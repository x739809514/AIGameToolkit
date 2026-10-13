import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as THREE from 'three';
import {defaultMotionBlend,normalizeMotionBlend,motionBlendWeights,upperBody,lowerBody,type MotionBlendNode} from '../src/shared/motion-blend';
import {humanoidNames} from '../src/shared/humanoid';
import {MotionPlayer} from '../src/ui/motion-player';
import {loadYBot} from '../src/ui/y-bot';
import {Workbenches} from '../electron/workbenches';
import {defaultModelEditor} from '../src/shared/types';
import {modelVideoFrames} from '../src/shared/model-video';
const node=(id:string,patch:Partial<MotionBlendNode>={}):MotionBlendNode=>({id,assetId:id,clipIndex:0,label:id,sourceDuration:2,x:id==='a'?-1:1,y:0,weight:1,enabled:true,mask:[...humanoidNames],...patch});
test('XY distance weights interpolate smoothly, reproduce exact nodes and handle coincident or disabled nodes',()=>{
 const tree={...defaultMotionBlend(),enabled:true,mode:'xy' as const,nodes:[node('a'),node('b')]};assert.deepEqual(motionBlendWeights(tree).map(n=>n.weight),[.5,.5]);assert.deepEqual(motionBlendWeights({...tree,x:-1}).map(n=>n.node.id),['a']);
 const coincident={...tree,nodes:[node('a',{x:0,weight:.25}),node('b',{x:0,weight:.75})]};assert.deepEqual(motionBlendWeights(coincident).map(n=>n.weight),[.25,.75]);assert.deepEqual(motionBlendWeights({...tree,nodes:tree.nodes.map(n=>({...n,enabled:false}))}),[]);
 for(let x=-1;x<=1;x+=.01){const weights=motionBlendWeights({...tree,x});assert.ok(weights.every(n=>Number.isFinite(n.weight)&&n.weight>=0));assert.ok(Math.abs(weights.reduce((sum,n)=>sum+n.weight,0)-1)<1e-9);}
 for(const patch of [{cycle:0},{x:NaN},{mode:'unknown'},{nodes:[node('a',{mask:['InvalidBone' as any]})]},{nodes:[node('a'),node('a')]}])assert.throws(()=>normalizeMotionBlend({...tree,...patch} as any));assert.throws(()=>normalizeMotionBlend(tree,()=>false));
});
function bot(){return loadYBot(Uint8Array.from(readFileSync('assets/models/y-bot.fbx')).buffer);}
test('masked layers combine actual Y Bot upper/lower poses, cover deformation bones, and preserve unselected bones',()=>{
 const avatar=bot(),a=bot(),b=bot(),player=new MotionPlayer(avatar);
 for(const [source,arm,leg]of [[a,.8,.2],[b,-.7,-.9]] as const){const tracks=['LeftArm','LeftLeg'].map((name,index)=>{const bone=source.bones[name as 'LeftArm'|'LeftLeg'],q=bone.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),index?leg:arm));return new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',[0,2],[...q.toArray(),...q.toArray()]);});source.group.animations=[new THREE.AnimationClip('pose',2,tracks)];}
 try{
  player.register('a',a.group);player.register('b',b.group);const sampleA=player.sample('a',0,1),sampleB=player.sample('b',0,1),arm=player.bones.indexOf(avatar.bones.LeftArm),leg=player.bones.indexOf(avatar.bones.LeftLeg);
  player.setBlendTree({...defaultMotionBlend(),enabled:true,nodes:[node('a',{mask:[...upperBody]}),node('b',{mask:[...lowerBody]})]});player.evaluate(1);
  assert.ok(avatar.bones.LeftArm.quaternion.angleTo(sampleA[arm].quaternion)<1e-6);assert.ok(avatar.bones.LeftLeg.quaternion.angleTo(sampleB[leg].quaternion)<1e-6);
  for(let i=0;i<player.bones.length;i++){const part=player.boneParts[i];if(part==='LeftArm')assert.ok(player.bones[i].quaternion.angleTo(sampleA[i].quaternion)<1e-6);}
  player.setBlendTree({...defaultMotionBlend(),enabled:true,nodes:[node('a',{mask:['LeftArm'],weight:.5})]});player.evaluate(1);assert.ok(avatar.bones.LeftArm.quaternion.angleTo(player.rest[arm].quaternion.clone().slerp(sampleA[arm].quaternion,.5))<1e-6);assert.ok(avatar.bones.LeftLeg.quaternion.angleTo(player.rest[leg].quaternion)<1e-6);
  player.setBlendTree({...defaultMotionBlend(),enabled:true,mode:'xy',nodes:[node('a'),node('b')]});player.evaluate(1);const expected=sampleA[arm].quaternion.clone().slerp(sampleB[arm].quaternion,.5);assert.ok(avatar.bones.LeftArm.quaternion.angleTo(expected)<1e-6);player.evaluate(.1);player.evaluate(1);assert.ok(avatar.bones.LeftArm.quaternion.angleTo(expected)<1e-6);assert.equal(player.duration,2);
 }finally{player.close();}
});
test('blend tree settings persist, reject foreign models, and define export duration independently of timeline',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'motion-blend-')),vault={secure:false,get:()=>undefined,set:()=>{}};let manager=new Workbenches(directory,vault,()=>{});const entry=manager.create('motion-editor');
 try{
  const service=manager.get(entry.id),[asset]=await service.importFiles([{name:'dance.fbx',bytes:Uint8Array.from(readFileSync('tests/fixtures/dancing.fbx')).buffer}]);const tree={...defaultMotionBlend(),enabled:true,cycle:1,nodes:[node('a',{assetId:asset.id,mask:[...upperBody]})]};
  service.saveModelEditor({...defaultModelEditor(),assetId:asset.id,blendTree:tree});assert.throws(()=>service.saveModelEditor({...defaultModelEditor(),blendTree:{...tree,nodes:[node('foreign')]}}));assert.throws(()=>service.saveModelEditor({...defaultModelEditor(),blendTree:tree,timelineEnabled:true}));
  assert.equal(modelVideoFrames({assetId:asset.id,clipIndex:0,start:0,end:1,speed:1,width:128,height:128,fps:24,blendTree:tree}),24);assert.throws(()=>modelVideoFrames({assetId:asset.id,clipIndex:0,start:0,end:2,speed:1,width:128,height:128,fps:24,blendTree:tree}));
  manager.close();manager=new Workbenches(directory,vault,()=>{});assert.deepEqual(manager.get(entry.id).workspace.modelEditor!.blendTree,normalizeMotionBlend(tree));
 }finally{manager.close();}
});
test('upper-body action retains its authored tempo when combined with a longer lower-body cycle',()=>{
 const avatar=bot(),upper=bot(),lower=bot(),player=new MotionPlayer(avatar),q=upper.bones.RightArm.quaternion.clone(),peak=q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.8));
 upper.group.animations=[new THREE.AnimationClip('recoil',.2,[new THREE.QuaternionKeyframeTrack(upper.bones.RightArm.name+'.quaternion',[0,.05,.2],[...q.toArray(),...peak.toArray(),...q.toArray()])])];
 const leg=lower.bones.LeftLeg;lower.group.animations=[new THREE.AnimationClip('walk',3.4,[new THREE.QuaternionKeyframeTrack(leg.name+'.quaternion',[0,3.4],[...leg.quaternion.toArray(),...leg.quaternion.toArray()])])];
 try{player.register('a',upper.group);player.register('b',lower.group);const index=player.bones.indexOf(avatar.bones.RightArm),expected=player.sample('a',0,.05)[index].quaternion.clone();player.setBlendTree({...defaultMotionBlend(),enabled:true,cycle:3.4,nodes:[node('a',{sourceDuration:.2,mask:[...upperBody]}),node('b',{sourceDuration:3.4,mask:[...lowerBody]})]});player.evaluate(.05);assert.ok(avatar.bones.RightArm.quaternion.angleTo(expected)<1e-5,'short recoil must not be slowed down to the walk cycle');player.evaluate(.25);assert.ok(avatar.bones.RightArm.quaternion.angleTo(expected)<1e-5,'recoil repeats at its original tempo');}finally{player.close();}
});
test('phase synchronization is explicit, old trees preserve native tempo and overlapping masks are explained',async()=>{const {motionBlendSampleTime,motionBlendOverrides}=await import('../src/shared/motion-blend');const a=node('a',{sourceDuration:.2}),b=node('b',{sourceDuration:3.4,mask:['Hips']}),tree={...defaultMotionBlend(),enabled:true,cycle:3.4,nodes:[a,b]};assert.ok(Math.abs(motionBlendSampleTime(tree,a,.25)-.05)<1e-8);assert.equal(motionBlendSampleTime({...tree,syncPhases:true},a,.85),.05);const old={...tree};delete old.syncPhases;assert.equal(normalizeMotionBlend(old).syncPhases,false);assert.deepEqual(motionBlendOverrides(tree,'a').map(x=>x.bones),[['Hips']]);assert.deepEqual(motionBlendOverrides({...tree,mode:'xy'},'a'),[]);assert.throws(()=>normalizeMotionBlend({...tree,syncPhases:'true'} as any));});
