import {sampleMotion2D,validateRig2D,type Clip2D,type MotionKey2D,type Rig2D,type Point2D,type PartState2D} from './skeletal2d';

export type DetailChannel='x'|'y'|'scaleX'|'scaleY'|'rotation';
export interface MotionWave {channel:DetailChannel;offset:number;amplitude:number;cycles:number;delay:number;wave:'sine'|'breath';peak:number}
export interface MotionChannelAction extends MotionWave {tool:'animate_channel';target:'bone'|'part';targetId:string}
export interface MotionRegionAction extends MotionWave {tool:'animate_region';regionId:string;partId:string;centerX:number;centerY:number;radiusX:number;radiusY:number;falloff:'radial'|'tip'}
export type MotionDetailAction=MotionChannelAction|MotionRegionAction;
export interface DeformRegion2D {partId:string;center:Point2D;radius:Point2D;falloff:'radial'|'tip'}
export interface RegionPose2D extends DeformRegion2D {transform:PartState2D}
export function withoutPartDeforms(clip:Clip2D,partId:string):Clip2D {
 const removed=new Set(Object.entries(clip.deformRegions??{}).filter(([,r])=>r.partId===partId).map(([id])=>id));if(!removed.size)return clip;
 return {...clip,deformRegions:Object.fromEntries(Object.entries(clip.deformRegions!).filter(([id])=>!removed.has(id))),keys:clip.keys.map(k=>({...k,...(k.deforms?{deforms:Object.fromEntries(Object.entries(k.deforms).filter(([id])=>!removed.has(id)))}:{})}))};
}
const finite=(v:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;

/** Deform in registered source coordinates; UVs and bind weights stay unchanged. */
export function deformPoint(point:Point2D,regions:RegionPose2D[]):Point2D {
 let x=point[0],y=point[1];
 for(const r of regions){const dx=point[0]-r.center[0],dy=point[1]-r.center[1],distance=Math.hypot(dx/r.radius[0],dy/r.radius[1]);
  const t=r.falloff==='tip'?Math.max(0,Math.min(1,dy/r.radius[1])):Math.max(0,1-distance),weight=t*t*(3-2*t),v=r.transform,angle=(v.rotation??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),sx=v.scaleX??1,sy=v.scaleY??1;
  x+=weight*((v.x??0)+c*sx*dx-s*sy*dy-dx);y+=weight*((v.y??0)+s*sx*dx+c*sy*dy-dy);
 }
 return [x,y];
}

export function validateMotionWave(a:MotionWave,duration:number){
 const scale=a.channel==='scaleX'||a.channel==='scaleY',limit=scale?1:a.channel==='rotation'?90:16384;
 if(!['x','y','scaleX','scaleY','rotation'].includes(a.channel)||!finite(a.offset,scale ? .1 : -limit,scale ? 4 : limit)||!finite(a.amplitude,-limit,limit)||!Number.isInteger(a.cycles)||a.cycles<1||a.cycles>8||!finite(a.delay,0,duration)||!['sine','breath'].includes(a.wave)||!finite(a.peak,.15,.85))throw Error('局部动作的幅度、延迟或节奏无效。');
 if(scale&&(a.offset-Math.abs(a.amplitude)<.05||a.offset+Math.abs(a.amplitude)>8))throw Error('局部缩放超出范围。');
}
export function motionWaveValue(a:MotionWave,clip:Clip2D,time:number){
 const raw=(time-a.delay)/clip.duration*a.cycles,phase=((raw%1)+1)%1;
 const wave=a.wave==='sine'?Math.sin(phase*Math.PI*2):phase<a.peak?(1-Math.cos(Math.PI*phase/a.peak))/2:(1+Math.cos(Math.PI*(phase-a.peak)/(1-a.peak)))/2;
 const envelope=clip.loop===false?Math.sin(Math.PI*time/clip.duration)**2:1;
 return a.offset+a.amplitude*wave*envelope;
}
/** Replace only the requested channel. Other sparse channels and discrete events remain intact. */
export function detailMotionClip(rig:Rig2D,clip:Clip2D,a:MotionDetailAction,bounds:Record<string,[number,number,number,number]>,id:string):Clip2D {
 validateMotionWave(a,clip.duration);const regions={...clip.deformRegions};
 if(a.tool==='animate_channel'){
  if(!['bone','part'].includes(a.target)||!(a.target==='bone'?rig.bones:rig.parts).some(t=>t.id===a.targetId))throw Error('局部动作引用的骨骼或部件不存在。');
 }else{
  const part=rig.parts.find(p=>p.id===a.partId),rect=bounds[a.partId];
  if(!part?.mesh||!rect)throw Error('局部变形需要部件网格与轮廓。');
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(a.regionId)||![a.centerX,a.centerY].every(v=>finite(v,0,1))||![a.radiusX,a.radiusY].every(v=>finite(v,.05,2))||!['radial','tip'].includes(a.falloff))throw Error('局部变形范围无效。');
  if(regions[a.regionId]&&regions[a.regionId].partId!==a.partId)throw Error('局部变形名称已用于其他部件。');
  regions[a.regionId]={partId:a.partId,center:[rect[0]+rect[2]*a.centerX,rect[1]+rect[3]*a.centerY],radius:[rect[2]*a.radiusX,rect[3]*a.radiusY],falloff:a.falloff};
 }
 // Insert enough samples for delayed waves, retaining original key times and interpolation.
 const count=Math.max(32,a.cycles*24),times=clip.keys.map(k=>k.time);for(let i=0;i<=count;i++){const time=clip.duration*i/count;if(!times.some(t=>Math.abs(t-time)<1e-7))times.push(time);}times.sort((a,b)=>a-b);
 const keys:MotionKey2D[]=times.map(time=>{
  const original=clip.keys.find(k=>k.time===time),previous=clip.keys.filter(k=>k.time<=time).at(-1)!,pose=original?undefined:sampleMotion2D(clip,time),key:MotionKey2D=original?structuredClone(original):{time,rotations:pose!.rotations,curve:previous.curve};
  let value=motionWaveValue(a,clip,time);
  if(a.tool==='animate_region')key.deforms={...key.deforms,[a.regionId]:{...key.deforms?.[a.regionId],[a.channel]:value}};
  else if(a.target==='bone'&&a.channel==='rotation'){
   const limits=rig.bones.find(b=>b.id===a.targetId)!.limits;if(limits)value=Math.max(limits.min,Math.min(limits.max,value));key.rotations[a.targetId]=value;
  }else{const kind=a.target==='bone'?'bones':'parts';key[kind]={...key[kind],[a.targetId]:{...key[kind]?.[a.targetId],[a.channel]:value}};}
  return key;
 });
 // A rotation channel must be present on every key, including previously sparse setup clips.
 if(clip.loop)keys[keys.length-1]={...structuredClone(keys[0]),time:clip.duration};
 const next={...clip,id,keys,...(a.tool==='animate_region'?{deformRegions:regions}:{})};validateRig2D({...rig,clips:[next]});return next;
}
