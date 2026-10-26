import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Assets} from '../electron/assets';
import {Store} from '../electron/store';
import {Service} from '../electron/service';
import {readPNG} from '../electron/image-processing';
import {validateOutputResolution,type OutputResolution} from '../src/shared/output-resolution';
const fits=['scale-crop','crop-scale','contain'] as const;
async function until(check:()=>boolean){for(let i=0;i<2000;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('timeout');}
test('rejects unsafe target dimensions and invalid adaptation before media work',()=>{
  for(const width of [0,-1,NaN,Infinity,1.5,8193])assert.throws(()=>validateOutputResolution({width,height:100,fit:'scale-crop'}));
  assert.throws(()=>validateOutputResolution({width:8192,height:8192,fit:'contain'}));
  assert.throws(()=>validateOutputResolution({width:100,height:100,fit:'invalid' as any}));
});
test('each fit produces exact odd and even image and video pixels and cleans its working files',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'resolution-')),assets=new Assets(directory);
  try{for(const fit of fits)for(const kind of ['image','video'] as const)for(const odd of [false,true]){
    const target={width:odd?321:320,height:odd?179:240,fit};
    const bytes=await assets.fitOutput(readFileSync(`tests/fixtures/${kind==='image'?'image.png':'video.mp4'}`),kind,target);
    assert.deepEqual(readdirSync(directory),[]);
    if(kind==='image'){const png=readPNG(bytes);assert.equal(png.width,target.width);assert.equal(png.height,target.height);}
    const a=await assets.import(kind==='image'?'output.png':'output.mp4',bytes);
    assert.equal(a.warning,undefined);assert.equal(a.width,target.width);assert.equal(a.height,target.height);
    if(kind==='video'){assert.ok(a.duration!>0);assert.ok(a.fps!>0);assert.equal(a.videoCodec,'h264');}
    for(const file of readdirSync(directory))rmSync(join(directory,file));
  }}finally{assets.close();rmSync(directory,{recursive:true,force:true});}
});
test('image target is frozen, persisted, and local fit retry never resubmits a paid request',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'resolution-service-')),store=new Store(directory),service=new Service(store,{secure:false,get:()=> 'test-key',set:()=>{}},()=>{}),original=globalThis.fetch;let submissions=0;
  const target:OutputResolution={width:301,height:507,fit:'crop-scale'},fit=service.assets.fitOutput.bind(service.assets);
  globalThis.fetch=async(_input,init)=>{submissions++;assert.equal(JSON.parse(String(init?.body)).size,'1024x1536');return Response.json({data:[{b64_json:readFileSync('tests/fixtures/image.png').toString('base64')}]});};
  try{
    const draft={prompt:'角色',attachmentIds:[],mode:'text' as const,discussion:false,outputResolution:target};
    service.saveDraft('image',draft);service.saveDraft('video',{...draft,outputResolution:{width:1280,height:720,fit:'scale-crop'}});
    assert.equal(store.load().drafts.image.outputResolution?.width,301);assert.equal(store.load().drafts.video.outputResolution?.width,1280);
    service.assets.fitOutput=async()=>{throw Error('local encoding failed');};
    const created=await service.generate({kind:'image',requestId:'resolution',draft});target.width=400;
    await until(()=>service.workspace.tasks[0].state==='save_failed');assert.equal(submissions,1);
    service.assets.fitOutput=fit;await service.retryTask(created.id);
    const task=service.workspace.tasks[0];assert.equal(task.state,'succeeded',task.error);assert.equal(submissions,1);
    const asset=service.workspace.assets.find(a=>a.id===task.outputAssetIds[0])!;assert.equal(asset.width,301);assert.equal(asset.height,507);
    assert.deepEqual(store.load().tasks[0].outputResolution,{width:301,height:507,fit:'crop-scale'});
  }finally{globalThis.fetch=original;service.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
test('unsupported custom video pixels are adapted locally; a failed adaptation only retries the saved remote result',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'video-resolution-')),store=new Store(directory),service=new Service(store,{secure:false,get:()=> 'test-key',set:()=>{}},()=>{}),original=globalThis.fetch;let submissions=0;
  const fit=service.assets.fitOutput.bind(service.assets);
  globalThis.fetch=async(input,init)=>{
    if(init?.method==='POST'){submissions++;const body=JSON.parse(String(init.body));assert.equal(body.resolution,'768P');return Response.json({task_id:'custom-video'});}
    if(String(input).includes('/query/'))return Response.json({task:{status:'succeeded',content:{url:'https://test.invalid/output.mp4'}}});
    return new Response(readFileSync('tests/fixtures/video.mp4'));
  };
  try{
    service.assets.fitOutput=async()=>{throw Error('encoding unavailable');};
    const task=await service.generate({kind:'video',requestId:'custom-video',draft:{prompt:'挥手',attachmentIds:[],mode:'text',discussion:false,outputResolution:{width:501,height:303,fit:'scale-crop'}}});
    await until(()=>service.workspace.tasks[0].state==='save_failed');
    service.assets.fitOutput=fit;await service.retryTask(task.id);
    const saved=service.workspace.tasks[0];assert.equal(saved.state,'succeeded',saved.error);assert.equal(submissions,1);
    const asset=service.workspace.assets.find(a=>a.id===saved.outputAssetIds[0])!;assert.equal(asset.width,501);assert.equal(asset.height,303);
  }finally{globalThis.fetch=original;service.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
