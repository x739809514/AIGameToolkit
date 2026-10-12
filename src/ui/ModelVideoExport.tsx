import {useEffect,useRef,useState} from 'react';
import {Download,LoaderCircle,Video,X} from 'lucide-react';
import type {Asset} from '../shared/types';
import {modelVideoFrames,modelVideoFrameTime,type ModelVideoInput} from '../shared/model-video';
import {useWorkbenchAPI} from './workbench-api';
import type {ModelScene} from './model-scene';
export function ModelVideoExport({viewer,asset,close}:{viewer:ModelScene;asset:Asset;close:()=>void}){
  const api=useWorkbenchAPI();const [start,setStart]=useState(0),[end,setEnd]=useState(viewer.duration),[height,setHeight]=useState(1080),[fps,setFPS]=useState(30),[phase,setPhase]=useState<'setup'|'rendering'|'encoding'|'complete'>('setup'),[progress,setProgress]=useState(0),[error,setError]=useState(''),[result,setResult]=useState<Asset>(),[saved,setSaved]=useState('');
  const alive=useRef(true),controller=useRef<AbortController|undefined>(undefined),job=useRef<string|undefined>(undefined),capture=useRef<ReturnType<ModelScene['beginVideoCapture']>|undefined>(undefined);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();if(job.current)void api.cancelModelVideo(job.current).catch(()=>{});capture.current?.restore();};},[api]);
  const width=Math.max(128,Math.round(height*viewer.camera.aspect/2)*2),seconds=(end-start)/viewer.speed;
  const busy=phase==='rendering'||phase==='encoding';
  async function cancel(){controller.current?.abort();if(job.current)await api.cancelModelVideo(job.current).catch(()=>{});}
  async function run(){
    if(busy)return;setError('');const settings:ModelVideoInput={assetId:asset.id,clipIndex:viewer.clipIndex,start,end,speed:viewer.speed,width,height,fps};
    try{modelVideoFrames(settings);if(end>viewer.duration+.00001)throw new Error('导出范围不能超过动画长度。');}catch(e){setError(e instanceof Error?e.message:'导出参数不正确');return;}
    const abort=new AbortController();controller.current=abort;setPhase('rendering');setProgress(0);
    try{
      capture.current=viewer.beginVideoCapture(width,height);
      const created=await api.beginModelVideo(settings);job.current=created.id;
      if(abort.signal.aborted)throw new Error('视频导出已取消。');
      for(let index=0;index<created.count;index++){
        const pixels=await capture.current.frame(modelVideoFrameTime(settings,index),abort.signal);
        if(abort.signal.aborted)throw new Error('视频导出已取消。');
        await api.appendModelVideoFrame(created.id,index,pixels);if(alive.current)setProgress((index+1)/created.count);
      }
      if(abort.signal.aborted)throw new Error('视频导出已取消。');if(alive.current)setPhase('encoding');
      const video=await api.finishModelVideo(created.id);job.current=undefined;
      if(alive.current){setResult(video);setPhase('complete');}
    }catch(e){if(job.current)await api.cancelModelVideo(job.current).catch(()=>{});job.current=undefined;if(alive.current){setPhase('setup');setError(abort.signal.aborted?'视频导出已取消。':e instanceof Error?e.message:'视频导出失败，请重试。');}}
    finally{capture.current?.restore();capture.current=undefined;controller.current=undefined;}
  }
  return <div className="modal-backdrop"><section className="model-export-dialog" role="dialog" aria-modal="true" aria-labelledby="model-export-title"><div className="modal-heading"><div><h2 id="model-export-title">按当前视角导出视频</h2><p>固定当前相机，导出一次选定的动画范围。</p></div><button className="icon-button" aria-label="关闭视频导出" disabled={busy} onClick={close}><X size={18}/></button></div>
    <div className="model-export-body">{phase==='complete'&&result?<><video className="model-export-preview" src={result.url} controls playsInline/><p role="status">视频已生成并保存在当前工作台。</p><small>{result.width} × {result.height} · {result.fps} FPS · {result.duration?.toFixed(2)} 秒 · MP4</small>{saved&&<p role="status">视频已保存到：{saved}</p>}</>:<><div className="model-export-fields"><label className="field">动画起点（秒）<input type="number" aria-label="视频导出起点" min={0} max={viewer.duration} step="0.001" value={start} disabled={busy} onChange={e=>setStart(e.target.valueAsNumber)}/></label><label className="field">动画终点（秒）<input type="number" aria-label="视频导出终点" min={0} max={viewer.duration} step="0.001" value={end} disabled={busy} onChange={e=>setEnd(e.target.valueAsNumber)}/></label><label className="field">分辨率<select aria-label="视频导出分辨率" value={height} disabled={busy} onChange={e=>setHeight(Number(e.target.value))}><option value={720}>720p</option><option value={1080}>1080p</option></select></label><label className="field">帧率<select aria-label="视频导出帧率" value={fps} disabled={busy} onChange={e=>setFPS(Number(e.target.value))}>{[24,30,60].map(n=><option key={n} value={n}>{n} FPS</option>)}</select></label></div><p className="model-export-summary">{width} × {height} · {Number.isFinite(seconds)&&seconds>0?seconds.toFixed(2):'—'} 秒 · {viewer.speed}× · MP4</p><p className="model-export-hint">沿用当前视角、骨骼、网格与忽略位移设置。画面比例与预览一致，视频不包含界面和鼠标，无音轨。</p>{busy&&<div className="model-export-progress" role="status"><span><LoaderCircle size={15} className="spin"/>{phase==='rendering'?`正在渲染 ${Math.round(progress*100)}%`:'正在编码视频…'}</span><progress max={1} value={phase==='encoding'?1:progress}/></div>}</>}{error&&<p className="model-export-error" role="alert">{error}</p>}</div>
    <div className="modal-footer">{busy?<><span>本地处理，可取消</span><button className="secondary" onClick={()=>void cancel()}>取消导出</button></>:phase==='complete'&&result?<><button className="secondary" onClick={close}>完成</button><button className="generate-button" aria-label="保存导出 MP4" onClick={()=>void api.exportAsset(result.id).then(path=>{if(path)setSaved(path);}).catch(e=>setError(e.message))}><Download size={14}/>保存 MP4</button></>:<><button className="secondary" onClick={close}>取消</button><button className="generate-button" aria-label="开始导出视频" onClick={()=>void run()}><Video size={14}/>开始导出</button></>}</div>
  </section></div>;
}
