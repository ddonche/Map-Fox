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

{
 // Regression: Photoshop-style anti-aliased black waterways carry fractional
 // dark pixels beside an exact-black 1px core. Before the fix those partial
 // pixels became solid country fill and the river looked broken/thin.
 const n=new NativeMap(16,12,{tileSize:16,regionIds:[42]});
 const original=[191,40,65],next=[20,200,60];
 const rgba=new Uint8ClampedArray(16*12*4);
 for(let y=0;y<12;y++)for(let x=0;x<16;x++){
   const i=(y*16+x)*4;
   const land=y!==6;
   if(land){n.setLand(x,y,true);n.setRegion(x,y,42);}
   let coverage=land?(y===5?.4:y===4?.8:y===7?.6:1):0;
   rgba[i]=Math.round(original[0]*coverage);
   rgba[i+1]=Math.round(original[1]*coverage);
   rgba[i+2]=Math.round(original[2]*coverage);
   rgba[i+3]=255;
 }
 const palette=[{id:42,color:'#14c83c'}];
 compositeNativePixels(rgba,16,12,n,palette,{
   sourcePalette:[{id:1602,color:'#bf2841'}],waterColor:[0,0,0]
 });
 const at=(x,y)=>[...rgba.slice((y*16+x)*4,(y*16+x)*4+3)];
 assert.deepEqual(at(8,3),next,'Complete land must use new political color');
 assert.deepEqual(at(8,6),[0,0,0],'Original river must remain black');
 for(const [y,expected] of [[4,.8],[5,.4],[7,.6]]){
   for(let channel=0;channel<3;channel++){
     assert(Math.abs(at(8,y)[channel]-Math.round(expected*next[channel]))<=2,
       'River fringe coverage was lost at y='+y+', color '+at(8,y));
   }
 }
 // The old interior red must never leak into a new-green region.
 assert.notDeepEqual(at(8,5),[76,16,26]);
 const slice=new Uint8ClampedArray(8*7*4);
 // Source pixels are the ORIGINAL old-color raster, not the output.
 for(let y=0;y<7;y++)for(let x=0;x<8;x++){
   const src=(y+3)*16+(x+4),dst=y*8+x;
   const coverage=(y+3)===6?0:(y+3)===5?.4:(y+3)===4?.8:(y+3)===7?.6:1;
   for(let c=0;c<3;c++)slice[dst*4+c]=Math.round(original[c]*coverage);
   slice[dst*4+3]=255;
 }
 compositeNativePixels(slice,8,7,n,palette,{originX:4,originY:3,
    sourcePalette:[{id:1602,color:'#bf2841'}],waterColor:[0,0,0]});
 for(let y=0;y<7;y++)for(let x=0;x<8;x++){
   assert.deepEqual([...slice.slice((y*8+x)*4,(y*8+x)*4+4)],
     [...rgba.slice(((y+3)*16+x+4)*4,((y+3)*16+x+4)*4+4)],
     'Native PNG and viewport differ at '+x+','+y);
 }
}
{
 // A dark *solid* territory color close to water is not itself an edge.
 const n=new NativeMap(16,16,{tileSize:16,regionIds:[2]});
 n.setLand(3,3,true);n.setRegion(3,3,2);
 const rgba=new Uint8ClampedArray(16*16*4);
 const idx=(3*16+3)*4;
 rgba.set([51,68,85,255],idx);
 compositeNativePixels(rgba,16,16,n,[{id:2,color:'#efab21'}],{
   sourcePalette:[{id:10,color:'#334455'}],waterColor:[0,0,0]
 });
 assert.deepEqual([...rgba.slice(idx,idx+3)],[239,171,33],'Solid dark original region leaked through');
}


{
 // Regression: a very thin black line can be entirely anti-aliased, without
 // a single exact-black pixel. Do not erase it just because every source
 // pixel was classified as land by the binary water mask.
 const n=new NativeMap(16,16,{tileSize:16,regionIds:[42]});
 const original=[191,40,65],fresh=[20,200,60];
 const rgba=new Uint8ClampedArray(16*16*4);
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
   n.setLand(x,y,true);n.setRegion(x,y,42);
   const k=(y*16+x)*4,alpha=(x===8 && y>=3 && y<=12)?.2:1;
   for(let channel=0;channel<3;channel++)rgba[k+channel]=Math.round(original[channel]*alpha);
   rgba[k+3]=255;
 }
 compositeNativePixels(rgba,16,16,n,[{id:42,color:'#14c83c'}],{
   sourcePalette:[{id:9,color:'#bf2841'}],waterColor:[0,0,0]
 });
 const get=(x,y)=>[...rgba.slice((y*16+x)*4,(y*16+x)*4+3)];
 assert.deepEqual(get(6,8),fresh,'Interior recolor failed');
 for(let channel=0;channel<3;channel++)
   assert(Math.abs(get(8,8)[channel]-fresh[channel]*.2)<=2,
     'Anti-aliased line with no pure-black core was erased');
}

console.log('PASS native composite: source water untouched, all native ownership recolored, viewport/export parity');
