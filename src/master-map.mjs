/** Map Fox image-first project format, independent of Fext export grids.
 * The full source image is retained losslessly. A bounded, editable cell grid
 * is an independent derivative and NEVER replaces that source.
 */
import {serializeMap, deserializeMap} from './spawner.mjs';

export const DOCUMENT_FORMAT = 'map-fox-document';
export const DOCUMENT_VERSION = 1;
export const APP_VERSION = '0.7.3';

// A run represents [owner, length]; -999 means water, -1 unclaimed land.
// The RLE only records the source WORKING classification for computing edits
// when a saved map is reopened. The native PNG is the actual master image.
export function encodeBaseline(map) {
  const runs=[];const n=map.width*map.height;
  for(let i=0;i<n;){
    const owner=map.valid[i]?map.layers.regions[i]:-999;
    let j=i+1;
    while(j<n && (map.valid[j]?map.layers.regions[j]:-999)===owner && j-i<0x7fffffff)j++;
    runs.push(owner,j-i);i=j;
  }
  return runs;
}
export function decodeBaseline(runs, width, height) {
  if(!Array.isArray(runs)||runs.length%2)throw new Error('Invalid master baseline');
  const n=width*height;
  if(!Number.isSafeInteger(n)||n<1||n>20000000)throw new Error('Invalid baseline dimensions');
  const data=new Int32Array(n);let offset=0;
  for(let j=0;j<runs.length;j+=2){
    const owner=runs[j],length=runs[j+1];
    if(!Number.isSafeInteger(owner)||owner< -999||!Number.isSafeInteger(length)||length<1||offset+length>n)throw new Error('Invalid master baseline run');
    data.fill(owner,offset,offset+length);offset+=length;
  }
  if(offset!==n)throw new Error('Master baseline does not match working grid');
  return data;
}
export function generatedMaster(map) {
  return {
    kind:'generated',nativeWidth:map.width,nativeHeight:map.height,
    workingWidth:map.width,workingHeight:map.height,
    imageDataUrl:null,filename:null,background:null,baselineRuns:null,baselinePalette:[],
    generatorSeed:map.seed??null
  };
}
export function importedMaster(map, info) {
  if(!info?.imageDataUrl?.startsWith('data:image/'))throw new Error('Missing original image data');
  if(!Number.isInteger(info.nativeWidth)||!Number.isInteger(info.nativeHeight)||info.nativeWidth<5||info.nativeHeight<5)throw new Error('Invalid source image dimensions');
  return {
    kind:'imported',nativeWidth:info.nativeWidth,nativeHeight:info.nativeHeight,
    workingWidth:map.width,workingHeight:map.height,
    imageDataUrl:info.imageDataUrl,filename:info.filename||'imported-map',
    background:info.background??[0,0,0],
    baselineRuns:encodeBaseline(map),
    baselinePalette:map.palette.map(({id,color})=>({id,color})),
    importMode:info.importMode||'auto',
    generatorSeed:null
  };
}
export function saveProjectDocument(map,master) {
  if(!map)throw new Error('No map to save');
  return {
    format:DOCUMENT_FORMAT,documentVersion:DOCUMENT_VERSION,appVersion:APP_VERSION,
    master:master||generatedMaster(map),map:serializeMap(map)
  };
}
export function loadProjectDocument(data) {
  if(!data||typeof data!=='object')throw new Error('Invalid project');
  if(data.format!==DOCUMENT_FORMAT){
    // Existing Map Fox/Map Spawner JSON remains valid; cannot restore a
    // native original image which these historical files never stored.
    const map=deserializeMap(data);
    return {map,master:{...generatedMaster(map),kind:'legacy-grid'}};
  }
  if(data.documentVersion!==DOCUMENT_VERSION)throw new Error(`Unsupported Map Fox document version: ${data.documentVersion}`);
  const map=deserializeMap(data.map),master=data.master;
  if(!master||!['generated','imported','legacy-grid'].includes(master.kind))throw new Error('Invalid master map type');
  if(!Number.isInteger(master.nativeWidth)||!Number.isInteger(master.nativeHeight)||master.nativeWidth<1||master.nativeHeight<1)throw new Error('Invalid master size');
  if(master.workingWidth!==map.width||master.workingHeight!==map.height)throw new Error('Master/editor size mismatch');
  if(master.kind==='imported'){
    if(typeof master.imageDataUrl!=='string'||!/^data:image\/(png|jpeg|webp|bmp|x-ms-bmp);base64,/.test(master.imageDataUrl))throw new Error('Missing source image from project');
    decodeBaseline(master.baselineRuns,map.width,map.height);
  }
  return {map,master};
}
