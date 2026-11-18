import assert from 'node:assert/strict';
import {spawnMap,serializeMap} from '../src/spawner.mjs';
import {DOCUMENT_VERSION,generatedMaster,importedMaster,saveProjectDocument,loadProjectDocument,decodeBaseline} from '../src/master-map.mjs';

const map=spawnMap({seed:'mapfox-073',style:'archipelago',width:100,height:75,regionCount:5});
const generated=generatedMaster(map);
assert.equal(generated.nativeWidth,map.width);
const project=saveProjectDocument(map,generated);
const reopened=loadProjectDocument(JSON.parse(JSON.stringify(project)));
assert.equal(project.documentVersion,1);
assert.deepEqual(serializeMap(reopened.map),serializeMap(map));
const legacy=loadProjectDocument(serializeMap(map));
assert.equal(legacy.master.kind,'legacy-grid');
const native=importedMaster(map,{imageDataUrl:'data:image/png;base64,iVBORw0KGgo=',nativeWidth:9201,nativeHeight:6600,background:[0,0,0]});
assert.equal(native.nativeWidth,9201);
const a=decodeBaseline(native.baselineRuns,map.width,map.height);
assert.equal(a.length,map.width*map.height);
for(let i=0;i<a.length;i++)assert.equal(a[i],map.valid[i]?map.layers.regions[i]:-999);
const restored=loadProjectDocument(JSON.parse(JSON.stringify(saveProjectDocument(map,native))));
assert.equal(restored.master.nativeHeight,6600);
assert.deepEqual(decodeBaseline(restored.master.baselineRuns,map.width,map.height),a);
for(const breakCase of [
 d=>d.documentVersion=333,
 d=>d.master.workingWidth++,
 d=>d.master.baselineRuns.pop(),
 d=>d.master.imageDataUrl='missing',
]){const modified=structuredClone(saveProjectDocument(map,native));breakCase(modified);assert.throws(()=>loadProjectDocument(modified));}
console.log('PASS generated/imported master document, legacy reopen, native dimensions, baseline RLE, tamper checks');
