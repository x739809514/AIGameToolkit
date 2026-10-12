import type {Api} from '../shared/types';
import type {MotionExtractInput,PoseJoint} from '../shared/pose';
export async function extractMotion(api:Api,input:MotionExtractInput){
 const {job,bytes}=await api.beginMotionExtraction(input);let worker:Worker|undefined;const video=document.createElement('video'),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));video.preload='auto';video.muted=true;video.src=url;let next=0;
 const waitVideo=(event:string,action:()=>void)=>new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(new Error('视频解码超时。')),30000);const good=()=>done(),bad=()=>done(new Error('视频无法解码。'));function done(error?:Error){clearTimeout(timeout);video.removeEventListener(event,good);video.removeEventListener('error',bad);error?reject(error):resolve();}video.addEventListener(event,good,{once:true});video.addEventListener('error',bad,{once:true});action();});
 try{
 await waitVideo('loadeddata',()=>video.load());worker=new Worker(new URL('./pose/worker.js',document.baseURI));
 const request=(message:Record<string,unknown>,transfer:Transferable[]=[])=>new Promise<any>((resolve,reject)=>{const id=++next;const timeout=setTimeout(()=>finish(new Error('本地姿态模型处理超时。')),90000);const listen=(event:MessageEvent)=>{if(event.data.id===id)finish(event.data.error?new Error(event.data.error):undefined,event.data);},fail=(event:ErrorEvent)=>finish(new Error(event.message||'姿态处理线程无法启动。'));function finish(error?:Error,data?:unknown){clearTimeout(timeout);worker!.removeEventListener('message',listen);worker!.removeEventListener('error',fail);error?reject(error):resolve(data);}worker!.addEventListener('message',listen);worker!.addEventListener('error',fail);worker!.postMessage({...message,id},transfer);});
 await request({kind:'init'});let batch:{time:number;joints:PoseJoint[]}[]=[];
 for(let i=0;i<job.total;i++){const time=job.start+i/job.fps;if(Math.abs(video.currentTime-time)>.0001)await waitVideo('seeked',()=>{video.currentTime=time;});const bitmap=await createImageBitmap(video),result=await request({kind:'detect',timestamp:i*1000/job.fps+1,bitmap},[bitmap]);batch.push({time:i/job.fps,joints:result.joints});if(batch.length===8||i===job.total-1){await api.appendMotionFrames(job.id,batch);batch=[];}await new Promise(r=>setTimeout(r,0));}
 return await api.finishMotionExtraction(job.id);
 }catch(e){await api.failMotionExtraction(job.id,e instanceof Error?e.message:'提取失败').catch(()=>{});throw e;}finally{worker?.terminate();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
