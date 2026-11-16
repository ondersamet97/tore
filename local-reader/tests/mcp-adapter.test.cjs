'use strict';
// Gerçek native ikili: yerel HTTP ile sentetik bir konu defteri hazırlanır, ardından
// aynı --data klasörüne `mcp` kipinde stdio üzerinden JSON-RPC konuşulur.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),binary=process.env.TORE_SERVER_BIN||path.join(root,'server/target/debug/tore-server');
const SECRET='SENTETİK GİZLİ SEÇİLMEMİŞ KAYIT',HIDDEN_QUESTION='SENTETİK paylaşılmayan soru';

async function start(archive,data){
 const child=spawn(binary,['--archive',archive,'--data',data,'--listen','127.0.0.1:0'],{stdio:['ignore','pipe','pipe']});let output='',errors='';child.stderr.on('data',b=>errors+=b);
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native hazır değil '+errors)),15000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);reject(Error('Native erken çıktı '+code+' '+errors));});child.stdout.on('data',b=>{output+=b;const m=output.match(/^TORE_READY (\{[^\n]+\})$/m);if(m){clearTimeout(timer);resolve(JSON.parse(m[1]));}});});
 const call=async(op,body)=>{const r=await fetch(ready.url+'/api/private/tore/'+op,{method:'POST',headers:{Authorization:'Bearer '+ready.localToken,Origin:ready.url,'Content-Type':'application/json'},body:JSON.stringify(body)});const json=await r.json();if(!r.ok)throw Error(op+': '+json.error);return json;};
 return {call,close:async()=>{if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});}};
}
function mcp(data){
 const child=spawn(binary,['mcp','--data',data],{stdio:['pipe','pipe','pipe']});let buffer='',stderr='';const lines=[],waiters=[];
 child.stderr.on('data',b=>stderr+=b);
 child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);lines.push(line);const w=waiters.shift();if(w)w();}});
 const next=()=>lines.length?Promise.resolve(lines.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP yanıt vermedi '+stderr)),10000);waiters.push(()=>{clearTimeout(timer);resolve(lines.shift());});});
 const transcript=[];
 const send=async(message,expectReply=true)=>{const raw=typeof message==='string'?message:JSON.stringify(message);transcript.push('> '+raw);child.stdin.write(raw+'\n');if(!expectReply)return null;const line=await next();transcript.push('< '+line);assert.equal(line.includes('\n'),false);return JSON.parse(line);};
 const tool=(id,name,args)=>send({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
 const close=()=>new Promise(resolve=>{child.once('exit',code=>resolve(code));child.stdin.end();});
 return {send,tool,close,transcript,pending:()=>lines.length,stderr:()=>stderr,kill:()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}};
}
function snapshot(dir){const out=[];const walk=d=>{for(const name of fsSync.readdirSync(d).sort()){const p=path.join(d,name),s=fsSync.lstatSync(p);out.push(path.relative(dir,p)+' '+s.size+' '+s.mtimeMs);if(s.isDirectory())walk(p);}};walk(dir);return out;}

test('MCP kipi yalnız açıkça paylaşılan devam metnini okutur; kapatma hemen geçerli olur ve hiçbir şey yazmaz',async t=>{
 const tmp=await fs.mkdtemp(path.join(fsSync.realpathSync(os.tmpdir()),'tore-mcp-')),archive=path.join(tmp,'archive'),data=path.join(tmp,'runtime');
 const server=await start(archive,data);t.after(async()=>{await server.close();await fs.rm(tmp,{recursive:true,force:true});});
 const {topic}=await server.call('records-topic-create',{title:'SENTETİK film konusu',goal:'SENTETİK amaç'});
 const ids=[];
 for(const text of ['SENTETİK benimsenen karar',SECRET]){const {record}=await server.call('records-create',{topicId:topic.id,kind:'decision',text,reason:'SENTETİK gerekçe'});const reviewed=await server.call('records-review',{id:record.id,expectedRevision:1,text,reason:'SENTETİK gerekçe',review:'reviewed',adoption:'adopted',currency:'current',priority:'active',questionState:'not_applicable',changeReason:'SENTETİK onay',confirmedByUser:true});ids.push(reviewed.record.id);}
 const {packet}=await server.call('records-prepare',{topicId:topic.id,recordIds:[ids[0]],proposalIds:[],target:'claude',model:null,question:'SENTETİK devam sorusu?',confirmedByUser:true});
 const {packet:hidden}=await server.call('records-prepare',{topicId:topic.id,recordIds:[ids[1]],proposalIds:[],target:'chatgpt',model:null,question:HIDDEN_QUESTION,confirmedByUser:true});
 assert.ok(!packet.text.includes(SECRET));
 await assert.rejects(server.call('records-share',{packetId:packet.id,shared:true,confirmedByUser:false}),/onay/);
 const shared=await server.call('records-share',{packetId:packet.id,shared:true,confirmedByUser:true});assert.equal(shared.packet.sharedWithTools,true);
 const before=snapshot(data);

 const client=mcp(data);t.after(()=>client.kill());
 const init=await client.send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'sentetik-test',version:'0'}}});
 assert.equal(init.result.protocolVersion,'2025-06-18');assert.deepEqual(init.result.capabilities,{tools:{}});assert.equal(init.result.serverInfo.name,'tore');
 await client.send({jsonrpc:'2.0',method:'notifications/initialized'},false);
 const tools=await client.send({jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal(client.pending(),0,'bildirim yanıtlanmaz');
 assert.deepEqual(tools.result.tools.map(x=>x.name),['tore_list_shared_contexts','tore_get_shared_context']);assert.ok(tools.result.tools.every(x=>x.annotations.readOnlyHint===true));
 const list=await client.tool(3,'tore_list_shared_contexts',{});
 assert.deepEqual(list.result.structuredContent.contexts.map(c=>c.id),[packet.id]);const item=list.result.structuredContent.contexts[0];
 assert.equal(item.topic,'SENTETİK film konusu');assert.equal(item.recordCount,1);assert.equal(item.question,'SENTETİK devam sorusu?');assert.equal(item.declaredDestination,'claude');
 const got=await client.tool(4,'tore_get_shared_context',{id:packet.id});const body=got.result.content[0].text,newline=body.indexOf('\n');
 assert.match(body.slice(0,newline),/explicitly shared/);assert.equal(body.slice(newline+1),packet.text,'kişinin önizlemede gördüğü metnin aynısı');
 const unshared=await client.tool(5,'tore_get_shared_context',{id:hidden.id}),unknown=await client.tool(6,'tore_get_shared_context',{id:'00000000-0000-4000-8000-000000000000'});
 assert.equal(unshared.result.isError,true);assert.deepEqual(unshared.result.content,unknown.result.content,'var olup olmadığı açığa çıkmaz');
 assert.equal((await client.send('{bozuk')).error.code,-32700);
 assert.equal((await client.send({jsonrpc:'2.0',id:7,method:'resources/list'})).error.code,-32601);
 assert.equal((await client.send({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'tore_get_shared_context',arguments:{}}})).error.code,-32602);
 assert.deepEqual(snapshot(data),before,'MCP diske yazmaz ve çalışan töre kilidine dokunmaz');

 await server.call('records-share',{packetId:packet.id,shared:false,confirmedByUser:true});
 const revoked=await client.tool(9,'tore_get_shared_context',{id:packet.id});assert.equal(revoked.result.isError,true);
 assert.deepEqual((await client.tool(10,'tore_list_shared_contexts',{})).result.structuredContent.contexts,[]);
 const all=client.transcript.filter(line=>line.startsWith('< ')).join('\n');for(const secret of [SECRET,HIDDEN_QUESTION,hidden.id,ids[1]])assert.equal(all.includes(secret),false,'paylaşılmayan içerik sızdı: '+secret);
 assert.equal(client.stderr().includes('SENTETİK'),false,'tanı çıktısında kişisel içerik yok');
 assert.equal(await client.close(),0);
 if(process.env.TORE_MCP_TRANSCRIPT)await fs.writeFile(process.env.TORE_MCP_TRANSCRIPT,client.transcript.join('\n')+'\n');
});

test('MCP kipi göreli veya eksik --data yolunu reddeder ve HTTP sunucusu başlatmaz',async()=>{
 for(const args of [['mcp'],['mcp','--data','göreli/klasör'],['mcp','--data','/tmp/x','--listen','127.0.0.1:0']]){
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);const code=await new Promise(r=>child.once('exit',r));
  assert.notEqual(code,0);assert.equal(out.includes('TORE_READY'),false);
 }
});
