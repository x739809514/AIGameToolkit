import {validateSkinMesh,type SkinMesh2D} from './cutout-skinning';
import {validateFootRig,validateFootContacts,type FootRig2D,type FootContact2D} from './cutout-foot-lock';
import type {DeformRegion2D,RegionPose2D} from './cutout-motion-detail';
/** Experimental rigid 2D cutout rig. Logical pixels, +Y down, clockwise degrees. */
export type Point2D=[number,number];
export type Matrix2D=[number,number,number,number,number,number];
export const boneRoles2D=['root','torso','head','leftUpperArm','leftForearm','rightUpperArm','rightForearm','leftThigh','leftShin','rightThigh','rightShin','leftFoot','rightFoot','accessory','other'] as const;
export type BoneRole2D=typeof boneRoles2D[number];
export interface BoneTransform2D {x?:number;y?:number;scaleX?:number;scaleY?:number}
export interface PartState2D extends BoneTransform2D {rotation?:number;opacity?:number;visible?:boolean;z?:number;variant?:string}
export type Curve2D='linear'|'smooth'|'cubic'|'step';
export interface MotionKey2D {time:number;rotations:Record<string,number>;bones?:Record<string,BoneTransform2D>;parts?:Record<string,PartState2D>;deforms?:Record<string,PartState2D>;curve?:Curve2D}
export interface MotionPose2D {rotations:Record<string,number>;bones:Record<string,BoneTransform2D>;parts:Record<string,PartState2D>;deforms?:Record<string,RegionPose2D>}
export interface Bone2D {role?:BoneRole2D;limits?:{min:number;max:number};name?:string;id:string;parent?:string;origin:Point2D;rotation:number}
export interface Part2D {mesh?:SkinMesh2D;visible?:boolean;variants?:{id:string;asset:string}[];offset?:Point2D;id:string;bone:string;asset:string;crop:[number,number,number,number];z:number;role:'source'|'joint-fill'}
export interface Clip2D {deformRegions?:Record<string,DeformRegion2D>;footLock?:boolean;contacts?:FootContact2D[];interpolation?:Curve2D;template?:'idle'|'walk'|'wave'|'custom';name?:string;prompt?:string;notes?:string;loop?:boolean;id:string;duration:number;keys:MotionKey2D[]}
export interface Rig2D {
 footRig?:FootRig2D;format:'laputa-cutout-experiment';version:1;revision:number;
 canvas:[number,number];sourceHash:string;bones:Bone2D[];parts:Part2D[];clips:Clip2D[];
}
export const identity2D=():Matrix2D=>[1,0,0,1,0,0];
export function multiply2D(a:Matrix2D,b:Matrix2D):Matrix2D {
 return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function inverse2D(a:Matrix2D):Matrix2D {
 const d=a[0]*a[3]-a[1]*a[2];if(Math.abs(d)<1e-10)throw Error('Singular 2D transform');
 return [a[3]/d,-a[1]/d,-a[2]/d,a[0]/d,(a[2]*a[5]-a[3]*a[4])/d,(a[1]*a[4]-a[0]*a[5])/d];
}
export const transform2D=(m:Matrix2D,p:Point2D):Point2D=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const id=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
export function validateRig2D(r:Rig2D):Rig2D {
 if(r.format!=='laputa-cutout-experiment'||r.version!==1||!Number.isInteger(r.revision)||r.revision<0)throw Error('Unsupported rig document');
 if(r.canvas.length!==2||!r.canvas.every(v=>finite(v)&&v>0&&v<=8192)||!/^[a-f0-9]{64}$/.test(r.sourceHash))throw Error('Invalid source registration');
 if(!r.bones.length||r.bones.length>128||r.parts.length>256||r.clips.length>32)throw Error('Invalid rig size');
 const ids=new Set<string>();
 for(const b of r.bones){if(b.role!==undefined&&!boneRoles2D.includes(b.role)||b.limits!==undefined&&(!finite(b.limits.min)||!finite(b.limits.max)||b.limits.min< -180||b.limits.max>180||b.limits.min>b.limits.max))throw Error('Invalid bone role or limits');if(b.name!==undefined&&(typeof b.name!=='string'||b.name.length>100))throw Error('Invalid bone name');if(!id(b.id)||ids.has(b.id)||b.origin.length!==2||!b.origin.every(finite)||!finite(b.rotation))throw Error('Invalid or duplicate bone');ids.add(b.id);}
 if(r.bones.filter(b=>!b.parent).length!==1)throw Error('Expected one root bone');
 for(const b of r.bones){const seen=new Set([b.id]);let p=b.parent;while(p){if(!ids.has(p)||seen.has(p))throw Error('Missing parent or cyclic hierarchy');seen.add(p);p=r.bones.find(v=>v.id===p)!.parent;}}
 const parts=new Set<string>();
 for(const p of r.parts){if(p.visible!==undefined&&typeof p.visible!=='boolean')throw Error('Invalid setup visibility');if(p.offset!==undefined&&(!Array.isArray(p.offset)||p.offset.length!==2||!p.offset.every(v=>finite(v)&&Math.abs(v)<=16384)))throw Error('Invalid part offset');if(!id(p.id)||parts.has(p.id)||!ids.has(p.bone)||!/^parts\/[a-zA-Z0-9_-]+\.png$/.test(p.asset)||p.crop.length!==4||!p.crop.every(finite)||p.crop[2]<=0||p.crop[3]<=0||!finite(p.z)||!['source','joint-fill'].includes(p.role))throw Error('Invalid part registration');parts.add(p.id);if(p.variants){if(!Array.isArray(p.variants)||p.variants.length>16||new Set(p.variants.map(v=>v.id)).size!==p.variants.length||p.variants.some(v=>!id(v.id)||!/^parts\/[a-zA-Z0-9_-]+\.png$/.test(v.asset)))throw Error('Invalid part variants');}}
 for(const p of r.parts)if(p.mesh)validateSkinMesh(p.mesh,ids);validateFootRig(r);
 const clips=new Set<string>();
 for(const c of r.clips){
  if(c.deformRegions!==undefined){if(!c.deformRegions||typeof c.deformRegions!=='object'||Array.isArray(c.deformRegions)||Object.keys(c.deformRegions).length>32)throw Error('Invalid deformation regions');for(const [name,v]of Object.entries(c.deformRegions)){if(!id(name)||!v||!r.parts.some(p=>p.id===v.partId&&p.mesh)||!['radial','tip'].includes(v.falloff)||!Array.isArray(v.center)||v.center.length!==2||!v.center.every(n=>finite(n)&&Math.abs(n)<=16384)||!Array.isArray(v.radius)||v.radius.length!==2||!v.radius.every(n=>finite(n)&&n>0&&n<=32768))throw Error('Invalid deformation region');}}
  for(const k of c.keys)if(k.deforms!==undefined){if(!k.deforms||typeof k.deforms!=='object'||Array.isArray(k.deforms))throw Error('Invalid deformation tracks');for(const [name,t]of Object.entries(k.deforms)){if(!c.deformRegions?.[name]||!t||Object.keys(t).some(f=>!['x','y','scaleX','scaleY','rotation'].includes(f)))throw Error('Unknown deformation channel');validateTransform2D(t);if(t.rotation!==undefined&&(!finite(t.rotation)||Math.abs(t.rotation)>180))throw Error('Invalid deformation rotation');}}
  validateFootContacts(r,c);
  if(c.interpolation!==undefined&&!['linear','smooth','cubic','step'].includes(c.interpolation)||c.template!==undefined&&!['idle','walk','wave','custom'].includes(c.template))throw Error('Invalid interpolation or template');
  if(c.name!==undefined&&(typeof c.name!=='string'||c.name.length>100)||c.prompt!==undefined&&(typeof c.prompt!=='string'||c.prompt.length>2000)||c.notes!==undefined&&(typeof c.notes!=='string'||c.notes.length>2000)||c.loop!==undefined&&typeof c.loop!=='boolean')throw Error('Invalid motion metadata');
  if(!id(c.id)||clips.has(c.id)||!finite(c.duration)||c.duration<=0||c.duration>60||c.keys.length<2||c.keys.length>3601)throw Error('Invalid motion clip');clips.add(c.id);
  let previous=-1;
  for(const k of c.keys){if(!finite(k.time)||k.time<=previous||k.time<0||k.time>c.duration||Object.entries(k.rotations).some(([b,v])=>!ids.has(b)||!finite(v)))throw Error('Invalid motion key');previous=k.time;validateMotionKey2D(r,k);}
  if(c.keys[0].time!==0||c.keys.at(-1)!.time!==c.duration)throw Error('Incomplete motion range');
  const channels=Object.keys(c.keys[0].rotations).sort().join(',');
  if(c.keys.some(k=>Object.keys(k.rotations).sort().join(',')!==channels))throw Error('Motion channels change between keys');
 }
 return r;
}
export function worldBones2D(r:Rig2D,rotations:Record<string,number>={},transforms:Record<string,BoneTransform2D>={}):Map<string,Matrix2D> {
 if(Object.entries(rotations).some(([k,v])=>!r.bones.some(b=>b.id===k)||!finite(v)))throw Error('Unknown or invalid pose channel');
 const out=new Map<string,Matrix2D>(),visiting=new Set<string>();
 const solve=(id:string):Matrix2D=>{
  const found=out.get(id);if(found)return found;
  const b=r.bones.find(v=>v.id===id);if(!b||visiting.has(id))throw Error('Invalid bone hierarchy');visiting.add(id);
  const delta=rotations[id]??0,angle=(b.rotation+(b.limits&&rotations[id]!==undefined?Math.max(b.limits.min,Math.min(b.limits.max,delta)):delta))*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),t=transforms[id]??{},sx=t.scaleX??1,sy=t.scaleY??1;
  const local:Matrix2D=[c*sx,s*sx,-s*sy,c*sy,b.origin[0]+(t.x??0),b.origin[1]+(t.y??0)],m=b.parent?multiply2D(solve(b.parent),local):local;
  visiting.delete(id);out.set(id,m);return m;
 };
 r.bones.forEach(b=>solve(b.id));return out;
}
export function partTransforms2D(r:Rig2D,rotations:Record<string,number>={},transforms:Record<string,BoneTransform2D>={}):Map<string,Matrix2D> {
 const bind=worldBones2D(r),pose=worldBones2D(r,rotations,transforms);
 return new Map(r.parts.map((p):[string,Matrix2D]=>{const delta=multiply2D(pose.get(p.bone)!,inverse2D(bind.get(p.bone)!));return [p.id,p.offset?multiply2D(delta,[1,0,0,1,...p.offset]):delta];}));
}
export function sampleClip2D(c:Clip2D,time:number):Record<string,number> {return sampleMotion2D(c,time).rotations;}
const curves2D=['linear','smooth','cubic','step'];
function validateTransform2D(t:BoneTransform2D){if(!t||typeof t!=='object'||Object.entries(t).some(([key,value])=>['x','y'].includes(key)?!finite(value)||Math.abs(value)>16384:['scaleX','scaleY'].includes(key)?!finite(value)||value<.05||value>8:false))throw Error('Invalid animated transform');}
export function validateMotionKey2D(r:Rig2D,k:MotionKey2D){
 for(const map of [k.bones,k.parts])if(map!==undefined&&(!map||typeof map!=='object'||Array.isArray(map)))throw Error('Invalid animation track map');
 if(k.curve!==undefined&&!curves2D.includes(k.curve))throw Error('Invalid key interpolation');
 for(const [id,t] of Object.entries(k.bones??{})){if(!r.bones.some(b=>b.id===id))throw Error('Unknown animated bone');validateTransform2D(t);}
 for(const [id,t] of Object.entries(k.parts??{})){const part=r.parts.find(p=>p.id===id);if(!part)throw Error('Unknown animated part');validateTransform2D(t);if(t.rotation!==undefined&&(!finite(t.rotation)||Math.abs(t.rotation)>180)||t.opacity!==undefined&&(!finite(t.opacity)||t.opacity<0||t.opacity>1)||t.visible!==undefined&&typeof t.visible!=='boolean'||t.z!==undefined&&(!finite(t.z)||Math.abs(t.z)>16384)||t.variant!==undefined&&(typeof t.variant!=='string'||t.variant!==''&&!part.variants?.some(v=>v.id===t.variant)))throw Error('Invalid animated part state');}
}
function interpolateTrack2D(c:Clip2D,time:number,read:(k:MotionKey2D)=>number|undefined,fallback:number){
 const keys=c.keys.flatMap(k=>{const value=read(k);return value===undefined?[]:[{time:k.time,value,curve:k.curve}];});if(!keys.length)return fallback;if(keys[0].time>0)keys.unshift({time:0,value:fallback,curve:undefined});
 const next=keys.findIndex(k=>k.time>time);if(next<0)return keys.at(-1)!.value;const i=Math.max(0,next-1),a=keys[i],b=keys[next],duration=b.time-a.time;if(duration<=0)return a.value;let u=Math.max(0,Math.min(1,(time-a.time)/duration));const curve=a.curve??c.interpolation??'smooth';if(curve==='step')return a.value;if(curve==='smooth')u=u*u*(3-2*u);
 if(curve==='cubic'){const before=keys[Math.max(0,i-1)],after=keys[Math.min(keys.length-1,next+1)],ma=(b.value-before.value)/(b.time-before.time||1),mb=(after.value-a.value)/(after.time-a.time||1);return (2*u**3-3*u*u+1)*a.value+(u**3-2*u*u+u)*duration*ma+(-2*u**3+3*u*u)*b.value+(u**3-u*u)*duration*mb;}
 return a.value*(1-u)+b.value*u;
}
export function sampleMotion2D(c:Clip2D,time:number):MotionPose2D {
 if(!finite(time))throw Error('Invalid sample time');const t=Math.max(0,Math.min(c.duration,time)),rotations:Record<string,number>={},bones:Record<string,BoneTransform2D>={},parts:Record<string,PartState2D>={};
 for(const id of new Set(c.keys.flatMap(k=>Object.keys(k.rotations))))rotations[id]=interpolateTrack2D(c,t,k=>k.rotations[id],0);
 for(const kind of ['bones','parts'] as const){for(const id of new Set(c.keys.flatMap(k=>Object.keys(k[kind]??{})))){const target:PartState2D={};for(const field of (kind==='bones'?['x','y','scaleX','scaleY']:['x','y','scaleX','scaleY','rotation','opacity','z']) as (keyof PartState2D)[]){if(field==='z'){const last=c.keys.filter(k=>k.time<=t&&k.parts?.[id]?.z!==undefined).at(-1);if(last)target.z=last.parts![id].z;continue;}if(!c.keys.some(k=>k[kind]?.[id]?.[field as keyof BoneTransform2D]!==undefined))continue;const value=interpolateTrack2D(c,t,k=>(k[kind]?.[id] as Record<string,number>|undefined)?.[field],['scaleX','scaleY','opacity'].includes(field)?1:0);(target as Record<string,unknown>)[field]=field==='opacity'?Math.max(0,Math.min(1,value)):field==='scaleX'||field==='scaleY'?Math.max(.05,Math.min(8,value)):value;}
 if(kind==='parts')for(const field of ['visible','variant'] as const){const last=c.keys.filter(k=>k.time<=t&&k.parts?.[id]?.[field]!==undefined).at(-1);if(last)(target as Record<string,unknown>)[field]=last.parts![id][field];}
 (kind==='bones'?bones:parts)[id]=target;}}
 const deforms:Record<string,RegionPose2D>={};for(const [id,region]of Object.entries(c.deformRegions??{})){const transform:PartState2D={};for(const field of ['x','y','scaleX','scaleY','rotation'] as const){if(!c.keys.some(k=>k.deforms?.[id]?.[field]!==undefined))continue;transform[field]=interpolateTrack2D(c,t,k=>k.deforms?.[id]?.[field],field.startsWith('scale')?1:0);}deforms[id]={...region,transform};}
 return {rotations,bones,parts,...(Object.keys(deforms).length?{deforms}:{})};
}
/** Absolute parent-space upper angle and relative elbow angle, no bone stretching. */
export function solveArm2D(shoulder:Point2D,target:Point2D,l1:number,l2:number,bend:1|-1=1){
 if(![...shoulder,...target,l1,l2].every(finite)||l1<=0||l2<=0)throw Error('Invalid IK chain');
 const dx=target[0]-shoulder[0],dy=target[1]-shoulder[1],distance=Math.hypot(dx,dy),reach=Math.min(l1+l2,Math.max(Math.abs(l1-l2)+1e-7,distance));
 const base=Math.atan2(dy,dx),elbow=bend*Math.acos(Math.max(-1,Math.min(1,(reach*reach-l1*l1-l2*l2)/(2*l1*l2))));
 const upper=base-Math.atan2(l2*Math.sin(elbow),l1+l2*Math.cos(elbow));
 return {upper:upper*180/Math.PI,lower:elbow*180/Math.PI,error:Math.abs(distance-reach)};
}
