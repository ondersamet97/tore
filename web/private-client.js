// Only the ephemeral loopback capability is kept in this tab; documents stay on disk.
const key='tore-local-session', fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('davet')){sessionStorage.setItem('tore-bootstrap-invite',fragment.get('davet'));fragment.delete('davet');}
if(fragment.has('local')){const token=fragment.get('local');if(/^[a-f0-9]{64}$/.test(token))sessionStorage.setItem(key,token);fragment.delete('local');history.replaceState(null,'',location.pathname+location.search+(fragment.size?'#'+fragment:''));}
const REOPEN='töre\'yi Başlat.command ile yeniden aç; dosyaların yerinde duruyor.';
// Known service messages, reworded so they say what happened and what to do next.
// Anything not listed here is shown unchanged.
const KNOWN={
 'Konu deposu dışarıdan değişmiş; üzerine yazılmadı':'Defter başka bir pencerede değişti. Sayfayı yenile; yazdıkların kaybolmadı.',
 'Konu deposu başka bir Töre sürecinde açık':'Defter başka bir töre penceresinde açık. Öbürünü kapat, sonra sayfayı yenile.',
 'Konu deposu yazma hatasından sonra kilitlendi; yeniden açın':'Defter bir yazma hatasından sonra kilitlendi. '+REOPEN,
 'Konu deposu bozuk; sıfırlanmadı':'Defter dosyası okunamadı. Hiçbir şey silinmedi; Konularım\'daki yedeklerinden birine dönebilirsin.',
 'Konu deposu bozuk; okunmadı':'Defter dosyası okunamadı. Hiçbir şey silinmedi; Konularım\'daki yedeklerinden birine dönebilirsin.',
 'Konu deposu değişti; geri alma önizlemesini yenileyin':'Defter bu arada değişti. Önizlemeyi yenile, sonra yeniden dene.',
 'Kayıt değişmiş; yeniden yükleyin':'Bu kayıt başka bir pencerede değişti. Sayfayı yenile, sonra yeniden dene.',
 'Kaydın konusu değişmiş; incelemeden önce yeniden yükleyin':'Kaydın konusu değişmiş. Sayfayı yenile, sonra yeniden dene.',
 'Kayıt bulunamadı':'Bu kayıt artık defterde yok. Sayfayı yenile.',
 'Konu bulunamadı':'Bu konu artık defterde yok. Sayfayı yenile.',
 'Kayıt içeriği veya durumları geçersiz':'Kayıt bu hâliyle kaydedilemedi. Metni ve seçtiğin durumları gözden geçirip yeniden dene.',
 'İstek kimliği başka içerik için kullanılmış':'Bu işlem az önce başka bir içerikle gönderilmiş. Sayfayı yenile, sonra yeniden dene.',
 'Harita girdisi bulunamadı':'Bu kayıt artık haritada yok. Sayfayı yenile.',
 'Haritadaki kayıt bulunamadı':'Bu kayıt artık haritada yok. Sayfayı yenile.',
 'Harita girdisi sınırı aşıldı':'Haritaya daha fazla kayıt sığmıyor. Önce birkaçını haritadan çıkar.',
 'Önce bu girdiye bağlı itiraz, cevap ve ölçütleri çıkarın':'Önce bu kayda bağlı itiraz, cevap ve ölçütleri haritadan çıkar.',
 'Bağlantı bulunamadı':'Bu bağlantı artık yok. Sayfayı yenile.',
 'Düşünür bağlantısı sınırı aşıldı':'Daha fazla bağlantı kurulamıyor. Önce birkaçını kaldır.',
 'Devam paketi bulunamadı':'Bu devam metni artık yok. Sayfayı yenile.',
};
export function explain(message){const text=String(message||'').trim();return KNOWN[text]||KNOWN[text.replace(/\.$/,'')]||text;}
export async function api(path,payload=undefined){
 const token=sessionStorage.getItem(key);if(!token)throw Error('töre\'nin bağlantısı kopmuş. '+REOPEN);
 let response;try{response=await fetch(path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),credentials:'omit',cache:'no-store',redirect:'error'});}
 catch(error){if(error instanceof TypeError)throw Error('töre\'ye ulaşılamıyor. '+REOPEN);throw error;}
 let result;try{result=await response.json();}catch{throw Error('töre beklenmeyen bir yanıt verdi. '+REOPEN);}
 if(!response.ok){const raw=result.error||result.message||'',error=Error(explain(raw)||'İşlem tamamlanamadı. Sayfayı yenileyip yeniden dene.');error.serverMessage=raw;error.code=result.code;error.status=response.status;throw error;}return result;
}
export function fs(op,path,extra={}){return api('/api/private/fs',typeof op==='object'?op:{op,path,...extra});}
const decode=base64=>{const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;};
const encode=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(raw);};
export async function readJson(path,fallback=null){
 let result;try{result=await fs('read',path);}catch(error){if(error.status===404)return {document:structuredClone(fallback),sha256:null};throw error;}
 let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(result.bytes)));}catch{throw Error(path+' okunamıyor; dosya bozuk görünüyor. Hiçbir şey silinmedi.');}return {document,sha256:result.sha256};
}
let queue=Promise.resolve();
export function saveJson(path,document,baselineSha){
 const run=queue.then(async()=>{
  const data=encode(new TextEncoder().encode(JSON.stringify(document,null,2)+'\n'));
  let previous;try{previous=await fs('read',path);}catch(error){if(error.status!==404)throw error;previous=null;}
  if((previous?.sha256??null)!==baselineSha)throw Error('Dosya başka bir pencerede değişti; üzerine yazılmadı. Sayfayı yenile.');
  if(previous){const backup=path.replace(/\.json$/,'.onceki.json');let old;try{old=await fs('read',backup);}catch(error){if(error.status!==404)throw error;old=null;}await fs('write',backup,{data:previous.bytes,expectedSha256:old?.sha256??null});}
  const written=await fs('write',path,{data,expectedSha256:baselineSha});const check=await fs('read',path);if(check.sha256!==written.sha256)throw Error('Yazılan dosya doğrulanamadı. Sayfayı yenileyip yeniden dene.');return written.sha256;
 });queue=run.catch(()=>{});return run;
}
export function download(data,filename,mime='application/octet-stream'){
 const blob=data instanceof Blob?data:new Blob([data],{type:mime}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),30000);
}
export function decodeBytes(value){return decode(value);}

// Explicit application lifecycle; closing a tab alone leaves the native service running.
// Closing asks once more in place, because it stops every open töre tab.
const footer=document.createElement('footer'),closeButton=document.createElement('button'),cancelButton=document.createElement('button'),closeStatus=document.createElement('p'),versionLine=document.createElement('p');
footer.className='app-footer';closeButton.type='button';closeButton.className='app-close';closeButton.textContent='Uygulamayı kapat';
cancelButton.type='button';cancelButton.className='app-close-cancel';cancelButton.textContent='Vazgeç';cancelButton.hidden=true;
closeStatus.setAttribute('role','status');closeStatus.className='app-close-status';versionLine.className='app-version';versionLine.hidden=true;
let closeArmed=false;
const disarm=()=>{closeArmed=false;closeButton.textContent='Uygulamayı kapat';cancelButton.hidden=true;};
cancelButton.onclick=()=>{disarm();closeStatus.textContent='';closeButton.focus();};
closeButton.onclick=async()=>{
 if(!closeArmed){closeArmed=true;closeButton.textContent='Evet, kapat';cancelButton.hidden=false;closeStatus.textContent='Kapatılsın mı? Dosyaların yerinde kalır.';return;}
 closeButton.disabled=true;cancelButton.hidden=true;
 try{await api('/api/private/shutdown',{});closeArmed=false;closeButton.textContent='Uygulama kapandı';closeStatus.textContent='töre kapanıyor. Dosyaların yerinde. Yeniden açmak için Başlat.command dosyasına çift tıkla.';}
 catch(e){disarm();closeStatus.textContent=e.message;closeButton.disabled=false;}
};
footer.append(closeButton,cancelButton,closeStatus,versionLine);document.body.append(footer);
// One quiet line with the running version. It is asked for only when the footer
// is actually on screen, so opening a page makes no extra request by itself.
let versionAsked=false;
async function showVersion(){
 if(versionAsked||!sessionStorage.getItem(key))return;versionAsked=true;
 try{const info=await api('/api/private/tore/status',{});if(typeof info.version==='string'&&/^[0-9A-Za-z.+-]{1,32}$/.test(info.version)){versionLine.textContent='töre '+info.version;versionLine.hidden=false;}}catch{/* no line when the version is unknown */}
}
if(typeof IntersectionObserver==='function'){const watch=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){watch.disconnect();showVersion();}});watch.observe(footer);}
