import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRig2D,worldBones2D,partTransforms2D,transform2D,solveArm2D,sampleClip2D,type Rig2D} from '../src/shared/skeletal2d';
const fixture=():Rig2D=>({format:'laputa-cutout-experiment',version:1,revision:1,canvas:[600,760],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[300,330],rotation:0},{id:'upper',parent:'root',origin:[60,0],rotation:0},{id:'lower',parent:'upper',origin:[90,0],rotation:0},{id:'hand',parent:'lower',origin:[60,0],rotation:0}],parts:[{id:'forearm',bone:'lower',asset:'parts/forearm.png',crop:[450,310,60,40],z:0,role:'source'}],clips:[{id:'bend',duration:2,keys:[{time:0,rotations:{lower:0}},{time:1,rotations:{lower:-90}},{time:2,rotations:{lower:0}}]}]});
test('trimmed sprite keeps its canvas registration and rotates around the elbow',()=>{
 const r=validateRig2D(fixture()),rest=partTransforms2D(r).get('forearm')!,bent=partTransforms2D(r,{lower:-90}).get('forearm')!;
 assert.deepEqual(transform2D(rest,[510,330]),[510,330]);
 const elbow=transform2D(bent,[450,330]),wrist=transform2D(bent,[510,330]);
 assert.ok(Math.hypot(elbow[0]-450,elbow[1]-330)<1e-9);assert.ok(Math.hypot(wrist[0]-450,wrist[1]-270)<1e-9);
});
test('IK reaches an independently specified target without changing segment lengths',()=>{
 const r=fixture(),target:[number,number]=[425,245],ik=solveArm2D([360,330],target,90,60,-1),bones=worldBones2D(r,{upper:ik.upper,lower:ik.lower});
 const shoulder=transform2D(bones.get('upper')!,[0,0]),elbow=transform2D(bones.get('lower')!,[0,0]),wrist=transform2D(bones.get('hand')!,[0,0]);
 assert.ok(Math.hypot(wrist[0]-target[0],wrist[1]-target[1])<1e-8);assert.ok(Math.abs(Math.hypot(elbow[0]-shoulder[0],elbow[1]-shoulder[1])-90)<1e-8);
 assert.ok(Math.abs(Math.hypot(wrist[0]-elbow[0],wrist[1]-elbow[1])-60)<1e-8);assert.equal(ik.error,0);
});
test('unreachable IK explicitly reports error and preserves maximum arm reach',()=>{
 const ik=solveArm2D([0,0],[200,0],90,60);assert.equal(ik.error,50);assert.ok(Math.abs(ik.upper)<1e-9);assert.ok(Math.abs(ik.lower)<1e-9);
});
test('exported JSON keeps hierarchy, pivots and animation including the loop endpoint',()=>{
 const r=fixture(),loaded=validateRig2D(JSON.parse(JSON.stringify(r)));
 assert.deepEqual(sampleClip2D(loaded.clips[0],1),{lower:-90});assert.deepEqual(sampleClip2D(loaded.clips[0],0),sampleClip2D(loaded.clips[0],2));
 assert.deepEqual([...partTransforms2D(r,{lower:-48})],[...partTransforms2D(loaded,{lower:-48})]);
});
test('bad hierarchy, assets and motion results are rejected before preview',()=>{
 const cases=[(r:Rig2D)=>{r.bones[0].parent='hand';},(r:Rig2D)=>{r.bones[1].id='root';},(r:Rig2D)=>{r.parts[0].bone='missing';},(r:Rig2D)=>{r.parts[0].asset='../secret.png';},(r:Rig2D)=>{r.clips[0].keys[1].rotations={unknown:30};},(r:Rig2D)=>{r.clips[0].keys[1].rotations={};},(r:Rig2D)=>{r.clips[0].keys[1].time=0;}];
 for(const change of cases){const r=fixture();change(r);assert.throws(()=>validateRig2D(r));}
 assert.throws(()=>worldBones2D(fixture(),{unknown:0}));assert.throws(()=>sampleClip2D(fixture().clips[0],NaN));
});
