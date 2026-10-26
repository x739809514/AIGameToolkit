import {withoutPartDeforms} from './cutout-motion-detail';
import {validateCutoutMotionDraft,type CutoutMotionDraft} from './cutout-motion';
import {validCutoutCrop,type CutoutCropRect} from './cutout-crop';
import {validateSelectionMask,type CutoutSelectionMask} from './cutout-selection';
import {validateRig2D,type Rig2D,type Point2D} from './skeletal2d';
export type CutoutTool='polygon'|'curve'|'brush'|'erase'|'mask'|'nodes'|'hand'|'eyedropper'|'quick-select'|'crop'|'move'|'bone';
export interface CutoutStroke {id:string;kind:'polygon'|'curve'|'brush'|'erase';channel:'fill'|'ink';color:string;width:number;points:Point2D[];renderer?:2;opacity?:number;hardness?:number;pressure?:number[]}
export interface CutoutArtwork {variants?:{id:string;name:string;bitmap:string}[];repair?:{status:'accepted'|'original'|'manual';taskId?:string};partId:string;name:string;bitmap:string;visible:boolean;locked:boolean;opacity:number;mask?:Point2D[];selectionMask?:CutoutSelectionMask;strokes:CutoutStroke[]}
export interface CutoutReference {name:string;bitmap:string;cropRect?:CutoutCropRect}
export interface CutoutPartDraft {mask?:CutoutSelectionMask;name:string;editingPartId?:string}
export interface CutoutDocument {editorMode?:'guided'|'advanced';motion?:CutoutMotionDraft;workflowStage?:'split'|'repair'|'assemble'|'inspect'|'motion';reference?:CutoutReference;selectionDraft?:CutoutPartDraft;format:'laputa-cutout-studio';version:1;revision:number;name:string;rig:Rig2D;artwork:CutoutArtwork[]}
export function validateCutoutDocument(input:unknown):CutoutDocument {
 const d=input as CutoutDocument;
 if(!d||d.format!=='laputa-cutout-studio'||d.version!==1||!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.name!=='string'||!d.name.trim()||d.name.length>100)throw Error('二维角色工程格式无效。');
 if(d.workflowStage!==undefined&&!['split','repair','assemble','inspect','motion'].includes(d.workflowStage))throw Error('角色制作阶段无效。');
 if(d.editorMode!==undefined&&!['guided','advanced'].includes(d.editorMode))throw Error('角色编辑模式无效。');
 validateRig2D(d.rig);if(d.motion)validateCutoutMotionDraft(d.motion);
 const bitmaps=new Set<string>();const validBitmap=(value:string)=>{if(typeof value!=='string'||value.length>8_000_000)return false;if(bitmaps.has(value))return true;if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))return false;bitmaps.add(value);return true;};
 if(d.reference&&(typeof d.reference.name!=='string'||d.reference.name.length>100||!validBitmap(d.reference.bitmap)))throw Error('参考原图格式无效。');
 if(d.reference?.cropRect!==undefined&&!validCutoutCrop(d.reference.cropRect,...d.rig.canvas))throw Error('裁切框必须位于原图内，并使用整数像素。');
 if(d.selectionDraft){if(!d.reference||typeof d.selectionDraft.name!=='string'||d.selectionDraft.name.length>100||d.selectionDraft.editingPartId!==undefined&&!d.rig.parts.some(p=>p.id===d.selectionDraft!.editingPartId))throw Error('临时部件选区无效。');if(d.selectionDraft.mask)validateSelectionMask(d.selectionDraft.mask);}
 if(d.rig.canvas.some(v=>!Number.isInteger(v)||v>4096)||!Array.isArray(d.artwork)||d.artwork.length!==d.rig.parts.length)throw Error('图层与角色部件不一致，或画布超过 4096px。');
 const ids=new Set<string>();let pointCount=0;
 const points=(p:Point2D[],minimum=1)=>{if(!Array.isArray(p)||p.length<minimum||p.length>3000||p.some(q=>!Array.isArray(q)||q.length!==2||q.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>16384)))throw Error('笔画或遮罩节点无效。');pointCount+=p.length;};
 for(const a of d.artwork){
  if(!a||ids.has(a.partId)||!d.rig.parts.some(p=>p.id===a.partId)||typeof a.name!=='string'||a.name.length>100||!validBitmap(a.bitmap)||typeof a.visible!=='boolean'||typeof a.locked!=='boolean'||!Number.isFinite(a.opacity)||a.opacity<0||a.opacity>1||!Array.isArray(a.strokes)||a.strokes.length>2000)throw Error('图层数据无效。');
  if(a.repair&&(!['accepted','original','manual'].includes(a.repair.status)||a.repair.taskId!==undefined&&(typeof a.repair.taskId!=='string'||a.repair.taskId.length>100)))throw Error('部件补画确认数据无效。');
  const variants=d.rig.parts.find(p=>p.id===a.partId)!.variants??[];if((a.variants?.length??0)!==variants.length||a.variants&&(!Array.isArray(a.variants)||new Set(a.variants.map(v=>v.id)).size!==a.variants.length||a.variants.some(v=>!variants.some(p=>p.id===v.id)||typeof v.name!=='string'||v.name.length>100||!validBitmap(v.bitmap))))throw Error('部件替换图无效。');
  ids.add(a.partId);if(a.mask!==undefined)points(a.mask,3);if(a.selectionMask!==undefined)validateSelectionMask(a.selectionMask);
  const strokeIDs=new Set<string>();
  for(const s of a.strokes){if(!s||typeof s.id!=='string'||s.id.length>80||strokeIDs.has(s.id)||!['polygon','curve','brush','erase'].includes(s.kind)||!['fill','ink'].includes(s.channel)||!/^#[a-f0-9]{6}$/i.test(s.color)||!Number.isFinite(s.width)||s.width<.1||s.width>200)throw Error('笔画样式无效。');strokeIDs.add(s.id);points(s.points,s.kind==='polygon'?3:1);
   if(s.renderer!==undefined&&s.renderer!==2||[s.opacity,s.hardness].some(v=>v!==undefined&&(!Number.isFinite(v)||v<0||v>1))||s.pressure!==undefined&&(!Array.isArray(s.pressure)||s.pressure.length!==s.points.length||s.pressure.some(v=>!Number.isFinite(v)||v<0||v>1)))throw Error('笔触透明度、硬度或压感数据无效。');
  }
 }
 let bitmapCharacters=0;const structure=JSON.stringify(d,(key,value)=>{if(key==='bitmap'&&typeof value==='string'&&bitmaps.has(value)){bitmapCharacters+=value.length;return '';}return value;});
 if(pointCount>50000||structure.length+bitmapCharacters>24_000_000)throw Error('二维角色工程超过容量限制。');return d;
}
export const cutoutNames:Record<string,string>={'head':'头部','torso':'躯干','left-upper':'画面左上臂','left-lower':'画面左前臂','left-hand':'画面左手','right-upper':'画面右上臂','right-lower':'画面右前臂','right-hand':'画面右手','left-leg':'画面左腿','right-leg':'画面右腿','left-foot':'画面左脚','right-foot':'画面右脚','shoulder-fill':'肩部隐藏补片','elbow-fill':'肘部隐藏补片','wrist-fill':'手腕隐藏补片'};
export function cutoutFromRig(rig:Rig2D,assets:Record<string,string>):CutoutDocument {
 return validateCutoutDocument({format:'laputa-cutout-studio',version:1,revision:0,name:'二维机器人 · 拆件与补画',rig,artwork:rig.parts.map(p=>({partId:p.id,name:cutoutNames[p.id]??p.id,bitmap:assets[p.asset],visible:p.visible??true,locked:false,opacity:1,strokes:[],...(p.variants?{variants:p.variants.map(v=>({id:v.id,name:v.id,bitmap:assets[v.asset]}))}:{})}))});
}

/** Upgrade the original full-canvas source layer to a non-exporting reference. */
export function upgradeCutoutWorkflow(d:CutoutDocument):CutoutDocument{
 if(d.reference)return d;
 const p=d.rig.parts.find(p=>p.id==='source'&&p.crop[0]===0&&p.crop[1]===0&&p.crop[2]===d.rig.canvas[0]&&p.crop[3]===d.rig.canvas[1]);
 const a=d.artwork.find(a=>a.partId===p?.id);if(!p||!a)return d;
 // Preserve an already edited polygon or painted source as an actual part as well.
 if(a.mask||a.strokes.length||p.offset?.some(v=>v!==0))return validateCutoutDocument({...d,reference:{name:a.name,bitmap:a.bitmap}});
 const parts=d.rig.parts.filter(v=>v.id!==p.id);
 return validateCutoutDocument({...d,reference:{name:a.name,bitmap:a.bitmap},selectionDraft:!parts.length&&a.selectionMask?{mask:a.selectionMask,name:''}:undefined,rig:{...d.rig,parts},artwork:d.artwork.filter(v=>v.partId!==p.id)});
}
export function commitCutoutPart(d:CutoutDocument,id:string):CutoutDocument{
 const draft=d.selectionDraft,name=draft?.name.trim(),mask=draft?.mask;
 if(!d.reference||!name||!mask||!mask.runs.some((n,i)=>i%2&&n>0))throw Error('请先涂选部件并输入名称。');
 if(d.artwork.some(a=>a.name===name&&a.partId!==draft?.editingPartId))throw Error('已有同名部件，请使用不同的名称。');
 if(draft?.editingPartId)return validateCutoutDocument({...d,selectionDraft:undefined,rig:{...d.rig,parts:d.rig.parts.map(p=>p.id===draft.editingPartId?{...p,crop:[0,0,...d.rig.canvas] as [number,number,number,number]}:p)},artwork:d.artwork.map(a=>a.partId===draft.editingPartId?{...a,name,bitmap:d.reference!.bitmap,mask:undefined,selectionMask:mask,repair:undefined}:a)});
 if(d.rig.parts.some(p=>p.id===id))throw Error('部件编号重复。');
 const part={id,bone:d.rig.bones.find(b=>!b.parent)!.id,asset:'parts/'+id+'.png',crop:[0,0,...d.rig.canvas] as [number,number,number,number],z:Math.max(-1,...d.rig.parts.map(p=>p.z))+1,role:'source' as const};
 return validateCutoutDocument({...d,selectionDraft:undefined,rig:{...d.rig,parts:[...d.rig.parts,part]},artwork:[...d.artwork,{partId:id,name,bitmap:d.reference.bitmap,visible:true,locked:false,opacity:1,selectionMask:mask,strokes:[]}]});
}
export function removeCutoutPart(d:CutoutDocument,id:string){return validateCutoutDocument({...d,selectionDraft:d.selectionDraft?.editingPartId===id?undefined:d.selectionDraft,rig:{...d.rig,parts:d.rig.parts.filter(p=>p.id!==id),clips:d.rig.clips.map(c=>withoutPartDeforms({...c,keys:c.keys.map(k=>({...k,...(k.parts?{parts:Object.fromEntries(Object.entries(k.parts).filter(([part])=>part!==id))}:{})}))},id))},artwork:d.artwork.filter(a=>a.partId!==id)});}
export function reorderCutoutPart(d:CutoutDocument,id:string,beforeId:string){
 const parts=[...d.rig.parts].sort((a,b)=>b.z-a.z),from=parts.findIndex(p=>p.id===id),to=parts.findIndex(p=>p.id===beforeId);if(from<0||to<0||from===to)return d;
 const [moved]=parts.splice(from,1);parts.splice(to,0,moved);
 return validateCutoutDocument({...d,rig:{...d.rig,parts:parts.map((p,i)=>({...p,z:parts.length-i}))}});
}

export function positionCutoutPart(d:CutoutDocument,id:string,offset:Point2D){
 const artwork=d.artwork.find(a=>a.partId===id);if(!artwork)throw Error('部件不存在。');if(artwork.locked)throw Error('部件已锁定。');
 return validateCutoutDocument({...d,rig:{...d.rig,parts:d.rig.parts.map(p=>p.id===id?{...p,offset}:p)}});
}
