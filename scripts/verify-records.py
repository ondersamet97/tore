#!/usr/bin/env python3
"""Synthetic real-process HTTP acceptance for the local topic flow. No model calls."""
import argparse, base64, hashlib, json, os, subprocess, tempfile, time
from pathlib import Path
import urllib.request, urllib.error
ROOT=Path(__file__).resolve().parent.parent
REPORT={'version':'0.12.0','syntheticDataOnly':True,'modelCalls':0,'paidCalls':0,'steps':[],'passed':False}
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def step(name):
    REPORT['steps'].append({'name':name,'passed':True}); print('PASS',name,flush=True)
def run(binary):
    with tempfile.TemporaryDirectory(prefix='tore-records-http-') as temp:
        root=Path(temp).resolve(); archive=root/'archive';data=root/'data'; archive.mkdir();data.mkdir()
        profile=root/'offline.sb';profile.write_text('(version 1)\n(allow default)\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n')
        process=None;runtime=None
        def call(op,body=None,status=200,headers=None):
            h={'Authorization':'Bearer '+runtime['localToken'],'Origin':runtime['url'],'Content-Type':'application/json'};h.update(headers or {})
            req=urllib.request.Request(runtime['url']+'/api/private/tore/'+op,data=json.dumps(body or {}).encode(),headers=h)
            try:r=OPENER.open(req,timeout=10)
            except urllib.error.HTTPError as e:r=e
            with r:
                result=json.load(r);assert r.code==status,(op,r.code,result)
                return result
        def start():
            nonlocal process,runtime
            command=[str(binary),'--archive',str(archive),'--data',str(data),'--listen','127.0.0.1:0']
            if Path('/usr/bin/sandbox-exec').exists():
                command=['/usr/bin/sandbox-exec','-f',str(profile)]+command;REPORT['networkEnforcement']='macOS sandbox: outbound limited to localhost'
            else: REPORT['networkEnforcement']='not enforced by OS; local API flow only'
            env={k:os.environ[k] for k in ('PATH','LANG','TMPDIR') if k in os.environ}
            process=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
            p=data/'.tore-runtime/runtime.json'
            for _ in range(250):
                assert process.poll() is None,'Server exited before ready'
                if p.exists():
                    runtime=json.loads(p.read_text())
                    if runtime['pid']==process.pid:
                        assert call('status')['version']==REPORT['version'];return
                time.sleep(.04)
            raise AssertionError('Readiness timeout')
        def stop():
            if process and process.poll() is None:process.terminate();process.wait(timeout=10)
        def create(kind,text,source=None):
            return call('records-create',{'topicId':topic['id'],'kind':kind,'text':text,'reason':'SENTETİK gerekçe',**({'source':source} if source else {})})['record']
        def review(record,**changes):
            payload={k:record[k] for k in ('id','text','reason','review','adoption','currency','priority','questionState')}
            payload.update(expectedRevision=record['revision'],changeReason='SENTETİK açık kullanıcı incelemesi',confirmedByUser=True);payload.update(changes)
            return call('records-review',payload)['record']
        try:
            start()
            for route,needle in [('/','return.js'),('/konular','Konuya geri dön'),('/calisma','workspace.js'),('/gorusler','opinions.js')]:
                with OPENER.open(runtime['url']+route) as r:assert needle in r.read().decode();assert "default-src 'none'" in r.headers['Content-Security-Policy']
            call('records-list',status=403,headers={'Origin':'https://foreign.example'});call('records-list',status=403,headers={'Authorization':'Bearer invalid'})
            step('embedded_home_and_private_authorization')
            p=call('import-preview',{'provider':'generic','fileName':'return-topic.json','contentBase64':base64.b64encode((ROOT/'fixtures/return-topic.json').read_bytes()).decode()})
            c=call('import-commit',{'previewId':p['previewId'],'selectedIds':[p['conversations'][0]['id']]})['conversations'][0]
            original=sha(data/'conversations/workspace-v1.json')
            topic=call('records-topic-create',{'title':'SENTETİK kitaplık','goal':'Gönüllü saatlerini belirlemek'})['topic']
            user=next(m for m in c['messages'] if m['role']=='user');ai=next(m for m in c['messages'] if m['role']=='assistant')
            src=lambda m:{'conversationId':c['id'],'messageId':m['id'],'excerpt':m['text']}
            call('records-create',{'topicId':topic['id'],'kind':'decision','text':'uydurma','source':{**src(user),'excerpt':'KAYNAKTA YOK'}},400)
            decision=create('decision',user['text'],src(user));assert decision['adoption']=='unknown' and decision['review']=='pending'
            decision=review(decision,text='SENTETİK düzeltilmiş karar: iki cumartesi deneme.',review='reviewed',adoption='adopted',currency='current',priority='active')
            assert decision['attribution']=='user_interpretation' and decision['source']['excerpt']==user['text'] and decision['history'][0]['text']==user['text']
            proposal=review(create('opinion',ai['text'],src(ai)),review='reviewed',adoption='not_adopted',currency='current')
            question=review(create('question','SENTETİK gönüllü azalırsa ne yapacağız?'),review='reviewed',currency='current')
            view=call('records-topic',{'topicId':topic['id']});assert [r['id'] for r in view['currentDecisions']]==[decision['id']];assert question['id'] in [q['id'] for q in view['openQuestions']]
            step('source_quote_review_correction_and_independent_states')
            payload={'topicId':topic['id'],'recordIds':[decision['id'],question['id']],'target':'chatgpt','question':'SENTETİK buradan devam et','confirmedByUser':True}
            call('records-prepare',{**payload,'confirmedByUser':False},400)
            call('records-prepare',{**payload,'recordIds':[proposal['id']]},400)
            packet=call('records-prepare',payload)['packet'];assert ai['text'] not in packet['text']
            packet=call('records-prepare',{**payload,'proposalIds':[proposal['id']]})['packet'];assert 'BENİMSENMEMİŞ AI ÖNERİSİ' in packet['text'];assert 'assistant' in packet['text']
            decision=review(decision,currency='superseded',priority='paused');call('records-prepare',payload,400)
            assert call('records-topic',{'topicId':topic['id']})['currentDecisions']==[]
            decision=review(decision,currency='current')
            step('selected_context_consent_old_decision_exclusion_and_ai_opt_in')
            for target in ('chatgpt','claude','gemini','meta','xai','deepseek','kimi','glm','qwen','mistral','nvidia','openrouter','other'):
                assert call('records-prepare',{**payload,'target':target})['packet']['target']==target
            step('all_manual_destination_contracts_without_external_calls')
            bad=call('records-reply',{'packetId':packet['id'],'rawText':'{"broken":','format':'json','confirmedByUser':True})['reply'];assert bad['validationStatus']=='invalid' and bad['rawText']=='{"broken":'
            call('records-create',{'topicId':topic['id'],'kind':'opinion','text':'broken','source':{'replyId':bad['id'],'excerpt':'broken'}},400)
            forged=json.dumps({'commentary':'SENTETİK yorum','citations':[{'sourceId':'missing','quote':'fake'}]})
            assert call('records-reply',{'packetId':packet['id'],'rawText':forged,'format':'json','confirmedByUser':True})['reply']['validationStatus']=='invalid'
            source=packet['sources'][0]
            raw=json.dumps({'commentary':'SENTETİK AI yorumu: süreyi yeniden değerlendirin.','citations':[{'sourceId':source['sourceId'],'quote':source['quote']}]})
            reply=call('records-reply',{'packetId':packet['id'],'rawText':raw,'format':'json','confirmedByUser':True})['reply'];assert reply['validationStatus']=='valid'
            candidate=create('opinion',reply['commentary'],{'replyId':reply['id'],'excerpt':reply['commentary']});assert candidate['attribution']=='assistant_proposal' and candidate['adoption']=='unknown' and candidate['review']=='pending'
            assert call('records-topic',{'topicId':topic['id']})['openQuestions'][0]['questionState']=='open'
            step('malformed_reply_retention_exact_citations_and_ai_candidate')
            question=review(question,questionState='closed',changeReason='SENTETİK yanıtı ayrıca kabul edip soruyu kapattım.')
            assert call('records-topic',{'topicId':topic['id']})['openQuestions']==[]
            step('question_closes_only_after_explicit_review')
            backup=call('records-backup');before=call('records-list');create('opinion','SENTETİK geri alınacak not');current=call('records-list')
            call('records-restore',{'backupId':backup['backupId'],'expectedStateHash':before['stateHash'],'confirmedByUser':True},400)
            call('records-restore',{'backupId':backup['backupId'],'expectedStateHash':current['stateHash'],'confirmedByUser':True})
            assert call('records-list')['stateHash']==before['stateHash']
            badbackup=call('records-backup');(data/'conversations/records-backups'/f"{badbackup['backupId']}.json").write_text('{broken')
            call('records-restore',{'backupId':badbackup['backupId'],'expectedStateHash':before['stateHash'],'confirmedByUser':True},400);assert call('records-list')['stateHash']==before['stateHash']
            step('backup_restore_rehearsal_stale_guard_and_corrupt_backup_rejection')
            legacy=call('opinion-create',{'topic':'life','statement':user['text'],'reason':'SENTETİK önceki onay','source':src(user),'attribution':'user_statement','positionIds':[]})['card']
            call('opinion-review',{'id':legacy['id'],'expectedRevision':legacy['revision'],'statement':legacy['statement'],'reason':legacy['reason'],'positionIds':[],'status':'confirmed','changeType':'review','changeReason':'SENTETİK onay','confirmedByUser':True})
            legacy_path=data/'conversations/opinions-v1.json';legacy_hash=sha(legacy_path)
            preview=call('records-migration-preview');assert preview['count']==1
            call('records-migration-apply',{'previewHash':preview['previewHash'],'confirmedByUser':False},400)
            migrated=call('records-migration-apply',{'previewHash':preview['previewHash'],'confirmedByUser':True});assert migrated['imported']==1
            again=call('records-migration-apply',{'previewHash':preview['previewHash'],'confirmedByUser':True});assert again['imported']==0 and again['skipped']==1
            old=next(r for r in call('records-list')['records'] if r.get('legacy'));assert old['adoption']=='adopted' and old['currency']=='unknown' and old['source']['excerpt']==user['text'] and old['legacy']['history']
            assert sha(legacy_path)==legacy_hash and sha(data/'conversations/workspace-v1.json')==original
            step('legacy_migration_endorsement_provenance_idempotence_and_original_hashes')
            bulk=call('records-bulk-preview');assert bulk['conversationCount']==1 and bulk['linkedCount']==1 and bulk['candidateCount']>=1
            before_bulk=call('records-list');before_record_ids={r['id'] for r in before_bulk['records']}
            call('records-bulk-apply',{'previewHash':bulk['previewHash'],'confirmedByUser':False},400)
            call('records-bulk-apply',{'previewHash':'stale','confirmedByUser':True},400)
            result=call('records-bulk-apply',{'previewHash':bulk['previewHash'],'confirmedByUser':True});assert result['linked']==1 and result['backupId']
            after_bulk=call('records-list');assert len(after_bulk['conversationLinks'])==1
            link=after_bulk['conversationLinks'][0];assert link['conversationId']==c['id'] and link['lastUserSource']['role']=='user'
            msg=next(m for m in c['messages'] if m['id']==link['lastUserSource']['messageId']);assert link['lastUserSource']['excerpt'] in msg['text']
            created=[r for r in after_bulk['records'] if r['id'] not in before_record_ids]
            assert len(created)==result['candidatesCreated'] and all(r['review']=='pending' and r['currency']=='unknown' and r['adoption'] in ('unknown','not_applicable') for r in created)
            assert not call('records-topic',{'topicId':link['topicId']})['currentDecisions']
            retry=call('records-bulk-apply',{'previewHash':bulk['previewHash'],'confirmedByUser':True});assert retry['alreadyApplied'] and call('records-list')['stateHash']==after_bulk['stateHash']
            assert call('records-bulk-preview')['linkedCount']==0 and sha(legacy_path)==legacy_hash and sha(data/'conversations/workspace-v1.json')==original
            step('bulk_link_sources_pending_candidates_consent_and_idempotence')
            call('records-restore',{'backupId':result['backupId'],'expectedStateHash':after_bulk['stateHash'],'confirmedByUser':True})
            rolled_back=call('records-list');assert rolled_back['stateHash']==before_bulk['stateHash'] and rolled_back['conversationLinks']==[]
            again_preview=call('records-bulk-preview');call('records-bulk-apply',{'previewHash':again_preview['previewHash'],'confirmedByUser':True})
            step('bulk_backup_restore_and_repeat_preserve_legacy_state')
            organization=call('records-organize-preview');assert organization['conversationCount']==1 and organization['subtopicCount']==1
            call('records-organize-apply',{'previewHash':organization['previewHash'],'confirmedByUser':False},400)
            call('records-topic-create',{'title':'SENTETİK önizleme sonrası yeni konu'})
            call('records-organize-apply',{'previewHash':organization['previewHash'],'confirmedByUser':True},400)
            organization=call('records-organize-preview');before_organization=call('records-list')
            organization_request={'previewHash':organization['previewHash'],'confirmedByUser':True}
            organized=call('records-organize-apply',organization_request);assert organized['subtopicsUpdated']==1 and organized['backupId']
            after_organization=call('records-list');assert after_organization['conversationLinks'][0]['subtopicTitle']
            before_records={r['id']:{k:v for k,v in r.items() if k!='topicId'} for r in before_organization['records']}
            after_records={r['id']:{k:v for k,v in r.items() if k!='topicId'} for r in after_organization['records']}
            assert before_records==after_records
            assert before_organization['packets']==after_organization['packets'] and before_organization['replies']==after_organization['replies']
            assert call('records-organize-apply',organization_request)['alreadyApplied']
            assert call('records-list')['stateHash']==after_organization['stateHash']
            assert call('records-organize-preview')['conversationCount']==0
            assert sha(legacy_path)==legacy_hash and sha(data/'conversations/workspace-v1.json')==original
            step('organization_preview_consent_stale_guard_source_and_review_preservation')
            call('records-restore',{'backupId':organized['backupId'],'expectedStateHash':after_organization['stateHash'],'confirmedByUser':True})
            assert call('records-list')['stateHash']==before_organization['stateHash']
            organization=call('records-organize-preview');call('records-organize-apply',{'previewHash':organization['previewHash'],'confirmedByUser':True})
            step('organization_backup_restore_and_idempotent_retry')
            saved=call('records-list');stop();start();restored=call('records-list');assert restored['stateHash']==saved['stateHash'] and any(r['id']==bad['id'] for r in restored['replies'])
            assert sha(legacy_path)==legacy_hash and len(restored['conversationLinks'])==1;step('restart_preserves_records_revisions_malformed_replies_links_and_legacy')
            REPORT['passed']=True
        finally:stop()
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--binary',type=Path,default=ROOT/'server/target/debug/tore-server');args=parser.parse_args()
    try:run(args.binary.resolve())
    finally:(ROOT/'docs/records-http-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
