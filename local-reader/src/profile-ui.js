/* Töre — kaynaklı profiller ve elle kaydedilen görüşler. */
(() => {
  'use strict';
  const areas={past:['Geçmiş','Düşünsel miras hakkındaki değerlendirmeler'],present:['Şimdi','Mevcut koşullarda savunulan yaklaşım'],future:['Gelecek','İstenen düzen, beklentiler ve açık sorular']};
  const kinds={position:'Görüş / ideal',prediction:'Tahmin',question:'Açık soru'};
  const changes={initial:'İlk kayıt',opinion:'Görüş değişikliği',correction:'Temsil / metin düzeltmesi'};
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(label,action)=>{const b=el('button',label);b.type='button';b.addEventListener('click',action);return b;};
  globalThis.createToreProfileUI=function({getArchive,getProfiles,task,message,onOpenReport,onOpenTimeline}) {
    const $=id=>document.getElementById(id);
    let mode='reports', thinkerId=null, currentId=null, disabled=false;
    const profiles=()=>getProfiles()?.document.profiles||[];
    const current=()=>profiles().find(p=>p.id===currentId);
    const reports=()=>getArchive()?.manifest.reports||[];
    function syncDisabled(value) {
      disabled=value;
      for(const id of ['profile-create-self','profile-create-thinker','profile-edit','view-add','profile-save','view-save','source-add'])$(id).disabled=value||!getProfiles();
      for(const e of document.querySelectorAll('#templates button,#profile-list button,#profile-current button,#profile-form input,#profile-form textarea,#profile-form select,#profile-form .source-row button,#view-form input,#view-form textarea,#view-form select'))e.disabled=value||!getProfiles();
    }
    function show(next) {
      mode=next; $('comparisons-pane').hidden=true;$('nav-comparisons').removeAttribute('aria-current'); $('reports-pane').hidden=mode!=='reports';$('profiles-pane').hidden=mode==='reports';
      for(const name of ['reports','self','thinkers']){const b=$('nav-'+name);if(name===mode)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
      if(mode!=='reports')refresh();
    }
    function reportButton(id) {
      const r=reports().find(r=>r.id===id);
      return button(r?(r.title||r.originalName)+(r.trashed?' (çöp kutusunda)':''):'Rapor bulunamadı',()=>task(async()=>{await onOpenReport(id);show('reports');}));
    }
    function sourceNode(source) {
      const box=el('div',undefined,'source-reference');
      if(source.url){
        const a=el('a',source.label);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';box.append(a);
      } else box.append(el('span',source.label));
      if(source.reportId)box.append(reportButton(source.reportId));
      return box;
    }
    function showHistory(view) {
      const box=$('history-content');box.replaceChildren();if(onOpenTimeline)box.append(button('Görsel zaman çizelgesinde aç',()=>{$('history-dialog').close();onOpenTimeline(view.id);}));$('history-title').textContent=view.topic+' — Değişim kaydı';
      for(const [i,r] of [...view.revisions].reverse().entries()) {
        const section=el('section',undefined,'history-entry');
        section.append(el('h3',changes[r.changeType]+(i===0?' · Güncel sürüm':'')),el('p',new Date(r.at).toLocaleString('tr-TR'),'muted small'),el('p',(areas[r.area]?.[0]||r.area)+' · '+(kinds[r.kind]||r.kind),'eyebrow'),el('h4',r.topic),el('p',r.text,'multiline'));
        if(r.bridge)section.append(el('p','Yöntem–hedef bağlantısı: '+r.bridge,'multiline'));
        if(r.reason)section.append(el('p','Gerekçe: '+r.reason,'multiline'));
        const p=current();for(const id of r.sourceIds||[]){const s=p?.sources.find(s=>s.id===id);if(s)section.append(sourceNode(s));}
        for(const id of r.reportIds||[])section.append(reportButton(id));
        if(globalThis.ToreShareDraft)section.append(button('Bu sürümün paylaşma taslağını hazırla',()=>ToreShareDraft.preview(ToreShareDraft.view(current(),r))));
        box.append(section);
      }
      $('history-dialog').showModal();
    }
    function renderCard(view,p) {
      const card=el('section',undefined,'view-card');card.dataset.viewId=view.id;
      card.append(el('p',kinds[view.kind],'view-kind kind-'+view.kind),el('h4',view.topic),el('p',view.text,'multiline'));
      if(view.bridge){const bridge=el('div',undefined,'bridge');bridge.append(el('strong','Bugünkü yaklaşım → ideal'),el('p',view.bridge,'multiline'));card.append(bridge);}
      const sources=el('div',undefined,'view-source-list');
      for(const id of view.sourceIds){const source=p.sources.find(s=>s.id===id);if(source)sources.append(sourceNode(source));}
      for(const id of view.reportIds)sources.append(reportButton(id));
      if(sources.childNodes.length)card.append(sources);
      const actions=el('div',undefined,'card-actions');
      const edit=button('Düzenle',()=>openView(view));edit.dataset.editView=view.id;
      const history=button('Değişim kaydı ('+view.revisions.length+')',()=>showHistory(view));history.dataset.historyView=view.id;
      actions.append(edit,history);if(globalThis.ToreShareDraft){const share=button('Paylaşma taslağı hazırla',()=>ToreShareDraft.preview(ToreShareDraft.view(p,view.revisions.at(-1))));share.dataset.shareView=view.id;actions.append(share);}card.append(actions);return card;
    }
    function refresh() {
      const ready=!!getProfiles(),isSelf=mode==='self';
      $('profiles-title').textContent=isSelf?'Profilim':'Düşünür profilleri';
      $('profiles-description').textContent=isSelf?'Yalnızca sizin kaydettiğiniz görüşler. Rapor okumak veya bir kaynak eklemek, o görüşü benimsediğiniz anlamına gelmez.':'Kaynaklara dayanan, hazırlayanı belli düşünce derlemeleri.';
      $('profile-create-self').hidden=!isSelf||profiles().some(p=>p.kind==='self');
      $('profile-create-thinker').hidden=isSelf;$('template-section').hidden=isSelf;
      const rows=profiles().filter(p=>p.kind===(isSelf?'self':'thinker'));
      if(isSelf)currentId=rows[0]?.id||null;
      else {if(!rows.some(p=>p.id===thinkerId))thinkerId=rows[0]?.id||null;currentId=thinkerId;}
      const list=$('profile-list');list.replaceChildren();
      for(const p of rows){const b=button(p.name,()=>{thinkerId=p.id;refresh();});b.dataset.profileId=p.id;b.className=p.id===currentId?'selected':'';list.append(b);}
      $('templates').replaceChildren();
      for(const [i,t]of (globalThis.ToreThinkers||[]).entries()) {
        const box=el('div',undefined,'template-card');box.append(el('h4',t.name),el('p',t.bio,'small muted'));
        const details=el('details');details.append(el('summary','Kaynakları ve başlangıç görüşlerini gör'));
        for(const s of t.sources)details.append(sourceNode(s));for(const v of t.views)details.append(el('p',v.topic+': '+v.text,'small'));
        const b=button('Bu derlemeyi ekle',()=>task(async()=>{
          let p;
          try {
            p=await getProfiles().saveProfile({kind:'thinker',name:t.name,bio:t.bio,editor:t.editor,sources:t.sources});
            thinkerId=p.id;currentId=p.id;
            for(const v of t.views)await getProfiles().saveView(p.id,{...v,sourceIds:v.sourceIndexes.map(n=>p.sources[n].id),reportIds:[],reason:'Kaynaklı başlangıç derlemesi eklendi.',changeType:'initial'});
          }catch(e){if(p){refresh();message('Profil kaydedildi; başlangıç görüşleri tamamen eklenemedi. '+e.message,true);return;}throw e;}
          refresh();message(t.name+' derlemesi kaynaklarıyla diske kaydedildi.');
        }));b.dataset.thinkerIndex=String(i);box.append(details,b);$('templates').append(box);
      }
      const p=current();$('profile-current').hidden=!ready||!p;$('profile-empty').hidden=ready&&!!p;
      $('profile-empty').textContent=!ready?'Profilleri açmak için veri klasörünüzü seçin. Profil dosyası hatalıysa üstteki hata açıklamasını izleyin.':isSelf?'Henüz profiliniz yok. “Profilimi oluştur” ile başlayın. Görüşlerinizi siz ekleyeceksiniz.':'Henüz düşünür profili yok. Kaynaklarıyla yeni bir düşünür ekleyin veya başlangıç koleksiyonundan seçin.';
      if(p){
        $('profile-type').textContent=p.kind==='self'?'Kişisel profil · yerel':'Düşünür profili · kaynaklı derleme';
        $('profile-display-name').textContent=p.name;$('profile-display-bio').textContent=p.bio;
        $('profile-attribution').textContent=p.kind==='thinker'?'Derlemeyi hazırlayan: '+p.editor+' · Tarihsel kişinin kendi hesabı değildir.':'Bu profildeki ifadeler elle kaydedilir; raporlardan otomatik görüş çıkarılmaz.';
        $('profile-display-sources').replaceChildren();for(const s of p.sources)$('profile-display-sources').append(sourceNode(s));
        if(!p.sources.length)$('profile-display-sources').append(el('p','Henüz kaynak eklenmedi.','muted small'));
        $('profile-columns').replaceChildren();
        for(const [area,[name,description]]of Object.entries(areas)){
          const section=el('section',undefined,'profile-area');section.dataset.area=area;section.append(el('h3',name),el('p',description,'muted small'));
          const views=p.views.filter(v=>v.area===area).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
          for(const v of views)section.append(renderCard(v,p));
          if(!views.length)section.append(el('p','Bu alana henüz bir kayıt eklenmedi.','empty small'));
          const add=button('Bu alana ekle',()=>openView(null,area));section.append(add);$('profile-columns').append(section);
        }
      }
      syncDisabled(disabled);
    }
    function sourceRow(source={}) {
      const row=el('div',undefined,'source-row');if(source.id)row.dataset.sourceId=source.id;
      const label=el('label','Kaynağın adı');const name=el('input');name.dataset.field='label';name.value=source.label||'';name.maxLength=300;label.append(name);
      const link=el('label','Kaynak bağlantısı');const url=el('input');url.dataset.field='url';url.value=source.url||'';url.type='url';url.placeholder='https://…';link.append(url);
      const reportLabel=el('label','Veya arşivdeki rapor');const select=el('select');select.dataset.field='reportId';select.append(new Option('Rapor seçilmedi',''));
      for(const r of reports())select.append(new Option((r.title||r.originalName)+(r.trashed?' (çöp kutusunda)':''),r.id));select.value=source.reportId||'';reportLabel.append(select);
      row.append(label,link,reportLabel,button('Bu kaynak satırını kaldır',()=>row.remove()));$('profile-source-rows').append(row);
    }
    function openProfile(kind,p=null) {
      $('profile-form').reset();$('profile-id').value=p?.id||'';$('profile-kind').value=kind;
      $('profile-dialog-title').textContent=p?'Profili düzenle':kind==='self'?'Profilimi oluştur':'Düşünür ekle';
      $('profile-name').value=p?.name||'';$('profile-bio').value=p?.bio||'';$('profile-editor').value=p?.editor||'';
      $('profile-editor-label').hidden=kind==='self';$('profile-editor-note').hidden=kind==='self';$('profile-editor').required=kind==='thinker';
      $('profile-source-rows').replaceChildren();for(const s of p?.sources||[])sourceRow(s);if(kind==='thinker'&&!p?.sources.length)sourceRow();
      $('profile-form-error').textContent='';$('profile-dialog').showModal();
    }
    function checklist(host,options,chosen) {
      host.replaceChildren();
      for(const [id,label]of options){const l=el('label',undefined,'check-option');const c=el('input');c.type='checkbox';c.value=id;c.checked=chosen.includes(id);l.append(c,document.createTextNode(label));host.append(l);}
      if(!options.length)host.append(el('p',host.id==='view-sources'?'Önce “Profili düzenle” bölümünden kaynak ekleyebilirsiniz.':'Henüz arşiv raporu yok. Rapor yüklemek isteğe bağlıdır.','muted small'));
    }
    function openView(view=null,area='present') {
      const p=current();if(!p)return;
      $('view-form').reset();$('view-profile').value=p.id;$('view-id').value=view?.id||'';
      $('view-dialog-title').textContent=view?'Görüşü düzenle':'Görüş ekle';
      $('view-topic').value=view?.topic||'';$('view-area').value=view?.area||area;$('view-kind').value=view?.kind||'position';
      $('view-text').value=view?.text||'';$('view-bridge').value=view?.bridge||'';
      checklist($('view-sources'),p.sources.map(s=>[s.id,s.label]),view?.sourceIds||[]);
      checklist($('view-reports'),reports().map(r=>[r.id,(r.title||r.originalName)+(r.trashed?' (çöp kutusunda)':'')]),view?.reportIds||[]);
      $('view-change-fields').hidden=!view;$('view-reason').required=!!view;$('view-form-error').textContent='';$('view-dialog').showModal();
    }
    for(const name of ['reports','self','thinkers'])$('nav-'+name).addEventListener('click',()=>{if(!disabled)show(name);});
    $('profile-create-self').addEventListener('click',()=>openProfile('self'));
    $('profile-create-thinker').addEventListener('click',()=>openProfile('thinker'));
    $('profile-edit').addEventListener('click',()=>openProfile(current().kind,current()));
    $('view-add').addEventListener('click',()=>openView());$('source-add').addEventListener('click',()=>sourceRow());
    for(const [dialog,close]of [['profile-dialog','profile-dialog-close'],['view-dialog','view-dialog-close'],['history-dialog','history-close']])$(close).addEventListener('click',()=>$(dialog).close());
    $('profile-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{
      $('profile-form-error').textContent='';
      try{
        const sources=[...$('profile-source-rows').children].map(row=>({...(row.dataset.sourceId?{id:row.dataset.sourceId}:{}),label:row.querySelector('[data-field=label]').value.trim(),url:row.querySelector('[data-field=url]').value.trim(),reportId:row.querySelector('[data-field=reportId]').value}));
        const p=await getProfiles().saveProfile({id:$('profile-id').value||undefined,kind:$('profile-kind').value,name:$('profile-name').value,bio:$('profile-bio').value,editor:$('profile-editor').value,sources});
        if(p.kind==='thinker')thinkerId=p.id;currentId=p.id;$('profile-dialog').close();refresh();message('Profil kaynaklarıyla diske kaydedildi.');
      }catch(e){$('profile-form-error').textContent=e.message;throw e;}
    });});
    $('view-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{
      $('view-form-error').textContent='';
      try{
        await getProfiles().saveView($('view-profile').value,{id:$('view-id').value||undefined,topic:$('view-topic').value,area:$('view-area').value,kind:$('view-kind').value,text:$('view-text').value,bridge:$('view-bridge').value,sourceIds:[...$('view-sources').querySelectorAll('input:checked')].map(c=>c.value),reportIds:[...$('view-reports').querySelectorAll('input:checked')].map(c=>c.value),reason:$('view-reason').value,changeType:$('view-id').value?$('view-change-type').value:'initial'});
        $('view-dialog').close();refresh();message('Görüş diske kaydedildi. Önceki sürümler değişim kaydında korunuyor.');
      }catch(e){$('view-form-error').textContent=e.message;throw e;}
    });});
    refresh();return {refresh,show,syncDisabled};
  };
})();
