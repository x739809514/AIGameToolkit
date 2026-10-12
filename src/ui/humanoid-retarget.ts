import * as THREE from 'three';
import {humanoidNames,type HumanoidName,type BaseHumanoid} from './base-humanoid';
const aliases:Record<HumanoidName,string[]>={Hips:['hips','pelvis','hip'],Spine:['spine','spine01','lowerback'],Spine1:['spine1','spine02','chest'],Spine2:['spine2','spine03','upperchest'],Neck:['neck','neck01'],Head:['head'],LeftShoulder:['leftshoulder','claviclel','shoulderl'],LeftArm:['leftarm','leftupperarm','upperarml','arml'],LeftForeArm:['leftforearm','leftlowerarm','lowerarml','forearml'],LeftHand:['lefthand','handl','wristl'],RightShoulder:['rightshoulder','clavicler','shoulderr'],RightArm:['rightarm','rightupperarm','upperarmr','armr'],RightForeArm:['rightforearm','rightlowerarm','lowerarmr','forearmr'],RightHand:['righthand','handr','wristr'],LeftUpLeg:['leftupleg','leftthigh','thighl','upperlegl'],LeftLeg:['leftleg','leftcalf','calfl','lowerlegl','shinl'],LeftFoot:['leftfoot','footl','anklel'],LeftToeBase:['lefttoebase','lefttoe','balll','toel'],RightUpLeg:['rightupleg','rightthigh','thighr','upperlegr'],RightLeg:['rightleg','rightcalf','calfr','lowerlegr','shinr'],RightFoot:['rightfoot','footr','ankler'],RightToeBase:['righttoebase','righttoe','ballr','toer']};
export function canonicalBoneName(name:string):HumanoidName|undefined {
  const normalized=name.toLowerCase().replace(/^.*:/,'').replace(/^(mixamorig\d*|armature|bip0*\d*)/,'').replace(/[^a-z0-9]/g,'');
  return humanoidNames.find(key=>aliases[key].includes(normalized));
}
export function mapHumanoidBones(source:THREE.Object3D){
  const candidates=new Set<THREE.Bone>();source.traverse(node=>{const mesh=node as THREE.SkinnedMesh;if(mesh.isSkinnedMesh)mesh.skeleton.bones.forEach(b=>candidates.add(b));});
  if(!candidates.size)source.traverse(node=>{if((node as THREE.Bone).isBone)candidates.add(node as THREE.Bone);});
  const mapping=new Map<HumanoidName,THREE.Bone>();for(const bone of candidates){let control=bone;while((control.parent as THREE.Bone|undefined)?.isBone&&control.parent!.name===control.name)control=control.parent as THREE.Bone;const key=canonicalBoneName(control.name);if(key&&!mapping.has(key))mapping.set(key,control);}
  return mapping;
}
export class HumanoidRetarget {
  mapping:Map<HumanoidName,THREE.Bone>;missing:HumanoidName[];scale:number;
  sourceRest=new Map<HumanoidName,THREE.Quaternion>();targetRest=new Map<HumanoidName,THREE.Quaternion>();sourceHip=new THREE.Vector3();targetHip=new THREE.Vector3();
  constructor(public source:THREE.Group,public target:BaseHumanoid){
    source.updateMatrixWorld(true);target.group.updateMatrixWorld(true);this.mapping=mapHumanoidBones(source);this.missing=humanoidNames.filter(name=>!this.mapping.has(name));
    const required:HumanoidName[]=['Hips','LeftArm','LeftForeArm','RightArm','RightForeArm','LeftUpLeg','LeftLeg','RightUpLeg','RightLeg'];
    const missingRequired=required.filter(name=>!this.mapping.has(name));if(missingRequired.length)throw new Error('无法将 FBX 应用到基础人形：未匹配 '+missingRequired.join('、')+'。请使用含完整人形骨骼的 Mixamo／标准人形 FBX。');
    for(const [name,bone] of this.mapping){this.sourceRest.set(name,bone.getWorldQuaternion(new THREE.Quaternion()).invert());this.targetRest.set(name,target.bones[name].getWorldQuaternion(new THREE.Quaternion()));}
    this.mapping.get('Hips')!.getWorldPosition(this.sourceHip);target.bones.Hips.getWorldPosition(this.targetHip);
    let sourceLength=0,targetLength=0;
    for(const [from,to] of [['LeftUpLeg','LeftLeg'],['LeftLeg','LeftFoot'],['RightUpLeg','RightLeg'],['RightLeg','RightFoot']] as [HumanoidName,HumanoidName][]){const a=this.mapping.get(from),b=this.mapping.get(to);if(a&&b){sourceLength+=a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));targetLength+=target.bones[from].getWorldPosition(new THREE.Vector3()).distanceTo(target.bones[to].getWorldPosition(new THREE.Vector3()));}}
    this.scale=sourceLength>1e-6?targetLength/sourceLength:1;if(!Number.isFinite(this.scale)||this.scale<=0)throw new Error('FBX 骨骼比例无效。');
  }
  update(){
    this.source.updateMatrixWorld(true);const hip=this.target.bones.Hips;
    const position=this.mapping.get('Hips')!.getWorldPosition(new THREE.Vector3()).sub(this.sourceHip).multiplyScalar(this.scale).add(this.targetHip);
    hip.position.copy(hip.parent!.worldToLocal(position));
    for(const name of humanoidNames){const source=this.mapping.get(name);if(!source)continue;const target=this.target.bones[name];
      const desired=source.getWorldQuaternion(new THREE.Quaternion()).multiply(this.sourceRest.get(name)!).multiply(this.targetRest.get(name)!);
      const parent=target.parent?.getWorldQuaternion(new THREE.Quaternion())||new THREE.Quaternion();target.quaternion.copy(parent.invert().multiply(desired)).normalize();target.updateMatrixWorld(true);
    }
    this.target.mesh.skeleton.update();
  }
}
