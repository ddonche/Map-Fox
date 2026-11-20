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


// The source image includes anti-aliased rivers and shorelines. Pixels on
// the dark fringe are *not* exactly black; a binary land mask alone classifies
// them as land and erases the soft river pixels during political recoloring.
// Cache a two-pixel water-neighborhood mask per native tile. Only pixels near
// genuine water can inherit source line-work coverage; unrelated original
// country colors are never preserved.
const mfWaterFringeCache=new WeakMap();
function mfNativeIsWater(native,x,y){
  if(x<0||y<0||x>=native.width||y>=native.height)return true;
  const ts=native.tileSize,tx=(x/ts)|0,ty=(y/ts)|0;
  const tile=native.tiles.get(ty*native.columns+tx);
  if(!tile)return true;
  const tw=Math.min(ts,native.width-tx*ts);
  const k=(y-ty*ts)*tw+(x-tx*ts);
  return !(tile.landBits[k>>>3]&(1<<(k&7)));
}
function mfWaterFringe(native,key){
  let cached=mfWaterFringeCache.get(native);
  if(!cached){cached=new Map();mfWaterFringeCache.set(native,cached);}
  if(cached.has(key))return cached.get(key);
  const tile=native.tiles.get(key);
  if(!tile){cached.set(key,null);return null;}
  const ts=native.tileSize,tx=key%native.columns,ty=(key/native.columns)|0;
  const x0=tx*ts,y0=ty*ts,tw=Math.min(ts,native.width-x0),th=Math.min(ts,native.height-y0);
  const bits=new Uint8Array(Math.ceil(tw*th/8));
  for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
    const i=y*tw+x;
    if(!(tile.landBits[i>>>3]&(1<<(i&7))))continue;
    const nx=x0+x,ny=y0+y;
    if(
      mfNativeIsWater(native,nx-1,ny)||mfNativeIsWater(native,nx+1,ny)||
      mfNativeIsWater(native,nx,ny-1)||mfNativeIsWater(native,nx,ny+1)||
      mfNativeIsWater(native,nx-1,ny-1)||mfNativeIsWater(native,nx+1,ny-1)||
      mfNativeIsWater(native,nx-1,ny+1)||mfNativeIsWater(native,nx+1,ny+1)||
      mfNativeIsWater(native,nx-2,ny)||mfNativeIsWater(native,nx+2,ny)||
      mfNativeIsWater(native,nx,ny-2)||mfNativeIsWater(native,nx,ny+2)
    )bits[i>>>3]|=1<<(i&7);
  }
  cached.set(key,bits);
  return bits;
}
function mfSourcePalette(sourcePalette,waterColor){
  const old=[];
  for(const p of sourcePalette||[]){
    const color=p.color;
    if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))continue;
    const r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
    const dr=r-waterColor[0],dg=g-waterColor[1],db=b-waterColor[2],length=dr*dr+dg*dg+db*db;
    if(length>400)old.push([dr,dg,db,length]);
  }
  return old;
}
// Infer how much of the old *land* color contributed to an anti-aliased
// source pixel: original = coverage * oldLand + (1-coverage) * sourceWater.
// Reapply the SAME coverage to the new political fill, eliminating old
// political colors without deleting the native black/blue water detail.
function mfLandCoverage(r,g,b,old,water){
  const cr=r-water[0],cg=g-water[1],cb=b-water[2];
  let bestError=Infinity,bestCoverage=1;
  for(let i=0;i<old.length;i++){
    const c=old[i];
    const coverage=Math.min(1,Math.max(0,(cr*c[0]+cg*c[1]+cb*c[2])/c[3]));
    const er=cr-coverage*c[0],eg=cg-coverage*c[1],eb=cb-coverage*c[2];
    const error=er*er+eg*eg+eb*eb;
    if(error<bestError){bestError=error;bestCoverage=coverage;}
  }
  // Require a credible original-color mixture. If no match, recolor
  // normally: stale political colors may not leak through.
  return bestError<=225?bestCoverage:1;
}


// Some genuinely thin Photoshop waterways have no exact-black center pixel
// after anti-aliasing. Treat a dark, palette-matching linear feature as a
// geographic detail only if nearby ORIGINAL pixels are significantly brighter.
// This prevents flat dark-colored regions from being mistaken for water lines.
function mfThinWaterLine(source,width,height,x,y,stepX,stepY,water){
  const k=(y*width+x)*4;
  const r=source[k]-water[0],g=source[k+1]-water[1],b=source[k+2]-water[2];
  const darkness=Math.max(Math.abs(r),Math.abs(g),Math.abs(b));
  if(darkness>102)return false;
  const dx=Math.min(24,Math.max(2,Math.ceil(1.5/stepX)));
  const dy=Math.min(24,Math.max(2,Math.ceil(1.5/stepY)));
  const points=[[x-dx,y],[x+dx,y],[x,y-dy],[x,y+dy]];
  for(const [xx,yy] of points){
    if(xx<0||yy<0||xx>=width||yy>=height)continue;
    const i=(yy*width+xx)*4;
    const bright=Math.max(Math.abs(source[i]-water[0]),Math.abs(source[i+1]-water[1]),Math.abs(source[i+2]-water[2]));
    if(bright>=darkness+35)return true;
  }
  return false;
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
export function compositeNativePixels(data,width,height,native,palette,{originX=0,originY=0,stepX=1,stepY=1,sourcePalette=null,waterColor=[0,0,0]}={}){
  if(!(native instanceof NativeMap)||!(data instanceof Uint8ClampedArray)||
     !Number.isInteger(width)||!Number.isInteger(height)||data.length!==width*height*4)
    throw new Error('Invalid native compositing buffer');
  if(![originX,originY,stepX,stepY].every(Number.isFinite)||stepX<=0||stepY<=0)
    throw new Error('Invalid native viewport transform');
  const colors=nativeColorTable(native,palette),ts=native.tileSize,columns=native.columns;
  const sourceColors=sourcePalette?mfSourcePalette(sourcePalette,waterColor):[];
  const restoreWaterFringe=sourceColors.length>0;
  const unclaimed=native.regionIds.length;
  const sourceSnapshot=restoreWaterFringe?data.slice():null;
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
    let prevTx=-2,tile=null,tileW=0,fringe=null;
    for(let x=0;x<width;x++){
      const tx=xTile[x];if(tx<0)continue;
      if(tx!==prevTx){prevTx=tx;const key=ty*columns+tx;tile=native.tiles.get(key);tileW=Math.min(ts,native.width-tx*ts);fringe=restoreWaterFringe?mfWaterFringe(native,key):null;}
      if(!tile)continue;
      const offset=tileY*tileW+xLocal[x];
      if(!(tile.landBits[offset>>>3]&(1<<(offset&7))))continue;
      const code=tile.owners[offset],k=(row+x)*4;
      const ci=(code===UNCLAIMED?unclaimed:code)*3;
      let coverage=1;
      if(restoreWaterFringe&&(
        (fringe&&(fringe[offset>>>3]&(1<<(offset&7)))) ||
        mfThinWaterLine(sourceSnapshot,width,height,x,y,stepX,stepY,waterColor)
      )){
        coverage=mfLandCoverage(sourceSnapshot[k],sourceSnapshot[k+1],sourceSnapshot[k+2],sourceColors,waterColor);
      }
      if(coverage<1){
        const waterPart=1-coverage;
        data[k]=Math.round(coverage*colors[ci]+waterPart*waterColor[0]);
        data[k+1]=Math.round(coverage*colors[ci+1]+waterPart*waterColor[1]);
        data[k+2]=Math.round(coverage*colors[ci+2]+waterPart*waterColor[2]);
      }else{
        data[k]=colors[ci];data[k+1]=colors[ci+1];data[k+2]=colors[ci+2];
      }
      data[k+3]=255;
      changed++;
    }
  }
  return changed;
}
