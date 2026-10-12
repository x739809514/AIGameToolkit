import {mkdtempSync,openSync,writeSync,closeSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Zip,ZipPassThrough} from 'fflate';
import type {Service} from './service';
export async function createFrameArchive(service:Service,sequenceId:string){
 if(service.workspace.workbenchType!=='video-frames')throw new Error('动画帧包仅用于视频与动画帧工作台。');
 const sequence=service.workspace.frameWorkspace?.sequences.find(s=>s.id===sequenceId);
 if(!sequence||sequence.status!=='succeeded'||!sequence.frames.length)throw new Error('请先完成视频拆帧，当前没有可下载的动画帧。');
 const snapshot=structuredClone(sequence),video=service.workspace.assets.find(a=>a.id===snapshot.videoId&&a.type==='video');
 if(!video)throw new Error('原视频素材不存在。');
 const sources=snapshot.frames.map(f=>({frame:f,asset:structuredClone(service.imageAsset(f.assetId))}));
 const directory=mkdtempSync(join(service.store.directory,'frame-export-')),path=join(directory,'frames.zip');let fd:number|undefined;let total=0,finished=false;
 try{
 fd=openSync(path,'wx',0o600);const zip=new Zip((error,bytes,final)=>{if(error)throw error;total+=bytes.byteLength;if(total>0xffffffff)throw new Error('帧包超过 4 GB，请减少帧数后下载。');let offset=0;while(offset<bytes.length)offset+=writeSync(fd!,bytes,offset,bytes.length-offset);if(final)finished=true;});
 const add=(name:string,bytes:Uint8Array)=>{const file=new ZipPassThrough(name);zip.add(file);file.push(bytes,true);};
 const manifest:{file:string;order:number;originalIndex:number;time:number;assetId:string;originalAssetId:string;modified:boolean}[]=[];
 for(let i=0;i<sources.length;i++){const {frame,asset}=sources[i],file=`frames/frame_${String(i+1).padStart(4,'0')}.png`;add(file,await service.assets.normalizedPNG(asset));manifest.push({file,order:i+1,originalIndex:frame.index,time:frame.time,assetId:frame.assetId,originalAssetId:frame.originalAssetId,modified:frame.assetId!==frame.originalAssetId});if(i%8===0)await new Promise(r=>setTimeout(r,0));}
 add('manifest.json',Buffer.from(JSON.stringify({format:'ai-assets-animation-frames',version:1,sourceVideo:video.name,videoId:video.id,sequenceId:snapshot.id,frameCount:manifest.length,frames:manifest},null,2),'utf8'));zip.end();if(!finished)throw new Error('动画帧包未完整写入。');closeSync(fd);fd=undefined;
 return {path,directory,name:video.name.replace(/\.[^.]+$/,'')+'-动画帧.zip',frameCount:sources.length};
 }catch(e){if(fd!==undefined)closeSync(fd);rmSync(directory,{recursive:true,force:true});throw e;}
}
