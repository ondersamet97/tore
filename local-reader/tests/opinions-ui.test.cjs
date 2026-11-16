'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const web = path.resolve(__dirname, '../../web');
const token = 'a'.repeat(64);
const copy = x => JSON.parse(JSON.stringify(x));
const catalog = {
  topics: [ ['life', 'Yaşam güvencesi ve kaynaklar'], ['freedom', 'Özgürlük ve güvenlik'], ['ai', 'Yapay zekâ ve toplum'] ].map(([id,label])=>({id,label,question:'SENTETİK: Nasıl bir gelecek istiyorsun?'})),
  positions: [{id:'life_basic',topic:'life',label:'Temel yaşam güvencesi',description:'Bir başlangıç güvencesi.',traditionIds:['capability']},{id:'life_plural',topic:'life',label:'Farklı yaşam biçimleri',description:'Çeşitliliğin korunması.',traditionIds:['pluralism']},{id:'ai_human',topic:'ai',label:'İnsan denetimi',description:'SENTETİK insan denetimi.',traditionIds:['capability']}],
  traditions: [{id:'capability',label:'Yapabilirlik yaklaşımı',description:'SENTETİK sınırlı yakınlık.',limits:'Tam bir program benimsendiği anlamına gelmez.'},{id:'pluralism',label:'Çoğulculuk',description:'SENTETİK farklı yaşamlar.',limits:'Kimlik testi değildir.'}]
};
function card(overrides={}) { return {id:'o1',topic:'life',statement:'SENTETİK herkesin yaşam güvencesi olmalı.',reason:'SENTETİK insanın seçenekleri artsın.',source:{conversationId:'c1',messageId:'m1',excerpt:'SENTETİK <img src=x onerror=alert(1)> kaynak.',conversationTitle:'SENTETİK <script>sakın</script> kaynak',provider:'chatgpt',role:'user',timestamp:null},attribution:'assistant_proposal',positionIds:['life_basic'],status:'draft',revision:1,createdAt:'2026-11-15T09:00:00Z',updatedAt:'2026-11-15T09:00:00Z',history:[],...overrides}; }
async function flush() { for(let i=0;i<10;i++) await new Promise(r=>setImmediate(r)); }
async function setup(t, opts={}) {
  const dom = new JSDOM(fs.readFileSync(path.join(web,'opinions.html'),'utf8'),{runScripts:'outside-only',url:'http://127.0.0.1:18740/gorusler#local='+token});t.after(()=>dom.window.close());
  const w=dom.window,requests=[],cards=copy(opts.cards||[card()]), creations=new Map();let failReview=!!opts.failReview, loseCreateAck=!!opts.loseCreateAck, next=2;
  w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>false;
  w.fetch=async(url,req)=>{
    assert.equal(req.method,'POST');assert.equal(req.headers.Authorization,'Bearer '+token);assert.equal(req.credentials,'omit');
    const op=url.split('/').at(-1),body=JSON.parse(req.body);requests.push({op,body});let result;
    if(op==='opinions') result={schemaVersion:1,cards,catalog};
    else if(op==='opinion-review') {
      if(failReview)return{ok:false,status:400,json:async()=>({error:'Sürüm değişti; eski kayıt üzerine yazılmadı.'})};
      const c=cards.find(x=>x.id===body.id);assert.equal(body.expectedRevision,c.revision);if(body.status==='confirmed')assert.equal(body.confirmedByUser,true);
      const old={revision:c.revision,statement:c.statement,reason:c.reason,positionIds:c.positionIds,status:c.status,changedAt:'2026-11-15T10:00:00Z',changeType:body.changeType,changeReason:body.changeReason};
      Object.assign(c,{statement:body.statement,reason:body.reason,positionIds:body.positionIds,status:body.status,revision:c.revision+1,history:[...c.history,old]});result={card:c};
    } else if(op==='opinion-create') {
      assert.match(body.requestId,/^[0-9a-f-]{36}$/);
      if(creations.has(body.requestId)){const saved=creations.get(body.requestId);assert.deepEqual(body,saved.body);result={card:cards.find(c=>c.id===saved.id)};}
      else {const c=card({id:'o'+next++,topic:body.topic,statement:body.statement,reason:body.reason,positionIds:body.positionIds,source:null,attribution:body.attribution});cards.push(c);creations.set(body.requestId,{id:c.id,body:copy(body)});result={card:c};if(loseCreateAck){loseCreateAck=false;throw Error('SENTETİK yanıt bağlantısı koptu.');}}
    }
    else if(op==='conversation') result={messages:[{id:'p1',role:'assistant',text:'SENTETİK önceki AI önerisi',parentId:null},{id:'m1',role:'user',text:'SENTETİK <img src=x onerror=alert(1)> kaynak.',parentId:'p1'},{id:'next1',role:'assistant',text:'SENTETİK sonraki dal',parentId:'m1'},{id:'other',role:'user',text:'BU YABANCI DAL GÖSTERİLMEMELİ',parentId:'p1'}]};
    else throw Error('Beklenmeyen ağ isteği: '+op);
    return {ok:true,status:200,json:async()=>copy(result)};
  };
  w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
  w.eval(fs.readFileSync(path.join(web,'opinions.js'),'utf8').replace(/^import .*;\n/,''));await flush();
  const $=id=>w.document.getElementById(id), click=async target=>{(typeof target==='string'?$(target):target).click();await flush();};
  const change=(id,value)=>{const e=$(id);e.value=value;e.dispatchEvent(new w.Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  return {w,$,cards,requests,click,change,setFailure:value=>{failReview=value;}};
}

test('ilk açılış kaynaklı taslak gösterir; AI yorumunu görüş saymaz ve özel içerik HTML olarak çalışmaz',async t=>{
  const h=await setup(t);assert.equal(h.w.location.hash,'');assert.equal(h.w.localStorage.length,0);assert.equal(h.$('confirmed-count').textContent,'0');assert.equal(h.$('draft-count').textContent,'1');
  assert.match(h.$('attribution-note').textContent,/AI yorum önerisi/);assert.match(h.$('source-excerpt').textContent,/<img/);assert.equal(h.w.document.querySelector('img,script:not([src])'),null);
  await h.click('view-map');assert.equal(h.$('map-empty').hidden,false);assert.equal(h.$('map-traditions').children.length,0);assert.deepEqual(h.requests.map(r=>r.op),['opinions']);
});

test('açık onay bağlantılı harita üretir; geri çekme haritadan çıkarır, kaynak atfı ve geçmiş korunur',async t=>{
  const h=await setup(t);await h.click('confirm-card');assert.equal(h.cards[0].status,'confirmed');assert.equal(h.cards[0].attribution,'assistant_proposal');assert.equal(h.cards[0].revision,2);assert.equal(h.$('confirmed-count').textContent,'1');
  await h.click('view-map');assert.equal(h.$('map-empty').hidden,true);assert.equal(h.$('map-traditions').children.length,1);assert.match(h.$('map-traditions').textContent,/Temel yaşam güvencesi/);assert.match(h.$('map-traditions').textContent,/Tam bir program/);
  await h.click(h.w.document.querySelector('[data-map-card-id="o1"]'));assert.equal(h.$('cards-view').hidden,false);assert.equal(h.$('statement').value,h.cards[0].statement);assert.equal(h.$('history-count').textContent,'1');
  await h.click('uncertain-card');await h.click('view-map');assert.equal(h.$('map-empty').hidden,false);assert.equal(h.$('map-traditions').children.length,0);assert.equal(h.cards[0].history.length,2);
});

test('metin veya bağlantı değişimi gerekçeli düzeltme ister; eski sürüm geçmişte tutulur',async t=>{
  const h=await setup(t);h.change('statement','SENTETİK güvence eşit sonuç demek değildir.');await h.click('confirm-card');assert.equal(h.requests.filter(r=>r.op==='opinion-review').length,0);assert.match(h.$('editor-error').textContent,/düzeltme/);
  h.change('change-type','correction');await h.click('confirm-card');assert.equal(h.requests.filter(r=>r.op==='opinion-review').length,0);
  h.change('change-reason','SENTETİK kavramları ayırdım.');await h.click('confirm-card');assert.equal(h.cards[0].statement,'SENTETİK güvence eşit sonuç demek değildir.');assert.match(h.cards[0].history[0].statement,/herkesin/);assert.match(h.$('card-history').textContent,/kavramları/);
  const position=h.w.document.querySelector('[data-position-id="life_basic"]');await h.click(position);await h.click('confirm-card');assert.match(h.$('editor-error').textContent,/bağlantılarını/);assert.equal(h.cards[0].positionIds.length,1);
});

test('kaynak bağlamı gerçek ebeveyn ve çocukları gösterir; başka dalı dahil etmez',async t=>{
  const h=await setup(t);await h.click('load-context');assert.match(h.$('source-context').textContent,/önceki AI/);assert.match(h.$('source-context').textContent,/sonraki dal/);assert.doesNotMatch(h.$('source-context').textContent,/YABANCI DAL/);assert.equal(h.w.document.querySelector('img'),null);
});

test('yeni manuel görüş önce taslaktır; konuya uygun seçili bağlantı ve sonradan onay ile haritaya girer',async t=>{
  const h=await setup(t,{cards:[]});assert.equal(h.$('editor').hidden,true);await h.click('new-card');h.change('new-topic','ai');h.change('statement','SENTETİK AI insan denetiminde olmalı.');h.change('reason','SENTETİK hesap verebilirlik.');await h.click(h.w.document.querySelector('[data-position-id="ai_human"]'));await h.click('create-card');
  assert.equal(h.cards.length,1);assert.equal(h.cards[0].status,'draft');assert.equal(h.cards[0].source,null);assert.equal(h.cards[0].attribution,'user_authored');assert.equal(h.$('source-panel').hidden,true);assert.equal(h.$('confirmed-count').textContent,'0');await h.click('confirm-card');assert.equal(h.$('confirmed-count').textContent,'1');
});

test('eski sürüm ve yazma hatası başarıya dönmez, kullanıcı metni formda kalır; kirli form sessizce terk edilmez',async t=>{
  const h=await setup(t,{cards:[card(),card({id:'o2',topic:'ai',statement:'SENTETİK başka görüş',positionIds:['ai_human']})],failReview:true});
  h.change('statement','SENTETİK yeni cümlem');h.change('change-type','opinion_change');h.change('change-reason','SENTETİK yeni kanıt');await h.click('confirm-card');assert.equal(h.cards[0].status,'draft');assert.match(h.$('editor-error').textContent,/Sonuç doğrulanamadı/);assert.equal(h.$('statement').value,'SENTETİK yeni cümlem');assert.equal(h.$('confirm-card').disabled,false);
  await h.click(h.w.document.querySelector('[data-card-id="o2"]'));assert.equal(h.$('statement').value,'SENTETİK yeni cümlem');h.w.confirm=()=>true;await h.click(h.w.document.querySelector('[data-card-id="o2"]'));assert.equal(h.$('statement').value,'SENTETİK başka görüş');
});

test('onaylı fakat bağlantısız görüş haritada görünür; bir gelenekle otomatik eşlenmez',async t=>{
  const h=await setup(t,{cards:[card({status:'confirmed',positionIds:[]})]});await h.click('view-map');assert.equal(h.$('map-empty').hidden,true);assert.match(h.$('map-topics').textContent,/yaşam güvencesi/);assert.equal(h.w.document.querySelectorAll('[data-tradition-id]').length,0);assert.match(h.$('map-traditions').textContent,/bağlantısı seçmedin/);
});

test('create yanıtı kaybolursa sabit istek kimliğiyle tekrar tek kayıt üretir',async t=>{
  const h=await setup(t,{cards:[],loseCreateAck:true});await h.click('new-card');h.change('statement','SENTETİK kayıp yanıt denemesi');await h.click('create-card');
  assert.equal(h.cards.length,1);assert.match(h.$('editor-error').textContent,/kayıt oluşmuş olabilir/);assert.equal(h.$('reconcile-card').hidden,false);assert.equal(h.$('statement').value,'SENTETİK kayıp yanıt denemesi');
  await h.click('create-card');assert.equal(h.cards.length,1);assert.equal(h.$('editor-error').hidden,true);assert.equal(h.$('reconcile-card').hidden,true);assert.equal(h.$('cards-count').textContent,'1');
  const requests=h.requests.filter(r=>r.op==='opinion-create');assert.equal(requests.length,2);assert.equal(requests[0].body.requestId,requests[1].body.requestId);
});

test('eski görüş defteri ortak menüyü taşır, kendini eski defter olarak tanıtır ve Konularım\'a yönlendirir',async t=>{
  const {w,$}=await setup(t);const d=w.document;
  assert.equal(d.title,'töre — Eski görüş defteri');
  assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konularım','/konular'],['Haritam','/harita'],['Düşünürler','/dusunurler'],['Konuşmalarım','/calisma'],['Arşiv','/arsiv']]);
  assert.equal(d.querySelectorAll('.topbar nav button').length,0,'üst menüde yalnız beş bağlantı');
  assert.equal(d.querySelector('.topbar').textContent.includes('Görüşlerim'),false);
  assert.doesNotMatch(d.querySelector('.topbar').textContent,/\d+\.\d+\.\d+/,'üst menüde sürüm yok');
  assert.equal(d.querySelector('.topbar .brand').getAttribute('href'),'/konular');
  assert.match(d.querySelector('.topbar .private-mark').textContent,/Bu bilgisayarda/);
  const note=d.querySelector('main .legacy-note');assert.ok(note);
  assert.match(note.textContent,/Bu, eski görüş defterin\. Yeni kayıtlar Konularım'da tutulur\./);
  assert.equal(note.querySelector('a[href="/konular"]').textContent,'Konularım\'a dön');
  assert.ok(note.contains($('ideology-nav')),'İdeolojim paneli sayfa içinden açılır');
  assert.doesNotMatch(d.body.textContent,/Töre/,'ürün adı küçük harfle');
});

test('eski görüş defteri biçemi okunur ikincil metin, görünür sınır, sarılan menü ve hareket azaltma taşır',()=>{
  const css=fs.readFileSync(path.join(web,'opinions.css'),'utf8');
  for(const m of css.matchAll(/font(?:-size)?:(?:\d{3} )?(\d+(?:\.\d+)?)px/g))assert.ok(Number(m[1])>=13,'en küçük yazı 13 px: '+m[0]);
  assert.match(css,/--muted:#5c665c/);
  assert.match(css,/::placeholder\{color:#6a7367/);
  assert.match(css,/\.topic-index\{[^}]*color:var\(--muted\)/);
  assert.match(css,/input,textarea,select\{border:1px solid #7d8c7a/);
  assert.doesNotMatch(css,/#7eaa61/,'odak halkası yeşil, 3:1 üstü');
  assert.match(css,/\.topbar nav\{flex-wrap:wrap/);
  assert.match(css,/input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),textarea,select\{font-size:16px!important\}/);
  assert.match(css,/button:disabled[^{]*\{opacity:1;[^}]*color:#5d685d/);
  assert.match(css,/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important/);
});
