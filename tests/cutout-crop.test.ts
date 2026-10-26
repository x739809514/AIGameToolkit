import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {fitCutoutCrop,dragCutoutCrop,validCutoutCrop} from '../src/shared/cutout-crop';
import {writeCutoutCropPNG,validateCutoutCropPNG} from '../electron/cutout-crop';
test('crop boxes draw in both directions, clamp within the source and keep the opposite resize edge fixed',()=>{
 const rect={x:20,y:30,width:100,height:80},start={x:20,y:30},end={x:120,y:110};
 assert.deepEqual(dragCutoutCrop(rect,start,end,'new',300,200),rect);assert.deepEqual(dragCutoutCrop(rect,end,start,'new',300,200),rect);
 assert.deepEqual(dragCutoutCrop(rect,start,{x:-100,y:500},'move',300,200),{x:0,y:120,width:100,height:80});
 assert.deepEqual(dragCutoutCrop(rect,start,{x:40,y:50},'nw',300,200),{x:40,y:50,width:80,height:60});
 assert.deepEqual(dragCutoutCrop(rect,start,{x:500,y:500},'se',300,200),{x:20,y:30,width:280,height:170});
 for(const edge of ['nw','n','ne','e','se','s','sw','w'])assert.ok(validCutoutCrop(dragCutoutCrop(rect,start,{x:-1000,y:1000},edge,300,200),300,200));
 assert.deepEqual(fitCutoutCrop({x:299.9,y:199,width:500,height:.1},300,200),{x:0,y:199,width:300,height:1});
 for(const invalid of [{...rect,width:0},{...rect,x:-1},{...rect,y:NaN},{...rect,width:1.5},{...rect,width:400}])assert.equal(validCutoutCrop(invalid,300,200),false);
});
test('PNG crop export preserves exact pixels and alpha, supports overwrite and rejects invalid data and special paths',()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-crop-'));try{const image=new PNG({width:3,height:2});image.data.set([20,40,60,128]);const raw=PNG.sync.write(image),bytes=Uint8Array.from(raw).buffer,path=writeCutoutCropPNG(join(dir,'view'),bytes);assert.deepEqual(readFileSync(path),raw);assert.equal(PNG.sync.read(readFileSync(path)).data[3],128);writeCutoutCropPNG(path,bytes);
 assert.throws(()=>validateCutoutCropPNG(new ArrayBuffer(30)));assert.throws(()=>validateCutoutCropPNG('bad'));const folder=join(dir,'folder.png');mkdirSync(folder);assert.throws(()=>writeCutoutCropPNG(folder,bytes));const link=join(dir,'link.png');symlinkSync(path,link);assert.throws(()=>writeCutoutCropPNG(link,bytes));assert.deepEqual(readFileSync(path),raw);assert.equal(readdirSync(dir).some(p=>p.endsWith('.tmp')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
