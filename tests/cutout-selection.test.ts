import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quickSelect,decodeSelection,encodeSelection,validateSelectionMask,type QuickSelectInput} from '../src/shared/cutout-selection';
function fixture(){const width=80,height=64,rgba=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const inside=(x-35)**2/400+(y-30)**2/225<=1,p=(y*width+x)*4;rgba.set(inside?[170+(x%5),60+(y%4),45,255]:[220,230,240,255],p);}return {width,height,rgba};}
function select(patch:Partial<QuickSelectInput>={}){return quickSelect({...fixture(),points:[[30,30],[36,30]],diameter:18,tolerance:28,mode:'add',...patch});}
test('quick selection grows beyond the painted interior and stops at contrasting irregular edges',()=>{
 const mask=decodeSelection(select());assert.equal(mask[30*80+17],1,'missed interior should be completed');assert.equal(mask[30*80+54],1);assert.equal(mask[30*80+57],0);assert.equal(mask[13*80+35],0);assert.equal(mask[30*80+35],1);
});
test('dominant stroke colour rejects a small overshoot into a contrasting background',()=>{
 const mask=decodeSelection(select({points:[[30,30],[40,30],[50,30],[57,30]],diameter:22}));assert.equal(mask[30*80+50],1);assert.equal(mask[30*80+57],0);assert.equal(mask[30*80+60],0);
});
test('small enclosed texture gaps are completed while transparent holes are retained',()=>{
 const f=fixture();for(let y=28;y<31;y++)for(let x=32;x<35;x++)f.rgba.set([10,10,10,255],(y*80+x)*4);
 f.rgba[(30*80+42)*4+3]=0;const mask=decodeSelection(select({...f}));assert.equal(mask[29*80+33],1);assert.equal(mask[30*80+42],0);
});
test('precise subtract and add preserve other selected regions and match the brush diameter',()=>{
 const previous=select(),removed=quickSelect({...fixture(),points:[[35,30]],diameter:8,tolerance:28,mode:'subtract',smart:false,previous});
 const mask=decodeSelection(removed);assert.equal(mask[30*80+35],0);assert.equal(mask[30*80+44],1);assert.equal(mask[30*80+20],1);
 const added=select({points:[[35,30]],diameter:8,smart:false,previous:removed});assert.deepEqual(decodeSelection(added),decodeSelection(previous));
});
test('transparent strokes are no-ops and empty selections survive encode/decode',()=>{
 const f=fixture();f.rgba.fill(0);assert.equal(decodeSelection(select({...f})).reduce((a,b)=>a+b,0),0);
 const pixels=Uint8Array.from([0,1,1,0,1,0]);assert.deepEqual(decodeSelection(encodeSelection(pixels,3,2)),pixels);
 assert.deepEqual(encodeSelection(new Uint8Array(16),4,4).runs,[16]);
});
test('invalid persisted masks and mismatched selection grids are rejected',()=>{
 for(const runs of [[10],[-1,17],[0,0,16],[NaN]])assert.throws(()=>validateSelectionMask({width:4,height:4,runs}));
 assert.throws(()=>validateSelectionMask({width:2048,height:1,runs:[2048]}));
 assert.throws(()=>select({previous:{width:4,height:4,runs:[16]}}));
});
test('dark cartoon outlines are retained without spilling into a light background',()=>{
 const f=fixture();for(let y=12;y<49;y++)for(let x=12;x<59;x++){const inner=x>=20&&x<=50&&y>=20&&y<=40,outline=x>=17&&x<=53&&y>=17&&y<=43;f.rgba.set(inner?[170,60,45,255]:outline?[10,10,10,255]:[230,235,240,255],(y*80+x)*4);}
 const mask=decodeSelection(select({...f,points:[[30,30],[38,30]],diameter:24}));assert.equal(mask[30*80+17],1);assert.equal(mask[30*80+16],0);
});
