import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {Service} from '../electron/service';
import {Store} from '../electron/store';
import {directorHash,validateDirectorPlan} from '../electron/cutout-director';
import {directorPlaybackTimes,directorAutoMesh,directorFeet,directorLocalAction,directorChecks,directorDocument,type DirectorInput} from '../src/shared/cutout-director';
import {validateCutoutDocument,type CutoutDocument} from '../src/shared/cutout-studio';
import {gridSkinMesh} from '../src/shared/cutout-skinning';
import {motionHasVisibleChange} from '../src/shared/cutout-motion-geometry';
const fixture=():CutoutDocument=>{const im=new PNG({width:64,height:64});im.data.fill(255);return {format:'laputa-cutout-studio',version:1,revision:0,name:'导演测试',editorMode:'guided',workflowStage:'repair',rig:{format:'laputa-cutout-experiment',version:1,revision:0,canvas:[64,64],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[32,32],rotation:0}],parts:[{id:'arm',bone:'root',asset:'parts/arm.png',crop:[0,0,64,64],z:0,role:'source'}],clips:[{id:'rest',duration:2,keys:[{time:0,rotations:{}},{time:2,rotations:{}}]}]},artwork:[{partId:'arm',name:'右上臂',bitmap:'data:image/png;base64,'+PNG.sync.write(im).toString('base64'),visible:true,locked:false,opacity:1,strokes:[]}]};};
const input=(d:CutoutDocument,id='run-1'):DirectorInput=>({requestId:id,revision:1,prompt:'自动绑定并挥手',image:d.artwork[0].bitmap,atlas:d.artwork[0].bitmap,bounds:{arm:[0,0,64,64]}});
const response=(data:unknown)=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(data)}]}]});
function setup(){const dir=mkdtempSync(join(tmpdir(),'laputa-director-')),store=new Store(dir),service=new Service(store,{secure:false,get:()=> 'test-key',set:()=>{}},()=>{}),d=fixture();service.workspace.workbenchType='cutout-studio';service.saveCutout(d,0);return {dir,store,service,d,close:()=>{service.close();store.close();rmSync(dir,{recursive:true,force:true});}};}
const reviewInput=(service:Service)=>{const c=service.workspace.cutoutDirector!.candidate!,clip=c.rig.clips.find(v=>v.id===c.clipId)!;return {revision:c.reviewRevision??0,frames:directorPlaybackTimes(clip).map(time=>({time,image:service.workspace.cutoutStudio!.artwork[0].bitmap}))};};
test('director executes tools, preserves the saved character, refines candidates and persists conversation',async()=>{
 const s=setup(),fetch=globalThis.fetch,names:string[]=[];let refine=false;
 try{globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body)),name=body.text.format.name;names.push(name);if(name==='cutout_director'){const ctx=JSON.parse(body.input[0].content[0].text);if(refine){assert.equal(ctx.character.selectedClip.name,'挥手');assert.ok(ctx.history.length>=3);return response({reply:'减小右手动作并放慢。',actions:[{tool:'adjust_motion',boneIds:['arm-bone'],amplitude:.5,duration:4,name:'轻柔挥手'}]});}return response({reply:'准备角色并制作挥手。',actions:[{tool:'prepare_character'},{tool:'create_motion',prompt:'挥手',template:'wave',duration:2,loop:true}]});}if(name==='cutout_layers')return response({notes:'顺序保持',backToFront:['arm']});if(name==='cutout_rig')return response({notes:'绑定肩部',bones:[{id:'root',parent:null,name:'根节点',x:.5,y:.5},{id:'arm-bone',parent:'root',name:'右上臂',x:.5,y:.3}],bindings:[{partId:'arm',boneId:'arm-bone'}]});if(name==='cutout_motion_template')return response({name:'挥手',notes:'轻柔',parameters:{amplitude:1,cycles:2,bounce:0,lean:0}});if(name==='cutout_director_review'){assert.equal(body.input[0].content.length,34);return response({reply:'已检查连续帧。',actions:[]});}throw Error(name);};
  const before=structuredClone(s.service.workspace.cutoutStudio),result=await s.service.director.run(input(s.d));assert.deepEqual(names,['cutout_director','cutout_layers','cutout_rig','cutout_motion_template']);assert.deepEqual(s.service.workspace.cutoutStudio,before);assert.equal(result.candidate?.rig.bones.length,2);assert.ok(result.candidate?.rig.parts[0].mesh);assert.equal(result.candidate?.source,directorHash(before!));assert.equal(result.candidate?.rig.parts[0].crop[2],64);
  await s.service.director.run(input(s.d));assert.equal(names.length,4);const c=result.candidate!,review=await s.service.director.review(c.id,reviewInput(s.service),input(s.d).bounds);assert.equal(review.candidate?.reviewed,true);await s.service.director.review(c.id,reviewInput(s.service),input(s.d).bounds);assert.equal(names.length,5);
  refine=true;const next=await s.service.director.run({...input(s.d,'run-2'),prompt:'右手幅度减半，慢一点',candidateId:c.id});assert.equal(next.candidate?.rig.clips.at(-1)?.duration,4);assert.equal(next.candidate?.rig.clips.at(-2)?.name,'挥手');assert.equal(next.candidate?.rig.clips.at(-1)?.name,'轻柔挥手');assert.deepEqual(s.service.workspace.cutoutStudio,before);assert.equal(s.store.load().cutoutDirector?.messages.at(-1)?.text,'减小右手动作并放慢。');
  const applied=directorDocument(before!,next.candidate!);validateCutoutDocument(applied);s.service.saveCutout(applied,1);s.service.director.dismiss(next.candidate!.id);assert.equal(s.store.load().cutoutStudio?.rig.clips.at(-1)?.name,'轻柔挥手');assert.equal(s.store.load().cutoutDirector?.candidate,undefined);
 }finally{globalThis.fetch=fetch;s.close();}
});
test('cancel and stale source stop the tool chain without partial character mutations; invalid calls never submit',async()=>{
 const s=setup(),fetch=globalThis.fetch;let calls=0,release:(v:Response)=>void=()=>{};
 try{globalThis.fetch=async()=>{calls++;return new Promise<Response>(r=>release=r);};await assert.rejects(s.service.director.run({...input(s.d),revision:0}),/保存/);await assert.rejects(s.service.director.run({...input(s.d),bounds:{}}),/轮廓/);assert.equal(calls,0);
  const pending=s.service.director.run(input(s.d));await assert.rejects(s.service.director.run(input(s.d,'duplicate')),/正在/);await assert.rejects(s.service.generateCutoutRig({image:s.d.artwork[0].bitmap,revision:1}),/正在/);s.service.director.cancel('run-1');release(response({reply:'',actions:[{tool:'prepare_character'}]}));await assert.rejects(pending,/停止/);assert.equal(calls,1);assert.equal(s.service.workspace.cutoutStudio?.rig.bones.length,1);assert.equal(s.service.workspace.cutoutDirector?.run?.status,'cancelled');
  const stale=s.service.director.run(input(s.d,'run-2'));s.service.saveCutout({...s.d,name:'改名',rig:{...s.d.rig,parts:s.d.rig.parts.map(p=>({...p,offset:[2,0]}))}},1);release(response({reply:'',actions:[{tool:'prepare_character'}]}));await assert.rejects(stale,/已修改/);assert.equal(calls,2);assert.equal(s.service.workspace.cutoutDirector?.candidate,undefined);
  assert.throws(()=>validateDirectorPlan({reply:'',actions:[{tool:'shell',command:'bad'}]}),/计划/);assert.throws(()=>validateDirectorPlan({reply:'',actions:[{tool:'prepare_character'}]},true),/计划/);
 }finally{globalThis.fetch=fetch;s.close();}
});
test('local tools enforce locks and identity, preserve edits, diagnose mesh folds and auto-detect foot chains',()=>{
 const d=fixture();d.rig.bones.push({id:'arm-bone',parent:'root',name:'右上臂',origin:[0,-10],rotation:0},{id:'elbow',parent:'arm-bone',name:'右前臂',origin:[0,20],rotation:0});d.rig.parts[0].bone='arm-bone';const bounds=input(d).bounds,meshed=directorAutoMesh(d,bounds);assert.ok(meshed.rig.parts[0].mesh?.weights.some(v=>v.length===2));assert.deepEqual(meshed.rig.parts[0].mesh!.uvs,meshed.rig.parts[0].mesh!.vertices);assert.equal(directorAutoMesh(meshed,bounds).rig.parts[0].mesh,meshed.rig.parts[0].mesh);
 const painted=directorLocalAction(meshed,{tool:'paint_weight',partId:'arm',boneId:'elbow',x:0,y:0,radius:50,strength:1},bounds,undefined,'x').doc;assert.equal(painted.rig.parts[0].mesh!.weights[0][0].bone,'elbow');assert.equal(painted.rig.parts[0].mesh!.weights[0][0].weight,1);
 assert.throws(()=>directorLocalAction({...d,artwork:[{...d.artwork[0],locked:true}]},{tool:'mesh_part',partId:'arm',boneIds:['root'],density:6},bounds,undefined,'x'),/锁定/);assert.throws(()=>directorLocalAction(d,{tool:'mesh_part',partId:'arm',boneIds:['missing'],density:6},bounds,undefined,'x'),/骨骼/);
 const broken=structuredClone(meshed.rig);broken.parts[0].mesh=gridSkinMesh([0,0,64,64],2,2,'arm-bone');broken.parts[0].mesh.vertices[0]=[100,100];const checks=directorChecks(broken,{id:'check',duration:1,keys:[{time:0,rotations:{},bones:{'arm-bone':{scaleX:5,scaleY:5}}},{time:1,rotations:{},bones:{'arm-bone':{scaleX:5,scaleY:5}}}]});assert.ok(checks.some(c=>c.code==='mesh_stretch'));
 const legs=fixture();legs.rig.bones.push({id:'hip',parent:'root',role:'leftThigh',origin:[0,0],rotation:0},{id:'knee',parent:'hip',role:'leftShin',origin:[2,10],rotation:0},{id:'foot',parent:'knee',role:'leftFoot',origin:[-2,10],rotation:0});legs.rig.parts[0].bone='foot';const withFeet=directorFeet(legs,bounds);assert.equal(withFeet.rig.footRig?.chains[0].foot,'foot');assert.equal(withFeet.rig.footRig?.groundY,64);validateCutoutDocument(withFeet);
});
test('restart marks an unfinished director run interrupted without repeating requests',()=>{
 const s=setup();s.service.workspace.cutoutDirector={messages:[],run:{id:'pending',status:'running',progress:'生成中'}};s.service.changed();s.service.close();const service=new Service(s.store,{secure:false,get:()=> 'test-key',set:()=>{}},()=>{});try{assert.equal(service.workspace.cutoutDirector?.run?.status,'failed');assert.match(service.workspace.cutoutDirector?.run?.error??'',/退出/);}finally{service.close();s.close();}
});
test('amplifying a static named clip creates real breathing and fills missing meshes even when the model skips preparation',async()=>{
 const s=setup(),fetch=globalThis.fetch,names:string[]=[];
 try{
  const d=s.service.workspace.cutoutStudio!;d.rig.bones.push({id:'shoulder',name:'右肩',parent:'root',origin:[10,0],rotation:0});d.rig.parts[0].bone='shoulder';d.rig.clips[0].name='呼吸感待机';d.rig.clips[0].keys[0].bones={root:{x:0}};
  const before=structuredClone(d);
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body)),name=body.text.format.name,context=JSON.parse(body.input[0].content[0].text);names.push(name);
   if(name==='cutout_director'){assert.equal(context.character.selectedClipHasMotion,false);return response({reply:'加大呼吸幅度。',actions:[{tool:'adjust_motion',boneIds:['root'],amplitude:1.8,duration:4,name:'呼吸感待机'}]});}
   assert.equal(name,'cutout_motion_template');assert.equal(context.template,'idle');assert.equal(context.parts[0].skinned,true);return response({name:'呼吸',notes:'',parameters:{amplitude:1,cycles:1,bounce:.006,lean:0}});
  };
  const result=await s.service.director.run({...input(d),prompt:'呼吸动作幅度大一些',clipId:'rest'}),candidate=result.candidate!;
  assert.deepEqual(names,['cutout_director','cutout_motion_template']);assert.deepEqual(s.service.workspace.cutoutStudio,before);assert.ok(candidate.rig.parts.every(p=>p.mesh));assert.equal(candidate.rig.clips.at(-1)?.template,'idle');assert.ok(motionHasVisibleChange(candidate.rig,candidate.rig.clips.at(-1)!));assert.match(result.messages.at(-1)!.text,/原动作没有实际运动/);
  assert.throws(()=>directorLocalAction(d,{tool:'adjust_motion',boneIds:[],amplitude:2,duration:4,name:'假的放大'},input(d).bounds,'rest','static'),/没有实际运动/);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('playback review uses fresh ordered frames, rechecks corrections, rejects stale evidence, and ends after three passes',async()=>{
 const s=setup(),fetch=globalThis.fetch;let calls=0;
 try{
  const saved=s.service.workspace.cutoutStudio!,rig=directorAutoMesh(saved,input(saved).bounds).rig;
  s.service.workspace.cutoutDirector={messages:[{id:'request',role:'user',text:'胸部呼吸起伏',createdAt:Date.now()}],candidate:{id:'review-detail',source:directorHash(saved),rig,clipId:'rest',checks:[],steps:[]}};
  const {directorPlaybackTimes}=await import('../src/shared/cutout-director');
  const payload=()=>{const c=s.service.workspace.cutoutDirector!.candidate!,clip=c.rig.clips.find(v=>v.id===c.clipId)!;return {revision:c.reviewRevision??0,frames:directorPlaybackTimes(clip).map(time=>({time,image:s.d.artwork[0].bitmap}))};};
  const first=payload();
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body)),ctx=JSON.parse(body.input[0].content[0].text);assert.equal(ctx.reviewPass,calls);assert.equal(body.input[0].content.length,ctx.frames.length+1);assert.ok(ctx.frames.length>=17);assert.ok(ctx.motionMeasurements.samples>=96);if(calls>1)assert.ok(ctx.character.selectedClip.deformRegions.chest);return response({reply:'回看第'+calls+'轮',actions:[{tool:'animate_region',regionId:'chest',partId:'arm',centerX:.5,centerY:.4,radiusX:.7,radiusY:.6,falloff:'radial',channel:'scaleX',offset:1,amplitude:calls===1?.12:.06,cycles:1,delay:0,wave:'breath',peak:.4}]});};
  const result=await s.service.director.review('review-detail',first,input(s.d).bounds);assert.equal(result.candidate!.reviewed,false);assert.equal(result.candidate!.reviewRevision,1);assert.equal(result.candidate!.rig.clips.length,2);
  await assert.rejects(s.service.director.review('review-detail',first,input(s.d).bounds),/过期/);assert.equal(calls,1);
  await assert.rejects(s.service.director.review('review-detail',{...payload(),frames:[]},input(s.d).bounds),/不完整/);assert.equal(calls,1);
  await s.service.director.review('review-detail',payload(),input(s.d).bounds);assert.equal(s.service.workspace.cutoutDirector!.candidate!.reviewed,false);assert.equal(s.service.workspace.cutoutDirector!.candidate!.rig.clips.length,2);
  const before=structuredClone(s.service.workspace.cutoutDirector!.candidate!.rig);const final=await s.service.director.review('review-detail',payload(),input(s.d).bounds);assert.equal(final.candidate!.reviewed,true);assert.equal(final.candidate!.reviewPasses,3);assert.deepEqual(final.candidate!.rig,before);
  await s.service.director.review('review-detail',payload(),input(s.d).bounds);assert.equal(calls,3);assert.equal(saved.rig.parts[0].mesh,undefined);assert.equal(saved.rig.clips.length,1);
 }finally{globalThis.fetch=fetch;s.close();}
});
test('review cancellation keeps the last candidate; a correction that introduces mesh collapse is rolled back',async()=>{
 const s=setup(),fetch=globalThis.fetch;
 try{
  const saved=s.service.workspace.cutoutStudio!,rig=directorAutoMesh(saved,input(saved).bounds).rig;
  s.service.workspace.cutoutDirector={messages:[],candidate:{id:'cancel-review',source:directorHash(saved),rig,clipId:'rest',checks:[],steps:[]}};
  let release:(r:Response)=>void=()=>{};globalThis.fetch=async()=>new Promise<Response>(r=>release=r);
  const original=structuredClone(s.service.workspace.cutoutDirector.candidate),pending=s.service.director.review('cancel-review',reviewInput(s.service),input(s.d).bounds);s.service.director.cancel(s.service.workspace.cutoutDirector.run!.id);release(response({reply:'',actions:[]}));await assert.rejects(pending,/停止/);assert.deepEqual(s.service.workspace.cutoutDirector.candidate,original);
  globalThis.fetch=async()=>response({reply:'夸张拉伸',actions:[{tool:'animate_channel',target:'part',targetId:'arm',channel:'scaleX',offset:4,amplitude:1,cycles:1,delay:0,wave:'breath',peak:.4}]});
  const result=await s.service.director.review('cancel-review',reviewInput(s.service),input(s.d).bounds);assert.deepEqual(result.candidate!.rig,original!.rig);assert.match(result.candidate!.review!,/保留修正前/);assert.equal(result.candidate!.reviewed,false);assert.ok(result.candidate!.rejectedCorrection?.checks[0].locations?.length);
  let retryCalls=0;globalThis.fetch=async(_url,init)=>{retryCalls++;const body=JSON.parse(String(init?.body)),ctx=JSON.parse(body.input[0].content[0].text);assert.equal(ctx.reviewPass,2);assert.equal(ctx.rejectedCorrection.actions[0].tool,'animate_channel');assert.ok(ctx.rejectedCorrection.checks.some((c:any)=>c.code==='mesh_stretch'));return response({reply:'撤回后保持原候选，仍需检查。',actions:[]});};
  const retried=await s.service.director.review('cancel-review',reviewInput(s.service),input(s.d).bounds);assert.equal(retryCalls,1);assert.equal(retried.candidate!.reviewed,true);assert.deepEqual(retried.candidate!.rig,original!.rig);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('director hands off one part repair without rebuilding rig or changing the saved character and blocks overlapping requests',async()=>{
 const s=setup(),fetch=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return response({reply:'先结合完整角色检查上臂连接。',actions:[{tool:'repair_part',partId:'arm',prompt:'补齐上臂根部'}]});};
  const saved=structuredClone(s.service.workspace.cutoutStudio),result=await s.service.director.run({...input(s.d),prompt:'补齐上臂根部'});assert.equal(result.repairRequest?.partId,'arm');assert.equal(result.repairRequest?.source,directorHash(saved!));assert.equal(result.run?.status,'done');assert.equal(result.candidate,undefined);assert.deepEqual(s.service.workspace.cutoutStudio,saved);assert.equal(s.service.workspace.tasks.length,0);await assert.rejects(s.service.director.run(input(s.d,'overlap')),/采用或放弃/);assert.equal(calls,1);s.service.finishCutoutRepair(result.repairRequest!.id);assert.equal(s.service.workspace.cutoutDirector?.repairRequest,undefined);
  globalThis.fetch=async()=>response({reply:'混合请求',actions:[{tool:'repair_part',partId:'arm',prompt:'补齐'},{tool:'prepare_character'}]});await assert.rejects(s.service.director.run(input(s.d,'mixed')),/一次补画/);assert.deepEqual(s.service.workspace.cutoutStudio,saved);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('review can rebuild only a diagnosed thin mesh, keeping bones, clips and other parts intact',async()=>{
 const s=setup(),fetch=globalThis.fetch;
 try{
  const saved=s.service.workspace.cutoutStudio!,rig=structuredClone(saved.rig);rig.bones.push({id:'joint',parent:'root',origin:[0,20],rotation:0});
  const mesh=gridSkinMesh([32,32,.01,40],1,1,'root');mesh.weights=mesh.uvs.map(v=>[{bone:v[0]>32?'joint':'root',weight:1}]);rig.parts[0].mesh=mesh;
  rig.clips=[{id:'bent',duration:2,loop:true,interpolation:'linear',keys:[{time:0,rotations:{joint:0}},{time:1,rotations:{joint:-5}},{time:2,rotations:{joint:0}}]}];
  const initial=directorChecks(rig,rig.clips[0]);assert.ok(initial.some(c=>c.locations?.some(l=>l.restMinAltitude<.011)));const original=structuredClone(rig);
  s.service.workspace.cutoutDirector={messages:[],candidate:{id:'thin',source:directorHash(saved),rig,clipId:'bent',checks:initial,steps:[]}};
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body)),ctx=JSON.parse(body.input[0].content[0].text);assert.ok(body.text.format.schema.properties.actions.items.anyOf.some((s:any)=>s.properties.tool.enum[0]==='mesh_part'));assert.ok(ctx.diagnostics.some((c:any)=>c.locations?.[0]?.vertices.length===3));assert.ok(ctx.motionMeasurements.bones.find((b:any)=>b.boneId==='joint').minRotation<=-5);return response({reply:'只重建有细条三角形的网格，保留动作。',actions:[{tool:'mesh_part',partId:'arm',boneIds:['joint'],density:6}]});};
  const result=await s.service.director.review('thin',reviewInput(s.service),input(s.d).bounds),candidate=result.candidate!;assert.equal(candidate.reviewed,false);assert.equal(candidate.reviewRevision,1);assert.equal(candidate.checks.length,0);assert.deepEqual(candidate.rig.bones,original.bones);assert.deepEqual(candidate.rig.clips,original.clips);assert.equal(saved.rig.parts[0].mesh,undefined);
  globalThis.fetch=async()=>response({reply:'重复重建',actions:[{tool:'mesh_part',partId:'arm',boneIds:['joint'],density:6}]});
  await assert.rejects(s.service.director.review('thin',reviewInput(s.service),input(s.d).bounds),/仅允许重建/);assert.deepEqual(s.service.workspace.cutoutDirector!.candidate,candidate);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('director and review expose an executable foot-lock tool and effective constraint state',async()=>{
 const s=setup(),fetch=globalThis.fetch;
 try{
  const saved=s.service.workspace.cutoutStudio!;saved.rig.bones.push({id:'hip',parent:'root',origin:[0,0],rotation:-20},{id:'knee',parent:'hip',origin:[0,12],rotation:40},{id:'foot',parent:'knee',origin:[0,12],rotation:-20});saved.rig.parts[0].bone='hip';saved.rig.parts[0].mesh=gridSkinMesh([0,0,64,64],3,3,'hip');saved.rig.footRig={groundY:58,chains:[{id:'left',name:'左脚',hip:'hip',knee:'knee',foot:'foot',sole:[0,2],bend:1}]};saved.rig.clips[0].footLock=true;saved.rig.clips[0].contacts=[];
  const original=structuredClone(saved);
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body)),ctx=JSON.parse(body.input[0].content[0].text);assert.equal(ctx.character.footLock.effective,false);assert.equal(ctx.character.footLock.reason,body.text.format.name==='cutout_director'?'no_contacts':'disabled');assert.ok(body.text.format.schema.properties.actions.items.anyOf.some((s:any)=>s.properties.tool.enum[0]==='set_foot_lock'));return response({reply:'确认关闭脚底约束。',actions:body.text.format.name==='cutout_director'?[{tool:'set_foot_lock',enabled:false,contacts:null}]:[]});};
  const result=await s.service.director.run({...input(saved),clipId:'rest',prompt:'关闭脚底锁定'});assert.equal(result.candidate!.rig.clips.at(-1)!.footLock,false);assert.deepEqual(result.candidate!.rig.clips.at(-1)!.keys,original.rig.clips[0].keys);await s.service.director.review(result.candidate!.id,reviewInput(s.service),input(s.d).bounds);assert.deepEqual(saved,original);
 }finally{globalThis.fetch=fetch;s.close();}
});
