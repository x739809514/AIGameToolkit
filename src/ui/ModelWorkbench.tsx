import {FileDropNotice} from './FileDropNotice';
import {parseWorktreeFileDrag} from '../shared/worktree-drag';
import {ModelHierarchy} from './ModelHierarchy';
import {MotionBlendEditor} from './MotionBlendEditor';
import {defaultMotionBlend} from '../shared/motion-blend';
import {MotionTimeline} from './MotionTimeline';
import {normalizeMotionTimeline,placeMotionTimelineItem,motionTimelineLayout,type MotionTimelineItem} from '../shared/motion-timeline';
import {loadYBot} from './y-bot';
import {ModelVideoExport} from './ModelVideoExport';
import {useEffect,useRef,useState} from 'react';
import {GitBranch,Box,Download,LoaderCircle,Pause,Play,RotateCcw,Video,SkipBack,SkipForward} from 'lucide-react';
import {defaultModelEditor,type Asset,type ModelEditorState,type Workspace} from '../shared/types';
import {useWorkbenchAPI} from './workbench-api';
import {ModelScene,type ModelInfo,type ModelNode} from './model-scene';
import './model-editor.css';
export function ModelWorkbench({workspace}:{workspace:Workspace}){
  const api=useWorkbenchAPI(),host=useRef<HTMLDivElement>(null),scene=useRef<ModelScene|undefined>(undefined),live=useRef(true);
  const state={...defaultModelEditor(),...workspace.modelEditor},files=workspace.assets.filter(a=>a.type==='model'),asset=files.find(a=>a.id===state.assetId);
  const [hierarchy,setHierarchy]=useState<ModelNode[]>([]),[attaching,setAttaching]=useState(false);
  const attachingRef=useRef(false);
  const [library,setLibrary]=useState<Record<string,ModelInfo>>({}),[viewerReady,setViewerReady]=useState(0);
  const [info,setInfo]=useState<ModelInfo>(),[dropping,setDropping]=useState(false),[dropError,setDropError]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[duration,setDuration]=useState(0),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[reload,setReload]=useState(0),[note,setNote]=useState(''),[exportOpen,setExportOpen]=useState(false),[blendOpen,setBlendOpen]=useState(false);
  const droppingRef=useRef(false);
  const options=useRef(state);options.current=state;
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  async function save(patch:Partial<ModelEditorState>){try{const next={...options.current,...patch};options.current=next;await api.saveModelEditor(next);}catch(e){if(live.current)setError(e instanceof Error?e.message:'保存失败');}}
  async function dropFiles(raw:string,dropped:File[],before?:string,at?:number){
    if(droppingRef.current){setDropError('正在加载动作，请完成后再拖入。');return;}
    const viewer=scene.current;if(!viewer||viewer.disposed){setDropError('角色尚未加载完成，请稍后重新拖入。');return;}
    droppingRef.current=true;setDropping(true);setDropError('');
    try{
      let assets:Asset[];
      if(raw){const file=parseWorktreeFileDrag(raw);if(file.kind==='directory'||!/\.fbx$/i.test(file.name))throw new Error('文件类型不符合，动作时间轴只能拖入 FBX 文件。');assets=[await api.useWorktreeFile(file.path,file.worktreeId)];}
      else{if(!dropped.length||dropped.some(file=>!/\.fbx$/i.test(file.name)))throw new Error('文件类型不符合，动作时间轴只能拖入 FBX 文件。');if(dropped.length>12)throw new Error('一次最多拖入 12 个 FBX 文件。');if(dropped.some(file=>file.size>50*1024*1024))throw new Error('FBX 文件须小于 50 MB。');assets=await api.importFiles(await Promise.all(dropped.map(async file=>({name:file.name,bytes:await file.arrayBuffer()}))));}
      const clips:{asset:Asset;index:number;clip:{name:string;duration:number}}[]=[];
      for(const asset of assets){if(!live.current||scene.current!==viewer||viewer.disposed)return;if(asset.type!=='model')throw new Error('文件类型不符合，动作时间轴只能拖入 FBX 文件。');let info=viewer.infos.get(asset.id);if(!info){const bytes=await api.modelData(asset.id);if(!live.current||scene.current!==viewer||viewer.disposed)return;info=viewer.loadAsset(asset.id,bytes);}const index=info.clips.findIndex(clip=>clip.duration>0);if(index<0)throw new Error(info.motionError||`${asset.name} 没有可播放的动画，无法添加到时间轴。`);clips.push({asset,index,clip:info.clips[index]});}
      if(!live.current||scene.current!==viewer||viewer.disposed)return;
      setLibrary(Object.fromEntries(viewer.infos));let items=[...options.current.timelineItems],cursor=at;
      for(const {asset,index,clip} of clips){const id=crypto.randomUUID(),position=before?items.findIndex(item=>item.id===before):-1;items.splice(position<0?items.length:position,0,{id,assetId:asset.id,clipIndex:index,label:`${asset.name.replace(/\.fbx$/i,'')} · ${clip.name}`.slice(0,180),sourceDuration:clip.duration,in:0,out:clip.duration,rate:1,blendIn:0});if(cursor!==undefined){items=placeMotionTimelineItem(items,id,cursor);cursor=motionTimelineLayout(items).find(span=>span.item.id===id)!.end;}}
      const next={...options.current,assetId:assets[0].id,clipIndex:clips[0].index,timelineItems:normalizeMotionTimeline(items),timelineEnabled:true,blendTree:{...(options.current.blendTree||defaultMotionBlend()),enabled:false}};await api.saveModelEditor(next);if(live.current&&scene.current===viewer){options.current=next;setNote(`已添加 ${assets.length} 个 FBX 动作到时间轴`);}
    }catch(error){if(live.current)setDropError(error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'动作加载失败，请重新拖入。');}
    finally{droppingRef.current=false;if(live.current)setDropping(false);}
  }

  useEffect(()=>{let active=true;let viewer:ModelScene|undefined;let baseReady=false;setInfo(undefined);setLoading(true);setTime(0);setDuration(0);setPlaying(false);setError('');
    const lost=(event:Event)=>{event.preventDefault();if(active)setError('三维预览连接中断，请点击重新加载。');};
    void (async()=>{try{
      const baseBytes=await api.baseModelData();if(!active||!host.current)return;
      const avatar=loadYBot(baseBytes);viewer=new ModelScene(host.current,(t,p)=>{if(active){setTime(t);setPlaying(p);setDuration(viewer?.duration||0);}},avatar);scene.current=viewer;baseReady=true;setInfo(viewer.baseInfo());setHierarchy(viewer.baseInfo().nodes);viewer.renderer.domElement.addEventListener('webglcontextlost',lost);
      const initial=options.current;viewer.options(initial.speed,initial.loop,initial.showSkeleton,initial.showGrid,initial.ignoreTranslation);
      setViewerReady(v=>v+1);
    }catch(e){if(active)setError(`${baseReady?'FBX 动作':'Y Bot 基础模型'}加载失败：${e instanceof Error?e.message:'文件损坏或版本不支持'}`);}finally{if(active)setLoading(false);}})();
    return()=>{active=false;viewer?.renderer.domElement.removeEventListener('webglcontextlost',lost);viewer?.dispose();if(scene.current===viewer)scene.current=undefined;};
  },[api,reload]);
  useEffect(()=>{let active=true;const viewer=scene.current;if(!viewer)return;void(async()=>{setLoading(true);setError('');for(const id of viewer.infos.keys())if(!files.some(file=>file.id===id))viewer.removeAsset(id);for(const file of files){if(viewer.infos.has(file.id))continue;try{const bytes=await api.modelData(file.id);if(!active)return;viewer.loadAsset(file.id,bytes);}catch(e){if(active)setError(`${file.name}：${(e as Error).message}`);}}if(active){setLibrary(Object.fromEntries(viewer.infos));setLoading(false);}})();return()=>{active=false;};},[api,viewerReady,files.map(f=>f.id).join(',')]);
  useEffect(()=>{const viewer=scene.current;if(!viewer)return;try{if(!asset){viewer.clearSource();setInfo(viewer.baseInfo());}if(asset&&viewer.infos.has(asset.id)){const clips=viewer.infos.get(asset.id)!.clips,index=clips[state.clipIndex]?.duration>0?state.clipIndex:Math.max(0,clips.findIndex(clip=>clip.duration>0));viewer.selectSource(asset.id,index);setInfo(viewer.infos.get(asset.id));}if(state.timelineItems.every(item=>viewer.infos.has(item.assetId))){viewer.setTimeline(state.timelineItems,state.timelineEnabled);}if((state.blendTree?.nodes||[]).every(node=>viewer.infos.has(node.assetId)))viewer.setBlendTree(state.blendTree||defaultMotionBlend());viewer.options(state.speed,state.loop,state.showSkeleton,state.showGrid,state.ignoreTranslation);}catch(e){setError((e as Error).message);}},[library,state.assetId,state.clipIndex,JSON.stringify(state.timelineItems),state.timelineEnabled,JSON.stringify(state.blendTree),viewerReady]);
  useEffect(()=>{scene.current?.options(state.speed,state.loop,state.showSkeleton,state.showGrid,state.ignoreTranslation??false);},[state.speed,state.loop,state.showSkeleton,state.showGrid,state.ignoreTranslation]);
  useEffect(()=>{let active=true;const viewer=scene.current;if(!viewer)return;void(async()=>{try{const items=state.attachments??[];viewer.attachments.sync(items);for(const item of items){if(viewer.attachments.objects.has(item.id))continue;const bytes=await api.modelData(item.assetId);if(!active||viewer.disposed)return;viewer.attachments.add(item,bytes);}if(active)setHierarchy(viewer.baseInfo().nodes);}catch(e){if(active)setDropError((e as Error).message);}})();return()=>{active=false;};},[api,viewerReady,JSON.stringify(state.attachments)]);
  async function attachFile(node:ModelNode,raw:string,dropped:File[],attachmentId?:string){
    const viewer=scene.current;if(!viewer||viewer.disposed||viewer.exporting||attachingRef.current)return;
    attachingRef.current=true;setAttaching(true);setDropError('');let added:string|undefined;
    try{
      const parent=viewer.attachments.parent(node.id);let items=[...(options.current.attachments??[])];
      if(attachmentId){if(!items.some(item=>item.id===attachmentId))throw new Error('子物体不存在，请重新拖动。');items=items.map(item=>item.id===attachmentId?{...item,parentPath:parent.path}:item);}
      else{
        if(items.length>=100)throw new Error('最多挂载 100 个 FBX 子物体。');let imported:Asset;
        if(raw){const file=parseWorktreeFileDrag(raw);if(file.kind==='directory'||!/\.fbx$/i.test(file.name))throw new Error('骨骼节点只能挂载 FBX 文件。');imported=await api.useWorktreeFile(file.path,file.worktreeId);}
        else{if(dropped.length!==1||!/\.fbx$/i.test(dropped[0].name))throw new Error('请一次拖入一个 FBX 文件到骨骼节点。');if(dropped[0].size>50*1024*1024)throw new Error('FBX 文件须小于 50 MB。');[imported]=await api.importFiles([{name:dropped[0].name,bytes:await dropped[0].arrayBuffer()}]);}
        const bytes=await api.modelData(imported.id);if(!live.current||scene.current!==viewer||viewer.disposed)return;
        const item={id:crypto.randomUUID(),assetId:imported.id,parentPath:parent.path,name:imported.name};viewer.attachments.add(item,bytes);added=item.id;items.push(item);
      }
      const next={...options.current,attachments:items};await api.saveModelEditor(next);
      if(live.current&&scene.current===viewer){options.current=next;viewer.attachments.sync(items);setHierarchy(viewer.baseInfo().nodes);setNote(`已挂载到 ${node.name}`);}
    }catch(e){if(added&&!viewer.disposed)viewer.attachments.sync(options.current.attachments??[]);if(live.current)setDropError(e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'FBX 挂载失败');}
    finally{attachingRef.current=false;if(live.current)setAttaching(false);}
  }
  async function removeAttachment(id:string){if(attachingRef.current)return;const next={...options.current,attachments:(options.current.attachments??[]).filter(item=>item.id!==id)};try{await api.saveModelEditor(next);options.current=next;}catch(e){setDropError((e as Error).message);}}
  function changeTimeline(items:MotionTimelineItem[]){try{void save({timelineItems:normalizeMotionTimeline(items),timelineEnabled:items.length>0,blendTree:{...(options.current.blendTree||defaultMotionBlend()),enabled:false}});}catch(e){setError((e as Error).message);}}
  function addMotion(assetId:string,index:number,before?:string,at?:number){const clip=library[assetId]?.clips[index];if(!clip||clip.duration<=0)return;const next=[...options.current.timelineItems],position=before?next.findIndex(item=>item.id===before):-1;const id=crypto.randomUUID();next.splice(position<0?next.length:position,0,{id,assetId,clipIndex:index,label:`${files.find(f=>f.id===assetId)?.name.replace(/\.fbx$/i,'')} · ${clip.name}`.slice(0,180),sourceDuration:clip.duration,in:0,out:clip.duration,rate:1,blendIn:0});changeTimeline(at===undefined?next:placeMotionTimelineItem(next,id,at));}
  return <><main className="model-workbench" onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();}}>
    <aside className="model-inspector"><ModelHierarchy nodes={hierarchy} busy={attaching||exportOpen} attach={attachFile} remove={id=>void removeAttachment(id)}/></aside>
    <section className="model-preview"><div className="model-toolbar"><div><Box size={15}/><strong>Y Bot{state.blendTree?.enabled?' · 骨骼混合':state.timelineEnabled?' · 动作时间轴':asset?` · ${asset.name}`:''}</strong>{info&&<small>{info.meshes} 网格 · {info.bones} 骨骼</small>}</div><div><button className="secondary compact model-save-fbx" aria-label="下载当前 FBX" title="下载当前 FBX，选择保存位置" disabled={!asset||loading} onClick={()=>void api.exportAsset(asset!.id).then(path=>{if(path)setNote(`FBX 已保存到：${path}`);}).catch(error=>setError(error.message))}><Download size={14}/><span>下载 FBX</span></button><button className="secondary compact" aria-label="打开混合设置" disabled={loading||!files.length} onClick={()=>setBlendOpen(true)}><GitBranch size={14}/>2D 混合树</button><button className="secondary compact" aria-label="导出动画视频" disabled={!duration||loading||!!error} onClick={()=>setExportOpen(true)}><Video size={13}/>导出视频</button><button className="quiet-button" disabled={!info} onClick={()=>scene.current?.view('front')}>正面</button><button className="quiet-button" disabled={!info} onClick={()=>scene.current?.view('side')}>侧面</button><button className="quiet-button" disabled={!info} onClick={()=>scene.current?.view('top')}>顶部</button><button className="icon-button" aria-label="重置相机" disabled={!info} onClick={()=>scene.current?.view('perspective')}><RotateCcw size={14}/></button></div></div>
      <div className="model-stage"><div className="model-canvas" ref={host}/>{!asset&&!error&&<div className="model-base-hint">Y Bot 基础模型 · 从右侧文件树选择 FBX 动作</div>}{loading&&<div className="model-loading"><LoaderCircle className="spin" size={22}/>正在加载模型与动作…</div>}{error&&<div className="model-error" role="alert"><p>{error}</p>{<button className="secondary" onClick={()=>setReload(r=>r+1)}>重新加载</button>}</div>}{info&&<div className="model-view-options"><label><input type="checkbox" checked={state.showGrid} onChange={e=>void save({showGrid:e.target.checked})}/>地面网格</label><label><input type="checkbox" checked={state.showSkeleton||info.meshes===0} disabled={!info.bones||!info.meshes} onChange={e=>void save({showSkeleton:e.target.checked})}/>骨骼</label></div>}<span className="model-camera-hint">左键拖动：环绕 · 滚轮：缩放 · 右键拖动：平移</span></div>
      {info?.mappedBones!==undefined&&<p className="model-notice" role="status">FBX 动作已应用到 Y Bot · 匹配 {info.mappedBones} / 22 个关节{info.missingBones?.length?` · 未匹配：${info.missingBones.join('、')}，保留基础姿态。`:''}</p>}{info?.missingTextures&&<p className="model-notice">未找到外部贴图，已使用基础材质。请导出嵌入贴图的 FBX 以显示完整材质。</p>}
      <MotionTimeline dropFiles={dropFiles} dropping={dropping} items={state.timelineItems} time={time} enabled={state.timelineEnabled} change={changeTimeline} activate={()=>{if(!options.current.timelineEnabled||options.current.blendTree?.enabled)void save({timelineEnabled:true,blendTree:{...(options.current.blendTree||defaultMotionBlend()),enabled:false}});}} seek={t=>scene.current?.seek(t)} add={addMotion} previewDuration={duration} saveSegment={async(item,name)=>{const clip=library[item.assetId]?.clips[item.clipIndex];if(!clip)throw new Error('原动画尚未加载。');const created=await api.saveModelSegment({item,name,clipName:clip.name});await save({assetId:created.id,clipIndex:0,timelineEnabled:false,blendTree:{...(options.current.blendTree||defaultMotionBlend()),enabled:false}});setNote('新动作已生成，点击下载 FBX 选择保存位置');}} controls={<div className="model-playback"><button className="icon-button" aria-label="回到开始" disabled={!duration} onClick={()=>scene.current?.seek(0)}><SkipBack size={16}/></button><button className="secondary" aria-label={playing?'暂停动作':'播放动作'} disabled={!duration} onClick={()=>scene.current?.toggle()}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><button className="icon-button" aria-label="到达末尾" disabled={!duration} onClick={()=>scene.current?.seek(duration)}><SkipForward size={16}/></button><span className="model-time">{time.toFixed(2)} / {duration.toFixed(2)} s</span><label>速度<select aria-label="动作播放速度" value={state.speed} onChange={e=>void save({speed:Number(e.target.value)})}>{[.25,.5,1,1.5,2].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label><label><input type="checkbox" checked={state.loop} onChange={e=>void save({loop:e.target.checked})}/>循环</label><label title="将角色根节点与髋部的 XYZ 位移固定在动作起始位置，保留关节动作和旋转。"><input type="checkbox" aria-label="忽略动画位移" checked={state.ignoreTranslation} onChange={e=>void save({ignoreTranslation:e.target.checked})}/>忽略动画位移</label></div>}/>
      {note&&<small role="status">{note}</small>}
    </section>
  </main>{dropError&&<FileDropNotice message={dropError} close={()=>setDropError('')}/>}{blendOpen&&<MotionBlendEditor files={files} library={library} state={state} close={()=>setBlendOpen(false)} apply={async(blendTree,name,bytes)=>{const asset=await api.saveModelBlend({tree:blendTree,name,bytes});options.current={...options.current,assetId:asset.id,clipIndex:0,blendTree:{...blendTree,enabled:false},timelineEnabled:false};setNote('混合结果已保存为新 FBX 动作，可拖入时间轴或下载');}}/>}{exportOpen&&scene.current&&(asset||files[0])&&<ModelVideoExport viewer={scene.current} asset={(state.blendTree?.enabled?files.find(f=>f.id===state.blendTree?.nodes[0]?.assetId):state.timelineEnabled?files.find(f=>f.id===state.timelineItems[0]?.assetId):asset)||files[0]} close={()=>setExportOpen(false)}/>}</>;
}
