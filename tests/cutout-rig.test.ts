import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {PNG} from 'pngjs';
import {proposalRig,editRigJoint,deleteRigJoint,type CutoutRigProposal} from '../src/shared/cutout-rig';
import {worldBones2D,partTransforms2D,transform2D,type Rig2D} from '../src/shared/skeletal2d';
import {Service} from '../electron/service';import {Store} from '../electron/store';import type {CutoutDocument} from '../src/shared/cutout-studio';
const fixture=():Rig2D=>({format:'laputa-cutout-experiment',version:1,revision:0,canvas:[100,100],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[40,40],rotation:30},{id:'arm',parent:'root',origin:[10,0],rotation:20},{id:'hand',parent:'arm',origin:[20,0],rotation:10}],parts:[{id:'part',asset:'parts/part.png',crop:[10,20,10,10],offset:[4,7],bone:'hand',z:1,role:'source'}],clips:[]});
const proposal=():CutoutRigProposal=>({notes:'肘部遮挡，建议检查',bones:[{id:'root',name:'根节点',parent:null,x:.5,y:.5},{id:'elbow',name:'肘关节',parent:'root',x:.7,y:.6}],bindings:[{partId:'part',boneId:'elbow'}]});
const near=(a:number[],b:number[])=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-7,`${a} != ${b}`));
test('generated skeleton converts normalized world coordinates, binds every part and retains source placement',()=>{const r=fixture(),next=proposalRig(r,proposal());near(worldBones2D(next).get('elbow')!.slice(4),[70,60]);assert.equal(next.parts[0].bone,'elbow');assert.deepEqual(next.parts[0].crop,r.parts[0].crop);assert.deepEqual(next.parts[0].offset,r.parts[0].offset);near(partTransforms2D(next).get('part')!,partTransforms2D(r).get('part')!);assert.equal(next.clips[0].id,'rest');});
test('AI candidates reject cyclic, missing, duplicate or invalid bindings and coordinates',()=>{for(const mutate of [(p:CutoutRigProposal)=>p.bones[1].parent='elbow',(p:CutoutRigProposal)=>p.bones[1].parent='missing',(p:CutoutRigProposal)=>p.bones[1].x=NaN,(p:CutoutRigProposal)=>p.bones[1].y=1.2,(p:CutoutRigProposal)=>p.bindings[0].partId='unknown',(p:CutoutRigProposal)=>p.bindings.push(p.bindings[0]),(p:CutoutRigProposal)=>p.bones[1].id='root']){const p=proposal();mutate(p);assert.throws(()=>proposalRig(fixture(),p));}});
test('moving/reparenting setup joints keeps descendants and image registration even with rotated parents',()=>{const r=fixture(),before=worldBones2D(r),moved=editRigJoint(r,'arm',[80,20]);near(worldBones2D(moved).get('hand')!,before.get('hand')!);near(worldBones2D(moved).get('arm')!.slice(4),[80,20]);near(partTransforms2D(moved).get('part')!,partTransforms2D(r).get('part')!);const point=before.get('hand')!.slice(4) as [number,number],reparented=editRigJoint(r,'hand',point,'root');near(worldBones2D(reparented).get('hand')!,before.get('hand')!);assert.equal(reparented.bones[2].parent,'root');assert.throws(()=>editRigJoint(r,'arm',[0,0],'hand'));});
test('setup subtree drag follows rotated hierarchies, keeps siblings, meshes and clips, and allows off-canvas joints',()=>{
 const r=fixture();r.bones.push({id:'sibling',parent:'root',origin:[-15,5],rotation:-45});
 r.parts[0].mesh={vertices:[[10,20],[20,20],[10,30]],uvs:[[0,0],[1,0],[0,1]],triangles:[0,1,2],weights:[[{bone:'arm',weight:.3},{bone:'hand',weight:.7}],[{bone:'hand',weight:1}],[{bone:'arm',weight:1}]]};
 r.clips=[{id:'idle',duration:1,keys:[{time:0,rotations:{arm:0}},{time:1,rotations:{arm:20}}]}];
 const original=structuredClone(r),before=worldBones2D(r),target:[number,number]=[-20,140],next=editRigJoint(r,'arm',target,undefined,true),after=worldBones2D(next),origin=before.get('arm')!;
 near(after.get('arm')!.slice(4),target);
 for(const id of ['root','sibling'])near(after.get(id)!,before.get(id)!);
 near(after.get('hand')!.slice(4),[before.get('hand')![4]+target[0]-origin[4],before.get('hand')![5]+target[1]-origin[5]]);
 near(after.get('hand')!.slice(0,4),before.get('hand')!.slice(0,4));
 near(partTransforms2D(next).get('part')!,partTransforms2D(r).get('part')!);
 assert.deepEqual(next.parts,r.parts);assert.deepEqual(next.clips,r.clips);assert.deepEqual(r,original);
 const all=worldBones2D(editRigJoint(r,'root',[-20,-30],undefined,true));
 for(const b of r.bones)near(all.get(b.id)!.slice(4),[before.get(b.id)![4]-60,before.get(b.id)![5]-70]);
 assert.throws(()=>editRigJoint(r,'arm',[Infinity,0],undefined,true));
 assert.throws(()=>editRigJoint(r,'arm',[0,0],'hand',true));
});
test('setup edits retain the registered sole position when moving a foot or its ancestors',()=>{
 const r=fixture();r.footRig={groundY:90,chains:[{id:'leg',name:'脚底',hip:'root',knee:'arm',foot:'hand',sole:[5,6],bend:1}]};
 const sole=transform2D(worldBones2D(r).get('hand')!,r.footRig.chains[0].sole);
 for(const [id,children] of [['hand',false],['arm',true],['root',true]] as const){
  const moved=editRigJoint(r,id,[30,-10],undefined,children);
  near(transform2D(worldBones2D(moved).get('hand')!,moved.footRig!.chains[0].sole),sole);
  assert.equal(moved.footRig!.groundY,90);assert.deepEqual(moved.parts,r.parts);
 }
});
test('deleting a joint reparents children and bindings, removes animation channels, protects root',()=>{const r=fixture();r.parts[0].bone='arm';r.clips=[{id:'test',duration:1,keys:[{time:0,rotations:{arm:0,hand:0}},{time:1,rotations:{arm:10,hand:20}}]}];const next=deleteRigJoint(r,'arm');assert.equal(next.parts[0].bone,'root');assert.equal(next.bones[1].parent,'root');near(worldBones2D(next).get('hand')!,worldBones2D(r).get('hand')!);assert.deepEqual(next.clips[0].keys[1].rotations,{hand:20});assert.throws(()=>deleteRigJoint(r,'root'));});
test('service generates a preview with vision, never mutates the saved rig, guards revisions and duplicate requests',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-rig-')),store=new Store(dir),service=new Service(store,{secure:false,get:()=> 'test-key',set:()=>{}},()=>{}),fetch=globalThis.fetch;let release:()=>void=()=>{},requests=0;
 try{const im=new PNG({width:100,height:100});im.data.fill(255);const image='data:image/png;base64,'+PNG.sync.write(im).toString('base64'),partImage=new PNG({width:10,height:10});partImage.data.fill(255);const d:CutoutDocument={format:'laputa-cutout-studio',version:1,revision:0,name:'测试',rig:fixture(),artwork:[{partId:'part',name:'前臂',bitmap:'data:image/png;base64,'+PNG.sync.write(partImage).toString('base64'),visible:true,locked:false,opacity:1,strokes:[]}]};service.workspace.workbenchType='cutout-studio';service.saveCutout(d,0);const before=structuredClone(service.workspace.cutoutStudio);
 globalThis.fetch=async(url,init)=>{requests++;assert.match(String(url),/responses$/);const body=JSON.parse(String(init?.body));assert.equal(body.input[0].content[1].image_url,image);assert.match(body.input[0].content[0].text,/前臂/);assert.match(body.instructions,/不强制人形/);await new Promise<void>(r=>release=r);return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(proposal())}]}]});};
 await assert.rejects(service.generateCutoutRig({image,revision:0}),/保存/);const pending=service.generateCutoutRig({image,revision:1});await assert.rejects(service.generateCutoutRig({image,revision:1}),/正在生成/);release();assert.deepEqual(await pending,proposal());assert.equal(requests,1);assert.deepEqual(service.workspace.cutoutStudio,before);
 globalThis.fetch=async()=>Response.json({status:'incomplete'});await assert.rejects(service.generateCutoutRig({image,revision:1}),/未完成/);globalThis.fetch=async()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{}'}]}]});await assert.rejects(service.generateCutoutRig({image,revision:1}),/格式/);
 }finally{globalThis.fetch=fetch;service.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('AI layer order is an exact permutation and changes only drawing depth',async()=>{
 const {proposalLayers}=await import('../src/shared/cutout-rig');const r=fixture();r.parts.push({...r.parts[0],id:'other',asset:'parts/other.png',z:5});const before=structuredClone(r),next=proposalLayers(r,{notes:'远侧在后',backToFront:['other','part']});assert.deepEqual(next.parts.map(p=>[p.id,p.z]),[['part',1],['other',0]]);assert.deepEqual(next.bones,r.bones);assert.deepEqual(next.clips,r.clips);assert.deepEqual(next.parts.map(({z,...p})=>p),r.parts.map(({z,...p})=>p));assert.deepEqual(r,before);
 for(const backToFront of [[],['part'],['part','part'],['part','missing'],['other','part','part'],[null,'part']])assert.throws(()=>proposalLayers(r,{notes:'',backToFront}));
});
test('bone tree includes empty bones and each part under its binding, independently of global draw order',async()=>{
 const {cutoutRigTree}=await import('../src/shared/cutout-rig');const r=fixture();r.parts.push({...r.parts[0],id:'torso',asset:'parts/torso.png',bone:'root',z:8});const tree=cutoutRigTree(r);assert.deepEqual(tree,{id:'root',partIds:['torso'],children:[{id:'arm',partIds:[],children:[{id:'hand',partIds:['part'],children:[]}]}]});const reparented=editRigJoint(r,'hand',[60,60],'root'),next=cutoutRigTree(reparented);assert.equal(next.children.length,2);assert.deepEqual(next.children[1].partIds,['part']);assert.deepEqual(next.children[0].children,[]);
});
test('layer vision validates atlas, revisions, exclusive analysis and output before any application',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-layers-')),store=new Store(dir),service=new Service(store,{secure:false,get:()=> 'test-key',set:()=>{}},()=>{}),fetch=globalThis.fetch;let release:()=>void=()=>{},requests=0;
 try{const imagePNG=new PNG({width:100,height:100});imagePNG.data.fill(255);const image='data:image/png;base64,'+PNG.sync.write(imagePNG).toString('base64'),partPNG=new PNG({width:10,height:10});partPNG.data.fill(255);const d:CutoutDocument={format:'laputa-cutout-studio',version:1,revision:0,name:'排布测试',rig:fixture(),artwork:[{partId:'part',name:'前臂',bitmap:'data:image/png;base64,'+PNG.sync.write(partPNG).toString('base64'),visible:true,locked:false,opacity:1,strokes:[]}]};service.workspace.workbenchType='cutout-studio';service.saveCutout(d,0);const before=structuredClone(service.workspace.cutoutStudio);
 globalThis.fetch=async(_url,init)=>{requests++;const body=JSON.parse(String(init?.body));assert.equal(body.text.format.name,'cutout_layers');assert.equal(body.input[0].content[2].image_url,image);const context=JSON.parse(body.input[0].content[0].text);assert.equal(context.parts[0].atlasIndex,1);assert.equal(context.parts[0].z,1);await new Promise<void>(r=>release=r);return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({notes:'保留顺序',backToFront:['part']})}]}]});};
 await assert.rejects(service.generateCutoutLayers({image,revision:0}),/保存/);await assert.rejects(service.generateCutoutLayers({image,revision:1,atlas:'https://invalid'}),/图集/);const pending=service.generateCutoutLayers({image,atlas:image,revision:1});await assert.rejects(service.generateCutoutRig({image,revision:1}),/正在生成/);release();assert.deepEqual(await pending,{notes:'保留顺序',backToFront:['part']});assert.deepEqual(service.workspace.cutoutStudio,before);assert.equal(requests,1);
 service.workspace.settings.openaiModel='fallback-vision';globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.response_format.json_schema.name,'cutout_layers');assert.equal(body.messages[1].content.length,3);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({notes:'',backToFront:['missing']})}}]});};await assert.rejects(service.generateCutoutLayers({image,atlas:image,revision:1}),/图层顺序/);assert.deepEqual(service.workspace.cutoutStudio,before);
 }finally{globalThis.fetch=fetch;service.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
