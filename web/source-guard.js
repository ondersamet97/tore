/* Değişim bağlamının dayanak kaynağı sessizce değişmez. Saf doğrulama;
   dosya okuma/yazma, DOM ve dış bağımlılık içermez. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY_FIELDS=['id','title','url','authors','published','kind','summary','source','doi'];
const CONTEXT_TYPES=new Set(['reading','experience','objection','evidence','correction','other']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>object(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const validIds=values=>Array.isArray(values)&&values.every(id=>typeof id==='string'&&UUID.test(id))&&new Set(values).size===values.length;

function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function malformed(){fail('SOURCE_CONTEXT','Değişim bağlamı veya kaynak kataloğu doğrulanamadı. Kaynak değiştirilmedi; dosyaları denetleyin.');}
function dateOnly(value){return value===null||(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);}

function contextSources(document){
  if(!keys(document,['format','version','revision','items'])||document.format!=='tore-change-context'||document.version!==1||!Number.isSafeInteger(document.revision)||document.revision<0||!Array.isArray(document.items))malformed();
  const revisions=new Set(),sources=new Set();
  for(const item of document.items){
    if(!keys(item,['revisionId','type','description','occurredAt','reportIds','sourceIds'])||typeof item.revisionId!=='string'||!UUID.test(item.revisionId)||revisions.has(item.revisionId)||!CONTEXT_TYPES.has(item.type)||typeof item.description!=='string'||!item.description.trim()||item.description.includes('\0')||!dateOnly(item.occurredAt)||!validIds(item.reportIds)||!validIds(item.sourceIds))malformed();
    revisions.add(item.revisionId);
    for(const id of item.sourceIds)sources.add(id);
  }
  return sources;
}

function catalogItems(document){
  if(!object(document)||document.format!=='tore-sources'||document.version!==1||!Number.isSafeInteger(document.revision)||document.revision<0||!Array.isArray(document.items))malformed();
  const items=new Map();
  for(const item of document.items){
    if(!object(item)||typeof item.id!=='string'||!UUID.test(item.id)||items.has(item.id)||!IDENTITY_FIELDS.every(key=>Object.hasOwn(item,key))||!['title','url','kind','summary','source','doi'].every(key=>typeof item[key]==='string')||!Array.isArray(item.authors)||item.authors.some(author=>typeof author!=='string')||(item.published!==null&&typeof item.published!=='string'))malformed();
    items.set(item.id,item);
  }
  return items;
}

export function assertSourceChanges(previousCatalog,nextCatalog,contextDocument){
  if(contextDocument===null||contextDocument===undefined)return;
  const referenced=contextSources(contextDocument),previous=catalogItems(previousCatalog),next=catalogItems(nextCatalog);
  for(const id of referenced){
    // sourceIds profil kaynaklarını da içerir; burada yalnız katalogdaki
    // kaynaklar korunur. Profil kaynaklarının koruması profil deposundadır.
    const old=previous.get(id);if(!old)continue;
    const replacement=next.get(id);
    if(!replacement||IDENTITY_FIELDS.some(field=>JSON.stringify(old[field])!==JSON.stringify(replacement[field])))fail('SOURCE_CONTEXT_HISTORY','Değişim bağlamında kullanılan kaynak silinemez; başlığı, bağlantısı, yazarı veya dayanak içeriği değiştirilemez. Eski kaynağı koruyup yeni bir kaynak ekleyin. Kişisel not, okuma durumu ve konu düzenlenebilir.');
  }
}
