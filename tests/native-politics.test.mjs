import assert from 'node:assert/strict';
import {NativeMap} from '../src/native-map.mjs';
import {regenerateNativePolitics,sampleNativePlanningMask} from '../src/native-politics.mjs';

const W=513,H=331;
function sourceFixture(){
  const result=new NativeMap(W,H);
  // Split mainland by a one-native-pixel black river; include lakes,
  // asymmetric coastline, and tiny isolated islands missing planner cells.
  for(let y=13;y<H-10;y++)for(let x=12;x<W-12;x++){
    const coast=24+Math.round(9*Math.sin(y*.077)+5*Math.cos(y*.032));
    const land=x>coast&&x<W-19-Math.round(13*Math.sin(y*.023));
    const river=x===256;
    const lake=(x>350&&x<370&&y>190&&y<205);
    const bay=x>445&&y>65&&y<135;
    if(land&&!river&&!lake&&!bay)result.setLand(x,y,true);
  }
  for(const [x,y] of [[3,4],[508,7],[8,325],[505,324]])result.setLand(x,y,true);
  return result;
}
function ownChecksum(m){
  // Deterministic lightweight equality key; no rendering/palette involved.
  return m.serialize().tiles.map(t=>t.tx+':'+t.ty+':'+t.land+':'+t.owners.encoding+':'+t.owners.data).join('|');
}
let cases=0;
async function test(name,fn){await fn();cases++;console.log('PASS native-politics: '+name);}
const source=sourceFixture();
const original=ownChecksum(source);
await test('native mask planning keeps full-resolution geography untouched',()=>{
  const sampled=sampleNativePlanningMask(source,53,35);
  assert(sampled.totalLand>50000);
  assert(sampled.representedCells>0);
  assert.equal(source.isLand(256,120),false);
  assert.equal(source.isLand(360,195),false);
  assert.equal(source.isLand(3,4),true);
  assert.equal(ownChecksum(source),original);
});
const options={regionCount:10,seed:'everwind-reroll-one',independentIslandRegions:2,
 unclaimedIslandRate:.14,maxPlanningCells:2400,roughness:1.25,yieldEveryTiles:7};
const a=await regenerateNativePolitics(source,options);
await test('native ownership covers land and keeps exact 1px rivers, lakes, islands',()=>{
  assert(a.map.geometryEquals(source));
  assert.equal(a.map.width,W);assert.equal(a.map.height,H);
  assert.equal(a.stats.nativeLandCells,a.stats.assigned+a.stats.unclaimed);
  assert.equal(a.map.getRegion(256,120),null);
  assert.equal(a.map.getRegion(360,195),null);
  assert.equal(a.map.isLand(3,4),true);
  assert(a.map.getRegion(3,4)!==null);
  assert.equal(a.stats.requestedRegions,10);
  assert(a.stats.actualRegions>=1);
  assert(a.stats.refinedPixels>50);
  assert(a.stats.subPlannerLand>0);
  assert.equal(ownChecksum(source),original);
});
await test('same seed is byte-identical, other seed changes ownership only',async()=>{
  const b=await regenerateNativePolitics(source,options);
  assert.equal(ownChecksum(a.map),ownChecksum(b.map));
  const c=await regenerateNativePolitics(source,{...options,seed:'everwind-reroll-two'});
  assert(c.map.geometryEquals(a.map));
  assert.notEqual(ownChecksum(a.map),ownChecksum(c.map));
});
await test('native political region IDs can be sparse and names/colors remain mapped',async()=>{
  const ids=Array.from({length:a.stats.actualRegions},(_,i)=>100+i*137);
  const b=await regenerateNativePolitics(source,{...options,regionIds:ids});
  assert.deepEqual(b.map.regionIds,ids);
  assert.deepEqual(b.palette.map(p=>p.id),ids);
  assert(b.map.geometryEquals(source));
  assert.equal(b.map.serialize().format,'map-fox-native-tiles');
  assert.deepEqual(NativeMap.deserialize(b.map.serialize()).serialize(),b.map.serialize());
});
await test('regeneration is not a rectangular upscaled planning grid',()=>{
  assert(a.stats.planningWidth<W&&a.stats.planningHeight<H);
  // For native resolution there must be changes inside several different
  // planner buckets—not just boundaries at each coarse rectangle edge.
  let inside=0,transitions=0;
  for(let y=20;y<H-20;y++){
    for(let x=24;x<W-25;x++){
      const left=a.map.getRegion(x-1,y),right=a.map.getRegion(x,y);
      if(left===null||right===null||left===right)continue;
      transitions++;
      const gx=Math.floor(x*a.stats.planningWidth/W);
      if(Math.floor((x-1)*a.stats.planningWidth/W)===gx)inside++;
    }
  }
  assert(transitions>60,'Need visible native territorial boundaries');
  assert(inside>30,'Territory edges should fall within planning cells');
});
await test('zero political regions leaves intentional unclaimed land',async()=>{
  const result=await regenerateNativePolitics(source,{regionCount:0,seed:'zero',maxPlanningCells:1000});
  assert.equal(result.stats.assigned,0);
  assert.equal(result.stats.unclaimed,result.stats.nativeLandCells);
  assert.equal(result.map.getRegion(20,50),-1);
  assert(result.map.geometryEquals(source));
});
await test('cancel or reject invalid options without changing original',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(regenerateNativePolitics(source,{...options,signal:controller.signal}),/cancelled/);
  const ctrl2=new AbortController();
  await assert.rejects(regenerateNativePolitics(source,{...options,signal:ctrl2.signal,onProgress:({phase})=>{if(phase==='refining')ctrl2.abort();}}),/cancelled/);
  for(const problem of [
    {...options,regionCount:101},
    {...options,roughness:-1},
    {...options,maxPlanningCells:10},
    {...options,regionIds:[1,1]}
  ])await assert.rejects(regenerateNativePolitics(source,problem));
  assert.equal(ownChecksum(source),original);
});
await test('sparse 9201 x 6600 map retains exact tiny land at far edges',async()=>{
  const big=new NativeMap(9201,6600);
  for(let y=6500;y<6504;y++)for(let x=9170;x<9174;x++)big.setLand(x,y,true);
  for(let y=130;y<134;y++)for(let x=110;x<114;x++)big.setLand(x,y,true);
  const result=await regenerateNativePolitics(big,{
    regionCount:2,seed:'big-islands',maxPlanningCells:2000,yieldEveryTiles:2
  });
  assert(result.map.geometryEquals(big));
  assert.equal(result.stats.nativeLandCells,32);
  assert.equal(result.stats.assigned+result.stats.unclaimed,32);
  assert.equal(result.map.isLand(9200,6599),false);
  assert.equal(result.map.isLand(9170,6500),true);
});
console.log('\n'+cases+' native political regeneration tests passed.');
