import {motionHasVisibleChange} from './cutout-motion-geometry';
import {motionTemplates,type MotionTemplate} from './cutout-motion-templates';
import {validateRig2D,type Clip2D,type Rig2D,type MotionKey2D,type BoneTransform2D,type PartState2D,type Curve2D} from './skeletal2d';
import type {CutoutDocument} from './cutout-studio';
import type {CutoutRigInput} from './cutout-rig';
export interface CutoutMotionDraft {template?:MotionTemplate;prompt:string;duration:number;loop:boolean;selectedClipId?:string}
export interface CutoutMotionInput extends CutoutRigInput {bounds?:Record<string,[number,number,number,number]>;template?:MotionTemplate;prompt:string;duration:number;loop:boolean}
export interface CutoutMotionProposal {name:string;notes:string;interpolation?:Curve2D;footLock?:boolean;contacts?:import('./cutout-foot-lock').FootContact2D[];keys:{time:number;rotations:{boneId:string;angle:number}[];bones?:({boneId:string}&BoneTransform2D)[];parts?:({partId:string}&PartState2D)[];curve?:Curve2D}[]}
export interface CutoutMotionResult {clip:Clip2D;notes:string}
export function validateCutoutMotionDraft(d:CutoutMotionDraft){
 if(d?.template!==undefined&&!motionTemplates.includes(d.template))throw Error('动作模板无效。');
 if(!d||typeof d.prompt!=='string'||d.prompt.length>2000||typeof d.duration!=='number'||!Number.isFinite(d.duration)||d.duration<.5||d.duration>15||typeof d.loop!=='boolean'||d.selectedClipId!==undefined&&(typeof d.selectedClipId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(d.selectedClipId)))throw Error('动作描述、时长或循环设置无效。');return d;
}
export const canAnimateCutout=(r:Rig2D)=>r.parts.some(p=>r.bones.some(b=>b.id===p.bone&&!!b.parent));
export const cutoutMotionSource=(d:CutoutDocument)=>JSON.stringify([d.rig.canvas,d.rig.sourceHash,d.rig.bones,d.rig.parts,d.rig.footRig,d.artwork]);
export function proposalMotion(rig:Rig2D,input:unknown,options:CutoutMotionDraft,id:string,deferVisibility=false):CutoutMotionResult {
 validateCutoutMotionDraft(options);const p=input as CutoutMotionProposal;
 if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.notes!=='string'||p.notes.length>2000||!Array.isArray(p.keys)||p.keys.length<2||p.keys.length>120)throw Error('AI 动作格式无效。');
 if(p.footLock!==undefined&&typeof p.footLock!=='boolean')throw Error('AI 返回的脚底锁定开关无效。');
 let previous=-1;const channels=new Set<string>();
 for(const k of p.keys){if(!k||!Number.isFinite(k.time)||k.time<=previous||k.time<0||k.time>options.duration||!Array.isArray(k.rotations)||k.rotations.length>rig.bones.length)throw Error('AI 动作关键帧时间无效。');previous=k.time;const seen=new Set<string>();for(const rotation of k.rotations){if(!rotation||typeof rotation.boneId!=='string'||!rig.bones.some(b=>b.id===rotation.boneId)||seen.has(rotation.boneId)||typeof rotation.angle!=='number'||!Number.isFinite(rotation.angle)||Math.abs(rotation.angle)>180)throw Error('AI 动作包含未知骨骼、重复通道或非法角度。');seen.add(rotation.boneId);channels.add(rotation.boneId);}}
 if(p.keys[0].time!==0||p.keys.at(-1)!.time!==options.duration||!channels.size&&!p.keys.some(k=>k.bones?.length||k.parts?.length))throw Error('AI 动作必须覆盖完整时长且包含骨骼通道。');
 const keys:MotionKey2D[]=p.keys.map(k=>{const converted:MotionKey2D={time:k.time,rotations:Object.fromEntries([...channels].map(bone=>{let angle=k.rotations.find(r=>r.boneId===bone)?.angle??0;const limits=rig.bones.find(b=>b.id===bone)?.limits;if(limits)angle=Math.max(limits.min,Math.min(limits.max,angle));return [bone,angle];})),curve:k.curve};
  for(const kind of ['bones','parts'] as const){const values=k[kind];if(values!==undefined){if(!Array.isArray(values)||values.length>(kind==='bones'?rig.bones.length:rig.parts.length))throw Error('AI 动作轨道无效。');const seen=new Set<string>(),out:Record<string,any>={};for(const value of values){const id=kind==='bones'?(value as {boneId:string}).boneId:(value as {partId:string}).partId;if(typeof id!=='string'||seen.has(id))throw Error('AI 动作轨道重复。');seen.add(id);const {boneId,partId,...state}=value as {boneId?:string;partId?:string}&PartState2D;out[id]=state;}converted[kind]=out;}}
  return converted;});
 if(options.loop)keys[keys.length-1]={...structuredClone(keys[0]),time:options.duration};
 const clip:Clip2D={id,...(p.contacts!==undefined?{contacts:p.contacts}:{}),footLock:p.footLock??!!p.contacts?.length,interpolation:p.interpolation??'smooth',template:options.template??'custom',name:p.name,prompt:options.prompt,notes:p.notes,loop:options.loop,duration:options.duration,keys};
 validateRig2D({...rig,clips:[clip]});if(!deferVisibility&&!motionHasVisibleChange(rig,clip))throw Error('AI 未生成可播放的动作变化，请调整描述后重试。');return {clip,notes:p.notes};
}
export function applyCutoutMotion(doc:CutoutDocument,clip:Clip2D):CutoutDocument {
 if(doc.rig.clips.some(c=>c.id===clip.id))throw Error('动作已存在，请勿重复应用。');
 const rig=validateRig2D({...doc.rig,clips:[...doc.rig.clips,clip]});
 return {...doc,rig,motion:{template:clip.template,prompt:clip.prompt??doc.motion?.prompt??'',duration:clip.duration,loop:clip.loop??true,selectedClipId:clip.id}};
}
