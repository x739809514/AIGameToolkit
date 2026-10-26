import {walkContacts} from './cutout-foot-lock';
import {validateRig2D,type Bone2D,type BoneRole2D,type Clip2D,type Rig2D} from './skeletal2d';
export const motionTemplates=['custom','idle','walk','wave'] as const;
export type MotionTemplate=typeof motionTemplates[number];
export const boneRoleLabels:Record<BoneRole2D,string>={root:'根节点',torso:'躯干',head:'头部',leftUpperArm:'左上臂 / 肩',leftForearm:'左前臂 / 肘',rightUpperArm:'右上臂 / 肩',rightForearm:'右前臂 / 肘',leftThigh:'左大腿 / 髋',leftShin:'左小腿 / 膝',rightThigh:'右大腿 / 髋',rightShin:'右小腿 / 膝',leftFoot:'左脚',rightFoot:'右脚',accessory:'配件',other:'其他'};
export function inferBoneRole(b:Bone2D):BoneRole2D {
 if(b.role)return b.role;if(!b.parent)return 'root';const name=(b.name??b.id).toLowerCase(),left=/left|左/.test(name),side=left?'left':'right';
 if(/forearm|lower.*arm|elbow|前臂|肘/.test(name))return side==='left'?'leftForearm':'rightForearm';
 if(/arm|shoulder|上臂|手臂|肩/.test(name))return side==='left'?'leftUpperArm':'rightUpperArm';
 if(/shin|calf|knee|lower.*leg|小腿|膝/.test(name))return side==='left'?'leftShin':'rightShin';
 if(/thigh|hip|leg|大腿|髋|腿/.test(name))return side==='left'?'leftThigh':'rightThigh';
 if(/foot|ankle|脚|踝/.test(name))return side==='left'?'leftFoot':'rightFoot';
 if(/head|neck|头|颈/.test(name))return 'head';if(/torso|body|chest|躯干|身体|胸/.test(name))return 'torso';return 'other';
}
export interface TemplateParameters {amplitude:number;cycles:number;bounce:number;lean:number}
export function templateClip(rig:Rig2D,type:Exclude<MotionTemplate,'custom'>,duration:number,loop:boolean,parameters:Partial<TemplateParameters>={},id='template-preview'):Clip2D {
 const p={amplitude:1,cycles:type==='wave'?2:1,bounce:type==='walk'?.018:.006,lean:0,...parameters};
 if(!Number.isFinite(duration)||duration<.5||duration>15||![p.amplitude,p.cycles,p.bounce,p.lean].every(Number.isFinite)||p.amplitude<.1||p.amplitude>2||!Number.isInteger(p.cycles)||p.cycles<1||p.cycles>8||p.bounce<0||p.bounce>.08||Math.abs(p.lean)>20)throw Error('动作模板参数无效。');
 const root=rig.bones.find(b=>!b.parent)!,frames=Math.max(17,p.cycles*12+1),height=rig.canvas[1];
 const keys=Array.from({length:frames},(_,i)=>{const t=i/(frames-1),phase=t*Math.PI*2*p.cycles,swing=Math.sin(phase),opposite=-swing,envelope=loop?1:Math.sin(Math.PI*t),rotations:Record<string,number>={};
 for(const bone of rig.bones){const role=inferBoneRole(bone);let angle=0;
 if(type==='idle'){if(role==='torso')angle=swing*1.5;if(role==='head')angle=-swing*2;if(role.endsWith('UpperArm'))angle=swing*2;}
 if(type==='walk'){if(role==='leftThigh')angle=swing*26;if(role==='rightThigh')angle=opposite*26;if(role==='leftShin')angle=Math.max(0,-swing)*36;if(role==='rightShin')angle=Math.max(0,swing)*36;if(role==='leftFoot')angle=-swing*10;if(role==='rightFoot')angle=swing*10;if(role==='leftUpperArm')angle=opposite*20;if(role==='rightUpperArm')angle=swing*20;if(role==='head')angle=-Math.sin(phase*2)*2;}
 if(type==='wave'){if(role==='rightUpperArm')angle=(-55+8*swing)*envelope;if(role==='rightForearm')angle=(-35+25*swing)*envelope;if(role==='head')angle=4*envelope;}
 if(role==='torso'||bone.id===root.id&&!rig.bones.some(b=>inferBoneRole(b)==='torso'))angle+=p.lean*envelope;angle*=p.amplitude;if(bone.limits)angle=Math.max(bone.limits.min,Math.min(bone.limits.max,angle));rotations[bone.id]=angle;}
 const bounce=-(1-Math.cos(phase*(type==='walk'?2:1)))/2*p.bounce*height*envelope;
 return {time:duration*t,rotations,bones:{[root.id]:{x:0,y:bounce,scaleX:1,scaleY:1}}};});
 if(loop)keys[keys.length-1]={...structuredClone(keys[0]),time:duration};
 const clip:Clip2D={id,name:{idle:'待机呼吸',walk:'原地行走',wave:'挥手'}[type],template:type,duration,loop,interpolation:'cubic',...(type==='walk'&&rig.footRig?.chains.length?{footLock:true,contacts:walkContacts(rig,duration,p.cycles)}:{}),notes:type==='walk'?(rig.footRig?.chains.length?'原地行走模板；已为配置的腿部生成交替支撑区间。':'原地行走模板；配置脚底骨链后可自动生成支撑区间。'):'根据骨骼用途适配的动作模板，可逐帧调整。',keys};const roles=rig.bones.map(inferBoneRole);if(type==='walk'&&!roles.some(r=>r==='leftThigh'||r==='rightThigh'))clip.notes+=' 未识别到髋部用途；请在装配阶段标记左右大腿。';if(type==='wave'&&!roles.some(r=>r==='rightUpperArm'||r==='rightForearm'))clip.notes+=' 未识别到右肩或右肘用途；请在装配阶段标记。';validateRig2D({...rig,clips:[clip]});return clip;
}
