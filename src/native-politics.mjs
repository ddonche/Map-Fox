/**
 * Map Fox 0.7.4 — Phase B native political regeneration.
 *
 * A small seeded planning graph decides the broad political arrangement.
 * Unlike the 0.7.3 regeneration path, its cells are NEVER enlarged into
 * the final owner map. Instead a continuous, seeded boundary-influence field
 * is sampled at EVERY native land pixel and written to NativeMap owner tiles.
 *
 * Exact land/water bits are copied, never derived from planning output.
 * This is independent of the app's working/editor grid and its 5M-cell cap.
 *
 * Phase C will wire these tiles into the viewport/PNG renderer; Phase D
 * will wire native painting and eyedropper.
 */
import {NativeMap,UNCLAIMED} from './native-map.mjs';
import {growRegions} from './spawner.mjs';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>t*t*(3-2*t);
function hashSeed(value){
  let h=2166136261>>>0;
  for(const c of String(value)){h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;}
  return h>>>0;
}
function hash2(x,y,seed){
  let h=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;
  return ((h^(h>>>16))>>>0)/4294967295*2-1;
}
function noise(x,y,seed){
  const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy);
  const a=hash2(ix,iy,seed),b=hash2(ix+1,iy,seed);
  const c=hash2(ix,iy+1,seed),d=hash2(ix+1,iy+1,seed);
  return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}
function checkCancelled(signal){
  if(signal?.aborted)throw new Error('Native political regeneration cancelled');
}
function planningSize(width,height,maxCells){
  const scale=Math.min(1,Math.sqrt(maxCells/(width*height)));
  let w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
  while(w*h>maxCells)w>=h?w--:h--;
  return [w,h];
}

/**
 * Area-weighted sampling: native land is counted as land in a planner cell
 * if it occupies at least half of that rectangle. Counts come from the
 * ACTUAL native bit mask; no canvas smoothing or imported color leakage.
 * Isolated sub-planner islands survive in native tiles and receive a
 * separate nearest-territory / deliberate-unclaimed fallback.
 */
export function sampleNativePlanningMask(source,plannerWidth,plannerHeight){
  if(!(source instanceof NativeMap))throw new Error('Expected native source map');
  if(!Number.isInteger(plannerWidth)||!Number.isInteger(plannerHeight)||
     plannerWidth<1||plannerHeight<1||plannerWidth>source.width||plannerHeight>source.height)
    throw new Error('Invalid native planning dimensions');
  const w=source.width,h=source.height,pw=plannerWidth,ph=plannerHeight;
  const xPlan=new Uint32Array(w),yPlan=new Uint32Array(h);
  for(let x=0;x<w;x++)xPlan[x]=Math.min(pw-1,Math.floor(x*pw/w));
  for(let y=0;y<h;y++)yPlan[y]=Math.min(ph-1,Math.floor(y*ph/h));
  const counts=new Uint32Array(pw*ph);
  const tilesize=source.tileSize;
  let totalLand=0;
  for(const [key,tile] of source.tiles){
    const tileX=(key%source.columns)*tilesize, tileY=Math.floor(key/source.columns)*tilesize;
    const tw=Math.min(tilesize,w-tileX),th=Math.min(tilesize,h-tileY);
    for(let yy=0;yy<th;yy++){
      const planRow=yPlan[tileY+yy]*pw,row=yy*tw;
      for(let xx=0;xx<tw;xx++){
        const local=row+xx;
        if(!(tile.landBits[local>>>3]&(1<<(local&7))))continue;
        counts[planRow+xPlan[tileX+xx]]++;
        totalLand++;
      }
    }
  }
  const valid=new Uint8Array(pw*ph);
  let present=0,largest=-1,largestCount=0;
  for(let py=0;py<ph;py++){
    const y0=Math.ceil(py*h/ph),y1=Math.ceil((py+1)*h/ph);
    for(let px=0;px<pw;px++){
      const i=py*pw+px,x0=Math.ceil(px*w/pw),x1=Math.ceil((px+1)*w/pw);
      const area=(x1-x0)*(y1-y0),count=counts[i];
      if(count*2>=area && count>0){valid[i]=1;present++;}
      if(count>largestCount){largestCount=count;largest=i;}
    }
  }
  // A tiny island can occupy less than half a planner cell everywhere.
  // Give the planner one anchor; do NOT change the native mask.
  if(!present&&largest>=0){valid[largest]=1;present++;}
  return {valid,counts,totalLand,representedCells:present};
}

/** Fill water planning nodes with nearest land-region labels.
 * Deterministic multi-source 4-neighbor BFS, including explicit unclaimed
 * land as a label. This assigns sub-planner islands without creating land.
 */
function nearestLabels(planned,width,height){
  const labels=new Int32Array(width*height).fill(-2);
  const queue=new Int32Array(width*height);
  let head=0,tail=0;
  for(let i=0;i<labels.length;i++){
    if(!planned.valid[i])continue;
    labels[i]=planned.regions[i];queue[tail++]=i;
  }
  if(!tail)return labels;
  while(head<tail){
    const i=queue[head++],x=i%width,y=(i/width)|0,label=labels[i];
    const candidates=[x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1];
    for(const j of candidates){
      if(j<0||labels[j]!==-2)continue;
      labels[j]=label;queue[tail++]=j;
    }
  }
  return labels;
}
function boundaryFlags(labels,width,height){
  const flags=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,v=labels[i];
    for(let dy=-1;dy<=1&&!flags[i];dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&yy>=0&&xx<width&&yy<height&&labels[yy*width+xx]!==v){flags[i]=1;break;}
    }
  }
  return flags;
}
function buildWarp(width,height,seed,roughness){
  // The continuous displacement field is defined in planning coordinates
  // but sampled at native pixels. Sampling its bilinear interpolation yields
  // sub-cell political contours, never repeated planning rectangles.
  const step=2,fw=width*step+1,fh=height*step+1;
  const dx=new Float32Array(fw*fh),dy=new Float32Array(fw*fh);
  const a=hashSeed(String(seed)+':native-warp-x'),b=hashSeed(String(seed)+':native-warp-y');
  for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){
    const fx=x/step,fy=y/step,i=y*fw+x;
    dx[i]=roughness*(.58*noise(fx/2.7,fy/2.7,a)+.17*noise(fx/.67,fy/.67,a^0xb2f1a93d));
    dy[i]=roughness*(.58*noise(fx/2.7,fy/2.7,b)+.17*noise(fx/.67,fy/.67,b^0x37dc08f1));
  }
  return {dx,dy,width:fw,height:fh};
}
function warped(field,x,y){
  const fx=clamp(x*2+1,0,field.width-1),fy=clamp(y*2+1,0,field.height-1);
  const ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;
  const jx=Math.min(field.width-1,ix+1),jy=Math.min(field.height-1,iy+1);
  const i00=iy*field.width+ix,i10=iy*field.width+jx;
  const i01=jy*field.width+ix,i11=jy*field.width+jx;
  const vx=field.dx,vy=field.dy;
  const w00=(1-tx)*(1-ty),w10=tx*(1-ty),w01=(1-tx)*ty,w11=tx*ty;
  return [
    vx[i00]*w00+vx[i10]*w10+vx[i01]*w01+vx[i11]*w11,
    vy[i00]*w00+vy[i10]*w10+vy[i01]*w01+vy[i11]*w11
  ];
}
function weightedLabel(labels,pw,ph,gx,gy){
  gx=clamp(gx,0,pw-1);gy=clamp(gy,0,ph-1);
  const x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(pw-1,x0+1),y1=Math.min(ph-1,y0+1);
  const fx=gx-x0,fy=gy-y0;
  const ids=[labels[y0*pw+x0],labels[y0*pw+x1],labels[y1*pw+x0],labels[y1*pw+x1]];
  if(ids[0]===ids[1]&&ids[0]===ids[2]&&ids[0]===ids[3])return ids[0];
  const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
  let best=-Infinity,winner=ids[0];
  for(let i=0;i<4;i++){
    let strength=0;
    for(let j=0;j<4;j++)if(ids[j]===ids[i])strength+=weights[j];
    if(strength>best+1e-10||(Math.abs(strength-best)<=1e-10&&ids[i]<winner)){
      best=strength;winner=ids[i];
    }
  }
  return winner;
}

/**
 * Create a NEW native owner map while retaining the EXACT source land mask.
 * Does not mutate source. All costly work can be awaited/cancelled; UI wiring
 * and dedicated worker are Phase C/E, not part of this pure Phase B engine.
 *
 * @returns {Promise<{map:NativeMap,palette:Array,stats:Object}>}
 */
export async function regenerateNativePolitics(source,options={}){
  if(!(source instanceof NativeMap))throw new Error('Expected native source map');
  const {
    regionCount=20,seed='12345',independentIslandRegions='auto',
    unclaimedIslandRate=.12,maxPlanningCells=90000,
    roughness=1,regionIds=null,signal=null,onProgress=null,yieldEveryTiles=8
  }=options;
  const n=Number(regionCount);
  if(!Number.isInteger(n)||n<0||n>100)throw new Error('Region count must be 0–100');
  if(!Number.isFinite(maxPlanningCells)||maxPlanningCells<256||maxPlanningCells>400000)
    throw new Error('Planning grid limit must be between 256 and 400000');
  if(!Number.isFinite(roughness)||roughness<0||roughness>2)throw new Error('Roughness must be 0–2');
  if(!Number.isFinite(unclaimedIslandRate)||unclaimedIslandRate<0||unclaimedIslandRate>1)
    throw new Error('Unclaimed-island rate must be between 0 and 1');
  if(!Number.isInteger(yieldEveryTiles)||yieldEveryTiles<1||yieldEveryTiles>1024)
    throw new Error('Invalid native regeneration yield size');
  const notify=(phase,pct)=>{if(typeof onProgress==='function')onProgress({phase,percent:pct});};
  checkCancelled(signal);
  const w=source.width,h=source.height;
  const [pw,ph]=planningSize(w,h,Math.floor(maxPlanningCells));
  notify('sampling',0);
  const sampled=sampleNativePlanningMask(source,pw,ph);
  checkCancelled(signal);
  if(!sampled.totalLand)throw new Error('Cannot regenerate politics without native land pixels');
  notify('planning',10);
  const planned=growRegions({
    valid:sampled.valid,width:pw,height:ph,seed,
    regionCount:n,independentIslandRegions,unclaimedIslandRate
  });
  checkCancelled(signal);
  const ownerIds=regionIds===null?planned.palette.map(p=>p.id):regionIds;
  if(!Array.isArray(ownerIds)||ownerIds.length!==planned.palette.length||
     new Set(ownerIds).size!==ownerIds.length)
    throw new Error('Political region IDs must be unique and match the generated region count');
  const result=new NativeMap(w,h,{tileSize:source.tileSize,regionIds:ownerIds});
  const palette=planned.palette.map((p,i)=>({...p,id:ownerIds[i]}));
  const count=Math.max(1,ownerIds.length);
  const labels=nearestLabels({valid:sampled.valid,regions:planned.regions},pw,ph);
  const flags=boundaryFlags(labels,pw,ph);
  const warp=buildWarp(pw,ph,seed,roughness);
  notify('refining',20);
  let assigned=0,unclaimed=0,refined=0,subPlannerLand=0,processed=0;
  const tiles=[...source.tiles].sort((a,b)=>a[0]-b[0]);
  for(const [key,t] of tiles){
    checkCancelled(signal);
    const tx=(key%source.columns)*source.tileSize,ty=Math.floor(key/source.columns)*source.tileSize;
    const tw=Math.min(source.tileSize,w-tx),th=Math.min(source.tileSize,h-ty);
    const owners=new Uint16Array(tw*th);owners.fill(UNCLAIMED);
    const geography=t.landBits.slice();
    for(let ly=0;ly<th;ly++){
      const y=ty+ly,gy=(y+.5)*ph/h-.5,row=ly*tw;
      for(let lx=0;lx<tw;lx++){
        const local=row+lx;
        if(!(geography[local>>>3]&(1<<(local&7))))continue;
        const x=tx+lx,gx=(x+.5)*pw/w-.5;
        const pX=clamp(Math.round(gx),0,pw-1),pY=clamp(Math.round(gy),0,ph-1),pi=pY*pw+pX;
        let political;
        if(n===0)political=-1;
        else if(!sampled.valid[pi]){
          // Tiny islands absent in the planning mask still retain exact land;
          // choose nearest planned land owner's label, deterministically.
          political=labels[pi];subPlannerLand++;
        } else if(!flags[pi]){
          political=labels[pi];
        } else {
          const [wx,wy]=warped(warp,gx,gy);
          political=weightedLabel(labels,pw,ph,gx+wx,gy+wy);
          refined++;
        }
        if(political<0)unclaimed++;
        else{
          if(political>=count)throw new Error('Planner returned an unknown owner');
          owners[local]=political;assigned++;
        }
      }
    }
    result.tiles.set(key,{landBits:geography,owners});
    processed++;
    if(processed%yieldEveryTiles===0){
      notify('refining',20+Math.round(75*processed/Math.max(1,tiles.length)));
      checkCancelled(signal);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  checkCancelled(signal);
  if(assigned+unclaimed!==sampled.totalLand)throw new Error('Native ownership coverage mismatch');
  if(!result.geometryEquals(source))throw new Error('Native coastlines changed during regeneration');
  notify('complete',100);
  return {map:result,palette,seed,stats:{
    width:w,height:h,nativeLandCells:sampled.totalLand,
    assigned,unclaimed,refinedPixels:refined,subPlannerLand,
    planningWidth:pw,planningHeight:ph,
    planningCells:pw*ph,representedPlanningCells:sampled.representedCells,
    requestedRegions:n,actualRegions:ownerIds.length
  }};
}
