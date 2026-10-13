import type {Workspace} from '../src/shared/types';
export interface TaskCompletion {id:string;label:string}
// Seed from saved state: opening an existing workbench must not replay history.
export class CompletionTracker {
  private states=new Map<string,string>();
  constructor(workspace:Workspace,private complete:(event:TaskCompletion)=>void){this.scan(workspace,false);}
  observe(workspace:Workspace){this.scan(workspace,true);}
  private scan(workspace:Workspace,notify:boolean){
    const entries:{id:string;state:string;label:string}[]=workspace.tasks.map(t=>({id:`task:${t.id}`,state:t.state,label:t.discussion?'AI 回复':t.imageEdit?.operation==='remove_background'?'去除背景':t.imageEdit?'图片修改':t.kind==='image'?'图片生成':'视频生成'}));
    for(const seq of workspace.frameWorkspace?.sequences||[])entries.push({id:`frames:${seq.id}`,state:seq.status,label:'视频拆帧'});
    const pose=workspace.poseWorkspace?.analysis;if(pose)entries.push({id:`pose:${pose.requestId}`,state:pose.status,label:'骨骼解析'});
    const motion=workspace.motionWorkspace?.extraction;if(motion)entries.push({id:`motion:${motion.id}`,state:motion.status,label:'动作提取'});
    for(const entry of entries){const previous=this.states.get(entry.id);this.states.set(entry.id,entry.state);if(notify&&previous!==undefined&&previous!=='succeeded'&&entry.state==='succeeded')this.complete({id:entry.id,label:entry.label});}
  }
}
export interface CompletionNotice {title:string;body:string;click:()=>void}
export class TaskNotifications {
  private sent=new Set<string>();
  constructor(private name:(workbenchId:string)=>string|undefined,private open:(workbenchId:string)=>void,private deliver:(notice:CompletionNotice)=>void){}
  complete(workbenchId:string,event:TaskCompletion){
    const key=JSON.stringify([workbenchId,event.id]);if(this.sent.has(key))return;
    const name=this.name(workbenchId);if(!name)return;this.sent.add(key);
    try{this.deliver({title:'Laputa · 任务完成',body:`${name}：${event.label}已完成`,click:()=>{if(this.name(workbenchId))this.open(workbenchId);}});}catch{/* System notification availability never changes a successful task result. */}
  }
}
