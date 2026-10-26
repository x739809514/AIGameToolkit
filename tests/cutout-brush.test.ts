import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cutoutBrushOutline,stabilizeCutoutPoint,simplifyCutoutContour} from '../src/shared/cutout-brush';
import {cutoutFromRig,validateCutoutDocument} from '../src/shared/cutout-studio';
test('a continuous pressure stroke has narrower ends and a single filled outline',()=>{
 const outline=cutoutBrushOutline([[0,0],[50,0],[100,0]],20,[.1,1,.1]);
 const near=(x:number)=>outline.filter(p=>Math.abs(p[0]-x)<.1).map(p=>Math.abs(p[1]));
 assert.ok(Math.max(...near(50))>9);assert.ok(Math.max(...near(0))<2);assert.ok(outline.every(p=>p.every(Number.isFinite)));
 const dot=cutoutBrushOutline([[20,20]],10);assert.equal(dot.length,24);assert.ok(Math.abs(Math.max(...dot.map(p=>p[0]))-25)<1e-8);
});
test('stabilizer reduces jitter and contour simplification preserves corners',()=>{
 assert.deepEqual(stabilizeCutoutPoint([0,0],[10,0],0),[10,0]);assert.ok(stabilizeCutoutPoint([0,0],[10,0],1)[0]<10);
 const contour=simplifyCutoutContour([[0,0],[5,.05],[10,0],[10,5],[10,10],[5,10],[0,10]],.1);assert.deepEqual(contour,[[0,0],[10,0],[10,10],[0,10]]);
});
test('pressure, softness and opacity persist; malformed pressure is rejected',()=>{
 const d=cutoutFromRig({format:'laputa-cutout-experiment',version:1,revision:0,canvas:[100,100],sourceHash:'a'.repeat(64),bones:[{id:'root',origin:[50,50],rotation:0}],parts:[{id:'part',bone:'root',asset:'parts/part.png',crop:[0,0,1,1],z:0,role:'source'}],clips:[]},{'parts/part.png':'data:image/png;base64,AAAA'});
 const stroke={id:'paint',kind:'brush' as const,channel:'fill' as const,color:'#123456',width:20,points:[[10,10],[20,20]] as [number,number][],renderer:2 as const,hardness:.4,opacity:.5,pressure:[.2,1]};d.artwork[0].strokes=[stroke];assert.deepEqual(validateCutoutDocument(JSON.parse(JSON.stringify(d))),d);
 for(const patch of [{opacity:2},{hardness:NaN},{pressure:[1]},{pressure:[1,-.2]},{renderer:3}])assert.throws(()=>validateCutoutDocument({...d,artwork:[{...d.artwork[0],strokes:[{...stroke,...patch}]}]}));
});
