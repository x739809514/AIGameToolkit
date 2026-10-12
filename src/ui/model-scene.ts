import type {BaseHumanoid} from './base-humanoid';
import {HumanoidRetarget} from './humanoid-retarget';
import * as THREE from 'three';
import {createInPlaceClip} from './root-motion';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export interface ModelNode {id:string;name:string;type:string;children:ModelNode[]}
export interface ModelInfo {mappedBones?:number;sourceBones?:number;missingBones?:string[];nodes:ModelNode[];clips:{name:string;duration:number}[];meshes:number;bones:number;missingTextures:boolean}
const blank='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
export class ModelScene {
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(40,1,.01,10000);renderer:THREE.WebGLRenderer;controls:OrbitControls;
  avatar:BaseHumanoid;retarget?:HumanoidRetarget;
  model?:THREE.Group;mixer?:THREE.AnimationMixer;action?:THREE.AnimationAction;skeleton?:THREE.SkeletonHelper;grid?:THREE.GridHelper;selection?:THREE.BoxHelper;
  exporting=false;
  ignoreTranslation=false;inPlaceClips=new Map<number,THREE.AnimationClip>();
  playing=false;speed=1;loop=true;time=0;duration=0;clipIndex=0;radius=1;center=new THREE.Vector3();frame=0;disposed=false;observer:ResizeObserver;last=performance.now();lastReport=0;
  constructor(public host:HTMLDivElement,public onTime:(time:number,playing:boolean)=>void,avatar:BaseHumanoid){
    this.avatar=avatar;
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0x15191f);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label','三维模型预览');host.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
    this.scene.add(new THREE.HemisphereLight(0xe8efff,0x69717c,2.5));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,6,5);this.scene.add(key);const fill=new THREE.DirectionalLight(0xc1d7ff,1.2);fill.position.set(-3,2,-4);this.scene.add(fill);
    this.camera.position.set(3,2,5);this.controls.target.set(0,1,0);this.controls.update();
    this.scene.add(this.avatar.group);this.setupStage();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.animate();
  }
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
  load(bytes:ArrayBuffer):ModelInfo {
    let missingTextures=false;const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(url.startsWith('blob:')||url.startsWith('data:'))return url;missingTextures=true;return blank;});
    const source=new FBXLoader(manager).parse(bytes,'');this.model=source;source.visible=false;this.scene.add(source);source.updateMatrixWorld(true);
    this.retarget=new HumanoidRetarget(source,this.avatar);this.mixer=new THREE.AnimationMixer(source);
    this.renderer.domElement.dataset.loaded='true';this.renderer.domElement.dataset.mappedBones=String(this.retarget.mapping.size);
    let sourceBones=0;source.traverse(node=>{if((node as THREE.Bone).isBone)sourceBones++;});
    return {...this.baseInfo(),sourceBones,mappedBones:this.retarget.mapping.size,missingBones:this.retarget.missing,clips:source.animations.map((clip,i)=>({name:clip.name||`动作 ${i+1}`,duration:clip.duration}))};
  }
  baseInfo():ModelInfo {
    let meshes=0,bones=0;const nodes=(node:THREE.Object3D):ModelNode=>{if((node as THREE.Mesh).isMesh)meshes++;if((node as THREE.Bone).isBone)bones++;return {id:node.uuid,name:node.name||node.type,type:node.type,children:node.children.map(nodes)};};
    const tree=nodes(this.avatar.group);this.renderer.domElement.dataset.meshes=String(meshes);this.renderer.domElement.dataset.bones=String(bones);this.renderer.domElement.dataset.baseModel='true';this.renderer.domElement.dataset.baseName='Y Bot';
    return {nodes:[tree],meshes,bones,missingTextures:false,clips:[]};
  }
  setupStage(){
    const bounds=new THREE.Box3().setFromObject(this.avatar.group);bounds.getCenter(this.center);this.radius=Math.max(bounds.getSize(new THREE.Vector3()).length()/2,.01);
    this.grid=new THREE.GridHelper(this.radius*5,20,0x505966,0x2c343e);this.grid.position.set(this.center.x,0,this.center.z);this.scene.add(this.grid);
    this.skeleton=new THREE.SkeletonHelper(this.avatar.group);this.skeleton.visible=false;(this.skeleton.material as THREE.Material).depthTest=false;this.skeleton.renderOrder=5;this.scene.add(this.skeleton);
    this.camera.near=this.radius/1000;this.camera.far=this.radius*100;this.camera.updateProjectionMatrix();this.controls.minDistance=this.radius*.1;this.controls.maxDistance=this.radius*30;this.view('perspective');
  }
  setClip(index:number){if(this.exporting)return;this.clipIndex=index;this.time=0;this.playing=false;this.bindClip();this.onTime(0,false);}
  bindClip(){
    this.mixer?.stopAllAction();let clip=this.model?.animations[this.clipIndex];this.duration=clip?.duration||0;
    if(clip&&this.model&&this.ignoreTranslation){let stationary=this.inPlaceClips.get(this.clipIndex);if(!stationary){stationary=createInPlaceClip(this.model,clip);this.inPlaceClips.set(this.clipIndex,stationary);}clip=stationary;}
    this.action=clip&&this.mixer?this.mixer.clipAction(clip):undefined;
    if(this.action){this.action.reset().play();this.action.setLoop(this.loop?THREE.LoopRepeat:THREE.LoopOnce,this.loop?Infinity:1);this.action.clampWhenFinished=true;this.mixer!.setTime(this.time);this.retarget?.update();}
  }
  options(speed:number,loop:boolean,skeleton:boolean,grid:boolean,ignoreTranslation=false){if(this.exporting)return;this.speed=speed;this.loop=loop;if(this.skeleton)this.skeleton.visible=skeleton||this.renderer.domElement.dataset.meshes==='0';if(this.grid)this.grid.visible=grid;if(this.ignoreTranslation!==ignoreTranslation){this.ignoreTranslation=ignoreTranslation;this.bindClip();}if(this.action){this.action.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);this.action.clampWhenFinished=true;}}
  seek(time:number){if(this.exporting)return;this.playing=false;this.time=Math.min(this.duration,Math.max(0,time));if(this.action){this.action.enabled=true;this.action.paused=false;}this.mixer?.setTime(this.time);this.retarget?.update();this.onTime(this.time,false);}
  toggle(){if(this.exporting)return;if(!this.action)return;if(this.time>=this.duration)this.seek(0);this.playing=!this.playing;this.onTime(this.time,this.playing);}
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
    if(this.disposed||this.exporting||!this.action||!this.mixer)throw new Error('请先加载可播放的动画。');
    this.settleCamera();const target=new THREE.WebGLRenderTarget(width,height,{samples:4});target.texture.colorSpace=THREE.SRGBColorSpace;
    const camera=this.camera.clone(),pixels=new Uint8Array(width*height*4),savedTime=this.time,savedPlaying=this.playing,selected=this.selection?.visible;
    this.exporting=true;this.playing=false;cancelAnimationFrame(this.frame);this.controls.enabled=false;if(this.selection)this.selection.visible=false;
    this.action.setLoop(THREE.LoopOnce,1);this.action.clampWhenFinished=true;
    let restored=false;
    return {
      frame:async(time:number,signal:AbortSignal):Promise<ArrayBuffer>=>{
        if(this.disposed||signal.aborted)throw new Error('视频导出已取消。');
        this.action!.enabled=true;this.action!.paused=false;this.mixer!.setTime(time);this.retarget?.update();
        this.renderer.setRenderTarget(target);this.renderer.render(this.scene,camera);
        const read=this.renderer.readRenderTargetPixelsAsync(target,0,0,width,height,pixels);
        this.renderer.setRenderTarget(null);
        await new Promise<void>((resolve,reject)=>{const abort=()=>reject(new Error('视频导出已取消。'));signal.addEventListener('abort',abort,{once:true});read.then(()=>{signal.removeEventListener('abort',abort);resolve();},error=>{signal.removeEventListener('abort',abort);reject(error);});if(signal.aborted)abort();});
        if(this.disposed||signal.aborted)throw new Error('视频导出已取消。');return pixels.buffer as ArrayBuffer;
      },
      restore:()=>{if(restored)return;restored=true;target.dispose();if(this.disposed)return;
        this.renderer.setRenderTarget(null);this.exporting=false;this.controls.enabled=true;this.action!.setLoop(this.loop?THREE.LoopRepeat:THREE.LoopOnce,this.loop?Infinity:1);this.action!.enabled=true;this.action!.paused=false;this.mixer!.setTime(savedTime);this.retarget?.update();this.time=savedTime;this.playing=savedPlaying;
        if(this.selection&&selected!==undefined)this.selection.visible=selected;this.last=performance.now();this.animate();
      }
    };
  }
  animate=()=>{if(this.disposed||this.exporting)return;const now=performance.now(),dt=Math.min((now-this.last)/1000,.1);this.last=now;
    if(this.playing&&this.action){this.time+=dt*this.speed;if(this.time>=this.duration){if(this.loop)this.time%=this.duration;else{this.time=this.duration;this.playing=false;}}this.action.enabled=true;this.action.paused=false;this.mixer!.setTime(this.time);this.retarget?.update();}
    this.controls.update();this.selection?.update();this.renderer.render(this.scene,this.camera);
    this.renderer.domElement.dataset.pose=this.avatar.bones.LeftForeArm.getWorldQuaternion(new THREE.Quaternion()).toArray().map(v=>v.toFixed(4)).join(',');
    this.renderer.domElement.dataset.camera=this.camera.position.toArray().map(v=>v.toFixed(4)).join(',');this.renderer.domElement.dataset.time=this.time.toFixed(4);
    if(now-this.lastReport>100){this.onTime(this.time,this.playing);this.lastReport=now;}this.frame=requestAnimationFrame(this.animate);
  };
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();this.mixer?.stopAllAction();if(this.model)this.mixer?.uncacheRoot(this.model);const textures=new Set<THREE.Texture>(),materials=new Set<THREE.Material>(),geometry=new Set<THREE.BufferGeometry>(),skeletons=new Set<THREE.Skeleton>();this.scene.traverse(o=>{const mesh=o as THREE.Mesh;if((mesh as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((mesh as THREE.SkinnedMesh).skeleton);if(mesh.geometry)geometry.add(mesh.geometry);if(mesh.material)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(mat);});for(const mat of materials){for(const value of Object.values(mat))if(value instanceof THREE.Texture)textures.add(value);mat.dispose();}textures.forEach(t=>t.dispose());geometry.forEach(g=>g.dispose());skeletons.forEach(s=>s.dispose());this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
