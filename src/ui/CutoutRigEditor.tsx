import {boneRoleLabels,inferBoneRole} from '../shared/cutout-motion-templates';
import {boneRoles2D,type BoneRole2D} from '../shared/skeletal2d';
import {useEffect,useRef,useState} from 'react';
import {cutoutRigSource,proposalLayers,proposalRig,editRigJoint,deleteRigJoint,type CutoutRigProposal} from '../shared/cutout-rig';
import {worldBones2D,type Rig2D,type Point2D} from '../shared/skeletal2d';
import type {CutoutDocument} from '../shared/cutout-studio';
import {cutoutAssemblyImage,cutoutPartAtlas} from './cutout-assembly-images';
import {useWorkbenchAPI} from './workbench-api';
export {CutoutRigOverlay} from './CutoutRigOverlay';
export function CutoutRigEditor({doc,images,configured,settings,persist,commit,preview,selected,select,editing,setEditing}:{doc:CutoutDocument;images:Map<string,HTMLImageElement>;configured:boolean;settings:()=>void;persist:(d:CutoutDocument)=>Promise<unknown>;commit:(d:CutoutDocument)=>void;preview:(r:Rig2D|undefined)=>void;selected:string;select:(id:string)=>void;editing:boolean;setEditing:(v:boolean)=>void}){
 const api=useWorkbenchAPI(),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[layerNotes,setLayerNotes]=useState(''),[error,setError]=useState(''),[candidate,setCandidate]=useState<{proposal:CutoutRigProposal;source:string}>(),latest=useRef(doc);latest.current=doc;
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;preview(undefined);};},[preview]);
 const bone=doc.rig.bones.find(b=>b.id===selected)??doc.rig.bones[0],world=worldBones2D(doc.rig),m=world.get(bone.id)!,stale=!!candidate&&candidate.source!==cutoutRigSource(doc);
 useEffect(()=>{preview(candidate&&!stale?proposalRig(doc.rig,candidate.proposal):undefined);},[candidate,stale,preview]);
 function setBone(patch:Partial<typeof bone>){try{const rig={...doc.rig,bones:doc.rig.bones.map(b=>b.id===bone.id?{...b,...patch}:b)};commit({...doc,rig});setError('');}catch(e){setError((e as Error).message);}}
 function edit(point:Point2D,parent=bone.parent){try{commit({...doc,rig:editRigJoint(doc.rig,bone.id,point,parent)});setError('');}catch(e){setError((e as Error).message);}}
 async function requestInput(d:CutoutDocument,atlas:string){
  await persist(d);if(!active.current)throw Error('已离开装配阶段。');
  const source=cutoutRigSource(d),boot=await api.boot();
  if(!boot.workspace.cutoutStudio||cutoutRigSource(boot.workspace.cutoutStudio)!==source||source!==cutoutRigSource(latest.current))throw Error('工程已变化，请保存后重新生成。');
  return {image:cutoutAssemblyImage(d,images),atlas,revision:boot.workspace.cutoutStudio.revision};
 }
 async function generate(onlyLayers=false){
  if(busy)return;setBusy(true);setError('');setLayerNotes('');setCandidate(undefined);preview(undefined);setEditing(false);
  let layersApplied=false;
  try{
   const source=cutoutRigSource(doc),atlas=cutoutPartAtlas(doc,images);setProgress(onlyLayers?'AI 正在排布图层…':'1/2 · AI 正在排布图层…');
   const layers=await api.generateCutoutLayers(await requestInput(doc,atlas));
   if(!active.current)return;if(source!==cutoutRigSource(latest.current))throw Error('排布期间角色已修改，请重新生成。');
   const arranged={...doc,rig:proposalLayers(doc.rig,layers)};commit(arranged);layersApplied=true;setLayerNotes(layers.notes);await persist(arranged);
   if(onlyLayers)return;
   setProgress('2/2 · AI 正在生成骨骼…');
   const proposal=await api.generateCutoutRig(await requestInput(arranged,atlas));
   if(!active.current)return;if(cutoutRigSource(arranged)!==cutoutRigSource(latest.current))throw Error('生成期间角色已修改，请重新生成。');
   const rig=proposalRig(arranged.rig,proposal);setCandidate({proposal,source:cutoutRigSource(arranged)});preview(rig);
  }catch(e){if(active.current)setError((layersApplied?'图层排布已保留，可撤销。':'')+(e as Error).message);}finally{if(active.current){setBusy(false);setProgress('');}}
 }
 return <section className="cutout-rig-editor"><h3>AI 骨骼与绑定</h3><p className="cutout-note">先判断部件前后遮挡并应用图层顺序，再基于排布结果生成骨骼预览。使用设置中的 OpenAI 模型。</p>{!configured&&<button onClick={settings}>配置 OpenAI</button>}<button aria-label="AI 自动生成骨骼" disabled={busy||!configured||!doc.rig.parts.length} onClick={()=>void generate()}>{busy?progress:'AI 排布图层并生成骨骼'}</button><button aria-label="AI 自动排布图层" disabled={busy||!configured||!doc.rig.parts.length} onClick={()=>void generate(true)}>仅 AI 排布图层</button><small className="cutout-note">完整流程依次调用两次 AI。图层排布自动应用，可撤销；骨架仍需确认。</small>{layerNotes&&<p className="cutout-note" role="status">图层已排布：{layerNotes}</p>}
 {candidate&&<div className="cutout-rig-candidate"><strong>骨架预览 · {candidate.proposal.bones.length} 个关节</strong><p>{candidate.proposal.notes}</p><p className="cutout-note">应用后替换骨骼与绑定，旧动作将重置，蒙皮会重绑，脚底骨链需重设；可撤销恢复。</p>{stale&&<p role="alert">角色已修改，请重新生成。</p>}<button aria-label="应用 AI 骨架" disabled={stale||busy} onClick={()=>{commit({...doc,rig:proposalRig(doc.rig,candidate.proposal)});preview(undefined);select(candidate.proposal.bones[0].id);setCandidate(undefined);setEditing(true);}}>应用骨架</button><button onClick={()=>{setCandidate(undefined);preview(undefined);}}>放弃预览</button></div>}
 <button aria-label="编辑骨骼关节" aria-pressed={editing} disabled={!!candidate} onClick={()=>setEditing(!editing)}>{editing?'结束关节编辑':'编辑骨骼关节'}</button>
 {editing&&<><p className="cutout-note">在画布上直接拖动圆点或骨骼连线调整关节；Shift 限制方向，Esc 取消。顶部可选择是否带动子骨骼，图片保持原位。</p><label>选择骨骼<select aria-label="选择骨骼" value={bone.id} onChange={e=>select(e.target.value)}>{doc.rig.bones.map(b=><option key={b.id} value={b.id}>{b.name??b.id}</option>)}</select></label><label>骨骼名称<input aria-label="骨骼名称" maxLength={100} value={bone.name??bone.id} onChange={e=>commit({...doc,rig:{...doc.rig,bones:doc.rig.bones.map(b=>b.id===bone.id?{...b,name:e.target.value}:b)}})}/></label><label>骨骼用途<select aria-label="骨骼用途" value={inferBoneRole(bone)} onChange={e=>setBone({role:e.target.value as BoneRole2D})}>{boneRoles2D.map(role=><option key={role} value={role}>{boneRoleLabels[role]}</option>)}</select></label><label><input aria-label="启用关节范围" type="checkbox" checked={!!bone.limits} onChange={e=>setBone({limits:e.target.checked?{min:-90,max:90}:undefined})}/>限制相对转角</label>{bone.limits&&(['min','max'] as const).map(field=><label key={field}>{field==='min'?'最小':'最大'}角度<input key={bone.id+field+bone.limits![field]} aria-label={field==='min'?'关节最小角度':'关节最大角度'} type="number" min="-180" max="180" defaultValue={bone.limits![field]} onBlur={e=>{const v=+e.target.value;if(Number.isFinite(v)&&v>=-180&&v<=180){const limits={...bone.limits!,[field]:v};if(limits.min<=limits.max)setBone({limits});else e.target.value=String(bone.limits![field]);}}}/></label>)}<p className="cutout-note">用途用于动作模板重定向。角度范围相对于静止姿势，生成和播放时生效。</p>{[0,1].map(i=><label key={i}>关节 {'XY'[i]}<input key={bone.id+':'+m[i+4]} aria-label={'关节 '+'XY'[i]} type="number" min={-16384} max={16384} defaultValue={Math.round(m[i+4]*100)/100} onBlur={e=>{if(!e.target.value.trim())return;const p:Point2D=[m[4],m[5]];p[i]=Number(e.target.value);if(p[i]!==m[i+4])edit(p);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>)}<label>父骨骼<select aria-label="骨骼父节点" value={bone.parent??''} disabled={!bone.parent} onChange={e=>edit([m[4],m[5]],e.target.value)}>{!bone.parent&&<option value="">根节点</option>}{doc.rig.bones.filter(b=>{let at:typeof b|undefined=b;while(at){if(at.id===bone.id)return false;at=doc.rig.bones.find(v=>v.id===at!.parent);}return true;}).map(b=><option key={b.id} value={b.id}>{b.name??b.id}</option>)}</select></label><button aria-label="添加骨骼" onClick={()=>{if(doc.rig.bones.length>=128)return;const id='bone-'+crypto.randomUUID();commit({...doc,rig:{...doc.rig,bones:[...doc.rig.bones,{id,name:'新骨骼',parent:bone.id,origin:[0,-Math.max(12,Math.min(...doc.rig.canvas)*.06)],rotation:0}]}});select(id);}}>添加子骨骼</button><button aria-label="删除骨骼" disabled={!bone.parent} onClick={()=>{commit({...doc,rig:deleteRigJoint(doc.rig,bone.id)});select(bone.parent!);}}>删除骨骼</button></>}{error&&<p role="alert">{error}</p>}
 </section>;
}
