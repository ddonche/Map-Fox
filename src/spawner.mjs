
/**
 * Map Fox — standalone, deterministic, dependency-free JavaScript.
 * The generator knows only cells, void/available, and arbitrary region IDs.
 * It does not model kingdoms, terrain types, simulations, or Goblin internals.
 *
 * A map's `valid` mask uses 1 for usable cells and 0 for void cells.
 * Its `regions` layer uses -1 for unassigned cells, otherwise a region ID.
 *
 * Designed so land/void generation and region growth can be ported independently.
 */

function hashString(value) {
  const str = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function smoothstep(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hash2d(x, y, seed) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy);
  const a = lerp(hash2d(ix, iy, seed), hash2d(ix + 1, iy, seed), fx);
  const b = lerp(hash2d(ix, iy + 1, seed), hash2d(ix + 1, iy + 1, seed), fx);
  return lerp(a, b, fy);
}

function fbm(x, y, seed, octaves = 4) {
  let amplitude = 1, frequency = 1, total = 0, sum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * noise(x * frequency, y * frequency, seed + o * 131);
    total += amplitude;
    amplitude *= 0.52;
    frequency *= 2;
  }
  return sum / total;
}

class MinHeap {
  constructor() { this.h = []; }
  push(node) {
    const h = this.h;
    let i = h.length;
    h.push(node);
    while (i) {
      const p = (i - 1) >>> 1;
      if (h[p].cost <= node.cost) break;
      h[i] = h[p]; i = p;
    }
    h[i] = node;
  }
  pop() {
    const h = this.h, root = h[0], last = h.pop();
    if (!h.length) return root;
    let i = 0;
    while (true) {
      let l = i * 2 + 1;
      if (l >= h.length) break;
      let r = l + 1;
      const c = r < h.length && h[r].cost < h[l].cost ? r : l;
      if (h[c].cost >= last.cost) break;
      h[i] = h[c]; i = c;
    }
    h[i] = last;
    return root;
  }
  get size() { return this.h.length; }
}

function neighbors(index, width, height, callback) {
  const x = index % width, y = Math.floor(index / width);
  if (x > 0) callback(index - 1);
  if (x + 1 < width) callback(index + 1);
  if (y > 0) callback(index - width);
  if (y + 1 < height) callback(index + width);
}

/** Return components of the valid grid, sorted largest first. */
function components(valid, width, height) {
  const seen = new Uint8Array(valid.length), list = [];
  const queue = new Int32Array(valid.length);
  for (let origin = 0; origin < valid.length; origin++) {
    if (!valid[origin] || seen[origin]) continue;
    let front = 0, back = 1;
    queue[0] = origin;
    seen[origin] = 1;
    const cells = [];
    while (front < back) {
      const cell = queue[front++];
      cells.push(cell);
      neighbors(cell, width, height, nb => {
        if (valid[nb] && !seen[nb]) {
          seen[nb] = 1;
          queue[back++] = nb;
        }
      });
    }
    list.push(cells);
  }
  list.sort((a, b) => b.length - a.length);
  return list;
}

/**
 * A world is built from a *seeded composition*, not a fixed continent count.
 * The composition supplies irregular, overlapping land influences. A warped,
 * multi-scale height field then carves coastlines, sounds, peninsulas and islands.
 * This produces a generic usable/void grid; the named styles are merely recipes.
 */
const WORLD_STYLES = [
  'continent-islands', 'supercontinent', 'archipelago', 'several',
  'fragmented', 'longshore'
];

function chooseStyle(seed, requested='surprise') {
  if (WORLD_STYLES.includes(requested)) return requested;
  const rand = rng32(hashString(seed)^0x492b7f1a);
  const choices = [
    'continent-islands', 'continent-islands', 'supercontinent', 'archipelago',
    'archipelago', 'several', 'several', 'fragmented', 'fragmented',
    'longshore'
  ];
  return choices[Math.floor(rand()*choices.length)];
}

function composition(seed, style) {
  const rand = rng32(hashString(seed)^0x29f72a17);
  const mix = (a,b)=>a+(b-a)*rand();
  const masses=[], cuts=[], lakes=[];
  function mass(x,y,rx,ry,weight=1,rotation=mix(-Math.PI,Math.PI)) {
    masses.push({ x,y,rx,ry,weight,rotation,c:Math.cos(rotation),s:Math.sin(rotation) });
  }
  function cluster(x,y,r,arms=4,elongation=1) {
    mass(x,y,r*elongation,r*mix(.66,1.10),mix(.85,1.09));
    for(let i=0;i<arms;i++) {
      const angle=2*Math.PI*(i+mix(-.24,.24))/arms;
      const distance=r*mix(.52,1.16);
      const nx=x+Math.cos(angle)*distance, ny=y+Math.sin(angle)*distance;
      mass(nx,ny,r*mix(.38,.72),r*mix(.32,.76),mix(.65,.99));
      if(rand()<.32) mass(nx+Math.cos(angle)*r*.35,ny+Math.sin(angle)*r*.35,r*.25,r*.32,mix(.5,.72));
    }
  }
  // Style changes are intentional macro-geography changes, not palette changes.
  let autoRatio;
  if(style==='supercontinent') {
    cluster(mix(.43,.57),mix(.42,.57),mix(.30,.39),6,mix(1.0,1.22));
    for(let i=0;i<3;i++) mass(mix(.09,.91),mix(.12,.88),mix(.05,.09),mix(.035,.085),.7);
    autoRatio=mix(.43,.55);
  } else if(style==='continent-islands') {
    const x=mix(.36,.58),y=mix(.38,.61);
    cluster(x,y,mix(.25,.32),5,mix(1,1.24));
    // 3–7 island groups; some elongate into island arcs.
    const n=3+Math.floor(rand()*5);
    for(let i=0;i<n;i++) {
      const theta=2*Math.PI*(i+rand()*.7)/n;
      const distance=mix(.35,.58);
      const a=x+Math.cos(theta)*distance,b=y+Math.sin(theta)*distance;
      mass(a,b,mix(.045,.105),mix(.04,.10),mix(.64,.88));
      if(rand()<.55) mass(a+mix(-.075,.075),b+mix(-.07,.07),mix(.035,.06),mix(.03,.07),.69);
    }
    autoRatio=mix(.30,.43);
  } else if(style==='archipelago') {
    const count=2+Math.floor(rand()*2);
    for(let g=0;g<count;g++) {
      const ang=mix(-1.2,1.2),cx=mix(.20,.78),cy=mix(.18,.82);
      const steps=7+Math.floor(rand()*6);
      for(let k=0;k<steps;k++) {
        const t=k/(steps-1)-.5;
        const x=cx+Math.cos(ang)*t*.72+Math.sin(t*10+g)*.035;
        const y=cy+Math.sin(ang)*t*.65+Math.cos(t*9+g)*.04;
        const r=mix(.05,.115);
        mass(x,y,r*mix(.8,1.35),r*mix(.60,1.10),mix(.72,1.02));
      }
    }
    autoRatio=mix(.19,.31);
  } else if(style==='several') {
    const n=2+Math.floor(rand()*3);
    const centers=[];
    for(let i=0;i<n;i++) {
      let best,score=-Infinity;
      for(let t=0;t<100;t++) {
        const x=mix(.12,.88),y=mix(.14,.86);
        let d=centers.length?Infinity:rand();
        for(const c of centers) d=Math.min(d,(x-c.x)**2+(y-c.y)**2);
        if(d>score){score=d;best={x,y};}
      }
      centers.push(best);
      cluster(best.x,best.y,mix(.16,.26),3+Math.floor(rand()*3),mix(.85,1.3));
    }
    autoRatio=mix(.32,.44);
  } else if(style==='fragmented') {
    const n=10+Math.floor(rand()*10);
    for(let i=0;i<n;i++) {
      const x=mix(.09,.91),y=mix(.08,.92);
      mass(x,y,mix(.045,.15),mix(.035,.15),mix(.75,1.12));
      if(rand()<.45) mass(x+mix(-.08,.08),y+mix(-.08,.08),mix(.035,.09),mix(.04,.10),.8);
    }
    autoRatio=mix(.20,.33);
  } else if(style==='longshore') {
    const angle=mix(-1.25,1.25),x=mix(.4,.6),y=mix(.4,.6);
    for(let k=0;k<7;k++) {
      const t=(k-3)/6;
      mass(x+t*.55*Math.cos(angle),y+t*.52*Math.sin(angle)+Math.sin(t*6)*.04,
        mix(.11,.19),mix(.09,.16),mix(.8,1.09));
    }
    for(let i=0;i<5;i++) mass(mix(.1,.9),mix(.1,.9),mix(.04,.085),mix(.04,.08),.82);
    autoRatio=mix(.25,.37);
  }
  return { masses,cuts,lakes,autoRatio };
}
function influenceAt(u,v,features) {
  let value=-1;
  for(const m of features.masses) {
    const dx=u-m.x,dy=v-m.y;
    const a=(dx*m.c+dy*m.s)/m.rx;
    const b=(-dx*m.s+dy*m.c)/m.ry;
    const z=m.weight*Math.exp(-1.65*(a*a+b*b));
    if(z>value)value=z;
  }
  for(const c of features.cuts) {
    const dx=(u-c.x)/c.rx,dy=(v-c.y)/c.ry;
    value-=c.strength*Math.exp(-1.9*(dx*dx+dy*dy));
  }
  // Variable-width curved troughs allow irregular basins and narrow channels,
  // rather than imposing a radial (perfectly centered) hole on land.
  for (const lake of features.lakes) {
    let depression=0;
    for(let j=1;j<lake.points.length;j++) {
      const a=lake.points[j-1],b=lake.points[j];
      const dx=b.x-a.x,dy=b.y-a.y;
      const t=clamp(((u-a.x)*dx+(v-a.y)*dy)/(dx*dx+dy*dy+1e-10),0,1);
      const px=a.x+dx*t,py=a.y+dy*t,r=lerp(a.radius,b.radius,t);
      const dist2=((u-px)**2+(v-py)**2)/(r*r);
      depression=Math.max(depression,Math.exp(-1.8*dist2));
    }
    value-=lake.strength*depression;
  }
  return value;
}
function generateValidMask({ width=320,height=200,seed=12345,landRatio=null,style='surprise'}={}) {
  const selectedStyle=chooseStyle(seed,style);
  const features=composition(seed,selectedStyle);
  const target=landRatio==null?features.autoRatio:clamp(landRatio,.06,.80);
  const ns=hashString(seed)^0x45f609ad;
  const scores=new Float32Array(width*height);
  // Multi-scale noise warps the continents before sampling their coastlines.
  // Both physical and rendering sides use integer cell indices.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=(x+.5)/width,v=(y+.5)/height;
    const wx=(fbm(u*4+15,v*4+12,ns,4)-.5)*(selectedStyle==='archipelago'||selectedStyle==='longshore'?.30:.22);
    const wy=(fbm(u*4+35,v*4+7,ns+71,4)-.5)*(selectedStyle==='archipelago'||selectedStyle==='longshore'?.30:.22);
    const macro=influenceAt(u+wx,v+wy,features);
    const coast=fbm(u*8,v*8,ns+151,5)-.5;
    const peninsulas=fbm(u*16,v*16,ns+457,4)-.5;
    const detail=fbm(u*45,v*45,ns+931,3)-.5;
    const margin=Math.min(u,v,1-u,1-v);
    const edgePenalty=(1-clamp(margin/.04,0,1))*.095;
    scores[y*width+x]=macro+coast*.58+peninsulas*.21+detail*.065-edgePenalty;
  }
  const ordered=Float32Array.from(scores).sort();
  const cutoff=ordered[clamp(Math.floor((1-target)*ordered.length),0,ordered.length-1)];
  const valid=new Uint8Array(scores.length);
  for(let i=0;i<scores.length;i++) valid[i]=+(scores[i]>=cutoff);
  // Suppress accidental tiny noise pixels but preserve real small islands.
  const minIsland=Math.max(3,Math.floor(width*height*.000045));
  for(const island of components(valid,width,height)) {
    if(island.length<minIsland)for(const i of island)valid[i]=0;
  }
  enrichGeography(valid,width,height,seed,selectedStyle);
  return {valid,style:selectedStyle,targetLandRatio:target};
}


/**
 * Shared geographic detailing pass. The overall world recipe chooses the broad
 * shape, but ALL styles receive small satellite islands and inland lakes.
 * This never assigns a semantic label to a cell: it's just available or void.
 */
function distanceFrom(valid, width, height, fromValue) {
  const d=new Uint16Array(valid.length);d.fill(65535);
  const q=new Int32Array(valid.length);let head=0,tail=0;
  for(let i=0;i<valid.length;i++) {
    if(valid[i]===fromValue) { d[i]=0;q[tail++]=i; }
  }
  while(head<tail) {
    const idx=q[head++],next=d[idx]+1;
    neighbors(idx,width,height,nb=>{if(d[nb]>next){d[nb]=next;q[tail++]=nb;}});
  }
  return d;
}

function enrichGeography(valid,width,height,seed,style) {
  const random=rng32(hashString(seed)^0x1b8e96c5);
  const ns=hashString(seed)^0x568bc972;
  const total=width*height;
  const scale=Math.sqrt(total/(480*300));
  // Choose lakes inside larger landmasses. Small lakes are deliberately much
  // smaller than the giant oval basin in V3 and never require a donut layout.
  const depth=distanceFrom(valid,width,height,0);
  const lakeCandidates=[];
  for(let i=0;i<total;i++) if(valid[i] && depth[i]>=Math.max(6,Math.round(8*scale))) lakeCandidates.push(i);
  const lakeCount=Math.round((3+random()*5)*clamp(total/144000,.35,2.3));
  for(let k=0;k<lakeCount && lakeCandidates.length;k++) {
    const center=lakeCandidates[Math.floor(random()*lakeCandidates.length)];
    if(!valid[center])continue;
    const x0=center%width,y0=(center/width)|0;
    const room=depth[center];
    const rad=Math.min(room*.48,(3+random()*6.5)*scale);
    if(rad<1.5)continue;
    const wide=rad*(1+random()*1.1),narrow=rad*(.48+random()*.4);
    const a=random()*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);
    const bound=Math.ceil(wide+3);
    for(let y=Math.max(1,y0-bound);y<Math.min(height-1,y0+bound);y++) {
      for(let x=Math.max(1,x0-bound);x<Math.min(width-1,x0+bound);x++) {
        const i=y*width+x;
        if(!valid[i] || depth[i]<3) continue;
        const dx=x-x0,dy=y-y0;
        const px=(dx*ca+dy*sa)/wide,py=(-dx*sa+dy*ca)/narrow;
        const bend=.13*Math.sin(px*4.1+0.5);
        const edge=(fbm(x/(25*scale)+3,y/(25*scale)+7,ns+k*733,3)-.5)*.65;
        if(px*px+(py+bend)*(py+bend)+edge<.91) valid[i]=0;
      }
    }
  }
  // Coastal satellite islands: seeded independently of the macro layout.
  // Sites are in nearby ocean but far enough out to avoid merging with shore.
  const coastDistance=distanceFrom(valid,width,height,1);
  const seaCandidates=[];
  const minDist=Math.max(4,Math.round(6*scale));
  const maxDist=Math.max(11,Math.round(24*scale));
  for(let y=4;y<height-4;y++)for(let x=4;x<width-4;x++) {
    const i=y*width+x,d=coastDistance[i];
    if(!valid[i] && d>=minDist && d<=maxDist)seaCandidates.push(i);
  }
  const base=style==='archipelago'?21:style==='longshore'?15:11;
  const islandCount=Math.round((base+random()*7)*clamp(total/144000,.5,1.5));
  for(let k=0;k<islandCount && seaCandidates.length;k++) {
    const center=seaCandidates[Math.floor(random()*seaCandidates.length)];
    if(valid[center])continue;
    const cx=center%width,cy=(center/width)|0;
    const waterRoom=coastDistance[center];
    const radius=Math.max(1.4,Math.min(waterRoom*.42, (2.1+random()*6)*scale));
    const aspect=.55+random()*1.3,rx=radius*aspect,ry=radius/Math.sqrt(aspect);
    const a=random()*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);
    const bound=Math.ceil(Math.max(rx,ry)+2);
    for(let y=Math.max(1,cy-bound);y<Math.min(height-1,cy+bound);y++) {
      for(let x=Math.max(1,cx-bound);x<Math.min(width-1,cx+bound);x++) {
        const i=y*width+x;
        if(valid[i] || coastDistance[i]<Math.max(2,Math.floor(radius*.6)))continue;
        const dx=x-cx,dy=y-cy;
        const px=(dx*ca+dy*sa)/rx,py=(-dx*sa+dy*ca)/ry;
        const perturb=(fbm(x/(8*scale)+9,y/(8*scale)+3,ns+k*103,3)-.5)*.76;
        if(px*px+py*py+perturb<.95)valid[i]=1;
      }
    }
  }
}

/** Choose seed sites within a connected component, spaced far apart. */
function chooseSites(cells, n, valid, width, height, random) {
  const sites = [];
  for (let s = 0; s < n; s++) {
    let best = -1, maxScore = -Infinity;
    const attempts = Math.min(600, Math.max(100, cells.length));
    for (let i = 0; i < attempts; i++) {
      const pos = cells[Math.floor(random() * cells.length)];
      const x = pos % width, y = Math.floor(pos/width);
      let score = 0;
      if (sites.length) {
        score = Infinity;
        for (const prev of sites) {
          const dx = x - prev % width, dy = y - Math.floor(prev/width);
          score = Math.min(score, dx*dx + dy*dy);
        }
      } else {
        score = random();
      }
      let nearLand = 0;
      neighbors(pos, width, height, nb => { if(valid[nb]) nearLand++; });
      score = sites.length ? score*(.50 + random()*.95) + nearLand*12 : random() + nearLand*.015;
      if (score > maxScore) { best = pos; maxScore = score; }
    }
    if (best >= 0) sites.push(best);
  }
  return sites;
}

function allocateSites(componentList, desired) {
  const chosen = componentList.slice(0, desired);
  if (!chosen.length) return [];
  const allocation = new Array(chosen.length).fill(1);
  let remaining = desired-chosen.length;
  // Dividing by assigned count prevents one enormous continent from swallowing all seeds.
  while (remaining-- > 0) {
    let best = 0, bestWeight = -Infinity;
    for (let i = 0; i < chosen.length; i++) {
      const weight = chosen[i].length / allocation[i];
      if (weight > bestWeight) { best = i; bestWeight = weight; }
    }
    allocation[best]++;
  }
  return allocation;
}

const BASE_PALETTE = [
  '#d77b67', '#78ad8e', '#e0bd66', '#8b9dc7', '#b48db7',
  '#67a9ba', '#ce9b67', '#9bb16c', '#cd88a6', '#9d94c8',
  '#64b9a4', '#d0a279', '#a7b17c', '#d18c7a', '#7fabc0',
];
function regionColor(index) {
  if (index < BASE_PALETTE.length) return BASE_PALETTE[index];
  const hue = ((index * 137.50776405 + 12) % 360) / 60;
  const chroma = .45 * (1 - Math.abs(2 * .63 - 1));
  const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
  const rgb = hue < 1 ? [chroma,secondary,0] : hue < 2 ? [secondary,chroma,0] : hue < 3 ? [0,chroma,secondary] : hue < 4 ? [0,secondary,chroma] : hue < 5 ? [secondary,0,chroma] : [chroma,0,secondary];
  const match = .63 - chroma / 2;
  return '#' + rgb.map(v => Math.round((v+match)*255).toString(16).padStart(2,'0')).join('');
}

/**
 * Assign connected regions to valid cells by expanding from spaced sites.
 * Weighted multi-source Dijkstra means every cell has a path back to its own site
 * through cells with the same region ID. Cells on unseeded islands stay unassigned.
 */
function growParcels({ valid, width, height, seed = 12345, regionCount = 7 }) {
  if (valid.length !== width*height) throw new Error('Invalid grid mask dimensions');
  const random = rng32(hashString(seed) ^ 0x817bd917);
  const comp = components(valid, width, height);
  const n = clamp(Math.floor(regionCount), 0, 10000);
  // A tiny satellite island need not become its own kingdom/region.
  // Only sizeable components receive sites; small islands stay valid but unassigned.
  const totalLand = comp.reduce((sum, c) => sum + c.length, 0);
  const minimumRegionLand = n ? Math.max(8, Math.floor(totalLand / n * .18)) : Infinity;
  const eligible = comp.filter(c => c.length >= minimumRegionLand);
  const allocations = allocateSites(eligible.length ? eligible : comp.slice(0, 1), n);
  const sites = [];
  for (let c = 0; c < allocations.length; c++) {
    const eligibleCells = (eligible.length ? eligible : comp)[c];
    sites.push(...chooseSites(eligibleCells, allocations[c], valid, width, height, random));
  }
  const regions = new Int32Array(width*height).fill(-1);
  const best = new Float64Array(width*height).fill(Infinity);
  const ownership = new Int32Array(width*height).fill(-1);
  const heap = new MinHeap();
  const speed = sites.map(() => .72 + random()*.66);
  const ns = hashString(seed) ^ 0x5d6fa8c3;
  const cost = new Float32Array(width*height);
  // Terrain-like travel resistance: a rugged multiscale field whose high-cost
  // contour ridges can deflect territory growth. These are generic costs, not
  // built-in mountains, rivers, or culture semantics.
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const u=x/width,v=y/height;
      const broad=fbm(u*5.1+19,v*5.1+11,ns+741,5);
      const ridge=Math.exp(-Math.pow((broad-.558)/.040,2));
      const grain=fbm(u*26,v*26,ns+17,4);
      cost[y*width+x]=.46 + grain*.75 + 3.9*ridge;
    }
  }
  for (let id = 0; id<sites.length; id++) {
    best[sites[id]] = 0;
    ownership[sites[id]] = id;
    heap.push({ index: sites[id], region: id, cost: 0 });
  }
  while (heap.size) {
    const item = heap.pop();
    const { index, region } = item;
    if (regions[index] !== -1 || best[index] !== item.cost || ownership[index] !== region) continue;
    regions[index] = region;
    neighbors(index, width, height, nb => {
      if (!valid[nb] || regions[nb] !== -1) return;
      const newCost = item.cost + cost[nb] / speed[region];
      if (newCost < best[nb]) {
        best[nb] = newCost;
        ownership[nb] = region;
        heap.push({ index: nb, region, cost: newCost });
      }
    });
  }
  removeFourWayJunctions(regions, valid, width, height);
  const palette = sites.map((_, id) => ({ id, color: regionColor(id), label: `Region ${id+1}` }));
  return { regions, palette, sites };
}

/**
 * Political placement is NOT a seven-seed Voronoi partition. First carve the
 * landscape into many small connected anonymous parcels, then grow larger
 * regions across their shared borders. Parcel boundaries absorb geographic
 * noise and make the resulting territory outlines less mathematical.
 */
function growRegionsBase({valid,width,height,seed=12345,regionCount=7}) {
  if(valid.length!==width*height)throw new Error('Invalid grid mask dimensions');
  const n=clamp(Math.floor(regionCount),0,10000);
  if(!n)return {regions:new Int32Array(valid.length).fill(-1),palette:[],sites:[]};
  const parcelCount=clamp(Math.round(valid.length/720),Math.max(n*16,50),Math.max(n*25,400));
  const fine=growParcels({valid,width,height,seed:String(seed)+':parcels',regionCount:parcelCount});
  const pmap=fine.regions,pn=fine.sites.length;
  const adjacency=Array.from({length:pn},()=>new Map());
  const sizes=new Int32Array(pn);
  for(let i=0;i<pmap.length;i++) {
    const a=pmap[i];if(a<0)continue;
    sizes[a]++;
    const x=i%width,y=(i/width)|0;
    for(const nb of [...(x<width-1?[i+1]:[]),...(y<height-1?[i+width]:[])]) {
      const b=pmap[nb];if(b<0||b===a)continue;
      adjacency[a].set(b,(adjacency[a].get(b)||0)+1);
      adjacency[b].set(a,(adjacency[b].get(a)||0)+1);
    }
  }
  const random=rng32(hashString(seed)^0x78451b9d);
  const comp=components(valid,width,height);
  const total=comp.reduce((sum,c)=>sum+c.length,0);
  const minimum=n?Math.max(8,Math.floor(total/n*.18)):Infinity;
  const eligible=comp.filter(c=>c.length>=minimum);
  const selected=eligible.length?eligible:comp.slice(0,1);
  const allocation=allocateSites(selected,n);
  const seedParcels=[],seedCells=[],used=new Set();
  for(let c=0;c<allocation.length;c++) {
    const candidateSites=chooseSites(selected[c],Math.min(allocation[c]+12,100),valid,width,height,random);
    for(let j=0,placed=0;j<candidateSites.length&&placed<allocation[c];j++) {
      const p=pmap[candidateSites[j]];
      if(p<0||used.has(p))continue;
      used.add(p);seedParcels.push(p);seedCells.push(candidateSites[j]);placed++;
    }
    // In unusual small or narrow components, fall back to any unclaimed parcel.
    while(seedParcels.length<allocation.slice(0,c+1).reduce((a,b)=>a+b,0)) {
      const cell=selected[c].find(cell=>pmap[cell]>=0&&!used.has(pmap[cell]));
      if(cell===undefined)break;
      used.add(pmap[cell]);seedParcels.push(pmap[cell]);seedCells.push(cell);
    }
  }
  const owner=new Int32Array(pn).fill(-1);
  const best=new Float64Array(pn).fill(Infinity);
  const pending=new Int32Array(pn).fill(-1);
  const speed=seedParcels.map(()=>.63+random()*.95);
  const friction=Float64Array.from({length:pn},(_,i)=>.5+random()*1.5);
  const heap=new MinHeap();
  for(let k=0;k<seedParcels.length;k++) {
    const id=seedParcels[k];best[id]=0;pending[id]=k;
    heap.push({index:id,region:k,cost:0});
  }
  while(heap.size) {
    const item=heap.pop(),p=item.index,region=item.region;
    if(owner[p]!==-1||best[p]!==item.cost||pending[p]!==region)continue;
    owner[p]=region;
    for(const [next,shared] of adjacency[p]) {
      if(owner[next]!==-1)continue;
      const hop=(.25+Math.sqrt(sizes[next])/14)*friction[next]/speed[region];
      const nextCost=item.cost+hop/(1+Math.log1p(shared)*.09);
      if(nextCost<best[next]) {
        best[next]=nextCost;pending[next]=region;
        heap.push({index:next,region,cost:nextCost});
      }
    }
  }
  const regions=new Int32Array(valid.length).fill(-1);
  for(let i=0;i<regions.length;i++) if(pmap[i]>=0)regions[i]=owner[pmap[i]];
  removeFourWayJunctions(regions,valid,width,height);
  const palette=seedParcels.map((_,id)=>({id,color:regionColor(id),label:`Region ${id+1}`}));
  return {regions,palette,sites:seedCells};
}

/**
 * Island owners are allocated after ordinary parcel-based political growth.
 * A region may own several separate landmasses: land connectivity is a property
 * of the individual fragments, not a requirement of maritime ownership.
 * Every independent island polity uses one of the caller's requested IDs.
 */
function landmassRecords(valid,width,height) {
  return components(valid,width,height).map((cells,id)=>{
    let minX=width,minY=height,maxX=0,maxY=0,sumX=0,sumY=0;
    for(const p of cells){const x=p%width,y=Math.floor(p/width);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      sumX+=x;sumY+=y;
    }
    return {id,cells,size:cells.length,minX,maxX,minY,maxY,x:sumX/cells.length,y:sumY/cells.length};
  });
}
function landGap(a,b) {
  const dx=Math.max(0,a.minX-b.maxX-1,b.minX-a.maxX-1);
  const dy=Math.max(0,a.minY-b.maxY-1,b.minY-a.maxY-1);
  return Math.hypot(dx,dy);
}

function independentIslandCandidates(landmasses,width,height,seed,regionCount) {
  if(landmasses.length < 2 || regionCount <= 1) return [];
  const random=rng32(hashString(seed)^0x59fa35c1);
  const largest=landmasses[0].size;
  const total=landmasses.reduce((s,c)=>s+c.size,0);
  const minArea=Math.max(12,Math.round(total*.00065));
  const maxGap=Math.max(8,Math.round(Math.min(width,height)*.055));
  // An "island nation" may be one island or several nearby islands, but it
  // must NOT swallow an entire secondary continent. Use the region budget:
  // once a landmass is substantially larger than an average desired territory,
  // leave it in normal parcel-based political generation so it receives
  // multiple starting regions. This fixes the all-one-color western continent.
  const typicalRegionArea=total/regionCount;
  const maxIndependentArea=Math.max(1,typicalRegionArea*(regionCount<=4?1.65:1.35));  const possibles=landmasses.slice(1).filter(c=>
    c.size>=3 && c.size<largest*.52 && c.size<=maxIndependentArea);
  const mainland=landmasses.filter(c=>c.size>maxIndependentArea || c.size>=largest*.52);
  if(!mainland.length)mainland.push(landmasses[0]);
  const used=new Set(),groups=[];
  // Nearby small islands can form one independent polity. Limit its combined
  // area too, otherwise a whole archipelago/continent becomes one forced color.
  for(const anchor of possibles) {
    if(used.has(anchor.id)) continue;
    const members=[anchor];used.add(anchor.id);
    let area=anchor.size;
    for(const item of possibles) {
      if(used.has(item.id)||members.length>=12) continue;
      if(area+item.size>maxIndependentArea)continue;
      const close=Math.min(...members.map(other=>landGap(item,other)));
      if(close<=maxGap && (item.size<=largest*.30 || members.length===1)){
        members.push(item);used.add(item.id);area+=item.size;
      }
    }
    if(area<minArea)continue;
    const nearestMain=Math.min(...mainland.map(c=>landGap(c,anchor)));
    const score=Math.sqrt(area)*(1+Math.min(4,members.length-1)*.35)*
      (1+Math.min(nearestMain,60)/180)*(.72+random()*.6);
    groups.push({members,area,score});
  }
  groups.sort((a,b)=>b.score-a.score);
  return groups;
}

/**
 * Sea-only multi-source BFS. Each water cell remembers its closest established
 * owner and the number of water cells to cross. This avoids using island
 * centroid distance, which gives poor results along concave coastlines.
 */
function nearestMaritimeOwners(regions,valid,width,height) {
  const length=regions.length;
  const distance=new Int32Array(length).fill(-1);
  const owner=new Int32Array(length).fill(-1);
  const queue=new Int32Array(length);let head=0,tail=0;
  // Enqueue only occupied coastal land as water-front origins.
  for(let i=0;i<length;i++) if(valid[i] && regions[i]>=0) {
    const x=i%width,y=(i/width)|0;
    if((x>0&&!valid[i-1])||(x+1<width&&!valid[i+1])||
       (y>0&&!valid[i-width])||(y+1<height&&!valid[i+width])) {
      distance[i]=0;owner[i]=regions[i];queue[tail++]=i;
    }
  }
  while(head<tail) {
    const p=queue[head++];
    neighbors(p,width,height,nb=>{
      if(valid[nb] || distance[nb]>=0)return;
      distance[nb]=distance[p]+1;owner[nb]=owner[p];queue[tail++]=nb;
    });
  }
  return {distance,owner};
}

/**
 * Grow the requested number of regions. Small islands may be attached across
 * water, combined into an independent island chain, or left unclaimed.
 * regionCount is the TOTAL desired initial region count, never mainland + extras.
 */
function growRegions({
  valid,width,height,seed=12345,regionCount=7,
  independentIslandRegions='auto',unclaimedIslandRate=.12
}) {
  if(valid.length!==width*height)throw new Error('Invalid grid mask dimensions');
  const n=clamp(Math.floor(Number(regionCount)||0),0,10000);
  if(n===0)return {regions:new Int32Array(valid.length).fill(-1),palette:[],sites:[],islandStats:{independentRegions:0,claimedLandmasses:0,unclaimedLandmasses:components(valid,width,height).length}};
  const random=rng32(hashString(seed)^0xa5ee7bb2);
  const masses=landmassRecords(valid,width,height);
  const candidates=independentIslandCandidates(masses,width,height,seed,n);
  const cap=Math.min(candidates.length,Math.max(0,n-1),Math.max(1,Math.floor(n*.30)));
  let independentCount;
  if(independentIslandRegions==='auto'||independentIslandRegions===null||independentIslandRegions===undefined){
    const suggestion=random()<.17?0:random()<.77?1:2;
    independentCount=Math.min(cap,suggestion);
  } else independentCount=Math.min(cap,Math.max(0,Math.floor(Number(independentIslandRegions)||0)));
  const selected=candidates.slice(0,independentCount);
  const baseValid=Uint8Array.from(valid);
  for(const group of selected)for(const m of group.members)for(const p of m.cells)baseValid[p]=0;
  const mainlandCount=n-selected.length;
  const base=growRegionsBase({valid:baseValid,width,height,seed,regionCount:mainlandCount});
  const regions=base.regions;
  const palette=base.palette;
  const sites=[...base.sites];
  const independentIds=[],independentGroups=[];
  for(const group of selected){
    const id=palette.length;
    for(const m of group.members)for(const p of m.cells)regions[p]=id;
    palette.push({id,label:`Region ${id+1}`,color:regionColor(id)});
    sites.push(group.members[0].cells[0]);independentIds.push(id);
    independentGroups.push({regionId:id,landmasses:group.members.length,cells:group.area});
  }
  // A remote island can be claimed by a foreign mainland region or by an
  // existing archipelago region. These claims do not consume extra region IDs.
  const maritime=nearestMaritimeOwners(regions,valid,width,height);
  const unclaimedRate=clamp(Number(unclaimedIslandRate)||0,0,1);
  let claimedLandmasses=0,unclaimedLandmasses=0,maritimeClaims=0;
  for(const mass of masses){
    if(mass.cells.some(p=>regions[p]>=0)){claimedLandmasses++;continue;}
    let bestDistance=Infinity,nearest=-1;
    for(const p of mass.cells){
      neighbors(p,width,height,nb=>{
        if(valid[nb]||maritime.owner[nb]<0)return;
        if(maritime.distance[nb]<bestDistance){
          bestDistance=maritime.distance[nb];nearest=maritime.owner[nb];
        }
      });
    }
    if(nearest<0){unclaimedLandmasses++;continue;}
    const proximity=bestDistance<=8?1:bestDistance<=22?.92:bestDistance<=50?.80:.61;
    const sizeBoost=mass.size>110?.99:mass.size>18?.95:mass.size>4?.86:.67;
    const claimChance=clamp((1-unclaimedRate)*proximity*sizeBoost + (mass.size>100?.13:0),0,1);
    if(random()<claimChance){
      for(const p of mass.cells)regions[p]=nearest;
      claimedLandmasses++;maritimeClaims++;
    } else unclaimedLandmasses++;
  }
  return {regions,palette,sites,islandStats:{independentRegions:independentIds.length,independentIds,independentGroups,maritimeClaims,claimedLandmasses,unclaimedLandmasses,totalLandmasses:masses.length}};
}

/** Generate the complete independent starting grid. */
function spawnMap(options = {}) {
  const width = clamp(Math.floor(options.width ?? 320), 10, 3000);
  const height = clamp(Math.floor(options.height ?? 200), 10, 3000);
  const seed = options.seed ?? 12345;
  const landRatio = options.landRatio ?? null;
  const style = options.style ?? "surprise";
  const regionCount = options.regionCount ?? 7;
  const independentIslandRegions = options.independentIslandRegions ?? "auto";
  const unclaimedIslandRate = options.unclaimedIslandRate ?? .12;
  const layerName = options.layerName ?? "regions";
  const geography = generateValidMask({ width, height, seed, landRatio, style });
  const { valid } = geography;
  const { regions, palette, sites, islandStats } = growRegions({ valid, width, height, seed, regionCount, independentIslandRegions, unclaimedIslandRate });
  return { width, height, seed, valid, style: geography.style, targetLandRatio: geography.targetLandRatio, activeLayer: layerName, layers: { [layerName]: regions }, palette, sites, islandStats, islandPolicy: { independentIslandRegions, unclaimedIslandRate } };
}

/** Count map vertices meeting four DIFFERENT assigned region IDs. */
function countFourWayJunctions(regions,valid,width,height) {
  let count=0;
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++) {
    const i=y*width+x;
    if(!valid[i]||!valid[i+1]||!valid[i+width]||!valid[i+width+1])continue;
    const a=regions[i],b=regions[i+1],c=regions[i+width],d=regions[i+width+1];
    if(a>=0&&b>=0&&c>=0&&d>=0&&a!==b&&a!==c&&a!==d&&b!==c&&b!==d&&c!==d)count++;
  }
  return count;
}

function canReassignCell(regions,width,height,idx,oldId) {
  const side=[];
  neighbors(idx,width,height,nb=>{if(regions[nb]===oldId)side.push(nb);});
  if(side.length<=1) return true;
  // Recolor only if the original territory remains connected without this cell.
  const seen=new Set([idx,side[0]]),queue=[side[0]],waiting=new Set(side.slice(1));
  for(let k=0;k<queue.length && waiting.size;k++) {
    neighbors(queue[k],width,height,nb=>{
      if(!seen.has(nb)&&regions[nb]===oldId){seen.add(nb);queue.push(nb);waiting.delete(nb);}
    });
  }
  return waiting.size===0;
}

function removeFourWayJunctions(regions,valid,width,height) {
  // A local, topology-preserving cleanup. It never changes the number of
  // regions or disconnects a region; it only softens unnatural cross-junctions.
  for(let pass=0;pass<3;pass++) {
    let fixes=0;
    for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++) {
      const i=y*width+x,box=[i,i+1,i+width,i+width+1];
      if(box.some(p=>!valid[p]||regions[p]<0))continue;
      if(new Set(box.map(p=>regions[p])).size!==4)continue;
      for(const [at,targets] of [[0,[1,2]],[1,[0,3]],[2,[0,3]],[3,[1,2]]]) {
        const p=box[at],old=regions[p];
        if(!canReassignCell(regions,width,height,p,old))continue;
        const replacements=targets.map(t=>regions[box[t]]);
        // Pick the adjacent region that already has more adjacent cells.
        const count=id=>{let n=0;neighbors(p,width,height,nb=>{if(regions[nb]===id)n++;});return n;};
        regions[p]=replacements.sort((a,b)=>count(b)-count(a))[0];
        fixes++;break;
      }
    }
    if(!fixes)break;
  }
}

/** Raw geographic connectivity diagnostics (not semantic terrain types). */
function summarizeGeography(valid,width,height) {
  const islands=components(valid,width,height);
  const inverted=Uint8Array.from(valid,v=>v?0:1);
  const water=components(inverted,width,height);
  let lakes=0;
  for(const group of water) {
    if(group.length<3)continue;
    if(!group.some(i=>{const x=i%width,y=(i/width)|0;return x===0||y===0||x===width-1||y===height-1;}))lakes++;
  }
  return {landmasses:islands.length,lakes};
}

/** Portable JSON payload for Goblin integration / persistent storage. */
function serializeMap(map) {
  return {
    version: 6, subdivisions: map.subdivisions ? { layer: Array.from(map.subdivisions.layer), palette: map.subdivisions.palette, counts: map.subdivisions.counts } : null, source: map.source ?? {type:"generated"}, islandStats: map.islandStats, islandPolicy: map.islandPolicy, width: map.width, height: map.height, seed: map.seed, style: map.style, targetLandRatio: map.targetLandRatio, activeLayer: map.activeLayer,
    // valid[i] = 0 is a void cell; index i = y*width+x
    valid: Array.from(map.valid),
    layers: Object.fromEntries(Object.entries(map.layers).map(([key, value]) => [key, Array.from(value)])),
    palette: map.palette,
  };
}

/** Deserialize earlier Map Spawner JSON and current Map Fox project/simulation JSON.
 * Legacy export version remains 6 to keep existing Goblin consumers working.
 * New inputs are validated before the current editor state is replaced.
 */
function deserializeMap(payload) {
  if(!payload || typeof payload!=='object' || Array.isArray(payload))throw new Error('Expected a JSON map object');
  const width=payload.width,height=payload.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>12000000)
    throw new Error('Map dimensions must be positive and no more than 12 million cells');
  const size=width*height;
  if(!Array.isArray(payload.valid)||payload.valid.length!==size)throw new Error(`valid mask needs exactly ${size} cells`);
  if(!payload.layers || typeof payload.layers!=='object' || !Array.isArray(payload.layers.regions) || payload.layers.regions.length!==size)
    throw new Error(`layers.regions needs exactly ${size} cells`);
  const valid=new Uint8Array(size);
  for(let i=0;i<size;i++){
    if(payload.valid[i]!==0 && payload.valid[i]!==1)throw new Error(`Invalid usable/void value at cell ${i}`);
    valid[i]=payload.valid[i];
  }
  const layers={};
  for(const [name,values] of Object.entries(payload.layers)){
    if(!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(name) || !Array.isArray(values) || values.length!==size)
      throw new Error(`Invalid layer ${name}: expected ${size} cells`);
    const arr=new Int32Array(size);
    for(let i=0;i<size;i++){
      const value=values[i];
      if(!Number.isSafeInteger(value)||value < -1 || value > 2147483647)
        throw new Error(`Invalid ${name} region ID at cell ${i}`);
      if(name==='regions' && !valid[i] && value!==-1)
        throw new Error(`Region placed on void cell ${i}`);
      arr[i]=value;
    }
    layers[name]=arr;
  }
  const palette=Array.isArray(payload.palette)?payload.palette.map((p,i)=>{
    if(!p || typeof p!=='object' || !Number.isInteger(p.id) || p.id<0 || p.id>2147483647)
      throw new Error(`Invalid palette ID at entry ${i}`);
    const color=typeof p.color==='string' && /^#[0-9a-f]{6}$/i.test(p.color)?p.color:regionColor(i);
    const label=typeof p.label==='string' && p.label.trim()?p.label:`Region ${p.id+1}`;
    const result={...p,id:p.id,color,label};
    if(result.subdivisionCount!==undefined && (!Number.isInteger(result.subdivisionCount) || result.subdivisionCount<0 || result.subdivisionCount>100))
      delete result.subdivisionCount;
    return result;
  }):[];
  const paletteIDs=new Set();
  for(const entry of palette){
    if(paletteIDs.has(entry.id))throw new Error(`Duplicate palette ID ${entry.id}`);
    paletteIDs.add(entry.id);
  }
  // Preserve noncontiguous or high region IDs by completing a missing legend.
  for(const id of new Set(layers.regions))if(id>=0 && !paletteIDs.has(id)){
    palette.push({id,label:`Region ${id+1}`,color:regionColor(palette.length)});
    paletteIDs.add(id);
  }
  let subdivisions=null;
  if(payload.subdivisions){
    const sub=payload.subdivisions;
    if(!Array.isArray(sub.layer)||sub.layer.length!==size)throw new Error('Invalid subdivision layer size');
    const layer=new Int32Array(size);
    for(let i=0;i<size;i++){
      const n=sub.layer[i];
      if(!Number.isInteger(n)||n< -1||n>2147483647 || (!valid[i]&&n!==-1))
        throw new Error(`Invalid subdivision at cell ${i}`);
      layer[i]=n;
    }
    subdivisions={layer,palette:Array.isArray(sub.palette)?sub.palette.map(p=>({...p})):[],counts:sub.counts&&typeof sub.counts==='object'?{...sub.counts}:{},seed:sub.seed};
  }
  const activeLayer=typeof payload.activeLayer==='string' && layers[payload.activeLayer]?payload.activeLayer:'regions';
  return {
    width,height,valid,layers,activeLayer,palette,subdivisions,
    seed:payload.seed??'imported',style:typeof payload.style==='string'?payload.style:'imported',
    targetLandRatio:payload.targetLandRatio??null,
    source:payload.source && typeof payload.source==='object' ? {...payload.source} : {type:'json'},
    islandStats:payload.islandStats??null,islandPolicy:payload.islandPolicy??null
  };
}

/** Validate the fundamental portable grid invariants (does not impose kingdom rules). */
function validateMapGrid(map){
  const size=map.width*map.height,regions=map.layers.regions;
  if(map.valid.length!==size||regions.length!==size)throw new Error('Grid lengths do not match dimensions');
  const legend=new Set(map.palette.map(p=>p.id));
  let land=0,unclaimed=0;const occupied=new Set();
  for(let i=0;i<size;i++){
    const v=map.valid[i],r=regions[i];
    if(v!==0&&v!==1)throw new Error(`Invalid usable/void value at ${i}`);
    if(!Number.isInteger(r)||r < -1)throw new Error(`Invalid region value at ${i}`);
    if(!v&&r>=0)throw new Error(`Assigned void cell at ${i}`);
    if(v){land++;if(r===-1)unclaimed++;else{occupied.add(r);if(!legend.has(r))throw new Error(`Missing palette ID ${r}`);}}
  }
  return {width:map.width,height:map.height,land,unclaimed,regions:occupied.size};
}

/** Color registry can be used with new IDs after a simulation changes ownership. */
function colorForRegion(id, palette) {
  let entry = palette.find(p => p.id === id);
  if (!entry) {
    entry = { id, label: `Region ${id+1}`, color: regionColor(palette.length) };
    palette.push(entry);
  }
  return entry.color;
}

function validateContiguity(map) {
  const {width,height,valid}=map;
  const regions=map.layers[map.activeLayer];
  const regionSizes=new Map(),seen=new Uint8Array(valid.length);
  // Each terrestrial piece of a region must be contiguous. A region is
  // explicitly allowed to own several disjoint pieces separated by void/water.
  const landIds=new Int32Array(valid.length).fill(-1);
  const masses=components(valid,width,height);
  masses.forEach((mass,id)=>{for(const p of mass)landIds[p]=id;});
  const fragmentKeys=new Set();let landFragments=0,unclaimed=0;
  for(let i=0;i<regions.length;i++){
    const r=regions[i];
    if(r<0){if(valid[i])unclaimed++;continue;}
    if(!valid[i])throw new Error(`Region ${r} placed on void cell ${i}`);
    regionSizes.set(r,(regionSizes.get(r)||0)+1);
    if(seen[i])continue;
    const key=landIds[i]+':'+r;
    if(fragmentKeys.has(key)) throw new Error(`Region ${r} is disconnected within landmass ${landIds[i]}`);
    fragmentKeys.add(key);landFragments++;
    const queue=[i];seen[i]=1;
    for(let h=0;h<queue.length;h++)neighbors(queue[h],width,height,nb=>{
      if(!seen[nb]&&regions[nb]===r){seen[nb]=1;queue.push(nb);}
    });
  }
  return {regionCount:regionSizes.size,regionSizes:Object.fromEntries(regionSizes),landFragments,unclaimed};
}

/**
 * Repaint political ownership inside an existing map's EXACT valid/void mask.
 * The output keeps the original full-resolution mask byte-for-byte. To keep
 * big imported images responsive we plan political regions at a smaller
 * resolution, then transfer the political ownership to the original cells.
 * Never use the planning grid as a replacement for the real geographic grid.
 */



function copyMap(map){
  return {...map,
    valid:new Uint8Array(map.valid),
    layers:Object.fromEntries(Object.entries(map.layers).map(([k,v])=>[k,new Int32Array(v)])),
    palette:map.palette.map(p=>({...p})),
    subdivisions:map.subdivisions ? {
      ...map.subdivisions,layer:new Int32Array(map.subdivisions.layer),
      palette:map.subdivisions.palette.map(p=>({...p})),
      counts:{...map.subdivisions.counts}
    }:null,
    source:{...(map.source||{type:'generated'})}
  };
}

function planningMask(valid,w,h,cw,ch){
  const filled=new Uint32Array(cw*ch);
  const total=new Uint32Array(cw*ch);
  // No nearest-neighbor sampling: aggregate area of every source cell, so
  // narrow islands have a chance to survive the planning reduction.
  for(let y=0;y<h;y++){
    const cy=Math.min(ch-1,Math.floor(y*ch/h));
    for(let x=0;x<w;x++){
      const c=cy*cw+Math.min(cw-1,Math.floor(x*cw/w));
      total[c]++;
      if(valid[y*w+x])filled[c]++;
    }
  }
  const coarse=new Uint8Array(cw*ch);
  for(let i=0;i<coarse.length;i++)coarse[i]=filled[i]>0&&filled[i]/total[i]>=.24?1:0;
  return coarse;
}

function nearestCoarseOwners(regions,w,h){
  const owner=new Int32Array(regions.length).fill(-1);
  const distance=new Int32Array(regions.length).fill(-1);
  const queue=new Int32Array(regions.length);let front=0,end=0;
  for(let i=0;i<regions.length;i++)if(regions[i]>=0){
    owner[i]=regions[i];distance[i]=0;queue[end++]=i;
  }
  while(front<end){
    const i=queue[front++],x=i%w,y=(i/w)|0;
    const push=(j)=>{if(distance[j]!==-1)return;distance[j]=distance[i]+1;owner[j]=owner[i];queue[end++]=j;};
    if(x>0)push(i-1);if(x<w-1)push(i+1);if(y>0)push(i-w);if(y<h-1)push(i+w);
  }
  return {owner,distance};
}

/** Create a different political starting map while preserving all void cells. */
function regeneratePoliticalMap(source,{
  regionCount=20,seed='12345',independentIslandRegions='auto',
  unclaimedIslandRate=.12,maxPlanningCells=190000
}={}){
  const {width:w,height:h,valid}=source;
  if(!source.layers?.regions||valid.length!==w*h)throw new Error('Invalid starting map');
  const count=Math.floor(Number(regionCount));
  if(!Number.isFinite(count)||count<0||count>100)throw new Error('Starting regions must be between 0 and 100');
  const maxCells=clamp(Math.floor(Number(maxPlanningCells)||190000),30000,380000);
  const scale=Math.min(1,Math.sqrt(maxCells/(w*h)));
  const cw=Math.max(10,Math.round(w*scale)),ch=Math.max(10,Math.round(h*scale));
  const mask=scale===1?valid:planningMask(valid,w,h,cw,ch);
  const planned=growRegions({valid:mask,width:cw,height:ch,seed,
    regionCount:count,independentIslandRegions,unclaimedIslandRate});
  const region=new Int32Array(w*h).fill(-1);
  const nearest=scale===1?null:nearestCoarseOwners(planned.regions,cw,ch);
  let assigned=0,unclaimed=0,transferFallback=0;
  for(let y=0;y<h;y++){
    const row=y*w,cy=Math.min(ch-1,Math.floor(y*ch/h));
    for(let x=0;x<w;x++){
      const i=row+x;if(!valid[i])continue;
      const c=cy*cw+Math.min(cw-1,Math.floor(x*cw/w));
      if(planned.regions[c]>=0){region[i]=planned.regions[c];assigned++;}
      else if(mask[c]){unclaimed++;} // Unclaimed islands remain unclaimed
      else if(nearest&&nearest.distance[c]>=0&&nearest.distance[c]<=25){
        region[i]=nearest.owner[c];assigned++;transferFallback++;
      }else{unclaimed++;}
    }
  }
  // Island policies and palette remain deterministic for a given input/seed.
  const palette=planned.palette.map(p=>({...p}));
  const output={...copyMap(source),
    valid:new Uint8Array(valid),layers:{...source.layers,regions:region},
    palette,seed,subdivisions:null,sites:[],
    islandStats:planned.islandStats,
    islandPolicy:{independentIslandRegions,unclaimedIslandRate},
    source:{type:'regenerated',geographySource:source.source?.type??'unknown',
      regionCount:count,seed,geographyLocked:true,planningGrid:{width:cw,height:ch}},
    regenerationStats:{assigned,unclaimed,transferFallback,
      planningWidth:cw,planningHeight:ch,
      fourWayJunctions:countFourWayJunctions(region,valid,w,h)}
  };
  return output;
}

/**
 * Export a DES-sized version of an existing map without changing it.
 * Every output grid cell represents a disjoint rectangle of source cells.
 * Land uses strict majority vote; region ownership uses the most frequent
 * (assigned or unclaimed) value among land cells in that rectangle.
 *
 * Regions smaller than the output resolution are preserved in a final pass,
 * which may exceptionally convert an otherwise-void output cell into land.
 * All retained IDs and their palette entries are unchanged.
 */
function simulationSizeMap(source, requestedLandCells=3000) {
  const sw=source.width,sh=source.height,srcValid=source.valid,srcRegion=source.layers?.regions;
  if(!Number.isInteger(sw)||!Number.isInteger(sh)||sw<1||sh<1 || srcValid?.length!==sw*sh || srcRegion?.length!==sw*sh)
    throw new Error('Map needs width, height, valid, and layers.regions arrays of equal length');
  const target=Number(requestedLandCells);
  if(!Number.isInteger(target)||target<1)throw new Error('Simulation size must be a positive whole number of land cells');
  if(target>10000000)throw new Error('Simulation size is too large; choose no more than 10,000,000 land cells');

  // Build a summed-area table once so dimension searches cost O(output area).
  const stride=sw+1,prefix=new Uint32Array(stride*(sh+1));
  const originalRegions=new Map();let sourceLand=0;
  for(let y=0;y<sh;y++){
    let rowSum=0;
    for(let x=0;x<sw;x++){
      const i=y*sw+x,v=srcValid[i]===1?1:0;
      rowSum+=v;prefix[(y+1)*stride+x+1]=prefix[y*stride+x+1]+rowSum;
      if(!v)continue;
      sourceLand++;
      const id=srcRegion[i];
      if(id<0)continue;
      let record=originalRegions.get(id);
      if(!record){record={count:0,sumX:0,sumY:0,closest:Infinity,centerX:0,centerY:0};originalRegions.set(id,record);}
      record.count++;record.sumX+=x;record.sumY+=y;
    }
  }
  if(!sourceLand)throw new Error('The current map has no land cells to export');
  if(target<originalRegions.size)throw new Error(`Simulation size ${target} is smaller than the ${originalRegions.size} occupied regions; choose at least ${originalRegions.size} land cells`);
  const regionIds=[...originalRegions.keys()].sort((a,b)=>a-b);
  for(const region of originalRegions.values()){
    region.centerX=region.sumX/region.count;region.centerY=region.sumY/region.count;
  }
  // Use the most central ACTUAL source cell, even for highly irregular regions.
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
    const i=y*sw+x;if(!srcValid[i])continue;
    const rec=originalRegions.get(srcRegion[i]);if(!rec)continue;
    const d=(x-rec.centerX)**2+(y-rec.centerY)**2;
    if(d<rec.closest){rec.closest=d;rec.bestX=x;rec.bestY=y;}
  }

  const countLand=(ow,oh)=>{
    let count=0;
    for(let y=0;y<oh;y++){
      const y0=Math.floor(y*sh/oh),y1=Math.floor((y+1)*sh/oh);
      for(let x=0;x<ow;x++){
        const x0=Math.floor(x*sw/ow),x1=Math.floor((x+1)*sw/ow);
        const land=prefix[y1*stride+x1]-prefix[y0*stride+x1]-prefix[y1*stride+x0]+prefix[y0*stride+x0];
        if(land*2>(x1-x0)*(y1-y0))count++;
      }
    }
    return count;
  };
  let chosen={width:sw,height:sh,land:sourceLand};
  if(target<sourceLand){
    let lo=0,hi=1;
    const visited=new Set();
    // Binary-search approximate cell density, always maintaining aspect ratio.
    for(let k=0;k<21;k++){
      const scale=(lo+hi)/2;
      const ow=Math.max(1,Math.min(sw,Math.round(sw*scale))),oh=Math.max(1,Math.min(sh,Math.round(sh*scale)));
      const key=ow+'x'+oh;
      const count=visited.has(key)?null:countLand(ow,oh);
      visited.add(key);
      if(count!==null && (Math.abs(count-target)<Math.abs(chosen.land-target)
        || (Math.abs(count-target)===Math.abs(chosen.land-target)&&ow*oh<chosen.width*chosen.height)))
        chosen={width:ow,height:oh,land:count};
      if(count===target)break;
      // If we already evaluated this resolution, use last known direction
      // estimated by total area rather than recalculating identical grids.
      const val=count===null ? (ow*oh)*sourceLand/(sw*sh) : count;
      if(val<target)lo=scale;else hi=scale;
    }
    // Neighboring rounded dimensions can get closer than the binary search.
    const targetWidth=chosen.width;
    for(let delta=-3;delta<=3;delta++){
      const ow=Math.max(1,Math.min(sw,targetWidth+delta));
      const oh=Math.max(1,Math.min(sh,Math.round(ow*sh/sw)));
      if(visited.has(ow+'x'+oh))continue;
      visited.add(ow+'x'+oh);
      const count=countLand(ow,oh);
      if(Math.abs(count-target)<Math.abs(chosen.land-target))chosen={width:ow,height:oh,land:count};
    }
  }

  const width=chosen.width,height=chosen.height;
  const valid=new Uint8Array(width*height),regions=new Int32Array(width*height).fill(-1);
  const counts=new Map(),votes=new Map();
  for(let y=0;y<height;y++){
    const y0=Math.floor(y*sh/height),y1=Math.floor((y+1)*sh/height);
    for(let x=0;x<width;x++){
      const x0=Math.floor(x*sw/width),x1=Math.floor((x+1)*sw/width);
      votes.clear();let land=0;
      for(let sy=y0;sy<y1;sy++)for(let sx=x0;sx<x1;sx++){
        const i=sy*sw+sx;if(!srcValid[i])continue;
        land++;const r=srcRegion[i];votes.set(r,(votes.get(r)||0)+1);
      }
      if(land*2<=(x1-x0)*(y1-y0))continue;
      const dest=y*width+x;valid[dest]=1;
      let best=-1,bestVotes=-1;
      for(const [r,n] of votes){
        // Unclaimed -1 can legitimately win the ownership vote.
        if(n>bestVotes||(n===bestVotes&&r>=0&&best<0)) {best=r;bestVotes=n;}
      }
      regions[dest]=best;
      if(best>=0)counts.set(best,(counts.get(best)||0)+1);
    }
  }

  let rescued=0,createdLandCells=0;
  const missing=regionIds.filter(id=>!counts.get(id));
  // Save disappearing polities without destroying the last cell of another.
  // The closest source-owned cell to the polity centroid is the initial target.
  // Prefer assigning vacant land or majority-void cells over capturing another
  // realm's cell; fall back to ordinary owned cells only if it has spare cells.
  for(const id of missing){
    const rec=originalRegions.get(id),cx=Math.min(width-1,Math.floor((rec.bestX+.5)*width/sw)),cy=Math.min(height-1,Math.floor((rec.bestY+.5)*height/sh));
    let choice=-1,choiceCost=Infinity;
    // Expand from the geographical center until an assignable output cell is found.
    const maxRadius=Math.max(width,height);
    for(let radius=0;radius<=maxRadius;radius++){
      for(let dy=-radius;dy<=radius;dy++){
        const y=cy+dy;if(y<0||y>=height)continue;
        const absX=radius-Math.abs(dy);
        for(const dx of (absX===0?[0]:[-absX,absX])){
          const x=cx+dx;if(x<0||x>=width)continue;
          const i=y*width+x,other=regions[i];
          if(valid[i]&&other>=0&&(counts.get(other)||0)<=1)continue;
          const distance=(x-cx)**2+(y-cy)**2;
          // Keep endangered islands near their correct original location.
          // Marking a void cell as land is an explicit preservation exception.
          const cost=distance+(valid[i]&&other>=0?0.25:valid[i]?0:0.15);
          if(cost<choiceCost){choice=i;choiceCost=cost;}
        }
      }
      if(choice>=0)break;
    }
    if(choice<0)throw new Error(`Unable to preserve region ${id} in the requested simulation grid`);
    const former=regions[choice];if(former>=0)counts.set(former,counts.get(former)-1);
    if(!valid[choice]){valid[choice]=1;createdLandCells++;}
    regions[choice]=id;counts.set(id,1);rescued++;
  }
  const actualLand=valid.reduce((n,v)=>n+v,0);
  const palette=source.palette.map(entry=>({...entry}));
  const stats={requestedLandCells:target,actualLandCells:actualLand,sourceLandCells:sourceLand,
    sourceWidth:sw,sourceHeight:sh,outputWidth:width,outputHeight:height,
    originalOccupiedRegions:originalRegions.size,occupiedRegionsAfter:regionIds.filter(r=>counts.get(r)>0).length,
    rescuedRegions:rescued,createdLandCells};
  return {
    map:{width,height,valid,layers:{regions},palette,activeLayer:'regions',
      seed:source.seed??null,style:source.style??'imported',subdivisions:null,
      source:{...(source.source||{type:'generated'}),simulationSize:stats}},
    stats
  };
}


export { spawnMap, serializeMap, deserializeMap, validateMapGrid, regeneratePoliticalMap, simulationSizeMap, countFourWayJunctions, copyMap, neighbors, growRegions };
