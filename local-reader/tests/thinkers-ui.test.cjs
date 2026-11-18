'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {loadI18n,languageStore,languageOp}=require('./i18n-helpers.cjs');
const web=path.resolve(__dirname,'../../web'),token='e'.repeat(64);
// Ideas carry their context ({text, context}); hobbes keeps the older plain string so both shapes stay readable.
const catalog={version:2,method:'SENTETİK yöntem',scope:'SENTETİK örnek katalog',thinkers:[
 {id:'hegel',name:'Hegel <img src=x onerror=alert(1)>',years:'1770–1831',works:['Eser'],ideas:[{text:'Fikir',context:'SENTETİK bağlam <img src=x onerror=alert(3)>'}],criticisms:['Eleştiri'],limits:'Sınır'},
 {id:'hobbes',name:'Hobbes',years:'1588–1679',works:['Leviathan'],ideas:['Sözleşme'],criticisms:['Locke'],limits:'Sınır'}]};
const record={id:'r1',topicId:'t1',kind:'opinion',text:'SENTETİK kullanıcı sözü',attribution:'user_statement',review:'pending',adoption:'unknown',currency:'unknown'};
const other={id:'r2',topicId:'t1',kind:'decision',text:'SENTETİK başka karar <img src=x onerror=alert(2)>',attribution:'user_authored',review:'reviewed',adoption:'adopted',currency:'current'};
async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
function setup(t,opts={}){
 const links=[],requests=[],records=opts.records||[record,other],lang=languageStore(opts.uiLanguage??null);
 const html=fs.readFileSync(path.join(web,'thinkers.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://127.0.0.1:18740/dusunurler#local='+token});t.after(()=>dom.window.close());
 const w=dom.window;
 w.fetch=async(url,request)=>{
  assert.ok(url.startsWith('/api/private/tore/'));assert.equal(request.headers.Authorization,'Bearer '+token);
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});let data;
  const ui=languageOp(lang,op,body);if(ui!==undefined)return{ok:true,status:200,json:async()=>ui};
  if(opts.failOp===op)return{ok:false,status:409,json:async()=>({error:'Konu deposu başka bir Töre sürecinde açık'})};
  if(op==='thinkers')data={catalog,links:links.map(l=>({link:l,record:records.find(r=>r.id===l.recordId)})),stateHash:'s'};
  else if(op==='records-list')data={topics:[{id:'t1',title:'İdeolojim'}],records};
  else if(op==='thinkers-link'){assert.equal(body.confirmedByUser,true);assert.match(body.requestId,/^[0-9a-f-]{36}$/);const l={id:'link-1',thinkerId:body.thinkerId,recordId:body.recordId,note:body.note,createdAt:'x'};links.push(l);data={link:l};}
  else if(op==='thinkers-unlink'){assert.equal(body.confirmedByUser,true);links.splice(links.findIndex(l=>l.id===body.linkId),1);data={removed:body.linkId};}
  else throw Error('beklenmeyen işlem '+op);
  return{ok:true,status:200,json:async()=>data};
 };
 if(!w.crypto.randomUUID)w.crypto.randomUUID=()=>'00000000-0000-4000-8000-000000000001';
 loadI18n(w,['thinkers'],{navigatorLanguage:opts.navigatorLanguage||'tr-TR'});
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
 w.eval(fs.readFileSync(path.join(web,'thinkers.js'),'utf8').replace(/^import .*;\n/,''));
 const open=id=>{const card=w.document.getElementById('thinker-'+id);card.open=true;card.dispatchEvent(new w.Event('toggle'));return card;};
 return{w,requests,links,open,lang};
}

test('üst menü dört bağlantıyı taşır; Düşünürler Haritam altındadır; başlık sırası atlamaz',async t=>{
 const {w}=setup(t);await flush();const d=w.document;
 assert.equal(d.title,'töre — Düşünürler');
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']]);
 assert.equal(d.querySelector('.topbar nav [aria-current="page"]'),null,'menüde bu sayfanın kendi bağlantısı yok');assert.equal(d.querySelector('.topbar nav [aria-current="true"]').textContent,'Haritam','Düşünürler Haritam bölümündedir');assert.equal(d.querySelector('.subnav [aria-current="page"]').textContent,'Düşünürler');assert.equal(d.querySelector('.subnav a[href="/harita"]').textContent,'Tuval');assert.equal(d.querySelector('.subnav a[href="/harita/liste"]').textContent,'Liste');assert.equal(d.querySelector('.topbar .brand').getAttribute('href'),'/');
 assert.doesNotMatch(d.querySelector('.topbar').textContent,/Görüşlerim|\d+\.\d+\.\d+/);
 assert.equal(d.querySelectorAll('h1').length,1);assert.equal(d.querySelectorAll('#thinker-list summary h2').length,2,'düşünür adı ikinci düzey başlık');
 assert.ok(d.querySelector('#thinker-hegel h3'));assert.equal(d.querySelector('h4,h5'),null,'h1 → h2 → h3; atlama yok');
 assert.match(d.querySelector('#thinker-hegel .notice').textContent,/^Bu özetin sınırı: /);
});

test('katalog örnek olarak sunulur; her düşünürün yaşadığı yıllar ve her fikrin bağlamı görünür',async t=>{
 const {w}=setup(t);await flush();const d=w.document;
 assert.equal(d.querySelector('h1').textContent,'Örnek düşünürler');
 assert.match(d.querySelector('[data-i18n="thinkers.example"]').textContent,/yalnız örnek olarak verilmiştir; seçim bir sıralama ya da öneri değildir/);
 assert.equal(d.querySelector('.page-meta').textContent,'0 bağlantı · 2 örnek düşünür katalogda');
 assert.equal(d.querySelector('#thinker-hegel summary .small').textContent,'Yaşadığı yıllar: 1770–1831 · 0 bağlantı');
 const idea=d.querySelector('#thinker-hegel .idea-list li');
 assert.equal(idea.querySelector('span').textContent,'Fikir');
 assert.equal(idea.querySelector('p.small').textContent,'Bağlam: SENTETİK bağlam <img src=x onerror=alert(3)>','bağlam düz metin olarak gösterilir');
 assert.equal(d.querySelector('img'),null);
 const plain=d.querySelector('#thinker-hobbes .idea-list li');
 assert.equal(plain.textContent,'Sözleşme','bağlamı olmayan eski biçim de okunur');assert.equal(plain.querySelector('p'),null);
});

test('düşünür sayfası kataloğu güvenli gösterir; bağlama onaylı ve aranabilir, kaldırma tek tık',async t=>{
 const {w,requests,links,open}=setup(t);await flush();
 const d=w.document;
 assert.equal(d.getElementById('thinker-count').textContent,'2');
 assert.equal(d.querySelector('img'),null,'katalog metni HTML olarak işlenmemeli');
 assert.equal(d.querySelector('#thinker-list form'),null,'kapalı kartlar kayıt listesini üretmez');
 assert.equal(d.querySelector('#thinker-list select'),null,'uzun açılır liste yok');
 open('hegel');
 assert.equal(d.querySelectorAll('#thinker-list form').length,1,'yalnız açılan kartın formu kurulur');
 const form=d.querySelector('form[data-thinker="hegel"]'),search=form.querySelector('input[type=search]'),consent=form.querySelector('input[type=checkbox]'),save=form.querySelector('button[type=submit]');
 const options=()=>[...form.querySelectorAll('input[type=radio]')].map(i=>i.value);
 assert.deepEqual(options(),['r1','r2']);assert.equal(form.querySelector('img'),null);
 search.value='KULLANICI';search.dispatchEvent(new w.Event('input'));assert.deepEqual(options(),['r1'],'arama listeyi süzer');
 search.value='hiç yok';search.dispatchEvent(new w.Event('input'));assert.deepEqual(options(),[]);assert.match(form.querySelector('[role=status]').textContent,/Aramana uyan kayıt yok/);
 search.value='';search.dispatchEvent(new w.Event('input'));
 const radio=form.querySelector('input[type=radio][value=r1]');radio.checked=true;radio.dispatchEvent(new w.Event('change'));
 assert.equal(save.disabled,true,'onaysız bağlanamaz');
 consent.checked=true;consent.dispatchEvent(new w.Event('change'));
 assert.equal(save.disabled,false);
 form.querySelector('textarea').value=' Yakın ';
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(links.length,1);assert.equal(links[0].note,'Yakın');assert.equal(links[0].recordId,'r1');
 assert.equal(d.getElementById('link-count').textContent,'1');
 const card=d.getElementById('thinker-hegel');
 assert.equal(card.open,true,'işlemden sonra kart açık kalır');
 assert.equal(card.querySelector('summary + [role=status]').textContent,'Bağlantı kaydedildi.');assert.equal(d.activeElement,card.querySelector('summary'),'odak işlem yapılan düşünürde kalır');
 assert.equal(d.getElementById('page-status').textContent,'Düşünürler hazır.','bildirim sayfa tepesine taşınmaz');
 assert.deepEqual([...card.querySelectorAll('form[data-thinker="hegel"] input[type=radio]')].map(i=>i.value),['r2'],'bağlı kayıt yeniden önerilmez');
 assert.equal(card.querySelector('[data-link-id="link-1"] a').getAttribute('href'),'/konular?view=overview&topicId=t1&recordId=r1');
 const unlink=d.querySelector('[data-unlink="link-1"]');
 assert.equal(unlink.disabled,false,'bağlantıyı kaldırmak tek tık');assert.equal(unlink.closest('article').querySelector('input[type=checkbox]'),null);
 unlink.click();await flush();
 assert.equal(links.length,0);assert.match(d.querySelector('#thinker-hegel summary + [role=status]').textContent,/Bağlantı kaldırıldı; kayıt defterinde duruyor/);
 assert.deepEqual(requests.map(r=>r.op).filter(o=>o.startsWith('thinkers-')),['thinkers-link','thinkers-unlink']);
});

test('hata düğmenin yanında ve anlaşılır dille görünür; kayıt yokken Konularım\'a yönlendirir',async t=>{
 const {w,links,open}=setup(t,{failOp:'thinkers-link'});await flush();const d=w.document;
 open('hobbes');const form=d.querySelector('form[data-thinker="hobbes"]'),save=form.querySelector('button[type=submit]');
 const radio=form.querySelector('input[type=radio]');radio.checked=true;radio.dispatchEvent(new w.Event('change'));
 const consent=form.querySelector('input[type=checkbox]');consent.checked=true;consent.dispatchEvent(new w.Event('change'));
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(links.length,0);const alert=save.closest('.actions').nextElementSibling;
 assert.equal(alert.getAttribute('role'),'alert');assert.equal(alert.textContent,'Defter başka bir töre penceresinde açık. Öbürünü kapat, sonra sayfayı yenile.');
 assert.equal(d.getElementById('page-error').hidden,true);assert.equal(save.disabled,false);assert.equal(d.activeElement,save);
 const empty=setup(t,{records:[]});await flush();empty.open('hegel');
 const go=empty.w.document.querySelector('form[data-thinker="hegel"] a');assert.equal(go.getAttribute('href'),'/konular');
});

test('İngilizce arayüz: menü, sayaçlar, kart başlıkları ve bağlama formu İngilizce; katalog Türkçe işaretli',async t=>{
 const {w,open}=setup(t,{navigatorLanguage:'en-GB'});await flush();const d=w.document;
 assert.equal(d.documentElement.lang,'en');assert.equal(d.title,'töre — Thinkers');
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>a.textContent),['Topics','Waiting for you','My map','Conversations']);
 assert.equal(d.querySelector('h1').textContent,'Example thinkers');assert.equal(d.querySelector('.subnav [aria-current="page"]').textContent,'Thinkers');
 assert.equal(d.querySelector('.page-meta').textContent,'0 links · 2 example thinkers in the catalogue');assert.equal(d.getElementById('page-status').textContent,'The thinkers are ready.');
 assert.match(d.querySelector('[data-i18n="thinkers.example"]').textContent,/^These thinkers are only examples\. The choice is not a ranking or a recommendation\./);
 assert.match(d.querySelector('[data-i18n="thinkers.intro"]').textContent,/^Only you link one of your records to a thinker/);
 const card=open('hegel');assert.equal(card.querySelector('summary .small').textContent,'Lived 1770–1831 · 0 links');
 assert.deepEqual([...card.querySelectorAll('h3')].map(h=>h.textContent),['Works','Main ideas','Criticisms','Records you linked','Link one of your records']);
 assert.equal(card.querySelector('ul').lang,'tr','katalog metni Türkçe olarak işaretli');assert.match(card.querySelector('.notice').textContent,/^Limits of this summary: Sınır$/);
 const context=card.querySelector('.idea-list p.small');assert.match(context.textContent,/^Context: SENTETİK bağlam/);assert.equal(context.lang,'','etiket arayüz dilinde');assert.equal(context.querySelector('span').lang,'tr','bağlam metni Türkçe olarak işaretli');
 assert.equal(card.querySelector('.idea-list > li > span').lang,'tr');
 const form=card.querySelector('form');assert.match(form.textContent,/I am linking this record to this thinker by my own decision/);assert.equal(form.querySelector('button[type=submit]').textContent,'Link');
 assert.match(form.querySelector('[role=status]').textContent,/^2 of 2 records match\.$/);assert.match(form.querySelector('.record-option').textContent,/İdeolojim · Opinion · Your words \(verbatim\)/);
 const saved=setup(t,{navigatorLanguage:'tr-TR',uiLanguage:'en'});await flush();assert.equal(saved.w.document.documentElement.lang,'en','kayıtlı seçim tarayıcı dilini geçer');
});

test('EN | TR anahtarı seçimi sunucuya yazar; açık kart açık kalır ve yerinde yeniden çizilir',async t=>{
 const {w,open,lang}=setup(t);await flush();const d=w.document;
 open('hobbes');assert.equal(d.querySelector('#thinker-hobbes h3').textContent,'Eserleri');
 d.querySelector('[data-ui-lang="en"]').click();await flush();
 assert.deepEqual(lang.sets,['en']);assert.equal(d.documentElement.lang,'en');assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');
 assert.equal(d.getElementById('thinker-hobbes').open,true);assert.equal(d.querySelector('#thinker-hobbes h3').textContent,'Works');assert.ok(d.querySelector('form[data-thinker="hobbes"]'),'açık kartın formu yeniden kurulur');
 assert.equal(d.querySelector('h1').textContent,'Example thinkers');assert.equal(d.getElementById('page-status').textContent,'The thinkers are ready.');
 d.querySelector('[data-ui-lang="tr"]').click();await flush();
 assert.deepEqual(lang.sets,['en','tr']);assert.equal(d.documentElement.lang,'tr');assert.equal(d.querySelector('#thinker-hobbes h3').textContent,'Eserleri');assert.equal(d.querySelector('.page-meta').textContent,'0 bağlantı · 2 örnek düşünür katalogda');assert.equal(d.querySelector('#thinker-hobbes ul').hasAttribute('lang'),false);
 assert.equal(d.querySelector('h1').textContent,'Örnek düşünürler');assert.equal(d.querySelector('#thinker-hegel .idea-list p.small').textContent.startsWith('Bağlam: '),true);
});
