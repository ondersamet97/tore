(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let readingStore=null,readingUI=null,thoughtTools=null;
  let archive=null, profileStore=null, profileUI=null, comparisonStore=null, comparisonUI=null, pendingDir=null, selected=null, trash=false, busy=false, cache=new Map(), loadGeneration=0;
  const hosted=!!globalThis.ToreRemote?.hosted;
  const supported=isSecureContext && (hosted || typeof showDirectoryPicker==='function') && !!crypto.subtle;
  const controls=['choose','upload','backup','restore','trash','rename','download','remove'];
  function allowNoteLeave(){const value=$('reading-note-input')?.value.trim();return !value||confirm('Bu okuma notu henüz kaydedilmedi. Notu kaydetmeden bu görünümden çıkılsın mı?');}
  function message(text,error=false) { $('status').textContent=text; $('status').className=error?'status error':'status'; }
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
      message(explain(e),true);
      if(e.recoverable && pendingDir) $('recover').hidden=false;
    } finally { busy=false; updateControls(); }
  }
  function explain(e) {
    if(e.name==='AbortError')return 'Seçim veya izin isteği iptal edildi ya da izin verilmedi. Yeni bir kayıt kaydedilmedi.';
    if(hosted && (e.name==='NotAllowedError'||e.name==='SecurityError'))return e.message+' Töre.app ile yerel bağlantıyı yeniden açın.';
    if(e.name==='InvalidModificationError')return 'Bu dosya başka bir işlemde değişti. Üzerine yazılmadı. Arşivi yenileyip son kaydı denetleyin.';
    if(e.name==='NotAllowedError'||e.name==='SecurityError')return 'Klasör izni verilmedi veya geri çekildi. Chrome’da bu dosyayı açıp klasörü yeniden seçin ve düzenleme izni verin.';
    return e.message || 'İşlem tamamlanamadı. Klasörü yeniden açıp dosyaları denetleyin.';
  }
  function resetReader() {
    readingUI?.reset();selected=null; $('readerHeader').hidden=true; $('toc').hidden=true; $('toc').replaceChildren();
    $('article').replaceChildren(); $('welcome').hidden=false; updateControls();
  }
  async function attach(dir,recover=false) {
    if(!allowNoteLeave())return;
    let priorReadingError='';try{await readingUI?.flush();}catch(e){priorReadingError=e.message;}readingStore=null;archive=null; profileStore=null;comparisonStore=null;comparisonUI?.reset(); cache.clear(); loadGeneration++; resetReader(); $('list').replaceChildren();profileUI?.refresh();
    pendingDir=dir; $('folder').textContent='Denetleniyor: '+dir.name; $('recover').hidden=true;$('recover-profiles').hidden=true;$('recover-comparisons').hidden=true;
    archive=await (recover?ToruStore.Archive.recover(dir):ToruStore.Archive.open(dir));
    $('folder').textContent='Veri klasörü: '+dir.name; pendingDir=null;
    const issues=[];
    try{profileStore=await ToreProfiles.ProfileStore.open(dir,archive.manifest.reports);}catch(e){issues.push('Profiller açılmadı: '+e.message);$('recover-profiles').hidden=!e.recoverable;}
    try{comparisonStore=await ToreComparisons.ComparisonStore.open(dir);}catch(e){issues.push('Karşılaştırmalar açılmadı: '+e.message);$('recover-comparisons').hidden=!e.recoverable;}
    $('recover-reading').hidden=true;try{readingStore=await ToreReading.Store.open(dir,archive.manifest.reports);}catch(e){issues.push('Okuma kayıtları açılmadı: '+e.message);$('recover-reading').hidden=!e.recoverable;}
    readingUI=createToreReadingUI({getArchive:()=>archive,getStore:()=>readingStore,task,message});if(priorReadingError)issues.push('Önceki oturumdaki okuma işlemi tamamlanmadı: '+priorReadingError);
    for(const r of archive.manifest.reports) {
      try { cache.set(r.id,await archive.readText(r.id)); } catch(e) { issues.push(r.originalName+': '+e.message); }
    }
    trash=false; $('trash').textContent='Çöp kutusu'; $('search').value=''; renderList();
    profileUI?.refresh();comparisonUI?.refresh();await thoughtTools?.refresh();
    message(issues.length ? 'Arşiv açıldı; okunamayan dosyalar var. '+issues.join(' • ') : 'Arşiv diskte açıldı. Raporları yeniden yüklemeniz gerekmez.',issues.length>0);
  }
  function renderList() {
    const rows=archive?archive.manifest.reports:[];
    const words=ToruReader.fold($('search').value.trim()).split(/\s+/).filter(Boolean);
    const shown=rows.filter(r=>r.trashed===trash && words.every(w=>ToruReader.fold(r.title+'\n'+(cache.get(r.id)||'')).includes(w)))
      .sort((a,b)=>b.addedAt.localeCompare(a.addedAt)||b.id.localeCompare(a.id));
    $('listTitle').textContent=trash?'Çöp kutusu':'Raporlar';
    $('count').textContent=String(shown.length); $('list').replaceChildren();
    if(!shown.length) {
      const p=document.createElement('p'); p.className='empty';
      p.textContent=words.length?'Aramanızla eşleşen rapor bulunamadı.':trash?'Çöp kutusu boş.':'Arşiv boş. .md dosyası yükleyin veya buraya bırakın.'; $('list').append(p);
    }
    for(const r of shown) {
      const b=document.createElement('button'); b.type='button'; b.className='report'+(selected===r.id?' selected':'');
      const title=document.createElement('strong'); title.textContent=r.title || '(Başlıksız rapor)';
      const meta=document.createElement('span'); meta.textContent=new Date(r.addedAt).toLocaleString('tr-TR')+(cache.has(r.id)?'':' · Dosya okunamadı');
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
    $('welcome').hidden=true; $('readerHeader').hidden=false; $('reportTitle').textContent=r.title || '(Başlıksız rapor)';
    $('reportMeta').textContent=r.originalName+' · '+new Date(r.addedAt).toLocaleString('tr-TR')+(r.trashed?' · Çöp kutusunda':'');
    $('remove').textContent=r.trashed?'Geri al':'Kaldır';
    ToruReader.render(text,$('article'),$('toc')); renderList(); $('reading').scrollTop=0;
    await readingUI?.onReportOpened(r,{article:$('article'),reading:$('reading'),toc:$('toc')});
  }
  async function importFiles(files) {
    if(!archive)throw Error(hosted?'Önce yerel arşiv bağlantısının açılmasını bekleyin.':'Önce “Veri klasörünü seç” ile arşivinizi açın.');
    const results=[];
    for(const file of files) {
      try {
        const {record,duplicate}=await archive.importFile(file);
        if(duplicate) {
          if(record.trashed && confirm('Bu içerik çöp kutusunda: '+record.title+'. Bilgilerini koruyarak geri getirilsin mi?')) {
            await archive.setTrashed(record.id,false); results.push(file.name+': çöp kutusundan geri alındı.');
          } else results.push(file.name+': aynı içerik zaten var'+(record.trashed?' (çöp kutusunda).':'.'));
        } else results.push(file.name+': diske kaydedildi.');
        cache.set(record.id,await archive.readText(record.id));
      } catch(e) { results.push(file.name+': '+explain(e)); message(results.join(' • '),true); renderList(); return; }
    }
    renderList(); message(results.join(' • '));
  }
  function download(data,name,type) {
    const url=URL.createObjectURL(new Blob([data],{type})); const a=document.createElement('a'); a.href=url; a.download=name;
    document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  $('choose').addEventListener('click',()=>task(async()=>{
    const dir=hosted?await ToreRemote.getRoot():await showDirectoryPicker({mode:'readwrite',id:'toru-archive'});
    let permission=await dir.queryPermission({mode:'readwrite'});
    if(permission!=='granted')permission=await dir.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw new DOMException('Klasör düzenleme izni verilmedi.','NotAllowedError');
    await attach(dir);
  }));
  $('recover').addEventListener('click',()=>task(async()=>{
    if(pendingDir && confirm('Önceki sağlam arşiv kaydı geri getirilsin mi? Son başarılı işlem listede bulunmayabilir. Mevcut bozuk kayıt ayrıca korunur.'))await attach(pendingDir,true);
  }));
  $('recover-reading').addEventListener('click',()=>task(async()=>{if(!archive||!confirm('Önceki sağlam okuma kaydı geri getirilsin mi? Son not veya konum bulunmayabilir; bozuk dosya korunur.'))return;readingStore=await ToreReading.Store.recover(archive.dir,archive.manifest.reports);readingUI.reset();readingUI=createToreReadingUI({getArchive:()=>archive,getStore:()=>readingStore,task,message});$('recover-reading').hidden=true;if(selected)await openReport(selected);message('Önceki sağlam okuma kaydı geri getirildi.');}));
  $('recover-profiles').addEventListener('click',()=>task(async()=>{
    if(!archive||!confirm('Önceki sağlam profil kaydı geri getirilsin mi? Son değişiklikler bulunmayabilir. Mevcut bozuk dosya ayrıca korunur.'))return;
    profileStore=await ToreProfiles.ProfileStore.recover(archive.dir,archive.manifest.reports);comparisonStore=await ToreComparisons.ComparisonStore.open(archive.dir);comparisonUI.reset();comparisonUI.refresh();$('recover-profiles').hidden=true;profileUI.refresh();message('Önceki sağlam profil kaydı doğrulanarak geri getirildi.');
  }));
  $('recover-comparisons').addEventListener('click',()=>task(async()=>{if(!archive||!confirm('Önceki sağlam karşılaştırma kaydı geri getirilsin mi? Son düzenleme bulunmayabilir; bozuk dosya ayrıca korunur.'))return;comparisonStore=await ToreComparisons.ComparisonStore.recover(archive.dir);$('recover-comparisons').hidden=true;comparisonUI.reset();comparisonUI.refresh();message('Önceki karşılaştırmalar doğrulanarak geri getirildi.');}));
  $('upload').addEventListener('click',()=>$('files').click());
  $('files').addEventListener('change',()=>{const files=[...$('files').files];$('files').value='';task(()=>importFiles(files));});
  $('search').addEventListener('input',renderList);
  $('trash').addEventListener('click',()=>task(async()=>{await readingUI?.flush();trash=!trash;$('trash').textContent=trash?'Arşive dön':'Çöp kutusu';resetReader();renderList();}));
  $('rename').addEventListener('click',()=>task(async()=>{
    const r=archive.manifest.reports.find(r=>r.id===selected); const title=prompt('Yeni görünen başlık (MD içeriği değişmez):',r.title);
    if(title===null)return; await archive.rename(r.id,title); await openReport(r.id); message('Görünen başlık diske kaydedildi.');
  }));
  $('remove').addEventListener('click',()=>task(async()=>{
    await readingUI?.flush();const r=archive.manifest.reports.find(r=>r.id===selected); await archive.setTrashed(r.id,!r.trashed);
    resetReader(); renderList(); message(r.trashed?'Rapor geri alındı.':'Rapor çöp kutusuna taşındı. Özgün dosya arşivde korunuyor.');
  }));
  $('download').addEventListener('click',()=>task(async()=>{
    const r=archive.manifest.reports.find(r=>r.id===selected); const bytes=await archive.readBytes(r.id);
    download(bytes,r.originalName,'text/markdown;charset=utf-8'); message('Özgün MD indirmesi başlatıldı. Chrome’un indirmeler bölümünden kontrol edebilirsiniz.');
  }));
  $('backup').addEventListener('click',()=>task(async()=>{
    await readingUI?.flush();const data=await archive.backup(); download(JSON.stringify(data,null,2),'Töre-yedek-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json','application/json');
    message('Yedek indirmesi başlatıldı. Chrome’un indirmeler bölümünden dosyayı kontrol edin.');
  }));
  $('restore').addEventListener('click',()=>{
    if(archive.manifest.reports.length||profileStore?.document.profiles.length||comparisonStore?.document.comparisons.length){message('Geri yüklemek için yeni/boş bir veri klasörü seçin. Dolu arşiv veya profiller birleştirilmez.',true);return;}
    $('backupFile').click();
  });
  $('backupFile').addEventListener('change',()=>{
    const file=$('backupFile').files[0];$('backupFile').value='';if(!file)return;
    task(async()=>{let data;try{data=JSON.parse(ToruStore.decodeUTF8(new Uint8Array(await file.arrayBuffer())));}catch(_){throw Error('Yedek okunamadı: geçerli UTF-8 JSON dosyası seçin.');}
      await archive.restore(data);readingStore=await ToreReading.Store.open(archive.dir,archive.manifest.reports);profileStore=await ToreProfiles.ProfileStore.open(archive.dir,archive.manifest.reports);comparisonStore=await ToreComparisons.ComparisonStore.open(archive.dir);comparisonUI.reset();cache.clear();for(const r of archive.manifest.reports)cache.set(r.id,await archive.readText(r.id));
      renderList();profileUI.refresh();comparisonUI.refresh();await thoughtTools?.refresh();message('Yedek geri yüklendi. Özgün dosyalar, arşiv ve varsa profil/değişim/karşılaştırma ile kaynak/temsilci kayıtları yeniden okunarak doğrulandı.');});
  });
  document.addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('dragging');});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('dropzone').classList.remove('dragging');});
  document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragging');if(busy){message('Önce devam eden işlemin bitmesini bekleyin.',true);return;}task(()=>importFiles([...e.dataTransfer.files]));});
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
  if(!supported)message('Bu ortamda güvenli File System Access API kullanılamıyor. Töre.html dosyasını Mac’te masaüstü Chrome ile açın. Disk izni olmadan kalıcı kayıt yapılmaz.',true);
  if(hosted){
    $('native-stop').hidden=false;$('native-stop').onclick=()=>task(async()=>{if(!allowNoteLeave())return;try{await readingUI?.flush();}catch(e){if(!confirm('Son okuma işlemi tamamlanamadı: '+e.message+' Son konum/not kaydedilmemiş olabilir. Yerel hizmet yine de kapatılsın mı?'))throw e;}message(await ToreRemote.stop());});
    message('Yerel arşiv açılıyor; veri klasörü seçmeniz gerekmiyor.');$('choose').textContent='Arşivi yeniden aç';$('folder').textContent='Yerel arşive bağlanılıyor…';$('network-link').hidden=false;$('sources-link').hidden=false;/* Legacy integration services are deliberately absent from this isolated demo. */
    $('welcome').replaceChildren();const title=document.createElement('h2');title.textContent='Özel arşiviniz hazır.';const info=document.createElement('p');info.textContent='Raporlar bilgisayarınızdaki Töre Verileri klasöründen otomatik açılır. Profilim ve Düşünürler alanında görüşleri siz kaydedersiniz. Ağ paylaşımı ayrı ve isteğe bağlıdır.';$('welcome').append(title,info);
    task(async()=>attach(await ToreRemote.getRoot()));
  }
  updateControls();
})();
