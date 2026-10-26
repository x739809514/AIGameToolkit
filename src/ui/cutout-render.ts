import {partMotionAdjustment} from '../shared/cutout-motion-geometry';
import {skinMatrices,skinVertices} from '../shared/cutout-skinning';
import {drawSkinnedMesh} from './cutout-mesh-render';
import {decodeSelection,type CutoutSelectionMask} from '../shared/cutout-selection';
import {unzipSync,zipSync} from 'fflate';
import {cutoutFromRig,validateCutoutDocument,type CutoutDocument,type CutoutArtwork,type CutoutStroke} from '../shared/cutout-studio';
import {partTransforms2D,worldBones2D,inverse2D,transform2D,type MotionPose2D,type Point2D,type Part2D} from '../shared/skeletal2d';
import {cutoutBrushOutline} from '../shared/cutout-brush';
const b64=(v:Uint8Array)=>{let s='';for(let i=0;i<v.length;i+=8192)s+=String.fromCharCode(...v.subarray(i,i+8192));return btoa(s);};
const bytes=(v:string)=>Uint8Array.from(atob(v.split(',').at(-1)!),c=>c.charCodeAt(0));
export const cutoutDigest=async(v:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(v)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const loadCutoutImage=(url:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('图层 PNG 无法读取。'));im.src=url;});
export async function prepareCutout(d:CutoutDocument,pool=new Map<string,Promise<HTMLImageElement>>()){
 const used=new Set([...(d.reference?[d.reference.bitmap]:[]),...d.artwork.flatMap(a=>[a.bitmap,...(a.variants??[]).map(v=>v.bitmap)])]);for(const bitmap of pool.keys())if(!used.has(bitmap))pool.delete(bitmap);
 const load=(bitmap:string)=>{let pending=pool.get(bitmap);if(!pending){pending=loadCutoutImage(bitmap).catch(error=>{pool.delete(bitmap);throw error;});pool.set(bitmap,pending);}return pending;};
 const result=new Map<string,HTMLImageElement>();
 if(d.reference){const im=await load(d.reference.bitmap);if(im.width!==d.rig.canvas[0]||im.height!==d.rig.canvas[1])throw Error('参考原图与画布尺寸不符。');result.set('__reference__',im);}
 await Promise.all(d.artwork.map(async(a)=>{const im=await load(a.bitmap),p=d.rig.parts.find(p=>p.id===a.partId)!;if(im.width!==p.crop[2]||im.height!==p.crop[3])throw Error('图层 PNG 尺寸与注册不符。');result.set(a.partId,im);for(const v of a.variants??[]){const vi=await load(v.bitmap);if(vi.width>4096||vi.height>4096)throw Error('替换图超过4096px。');result.set(a.partId+':'+v.id,vi);}}));return result;
}
function path(c:CanvasRenderingContext2D,p:Point2D[],curve=false){
 c.beginPath();c.moveTo(...p[0]);
 if(curve&&p.length>2){for(let i=1;i<p.length-1;i++)c.quadraticCurveTo(...p[i],(p[i][0]+p[i+1][0])/2,(p[i][1]+p[i+1][1])/2);c.lineTo(...p.at(-1)!);}else p.slice(1).forEach(q=>c.lineTo(...q));
}
export function paintCutoutStroke(c:CanvasRenderingContext2D,s:CutoutStroke){
 c.save();c.globalCompositeOperation=s.kind==='erase'?'destination-out':'source-over';c.globalAlpha=s.opacity??1;c.strokeStyle=c.fillStyle=s.color;c.lineWidth=s.width;c.lineCap=c.lineJoin='round';
 if(s.renderer===2&&s.kind!=='polygon'){
  const outline=cutoutBrushOutline(s.points,s.width,s.pressure,true);
  if((s.hardness??1)<1)c.filter=`blur(${(1-(s.hardness??1))*s.width*.25}px)`;
  if(outline.length){path(c,outline);c.closePath();c.fill();}c.restore();return;
 }
 path(c,s.points,s.kind==='curve');
 if(s.kind==='polygon'){c.closePath();c.fill();}else if(s.points.length===1){c.beginPath();c.arc(...s.points[0],s.width/2,0,Math.PI*2);c.fill();}else c.stroke();c.restore();
}
const selectionCache=new WeakMap<CutoutSelectionMask,HTMLCanvasElement>();
export function selectionCanvas(mask:CutoutSelectionMask){
 const found=selectionCache.get(mask);if(found)return found;
 const cv=document.createElement('canvas');cv.width=mask.width;cv.height=mask.height;
 const c=cv.getContext('2d')!,image=c.createImageData(mask.width,mask.height),pixels=decodeSelection(mask);
 for(let i=0;i<pixels.length;i++)if(pixels[i]){image.data[i*4]=65;image.data[i*4+1]=220;image.data[i*4+2]=200;image.data[i*4+3]=255;}
 c.putImageData(image,0,0);selectionCache.set(mask,cv);return cv;
}
export interface CutoutRaster {canvas:HTMLCanvasElement;x:number;y:number}
const cache=new WeakMap<CutoutArtwork,CutoutRaster>();
export function rasterCutout(a:CutoutArtwork,p:Part2D,im:HTMLImageElement,canvasSize?:Point2D):CutoutRaster {
 const found=cache.get(a);if(found)return found;
 let [x,y,w,h]=p.crop,r=x+w,b=y+h;
 for(const s of a.strokes)for(const q of s.points){const pad=s.width*1.5+3;x=Math.min(x,Math.floor(q[0]-pad));y=Math.min(y,Math.floor(q[1]-pad));r=Math.max(r,Math.ceil(q[0]+pad));b=Math.max(b,Math.ceil(q[1]+pad));}
 const make=()=>{const cv=document.createElement('canvas');cv.width=r-x;cv.height=b-y;cv.getContext('2d')!.translate(-x,-y);return cv;};
 const fill=make(),c=fill.getContext('2d')!;c.drawImage(im,...p.crop);a.strokes.filter(s=>s.channel==='fill').forEach(s=>paintCutoutStroke(c,s));
 const ink=make(),ic=ink.getContext('2d')!;a.strokes.filter(s=>s.channel==='ink').forEach(s=>paintCutoutStroke(ic,s));c.drawImage(ink,x,y);
 if(a.mask){c.globalCompositeOperation='destination-in';path(c,a.mask);c.closePath();c.fill();c.globalCompositeOperation='source-over';}
 if(a.selectionMask){if(!canvasSize)throw Error('像素遮罩缺少画布尺寸。');c.globalCompositeOperation='destination-in';c.drawImage(selectionCanvas(a.selectionMask),0,0,...canvasSize);c.globalCompositeOperation='source-over';}
 const result={canvas:fill,x,y};cache.set(a,result);return result;
}
export function renderCutout(c:CanvasRenderingContext2D,d:CutoutDocument,images:Map<string,HTMLImageElement>,pose:Record<string,number>={},options:{selected?:string;solo?:boolean;fills?:boolean;motion?:MotionPose2D;meshWire?:boolean;skinning?:boolean}={}){
 c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,c.canvas.width,c.canvas.height);c.restore();const motion=options.motion,transforms=partTransforms2D(d.rig,pose,motion?.bones),bind=worldBones2D(d.rig),skin=d.rig.parts.some(p=>p.mesh)?skinMatrices(d.rig,{rotations:pose,bones:motion?.bones??{},parts:motion?.parts??{}}):undefined;
 for(const p of [...d.rig.parts].sort((a,b)=>(motion?.parts[a.id]?.z??a.z)-(motion?.parts[b.id]?.z??b.z))){
  const a=d.artwork.find(a=>a.partId===p.id)!,state=motion?.parts[p.id]??{},im=images.get(state.variant?p.id+':'+state.variant:p.id);if(!(state.visible??a.visible)||!im||options.solo&&p.id!==options.selected||options.fills===false&&p.role==='joint-fill')continue;
  if(p.mesh&&skin&&options.skinning!==false){let raster:CutoutRaster;if(state.variant){const cv=document.createElement('canvas');cv.width=p.crop[2];cv.height=p.crop[3];cv.getContext('2d')!.drawImage(im,0,0,cv.width,cv.height);raster={canvas:cv,x:p.crop[0],y:p.crop[1]};}else raster=rasterCutout(a,p,im,d.rig.canvas);
   const adjust=partMotionAdjustment(p,bind.get(p.bone)!,state);c.save();c.globalAlpha=a.opacity*(state.opacity??1);drawSkinnedMesh(c,raster.canvas,[raster.x,raster.y],p.mesh,skinVertices(p,skin,adjust,motion?.deforms),options.meshWire);c.restore();continue;}
  c.save();c.transform(...transforms.get(p.id)!);c.transform(...partMotionAdjustment(p,bind.get(p.bone)!,state));
  c.globalAlpha=a.opacity*(state.opacity??1);if(state.variant)c.drawImage(im,...p.crop);else{const raster=rasterCutout(a,p,im,d.rig.canvas);c.drawImage(raster.canvas,raster.x,raster.y);}c.restore();
 }
}

export async function readCutoutPackage(v:Uint8Array):Promise<CutoutDocument>{
 if(v.byteLength>24_000_000)throw Error('角色包超过 24 MB。');
 let total=0;const files=unzipSync(v,{filter:f=>{total+=f.originalSize;if(total>32_000_000)throw Error('解压后的角色包过大。');return true;}});
 if(files['authoring.json']){
  const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if(manifest.format!=='laputa-cutout-studio-package-v1'||!manifest.files?.['authoring.json'])throw Error('缺少角色包校验信息。');
  for(const [name,digest]of Object.entries(manifest.files))if(!files[name]||await cutoutDigest(files[name])!==digest)throw Error('角色包内容校验失败。');
  const d=validateCutoutDocument(JSON.parse(new TextDecoder().decode(files['authoring.json'])));await prepareCutout(d);return d;
 }
 const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
 if(manifest.format!=='laputa-cutout-package-v1'||!manifest.files?.['project.json'])throw Error('不支持的角色包。');
 for(const [name,digest]of Object.entries(manifest.files))if(!files[name]||await cutoutDigest(files[name])!==digest)throw Error('角色部件校验失败。');
 const rig=JSON.parse(new TextDecoder().decode(files['project.json'])),assets:Record<string,string>={};
 for(const p of rig.parts)for(const asset of [p.asset,...(p.variants??[]).map((v:{asset:string})=>v.asset)]){if(!manifest.files[asset]||!files[asset])throw Error('缺少角色部件。');assets[asset]='data:image/png;base64,'+b64(files[asset]);}
 const d=cutoutFromRig(rig,assets);await prepareCutout(d);return d;
}
export async function exportCutoutPackage(input:CutoutDocument):Promise<Uint8Array>{
 const d=validateCutoutDocument(structuredClone(input)),images=await prepareCutout(d),files:Record<string,Uint8Array>={};
 const runtime=structuredClone(d.rig);runtime.parts=[];
 for(const p of d.rig.parts){const a=d.artwork.find(a=>a.partId===p.id)!;
  const r=rasterCutout(a,p,images.get(p.id)!,d.rig.canvas),canvas=r.canvas;
  const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;const c=output.getContext('2d')!;c.globalAlpha=a.opacity;c.drawImage(canvas,0,0);
  runtime.parts.push({...p,crop:[r.x,r.y,canvas.width,canvas.height],visible:a.visible} as typeof p);files[p.asset]=bytes(output.toDataURL('image/png'));for(const v of p.variants??[]){const layer=a.variants?.find(a=>a.id===v.id);if(!layer)throw Error('缺少替换图。');const variant=document.createElement('canvas');variant.width=canvas.width;variant.height=canvas.height;const vc=variant.getContext('2d')!;vc.globalAlpha=a.opacity;vc.drawImage(images.get(p.id+':'+v.id)!,p.crop[0]-r.x,p.crop[1]-r.y,p.crop[2],p.crop[3]);files[v.asset]=bytes(variant.toDataURL('image/png'));}
 }
 files['project.json']=new TextEncoder().encode(JSON.stringify(runtime));files['authoring.json']=new TextEncoder().encode(JSON.stringify(d));
 const hashes:Record<string,string>={};for(const [n,v]of Object.entries(files))hashes[n]=await cutoutDigest(v);
 files['manifest.json']=new TextEncoder().encode(JSON.stringify({format:'laputa-cutout-studio-package-v1',files:hashes}));return zipSync(files);
}

const thumbnails=new WeakMap<CutoutArtwork,string>();
export function cutoutThumbnail(a:CutoutArtwork,p:Part2D,im:HTMLImageElement,size:Point2D){
 const cached=thumbnails.get(a);if(cached)return cached;
 const raster=rasterCutout(a,p,im,size),cv=document.createElement('canvas');cv.width=cv.height=96;
 const c=cv.getContext('2d')!,ratio=96/Math.max(raster.canvas.width,raster.canvas.height);c.drawImage(raster.canvas,0,0,raster.canvas.width*ratio,raster.canvas.height*ratio);
 const pixels=c.getImageData(0,0,96,96).data;let l=96,t=96,r=0,b=0;for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(pixels[(y*96+x)*4+3]>8){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
 const thumb=document.createElement('canvas');thumb.width=thumb.height=48;const tc=thumb.getContext('2d')!;if(r>l&&b>t){const scale=44/Math.max(r-l,b-t);tc.drawImage(cv,l,t,r-l,b-t,24-(r-l)*scale/2,24-(b-t)*scale/2,(r-l)*scale,(b-t)*scale);}
 const result=thumb.toDataURL();thumbnails.set(a,result);return result;
}

/** Hit test the visible pixels in draw order, including part placement and source masks. */
export function hitCutoutPart(d:CutoutDocument,images:Map<string,HTMLImageElement>,at:Point2D,onlyId?:string){
 const transforms=partTransforms2D(d.rig);
 for(const p of [...d.rig.parts].sort((a,b)=>b.z-a.z)){
  const a=d.artwork.find(a=>a.partId===p.id)!,im=images.get(p.id);if(!a.visible||a.opacity<=0||!im||onlyId&&p.id!==onlyId)continue;
  const point=transform2D(inverse2D(transforms.get(p.id)!),at),raster=rasterCutout(a,p,im,d.rig.canvas),x=Math.floor(point[0]-raster.x),y=Math.floor(point[1]-raster.y);
  if(x>=0&&y>=0&&x<raster.canvas.width&&y<raster.canvas.height&&raster.canvas.getContext('2d')!.getImageData(x,y,1,1).data[3]>8)return p.id;
 }
}

export async function prepareCutoutRepair(d:CutoutDocument,id:string,images:Map<string,HTMLImageElement>){
 const a=d.artwork.find(a=>a.partId===id),p=d.rig.parts.find(p=>p.id===id),im=images.get(id);if(!a||!p||!im)throw Error('部件图片尚未就绪。');
 const r=rasterCutout(a,p,im,d.rig.canvas),c=r.canvas.getContext('2d',{willReadFrequently:true})!,pixels=c.getImageData(0,0,r.canvas.width,r.canvas.height);let left=r.canvas.width,top=r.canvas.height,right=-1,bottom=-1;
 for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++)if(pixels.data[(y*pixels.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 if(right<left)throw Error('这个部件是空的，请返回拆分部件重新选择。');
 const w=right-left+1,h=bottom-top+1,pad=Math.min(256,Math.max(24,Math.ceil(Math.max(w,h)*.2)),Math.floor((4096-w)/2),Math.floor((4096-h)/2));if(pad<4)throw Error('部件过大，无法预留补画空间，请先缩小原图。');
 const cv=document.createElement('canvas');cv.width=w+pad*2;cv.height=h+pad*2;cv.getContext('2d')!.drawImage(r.canvas,pad-left,pad-top);
 const blob=await new Promise<Blob>((ok,bad)=>cv.toBlob(b=>b?ok(b):bad(Error('无法准备补画输入。')),'image/png'));if(blob.size>8_000_000)throw Error('部件 PNG 超过 8 MB，请先缩小原图。');
 return {source:await blob.arrayBuffer(),preview:cv.toDataURL('image/png'),frame:[r.x+left-pad,r.y+top-pad,cv.width,cv.height] as [number,number,number,number]};
}

export function cutoutAlphaBounds(a:CutoutArtwork,p:Part2D,im:HTMLImageElement,canvasSize:Point2D):[number,number,number,number]{const r=rasterCutout(a,p,im,canvasSize),sample=document.createElement('canvas'),scale=Math.min(1,512/Math.max(r.canvas.width,r.canvas.height));sample.width=Math.max(1,Math.ceil(r.canvas.width*scale));sample.height=Math.max(1,Math.ceil(r.canvas.height*scale));const c=sample.getContext('2d')!;c.drawImage(r.canvas,0,0,sample.width,sample.height);const pixels=c.getImageData(0,0,sample.width,sample.height).data;let left=sample.width,top=sample.height,right=-1,bottom=-1;for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++)if(pixels[(y*sample.width+x)*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}if(right<left)throw Error('部件为空，无法生成网格。');return [r.x+left/scale,r.y+top/scale,(right-left+1)/scale,(bottom-top+1)/scale];}
