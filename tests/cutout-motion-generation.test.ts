import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {Service} from '../electron/service';
import {Store} from '../electron/store';
import {gridSkinMesh} from '../src/shared/cutout-skinning';
import {motionHasVisibleChange} from '../src/shared/cutout-motion-geometry';
import {sampleMotion2D,validateRig2D,type Clip2D} from '../src/shared/skeletal2d';
import type {MotionDetailAction,MotionRegionAction} from '../src/shared/cutout-motion-detail';
import type {CutoutDocument} from '../src/shared/cutout-studio';

const wave={offset:0,amplitude:1,cycles:1,delay:0,wave:'breath' as const,peak:.4};
function breathingDetails():MotionDetailAction[]{
 const regions:MotionRegionAction[]=['chest','belly','cape'].flatMap((regionId,i)=>(['scaleX','scaleY','y'] as const).map(channel=>({tool:'animate_region' as const,regionId,partId:'body',centerX:.5,centerY:.2+i*.25,radiusX:.8,radiusY:.3,falloff:'radial' as const,...wave,channel,offset:channel==='y'?0:1,amplitude:channel==='y'?1:.04,delay:i*.1})));
 return [...regions,...(['head','left-shoulder','right-shoulder'] as const).flatMap(targetId=>(['rotation','y'] as const).map(channel=>({tool:'animate_channel' as const,target:'bone' as const,targetId,...wave,channel,delay:targetId==='head'?.25:.1}))),{tool:'animate_region',regionId:'cape',partId:'body',centerX:.5,centerY:.7,radiusX:.8,radiusY:.3,falloff:'radial',...wave,channel:'x',delay:.35}];
}
function setup(){
 const image=new PNG({width:64,height:64});image.data.fill(255);const bitmap='data:image/png;base64,'+PNG.sync.write(image).toString('base64');
 const d:CutoutDocument={format:'laputa-cutout-studio',version:1,revision:0,name:'呼吸生成回归',workflowStage:'motion',rig:{format:'laputa-cutout-experiment',version:1,revision:0,canvas:[64,64],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[32,32],rotation:0},{id:'chest',parent:'root',name:'胸部',role:'torso',origin:[0,-12],rotation:0},{id:'head',parent:'chest',role:'head',origin:[0,-12],rotation:0},{id:'left-shoulder',parent:'chest',role:'leftUpperArm',origin:[-12,0],rotation:0},{id:'right-shoulder',parent:'chest',role:'rightUpperArm',origin:[12,0],rotation:0}],parts:[{id:'body',asset:'parts/body.png',bone:'chest',crop:[0,0,64,64],z:0,role:'source',mesh:gridSkinMesh([0,0,64,64],8,8,'chest')}],clips:[{id:'rest',duration:3,loop:true,keys:[{time:0,rotations:{}},{time:3,rotations:{}}]}]},artwork:[{partId:'body',name:'身体',bitmap,visible:true,locked:false,opacity:1,strokes:[]}]};
 const dir=mkdtempSync(join(tmpdir(),'laputa-motion-count-')),store=new Store(dir),service=new Service(store,{secure:false,get:()=> 'mock-key',set:()=>{}},()=>{});service.workspace.workbenchType='cutout-studio';service.saveCutout(d,0);
 const input={requestId:'breath',revision:1,prompt:'胸腹呼吸起伏，双肩轻抬，头部延迟跟随，披风轻摆',template:'idle' as const,duration:3,loop:true,image:bitmap,atlas:bitmap,bounds:{body:[0,0,64,64] as [number,number,number,number]}};
 return {d,service,input,close:()=>{service.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
const response=(data:unknown)=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const template=(details:unknown)=>({name:'自然呼吸',notes:'胸腹、头肩与披风独立变化',parameters:{amplitude:.5,cycles:1,bounce:0,lean:0},details});
function assertDetails(clip:Clip2D,details:MotionDetailAction[]){for(const a of details){const values=clip.keys.map(k=>a.tool==='animate_region'?k.deforms?.[a.regionId]?.[a.channel]:a.target==='bone'&&a.channel==='rotation'?k.rotations[a.targetId]:(a.target==='bone'?k.bones:k.parts)?.[a.targetId]?.[a.channel as 'x'|'y'|'scaleX'|'scaleY']);assert.ok(values.some(v=>v!==undefined),JSON.stringify(a));assert.ok(Math.max(...values.filter((v):v is number=>v!==undefined))-Math.min(...values.filter((v):v is number=>v!==undefined))>0,JSON.stringify(a));}assert.equal(JSON.stringify(sampleMotion2D(clip,0)),JSON.stringify(sampleMotion2D(clip,clip.duration)));}

test('director breathing accepts 16 local channels, retains every requested track and leaves saved setup unchanged',async()=>{
 const s=setup(),fetch=globalThis.fetch,names:string[]=[],details=breathingDetails();assert.equal(details.length,16);
 try{globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body)),name=body.text.format.name;names.push(name);if(name==='cutout_director')return response({reply:'制作自然呼吸。',actions:[{tool:'create_motion',prompt:s.input.prompt,template:'idle',duration:3,loop:true}]});assert.equal(name,'cutout_motion_template');return response(template(details));};
  const before=structuredClone(s.service.workspace.cutoutStudio),result=await s.service.director.run(s.input),clip=result.candidate!.rig.clips.at(-1)!;
  assert.deepEqual(names,['cutout_director','cutout_motion_template']);assert.equal(result.run?.status,'done');assertDetails(clip,details);validateRig2D(result.candidate!.rig);assert.ok(motionHasVisibleChange(result.candidate!.rig,clip));assert.deepEqual(s.service.workspace.cutoutStudio,before);assert.deepEqual(result.candidate!.rig.parts,before!.rig.parts);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('advanced custom generation accepts the same 16-channel breathing plan with a static base',async()=>{
 const s=setup(),fetch=globalThis.fetch,details=breathingDetails();
 try{globalThis.fetch=async()=>response({name:'自定义呼吸',notes:'独立局部通道驱动',interpolation:'cubic',keys:[0,1,2,3].map(time=>({time,rotations:[{boneId:'chest',angle:0}],bones:[],parts:[]})),details});const before=structuredClone(s.service.workspace.cutoutStudio),result=await s.service.generateCutoutMotion({...s.input,template:'custom'});assertDetails(result.clip,details);assert.ok(motionHasVisibleChange(s.d.rig,result.clip));assert.deepEqual(s.service.workspace.cutoutStudio,before);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('template and custom requests declare the same 32-channel budget that their validator accepts',async()=>{
 const s=setup(),fetch=globalThis.fetch,details=Array.from({length:32},(_,i)=>({...breathingDetails()[0] as MotionRegionAction,regionId:'region-'+i,amplitude:.001}));let requests=0;
 try{globalThis.fetch=async(_url,init)=>{requests++;const body=JSON.parse(String(init?.body));assert.equal(body.text.format.schema.properties.details.maxItems,32);assert.match(body.instructions,/最多 32 条局部动画通道/);return response(body.text.format.name==='cutout_motion_template'?template(details):{name:'自定义呼吸',notes:'',keys:[0,1,2,3].map(time=>({time,rotations:[{boneId:'chest',angle:0}]})),details});};
  for(const mode of ['idle','custom'] as const){const result=await s.service.generateCutoutMotion({...s.input,template:mode});assert.equal(Object.keys(result.clip.deformRegions!).length,32);assertDetails(result.clip,details);}
  assert.equal(requests,2);assert.equal(s.service.workspace.cutoutStudio!.rig.clips.length,1);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('bad detail shape and excessive count have different actionable errors and never alter saved data',async()=>{
 const s=setup(),fetch=globalThis.fetch;let details:unknown,requests=0;
 try{globalThis.fetch=async(_url,init)=>{requests++;const body=JSON.parse(String(init?.body));return response(body.text.format.name==='cutout_motion_template'?template(details):{name:'呼吸',notes:'',keys:[0,1,2,3].map(time=>({time,rotations:[{boneId:'chest',angle:0}]})),details});};const before=structuredClone(s.service.workspace.cutoutStudio);
  for(const mode of ['idle','custom'] as const){for(const value of [null,{},'invalid']){details=value;await assert.rejects(s.service.generateCutoutMotion({...s.input,template:mode}),/格式无效.*应为数组/);}details=Array.from({length:33},()=>breathingDetails()[0]);await assert.rejects(s.service.generateCutoutMotion({...s.input,template:mode}),/33 条.*32 条上限/);}
  assert.equal(requests,8);assert.deepEqual(s.service.workspace.cutoutStudio,before);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('both motion generators carry explicit footLock false into the clip and empty contacts never implicitly enable it',async()=>{
 const s=setup(),fetch=globalThis.fetch;let footLock:unknown=false,contacts:any[]=[];
 try{
  const d=s.service.workspace.cutoutStudio!;d.rig.bones.push({id:'knee',parent:'chest',origin:[0,10],rotation:15},{id:'foot',parent:'knee',origin:[0,10],rotation:-15});d.rig.bones[1].role='leftThigh';d.rig.bones[1].rotation=-15;d.rig.footRig={groundY:44,chains:[{id:'left',name:'左脚',hip:'chest',knee:'knee',foot:'foot',sole:[0,3],bend:1}]};
  const before=structuredClone(d);
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.deepEqual(body.text.format.schema.properties.footLock,{type:'boolean'});assert.match(body.instructions,/禁用脚底锁定.*false/);return response(body.text.format.name==='cutout_motion_template'?{...template([]),parameters:{amplitude:1,cycles:1,bounce:.01,lean:0},footLock}:{name:'屈膝',notes:'禁用锁定',footLock,contacts,interpolation:'linear',keys:[0,1.5,3].map((time,i)=>({time,rotations:[{boneId:'chest',angle:i===1?12:0}]})),details:[]});};
  contacts=[{chainId:'left',start:0,end:3,targetX:null,targetY:null}];
  for(const mode of ['walk','custom'] as const){const result=await s.service.generateCutoutMotion({...s.input,template:mode});assert.equal(result.clip.footLock,false);assert.ok(result.clip.contacts!.length>0);}
  footLock=undefined;contacts=[];const legacy=await s.service.generateCutoutMotion({...s.input,template:'custom'});assert.equal(legacy.clip.footLock,false);
  footLock='false';for(const mode of ['walk','custom'] as const)await assert.rejects(s.service.generateCutoutMotion({...s.input,template:mode}),/脚底锁定/);
  assert.deepEqual(s.service.workspace.cutoutStudio,before);
 }finally{globalThis.fetch=fetch;s.close();}
});
