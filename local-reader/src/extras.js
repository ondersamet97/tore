/* v4 yedeğinin sabit iki özel JSON kataloğu; dosya yolları kullanıcı girdisinden türetilmez. */
(()=>{'use strict';
 const names=Object.freeze(['kaynaklar.json','temsilciler.json','okuma.json','degisimler.json']),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),keys=(value,list)=>Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
 const fail=text=>{const error=Error(text);error.code='BACKUP_EXTRAS';throw error;};
 const uniqueIds=values=>Array.isArray(values)&&values.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(values).size===values.length;
 function date(value){if(value===null)return true;if(typeof value!=='string')return false;if(/^\d{4}-\d{2}-\d{2}$/.test(value))return Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;return /^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));}
 function sourceURL(value){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('Ek katalogda güvenli olmayan kaynak bağlantısı var.');url.hash='';return url.href;}catch(_){fail('Ek katalogda geçersiz kaynak bağlantısı var.');}}
 function empty(name){if(!names.includes(name))fail('Desteklenmeyen ek katalog adı.');return {format:({'kaynaklar.json':'tore-sources','temsilciler.json':'tore-representatives','okuma.json':'tore-reading','degisimler.json':'tore-change-context'})[name],version:1,revision:0,items:[]};}
 function validate(name,doc,reports,profiles,catalog){
  if(name==='okuma.json'){if(!globalThis.ToreReading)fail('Okuma kayıtları doğrulanamadı.');return globalThis.ToreReading.validateDocument(doc,reports);}
  if(name==='degisimler.json'){if(!globalThis.ToreThoughtTools)fail('Değişim bağlamı doğrulanamadı.');return globalThis.ToreThoughtTools.validateContext(doc,reports,profiles,catalog);}
if(!names.includes(name))fail('Yedekte izin verilmeyen ek dosya yolu var.');if(!object(doc)||!keys(doc,['format','version','revision','items'])||doc.format!==empty(name).format||doc.version!==1||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.items))fail(name+' şeması desteklenmiyor; yedekten sessizce çıkarılmadı.');const ids=new Set(),urls=new Set(),reportIds=new Set(reports.map(r=>r.id));
  for(const item of doc.items){if(!object(item)||!uuid.test(item.id)||ids.has(item.id)||!uniqueIds(item.reportIds)||item.reportIds.some(id=>!reportIds.has(id)))fail(name+' içinde geçersiz kimlik veya arşivde bulunmayan rapor bağı var.');ids.add(item.id);
   if(name==='kaynaklar.json'){if(!keys(item,['id','title','url','authors','published','retrievedAt','kind','summary','source','doi','topic','status','notes','reportIds'])||typeof item.title!=='string'||!item.title.trim()||typeof item.url!=='string'||!Array.isArray(item.authors)||item.authors.some(v=>typeof v!=='string')||!date(item.published)||!date(item.retrievedAt)||!['paper','news','manual'].includes(item.kind)||!['unread','read','questioned'].includes(item.status)||['summary','source','doi','topic','notes'].some(key=>typeof item[key]!=='string'))fail('kaynaklar.json içinde geçersiz kaynak bilgisi var.');const key=sourceURL(item.url);if(urls.has(key))fail('Kaynak kataloğunda aynı bağlantı tekrar ediyor.');urls.add(key);}
   else{const expected=['id','name','instructions','reportIds','approved'];if(Object.hasOwn(item,'profileViewIds'))expected.push('profileViewIds');if(!keys(item,expected)||typeof item.name!=='string'||!item.name.trim()||typeof item.instructions!=='string'||typeof item.approved!=='boolean'||(item.profileViewIds!==undefined&&!uniqueIds(item.profileViewIds)))fail('temsilciler.json içinde geçersiz temsilci veya görüş kimliği var.');}
  }return doc;
 }
 globalThis.ToreExtras=Object.freeze({names,empty,validate});
})();
