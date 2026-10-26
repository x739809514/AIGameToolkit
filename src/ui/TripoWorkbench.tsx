import dracoWasmURL from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import dracoWrapperURL from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import {useEffect,useRef,useState} from 'react';
import {Box,Download,ImagePlus,LoaderCircle,RotateCcw,Sparkles} from 'lucide-react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import type {Asset,Workspace} from '../shared/types';
import {defaultTripoWorkspace,tripoBusy,type TripoDraft} from '../shared/tripo';
import {useWorkbenchAPI} from './workbench-api';
import './tripo.css';
const labels:Record<string,string>={preparing:'准备参考图片',submitting:'提交生成',submission_unknown:'提交结果待核实',queued:'排队中',running:'生成中',saving:'保存到本地',save_failed:'保存失败',succeeded:'已完成',failed:'生成失败',cancelled:'本地处理已停止'};
export function TripoWorkbench({workspace,configured,settings}:{workspace:Workspace;configured:boolean;settings:()=>void}){
 const api=useWorkbenchAPI(),state=workspace.tripoWorkspace??defaultTripoWorkspace();
 const [draft,setDraft]=useState<TripoDraft>(state.draft),[error,setError]=useState(''),[sending,setSending]=useState(false),[uploading,setUploading]=useState(false);
 const latest=useRef(draft),file=useRef<HTMLInputElement>(null);latest.current=draft;
 const selected=workspace.assets.find(a=>a.id===state.selectedAssetId),images=workspace.assets.filter(a=>a.type==='image'),models=workspace.assets.filter(a=>a.mime==='model/gltf-binary'),busy=state.tasks.some(tripoBusy);
 useEffect(()=>{const timer=setTimeout(()=>{void api.saveTripoDraft(draft).catch(e=>setError(e.message));},350);return()=>clearTimeout(timer);},[api,draft]);
 useEffect(()=>()=>{void api.saveTripoDraft(latest.current).catch(()=>{});},[api]);
 function patch(value:Partial<TripoDraft>){setDraft(d=>({...d,...value}));}
 async function upload(files:FileList|null){if(!files?.length)return;setError('');setUploading(true);try{const f=files[0];if(!/\.(png|jpe?g|webp)$/i.test(f.name)||f.size>20*1024*1024)throw new Error('请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片。');const [asset]=await api.importFiles([{name:f.name,bytes:await f.arrayBuffer()}]);patch({mode:'image',imageId:asset.id});}catch(e){setError((e as Error).message);}finally{setUploading(false);if(file.current)file.current.value='';}}
 async function run(){setError('');setSending(true);try{await api.generateTripo({...draft,requestId:crypto.randomUUID()});}catch(e){setError((e as Error).message);}finally{setSending(false);}}
 return <main className="tripo-workbench">
  <section className="tripo-controls" aria-label="Tripo 生成设置"><div className="tripo-title"><Box size={20}/><div><h2>创建 3D 模型</h2><span>Tripo H3.1</span></div></div>
   <div className="tripo-tabs" role="group" aria-label="3D 生成模式"><button aria-pressed={draft.mode==='text'} onClick={()=>patch({mode:'text'})}>文字生成</button><button aria-pressed={draft.mode==='image'} onClick={()=>patch({mode:'image'})}>图片生成</button></div>
   {draft.mode==='text'?<label className="field">模型描述<textarea aria-label="3D 模型描述" rows={7} maxLength={1000} value={draft.prompt} placeholder="例如：一个低多边形风格的浮空岛，石质建筑、青绿色屋顶，适合游戏场景。" onChange={e=>patch({prompt:e.target.value})}/><small>{draft.prompt.length} / 1000</small></label>:<div className="tripo-reference"><input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>void upload(e.target.files)}/><button className="secondary" disabled={uploading} onClick={()=>file.current?.click()}>{uploading?<LoaderCircle size={15} className="spin"/>:<ImagePlus size={15}/>}上传参考图片</button><label className="field">参考图片<select aria-label="Tripo 参考图片" value={draft.imageId||''} onChange={e=>patch({imageId:e.target.value||undefined})}><option value="">选择已导入图片</option>{images.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>{images.find(a=>a.id===draft.imageId)&&<img src={images.find(a=>a.id===draft.imageId)!.url} alt="3D 参考图片"/>}<small>PNG / JPEG / WebP · 最大 20 MB。主体清晰、遮挡较少的图片效果更好。</small></div>}
   <label className="tripo-option"><input type="checkbox" checked={draft.texture} onChange={e=>patch({texture:e.target.checked})}/>生成纹理</label><label className="tripo-option"><input type="checkbox" disabled={!draft.texture} checked={draft.pbr} onChange={e=>patch({pbr:e.target.checked})}/>PBR 材质</label>
   {!configured&&<button className="secondary" onClick={settings}>配置 Tripo API Key</button>}
   <p className="tripo-note">生成会消耗 Tripo 积分，费用以服务商实际扣费为准。结果自动保存在工作台，下载后可用于 Blender、Unity 等工具。</p>
   <button className="generate-button" disabled={!configured||busy||sending||uploading||draft.mode==='text'&&!draft.prompt.trim()||draft.mode==='image'&&!draft.imageId} onClick={()=>void run()}>{busy||sending?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>}生成 3D 模型</button>
   {error&&<p className="tripo-error" role="alert">{error}</p>}
   <div className="tripo-tasks"><h3>生成记录</h3>{!state.tasks.length&&<p className="tripo-note">生成进度和历史会显示在这里。</p>}{state.tasks.slice().reverse().map(task=><article key={task.id} className="tripo-task" data-task-state={task.state}><div><strong>{labels[task.state]}</strong><small>{task.progress}%</small></div><p>{task.mode==='text'?task.prompt:workspace.assets.find(a=>a.id===task.imageId)?.name||'图片生成'}</p>{tripoBusy(task)&&<progress max={100} value={task.progress}/>}<small>{new Date(task.createdAt).toLocaleString('zh-CN')}{task.credits!==undefined?` · ${task.credits} 积分`:''}</small>{(task.error||task.pollError)&&<p role="alert" className="tripo-error">{task.error||task.pollError}</p>}{task.remoteTaskId&&<small className="tripo-task-id">任务 ID：{task.remoteTaskId}</small>}{task.state==='submission_unknown'&&<p className="tripo-note">请先在 Tripo 控制台核实任务，避免重复生成和扣费。</p>}{task.assetId&&<button className="quiet-button" onClick={()=>void api.selectTripo(task.assetId!).catch(e=>setError(e.message))}>查看模型</button>}{task.remoteTaskId&&(['save_failed'].includes(task.state)||!!task.pollError)&&<button className="secondary compact" onClick={()=>void api.retryTripo(task.id).catch(e=>setError(e.message))}><RotateCcw size={12}/>{task.state==='save_failed'?'重试保存':'恢复查询'}</button>}</article>)}</div>
  </section>
  <section className="tripo-result"><header><div><h2>模型预览</h2><span>{selected?.name||'GLB · 三维预览'}</span></div><button className="secondary compact" disabled={!selected} onClick={()=>void api.exportAsset(selected!.id).catch(e=>setError(e.message))}><Download size={14}/>下载 GLB</button></header><TripoPreview asset={selected}/><div className="tripo-models">{models.map(a=><button key={a.id} aria-pressed={selected?.id===a.id} onClick={()=>void api.selectTripo(a.id).catch(e=>setError(e.message))}><Box size={16}/><span>{a.name}<small>{(a.size/1024/1024).toFixed(1)} MB</small></span></button>)}</div></section>
 </main>;
}
function TripoPreview({asset}:{asset?:Asset}){
 const api=useWorkbenchAPI(),host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!asset||!host.current)return;const element=host.current;let live=true,frame=0,renderer:THREE.WebGLRenderer|undefined,controls:OrbitControls|undefined,observer:ResizeObserver|undefined,scene:THREE.Scene|undefined;
  const decoderManager=new THREE.LoadingManager();decoderManager.setURLModifier(url=>url.endsWith('.wasm')?dracoWasmURL:dracoWrapperURL);const draco=new DRACOLoader(decoderManager);draco.setDecoderConfig({type:'wasm'});
  setLoading(true);setError('');
  const dispose=(object:THREE.Object3D)=>object.traverse(node=>{const mesh=node as THREE.Mesh;mesh.geometry?.dispose();const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const material of materials.filter(Boolean)){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.dispose();material.dispose();}});
  void (async()=>{try{
   const bytes=await api.modelData(asset.id);
   const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(!url.startsWith('blob:')&&!url.startsWith('data:'))throw new Error('预览仅支持包含纹理的独立 GLB 文件。');return url;});
   const loader=new GLTFLoader(manager);loader.setDRACOLoader(draco);const gltf=await loader.parseAsync(bytes,'');if(!live){dispose(gltf.scene);return;}
   scene=new THREE.Scene();scene.background=new THREE.Color('#20242b');scene.add(new THREE.HemisphereLight(0xffffff,0x737782,3));const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(3,6,4);scene.add(light);
   const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),length=Math.max(size.x,size.y,size.z);if(!Number.isFinite(length)||length<=0)throw new Error('模型没有可预览的几何体。');gltf.scene.position.sub(center);const normalized=new THREE.Group();normalized.add(gltf.scene);normalized.scale.setScalar(2/length);scene.add(normalized);
   const camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.set(3,2,4);renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;element.appendChild(renderer.domElement);
   controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.5;controls.maxDistance=20;controls.update();
   const resize=()=>{const width=element.clientWidth,height=element.clientHeight;renderer!.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();};observer=new ResizeObserver(resize);observer.observe(element);resize();
   const render=()=>{if(!live)return;controls!.update();renderer!.render(scene!,camera);frame=requestAnimationFrame(render);};render();setLoading(false);
  }catch(e){if(live){setError((e as Error).message);setLoading(false);}}})();
  return()=>{live=false;cancelAnimationFrame(frame);observer?.disconnect();controls?.dispose();if(scene)dispose(scene);draco.dispose();renderer?.dispose();renderer?.domElement.remove();};
 },[asset?.id,api]);
 return <div className="tripo-stage" ref={host}>{!asset?<div className="tripo-empty"><Box size={52}/><h3>让想法成为立体模型</h3><p>描述模型或上传参考图片，生成后可在这里旋转、缩放和平移。</p></div>:loading?<div className="tripo-preview-overlay"><LoaderCircle size={22} className="spin"/>正在加载模型…</div>:error?<div className="tripo-preview-overlay tripo-error" role="alert">{error}<small>模型文件仍可下载。</small></div>:<span className="tripo-view-hint">拖动旋转 · 滚轮缩放 · 右键平移</span>}</div>;
}
