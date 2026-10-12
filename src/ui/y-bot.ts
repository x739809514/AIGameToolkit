import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {humanoidNames,type BaseHumanoid} from './base-humanoid';
import {mapHumanoidBones} from './humanoid-retarget';
export function loadYBot(bytes:ArrayBuffer):BaseHumanoid {
  const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(url.startsWith('data:')||url.startsWith('blob:'))return url;return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';});
  const group=new FBXLoader(manager).parse(bytes,'');group.name='Y Bot 基础模型';group.animations=[];group.updateMatrixWorld(true);
  let mesh:THREE.SkinnedMesh|undefined;group.traverse(node=>{if((node as THREE.SkinnedMesh).isSkinnedMesh){mesh??=node as THREE.SkinnedMesh;(node as THREE.SkinnedMesh).frustumCulled=false;}});
  const mapping=mapHumanoidBones(group);if(!mesh||humanoidNames.some(name=>!mapping.has(name)))throw new Error('内置 Y Bot 的网格或主要人形骨骼不完整。');
  const bounds=new THREE.Box3().setFromObject(group),height=bounds.max.y-bounds.min.y;if(!Number.isFinite(height)||height<=0)throw new Error('内置 Y Bot 的尺寸不正确。');
  group.scale.multiplyScalar(1.8/height);group.updateMatrixWorld(true);bounds.setFromObject(group);const center=bounds.getCenter(new THREE.Vector3());group.position.x-=center.x;group.position.z-=center.z;group.position.y-=bounds.min.y;group.updateMatrixWorld(true);
  const bones=Object.fromEntries(humanoidNames.map(name=>[name,mapping.get(name)!])) as BaseHumanoid['bones'];
  return {group,mesh,bones};
}
