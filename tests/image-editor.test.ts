import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cropPNG,readPNG,validateMask,compositeSelection,hasTransparency} from '../electron/image-processing';
import {Store} from '../electron/store';
import {Service,type Vault} from '../electron/service';
import {cropRect} from '../src/ui/editor-canvas';
function picture(w=16,h=16,color=[20,50,80,255]){const p=new PNG({width:w,height:h});for(let i=0;i<p.data.length;i+=4)p.data.set(color,i);return PNG.sync.write(p);}
function mask(){const p=readPNG(picture(16,16,[255,255,255,255]));for(let y=4;y<12;y++)for(let x=4;x<12;x++)p.data[(y*16+x)*4+3]=0;return PNG.sync.write(p);}
function fixture(){const store=new Store(mkdtempSync(join(tmpdir(),'editor-test-')));const vault:Vault={secure:false,get:p=>p==='openai'?'test-only':undefined,set:()=>{}};return {store,service:new Service(store,vault,()=>{})};}
async function complete(service:Service,id:string){for(let i=0;i<400;i++){const t=service.workspace.tasks.find(t=>t.id===id)!;if(['succeeded','failed','submission_unknown'].includes(t.state))return t;await new Promise(r=>setTimeout(r,25));}throw new Error('task timeout');}
test('crop copies the exact requested pixels and preserves alpha',()=>{
 const source=readPNG(picture(4,4));source.data.set([200,100,50,0],(2*4+1)*4);const out=readPNG(cropPNG(PNG.sync.write(source),{x:1,y:2,width:2,height:1}));assert.equal(out.width,2);assert.equal(out.height,1);assert.deepEqual([...out.data.subarray(0,4)],[200,100,50,0]);assert.throws(()=>cropPNG(picture(),{x:15,y:0,width:2,height:1}),/范围/);
});
test('crop dragging is clamped to image coordinates in either direction',()=>{assert.deepEqual(cropRect({x:80,y:70},{x:20,y:10},100,100),{x:20,y:10,width:60,height:60});assert.deepEqual(cropRect({x:-5,y:-5},{x:200,y:200},100,100),{x:0,y:0,width:100,height:100});});
test('mask dimension and selection validation happens before generation',()=>{assert.throws(()=>validateMask(picture(),picture(8,8)),/尺寸/);assert.throws(()=>validateMask(picture(),picture(16,16,[255,255,255,255])),/圈选/);assert.equal(validateMask(picture(),mask()).width,16);});
test('compositing changes selected pixels and leaves every outside pixel identical',()=>{
 const original=picture(),generated=picture(16,16,[220,30,10,255]);const out=readPNG(compositeSelection(original,generated,mask()));const src=readPNG(original);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const index=(y*16+x)*4;assert.deepEqual([...out.data.subarray(index,index+4)],x>=4&&x<12&&y>=4&&y<12?[220,30,10,255]:[...src.data.subarray(index,index+4)]);}
});
test('local crop creates a derived asset without requiring an API key or changing the source file',async()=>{
 const {store,service}=fixture();service.vault={...service.vault,get:()=>undefined};try{const source=await service.assets.import('source.png',picture());service.workspace.assets.push(source);const original=service.assets.bytes(source);const next=await service.cropImage({assetId:source.id,x:2,y:3,width:7,height:8});assert.equal(next.width,7);assert.equal(next.height,8);assert.equal(next.sourceAssetId,source.id);assert.equal(next.imageAction,'crop');assert.ok(original.equals(service.assets.bytes(source)));assert.equal(service.workspace.selectedImageId,next.id);assert.equal(service.workspace.tasks.length,0);}finally{service.close();store.close();}
});
test('brush edits send aligned PNG mask to Images API and persist only changes inside selection',async()=>{
 const {store,service}=fixture();const originalFetch=globalThis.fetch;let called=0;
 globalThis.fetch=async(input,init)=>{called++;assert.equal(String(input),'https://api.openai.com/v1/images/edits');assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('size'),'auto');const source=init.body.get('image[]') as File;const file=init.body.get('mask') as File;assert.equal(source.type,'image/png');assert.equal(file.type,'image/png');validateMask(Buffer.from(await source.arrayBuffer()),Buffer.from(await file.arrayBuffer()));return Response.json({data:[{b64_json:picture(16,16,[200,0,0,255]).toString('base64')}]});};
 try{const source=await service.assets.import('source.png',picture());service.workspace.assets.push(source);const selection=mask();const task=await service.editImage({assetId:source.id,requestId:'masked',operation:'inpaint',prompt:'改成红色',mask:Uint8Array.from(selection).buffer});const done=await complete(service,task.id);assert.equal(done.state,'succeeded',done.error);assert.equal(called,1);assert.equal(done.imageEdit?.sourceAssetId,source.id);const asset=service.workspace.assets.find(a=>a.id===done.outputAssetIds[0])!;assert.equal(asset.imageAction,'inpaint');const pixels=readPNG(service.assets.bytes(asset));assert.deepEqual([...pixels.data.subarray(0,4)],[20,50,80,255]);assert.deepEqual([...pixels.data.subarray((8*16+8)*4,(8*16+8)*4+4)],[200,0,0,255]);assert.ok(readFileSync(join(service.assets.directory,done.imageEdit!.maskFile!)).equals(selection));}
 finally{globalThis.fetch=originalFetch;service.close();store.close();}
});
test('background removal requests transparent PNG and verifies transparent output',async()=>{
 const {store,service}=fixture();const originalFetch=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('background'),'transparent');assert.equal(init.body.get('output_format'),'png');assert.equal(init.body.get('mask'),null);return Response.json({data:[{b64_json:picture(16,16,[50,80,20,0]).toString('base64')}]});};
 try{const source=await service.assets.import('source.png',picture());service.workspace.assets.push(source);const task=await service.editImage({assetId:source.id,requestId:'background',operation:'remove_background',prompt:'保留头发细节'});const done=await complete(service,task.id);assert.equal(done.state,'succeeded',done.error);const asset=service.workspace.assets.find(a=>a.id===done.outputAssetIds[0])!;assert.equal(asset.imageAction,'remove_background');assert.ok(hasTransparency(service.assets.bytes(asset)));}
 finally{globalThis.fetch=originalFetch;service.close();store.close();}
});
test('text-only edits need no brush mask and save a new image while preserving the original',async()=>{
 const {store,service}=fixture();const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://api.openai.com/v1/images/edits');assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('mask'),null);assert.equal(init.body.get('prompt'),'把整张图片改成暖色风格');assert.equal(init.body.get('output_format'),'png');assert.equal(init.body.get('model'),'gpt-image-2.5-sunburst');const source=init.body.get('image[]') as File;assert.equal(readPNG(Buffer.from(await source.arrayBuffer())).width,16);return Response.json({data:[{b64_json:picture(16,16,[220,120,40,255]).toString('base64')}]});};
 try{
  const source=await service.assets.import('source.png',picture());service.workspace.assets.push(source);const original=service.assets.bytes(source);service.workspace.settings.optimize=true;
  const input={assetId:source.id,requestId:'text-edit',operation:'edit' as const,prompt:'把整张图片改成暖色风格'};
  const task=await service.editImage(input);const done=await complete(service,task.id);assert.equal(done.state,'succeeded',done.error);assert.equal(done.settings.optimize,false);assert.equal(done.imageEdit?.maskFile,undefined);
  const duplicate=await service.editImage(input);assert.equal(duplicate.id,task.id);assert.equal(calls,1);
  const result=service.workspace.assets.find(a=>a.id===done.outputAssetIds[0])!;assert.equal(result.imageAction,'edit');assert.equal(result.sourceAssetId,source.id);assert.equal(service.workspace.selectedImageId,result.id);assert.ok(original.equals(service.assets.bytes(source)));assert.deepEqual([...readPNG(service.assets.bytes(result)).data.subarray(0,4)],[220,120,40,255]);
 }finally{globalThis.fetch=originalFetch;service.close();store.close();}
});
test('text-only edits reject blank instructions and accidental masks before creating a task',async()=>{
 const {store,service}=fixture();try{
  const source=await service.assets.import('source.png',picture());service.workspace.assets.push(source);
  await assert.rejects(()=>service.editImage({assetId:source.id,requestId:'blank',operation:'edit',prompt:'   '}),/修改要求/);
  await assert.rejects(()=>service.editImage({assetId:source.id,requestId:'wrong-mask',operation:'edit',prompt:'修改颜色',mask:Uint8Array.from(mask()).buffer}),/不使用圈选遮罩/);
  assert.equal(service.workspace.tasks.length,0);
 }finally{service.close();store.close();}
});
