import {motionViewBounds,type MotionRect,type PartBounds} from '../shared/cutout-motion-geometry';
import type {CutoutDocument,CutoutArtwork} from '../shared/cutout-studio';
import type {Clip2D,MotionPose2D} from '../shared/skeletal2d';
import {cutoutAlphaBounds} from './cutout-render';

const cache=new WeakMap<CutoutArtwork,{crop:string;rect:MotionRect}>();
export function cutoutMotionBounds(doc:CutoutDocument,images:Map<string,HTMLImageElement>,clip?:Clip2D,extra?:MotionPose2D,skinning=true):MotionRect {
 const bounds:PartBounds={};
 for(const p of doc.rig.parts){const a=doc.artwork.find(a=>a.partId===p.id)!,im=images.get(p.id);if(!im)continue;const crop=JSON.stringify(p.crop),saved=cache.get(a);if(saved?.crop===crop){bounds[p.id]=saved.rect;continue;}
  try{const rect=cutoutAlphaBounds(a,p,im,doc.rig.canvas);cache.set(a,{crop,rect});bounds[p.id]=rect;}catch{bounds[p.id]=p.crop;}
 }
 const rig={...doc.rig,parts:doc.rig.parts.map(p=>({...p,visible:doc.artwork.find(a=>a.partId===p.id)?.visible!==false}))};
 return motionViewBounds(rig,clip,bounds,extra,skinning);
}
export function motionCanvasSize(rect:MotionRect,max=1024):[number,number]{const scale=Math.min(1,max/Math.max(rect[2],rect[3]));return [Math.max(1,Math.ceil(rect[2]*scale)),Math.max(1,Math.ceil(rect[3]*scale))];}
export function applyMotionView(c:CanvasRenderingContext2D,rect:MotionRect){const scale=Math.min(c.canvas.width/rect[2],c.canvas.height/rect[3]);c.setTransform(scale,0,0,scale,(c.canvas.width-rect[2]*scale)/2-rect[0]*scale,(c.canvas.height-rect[3]*scale)/2-rect[1]*scale);c.canvas.dataset.motionView=JSON.stringify(rect);return scale;}
