import assert from 'node:assert/strict';
import {NativeMap,NATIVE_TILE_SIZE,UNCLAIMED} from '../src/native-map.mjs';
import {spawnMap} from '../src/spawner.mjs';

let cases=0;
function test(name,fn){fn();cases++;console.log('PASS native: '+name);}
const W=513,H=259;
function fixture(){
  const map=new NativeMap(W,H,{regionIds:[7,1602,42]});
  for(let y=5;y<H-5;y++)for(let x=5;x<W-5;x++){
    if(x===256||y===127||(x>390&&x<395&&y>75&&y<85))continue; // 1px strait + lake
    map.setLand(x,y,true);
    map.setRegion(x,y,x<250?1602:7);
  }
  return map;
}
test('1-pixel water straits, lakes and tile edges survive',()=>{
 const map=fixture();
 assert.equal(map.isLand(256,30),false);
 assert.equal(map.getRegion(256,30),null);
 assert.equal(map.isLand(255,30),true);
 assert.equal(map.getRegion(255,30),7);
 assert.equal(map.getRegion(50,50),1602);
 assert.equal(map.getRegion(392,79),null);
 assert.equal(map.isLand(512,257),false);
 assert.throws(()=>map.setRegion(256,30,7),/water/);
 assert.throws(()=>map.setLand(20,20,1),/boolean/);
});
test('RLE/raw tile serialization and stable nonconsecutive IDs',()=>{
 const map=fixture(),data=map.serialize(),copy=NativeMap.deserialize(JSON.parse(JSON.stringify(data)));
 assert.deepEqual(copy.regionIds,[7,1602,42]);
 assert(copy.geometryEquals(map));
 assert.equal(copy.getRegion(50,50),1602);
 assert.equal(copy.getRegion(280,50),7);
 assert(data.tiles.some(t=>t.owners.encoding==='rle-u16'));
 assert.deepEqual(copy.serialize(),data);
});
test('political rerolls cannot change coastline',()=>{
 const a=fixture(),b=a.clone();
 b.setRegion(50,50,42);
 assert.equal(b.getRegion(50,50),42);
 assert.equal(a.getRegion(50,50),1602);
 a.replacePolitics(b);
 assert.equal(a.getRegion(50,50),42);
 assert.equal(a.isLand(256,50),false);
 const changed=b.clone();changed.setLand(256,50,true);
 assert.throws(()=>a.replacePolitics(changed),/geography/);
 assert.equal(a.isLand(256,50),false);
});
test('corrupt, duplicate and politically invalid owner tiles rejected',()=>{
 const good=fixture().serialize();
 const x=structuredClone(good);x.tiles.push(structuredClone(x.tiles[0]));
 assert.throws(()=>NativeMap.deserialize(x),/Duplicate/);
 const y=structuredClone(good);y.tiles[0].land='AA==';
 assert.throws(()=>NativeMap.deserialize(y),/length mismatch/);
 const z=structuredClone(good);z.regionIds=[7];
 assert.throws(()=>NativeMap.deserialize(z),/region table/);
});
test('sparse 9201 x 6600 map stores only allocated tiles',()=>{
 const m=new NativeMap(9201,6600);
 m.setLand(9200,6599,true);m.setRegion(9200,6599,99);
 assert.equal(m.tiles.size,1);
 assert.equal(m.getRegion(9200,6599),99);
 assert.equal(m.isLand(0,0),false);
 const c=NativeMap.deserialize(m.serialize());
 assert.equal(c.getRegion(9200,6599),99);
 assert(c.geometryEquals(m));
});
test('native exact-color import retains black water and flat-color owners',()=>{
 const px=new Uint8ClampedArray(8*8*4);
 for(let i=0;i<64;i++){
   px[i*4+3]=255;
   if(i%8<3){px[i*4]=200;px[i*4+1]=25;px[i*4+2]=70;}
   else if(i%8>4){px[i*4]=20;px[i*4+1]=210;px[i*4+2]=90;}
 }
 const m=NativeMap.fromRGBA({rgba:px,width:8,height:8,
   background:[0,0,0],colorToRegion:{'#c81946':1602,'#14d25a':99}});
 assert.equal(m.isLand(3,4),false);assert.equal(m.isLand(4,4),false);
 assert.equal(m.getRegion(2,4),1602);assert.equal(m.getRegion(5,4),99);
 assert.equal(m.getRegion(3,4),null);
});
test('legacy generated maps can use same native API without new coastline fiction',()=>{
 const old=spawnMap({seed:'native-foundation',width:54,height:42,regionCount:7});
 const m=NativeMap.fromGrid(old);
 assert.equal(m.width,old.width);
 for(let i=0;i<old.valid.length;i++){
   const x=i%old.width,y=Math.floor(i/old.width);
   assert.equal(m.isLand(x,y),Boolean(old.valid[i]));
   if(old.valid[i])assert.equal(m.getRegion(x,y),old.layers.regions[i]);
 }
});

// Stage A v2 projects are opt-in; 0.7.3's editor continues saving v1 safely.
import {generatedMaster,saveProjectDocument,saveNativeProjectDocument,loadNativeProjectDocument,NATIVE_DOCUMENT_VERSION} from '../src/master-map.mjs';
test('v2 native document roundtrip preserves exact geography and owner table',()=>{
  const grid=spawnMap({seed:'doc-v2',width:65,height:48,regionCount:6});
  const native=NativeMap.fromGrid(grid),master=generatedMaster(grid);
  const encoded=saveNativeProjectDocument(grid,master,native);
  assert.equal(encoded.documentVersion,NATIVE_DOCUMENT_VERSION);
  const opened=loadNativeProjectDocument(JSON.parse(JSON.stringify(encoded)));
  assert.equal(opened.requiresNativeMigration,false);
  assert(opened.native.geometryEquals(native));
  assert.deepEqual(opened.native.serialize(),native.serialize());
  assert.deepEqual(opened.native.regionIds,native.regionIds);
  const legacy=loadNativeProjectDocument(saveProjectDocument(grid,master));
  assert.equal(legacy.native,null);
  assert.equal(legacy.requiresNativeMigration,true);
});
test('v2 document loader fails closed on corrupt or missing native ownership',()=>{
  const grid=spawnMap({seed:'doc-v2-bad',width:50,height:34,regionCount:4});
  const original=saveNativeProjectDocument(grid,generatedMaster(grid),NativeMap.fromGrid(grid));
  for (const modify of [
    doc=>delete doc.native,
    doc=>doc.master.nativeWidth++,
    doc=>doc.native.width++,
    doc=>doc.native.tiles[0].land='AA==',
  ]) {
    const corrupted=structuredClone(original);modify(corrupted);
    assert.throws(()=>loadNativeProjectDocument(corrupted));
  }
});

console.log('\n'+cases+' native foundation tests passed.');
