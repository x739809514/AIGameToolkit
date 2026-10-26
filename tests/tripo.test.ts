import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../electron/service';
import {Store} from '../electron/store';
import {tripoRequest,TripoError,tripoBaseURL} from '../electron/tripo';
import {defaultTripoWorkspace,tripoModel,type TripoTask} from '../src/shared/tripo';
import {inspectFile} from '../electron/assets';
import {BalanceReader} from '../electron/api-balance';
import {Workbenches} from '../electron/workbenches';
const json=(data:object)=>Response.json({code:0,data});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'laputa-tripo-test-')),keys:Record<string,string>={tripo:'secret-tripo'};const service=new Service(new Store(directory),{secure:false,get:p=>keys[p],set:(p,v)=>{keys[p]=v;}},()=>{});service.workspace.workbenchType='tripo';service.workspace.tripoWorkspace=defaultTripoWorkspace();return {service,keys,directory,close:()=>{service.close();service.store.close();rmSync(directory,{recursive:true,force:true});}};}
function task(patch:Partial<TripoTask>={}):TripoTask{return {id:'local',requestId:'request',mode:'text',prompt:'a cat',texture:true,pbr:true,model:tripoModel,state:'queued',createdAt:Date.now(),updatedAt:Date.now(),remoteTaskId:'task_test',progress:0,...patch};}
function glb(){const raw=Buffer.from(JSON.stringify({asset:{version:'2.0'}})),body=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);const bytes=Buffer.alloc(20+body.length);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(body.length,12);bytes.writeUInt32LE(0x4e4f534a,16);body.copy(bytes,20);return bytes;}
const wait=async(fn:()=>boolean)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Task did not settle');};
test('Tripo v3 contract handles HTTP-200 errors and uncertain submissions without exposing server secrets',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,init)=>{assert.equal(url,tripoBaseURL+'/generation/text-to-model');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer key');assert.equal(JSON.parse(init?.body as string).model,tripoModel);return json({task_id:'task_1'});};
  assert.equal((await tripoRequest('/generation/text-to-model','key',new AbortController().signal,{model:tripoModel})).task_id,'task_1');
  for(const mock of [()=>Response.json({code:2001,message:'secret-key'}),()=>new Response('secret-key',{status:401}),()=>Response.json({code:500,message:'secret-key'},{status:500}),()=>{throw new Error('secret-key');}]){globalThis.fetch=async()=>mock();await assert.rejects(()=>tripoRequest('/generation/text-to-model','key',new AbortController().signal,{}),e=>e instanceof TripoError&&!e.message.includes('secret-key'));}
 }finally{globalThis.fetch=original;}
});
test('generation freezes input, deduplicates request IDs and never resubmits an uncertain POST',async()=>{
 const f=fixture(),original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;throw new Error('lost response');};const input={...defaultTripoWorkspace().draft,prompt:'a cat',requestId:'one'};const created=f.service.tripo.generate(input);input.prompt='changed';assert.equal(f.service.tripo.generate(input).id,created.id);await wait(()=>f.service.workspace.tripoWorkspace!.tasks[0].state==='submission_unknown');assert.equal(calls,1);assert.equal(f.service.workspace.tripoWorkspace!.tasks[0].prompt,'a cat');assert.throws(()=>f.service.tripo.retry(created.id),/不能自动重试/);assert.ok(!JSON.stringify(f.service.workspace).includes('secret-tripo'));}finally{globalThis.fetch=original;f.close();}
});
test('image generation uploads PNG multipart and uses the returned token in v3 input',async()=>{
 const f=fixture(),original=globalThis.fetch;const calls:string[]=[];
 try{const bytes=(await import('node:fs')).readFileSync('tests/fixtures/image.png');const [image]=await f.service.importFiles([{name:'ref.png',bytes:Uint8Array.from(bytes).buffer}]);globalThis.fetch=async(url,init)=>{calls.push(String(url));if(String(url).endsWith('/files')){assert.ok(init?.body instanceof FormData);assert.ok(init.body.get('file') instanceof Blob);assert.equal((init.headers as Record<string,string>)['Content-Type'],undefined);return json({file_token:'file_uploaded'});}const body=JSON.parse(init?.body as string);assert.equal(body.input,'file_uploaded');assert.equal(body.prompt,undefined);assert.equal(body.pbr,false);return json({task_id:'task_image'});};f.service.tripo.generate({mode:'image',prompt:'',imageId:image.id,texture:false,pbr:true,requestId:'image'});await wait(()=>f.service.workspace.tripoWorkspace!.tasks[0].state==='queued');assert.deepEqual(calls,[tripoBaseURL+'/files',tripoBaseURL+'/generation/image-to-model']);}finally{globalThis.fetch=original;f.close();}
});
test('successful models download locally without forwarding API credentials; retries obtain fresh signed URLs',async()=>{
 const f=fixture(),original=globalThis.fetch;let query=0,download=0;const t=task();f.service.workspace.tripoWorkspace!.tasks.push(t);
 try{globalThis.fetch=async(url,init)=>{if(String(url).startsWith(tripoBaseURL)){query++;return json({status:'success',progress:100,credits_consumed:20,output:{model_url:'https://cdn.tripo3d.ai/model.glb?signature='+query}});}download++;assert.equal(init?.headers,undefined);assert.equal(String(url),'https://cdn.tripo3d.ai/model.glb?signature='+query);return download===1?new Response('',{status:403}):new Response(new Uint8Array(glb()));};await f.service.tripo.poll(t);assert.equal(t.state,'save_failed');f.service.tripo.retry(t.id);await wait(()=>t.state==='succeeded');assert.equal(query,2);assert.equal(t.credits,20);assert.equal(f.service.workspace.assets[0].mime,'model/gltf-binary');assert.ok(existsSync(f.service.assets.path(f.service.workspace.assets[0])));f.service.tripo.select(t.assetId!);assert.equal(f.service.workspace.tripoWorkspace!.selectedAssetId,t.assetId);}finally{globalThis.fetch=original;f.close();}
});
test('restart resumes task IDs while interrupted submissions remain unknown; drafts survive SQLite reload',()=>{
 const f=fixture();try{const state=f.service.workspace.tripoWorkspace!;state.tasks=[task(),task({id:'unknown',state:'submitting',remoteTaskId:undefined})];f.service.tripo.saveDraft({...state.draft,prompt:'saved draft'});assert.equal(f.service.store.load().tripoWorkspace?.draft.prompt,'saved draft');f.service.tripo.resume();assert.equal(state.tasks[0].state,'queued');assert.equal(state.tasks[1].state,'submission_unknown');}finally{f.close();}
});
test('progress, banned status and transient query failures preserve the remote task correctly',async()=>{
 const f=fixture(),original=globalThis.fetch,t=task();f.service.workspace.tripoWorkspace!.tasks.push(t);
 try{globalThis.fetch=async()=>json({status:'running',progress:43});await f.service.tripo.poll(t);assert.equal(t.state,'running');assert.equal(t.progress,43);globalThis.fetch=async()=>{throw new Error('offline');};await f.service.tripo.poll(t);assert.equal(t.state,'running');assert.ok(t.pollError);globalThis.fetch=async()=>json({status:'banned'});await f.service.tripo.poll(t);assert.equal(t.state,'failed');assert.equal(t.remoteTaskId,'task_test');}finally{globalThis.fetch=original;f.close();}
});
test('forced closure prevents late model results from recreating deleted data',async()=>{
 const f=fixture(),original=globalThis.fetch,t=task();let finish!:(r:Response)=>void;
 try{globalThis.fetch=async()=>new Promise<Response>(resolve=>{finish=resolve;});f.service.workspace.tripoWorkspace!.tasks.push(t);const pending=f.service.tripo.poll(t);f.service.close(true);f.service.store.close();rmSync(f.directory,{recursive:true,force:true});finish(json({status:'success',output:{model_url:'https://cdn.tripo3d.ai/model.glb'}}));await pending;assert.equal(t.state,'cancelled');assert.equal(existsSync(f.directory),false);}finally{globalThis.fetch=original;}
});
test('GLB file inspection rejects a forged header and incorrect declared length',()=>{assert.equal(inspectFile('model.glb',glb()).mime,'model/gltf-binary');const forged=glb();forged.writeUInt32LE(99999,8);assert.throws(()=>inspectFile('model.glb',forged));});
test('Tripo credits use the documented read-only endpoint, cache concurrent reads and distinguish valid zero from failure',async()=>{
 const original=globalThis.fetch,keys:Record<string,string>={tripo:'key'};let calls=0;
 try{globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,tripoBaseURL+'/account/balance');assert.equal(init?.method,'GET');return json({balance:0,frozen:10});};const reader=new BalanceReader({secure:false,get:p=>keys[p],set:()=>{}}),[a,b]=await Promise.all([reader.read('cn'),reader.read('cn')]);const balance=a.find(x=>x.provider==='tripo')!;assert.equal(calls,1);assert.deepEqual(a.find(x=>x.provider==='tripo'),b.find(x=>x.provider==='tripo'));assert.equal(balance.status,'available');assert.equal(balance.credits?.amount,0);keys.tripo='replacement';globalThis.fetch=async()=>Response.json({code:2001,message:'replacement'});const failed=(await reader.read('cn')).find(x=>x.provider==='tripo')!;assert.equal(failed.status,'error');assert.equal(failed.credits,undefined);delete keys.tripo;assert.equal((await reader.read('cn')).find(x=>x.provider==='tripo')?.status,'unconfigured');}finally{globalThis.fetch=original;}
});
test('Worktree deletion protects Tripo tasks and forced deletion stops their local processing',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'laputa-tripo-delete-')),manager=new Workbenches(directory,{secure:false,get:()=>undefined,set:()=>{}},()=>{});
 try{const entry=manager.create('tripo'),service=manager.get(entry.id);service.workspace.tripoWorkspace=defaultTripoWorkspace();service.workspace.tripoWorkspace.tasks=[task({state:'submission_unknown'})];service.changed();await assert.rejects(()=>manager.deleteWorkbench(entry.id,async()=>{}),/正在运行/);await assert.rejects(()=>manager.deleteWorktree(entry.worktreeId,async()=>{}),/正在运行/);await manager.deleteWorktree(entry.worktreeId,async()=>{},()=>{},true);assert.equal(service.closed,true);assert.equal(service.workspace.tripoWorkspace.tasks[0].state,'cancelled');}finally{manager.close();rmSync(directory,{recursive:true,force:true});}
});
