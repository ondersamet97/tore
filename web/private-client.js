// Only the ephemeral loopback capability is kept in this tab; documents stay on disk.
const key='tore-local-session', fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('davet')){sessionStorage.setItem('tore-bootstrap-invite',fragment.get('davet'));fragment.delete('davet');}
if(fragment.has('local')){const token=fragment.get('local');if(/^[a-f0-9]{64}$/.test(token))sessionStorage.setItem(key,token);fragment.delete('local');history.replaceState(null,'',location.pathname+location.search+(fragment.size?'#'+fragment:''));}
export async function api(path,payload=undefined){
 const token=sessionStorage.getItem(key);if(!token)throw Error('Yerel oturum açık değil. Demo Başlat.command dosyasını yeniden açın; arşiv dosyalarınız korunur.');
 const response=await fetch(path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),credentials:'omit',cache:'no-store',redirect:'error'});
 let result;try{result=await response.json();}catch{throw Error('Yerel hizmet geçerli yanıt vermedi. Demo Başlat.command dosyasını yeniden açın.');}
 if(!response.ok){const error=Error(result.error||result.message||'İşlem tamamlanamadı; başarı bildirilmedi.');error.code=result.code;error.status=response.status;throw error;}return result;
}
export function fs(op,path,extra={}){return api('/api/private/fs',typeof op==='object'?op:{op,path,...extra});}
const decode=base64=>{const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;};
const encode=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(raw);};
export async function readJson(path,fallback=null){
 let result;try{result=await fs('read',path);}catch(error){if(error.status===404)return {document:structuredClone(fallback),sha256:null};throw error;}
 let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(result.bytes)));}catch{throw Error(path+' okunamıyor: UTF-8 veya JSON bozuk. Dosya sıfırlanmadı.');}return {document,sha256:result.sha256};
}
let queue=Promise.resolve();
export function saveJson(path,document,baselineSha){
 const run=queue.then(async()=>{
  const data=encode(new TextEncoder().encode(JSON.stringify(document,null,2)+'\n'));
  let previous;try{previous=await fs('read',path);}catch(error){if(error.status!==404)throw error;previous=null;}
  if((previous?.sha256??null)!==baselineSha)throw Error('Dosya başka bir işlemde değişmiş. Sayfayı yeniden açın; üzerine yazılmadı.');
  if(previous){const backup=path.replace(/\.json$/,'.onceki.json');let old;try{old=await fs('read',backup);}catch(error){if(error.status!==404)throw error;old=null;}await fs('write',backup,{data:previous.bytes,expectedSha256:old?.sha256??null});}
  const written=await fs('write',path,{data,expectedSha256:baselineSha});const check=await fs('read',path);if(check.sha256!==written.sha256)throw Error('Yazma doğrulaması başarısız. Başarı bildirimi verilmedi.');return written.sha256;
 });queue=run.catch(()=>{});return run;
}
export function download(data,filename,mime='application/octet-stream'){
 const blob=data instanceof Blob?data:new Blob([data],{type:mime}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),30000);
}
export function decodeBytes(value){return decode(value);}

// Explicit application lifecycle; closing a tab alone leaves the native service running.
const footer=document.createElement('footer'),closeButton=document.createElement('button'),closeStatus=document.createElement('p');closeButton.type='button';closeButton.textContent='Uygulamayı kapat';closeStatus.setAttribute('role','status');closeButton.onclick=async()=>{closeButton.disabled=true;try{const r=await api('/api/private/shutdown',{});closeStatus.textContent=r.message;}catch(e){closeStatus.textContent=e.message;closeButton.disabled=false;}};footer.append(closeButton,closeStatus);document.body.append(footer);
