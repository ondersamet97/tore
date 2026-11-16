/* Yalnızca geliştirme: son kullanıcı Töre.html dosyasını açar. */
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const root=__dirname;
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sha=s=>"'sha256-"+crypto.createHash('sha256').update(s).digest('base64')+"'";
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const sources=['vendor/marked-18.2.0.js','vendor/dompurify-3.4.17.js','src/profiles.js','src/comparisons.js','src/reading.js','src/thought-tools.js','src/extras.js','src/storage.js','src/reader.js'];
const common=sources.map(p=>escapeScript(read(p)));
function csp(scripts,style='',hosted=false) {return "default-src 'none'; script-src "+scripts.map(sha).join(' ')+"; style-src "+(style?sha(style):"'none'")+"; connect-src "+(hosted?"'self'":"'none'")+"; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";}
const scripts=[...common,escapeScript(read('src/thinkers.js')),escapeScript(read('src/share-draft.js')),escapeScript(read('src/profile-ui.js')),escapeScript(read('src/comparison-ui.js')),escapeScript(read('src/reading-ui.js')),escapeScript(read('src/app.js'))];
const style=read('src/style.css')+'\n'+read('src/reading.css')+'\n'+read('src/thought-tools.css');
const licenses=('Marked 18.2.0\n'+read('vendor/marked-LICENSE.md')+'\nDOMPurify 3.4.17\n'+read('vendor/DOMPurify-LICENSE')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const html=read('src/shell.html').replace('{{CSP}}',csp(scripts,style)).replace('{{STYLE}}',style).replace('{{LICENSES}}',licenses).replace('{{SCRIPTS}}',scripts.map(s=>'<script>'+s+'</script>').join('\n'));
const hostedScripts=[...scripts.slice(0,-1),escapeScript(read('src/remote-fs.js')),scripts.at(-1)];
const hostedHTML=read('src/shell.html').replace('{{CSP}}',csp(hostedScripts,style,true)).replace('{{STYLE}}',style).replace('{{LICENSES}}',licenses).replace('{{SCRIPTS}}',hostedScripts.map(s=>'<script>'+s+'</script>').join('\n'));
fs.writeFileSync(path.join(root,'Hosted.html'),hostedHTML);
fs.writeFileSync(path.join(root,'Töre.html'),html);
fs.writeFileSync(path.join(root,'..','Töre.html'),html);
if(fs.existsSync(path.join(root,'tests/browser-harness.js'))) {
  const runner=`document.getElementById('run').onclick=async()=>{const out=document.getElementById('out');out.textContent='';try{const d=await showDirectoryPicker({mode:'readwrite'});const result=await runDiskTests(d,s=>{out.textContent+=s+'\\n'});const json=JSON.stringify({userAgent:navigator.userAgent,date:new Date().toISOString(),url:location.href,results:result},null,2);const f=await d.getFileHandle('browser-results.json',{create:true});const w=await f.createWritable();await w.write(json);await w.close();out.textContent+='\\nSONUÇLAR: '+result.filter(r=>r.status==='PASS').length+'/'+result.length+' PASS; browser-results.json diske yazıldı.';}catch(e){out.textContent+=e.name+': '+e.message;}};`;
  const hs=[...common,escapeScript(read('tests/browser-harness.js')),runner];
  fs.writeFileSync(path.join(root,'tests/Disk-Testi.html'),`<!doctype html><html lang="tr"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp(hs)}"><title>Töre sentetik disk testleri</title><h1>Töre — sentetik disk testleri</h1><p>Yalnızca boş test klasörünü seçin. Gerçek arşivinizi seçmeyin.</p><button id="run">Test klasörünü seç ve testleri başlat</button><pre id="out"></pre><article id="article"></article><nav id="toc"></nav>${hs.map(s=>'<script>'+s+'</script>').join('\n')}</html>`);
}
if(fs.existsSync(path.join(root,'tests/profile-browser-harness.js'))) {
  const runner=`document.getElementById('run').onclick=async()=>{const out=document.getElementById('out');out.textContent='';try{const d=await showDirectoryPicker({mode:'readwrite'});const result=await runProfileTests(d,s=>{out.textContent+=s+'\\n'});const f=await d.getFileHandle('profile-browser-results.json',{create:true});const w=await f.createWritable();await w.write(JSON.stringify({userAgent:navigator.userAgent,date:new Date().toISOString(),results:result},null,2));await w.close();out.textContent+='\\nBİTTİ — '+result.filter(r=>r.status==='PASS').length+'/'+result.length+' geçti. Sonuç dosyası diske yazıldı.';}catch(e){out.textContent+=e.name+': '+e.message;}};`;
  const hs=[...common,escapeScript(read('tests/profile-browser-harness.js')),runner];
  fs.writeFileSync(path.join(root,'tests/Profil-Testi.html'),`<!doctype html><html lang="tr"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp(hs)}"><title>Töre profil ve uyumluluk testleri</title><h1>Töre — sentetik profil ve arşiv testleri</h1><p>Yalnızca test için ayırdığınız klasörü seçin.</p><button id="run">Test klasörünü seç ve başlat</button><pre id="out"></pre>${hs.map(s=>'<script>'+s+'</script>').join('\n')}</html>`);
}
console.log('Töre.html oluşturuldu ('+Buffer.byteLength(html)+' bayt).');
