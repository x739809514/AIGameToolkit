import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {cutoutFromRig,validateCutoutDocument,type CutoutDocument} from '../src/shared/cutout-studio';
import {Workbenches} from '../electron/workbenches';
function fixture(){const im=new PNG({width:2,height:2});im.data.fill(255);return cutoutFromRig({format:'laputa-cutout-experiment',version:1,revision:0,canvas:[100,100],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[50,50],rotation:0}],parts:[{id:'head',bone:'root',asset:'parts/head.png',crop:[20,20,2,2],z:0,role:'source'}],clips:[]},{'parts/head.png':'data:image/png;base64,'+PNG.sync.write(im).toString('base64')});}
test('editable masks, channel erasers and independent source pixels survive serialization',()=>{
 const d=fixture();d.artwork[0].mask=[[10,10],[40,10],[30,40]];d.artwork[0].strokes=[{id:'fill',kind:'polygon',channel:'fill',points:[[10,10],[20,10],[20,20]],color:'#ff0000',width:2},{id:'erase',kind:'erase',channel:'ink',points:[[10,15],[20,15]],color:'#000000',width:4}];
 assert.deepEqual(validateCutoutDocument(JSON.parse(JSON.stringify(d))),d);assert.equal(d.artwork[0].bitmap,fixture().artwork[0].bitmap);
});
test('reject incomplete layer registration and malformed editable data',()=>{
 const bads:((d:CutoutDocument)=>void)[]=[d=>{d.artwork=[];},d=>{d.artwork[0].mask=[[0,0],[1,1]];},d=>{d.artwork[0].bitmap='https://example.com/image.png';},d=>{d.artwork[0].opacity=NaN;},d=>{d.artwork[0].partId='missing';},d=>{d.artwork[0].strokes=[{id:'bad',kind:'brush',channel:'ink',color:'url(x)',width:4,points:[[1,1]]}];}];
 for(const bad of bads){const d=fixture();bad(d);assert.throws(()=>validateCutoutDocument(d));}
});
test('save revisions prevent overwrites; source dimensions and workbench isolation are enforced',()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-cutout-')),vault={secure:false,get:()=>undefined,set:()=>{}};let manager=new Workbenches(dir,vault,()=>{});
 try{const a=manager.create('cutout-studio'),b=manager.create('cutout-studio'),other=manager.create('image-video'),d=fixture();
  assert.equal(manager.get(a.id).saveCutout(d,0),1);assert.equal(manager.get(b.id).workspace.cutoutStudio,undefined);
  assert.throws(()=>manager.get(a.id).saveCutout({...d,name:'stale'},0),/另一窗口/);assert.equal(manager.get(a.id).workspace.cutoutStudio?.name,d.name);
  assert.throws(()=>manager.get(other.id).saveCutout(d,0),/二维角色绘制台/);
  const wrong=fixture();wrong.rig.parts[0].crop[2]=20;assert.throws(()=>manager.get(a.id).saveCutout(wrong,1),/尺寸/);
  manager.close();manager=new Workbenches(dir,vault,()=>{});assert.deepEqual(manager.get(a.id).workspace.cutoutStudio,{...d,revision:1});
 }finally{manager.close();rmSync(dir,{recursive:true,force:true});}
});
test('shared immutable PNGs are decoded once; changed bytes and registrations are still validated',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cutout-png-cache-')),manager=new Workbenches(dir,{secure:false,get:()=>undefined,set:()=>{}},()=>{}),board=manager.create('cutout-studio'),service=manager.get(board.id),d=fixture(),read=PNG.sync.read;let reads=0;
 d.rig.parts.push({...d.rig.parts[0],id:'copy',asset:'parts/copy.png'});d.artwork.push({...d.artwork[0],partId:'copy',name:'副本'});
 PNG.sync.read=(buffer,options)=>{reads++;return read(buffer,options);};
 try{
  service.saveCutout(d,0);assert.equal(reads,1);service.saveCutout({...d,name:'仅改选区'},1);assert.equal(reads,1);
  const wrong=structuredClone(d);wrong.rig.parts[1].crop[2]=3;assert.throws(()=>service.saveCutout(wrong,2),/尺寸/);assert.equal(reads,1);
  const changed=new PNG({width:3,height:2});changed.data.fill(255);wrong.rig.parts[1].crop[2]=2;wrong.artwork[1].bitmap='data:image/png;base64,'+PNG.sync.write(changed).toString('base64');assert.throws(()=>service.saveCutout(wrong,2),/尺寸/);assert.equal(reads,2);
 }finally{PNG.sync.read=read;manager.close();rmSync(dir,{recursive:true,force:true});}
});
test('fast document size validation still enforces the full serialized bitmap limit exactly',()=>{
 const d=fixture();for(let i=1;i<4;i++){d.rig.parts.push({...d.rig.parts[0],id:'part'+i,asset:'parts/part'+i+'.png'});d.artwork.push({...d.artwork[0],partId:'part'+i});}
 for(const a of d.artwork)a.bitmap='';const overhead=JSON.stringify(d).length,length=Math.floor((24_000_000-overhead)/4),prefix='data:image/png;base64,';const bitmap=prefix+'A'.repeat(length-prefix.length);for(const a of d.artwork)a.bitmap=bitmap;
 assert.ok(JSON.stringify(d).length<=24_000_000);assert.doesNotThrow(()=>validateCutoutDocument(d));assert.throws(()=>validateCutoutDocument({...d,extra:'x'.repeat(30)}),/容量/);
 for(const a of d.artwork)a.bitmap=bitmap.slice(0,-32);const escaped={...d,extra:{bitmap:'\n'.repeat(60)}};assert.ok(JSON.stringify(escaped).length>24_000_000);assert.throws(()=>validateCutoutDocument(escaped),/容量/);
});
