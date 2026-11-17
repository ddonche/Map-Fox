import { neighbors } from './spawner.mjs';
const Importer = (() => {
/** Map Fox — pixel-map importer, inherited from V6.1. Dependency-free; no DOM assumptions.
 * RGBA input comes from a browser canvas or any image decoder. Generic output
 * is a void mask, region IDs, and palette; no political semantics are baked in.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist2=(a,b)=>((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
const hex=(rgb)=>'#'+rgb.slice(0,3).map(x=>clamp(Math.round(x),0,255).toString(16).padStart(2,'0')).join('');
const rgbAt=(data,i)=>[data[i*4],data[i*4+1],data[i*4+2]];
const lum=(p)=>.2126*p[0]+.7152*p[1]+.0722*p[2];

/** Sample a small square, using per-channel medians (avoids text strokes). */
function sampleColor(rgba,width,height,x,y,r=3) {
  const channels=[[],[],[]];
  for(let yy=Math.max(0,y-r);yy<=Math.min(height-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(width-1,x+r);xx++){
    const k=(yy*width+xx)*4;
    for(let c=0;c<3;c++)channels[c].push(rgba[k+c]);
  }
  return channels.map(ch=>{ch.sort((a,b)=>a-b);return ch[ch.length>>1];});
}
/** Median filter suppresses one-pixel map labels and thin borders while preserving flat color edges. */
function medianImage(rgba,width,height,passes=1){
  let src=new Uint8ClampedArray(rgba);
  for(let pass=0;pass<passes;pass++){
    const out=new Uint8ClampedArray(src.length),samples=new Array(9);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=(y*width+x)*4;
      for(let ch=0;ch<3;ch++){
        let k=0;
        for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
          const cx=clamp(x+ox,0,width-1),cy=clamp(y+oy,0,height-1);
          samples[k++]=src[(cy*width+cx)*4+ch];
        }
        samples.sort((a,b)=>a-b);out[at+ch]=samples[4];
      }
      out[at+3]=src[at+3];
    }
    src=out;
  }
  return src;
}
/** Suppress isolated line-like groups in the ocean, such as place labels. */
function removeFloatingLabels(valid,rgba,width,height,bg){
  const seen=new Uint8Array(valid.length),queue=new Int32Array(valid.length);
  for(let start=0;start<valid.length;start++){
    if(!valid[start]||seen[start])continue;
    let front=0,back=1;queue[0]=start;seen[start]=1;
    let minX=width,maxX=0,minY=height,maxY=0,r=0,g=0,b=0;
    while(front<back){
      const i=queue[front++],x=i%width,y=(i/width)|0,k=i*4;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      r+=rgba[k];g+=rgba[k+1];b+=rgba[k+2];
      for(const j of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1]){
        if(j>=0&&!seen[j]&&valid[j]){seen[j]=1;queue[back++]=j;}
      }
    }
    if(back>210)continue;
    const avg=[r/back,g/back,b/back],w=maxX-minX+1,h=maxY-minY+1;
    const thin=(w>=10&&h<=9&&w/h>=2.0)||(h>=10&&w<=8&&h/w>=1.9);
    const neutral=Math.max(...avg)-Math.min(...avg)<35;
    if(thin&&neutral&&lum(avg)<235&&dist2(avg,bg)<10000){
      for(let q=0;q<back;q++)valid[queue[q]]=0;
    }
  }
}

function colorHistogram(rgba,mask,step=1){
  const hist=new Map();
  for(let i=0;i<mask.length;i+=step){if(!mask[i])continue;
    const k=i*4, color=(rgba[k]<<16)|(rgba[k+1]<<8)|rgba[k+2];hist.set(color,(hist.get(color)||0)+1);
  }
  return [...hist].sort((a,b)=>b[1]-a[1]);
}
function unpack(num){return [(num>>>16)&255,(num>>>8)&255,num&255];}
function kmeansColors(rgba,valid,requestedK){
  const bins=new Map();let eligible=0;
  for(let i=0;i<valid.length;i+=2){
    if(!valid[i])continue;
    const p=rgbAt(rgba,i);if(lum(p)<68)continue;
    const key=((p[0]>>4)<<8)|((p[1]>>4)<<4)|(p[2]>>4);
    const row=bins.get(key)||{n:0,r:0,g:0,b:0};row.n++;row.r+=p[0];row.g+=p[1];row.b+=p[2];bins.set(key,row);eligible++;
  }
  const candidates=[...bins.values()].filter(b=>b.n>=2).sort((a,b)=>b.n-a.n).map(b=>({n:b.n,c:[b.r/b.n,b.g/b.n,b.b/b.n]}));
  if(!candidates.length)return [[216,207,171]];
  const centers=[];
  // Favor frequent flat fills, but ensure minority hues also have a chance.
  let mindistance=28;
  while(centers.length<requestedK&&mindistance>=7){
    for(const v of candidates){if(centers.length>=requestedK)break;
      if(centers.every(c=>dist2(c,v.c)>=mindistance*mindistance))centers.push(v.c.slice());
    }
    mindistance*=.72;
  }
  for(let round=0;round<7;round++){
    const sums=centers.map(()=>[0,0,0,0]);
    for(const v of candidates){let best=0,d=Infinity;
      for(let c=0;c<centers.length;c++){const test=dist2(v.c,centers[c]);if(test<d){d=test;best=c;}}
      const s=sums[best];s[0]+=v.c[0]*v.n;s[1]+=v.c[1]*v.n;s[2]+=v.c[2]*v.n;s[3]+=v.n;
    }
    for(let j=0;j<centers.length;j++)if(sums[j][3])centers[j]=sums[j].slice(0,3).map(x=>x/sums[j][3]);
  }
  return centers;
}
function fillNoisyBorders(regions,valid,width,height){
  const q=new Int32Array(valid.length);let a=0,b=0;
  for(let i=0;i<regions.length;i++)if(valid[i]&&regions[i]>=0)q[b++]=i;
  while(a<b){const i=q[a++],x=i%width,y=(i/width)|0,id=regions[i];
    if(x>0&&valid[i-1]&&regions[i-1]===-2){regions[i-1]=id;q[b++]=i-1;}
    if(x+1<width&&valid[i+1]&&regions[i+1]===-2){regions[i+1]=id;q[b++]=i+1;}
    if(y>0&&valid[i-width]&&regions[i-width]===-2){regions[i-width]=id;q[b++]=i-width;}
    if(y+1<height&&valid[i+width]&&regions[i+width]===-2){regions[i+width]=id;q[b++]=i+width;}
  }
  for(let i=0;i<regions.length;i++)if(regions[i]===-2)regions[i]=-1;
}
function smoothSmallArtifacts(regions,valid,width,height,passes){
  for(let iter=0;iter<passes;iter++){
    const old=new Int32Array(regions);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x;if(!valid[i])continue;
      const counts=new Map();let count=0;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        const j=yy*width+xx;if(!valid[j]||old[j]<0)continue;
        counts.set(old[j],(counts.get(old[j])||0)+1);count++;
      }
      let best=old[i],n=0;for(const [id,v] of counts)if(v>n){best=id;n=v;}
      if(best!==old[i]&&n>=Math.max(13,Math.floor(count*.69)))regions[i]=best;
    }
  }
}


/** A clean map has large genuinely flat fills. Its paint pixels should not
 * undergo median/majority filters; those filters damage islands and thin capes.
 * Borders, if present, are resolved conservatively as thin gaps only.
 */
function solidColors(rgba,width,height,background,waterTolerance){
  const counts=new Map(), interior=new Map(), patches=new Map();
  const size=width*height,bg2=waterTolerance**2;
  // Count *exact* colors before any blur or resizing. Interior evidence rejects
  // 1px outlines that might otherwise be mistaken for a new country.
  for(let i=0;i<size;i++){
    const k=i*4;if(rgba[k+3]<110)continue;
    const r=rgba[k],g=rgba[k+1],b=rgba[k+2];
    if((r-background[0])**2+(g-background[1])**2+(b-background[2])**2<=bg2)continue;
    const color=(r<<16)|(g<<8)|b;
    counts.set(color,(counts.get(color)||0)+1);
    const x=i%width,y=(i/width)|0;
    if(x===0||x===width-1||y===0||y===height-1)continue;
    const neighbors=[i-1,i+1,i-width,i+width];
    let exact=0;
    for(const j of neighbors){const q=j*4;if(rgba[q]===r&&rgba[q+1]===g&&rgba[q+2]===b)exact++;}
    if(exact===4)interior.set(color,(interior.get(color)||0)+1);
    if(exact>=2)patches.set(color,(patches.get(color)||0)+1);
  }
  const minLarge=Math.max(12,Math.round(size*.000008));
  const candidates=[];
  for(const [color,n] of counts){
    const inside=interior.get(color)||0, patch=patches.get(color)||0;
    // Large flat swaths and genuine small colored patches survive; long
    // 1-pixel outlines have no 2-D interior and are rejected.
    const c=unpack(color),chroma=Math.max(...c)-Math.min(...c);
    // Neutral dark linework can contain a few genuinely flat corners, yet is
    // not usually a territory fill. Demand substantial mass for such a color.
    const darkNeutral=chroma<42&&lum(c)<142;
    if(darkNeutral&&n<Math.max(120,size*.0002))continue;
    if((n>=minLarge&&inside>=Math.max(2,Math.floor(n*.03)))||
       (n>=4&&n<minLarge&&patch>=Math.max(2,n*.5)&&!darkNeutral))
      candidates.push({color,n,inside,patch,c});
  }
  candidates.sort((a,b)=>b.n-a.n||a.color-b.color);
  const centers=[];
  for(const cand of candidates){
    if(centers.length>=120)break;
    // A near-identical paint shade (PNG export artifacts) is one fill, but do
    // not aggressively merge distinct pastel kingdoms.
    if(centers.some(v=>dist2(v,cand.c)<8**2))continue;
    centers.push(cand.c);
  }
  return centers;
}
function likelyCleanImage(rgba,width,height,bg,tolerance){
  const hist=new Map();let eligible=0;
  const water2=tolerance*tolerance;
  for(let i=0;i<width*height;i+=3){
    const k=i*4;if(rgba[k+3]<110)continue;
    if((rgba[k]-bg[0])**2+(rgba[k+1]-bg[1])**2+(rgba[k+2]-bg[2])**2<=water2)continue;
    const key=(rgba[k]<<16)|(rgba[k+1]<<8)|rgba[k+2];
    hist.set(key,(hist.get(key)||0)+1);eligible++;
  }
  const largest=[...hist.values()].sort((a,b)=>b-a).slice(0,60).reduce((a,b)=>a+b,0);
  return eligible>0&&largest/eligible>.88;
}
/** A narrow dark border can be void-colored, even between two colored lands.
 * Fill only single-cell gaps with strong land evidence on opposing sides.
 * Never globally close water: real lakes/straits must remain intact.
 */
function bridgeOneCellBorders(valid,regions,width,height){
  const changes=[];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;if(valid[i])continue;
    const l=regions[i-1],r=regions[i+1],u=regions[i-width],d=regions[i+width];
    const lr=valid[i-1]&&valid[i+1],ud=valid[i-width]&&valid[i+width];
    if(!lr&&!ud)continue;
    const votes=new Map();
    const around=[i-1,i+1,i-width,i+width];
    for(const j of around)if(valid[j]&&regions[j]>=0)votes.set(regions[j],(votes.get(regions[j])||0)+1);
    const assigned=[...votes.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
    if(!assigned.length)continue;
    // A clearly enclosed pinhole, or an internal border between different
    // territories. Do not bridge a likely channel between matching shores.
    const neighbors=around.filter(j=>valid[j]&&regions[j]>=0).length;
    const twoRegions=(lr&&l>=0&&r>=0&&l!==r)||(ud&&u>=0&&d>=0&&u!==d);
    if(neighbors>=3||twoRegions)changes.push([i,assigned[0][0]]);
  }
  for(const [i,id] of changes){valid[i]=1;regions[i]=id;}
  return changes.length;
}
function nearestCenter(p,centers){
  let id=-1,best=Infinity;
  for(let j=0;j<centers.length;j++){
    const d=dist2(p,centers[j]);if(d<best){best=d;id=j;}
  }
  return [id,best];
}
function importCleanPixels({rgba,width,height,background,waterTolerance}){
  const size=width*height,centers=solidColors(rgba,width,height,background,waterTolerance);
  if(!centers.length)throw new Error('No distinct flat region colors found. Try Assisted mode or sample a different water color.');
  const valid=new Uint8Array(size),regions=new Int32Array(size).fill(-1);
  const bg2=waterTolerance*waterTolerance;
  let rejected=0,ambiguous=0;
  for(let i=0;i<size;i++){
    const k=i*4;if(rgba[k+3]<110)continue;
    const p=[rgba[k],rgba[k+1],rgba[k+2]];
    const bgDist=dist2(p,background),[id,near]=nearestCenter(p,centers);
    // Distinct known fills win over background only when they are decidedly
    // closer. This makes edge antialiasing benign without erasing small islands.
    if(bgDist<=bg2&&bgDist<=near*1.5)continue;
    if(near<=26**2&&near<bgDist*.85){valid[i]=1;regions[i]=id;}
    else if(bgDist>bg2&&near<=45**2&&near<bgDist*.66){valid[i]=1;regions[i]=id;}
    else if(bgDist>bg2){rejected++;if(near<bgDist)ambiguous++;}
  }
  const healed=0; // Preserve source void pixels exactly: black waterways are intentional.
  const counts=new Int32Array(centers.length);
  for(let i=0;i<size;i++)if(valid[i]&&regions[i]>=0)counts[regions[i]]++;
  const order=[...centers.keys()].filter(id=>counts[id]>0).sort((a,b)=>counts[b]-counts[a]||a-b);
  const lookup=new Int32Array(centers.length).fill(-1);
  for(let id=0;id<order.length;id++)lookup[order[id]]=id;
  for(let i=0;i<size;i++)if(regions[i]>=0)regions[i]=lookup[regions[i]];
  const palette=order.map((j,id)=>({id,label:`Region ${id+1}`,color:hex(centers[j])}));
  return {width,height,valid,layers:{regions},activeLayer:'regions',palette,seed:null,style:'imported',targetLandRatio:null,
    source:{type:'image',importMode:'clean',backgroundColor:hex(background),waterTolerance,cleanup:0,
      healedBorderCells:healed,ambiguousPixels:ambiguous,rejectedDecorationPixels:rejected},islandStats:null,islandPolicy:null};
}
/** Only repair small connected patches of VALID but unassigned land. Do not
 * silently annex deliberately unclaimed large regions or remote islands. */
function fixStrayLandCells(map,maxPatch=64){
  const {valid,width,height}=map,regions=map.layers.regions;
  const seen=new Uint8Array(valid.length),queue=new Int32Array(valid.length);
  let repaired=0,patches=0,skipped=0;
  for(let start=0;start<valid.length;start++){
    if(!valid[start]||regions[start]>=0||seen[start])continue;
    let a=0,b=1;queue[0]=start;seen[start]=1;
    const votes=new Map();
    while(a<b){const i=queue[a++],x=i%width,y=(i/width)|0;
      const neighbors=[x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1];
      for(const j of neighbors){if(j<0||!valid[j])continue;
        if(regions[j]>=0)votes.set(regions[j],(votes.get(regions[j])||0)+1);
        else if(!seen[j]){seen[j]=1;queue[b++]=j;}
      }
    }
    if(b>maxPatch||!votes.size){skipped++;continue;}
    const id=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
    for(let t=0;t<b;t++)regions[queue[t]]=id;
    repaired+=b;patches++;
  }
  return {repaired,patches,skipped};
}
/** Recover only confidently matching small island/coastal cells from original
 * image RGBs. Never use nearest landowner across an arbitrary water gap. */
function restoreTinyIslands(map,rgba,waterTolerance=34){
  if(!rgba||rgba.length!==map.valid.length*4)throw new Error('Original image pixels are required for island restoration');
  const centers=map.palette.map(p=>[1,3,5].map(k=>parseInt(p.color.slice(k,k+2),16)));
  const bg=map.source?.backgroundColor;
  if(!bg)return {restored:0};
  const bgRgb=[1,3,5].map(k=>parseInt(bg.slice(k,k+2),16)),bg2=waterTolerance**2;
  let restored=0;
  for(let i=0;i<map.valid.length;i++){
    if(map.valid[i])continue;
    const k=i*4;if(rgba[k+3]<110)continue;
    const p=[rgba[k],rgba[k+1],rgba[k+2]];    if(dist2(p,bgRgb)<=bg2)continue;
    const [id,d]=nearestCenter(p,centers);
    // A genuine known region fill, not a dark line or a new unknown shade.
    if(id>=0&&d<=13**2){map.valid[i]=1;map.layers.regions[i]=id;restored++;}
  }
  return {restored};
}
/** Convert ImageData-style data to generic map data. `background` must be a sampled RGB triple. */
function importPixels({rgba,width,height,background=null,waterTolerance=34,regionLimit=24,cleanup=1,mode='auto'}={}){
  if(!rgba||rgba.length!==width*height*4)throw new Error('Invalid image pixel data');
  if(width<5||height<5||width*height>5000000)throw new Error(`Import image grid ${width} × ${height} (${(width*height).toLocaleString()} cells) is outside the supported range: at least 5 pixels on each side and no more than 5,000,000 cells.`);
  const bg=background??sampleColor(rgba,width,height,Math.min(5,width-1),Math.min(5,height-1),2);
  const chosenMode=mode==='exact'||mode==='clean'?'clean':mode==='auto'?
    (likelyCleanImage(rgba,width,height,bg,clamp(Number(waterTolerance)||34,4,110))?'clean':'assisted'):'assisted';
  if(chosenMode==='clean')return importCleanPixels({rgba,width,height,background:bg,waterTolerance:clamp(Number(waterTolerance)||34,4,110)});
  const processed=cleanup?medianImage(rgba,width,height,1):new Uint8ClampedArray(rgba);
  const limit=clamp(Math.round(Number(regionLimit)||24),2,120);
  const water2=clamp(Number(waterTolerance)||34,4,110)**2;
  const valid=new Uint8Array(width*height);
  for(let i=0;i<valid.length;i++){
    const p=rgbAt(processed,i);valid[i]=Number(processed[i*4+3]>=110&&dist2(p,bg)>water2);
  }
  // Discard thin dark marks floating in the sampled background (ocean labels,
  // compass marks, and stray lettering). Keep genuine small colored islands.
  if(cleanup){
    const old=new Uint8Array(valid);
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
      const i=y*width+x;if(!old[i])continue;
      const p=rgbAt(processed,i),dark=lum(p)<163,neutral=Math.max(...p)-Math.min(...p)<75;
      if(!dark||!neutral)continue;
      let water=0,seen=0;
      for(let dy=-5;dy<=5;dy+=2)for(let dx=-5;dx<=5;dx+=2){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        seen++;if(!old[yy*width+xx])water++;
      }
      if(seen>=15&&water/seen>.72)valid[i]=0;
    }
  }
  if(cleanup>0)removeFloatingLabels(valid,processed,width,height,bg);
  // An image with large areas of exactly the same RGB value is a flat-color map.
  const histogram=colorHistogram(rgba,valid);
  const land=valid.reduce((a,b)=>a+b,0);
  const top=histogram.slice(0,limit+10).reduce((a,v)=>a+v[1],0);
  const clean=mode==='exact'||(mode==='auto'&&land>0&&top/land>.90);
  let centers;
  if(clean){
    const dominant=histogram.filter(row=>row[1]>=Math.max(30,land*.0004) && (!cleanup || lum(unpack(row[0]))>=80));
    centers=dominant.slice(0,120).map(row=>unpack(row[0]));
  } else centers=kmeansColors(processed,valid,limit);
  const regions=new Int32Array(valid.length).fill(-1),totals=new Int32Array(centers.length);
  for(let i=0;i<regions.length;i++){
    if(!valid[i])continue;
    const p=rgbAt(processed,i);
    if(cleanup>0){
      const darkness=lum(p);
      // Relative brightness picks out type and outlines without deleting a
      // uniformly dark-filled region.
      const x=i%width,y=(i/width)|0,near=[];
      for(const [dx,dy] of [[-5,0],[5,0],[0,-5],[0,5],[-4,-4],[4,4],[-4,4],[4,-4]]){
        const xx=clamp(x+dx,0,width-1),yy=clamp(y+dy,0,height-1);
        const j=yy*width+xx;if(valid[j])near.push(lum(rgbAt(processed,j)));
      }
      near.sort((a,b)=>a-b);const typical=near.length?near[near.length>>1]:darkness;
      if((darkness<90&&typical-darkness>17)||(darkness<157&&typical-darkness>36)){
        regions[i]=-2;continue;
      }
    }
    let chosen=0,best=Infinity;
    for(let id=0;id<centers.length;id++){
      const d=dist2(p,centers[id]);if(d<best){best=d;chosen=id;}
    }
    if(cleanup&&best>150**2&&lum(p)<120){regions[i]=-2;continue;}
    regions[i]=chosen;totals[chosen]++;
  }
  if(cleanup)fillNoisyBorders(regions,valid,width,height);
  if(cleanup>1)smoothSmallArtifacts(regions,valid,width,height,cleanup-1);
  // Reorder palette by descending area, drop unused centers. Dense 0..N-1 IDs.
  const used=new Map();for(let i=0;i<regions.length;i++)if(regions[i]>=0)used.set(regions[i],(used.get(regions[i])||0)+1);
  const order=[...used].sort((a,b)=>b[1]-a[1]).map(row=>row[0]);
  const translate=new Map(order.map((old,id)=>[old,id]));
  for(let i=0;i<regions.length;i++)if(regions[i]>=0)regions[i]=translate.get(regions[i]);
  const palette=order.map((j,id)=>({id,label:`Region ${id+1}`,color:hex(centers[j])}));
  return {width,height,valid,layers:{regions},activeLayer:'regions',palette,seed:null,style:'imported',targetLandRatio:null,source:{type:'image',importMode:clean?'exact':'assisted',backgroundColor:hex(bg),waterTolerance,cleanup},islandStats:null,islandPolicy:null};
}

/** Replace all cells of a selected *connected component* of current region ownership. */
function floodReassign(map,x,y,toId,trackCell){
  const {width,height,valid}=map,region=map.layers.regions;
  if(x<0||x>=width||y<0||y>=height)return 0;
  const i=y*width+x,from=valid[i]?region[i]:-999;
  if(from===toId)return 0;
  // Water can be converted to land by flood only when manually selected.
  const q=[i],seen=new Uint8Array(valid.length);seen[i]=1;
  let changed=0;
  for(let p=0;p<q.length;p++){
    const at=q[p],xx=at%width,yy=(at/width)|0;
    if(trackCell)trackCell(at);
    if(toId===-999){valid[at]=0;region[at]=-1;}else{valid[at]=1;region[at]=toId;}
    changed++;
    for(const j of [xx>0?at-1:-1,xx+1<width?at+1:-1,yy>0?at-width:-1,yy+1<height?at+width:-1]){
      if(j<0||seen[j])continue;
      if((from===-999&&!valid[j])||(from!==-999&&valid[j]&&region[j]===from)){seen[j]=1;q.push(j);}
    }
  }
  return changed;
}
/** Local painting is safer for fine distinctions than floodfill. */
function brushAssign(map,x,y,toId,radius=3,trackCell){
  const {width,height,valid}=map,region=map.layers.regions;let changed=0;
  for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
    if((xx-x)**2+(yy-y)**2>radius*radius)continue;
    const i=yy*width+xx;
    const nextValid=toId===-999?0:1,nextRegion=toId===-999?-1:toId;
    if(valid[i]===nextValid&&region[i]===nextRegion)continue;
    if(trackCell)trackCell(i);
    valid[i]=nextValid;region[i]=nextRegion;changed++;
  }
  return changed;
}

return {importPixels,sampleColor,floodReassign,brushAssign,fixStrayLandCells,restoreTinyIslands};
})();

export const {importPixels,sampleColor,floodReassign,brushAssign,fixStrayLandCells,restoreTinyIslands} = Importer;
