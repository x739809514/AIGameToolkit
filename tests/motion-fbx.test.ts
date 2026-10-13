import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {loadYBot} from '../src/ui/y-bot';
import {MotionPlayer} from '../src/ui/motion-player';
import {bakeMotionFBX} from '../src/ui/motion-fbx';
import {defaultMotionBlend,normalizeMotionBlend,upperBody,lowerBody} from '../src/shared/motion-blend';
import {Workbenches} from '../electron/workbenches';
const bot=()=>loadYBot(Uint8Array.from(readFileSync('assets/models/y-bot.fbx')).buffer);
test('baked blend round trips as an independent FBX and preserves masked target poses',()=>{
 const player=new MotionPlayer(bot()),replay=new MotionPlayer(bot());
 try{
  for(const [id,angle] of [['a',.8],['b',-.7]] as const){const source=bot(),bone=source.bones.LeftArm,q=bone.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle));source.group.animations=[new THREE.AnimationClip(id,1,[new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',[0,1],[...bone.quaternion.toArray(),...q.toArray()])])];player.register(id,source.group);}
  for(const mode of ['layers','xy'] as const){
   player.setBlendTree({...defaultMotionBlend(),enabled:true,cycle:1,mode,nodes:['a','b'].map((id,i)=>({id,assetId:id,clipIndex:0,label:id,sourceDuration:1,x:i?1:-1,y:0,weight:1,enabled:true,mask:mode==='layers'?(i?lowerBody:upperBody):[...upperBody,...lowerBody]}))});
   player.evaluate(.4);const saved=player.snapshot(),data=bakeMotionFBX(player,'混合动作'),loaded=new FBXLoader().parse(data,'');assert.equal(loaded.animations.length,1);assert.ok(Math.abs(loaded.animations[0].duration-1)<1e-6);assert.ok(player.bones.every((bone,i)=>bone.quaternion.angleTo(saved[i].quaternion)<1e-6));
   const id=mode;replay.register(id,loaded);replay.select(id,0);
   for(const time of [0,.2,.5,.8,.99]){player.evaluate(time);replay.evaluate(time);for(const name of ['Hips','LeftArm','LeftForeArm','LeftLeg','Spine','Head'] as const){const a=player.avatar.bones[name],b=replay.avatar.bones[name];assert.ok(a.getWorldQuaternion(new THREE.Quaternion()).angleTo(b.getWorldQuaternion(new THREE.Quaternion()))<.005,`${mode} ${time} ${name}`);assert.ok(a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()))<.002,`${mode} position ${name}`);}}
  }
 }finally{player.close();replay.close();}
});
test('saving a blend adds and selects a persistent action without changing source files',async()=>{
 const manager=new Workbenches(mkdtempSync(join(tmpdir(),'blend-save-')),{secure:false,get:()=>undefined,set:()=>{}},()=>{}),board=manager.create('motion-editor'),service=manager.get(board.id),raw=Uint8Array.from(readFileSync('tests/fixtures/dancing.fbx')).buffer;
 try{const [source]=await service.importFiles([{name:'dance.fbx',bytes:raw}]);const tree={...defaultMotionBlend(),enabled:true,nodes:[{id:'a',assetId:source.id,clipIndex:0,label:'dance',sourceDuration:18.2,x:0,y:0,weight:1,enabled:true,mask:[...upperBody,...lowerBody]}]};
  const saved=await service.saveModelBlend({tree,name:'新混合',bytes:raw});assert.notEqual(saved.id,source.id);assert.equal(saved.name,'新混合.fbx');assert.deepEqual(service.modelData(source.id),raw);assert.equal(service.workspace.modelEditor?.assetId,saved.id);assert.equal(service.workspace.modelEditor?.blendTree?.enabled,false);assert.deepEqual(saved.motionBlend,normalizeMotionBlend(tree));assert.equal(service.workspace.assets.length,2);
  const other=manager.get(manager.create('motion-editor').id);await assert.rejects(()=>other.saveModelBlend({tree,name:'bad',bytes:raw}));assert.equal(other.workspace.assets.length,0);
  const reloaded=service.store.load();assert.equal(reloaded.modelEditor?.assetId,saved.id);
 }finally{manager.close();}
});
