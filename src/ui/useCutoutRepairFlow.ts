import {useEffect,useMemo,useRef,useState} from 'react';
import type {CutoutDocument} from '../shared/cutout-studio';
import {applyCutoutRepair,applyCutoutManualRepair,cutoutRepairDocumentSource,type CutoutRepairInput} from '../shared/cutout-repair';
import {directorDocument} from '../shared/cutout-director';
import {isBusy,type Task,type Workspace} from '../shared/types';
import {cutoutDigest,prepareCutout} from './cutout-render';
import {prepareContextRepairInput,repairComparison} from './cutout-repair-context';
import {useWorkbenchAPI} from './workbench-api';
type Options={doc?:CutoutDocument;workspace:Workspace;ready:boolean;persist:(d:CutoutDocument)=>Promise<unknown>;change:(d:CutoutDocument)=>void};
export type CutoutRepairFlow=ReturnType<typeof useCutoutRepairFlow>;
/** One controller for both modes. Persistent task IDs prevent remounts from resubmitting images. */
export function useCutoutRepairFlow(options:Options){
 const api=useWorkbenchAPI(),latest=useRef(options);latest.current=options;
 const active=useRef(true),running=useRef(false),started=useRef(new Set<string>()),reviewed=useRef(new Set<string>()),pool=useRef(new Map<string,Promise<HTMLImageElement>>());
 const [localBusy,setLocalBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[documentHash,setDocumentHash]=useState('');
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const source=useMemo(()=>options.doc?cutoutRepairDocumentSource(options.doc):'',[options.doc?.rig,options.doc?.artwork,options.doc?.reference]);
 useEffect(()=>{let live=true;setDocumentHash('');if(source)void cutoutDigest(new TextEncoder().encode(source)).then(h=>live&&setDocumentHash(h));return()=>{live=false;};},[source]);
 const tasks=options.workspace.tasks;
 function base(t?:Task,candidateId=t?.cutoutRepair?.candidateId){const {doc,workspace}=latest.current;if(!doc)throw Error('角色尚未载入。');if(!candidateId)return doc;const c=workspace.cutoutDirector?.candidate;if(c?.id!==candidateId)throw Error('原角色候选已变化，请重新补画。');return directorDocument(doc,c);}
 function stale(t:Task){const r=t.cutoutRepair;return !!r?.contextVersion&&(!documentHash||r.documentSignature!==documentHash||!!r.candidateId&&options.workspace.cutoutDirector?.candidate?.id!==r.candidateId);}
 async function ensureCurrent(t:Task){const d=latest.current.doc,r=t.cutoutRepair!;if(!d)throw Error('角色尚未载入。');const snapshot=cutoutRepairDocumentSource(d),hash=await cutoutDigest(new TextEncoder().encode(snapshot));if(r.documentSignature!==hash||!latest.current.doc||snapshot!==cutoutRepairDocumentSource(latest.current.doc))throw Error('角色已修改，请重新补画；旧候选不能覆盖新设置。');return base(t);}
 function latestTask(id:string){return latest.current.workspace.tasks.slice().reverse().find(t=>t.cutoutRepair?.partId===id&&!t.cutoutRepair.dismissed);}
 function candidateTask(id:string){const t=latestTask(id);return t?.state==='succeeded'?t:t?.cutoutRepair?.retryOf?latest.current.workspace.tasks.find(v=>v.id===t.cutoutRepair!.retryOf&&v.state==='succeeded'):undefined;}
 async function start(id:string,prompt:string,extra:Partial<CutoutRepairInput>={}){
  if(running.current)return;const request=latest.current.workspace.cutoutDirector?.repairRequest;if(!extra.directorRequestId&&request?.partId===id){extra={...extra,directorRequestId:request.id,candidateId:request.candidateId};if(!prompt.trim())prompt=request.prompt;}running.current=true;setLocalBusy(true);setError('');setProgress('准备完整角色、部件定位和接缝参考…');
  try{const saved=latest.current.doc!;await latest.current.persist(saved);const d=base(undefined,extra.candidateId),images=await prepareCutout(d,pool.current),input=await prepareContextRepairInput(d,id,images,prompt);if(!active.current)return;await api.repairCutoutPart({...input,...extra});}
  catch(e){if(active.current)setError((e as Error).message);}finally{running.current=false;if(active.current){setLocalBusy(false);setProgress('');}}
 }
 async function review(t:Task){
  if(running.current)return;running.current=true;setLocalBusy(true);setError('');setProgress('装回角色，渲染关节转动并回看…');reviewed.current.add(t.id);
  try{const d=await ensureCurrent(t),images=await prepareCutout(d,pool.current),bitmap=await api.imageData(t.outputAssetIds[0]),comparison=await repairComparison(d,t.id,t.cutoutRepair!,bitmap,images);if(!active.current)return;
   const result=await api.reviewCutoutRepair(t.id,{...comparison.evidence,assetId:t.outputAssetIds[0]});
   if(result.needsCorrection&&t.cutoutRepair!.attempt===1&&active.current){await ensureCurrent(t);const current=latest.current.workspace.tasks.find(v=>v.id===t.id);if(current?.cutoutRepair?.stopped||current?.cutoutRepair?.dismissed)return;setProgress('根据装配回看结果局部修正一次…');const input=await prepareContextRepairInput(d,t.cutoutRepair!.partId,images,t.cutoutRepair!.instruction);if(!active.current)return;await api.repairCutoutPart({...input,requestId:t.requestId+'-fix',retryOf:t.id,candidateId:t.cutoutRepair!.candidateId,directorRequestId:t.cutoutRepair!.directorRequestId});}
  }catch(e){if(active.current)setError((e as Error).message);}finally{running.current=false;if(active.current){setLocalBusy(false);setProgress('');}}
 }
 async function adopt(t:Task,manualBitmap?:string){
  if(running.current)throw Error('补画尚在处理。');running.current=true;setLocalBusy(true);setError('');
  try{const bitmap=manualBitmap??await api.imageData(t.outputAssetIds[0]),d=t.cutoutRepair?.contextVersion?await ensureCurrent(t):base(t);
   const next=manualBitmap?applyCutoutManualRepair(d,t.cutoutRepair!.partId,t.cutoutRepair!.frame,bitmap,t.id):applyCutoutRepair(d,t.id,t.cutoutRepair!,bitmap);
   latest.current.change(next);await latest.current.persist(next);if(t.cutoutRepair?.candidateId)await api.dismissCutoutDirector(t.cutoutRepair.candidateId);await api.finishCutoutRepair(t.id);
  }catch(e){if(active.current)setError((e as Error).message);throw e;}finally{running.current=false;if(active.current)setLocalBusy(false);}
 }
 useEffect(()=>{
  if(!options.ready||!options.doc||running.current||localBusy)return;
  const request=options.workspace.cutoutDirector?.repairRequest;
  if(request&&!request.taskId&&!started.current.has(request.id)&&documentHash===request.source){started.current.add(request.id);void start(request.partId,request.prompt,{requestId:'director-'+request.id,directorRequestId:request.id,candidateId:request.candidateId});return;}
  const latestByPart=new Map<string,Task>();for(const t of tasks)if(t.cutoutRepair?.contextVersion&&!t.cutoutRepair.dismissed)latestByPart.set(t.cutoutRepair.partId,t);
  for(const t of latestByPart.values()){const r=t.cutoutRepair!;if(t.state==='succeeded'&&!r.stopped&&!stale(t)&&!reviewed.current.has(t.id)&&(!r.review||r.review.status==='done'&&r.review.needsCorrection&&r.attempt===1)){void review(t);break;}}
 },[tasks,options.workspace.cutoutDirector,options.ready,options.doc,documentHash,localBusy]);
 const busy=localBusy||tasks.some(t=>t.cutoutRepair&&!t.cutoutRepair.dismissed&&(isBusy(t)||t.cutoutRepair.review?.status==='reviewing'));
 const directorRequest=options.workspace.cutoutDirector?.repairRequest,directorTask=directorRequest?.taskId?tasks.find(t=>t.id===directorRequest.taskId):undefined;
 return {busy,error,progress,base,stale,latestTask,candidateTask,start,review,adopt,directorTask,directorRequest,
  finish:(t:Task,stop=false)=>api.finishCutoutRepair(t.id,stop).catch(e=>setError(e.message)),
  dismissRequest:()=>{const r=latest.current.workspace.cutoutDirector?.repairRequest;if(r)void api.finishCutoutRepair(r.taskId??r.id).catch(e=>setError(e.message));},
  retryRequest:()=>{const r=latest.current.workspace.cutoutDirector?.repairRequest;if(r)void start(r.partId,r.prompt,{requestId:'director-'+r.id,directorRequestId:r.id,candidateId:r.candidateId});}};
}
