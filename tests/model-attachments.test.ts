import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Group,Bone,Vector3} from 'three';
import {ModelAttachments} from '../src/ui/model-attachments';
import {normalizeModelAttachments} from '../src/shared/model-attachments';
import {Workbenches} from '../electron/workbenches';
import {defaultModelEditor} from '../src/shared/types';
const fixture=()=>Uint8Array.from(readFileSync('tests/fixtures/dancing.fbx')).buffer;
test('FBX instances parent to exact bones, follow motion, reparent, restore and dispose independently',()=>{
 const root=new Group(),a=new Bone(),b=new Bone();a.name=b.name='duplicate';root.scale.setScalar(.01);root.add(a,b);a.position.set(10,20,0);b.position.set(-10,0,0);
 const attachments=new ModelAttachments(root),item={id:'one',assetId:'asset',name:'Prop.fbx',parentPath:attachments.parent(a.uuid).path};
 const prop=attachments.add(item,fixture()),second=attachments.add({...item,id:'two'},fixture());assert.equal(prop.parent,a);assert.notEqual(prop,second);assert.deepEqual(prop.position.toArray(),[0,0,0]);
 const before=prop.getWorldPosition(new Vector3());a.position.x+=50;root.updateMatrixWorld(true);assert.ok(Math.abs(prop.getWorldPosition(new Vector3()).x-before.x-.5)<1e-6);
 const changed={...item,parentPath:attachments.parent(b.uuid).path};attachments.sync([changed]);assert.equal(prop.parent,b);assert.equal(second.parent,null);assert.equal(attachments.objects.size,1);
 assert.throws(()=>attachments.parent(prop.uuid));assert.throws(()=>attachments.target([999]));attachments.sync([]);assert.equal(prop.parent,null);
 const fresh=new Group(),freshA=new Bone(),freshB=new Bone();fresh.add(freshA,freshB);const restored=new ModelAttachments(fresh);assert.equal(restored.add(changed,fixture()).parent,freshB);restored.sync([]);
});
test('attachment persistence validates references and removes references when the source is deleted',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'attachments-')),vault={secure:false,get:()=>undefined,set:()=>{}},manager=new Workbenches(dir,vault,()=>{}),entry=manager.create('motion-editor'),service=manager.get(entry.id);
 try{const [asset]=await service.importFiles([{name:'prop.fbx',bytes:fixture()}]),item={id:'one',assetId:asset.id,name:'prop.fbx',parentPath:[0,2,3]};service.saveModelEditor({...defaultModelEditor(),attachments:[item]});assert.deepEqual(service.store.load().modelEditor?.attachments,[item]);
 assert.throws(()=>service.saveModelEditor({...defaultModelEditor(),attachments:[{...item,assetId:'foreign'}]}));assert.throws(()=>normalizeModelAttachments([item,item],()=>true));assert.throws(()=>normalizeModelAttachments([{...item,parentPath:[-1]}],()=>true));
 manager.close();const restored=new Workbenches(dir,vault,()=>{});try{const s=restored.get(entry.id);assert.deepEqual(s.workspace.modelEditor?.attachments,[item]);await s.deleteModel(asset.id,async()=>{});assert.deepEqual(s.workspace.modelEditor?.attachments,[]);}finally{restored.close();}
 }finally{manager.close();}
});
