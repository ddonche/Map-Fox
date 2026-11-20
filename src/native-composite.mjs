/**
 * Shared native political compositing for viewport and PNG export.
 * Every visible land pixel receives its current native region's color.
 * Original image pixels remain untouched wherever native geography is water.
 * No old imported political colors can leak through after a reroll.
 */
import {NativeMap,UNCLAIMED} from './native-map.mjs';

export function nativeColorTable(native,palette,unclaimed=[223,211,174]){
  if(!(native instanceof NativeMap))throw new Error('Native political map required');
  const lookup=new Map((palette||[]).map(p=>[p.id,p.color]));
  const colors=new Uint8Array((native.regionIds.length+1)*3);
  for(let i=0;i<native.regionIds.length;i++){
    const hex=lookup.get(native.regionIds[i]);
    if(typeof hex!=='string'||!/^#[0-9a-f]{6}$/i.test(hex))
      throw new Error('Missing or invalid native political color for region '+native.regionIds[i]);
    const k=i*3;
    colors[k]=parseInt(hex.slice(1,3),16);
    colors[k+1]=parseInt(hex.slice(3,5),16);
    colors[k+2]=parseInt(hex.slice(5,7),16);
  }
  const k=native.regionIds.length*3;colors[k]=unclaimed[0];colors[k+1]=unclaimed[1];colors[k+2]=unclaimed[2];
  return colors;
}

/**
 * Replace source land pixels in a decoded RGBA rectangle.
 *
 * originX/Y = continuous native-coordinate position of the first output
 * pixel; stepX/Y = source pixels per output pixel (normally 1 for PNG).
 *
 * A single function runs on BOTH the native-resolution editor viewport and
 * exported PNG image strips, keeping political borders pixel-consistent.
 */
export function compositeNativePixels(data,width,height,native,palette,{originX=0,originY=0,stepX=1,stepY=1}={}){
  if(!(native instanceof NativeMap)||!(data instanceof Uint8ClampedArray)||
     !Number.isInteger(width)||!Number.isInteger(height)||data.length!==width*height*4)
    throw new Error('Invalid native compositing buffer');
  if(![originX,originY,stepX,stepY].every(Number.isFinite)||stepX<=0||stepY<=0)
    throw new Error('Invalid native viewport transform');
  const colors=nativeColorTable(native,palette),ts=native.tileSize,columns=native.columns;
  const unclaimed=native.regionIds.length;
  const xLocal=new Int32Array(width),xTile=new Int32Array(width);
  for(let x=0;x<width;x++){
    const nx=Math.floor(originX+(x+.5)*stepX);
    if(nx<0||nx>=native.width){xTile[x]=-1;continue;}
    const tx=Math.floor(nx/ts);xTile[x]=tx;xLocal[x]=nx-tx*ts;
  }
  let changed=0;
  for(let y=0;y<height;y++){
    const ny=Math.floor(originY+(y+.5)*stepY);
    if(ny<0||ny>=native.height)continue;
    const ty=Math.floor(ny/ts),tileY=ny-ty*ts;
    const row=y*width;
    let prevTx=-2,tile=null,tileW=0;
    for(let x=0;x<width;x++){
      const tx=xTile[x];if(tx<0)continue;
      if(tx!==prevTx){prevTx=tx;tile=native.tiles.get(ty*columns+tx);tileW=Math.min(ts,native.width-tx*ts);}
      if(!tile)continue;
      const offset=tileY*tileW+xLocal[x];
      if(!(tile.landBits[offset>>>3]&(1<<(offset&7))))continue;
      const code=tile.owners[offset],k=(row+x)*4;
      const ci=(code===UNCLAIMED?unclaimed:code)*3;
      data[k]=colors[ci];data[k+1]=colors[ci+1];data[k+2]=colors[ci+2];data[k+3]=255;
      changed++;
    }
  }
  return changed;
}
