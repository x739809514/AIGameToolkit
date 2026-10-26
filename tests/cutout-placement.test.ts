import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRig2D,partTransforms2D,transform2D,type Rig2D} from '../src/shared/skeletal2d';
import {positionCutoutPart,type CutoutDocument} from '../src/shared/cutout-studio';
import {PNG} from 'pngjs';
const image=new PNG({width:4,height:4});image.data.fill(255);
function fixture():CutoutDocument{return {format:'laputa-cutout-studio',version:1,revision:0,name:'角色',rig:{format:'laputa-cutout-experiment',version:1,revision:0,canvas:[100,100],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[0,0],rotation:0},{id:'joint',parent:'root',origin:[10,10],rotation:0}],parts:[{id:'head',bone:'joint',asset:'parts/head.png',crop:[20,10,4,4],role:'source',z:1}],clips:[]},artwork:[{partId:'head',name:'头部',bitmap:'data:image/png;base64,'+PNG.sync.write(image).toString('base64'),visible:true,locked:false,opacity:1,selectionMask:{width:2,height:2,runs:[0,1,3]},strokes:[]}]};}
const near=(a:number[],b:number[])=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-7,`${a} != ${b}`));
test('image placement changes setup and animated positions without changing source pixels or the joint',()=>{
 const d=fixture(),moved=positionCutoutPart(d,'head',[5,0]);assert.equal(moved.artwork,d.artwork);assert.equal(moved.rig.bones,d.rig.bones);assert.deepEqual(moved.rig.parts[0].crop,d.rig.parts[0].crop);assert.equal(d.rig.parts[0].offset,undefined);
 near(transform2D(partTransforms2D(moved.rig).get('head')!,[20,10]),[25,10]);near(transform2D(partTransforms2D(moved.rig,{joint:90}).get('head')!,[20,10]),[10,25]);
 const loaded=JSON.parse(JSON.stringify(moved)) as CutoutDocument;near(transform2D(partTransforms2D(loaded.rig,{joint:90}).get('head')!,[20,10]),[10,25]);
});
test('invalid offsets and locked or missing parts reject placement',()=>{
 const d=fixture();for(const offset of [[NaN,0],[Infinity,0],[16385,0],[0],['x',1]]){const rig=structuredClone(d.rig) as Rig2D;rig.parts[0].offset=offset as any;assert.throws(()=>validateRig2D(rig),/offset/);}
 d.artwork[0].locked=true;assert.throws(()=>positionCutoutPart(d,'head',[0,1]),/锁定/);assert.throws(()=>positionCutoutPart(d,'missing',[0,1]),/不存在/);
});
test('resetting image placement restores the original pose and accepts negative coordinates',()=>{
 const d=fixture(),moved=positionCutoutPart(d,'head',[-30,50]);near(transform2D(partTransforms2D(moved.rig).get('head')!,[20,10]),[-10,60]);
 const reset=positionCutoutPart(moved,'head',[0,0]);near(transform2D(partTransforms2D(reset.rig).get('head')!,[20,10]),[20,10]);
});
