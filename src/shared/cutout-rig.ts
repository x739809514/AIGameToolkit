import {normalizeSkinWeights} from './cutout-skinning';
import {inverse2D,transform2D,worldBones2D,validateRig2D,type Rig2D,type Point2D} from './skeletal2d';
import type {CutoutDocument} from './cutout-studio';
export interface CutoutRigProposal {notes:string;bones:{id:string;name:string;parent:string|null;x:number;y:number}[];bindings:{partId:string;boneId:string}[]}
export interface CutoutRigInput {image:string;atlas?:string;revision:number}
export const cutoutRigSource=(d:CutoutDocument)=>JSON.stringify([d.rig,d.artwork]);
export function proposalRig(rig:Rig2D,input:unknown):Rig2D {
 const p=input as CutoutRigProposal;
 if(!p||typeof p.notes!=='string'||p.notes.length>2000||!Array.isArray(p.bones)||!p.bones.length||p.bones.length>128||!Array.isArray(p.bindings)||p.bindings.length!==rig.parts.length)throw Error('AI 骨架格式无效。');
 const ids=new Set(p.bones.map(b=>b.id));
 if(ids.size!==p.bones.length||p.bones.filter(b=>b.parent===null).length!==1)throw Error('AI 骨架必须有一个根节点且不能重复。');
 for(const b of p.bones)if(!/^[a-zA-Z0-9_-]{1,80}$/.test(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||b.parent!==null&&!ids.has(b.parent)||![b.x,b.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))throw Error('AI 骨骼坐标或父节点无效。');
 const seen=new Set<string>();for(const b of p.bindings){if(!b||seen.has(b.partId)||!rig.parts.some(v=>v.id===b.partId)||!ids.has(b.boneId))throw Error('AI 部件绑定无效。');seen.add(b.partId);}
 const next:Rig2D={...rig,footRig:undefined,bones:p.bones.map(b=>{const parent=p.bones.find(v=>v.id===b.parent);return {id:b.id,name:b.name,parent:b.parent??undefined,origin:[(b.x-(parent?.x??0))*rig.canvas[0],(b.y-(parent?.y??0))*rig.canvas[1]],rotation:0};}),parts:rig.parts.map(v=>({...v,bone:p.bindings.find(b=>b.partId===v.id)!.boneId,...(v.mesh?{mesh:{...v.mesh,weights:v.mesh.weights.map(()=>[{bone:p.bindings.find(b=>b.partId===v.id)!.boneId,weight:1}])}}:{})})),clips:[{id:'rest',duration:2,keys:[{time:0,rotations:{}},{time:2,rotations:{}}]}]};
 return validateRig2D(next);
}
/** Edit setup joints, optionally translating descendants. Artwork stays registered in setup space. */
export function editRigJoint(rig:Rig2D,id:string,point:Point2D,parent?:string,moveChildren=false):Rig2D {
 const bone=rig.bones.find(b=>b.id===id);if(!bone)throw Error('骨骼不存在。');
 if(!point.every(v=>Number.isFinite(v)&&Math.abs(v)<=16384))throw Error('关节坐标无效。');
 const world=worldBones2D(rig),nextParent=bone.parent===undefined?undefined:parent??bone.parent;
 const setupWorld=new Map(world);
 const candidate={...rig,bones:rig.bones.map(b=>b.id===id?{...b,parent:nextParent}:b)};validateRig2D(candidate);
 const original=world.get(id)!,target=[...original] as typeof original;target[4]=point[0];target[5]=point[1];world.set(id,target);
 if(moveChildren){
  const descendants=new Set([id]);let size=0;
  while(size!==descendants.size){size=descendants.size;for(const b of rig.bones)if(b.parent&&descendants.has(b.parent))descendants.add(b.id);}
  for(const child of descendants){if(child===id)continue;const m=[...world.get(child)!] as typeof original;m[4]+=point[0]-original[4];m[5]+=point[1]-original[5];world.set(child,m);}
 }
 // Sole contacts are registered to the artwork, so compensate their local coordinates too.
 const footRig=rig.footRig?{...rig.footRig,chains:rig.footRig.chains.map(c=>world.get(c.foot)===setupWorld.get(c.foot)?c:{...c,sole:transform2D(inverse2D(world.get(c.foot)!),transform2D(setupWorld.get(c.foot)!,c.sole))})}:undefined;
 return validateRig2D({...candidate,...(footRig?{footRig}:{}),bones:candidate.bones.map(b=>{const m=world.get(b.id)!,pm=b.parent?world.get(b.parent)!:undefined,origin=pm?transform2D(inverse2D(pm),[m[4],m[5]]):[m[4],m[5]] as Point2D,rotation=Math.atan2(m[1],m[0])*180/Math.PI-(pm?Math.atan2(pm[1],pm[0])*180/Math.PI:0);return {...b,origin,rotation};})});
}
export function deleteRigJoint(rig:Rig2D,id:string):Rig2D {
 const bone=rig.bones.find(b=>b.id===id);if(!bone?.parent)throw Error('根骨骼不能删除。');
 const removedChains=new Set(rig.footRig?.chains.filter(c=>[c.hip,c.knee,c.foot].includes(id)).map(c=>c.id)??[]);
 let next:Rig2D={...rig,footRig:rig.footRig?{...rig.footRig,chains:rig.footRig.chains.filter(c=>!removedChains.has(c.id))}:undefined,clips:rig.clips.map(c=>({...c,contacts:c.contacts?.filter(v=>!removedChains.has(v.chainId))}))};for(const child of rig.bones.filter(b=>b.parent===id)){const m=worldBones2D(next).get(child.id)!;next=editRigJoint(next,child.id,[m[4],m[5]],bone.parent);}
 return validateRig2D({...next,footRig:next.footRig?{...next.footRig,chains:next.footRig.chains.filter(c=>!removedChains.has(c.id))}:undefined,bones:next.bones.filter(b=>b.id!==id),parts:next.parts.map(p=>({...p,bone:p.bone===id?bone.parent!:p.bone,...(p.mesh?{mesh:{...p.mesh,weights:p.mesh.weights.map(weights=>normalizeSkinWeights(weights.map(w=>({...w,bone:w.bone===id?bone.parent!:w.bone})),bone.parent!))}}:{})})),clips:next.clips.map(c=>({...c,contacts:c.contacts?.filter(v=>!removedChains.has(v.chainId)),keys:c.keys.map(k=>({...k,rotations:Object.fromEntries(Object.entries(k.rotations).filter(([key])=>key!==id)),...(k.bones?{bones:Object.fromEntries(Object.entries(k.bones).filter(([key])=>key!==id))}:{})}))}))});
}

export interface CutoutLayerProposal {notes:string;backToFront:string[]}
/** AI draw order changes only z; registration, binding and motion remain intact. */
export function proposalLayers(rig:Rig2D,input:unknown):Rig2D {
 const p=input as CutoutLayerProposal;
 if(!p||typeof p.notes!=='string'||p.notes.length>2000||!Array.isArray(p.backToFront)||p.backToFront.length!==rig.parts.length||new Set(p.backToFront).size!==rig.parts.length||p.backToFront.some(id=>typeof id!=='string'||!rig.parts.some(part=>part.id===id)))throw Error('AI 图层顺序必须包含每个部件且不能重复。');
 return validateRig2D({...rig,parts:rig.parts.map(part=>({...part,z:p.backToFront.indexOf(part.id)}))});
}
export interface CutoutRigTreeNode {id:string;partIds:string[];children:CutoutRigTreeNode[]}
export function cutoutRigTree(rig:Rig2D):CutoutRigTreeNode {
 validateRig2D(rig);
 const visit=(id:string):CutoutRigTreeNode=>({id,partIds:rig.parts.filter(p=>p.bone===id).sort((a,b)=>b.z-a.z).map(p=>p.id),children:rig.bones.filter(b=>b.parent===id).map(b=>visit(b.id))});
 return visit(rig.bones.find(b=>!b.parent)!.id);
}
