/**
 * Build an exact native land/water mask from the embedded imported source.
 * Phase C entry point. A tiled canvas avoids allocating a second full-size
 * ImageData buffer; all political owners initially remain unclaimed.
 *
 * Clean, flat-color maps: EXACT background-color matching by default.
 * No inferred border "repair", geography smoothing or lossy resizing.
 */
import {NativeMap,UNCLAIMED} from './native-map.mjs';

export async function loadNativeGeography(master,{signal=null,onProgress=null,waterTolerance=0,yieldEveryTiles=8}={}){
  if(master?.kind!=='imported'||typeof master.imageDataUrl!=='string')
    throw new Error('Native geography requires an imported image with original pixels');
  if(!Number.isFinite(waterTolerance)||waterTolerance<0||waterTolerance>255)
    throw new Error('Invalid native water tolerance');
  const background=master.background||[0,0,0];
  if(background.length!==3||background.some(v=>!Number.isInteger(v)||v<0||v>255))
    throw new Error('Invalid native source background');
  const cancelled=()=>{if(signal?.aborted)throw new Error('Native geography scan cancelled');};
  cancelled();
  const response=await fetch(master.imageDataUrl);
  if(!response.ok)throw new Error('Could not read embedded source image');
  const bitmap=await createImageBitmap(await response.blob());
  const width=master.nativeWidth,height=master.nativeHeight;
  if(bitmap.width!==width||bitmap.height!==height){
    bitmap.close?.();throw new Error('Original image dimensions do not match the project');
  }
  const map=new NativeMap(width,height),ts=map.tileSize;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx){bitmap.close?.();throw new Error('Native image scan is unavailable in this browser');}
  const tol2=waterTolerance*waterTolerance;
  let count=0,land=0;
  const total=map.rows*map.columns;
  try{
    for(let ty=0;ty<map.rows;ty++){
      for(let tx=0;tx<map.columns;tx++){
        cancelled();
        const x=tx*ts,y=ty*ts,tw=Math.min(ts,width-x),th=Math.min(ts,height-y),length=tw*th;
        canvas.width=tw;canvas.height=th;
        ctx.clearRect(0,0,tw,th);
        ctx.drawImage(bitmap,x,y,tw,th,0,0,tw,th);
        const pixels=ctx.getImageData(0,0,tw,th).data;
        const bits=new Uint8Array(Math.ceil(length/8));
        let hasLand=false;
        for(let i=0;i<length;i++){
          const k=i*4;
          if(pixels[k+3]<128)continue;
          const dr=pixels[k]-background[0],dg=pixels[k+1]-background[1],db=pixels[k+2]-background[2];
          if(dr*dr+dg*dg+db*db<=tol2)continue;
          bits[i>>>3]|=1<<(i&7);land++;hasLand=true;
        }
        if(hasLand){
          const owners=new Uint16Array(length);owners.fill(UNCLAIMED);
          map.tiles.set(ty*map.columns+tx,{landBits:bits,owners});
        }
        count++;
        if(count%yieldEveryTiles===0){
          onProgress?.({phase:'geography',percent:Math.round(100*count/total)});
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
    }
    cancelled();
    onProgress?.({phase:'geography',percent:100});
    if(!land)throw new Error('The source image contains no land outside the selected water color');
    return map;
  }finally{bitmap.close?.();}
}
