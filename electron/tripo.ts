import {randomUUID} from 'node:crypto';
import {defaultTripoWorkspace,tripoModel,tripoBusy,validateTripoDraft,type TripoDraft,type TripoInput,type TripoTask} from '../src/shared/tripo';
import type {Service} from './service';
import {fetchHTTP} from './network';
export const tripoBaseURL='https://openapi.tripo3d.ai/v3';
export class TripoError extends Error {constructor(message:string,public uncertain=false){super(message);}}
export async function tripoRequest(path:string,key:string,signal:AbortSignal,body?:object|FormData){
 const post=body!==undefined;
 try{
  const response=await fetchHTTP(tripoBaseURL+path,{method:post?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(post?180000:30000)]),redirect:'error'});
  let data:any;try{data=await response.json();}catch{throw new TripoError('Tripo 返回无法解析的响应。',post&&response.ok||post&&response.status>=500);}
  if(!response.ok||data?.code!==0){const labels:Record<number,string>={401:'Tripo API Key 无效',403:'Tripo 账号没有权限',402:'Tripo 积分不足',429:'Tripo 请求频繁，请稍后重试'};throw new TripoError(labels[response.status]||`Tripo 请求失败（HTTP ${response.status}，错误码 ${typeof data?.code==='number'?data.code:'未知'}）。请在控制台核对。`,post&&response.status>=500);}
  if(!data.data||typeof data.data!=='object')throw new TripoError('Tripo 未返回有效任务数据。',post);
  return data.data;
 }catch(error){if(error instanceof TripoError)throw error;throw new TripoError('无法连接 Tripo，请检查网络与代理。',post);}
}
export class Tripo {
 private timers=new Map<string,ReturnType<typeof setTimeout>>();private active=new Set<string>();
 constructor(private service:Service){}
 private get state(){return this.service.workspace.tripoWorkspace??=defaultTripoWorkspace();}
 private assert(){if(this.service.closed)throw new Error('工作台已关闭。');if(this.service.workspace.workbenchType!=='tripo')throw new Error('请在 3D 模型生成工作台使用 Tripo。');}
 private key(){const key=this.service.vault.get('tripo');if(!key)throw new Error('请先在设置中配置 Tripo API Key。');return key;}
 private update(task:TripoTask,patch:Partial<TripoTask>){if(this.service.closed)return;Object.assign(task,patch,{updatedAt:Date.now()});this.service.changed();}
 saveDraft(draft:TripoDraft){this.assert();validateTripoDraft(draft);this.state.draft={mode:draft.mode,prompt:draft.prompt,imageId:draft.imageId,texture:draft.texture,pbr:draft.pbr};this.service.changed();}
 generate(input:TripoInput){
  this.assert();validateTripoDraft(input);if(typeof input.requestId!=='string'||!input.requestId||input.requestId.length>100)throw new Error('生成请求标识无效。');
  const duplicate=this.state.tasks.find(t=>t.requestId===input.requestId);if(duplicate)return structuredClone(duplicate);
  if(this.state.tasks.some(tripoBusy))throw new Error('已有 3D 模型任务正在处理，请等待完成。');
  if(input.mode==='text'&&!input.prompt.trim())throw new Error('请描述要生成的 3D 模型。');
  if(input.mode==='image'){const image=this.service.imageAsset(input.imageId!);if(!['image/png','image/jpeg','image/webp'].includes(image.mime)||image.size>20*1024*1024)throw new Error('参考图片须为 PNG、JPEG 或 WebP，且不超过 20 MB。');}
  this.key();this.saveDraft(input);
  const task:TripoTask={...this.state.draft,requestId:input.requestId,id:randomUUID(),model:tripoModel,state:'preparing',createdAt:Date.now(),updatedAt:Date.now(),progress:0};
  this.state.tasks.push(task);this.service.changed();void this.submit(task);return structuredClone(task);
 }
 private async submit(task:TripoTask){
  try{
   const key=this.key(),signal=this.service.lifecycle.signal;let input:string|undefined;
   if(task.mode==='image'){
    const image=this.service.imageAsset(task.imageId!);const bytes=await this.service.assets.normalizedPNG(image);if(bytes.length>20*1024*1024)throw new Error('转换后的参考图片超过 20 MB，请缩小图片。');
    const form=new FormData();form.set('file',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'reference.png');
    const uploaded=await tripoRequest('/files',key,signal,form);if(typeof uploaded.file_token!=='string'||!uploaded.file_token)throw new Error('Tripo 上传未返回文件标识。');input=uploaded.file_token;
   }
   if(this.service.closed)return;
   this.update(task,{state:'submitting'});
   const result=await tripoRequest(`/generation/${task.mode==='text'?'text':'image'}-to-model`,key,signal,{model:task.model,...(task.mode==='text'?{prompt:task.prompt}:{input}),texture:task.texture,pbr:task.texture&&task.pbr});
   if(typeof result.task_id!=='string'||!result.task_id)throw new TripoError('Tripo 未返回任务 ID，请在控制台核实提交结果。',true);
   this.update(task,{remoteTaskId:result.task_id,state:'queued'});this.schedule(task,2000);
  }catch(error){this.update(task,{state:task.state==='submitting'&&error instanceof TripoError&&error.uncertain?'submission_unknown':'failed',error:this.service.error(error)});}
 }
 private schedule(task:TripoTask,delay=2000){if(this.service.closed)return;const old=this.timers.get(task.id);if(old)clearTimeout(old);this.timers.set(task.id,setTimeout(()=>{this.timers.delete(task.id);void this.poll(task);},delay));}
 async poll(task:TripoTask){
  if(this.service.closed||this.active.has(task.id)||!['queued','running','saving','save_failed'].includes(task.state))return;this.active.add(task.id);let saving=false;
  try{
   const data=await tripoRequest('/tasks/'+encodeURIComponent(task.remoteTaskId!),this.key(),this.service.lifecycle.signal);
   if(this.service.closed)return;
   if(['failed','cancelled','banned'].includes(data.status)){this.update(task,{state:data.status==='cancelled'?'cancelled':'failed',error:`Tripo 任务${data.status==='banned'?'被拒绝':'未完成'}（${typeof data.error_code==='number'?data.error_code:data.status}），请在控制台查看。`,pollError:undefined});return;}
   if(data.status==='success'){
    saving=true;this.update(task,{state:'saving',progress:100,pollError:undefined});
    if(typeof data.output?.model_url!=='string')throw new Error('Tripo 未返回模型下载地址。');
    const url=new URL(data.output.model_url);if(url.protocol!=='https:')throw new Error('Tripo 模型下载必须使用 HTTPS。');
    // Signed result URLs expire quickly. Always query for a fresh URL before saving.
    const response=await fetchHTTP(url,{signal:AbortSignal.any([this.service.lifecycle.signal,AbortSignal.timeout(180000)]),credentials:'omit'});
    if(!response.ok)throw new Error(`模型下载失败（HTTP ${response.status}），可以重试保存。`);
    const reader=response.body?.getReader();if(!reader)throw new Error('模型下载没有内容。');let total=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>150*1024*1024){await reader.cancel();throw new Error('模型超过 150 MB。');}chunks.push(value);}
    if(this.service.closed)return;
    const asset=await this.service.assets.import('Tripo-'+task.id.slice(0,8)+'.glb',Buffer.concat(chunks),task.id,150);
    if(asset.mime!=='model/gltf-binary')throw new Error('Tripo 返回的结果不是有效 GLB 模型。');
    if(this.service.closed)return;this.service.workspace.assets.push(asset);this.state.selectedAssetId=asset.id;
    this.update(task,{state:'succeeded',assetId:asset.id,error:undefined,credits:typeof data.credits_consumed==='number'?data.credits_consumed:undefined});
    this.service.completed({id:'tripo:'+task.id,label:'3D 模型生成'});
   }else if(['queued','running'].includes(data.status)){this.update(task,{state:data.status,progress:typeof data.progress==='number'?Math.max(0,Math.min(100,data.progress)):task.progress,pollError:undefined});this.schedule(task);}
   else throw new Error('Tripo 返回未知任务状态。');
  }catch(error){if(saving)this.update(task,{state:'save_failed',error:this.service.error(error)});else{this.update(task,{pollError:this.service.error(error)});if(Date.now()-task.createdAt<24*60*60*1000)this.schedule(task,20000);}}
  finally{this.active.delete(task.id);}
 }
 retry(id:string){this.assert();const task=this.state.tasks.find(t=>t.id===id);if(!task?.remoteTaskId||!['queued','running','saving','save_failed'].includes(task.state))throw new Error('此任务不能自动重试；提交状态不确定时请先在 Tripo 控制台核实。');if(this.active.has(id))return;this.update(task,{state:'queued',error:undefined,pollError:undefined});this.schedule(task,0);}
 select(id:string){this.assert();if(!this.service.workspace.assets.some(a=>a.id===id&&a.mime==='model/gltf-binary'))throw new Error('模型不存在。');this.state.selectedAssetId=id;this.service.changed();}
 resume(){if(this.service.workspace.workbenchType!=='tripo')return;for(const task of this.state.tasks){if(!tripoBusy(task))continue;if(task.remoteTaskId){this.update(task,{state:'queued'});this.schedule(task);}else this.update(task,{state:task.state==='submitting'?'submission_unknown':'failed',error:'应用在处理期间退出。未自动重新提交，请核实 Tripo 任务记录。'});}}
 close(cancel:boolean){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();if(cancel&&!this.service.closed)for(const task of this.service.workspace.tripoWorkspace?.tasks??[])if(tripoBusy(task)||task.state==='submission_unknown'){task.state='cancelled';task.error='本地处理已停止，远程 Tripo 任务可能继续运行或计费。';}}
}
