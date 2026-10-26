import {disposeAttachedObject,ModelAttachments} from './model-attachments';
import type {BaseHumanoid} from './base-humanoid';
import {MotionPlayer} from './motion-player';
import type {MotionTimelineItem} from '../shared/motion-timeline';
import type {MotionBlendTree} from '../shared/motion-blend';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export interface ModelNode {id:string;name:string;type:string;children:ModelNode[];attachmentId?:string}
export interface ModelInfo {motionError?:string;mappedBones?:number;sourceBones?:number;missingBones?:string[];nodes:ModelNode[];clips:{name:string;duration:number}[];meshes:number;bones:number;missingTextures:boolean}
const blank='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
export class ModelScene {
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(40,1,.01,10000);renderer:THREE.WebGLRenderer;controls:OrbitControls;
  attachments:ModelAttachments;avatar:BaseHumanoid;player:MotionPlayer;infos=new Map<string,ModelInfo>();
  skeleton?:THREE.SkeletonHelper;grid?:THREE.GridHelper;selection?:THREE.BoxHelper;
  exporting=false;
  ignoreTranslation=false;
  playing=false;speed=1;loop=true;time=0;duration=0;clipIndex=0;radius=1;center=new THREE.Vector3();frame=0;disposed=false;observer:ResizeObserver;last=performance.now();lastReport=0;
  constructor(public host:HTMLDivElement,public onTime:(time:number,playing:boolean)=>void,avatar:BaseHumanoid){
    this.avatar=avatar;this.attachments=new ModelAttachments(avatar.group);this.player=new MotionPlayer(avatar);
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0x15191f);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label','三维模型预览');host.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
    this.scene.add(new THREE.HemisphereLight(0xe8efff,0x69717c,2.5));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,6,5);this.scene.add(key);const fill=new THREE.DirectionalLight(0xc1d7ff,1.2);fill.position.set(-3,2,-4);this.scene.add(fill);
    this.camera.position.set(3,2,5);this.controls.target.set(0,1,0);this.controls.update();
    this.scene.add(this.avatar.group);this.setupStage();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.animate();
  }
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
  load(bytes:ArrayBuffer):ModelInfo {return this.loadAsset("default",bytes);}
  loadAsset(id:string,bytes:ArrayBuffer):ModelInfo {
    if(this.infos.has(id))return this.infos.get(id)!;
    let missingTextures=false;const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(url.startsWith('blob:')||url.startsWith('data:'))return url;missingTextures=true;return blank;});
    const source=new FBXLoader(manager).parse(bytes,'');source.visible=false;this.scene.add(source);source.updateMatrixWorld(true);
    let sourceBones=0;source.traverse(node=>{if((node as THREE.Bone).isBone)sourceBones++;});
    let registered:ReturnType<MotionPlayer['register']>|undefined,motionError:string|undefined;
    if(source.animations.length){try{registered=this.player.register(id,source);this.player.select(id,0);}catch(error){motionError=(error as Error).message;}}
    this.renderer.domElement.dataset.loaded='true';this.renderer.domElement.dataset.mappedBones=String(registered?.retarget.mapping.size??0);
    const info:ModelInfo={...this.baseInfo(),sourceBones,mappedBones:registered?.retarget.mapping.size,missingBones:registered?.retarget.missing,missingTextures,motionError,clips:registered?source.animations.map((clip,i)=>({name:clip.name||`动作 ${i+1}`,duration:clip.duration})):[]};
    // Props are valid FBX assets even when they have no humanoid animation.
    if(!registered)disposeAttachedObject(source);this.infos.set(id,info);return info;
  }

  baseInfo():ModelInfo {
    let meshes=0,bones=0;const nodes=(node:THREE.Object3D):ModelNode=>{if(this.attachments.parents.has(node.uuid)){if((node as THREE.Mesh).isMesh)meshes++;if((node as THREE.Bone).isBone)bones++;}return {id:node.uuid,name:node.name||node.type,type:node.type,children:node.children.map(nodes),attachmentId:node.userData.attachmentId};};
    const tree=nodes(this.avatar.group);this.renderer.domElement.dataset.meshes=String(meshes);this.renderer.domElement.dataset.bones=String(bones);this.renderer.domElement.dataset.baseModel='true';this.renderer.domElement.dataset.baseName='Y Bot';
    return {nodes:[tree],meshes,bones,missingTextures:false,clips:[]};
  }
  setupStage(){
    const bounds=new THREE.Box3().setFromObject(this.avatar.group);bounds.getCenter(this.center);this.radius=Math.max(bounds.getSize(new THREE.Vector3()).length()/2,.01);
    this.grid=new THREE.GridHelper(this.radius*5,20,0x505966,0x2c343e);this.grid.position.set(this.center.x,0,this.center.z);this.scene.add(this.grid);
    this.skeleton=new THREE.SkeletonHelper(this.avatar.group);this.skeleton.visible=false;(this.skeleton.material as THREE.Material).depthTest=false;this.skeleton.renderOrder=5;this.scene.add(this.skeleton);
    this.camera.near=this.radius/1000;this.camera.far=this.radius*100;this.camera.updateProjectionMatrix();this.controls.minDistance=this.radius*.1;this.controls.maxDistance=this.radius*30;this.view('perspective');
  }
  clearSource(){if(this.exporting)return;this.player.selected=undefined;this.clipIndex=0;}
  removeAsset(id:string){if(this.exporting)return;this.player.setTimeline(this.player.timelineItems.filter(item=>item.assetId!==id),this.player.timelineEnabled);const source=this.player.sources.get(id);if(source){this.scene.remove(source.group);const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),skeletons=new Set<THREE.Skeleton>();source.group.traverse(node=>{const mesh=node as THREE.Mesh;if(mesh.geometry)geometry.add(mesh.geometry);if(mesh.material)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(mat);if((mesh as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((mesh as THREE.SkinnedMesh).skeleton);});for(const mat of materials){for(const value of Object.values(mat))if(value instanceof THREE.Texture)textures.add(value);mat.dispose();}geometry.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());skeletons.forEach(s=>s.dispose());}this.player.unregister(id);this.infos.delete(id);}
  selectSource(id:string,index:number){if(this.exporting)return;this.player.select(id,index);this.clipIndex=index;this.refresh();}
  setClip(index:number){if(this.player.selected)this.selectSource(this.player.selected,index);}
  setTimeline(items:MotionTimelineItem[],enabled:boolean){if(this.exporting)return;this.player.setTimeline(items,enabled);this.refresh();}
  setBlendTree(tree:MotionBlendTree){if(this.exporting)return;const oldDuration=this.duration;this.player.setBlendTree(tree);this.duration=this.player.duration;this.time=Math.min(this.time,this.duration);this.player.evaluate(this.time);if(oldDuration!==this.duration)this.onTime(this.time,this.playing);}
  refresh(){this.duration=this.player.duration;this.time=0;this.playing=false;this.player.evaluate(0);this.onTime(0,false);}
  options(speed:number,loop:boolean,skeleton:boolean,grid:boolean,ignoreTranslation=false){if(this.exporting)return;this.speed=speed;this.loop=loop;if(this.skeleton)this.skeleton.visible=skeleton;if(this.grid)this.grid.visible=grid;this.ignoreTranslation=ignoreTranslation;this.player.setIgnoreTranslation(ignoreTranslation);this.player.evaluate(this.time);}
  seek(time:number){if(this.exporting)return;this.playing=false;this.time=Math.min(this.duration,Math.max(0,time));this.player.evaluate(this.time);this.onTime(this.time,false);}
  toggle(){if(this.exporting||!this.duration)return;if(this.time>=this.duration)this.seek(0);this.playing=!this.playing;this.onTime(this.time,this.playing);}
  settleCamera(){
    // Discard OrbitControls inertia without moving the chosen view.
    const position=this.camera.position.clone(),target=this.controls.target.clone(),damping=this.controls.enableDamping;
    this.controls.enableDamping=false;this.controls.update();this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();this.controls.enableDamping=damping;
  }
  view(view:'perspective'|'front'|'side'|'top'){
    if(this.exporting)return;this.settleCamera();const direction=view==='front'?new THREE.Vector3(0,0,1):view==='side'?new THREE.Vector3(1,0,0):view==='top'?new THREE.Vector3(0,1,.0001):new THREE.Vector3(1,.55,1.6).normalize();
    const vfov=THREE.MathUtils.degToRad(this.camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*this.camera.aspect),distance=this.radius/Math.sin(Math.min(vfov,hfov)/2)*1.15;
    this.controls.target.copy(this.center);this.camera.position.copy(this.center).addScaledVector(direction,distance);this.controls.update();
  }
  select(id:string){if(this.selection){this.scene.remove(this.selection);this.selection.geometry.dispose();(this.selection.material as THREE.Material).dispose();this.selection=undefined;}const object=this.avatar.group.getObjectByProperty('uuid',id);if(object instanceof THREE.Mesh){this.selection=new THREE.BoxHelper(object,0x93c5fd);this.scene.add(this.selection);}}
  beginVideoCapture(width:number,height:number){
    if(this.disposed||this.exporting||!this.duration)throw new Error('请先加载可播放的动画。');
    this.settleCamera();const target=new THREE.WebGLRenderTarget(width,height,{samples:4});target.texture.colorSpace=THREE.SRGBColorSpace;
    const camera=this.camera.clone(),pixels=new Uint8Array(width*height*4),savedTime=this.time,savedPlaying=this.playing,selected=this.selection?.visible;
    this.exporting=true;this.playing=false;cancelAnimationFrame(this.frame);this.controls.enabled=false;if(this.selection)this.selection.visible=false;
    let restored=false;
    return {
      frame:async(time:number,signal:AbortSignal):Promise<ArrayBuffer>=>{
        if(this.disposed||signal.aborted)throw new Error('视频导出已取消。');
        this.player.evaluate(time);
        this.renderer.setRenderTarget(target);this.renderer.render(this.scene,camera);
        const read=this.renderer.readRenderTargetPixelsAsync(target,0,0,width,height,pixels);
        this.renderer.setRenderTarget(null);
        await new Promise<void>((resolve,reject)=>{const abort=()=>reject(new Error('视频导出已取消。'));signal.addEventListener('abort',abort,{once:true});read.then(()=>{signal.removeEventListener('abort',abort);resolve();},error=>{signal.removeEventListener('abort',abort);reject(error);});if(signal.aborted)abort();});
        if(this.disposed||signal.aborted)throw new Error('视频导出已取消。');return pixels.buffer as ArrayBuffer;
      },
      restore:()=>{if(restored)return;restored=true;target.dispose();if(this.disposed)return;
        this.renderer.setRenderTarget(null);this.exporting=false;this.controls.enabled=true;this.player.evaluate(savedTime);this.time=savedTime;this.playing=savedPlaying;
        if(this.selection&&selected!==undefined)this.selection.visible=selected;this.last=performance.now();this.animate();
      }
    };
  }
  animate=()=>{if(this.disposed||this.exporting)return;const now=performance.now(),dt=Math.min((now-this.last)/1000,.1);this.last=now;
    if(this.playing&&this.duration){this.time+=dt*this.speed;if(this.time>=this.duration){if(this.loop)this.time%=this.duration;else{this.time=this.duration;this.playing=false;}}this.player.evaluate(this.time);}
    this.controls.update();this.selection?.update();this.renderer.render(this.scene,this.camera);
    this.renderer.domElement.dataset.blendTreeEnabled=String(this.player.blendTree.enabled);
    this.renderer.domElement.dataset.pose=this.avatar.bones.LeftForeArm.getWorldQuaternion(new THREE.Quaternion()).toArray().map(v=>v.toFixed(4)).join(',');
    this.renderer.domElement.dataset.camera=this.camera.position.toArray().map(v=>v.toFixed(4)).join(',');this.renderer.domElement.dataset.time=this.time.toFixed(4);this.renderer.domElement.dataset.timelineEnabled=String(this.player.timelineEnabled);this.renderer.domElement.dataset.duration=String(this.duration);this.renderer.domElement.dataset.clips=String(this.player.sources.get(this.player.selected||'')?.group.animations.length||0);
    if(now-this.lastReport>100){this.onTime(this.time,this.playing);this.lastReport=now;}this.frame=requestAnimationFrame(this.animate);
  };
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();this.player.close();const textures=new Set<THREE.Texture>(),materials=new Set<THREE.Material>(),geometry=new Set<THREE.BufferGeometry>(),skeletons=new Set<THREE.Skeleton>();this.scene.traverse(o=>{const mesh=o as THREE.Mesh;if((mesh as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((mesh as THREE.SkinnedMesh).skeleton);if(mesh.geometry)geometry.add(mesh.geometry);if(mesh.material)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(mat);});for(const mat of materials){for(const value of Object.values(mat))if(value instanceof THREE.Texture)textures.add(value);mat.dispose();}textures.forEach(t=>t.dispose());geometry.forEach(g=>g.dispose());skeletons.forEach(s=>s.dispose());this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
