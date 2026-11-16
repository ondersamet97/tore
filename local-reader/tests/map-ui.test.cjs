'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const web=path.resolve(__dirname,'../../web'),token='e'.repeat(64);
const catalog={version:1,method:'SENTETİK yöntem',methodEn:'SYNTHETIC method',
 sections:[{id:'insan',title:'İnsan <img src=x onerror=alert(1)>',titleEn:'Person',question:'Soru',questionEn:'Question'},{id:'toplum',title:'Toplum',titleEn:'Society',question:'Soru',questionEn:'Question'}],
 roles:[['premise','Ön kabul','Premise'],['position','Pozisyon','Position'],['divergence','Ayrılık','Divergence'],['change','Fikir değişimi','Change'],['objection','İtiraz','Objection'],['answer','Cevap','Answer'],['test','Yanlışlama ölçütü','Refutation'],['open_question','Açık soru','Open question']].map(([id,title,titleEn])=>({id,title,titleEn}))};
const rec=(id,text,extra={})=>({id,topicId:'t1',kind:'opinion',text,reason:'',attribution:'user_statement',review:'reviewed',adoption:'adopted',currency:'current',priority:'unspecified',questionState:'not_applicable',revision:1,updatedAt:'2026-01-02T00:00:00Z',source:{title:'SENTETİK konuşma',timestamp:'2026-01-01T00:00:00Z'},...extra});
const ent=(id,recordId,role,extra={})=>({id,recordId,section:'insan',role,parentId:null,counterpart:'',label:'',note:'',order:0,placement:'user',createdAt:'2026-01-0'+id.slice(-1),updatedAt:'x',...extra});
async function flush(){for(let i=0;i<14;i++)await new Promise(r=>setImmediate(r));}
function setup(t){
 const records=[rec('r1','SENTETİK pozisyon <b>kalın</b>'),rec('r2','SENTETİK itiraz',{attribution:'user_authored',adoption:'not_adopted'}),rec('r3','SENTETİK cevap'),rec('r4','SENTETİK bekleyen',{review:'pending',adoption:'unknown'}),rec('r5','SENTETİK yerleşmemiş')];
 const entries=[ent('e1','r1','position',{label:'Başlık',counterpart:'SENTETİK gelenek',translationEn:{text:'SYNTHETIC position',by:'ai',label:'Heading'}}),ent('e2','r2','objection',{parentId:'e1'}),ent('e3','r3','answer',{parentId:'e2'}),ent('e4','r4','position',{section:'toplum',placement:'suggested'})];
 const requests=[],downloads=[];
 const html=fs.readFileSync(path.join(web,'map.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://127.0.0.1:18740/harita#local='+token});t.after(()=>dom.window.close());
 const w=dom.window;
 w.fetch=async(url,request)=>{
  assert.ok(url.startsWith('/api/private/tore/'));assert.equal(request.headers.Authorization,'Bearer '+token);
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});let data;
  const find=id=>records.find(r=>r.id===id);
  if(op==='map')data={catalog,entries:entries.map(e=>({entry:e,record:find(e.recordId),thinkerIds:[]})),stateHash:'s'};
  else if(op==='records-list')data={topics:[{id:'t1',title:'SENTETİK konu'}],records};
  else if(op==='map-add'){assert.equal(body.confirmedByUser,true);const e=ent('e'+(entries.length+1),body.recordId,body.role,{section:body.section,parentId:body.parentId||null,label:body.label||''});entries.push(e);data={entry:e};}
  else if(op==='map-update'){assert.equal(body.confirmedByUser,true);const e=entries.find(x=>x.id===body.entryId);Object.assign(e,{section:body.section,label:body.label,counterpart:body.counterpart,note:body.note,translationEn:body.translationEn,placement:'user'});data={entry:e};}
  else if(op==='map-remove'){assert.equal(body.confirmedByUser,true);entries.splice(entries.findIndex(e=>e.id===body.entryId),1);data={removed:body.entryId};}
  else if(op==='records-create'){assert.equal(body.kind,'opinion');const r=rec('r'+(records.length+1),body.text,{attribution:'user_authored',review:'pending',adoption:'unknown'});records.push(r);data={record:r};}
  else if(op==='records-review'){assert.equal(body.confirmedByUser,true);assert.equal(body.expectedRevision,1);Object.assign(find(body.id),{review:body.review,adoption:body.adoption});data={record:find(body.id)};}
  else if(op==='map-export'){assert.equal(body.confirmedByUser,true);data={html:'<!doctype html><p>SENTETİK</p>',entryCount:1,hash:'h',findings:[]};}
  else throw Error('beklenmeyen işlem '+op);
  return{ok:true,status:200,json:async()=>data};
 };
 if(!w.crypto.randomUUID)w.crypto.randomUUID=()=>'00000000-0000-4000-8000-000000000001';
 w.URL.createObjectURL=blob=>{downloads.push(blob);return'blob:x';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
 w.eval(fs.readFileSync(path.join(web,'map.js'),'utf8').replace(/^import .*;\n/,''));
 const d=w.document,check=(el,on=true)=>{el.checked=on;el.dispatchEvent(new w.Event('change'));};
 return{w,d,requests,entries,records,downloads,check};
}

test('harita okur görünümünde kayıtları bölüm ve bağlarıyla, metni güvenli gösterir',async t=>{
 const {d,check}=setup(t);await flush();
 assert.equal(d.getElementById('entry-count').textContent,'4');assert.equal(d.getElementById('pending-count').textContent,'1');
 assert.equal(d.querySelector('#map-body img'),null);assert.equal(d.querySelector('#map-body b'),null,'kayıt metni HTML olarak işlenmemeli');
 const position=d.getElementById('entry-e1');
 assert.equal(position.querySelector('h3').textContent,'Başlık');
 assert.ok(position.querySelector('#entry-e2 #entry-e3'),'cevap itirazın, itiraz pozisyonun altında durur');
 assert.match(position.querySelector('.map-test-line').textContent,/1 itiraz · 1 cevaplandı · yanlışlama ölçütü yok/);
 assert.match(position.textContent,/Karşısındaki görüş: SENTETİK gelenek/);
 assert.match(d.getElementById('entry-e4').textContent,/yeri AI önerisi/);
 assert.equal(d.getElementById('map-tools').hidden,true);assert.equal(d.querySelector('.map-edit'),null,'okur görünümünde düzenleme aracı yok');
 check(d.getElementById('show-pending'),false);
 assert.equal(d.getElementById('entry-e4'),null,'bekleyen kayıt süzülür');
 check(d.getElementById('show-pending'));check(d.getElementById('show-suggested'),false);
 assert.equal(d.getElementById('entry-e4'),null,'yeri önerilen kayıt süzülür');
});

test('İngilizce görünüm çeviriyi AI çevirisi olarak işaretler ve özgün metni korur',async t=>{
 const {d}=setup(t);await flush();
 d.getElementById('lang-en').click();
 assert.equal(d.documentElement.lang,'en');assert.equal(d.getElementById('map-title').textContent,'Map of my thinking');
 const position=d.getElementById('entry-e1');
 assert.equal(position.querySelector('.map-text').textContent,'SYNTHETIC position');assert.equal(position.querySelector('h3').textContent,'Heading');
 assert.match(position.textContent,/AI translation, not reviewed by the author/);
 assert.equal(position.querySelector('.map-original').textContent,'SENTETİK pozisyon <b>kalın</b>');
 assert.match(d.getElementById('entry-e2').textContent,/Not translated/);
 assert.equal(d.querySelector('#section-insan h2').textContent,'Person');
});

test('düzenleme yalnız onayla yazar: inceleme, sınama, yerleşim, ekleme, çıkarma ve dışa aktarım',async t=>{
 const {w,d,requests,entries,records,downloads,check}=setup(t);await flush();
 d.getElementById('mode-edit').click();
 assert.equal(d.getElementById('map-tools').hidden,false);
 const tools=d.querySelector('[data-tools="e4"]'),adopt=tools.querySelector('[data-review="adopted"]');
 assert.equal(adopt.disabled,true,'onaysız benimseme yok');
 check(tools.querySelector('input[type=checkbox]'));adopt.click();await flush();
 assert.equal(records.find(r=>r.id==='r4').adoption,'adopted');
 const place=d.querySelector('form[data-place="e4"]'),save=place.querySelector('button[type=submit]');
 assert.equal(save.disabled,true);place.querySelector('input').value=' Yeni başlık ';check(place.querySelector('input[type=checkbox]'));
 place.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(entries.find(e=>e.id==='e4').label,'Yeni başlık');assert.equal(entries.find(e=>e.id==='e4').placement,'user');
 const child=d.querySelector('form[data-child-of="e1"]'),write=child.querySelector('button[type=submit]');
 child.querySelector('select').value='test';child.querySelector('textarea').value='SENTETİK ölçüt';
 assert.equal(write.disabled,true);check(child.querySelector('input[type=checkbox]'));assert.equal(write.disabled,false);
 child.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 const added=entries.at(-1);assert.equal(added.role,'test');assert.equal(added.parentId,'e1');
 assert.match(d.getElementById('entry-e1').querySelector('.map-test-line').textContent,/yanlışlama ölçütü var/);
 const add=d.getElementById('add-form');d.getElementById('add-record').value='r5';d.getElementById('add-record').dispatchEvent(new w.Event('change'));
 assert.equal(d.getElementById('add-save').disabled,true);check(d.getElementById('add-consent'));
 add.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.ok(entries.some(e=>e.recordId==='r5'));
 const remove=d.querySelector('[data-remove="e3"]');assert.equal(remove.disabled,true);
 check(remove.closest('.actions').querySelector('input[type=checkbox]'));remove.click();await flush();
 assert.equal(entries.some(e=>e.id==='e3'),false);
 assert.equal(d.getElementById('export-save').disabled,true);check(d.getElementById('export-consent'));
 d.getElementById('export-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.ok(downloads.includes('dusunce-haritam.html'));
 assert.deepEqual(requests.map(r=>r.op).filter(o=>!['map','records-list'].includes(o)),['records-review','map-update','records-create','map-add','map-add','map-remove','map-export']);
});
