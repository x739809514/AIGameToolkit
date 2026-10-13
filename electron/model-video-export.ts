import {normalizeMotionBlend} from '../src/shared/motion-blend';
import {normalizeMotionTimeline} from '../src/shared/motion-timeline';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import {modelVideoFrames,type ModelVideoInput} from '../src/shared/model-video';
import type {Service} from './service';
interface ExportJob {id:string;input:ModelVideoInput;directory:string;target:string;encoder:ChildProcessWithoutNullStreams;done:Promise<void>;count:number;received:number;writing:boolean;finishing:boolean;cancelled:boolean;released:boolean;timer:ReturnType<typeof setTimeout>;error?:string}
export class ModelVideoExporter {
  jobs=new Map<string,ExportJob>();
  constructor(public service:Service){}
  begin(input:ModelVideoInput){
    if(this.service.closed||this.service.workspace.workbenchType!=='motion-editor')throw new Error('请在动作编辑器中导出视频。');
    if(this.jobs.size)throw new Error('已有视频导出任务，请等待或取消。');
    const count=modelVideoFrames(input);if(!this.service.workspace.assets.some(a=>a.id===input.assetId&&a.type==='model'))throw new Error('FBX 模型不存在。');
    if(input.timelineItems)normalizeMotionTimeline(input.timelineItems,id=>this.service.workspace.assets.some(a=>a.id===id&&a.type==='model'));
    if(input.blendTree)normalizeMotionBlend(input.blendTree,id=>this.service.workspace.assets.some(a=>a.id===id&&a.type==='model'));
    const directory=mkdtempSync(join(this.service.assets.directory,'model-video-')),target=join(directory,'video.mp4');
    const encoder=spawn(ffmpeg!.replace('app.asar/','app.asar.unpacked/'),['-y','-v','error','-f','rawvideo','-pixel_format','rgba','-video_size',`${input.width}x${input.height}`,'-framerate',String(input.fps),'-i','pipe:0','-vf','vflip','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-frames:v',String(count),'-movflags','+faststart',target],{stdio:['pipe','pipe','pipe']});
    const job:ExportJob={id:randomUUID(),input:structuredClone(input),directory,target,encoder,done:Promise.resolve(),count,received:0,writing:false,finishing:false,cancelled:false,released:false,timer:setTimeout(()=>{},0)};clearTimeout(job.timer);
    let stderr='';encoder.stderr.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-4000);});encoder.stdout.resume();encoder.stdin.on('error',error=>{job.error=error.message;});
    job.done=new Promise<void>((resolve,reject)=>{encoder.on('error',error=>{job.error=error.message;reject(new Error('本地视频编码器启动失败。'));});encoder.on('close',code=>{if(code===0&&!job.cancelled)resolve();else{job.error=stderr||job.error||'视频编码已中断。';reject(new Error(job.cancelled?'视频导出已取消。':'本地视频编码失败：'+job.error));}if(!job.finishing&&job.received<count)this.release(job);});});void job.done.catch(()=>{});
    this.jobs.set(job.id,job);this.service.localOperations++;this.touch(job);return {id:job.id,count};
  }
  touch(job:ExportJob){clearTimeout(job.timer);job.timer=setTimeout(()=>this.cancel(job.id),120000);job.timer.unref();}
  job(id:string){const job=this.jobs.get(id);if(!job||job.cancelled||job.error)throw new Error('视频导出已取消或中断，请重新导出。');return job;}
  async frame(id:string,index:number,bytes:ArrayBuffer){
    const job=this.job(id);if(job.finishing||job.writing||index!==job.received||index>=job.count||!(bytes instanceof ArrayBuffer)||bytes.byteLength!==job.input.width*job.input.height*4)throw new Error('视频帧格式或顺序不正确。');
    job.writing=true;this.touch(job);try{await new Promise<void>((resolve,reject)=>job.encoder.stdin.write(Buffer.from(bytes),error=>error?reject(new Error('视频编码连接中断。')):resolve()));if(job.cancelled)throw new Error('视频导出已取消。');job.received++;}finally{job.writing=false;}
  }
  async finish(id:string){
    const job=this.job(id);if(job.finishing||job.writing||job.received!==job.count)throw new Error('视频帧尚未全部完成。');job.finishing=true;this.touch(job);
    try{job.encoder.stdin.end();await job.done;if(job.cancelled||this.service.closed)throw new Error('视频导出已取消。');if(statSync(job.target).size>200*1024*1024)throw new Error('导出视频超过 200 MB，请缩短动画范围。');
      const model=this.service.workspace.assets.find(a=>a.id===job.input.assetId)!;
      const asset=await this.service.assets.import((job.input.blendTree?'骨骼混合':job.input.timelineItems?'动作时间轴':model.name.replace(/\.[^.]+$/,''))+'-相机视角.mp4',readFileSync(job.target),undefined,200);
      if(job.cancelled||this.service.closed){rmSync(this.service.assets.path(asset),{force:true});for(let i=0;i<3;i++)rmSync(this.service.assets.framePath(asset.id,i),{force:true});throw new Error('视频导出已取消。');}
      asset.sourceAssetId=model.id;if(job.input.blendTree)asset.motionBlend=structuredClone(job.input.blendTree);if(job.input.timelineItems)asset.motionTimeline=structuredClone(job.input.timelineItems);this.service.workspace.assets.push(asset);this.release(job);this.service.changed();return asset;
    }finally{this.release(job);}
  }
  cancel(id:string){const job=this.jobs.get(id);if(!job)return;job.cancelled=true;job.encoder.stdin.destroy();job.encoder.kill('SIGTERM');if(!job.finishing)this.release(job);}
  release(job:ExportJob){if(job.released)return;job.released=true;clearTimeout(job.timer);this.jobs.delete(job.id);rmSync(job.directory,{recursive:true,force:true});this.service.localOperations--;}
  close(){for(const id of this.jobs.keys())this.cancel(id);}
}
