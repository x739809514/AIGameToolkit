import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {Service} from '../electron/service';
import {Store} from '../electron/store';
import {repairRegionMask} from '../electron/cutout-repair-mask';
import {applyCutoutRepair,cutoutRepairContextSource,cutoutRepairDocumentSource,validateRepairPlan,type CutoutRepairInput,type CutoutRepairPlan} from '../src/shared/cutout-repair';
import {extendRepairMesh} from '../src/shared/cutout-repair-mesh';
import {gridSkinMesh} from '../src/shared/cutout-skinning';
import {validateCutoutDocument,type CutoutDocument} from '../src/shared/cutout-studio';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const png=(im:PNG)=>'data:image/png;base64,'+PNG.sync.write(im).toString('base64');
const response=(data:unknown)=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const plan:CutoutRepairPlan={summary:'肩部连接需要向上补齐。',instruction:'补全肩部，沿用红色布料，不添加手掌。',regions:[{x:.2,y:.2,width:.6,height:.4}]};
function fixture(){
 const source=new PNG({width:64,height:64}),result=new PNG({width:64,height:64});
 for(let y=24;y<44;y++)for(let x=24;x<44;x++)source.data.set([180,40,65,255],(y*64+x)*4);
 for(let y=12;y<50;y++)for(let x=12;x<50;x++)result.data.set([20,180,90,255],(y*64+x)*4);
 const bitmap=png(source),mesh=gridSkinMesh([24,24,20,20],2,2,'arm-bone');mesh.vertices[4][0]+=2;mesh.weights[4]=[{bone:'root',weight:.3},{bone:'arm-bone',weight:.7}];
 const d:CutoutDocument={format:'laputa-cutout-studio',version:1,revision:0,name:'上下文补画测试',rig:{format:'laputa-cutout-experiment',version:1,revision:0,canvas:[64,64],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[32,32],rotation:0},{id:'arm-bone',parent:'root',origin:[0,-8],rotation:0}],parts:[{id:'arm',asset:'parts/arm.png',bone:'root',crop:[0,0,64,64],mesh,offset:[5,2],z:3,role:'source'}],clips:[{id:'idle',duration:2,keys:[{time:0,rotations:{'arm-bone':0}},{time:1,rotations:{'arm-bone':12}},{time:2,rotations:{'arm-bone':0}}]}]},artwork:[{partId:'arm',name:'上臂',bitmap,visible:true,locked:false,opacity:1,strokes:[]}]};
 const input:CutoutRepairInput={partId:'arm',requestId:'context-repair',prompt:'补齐肩部连接',signature:hash(cutoutRepairContextSource(d,'arm')),source:Uint8Array.from(PNG.sync.write(source)).buffer,frame:[0,0,64,64],context:{assembly:bitmap,marked:bitmap,detail:bitmap}};
 return {source,result,d,input};
}
function setup(){const dir=mkdtempSync(join(tmpdir(),'laputa-context-repair-')),store=new Store(dir),service=new Service(store,{secure:false,get:()=> 'fixture-key',set:()=>{}},()=>{}),f=fixture();service.workspace.workbenchType='cutout-studio';service.saveCutout(f.d,0);return {...f,service,store,close:()=>{service.close();store.close();rmSync(dir,{recursive:true,force:true});}};}
async function done(s:Service,id:string){for(let i=0;i<500;i++){const t=s.workspace.tasks.find(t=>t.id===id)!;if(['succeeded','failed'].includes(t.state))return t;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}

test('repair region mask permits a seam and planned transparent area, preserving core and unselected background',()=>{
 const {source}=fixture(),mask=PNG.sync.read(repairRegionMask(source,plan)),alpha=(x:number,y:number)=>mask.data[(y*64+x)*4+3];
 assert.equal(alpha(28,28),255);assert.equal(alpha(24,24),0);assert.equal(alpha(20,20),0);assert.equal(alpha(20,48),255);assert.equal(alpha(0,0),255);
 assert.throws(()=>validateRepairPlan({...plan,regions:[{x:0,y:0,width:1,height:1}]}),/范围过大/);
 assert.throws(()=>validateRepairPlan({...plan,regions:[{x:.9,y:0,width:.5,height:.1}]}),/无效/);
 assert.throws(()=>repairRegionMask(source,{...plan,regions:[{x:.45,y:.45,width:.05,height:.05}]}),/没有可补画/);
});

test('repair extends mesh to cover new pixels while preserving all original vertices, UVs, weights, bindings and clips',()=>{
 const {d,result}=fixture(),mesh=d.rig.parts[0].mesh!,next=applyCutoutRepair(d,'candidate',{partId:'arm',signature:'x',instruction:'',frame:[0,0,64,64]},png(result)),extended=next.rig.parts[0].mesh!;
 assert.ok(extended.vertices.length>mesh.vertices.length);assert.deepEqual(extended.vertices.slice(0,9),mesh.vertices);assert.deepEqual(extended.uvs.slice(0,9),mesh.uvs);assert.deepEqual(extended.weights.slice(0,9),mesh.weights);assert.deepEqual(extended.triangles.slice(0,mesh.triangles.length),mesh.triangles);assert.ok(Math.min(...extended.uvs.map(v=>v[0]))<=0);assert.ok(Math.max(...extended.uvs.map(v=>v[0]))>=64);
 assert.deepEqual(next.rig.bones,d.rig.bones);assert.deepEqual(next.rig.clips,d.rig.clips);assert.deepEqual(next.rig.parts[0].offset,[5,2]);assert.equal(next.rig.parts[0].bone,'root');validateCutoutDocument(next);assert.equal(extendRepairMesh(extended,[0,0,64,64]),extended);
 const hole={...mesh,triangles:mesh.triangles.slice(3)};assert.throws(()=>extendRepairMesh(hole,[0,0,64,64]),/网格/);
});

test('context repair plans with assembly references without an original, reviews exact output, bounds retries, preserves saved setup',async()=>{
 const s=setup(),fetch=globalThis.fetch,names:string[]=[];let images=0;
 try{globalThis.fetch=async(url,init)=>{if(String(url).endsWith('images/edits')){images++;const form=init!.body as FormData;assert.equal(form.getAll('image[]').length,4);assert.match(String(form.get('prompt')),/接缝|局部/);if(images===2)assert.match(String(form.get('prompt')),/过厚/);return Response.json({data:[{b64_json:PNG.sync.write(s.result).toString('base64')}]});}
  const body=JSON.parse(String(init?.body)),name=body.text.format.name;names.push(name);assert.equal(body.input[0].content.length,5);if(name==='cutout_repair_plan')return response(plan);assert.equal(name,'cutout_repair_review');return response({summary:'肩部新边缘过厚。',needsCorrection:true,correction:'将肩部边缘向内收细。过厚区域只修接缝。'});};
  const before=structuredClone(s.service.workspace.cutoutStudio),first=await s.service.repairCutoutPart(s.input),a=await done(s.service,first.id);assert.equal(a.state,'succeeded',a.error);assert.deepEqual(names,['cutout_repair_plan']);assert.equal(a.cutoutRepair?.attempt,1);assert.equal(a.cutoutRepair?.documentSignature,hash(cutoutRepairDocumentSource(s.d)));
  const output=PNG.sync.read(s.service.assets.bytes(s.service.workspace.assets.find(v=>v.id===a.outputAssetIds[0])!));assert.deepEqual([...output.data.subarray((28*64+28)*4,(28*64+28)*4+4)],[180,40,65,255]);assert.equal(output.data[(20*64+20)*4+3],255);assert.equal(output.data[(48*64+20)*4+3],0);
  const evidence={assetId:a.outputAssetIds[0],signature:s.input.signature,images:[png(s.source),png(s.result)],poses:['rest','-20°','20°']};
  await assert.rejects(s.service.reviewCutoutRepair(a.id,{...evidence,assetId:'wrong'}),/过期/);await s.service.reviewCutoutRepair(a.id,evidence);await s.service.reviewCutoutRepair(a.id,evidence);assert.equal(names.filter(n=>n==='cutout_repair_review').length,1);
  const second=await s.service.repairCutoutPart({...s.input,requestId:'repair-fix',retryOf:a.id}),b=await done(s.service,second.id);assert.equal(b.state,'succeeded',b.error);assert.equal(b.cutoutRepair?.attempt,2);assert.equal(names.filter(n=>n==='cutout_repair_plan').length,1);await s.service.reviewCutoutRepair(b.id,{...evidence,assetId:b.outputAssetIds[0]});
  await assert.rejects(s.service.repairCutoutPart({...s.input,requestId:'third',retryOf:b.id}),/不能继续/);await assert.rejects(s.service.repairCutoutPart({...s.input,requestId:'repeat',retryOf:a.id}),/不能继续/);assert.equal(images,2);assert.deepEqual(s.service.workspace.cutoutStudio,before);
  s.service.workspace.cutoutDirector={messages:[],repairRequest:{id:'director-request',partId:'arm',prompt:'补画',source:a.cutoutRepair!.documentSignature!,taskId:b.id}};s.service.finishCutoutRepair(a.id);assert.ok(s.service.workspace.tasks.every(t=>t.cutoutRepair?.dismissed));assert.equal(s.service.workspace.cutoutDirector.repairRequest,undefined);assert.equal(s.store.load().tasks.length,2);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('changed assembly or stop prevents subsequent image calls; interrupted review can be explicitly resumed',async()=>{
 const s=setup(),fetch=globalThis.fetch;let release:(v:Response)=>void=()=>{},calls=0;
 try{globalThis.fetch=async()=>{calls++;return new Promise<Response>(r=>release=r);};const t=await s.service.repairCutoutPart(s.input);for(let i=0;i<50&&!calls;i++)await new Promise(r=>setTimeout(r,5));s.service.finishCutoutRepair(t.id,true);release(response(plan));const stopped=await done(s.service,t.id);assert.equal(stopped.state,'failed');assert.match(stopped.error!,/停止/);assert.equal(calls,1);
  const input={...s.input,requestId:'stale'};const next=await s.service.repairCutoutPart(input);for(let i=0;i<50&&calls<2;i++)await new Promise(r=>setTimeout(r,5));s.service.workspace.cutoutStudio!.rig.parts[0].offset=[7,2];release(response(plan));assert.equal((await done(s.service,next.id)).state,'failed');assert.equal(calls,2);
  stopped.cutoutRepair!.review={status:'reviewing',summary:'pending'};s.service.changed();s.service.close();const reopened=new Service(s.store,{secure:false,get:()=> 'fixture-key',set:()=>{}},()=>{});assert.equal(reopened.workspace.tasks[0].cutoutRepair?.review?.status,'failed');reopened.close();
 }finally{globalThis.fetch=fetch;s.close();}
});

test('repair can use a pending director rig, then becomes stale when that candidate is replaced',async()=>{
 const s=setup(),fetch=globalThis.fetch;
 try{const saved=s.service.workspace.cutoutStudio!,candidate={id:'rig-candidate',source:hash(cutoutRepairDocumentSource(saved)),rig:structuredClone(saved.rig),steps:[],checks:[]};candidate.rig.parts[0].offset=[8,2];s.service.workspace.cutoutDirector={messages:[],candidate,repairRequest:{id:'repair-request',partId:'arm',prompt:'补画',source:candidate.source,candidateId:candidate.id}};
  const base={...saved,rig:candidate.rig},input={...s.input,candidateId:candidate.id,directorRequestId:'repair-request',signature:hash(cutoutRepairContextSource(base,'arm'))};globalThis.fetch=async(url)=>String(url).endsWith('images/edits')?Response.json({data:[{b64_json:PNG.sync.write(s.result).toString('base64')}]}):response(plan);
  const first=await s.service.repairCutoutPart(input),t=await done(s.service,first.id);assert.equal(t.state,'succeeded',t.error);assert.equal(t.cutoutRepair?.candidateId,candidate.id);assert.deepEqual(s.service.workspace.cutoutStudio!.rig.parts[0].offset,[5,2]);assert.equal(s.service.workspace.cutoutDirector.repairRequest?.taskId,t.id);
  s.service.workspace.cutoutDirector.candidate={...candidate,id:'replaced'};await assert.rejects(s.service.reviewCutoutRepair(t.id,{assetId:t.outputAssetIds[0],signature:input.signature,images:[png(s.source),png(s.result)],poses:['rest','-20','20']}),/候选已变化/);s.service.finishCutoutRepair(t.id);assert.equal(s.service.workspace.cutoutDirector.repairRequest,undefined);
 }finally{globalThis.fetch=fetch;s.close();}
});

test('one-sided and repeated repair expansion does not add hairline mesh strips on unchanged edges',()=>{
 const original=gridSkinMesh([0,0,60,60],6,6,'arm-bone');let mesh=extendRepairMesh(original,[0,-12,60,72]);
 assert.equal(Math.min(...mesh.uvs.map(v=>v[0])),0);assert.equal(Math.max(...mesh.uvs.map(v=>v[0])),60);assert.equal(Math.max(...mesh.uvs.map(v=>v[1])),60);
 assert.deepEqual(mesh.vertices.slice(0,original.vertices.length),original.vertices);assert.deepEqual(mesh.weights.slice(0,original.weights.length),original.weights);
 for(const frame of [[0,-24,60,84],[-.01,-24,60.01,84],[-4,-30,70,94]] as [number,number,number,number][]){mesh=extendRepairMesh(mesh,frame);for(let i=0;i<mesh.triangles.length;i+=3){const [a,b,c]=mesh.triangles.slice(i,i+3).map(j=>mesh.uvs[j]),area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])),longest=Math.max(Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(a[0]-c[0],a[1]-c[1]),Math.hypot(b[0]-c[0],b[1]-c[1]));assert.ok(area/longest>=.5,JSON.stringify({i,a,b,c,altitude:area/longest}));}assert.equal(extendRepairMesh(mesh,frame),mesh);}
});
