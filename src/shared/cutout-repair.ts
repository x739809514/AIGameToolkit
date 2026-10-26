import {validateCutoutDocument,type CutoutDocument} from './cutout-studio';
import {extendRepairMesh} from './cutout-repair-mesh';
export interface RepairRegion {x:number;y:number;width:number;height:number}
export interface CutoutRepairPlan {summary:string;instruction:string;regions:RepairRegion[]}
export interface CutoutRepairContext {assembly:string;marked:string;detail:string}
export interface CutoutRepairReview {status:'reviewing'|'done'|'failed';summary:string;needsCorrection?:boolean;correction?:string}
export interface CutoutRepairEvidence {assetId:string;signature:string;images:string[];poses:string[]}
export interface CutoutRepairInput {partId:string;requestId:string;prompt:string;signature:string;source:ArrayBuffer;frame:[number,number,number,number];context?:CutoutRepairContext;directorRequestId?:string;candidateId?:string;retryOf?:string}
export interface CutoutRepairTask {partId:string;signature:string;frame:[number,number,number,number];instruction:string;contextVersion?:1;documentSignature?:string;candidateId?:string;directorRequestId?:string;attempt?:number;retryOf?:string;plan?:CutoutRepairPlan;review?:CutoutRepairReview;dismissed?:boolean;stopped?:boolean}
export const cutoutRepairDocumentSource=(d:CutoutDocument)=>JSON.stringify([d.rig,d.artwork,d.reference]);
export const cutoutRepairContextSource=(d:CutoutDocument,id:string)=>JSON.stringify([id,cutoutRepairDocumentSource(d)]);
export const repairSourceFor=(d:CutoutDocument,t:CutoutRepairTask)=>t.contextVersion?cutoutRepairContextSource(d,t.partId):cutoutRepairSource(d,t.partId);
export function validateRepairPlan(value:unknown):CutoutRepairPlan {
 const p=value as CutoutRepairPlan;
 if(!p||typeof p.summary!=='string'||p.summary.length>2000||typeof p.instruction!=='string'||!p.instruction.trim()||p.instruction.length>3000||!Array.isArray(p.regions)||!p.regions.length||p.regions.length>4||p.regions.some(r=>!r||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.000001||r.y+r.height>1.000001))throw Error('补画定位区域无效。');
 if(p.regions.reduce((sum,r)=>sum+r.width*r.height,0)>.75)throw Error('补画范围过大，请限定缺口和接缝。');
 return {summary:p.summary,instruction:p.instruction,regions:p.regions.map(({x,y,width,height})=>({x,y,width,height}))};
}
export function cutoutRepairSource(document:CutoutDocument,id:string):string {
 const part=document.rig.parts.find(p=>p.id===id),layer=document.artwork.find(a=>a.partId===id);
 if(!part||!layer)throw Error('部件不存在。');
 return JSON.stringify({partId:part.id,crop:part.crop,bitmap:layer.bitmap,mask:layer.mask,selectionMask:layer.selectionMask,strokes:layer.strokes});
}
export function cutoutRepairProgress(document:CutoutDocument){const reviewed=document.artwork.filter(a=>!!a.repair).length;return {reviewed,total:document.artwork.length,complete:document.artwork.length>0&&reviewed===document.artwork.length};}
export function reviewCutoutOriginal(document:CutoutDocument,id:string):CutoutDocument {
 if(!document.artwork.some(a=>a.partId===id))throw Error('部件不存在。');
 return {...document,artwork:document.artwork.map(a=>a.partId===id?{...a,repair:{status:'original' as const}}:a)};
}
export function applyCutoutRepair(document:CutoutDocument,taskID:string,repair:CutoutRepairTask,bitmap:string):CutoutDocument {
 const a=document.artwork.find(a=>a.partId===repair.partId);if(!a)throw Error('此部件已删除。');if(a.locked)throw Error('请先解锁此部件。');
 return validateCutoutDocument({...document,rig:{...document.rig,parts:document.rig.parts.map(p=>p.id===repair.partId?{...p,crop:[...repair.frame] as [number,number,number,number],...(p.mesh?{mesh:extendRepairMesh(p.mesh,repair.frame)}:{})}:p)},artwork:document.artwork.map(a=>a.partId===repair.partId?{...a,bitmap,mask:undefined,selectionMask:undefined,strokes:[],repair:{status:'accepted',taskId:taskID}}:a)});
}
export function cutoutRepairPrompt(name:string,instruction:string){return `为二维骨骼切片角色补画一个独立部件：「${name}」。第一张是当前部件的透明底图，第二张（若有）仅供参考角色风格与结构。补全该部件被遮挡的连接部位、缺口和隐藏轮廓，使其适合骨骼旋转。保持原有可见像素、位置、大小、配色、线条和材质不变；只在透明区域延伸。不要生成整个人物、其他部件、文字、阴影或背景。保留透明 PNG，四周留透明边距，保持第一张图片尺寸和注册位置。${instruction.trim()?'用户对该部件的要求：'+instruction.trim():''}`;}

/** Hand edits use the same registration as the displayed repair input/candidate. */
export function applyCutoutManualRepair(document:CutoutDocument,id:string,frame:CutoutRepairTask['frame'],bitmap:string,taskId?:string):CutoutDocument {
 const next=applyCutoutRepair(document,taskId??'',{partId:id,frame,signature:'',instruction:''},bitmap);
 return validateCutoutDocument({...next,artwork:next.artwork.map(a=>a.partId===id?{...a,repair:{status:'manual',...(taskId?{taskId}:{})}}:a)});
}
