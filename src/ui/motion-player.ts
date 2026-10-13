import * as THREE from 'three';
import {type BaseHumanoid} from './base-humanoid';
import {HumanoidRetarget,canonicalBoneName} from './humanoid-retarget';
import {defaultMotionBlend,normalizeMotionBlend,motionBlendWeights,motionBlendSampleTime,type MotionBlendTree} from '../shared/motion-blend';
import type {HumanoidName} from '../shared/humanoid';
import {createInPlaceClip} from './root-motion';
import {motionTimelineDuration,motionTimelineLayout,motionTimelineSamples,normalizeMotionTimeline,type MotionTimelineItem} from '../shared/motion-timeline';
interface BonePose {position:THREE.Vector3;quaternion:THREE.Quaternion;scale:THREE.Vector3}
export interface MotionSource {id:string;group:THREE.Group;mixer:THREE.AnimationMixer;retarget:HumanoidRetarget;inPlace:Map<number,THREE.AnimationClip>;active?:THREE.AnimationClip;action?:THREE.AnimationAction}
export class MotionPlayer {
  blendTree:MotionBlendTree=defaultMotionBlend();boneParts:(HumanoidName|undefined)[]=[];
  sources=new Map<string,MotionSource>();bones:THREE.Bone[]=[];rest:BonePose[];hipIndex:number;selected?:string;clipIndex=0;timelineItems:MotionTimelineItem[]=[];timelineEnabled=false;ignoreTranslation=false;offsets?:THREE.Vector3[];
  constructor(public avatar:BaseHumanoid){avatar.group.traverse(node=>{if((node as THREE.Bone).isBone)this.bones.push(node as THREE.Bone);});this.rest=this.snapshot();this.hipIndex=this.bones.indexOf(avatar.bones.Hips);this.boneParts=this.bones.map(bone=>{let node:THREE.Object3D|null=bone;while(node){const name=canonicalBoneName(node.name);if(name)return name;node=node.parent;}return undefined;});}
  snapshot():BonePose[]{return this.bones.map(bone=>({position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));}
  apply(pose:BonePose[]){pose.forEach((value,i)=>{this.bones[i].position.copy(value.position);this.bones[i].quaternion.copy(value.quaternion);this.bones[i].scale.copy(value.scale);});this.avatar.group.updateMatrixWorld(true);this.avatar.mesh.skeleton.update();}
  register(id:string,group:THREE.Group){if(this.sources.has(id))return this.sources.get(id)!;const previous=this.snapshot();this.apply(this.rest);try{const source:MotionSource={id,group,mixer:new THREE.AnimationMixer(group),retarget:new HumanoidRetarget(group,this.avatar),inPlace:new Map()};this.sources.set(id,source);this.offsets=undefined;return source;}finally{this.apply(previous);}}
  get duration(){return this.blendTree.enabled?this.blendTree.cycle:this.timelineEnabled?motionTimelineDuration(this.timelineItems):this.sources.get(this.selected||'')?.group.animations[this.clipIndex]?.duration||0;}
  setBlendTree(tree:MotionBlendTree){const next=normalizeMotionBlend(tree);for(const node of next.nodes){const clip=this.sources.get(node.assetId)?.group.animations[node.clipIndex];if(!clip||clip.duration<=0||Math.abs(clip.duration-node.sourceDuration)>.01)throw new Error(`混合动作“${node.label}”未加载或动画时长发生变化。`);}this.blendTree=next;}
  select(id:string,index:number){this.selected=id;this.clipIndex=index;}
  setTimeline(items:MotionTimelineItem[],enabled:boolean){const next=normalizeMotionTimeline(items);for(const item of next){const clip=this.sources.get(item.assetId)?.group.animations[item.clipIndex];if(!clip||clip.duration<=0||item.out>clip.duration+.00001)throw new Error(`时间轴中的“${item.label}”未加载或超出原动画范围。`);}this.timelineItems=next;this.timelineEnabled=enabled&&next.length>0;this.offsets=undefined;}
  setIgnoreTranslation(value:boolean){if(this.ignoreTranslation!==value){this.ignoreTranslation=value;this.offsets=undefined;}}
  sample(id:string,index:number,time:number){
    const source=this.sources.get(id),original=source?.group.animations[index];if(!source||!original)throw new Error('动作片段尚未加载。');let clip=original;
    if(this.ignoreTranslation){let stationary=source.inPlace.get(index);if(!stationary){stationary=createInPlaceClip(source.group,original);source.inPlace.set(index,stationary);}clip=stationary;}
    if(source.active!==clip){source.mixer.stopAllAction();source.active=clip;source.action=source.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1).play();source.action.clampWhenFinished=true;}
    source.action!.enabled=true;source.action!.paused=false;source.mixer.setTime(Math.max(0,Math.min(time,clip.duration)));this.apply(this.rest);source.retarget.update();return this.snapshot();
  }
  rootOffsets(){if(this.offsets)return this.offsets;const spans=motionTimelineLayout(this.timelineItems),offsets:THREE.Vector3[]=[];
    for(let i=0;i<spans.length;i++){if(i===0){offsets.push(new THREE.Vector3());continue;}const current=spans[i],previous=spans[i-1],outTime=Math.min(previous.item.out,previous.item.in+(current.start-previous.start)*previous.item.rate);const outgoing=this.sample(previous.item.assetId,previous.item.clipIndex,outTime)[this.hipIndex].position.add(offsets[i-1]),incoming=this.sample(current.item.assetId,current.item.clipIndex,current.item.in)[this.hipIndex].position;offsets.push(outgoing.sub(incoming));}
    this.offsets=offsets;return offsets;
  }
  evaluate(time:number){
    if(this.blendTree.enabled){this.evaluateBlend(time);return;}
    if(!this.timelineEnabled){if(this.selected&&this.sources.get(this.selected)?.group.animations[this.clipIndex])this.apply(this.sample(this.selected,this.clipIndex,time));else this.apply(this.rest);return;}
    const offsets=this.rootOffsets(),samples=motionTimelineSamples(this.timelineItems,time),layout=motionTimelineLayout(this.timelineItems);let pose:BonePose[]|undefined;
    const anchor=this.ignoreTranslation&&layout[0]?this.sample(layout[0].item.assetId,layout[0].item.clipIndex,layout[0].item.in)[this.hipIndex].position:undefined;
    for(const sample of samples){const current=this.sample(sample.span.item.assetId,sample.span.item.clipIndex,sample.time),index=layout.findIndex(span=>span.item.id===sample.span.item.id);current[this.hipIndex].position.add(offsets[index]);if(anchor)current[this.hipIndex].position.copy(anchor);
      if(!pose)pose=current;else pose.forEach((bone,i)=>{bone.position.lerp(current[i].position,sample.weight);bone.quaternion.slerp(current[i].quaternion,sample.weight).normalize();bone.scale.lerp(current[i].scale,sample.weight);});
    }
    if(pose)this.apply(pose);
  }
  evaluateBlend(time:number){
    const tree=this.blendTree,samples=motionBlendWeights(tree).map(({node,weight})=>({node,weight,pose:this.sample(node.assetId,node.clipIndex,motionBlendSampleTime(tree,node,time))}));
    const pose=this.rest.map(p=>({position:p.position.clone(),quaternion:p.quaternion.clone(),scale:p.scale.clone()}));
    for(let i=0;i<pose.length;i++){
      const part=this.boneParts[i];if(!part)continue;const relevant=samples.filter(s=>s.node.mask.includes(part));let total=0;
      for(const sample of relevant){const incoming=sample.pose[i],weight=tree.mode==='layers'?sample.weight:sample.weight/(total+sample.weight);pose[i].position.lerp(incoming.position,weight);pose[i].quaternion.slerp(incoming.quaternion,weight).normalize();pose[i].scale.lerp(incoming.scale,weight);total+=sample.weight;}
    }
    this.apply(pose);
  }
  unregister(id:string){const source=this.sources.get(id);if(source){source.mixer.stopAllAction();source.mixer.uncacheRoot(source.group);this.sources.delete(id);}if(this.selected===id)this.selected=undefined;this.offsets=undefined;}
  close(){for(const source of this.sources.values()){source.mixer.stopAllAction();source.mixer.uncacheRoot(source.group);}this.sources.clear();}
}
