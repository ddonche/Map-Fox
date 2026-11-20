import assert from 'node:assert/strict';
import {NativeMap} from '../src/native-map.mjs';
import {compositeNativePixels,nativeColorTable} from '../src/native-composite.mjs';

const map=new NativeMap(17,12,{tileSize:16,regionIds:[1602,42]});
for(let y=0;y<12;y++)for(let x=0;x<17;x++){
  if(x===8||y===6||x===0)continue; // 1px river/lake/water coastline
  map.setLand(x,y,true);
  map.setRegion(x,y,x<8?1602:42);
}
const palette=[{id:1602,color:'#ff6600'},{id:42,color:'#3366bb'}];
const untouched=[201,32,88];
function src(w,h){
  const rgba=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){
    const k=i*4;rgba[k]=untouched[0];rgba[k+1]=untouched[1];rgba[k+2]=untouched[2];rgba[k+3]=255;
  }
  return rgba;
}
{
 const pixels=src(17,12),count=compositeNativePixels(pixels,17,12,map,palette);
 assert(count>80);
 const at=(x,y)=>[...pixels.slice((y*17+x)*4,(y*17+x)*4+4)];
 assert.deepEqual(at(0,1),[...untouched,255]);
 assert.deepEqual(at(8,1),[...untouched,255]);
 assert.deepEqual(at(4,6),[...untouched,255]);
 assert.deepEqual(at(4,4),[255,102,0,255]);
 assert.deepEqual(at(12,4),[51,102,187,255]);
 assert.deepEqual(at(9,11),[51,102,187,255]);
}
{
 // Export at full resolution vs viewport subsection must produce the same
 // political colors and boundaries pixel-for-pixel at 1:1.
 const full=src(17,12),slice=src(7,5);
 compositeNativePixels(full,17,12,map,palette);
 compositeNativePixels(slice,7,5,map,palette,{originX:3,originY:2});
 for(let y=0;y<5;y++)for(let x=0;x<7;x++){
   assert.deepEqual(
     [...slice.slice((y*7+x)*4,(y*7+x)*4+4)],
     [...full.slice(((y+2)*17+x+3)*4,((y+2)*17+x+3)*4+4)]
   );
 }
}
{
 // No stale original political colors are allowed inside native land.
 const rgba=src(17,12);
 map.setRegion(2,2,-1);
 compositeNativePixels(rgba,17,12,map,palette);
 assert.deepEqual([...rgba.slice((2*17+2)*4,(2*17+2)*4+4)],[223,211,174,255]);
 assert.throws(()=>nativeColorTable(map,[{id:1602,color:'#ff6600'}]),/Missing/);
}
console.log('PASS native composite: source water untouched, all native ownership recolored, viewport/export parity');
