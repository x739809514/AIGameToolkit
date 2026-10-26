import type {CutoutDocument} from '../shared/cutout-studio';
import {rasterCutout,renderCutout} from './cutout-render';
/** Include separate indexed cutouts so occluded parts can still be identified. */
export function cutoutPartAtlas(doc:CutoutDocument,images:Map<string,HTMLImageElement>):string {
 const columns=Math.min(8,doc.rig.parts.length),cv=document.createElement('canvas');cv.width=columns*160;cv.height=Math.ceil(doc.rig.parts.length/columns)*64;
 const c=cv.getContext('2d')!;c.fillStyle='#263344';c.fillRect(0,0,cv.width,cv.height);
 doc.rig.parts.forEach((p,index)=>{const a=doc.artwork.find(a=>a.partId===p.id)!,im=images.get(p.id);if(!im)throw Error('部件图片尚未载入。');const r=rasterCutout(a,p,im,doc.rig.canvas),sample=document.createElement('canvas'),ratio=Math.min(1,128/Math.max(r.canvas.width,r.canvas.height));sample.width=Math.max(1,Math.ceil(r.canvas.width*ratio));sample.height=Math.max(1,Math.ceil(r.canvas.height*ratio));const sc=sample.getContext('2d')!;sc.drawImage(r.canvas,0,0,sample.width,sample.height);const pixels=sc.getImageData(0,0,sample.width,sample.height).data;let left=sample.width,top=sample.height,right=-1,bottom=-1;for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++)if(pixels[(y*sample.width+x)*4+3]>8){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  const x=(index%columns)*160,y=Math.floor(index/columns)*64;c.strokeStyle='#526176';c.strokeRect(x,y,160,64);c.fillStyle='white';c.font='12px sans-serif';c.fillText(String(index+1),x+5,y+15);if(right>=left){const w=(right-left+1)/ratio,h=(bottom-top+1)/ratio,fit=Math.min(125/w,54/h);c.drawImage(r.canvas,left/ratio,top/ratio,w,h,x+30+(125-w*fit)/2,y+5+(54-h*fit)/2,w*fit,h*fit);}
 });return cv.toDataURL('image/png');
}
export function cutoutAssemblyImage(doc:CutoutDocument,images:Map<string,HTMLImageElement>):string {const cv=document.createElement('canvas');[cv.width,cv.height]=doc.rig.canvas;renderCutout(cv.getContext('2d')!,doc,images,{});return cv.toDataURL('image/png');}
