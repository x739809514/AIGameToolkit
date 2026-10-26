import {useEffect,useRef,useState} from 'react';
import type {CutoutDocument} from '../shared/cutout-studio';
import {cutoutRepairDocumentSource} from '../shared/cutout-repair';
import type {Task} from '../shared/types';
import {prepareCutout} from './cutout-render';
import {repairComparison,repairRender} from './cutout-repair-context';
import {useWorkbenchAPI} from './workbench-api';
export function CutoutRepairComparison({doc,task,bitmap}:{doc:CutoutDocument;task:Task;bitmap?:string}){
 const source=cutoutRepairDocumentSource(doc);
 const api=useWorkbenchAPI(),canvas=useRef<HTMLCanvasElement>(null),[data,setData]=useState<Awaited<ReturnType<typeof repairComparison>>>(),[pose,setPose]=useState(0),[compare,setCompare]=useState(false),[error,setError]=useState(''),original=useRef(new Map<string,HTMLImageElement>());
 useEffect(()=>{let live=true;setData(undefined);setError('');void (async()=>{const images=await prepareCutout(doc),url=bitmap??await api.imageData(task.outputAssetIds[0]),result=await repairComparison(doc,task.id,task.cutoutRepair!,url,images);if(live){original.current=images;setData(result);setPose(0);}})().catch(e=>live&&setError(e.message));return()=>{live=false;};},[source,task.id,task.outputAssetIds[0],bitmap]);
 useEffect(()=>{if(!data||!canvas.current)return;const cv=repairRender(compare?doc:data.after,compare?original.current:data.images,data.view,data.poses[pose]?.pose,640);canvas.current.width=cv.width;canvas.current.height=cv.height;canvas.current.getContext('2d')!.drawImage(cv,0,0);},[data,pose,compare,doc]);
 return <section className="cutout-repair-assembly" aria-label="补画装配回看"><header><strong>装回角色检查</strong><button aria-label="对照补画前角色" aria-pressed={compare} onClick={()=>setCompare(v=>!v)}>{compare?'查看补画后':'对照补画前'}</button></header><canvas ref={canvas} aria-label="补画整体预览"/><div>{data?.poses.map((p,i)=><button key={i} aria-label={'补画姿势 '+i} aria-pressed={pose===i} onClick={()=>setPose(i)}>{p.name}</button>)}</div>{task.cutoutRepair?.plan&&<p>{task.cutoutRepair.plan.summary}</p>}{task.cutoutRepair?.review&&<p role="status">{task.cutoutRepair.review.summary}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
