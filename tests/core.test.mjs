import assert from 'node:assert/strict';
import {
  spawnMap, serializeMap, deserializeMap, validateMapGrid,
  regeneratePoliticalMap, simulationSizeMap, countFourWayJunctions, copyMap,
} from '../src/spawner.mjs';
import {importPixels} from '../src/importer.mjs';
import {subdivideMap} from '../src/subdivisions.mjs';
import {goblinSmoothFrame} from '../src/renderer.mjs';

const scenarios = [
 {seed:'fox-1',style:'archipelago',width:120,height:85,regionCount:9,independentIslandRegions:3},
 {seed:'fox-1',style:'continent-islands',width:140,height:90,regionCount:8},
 {seed:'fox-2',style:'longshore',width:125,height:75,regionCount:8},
 {seed:'fox-3',style:'several',width:120,height:85,regionCount:11},
 {seed:'fox-4',style:'fragmented',width:120,height:85,regionCount:3},
 {seed:'fox-5',style:'supercontinent',width:120,height:85,regionCount:0},
];
const maps = scenarios.map(options=>spawnMap(options));
let checked=0;
function test(name,fn){fn();checked++;console.log('PASS '+name);}
test('deterministic generation',()=>{
 const a=serializeMap(maps[0]),b=serializeMap(spawnMap(scenarios[0]));
 assert.deepEqual(a.valid,b.valid);assert.deepEqual(a.layers.regions,b.layers.regions);assert.deepEqual(a.palette,b.palette);
});
test('valid grid in all styles; no four-way junctions',()=>{
 maps.forEach((m,i)=>{
  const status=validateMapGrid(m);
  assert(status.land>0, 'scenario '+i);
  assert.equal(status.width,scenarios[i].width);
  assert.equal(countFourWayJunctions(m.layers.regions,m.valid,m.width,m.height),0);
 });
});
test('JSON project roundtrip keeps names and colors',()=>{
 const m=copyMap(maps[0]);m.palette[0].label='Lands of Fox';m.palette[0].color='#a1b2c3';
 assert.deepEqual(serializeMap(deserializeMap(JSON.parse(JSON.stringify(serializeMap(m))))),serializeMap(m));
});
test('nonconsecutive region IDs survive reopening',()=>{
 const input=serializeMap(maps[1]),old=input.palette[0].id,next=1602;
 input.palette[0].id=next;input.layers.regions=input.layers.regions.map(v=>v===old?next:v);
 const m=deserializeMap(input);assert.equal(m.palette[0].id,next);assert.doesNotThrow(()=>validateMapGrid(m));
});
test('malformed project JSON is rejected',()=>{
 const base=serializeMap(maps[2]);
 for (const modify of [
  x=>x.valid.pop(),
  x=>{x.layers.regions[0]=2;x.valid[0]=0;},
  x=>x.valid[0]=7,
  x=>x.width=99999,
 ]){const b=structuredClone(base);modify(b);assert.throws(()=>deserializeMap(b));}
});
test('political reroll preserves exact land-water mask',()=>{
 const original=maps[1],changed=regeneratePoliticalMap(original,{regionCount:12,seed:'politics-55',independentIslandRegions:2});
 assert.deepEqual([...changed.valid],[...original.valid]);
 assert.notDeepEqual([...changed.layers.regions],[...original.layers.regions]);
 assert.doesNotThrow(()=>validateMapGrid(changed));
});
test('simulation reduction preserves political ownership IDs and source',()=>{
 const original=maps[0],before=JSON.stringify(serializeMap(original)),result=simulationSizeMap(original,300);
 const ids=new Set(original.layers.regions.filter(v=>v>=0));
 const outIds=new Set(result.map.layers.regions.filter(v=>v>=0));
 assert.deepEqual([...outIds].sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));
 assert.equal(JSON.stringify(serializeMap(original)),before);
 assert.equal(result.stats.occupiedRegionsAfter,ids.size);
});
test('simulation refuses fewer cells than regions',()=>{
 const m=maps[0],ids=new Set(m.layers.regions.filter(v=>v>=0));
 if(ids.size>1)assert.throws(()=>simulationSizeMap(m,ids.size-1));
});
test('source module imports expose generator, importer, subdivisions and smoothing',()=>{
 assert.equal(typeof spawnMap,'function');
 assert.equal(typeof importPixels,'function');
 assert.equal(typeof subdivideMap,'function');
 assert.equal(typeof goblinSmoothFrame,'function');
});
console.log('\n'+checked+' Map Fox regression checks passed.');
