import { growRegions } from './spawner.mjs';
const Subdivider = (() => {
/** Optional subdivisions on any generic parent-region layer, generated or imported. */

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function tint(hex,id){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  // Small, deterministic shade variations retain parent identity visually.
  const t=[-.22,-.11,.04,.15,.25,-.04][id%6];
  const v=[r,g,b].map(c=>Math.round(clamp(t>=0?c+(255-c)*t:c*(1+t),0,255)));
  return '#'+v.map(c=>c.toString(16).padStart(2,'0')).join('');
}
function assignUnclaimedIslands(regions,valid,width,height){
  // For each remaining disconnected valid component, use the closest assigned
  // province ID; a subdivision can have satellite fragments across void cells.
  const seen=new Uint8Array(valid.length),q=[];
  const owned=[];
  for(let i=0;i<regions.length;i++)if(regions[i]>=0)owned.push(i);
  if(!owned.length)return;
  // Precompute multi-source nearest-province ownership over water as well.
  const nearest=new Int32Array(valid.length).fill(-1);
  const queue=new Int32Array(valid.length);let front=0,back=0;
  for(const i of owned){nearest[i]=regions[i];queue[back++]=i;}
  while(front<back){const i=queue[front++],x=i%width,y=(i/width)|0;
    for(const n of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1]){
      if(n>=0&&nearest[n]<0){nearest[n]=nearest[i];queue[back++]=n;}
    }
  }
  for(let i=0;i<regions.length;i++)if(valid[i]&&regions[i]<0)regions[i]=nearest[i];
}
function subdivideMap(map,{defaultCount=0,counts={},seed='subdivisions'}={}) {
  const {width,height,valid,palette}=map,parent=map.layers.regions;
  if(!parent||parent.length!==valid.length)throw new Error('Map has no region layer');
  const layers=new Int32Array(valid.length).fill(-1),subPalette=[],actualCounts={};
  const parentRegions=new Map();
  for(let i=0;i<parent.length;i++)if(valid[i]&&parent[i]>=0){
    const id=parent[i];let rec=parentRegions.get(id);
    if(!rec){rec={cells:[],minX:width,maxX:0,minY:height,maxY:0};parentRegions.set(id,rec);}
    rec.cells.push(i);const x=i%width,y=(i/width)|0;
    rec.minX=Math.min(rec.minX,x);rec.maxX=Math.max(rec.maxX,x);
    rec.minY=Math.min(rec.minY,y);rec.maxY=Math.max(rec.maxY,y);
  }
  for(const [parentId,rec] of [...parentRegions].sort((a,b)=>a[0]-b[0])){
    const target=Number(Object.hasOwn(counts,parentId)?counts[parentId]:defaultCount);
    const n=clamp(Math.floor(target||0),0,Math.min(100,rec.cells.length));
    actualCounts[parentId]=n;if(n===0)continue;
    const parentColor=palette.find(p=>p.id===parentId)?.color??'#93a2b2';
    const parentName=palette.find(p=>p.id===parentId)?.label??`Region ${parentId+1}`;
    const ids=Array.from({length:n},(_,j)=>{
      const id=subPalette.length;
      subPalette.push({id,parentId,label:`${parentName} · ${j+1}`,color:tint(parentColor,j)});return id;
    });
    if(n===1){for(const idx of rec.cells)layers[idx]=ids[0];continue;}
    const cropX=Math.max(0,rec.minX-1),cropY=Math.max(0,rec.minY-1);
    const w=Math.min(width-1,rec.maxX+1)-cropX+1,h=Math.min(height-1,rec.maxY+1)-cropY+1;
    const mask=new Uint8Array(w*h);
    for(const idx of rec.cells){const xx=idx%width-cropX,yy=((idx/width)|0)-cropY;mask[yy*w+xx]=1;}
    const built=growRegions({valid:mask,width:w,height:h,seed:`${seed}:${parentId}`,regionCount:n,independentIslandRegions:0,unclaimedIslandRate:0});
    assignUnclaimedIslands(built.regions,mask,w,h);
    for(const idx of rec.cells){const xx=idx%width-cropX,yy=((idx/width)|0)-cropY,local=built.regions[yy*w+xx];
      if(local>=0&&local<n)layers[idx]=ids[local];
      else layers[idx]=ids[0];
    }
  }
  return {layer:layers,palette:subPalette,counts:actualCounts,seed};
}

return {subdivideMap};
})();

export const {subdivideMap} = Subdivider;
