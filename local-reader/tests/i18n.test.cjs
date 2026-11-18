'use strict';
// 0.16 step 4: the interface exists in English and Turkish. These checks cover
// the dictionaries themselves, the keys used by every in-scope page and script,
// that the Turkish copy in the HTML is exactly the Turkish dictionary text, and
// the language module's own behaviour (default, saved choice, switch).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const DICTS=['web/i18n-return.js','web/i18n-workspace.js','web/i18n-map.js','web/i18n-canvas.js','web/i18n-thinkers.js','web/i18n-personality.js','web/i18n-opinions.js','local-reader/src/i18n-archive.js','local-reader/src/i18n-archive-tools.js'];
const PAGES={'web/return.html':'return','web/workspace.html':'workspace','web/map.html':'map','web/canvas.html':'canvas','web/thinkers.html':'thinkers','web/personality.html':'personality','web/opinions.html':'opinions','local-reader/src/shell.html':'archive'};
const SCRIPTS=['web/private-client.js','web/return.js','web/workspace.js','web/map.js','web/thinkers.js','web/personality.js','web/opinions.js','web/ideology.js',...fs.readdirSync(path.join(root,'local-reader/src')).filter(f=>f.endsWith('.js')).map(f=>'local-reader/src/'+f)];
// Names and marks that read the same in both languages.
const SAME=['Claude Code','Claude Desktop','töre','AI','MCP','ChatGPT','Claude','Codex','Cursor','Gemini','OpenRouter','JSON','Markdown','HTML','CSV','PDF','URL','ID','OK','EN','TR'];
const sameAllowed=value=>{let rest=JSON.stringify(value);for(const word of SAME)rest=rest.split(word).join('');rest=rest.replace(/\{\w+\}/g,'').replace(/"(one|other)"/g,'');return !/\p{L}/u.test(rest);};
const placeholders=value=>[...new Set([...JSON.stringify(value).matchAll(/\{(\w+)\}/g)].map(m=>m[1]))].sort();
const norm=s=>String(s).replace(/\s+/g,' ').trim();

function load({navigatorLanguage='tr-TR',html='<!doctype html><html lang="tr"><body></body></html>',url='http://127.0.0.1:18740/konular'}={}){
 const dom=new JSDOM(html,{runScripts:'outside-only',url});const w=dom.window;
 Object.defineProperty(w.navigator,'language',{value:navigatorLanguage,configurable:true});
 const origin=new Map();w.eval(read('web/i18n.js'));
 for(const k of Object.keys(w.toreI18n.entries()))origin.set(k,'web/i18n.js');
 const dupes=[];
 for(const file of DICTS){const before=new Set(Object.keys(w.toreI18n.entries()));const added=[];const add=w.toreI18n.add;w.toreI18n.add=e=>{added.push(...Object.keys(e));add(e);};w.eval(read(file));w.toreI18n.add=add;for(const k of added){if(before.has(k)||origin.has(k)&&origin.get(k)!==file)dupes.push(k+' ('+origin.get(k)+' / '+file+')');origin.set(k,file);}}
 return {dom,w,I:w.toreI18n,origin,dupes};
}

test('her sözlük girdisi iki dilde dolu, iki dilde farklı ve aynı yer tutucuları taşıyor',()=>{
 const {I,dupes,dom}=load();
 assert.deepEqual(dupes,[],'aynı anahtar iki dosyada tanımlı');
 const entries=I.entries(),problems=[];
 for(const [key,[tr,en]] of Object.entries(entries)){
  for(const [lang,v] of [['tr',tr],['en',en]]){
   if(typeof v==='string'){if(!v.trim())problems.push(key+': boş '+lang);}
   else if(v&&typeof v==='object'){if(typeof v.other!=='string'||!v.other.trim())problems.push(key+': '+lang+' other eksik');for(const f of Object.values(v))if(typeof f!=='string'||!f.trim())problems.push(key+': '+lang+' çoğul biçimi boş');}
   else problems.push(key+': '+lang+' metin değil');
  }
  if(JSON.stringify(tr)===JSON.stringify(en)&&!sameAllowed(tr))problems.push(key+': iki dilde aynı «'+JSON.stringify(tr)+'»');
  if(JSON.stringify(placeholders(tr))!==JSON.stringify(placeholders(en)))problems.push(key+': yer tutucular farklı '+placeholders(tr)+' / '+placeholders(en));
  if(/\btöre\.(?!\w)/.test(JSON.stringify(en)+JSON.stringify(tr))&&/"töre\."/.test(JSON.stringify([tr,en])))problems.push(key+': ad noktasız yazılır');
  if(/\bTöre\b/.test(typeof en==='string'?en:JSON.stringify(en)))problems.push(key+': İngilizcede ad küçük harfle "töre"');
 }
 for(const [message,en] of Object.entries(I.serverEntries())){if(!en.trim()||en===message)problems.push('sunucu: '+message);}
 assert.deepEqual(problems,[]);
 assert.ok(Object.keys(entries).length>200,'sözlük bütün sayfaları kapsamalı');
 dom.window.close();
});

test('HTML\'deki her data-i18n anahtarı sözlükte var ve Türkçe metin sözlükteki Türkçeyle birebir aynı',()=>{
 const {I,dom}=load(),entries=I.entries(),missing=[],changed=[];
 for(const [file] of Object.entries(PAGES)){
  const page=new JSDOM(read(file).replace('{{STYLE}}','').replace('{{SCRIPTS}}','').replace('{{LICENSES}}',''));const d=page.window.document;
  const keyOf=(el,attr)=>el.getAttribute(attr);
  for(const el of d.querySelectorAll('[data-i18n]')){const k=keyOf(el,'data-i18n');if(!entries[k]){missing.push(file+': '+k);continue;}if(el.children.length)changed.push(file+': '+k+' öğe içinde alt öğe var');const tr=entries[k][0];if(norm(el.textContent)!==norm(typeof tr==='string'?tr:tr.other))changed.push(file+': '+k+' «'+norm(el.textContent)+'» ≠ «'+norm(tr)+'»');}
  for(const el of d.querySelectorAll('[data-i18n-rich]')){const k=keyOf(el,'data-i18n-rich');if(!entries[k]){missing.push(file+': '+k);continue;}const probe=d.createElement('div');probe.setAttribute('data-i18n-rich',k);dom.window.document.body.append(dom.window.document.importNode(probe));I.applyI18n(dom.window.document.body);const rendered=dom.window.document.body.lastElementChild.innerHTML;dom.window.document.body.lastElementChild.remove();if(norm(el.innerHTML)!==norm(rendered))changed.push(file+': '+k+' «'+norm(el.innerHTML)+'» ≠ «'+norm(rendered)+'»');}
  for(const el of d.querySelectorAll('[data-i18n-attr]'))for(const pair of el.getAttribute('data-i18n-attr').split(';')){const [name,k]=pair.split(':').map(s=>s.trim());if(!entries[k]){missing.push(file+': '+k);continue;}if(norm(el.getAttribute(name))!==norm(entries[k][0]))changed.push(file+': '+name+'='+k+' «'+el.getAttribute(name)+'» ≠ «'+entries[k][0]+'»');}
  page.window.close();
 }
 assert.deepEqual(missing,[]);assert.deepEqual(changed,[]);
 dom.window.close();
});

test('sayfa betiklerinde adıyla geçen her anahtar sözlükte var',()=>{
 const {I,dom}=load(),entries=I.entries(),missing=[];
 for(const file of SCRIPTS){
  const text=read(file);
  for(const m of text.matchAll(/\b(?:tx|tn|clientText|toreI18n\.t|toreI18n\.n)\(\s*'([A-Za-z0-9_.-]+)'/g))if(!entries[m[1]])missing.push(file+': '+m[1]);
  for(const m of text.matchAll(/data-i18n(?:-rich)?="([A-Za-z0-9_.-]+)"/g))if(!entries[m[1]])missing.push(file+': '+m[1]);
 }
 assert.deepEqual(missing,[]);
 dom.window.close();
});

test('her sayfada tek bir EN | TR anahtarı var; dil modülü sayfa betiğinden önce yükleniyor ve sunucu dosyaları veriyor',()=>{
 const assets=read('server/src/assets.rs');
 for(const [file,name] of Object.entries(PAGES)){
  const html=read(file),page=new JSDOM(html.replace('{{STYLE}}','').replace('{{SCRIPTS}}','')),d=page.window.document;
  const groups=d.querySelectorAll('.lang-switch');assert.equal(groups.length,1,file);
  const buttons=[...groups[0].querySelectorAll('button[data-ui-lang]')];assert.deepEqual(buttons.map(b=>b.dataset.uiLang),['en','tr'],file);
  for(const b of buttons){assert.equal(b.type,'button');assert.ok(b.hasAttribute('aria-pressed'),file);}
  assert.ok(groups[0].closest('header,.app-topbar'),file+': anahtar üst çubukta olmalı');
  assert.ok(d.querySelector('title[data-i18n]'),file+': sayfa başlığı çevrilmeli');
  if(name!=='archive'){
   const srcs=[...d.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'));
   assert.ok(srcs.indexOf('/i18n.js')>=0&&srcs.indexOf('/i18n.js')<srcs.indexOf('/i18n-'+name+'.js'),file);
   assert.ok(srcs.indexOf('/i18n-'+name+'.js')<srcs.findIndex(s=>!s.startsWith('/i18n')),file);
   assert.ok(assets.includes('"i18n-'+name+'.js" => Some(')&&assets.includes('include_bytes!("../../web/i18n-'+name+'.js")'),file);
  }
  page.window.close();
 }
 assert.ok(assets.includes('"i18n.js" => Some('));
 // The archive inlines both files under its script hashes.
 for(const built of ['local-reader/Töre.html','local-reader/Hosted.html']){const html=read(built);assert.ok(html.includes('globalThis.toreI18n = {'),built);assert.ok(html.includes('Interface text for /arsiv'),built);}
});

test('kayıtlı seçim yoksa tarayıcı dili; kayıtlı seçim tarayıcıyı geçer; html lang seçimi izler',async()=>{
 for(const [nav,saved,want] of [['tr-TR',null,'tr'],['tr',null,'tr'],['en-US',null,'en'],['de-DE',null,'en'],['tr-TR','en','en'],['en-GB','tr','tr']]){
  const {w,I,dom}=load({navigatorLanguage:nav,html:'<!doctype html><html lang="tr"><body><p id="x" data-i18n="nav.topics">Konular</p><input id="y" placeholder="Konu adı" data-i18n-attr="placeholder:nav.map;aria-label:nav.waiting"></body></html>'});
  const calls=[];assert.equal(await I.init(async(op,body)=>{calls.push([op,body]);return {language:saved};}),want,nav+' '+saved);
  assert.equal(JSON.stringify(calls),JSON.stringify([['ui-language-get',{}]]));assert.equal(w.document.documentElement.lang,want);
  assert.equal(w.document.getElementById('x').textContent,want==='en'?'Topics':'Konular');
  assert.equal(w.document.getElementById('y').placeholder,want==='en'?'My map':'Haritam');assert.equal(w.document.getElementById('y').getAttribute('aria-label'),want==='en'?'Waiting for you':'Seni bekleyenler');
  dom.window.close();
 }
 // A service that cannot be reached still leaves a usable page in the browser language.
 const {I,dom}=load({navigatorLanguage:'en-US'});assert.equal(await I.init(async()=>{throw Error('offline');}),'en');dom.window.close();
});

test('EN | TR anahtarı seçimi sunucuya yazar, aria-pressed günceller ve sayfayı yerinde yeniden çizer',async()=>{
 const html='<!doctype html><html lang="tr"><body><header><span class="lang-switch"><button type="button" data-ui-lang="en" aria-pressed="false">EN</button><button type="button" data-ui-lang="tr" aria-pressed="true">TR</button></span></header><h1 data-i18n="nav.map">Haritam</h1></body></html>';
 const {w,I,dom}=load({navigatorLanguage:'tr-TR',html});const sets=[];let saved=null;
 await I.init(async(op,body)=>{if(op==='ui-language-set'){sets.push(body);saved=body.language;return body;}return {language:saved};});
 const [en,tr]=w.document.querySelectorAll('[data-ui-lang]');assert.equal(en.getAttribute('aria-pressed'),'false');assert.equal(tr.getAttribute('aria-pressed'),'true');
 const seen=[];I.onChange(l=>seen.push(l));
 en.click();await new Promise(r=>setTimeout(r,0));
 assert.equal(JSON.stringify(sets),JSON.stringify([{language:'en'}]));assert.equal(JSON.stringify(seen),'["en"]');assert.equal(w.document.documentElement.lang,'en');assert.equal(w.document.querySelector('h1').textContent,'My map');assert.equal(en.getAttribute('aria-pressed'),'true');assert.equal(tr.getAttribute('aria-pressed'),'false');
 en.click();await new Promise(r=>setTimeout(r,0));assert.equal(sets.length,1,'aynı dile geçiş yazmaz');
 // A guard (unsaved edits) keeps the current language and writes nothing.
 I.beforeChange(()=>false);tr.click();await new Promise(r=>setTimeout(r,0));assert.equal(sets.length,1);assert.equal(I.lang(),'en');
 dom.window.close();
});

test('sayılar ve yer tutucular: Türkçede sayıdan sonra tekil, İngilizcede çoğul',async()=>{
 const {I,dom}=load({navigatorLanguage:'en-US'});
 I.add({'test.records':['{n} kayıt',{one:'{n} record',other:'{n} records'}],'test.hello':['Merhaba {name}','Hello {name}']});
 await I.init(async()=>({language:null}));I.onChange(()=>{});
 assert.equal(I.n('test.records',1),'1 record');assert.equal(I.n('test.records',3),'3 records');assert.equal(I.n('test.records',0),'0 records');assert.equal(I.t('test.hello',{name:'<b>'}),'Hello <b>');assert.equal(I.t('test.hello'),'Hello {name}');
 await I.choose('tr');assert.equal(I.n('test.records',1),'1 kayıt');assert.equal(I.n('test.records',3),'3 kayıt');
 assert.equal(I.t('yok.böyle.bir.anahtar'),'yok.böyle.bir.anahtar');
 dom.window.close();
});

test('sunucu iletileri tam Türkçe metinle eşlenir; bilinmeyen ileti olduğu gibi kalır',async()=>{
 const {I,dom}=load({navigatorLanguage:'en-US'});await I.init(async()=>({language:'en'}));I.onChange(()=>{});
 assert.equal(I.server('Kayıt bulunamadı'),'This record is no longer in the notebook. Reload the page.');
 assert.equal(I.server('Kayıt bulunamadı.'),'This record is no longer in the notebook. Reload the page.');
 assert.equal(I.server('SENTETİK bilinmeyen hata'),'SENTETİK bilinmeyen hata');
 await I.choose('tr');assert.equal(I.server('Kayıt bulunamadı'),'Kayıt bulunamadı');
 dom.window.close();
});

test('zengin metin yalnız izinli etiketleri öğe yapar; gerisi düz metin kalır',async()=>{
 const {w,I,dom}=load({html:'<!doctype html><body><p id="p" data-i18n-rich="test.rich"></p></body>'});
 I.add({'test.rich':['<b>kalın</b> ve <img src=x onerror=alert(1)> <kbd>Tab</kbd>','<b>bold</b> and <img src=x onerror=alert(1)> <kbd>Tab</kbd>']});
 await I.init(async()=>({language:'en'}));const p=w.document.getElementById('p');
 assert.equal(p.querySelector('b').textContent,'bold');assert.equal(p.querySelector('kbd').textContent,'Tab');assert.equal(p.querySelector('img'),null);assert.match(p.textContent,/<img src=x/);
 dom.window.close();
});
