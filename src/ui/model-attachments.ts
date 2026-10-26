import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import type {ModelAttachment} from '../shared/model-attachments';
export function disposeAttachedObject(root:THREE.Object3D){
 root.removeFromParent();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),skeletons=new Set<THREE.Skeleton>();
 root.traverse(node=>{const mesh=node as THREE.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(mat);if((mesh as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((mesh as THREE.SkinnedMesh).skeleton);});
 materials.forEach(mat=>{Object.values(mat).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});mat.dispose();});textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());skeletons.forEach(s=>s.dispose());
}
export class ModelAttachments {
 objects=new Map<string,THREE.Group>();parents=new Map<string,{object:THREE.Object3D;path:number[]}>();
 constructor(root:THREE.Object3D){const visit=(node:THREE.Object3D,path:number[])=>{this.parents.set(node.uuid,{object:node,path});node.children.forEach((child,i)=>visit(child,[...path,i]));};visit(root,[]);}
 parent(id:string){const parent=this.parents.get(id);if(!parent||(parent.object as THREE.Bone).isBone!==true)throw new Error('请将 FBX 拖到角色骨骼节点上。');return parent;}
 target(path:number[]){const key=JSON.stringify(path);const parent=Array.from(this.parents.values()).find(p=>JSON.stringify(p.path)===key);if(!parent||(parent.object as THREE.Bone).isBone!==true)throw new Error('挂载骨骼不存在。');return parent.object;}
 add(item:ModelAttachment,bytes:ArrayBuffer){
  const parent=this.target(item.parentPath),manager=new THREE.LoadingManager();manager.setURLModifier(url=>url.startsWith('blob:')||url.startsWith('data:')?url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==');
  const object=new FBXLoader(manager).parse(bytes,'');object.name=item.name;object.animations=[];object.userData.attachmentId=item.id;
  // Local origin snaps to the bone; keep the FBX's authored rotation and scale.
  object.position.set(0,0,0);parent.add(object);object.updateMatrixWorld(true);object.traverse(node=>{if((node as THREE.SkinnedMesh).isSkinnedMesh)(node as THREE.SkinnedMesh).frustumCulled=false;});this.objects.set(item.id,object);return object;
 }
 sync(items:ModelAttachment[]){const wanted=new Set(items.map(item=>item.id));for(const [id,object]of this.objects)if(!wanted.has(id)){disposeAttachedObject(object);this.objects.delete(id);}for(const item of items){const object=this.objects.get(item.id);if(object){const parent=this.target(item.parentPath);if(object.parent!==parent)parent.add(object);object.name=item.name;}}}
}
