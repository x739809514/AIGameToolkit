import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, type Asset, type Provider, type Task } from '../src/shared/types';
import { buildVideoBody, validateVideo, ProviderError } from '../electron/providers';
import { inspectFile } from '../electron/assets';
import { Service, type Vault } from '../electron/service';
import { Store } from '../electron/store';
const image:Asset={id:'image-1',name:'frame.png',type:'image',mime:'image/png',size:1024,url:'asset://local/image-1',width:1024,height:1024,createdAt:0};
const task=(patch:Partial<Task>={}):Task=>({id:'t',requestId:'r',kind:'video',state:'submitting',createdAt:Date.now(),updatedAt:Date.now(),prompt:'镜头向前移动',assetIds:[],baseImageId:'image-1',mode:'first_frame',discussion:false,settings:{...defaults},outputAssetIds:[],...patch});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'toolkit-test-'));const store=new Store(directory);const memory:Partial<Record<Provider,string>>={};const vault:Vault={secure:false,get:p=>memory[p],set:(p,k)=>{memory[p]=k;}};const service=new Service(store,vault,()=>{});return {store,service};}
async function waitUntil(check:()=>boolean){for(let i=0;i<2000;i++){if(check())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Task timeout');}
test('H3 first-frame body uses nested media URL and frozen prompt',()=>{const body=buildVideoBody(task({effectivePrompt:'优化镜头'}),[image],()=> 'data:image/png;base64,test');assert.equal(body.model,'MiniMax-H3');assert.equal(body.ratio,'adaptive');assert.deepEqual(body.content[1],{type:'image_url',image_url:{url:'data:image/png;base64,test'},role:'first_frame'});assert.equal(body.content[0].text,'优化镜头');});
test('H3 rejects mixed first frame and reference video, dimensions, incompatible Max parameters',()=>{
  const video:Asset={...image,id:'v',name:'v.mp4',type:'video',mime:'video/mp4',duration:5,fps:24,videoCodec:'h264'};
  assert.throws(()=>validateVideo(task(),[image,video]),/首帧模式/);
  assert.throws(()=>validateVideo(task(),[{...image,width:100}]),/宽高/);
  assert.throws(()=>validateVideo(task({settings:{...defaults,videoModel:'MiniMax-H3-Max',videoResolution:'2K'}}),[image]),/分辨率/);
  assert.throws(()=>validateVideo(task({mode:'reference'}),[{...video,duration:16}]),/2–15/);
});
test('reference mode maps video and images without first-frame role',()=>{
 const v:Asset={...image,id:'v',type:'video',mime:'video/mp4',duration:5,fps:24,videoCodec:'h264'};
 const body=buildVideoBody(task({mode:'reference'}),[image,v],a=>a.url);assert.deepEqual(body.content.map(a=>a.role).filter(Boolean),['reference_image','reference_video']);
});
test('file validation rejects forged images and binary text',()=>{
 assert.throws(()=>inspectFile('fake.png',Buffer.from('not an image')),/仅支持/);
 assert.throws(()=>inspectFile('notes.txt',Buffer.from([65,0,1])),/仅支持/);
 assert.equal(inspectFile('notes.md',Buffer.from('A story')).type,'document');
});
test('SQLite persists independent drafts and snapshots without keys',()=>{
 const {store,service}=fixture();service.saveDraft('image',{prompt:'图像',attachmentIds:[],mode:'first_frame',discussion:false});service.saveDraft('video',{prompt:'镜头',attachmentIds:[],mode:'first_frame',discussion:false});service.saveSettings({...defaults},{openai:'secret-test'});const data=store.load();assert.equal(data.drafts.image.prompt,'图像');assert.equal(data.drafts.video.prompt,'镜头');assert.ok(!JSON.stringify(data).includes('secret-test'));service.close();store.close();
});
test('API image to video preserves snapshots and deduplicates submissions',async()=>{
 const {store,service}=fixture();service.vault.set('openai','test-only');service.vault.set('minimax','test-only');const original=globalThis.fetch;let submissions=0;
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/images/generations')){submissions++;return Response.json({data:[{b64_json:readFileSync('tests/fixtures/image.png').toString('base64')}]});}if(init?.method==='POST')return Response.json({task_id:'test-remote'});if(url.includes('/query/'))return Response.json({task:{status:'succeeded',content:{url:'https://cdn.example.test/test.mp4'}}});return new Response(readFileSync('tests/fixtures/video.mp4'));};
 try{
  const draft={prompt:'画面',attachmentIds:[],mode:'first_frame' as const,discussion:false};const t=await service.generate({kind:'image',requestId:'once',draft});draft.prompt='修改后的草稿';const duplicate=await service.generate({kind:'image',requestId:'once',draft});assert.equal(t.id,duplicate.id);await waitUntil(()=>service.workspace.tasks[0].state==='succeeded');assert.equal(submissions,1);assert.equal(service.workspace.tasks[0].prompt,'画面');
  const a=service.workspace.assets[0];const vt=await service.generate({kind:'video',requestId:'video-once',draft:{prompt:'推近',attachmentIds:[],mode:'first_frame',discussion:false,baseImageId:a.id}});service.saveDraft('video',{prompt:'新草稿',attachmentIds:[],mode:'first_frame',discussion:false});await waitUntil(()=>service.workspace.tasks.find(x=>x.id===vt.id)?.state==='succeeded');assert.equal(service.workspace.tasks.find(x=>x.id===vt.id)?.baseImageId,a.id);assert.ok(service.workspace.assets.find(a=>a.type==='video')?.duration);
 }finally{globalThis.fetch=original;service.close();store.close();}
});
test('restart marks uncertain submissions and resumes existing remote task IDs without new submission',()=>{
 const {store,service}=fixture();service.workspace.tasks=[task({id:'unknown',remoteTaskId:undefined}),task({id:'remote',remoteTaskId:'remote-1',state:'running'})];service.resume();assert.equal(service.workspace.tasks[0].state,'submission_unknown');assert.equal(service.workspace.tasks[1].remoteTaskId,'remote-1');assert.equal(service.timers.size,1);service.close();store.close();
});
test('ambiguous paid submission is not marked safe to resubmit',()=>{const e=new ProviderError('timeout',true);assert.equal(e.uncertain,true);});
test('network loss after paid POST persists uncertainty and never automatically resubmits',async()=>{
 const {store,service}=fixture();const a=await service.assets.import('frame.png',readFileSync('tests/fixtures/image.png'));service.workspace.assets.push(a);service.vault.set('minimax','test-only');let calls=0;const original=globalThis.fetch;
 globalThis.fetch=async()=>{calls++;throw new Error('socket lost');};
 try{
  const t=await service.generate({kind:'video',requestId:'lost-response',draft:{prompt:'推近',attachmentIds:[],baseImageId:a.id,mode:'first_frame',discussion:false}});
  await waitUntil(()=>service.workspace.tasks.find(x=>x.id===t.id)?.state==='submission_unknown');
  assert.equal(calls,1);service.resume();assert.equal(calls,1);assert.equal(store.load().tasks.at(-1)?.state,'submission_unknown');
  await assert.rejects(()=>service.retryTask(t.id),/不能安全/);assert.equal(calls,1);
 }finally{globalThis.fetch=original;service.close();store.close();}
});
test('video download failure retries save without a second paid submission',async()=>{
 const {store,service}=fixture();const a=await service.assets.import('frame.png',readFileSync('tests/fixtures/image.png'));service.workspace.assets.push(a);service.vault.set('minimax','test-only');const original=globalThis.fetch;let submissions=0,downloads=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(init?.method==='POST'){submissions++;return Response.json({task_id:'remote-safe'});}
  if(url.includes('/query/video_generation/'))return Response.json({task:{status:'succeeded',content:{url:'https://cdn.example.test/result.mp4'}}});
  downloads++;if(downloads===1)return new Response('temporary error',{status:503});return new Response(readFileSync('tests/fixtures/video.mp4'),{headers:{'Content-Type':'video/mp4'}});
 };
 try{
  const t=await service.generate({kind:'video',requestId:'download-retry',draft:{prompt:'镜头推近',attachmentIds:[],baseImageId:a.id,mode:'first_frame',discussion:false}});
  await waitUntil(()=>service.workspace.tasks.find(x=>x.id===t.id)?.state==='save_failed');assert.equal(submissions,1);
  await service.retryTask(t.id);await waitUntil(()=>service.workspace.tasks.find(x=>x.id===t.id)?.state==='succeeded');assert.equal(submissions,1);assert.equal(downloads,2);assert.ok(service.workspace.selectedVideoId);
 }finally{globalThis.fetch=original;service.close();store.close();}
});
test('OpenAI and Claude prompt assistants preserve multimodal request contracts',async()=>{
 const {chat}=await import('../electron/providers');const original=globalThis.fetch;const requests:{url:string;body:any;headers:any}[]=[];
 globalThis.fetch=async(input,init)=>{const url=String(input);requests.push({url,body:JSON.parse(String(init?.body)),headers:init?.headers});return Response.json(url.includes('anthropic')?{content:[{type:'text',text:'镜头缓慢推近'}]}:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'森林木屋，清晨'}]}]});};
 try{
  const image='data:image/png;base64,dGVzdA==';assert.equal(await chat({...defaults},'test-key','森林木屋',[image],[],false),'森林木屋，清晨');
  assert.equal(await chat({...defaults,chatProvider:'anthropic'},'test-key','镜头',[image],[],false),'镜头缓慢推近');
  assert.equal(requests[0].url,'https://api.openai.com/v1/responses');assert.equal(requests[0].body.model,'gpt-6.1-sol');assert.equal(requests[0].body.input.at(-1).content[1].image_url,image);assert.deepEqual(requests[0].body.reasoning,{effort:'medium',mode:'standard'});assert.equal(requests[1].body.messages.at(-1).content[1].source.type,'base64');assert.equal(requests[1].headers['anthropic-version'],'2023-06-01');
 }finally{globalThis.fetch=original;}
});
test('image edits upload binary references and return actual image bytes',async()=>{
 const {generateImage}=await import('../electron/providers');const bytes=readFileSync('tests/fixtures/image.png');const original=globalThis.fetch;let received=false;
 globalThis.fetch=async(input,init)=>{assert.ok(String(input).endsWith('/images/edits'));assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('model'),'gpt-image-2.5-sunburst');const file=init.body.get('image[]') as File;assert.equal(file.size,bytes.length);assert.equal(file.type,'image/png');received=true;return Response.json({data:[{b64_json:bytes.toString('base64')}]});};
 try{const result=await generateImage(task({kind:'image'}),[image],()=>bytes,'test-key');assert.ok(received);assert.ok(result.equals(bytes));}finally{globalThis.fetch=original;}
});

test('Sunburst migration persists once and preserves historical task settings and custom models',()=>{
 const {store,service}=fixture();
 try{
  const legacy=structuredClone(service.workspace);delete legacy.imageModelDefaultVersion;legacy.settings.imageModel='gpt-image-1.5';
  legacy.tasks=[task({kind:'image',state:'succeeded',settings:{...defaults,imageModel:'gpt-image-1.5'}})];
  store.save(legacy);
  const upgraded=store.load();assert.equal(upgraded.settings.imageModel,'gpt-image-2.5-sunburst');assert.equal(upgraded.tasks[0].settings.imageModel,'gpt-image-1.5');
  assert.equal(JSON.parse(String(store.db.prepare('SELECT data FROM workspace WHERE id=1').get()!.data)).settings.imageModel,'gpt-image-2.5-sunburst');
  upgraded.settings.imageModel='gpt-image-1.5';store.save(upgraded);assert.equal(store.load().settings.imageModel,'gpt-image-1.5');
  delete legacy.imageModelDefaultVersion;legacy.settings.imageModel='custom-image-model';store.save(legacy);assert.equal(store.load().settings.imageModel,'custom-image-model');
 }finally{service.close();store.close();}
});
test('Sunburst text-to-image uses the Image API and decodes its base64 output',async()=>{
 const {generateImage}=await import('../electron/providers');const bytes=readFileSync('tests/fixtures/image.png');const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  assert.equal(String(input),'https://api.openai.com/v1/images/generations');assert.equal(init?.method,'POST');
  const body=JSON.parse(String(init?.body));assert.equal(body.model,'gpt-image-2.5-sunburst');assert.equal(body.prompt,'森林木屋');assert.equal(body.size,'1024x1024');assert.equal(body.quality,'medium');assert.equal(body.n,1);assert.ok(!('response_format' in body));
  return Response.json({data:[{b64_json:bytes.toString('base64')}]});
 };
 try{assert.ok((await generateImage(task({kind:'image',effectivePrompt:'森林木屋'}),[],()=>bytes,'test-key')).equals(bytes));}finally{globalThis.fetch=original;}
});
test('media ranges support streaming, seeking and suffix reads without invalid file access',async()=>{
 const {parseRange}=await import('../electron/range');assert.deepEqual(parseRange(null,100),{start:0,end:99,partial:false});assert.deepEqual(parseRange('bytes=0-15',100),{start:0,end:15,partial:true});assert.deepEqual(parseRange('bytes=50-',100),{start:50,end:99,partial:true});assert.deepEqual(parseRange('bytes=-12',100),{start:88,end:99,partial:true});assert.equal(parseRange('bytes=100-',100),undefined);assert.equal(parseRange('bytes=9-5',100),undefined);assert.equal(parseRange('bytes=0-1,4-5',100),undefined);
});

test('Sol sends all five efforts and both modes with text history and image references',async()=>{
 const {chat}=await import('../electron/providers');const {reasoningEfforts,reasoningModes}=await import('../src/shared/types');const original=globalThis.fetch;
 try{
  for(const effort of reasoningEfforts)for(const mode of reasoningModes){
   globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),'https://api.openai.com/v1/responses');const b=JSON.parse(String(init?.body));
    assert.deepEqual(b.reasoning,{effort,mode});assert.equal(b.store,false);assert.equal(b.input[0].content,'先确定画面');assert.equal(b.input[1].content[0].text,'分析素材');assert.equal(b.input[1].content[1].type,'input_image');assert.ok(!('temperature' in b));
    return Response.json({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'构图建议'},{type:'output_text',text:'光线建议'}]}]});
   };
   assert.equal(await chat({...defaults,openaiReasoningEffort:effort,openaiReasoningMode:mode},'test-key','分析素材',['data:image/png;base64,dGVzdA=='],[{role:'user',text:'先确定画面'}],true),'构图建议\n光线建议');
  }
 }finally{globalThis.fetch=original;}
});
test('Sol rejects incomplete responses and displays refusals instead of using partial prompts',async()=>{
 const {chat}=await import('../electron/providers');const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'partial'}]}]});
  await assert.rejects(()=>chat({...defaults},'test','prompt',[],[],false),/未完成/);
  globalThis.fetch=async()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'无法处理此请求'}]}]});
  await assert.rejects(()=>chat({...defaults},'test','prompt',[],[],false),/无法处理/);
 }finally{globalThis.fetch=original;}
});
test('chat migration persists reasoning defaults and preserves prior tasks and later model choices',()=>{
 const {store,service}=fixture();
 try{
  const old=structuredClone(service.workspace);delete old.chatModelDefaultVersion;old.settings.openaiModel='gpt-4.1';delete (old.settings as any).openaiReasoningEffort;delete (old.settings as any).openaiReasoningMode;
  old.tasks=[task({state:'succeeded',settings:{...defaults,openaiModel:'gpt-4.1'}})];store.save(old);
  const next=store.load();assert.equal(next.settings.openaiModel,'gpt-6.1-sol');assert.equal(next.settings.openaiReasoningEffort,'medium');assert.equal(next.settings.openaiReasoningMode,'standard');assert.equal(next.tasks[0].settings.openaiModel,'gpt-4.1');
  next.settings.openaiModel='gpt-4.1';next.settings.openaiReasoningEffort='max';next.settings.openaiReasoningMode='pro';store.save(next);assert.equal(store.load().settings.openaiModel,'gpt-4.1');assert.equal(store.load().settings.openaiReasoningEffort,'max');
  old.settings.openaiModel='custom-chat-model';store.save(old);assert.equal(store.load().settings.openaiModel,'custom-chat-model');
  assert.throws(()=>service.saveSettings({...defaults,openaiReasoningEffort:'ultra' as any},{}),/推理参数/);
  assert.throws(()=>service.saveSettings({...defaults,openaiReasoningMode:'invalid' as any},{}),/推理参数/);
 }finally{service.close();store.close();}
});
test('explicit legacy chat model retains Chat Completions without Sol reasoning fields',async()=>{
 const {chat}=await import('../electron/providers');const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{assert.ok(String(input).endsWith('/chat/completions'));const b=JSON.parse(String(init?.body));assert.equal(b.model,'gpt-4.1');assert.ok(!('reasoning' in b));return Response.json({choices:[{message:{content:'legacy result'}}]});};
 try{assert.equal(await chat({...defaults,openaiModel:'gpt-4.1'},'test','prompt',[],[],true),'legacy result');}finally{globalThis.fetch=original;}
});
test('legacy sample settings cannot bypass API credentials after migration',async()=>{
 const {store,service}=fixture();const legacy=structuredClone(service.workspace) as any;legacy.demo=true;legacy.tasks=[{...task({state:'succeeded'}),demo:true}];store.save(legacy);service.close();const reopened=new Service(store,service.vault,()=>{});assert.ok(!('demo' in reopened.workspace));assert.ok(!('demo' in reopened.workspace.tasks[0]));assert.equal(reopened.workspace.tasks[0].legacySample,true);await assert.rejects(()=>reopened.generate({kind:'image',requestId:'missing-key',draft:{prompt:'画一只猫',attachmentIds:[],mode:'first_frame',discussion:false}}),/OpenAI API Key/);assert.equal(reopened.workspace.assets.length,0);reopened.close();store.close();
});

test('deleting a generated image trashes its file, cleans drafts and persists the remaining selection',async()=>{
 const {store,service}=fixture();
 try{
  const a=await service.assets.import('output.png',readFileSync('tests/fixtures/image.png'),'image-task');
  const remaining=await service.assets.import('keep.png',readFileSync('tests/fixtures/image.png'),'keep-task');
  const video:Asset={...image,id:'video-keep',type:'video',mime:'video/mp4'};
  service.workspace.assets=[a,remaining,video];service.workspace.selectedImageId=a.id;service.workspace.selectedVideoId=video.id;
  service.workspace.tasks=[task({id:'image-task',kind:'image',state:'succeeded',baseImageId:undefined,outputAssetIds:[a.id]}),task({id:'video-task',state:'succeeded',baseImageId:a.id,outputAssetIds:[video.id]})];
  service.workspace.messages=[{id:'m',kind:'image',role:'user',text:'原始描述',createdAt:0,assetIds:[a.id]}];
  service.saveDraft('image',{prompt:'图片草稿',attachmentIds:[a.id,remaining.id],editImageId:a.id,mode:'first_frame',discussion:false});
  service.saveDraft('video',{prompt:'视频草稿',attachmentIds:[a.id],baseImageId:a.id,mode:'first_frame',discussion:false});
  const originalPath=service.assets.path(a),trashPath=originalPath+'.trashed';
  const result=await service.deleteGeneratedImage(a.id,async path=>{assert.equal(path,originalPath);renameSync(path,trashPath);});
  assert.ok(!existsSync(originalPath));assert.ok(existsSync(trashPath));assert.deepEqual(result.assets.map(a=>a.id),[remaining.id,video.id]);assert.equal(result.selectedImageId,remaining.id);assert.equal(result.selectedVideoId,video.id);
  assert.equal(result.drafts.image.prompt,'图片草稿');assert.equal(result.drafts.video.prompt,'视频草稿');assert.deepEqual(result.drafts.image.attachmentIds,[remaining.id]);assert.equal(result.drafts.image.editImageId,undefined);assert.equal(result.drafts.video.baseImageId,undefined);assert.deepEqual(result.drafts.video.attachmentIds,[]);
  assert.equal(result.messages[0].text,'原始描述');assert.deepEqual(result.messages[0].assetIds,[]);assert.equal(result.tasks[1].baseImageId,a.id);assert.deepEqual(result.tasks[0].outputAssetIds,[]);assert.equal(store.load().selectedImageId,remaining.id);
  await service.deleteGeneratedImage(remaining.id,async path=>renameSync(path,path+'.trashed'));assert.equal(store.load().selectedImageId,undefined);
 }finally{service.close();store.close();}
});
test('image deletion refuses uploads, unknown IDs and images used by active or uncertain tasks',async()=>{
 const {store,service}=fixture();let fileCalls=0;const trash=async()=>{fileCalls++;};
 try{
  const generated={...image,sourceTaskId:'producer'};service.workspace.assets=[generated,{...image,id:'upload'}];
  await assert.rejects(()=>service.deleteGeneratedImage('upload',trash),/只能删除/);await assert.rejects(()=>service.deleteGeneratedImage('missing',trash),/只能删除/);
  for(const state of ['preparing','submitting','queued','running','saving','submission_unknown'] as const){
   for(const refs of [{baseImageId:generated.id},{editImageId:generated.id,baseImageId:undefined},{assetIds:[generated.id],baseImageId:undefined}]){
    service.workspace.tasks=[task({state,...refs})];await assert.rejects(()=>service.deleteGeneratedImage(generated.id,trash),/正在被生成任务/);
   }
  }
  assert.equal(fileCalls,0);assert.equal(service.workspace.assets.length,2);
 }finally{service.close();store.close();}
});
test('failed trash operations preserve image state and block new tasks while deletion is pending',async()=>{
 const {store,service}=fixture();
 try{
  const a=await service.assets.import('output.png',readFileSync('tests/fixtures/image.png'),'producer');service.workspace.assets=[a];service.workspace.selectedImageId=a.id;service.changed();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const deletion=service.deleteGeneratedImage(a.id,async()=>{await gate;throw new Error('trash failed');});
  await assert.rejects(()=>service.deleteGeneratedImage(a.id,async()=>{}),/正在删除/);
  await assert.rejects(()=>service.generate({kind:'image',requestId:'while-deleting',draft:{prompt:'edit',attachmentIds:[a.id],mode:'first_frame',discussion:false}}),/正在删除/);
  release();await assert.rejects(()=>deletion,/trash failed/);assert.ok(existsSync(service.assets.path(a)));assert.equal(store.load().selectedImageId,a.id);assert.equal(service.deletingImageIds.size,0);
 }finally{service.close();store.close();}
});
