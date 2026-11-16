const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');
function reader(){
  const requests=[];
  class BlockNetwork extends ResourceLoader{fetch(url){requests.push(url);return null;}}
  const dom=new JSDOM('<article id="article"></article><nav id="toc"></nav>',{url:'file:///Törü.html',runScripts:'outside-only',resources:new BlockNetwork(),virtualConsole:new VirtualConsole()});
  for(const p of ['vendor/marked-18.2.0.js','vendor/dompurify-3.4.17.js','src/reader.js'])dom.window.eval(fs.readFileSync(path.join(root,p),'utf8'));
  const w=dom.window;return {w,requests,render:text=>w.ToruReader.render(text,w.document.getElementById('article'),w.document.getElementById('toc'))};
}
test('GFM Türkçe başlık, tablo, alıntı, liste, kod ve içindekiler',()=>{
  const {w,render}=reader();render(fs.readFileSync(path.join(root,'ornekler/TEST - Türkçe Okuma.md'),'utf8'));
  for(const tag of ['h1','h2','table','blockquote','li','pre','code','strong','em'])assert.ok(w.document.querySelector('article '+tag),tag);
  assert.match(w.document.querySelector('article').textContent,/ı, İ, ş, ğ, ü, ö, ç/);
  assert.equal(w.document.getElementById('toc').hidden,false);
  assert.equal(w.document.querySelectorAll('#toc button').length,5);
  assert.equal(w.ToruReader.fold('İSTANBUL IŞIK ÖĞRENİM'),'istanbul ışık öğrenim');
});
test('Güvenilmeyen HTML, protokol, öznitelik ve otomatik kaynaklar engellenir',()=>{
  const {w,render,requests}=reader();render(fs.readFileSync(path.join(root,'ornekler/TEST - Güvenilmeyen İçerik.md'),'utf8')+'\n<svg><a xlink:href="javascript:alert(1)">x</a></svg>\n\n[x](data:text/html;base64,PHNjcmlwdD4=)\n\n[x](//example.invalid)');
  assert.equal(w.TORU_XSS,undefined);
  assert.equal(w.document.querySelector('article script,article img,article iframe,article style,article svg,article object,article input,article link'),null);
  for(const e of w.document.querySelectorAll('article *'))for(const a of e.attributes)assert.ok(!/^(on|style|src|srcset)/i.test(a.name),a.name);
  const links=[...w.document.querySelectorAll('article a')];assert.equal(links.length,1);assert.equal(links[0].protocol,'https:');assert.equal(links[0].target,'_blank');assert.equal(links[0].rel,'noopener noreferrer');
  assert.match(w.document.querySelector('article').textContent,/Görsel yüklenmedi/);assert.deepEqual(requests,[]);
});
test('Başlık/URL içeren kaçış saldırıları düz metin kalır',()=>{
  const {w,render}=reader();render('![<img src=x onerror=alert(1)>](https://example.invalid)\n\n[a](javascript:alert%281%29)\n\n## <script>alert(1)</script>');
  assert.equal(w.document.querySelector('article img,article script'),null);
  assert.match(w.document.querySelector('article').textContent,/img src=x/);
});
test('Teori çıktısı UTF-8 Markdown olarak okuyucuda açılır',()=>{
  const {w,render}=reader();const name=fs.readdirSync(path.join(root,'ornekler')).find(n=>n.startsWith('Okuma Grubu'));
  assert.ok(name);const data=fs.readFileSync(path.join(root,'ornekler',name));const text=new TextDecoder('utf-8',{fatal:true}).decode(data);render(text);
  assert.equal(w.document.querySelector('article h1').textContent,name.slice(0,-3));assert.ok(w.document.querySelectorAll('article h2').length>=3);
});
test('Hazır HTML hash CSP ile bağımlılıklarını içerir; depolama ve ağ API yok',()=>{
  const html=fs.readFileSync(path.join(root,'Töre.html'),'utf8');
  assert.ok(!/\{\{(?:CSP|STYLE|SCRIPTS)\}\}/.test(html));assert.match(html,/connect-src 'none'/);assert.match(html,/img-src 'none'/);
  assert.ok(!/<script[^>]+src=/i.test(html));assert.ok(!/<link\b/i.test(html));assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
  const crypto=require('node:crypto');
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.ok(html.includes(crypto.createHash('sha256').update(m[1]).digest('base64')));
  assert.doesNotMatch(html,/Törü|Törre/);
  for(const file of ['src/app.js','src/storage.js','src/reader.js','src/profiles.js','src/profile-ui.js','src/thinkers.js'])assert.ok(!/\b(?:localStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|sendBeacon|serviceWorker)\b/.test(fs.readFileSync(path.join(root,file),'utf8')),file);
});
