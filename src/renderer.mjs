/*
 * Port of Goblin `crates/goblin-vm/src/image.rs`, draw_onto() (jareth branch).
 * Source verified against GitHub commit f64008a45d66d6e3c88095b4196962231e7a9b9d.
 *
 * Algorithm (NOT a vector trace or bilinear interpolation):
 * - Each output pixel samples a 5x5 stencil of input class colors.
 * - Weight each candidate class with a Gaussian (sigma 0.7 input cells).
 * - The winning class gets the pixel; the runner-up provides edge blending.
 * - Margin/gradient gives distance to the boundary in output pixels.
 * - Blend over 1 output pixel; optionally draw a border of width 1.5px.
 * - Optional high-resolution mask works like :write_png!(mask: ...): it
 *   preserves every silhouette pixel and extrapolates nearby land colors.
 *
 * Two speed-only deviations from Rust: precomputed separable Gaussian
 * weights, and typed arrays for per-pixel temporary data. They do not
 * change the sampling rule, winning-class rule, or blend/border equations.
 */
function goblinSmoothFrame(frame, w, h, scale=3, options={}) {
  const ow=options.outputWidth||w*scale, oh=options.outputHeight||h*scale;
  const sx=ow/w, sy=oh/h;
  const smooth=options.smooth!==false, sigma=smooth?0.7:0.35, denominator=2*sigma*sigma;
  const mask=options.mask || null;
  const borderHex=options.border===undefined?'#404040':options.border;
  const borderWidth=options.borderWidth===undefined?1.5:Number(options.borderWidth);
  const borderAlpha=borderHex?parseHexColor(borderHex):null;
  if(mask && mask.length!==ow*oh)throw new Error('Coastline mask dimensions must equal the output image size');

  // Paletteize the input, just as Rust's draw_onto() maps RGBA colors to u16 IDs.
  const raw=new Uint32Array(frame.data.buffer,frame.data.byteOffset,w*h);
  const idByRGBA=new Map(),palette=[],cell=new Uint16Array(w*h);
  for(let i=0;i<raw.length;i++){
    const packed=raw[i]; let id=idByRGBA.get(packed);
    if(id===undefined){
      id=palette.length;idByRGBA.set(packed,id);
      const k=i*4;palette.push([frame.data[k],frame.data[k+1],frame.data[k+2],frame.data[k+3]]);
      if(id>65535)throw new Error('Too many map colors for the Goblin PNG renderer');
    }
    cell[i]=id;
  }
  let outside=null,lonely=null;
  if(mask){
    // The masked code path is intentionally equivalent to the Goblin source:
    // outside/nil cells get their nearest inside neighbor's palette ID;
    // they contribute 1/4 weight. Small isolated patches get center weight.
    const outsidePacked=options.outside ? rgbaPack(parseHexColor(options.outside)) : 0;
    outside=new Uint8Array(w*h);const near=new Int32Array(w*h).fill(-1),queue=new Int32Array(w*h);let front=0,back=0;
    for(let i=0;i<w*h;i++){
      const c=palette[cell[i]],isOut=c[3]===0||raw[i]===outsidePacked;
      outside[i]=isOut?1:0;
      if(!isOut){near[i]=i;queue[back++]=i;}
    }
    while(front<back){
      const i=queue[front++],x=i%w,y=(i/w)|0;
      for(const j of [x?i-1:-1,x+1<w?i+1:-1,y?i-w:-1,y+1<h?i+w:-1]){
        if(j>=0&&near[j]<0){near[j]=near[i];queue[back++]=j;}
      }
    }
    for(let i=0;i<w*h;i++)if(outside[i]&&near[i]>=0)cell[i]=cell[near[i]];
    lonely=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const k=y*w+x;if(outside[k])continue;
      let same=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy;
        if((dx===0&&dy===0)||nx<0||ny<0||nx>=w||ny>=h)continue;
        const j=ny*w+nx;
        if(!outside[j]&&cell[j]===cell[k])same++;
      }
      lonely[k]=Math.max(0,2*(1-same/3));
    }
  }

  // Precompute Gaussian samples at each output pixel's input-cell position.
  // The separable product equals exp(-(dx^2+dy^2)/(2*sigma^2)) in Goblin.
  const cxs=new Int32Array(ow),uvals=new Float64Array(ow),xWeights=new Float64Array(ow*5);
  const cys=new Int32Array(oh),vvals=new Float64Array(oh),yWeights=new Float64Array(oh*5);
  for(let x=0;x<ow;x++){
    const u=(x+0.5)/sx-0.5,cx=Math.round(u);uvals[x]=u;cxs[x]=cx;
    for(let dx=-2;dx<=2;dx++)xWeights[x*5+dx+2]=Math.exp(-((cx+dx-u)**2)/denominator);
  }
  for(let y=0;y<oh;y++){
    const v=(y+0.5)/sy-0.5,cy=Math.round(v);vvals[y]=v;cys[y]=cy;
    for(let dy=-2;dy<=2;dy++)yWeights[y*5+dy+2]=Math.exp(-((cy+dy-v)**2)/denominator);
  }

  const n=ow*oh,first=new Uint16Array(n),second=new Uint16Array(n),margin=new Float32Array(n);
  margin.fill(1);
  const sums=new Float64Array(palette.length),touched=[];
  for(let oy=0;oy<oh;oy++){
    const cy=cys[oy];
    for(let ox=0;ox<ow;ox++){
      const i=oy*ow+ox;
      if(mask && !mask[i])continue;
      const cx=cxs[ox];
      for(let dy=-2;dy<=2;dy++){
        const y=cy+dy;if(y<0||y>=h)continue;
        const yw=yWeights[oy*5+dy+2],base=y*w;
        for(let dx=-2;dx<=2;dx++){
          const x=cx+dx;if(x<0||x>=w)continue;
          const k=base+x,id=cell[k],wt=xWeights[ox*5+dx+2]*yw*(mask&&outside[k]?0.25:1);
          if(sums[id]===0)touched.push(id);
          sums[id]+=wt;
        }
      }
      if(mask&&cx>=0&&cy>=0&&cx<w&&cy<h){
        const k=cy*w+cx,extra=lonely[k];
        if(extra>0){
          const edge=1-2*Math.hypot(uvals[ox]-cx,vvals[oy]-cy);
          if(edge>0){const id=cell[k];if(sums[id]===0)touched.push(id);sums[id]+=extra*edge;}
        }
      }
      let a=0,wa=-1,b=0,wb=-1;
      for(const id of touched){
        const wt=sums[id];
        if(wt>wa){b=a;wb=wa;a=id;wa=wt;}
        else if(wt>wb){b=id;wb=wt;}
      }
      for(const id of touched)sums[id]=0;
      touched.length=0;
      first[i]=a;
      if(wb>0){second[i]=b;margin[i]=(wa-wb)/(wa+wb);}
      else second[i]=a;
    }
  }

  const result=new ImageData(ow,oh),out=result.data;
  const bg=options.outside?parseHexColor(options.outside):[0,0,0,0];
  for(let oy=0;oy<oh;oy++)for(let ox=0;ox<ow;ox++){
    const i=oy*ow+ox,k=i*4;
    if(mask&&!mask[i]){out.set(bg,k);continue;}
    const a=first[i],b=second[i],m=margin[i],c=palette[a];
    if(a===b){out.set(c,k);continue;}
    const at=(x,y)=>{
      const j=y*ow+x;
      return mask&&!mask[j]?m:margin[j];
    };
    const gx=(ox>0&&ox+1<ow)?Math.max(Math.abs(at(ox+1,oy)-m),Math.abs(m-at(ox-1,oy))):0;
    const gy=(oy>0&&oy+1<oh)?Math.max(Math.abs(at(ox,oy+1)-m),Math.abs(m-at(ox,oy-1))):0;
    const g=Math.hypot(gx,gy),d=g>1e-9?m/g:Infinity;
    let rgba=c;
    if(smooth&&d<1){
      const t=0.5+0.5*d;
      rgba=blendRGBA(palette[b],rgba,t);
    }
    if(borderAlpha){
      const cover=Math.max(0,Math.min(1,borderWidth/2+0.5-d))*(borderAlpha[3]/255);
      if(cover>0)rgba=blendRGBA(rgba,[borderAlpha[0],borderAlpha[1],borderAlpha[2],255],cover);
    }
    out.set(rgba,k);
  }
  return result;
}
function parseHexColor(hex){
  const s=String(hex).replace(/^#/,'');
  if(!/^[\da-f]{6}(?:[\da-f]{2})?$/i.test(s))throw new Error(`Invalid color ${hex}`);
  return [parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16),s.length===8?parseInt(s.slice(6,8),16):255];
}
function rgbaPack(c){return (c[0]|c[1]<<8|c[2]<<16|c[3]<<24)>>>0;}
function blendRGBA(a,b,t){
  return [
    Math.round(a[0]*(1-t)+b[0]*t),Math.round(a[1]*(1-t)+b[1]*t),
    Math.round(a[2]*(1-t)+b[2]*t),Math.round(a[3]*(1-t)+b[3]*t)
  ];
}

export { goblinSmoothFrame };
