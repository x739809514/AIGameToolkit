import {worldBones2D,inverse2D,transform2D,solveArm2D,sampleMotion2D,type Point2D,type Rig2D,type Clip2D,type MotionPose2D} from './skeletal2d';
export interface FootChain2D {id:string;name:string;hip:string;knee:string;foot:string;sole:Point2D;bend:1|-1}
export interface FootRig2D {groundY:number;chains:FootChain2D[]}
export interface FootContact2D {chainId:string;start:number;end:number;target?:Point2D}
export interface FootLockDiagnostic {chainId:string;target:Point2D;actual:Point2D;error:number}
export interface EvaluatedMotion2D extends MotionPose2D {footLocks?:FootLockDiagnostic[]}
/** The stored flag alone does not say whether playback will run foot IK. */
export function footLockState(r:Rig2D,c:Clip2D){
 const enabled=c.footLock!==false,contactCount=c.contacts?.length??0;
 const reason=!enabled?'disabled':!r.footRig?.chains.length?'no_foot_rig':!contactCount?'no_contacts':'active_intervals';
 return {enabled,effective:reason==='active_intervals',reason,contactCount};
}
const point=(p:unknown):p is Point2D=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=16384);
export function validateFootRig(r:Rig2D){const f=r.footRig;if(!f)return;if(!Number.isFinite(f.groundY)||Math.abs(f.groundY)>16384||!Array.isArray(f.chains)||f.chains.length>8||new Set(f.chains.map(c=>c.id)).size!==f.chains.length)throw Error('地面或脚底骨链设置无效。');const used=new Set<string>();for(const c of f.chains){const hip=r.bones.find(b=>b.id===c.hip),knee=r.bones.find(b=>b.id===c.knee),foot=r.bones.find(b=>b.id===c.foot);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id)||typeof c.name!=='string'||c.name.length>100||!hip||knee?.parent!==c.hip||foot?.parent!==c.knee||new Set([c.hip,c.knee,c.foot]).size!==3||!point(c.sole)||![1,-1].includes(c.bend)||[c.hip,c.knee,c.foot].some(id=>used.has(id)))throw Error('脚底骨链必须是互不重叠的 髋→膝→脚 直接父子关系。');for(const id of [c.hip,c.knee,c.foot])used.add(id);}}
export function validateFootContacts(r:Rig2D,c:Clip2D){if(c.footLock!==undefined&&typeof c.footLock!=='boolean')throw Error('脚底锁定开关无效。');if(c.contacts!==undefined){if(!Array.isArray(c.contacts)||c.contacts.length>128)throw Error('脚底接触片段过多。');const byChain=new Map<string,FootContact2D[]>();for(const v of c.contacts){if(!v||!r.footRig?.chains.some(chain=>chain.id===v.chainId)||!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.start<0||v.end>c.duration||v.start>=v.end||v.target!==undefined&&!point(v.target))throw Error('脚底接触区间或目标无效。');const previous=byChain.get(v.chainId)??[];if(previous.some(p=>v.start<p.end&&v.end>p.start))throw Error('同一只脚的支撑区间不能重叠。');previous.push(v);byChain.set(v.chainId,previous);}}}
const angle=(m:number[])=>Math.atan2(m[1],m[0])*180/Math.PI;
const wrap=(v:number)=>((v+180)%360+360)%360-180;
export function solePosition(r:Rig2D,chain:FootChain2D,pose:MotionPose2D):Point2D{return transform2D(worldBones2D(r,pose.rotations,pose.bones).get(chain.foot)!,chain.sole);}
export function solveFootTarget(r:Rig2D,chain:FootChain2D,input:MotionPose2D,target:Point2D,footAngle?:number):EvaluatedMotion2D {
 const pose:EvaluatedMotion2D={...input,rotations:{...input.rotations}},hip=r.bones.find(b=>b.id===chain.hip)!,knee=r.bones.find(b=>b.id===chain.knee)!,foot=r.bones.find(b=>b.id===chain.foot)!,heading=footAngle??angle(worldBones2D(r,input.rotations,input.bones).get(chain.foot)!);
 const set=(id:string,value:number)=>{const limits=r.bones.find(b=>b.id===id)?.limits;value=wrap(value);pose.rotations[id]=limits?Math.max(limits.min,Math.min(limits.max,value)):value;};
 const orientFoot=()=>{for(let i=0;i<3;i++){const world=worldBones2D(r,pose.rotations,pose.bones),difference=wrap(heading-angle(world.get(chain.foot)!));if(Math.abs(difference)<1e-5)break;set(chain.foot,(pose.rotations[chain.foot]??0)+difference);}};
 for(let iteration=0;iteration<8;iteration++){
  orientFoot();const world=worldBones2D(r,pose.rotations,pose.bones),fm=world.get(chain.foot)!,parent=hip.parent?world.get(hip.parent):undefined,ankle:Point2D=[target[0]-fm[0]*chain.sole[0]-fm[2]*chain.sole[1],target[1]-fm[1]*chain.sole[0]-fm[3]*chain.sole[1]],local=parent?transform2D(inverse2D(parent),ankle):ankle,h=pose.bones[hip.id]??{},k=pose.bones[knee.id]??{},f=pose.bones[foot.id]??{},origin:Point2D=[hip.origin[0]+(h.x??0),hip.origin[1]+(h.y??0)],kv:Point2D=[(knee.origin[0]+(k.x??0))*(h.scaleX??1),(knee.origin[1]+(k.y??0))*(h.scaleY??1)],fv:Point2D=[(foot.origin[0]+(f.x??0))*(k.scaleX??1)*(h.scaleX??1),(foot.origin[1]+(f.y??0))*(k.scaleY??1)*(h.scaleY??1)],l1=Math.hypot(...kv),l2=Math.hypot(...fv);
  if(l1<1e-5||l2<1e-5)break;const solution=solveArm2D(origin,local,l1,l2,chain.bend);set(hip.id,solution.upper-Math.atan2(kv[1],kv[0])*180/Math.PI-hip.rotation);set(knee.id,solution.lower+Math.atan2(kv[1],kv[0])*180/Math.PI-Math.atan2(fv[1],fv[0])*180/Math.PI-knee.rotation);orientFoot();if(Math.hypot(...solePosition(r,chain,pose).map((v,i)=>v-target[i]))<.02)break;
 }
 // Refine for scaled parents and joint limits without stretching either segment.
 for(let iteration=0;iteration<32;iteration++){let actual=solePosition(r,chain,pose);if(Math.hypot(actual[0]-target[0],actual[1]-target[1])<.05)break;for(const id of [chain.knee,chain.hip]){const world=worldBones2D(r,pose.rotations,pose.bones),m=world.get(id)!,a=[actual[0]-m[4],actual[1]-m[5]],b=[target[0]-m[4],target[1]-m[5]],delta=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1])*180/Math.PI;set(id,(pose.rotations[id]??0)+Math.max(-20,Math.min(20,delta)));orientFoot();actual=solePosition(r,chain,pose);}}
 const actual=solePosition(r,chain,pose);pose.footLocks=[{chainId:chain.id,target,actual,error:Math.hypot(actual[0]-target[0],actual[1]-target[1])}];return pose;
}
export function evaluateMotion2D(r:Rig2D,c:Clip2D,time:number,extra?:MotionPose2D):EvaluatedMotion2D {
 let pose:EvaluatedMotion2D=sampleMotion2D(c,time);if(extra){pose={...pose,rotations:{...pose.rotations,...extra.rotations},bones:{...pose.bones},parts:{...pose.parts,...extra.parts},deforms:{...pose.deforms,...extra.deforms}};for(const [id,t]of Object.entries(extra.bones))pose.bones[id]={...pose.bones[id],...t};}
 if(c.footLock===false||!r.footRig||!c.contacts?.length)return pose;const t=Math.max(0,Math.min(c.duration,time)),diagnostics:FootLockDiagnostic[]=[];
 for(const contact of c.contacts.filter(v=>t>=v.start&&(t<v.end||t===c.duration&&v.end===c.duration))){const chain=r.footRig.chains.find(v=>v.id===contact.chainId);if(!chain)continue;const start=sampleMotion2D(c,contact.start),anchor=solePosition(r,chain,start),target:Point2D=contact.target??[anchor[0],r.footRig.groundY],heading=angle(worldBones2D(r,start.rotations,start.bones).get(chain.foot)!);pose=solveFootTarget(r,chain,pose,target,heading);diagnostics.push(...pose.footLocks??[]);}
 return {...pose,footLocks:diagnostics};
}
export function walkContacts(r:Rig2D,duration:number,cycles:number):FootContact2D[]{if(!r.footRig)return [];return r.footRig.chains.flatMap((chain,index)=>Array.from({length:cycles},(_,i)=>{const start=(i+(index%2?.5:0))/cycles*duration,end=Math.min(duration,start+duration/cycles*.5);return {chainId:chain.id,start,end};}));}
