import { spawnMap, serializeMap, deserializeMap, validateMapGrid, regeneratePoliticalMap, simulationSizeMap, countFourWayJunctions, copyMap } from './spawner.mjs';
import { importPixels, sampleColor, floodReassign, brushAssign, fixStrayLandCells, restoreTinyIslands } from './importer.mjs';
import { subdivideMap } from './subdivisions.mjs';
import { goblinSmoothFrame } from './renderer.mjs';
import {generatedMaster,importedMaster,saveProjectDocument,loadProjectDocument} from './master-map.mjs';
import {renderNativeImportedPNG,downloadCanvasPNG} from './native-export.mjs';
import {createNativePreview} from './native-preview.mjs';
// BEGIN APP UI
const $=id=>document.getElementById(id);
let current=null,originalPolitical=null,raw=null,rawWidth=0,rawHeight=0,bg=null,sourceMode='generate',penDown=false,lastPaint=-1;
let master=null,pendingNativeSource=null;
let nativePreview=null;
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const pixelRgb=(data,k)=>[data[k],data[k+1],data[k+2]];
const format=(x)=>Number(x).toLocaleString();
// One history action per completed stroke/fill. Only touched grid cells are
// recorded; 40 full-size snapshots would be wasteful on imported maps.
const undoSteps=[],redoSteps=[];
const MAX_PAINT_HISTORY=40;
let pendingPaint=null;
function updatePaintHistoryControls(){
  $('undoPaint').disabled=!undoSteps.length;
  $('redoPaint').disabled=!redoSteps.length;
}
function clearPaintHistory(){
  pendingPaint=null;undoSteps.length=0;redoSteps.length=0;updatePaintHistoryControls();
}
function beginPaintStep(){
  pendingPaint={before:new Map(),subdivisionsBefore:current?.subdivisions??null};
}
function recordPaintCell(i){
  if(!pendingPaint||pendingPaint.before.has(i))return;
  pendingPaint.before.set(i,[current.valid[i],current.layers.regions[i]]);
}
function finishPaintStep(){
  const pending=pendingPaint;pendingPaint=null;
  if(!pending||!current)return;
  const changes=[];
  for(const [i,[oldValid,oldRegion]] of pending.before){
    const newValid=current.valid[i],newRegion=current.layers.regions[i];
    if(oldValid!==newValid||oldRegion!==newRegion){
      changes.push([i,oldValid,oldRegion,newValid,newRegion]);
    }
  }
  if(!changes.length)return;
  undoSteps.push({changes,subdivisionsBefore:pending.subdivisionsBefore,subdivisionsAfter:current.subdivisions??null});
  if(undoSteps.length>MAX_PAINT_HISTORY)undoSteps.shift();
  redoSteps.length=0;
  updatePaintHistoryControls();
}
function applyPaintHistory(stackFrom,stackTo,undo){
  if(!current||pendingPaint||penDown||!stackFrom.length)return;
  const entry=stackFrom.pop();
  for(const [i,oldValid,oldRegion,newValid,newRegion] of entry.changes){
    current.valid[i]=undo?oldValid:newValid;
    current.layers.regions[i]=undo?oldRegion:newRegion;
  }
  current.subdivisions=undo?entry.subdivisionsBefore:entry.subdivisionsAfter;
  stackTo.push(entry);
  paint();refreshInfo();
  updatePaintHistoryControls();
  message(`${undo?'Undid':'Redid'} ${format(entry.changes.length)} painted cells.`);
}
function undoPaintStep(){applyPaintHistory(undoSteps,redoSteps,true);}
function redoPaintStep(){applyPaintHistory(redoSteps,undoSteps,false);}
$('undoPaint').onclick=undoPaintStep;
$('redoPaint').onclick=redoPaintStep;
updatePaintHistoryControls();
function message(text,isError=false){const el=$('message');el.textContent=text;el.classList.toggle('error',isError);el.classList.remove('hidden');}
function prepare(kind){sourceMode=kind;$('tabGenerate').classList.toggle('active',kind==='generate');$('tabImport').classList.toggle('active',kind==='import');$('tabJSON').classList.toggle('active',kind==='json');$('generatorForm').classList.toggle('hidden',kind!=='generate');$('importForm').classList.toggle('hidden',kind!=='import');$('jsonForm').classList.toggle('hidden',kind!=='json');$('originalBox').classList.toggle('hidden',kind!=='import'||!raw);$('importRepairs').classList.toggle('hidden',kind!=='import'||current?.source?.type!=='image');}
$('tabGenerate').onclick=()=>prepare('generate');$('tabImport').onclick=()=>prepare('import');$('tabJSON').onclick=()=>prepare('json');
$('jsonFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const loaded=loadProjectDocument(parsed),next=loaded.map;const summary=validateMapGrid(next);
    current=next;master=loaded.master;pendingNativeSource=null;clearPaintHistory();raw=null;rawWidth=0;rawHeight=0;bg=null;resetOriginal();prepare('json');updateAll();window.mapFoxFit?.();
    message(`Loaded ${file.name}: ${summary.width} × ${summary.height}, ${format(summary.land)} usable cells, ${summary.regions} occupied regions. Continue editing or exporting.`);
  }catch(e){console.error(e);message(`Could not open JSON: ${e.message}`,true);}
  finally{event.target.value='';}
});
function makeGenerated(){
  try{
    const start=performance.now();let land=$('land').value.trim();
    clearPaintHistory();current=spawnMap({seed:$('seed').value,style:$('style').value,width:Number($('width').value),height:Number($('height').value),regionCount:Number($('regions').value),independentIslandRegions:$('islandRegions').value.trim()?Number($('islandRegions').value):'auto',unclaimedIslandRate:Number($('unclaimedChance').value)/100,landRatio:land?Number(land)/100:null});
    current.source={type:'generated'};current.subdivisions=null;master=generatedMaster(current);pendingNativeSource=null;resetOriginal();
    updateAll();window.mapFoxFit?.();message(`Generated ${current.width} × ${current.height} in ${Math.round(performance.now()-start)} ms.`);
  }catch(e){console.error(e);message(`Generation error: ${e.message}`,true);}
}
$('generate').onclick=makeGenerated;
$('newSeed').onclick=()=>{$('seed').value=String(Math.floor(Math.random()*1e9));makeGenerated();};
function resetOriginal(){
  originalPolitical=null;
  $('restorePolitical').disabled=true;
  $('exportOriginal').disabled=true;
}
function newPoliticalSeed(){
  $('regenSeed').value=String(Math.floor(Math.random()*4294967295));
}
function doRegeneration(){
  if(!current){message('Generate or import a map first.',true);return;}
  try{
    // Always regenerate against the same original, not the previous variant.
    const base=originalPolitical||current;
    const options={regionCount:Number($('regenCount').value),seed:$('regenSeed').value,
      independentIslandRegions:$('regenIslands').value.trim()?Number($('regenIslands').value):'auto',
      unclaimedIslandRate:Number($('regenUnclaimed').value)/100};
    if(!Number.isInteger(options.regionCount)||options.regionCount<0||options.regionCount>100)throw new Error('Choose 0–100 starting regions');
    const started=performance.now();
    const next=regeneratePoliticalMap(base,options);
    if(!originalPolitical)originalPolitical=copyMap(base);
    current=next;clearPaintHistory();
    $('view').value='regions';
    $('restorePolitical').disabled=false;
    $('exportOriginal').disabled=false;
    updateAll();
    const actual=new Set(current.layers.regions.filter(v=>v>=0)).size;
    message(`New political map: ${actual} regions; ${format(next.regenerationStats.unclaimed)} unclaimed land cells. Fixed ${next.width} × ${next.height} geography preserved. ${Math.round(performance.now()-started)} ms. You can restore or export the original.`);
  }catch(e){console.error(e);message(`Could not regenerate: ${e.message}`,true);}
}
$('regenerate').onclick=doRegeneration;
$('rerollPolitical').onclick=()=>{newPoliticalSeed();doRegeneration();};
$('restorePolitical').onclick=()=>{
  if(!originalPolitical)return;
  current=copyMap(originalPolitical);clearPaintHistory();$('view').value='regions';updateAll();
  message('Original political regions restored. Fixed geography unchanged. Your regenerated version can be recreated using its seed.');
};
$('exportOriginal').onclick=()=>{
  if(!originalPolitical)return;
  save(new Blob([JSON.stringify(serializeMap(originalPolitical))],{type:'application/json'}),'map-fox-original.json');
};
function paint(){
  if($('simPreviewBox'))$('simPreviewBox').classList.add('hidden');
  if($('simResult'))$('simResult').textContent='';
  if(!current)return;const m=current,canvas=$('map'),view=$('view').value;
  // Display imported original-resolution image in the viewport, not the working grid.
  nativePreview?.markDataChanged();
  if(nativePreview?.sync(view))return;
  // First produce the exact original grid image. The Goblin renderer draws
  // a higher-resolution picture from these pixels; it never rewrites cells.
  const baseCanvas=document.createElement('canvas');
  baseCanvas.width=m.width;baseCanvas.height=m.height;
  const baseCtx=baseCanvas.getContext('2d');
  const frame=baseCtx.createImageData(m.width,m.height);
  const colors=new Map(m.palette.map(p=>[p.id,rgb(p.color)])),subColors=m.subdivisions?.palette.map(p=>rgb(p.color))||[];
  const sea=[48,91,114],empty=[223,211,174];const region=m.layers.regions,sub=m.subdivisions?.layer;
  for(let i=0;i<m.valid.length;i++){
    let c=!m.valid[i]?sea:empty;
    if(m.valid[i]&&view!=='mask'){
      const id=region[i];c=id<0?empty:colors.get(id)||empty;
      if(view==='subdivisions'&&sub&&sub[i]>=0)c=subColors[sub[i]]||c;
    }
    const x=i%m.width,y=(i/m.width)|0;
    if(m.valid[i]&&sub&&sub[i]>=0&&(view==='borders'||view==='subdivisions')){
      if((x+1<m.width&&sub[i+1]>=0&&sub[i+1]!==sub[i])||(y+1<m.height&&sub[i+m.width]>=0&&sub[i+m.width]!==sub[i]))c=c.map(a=>Math.round(a*.49));
    }
    const k=i*4;frame.data[k]=c[0];frame.data[k+1]=c[1];frame.data[k+2]=c[2];frame.data[k+3]=255;
  }
  // During brush strokes use the exact grid for responsiveness, then
  // smooth the finished stroke when pointerup fires. PNG exports use the
  // smoothed canvas whenever the toggle is on.
  const smooth=$('smoothEdges')?.checked && !penDown;
  if(smooth){
    const pixels=m.width*m.height;
    // Keep render output bounded for large imported maps. 480x300 -> 3x.
    const scale=Math.max(1,Math.min(3,Math.floor(Math.sqrt(1550000/pixels))));
    const polished=goblinSmoothFrame(frame,m.width,m.height,scale,{smooth:true,border:'#404040',borderWidth:1.5});
    canvas.width=polished.width;canvas.height=polished.height;
    canvas.getContext('2d').putImageData(polished,0,0);
  }else{
    canvas.width=m.width;canvas.height=m.height;
    canvas.getContext('2d').putImageData(frame,0,0);
  }
}
function refreshInfo(){if(!current)return;const m=current,assigned=new Set();let land=0,empty=0;
  for(let i=0;i<m.valid.length;i++){if(m.valid[i]){land++;if(m.layers.regions[i]<0)empty++;else assigned.add(m.layers.regions[i]);}}
  $('infoStyle').textContent=m.style.replaceAll('-',' ');$('infoSize').textContent=`${m.width} × ${m.height}`;
  $('infoMaster').textContent=`${master?.nativeWidth??m.width} × ${master?.nativeHeight??m.height}`+ (master?.kind==='imported'?' · original saved':master?.kind==='generated'?' · generated grid':' · legacy project');
  $('infoLand').textContent=`${format(land)} (${(100*land/m.valid.length).toFixed(1)}%)`;
  $('infoRegions').textContent=assigned.size;$('infoEmpty').textContent=format(empty);
  $('infoSub').textContent=m.subdivisions?.palette.length||0;
}
function refreshTargets(){const target=$('target'),keep=target.value;target.replaceChildren();
 for(const [val,title] of [['-999','Void / water'],['-1','Unclaimed land']]){const opt=new Option(title,val);target.add(opt);}
 for(const p of current.palette){const opt=new Option(`${p.id} · ${p.label}`,String(p.id));target.add(opt);}
 if([...target.options].some(o=>o.value===keep))target.value=keep;
 const bulkFrom=$('bulkFrom'),bulkTo=$('bulkTo'),keepFrom=bulkFrom.value,keepTo=bulkTo.value;
 bulkFrom.replaceChildren();bulkTo.replaceChildren();
 for(const entry of current.palette){bulkFrom.add(new Option(`${entry.id} · ${entry.label}`,String(entry.id)));}
 for(const [val,title] of [['-999','Void / water'],['-1','Unclaimed land']])bulkTo.add(new Option(title,val));
 for(const entry of current.palette)bulkTo.add(new Option(`${entry.id} · ${entry.label}`,String(entry.id)));
 if([...bulkFrom.options].some(o=>o.value===keepFrom))bulkFrom.value=keepFrom;
 if([...bulkTo.options].some(o=>o.value===keepTo))bulkTo.value=keepTo;
}
function refreshPalette(){const host=$('paletteEditor');host.replaceChildren();if(!current)return;
 for(const item of current.palette){
   const row=document.createElement('div');row.className='regionrow';
   const color=document.createElement('input');color.type='color';color.value=item.color;color.title='Region color';
   color.addEventListener('input',()=>{item.color=color.value;paint();window.mapFoxRefreshPaint?.();});
   const name=document.createElement('input');name.type='text';name.value=item.label;name.setAttribute('aria-label',`Name for region ${item.id}`);
   name.onchange=()=>{item.label=name.value||`Region ${item.id+1}`;refreshTargets();};
   const id=document.createElement('span');id.textContent=String(item.id);id.className='muted';
   const cnt=document.createElement('input');cnt.type='number';cnt.min='0';cnt.max='100';cnt.placeholder='Default';
   if(item.subdivisionCount!==undefined)cnt.value=item.subdivisionCount;
   cnt.title=`Subdivision override for region ${item.id}`;
   cnt.onchange=()=>{if(cnt.value==='')delete item.subdivisionCount;else item.subdivisionCount=Math.max(0,Math.min(100,Number(cnt.value)||0));};
   row.append(color,name,id,cnt);host.append(row);
 }
}
function updateAll(){paint();refreshInfo();refreshTargets();refreshPalette();window.mapFoxRefreshPaint?.();}
function dropSubs(){if(current){current.subdivisions=null;refreshInfo();paint();}}
$('eraseSubs').onclick=()=>{dropSubs();message('Subdivision layer removed; parent regions are unchanged.');};

$('fixStrays').onclick=()=>{
 if(!current||current.source?.type!=='image'){message('Import an image before repairing it.',true);return;}
 const result=fixStrayLandCells(current,64);
 if(result.repaired){clearPaintHistory();dropSubs();updateAll();}
 message(`Fixed ${format(result.repaired)} stray cells in ${result.patches} small patches. ${result.skipped} disconnected/large unclaimed patches preserved.`);
};
$('restoreIslands').onclick=()=>{
 if(!current||current.source?.type!=='image'||!raw){message('Import an image before restoring islands.',true);return;}
 const result=restoreTinyIslands(current,raw,Number($('waterTolerance').value)||34);
 if(result.restored){clearPaintHistory();dropSubs();updateAll();}
 message(`Restored ${format(result.restored)} confidently matching source cells. Unclaimed islands and genuine water remain unchanged.`);
};

$('bulkApply').onclick=()=>{
 if(!current)return;const from=Number($('bulkFrom').value),to=Number($('bulkTo').value),layer=current.layers.regions;
 if(from===to){message('Choose two different region assignments.');return;}
 let changed=0;for(let i=0;i<layer.length;i++)if(layer[i]===from){
   if(to===-999){current.valid[i]=0;layer[i]=-1;}else{current.valid[i]=1;layer[i]=to;}changed++;
 }
 clearPaintHistory();dropSubs();paint();refreshInfo();message(`Reassigned ${format(changed)} cells from region ${from} to ${to===-999?'void':to===-1?'unclaimed':`region ${to}`}.`);
};
$('addRegion').onclick=()=>{
 if(!current)return;
 let id=current.palette.reduce((a,b)=>Math.max(a,b.id),-1)+1;
 const hue=id*137.508;const base=`hsl(${hue} 45% 63%)`;
 const c=document.createElement('canvas').getContext('2d');c.fillStyle=base;const shade=c.fillStyle;
 current.palette.push({id,label:`Region ${id+1}`,color:shade});refreshTargets();refreshPalette();$('target').value=String(id);window.mapFoxRefreshPaint?.();dropSubs();
 message(`Region ${id} added. Use the correction tool to assign cells to it.`);
};
$('buildSubs').onclick=()=>{
 if(!current)return;const start=performance.now(),counts={};
 for(const item of current.palette)if(item.subdivisionCount!==undefined)counts[item.id]=item.subdivisionCount;
 try{current.subdivisions=subdivideMap(current,{defaultCount:Number($('defaultSubs').value),counts,seed:$('subSeed').value});
  $('view').value='subdivisions';paint();refreshInfo();message(`Generated ${current.subdivisions.palette.length} subdivisions in ${Math.round(performance.now()-start)} ms. Parent borders are unchanged.`);
 }catch(e){console.error(e);message(`Subdivision error: ${e.message}`,true);}
};
 function canvasPosition(event,canvas){
   // getBoundingClientRect already includes CSS zoom/pan transforms. Convert
   // directly back to the original editable grid, not the smoothed pixels.
   const r=canvas.getBoundingClientRect();
   const w=canvas.id==='map'&&current?current.width:canvas.width;
   const h=canvas.id==='map'&&current?current.height:canvas.height;
   return [Math.max(0,Math.min(w-1,Math.floor((event.clientX-r.left)/r.width*w))),
           Math.max(0,Math.min(h-1,Math.floor((event.clientY-r.top)/r.height*h)))];
 }
 function correct(event,previous=null){
   if(!current)return;
   const tool=$('tool').value;
   if(tool!=='brush'&&tool!=='fill')return;
   const [x,y]=canvasPosition(event,$('map')),id=Number($('target').value);
   const k=y*current.width+x;
   if(tool==='brush'&&k===lastPaint)return;
   lastPaint=k;
   // Interpolate skipped pointer cells so a quick stroke has no dotted gaps.
   const distance=previous&&tool==='brush'?Math.max(Math.abs(x-previous[0]),Math.abs(y-previous[1])):0;
   let count=0;
   if(tool==='brush'){
     for(let step=0;step<=distance;step++){
       const sx=distance?Math.round(previous[0]+(x-previous[0])*step/distance):x;
       const sy=distance?Math.round(previous[1]+(y-previous[1])*step/distance):y;
       count+=brushAssign(current,sx,sy,id,Math.max(1,Math.min(35,Number($('radius').value)||3)),recordPaintCell);
     }
   } else count=floodReassign(current,x,y,id,recordPaintCell);
   if(count>0){
     // No implicit changes to unrelated land. Rendering stays in exact-grid
     // mode until the brush stroke ends, then Goblin smoothing resumes.
     current.subdivisions=null;paint();refreshInfo();
     $('hoverInfo').textContent=`Painted at ${x}, ${y}.`;
   }
 }
 const mapCanvas=$('map'), mapFrame=$('mapFrame');
 nativePreview=createNativePreview({mapCanvas,mapFrame,viewport:$('nativeViewport'),getMap:()=>current,getMaster:()=>master,getView:()=>$('view').value});
 let mapZoom=1,mapOffsetX=0,mapOffsetY=0,spaceHeld=false;
 let panDrag=null,paintPointer=null,lastPoint=null;
 function boundMapOffset(){
   const cw=mapCanvas.offsetWidth,ch=mapCanvas.offsetHeight;
   const vw=mapFrame.clientWidth,vh=mapFrame.clientHeight;
   mapOffsetX=Math.min(0,Math.max(vw-cw*mapZoom,mapOffsetX));
   mapOffsetY=Math.min(0,Math.max(vh-ch*mapZoom,mapOffsetY));
 }
 function showMapTransform(){
   boundMapOffset();
   mapCanvas.style.transform=`translate(${mapOffsetX}px, ${mapOffsetY}px) scale(${mapZoom})`;
   $('zoomLevel').textContent=`${Math.round(mapZoom*100)}%`;
   nativePreview?.invalidate();
   updateBrushOutline();
 }
 function zoomAt(factor,clientX,clientY){
   const next=Math.min(16,Math.max(1,mapZoom*factor));
   if(next===mapZoom)return;
   const r=mapFrame.getBoundingClientRect();
   const x=clientX-r.left,y=clientY-r.top,ratio=next/mapZoom;
   mapOffsetX=x-(x-mapOffsetX)*ratio;
   mapOffsetY=y-(y-mapOffsetY)*ratio;
   mapZoom=next;showMapTransform();
 }
 function fitMap(){mapZoom=1;mapOffsetX=0;mapOffsetY=0;showMapTransform();}
 window.mapFoxFit=fitMap;
 const frameCenter=()=>{const b=mapFrame.getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2];};
 $('zoomIn').onclick=()=>zoomAt(1.25,...frameCenter());
 $('zoomOut').onclick=()=>zoomAt(1/1.25,...frameCenter());
 $('zoomFit').onclick=fitMap;
 mapFrame.addEventListener('wheel',e=>{
   e.preventDefault();zoomAt(Math.exp(-Math.max(-160,Math.min(160,e.deltaY))*0.0018),e.clientX,e.clientY);
 },{passive:false});
 mapCanvas.addEventListener('contextmenu',e=>e.preventDefault());
 function activeEdit(){return document.querySelector('.rail-action.is-active')?.dataset.pane==='edit';}
 function updateBrushOutline(event){
   const circle=$('brushOutline'),mode=$('tool').value;
   if(!event || !activeEdit() || mode!=='brush' || spaceHeld || panDrag){circle.style.display='none';return;}
   const b=mapFrame.getBoundingClientRect(),c=mapCanvas.getBoundingClientRect();
   const size=(2*(Number($('radius').value)||3)+1)*c.width/(current?.width||1);
   circle.style.width=`${Math.max(4,size)}px`;
   circle.style.height=`${Math.max(4,size)}px`;
   circle.style.left=`${event.clientX-b.left}px`;
   circle.style.top=`${event.clientY-b.top}px`;
   circle.style.display='block';
 }
 function syncToolButtons(){
   const mode=$('tool').value;
   document.querySelectorAll('[data-edit-tool]').forEach(btn=>{
     const on=btn.dataset.editTool===mode;
     btn.classList.toggle('is-selected',on);
     btn.setAttribute('aria-pressed',on?'true':'false');
   });
   mapCanvas.style.cursor=(spaceHeld||mode==='pan'||!activeEdit())?'grab':mode==='pick'?'copy':mode==='brush'?'crosshair':'cell';
   if(mode!=='brush')$('brushOutline').style.display='none';
 }
 window.mapFoxSyncTools=syncToolButtons;
 document.querySelectorAll('[data-edit-tool]').forEach(btn=>btn.addEventListener('click',()=>{
   $('tool').value=btn.dataset.editTool;syncToolButtons();
 }));
 function updatePaintSelection(){
   const selected=$('target').value;
   const isWater=selected==='-999',unclaimed=selected==='-1';
   const region=current?.palette.find(p=>String(p.id)===selected);
   $('paintSwatch').style.background=isWater?'#305b72':unclaimed?'#dfd3ae':region?.color||'#ddd';
   $('paintLabel').textContent=isWater?'Water':unclaimed?'Unclaimed land':region?.label||'Pick a color';
 }
 window.mapFoxRefreshPaint=updatePaintSelection;
 $('target').addEventListener('change',updatePaintSelection);
 function pickPaint(event){
   if(!current)return;
   const [x,y]=canvasPosition(event,mapCanvas),i=y*current.width+x;
   const value=current.valid[i]?String(current.layers.regions[i]):'-999';
   if(![...$('target').options].some(option=>option.value===value))return;
   $('target').value=value;updatePaintSelection();
   $('tool').value='brush';syncToolButtons();
   const label=$('paintLabel').textContent;
   $('hoverInfo').textContent=`Picked ${label}. Drag to paint, or hold Space to move the map.`;
 }
 function updateHover(event){
   if(!current)return;
   const [x,y]=canvasPosition(event,mapCanvas),i=y*current.width+x;
   const id=current.valid[i]?current.layers.regions[i]:'water';
   $('hoverInfo').textContent=`Cell (${x}, ${y}) · ${id===-1?'unclaimed land':id==='water'?'water':current.palette.find(p=>p.id===id)?.label||`region ${id}`}`;
 }
 mapCanvas.addEventListener('pointerdown',event=>{
   if(!current)return;
   const mode=$('tool').value;
   const shouldPan=event.button===1||event.button===2||spaceHeld||!activeEdit()||mode==='pan'||mode==='inspect';
   if(shouldPan){
     panDrag={id:event.pointerId,x:event.clientX,y:event.clientY,tx:mapOffsetX,ty:mapOffsetY};
     mapCanvas.setPointerCapture(event.pointerId);mapCanvas.style.cursor='grabbing';
     $('brushOutline').style.display='none';event.preventDefault();return;
   }
   if(event.button!==0)return;
   if(mode==='pick'||event.altKey){pickPaint(event);event.preventDefault();return;}
   if(mode!=='brush'&&mode!=='fill')return;
   beginPaintStep();penDown=true;paintPointer=event.pointerId;lastPaint=-1;lastPoint=null;
   mapCanvas.setPointerCapture(event.pointerId);
   correct(event);lastPoint=canvasPosition(event,mapCanvas);
   updateBrushOutline(event);event.preventDefault();
 });
 mapCanvas.addEventListener('pointermove',event=>{
   if(panDrag&&event.pointerId===panDrag.id){
     mapOffsetX=panDrag.tx+event.clientX-panDrag.x;
     mapOffsetY=panDrag.ty+event.clientY-panDrag.y;
     showMapTransform();return;
   }
   if(penDown&&paintPointer===event.pointerId&&$('tool').value==='brush'){
     correct(event,lastPoint);lastPoint=canvasPosition(event,mapCanvas);
   }
   updateHover(event);updateBrushOutline(event);
 });
 function endPointer(event){
   if(panDrag&&event.pointerId===panDrag.id){panDrag=null;syncToolButtons();}
   if(penDown&&paintPointer===event.pointerId){
     penDown=false;paintPointer=null;lastPaint=-1;lastPoint=null;
     finishPaintStep();
     paint(); // Resume Goblin-rendered smooth preview after the stroke.
   }
   if(mapCanvas.hasPointerCapture(event.pointerId))mapCanvas.releasePointerCapture(event.pointerId);
   updateBrushOutline(event);
 }
 mapCanvas.addEventListener('pointerup',endPointer);
 mapCanvas.addEventListener('pointercancel',endPointer);
 mapCanvas.addEventListener('pointerleave',()=>{$('brushOutline').style.display='none';});
 function resizeBrush(delta){
   const next=Math.max(1,Math.min(35,(Number($('radius').value)||3)+delta));
   $('radius').value=String(next);
   $('radius').dispatchEvent(new Event('input',{bubbles:true}));
 }
 $('brushSmaller').onclick=()=>resizeBrush(-1);
 $('brushLarger').onclick=()=>resizeBrush(1);
 $('radius').addEventListener('input',()=>{
   $('radius').value=String(Math.max(1,Math.min(35,Number($('radius').value)||1)));
 });
 document.addEventListener('keydown',event=>{
   const t=event.target;
   if(t?.closest?.('input, textarea, select, [contenteditable=true]'))return;
   const modifier=event.ctrlKey||event.metaKey;
   if(modifier&&!event.altKey&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')){
     const redo=event.key.toLowerCase()==='y'||event.shiftKey;
     if((redo?redoSteps:undoSteps).length){
       event.preventDefault();(redo?redoPaintStep:undoPaintStep)();
     }
     return;
   }
   if(event.code==='Space'&&!event.repeat){spaceHeld=true;syncToolButtons();event.preventDefault();return;}
   if(!activeEdit()||event.ctrlKey||event.metaKey||event.altKey)return;
   if(event.key==='['||event.code==='BracketLeft'){resizeBrush(-1);event.preventDefault();}
   if(event.key===']'||event.code==='BracketRight'){resizeBrush(1);event.preventDefault();}
 });
 document.addEventListener('keyup',event=>{if(event.code==='Space'){spaceHeld=false;syncToolButtons();event.preventDefault();}});
 window.addEventListener('blur',()=>{spaceHeld=false;syncToolButtons();});
 window.addEventListener('resize',showMapTransform);
 syncToolButtons();updatePaintSelection();showMapTransform();
$('view').onchange=paint;
function setBackground(rgbValue){bg=rgbValue;$('waterDot').style.background='#'+bg.map(v=>v.toString(16).padStart(2,'0')).join('');$('waterHex').textContent=$('waterDot').style.background;}
let pickingWater=false;
$('pickWater').onclick=()=>{pickingWater=true;message('Tap a clean patch of ocean/background in the original image, then detect regions again.');};
$('sourceCanvas').addEventListener('click',event=>{if(!raw)return;
 const [x,y]=canvasPosition(event,$('sourceCanvas'));
 if(!pickingWater)message(`Sampled original pixel (${x}, ${y}); click “Pick water” to use it as background.`);
 else{setBackground(sampleColor(raw,rawWidth,rawHeight,x,y,4));pickingWater=false;message(`Background sampled at (${x}, ${y}). Click Detect regions to re-import.`);}
});
// Fit imported images into the grid's real cell budget. Rounding both sides
// independently can exceed the cap even when the floating-point scale is valid.
// Always floor, then defensively verify the resulting integer dimensions.
function fitImportDimensions(width,height,maxWidth=4096,maxCells=5000000){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){
   throw new Error('Invalid image dimensions');
 }
 const widthLimit=Number.isFinite(maxWidth)&&maxWidth>=5?maxWidth:4096;
 const scale=Math.min(1,widthLimit/width,Math.sqrt(maxCells/(width*height)));
 let w=Math.max(1,Math.floor(width*scale));
 let h=Math.max(1,Math.floor(height*scale));
 // Guard against floating-point edge cases and unusual dimension ratios.
 while(w*h>maxCells){if(w/width>=h/height)w--;else h--;}
 if(w<5||h<5)throw new Error(`Image is too narrow to import at this size (${w} × ${h}); try a wider source or another resolution.`);
 return {width:w,height:h,resized:w!==width||h!==height};
}
async function openFile(file){
 if(!file)return;
 try{
   if(!file.type.startsWith('image/'))throw new Error('Please upload a PNG, JPEG, BMP, or WebP image');
   const url=URL.createObjectURL(file);
   try{
     const image=await createImageBitmap(file);
     const imageDataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Could not read original image'));r.readAsDataURL(file);});
     pendingNativeSource={imageDataUrl,nativeWidth:image.width,nativeHeight:image.height,filename:file.name};
     const maxWidth=Number($('importMaxWidth').value)||4096;
     const fitted=fitImportDimensions(image.width,image.height,maxWidth);
     rawWidth=fitted.width;rawHeight=fitted.height;
     const canvas=$('sourceCanvas');canvas.width=rawWidth;canvas.height=rawHeight;
     const ctx=canvas.getContext('2d',{willReadFrequently:true});
     // When resizing is unavoidable, nearest-neighbour avoids inventing blended territory colors.
     if(fitted.resized)ctx.imageSmoothingEnabled=false;
     ctx.drawImage(image,0,0,rawWidth,rawHeight);
     raw=ctx.getImageData(0,0,rawWidth,rawHeight).data;image.close?.();
   }finally{URL.revokeObjectURL(url);}
   bg=null;setBackground(sampleColor(raw,rawWidth,rawHeight,Math.min(4,rawWidth-1),Math.min(4,rawHeight-1),2));
   prepare('import');runImport();
 }catch(e){console.error(e);message(`Could not open image: ${e.message}`,true);}
}
$('file').onchange=event=>openFile(event.target.files[0]);
const drop=$('filedrop');
for(const eventName of ['dragenter','dragover'])drop.addEventListener(eventName,e=>{e.preventDefault();drop.classList.add('drag');});
for(const eventName of ['dragleave','drop'])drop.addEventListener(eventName,e=>{e.preventDefault();drop.classList.remove('drag');});
drop.addEventListener('drop',event=>openFile(event.dataTransfer.files[0]));
function runImport(){
 if(!raw){message('Choose an image to import first.',true);return;}
 try{
   const start=performance.now();
   clearPaintHistory();current=importPixels({rgba:raw,width:rawWidth,height:rawHeight,background:bg,waterTolerance:Number($('waterTolerance').value),regionLimit:Number($('colorLimit').value),cleanup:Number($('cleanup').value),mode:$('mode').value});
   current.subdivisions=null;master=pendingNativeSource?importedMaster(current,{...pendingNativeSource,background:bg,importMode:current.source.importMode}):generatedMaster(current);resetOriginal();updateAll();window.mapFoxFit?.();
   message(`Imported ${current.width} × ${current.height}; ${current.palette.length} detected region colors (${current.source.importMode} mode) in ${Math.round(performance.now()-start)} ms. Review boundaries; use Fill, Brush, or the repair buttons for any remaining mistakes.`);
 }catch(e){console.error(e);message(`Import error: ${e.message}`,true);}
}
$('runImport').onclick=runImport;
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
$('png').onclick=async()=>{
 if(!current)return;const type=$('view').value,button=$('png');button.disabled=true;
 try{
   if(master?.kind==='imported'){
     message(`Rendering ${master.nativeWidth} × ${master.nativeHeight} PNG from original master image…`);
     const image=await renderNativeImportedPNG(current,master);
     const blob=await downloadCanvasPNG(image);save(blob,`map-fox-native-${type}.png`);
     message(`Exported original-size ${master.nativeWidth} × ${master.nativeHeight} PNG. Original coastline preserved unless you painted geography edits.`);
   }else{
     const blob=await downloadCanvasPNG($('map'));save(blob,`map-fox-${type}.png`);
     message('Exported generated map PNG. Native-quality procedural geography is a later roadmap milestone.');
   }
 }catch(e){console.error(e);message(`PNG export error: ${e.message}`,true);}finally{button.disabled=false;}
};
$('json').onclick=()=>{if(!current)return;try{validateMapGrid(current);save(new Blob([JSON.stringify(saveProjectDocument(current,master))],{type:'application/json'}),'map-fox-project.json');message('Map Fox project saved, including the original native image for imports. Reopen using Open project.');}catch(e){message(`Could not save project: ${e.message}`,true);}};
$('verify').onclick=()=>{
  try{
    const status=validateMapGrid(current);
    const junctions=countFourWayJunctions(current.layers.regions,current.valid,current.width,current.height);
    message(`Grid valid: ${format(status.land)} land cells · ${format(status.regions)} occupied regions · ${format(status.unclaimed)} unclaimed cells · ${junctions} four-way region junctions. ${junctions?'Check manual edits if these junctions are unwanted.':''}`);
  }catch(e){message(`Invalid grid: ${e.message}`,true);}
};
function buildSimulationExport(){
  if(!current)throw new Error('Generate or import a map first');
  return simulationSizeMap(current, Number($('simSize').value));
}
function describeSimulation(result){
  const s=result.stats;
  $('simResult').textContent=`${format(s.outputWidth)} × ${format(s.outputHeight)} grid · ${format(s.actualLandCells)} land cells (requested ${format(s.requestedLandCells)}) · ${format(s.occupiedRegionsAfter)} regions kept / ${format(s.originalOccupiedRegions)} original · ${format(s.rescuedRegions)} rescued · ${format(s.createdLandCells)} formerly-void cells restored to preserve small regions.`;
}
$('simPreview').onclick=()=>{
  try{
    const result=buildSimulationExport();describeSimulation(result);
    const m=result.map,c=$('simCanvas'),ctx=c.getContext('2d');
    c.width=m.width;c.height=m.height;
    const data=ctx.createImageData(m.width,m.height),colors=new Map(m.palette.map(p=>[p.id,rgb(p.color)]));
    for(let i=0;i<m.valid.length;i++){
      const color=!m.valid[i]?[48,91,114]:m.layers.regions[i]<0?[223,211,174]:(colors.get(m.layers.regions[i])||[223,211,174]);
      const k=i*4;data.data[k]=color[0];data.data[k+1]=color[1];data.data[k+2]=color[2];data.data[k+3]=255;
    }
    ctx.putImageData(data,0,0);$('simPreviewBox').classList.remove('hidden');
    message(`Simulation preview ready: ${result.stats.occupiedRegionsAfter} political regions preserved.`);
  }catch(e){message(`Simulation preview error: ${e.message}`,true);}
};
$('simExport').onclick=()=>{
  try{
    const result=buildSimulationExport();describeSimulation(result);
    const n=Number($('simSize').value);
    save(new Blob([JSON.stringify(serializeMap(result.map))],{type:'application/json'}),`map-fox-des-${n}-land.json`);
    message(`Simulation JSON exported: ${format(result.stats.actualLandCells)} land cells, ${result.stats.occupiedRegionsAfter} regions, ${result.stats.rescuedRegions} regions preserved by rescue. Full-resolution map unchanged.`);
  }catch(e){message(`Simulation export error: ${e.message}`,true);}
};
makeGenerated();
// END APP UI


export { paint };
