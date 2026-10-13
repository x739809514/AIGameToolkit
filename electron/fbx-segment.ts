import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeMotionTimeline,type MotionTimelineItem} from '../src/shared/motion-timeline';
import type {Service} from './service';
const run=promisify(execFile);
const script=existsSync(join(__dirname,'assets/fbx-segment.py'))?join(__dirname,'assets/fbx-segment.py'):join(__dirname,'fbx-segment.py');
export function motionName(value:string){const name=value.trim().replace(/\.fbx$/i,'');if(!name||name.length>120||/[\x00-\x1f/\\]/.test(name))throw new Error('名称须为 1–120 个字符，不能包含路径符号。');return name;}
export async function saveFBXSegment(service:Service,input:{item:MotionTimelineItem;name:string;clipName:string}){
 if(service.workspace.workbenchType!=='motion-editor')throw new Error('请在动作编辑器中另存动作。');
 const [item]=normalizeMotionTimeline([input.item],id=>service.workspace.assets.some(a=>a.id===id&&a.type==='model')),name=motionName(input.name);
 if(typeof input.clipName!=='string'||!input.clipName||input.clipName.length>500||(item.out-item.in)/item.rate>300)throw new Error('另存片段须在 5 分钟以内，并指定原始动画。');
 if(service.deletingModelIds.has(item.assetId))throw new Error('动作正在删除。');
 const source=service.workspace.assets.find(a=>a.id===item.assetId)!;
 const blender=['/Applications/Blender.app/Contents/MacOS/Blender','/usr/bin/blender','/usr/local/bin/blender'].find(existsSync);
 if(!blender)throw new Error('另存 FBX 需要安装 Blender。请安装后重试，原文件与裁剪不会改变。');
 return service.localOperation(async()=>{const directory=mkdtempSync(join(tmpdir(),'laputa-fbx-')),target=join(directory,'segment.fbx'),controller=new AbortController(),stop=()=>{controller.abort();rmSync(directory,{recursive:true,force:true});};service.modelFileJobs.add(stop);try{
 const localScript=join(directory,'export.py');writeFileSync(localScript,readFileSync(script));
 await run(blender,['--background','--factory-startup','--python-exit-code','1','--python',localScript,'--',JSON.stringify({source:service.assets.path(source),target,clipName:input.clipName,in:item.in,out:item.out,rate:item.rate})],{timeout:180000,maxBuffer:1024*1024,signal:controller.signal,killSignal:'SIGKILL'});
 if(service.closed)throw new Error('工作台已关闭，另存已取消。');if(statSync(target).size>50*1024*1024)throw new Error('另存 FBX 超过 50 MB。');
 const [asset]=await service.importFiles([{name:name+'.fbx',bytes:Uint8Array.from(readFileSync(target)).buffer}]);asset.sourceAssetId=source.id;service.changed();return asset;
 }catch(e){throw new Error('另存 FBX 失败：'+(e instanceof Error?e.message:'无法导出'));}finally{service.modelFileJobs.delete(stop);rmSync(directory,{recursive:true,force:true});}});
}
