import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detailMotionClip,deformPoint,type MotionRegionAction,type MotionChannelAction} from '../src/shared/cutout-motion-detail';
import {gridSkinMesh} from '../src/shared/cutout-skinning';
import {sampleMotion2D,validateRig2D,type Rig2D,type Clip2D} from '../src/shared/skeletal2d';
import {motionGeometry,motionHasVisibleChange,motionViewBounds} from '../src/shared/cutout-motion-geometry';
import {directorChecks,directorMotionReport,directorLocalAction} from '../src/shared/cutout-director';
import {removeCutoutPart,type CutoutDocument} from '../src/shared/cutout-studio';
import {PNG} from 'pngjs';

const bounds={body:[0,0,100,200] as [number,number,number,number],cape:[100,0,80,200] as [number,number,number,number]};
function fixture():Rig2D{return {format:'laputa-cutout-experiment',version:1,revision:0,sourceHash:'a'.repeat(64),canvas:[200,240],bones:[{id:'root',origin:[0,0],rotation:0},{id:'body',name:'身体',parent:'root',origin:[50,0],rotation:0},{id:'head',parent:'body',origin:[0,-20],rotation:0},{id:'shoulder',parent:'body',origin:[30,40],rotation:0,limits:{min:-10,max:10}}],parts:Object.entries(bounds).map(([id,crop],i)=>({id,bone:'body',asset:`parts/${id}.png`,crop,z:i,role:'source',mesh:gridSkinMesh(crop,8,12,'body')})),clips:[{id:'rest',duration:4,loop:true,interpolation:'linear',keys:[{time:0,rotations:{head:0},parts:{body:{opacity:1}}},{time:1,rotations:{head:10},parts:{body:{opacity:.6}}},{time:4,rotations:{head:0},parts:{body:{opacity:1}}}]}]};}
const wave={channel:'scaleX' as const,offset:1,amplitude:.15,cycles:1,delay:0,wave:'breath' as const,peak:.4};
const chest:MotionRegionAction={tool:'animate_region',regionId:'chest',partId:'body',centerX:.5,centerY:.3,radiusX:.65,radiusY:.3,falloff:'radial',...wave};
const head:MotionChannelAction={tool:'animate_channel',target:'bone',targetId:'head',...wave,channel:'rotation',offset:0,amplitude:5,delay:.3};
function doc(rig:Rig2D):CutoutDocument {const png=new PNG({width:8,height:8});png.data.fill(255);return {format:'laputa-cutout-studio',version:1,revision:0,name:'细节',rig,artwork:rig.parts.map(p=>({partId:p.id,name:p.id,bitmap:'data:image/png;base64,'+PNG.sync.write(png).toString('base64'),visible:true,locked:false,opacity:1,strokes:[]}))};}

test('independent chest and abdomen deformation stays local, preserves UVs/weights, and survives JSON export',()=>{
 const rig=fixture(),original=structuredClone(rig);let clip=detailMotionClip(rig,rig.clips[0],chest,bounds,'details');
 clip=detailMotionClip(rig,clip,{...chest,regionId:'belly',centerY:.75,radiusY:.2,channel:'y',offset:0,amplitude:4,delay:.25},bounds,'details');
 const first=motionGeometry(rig,sampleMotion2D(clip,0)),mid=motionGeometry(rig,sampleMotion2D(clip,1.6));
 assert.deepEqual(first[1].points,mid[1].points);assert.notDeepEqual(first[0].points,mid[0].points);assert.deepEqual(first[0].points[0],mid[0].points[0]);
 assert.ok(motionHasVisibleChange(rig,clip));assert.deepEqual(rig,original);assert.deepEqual(clip.keys[0].deforms,clip.keys.at(-1)!.deforms);
 assert.deepEqual(sampleMotion2D(JSON.parse(JSON.stringify(clip)),1.6),sampleMotion2D(clip,1.6));assert.equal(directorChecks(rig,clip).length,0);
 const report=directorMotionReport(rig,clip);assert.ok(report.parts[0].maxDisplacement>1);assert.equal(report.parts[1].maxDisplacement,0);
});
test('changing one region/channel replaces it without accumulating or moving unrelated channels',()=>{
 const rig=fixture(),base=rig.clips[0],first=detailMotionClip(rig,base,chest,bounds,'detail');
 let clip=detailMotionClip(rig,first,{...chest,amplitude:.06},bounds,'detail');const again=detailMotionClip(rig,clip,{...chest,amplitude:.06},bounds,'detail');assert.deepEqual(clip,again);
 for(let t=0;t<=4;t+=.125){assert.ok(Math.abs(sampleMotion2D(base,t).rotations.head-sampleMotion2D(clip,t).rotations.head)<1e-8);assert.equal(sampleMotion2D(base,t).parts.body.opacity,sampleMotion2D(clip,t).parts.body.opacity);}
 clip=detailMotionClip(rig,clip,head,bounds,'detail');assert.deepEqual(clip.deformRegions,first.deformRegions);assert.ok(Math.abs(sampleMotion2D(clip,1.9).rotations.head-5)<.02);
 assert.ok(Math.abs(sampleMotion2D(clip,1.6).rotations.head-5)>.1);assert.deepEqual(clip.keys[0].rotations,clip.keys.at(-1)!.rotations);
});
test('cape tip remains pinned while the lower mesh bends; bounds include deformation',()=>{
 const rig=fixture(),clip=detailMotionClip(rig,rig.clips[0],{...chest,partId:'cape',regionId:'cape',centerY:0,radiusY:1,falloff:'tip',channel:'x',offset:0,amplitude:80},bounds,'cape');
 const geometry=motionGeometry(rig,sampleMotion2D(clip,1.6));assert.deepEqual(geometry[1].points[0],[100,0]);assert.ok(geometry[1].points.at(-1)![0]>250);assert.ok(motionViewBounds(rig,clip)[2]>250);
 assert.deepEqual(deformPoint([100,0],Object.values(sampleMotion2D(clip,1.6).deforms!)),[100,0]);
});
test('nonloop curves return to the setup offset, obey bone limits, and reject malformed or unknown targets',()=>{
 const rig=fixture(),base={...rig.clips[0],loop:false},clip=detailMotionClip(rig,base,{...head,targetId:'shoulder',amplitude:80,offset:2},bounds,'single');
 assert.equal(clip.keys[0].rotations.shoulder,2);assert.equal(clip.keys.at(-1)!.rotations.shoulder,2);assert.ok(clip.keys.every(k=>k.rotations.shoulder<=10));
 for(const bad of [{...head,cycles:0},{...head,amplitude:NaN},{...head,targetId:'missing'},{...chest,radiusX:0},{...chest,partId:'missing'}])assert.throws(()=>detailMotionClip(rig,base,bad,bounds,'invalid'));
 const corrupt=detailMotionClip(rig,base,chest,bounds,'bad');corrupt.keys[0].deforms!.missing={x:1};assert.throws(()=>validateRig2D({...rig,clips:[corrupt]}),/deformation/);
});
test('local tools preserve saved clips, respect locks, retime and amplify deformation, and remove orphan region tracks',()=>{
 const d=doc(fixture()),source=structuredClone(d),result=directorLocalAction(d,chest,bounds,'rest','candidate'),clip=result.doc.rig.clips.at(-1)!;assert.deepEqual(d,source);
 const adjusted=directorLocalAction(result.doc,{tool:'adjust_motion',boneIds:[],amplitude:.5,duration:8,name:'轻一些'},bounds,'candidate','candidate').doc;
 assert.equal(adjusted.rig.clips.length,2);assert.equal(adjusted.rig.clips.at(-1)!.duration,8);const originalScale=sampleMotion2D(clip,1.6).deforms!.chest.transform.scaleX!;assert.ok(Math.abs(sampleMotion2D(adjusted.rig.clips.at(-1)!,3.2).deforms!.chest.transform.scaleX!-(1+(originalScale-1)*.5))<1e-8);
 const locked=structuredClone(d);locked.artwork[0].locked=true;assert.throws(()=>directorLocalAction(locked,chest,bounds,'rest','x'),/锁定/);assert.throws(()=>directorLocalAction(locked,{...head,targetId:'root'},bounds,'rest','x'),/锁定/);
 const removed=removeCutoutPart(result.doc,'body');assert.equal(Object.keys(removed.rig.clips.at(-1)!.deformRegions!).length,0);assert.ok(removed.rig.clips.at(-1)!.keys.every(k=>!Object.keys(k.deforms??{}).length));
});
