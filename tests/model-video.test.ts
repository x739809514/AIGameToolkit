import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {PNG} from 'pngjs';
import {Workbenches} from '../electron/workbenches';
import {modelVideoFrames,modelVideoFrameTime,type ModelVideoInput} from '../src/shared/model-video';
const run=promisify(execFile),vault={secure:false,get:()=>undefined,set:()=>{}};
const settings:ModelVideoInput={assetId:'model',clipIndex:0,start:0,end:.25,speed:1,width:128,height:128,fps:24};
test('export samples exactly once, respects range and speed, and rejects invalid parameters',()=>{
 assert.equal(modelVideoFrames(settings),6);assert.equal(modelVideoFrameTime({...settings,start:2,end:3,speed:2},6),2.5);assert.equal(modelVideoFrames({...settings,end:1,speed:.5,fps:30}),60);
 for(const change of [{end:0},{start:NaN},{fps:25},{width:129},{height:6000},{speed:0},{end:301}])assert.throws(()=>modelVideoFrames({...settings,...change}));
});
test('raw camera frames encode to a real H264 MP4 with correct timing and vertical orientation',async()=>{
 const manager=new Workbenches(mkdtempSync(join(tmpdir(),'model-video-')),vault,()=>{}),entry=manager.create('motion-editor'),service=manager.get(entry.id),raw=readFileSync('tests/fixtures/dancing.fbx');
 try{const [model]=await service.importFiles([{name:'actor.fbx',bytes:Uint8Array.from(raw).buffer}]),input={...settings,assetId:model.id},job=service.modelVideo.begin(input);
 assert.equal(service.localOperations,1);assert.throws(()=>service.modelVideo.begin(input),/已有/);await assert.rejects(()=>service.modelVideo.frame(job.id,1,new ArrayBuffer(128*128*4)),/顺序/);await assert.rejects(()=>service.modelVideo.frame(job.id,0,new ArrayBuffer(4)),/格式/);await assert.rejects(()=>service.modelVideo.finish(job.id),/尚未/);
 const pixels=new Uint8Array(128*128*4);for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;pixels[i]=y<64?240:0;pixels[i+2]=y>=64?240:0;pixels[i+3]=255;}
 for(let i=0;i<job.count;i++)await service.modelVideo.frame(job.id,i,pixels.buffer);const asset=await service.modelVideo.finish(job.id);assert.equal(asset.type,'video');assert.equal(asset.sourceAssetId,model.id);assert.equal(service.localOperations,0);assert.equal(service.modelVideo.jobs.size,0);assert.ok(!readdirSync(service.assets.directory).some(name=>name.startsWith('model-video-')));
 const {stdout}=await run(ffprobe.path,['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration','-of','json',service.assets.path(asset)]),meta=JSON.parse(stdout);assert.equal(meta.streams[0].codec_name,'h264');assert.equal(meta.streams[0].nb_read_frames,'6');assert.equal(meta.streams[0].avg_frame_rate,'24/1');assert.equal(meta.streams[0].width,128);assert.ok(Math.abs(Number(meta.format.duration)-.25)<.01);
 const pngBytes=await run(ffmpeg!,['-v','error','-i',service.assets.path(asset),'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});const png=PNG.sync.read(pngBytes.stdout),top=(16*128+16)*4,bottom=(112*128+16)*4;assert.ok(png.data[top+2]>200&&png.data[top]<20);assert.ok(png.data[bottom]>200&&png.data[bottom+2]<20);
 }finally{manager.close();}
});
test('cancellation cleans temporary output and does not add assets; jobs cannot cross workbenches',async()=>{
 const manager=new Workbenches(mkdtempSync(join(tmpdir(),'model-video-cancel-')),vault,()=>{}),a=manager.create('motion-editor'),b=manager.create('motion-editor'),service=manager.get(a.id);
 try{const [model]=await service.importFiles([{name:'actor.fbx',bytes:Uint8Array.from(readFileSync('tests/fixtures/dancing.fbx')).buffer}]);const job=service.modelVideo.begin({...settings,assetId:model.id});await assert.rejects(()=>manager.get(b.id).modelVideo.frame(job.id,0,new ArrayBuffer(128*128*4)),/中断/);service.modelVideo.cancel(job.id);service.modelVideo.cancel(job.id);assert.equal(service.localOperations,0);assert.equal(service.workspace.assets.length,1);assert.ok(!readdirSync(service.assets.directory).some(name=>name.startsWith('model-video-')));await assert.rejects(()=>service.modelVideo.finish(job.id),/中断/);
 }finally{manager.close();}
});
