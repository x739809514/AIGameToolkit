import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCutoutDocument,upgradeCutoutWorkflow,commitCutoutPart,removeCutoutPart,reorderCutoutPart,type CutoutDocument} from '../src/shared/cutout-studio';
import {Workbenches} from '../electron/workbenches';
const png=new PNG({width:4,height:4});png.data.fill(255);const bitmap='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
function fixture():CutoutDocument{return {format:'laputa-cutout-studio',version:1,revision:0,name:'角色',reference:{name:'原图',bitmap},rig:{format:'laputa-cutout-experiment',version:1,revision:0,canvas:[4,4],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[2,2],rotation:0}],parts:[],clips:[]},artwork:[]};}
function draft(d:CutoutDocument,name:string,editingPartId?:string){return {...d,selectionDraft:{name,mask:{width:4,height:4,runs:[5,2,9]},...(editingPartId?{editingPartId}:{})}};}
test('continuous part creation keeps source intact and resets only the temporary draft',()=>{
 const original=fixture(),selected=draft(original,'头部');assert.equal(selected.artwork.length,0);assert.equal(selected.rig.parts.length,0);
 const a=commitCutoutPart(selected,'head'),b=commitCutoutPart(draft(a,'身体'),'torso');
 assert.equal(a.selectionDraft,undefined);assert.equal(b.artwork.length,2);assert.equal(b.reference,original.reference);assert.equal(b.reference?.bitmap,bitmap);assert.equal(a.artwork[0].visible,true);assert.equal(b.artwork[0],a.artwork[0]);assert.equal(b.artwork[1].bitmap,bitmap);assert.deepEqual(b.rig.parts.map(p=>p.crop),[[0,0,4,4],[0,0,4,4]]);
 assert.equal(original.artwork.length,0);assert.equal(selected.selectionDraft.name,'头部');
});
test('editing selection is isolated until confirmed and updates the existing part without cloning it',()=>{
 const a=commitCutoutPart(draft(fixture(),'头部'),'head'),before=a.artwork[0],editing=draft(a,'帽子','head');editing.selectionDraft.mask={width:4,height:4,runs:[0,8,8]};
 assert.equal(editing.artwork[0],before);const b=commitCutoutPart(editing,'ignored');assert.equal(b.artwork.length,1);assert.equal(b.artwork[0].partId,'head');assert.equal(b.artwork[0].name,'帽子');assert.equal(b.artwork[0].selectionMask?.runs[1],8);assert.equal(before.name,'头部');assert.equal(b.selectionDraft,undefined);
});
test('legacy source layers become references without affecting previously extracted parts',()=>{
 const d=fixture();delete d.reference;d.artwork=[{partId:'source',name:'角色源图',bitmap,visible:false,locked:false,opacity:1,selectionMask:{width:4,height:4,runs:[5,2,9]},strokes:[]}];d.rig.parts=[{id:'source',bone:'root',asset:'parts/source.png',crop:[0,0,4,4],z:0,role:'source'}];
 const migrated=upgradeCutoutWorkflow(d);assert.equal(migrated.artwork.length,0);assert.equal(migrated.reference?.bitmap,bitmap);assert.ok(migrated.selectionDraft?.mask);assert.equal(upgradeCutoutWorkflow(migrated),migrated);
 const head=commitCutoutPart({...migrated,selectionDraft:{...migrated.selectionDraft!,name:'头部'}},'head');const legacy={...d,rig:{...d.rig,parts:[...d.rig.parts,...head.rig.parts]},artwork:[...d.artwork,...head.artwork]};
 const upgraded=upgradeCutoutWorkflow(legacy);assert.deepEqual(upgraded.artwork,head.artwork);assert.equal(upgraded.selectionDraft,undefined);assert.equal(d.artwork.length,1);
});
test('reorder and removal preserve registrations; draft and name validation prevents invalid edits',()=>{
 const a=commitCutoutPart(draft(fixture(),'头部'),'head'),b=commitCutoutPart(draft(a,'身体'),'torso'),moved=reorderCutoutPart(b,'head','torso');
 assert.ok(moved.rig.parts.find(p=>p.id==='head')!.z>moved.rig.parts.find(p=>p.id==='torso')!.z);assert.deepEqual(moved.rig.parts.map(p=>p.crop),b.rig.parts.map(p=>p.crop));
 const removed=removeCutoutPart(draft(b,'头部','head'),'head');assert.equal(removed.selectionDraft,undefined);assert.equal(removed.artwork[0].partId,'torso');assert.equal(removed.reference,b.reference);
 assert.throws(()=>commitCutoutPart(draft(b,'头部'),'third'),/同名/);assert.throws(()=>commitCutoutPart(draft(b,' '),'third'),/名称/);assert.throws(()=>commitCutoutPart({...b,selectionDraft:{name:'空',mask:{width:4,height:4,runs:[16]}}},'third'),/涂选/);
 assert.throws(()=>validateCutoutDocument(draft(b,'失效','missing')),/临时/);
});
test('references and pending selections persist without being inserted into runtime parts',()=>{
 const directory=mkdtempSync(join(tmpdir(),'cutout-workflow-')),vault={secure:false,get:()=>undefined,set:()=>{}};let manager=new Workbenches(directory,vault,()=>{});
 try{const board=manager.create('cutout-studio'),d=draft(fixture(),'下一块');manager.get(board.id).saveCutout(d,0);manager.close();manager=new Workbenches(directory,vault,()=>{});const saved=manager.get(board.id).workspace.cutoutStudio!;assert.deepEqual(saved.selectionDraft,d.selectionDraft);assert.equal(saved.reference?.bitmap,bitmap);assert.equal(saved.rig.parts.length,0);
 const bad=fixture();bad.rig.canvas=[8,8];assert.throws(()=>manager.get(board.id).saveCutout(bad,1),/原图/);
 }finally{manager.close();rmSync(directory,{recursive:true,force:true});}
});

test('legacy polygon selections and source painting survive reference migration intact',()=>{
 const d=fixture();delete d.reference;d.rig.parts=[{id:'source',bone:'root',asset:'parts/source.png',crop:[0,0,4,4],z:0,role:'source'}];d.artwork=[{partId:'source',name:'角色源图',bitmap,visible:true,locked:false,opacity:1,mask:[[0,0],[4,0],[0,4]],strokes:[]}];
 const next=upgradeCutoutWorkflow(d);assert.equal(next.reference?.bitmap,bitmap);assert.deepEqual(next.artwork,d.artwork);assert.deepEqual(next.rig,d.rig);
 delete d.artwork[0].mask;d.artwork[0].strokes=[{id:'stroke',kind:'brush',channel:'fill',color:'#ffffff',width:1,points:[[1,1]]}];assert.deepEqual(upgradeCutoutWorkflow(d).artwork,d.artwork);
});
