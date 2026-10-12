import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {Workbenches} from '../electron/workbenches';
import {Store} from '../electron/store';
import {Service,type Vault} from '../electron/service';
import {buildVideoBody,validateVideo} from '../electron/providers';
import {readPNG} from '../electron/image-processing';
import {defaults,defaultFrameWorkspace,type Task,type Asset} from '../src/shared/types';
function fixture(){const store=new Store(mkdtempSync(join(tmpdir(),'video-frames-'))),vault:Vault={secure:false,get:()=> 'test-key',set:()=>{}};const service=new Service(store,vault,()=>{});service.workspace.workbenchType='video-frames';service.workspace.frameWorkspace=defaultFrameWorkspace();return {store,service};}
async function until(check:()=>boolean){for(let i=0;i<1200;i++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error('timeout');}
const image:Asset={id:'first',name:'first.png',type:'image',mime:'image/png',size:100,width:1024,height:1024,url:'asset://local/first',createdAt:0};
const task=(patch:Partial<Task>={}):Task=>({id:'task',requestId:'request',kind:'video',state:'submitting',createdAt:Date.now(),updatedAt:Date.now(),prompt:'镜头推近',assetIds:[],mode:'text',discussion:false,settings:{...defaults},outputAssetIds:[],...patch});
test('H3 first and last images map to distinct roles; text generation uses a fixed aspect ratio',()=>{
 const last={...image,id:'last'};const t=task({mode:'first_last',baseImageId:'first',lastImageId:'last'});const b=buildVideoBody(t,[last,image],a=>a.url);assert.deepEqual(b.content.slice(1).map(c=>c.role),['last_frame','first_frame']);assert.equal(b.ratio,'adaptive');assert.equal(buildVideoBody(task(),[],()=> '').ratio,'16:9');assert.throws(()=>validateVideo(t,[image]),/两张/);assert.throws(()=>validateVideo(task({mode:'text'}),[image]),/纯文字/);assert.throws(()=>validateVideo(t,[image,last,{...image,id:'v',type:'video'}]),/参考视频/);
});
test('local split produces exact requested PNG count, timestamps and preserved video without an API request',async()=>{
 const {store,service}=fixture();const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('No paid request allowed');};
 try{const [video]=await service.importFiles([{name:'uploaded.mp4',bytes:Uint8Array.from(readFileSync('tests/fixtures/video.mp4')).buffer}]);const bytes=service.assets.bytes(video);const seq=await service.splitVideo({assetId:video.id,count:20,requestId:'local-split'});assert.equal(seq.status,'succeeded');assert.equal(seq.frames.length,20);assert.equal(seq.frames[0].time,0);assert.ok(seq.frames[19].time<video.duration!);assert.ok(seq.frames[19].time>video.duration!-.2);assert.ok(bytes.equals(service.assets.bytes(video)));for(const frame of seq.frames){const a=service.workspace.assets.find(a=>a.id===frame.assetId)!;const png=readPNG(service.assets.bytes(a));assert.equal(png.width,video.width);assert.equal(png.height,video.height);assert.equal(a.frame?.index,frame.index);assert.equal(a.frame?.sequenceId,seq.id);}assert.equal(store.load().frameWorkspace?.sequences[0].frames.length,20);assert.equal((await service.splitVideo({assetId:video.id,count:20,requestId:'local-split'})).id,seq.id);assert.equal(service.workspace.frameWorkspace?.sequences.length,1);service.selectFrame(seq.id,9);assert.equal(service.workspace.selectedImageId,seq.frames[9].assetId);assert.throws(()=>service.saveFrameOptions({mode:'split',frameCount:0}),/1–240/);await assert.rejects(()=>service.splitVideo({assetId:video.id,count:2.5,requestId:'bad'}),/1–240/);}finally{globalThis.fetch=original;service.close();store.close();}
});
test('generated videos automatically split at the submitted count even after the current count changes',async()=>{
 const {store,service}=fixture();const original=globalThis.fetch;let submissions=0;
 globalThis.fetch=async(input,init)=>{const url=String(input);if(init?.method==='POST'){submissions++;const b=JSON.parse(String(init.body));assert.equal(b.content[0].text,'角色挥手');assert.equal(b.ratio,'16:9');return Response.json({task_id:'auto-frames-remote'});}if(url.includes('/query/'))return Response.json({task:{status:'succeeded',content:{url:'https://test.invalid/generated.mp4'}}});return new Response(readFileSync('tests/fixtures/video.mp4'));};
 try{service.saveFrameOptions({mode:'normal',frameCount:7});const t=await service.generate({kind:'video',requestId:'generate-seven',draft:{prompt:'角色挥手',attachmentIds:[],mode:'text',discussion:false}});assert.equal(t.autoFrameCount,7);service.saveFrameOptions({mode:'normal',frameCount:20});await until(()=>service.workspace.frameWorkspace!.sequences.some(s=>s.status==='succeeded'));assert.equal(submissions,1);assert.equal(service.workspace.tasks.find(x=>x.id===t.id)!.state,'succeeded');const seq=service.workspace.frameWorkspace!.sequences[0];assert.equal(seq.frames.length,7);assert.equal(seq.count,7);assert.equal(service.workspace.frameWorkspace!.frameCount,20);assert.ok(service.workspace.assets.some(a=>a.id===seq.videoId&&a.type==='video'));}finally{globalThis.fetch=original;service.close();store.close();}
});
test('split samples real frames despite rounded container duration and an audio track beyond the video',async()=>{
 const {store,service}=fixture(),directory=mkdtempSync(join(tmpdir(),'rounded-video-')),rounded=join(directory,'rounded.mp4'),audio=join(directory,'long-audio.mp4'),run=promisify(execFile);
 try{
  await run(ffmpeg!,['-y','-v','error','-f','lavfi','-i','testsrc2=size=80x80:rate=24','-frames:v','124','-c:v','libx264','-pix_fmt','yuv420p',rounded]);
  await run(ffmpeg!,['-y','-v','error','-i',rounded,'-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','copy','-c:a','aac',audio]);
  for(const file of [rounded,audio]){
   const [video]=await service.importFiles([{name:'regression.mp4',bytes:Uint8Array.from(readFileSync(file)).buffer}]);
   assert.ok(video.duration!>5.166666);
   const seq=await service.splitVideo({assetId:video.id,count:20,requestId:file});
   assert.equal(seq.frames.length,20);assert.equal(seq.frames[19].time,5.125);
   for(const frame of seq.frames){const asset=service.workspace.assets.find(a=>a.id===frame.assetId)!;assert.equal(readPNG(service.assets.bytes(asset)).width,80);}
  }
 }finally{service.close();store.close();}
});
test('editing a timeline frame updates that slot while preserving its original and permits restoration',async()=>{
 const {store,service}=fixture();const original=globalThis.fetch;
 try{const [video]=await service.importFiles([{name:'video.mp4',bytes:Uint8Array.from(readFileSync('tests/fixtures/video.mp4')).buffer}]);const seq=await service.splitVideo({assetId:video.id,count:3,requestId:'three'});service.selectFrame(seq.id,1);const source=service.workspace.assets.find(a=>a.id===seq.frames[1].assetId)!,bytes=service.assets.bytes(source);
  globalThis.fetch=async(input,init)=>{assert.ok(String(input).endsWith('/images/edits'));assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('model'),'gpt-image-2.5-sunburst');assert.equal(init.body.get('mask'),null);return Response.json({data:[{b64_json:bytes.toString('base64')}]});};
  const t=await service.editImage({assetId:source.id,requestId:'edit-frame',operation:'edit',prompt:'将帽子改成红色'});await until(()=>service.workspace.tasks.find(x=>x.id===t.id)?.state==='succeeded');const result=service.workspace.tasks.find(x=>x.id===t.id)!.outputAssetIds[0],slot=service.workspace.frameWorkspace!.sequences[0].frames[1];assert.equal(slot.assetId,result);assert.equal(slot.originalAssetId,source.id);assert.deepEqual(slot.versions,[source.id,result]);assert.equal(service.workspace.assets.find(a=>a.id===result)!.frame?.index,1);assert.ok(service.assets.bytes(source).equals(bytes));service.restoreFrame(seq.id,1);assert.equal(slot.assetId,source.id);assert.equal(service.workspace.selectedImageId,source.id);
 }finally{globalThis.fetch=original;service.close();store.close();}
});
test('interrupted frame extraction can retry locally without resubmitting a completed video task',()=>{
 const {store,service}=fixture();service.workspace.frameWorkspace!.sequences.push({id:'seq',requestId:'split',videoId:'video',count:20,status:'extracting',createdAt:1,frames:[]});service.changed();service.close();const next=new Service(store,{secure:false,get:()=>undefined,set:()=>{}},()=>{});try{assert.equal(next.workspace.frameWorkspace!.sequences[0].status,'failed');assert.match(next.workspace.frameWorkspace!.sequences[0].error!,/重新拆帧/);}finally{next.close();store.close();}
});
test('single and batch frame deletion preserve frame identities, editing, original media and persisted empty sequences',async()=>{
 const {store,service}=fixture();
 try{
  const [video]=await service.importFiles([{name:'delete-test.mp4',bytes:Uint8Array.from(readFileSync('tests/fixtures/video.mp4')).buffer}]);
  const seq=await service.splitVideo({assetId:video.id,count:4,requestId:'delete-frames'}),state=service.workspace.frameWorkspace!,saved=state.sequences[0];
  service.selectFrame(seq.id,0);service.deleteFrames(seq.id,[0]);assert.deepEqual(saved.frames.map(f=>f.index),[1,2,3]);assert.equal(state.selectedFrameIndex,1);
  service.selectFrame(seq.id,2);const source=service.workspace.assets.find(a=>a.id===saved.frames.find(f=>f.index===2)!.assetId)!;
  const edited={...source,id:'edited-surviving-frame'};service.workspace.assets.push(edited);service.updateFrameVersion(source,edited);
  assert.equal(saved.frames.find(f=>f.index===2)!.assetId,edited.id);assert.equal(saved.frames.find(f=>f.index===3)!.assetId,seq.frames[3].assetId);
  service.restoreFrame(seq.id,2);assert.equal(service.workspace.selectedImageId,source.id);
  assert.throws(()=>service.deleteFrames(seq.id,[1,99]),/存在/);assert.equal(saved.frames.length,3);
  service.deleteFrames(seq.id,[1,2]);assert.deepEqual(saved.frames.map(f=>f.index),[3]);assert.equal(state.selectedFrameIndex,3);assert.throws(()=>service.selectFrame(seq.id,2),/不存在/);
  service.deleteFrames(seq.id,[3]);assert.equal(saved.frames.length,0);assert.equal(state.selectedFrameIndex,undefined);assert.equal(service.workspace.selectedImageId,undefined);
  assert.equal(store.load().frameWorkspace!.sequences[0].frames.length,0);assert.ok(service.assets.bytes(video).length);assert.ok(service.assets.bytes(source).length);
 }finally{service.close();store.close();}
});
