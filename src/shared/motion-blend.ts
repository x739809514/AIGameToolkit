import {humanoidNames,type HumanoidName} from './humanoid';
export interface MotionBlendNode {id:string;assetId:string;clipIndex:number;label:string;sourceDuration:number;x:number;y:number;weight:number;enabled:boolean;mask:HumanoidName[]}
export interface MotionBlendTree {enabled:boolean;syncPhases?:boolean;mode:'xy'|'layers';x:number;y:number;cycle:number;nodes:MotionBlendNode[]}
export const defaultMotionBlend=():MotionBlendTree=>({enabled:false,syncPhases:false,mode:'layers',x:0,y:0,cycle:2,nodes:[]});
export const boneGroups:{id:string;name:string;bones:HumanoidName[]}[]=[{id:'hips',name:'髋部／根位移',bones:['Hips']},{id:'spine',name:'躯干',bones:['Spine','Spine1','Spine2']},{id:'head',name:'头颈',bones:['Neck','Head']},{id:'left-arm',name:'左臂与手',bones:['LeftShoulder','LeftArm','LeftForeArm','LeftHand']},{id:'right-arm',name:'右臂与手',bones:['RightShoulder','RightArm','RightForeArm','RightHand']},{id:'left-leg',name:'左腿与脚',bones:['LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase']},{id:'right-leg',name:'右腿与脚',bones:['RightUpLeg','RightLeg','RightFoot','RightToeBase']}];
export const upperBody=boneGroups.filter(g=>['spine','head','left-arm','right-arm'].includes(g.id)).flatMap(g=>g.bones);
export const lowerBody=boneGroups.filter(g=>['hips','left-leg','right-leg'].includes(g.id)).flatMap(g=>g.bones);
export function normalizeMotionBlend(input:MotionBlendTree,owns?:(id:string)=>boolean):MotionBlendTree{
 if(!input||input.syncPhases!==undefined&&typeof input.syncPhases!=='boolean'||typeof input.enabled!=='boolean'||!['xy','layers'].includes(input.mode)||![input.x,input.y,input.cycle].every(Number.isFinite)||Math.abs(input.x)>1||Math.abs(input.y)>1||input.cycle<.1||input.cycle>300||!Array.isArray(input.nodes)||input.nodes.length>16)throw new Error('混合树参数不合法，最多 16 个动作，循环时长为 0.1–300 秒。');
 const ids=new Set<string>();const nodes=input.nodes.map(n=>{
  if(!n||typeof n.id!=='string'||!n.id||n.id.length>80||ids.has(n.id)||typeof n.assetId!=='string'||!n.assetId||owns&&!owns(n.assetId)||!Number.isInteger(n.clipIndex)||n.clipIndex<0||n.clipIndex>10000||typeof n.label!=='string'||n.label.length>180||![n.x,n.y,n.weight,n.sourceDuration].every(Number.isFinite)||Math.abs(n.x)>1||Math.abs(n.y)>1||n.weight<0||n.weight>1||n.sourceDuration<=0||n.sourceDuration>36000||typeof n.enabled!=='boolean'||!Array.isArray(n.mask)||n.mask.some(b=>!humanoidNames.includes(b)))throw new Error('混合动作、权重或骨骼遮罩不合法。');ids.add(n.id);
  return {id:n.id,assetId:n.assetId,clipIndex:n.clipIndex,label:n.label,sourceDuration:n.sourceDuration,x:n.x,y:n.y,weight:n.weight,enabled:n.enabled,mask:humanoidNames.filter(b=>n.mask.includes(b))};
 });return {enabled:input.enabled&&nodes.length>0,syncPhases:input.syncPhases??false,mode:input.mode,x:input.x,y:input.y,cycle:input.cycle,nodes};
}
// Smooth inverse-distance XY interpolation, with exact motion samples at nodes.
// This is a distance blend, rather than Unity's directional/cartesian solver.
export function motionBlendWeights(tree:MotionBlendTree){
 const active=tree.nodes.filter(n=>n.enabled&&n.weight>0&&n.mask.length);if(tree.mode==='layers')return active.map(node=>({node,weight:node.weight}));
 const exact=active.filter(n=>Math.hypot(tree.x-n.x,tree.y-n.y)<1e-6),chosen=exact.length?exact:active;
 const values=chosen.map(node=>({node,weight:exact.length?node.weight:node.weight/Math.max(1e-12,(tree.x-node.x)**2+(tree.y-node.y)**2)})),sum=values.reduce((s,n)=>s+n.weight,0);return values.map(n=>({...n,weight:n.weight/sum}));
}

// Cycle controls the output range. Preserve the authored motion speed unless
// phase synchronization is explicitly requested for locomotion blend spaces.
export function motionBlendSampleTime(tree:MotionBlendTree,node:MotionBlendNode,time:number){const t=Math.max(0,Math.min(tree.cycle,time));return tree.syncPhases?t/tree.cycle*node.sourceDuration:t%node.sourceDuration;}
export function motionBlendOverrides(tree:MotionBlendTree,id:string){if(tree.mode!=='layers')return [];const index=tree.nodes.findIndex(node=>node.id===id),current=tree.nodes[index];if(!current?.enabled)return [];return tree.nodes.slice(index+1).filter(node=>node.enabled&&node.weight>0).map(node=>({node,bones:current.mask.filter(b=>node.mask.includes(b))})).filter(entry=>entry.bones.length>0);}
