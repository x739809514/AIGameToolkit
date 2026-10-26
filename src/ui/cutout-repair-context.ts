import {extendRepairMesh} from '../shared/cutout-repair-mesh';
import {applyCutoutRepair,cutoutRepairContextSource,type CutoutRepairInput,type CutoutRepairTask} from '../shared/cutout-repair';
import type {CutoutDocument} from '../shared/cutout-studio';
import {worldBones2D,type MotionPose2D} from '../shared/skeletal2d';
import {motionGeometry,type MotionRect} from '../shared/cutout-motion-geometry';
import {evaluateMotion2D} from '../shared/cutout-foot-lock';
import {cutoutMotionBounds,applyMotionView,motionCanvasSize} from './cutout-motion-view';
import {prepareCutoutRepair,cutoutDigest,cutoutAlphaBounds,renderCutout,loadCutoutImage} from './cutout-render';
export const repairRest:MotionPose2D={rotations:{},bones:{},parts:{}};
function union(rects:MotionRect[]):MotionRect {const x=Math.min(...rects.map(r=>r[0])),y=Math.min(...rects.map(r=>r[1]));return [x,y,Math.max(...rects.map(r=>r[0]+r[2]))-x,Math.max(...rects.map(r=>r[1]+r[3]))-y];}
export function repairRender(d:CutoutDocument,images:Map<string,HTMLImageElement>,view:MotionRect,pose=repairRest,max=768){const cv=document.createElement('canvas');[cv.width,cv.height]=motionCanvasSize(view,max);applyMotionView(cv.getContext('2d')!,view);renderCutout(cv.getContext('2d')!,d,images,pose.rotations,{motion:pose});return cv;}
export async function prepareContextRepairInput(d:CutoutDocument,id:string,images:Map<string,HTMLImageElement>,prompt:string):Promise<CutoutRepairInput>{
 const input=await prepareCutoutRepair(d,id,images),p=d.rig.parts.find(p=>p.id===id)!,layer=d.artwork.find(a=>a.partId===id)!,offset=p.offset??[0,0],rect=cutoutAlphaBounds(layer,p,images.get(id)!,d.rig.canvas),world=worldBones2D(d.rig),joint=world.get(p.mesh?.weights.flat().find(w=>d.rig.bones.some(b=>b.id===w.bone&&b.parent))?.bone??p.bone)!;
 if(p.mesh)extendRepairMesh(p.mesh,input.frame);
 const points=motionGeometry({...d.rig,parts:[p]},repairRest,{[id]:rect})[0].points,target=union(points.map(([x,y])=>[x,y,1,1])),view=union([cutoutMotionBounds(d,images),[joint[4]-20,joint[5]-20,40,40],target]);
 const assembly=repairRender(d,images,view),marked=repairRender(d,images,view),c=marked.getContext('2d')!,scale=applyMotionView(c,view);
 c.strokeStyle='#ffdf57';c.lineWidth=3/scale;c.strokeRect(...target);c.fillStyle='#ffdf57';c.beginPath();c.arc(joint[4],joint[5],6/scale,0,Math.PI*2);c.fill();c.font=`${14/scale}px sans-serif`;c.fillText(layer.name,target[0],target[1]-8/scale);
 const pad=Math.max(target[2],target[3])*.45+24,detailView:MotionRect=[target[0]-pad,target[1]-pad,target[2]+pad*2,target[3]+pad*2];
 return {partId:id,requestId:crypto.randomUUID(),prompt,signature:await cutoutDigest(new TextEncoder().encode(cutoutRepairContextSource(d,id))),source:input.source,frame:input.frame,context:{assembly:assembly.toDataURL('image/png'),marked:marked.toDataURL('image/png'),detail:repairRender(d,images,detailView).toDataURL('image/png')}};
}
export function repairPoses(d:CutoutDocument,id:string){
 const p=d.rig.parts.find(p=>p.id===id)!,bone=d.rig.bones.find(b=>b.id===(p.mesh?.weights.flat().find(w=>d.rig.bones.some(b=>b.id===w.bone&&b.parent))?.bone??p.bone))!;
 const poses:{name:string;pose:MotionPose2D}[]=[{name:'静止装配',pose:repairRest}];
 for(const angle of [-20,20]){const value=Math.max(bone.limits?.min??-180,Math.min(bone.limits?.max??180,angle));poses.push({name:(bone.name??bone.id)+' '+value+'°',pose:{rotations:{[bone.id]:value},bones:{},parts:{}}});}
 const clip=d.rig.clips.find(c=>c.id===d.motion?.selectedClipId);if(clip)for(const t of [.25,.75])poses.push({name:`已有动作 ${(clip.duration*t).toFixed(2)}s`,pose:evaluateMotion2D(d.rig,clip,clip.duration*t)});
 return poses;
}
export async function repairComparison(d:CutoutDocument,taskId:string,repair:CutoutRepairTask,bitmap:string,images:Map<string,HTMLImageElement>){
 const after=applyCutoutRepair(d,taskId,repair,bitmap),nextImages=new Map(images);nextImages.set(repair.partId,await loadCutoutImage(bitmap));const poses=repairPoses(d,repair.partId);
 const view=union(poses.flatMap(({pose})=>[cutoutMotionBounds(d,images,undefined,pose),cutoutMotionBounds(after,nextImages,undefined,pose)]));
 const sheet=(rows:typeof poses)=>{const cv=document.createElement('canvas');cv.width=768;cv.height=rows.length*280;const c=cv.getContext('2d')!;c.fillStyle='#243141';c.fillRect(0,0,cv.width,cv.height);rows.forEach(({name,pose},i)=>{for(const [j,doc,map] of [[0,d,images],[1,after,nextImages]] as const){const frame=repairRender(doc,map,view,pose,250),x=j*384;c.drawImage(frame,x+(384-frame.width)/2,i*280+25+(250-frame.height)/2);c.fillStyle='white';c.font='12px sans-serif';c.fillText((j?'补画后 · ':'补画前 · ')+name,x+8,i*280+17);}});return cv.toDataURL('image/png');};
 return {after,images:nextImages,view,poses,evidence:{signature:repair.signature,assetId:'',images:[sheet(poses.slice(0,1)),sheet(poses)],poses:poses.map(p=>p.name)}};
}
