/** Render native-resolution imported image, keeping the source coastline.
 * Edits made to working cells recolor only corresponding original land pixels,
 * except explicit land/water edits. Unedited pixels stay identical to input.
 * Uses strips to bound temporary pixel memory on large imported maps.
 */
import {decodeBaseline} from './master-map.mjs';
import {compositeNativePixels} from './native-composite.mjs';

function colorHex(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function imageBlob(dataUrl){
  const comma=dataUrl.indexOf(',');if(comma<0)throw new Error('Invalid embedded image');
  const binary=atob(dataUrl.slice(comma+1));
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:dataUrl.slice(5,dataUrl.indexOf(';'))});
}
function hasAnyEdits(map,master,baseline){
  const now=map.layers.regions;
  for(let i=0;i<now.length;i++)if(baseline[i] !== (map.valid[i]?now[i]:-999))return true;
  const prior=new Map(master.baselinePalette.map(p=>[p.id,p.color.toLowerCase()]));
  for(const p of map.palette)if(prior.has(p.id)&&prior.get(p.id)!==p.color.toLowerCase())return true;
  return false;
}
export async function renderNativeImportedPNG(map,master,{onProgress}={}){
  if(master.kind!=='imported')throw new Error('Native source image is unavailable');
  const source=await createImageBitmap(imageBlob(master.imageDataUrl));
  const w=master.nativeWidth,h=master.nativeHeight;
  if(source.width!==w||source.height!==h){source.close?.();throw new Error('Embedded source image dimensions do not match project');}
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx){source.close?.();throw new Error('This browser cannot create a native-resolution canvas');}
  ctx.drawImage(source,0,0);source.close?.();
  const base=decodeBaseline(master.baselineRuns,map.width,map.height);
  if(!hasAnyEdits(map,master,base))return canvas;
  const palette=new Map(map.palette.map(p=>[p.id,colorHex(p.color)]));
  const prevPalette=new Map(master.baselinePalette.map(p=>[p.id,p.color.toLowerCase()]));
  const recolored=new Set(map.palette.filter(p=>prevPalette.has(p.id)&&prevPalette.get(p.id)!==p.color.toLowerCase()).map(p=>p.id));
  const water=master.background||[0,0,0];
  const gw=map.width,gh=map.height;
  const xToGrid=new Uint32Array(w);
  for(let x=0;x<w;x++)xToGrid[x]=Math.min(gw-1,Math.floor(x*gw/w));
  const rowHeight=128;
  for(let y0=0;y0<h;y0+=rowHeight){
    const hh=Math.min(rowHeight,h-y0),part=ctx.getImageData(0,y0,w,hh),data=part.data;
    let altered=false;
    for(let y=0;y<hh;y++){
      const gy=Math.min(gh-1,Math.floor((y0+y)*gh/h)),row=gy*gw;
      for(let x=0;x<w;x++){
        const cell=row+xToGrid[x],original=base[cell],now=map.valid[cell]?map.layers.regions[cell]:-999;
        if(original===now&&!recolored.has(now))continue;
        const k=(y*w+x)*4;
        const nativeWater=Math.abs(data[k]-water[0])<=12&&Math.abs(data[k+1]-water[1])<=12&&Math.abs(data[k+2]-water[2])<=12;
        // Geography unchanged: original ocean/coastline is authoritative.
        if(original!==-999&&now!==-999&&nativeWater)continue;
        if(original===-999&&now===-999)continue;
        const c=now===-999?water:now===-1?[223,211,174]:(palette.get(now)||[223,211,174]);
        data[k]=c[0];data[k+1]=c[1];data[k+2]=c[2];data[k+3]=255;
        altered=true;
      }
    }
    if(altered)ctx.putImageData(part,0,y0);
    if(onProgress){onProgress(Math.round(100*(y0+hh)/h));await new Promise(resolve=>requestAnimationFrame(resolve));}
  }
  return canvas;
}
export async function downloadCanvasPNG(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG export failed')),'image/png'));
}

/** Render the regenerated NATIVE political owner layer, not the working grid.
 * Native waterpixels keep their original image pixels/shape exactly; every
 * land pixel is completely recolored from current native political ownership.
 * This calls the same shared compositor as the in-browser native viewport.
 */
export async function renderNativePoliticalPNG(master,native,palette,{onProgress,signal}={}){
  if(master?.kind!=='imported'||!native||!palette)throw new Error('Native political map is unavailable');
  if(master.nativeWidth!==native.width||master.nativeHeight!==native.height)
    throw new Error('Native politics and source-image dimensions disagree');
  const source=await createImageBitmap(imageBlob(master.imageDataUrl));
  const canvas=document.createElement('canvas');canvas.width=native.width;canvas.height=native.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx){source.close?.();throw new Error('Cannot create a full-resolution export canvas');}
  try{
    ctx.drawImage(source,0,0);
    for(let y0=0;y0<native.height;y0+=96){
      if(signal?.aborted)throw new Error('Native PNG export cancelled');
      const rows=Math.min(96,native.height-y0);
      const part=ctx.getImageData(0,y0,native.width,rows);
      compositeNativePixels(part.data,native.width,rows,native,palette,{originX:0,originY:y0,sourcePalette:master.baselinePalette,waterColor:master.background||[0,0,0]});
      ctx.putImageData(part,0,y0);
      onProgress?.(Math.round(100*(y0+rows)/native.height));
      if(y0%768===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    return canvas;
  }finally{source.close?.();}
}
