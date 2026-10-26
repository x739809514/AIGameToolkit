import {test} from 'node:test';
import assert from 'node:assert/strict';
import {motionGeometry,motionHasVisibleChange,motionViewBounds} from '../src/shared/cutout-motion-geometry';
import {evaluateMotion2D} from '../src/shared/cutout-foot-lock';
import {gridSkinMesh} from '../src/shared/cutout-skinning';
import {templateClip} from '../src/shared/cutout-motion-templates';
import {proposalMotion} from '../src/shared/cutout-motion';
import type {Rig2D,Clip2D} from '../src/shared/skeletal2d';
const rig=():Rig2D=>({format:'laputa-cutout-experiment',version:1,revision:0,sourceHash:'a'.repeat(64),canvas:[100,200],bones:[{id:'body',name:'身体',origin:[50,100],rotation:0},{id:'arm',name:'右肩',parent:'body',origin:[30,0],rotation:0},{id:'unused',parent:'body',origin:[0,0],rotation:0}],parts:[{id:'arm',bone:'arm',asset:'parts/arm.png',crop:[75,100,20,80],z:0,role:'source'}],clips:[]});
const still=():Clip2D=>({id:'rest',name:'呼吸感待机',duration:4,keys:[{time:0,rotations:{},bones:{body:{x:0}}},{time:4,rotations:{}}]});
test('static setup tracks and animation on unused bones are not visible movement',()=>{
 const r=rig();assert.equal(motionHasVisibleChange(r,still()),false);
 const c=still();c.keys[0].rotations={unused:0};c.keys[1].rotations={unused:40};assert.equal(motionHasVisibleChange(r,c),false);
 c.keys[0].bones={body:{scaleY:1}};c.keys[1].bones={body:{scaleY:1.02}};assert.equal(motionHasVisibleChange(r,c),true);
 assert.throws(()=>proposalMotion(r,{name:'假的呼吸',notes:'',keys:[{time:0,rotations:[],bones:[{boneId:'body',x:0}]},{time:2,rotations:[],bones:[{boneId:'body',x:0,y:0,scaleX:1}]},{time:4,rotations:[],bones:[]}]},{prompt:'呼吸',duration:4,loop:true},'fake'),/未生成可播放/);
});
test('breathing has actual geometry change, including after automatic skinning',()=>{
 const r=rig();r.parts[0].mesh=gridSkinMesh(r.parts[0].crop,4,4,'arm');const c=templateClip(r,'idle',4,true,{amplitude:1,bounce:.006});assert.equal(motionHasVisibleChange(r,c),true);
 const a=motionGeometry(r,evaluateMotion2D(r,c,0))[0],b=motionGeometry(r,evaluateMotion2D(r,c,1))[0];assert.ok(b.points.some((v,i)=>Math.hypot(v[0]-a.points[i][0],v[1]-a.points[i][1])>1));
 r.parts[0].mesh.weights=r.parts[0].mesh.weights.map(()=>[{bone:'body',weight:1}]);const armOnly:Clip2D={id:'arm-only',duration:1,keys:[{time:0,rotations:{arm:0}},{time:1,rotations:{arm:45}}]};assert.equal(motionHasVisibleChange(r,armOnly),false,'weights, not just the bound bone, determine visible movement');
});
test('one animation viewport contains negative positions, off-canvas limbs, part transforms and skinned motion without changing registration',()=>{
 for(const skinned of [false,true]){const r=rig();r.parts[0].offset=[30,-10];if(skinned)r.parts[0].mesh=gridSkinMesh(r.parts[0].crop,4,4,'arm');const original=structuredClone(r);
 const c:Clip2D={id:'outside',duration:2,interpolation:'cubic',keys:[{time:0,rotations:{arm:0}},{time:.6,rotations:{arm:95},bones:{body:{x:-150,y:-200}},parts:{arm:{scaleX:1.5,rotation:30}}},{time:1.3,rotations:{arm:-80},bones:{body:{x:210,y:240}},parts:{arm:{x:15,y:25,scaleY:1.4}}},{time:2,rotations:{arm:0}}]};
 const v=motionViewBounds(r,c);assert.ok(v[0]<0&&v[1]<0&&v[0]+v[2]>100&&v[1]+v[3]>200);
 for(let t=0;t<=2;t+=.013)for(const part of motionGeometry(r,evaluateMotion2D(r,c,t)))for(const [x,y]of part.points)assert.ok(x>v[0]&&x<v[0]+v[2]&&y>v[1]&&y<v[1]+v[3],JSON.stringify({x,y,v}));
 assert.deepEqual(r,original);
 }
});
