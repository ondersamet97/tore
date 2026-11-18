'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'web'),local=path.join(root,'local-reader');
const read=p=>fs.readFileSync(p,'utf8');
const MENU=[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']];

test('Arşiv ortak dört bağlantılı menüyü taşır, Konuşmalar altında durur ve Konularım\'a döner; sürüm yalnız sayfa altında',()=>{
 const d=new JSDOM(read(path.join(local,'src/shell.html'))).window.document;
 assert.equal(d.title,'töre — Arşiv');
 const bar=d.getElementById('app-topbar');
 assert.equal(bar.querySelector('.app-brand').getAttribute('href'),'/konular');
 assert.deepEqual([...bar.querySelectorAll('nav a')].map(a=>[a.textContent,a.getAttribute('href')]),MENU);
 assert.equal(bar.querySelector('nav [aria-current="page"]'),null);assert.equal(bar.querySelector('nav [aria-current="true"]').textContent,'Konuşmalar','Arşiv Konuşmalar bölümündedir');
 assert.equal(bar.querySelector('nav').getAttribute('aria-label'),'Ana gezinme');
 assert.equal(d.querySelectorAll('nav[aria-label="Ana gezinme"]').length,1,'tek ana gezinme');
 assert.equal(d.getElementById('back-to-topics').getAttribute('href'),'/konular');
 assert.doesNotMatch(bar.textContent+d.querySelector('header.top').textContent,/\d+\.\d+\.\d+/,'üstte sürüm yok');
 assert.match(d.querySelector('.archive-version').textContent,/^töre \d+\.\d+\.\d+$/);
 assert.equal(d.getElementById('nav-thinkers').textContent,'Düşünür profilleri','menüdeki Düşünürler ile karışmaz');
 // The bar links only work when served; the hosted start shows them.
 assert.equal(bar.hidden,true);assert.match(read(path.join(local,'src/app.js')),/\$\('app-topbar'\)\.hidden=false;\$\('back-to-topics'\)\.hidden=false;/);
 for(const built of ['Hosted.html','Töre.html'])assert.ok(read(path.join(local,built)).includes('id="app-topbar"'),built+' yeniden derlendi');
});

test('eski sayfalar markayla ve geri bağlantıyla Konularım\'a döner; eski sürüm yazısı yok',()=>{
 for(const page of ['index.html','sources.html','assistant.html','video.html']){
  const html=read(path.join(web,page)),d=new JSDOM(html).window.document;
  assert.doesNotMatch(html,/0\.[5-7]\.0/,page+' eski sürüm yazısı');
  assert.equal(d.querySelector('.brand').getAttribute('href'),'/konular',page+' marka');
  assert.ok(d.querySelector('a[href="/konular"]:not(.brand)'),page+' geri bağlantı');
  assert.equal(d.querySelector('a[href="/"]'),null,page+' eski ana sayfa bağlantısı');
  assert.match(d.title,/^töre — /,page+' başlık');
 }
});

test('eski sayfa ve Arşiv biçemleri: okunur yazı, görünür alan sınırı, sarılan menü, hareket azaltma, okunur devre dışı düğme',()=>{
 const files={'web/style.css':/\.topbar\{flex-wrap:wrap/,'web/sources.css':/header nav\{flex-wrap:wrap/,'web/video.css':/nav\{[^}]*flex-wrap:wrap/,'local-reader/src/style.css':/\.main-nav\{flex-wrap:wrap/};
 for(const [file,wrap] of Object.entries(files)){
  const css=read(path.join(root,file));
  assert.match(css,wrap,file+' menü sarar');
  assert.match(css,/prefers-reduced-motion:reduce/,file+' hareket azaltma');
  for(const m of css.matchAll(/font(?:-size)?:(?:\d{3} )?(\d+(?:\.\d+)?)px/g))assert.ok(Number(m[1])>=13,file+' '+m[0]);
  for(const m of css.matchAll(/font(?:-size)?:(?:\d{3} )?(\.\d+)rem/g))assert.ok(Number(m[1])>=0.8125,file+' '+m[0]);
  assert.doesNotMatch(css,/url\(\s*['"]?https?:|@import\s+url\(\s*['"]?https?:/,file+' dış kaynak');
 }
 for(const file of ['web/style.css','web/sources.css','web/video.css','local-reader/src/style.css']){
  const css=read(path.join(root,file));
  assert.match(css,/button:disabled[^{]*\{opacity:1;/,file+' devre dışı düğme soluklaştırılmaz');
  assert.match(css,/(textarea,select|select,textarea)\{border-color:(#6f8674|var\(--field-line\));font-size:16px\}/,file+' alan sınırı ve 16 px girdi');
  assert.match(css,/::placeholder\{color:var\(--muted\)/,file+' yer tutucu');
 }
 for(const file of ['web/sources.css','web/video.css','local-reader/src/style.css'])assert.match(read(path.join(root,file)),/--field-line:#7d8c7a\}[\s\S]*prefers-color-scheme:dark\)\{:root\{--field-line:#6f8674\}/,file);
});

test('her sayfanın üst menüsü aynı dört öğedir; alt sayfa kendi bölümünü işaretler, Düşünürler ve Arşiv ikincil bağlantıdır',()=>{
 const pages={'web/return.html':['Konular','page'],'web/canvas.html':['Haritam','page'],'web/map.html':['Haritam','true'],'web/thinkers.html':['Haritam','true'],'web/workspace.html':['Konuşmalar','page'],'web/opinions.html':['Konular','true'],'local-reader/src/shell.html':['Konuşmalar','true']};
 for(const [file,[current,kind]] of Object.entries(pages)){
  const d=new JSDOM(read(path.join(root,file))).window.document,nav=d.querySelector('nav[aria-label="Ana gezinme"]');
  assert.equal(d.querySelectorAll('nav[aria-label="Ana gezinme"]').length,1,file);
  assert.deepEqual([...nav.querySelectorAll('a')].map(a=>[a.firstChild.textContent,a.getAttribute('href')]),MENU,file+' dört öğe');
  assert.equal(nav.querySelectorAll('button').length,0,file);
  const marked=[...nav.querySelectorAll('[aria-current]')];assert.equal(marked.length,1,file+' tek işaret');
  assert.deepEqual([marked[0].textContent,marked[0].getAttribute('aria-current')],[current,kind],file);
 }
 const sub=file=>[...new JSDOM(read(path.join(root,file))).window.document.querySelectorAll('.subnav a')].map(a=>a.getAttribute('href'));
 assert.ok(sub('web/map.html').includes('/dusunurler'),'Haritam → Düşünürler');assert.ok(sub('web/workspace.html').includes('/arsiv'),'Konuşmalar → Arşiv');
});

// 0.16: Töre.html opened as a file has no server to remember the choice, so the
// browser language decides and the switch redraws in place; the switch sits next
// to the title because the shared top bar stays hidden there.
test('dosyadan açılan Töre.html tarayıcı diliyle açılır; EN | TR başlığın yanında ve yerinde yeniden çizer',async()=>{
 const html=read(path.join(local,'Töre.html'));
 for(const [navigatorLanguage,lang] of [['en-US','en'],['tr-TR','tr']]){
  const dom=new JSDOM(html,{url:'file:///synthetic/T%C3%B6re.html',runScripts:'dangerously',beforeParse(w){Object.defineProperty(w,'isSecureContext',{value:false});Object.defineProperty(w.navigator,'language',{value:navigatorLanguage,configurable:true});w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};}});
  const w=dom.window,d=w.document,$=id=>d.getElementById(id);
  for(let i=0;i<50&&d.documentElement.lang!==lang;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(d.documentElement.lang,lang);assert.equal($('app-topbar').hidden,true);
  const sw=d.querySelectorAll('.lang-switch');assert.equal(sw.length,1);assert.ok(sw[0].closest('header.top .brand'),'anahtar başlığın yanında');
  if(lang==='en'){
   assert.equal(d.title,'töre — Archive');assert.equal(d.querySelector('header.top h1').textContent,'Archive');assert.equal($('choose').textContent,'Choose data folder');assert.equal($('folder').textContent,'No data folder chosen yet');
   assert.equal($('nav-reports').textContent,'Reports');assert.equal($('list').textContent,'Choose your data folder to open the archive.');assert.match($('status').textContent,/File System Access API is not available/);
   assert.equal(d.querySelector('#welcome h2').innerHTML,'Make room for<br>your thinking again.');assert.equal(d.querySelector('#welcome li strong').textContent,'Choose the data folder.');
   // No server: the switch still works for this page.
   d.querySelector('[data-ui-lang="tr"]').click();for(let i=0;i<50&&d.documentElement.lang!=='tr';i++)await new Promise(r=>setTimeout(r,5));
   assert.equal(d.documentElement.lang,'tr');assert.equal($('choose').textContent,'Veri klasörünü seç');assert.match($('status').textContent,/File System Access API kullanılamıyor/);assert.equal(d.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'true');
  }else{
   assert.equal(d.title,'töre — Arşiv');assert.equal($('choose').textContent,'Veri klasörünü seç');assert.equal($('folder').textContent,'Henüz bir veri klasörü seçilmedi');assert.equal($('list').textContent,'Arşivi açmak için veri klasörünüzü seçin.');
  }
  dom.window.close();
 }
});
