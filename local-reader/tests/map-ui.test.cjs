'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {loadI18n,languageStore,languageOp,UI_OPS}=require('./i18n-helpers.cjs');
const web=path.resolve(__dirname,'../../web'),token='e'.repeat(64);
const catalog={version:1,method:'SENTETİK yöntem',methodEn:'SYNTHETIC method',
 sections:[{id:'insan',title:'İnsan <img src=x onerror=alert(1)>',titleEn:'Person',question:'Soru',questionEn:'Question'},{id:'toplum',title:'Toplum',titleEn:'Society',question:'Soru',questionEn:'Question'}],
 roles:[['premise','Ön kabul','Premise'],['position','Pozisyon','Position'],['divergence','Ayrılık','Divergence'],['change','Fikir değişimi','Change'],['objection','İtiraz','Objection'],['answer','Cevap','Answer'],['test','Yanlışlama ölçütü','Refutation'],['open_question','Açık soru','Open question']].map(([id,title,titleEn])=>({id,title,titleEn}))};
const rec=(id,text,extra={})=>({id,topicId:'t1',kind:'opinion',text,reason:'',attribution:'user_statement',review:'reviewed',adoption:'adopted',currency:'current',priority:'unspecified',questionState:'not_applicable',revision:1,updatedAt:'2026-01-02T00:00:00Z',source:{title:'SENTETİK konuşma',timestamp:'2026-01-01T00:00:00Z'},...extra});
const ent=(id,recordId,role,extra={})=>({id,recordId,section:'insan',role,parentId:null,counterpart:'',label:'',note:'',order:0,placement:'user',createdAt:'2026-01-0'+id.slice(-1),updatedAt:'x',...extra});
async function flush(){for(let i=0;i<14;i++)await new Promise(r=>setImmediate(r));}
function setup(t,opts={}){
 const records=opts.records||[rec('r1','SENTETİK pozisyon <b>kalın</b>'),rec('r2','SENTETİK itiraz',{attribution:'user_authored',adoption:'not_adopted'}),rec('r3','SENTETİK cevap'),rec('r4','SENTETİK bekleyen',{review:'pending',adoption:'unknown'}),rec('r5','SENTETİK yerleşmemiş'),rec('r6','SENTETİK düşünce deneyi',{adoption:'hypothesis'}),rec('r7','SENTETİK iş',{kind:'task'})];
 const entries=opts.entries||[ent('e1','r1','position',{label:'Başlık',counterpart:'SENTETİK gelenek',translationEn:{text:'SYNTHETIC position',by:'ai',label:'Heading'}}),ent('e2','r2','objection',{parentId:'e1'}),ent('e3','r3','answer',{parentId:'e2'}),ent('e4','r4','position',{section:'toplum',placement:'suggested'}),ent('e6','r6','position',{section:'toplum'})];
 const requests=[],downloads=[],fail=new Set(opts.failOps||[]),lang=languageStore(opts.uiLanguage??null);
 const html=fs.readFileSync(path.join(web,'map.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://127.0.0.1:18740/harita#local='+token});t.after(()=>dom.window.close());
 const w=dom.window;
 w.fetch=async(url,request)=>{
  assert.ok(url.startsWith('/api/private/tore/'));assert.equal(request.headers.Authorization,'Bearer '+token);
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});let data;
  const find=id=>records.find(r=>r.id===id);
  const ui=languageOp(lang,op,body);if(ui!==undefined)return{ok:true,status:200,json:async()=>ui};
  if(fail.has(op))return{ok:false,status:409,json:async()=>({error:opts.failMessage||'Konu deposu dışarıdan değişmiş; üzerine yazılmadı'})};
  if(op==='map')data={catalog,entries:entries.map(e=>({entry:e,record:find(e.recordId),thinkerIds:[]})),stateHash:'s'};
  else if(op==='records-list')data={topics:[{id:'t1',title:'SENTETİK konu'}],records};
  else if(op==='map-add'){assert.equal(body.confirmedByUser,true);const e=ent('e'+(entries.length+10),body.recordId,body.role,{section:body.section,parentId:body.parentId||null,label:body.label||''});entries.push(e);data={entry:e};}
  else if(op==='map-update'){assert.equal(body.confirmedByUser,true);const e=entries.find(x=>x.id===body.entryId);Object.assign(e,{section:body.section,label:body.label,counterpart:body.counterpart,note:body.note,translationEn:body.translationEn,placement:'user'});data={entry:e};}
  else if(op==='map-remove'){assert.equal(body.confirmedByUser,true);entries.splice(entries.findIndex(e=>e.id===body.entryId),1);data={removed:body.entryId};}
  else if(op==='records-create'){assert.equal(body.kind,'opinion');const r=rec('r'+(records.length+10),body.text,{attribution:'user_authored',review:'pending',adoption:'unknown'});records.push(r);data={record:r};}
  else if(op==='records-review'){assert.equal(body.confirmedByUser,true);assert.equal(body.expectedRevision,1);Object.assign(find(body.id),{review:body.review,adoption:body.adoption});data={record:find(body.id)};}
  else if(op==='map-export'){assert.equal(body.confirmedByUser,true);data={html:'<!doctype html><html lang="tr"><head><title>x</title><style>body{color:red}</style></head><body><h1>Düşünce haritam</h1><p class="notice">SENTETİK kapsam</p><section><h2>İnsan</h2><div class="e"><p class="role">Pozisyon</p><p class="text">SENTETİK dosya metni &lt;b&gt;kalın&lt;/b&gt;</p><img src="x" onerror="alert(1)"><script>window.__pwned=1</'+'script></div></section><section><h2>Toplum</h2></section></body></html>',entryCount:1,hash:'h',findings:[]};}
  else throw Error('beklenmeyen işlem '+op);
  return{ok:true,status:200,json:async()=>data};
 };
 if(!w.crypto.randomUUID)w.crypto.randomUUID=()=>'00000000-0000-4000-8000-000000000001';
 w.URL.createObjectURL=blob=>{downloads.push(blob);return'blob:x';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 loadI18n(w,['map'],{navigatorLanguage:opts.navigatorLanguage||'tr-TR'});
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
 w.eval(fs.readFileSync(path.join(web,'map.js'),'utf8').replace(/^import .*;\n/,''));
 const d=w.document,check=(el,on=true)=>{el.checked=on;el.dispatchEvent(new w.Event('change'));};
 const type=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event('input'));};
 const submit=form=>form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 const ops=()=>requests.map(r=>r.op).filter(o=>!['map','records-list'].includes(o)&&!UI_OPS.has(o));
 return{w,d,requests,entries,records,downloads,check,type,submit,ops,lang};
}

test('üst menü dört bağlantıyı taşır; Düşünürler Haritam altında; başlık menüdeki addır',async t=>{
 const {d}=setup(t);await flush();
 assert.equal(d.title,'töre — Haritam');
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']]);
 assert.equal(d.querySelector('.topbar nav [aria-current="true"]').textContent,'Haritam','liste Haritam altındadır');assert.equal(d.querySelectorAll('.topbar nav [aria-current]').length,1);
 assert.deepEqual([...d.querySelectorAll('.subnav a')].map(a=>[a.textContent,a.getAttribute('href'),a.getAttribute('aria-current')]),[['Tuval','/harita',null],['Liste','/harita/liste','page'],['Düşünürler','/dusunurler',null],['Aşılmış düşünceler','/asilmis',null]],'tuval, liste, Düşünürler ve aşılmışlar Haritam altından açılır');
 assert.equal(d.querySelector('.topbar .brand').getAttribute('href'),'/');
 assert.equal(d.querySelector('.topbar').textContent.includes('Görüşlerim'),false);
 assert.doesNotMatch(d.querySelector('.topbar').textContent,/\d+\.\d+\.\d+/,'üst menüde sürüm numarası yok');
 assert.equal(d.querySelector('.private-mark').textContent,'● Bu bilgisayarda');
 assert.equal(d.getElementById('map-title').textContent,'Haritam');
});

test('harita okur görünümünde kayıtları bölüm ve bağlarıyla, metni güvenli gösterir',async t=>{
 const {d,check}=setup(t);await flush();
 assert.equal(d.getElementById('entry-count').textContent,'5');assert.equal(d.getElementById('pending-count').textContent,'1');
 assert.equal(d.querySelector('#map-body img'),null);assert.equal(d.querySelector('#map-body b'),null,'kayıt metni HTML olarak işlenmemeli');
 const position=d.getElementById('entry-e1');
 assert.equal(position.querySelector('h3').textContent,'Başlık');
 assert.ok(position.querySelector('#entry-e2 #entry-e3'),'cevap itirazın, itiraz pozisyonun altında durur');
 assert.match(position.querySelector('.map-test-line').textContent,/1 itiraz · 1 cevaplandı · yanlışlama ölçütü yok/);
 assert.match(position.textContent,/Karşısındaki görüş: SENTETİK gelenek/);
 assert.match(position.querySelector(':scope > .map-meta:not(.map-record-link)').parentElement.textContent,/Senin sözün \(birebir\) · İncelendi · Benimsedim/);
 assert.match(d.getElementById('entry-e2').textContent,/Kendi notun · İncelendi · Benimsemedim/);
 assert.match(d.getElementById('entry-e4').textContent,/yeri AI önerisi/);
 assert.match(d.getElementById('entry-e4').textContent,/İnceleme bekliyor · Benimseme: Belirtilmedi/);
 assert.equal(d.getElementById('map-tools').hidden,true);assert.equal(d.querySelector('.map-edit'),null,'okur görünümünde düzenleme aracı yok');
 assert.equal(d.querySelector('.map-source'),null,'konuşma başlığı okur görünümünde yok');
 check(d.getElementById('show-pending'),false);
 assert.equal(d.getElementById('entry-e4'),null,'bekleyen kayıt süzülür');
 check(d.getElementById('show-pending'));check(d.getElementById('show-suggested'),false);
 assert.equal(d.getElementById('entry-e4'),null,'yeri önerilen kayıt süzülür');
});

test('her kayıt Konularım\'daki kaydına bağlanır; hipotez ayırt edilir; yalnız benimsenenler süzülebilir',async t=>{
 const {d,check}=setup(t);await flush();
 const link=d.querySelector('#entry-e1 > .map-record-link a');
 assert.equal(link.textContent,'Konularım\'da aç');assert.equal(link.getAttribute('href'),'/konular?view=overview&topicId=t1&recordId=r1');
 assert.equal(d.querySelectorAll('.map-record-link a').length,5,'her kayıtta dönüş bağlantısı');
 const hypo=d.getElementById('entry-e6');
 assert.equal(hypo.dataset.adoption,'hypothesis');assert.equal(hypo.querySelector('.map-hypothesis').textContent,'Hipotez / düşünce deneyi');
 assert.equal(d.querySelector('#entry-e1 > .map-hypothesis'),null,'benimsenen kayıt hipotez diye işaretlenmez');
 const only=d.getElementById('show-adopted');assert.equal(only.checked,false);
 assert.equal(d.getElementById('show-adopted-label').textContent,'Yalnız benimsediklerimi göster');
 assert.ok(d.getElementById('show-pending').closest('label').nextElementSibling.contains(only),'süzgeç, inceleme bekleyenler süzgecinin yanında');
 check(only);
 assert.ok(d.getElementById('entry-e1'));assert.ok(d.getElementById('entry-e3'),'benimsenen cevap üst düzeye çıkar');
 for(const id of ['entry-e2','entry-e4','entry-e6'])assert.equal(d.getElementById(id),null,id+' benimsenmedi; süzülür');
 check(only,false);assert.ok(d.getElementById('entry-e6'));
 // The map's content toggle shows translations; the interface stays in the interface language.
 d.getElementById('lang-en').click();
 assert.equal(d.querySelector('#entry-e6 .map-hypothesis').textContent,'Hipotez / düşünce deneyi');assert.equal(d.getElementById('show-adopted-label').textContent,'Yalnız benimsediklerimi göster');
});

test('içeriğin İngilizcesi çeviriyi AI çevirisi olarak işaretler ve özgün metni korur; arayüz Türkçe kalır',async t=>{
 const {d}=setup(t);await flush();
 assert.equal(d.getElementById('lang-tr').getAttribute('aria-pressed'),'true','içerik varsayılan olarak arayüz dilinde');
 d.getElementById('lang-en').click();
 assert.equal(d.documentElement.lang,'tr','sayfa dili arayüz dilini izler');assert.equal(d.getElementById('map-title').textContent,'Haritam');
 assert.equal(d.getElementById('content-lang-label').textContent,'Harita içeriğinin dili');assert.equal(d.querySelector('.map-switch[aria-labelledby="content-lang-label"]').contains(d.getElementById('lang-en')),true);
 const position=d.getElementById('entry-e1');
 assert.equal(position.querySelector('.map-text').textContent,'SYNTHETIC position');assert.equal(position.querySelector('.map-text').lang,'en');assert.equal(position.querySelector('h3').textContent,'Heading');
 assert.match(position.textContent,/AI çevirisi; sahibi incelemedi/);
 assert.equal(position.querySelector('.map-original').textContent,'SENTETİK pozisyon <b>kalın</b>');
 assert.match(d.getElementById('entry-e2').textContent,/Çevrilmedi/);
 assert.equal(d.querySelector('#section-insan h2').textContent,'Person');assert.equal(d.querySelector('#section-insan h2').lang,'en');
});

test('boş harita ne işe yaradığını, şimdi ne yapılacağını ve sonrasını söyler',async t=>{
 const none=setup(t,{records:[],entries:[]});await flush();
 const box=none.d.querySelector('#map-body .map-empty');
 assert.match(box.textContent,/Haritam, defterindeki kayıtları bölümlere yerleştirip/);
 const go=box.querySelector('a');assert.equal(go.getAttribute('href'),'/konular');assert.equal(go.textContent,'Konularım\'a git');
 assert.equal(box.querySelectorAll('a,button').length,1,'tek birincil eylem');assert.match(box.textContent,/Sonra buraya dönüp/);
 none.d.getElementById('mode-edit').click();
 assert.equal(none.d.getElementById('add-search-count').querySelector('a').getAttribute('href'),'/konular','düzenle kipinde de çıkmaz sokak yok');
 const some=setup(t,{records:[rec('r1','SENTETİK tek kayıt')],entries:[]});await flush();
 const start=some.d.querySelector('#map-body .map-empty button');
 assert.equal(start.textContent,'İlk kaydı yerleştir');assert.equal(some.d.querySelector('#map-body .map-empty a'),null);
 start.click();
 assert.equal(some.d.getElementById('map-tools').hidden,false);assert.equal(some.d.activeElement,some.d.getElementById('add-search'),'odak kayıt aramasına gider');
});

test('düzenleme: inceleme ve dışa aktarım onaylı; çıkarma, yerleşim ve kendi notu tek tık',async t=>{
 const {d,entries,records,downloads,check,type,submit,ops}=setup(t);await flush();
 d.getElementById('mode-edit').click();
 assert.equal(d.getElementById('map-tools').hidden,false);
 assert.match(d.getElementById('entry-e1').querySelector('.map-source').textContent,/Kaynak: SENTETİK konuşma/);
 assert.equal(d.querySelector('#map-body h4'),null,'araç başlıkları başlık düzeyi atlamaz');
 const tools=d.querySelector('[data-tools="e4"]'),adopt=tools.querySelector('[data-review="adopted"]'),reject=tools.querySelector('[data-review="not_adopted"]');
 tools.open=true;
 assert.equal(adopt.disabled,true,'onaysız benimseme yok');assert.equal(reject.disabled,true,'onaysız reddetme yok');
 check(tools.querySelector('input[type=checkbox]'));adopt.click();await flush();
 assert.equal(records.find(r=>r.id==='r4').adoption,'adopted');
 const reopened=d.querySelector('[data-tools="e4"]');
 assert.equal(reopened.open,true,'açık araç kutusu açık kalır');
 const note=reopened.querySelector('[role=status]');assert.equal(note.textContent,'Kayıt incelendi: Benimsedim.');
 assert.equal(d.activeElement,reopened.querySelector('summary'),'odak işlem yapılan kayıtta kalır');
 assert.equal(d.getElementById('page-status').textContent,'Harita hazır.','bildirim sayfa tepesine taşınmaz');
 const place=d.querySelector('form[data-place="e4"]'),save=place.querySelector('button[type=submit]');
 assert.equal(place.querySelector('input[type=checkbox]'),null,'yerleşim için onay kutusu yok');assert.equal(save.disabled,false);
 place.querySelector('input').value=' Yeni başlık ';submit(place);await flush();
 assert.equal(entries.find(e=>e.id==='e4').label,'Yeni başlık');assert.equal(entries.find(e=>e.id==='e4').placement,'user');
 assert.equal(d.querySelector('[data-tools="e4"] [role=status]').textContent,'Yerleşim kaydedildi.');
 const child=d.querySelector('form[data-child-of="e1"]'),write=child.querySelector('button[type=submit]');
 assert.equal(child.querySelector('input[type=checkbox]'),null,'kendi notun için onay kutusu yok');
 child.querySelector('select').value='test';assert.equal(write.disabled,true,'boş metin yazılmaz');
 type(child.querySelector('textarea'),'SENTETİK ölçüt');assert.equal(write.disabled,false);
 submit(child);await flush();
 const added=entries.at(-1);assert.equal(added.role,'test');assert.equal(added.parentId,'e1');
 assert.match(d.getElementById('entry-e1').querySelector('.map-test-line').textContent,/yanlışlama ölçütü var/);
 assert.equal(d.activeElement,d.getElementById('entry-'+added.id),'odak yeni kayda gider');assert.match(d.activeElement.querySelector('[role=status]').textContent,/yazıldı ve bağlandı/);
 const remove=d.querySelector('[data-remove="e3"]');
 assert.equal(remove.disabled,false,'haritadan çıkarma tek tık');assert.equal(remove.closest('.actions').querySelector('input[type=checkbox]'),null);
 remove.click();await flush();
 assert.equal(entries.some(e=>e.id==='e3'),false);
 assert.match(d.getElementById('entry-e2').querySelector(':scope > [role=status]').textContent,/haritadan çıkarıldı; defterinde duruyor/);
 assert.equal(d.activeElement,d.getElementById('entry-e2'),'odak çıkarılan kaydın üst kaydına gider');
 assert.equal(d.getElementById('export-preview-panel').hidden,true);assert.equal(d.getElementById('export-save').disabled,true);
 assert.deepEqual(ops(),['records-review','map-update','records-create','map-add','map-remove']);
 assert.deepEqual(downloads,[]);
});

test('kayıt seçimi aranabilir: metin kutusu listeyi süzer, iş kayıtları önerilmez',async t=>{
 const {d,entries,check,type,submit,ops}=setup(t);await flush();
 d.getElementById('mode-edit').click();
 assert.equal(d.querySelector('#add-form select#add-record'),null,'uzun açılır liste yok');
 const options=()=>[...d.querySelectorAll('#add-record input[type=radio]')].map(i=>i.value);
 assert.deepEqual(options(),['r5'],'haritadaki kayıtlar ve işler önerilmez');
 assert.match(d.getElementById('add-search-count').textContent,/1 kayıttan 1 tanesi uyuyor/);
 type(d.getElementById('add-search'),'yok böyle bir şey');assert.deepEqual(options(),[]);assert.match(d.getElementById('add-search-count').textContent,/Aramana uyan kayıt yok/);
 type(d.getElementById('add-search'),'YERLEŞMEMİŞ');assert.deepEqual(options(),['r5'],'arama büyük küçük harfe bakmaz');
 assert.equal(d.querySelector('#add-record img'),null);
 check(d.getElementById('add-consent'));assert.equal(d.getElementById('add-save').disabled,true,'kayıt seçilmeden eklenmez');
 const radio=d.querySelector('#add-record input[type=radio]');radio.checked=true;radio.dispatchEvent(new d.defaultView.Event('change'));
 assert.equal(d.getElementById('add-save').disabled,false);
 check(d.getElementById('add-consent'),false);assert.equal(d.getElementById('add-save').disabled,true,'haritaya ekleme onaylı kalır');check(d.getElementById('add-consent'));
 submit(d.getElementById('add-form'));await flush();
 const added=entries.find(e=>e.recordId==='r5');assert.ok(added);
 assert.match(d.getElementById('add-result').textContent,/Kayıt haritaya eklendi/);assert.equal(d.getElementById('add-result').querySelector('a').getAttribute('href'),'#entry-'+added.id);
 assert.equal(d.activeElement,d.getElementById('add-search'),'odak ekleme formunda kalır');
 assert.equal(d.getElementById('add-consent').checked,false);assert.deepEqual(options(),[]);assert.match(d.getElementById('add-search-count').textContent,/bütün kayıtlar haritada/);
 assert.deepEqual(ops(),['map-add']);
});

test('dışa aktarım önce önizleme gösterir; dosya ancak içerik görüldükten sonra iner',async t=>{
 const {w,d,requests,downloads,check,submit,ops}=setup(t);await flush();
 d.getElementById('mode-edit').click();
 assert.equal(d.querySelector('#export-form iframe'),null,'önizleme istenmeden çerçeve yok');
 submit(d.getElementById('export-form'));await flush();
 assert.deepEqual(downloads,[],'önizleme dosya indirmez');
 const panel=d.getElementById('export-preview-panel');assert.equal(panel.hidden,false);
 assert.match(d.getElementById('export-summary').textContent,/1 kayıt dosyaya girecek · 2 bölüm: İnsan, Toplum\./);
 const body=d.getElementById('export-preview-body'),frames=body.querySelectorAll('iframe');
 assert.equal(frames.length,1,'dosya tek bir çerçevede gösterilir');const frame=frames[0];
 assert.equal(frame.getAttribute('sandbox'),'','çerçeve kum havuzunda: betik ve aynı köken izni yok');
 assert.ok(frame.getAttribute('srcdoc').startsWith('<!doctype html>'),'dosyanın kendisi srcdoc ile verilir');assert.equal(frame.hasAttribute('src'),false);
 assert.match(frame.srcdoc,/SENTETİK dosya metni &lt;b&gt;kalın&lt;\/b&gt;/);assert.match(frame.srcdoc,/SENTETİK kapsam/);
 assert.ok(frame.title,'çerçevenin erişilebilir adı var');
 assert.equal(body.querySelector('script,style,img,b,[onerror]'),null,'sayfaya işaretleme olarak hiçbir şey eklenmez');assert.equal(d.querySelector('#export-preview-panel script,#export-preview-panel img'),null);assert.equal(w.__pwned,undefined);
 assert.equal(d.activeElement,d.getElementById('export-preview-heading'));
 const save=d.getElementById('export-save');assert.equal(save.disabled,true,'içeriği gördüm demeden inmez');save.click();assert.deepEqual(downloads,[]);
 check(d.getElementById('export-pending'));assert.equal(panel.hidden,true,'seçim değişince önizleme geçersizleşir');assert.match(d.getElementById('export-result').textContent,/yeniden hazırla/);
 submit(d.getElementById('export-form'));await flush();assert.equal(requests.at(-1).body.includePending,true);
 check(d.getElementById('export-consent'));assert.equal(save.disabled,false);save.click();
 assert.ok(downloads.includes('dusunce-haritam.html'));assert.match(d.getElementById('export-result').textContent,/Dosya bu bilgisayara indi/);
 assert.equal(save.disabled,true);assert.deepEqual(ops(),['map-export','map-export']);
});

test('hata, onu doğuran düğmenin yanında ve anlaşılır dille görünür; odak düğmede kalır',async t=>{
 const {d,entries,ops}=setup(t,{failOps:['map-remove','map-export']});await flush();
 d.getElementById('mode-edit').click();
 const tools=d.querySelector('[data-tools="e3"]');tools.open=true;const remove=tools.querySelector('[data-remove="e3"]');
 remove.click();await flush();
 assert.ok(entries.some(e=>e.id==='e3'));
 const alert=remove.closest('.actions').nextElementSibling;
 assert.equal(alert.getAttribute('role'),'alert');assert.equal(alert.textContent,'Defter başka bir pencerede değişti. Sayfayı yenile; yazdıkların kaybolmadı.');
 assert.equal(d.getElementById('page-error').hidden,true,'hata sayfa tepesine yazılmaz');
 assert.equal(remove.disabled,false);assert.equal(d.activeElement,remove);assert.equal(d.querySelector('[data-tools="e3"]').open,true);
 d.getElementById('export-form').dispatchEvent(new d.defaultView.Event('submit',{cancelable:true}));await flush();
 assert.equal(d.getElementById('export-error').hidden,false);assert.match(d.getElementById('export-error').textContent,/Defter başka bir pencerede değişti/);
 assert.equal(d.getElementById('export-preview-panel').hidden,true);assert.deepEqual(ops(),['map-remove','map-export']);
});

test('harita stili uzun dizgiyi kırar, satırı kısaltır ve kâğıda yalnız haritayı çıkarır',()=>{
 const css=fs.readFileSync(path.join(web,'map.css'),'utf8');
 for(const sel of ['.map-text','.map-meta','.map-original'])assert.match(css,new RegExp(sel.replace('.','\\.')+'\\{[^}]*overflow-wrap:anywhere[^}]*max-width:70ch'),sel);
 const print=css.slice(css.indexOf('@media print'));
 for(const sel of ['.map-source','.map-edit','#map-tools','.map-toolbar','.map-record-link','.topbar','footer'])assert.ok(print.split('{')[1].includes(sel),sel+' yazdırmada gizli');
 assert.match(print,/\.map-entry\{break-inside:avoid\}/);assert.match(css,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(css,/url\(|@import|http/);
});

test('İngilizce arayüz: menü, başlık, süzgeçler, kayıt satırları ve içerik İngilizce; lang="en"',async t=>{
 const {d,w}=setup(t,{navigatorLanguage:'en-US'});await flush();
 assert.equal(d.documentElement.lang,'en');assert.equal(d.title,'töre — My map');
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>a.textContent),['Topics','Waiting for you','My map','Conversations']);
 assert.deepEqual([...d.querySelectorAll('.subnav a')].map(a=>a.textContent),['Canvas','List','Thinkers','Surpassed thoughts']);
 assert.equal(d.querySelector('.private-mark').textContent,'● On this computer');
 assert.equal(d.getElementById('map-title').textContent,'My map');assert.equal(d.getElementById('page-status').textContent,'The map is ready.');
 assert.equal(d.getElementById('entry-count-label').textContent,'records on the map');assert.equal(d.getElementById('pending-count-label').textContent,'pending review');
 assert.equal(d.getElementById('show-adopted-label').textContent,'Show only what I adopted');assert.equal(d.getElementById('content-lang-label').textContent,'Language of the map\'s content');
 assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');
 // The content toggle starts in the interface language: English translations where they exist.
 assert.equal(d.getElementById('lang-en').getAttribute('aria-pressed'),'true');
 const position=d.getElementById('entry-e1');
 assert.equal(position.querySelector('.map-text').textContent,'SYNTHETIC position');assert.match(position.textContent,/AI translation, not reviewed by its author/);
 assert.match(position.textContent,/Opposing view: SENTETİK gelenek/);assert.match(position.textContent,/Your words \(verbatim\) · Reviewed · Adopted/);
 assert.match(position.querySelector('.map-test-line').textContent,/^Tested: 1 objection · 1 answered · refutation criterion not stated$/);
 assert.match(d.getElementById('entry-e2').textContent,/Not translated\. Original:/);
 assert.match(d.getElementById('entry-e4').textContent,/Its place on the map is an AI suggestion/);assert.match(d.getElementById('entry-e4').textContent,/Pending review · Adoption: not stated/);
 assert.equal(d.querySelector('#entry-e6 .map-hypothesis').textContent,'Hypothesis / thought experiment');
 assert.equal(d.querySelector('#entry-e1 > .map-record-link a').textContent,'Open in Topics');
 assert.equal(d.querySelector('#section-insan h2').textContent,'Person');assert.equal(d.querySelector('#section-insan h2').hasAttribute('lang'),false);
 // Editing shows originals with the interface (and the form labels) in English.
 d.getElementById('mode-edit').click();
 assert.equal(d.getElementById('lang-tr').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('#entry-e1 .map-text').textContent,'SENTETİK pozisyon <b>kalın</b>');
 assert.equal(d.querySelector('#map-tools h2').textContent,'Add a record to the map');assert.equal(d.querySelector('#section-insan h2').textContent,'Person','düzenlerken yapı arayüz dilinde');
 assert.deepEqual([...d.getElementById('add-section').options].map(o=>o.textContent),['Person','Society']);
 assert.match(d.getElementById('add-search-count').textContent,/^1 of 1 records matches\.$/);
 assert.equal(d.querySelector('[data-tools="e1"] summary').textContent,'Tools for this record');
 const empty=setup(t,{navigatorLanguage:'en-US',records:[],entries:[]});await flush();
 assert.match(empty.d.querySelector('#map-body .map-empty').textContent,/My map is where you place records/);assert.equal(empty.d.querySelector('#map-body .map-empty a').textContent,'Go to Topics');
 const saved=setup(t,{navigatorLanguage:'tr-TR',uiLanguage:'en'});await flush();assert.equal(saved.d.documentElement.lang,'en','kayıtlı seçim tarayıcı dilini geçer');assert.equal(saved.d.getElementById('map-title').textContent,'My map');
 assert.equal(w.document.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'false');
});

test('EN | TR anahtarı seçimi sunucuya yazar ve haritayı yerinde yeniden çizer; açık araç ve önizleme kalır',async t=>{
 const {d,lang,submit,ops}=setup(t);await flush();
 d.getElementById('mode-edit').click();const tools=d.querySelector('[data-tools="e1"]');tools.open=true;
 submit(d.getElementById('export-form'));await flush();assert.match(d.getElementById('export-summary').textContent,/^1 kayıt dosyaya girecek · 2 bölüm: İnsan, Toplum\.$/);
 d.querySelector('[data-ui-lang="en"]').click();await flush();
 assert.deepEqual(lang.sets,['en']);assert.equal(d.documentElement.lang,'en');
 assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'false');
 assert.equal(d.getElementById('map-title').textContent,'My map');assert.equal(d.getElementById('page-status').textContent,'The map is ready.');
 assert.equal(d.querySelector('[data-tools="e1"]').open,true,'açık araç kutusu açık kalır');assert.equal(d.querySelector('[data-tools="e1"] summary').textContent,'Tools for this record');
 assert.equal(d.getElementById('map-tools').hidden,false,'düzenleme kipi sürer');assert.equal(d.getElementById('lang-tr').getAttribute('aria-pressed'),'true','düzenlerken özgün metin');
 assert.equal(d.getElementById('export-preview-panel').hidden,false,'hazır önizleme kalır');assert.match(d.getElementById('export-summary').textContent,/^1 record will go into the file · 2 sections: İnsan, Toplum\.$/);
 assert.equal(d.querySelector('#export-preview-body iframe').title,'Preview of the file');
 d.querySelector('[data-ui-lang="tr"]').click();await flush();
 assert.deepEqual(lang.sets,['en','tr']);assert.equal(d.documentElement.lang,'tr');assert.equal(d.getElementById('map-title').textContent,'Haritam');assert.equal(d.querySelector('[data-tools="e1"] summary').textContent,'Bu kayıt için araçlar');
 assert.match(d.getElementById('export-summary').textContent,/^1 kayıt dosyaya girecek/);
 d.getElementById('mode-read').click();d.querySelector('[data-ui-lang="en"]').click();await flush();
 assert.equal(d.getElementById('lang-en').getAttribute('aria-pressed'),'true','okurken içerik yeni arayüz dilini izler');assert.equal(d.querySelector('#entry-e1 .map-text').textContent,'SYNTHETIC position');
 assert.deepEqual(ops(),['map-export']);
});
