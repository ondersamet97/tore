'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const web=path.resolve(__dirname,'../../web'),token='e'.repeat(64);
const catalog={version:1,method:'SENTETİK yöntem',thinkers:[
 {id:'hegel',name:'Hegel <img src=x onerror=alert(1)>',years:'1770–1831',works:['Eser'],ideas:['Fikir'],criticisms:['Eleştiri'],limits:'Sınır'},
 {id:'hobbes',name:'Hobbes',years:'1588–1679',works:['Leviathan'],ideas:['Sözleşme'],criticisms:['Locke'],limits:'Sınır'}]};
const record={id:'r1',topicId:'t1',kind:'opinion',text:'SENTETİK kullanıcı sözü',attribution:'user_statement',review:'pending',adoption:'unknown',currency:'unknown'};
async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
function setup(t){
 const links=[],requests=[];
 const html=fs.readFileSync(path.join(web,'thinkers.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://127.0.0.1:18740/dusunurler#local='+token});t.after(()=>dom.window.close());
 const w=dom.window;
 w.fetch=async(url,request)=>{
  assert.ok(url.startsWith('/api/private/tore/'));assert.equal(request.headers.Authorization,'Bearer '+token);
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});let data;
  if(op==='thinkers')data={catalog,links:links.map(l=>({link:l,record})),stateHash:'s'};
  else if(op==='records-list')data={topics:[{id:'t1',title:'İdeolojim'}],records:[record]};
  else if(op==='thinkers-link'){assert.equal(body.confirmedByUser,true);assert.match(body.requestId,/^[0-9a-f-]{36}$/);const l={id:'link-1',thinkerId:body.thinkerId,recordId:body.recordId,note:body.note,createdAt:'x'};links.push(l);data={link:l};}
  else if(op==='thinkers-unlink'){assert.equal(body.confirmedByUser,true);links.splice(links.findIndex(l=>l.id===body.linkId),1);data={removed:body.linkId};}
  else throw Error('beklenmeyen işlem '+op);
  return{ok:true,status:200,json:async()=>data};
 };
 if(!w.crypto.randomUUID)w.crypto.randomUUID=()=>'00000000-0000-4000-8000-000000000001';
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
 w.eval(fs.readFileSync(path.join(web,'thinkers.js'),'utf8').replace(/^import .*;\n/,''));
 return{w,requests,links};
}

test('düşünür sayfası kataloğu güvenli gösterir ve bağlantı yalnız onayla kurulur',async t=>{
 const {w,requests,links}=setup(t);await flush();
 const d=w.document;
 assert.equal(d.getElementById('thinker-count').textContent,'2');
 assert.equal(d.querySelector('img'),null,'katalog metni HTML olarak işlenmemeli');
 const form=d.querySelector('form[data-thinker="hegel"]'),select=form.querySelector('select'),consent=form.querySelector('input[type=checkbox]'),save=form.querySelector('button');
 select.value='r1';select.dispatchEvent(new w.Event('change'));
 assert.equal(save.disabled,true,'onaysız bağlanamaz');
 consent.checked=true;consent.dispatchEvent(new w.Event('change'));
 assert.equal(save.disabled,false);
 form.querySelector('textarea').value=' Yakın ';
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
 assert.equal(links.length,1);assert.equal(links[0].note,'Yakın');
 assert.equal(d.getElementById('link-count').textContent,'1');
 assert.equal(d.querySelector('form[data-thinker="hegel"] select'),null,'bağlı kayıt yeniden önerilmez');
 const unlink=d.querySelector('[data-unlink="link-1"]');assert.equal(unlink.disabled,true);
 const box=unlink.closest('article').querySelector('input[type=checkbox]');box.checked=true;box.dispatchEvent(new w.Event('change'));
 unlink.click();await flush();
 assert.equal(links.length,0);
 assert.deepEqual(requests.map(r=>r.op).filter(o=>o.startsWith('thinkers-')),['thinkers-link','thinkers-unlink']);
});
