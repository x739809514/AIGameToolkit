import * as THREE from 'three';
import type {MotionPlayer} from './motion-player';

// Export the sampled target skeleton so the saved action uses exactly the preview's
// retargeting, masks and weights. The default transforms retain the bind pose.
export function bakeMotionFBX(player:MotionPlayer,name:string):ArrayBuffer {
 const duration=player.duration;if(!player.blendTree.enabled||!duration)throw new Error('请先配置混合动作。');
 const saved=player.snapshot(),bones=player.bones,count=Math.ceil(duration*30),times=Array.from({length:count+1},(_,i)=>Math.round(i/count*duration*46186158000));
 const names=bones.map((b,i)=>THREE.PropertyBinding.sanitizeNodeName(b.name)+(bones.findIndex(other=>other.name===b.name)!==i?`_${i}`:''));
 const parentIndices=bones.map(b=>{let parent=b.parent;while(parent&&!bones.includes(parent as THREE.Bone))parent=parent.parent;return parent?bones.indexOf(parent as THREE.Bone):-1;});
 const transforms=()=>{player.avatar.group.updateMatrixWorld(true);return bones.map((bone,i)=>{const parent=parentIndices[i]>=0?bones[parentIndices[i]]:player.avatar.group;const matrix=parent.matrixWorld.clone().invert().multiply(bone.matrixWorld),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,rotation,scale);const euler=new THREE.Euler().setFromQuaternion(rotation,'ZYX');return [position.toArray(),[euler.x,euler.y,euler.z].map(THREE.MathUtils.radToDeg),scale.toArray()];});};
 try {
  player.apply(player.rest);const rest=transforms(),values=bones.map(()=>Array.from({length:9},()=>[] as number[]));
  for(let frame=0;frame<=count;frame++){player.evaluate(frame===count?Math.max(0,duration-1e-7):frame/count*duration);transforms().forEach((channels,i)=>channels.flat().forEach((value,c)=>{const previous=values[i][c].at(-1);if(c>=3&&c<6&&previous!==undefined)value+=360*Math.round((previous-value)/360);values[i][c].push(value);}));}
  let id=1000;const models=bones.map(()=>id++),stack=id++,layer=id++,objects:string[]=[],connections:string[]=[];
  const properties=['Lcl Translation','Lcl Rotation','Lcl Scaling'],attrs=['T','R','S'];
  const array=(key:string,data:number[])=>`\t\t${key}: *${data.length} {\n\t\t\ta: ${data.join(',')}\n\t\t}`;
  bones.forEach((_,i)=>{
   objects.push(`\tModel: ${models[i]}, "Model::${names[i]}", "LimbNode" {\n\t\tVersion: 232\n\t\tProperties70: {\n\t\t\tP: "RotationOrder", "enum", "", "",0\n${properties.map((p,c)=>`\t\t\tP: "${p}", "${p}", "", "A",${rest[i][c].join(',')}`).join('\n')}\n\t\t}\n\t}`);
   connections.push(`\tC: "OO",${models[i]},${parentIndices[i]<0?0:models[parentIndices[i]]}`);
   attrs.forEach((attr,c)=>{const node=id++;objects.push(`\tAnimationCurveNode: ${node}, "AnimCurveNode::${attr}", "" {\n\t\tProperties70: {\n${['X','Y','Z'].map((axis,a)=>`\t\t\tP: "d|${axis}", "Number", "", "A",${rest[i][c][a]}`).join('\n')}\n\t\t}\n\t}`);connections.push(`\tC: "OO",${node},${layer}`,`\tC: "OP",${node},${models[i]},"${properties[c]}"`);
    ['X','Y','Z'].forEach((axis,a)=>{const curve=id++;objects.push(`\tAnimationCurve: ${curve}, "AnimCurve::${attr}${axis}", "" {\n\t\tDefault: ${rest[i][c][a]}\n\t\tKeyVer: 4008\n${array('KeyTime',times)}\n${array('KeyValueFloat',values[i][c*3+a])}\n${array('KeyAttrFlags',[24836])}\n${array('KeyAttrDataFloat',[0,0,0,0])}\n${array('KeyAttrRefCount',[count+1])}\n\t}`);connections.push(`\tC: "OP",${curve},${node},"d|${axis}"`);});
   });
  });
  objects.push(`\tAnimationStack: ${stack}, "AnimStack::${name.replace(/["\r\n\\]/g,'_')}", "" {\n\t\tProperties70: {\n\t\t\tP: "LocalStart", "KTime", "Time", "",0\n\t\t\tP: "LocalStop", "KTime", "Time", "",${times[count]}\n\t\t}\n\t}`,`\tAnimationLayer: ${layer}, "AnimLayer::BaseLayer", "" {\n\t}`);connections.push(`\tC: "OO",${layer},${stack}`);
  const text=`; FBX 7.4.0 project file\nFBXHeaderExtension: {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 7400\n}\nGlobalSettings: {\n\tVersion: 1000\n\tProperties70: {\n\t\tP: "UpAxis", "int", "Integer", "",1\n\t\tP: "UpAxisSign", "int", "Integer", "",1\n\t\tP: "FrontAxis", "int", "Integer", "",2\n\t\tP: "FrontAxisSign", "int", "Integer", "",-1\n\t\tP: "CoordAxis", "int", "Integer", "",0\n\t\tP: "CoordAxisSign", "int", "Integer", "",1\n\t\tP: "UnitScaleFactor", "double", "Number", "",1\n\t}\n}\nObjects: {\n${objects.join('\n')}\n}\nConnections: {\n${connections.join('\n')}\n}\n`;
  const bytes=new TextEncoder().encode(text);if(bytes.byteLength>50*1024*1024)throw new Error('混合动作超过 50 MB，请缩短循环时长。');return bytes.buffer;
 } finally {player.apply(saved);}
}
