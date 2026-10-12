export const poseBones=[
 {id:'pelvis',name:'骨盆',parent:null,color:'#83d4cd'},
 {id:'chest',name:'胸部',parent:'pelvis',color:'#83d4cd'},
 {id:'neck',name:'颈部',parent:'chest',color:'#bba2ea'},
 {id:'head',name:'头部',parent:'neck',color:'#bba2ea'},
 {id:'left_shoulder',name:'左肩',parent:'chest',color:'#81cdab'},
 {id:'left_elbow',name:'左肘',parent:'left_shoulder',color:'#81cdab'},
 {id:'left_wrist',name:'左腕',parent:'left_elbow',color:'#81cdab'},
 {id:'right_shoulder',name:'右肩',parent:'chest',color:'#e5d96d'},
 {id:'right_elbow',name:'右肘',parent:'right_shoulder',color:'#e5d96d'},
 {id:'right_wrist',name:'右腕',parent:'right_elbow',color:'#e5d96d'},
 {id:'left_hip',name:'左髋',parent:'pelvis',color:'#f29e80'},
 {id:'left_knee',name:'左膝',parent:'left_hip',color:'#f29e80'},
 {id:'left_ankle',name:'左踝',parent:'left_knee',color:'#f29e80'},
 {id:'left_toe',name:'左脚尖',parent:'left_ankle',color:'#f29e80'},
 {id:'right_hip',name:'右髋',parent:'pelvis',color:'#b8d880'},
 {id:'right_knee',name:'右膝',parent:'right_hip',color:'#b8d880'},
 {id:'right_ankle',name:'右踝',parent:'right_knee',color:'#b8d880'},
 {id:'right_toe',name:'右脚尖',parent:'right_ankle',color:'#b8d880'}
] as const;
export type PoseJointID=typeof poseBones[number]['id'];
export interface PoseJoint {id:PoseJointID;x:number|null;y:number|null;confidence:number;visible:boolean}
export interface PoseAnalysis {assetId:string;requestId:string;status:'analyzing'|'succeeded'|'failed';model:string;createdAt:number;joints:PoseJoint[];originalJoints?:PoseJoint[];editedAt?:number;notes?:string;error?:string}
export interface PoseWorkspace {sourceAssetId?:string;analysis?:PoseAnalysis}
export interface SavedPose {id:string;name:string;assetId:string;width:number;height:number;joints:PoseJoint[];createdAt:number}
export interface MotionFrame {time:number;joints:PoseJoint[];originalJoints?:PoseJoint[];edited?:boolean;sourceTime?:number}
export interface MotionClip {id:string;name:string;width:number;height:number;fps:number;frames:MotionFrame[];createdAt:number;saved:boolean;tags:string[];sourceVideoId?:string;sourceStart?:number;targetAssetId?:string;engine:string;previewAssetId?:string}
export interface MotionExtraction {id:string;videoId:string;start:number;end:number;fps:number;total:number;frames:MotionFrame[];status:'extracting'|'failed'|'cancelled'|'succeeded';error?:string}
export interface MotionWorkspace {poses:SavedPose[];clips:MotionClip[];selectedClipId?:string;extraction?:MotionExtraction}
export interface MotionExtractInput {videoId:string;start:number;end:number;fps:number}
export interface MotionPart {clipId:string;speed:number;repeat:number;mirror:boolean}
export const emptyJoints=():PoseJoint[]=>poseBones.map(b=>({id:b.id,x:null,y:null,visible:false,confidence:0}));
export function validateJoints(input:unknown):PoseJoint[]{
 if(!Array.isArray(input)||input.length!==poseBones.length)throw new Error('关节数量不正确。');const seen=new Set<string>();
 for(const j of input){if(!j||!poseBones.some(b=>b.id===j.id)||seen.has(j.id)||typeof j.visible!=='boolean'||typeof j.confidence!=='number'||!Number.isFinite(j.confidence)||j.confidence<0||j.confidence>1)throw new Error('关节数据不合法。');seen.add(j.id);if(j.x===null||j.y===null){if(j.x!==null||j.y!==null||j.visible)throw new Error('缺失关节坐标不合法。');}else if(typeof j.x!=='number'||typeof j.y!=='number'||!Number.isFinite(j.x)||!Number.isFinite(j.y)||j.x<0||j.x>1||j.y<0||j.y>1)throw new Error('关节坐标须在图片范围内。');}
 return poseBones.map(b=>{const j=input.find(j=>j.id===b.id);return {id:b.id,x:j.x,y:j.y,confidence:j.confidence,visible:j.visible};});
}
export function interpolateJoints(a:PoseJoint[],b:PoseJoint[],weight:number):PoseJoint[]{return poseBones.map(bone=>{const x=a.find(j=>j.id===bone.id)!,y=b.find(j=>j.id===bone.id)!;if(x.x===null||x.y===null||y.x===null||y.y===null)return {id:bone.id,x:null,y:null,confidence:0,visible:false};return {id:bone.id,x:x.x+(y.x-x.x)*weight,y:x.y+(y.y-x.y)*weight,confidence:Math.min(x.confidence,y.confidence),visible:x.visible&&y.visible};});}
export function sampleMotion(clip:MotionClip,time:number){const frames=clip.frames;if(!frames.length)return emptyJoints();if(time<=frames[0].time)return structuredClone(frames[0].joints);if(time>=frames.at(-1)!.time)return structuredClone(frames.at(-1)!.joints);let i=1;while(frames[i].time<time)i++;return interpolateJoints(frames[i-1].joints,frames[i].joints,(time-frames[i-1].time)/(frames[i].time-frames[i-1].time));}
export const motionDuration=(clip:MotionClip)=>(clip.frames.at(-1)?.time||0)+1/clip.fps;
export function mirrorJoints(joints:PoseJoint[]):PoseJoint[]{return poseBones.map(b=>{const other=b.id.startsWith('left_')?b.id.replace('left_','right_'):b.id.startsWith('right_')?b.id.replace('right_','left_'):b.id;const j=joints.find(j=>j.id===other)!;return {...j,id:b.id,x:j.x===null?null:1-j.x};});}
export function cleanMotion(frames:MotionFrame[],fps:number,fillGap:number,smoothWindow:number):MotionFrame[]{
 const result=structuredClone(frames);for(const bone of poseBones){let previous=-1;for(let i=0;i<result.length;i++){const j=result[i].joints.find(j=>j.id===bone.id)!;if(j.x===null)continue;if(previous>=0&&i>previous+1&&frames[i].time-frames[previous].time<=fillGap){const from=result[previous].joints.find(j=>j.id===bone.id)!;for(let k=previous+1;k<i;k++){const weight=(frames[k].time-frames[previous].time)/(frames[i].time-frames[previous].time);Object.assign(result[k].joints.find(j=>j.id===bone.id)!,{x:from.x!+(j.x!-from.x!)*weight,y:from.y!+(j.y!-from.y!)*weight,confidence:Math.min(from.confidence,j.confidence)*.8,visible:false});result[k].edited=true;}}previous=i;}}
 if(smoothWindow>1){const input=structuredClone(result),radius=Math.floor(smoothWindow/2);for(let i=0;i<result.length;i++)for(const joint of result[i].joints){if(joint.x===null)continue;const nearby=input.slice(Math.max(0,i-radius),Math.min(input.length,i+radius+1)).map(f=>f.joints.find(j=>j.id===joint.id)!).filter(j=>j.x!==null);if(nearby.length>1){joint.x=nearby.reduce((n,j)=>n+j.x!,0)/nearby.length;joint.y=nearby.reduce((n,j)=>n+j.y!,0)/nearby.length;result[i].edited=true;}}}return result;
}
export function retargetJoints(joints:PoseJoint[],origin:PoseJoint[],target:PoseJoint[],sourceSize:{width:number;height:number},targetSize:{width:number;height:number}):PoseJoint[]{
 const root=joints.find(j=>j.id==='pelvis')!,base=origin.find(j=>j.id==='pelvis')!,dest=target.find(j=>j.id==='pelvis')!,sChest=origin.find(j=>j.id==='chest')!,tChest=target.find(j=>j.id==='chest')!;
 if([root,base,dest,sChest,tChest].some(j=>j.x===null||j.y===null))throw new Error('动作与目标姿态需包含骨盆和胸部关节。');
 const length=(a:PoseJoint,b:PoseJoint,size:{width:number;height:number})=>Math.hypot((a.x!-b.x!)*size.width,(a.y!-b.y!)*size.height);const scale=length(dest,tChest,targetSize)/Math.max(1,length(base,sChest,sourceSize)),out=emptyJoints(),map=new Map(out.map(j=>[j.id,j]));
 const set=(joint:PoseJoint,x:number,y:number,confidence:number,visible:boolean)=>{if(x>=0&&x<=1&&y>=0&&y<=1)Object.assign(joint,{x,y,confidence,visible});};set(map.get('pelvis')!,dest.x!+(root.x!-base.x!)*sourceSize.width*scale/targetSize.width,dest.y!+(root.y!-base.y!)*sourceSize.height*scale/targetSize.height,root.confidence,root.visible);
 for(const bone of poseBones){if(!bone.parent)continue;const j=joints.find(j=>j.id===bone.id)!,p=joints.find(j=>j.id===bone.parent)!,t=target.find(j=>j.id===bone.id)!,tp=target.find(j=>j.id===bone.parent)!,parent=map.get(bone.parent)!;if([j,p,t,tp,parent].some(j=>j.x===null||j.y===null))continue;const dx=(j.x!-p.x!)*sourceSize.width,dy=(j.y!-p.y!)*sourceSize.height,d=Math.hypot(dx,dy);if(d<.001)continue;const l=length(t,tp,targetSize);set(map.get(bone.id)!,parent.x!+dx/d*l/targetSize.width,parent.y!+dy/d*l/targetSize.height,Math.min(j.confidence,t.confidence),j.visible&&t.visible);}return out;
}
