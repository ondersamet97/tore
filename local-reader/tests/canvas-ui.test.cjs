'use strict';
// 0.18: the opening thought map canvas (web/canvas.html, canvas.js). SYNTHETIC data only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {loadI18n,languageStore,languageOp,UI_OPS}=require('./i18n-helpers.cjs');
const web=path.resolve(__dirname,'../../web'),token='c'.repeat(64);
const catalog={version:1,method:'SENTETİK yöntem',methodEn:'SYNTHETIC method',
 sections:[{id:'baslangic',title:'Başlangıç noktaları',titleEn:'Starting points',question:'Soru',questionEn:'Question'},{id:'insan',title:'İnsan <img src=x onerror=alert(1)>',titleEn:'Person',question:'İnsan sorusu',questionEn:'Person question'},{id:'toplum',title:'Toplum',titleEn:'Society',question:'Soru',questionEn:'Question'}],
 roles:[['premise','Ön kabul','Premise'],['position','Pozisyon','Position'],['divergence','Ayrılık','Divergence'],['change','Fikir değişimi','Change of view'],['objection','İtiraz','Objection'],['answer','Cevap','Answer'],['test','Yanlışlama ölçütü','What would refute it'],['open_question','Açık soru','Open question']].map(([id,title,titleEn])=>({id,title,titleEn}))};
const rec=(id,text,extra={})=>({id,topicId:'t1',kind:'opinion',text,reason:'',attribution:'user_statement',review:'reviewed',adoption:'adopted',currency:'current',priority:'unspecified',questionState:'not_applicable',revision:1,updatedAt:'2026-01-02T00:00:00Z',source:null,...extra});
const ent=(id,recordId,role,extra={})=>({id,recordId,section:'insan',role,parentId:null,counterpart:'',label:'',note:'',order:0,placement:'user',createdAt:'2026-01-01T00:00:0'+id.slice(-1)+'Z',updatedAt:'x',...extra});
const item=(entry,record,extra={})=>({entry,record,thinkerIds:[],lastDiscussedAt:null,predecessors:[],...extra});
async function flush(){for(let i=0;i<14;i++)await new Promise(r=>setImmediate(r));}
function sample(){
 const src={excerpt:'SENTETİK: emek anlam verir.',title:'SENTETİK konuşma',timestamp:'2026-03-04T10:00:00Z',conversationId:'c1',role:'user'};
 return [
  item(ent('e1','r1','position',{order:2}),rec('r1','SENTETİK pozisyon <b>kalın</b>',{reason:'SENTETİK gerekçe',source:src}),{thinkerIds:['marx'],lastDiscussedAt:'2026-03-04T10:00:00Z',predecessors:[
   {id:'old2',kind:'opinion',text:'SENTETİK en eski düşünce',reason:'',depth:2,via:'old1',supersededAt:'2026-01-01T00:00:00Z',supersessionReason:'SENTETİK eski neden',source:null},
   {id:'old1',kind:'opinion',text:'SENTETİK önceki düşünce',reason:'',depth:1,via:'r1',supersededAt:'2026-02-01T00:00:00Z',supersessionReason:'SENTETİK neden',source:null}]}),
  item(ent('e2','r2','objection',{parentId:'e1',order:3}),rec('r2','SENTETİK itiraz',{attribution:'user_interpretation',adoption:'not_adopted'})),
  item(ent('e3','r3','open_question',{parentId:'e1',order:1}),rec('r3','SENTETİK açık soru?',{kind:'question',adoption:'not_applicable',questionState:'open'})),
  item(ent('e4','r4','change',{parentId:'e1',order:0}),rec('r4','SENTETİK değişim',{adoption:'hypothesis'})),
  item(ent('e5','r5','position',{order:1,placement:'suggested'}),rec('r5','SENTETİK önerilen yer',{attribution:'assistant_proposal',review:'pending',adoption:'unknown'})),
  item(ent('e6','r6','position',{section:'toplum'}),rec('r6','SENTETİK reddedilen',{review:'rejected'})),
  item(ent('e7','r7','premise',{section:'baslangic'}),rec('r7','SENTETİK ön kabul'))
 ];
}
function setup(t,opts={}){
 const entries=opts.entries||sample(),lang=languageStore(opts.uiLanguage??null),requests=[];
 const html=fs.readFileSync(path.join(web,'canvas.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://127.0.0.1:18740/'+(opts.hash||'#local='+token)});t.after(()=>dom.window.close());
 const w=dom.window;if(opts.hash)w.sessionStorage.setItem('tore-local-session',token);
 w.fetch=async(url,request)=>{
  assert.ok(url.startsWith('/api/private/tore/'));assert.equal(request.headers.Authorization,'Bearer '+token);
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push(op);
  const ui=languageOp(lang,op,body);if(ui!==undefined)return{ok:true,status:200,json:async()=>ui};
  let data;
  if(op==='map')data={catalog,entries:structuredClone(entries),lastDiscussedEntryId:opts.lastId===undefined?'e1':opts.lastId,stateHash:'s'};
  else if(op==='thinkers')data={catalog:{thinkers:[{id:'marx',name:'Karl Marx'}]},links:[]};
  else throw Error('beklenmeyen işlem '+op);
  return{ok:true,status:200,json:async()=>data};
 };
 loadI18n(w,['canvas'],{navigatorLanguage:'tr-TR'});
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
 w.eval(fs.readFileSync(path.join(web,'canvas.js'),'utf8').replace(/^import .*;\n/,''));
 const d=w.document,key=(el,k)=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
 return {w,d,requests,lang,key,$:id=>d.getElementById(id)};
}

test('tuval yalnız okur; menü, marka ve alt gezinme tuvali gösterir',async t=>{
 const {d,requests}=setup(t);await flush();
 assert.deepEqual([...new Set(requests.filter(o=>!UI_OPS.has(o)))].sort(),['map','thinkers'],'yalnız okuma işlemleri');
 assert.equal(d.querySelector('.topbar .brand').getAttribute('href'),'/');
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']]);
 assert.equal(d.querySelector('.topbar nav [aria-current="page"]').textContent,'Haritam');
 assert.deepEqual([...d.querySelectorAll('.subnav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Tuval','/harita'],['Liste','/harita/liste'],['Düşünürler','/dusunurler'],['Aşılmış düşünceler','/asilmis']]);
});

test('ağaç: kök, kaydı olan bölümler, sıraya göre çocuklar; reddedilen ve aşılan yok; metin metin olarak',async t=>{
 const {d,$,w}=setup(t);await flush();
 assert.equal(w.__pwned,undefined);assert.equal(d.querySelector('#nodes img'),null,'HTML çizilmez');
 const ids=[...d.querySelectorAll('.cnode')].map(n=>n.dataset.id);
 assert.deepEqual(ids,['root','section:baslangic','e7','section:insan','e5','e1','e4','e3','e2'],'önce bölüm sırası, sonra entry.order');
 assert.equal($('node-e6'),null,'reddedilen kayıt haritada yok');
 assert.equal($('node-e1').querySelector('.cnode-text').textContent,'SENTETİK pozisyon <b>kalın</b>');
 assert.equal(d.querySelectorAll('.edges path').length,ids.length-1);
 assert.ok($('node-e5').classList.contains('is-tentative'),'önerilen yer kesik çizgili');assert.ok($('node-e4').classList.contains('is-tentative'),'hipotez de');
 assert.ok(!$('node-e1').classList.contains('is-tentative'));
 assert.equal($('node-e2').dataset.role,'objection');assert.ok(d.querySelector('.edges path.objection'));assert.ok(d.querySelector('.edges path.tentative'));
 assert.ok($('node-e1').querySelector('.ring'),'aşılmış öncülü olan düşüncede halka');assert.equal($('node-e2').querySelector('.ring'),null);
 assert.equal($('node-e1').querySelector('.last-mark').textContent,'en son konuşulan');
 const chip=$('node-e1').querySelector('a.chip');assert.equal(chip.textContent,'Karl Marx');assert.equal(chip.getAttribute('href'),'/dusunurler#thinker-marx');
 assert.equal($('node-e1').tabIndex,0);assert.equal(chip.tabIndex,-1,'Sekme düğümler arasında dolaşır');
 assert.match($('page-status').textContent,/6 düşünce haritada/);
 for(const top of ['e1','e5'])assert.ok(/\d+px/.test($('node-'+top).style.left));
});

test('düşünceye tıklayınca panel: ses, neden, birebir alıntı, nereden geldim, kapalı miras, düşünürler',async t=>{
 const {d,$,w}=setup(t);await flush();
 $('node-e1').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 const panel=$('panel');assert.equal(panel.hidden,false);assert.ok($('node-e1').classList.contains('is-selected'));
 assert.match(panel.querySelector('.eyebrow').textContent,/Pozisyon · Görüş · Benimsedim/);
 assert.equal(panel.querySelector('.p-voice.is-own .p-voice-label').textContent,'Senin sözün');
 assert.equal(panel.querySelector('.p-text').textContent,'SENTETİK pozisyon <b>kalın</b>');
 const why=[...panel.querySelectorAll('.p-section')].find(s=>s.querySelector('h3').textContent==='Neden benimsedim');assert.ok(why);
 assert.equal(why.querySelector('.p-reason').textContent,'SENTETİK gerekçe');
 assert.equal(why.querySelector('blockquote.voice-source').textContent,'SENTETİK: emek anlam verir.');
 assert.match(why.querySelector('figcaption').textContent,/^SENTETİK konuşma · /);
 const from=[...panel.querySelectorAll('.p-section')].find(s=>s.querySelector('h3').textContent==='Nereden geldim');
 assert.deepEqual([...from.querySelectorAll('button')].map(b=>b.textContent),['Haritam','İnsan <img src=x onerror=alert(1)>']);
 const details=panel.querySelector('details.p-lineage');assert.equal(details.open,false,'miras kapalı başlar');
 assert.deepEqual([...details.querySelectorAll('li')].map(li=>[li.dataset.depth,li.querySelector('.p-lineage-text').textContent]),[['1','SENTETİK önceki düşünce'],['2','SENTETİK en eski düşünce']],'en yakını önce, derinliğe göre girintili');
 assert.match(details.querySelector('summary').textContent,/\(2\)/);
 assert.equal(panel.querySelector('.p-chips a').getAttribute('href'),'/dusunurler#thinker-marx');
 assert.match(panel.querySelector('.p-last').textContent,/^Son konuşulduğu tarih: /);
 assert.deepEqual([...panel.querySelectorAll('.p-links a')].map(a=>a.getAttribute('href')),['/harita/liste#entry-e1','/asilmis','/konular?view=overview&topicId=t1&recordId=r1']);
 // An AI restatement and an AI suggestion are never shown as the person's own words.
 $('node-e2').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.equal(panel.querySelector('.p-voice').className,'p-voice is-ai');assert.match(panel.querySelector('.p-voice-label').textContent,/AI'nın senin sözünden/);
 assert.ok(panel.querySelector('.eyebrow').classList.contains('is-objection'));
 assert.deepEqual([...panel.querySelectorAll('.p-path button')].map(b=>b.textContent.split(':')[0]),['Haritam','İnsan <img src=x onerror=alert(1)>','Pozisyon']);
 $('node-e5').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.match(panel.querySelector('.p-voice-label').textContent,/AI önerisi — senin sözün değil/);
 assert.ok([...panel.querySelectorAll('.p-tentative')].some(p=>/AI önerdi; henüz onaylamadın/.test(p.textContent)));
 assert.equal(panel.querySelector('.p-lineage'),null);assert.match(panel.textContent,/Bu düşünce bir başkasını aşarak gelmedi/);
 // "Where I came from" moves to that thought.
 [...panel.querySelectorAll('.p-path button')][1].click();
 assert.equal(panel.querySelector('.p-title').textContent,'İnsan <img src=x onerror=alert(1)>');
});

test('son düşünceme bak paneli açar ve vurgular; yoksa düğme kapalı ve neden yazılı',async t=>{
 const {d,$}=setup(t);await flush();
 assert.equal($('last-thought').disabled,false);assert.equal($('last-why').hidden,true);
 $('last-thought').click();
 assert.ok($('node-e1').classList.contains('is-highlight'));assert.equal($('panel').hidden,false);assert.equal(d.activeElement,$('node-e1'));
 assert.match($('page-status').textContent,/En son konuştuğun düşünce ortada/);
 $('fit-all').click();assert.match($('page-status').textContent,/Bütün harita ekranda/);
 const none=setup(t,{lastId:null});await flush();
 assert.equal(none.$('last-thought').disabled,true);assert.equal(none.$('last-why').hidden,false);assert.match(none.$('last-why').textContent,/Henüz konuşma tarihi taşıyan/);
});

test('klavye: oklar üst, alt ve yan düşünceye; Enter paneli açar; Esc kapatıp düğüme döner',async t=>{
 const {d,$,key}=setup(t);await flush();
 $('node-e1').focus();key($('node-e1'),'ArrowRight');assert.equal(d.activeElement.id,'node-e4','ilk çocuk');
 key(d.activeElement,'ArrowDown');assert.equal(d.activeElement.id,'node-e3','sonraki kardeş');
 key(d.activeElement,'ArrowUp');assert.equal(d.activeElement.id,'node-e4');
 key(d.activeElement,'ArrowLeft');assert.equal(d.activeElement.id,'node-e1','üst');
 key(d.activeElement,'ArrowLeft');assert.equal(d.activeElement.id,'node-section:insan');
 key($('node-e1'),'Enter');assert.equal($('panel').hidden,false);assert.equal(d.activeElement,$('panel-title'));
 key($('panel-title'),'Escape');assert.equal($('panel').hidden,true);assert.equal(d.activeElement,$('node-e1'));
});

test('adres #entry-ID o düşünceyi açar',async t=>{
 const {$}=setup(t,{hash:'#entry-e3'});await flush();
 assert.equal($('panel').hidden,false);assert.equal($('panel').querySelector('.p-text').textContent,'SENTETİK açık soru?');
 assert.match($('panel').querySelector('.eyebrow').textContent,/Açık soru · Soru · Açık soru/);
});

test('boş defter sakin bir açıklama ve Güncelle ile Konular bağlantısı gösterir',async t=>{
 const {$}=setup(t,{entries:[],lastId:null});await flush();
 assert.equal($('empty').hidden,false);assert.equal($('controls').hidden,true);
 assert.deepEqual([...$('empty').querySelectorAll('a')].map(a=>a.getAttribute('href')),['/guncelle','/konular']);
 assert.equal($('page-status').textContent,'Haritan henüz boş.');
});

test('EN | TR: arayüz İngilizce olur, kişinin sözleri çevrilmez; açık panel yerinde kalır',async t=>{
 const {d,$,w,lang}=setup(t);await flush();
 $('node-e1').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 d.querySelector('[data-ui-lang="en"]').click();await flush();
 assert.deepEqual(lang.sets,['en']);assert.equal(d.documentElement.lang,'en');
 assert.equal($('fit-all').textContent,'Look at my whole map');assert.equal($('last-thought').textContent,'Look at my last thought');
 assert.equal(d.querySelector('.subnav a').textContent,'Canvas');
 assert.equal($('node-root').textContent,'My map');assert.equal($('node-section:insan').querySelector('.cnode-section-title').textContent,'Person');
 assert.equal($('node-e1').querySelector('.cnode-role').firstChild.textContent,'Position');
 assert.equal($('node-e1').querySelector('.cnode-text').textContent,'SENTETİK pozisyon <b>kalın</b>');
 assert.equal($('panel').hidden,false);assert.equal($('panel').querySelector('.p-voice-label').textContent,'Your own words');
 assert.ok([...$('panel').querySelectorAll('h3')].some(h=>h.textContent==='Thought inheritance'));
 assert.match($('page-status').textContent,/6 thoughts on the map/);
});

test('tuval stili: dar ekranda alt çekmece, hareket azaltma, sabit yazı tipi yok',()=>{
 const css=fs.readFileSync(path.join(web,'canvas.css'),'utf8');
 assert.match(css,/@media\(max-width:720px\)\{[\s\S]*\.side-panel\{top:auto;left:0;right:0;bottom:0/);
 assert.match(css,/prefers-reduced-motion:reduce/);assert.doesNotMatch(css,/@import|url\(/,'dış kaynak yok');
 const js=fs.readFileSync(path.join(web,'canvas.js'),'utf8');assert.match(js,/prefers-reduced-motion: reduce/);assert.doesNotMatch(js.replace('http://www.w3.org/2000/svg',''),/innerHTML|https?:\/\//);
});
