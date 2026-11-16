/* Yerel Rust sürecinin izin verilen veri kökü. Ana veri tarayıcıda tutulmaz. */
(() => {
  'use strict';
  const key='tore-local-session', params=new URLSearchParams(location.hash.slice(1));
  let token=params.get('local')||'', setupError='';
  const bootstrapInvite=params.get('davet');
  if(bootstrapInvite){try{sessionStorage.setItem('tore-bootstrap-invite',bootstrapInvite);}catch(_){}params.delete('davet');}
  if(token){
    params.delete('local');history.replaceState(null,'',location.pathname+location.search+(params.size?'#'+params:''));
    try{sessionStorage.setItem(key,token);}catch(_){setupError='Bu sekme yerel bağlantı iznini saklayamadı. Töre.app ile yeniden açın.';}
  }else{if(bootstrapInvite)history.replaceState(null,'',location.pathname+location.search+(params.size?'#'+params:''));try{token=sessionStorage.getItem(key)||'';}catch(_){}}
  const fail=(name,text)=>new DOMException(text,name);
  const component=name=>{if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\\/\0]/.test(name))throw fail('SecurityError','Geçersiz yerel dosya adı.');return name;};
  const child=(parent,name)=>parent?parent+'/'+component(name):component(name);
  const decode=value=>{const s=atob(value),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;};
  const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
  async function request(op,path,extra={}){
    if(!token)throw fail('NotAllowedError',setupError||'Yerel arşiv bağlantısı eksik. Töre’yi Töre.app ile açın.');
    let response;
    try{response=await fetch('/api/private/fs',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({op,path,...extra})});}
    catch(_){throw fail('NetworkError','Yerel Töre sürecine ulaşılamadı. Töre.app açık olmalı; kaydedildi bildirimi verilmedi.');}
    let data;try{data=await response.json();}catch(_){throw fail('UnknownError','Yerel dosya yanıtı okunamadı.');}
    if(!response.ok)throw fail(data.code||'UnknownError',data.error||'Yerel dosya işlemi tamamlanamadı.');
    return data;
  }
  class RemoteFile{
    constructor(path){this.path=path;this.name=path.split('/').at(-1);this.kind='file';}
    async getFile(){const r=await request('read',this.path);return new File([decode(r.bytes)],this.name,{type:'application/octet-stream'});}
    async createWritable(){
      const baseline=await request('read',this.path);let bytes=new Uint8Array(),closed=false;
      return {
        async write(value){if(closed)throw fail('InvalidStateError','Dosya yazıcısı kapandı.');if(value instanceof Blob)bytes=new Uint8Array(await value.arrayBuffer());else if(typeof value==='string')bytes=new TextEncoder().encode(value);else if(value instanceof ArrayBuffer)bytes=new Uint8Array(value.slice(0));else if(ArrayBuffer.isView(value))bytes=new Uint8Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));else throw fail('TypeMismatchError','Desteklenmeyen yazma verisi.');},
        close:async()=>{if(closed)throw fail('InvalidStateError','Dosya yazıcısı kapandı.');await request('write',this.path,{data:encode(bytes),expectedSha256:baseline.sha256});closed=true;},
        async abort(){closed=true;bytes=new Uint8Array();}
      };
    }
  }
  class RemoteDir{
    constructor(path=''){this.path=path;this.name=path?path.split('/').at(-1):'Töre Verileri';this.kind='directory';}
    async queryPermission(){return token?'granted':'denied';}
    async requestPermission(){return this.queryPermission();}
    async getFileHandle(name,{create=false}={}){const path=child(this.path,name);if(create)await request('touch',path);else await request('read',path);return new RemoteFile(path);}
    async getDirectoryHandle(name,{create=false}={}){const path=child(this.path,name);if(create)await request('mkdir',path);else await request('list',path);return new RemoteDir(path);}
    async *entries(){const result=await request('list',this.path);for(const e of result.entries){component(e.name);if(!['directory','file'].includes(e.kind))throw fail('TypeMismatchError','Desteklenmeyen yerel dosya türü.');yield [e.name,e.kind==='directory'?new RemoteDir(child(this.path,e.name)):new RemoteFile(child(this.path,e.name))];}}
    async removeEntry(){throw fail('NotAllowedError','Bu sürüm yerel dosyaları kalıcı olarak silmez.');}
  }
  globalThis.ToreRemote={hosted:true,stop:async()=>{const r=await fetch("/api/private/shutdown",{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:"{}"});const data=await r.json();if(!r.ok)throw fail("NotAllowedError",data.error||"Hizmet kapatılamadı.");return data.message;},getRoot:async()=>{if(setupError)throw fail('NotAllowedError',setupError);const root=new RemoteDir();await request('list','');return root;}};
})();
