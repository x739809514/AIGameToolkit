import {evaluateMotion2D} from './cutout-foot-lock';
import {skinMatrices,skinVertices} from './cutout-skinning';
import {partTransforms2D,worldBones2D,multiply2D,transform2D,type Rig2D,type Clip2D,type MotionPose2D,type Part2D,type PartState2D,type Matrix2D,type Point2D} from './skeletal2d';

export type MotionRect=[number,number,number,number];
export type PartBounds=Record<string,MotionRect>;
const rest:MotionPose2D={rotations:{},bones:{},parts:{}};

/** Extra part transforms are applied in source coordinates, before skinning. */
export function partMotionAdjustment(part:Part2D,pivot:Matrix2D,state:PartState2D):Matrix2D {
 const px=pivot[4]-(part.offset?.[0]??0),py=pivot[5]-(part.offset?.[1]??0),angle=(state.rotation??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),sx=state.scaleX??1,sy=state.scaleY??1;
 return [c*sx,s*sx,-s*sy,c*sy,(state.x??0)+px-c*sx*px+s*sy*py,(state.y??0)+py-s*sx*px-c*sy*py];
}

export function motionGeometry(rig:Rig2D,pose:MotionPose2D=rest,bounds:PartBounds={},skinning=true){
 const transforms=partTransforms2D(rig,pose.rotations,pose.bones),bind=worldBones2D(rig),skin=skinning&&rig.parts.some(p=>p.mesh)?skinMatrices(rig,pose):undefined;
 return rig.parts.map(p=>{
  const state=pose.parts[p.id]??{},adjust=partMotionAdjustment(p,bind.get(p.bone)!,state),r=state.variant?p.crop:bounds[p.id]??p.crop;
  const corners:Point2D[]=[[r[0],r[1]],[r[0]+r[2],r[1]],[r[0]+r[2],r[1]+r[3]],[r[0],r[1]+r[3]]];
  const matrix=multiply2D(transforms.get(p.id)!,adjust);
  return {id:p.id,points:skin&&p.mesh?skinVertices(p,skin,adjust,pose.deforms):corners.map(q=>transform2D(matrix,q)),visible:state.visible??p.visible??true,opacity:state.opacity??1,z:state.z??p.z,variant:state.variant??''};
 });
}

export function motionSampleTimes(clip:Clip2D):number[]{
 const count=Math.min(240,Math.max(96,Math.ceil(clip.duration*30))),times=new Set(Array.from({length:count+1},(_,i)=>clip.duration*i/count)),stride=Math.max(1,Math.ceil(clip.keys.length/240));
 for(let i=0;i<clip.keys.length;i+=stride)times.add(clip.keys[i].time);
 for(const c of clip.contacts??[]){times.add(c.start);times.add(c.end);}
 return [...times].sort((a,b)=>a-b);
}

/** Compare evaluated, drawable geometry; a named clip or a zero-valued track is not animation. */
export function motionHasVisibleChange(rig:Rig2D,clip:Clip2D,bounds:PartBounds={}):boolean {
 const first=motionGeometry(rig,evaluateMotion2D(rig,clip,0),bounds);
 for(const t of motionSampleTimes(clip).slice(1)){
  const frame=motionGeometry(rig,evaluateMotion2D(rig,clip,t),bounds);
  if(frame.some((p,i)=>{const a=first[i],shown=p.visible&&p.opacity>.001,wasShown=a.visible&&a.opacity>.001;if(shown!==wasShown)return true;if(!shown)return false;return Math.abs(p.opacity-a.opacity)>.001||p.variant!==a.variant||p.z!==a.z||p.points.some((v,j)=>Math.hypot(v[0]-a.points[j][0],v[1]-a.points[j][1])>.01);}))return true;
 }
 return false;
}

/** One camera for the complete animation, so framing never cancels a breathing/translation motion. */
export function motionViewBounds(rig:Rig2D,clip?:Clip2D,bounds:PartBounds={},extra?:MotionPose2D,skinning=true):MotionRect {
 let left=0,top=0,right=rig.canvas[0],bottom=rig.canvas[1];
 const include=(pose:MotionPose2D)=>{for(const p of motionGeometry(rig,pose,bounds,skinning)){if(!p.visible||p.opacity<=0)continue;for(const [x,y]of p.points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}};
 include(rest);
 if(clip)for(const time of motionSampleTimes(clip))include(evaluateMotion2D(rig,clip,time,extra));else if(extra)include(extra);
 const pad=Math.max(8,Math.max(right-left,bottom-top)*.06);
 return [Math.floor(left-pad),Math.floor(top-pad),Math.ceil(right-left+pad*2),Math.ceil(bottom-top+pad*2)];
}
