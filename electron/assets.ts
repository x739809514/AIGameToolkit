import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { readPNG } from './image-processing';
import {validateFrameCount} from '../src/shared/types';
import type { Asset } from '../src/shared/types';
const exec=promisify(execFile);
const executable=(p:string)=>p.replace('app.asar/','app.asar.unpacked/');
export function inspectFile(name:string,b:Buffer,maxMB=50){
  const ext=extname(name).toLowerCase();let mime='';let type:Asset['type']='document';
  if(ext==='.fbx'&&(b.subarray(0,23).equals(Buffer.from('Kaydara FBX Binary  \0\x1a\0','binary'))||/^\s*;\s*FBX[\s\S]*FBXHeaderExtension:/.test(b.toString('utf8',0,4096)))){mime='application/vnd.autodesk.fbx';type='model';}
  else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime='image/png';type='image';}
  else if(b[0]===255&&b[1]===216&&b[2]===255){mime='image/jpeg';type='image';}
  else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){mime='image/webp';type='image';}
  else if(b.toString('ascii',4,8)==='ftyp'&&['.mp4','.mov'].includes(ext)){mime=ext==='.mov'?'video/quicktime':'video/mp4';type='video';}
  else if(b.toString('ascii',0,5)==='%PDF-'){mime='application/pdf';}
  else if(['.txt','.md','.markdown'].includes(ext)&&!b.includes(0)){mime='text/plain';}
  else throw new Error(`${name}：仅支持 PNG/JPEG/WebP、MP4/MOV、TXT/Markdown/PDF 或 FBX。`);
  if(ext==='.fbx'&&type!=='model')throw new Error(`${name}：不是有效的 FBX 文件。`);
  if(!b.length||b.length>maxMB*1024*1024)throw new Error(`${name}：文件须小于 ${maxMB} MB。`);
  return {mime,type};
}
export class Assets {
  normalizations=new Map<string,Promise<Buffer>>();
  constructor(public directory:string){}
  path(a:Asset){return join(this.directory,a.id+extension(a.mime));}
  framePath(id:string,index:number){return join(this.directory,`${id}-frame-${index}.jpg`);}
  bytes(a:Asset){return readFileSync(this.path(a));}
  dataUrl(a:Asset){return `data:${a.mime};base64,${this.bytes(a).toString('base64')}`;}
  async h3DataUrl(a:Asset){
    if(a.mime!=='video/quicktime')return this.dataUrl(a);
    const target=join(this.directory,`${a.id}-transport.mp4`);
    await exec(executable(ffmpeg!),['-y','-i',this.path(a),'-c','copy','-movflags','+faststart',target],{timeout:30000,maxBuffer:1024*1024});
    return `data:video/mp4;base64,${readFileSync(target).toString('base64')}`;
  }

  async normalizedPNG(a:Asset){
    if(a.type!=='image')throw new Error('请选择图片素材。');
    if(a.mime==='image/png'){const bytes=this.bytes(a);readPNG(bytes);return bytes;}
    const pending=this.normalizations.get(a.id);if(pending)return pending;
    const work=(async()=>{const target=join(this.directory,`${a.id}-normalized.png`);
      await exec(executable(ffmpeg!),['-y','-i',this.path(a),'-frames:v','1','-pix_fmt','rgba',target],{timeout:30000,maxBuffer:1024*1024});
      const bytes=readFileSync(target);readPNG(bytes);return bytes;
    })();this.normalizations.set(a.id,work);try{return await work;}finally{this.normalizations.delete(a.id);}
  }

  async resizePNG(bytes:Buffer,width:number,height:number,id:string){
    const image=readPNG(bytes);if(image.width===width&&image.height===height)return bytes;
    const source=join(this.directory,`${id}-result.png`),target=join(this.directory,`${id}-resized.png`);writeFileSync(source,bytes);
    await exec(executable(ffmpeg!),['-y','-i',source,'-vf',`scale=${width}:${height}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgba',target],{timeout:30000,maxBuffer:1024*1024});return readFileSync(target);
  }
  async extractFrames(video:Asset,count:number,sequenceId:string):Promise<Asset[]>{
    validateFrameCount(count);
    if(video.type!=='video')throw new Error('请选择视频素材进行拆帧。');
    // Container duration can include longer audio or rounded fractions. Seek to
    // decoded frame timestamps instead of estimating the last frame from FPS.
    const {stdout}=await exec(executable(ffprobe.path),['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time:format=start_time','-of','json',this.path(video)],{timeout:60000,maxBuffer:32*1024*1024});
    const metadata=JSON.parse(stdout),start=Number(metadata.format?.start_time)||0;
    const times:number[]=metadata.frames.map((frame:{best_effort_timestamp_time?:string})=>Number(frame.best_effort_timestamp_time)).filter((time:number)=>Number.isFinite(time)).map((time:number)=>Math.max(0,time-start)).sort((a:number,b:number)=>a-b);
    if(!times.length)throw new Error('视频中没有可解码的动画帧，请检查视频文件。');
    const temporary=join(this.directory,`${sequenceId}-extracting`);mkdirSync(temporary,{recursive:true});
    const result:Asset[]=new Array(count);const installed:string[]=[];let next=0;
    const first=times[0],last=times[times.length-1];
    const samples=Array.from({length:count},(_,index)=>{const target=count===1?first:first+(last-first)*index/(count-1);let low=0,high=times.length-1;while(low<high){const mid=Math.floor((low+high)/2);if(times[mid]<target)low=mid+1;else high=mid;}return low>0&&target-times[low-1]<times[low]-target?times[low-1]:times[low];});
    const worker=async()=>{while(next<count){const index=next++,time=samples[index],id=randomUUID(),file=join(temporary,`${index}.png`);
      await exec(executable(ffmpeg!),['-y','-ss',String(Math.max(0,time-.00001)),'-i',this.path(video),'-map','0:v:0','-frames:v','1','-pix_fmt','rgba',file],{timeout:60000,maxBuffer:1024*1024});
      const bytes=readFileSync(file),png=readPNG(bytes);result[index]={id,name:`${video.name.replace(/\.[^.]+$/,'')}-帧${String(index+1).padStart(3,'0')}.png`,type:'image',mime:'image/png',size:bytes.length,url:`asset://local/${id}`,createdAt:Date.now(),sourceTaskId:video.sourceTaskId,sourceAssetId:video.id,width:png.width,height:png.height,frame:{videoId:video.id,sequenceId,index,time}};
    }};
    try{const settled=await Promise.allSettled(Array.from({length:Math.min(3,count)},()=>worker()));const failure=settled.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
      for(let i=0;i<count;i++){const destination=this.path(result[i]);renameSync(join(temporary,`${i}.png`),destination);installed.push(destination);}return result;
    }catch(e){for(const file of installed)rmSync(file,{force:true});throw e;}finally{rmSync(temporary,{recursive:true,force:true});}
  }

  async import(name:string,bytes:Buffer,sourceTaskId?:string,maxMB=sourceTaskId?200:50):Promise<Asset>{
    const {mime,type}=inspectFile(name,bytes,maxMB);const id=randomUUID();
    const a:Asset={id,name:basename(name).slice(0,180),mime,type,size:bytes.length,url:`asset://local/${id}`,createdAt:Date.now(),sourceTaskId};
    const path=this.path(a);writeFileSync(path+'.tmp',bytes);renameSync(path+'.tmp',path);
    if(type==='model')return a;
    if(type==='document'){
      if(mime==='application/pdf'){
        try{const parsed=await pdf(bytes);a.text=parsed.text.trim();if(!a.text)a.warning='此 PDF 无可提取文字，首版不包含 OCR。';}catch{a.warning='PDF 加密或损坏，无法提取文字。';}
      }else a.text=bytes.toString('utf8');
      if((a.text?.length||0)>30000)a.warning='文档超过 30000 字符，请缩短后发送，避免静默截断。';
      return a;
    }
    try{
      const {stdout}=await exec(executable(ffprobe.path),['-v','quiet','-print_format','json','-show_streams','-show_format',path],{timeout:20000,maxBuffer:1024*1024});
      const meta=JSON.parse(stdout);const v=meta.streams.find((s:any)=>s.codec_type==='video');
      if(!v)throw new Error('没有可解码的视频或图片');a.width=v.width;a.height=v.height;
      if(type==='video'){
        a.duration=Number(meta.format.duration);a.videoCodec=v.codec_name;a.audioCodec=meta.streams.find((s:any)=>s.codec_type==='audio')?.codec_name;
        const [n,d]=String(v.avg_frame_rate||'0/1').split('/').map(Number);a.fps=n/d;
        a.frameUrls=[];
        for(let i=0;i<3;i++){
          await exec(executable(ffmpeg!),['-y','-ss',String((a.duration||1)*(i+0.5)/3),'-i',path,'-frames:v','1','-vf','scale=768:-2',this.framePath(id,i)],{timeout:30000,maxBuffer:1024*1024});
          a.frameUrls.push(`asset://local/${id}/frame/${i}`);
        }
      }
    }catch{a.warning='媒体元数据或关键帧解析失败，请检查文件编码。';}
    return a;
  }

}
export const extension=(mime:string)=>({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','video/mp4':'.mp4','video/quicktime':'.mov','application/pdf':'.pdf','text/plain':'.txt','application/vnd.autodesk.fbx':'.fbx'}[mime]||'.bin');
