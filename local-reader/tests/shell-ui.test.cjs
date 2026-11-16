'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'web'),local=path.join(root,'local-reader');
const read=p=>fs.readFileSync(p,'utf8');
const MENU=[['Konularım','/konular'],['Haritam','/harita'],['Düşünürler','/dusunurler'],['Konuşmalarım','/calisma'],['Arşiv','/arsiv']];

test('Arşiv ortak beş bağlantılı menüyü ve Konularım\'a dönüşü taşır; sürüm yalnız sayfa altında',()=>{
 const d=new JSDOM(read(path.join(local,'src/shell.html'))).window.document;
 assert.equal(d.title,'töre — Arşiv');
 const bar=d.getElementById('app-topbar');
 assert.equal(bar.querySelector('.app-brand').getAttribute('href'),'/konular');
 assert.deepEqual([...bar.querySelectorAll('nav a')].map(a=>[a.textContent,a.getAttribute('href')]),MENU);
 assert.equal(bar.querySelector('nav [aria-current="page"]').textContent,'Arşiv');
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
 for(const page of ['index.html','sources.html','integrations.html','assistant.html','video.html']){
  const html=read(path.join(web,page)),d=new JSDOM(html).window.document;
  assert.doesNotMatch(html,/0\.[5-7]\.0/,page+' eski sürüm yazısı');
  assert.equal(d.querySelector('.brand').getAttribute('href'),'/konular',page+' marka');
  assert.ok(d.querySelector('a[href="/konular"]:not(.brand)'),page+' geri bağlantı');
  assert.equal(d.querySelector('a[href="/"]'),null,page+' eski ana sayfa bağlantısı');
  assert.match(d.title,/^töre — /,page+' başlık');
 }
});

test('eski sayfa ve Arşiv biçemleri: okunur yazı, görünür alan sınırı, sarılan menü, hareket azaltma, okunur devre dışı düğme',()=>{
 const files={'web/style.css':/\.topbar\{flex-wrap:wrap/,'web/sources.css':/header nav\{flex-wrap:wrap/,'web/video.css':/nav\{[^}]*flex-wrap:wrap/,'web/integrations.css':/\.integration-top\{flex-wrap:wrap/,'local-reader/src/style.css':/\.main-nav\{flex-wrap:wrap/};
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
