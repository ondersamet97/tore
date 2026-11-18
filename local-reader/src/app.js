(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let readingStore=null,readingUI=null,thoughtTools=null;
  let archive=null, profileStore=null, profileUI=null, comparisonStore=null, comparisonUI=null, pendingDir=null, selected=null, trash=false, busy=false, cache=new Map(), loadGeneration=0;
  const hosted=!!globalThis.ToreRemote?.hosted;
  const supported=isSecureContext && (hosted || typeof showDirectoryPicker==='function') && !!crypto.subtle;
  const controls=['choose','upload','backup','restore','trash','rename','download','remove'];
  // Interface text (EN/TR). Status lines are kept as functions so a language
  // switch can redraw them; plain strings from other modules are translated by
  // their exact Turkish wording when a translation is known.
  const I18N=globalThis.toreI18n,tx=(k,v)=>I18N.t(k,v);
  const MESSAGE_PATTERNS=[
    [/^Mevcut dosyanın üzerine yazılmadı: (.+)$/s,'archive.err.collision',['name']],
    [/^Disk doğrulaması eşleşmedi: (.+)$/s,'archive.err.verify',['name']],
    [/^Rapor dosyası okunamadı veya eksik: (.+?)\. Arşiv kaydı korundu\.$/s,'archive.err.missingFile',['path']],
    [/^Raporun içerik özeti eşleşmiyor: (.+?)\. Dosya dışarıdan değişmiş olabilir\.$/s,'archive.err.hash',['path']],
    [/^(.+) bulunamadı\. Arşiv otomatik sıfırlanmadı\.$/s,'archive.err.manifestMissing',['name']],
    [/^Başlık kaydedilemedi: (.+) Klasörü yeniden seçin\.$/s,'archive.err.title',['*cause']],
    [/^Çöp kutusu durumu kaydedilemedi: (.+) Klasörü yeniden seçin\.$/s,'archive.err.trash',['*cause']],
    [/^Yedek geri yüklenemedi: (.+) Başarı bildirilmedi\. Klasörü yeniden seçin\.$/s,'archive.err.restore',['*cause']],
    [/^Rapor kaydedilemedi: (.+) Başarı bildirilmedi\. Klasörü yeniden seçin; kayıtsız bir dosya kalmış olabilir\.$/s,'archive.err.saveTouched',['*cause']],
    [/^Rapor kaydedilemedi: (.+) Başarı bildirilmedi\.$/s,'archive.err.save',['*cause']],
    [/^(.+?) şeması desteklenmiyor; yedekten sessizce çıkarılmadı\.$/s,'archive.err.extraSchema',['name']],
    [/^(.+?) içinde geçersiz kimlik veya arşivde bulunmayan rapor bağı var\.$/s,'archive.err.extraIds',['name']],
    [/^(.+?) eksik fakat önceki kaydı mevcut\. Ek katalog yedekten sessizce çıkarılmadı; dosyaları denetleyin\.$/s,'archive.err.extraMissing',['name']],
    [/^(.+?) geçerli UTF-8 JSON değil; sıfırlanmadı veya yedekten çıkarılmadı\.$/s,'archive.err.extraJson',['name']]
  ];
  // Exact message, then known shapes, then sentence by sentence; unknown text stays as it is.
  function localize(text){
    text=String(text??'');if(I18N.lang()!=='en'||!text)return text;
    const whole=I18N.server(text);if(whole!==text)return whole;
    for(const [pattern,key,names] of MESSAGE_PATTERNS){const m=text.match(pattern);if(m){const vars={};names.forEach((name,i)=>{if(name.startsWith('*'))vars[name.slice(1)]=localize(m[i+1]);else vars[name]=m[i+1];});return tx(key,vars);}}
    const parts=text.split(/(?<=[.!?])\s+/);return parts.length>1?parts.map(part=>localize(part)).join(' '):text;
  }
  globalThis.ToreArchiveText=Object.freeze({localize});
  let lastStatus={text:()=>tx('archive.status.start'),error:false},folderText=()=>tx('archive.folder.none');
  const when=d=>new Date(d).toLocaleString(I18N.locale());
  const untitled=r=>r.title||tx('archive.untitled');
  function allowNoteLeave(){const value=$('reading-note-input')?.value.trim();return !value||confirm(tx('archive.confirm.noteLeave'));}
  function paintStatus(){const {text,error}=lastStatus;$('status').textContent=typeof text==='function'?text():localize(text);$('status').className=error?'status error':'status';}
  function message(text,error=false) { lastStatus={text,error}; paintStatus(); }
  function setFolder(fn){folderText=fn;$('folder').textContent=fn();}
  function updateControls() {
    for (const id of controls) $(id).disabled=busy || (id!=='choose' && !archive) || (['rename','download','remove'].includes(id) && !selected);
    $('choose').disabled=busy||!supported; $('search').disabled=!archive||busy;
    $('recover').disabled=busy;$('recover-reading').disabled=busy;$('native-stop').disabled=busy;
    $('recover-profiles').disabled=busy;
    readingUI?.syncDisabled?.(busy);thoughtTools?.syncDisabled?.(busy);profileUI?.syncDisabled(busy);comparisonUI?.syncDisabled(busy);$('recover-comparisons').disabled=busy;
  }
  async function task(fn) {
    if(busy)return; busy=true; updateControls();
    try { await fn(); } catch(e) {
      message(()=>explain(e),true);
      if(e.recoverable && pendingDir) $('recover').hidden=false;
    } finally { busy=false; updateControls(); }
  }
  function explain(e) {
    if(e.name==='AbortError')return tx('archive.err.abort');
    if(hosted && (e.name==='NotAllowedError'||e.name==='SecurityError'))return tx('archive.err.hostedPermission',{message:localize(e.message)});
    if(e.name==='InvalidModificationError')return tx('archive.err.changed');
    if(e.name==='NotAllowedError'||e.name==='SecurityError')return tx('archive.err.permission');
    return localize(e.message) || tx('archive.err.failed');
  }
  function resetReader() {
    readingUI?.reset();selected=null; $('readerHeader').hidden=true; $('toc').hidden=true; $('toc').replaceChildren();
    $('article').replaceChildren(); $('welcome').hidden=false; updateControls();
  }
  function paintReportHeader(r){$('reportTitle').textContent=untitled(r);$('reportMeta').textContent=r.originalName+' · '+when(r.addedAt)+(r.trashed?tx('archive.reader.inTrash'):'');$('remove').textContent=r.trashed?tx('archive.reader.untrash'):tx('archive.reader.remove');}
  function paintHostedWelcome(){$('welcome').replaceChildren();const title=document.createElement('h2');title.textContent=tx('archive.hosted.title');const info=document.createElement('p');info.textContent=tx('archive.hosted.body');$('welcome').append(title,info);}
  async function attach(dir,recover=false) {
    if(!allowNoteLeave())return;
    let priorReadingError='';try{await readingUI?.flush();}catch(e){priorReadingError=e.message;}readingStore=null;archive=null; profileStore=null;comparisonStore=null;comparisonUI?.reset(); cache.clear(); loadGeneration++; resetReader(); $('list').replaceChildren();profileUI?.refresh();
    pendingDir=dir; setFolder(()=>tx('archive.folder.checking',{name:dir.name})); $('recover').hidden=true;$('recover-profiles').hidden=true;$('recover-comparisons').hidden=true;
    archive=await (recover?ToruStore.Archive.recover(dir):ToruStore.Archive.open(dir));
    setFolder(()=>tx('archive.folder.data',{name:dir.name})); pendingDir=null;
    const issues=[];
    try{profileStore=await ToreProfiles.ProfileStore.open(dir,archive.manifest.reports);}catch(e){issues.push(()=>tx('archive.issue.profiles',{message:localize(e.message)}));$('recover-profiles').hidden=!e.recoverable;}
    try{comparisonStore=await ToreComparisons.ComparisonStore.open(dir);}catch(e){issues.push(()=>tx('archive.issue.comparisons',{message:localize(e.message)}));$('recover-comparisons').hidden=!e.recoverable;}
    $('recover-reading').hidden=true;try{readingStore=await ToreReading.Store.open(dir,archive.manifest.reports);}catch(e){issues.push(()=>tx('archive.issue.reading',{message:localize(e.message)}));$('recover-reading').hidden=!e.recoverable;}
    readingUI=createToreReadingUI({getArchive:()=>archive,getStore:()=>readingStore,task,message});if(priorReadingError)issues.push(()=>tx('archive.issue.priorReading',{message:localize(priorReadingError)}));
    for(const r of archive.manifest.reports) {
      try { cache.set(r.id,await archive.readText(r.id)); } catch(e) { issues.push(()=>r.originalName+': '+localize(e.message)); }
    }
    trash=false; $('trash').textContent=tx('archive.trash'); $('search').value=''; renderList();
    profileUI?.refresh();comparisonUI?.refresh();await thoughtTools?.refresh();
    message(issues.length ? ()=>tx('archive.status.openedIssues',{issues:issues.map(f=>f()).join(' • ')}) : ()=>tx('archive.status.opened'),issues.length>0);
  }
  function renderList() {
    const rows=archive?archive.manifest.reports:[];
    const words=ToruReader.fold($('search').value.trim()).split(/\s+/).filter(Boolean);
    const shown=rows.filter(r=>r.trashed===trash && words.every(w=>ToruReader.fold(r.title+'\n'+(cache.get(r.id)||'')).includes(w)))
      .sort((a,b)=>b.addedAt.localeCompare(a.addedAt)||b.id.localeCompare(a.id));
    $('listTitle').textContent=trash?tx('archive.trash'):tx('archive.nav.reports');
    $('count').textContent=String(shown.length); $('list').replaceChildren();
    if(!shown.length) {
      const p=document.createElement('p'); p.className='empty';
      p.textContent=words.length?tx('archive.list.noMatch'):trash?tx('archive.list.trashEmpty'):tx('archive.list.empty'); $('list').append(p);
    }
    for(const r of shown) {
      const b=document.createElement('button'); b.type='button'; b.className='report'+(selected===r.id?' selected':'');
      const title=document.createElement('strong'); title.textContent=untitled(r);
      const meta=document.createElement('span'); meta.textContent=when(r.addedAt)+(cache.has(r.id)?'':tx('archive.list.unreadable'));
      b.append(title,meta); b.addEventListener('click',()=>task(()=>openReport(r.id))); $('list').append(b);
    }
    updateControls();
  }
  async function openReport(id) {
    if(!allowNoteLeave())return;
    await readingUI?.flush();
    const generation=++loadGeneration, text=await archive.readText(id);
    if(generation!==loadGeneration)return;
    const r=archive.manifest.reports.find(r=>r.id===id); selected=id; cache.set(id,text);
    $('welcome').hidden=true; $('readerHeader').hidden=false; paintReportHeader(r);
    ToruReader.render(text,$('article'),$('toc')); renderList(); $('reading').scrollTop=0;
    await readingUI?.onReportOpened(r,{article:$('article'),reading:$('reading'),toc:$('toc')});
  }
  async function importFiles(files) {
    if(!archive)throw Error(hosted?tx('archive.err.waitConnection'):tx('archive.err.openFirst'));
    const results=[];
    for(const file of files) {
      try {
        const {record,duplicate}=await archive.importFile(file);
        if(duplicate) {
          if(record.trashed && confirm(tx('archive.confirm.untrash',{title:record.title}))) {
            await archive.setTrashed(record.id,false); results.push(()=>tx('archive.import.untrashed',{name:file.name}));
          } else { const trashed=record.trashed; results.push(()=>tx(trashed?'archive.import.duplicateTrashed':'archive.import.duplicate',{name:file.name})); }
        } else results.push(()=>tx('archive.import.saved',{name:file.name}));
        cache.set(record.id,await archive.readText(record.id));
      } catch(e) { results.push(()=>file.name+': '+explain(e)); message(()=>results.map(f=>f()).join(' • '),true); renderList(); return; }
    }
    renderList(); message(()=>results.map(f=>f()).join(' • '));
  }
  function download(data,name,type) {
    const url=URL.createObjectURL(new Blob([data],{type})); const a=document.createElement('a'); a.href=url; a.download=name;
    document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  $('choose').addEventListener('click',()=>task(async()=>{
    const dir=hosted?await ToreRemote.getRoot():await showDirectoryPicker({mode:'readwrite',id:'toru-archive'});
    let permission=await dir.queryPermission({mode:'readwrite'});
    if(permission!=='granted')permission=await dir.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw new DOMException(tx('archive.err.noEditPermission'),'NotAllowedError');
    await attach(dir);
  }));
  $('recover').addEventListener('click',()=>task(async()=>{
    if(pendingDir && confirm(tx('archive.confirm.recoverArchive')))await attach(pendingDir,true);
  }));
  $('recover-reading').addEventListener('click',()=>task(async()=>{if(!archive||!confirm(tx('archive.confirm.recoverReading')))return;readingStore=await ToreReading.Store.recover(archive.dir,archive.manifest.reports);readingUI.reset();readingUI=createToreReadingUI({getArchive:()=>archive,getStore:()=>readingStore,task,message});$('recover-reading').hidden=true;if(selected)await openReport(selected);message(()=>tx('archive.status.readingRecovered'));}));
  $('recover-profiles').addEventListener('click',()=>task(async()=>{
    if(!archive||!confirm(tx('archive.confirm.recoverProfiles')))return;
    profileStore=await ToreProfiles.ProfileStore.recover(archive.dir,archive.manifest.reports);comparisonStore=await ToreComparisons.ComparisonStore.open(archive.dir);comparisonUI.reset();comparisonUI.refresh();$('recover-profiles').hidden=true;profileUI.refresh();message(()=>tx('archive.status.profilesRecovered'));
  }));
  $('recover-comparisons').addEventListener('click',()=>task(async()=>{if(!archive||!confirm(tx('archive.confirm.recoverComparisons')))return;comparisonStore=await ToreComparisons.ComparisonStore.recover(archive.dir);$('recover-comparisons').hidden=true;comparisonUI.reset();comparisonUI.refresh();message(()=>tx('archive.status.comparisonsRecovered'));}));
  $('upload').addEventListener('click',()=>$('files').click());
  $('files').addEventListener('change',()=>{const files=[...$('files').files];$('files').value='';task(()=>importFiles(files));});
  $('search').addEventListener('input',renderList);
  $('trash').addEventListener('click',()=>task(async()=>{await readingUI?.flush();trash=!trash;$('trash').textContent=trash?tx('archive.backToArchive'):tx('archive.trash');resetReader();renderList();}));
  $('rename').addEventListener('click',()=>task(async()=>{
    const r=archive.manifest.reports.find(r=>r.id===selected); const title=prompt(tx('archive.prompt.rename'),r.title);
    if(title===null)return; await archive.rename(r.id,title); await openReport(r.id); message(()=>tx('archive.status.renamed'));
  }));
  $('remove').addEventListener('click',()=>task(async()=>{
    await readingUI?.flush();const r=archive.manifest.reports.find(r=>r.id===selected); await archive.setTrashed(r.id,!r.trashed);
    resetReader(); renderList(); const wasTrashed=r.trashed;message(()=>wasTrashed?tx('archive.status.untrashed'):tx('archive.status.trashed'));
  }));
  $('download').addEventListener('click',()=>task(async()=>{
    const r=archive.manifest.reports.find(r=>r.id===selected); const bytes=await archive.readBytes(r.id);
    download(bytes,r.originalName,'text/markdown;charset=utf-8'); message(()=>tx('archive.status.downloadStarted'));
  }));
  $('backup').addEventListener('click',()=>task(async()=>{
    await readingUI?.flush();const data=await archive.backup(); download(JSON.stringify(data,null,2),tx('archive.backupFilePrefix')+new Date().toISOString().replace(/[:.]/g,'-')+'.json','application/json');
    message(()=>tx('archive.status.backupStarted'));
  }));
  $('restore').addEventListener('click',()=>{
    if(archive.manifest.reports.length||profileStore?.document.profiles.length||comparisonStore?.document.comparisons.length){message(()=>tx('archive.status.restoreNeedsEmpty'),true);return;}
    $('backupFile').click();
  });
  $('backupFile').addEventListener('change',()=>{
    const file=$('backupFile').files[0];$('backupFile').value='';if(!file)return;
    task(async()=>{let data;try{data=JSON.parse(ToruStore.decodeUTF8(new Uint8Array(await file.arrayBuffer())));}catch(_){throw Error(tx('archive.err.backupUnreadable'));}
      await archive.restore(data);readingStore=await ToreReading.Store.open(archive.dir,archive.manifest.reports);profileStore=await ToreProfiles.ProfileStore.open(archive.dir,archive.manifest.reports);comparisonStore=await ToreComparisons.ComparisonStore.open(archive.dir);comparisonUI.reset();cache.clear();for(const r of archive.manifest.reports)cache.set(r.id,await archive.readText(r.id));
      renderList();profileUI.refresh();comparisonUI.refresh();await thoughtTools?.refresh();message(()=>tx('archive.status.restored'));});
  });
  document.addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('dragging');});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('dropzone').classList.remove('dragging');});
  document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragging');if(busy){message(()=>tx('archive.status.busy'),true);return;}task(()=>importFiles([...e.dataTransfer.files]));});
  profileUI=createToreProfileUI({getArchive:()=>archive,getProfiles:()=>profileStore,task,message,onOpenReport:openReport,onOpenTimeline:id=>thoughtTools?.openTimeline(id)});
  comparisonUI=createToreComparisonUI({getStore:()=>comparisonStore,getProfiles:()=>profileStore,getArchive:()=>archive,task,message,onOpenReport:async id=>{profileUI.show('reports');await openReport(id);}});
  readingUI=createToreReadingUI({getArchive:()=>archive,getStore:()=>readingStore,task,message});
  function showPanel(id){
    readingUI?.flush().catch(e=>message(e.message,true));
    profileUI.show('reports');if(id==='reports-pane'){for(const p of document.querySelectorAll('.tore-extra-pane'))p.hidden=true;for(const id of ['nav-timeline','nav-connection-map'])document.getElementById(id)?.removeAttribute('aria-current');return;}$('reports-pane').hidden=true;
    for(const panel of document.querySelectorAll('.tore-extra-pane'))panel.hidden=panel.id!==id;
    for(const button of document.querySelectorAll('.main-nav button'))button.removeAttribute('aria-current');
    const target=id==='thought-timeline-pane'?'nav-timeline':'nav-connection-map';document.getElementById(target)?.setAttribute('aria-current','page');
  }
  thoughtTools=createToreThoughtTools({getArchive:()=>archive,getProfiles:()=>profileStore,getReportTexts:()=>cache,task,message,onOpenReport:async id=>{for(const p of document.querySelectorAll('.tore-extra-pane'))p.hidden=true;profileUI.show('reports');await openReport(id);},showPanel});
  document.querySelector('.main-nav').addEventListener('click',event=>{
    const link=event.target.closest('a.network-link');if(link&&hosted&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0){event.preventDefault();task(async()=>{if(!allowNoteLeave())return;await readingUI?.flush();location.assign(link.href);});return;}
if(['nav-reports','nav-self','nav-thinkers','nav-comparisons'].includes(event.target.closest('button')?.id)){for(const p of document.querySelectorAll('.tore-extra-pane'))p.hidden=true;for(const id of ['nav-timeline','nav-connection-map'])document.getElementById(id)?.removeAttribute('aria-current');readingUI?.flush().catch(e=>message(e.message,true));}});
  if(!supported)message(()=>tx('archive.status.unsupported'),true);
  if(hosted){
    $('native-stop').hidden=false;$('native-stop').onclick=()=>task(async()=>{if(!allowNoteLeave())return;try{await readingUI?.flush();}catch(e){if(!confirm(tx('archive.confirm.stopAnyway',{message:localize(e.message)})))throw e;}const stopped=await ToreRemote.stop();message(()=>localize(stopped));});
    $('app-topbar').hidden=false;$('back-to-topics').hidden=false;message(()=>tx('archive.status.hostedOpening'));$('choose').textContent=tx('archive.reopen');setFolder(()=>tx('archive.folder.connecting'));$('network-link').hidden=false;$('sources-link').hidden=false;/* Legacy integration services are deliberately absent from this isolated demo. */
    paintHostedWelcome();
    task(async()=>attach(await ToreRemote.getRoot()));
  }
  // Language: redraw everything this script wrote, once the saved choice is
  // known and again after each switch. Without a server (Töre.html opened as a
  // file) the switch moves next to the archive title, since the top bar stays hidden.
  if(!hosted){const sw=document.querySelector('#app-topbar .lang-switch');if(sw)document.querySelector('header.top .brand').append(sw);}
  function repaint(){
    $('choose').textContent=hosted?tx('archive.reopen'):tx('archive.choose');$('folder').textContent=folderText();
    $('trash').textContent=trash?tx('archive.backToArchive'):tx('archive.trash');
    if(archive)renderList();else{$('listTitle').textContent=tx('archive.nav.reports');const p=document.createElement('p');p.className='empty';p.textContent=tx('archive.list.chooseFolder');$('list').replaceChildren(p);}
    const r=selected&&archive?.manifest.reports.find(r=>r.id===selected);if(r)paintReportHeader(r);
    if(hosted)paintHostedWelcome();paintStatus();
  }
  I18N.whenReady().then(repaint);I18N.onChange(repaint);
  updateControls();
})();
