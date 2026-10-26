import {motionHasVisibleChange,motionGeometry,partMotionAdjustment} from './cutout-motion-geometry';
import {detailMotionClip,type MotionDetailAction} from './cutout-motion-detail';
import {validateCutoutDocument,type CutoutDocument} from './cutout-studio';
import {validateRig2D,worldBones2D,sampleMotion2D,transform2D,inverse2D,type Rig2D,type Clip2D,type BoneRole2D,type Point2D} from './skeletal2d';
import {autoSkinWeights,gridSkinMesh,paintSkinWeights,skinMatrices,skinVertices} from './cutout-skinning';
import {inferBoneRole} from './cutout-motion-templates';
import {editRigJoint} from './cutout-rig';
import {evaluateMotion2D,footLockState,type FootContact2D} from './cutout-foot-lock';
import type {MotionTemplate} from './cutout-motion-templates';
export type DirectorAction=
 |MotionDetailAction
 |{tool:'repair_part';partId:string;prompt:string}
 |{tool:'prepare_character'}
 |{tool:'create_motion';prompt:string;template:MotionTemplate;duration:number;loop:boolean}
 |{tool:'adjust_motion';boneIds:string[];amplitude:number;duration:number;name:string}
 |{tool:'set_foot_lock';enabled:boolean;contacts:FootContact2D[]|null}
 |{tool:'mesh_part';partId:string;boneIds:string[];density:number}
 |{tool:'paint_weight';partId:string;boneId:string;x:number;y:number;radius:number;strength:number}
 |{tool:'move_joint';boneId:string;x:number;y:number}
 |{tool:'bind_part';partId:string;boneId:string}
 |{tool:'place_part';partId:string;x:number;y:number;z:number}
 |{tool:'set_role';boneId:string;role:BoneRole2D}
 |{tool:'setup_feet'};
export interface DirectorPlan {reply:string;actions:DirectorAction[]}
export interface DirectorMessage {id:string;role:'user'|'assistant';text:string;createdAt:number}
export interface DirectorMeshSample {partId:string;count:number;time:number;triangle:number;areaRatio:number;restMinAltitude:number;position:Point2D;vertices:{index:number;position:Point2D;weights:{bone:string;weight:number}[]}[]}
export interface DirectorCheck {code:string;message:string;count:number;locations?:DirectorMeshSample[]}
export interface DirectorCandidate {id:string;source:string;rig:Rig2D;clipId?:string;checks:DirectorCheck[];steps:string[];review?:string;reviewed?:boolean;reviewPasses?:number;reviewRevision?:number;rejectedCorrection?:{actions:DirectorAction[];checks:DirectorCheck[]}}
export interface DirectorPlayback {revision:number;frames:{time:number;image:string}[]}
export const directorReviewLimit=3;
export function directorPlaybackTimes(clip:Clip2D){const count=33;return Array.from({length:count},(_,i)=>clip.duration*i/(count-1));}
export interface DirectorRepairRequest {id:string;partId:string;prompt:string;source:string;candidateId?:string;taskId?:string}
export interface DirectorState {repairRequest?:DirectorRepairRequest;messages:DirectorMessage[];candidate?:DirectorCandidate;run?:{id:string;status:'running'|'cancelled'|'failed'|'done';progress:string;error?:string};lastRequestId?:string}
export type DirectorBounds=Record<string,[number,number,number,number]>;
export interface DirectorInput {requestId:string;revision:number;prompt:string;image:string;atlas:string;bounds:DirectorBounds;candidateId?:string;clipId?:string}
export const directorSource=(d:CutoutDocument)=>JSON.stringify([d.rig,d.artwork,d.reference]);
export function directorDocument(d:CutoutDocument,c:DirectorCandidate):CutoutDocument {return validateCutoutDocument({...d,rig:c.rig,workflowStage:c.clipId?'motion':'assemble',motion:c.clipId?{prompt:c.rig.clips.find(v=>v.id===c.clipId)?.prompt??'',duration:c.rig.clips.find(v=>v.id===c.clipId)!.duration,loop:c.rig.clips.find(v=>v.id===c.clipId)?.loop??true,selectedClipId:c.clipId}:d.motion});}
const finite=(v:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function editable(d:CutoutDocument,id:string){const p=d.rig.parts.find(p=>p.id===id),a=d.artwork.find(a=>a.partId===id);if(!p||!a)throw Error('AI 引用了不存在的部件。');if(a.locked)throw Error(`「${a.name}」已锁定，请在高级编辑中解锁后再修改。`);return p;}
function editableBone(d:CutoutDocument,id:string){const descendants=new Set([id]);for(let i=0;i<d.rig.bones.length;i++)for(const b of d.rig.bones)if(b.parent&&descendants.has(b.parent))descendants.add(b.id);for(const p of d.rig.parts)if(descendants.has(p.bone)||p.mesh?.weights.some(w=>w.some(v=>descendants.has(v.bone)&&v.weight>0)))editable(d,p.id);}
export function directorAutoMesh(d:CutoutDocument,bounds:DirectorBounds):CutoutDocument {
 const rig={...d.rig,bones:d.rig.bones.map(b=>({...b,role:inferBoneRole(b)}))};
 return {...d,rig:{...rig,parts:rig.parts.map(p=>{if(p.mesh||d.artwork.find(a=>a.partId===p.id)?.locked)return p;const rect=bounds[p.id];if(!rect)throw Error('缺少部件轮廓。');const role=inferBoneRole(rig.bones.find(b=>b.id===p.bone)!),name=d.artwork.find(a=>a.partId===p.id)?.name??'',soft=/发|披|裙|布|尾|翼|hair|cape|cloth|tail|wing/i.test(name),joint=/UpperArm|Forearm|Thigh|Shin/.test(role);const ids=[p.bone,...(soft||joint?rig.bones.filter(b=>b.parent===p.bone).map(b=>b.id):[])];return {...p,mesh:autoSkinWeights(rig,gridSkinMesh(rect,6,6,p.bone),ids,p.offset)};})}};
}
export function directorFeet(d:CutoutDocument,bounds:DirectorBounds):CutoutDocument {
 if(d.rig.footRig?.chains.length)return d;
 const world=worldBones2D(d.rig),chains=[];
 for(const side of ['left','right'] as const){const hip=d.rig.bones.find(b=>inferBoneRole(b)===(side==='left'?'leftThigh':'rightThigh')),knee=d.rig.bones.find(b=>b.parent===hip?.id&&inferBoneRole(b)===(side==='left'?'leftShin':'rightShin')),foot=d.rig.bones.find(b=>b.parent===knee?.id&&inferBoneRole(b)===(side==='left'?'leftFoot':'rightFoot'));if(!hip||!knee||!foot)continue;const p=d.rig.parts.find(p=>p.bone===foot.id),r=p&&bounds[p.id],m=world.get(foot.id)!,h=world.get(hip.id)!,k=world.get(knee.id)!,sole:Point2D=r?transform2D(inverse2D(m),[r[0]+r[2]/2+(p!.offset?.[0]??0),r[1]+r[3]+(p!.offset?.[1]??0)]):[0,Math.max(4,d.rig.canvas[1]*.015)];chains.push({id:side+'-leg',name:side==='left'?'左脚':'右脚',hip:hip.id,knee:knee.id,foot:foot.id,sole,bend:((k[4]-h[4])*(m[5]-k[5])-(k[5]-h[5])*(m[4]-k[4])<0?-1:1) as -1|1});}
 return chains.length?{...d,rig:validateRig2D({...d.rig,footRig:{chains,groundY:Math.max(...chains.map(c=>transform2D(world.get(c.foot)!,c.sole)[1]))}})}:d;
}
function adjustmentClip(d:CutoutDocument,a:Extract<DirectorAction,{tool:'adjust_motion'}>,clipId?:string){
 const clip=d.rig.clips.find(c=>c.id===clipId);if(!clip)throw Error('请先生成或选择要调整的动作。');
 if(!finite(a.amplitude,0,2)||!finite(a.duration,.5,15)||typeof a.name!=='string'||!a.name.trim()||a.name.length>100||!Array.isArray(a.boneIds)||a.boneIds.some(id=>!d.rig.bones.some(b=>b.id===id)))throw Error('动作调整参数无效。');return clip;
}
/** Static setup clips cannot be amplified: create actual keyframes instead. */
export function directorMotionAction(d:CutoutDocument,a:DirectorAction,prompt:string,bounds:DirectorBounds,clipId?:string):DirectorAction {
 if(a.tool!=='adjust_motion')return a;const clip=adjustmentClip(d,a,clipId);
 if(motionHasVisibleChange(d.rig,clip,bounds))return a;
 return {tool:'create_motion',template:/呼吸|待机|breath|idle/i.test(prompt+' '+(clip.name??''))?'idle':'custom',duration:a.duration,loop:clip.loop??true,prompt:('当前动作是静止姿势，需要创建真实的新动作关键帧，不能只放大零值。用户要求：'+prompt).slice(0,2000)};
}
export function directorLocalAction(d:CutoutDocument,a:DirectorAction,bounds:DirectorBounds,clipId:string|undefined,newId:string):{doc:CutoutDocument;clipId?:string}{
 let rig=d.rig;
 if(a.tool==='setup_feet')return {doc:directorFeet(d,bounds),clipId};
 if(a.tool==='set_foot_lock'){
  const clip=rig.clips.find(c=>c.id===clipId);if(!clip)throw Error('请先生成或选择要调整脚底支撑的动作。');
  if(typeof a.enabled!=='boolean'||a.contacts!==null&&!Array.isArray(a.contacts))throw Error('脚底锁定开关或接触区间无效。');
  const contacts=a.contacts===null?clip.contacts:a.contacts.map(c=>c&&c.target==null?{chainId:c.chainId,start:c.start,end:c.end}:structuredClone(c));
  if(a.enabled&&(!rig.footRig?.chains.length||!contacts?.length))throw Error('启用脚底锁定需要有效的脚底骨链和接触区间。');
  if(clip.footLock===a.enabled&&JSON.stringify(clip.contacts)===JSON.stringify(contacts))return {doc:d,clipId};
  for(const chain of rig.footRig?.chains??[])editableBone(d,chain.hip);
  const next:Clip2D={...clip,id:newId,footLock:a.enabled,contacts};rig={...rig,clips:[...rig.clips.filter(c=>c.id!==newId),next]};clipId=newId;
 }else if(a.tool==='animate_channel'||a.tool==='animate_region'){
  const clip=rig.clips.find(c=>c.id===clipId);if(!clip)throw Error('请先创建或选择要精修的动作。');
  if(a.tool==='animate_region'||a.target==='part')editable(d,a.tool==='animate_region'?a.partId:a.targetId);
  else editableBone(d,a.targetId);
  const next=detailMotionClip(rig,clip,a,bounds,newId);rig={...rig,clips:[...rig.clips.filter(c=>c.id!==newId),next]};clipId=newId;
 }else if(a.tool==='adjust_motion'){
  const clip=adjustmentClip(d,a,clipId);if(!motionHasVisibleChange(rig,clip,bounds))throw Error('当前动作没有实际运动，无法放大幅度；请生成新的动作关键帧。');
  const targets=new Set(a.boneIds.length?a.boneIds:rig.bones.map(b=>b.id)),first=clip.keys[0],ratio=a.duration/clip.duration;
  const next:Clip2D={...clip,id:newId,name:a.name,duration:a.duration,contacts:clip.contacts?.map(c=>({...c,start:c.start*ratio,end:c.end*ratio})),keys:clip.keys.map(k=>({...k,time:k.time*ratio,rotations:Object.fromEntries(Object.entries(k.rotations).map(([id,v])=>[id,targets.has(id)?(first.rotations[id]??0)+(v-(first.rotations[id]??0))*a.amplitude:v])),bones:k.bones?Object.fromEntries(Object.entries(k.bones).map(([id,t])=>[id,targets.has(id)?Object.fromEntries(Object.entries(t).map(([key,v])=>{const base=(first.bones?.[id] as Record<string,number>|undefined)?.[key]??(key.startsWith('scale')?1:0);return [key,base+(v-base)*a.amplitude];})):t])):undefined}))};
  const affectedPart=(id:string)=>{const p=rig.parts.find(p=>p.id===id);return !!p&&(targets.has(p.bone)||!!p.mesh?.weights.some(w=>w.some(v=>targets.has(v.bone))));};
  const amplify=(values:Record<string,number>,base:Record<string,number>)=>Object.fromEntries(Object.entries(values).map(([key,v])=>{if(!['x','y','rotation','scaleX','scaleY'].includes(key))return [key,v];const start=base[key]??(key.startsWith('scale')?1:0);return [key,start+(v-start)*a.amplitude];}));
  next.keys=next.keys.map(k=>({...k,...(k.deforms?{deforms:Object.fromEntries(Object.entries(k.deforms).map(([id,t])=>[id,affectedPart(clip.deformRegions![id].partId)?amplify(t as Record<string,number>,first.deforms?.[id] as Record<string,number>??{}):t]))}:{}),...(k.parts?{parts:Object.fromEntries(Object.entries(k.parts).map(([id,t])=>[id,affectedPart(id)?amplify(t as Record<string,number>,first.parts?.[id] as Record<string,number>??{}):t]))}:{})}));
  rig={...rig,clips:[...rig.clips.filter(c=>c.id!==newId),next]};clipId=newId;
 }else if(a.tool==='move_joint'){if(!finite(a.x,-16384,16384)||!finite(a.y,-16384,16384))throw Error('关节坐标无效。');rig=editRigJoint(rig,a.boneId,[a.x,a.y]);}
 else if(a.tool==='set_role'){rig={...rig,bones:rig.bones.map(b=>b.id===a.boneId?{...b,role:a.role}:b)};if(!rig.bones.some(b=>b.id===a.boneId))throw Error('骨骼不存在。');}
 else if(['mesh_part','paint_weight','bind_part','place_part'].includes(a.tool)){
  const v=a as Extract<DirectorAction,{partId:string}>,p=editable(d,v.partId);let part={...p};
  if(v.tool==='mesh_part'){if(!Number.isInteger(v.density)||v.density<2||v.density>16||!Array.isArray(v.boneIds)||!v.boneIds.length||v.boneIds.some(id=>!rig.bones.some(b=>b.id===id)))throw Error('网格影响骨骼或密度无效。');part.mesh=autoSkinWeights(rig,gridSkinMesh(bounds[p.id],v.density,v.density,p.bone),v.boneIds,p.offset);}
  if(v.tool==='paint_weight'){if(!p.mesh||!rig.bones.some(b=>b.id===v.boneId)||!finite(v.x,-16384,16384)||!finite(v.y,-16384,16384)||!finite(v.radius,1,500)||!finite(v.strength,-1,1))throw Error('权重修正参数无效。');part.mesh=paintSkinWeights(p.mesh,v.boneId,[v.x-(p.offset?.[0]??0),v.y-(p.offset?.[1]??0)],v.radius,v.strength);}
  if(v.tool==='bind_part'){if(!rig.bones.some(b=>b.id===v.boneId))throw Error('骨骼不存在。');part.bone=v.boneId;if(part.mesh)part.mesh={...part.mesh,weights:part.mesh.weights.map(()=>[{bone:v.boneId,weight:1}])};}
  if(v.tool==='place_part'){if(!finite(v.x,-16384,16384)||!finite(v.y,-16384,16384)||!finite(v.z,-10000,10000))throw Error('图片位置或顺序无效。');part.offset=[v.x,v.y];part.z=v.z;}
  rig={...rig,parts:rig.parts.map(v=>v.id===p.id?part:v)};
 }else throw Error('不支持的本地编辑工具。');
 return {doc:validateCutoutDocument({...d,rig}),clipId};
}
/** Deterministic checks are measured on evaluated poses, including foot IK. */
export function directorChecks(rig:Rig2D,clip?:Clip2D):DirectorCheck[]{
 validateRig2D(rig);if(!clip)return [];
 let flipped=0,stretched=0,feet=0;const locations={mesh_flip:new Map<string,DirectorMeshSample>(),mesh_stretch:new Map<string,DirectorMeshSample>()};
 const area=(p:Point2D[],a:number,b:number,c:number)=>(p[b][0]-p[a][0])*(p[c][1]-p[a][1])-(p[b][1]-p[a][1])*(p[c][0]-p[a][0]);
 const bind=worldBones2D(rig);for(let i=0;i<=64;i++){
  const time=clip.duration*i/64,pose=evaluateMotion2D(rig,clip,time),matrices=skinMatrices(rig,pose);feet+=pose.footLocks?.filter(f=>f.error>Math.max(2,rig.canvas[1]*.005)).length??0;
  for(const p of rig.parts){if(!p.mesh)continue;
   const vertices=skinVertices(p,matrices,partMotionAdjustment(p,bind.get(p.bone)!,pose.parts[p.id]??{}),pose.deforms);
   for(let t=0;t<p.mesh.triangles.length;t+=3){
    const indices=p.mesh.triangles.slice(t,t+3),[a,b,c]=indices,before=area(p.mesh.vertices,a,b,c),after=area(vertices,a,b,c);if(Math.abs(before)<1e-6)continue;
    const ratio=after/before,flip=ratio<=0,stretch=Math.abs(ratio)>3||Math.abs(ratio)<.2;if(flip)flipped++;if(stretch)stretched++;
    for(const code of ['mesh_flip','mesh_stretch'] as const){
     if(!(code==='mesh_flip'?flip:stretch))continue;const old=locations[code].get(p.id),count=(old?.count??0)+1;
     const severity=(v:number)=>code==='mesh_flip'?-v:Math.abs(Math.log(Math.max(1e-9,Math.abs(v))));
     if(old&&severity(ratio)<=severity(old.areaRatio)){old.count=count;continue;}
     const source=indices.map(index=>({index,position:[p.mesh!.vertices[index][0]+(p.offset?.[0]??0),p.mesh!.vertices[index][1]+(p.offset?.[1]??0)] as Point2D,weights:p.mesh!.weights[index].map(w=>({...w}))}));
     locations[code].set(p.id,{partId:p.id,count,time,triangle:t/3,areaRatio:ratio,restMinAltitude:Math.abs(before)/Math.max(...indices.map((id,j)=>Math.hypot(p.mesh!.vertices[id][0]-p.mesh!.vertices[indices[(j+1)%3]][0],p.mesh!.vertices[id][1]-p.mesh!.vertices[indices[(j+1)%3]][1]))),position:[source.reduce((n,v)=>n+v.position[0],0)/3,source.reduce((n,v)=>n+v.position[1],0)/3],vertices:source});
    }
   }
  }
 }
 const located=(code:keyof typeof locations)=>[...locations[code].values()].sort((a,b)=>b.count-a.count).slice(0,8);
 const checks:DirectorCheck[]=[];
 if(!motionHasVisibleChange(rig,clip))checks.push({code:'static_motion',message:'这个动作没有实际运动，请重新制作动作；放大静止姿势不会产生呼吸。',count:1});
 if(flipped)checks.push({code:'mesh_flip',message:'部分网格在动作中翻折，需要结合对应部件与时刻检查权重。',count:flipped,locations:located('mesh_flip')});
 if(stretched)checks.push({code:'mesh_stretch',message:'部分网格拉伸或压缩较大，需要检查对应部件的关节。',count:stretched,locations:located('mesh_stretch')});
 if(feet)checks.push({code:'foot_slip',message:'部分支撑脚超出可达范围，可减少起伏或调整腿部绑定。',count:feet});
 if(clip.loop){const first=evaluateMotion2D(rig,clip,0),last=evaluateMotion2D(rig,clip,clip.duration);if(JSON.stringify([first.rotations,first.bones,first.parts,first.deforms])!==JSON.stringify([last.rotations,last.bones,last.parts,last.deforms]))checks.push({code:'loop',message:'循环首尾姿势不一致。',count:1});}return checks;
}

/** Measured from the same mesh/IK evaluator as playback, including frames between review images. */
export function directorMotionReport(rig:Rig2D,clip:Clip2D){
 const baseline=motionGeometry(rig,evaluateMotion2D(rig,clip,0)),parts=baseline.map(p=>({partId:p.id,maxDisplacement:0,peakTime:0,maxFrameStep:0,maxFrameStepTime:0}));let previous=baseline;
 const bones=rig.bones.map(b=>({boneId:b.id,role:inferBoneRole(b),minRotation:Infinity,maxRotation:-Infinity,maxIKCorrection:0,maxIKCorrectionTime:0,maxFrameStep:0,maxFrameStepTime:0}));let previousPose:ReturnType<typeof evaluateMotion2D>|undefined;
 const samples=Math.min(240,Math.max(96,Math.ceil(clip.duration*30)));
 for(let i=0;i<=samples;i++){
  const time=clip.duration*i/samples,pose=evaluateMotion2D(rig,clip,time),raw=sampleMotion2D(clip,time),frame=motionGeometry(rig,pose);
  for(const b of bones){const value=pose.rotations[b.boneId]??0;b.minRotation=Math.min(b.minRotation,value);b.maxRotation=Math.max(b.maxRotation,value);const correction=Math.abs(value-(raw.rotations[b.boneId]??0)),step=previousPose?Math.abs(value-(previousPose.rotations[b.boneId]??0)):0;if(correction>b.maxIKCorrection){b.maxIKCorrection=correction;b.maxIKCorrectionTime=time;}if(step>b.maxFrameStep){b.maxFrameStep=step;b.maxFrameStepTime=time;}}
  for(let j=0;j<frame.length;j++){if(!frame[j].visible||frame[j].opacity<=0)continue;let distance=0,step=0;for(let v=0;v<frame[j].points.length;v++){const p=frame[j].points[v],b=baseline[j].points[v],prev=previous[j].points[v];distance=Math.max(distance,Math.hypot(p[0]-b[0],p[1]-b[1]));step=Math.max(step,Math.hypot(p[0]-prev[0],p[1]-prev[1]));}if(distance>parts[j].maxDisplacement){parts[j].maxDisplacement=distance;parts[j].peakTime=time;}if(step>parts[j].maxFrameStep){parts[j].maxFrameStep=step;parts[j].maxFrameStepTime=time;}}
  previous=frame;previousPose=pose;
 }
 return {duration:clip.duration,samples,footLock:footLockState(rig,clip),bones,parts};
}
