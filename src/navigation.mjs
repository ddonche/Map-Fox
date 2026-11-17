import { paint } from './app.mjs';
document.getElementById('smoothEdges').addEventListener('change',()=>paint());

(function(){
  const panes=['generate','import','edit','export'];
  let active='generate';
  function switchPane(to){
    if(!panes.includes(to))return;
    active=to;
    document.querySelectorAll('.rail-action').forEach(b=>{const on=b.dataset.pane===to;b.classList.toggle('is-active',on);b.setAttribute('aria-current',on?'page':'false');});
    panes.forEach(k=>document.getElementById('pane-'+k).classList.toggle('is-active',k===to));
    if(to==='import'){document.getElementById('tabImport').click();}
    else if(to==='generate'){document.getElementById('tabGenerate').click();}
    else if(to==='edit' || to==='export'){
      // Preserve import-mode state when working with an imported image.
      // A non-edit view must never keep a painting tool armed.
    }
   // The editing toolbar manages the active tool; outside Edit the map pans.
   if(to==='edit' && document.getElementById('tool').value==='inspect')document.getElementById('tool').value='pick';
   window.mapFoxSyncTools?.();
  }
  window.mapFoxSwitch=switchPane;
  document.querySelectorAll('.rail-action').forEach(b=>b.addEventListener('click',()=>switchPane(b.dataset.pane)));
  document.getElementById('openProject').addEventListener('click',()=>document.getElementById('jsonFile').click());
  document.getElementById('saveProject').addEventListener('click',()=>document.getElementById('json').click());
  document.getElementById('jsonFile').addEventListener('change',()=>setTimeout(()=>switchPane('edit'),150));
  switchPane('generate');
})();
