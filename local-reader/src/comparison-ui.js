/* Özel karşılaştırma: otomatik düşünce çıkarımı veya ağ aktarımı yoktur. */
(()=>{'use strict';
// Interface text comes from the archive dictionaries (i18n-archive-tools.js), read at render time.
const tx=(k,v)=>toreI18n.t(k,v),say=m=>toreI18n.server(m),when=at=>new Date(at).toLocaleString(toreI18n.locale());
const CATEGORIES={fact:'tools.category.fact',prediction:'tools.category.prediction',value:'tools.category.value',goal:'tools.category.goal',method:'tools.category.method',scope:'tools.category.scope',unclear:'tools.category.unclear'};
const AREAS={past:'tools.area.past',present:'tools.area.present',future:'tools.area.future'},KINDS={position:'tools.kind.position',prediction:'tools.kind.prediction',question:'tools.kind.question'};
const category=c=>CATEGORIES[c]?tx(CATEGORIES[c]):c,areaName=a=>AREAS[a]?tx(AREAS[a]):a,kindName=k=>KINDS[k]?tx(KINDS[k]):k;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,action)=>{const b=el('button',text);b.type='button';b.addEventListener('click',action);return b;};
globalThis.createToreComparisonUI=({getStore,getProfiles,getArchive,task,message,onOpenReport})=>{
 const $=id=>document.getElementById(id);let editing=null,options=new Map(),disabled=false;
 const rows=()=>getStore()?.document.comparisons||[];
 function reference(side){return options.get($('cmp-'+side).value);}
 function sourceNode(source){const box=el('div',undefined,'source-reference');if(source.url){const a=el('a',source.label);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';box.append(a);}else box.append(el('span',source.label));if(source.reportId){const report=getArchive()?.manifest.reports.find(r=>r.id===source.reportId);box.append(button(report?.title||report?.originalName||tx('tools.cmp.archiveReport'),()=>task(()=>onOpenReport(source.reportId))));}return box;}
 function showSide(side,snapshot=null){const box=$('cmp-'+side+'-preview');box.replaceChildren();if(!snapshot){const ref=reference(side);if(!ref)return;try{snapshot=ToreComparisons.resolveReference(ref,getProfiles().document);}catch(e){message(say(e.message),true);return;}}
  box.append(el('h3',snapshot.profileName+' · '+snapshot.topic),el('p',areaName(snapshot.area)+' · '+kindName(snapshot.kind)+' · '+when(snapshot.at),'muted small'));
  if(snapshot.profileKind==='thinker')box.append(el('p',tx('tools.cmp.byEditor',{editor:snapshot.editor}),'small muted'));
  const quoted=el('blockquote',snapshot.text,'comparison-source multiline');quoted.id='cmp-'+side+'-source';box.append(quoted);
  if(snapshot.bridge)box.append(el('p',tx('tools.bridgeLine',{text:snapshot.bridge}),'multiline'));
  for(const s of snapshot.sources)box.append(sourceNode(s));
  for(const id of snapshot.reportIds){if(snapshot.sources.some(s=>s.reportId===id))continue;box.append(sourceNode({label:tx('tools.cmp.viewReport'),url:'',reportId:id}));}
 }
 function setOptions(){const left=$('cmp-left').value,right=$('cmp-right').value;options=new Map();for(const side of ['left','right'])$('cmp-'+side).replaceChildren(new Option(tx('tools.cmp.chooseVersion'),''));
  for(const p of getProfiles()?.document.profiles||[])for(const v of p.views)for(const [i,r]of [...v.revisions].reverse().entries()){
   const key=[p.id,v.id,r.id].join('/'),ref={profileId:p.id,viewId:v.id,revisionId:r.id};options.set(key,ref);
   const label=p.name+' · '+r.topic+' · '+areaName(r.area)+' · '+(i===0?tx('tools.cmp.current'):tx('tools.cmp.earlier'))+' · '+when(r.at);for(const side of ['left','right'])$('cmp-'+side).append(new Option(label,key));
  }if(options.has(left))$('cmp-left').value=left;if(options.has(right))$('cmp-right').value=right;
 }
 function syncDisabled(value){disabled=value;const ready=!!getStore()&&!!getProfiles();for(const e of document.querySelectorAll('#comparisons-pane input,#comparisons-pane textarea,#comparisons-pane select,#comparisons-pane button'))e.disabled=value||!ready;
  $('cmp-left').disabled=value||!ready||!!editing;$('cmp-right').disabled=value||!ready||!!editing;
 }
 function reset(){editing=null;$('comparison-form').reset();$('cmp-id').value='';$('cmp-reason-label').hidden=true;$('cmp-reason').required=false;$('cmp-save').textContent=tx('tools.cmp.save');$('cmp-form-error').textContent='';setOptions();showSide('left');showSide('right');syncDisabled(disabled);}
 function edit(c){editing=c;$('cmp-id').value=c.id;setOptions();for(const side of ['left','right']){const s=c[side];$('cmp-'+side).value=[s.profileId,s.viewId,s.revisionId].join('/');showSide(side,s);}
  const a=c.assessment;$('cmp-question').value=a.commonQuestion;$('cmp-category').value=a.category;$('cmp-shared').value=a.sharedGround;$('cmp-difference').value=a.difference;$('cmp-left-evidence').value=a.leftEvidence[0];$('cmp-right-evidence').value=a.rightEvidence[0];$('cmp-open').value=a.openQuestions.join('\n');$('cmp-reason').value='';$('cmp-reason-label').hidden=false;$('cmp-reason').required=true;$('cmp-save').textContent=tx('tools.cmp.saveEdit');syncDisabled(disabled);$('comparison-form').scrollIntoView({block:'start'});
 }
 function card(c){const box=el('section',undefined,'view-card');box.append(el('h3',c.assessment.commonQuestion),el('p',c.left.profileName+' ↔ '+c.right.profileName,'small muted'),el('p',tx('tools.cmp.userCategory',{category:category(c.assessment.category)}),'eyebrow'));
  if(c.assessment.sharedGround)box.append(el('h4',tx('tools.cmp.savedShared')),el('p',c.assessment.sharedGround,'multiline'));
  if(c.assessment.difference)box.append(el('h4',tx('tools.cmp.savedDifference')),el('p',c.assessment.difference,'multiline'));
  for(const [side,label]of [['left',tx('tools.cmp.leftEvidence')],['right',tx('tools.cmp.rightEvidence')]]){box.append(el('h4',label));for(const quote of c.assessment[side+'Evidence'])box.append(el('blockquote',quote,'multiline'));}
  if(c.assessment.openQuestions.length){box.append(el('h4',tx('tools.cmp.openQuestions')));const ul=el('ul');for(const q of c.assessment.openQuestions)ul.append(el('li',q));box.append(ul);}
  const detail=el('details');detail.append(el('summary',tx('tools.cmp.fixedVersions')));for(const side of ['left','right']){const s=c[side];detail.append(el('h4',s.profileName+' · '+s.topic),el('p',areaName(s.area)+' · '+kindName(s.kind)+' · '+when(s.at),'small muted'),el('blockquote',s.text,'multiline'));for(const source of s.sources)detail.append(sourceNode(source));for(const id of s.reportIds)if(!s.sources.some(s=>s.reportId===id))detail.append(sourceNode({label:tx('tools.cmp.archiveReport'),url:'',reportId:id}));}box.append(detail);
  const history=el('details');history.append(el('summary',tx('tools.cmp.history',{n:c.revisions.length})));for(const r of [...c.revisions].reverse()){const section=el('section',undefined,'history-entry');section.append(el('p',when(r.at),'small muted'),el('h4',r.assessment.commonQuestion),el('p',category(r.assessment.category)),el('p',r.assessment.sharedGround,'multiline'),el('p',r.assessment.difference,'multiline'));if(r.reason)section.append(el('p',tx('tools.reasonLine',{text:r.reason}),'multiline'));for(const q of [...r.assessment.leftEvidence,...r.assessment.rightEvidence])section.append(el('blockquote',q,'multiline'));if(r.assessment.openQuestions.length){section.append(el('h4',tx('tools.cmp.thenOpen')));const ul=el('ul');for(const q of r.assessment.openQuestions)ul.append(el('li',q));section.append(ul);}history.append(section);}box.append(history,button(tx('tools.cmp.editAssessment'),()=>edit(c)));if(globalThis.ToreShareDraft)box.append(button(tx('tools.card.share'),()=>ToreShareDraft.preview(ToreShareDraft.comparison(c))));return box;
 }
 function refresh(){setOptions();const list=$('comparison-list');list.replaceChildren();const data=[...rows()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));for(const c of data)list.append(card(c));if(!data.length)list.append(el('p',getStore()?tx('tools.cmp.empty'):tx('tools.cmp.closed'),'empty'));if(!editing){showSide('left');showSide('right');}syncDisabled(disabled);}
 function show(){for(const id of ['reports-pane','profiles-pane'])$(id).hidden=true;$('comparisons-pane').hidden=false;for(const name of ['reports','self','thinkers'])$('nav-'+name).removeAttribute('aria-current');$('nav-comparisons').setAttribute('aria-current','page');refresh();}
 $('nav-comparisons').addEventListener('click',()=>{if(!disabled)show();});
 for(const side of ['left','right']){$('cmp-'+side).addEventListener('change',()=>{showSide(side);$('cmp-'+side+'-evidence').value='';});$('cmp-'+side+'-capture').addEventListener('click',()=>{const selection=window.getSelection(),source=$('cmp-'+side+'-source');if(!selection?.rangeCount||!source||!source.contains(selection.getRangeAt(0).commonAncestorContainer)||!selection.toString()){message(tx('tools.cmp.selectFirst'),true);return;}$('cmp-'+side+'-evidence').value=selection.toString();});}
 $('cmp-reset').addEventListener('click',reset);
 $('comparison-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{try{const a={commonQuestion:$('cmp-question').value,category:$('cmp-category').value,sharedGround:$('cmp-shared').value,difference:$('cmp-difference').value,leftEvidence:[$('cmp-left-evidence').value],rightEvidence:[$('cmp-right-evidence').value],openQuestions:$('cmp-open').value.split('\n').map(s=>s.trim()).filter(Boolean)};
   // Düzenlemede arayüz bir alıntı gösterir; mevcut çoklu alıntıları sessizce düşürmez.
   if(editing){a.leftEvidence=[a.leftEvidence[0],...editing.assessment.leftEvidence.slice(1)];a.rightEvidence=[a.rightEvidence[0],...editing.assessment.rightEvidence.slice(1)];}
   await getStore().save({id:editing?.id,left:editing?undefined:reference('left'),right:editing?undefined:reference('right'),assessment:a,reason:$('cmp-reason').value});reset();refresh();message(tx('tools.cmp.savedMessage'));
  }catch(e){$('cmp-form-error').textContent=say(e.message);throw e;}});});
 function categoryOptions(){const chosen=$('cmp-category').value;$('cmp-category').replaceChildren(...Object.keys(CATEGORIES).map(value=>new Option(category(value),value)));if(chosen)$('cmp-category').value=chosen;}
 // A language switch redraws labels in place and keeps what was typed and chosen.
 const redraw=()=>{categoryOptions();$('cmp-save').textContent=editing?tx('tools.cmp.saveEdit'):tx('tools.cmp.save');const left=$('cmp-left').value,right=$('cmp-right').value;refresh();$('cmp-left').value=left;$('cmp-right').value=right;if(editing){showSide('left',editing.left);showSide('right',editing.right);}};
 toreI18n.onChange(redraw);toreI18n.whenReady().then(redraw);
 categoryOptions();reset();refresh();return {show,refresh,syncDisabled,reset};
};})();
