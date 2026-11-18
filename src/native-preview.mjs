/**
 * Map Fox source-resolution viewport for imported flat-color political maps.
 * Draws the visible source pixels at screen resolution instead of zooming the
 * downsampled editor grid. Editor ownership changes are applied on top.
 */
import {decodeBaseline} from './master-map.mjs';

export function createNativePreview({mapCanvas,mapFrame,viewport,getMap,getMaster,getView}){
  let image=null,imageMaster=null,requestedMaster=null,requestToken=0;
  let framePending=false,paintState=null,paintStateVersion=-1,dirtyVersion=0;
  const ctx=viewport.getContext('2d',{willReadFrequently:true});
  const showNative=()=>getMaster()?.kind==='imported'&&getView()==='regions';
  const hide=()=>{viewport.style.display='none';mapCanvas.style.opacity='1';};
  function disposeImage(){image?.close?.();image=null;imageMaster=null;paintState=null;}
  function queue(){
    if(framePending||!image||!showNative())return;
    framePending=true;
    requestAnimationFrame(()=>{framePending=false;if(showNative()&&imageMaster===getMaster())draw();});
  }
  function load(master){
    if(requestedMaster===master)return;
    requestedMaster=master;
    const token=++requestToken;
    disposeImage();
    fetch(master.imageDataUrl).then(r=>{if(!r.ok)throw new Error('Source image is unreadable');return r.blob();})
      .then(b=>createImageBitmap(b)).then(bitmap=>{
        if(token!==requestToken||getMaster()!==master){bitmap.close?.();return;}
        image=bitmap;imageMaster=master;paintState=null;paintStateVersion=-1;
        viewport.style.display='block';mapCanvas.style.opacity='0';queue();
      }).catch(e=>{if(token!==requestToken)return;console.error('Map Fox native preview:',e);hide();});
  }
  function state(){
    const map=getMap(),master=getMaster();
    if(!map||!master||!image||imageMaster!==master)return null;
    if(paintState&&paintStateVersion===dirtyVersion&&paintState.map===map)return paintState;
    const baseline=decodeBaseline(master.baselineRuns,map.width,map.height);
    const current=map.layers.regions,valid=map.valid;
    const oldPalette=new Map((master.baselinePalette||[]).map(p=>[p.id,p.color?.toLowerCase()]));
    const colors=new Map(map.palette.map(p=>[p.id,[1,3,5].map(k=>parseInt(p.color.slice(k,k+2),16))]));
    const recolored=new Set(map.palette.filter(p=>oldPalette.has(p.id)&&oldPalette.get(p.id)!==p.color?.toLowerCase()).map(p=>p.id));
    let changed=null;
    for(let k=0;k<baseline.length;k++){
      const now=valid[k]?current[k]:-999;
      if(now!==baseline[k]||recolored.has(now)){
        if(!changed)changed=new Uint8Array(baseline.length);
        changed[k]=1;
      }
    }
    paintState={map,baseline,changed,colors,water:master.background||[0,0,0]};
    paintStateVersion=dirtyVersion;
    return paintState;
  }
  function draw(){
    const map=getMap(),master=getMaster();
    if(!map||!master||!image||imageMaster!==master)return;
    const vw=mapFrame.clientWidth,vh=mapFrame.clientHeight;
    if(vw<2||vh<2)return;
    const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    const pw=Math.max(1,Math.round(vw*dpr)),ph=Math.max(1,Math.round(vh*dpr));
    if(viewport.width!==pw||viewport.height!==ph){viewport.width=pw;viewport.height=ph;}
    ctx.clearRect(0,0,pw,ph);
    const frameRect=mapFrame.getBoundingClientRect(),mapRect=mapCanvas.getBoundingClientRect();
    const left=mapRect.left-frameRect.left,top=mapRect.top-frameRect.top,sw=mapRect.width,sh=mapRect.height;
    if(sw<1||sh<1)return;
    const x0=Math.max(0,left),y0=Math.max(0,top),x1=Math.min(vw,left+sw),y1=Math.min(vh,top+sh);
    if(x1<=x0||y1<=y0)return;
    const sx=(x0-left)/sw*image.width,sy=(y0-top)/sh*image.height;
    const sW=(x1-x0)/sw*image.width,sH=(y1-y0)/sh*image.height;
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(image,sx,sy,sW,sH,x0*dpr,y0*dpr,(x1-x0)*dpr,(y1-y0)*dpr);
    const edit=state();if(!edit?.changed)return;
    const rx0=Math.max(0,Math.floor(x0*dpr)),ry0=Math.max(0,Math.floor(y0*dpr));
    const rw=Math.min(pw-rx0,Math.ceil(x1*dpr)-rx0),rh=Math.min(ph-ry0,Math.ceil(y1*dpr)-ry0);
    if(rw<=0||rh<=0)return;
    const pixels=ctx.getImageData(rx0,ry0,rw,rh),data=pixels.data;
    const colIndex=new Int32Array(rw),width=map.width,height=map.height;
    for(let xx=0;xx<rw;xx++){
      colIndex[xx]=Math.max(0,Math.min(width-1,Math.floor(((rx0+xx)/dpr-left)/sw*width)));
    }
    let updated=false;
    const water=edit.water;
    for(let yy=0;yy<rh;yy++){
      const gy=Math.max(0,Math.min(height-1,Math.floor(((ry0+yy)/dpr-top)/sh*height)));
      const row=gy*width;
      for(let xx=0;xx<rw;xx++){
        const k=row+colIndex[xx];if(!edit.changed[k])continue;
        const now=map.valid[k]?map.layers.regions[k]:-999,original=edit.baseline[k];
        const p=(yy*rw+xx)*4;
        const waterPixel=Math.abs(data[p]-water[0])<=12&&Math.abs(data[p+1]-water[1])<=12&&Math.abs(data[p+2]-water[2])<=12;
        // If ownership changes but land/water does not, retain fine waterways.
        if(original!==-999&&now!==-999&&waterPixel)continue;
        if(original===-999&&now===-999)continue;
        const color=now===-999?water:now===-1?[223,211,174]:(edit.colors.get(now)||[223,211,174]);
        data[p]=color[0];data[p+1]=color[1];data[p+2]=color[2];data[p+3]=255;
        updated=true;
      }
    }
    if(updated)ctx.putImageData(pixels,rx0,ry0);
  }
  const resizeObserver=new ResizeObserver(()=>queue());resizeObserver.observe(mapFrame);
  return {
    sync(view){
      if(!showNative()||view!=='regions'){hide();return false;}
      const master=getMaster();
      if(imageMaster!==master||!image){hide();load(master);return false;}
      viewport.style.display='block';mapCanvas.style.opacity='0';queue();return true;
    },
    markDataChanged(){dirtyVersion++;paintState=null;},
    invalidate(){queue();}
  };
}
