'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'web'),token='f'.repeat(64);
async function flush(){for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));}

function setup(t,opts={}){
 const dom=new JSDOM('<!doctype html><html lang="tr"><body><main><button id="act">İşlem</button></main></body></html>',{runScripts:'outside-only',url:'http://127.0.0.1:18740/harita#local='+token});t.after(()=>dom.window.close());
 const w=dom.window,requests=[],observers=[];
 w.fetch=async(url,request)=>{
  requests.push({url,method:request.method});
  if(opts.fail)return{ok:false,status:409,json:async()=>({error:opts.fail})};
  if(url==='/api/private/tore/status')return opts.noVersion?{ok:false,status:500,json:async()=>({error:'x'})}:{ok:true,status:200,json:async()=>({version:opts.version||'0.14.0'})};
  if(url==='/api/private/shutdown')return{ok:true,status:200,json:async()=>({message:'ok'})};
  return{ok:true,status:200,json:async()=>({})};
 };
 if(!opts.noObserver)w.IntersectionObserver=class{constructor(cb){this.cb=cb;observers.push(this);}observe(){}disconnect(){this.off=true;}};
 const code=fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,'');
 w.eval(code+'\nwindow.__api=api;window.__explain=explain;');
 const d=w.document,footer=d.querySelector('body > footer.app-footer');
 const seen=async()=>{for(const o of observers)if(!o.off)o.cb([{isIntersecting:true}]);await flush();};
 return{w,d,footer,requests,seen};
}

test('sayfa altı sürümü status yanıtından yazar; üst menüye sürüm koymaz',async t=>{
 const {d,footer,requests,seen}=setup(t);
 const line=footer.querySelector('.app-version');assert.equal(line.hidden,true);assert.equal(requests.length,0,'açılışta kendiliğinden istek yok');
 await seen();
 assert.deepEqual(requests.map(r=>r.url),['/api/private/tore/status']);
 assert.equal(line.hidden,false);assert.equal(line.textContent,'töre 0.14.0');
 await seen();assert.equal(requests.length,1,'sürüm bir kez sorulur');
});

test('sürüm alınamaz ya da biçimsizse hiçbir şey yazmaz',async t=>{
 for(const opts of [{noVersion:true},{version:'<b>1</b>'}]){
  const {footer,seen}=setup(t,opts);await seen();
  const line=footer.querySelector('.app-version');assert.equal(line.hidden,true);assert.equal(line.textContent,'');
 }
});

test('Uygulamayı kapat ikinci tıkla onay ister; Vazgeç geri alır',async t=>{
 const {d,footer,requests}=setup(t);
 const close=footer.querySelector('.app-close'),cancel=footer.querySelector('.app-close-cancel'),status=footer.querySelector('.app-close-status');
 assert.equal(status.getAttribute('role'),'status');
 close.click();await flush();
 assert.equal(requests.length,0,'ilk tık kapatmaz');assert.equal(status.textContent,'Kapatılsın mı? Dosyaların yerinde kalır.');assert.equal(cancel.hidden,false);
 cancel.click();assert.equal(cancel.hidden,true);assert.equal(close.textContent,'Uygulamayı kapat');assert.equal(status.textContent,'');assert.equal(d.activeElement,close);
 close.click();close.click();await flush();
 assert.deepEqual(requests.map(r=>[r.url,r.method]),[['/api/private/shutdown','POST']]);
 assert.equal(close.disabled,true);assert.match(status.textContent,/Dosyaların yerinde/);
});

test('bilinen sunucu iletileri ne olduğunu ve ne yapılacağını söyler; bilinmeyen ileti olduğu gibi kalır',async t=>{
 const {w}=setup(t,{fail:'Konu deposu dışarıdan değişmiş; üzerine yazılmadı'});
 await assert.rejects(w.__api('/api/private/tore/map',{}),e=>e.message==='Defter başka bir pencerede değişti. Sayfayı yenile; yazdıkların kaybolmadı.'&&e.serverMessage==='Konu deposu dışarıdan değişmiş; üzerine yazılmadı'&&e.status===409);
 assert.equal(w.__explain('Kayıt değişmiş; yeniden yükleyin.'),'Bu kayıt başka bir pencerede değişti. Sayfayı yenile, sonra yeniden dene.');
 assert.equal(w.__explain('SENTETİK bilinmeyen ileti'),'SENTETİK bilinmeyen ileti');
 for(const message of Object.values({a:w.__explain('Konu bulunamadı'),b:w.__explain('Harita girdisi sınırı aşıldı')}))assert.doesNotMatch(message,/(^|\s)(yükleyin|açın)([\s.;]|$)|deposu/i,'"sen" diliyle, iç sözcük olmadan');
});

test('oturum yoksa ya da hizmete ulaşılamazsa ne yapılacağı söylenir',async t=>{
 const {w}=setup(t);
 w.fetch=async()=>{throw new w.TypeError('Failed to fetch');};
 await assert.rejects(w.__api('/api/private/tore/map',{}),/töre'ye ulaşılamıyor\. .*Başlat\.command/);
 w.sessionStorage.clear();
 await assert.rejects(w.__api('/api/private/tore/map',{}),/bağlantısı kopmuş/);
});

test('dışa aktarım biçemi betik, ağ adresi ve dış kaynak içermez; uzun dizgiyi kırar ve kâğıda uygun basılır',()=>{
 const rust=fs.readFileSync(path.join(root,'server/src/workspace/records_map.rs'),'utf8');
 const css=rust.match(/const EXPORT_CSS: &str = "([^"]*)";/)[1];
 assert.doesNotMatch(css,/http|<script|url\(|@import/i);
 assert.match(css,/body\{[^}]*overflow-wrap:anywhere/);
 const print=css.slice(css.indexOf('@media print'));assert.ok(css.includes('@media print'));
 assert.match(print,/@page\{margin:[^}]+\}/);assert.match(print,/\.e\{break-inside:avoid\}/);assert.match(print,/body\{[^}]*background:#fff/);
 assert.match(css,/max-width:70ch/);
});
