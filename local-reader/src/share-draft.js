/* Seçilmiş metnin kullanıcı denetimli, taşınabilir paylaşma taslağı. */
(()=>{'use strict';
 const safeURL=url=>{if(!url)return '';try{const parsed=new URL(url);return ['http:','https:'].includes(parsed.protocol)?parsed.href:'';}catch(_){return '';}};
 const sources=rows=>(rows||[]).map(s=>({label:String(s.label||''),url:safeURL(s.url)}));
 function packet(kind,title,text,topic,area,viewType,provenance){return {format:'tore-share-draft',version:1,kind,title,text,topic,area,viewType,provenance:{...provenance,sources:sources(provenance.sources),createdAt:new Date().toISOString()}};}
 function view(profile,revision){
  const labels=(revision.sourceIds||[]).map(id=>profile.sources.find(s=>s.id===id)).filter(Boolean);
  return packet('view',revision.topic,revision.text+(revision.bridge?'\n\n## Bugünkü yaklaşım ile ideal arasındaki bağlantı\n\n'+revision.bridge:''),revision.topic,revision.area,revision.kind,{representation:profile.kind==='thinker'?'thinker':'self',profileName:profile.name,editor:profile.editor||'',revisionIds:[revision.id],sources:labels});
 }
 function comparison(c){const a=c.assessment,categories={fact:'Olgusal iddia',prediction:'Tahmin',value:'Değer önceliği',goal:'Amaç / ideal',method:'Yöntem',scope:'Kapsam / koşul',unclear:'Henüz belirlenemedi'},lines=['# '+a.commonQuestion,'','Bu metin karşılaştırmayı hazırlayan kişinin analizidir; kaynak kişilerin kendi yayını veya onayı değildir.','','Ayrışmanın kullanıcı tarafından seçilen türü: '+categories[a.category]];
  for(const [side,label]of [['left','Sol kaynak'],['right','Sağ kaynak']]){const s=c[side];lines.push('','## '+label+' — '+s.profileName,'','Konu: '+s.topic);if(s.profileKind==='thinker')lines.push('','Kaynaklı düşünür derlemesi · Hazırlayan: '+s.editor);lines.push('','> '+s.text.replace(/\n/g,'\n> '),'','### Değerlendirmede seçilen birebir alıntılar','',...a[side+'Evidence'].map(q=>'> '+q.replace(/\n/g,'\n> ')));}
  if(a.sharedGround)lines.push('','## Ortak zemin','',a.sharedGround);if(a.difference)lines.push('','## Ayrışma','',a.difference);if(a.openQuestions.length)lines.push('','## Açık sorular','',...a.openQuestions.map(q=>'- '+q));
  return packet('comparison',a.commonQuestion,lines.join('\n'),a.commonQuestion,c.left.area,'position',{representation:'analysis',profileName:'Özel karşılaştırma analizi',editor:'Karşılaştırmayı hazırlayan kullanıcı',revisionIds:[c.left.revisionId,c.right.revisionId,c.revisions.at(-1).id],sources:[...c.left.sources,...c.right.sources]});
 }
 function preview(data){const $=id=>document.getElementById(id);$('share-title').textContent=data.title;$('share-attribution').textContent=data.provenance.representation==='thinker'?'Düşünürün kendi hesabı değildir. '+data.provenance.profileName+' için kaynak derlemesi · Hazırlayan: '+data.provenance.editor:data.provenance.representation==='analysis'?'Sizin karşılaştırma analiziniz; kaynak tarafların görüşü veya onayı değildir.':'Elle kaydettiğiniz kişisel görüşün seçili sürümü.';$('share-preview').textContent=data.text;$('share-dialog').showModal();
  $('share-download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=(data.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').slice(0,140)||'Töre paylaşma taslağı')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('share-dialog').close();};
 }
 globalThis.ToreShareDraft={view,comparison,preview};
 document.getElementById('share-close').onclick=()=>document.getElementById('share-dialog').close();
})();
