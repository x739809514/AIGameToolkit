import {useState} from 'react';
import {validateRig2D,sampleMotion2D,type Clip2D} from '../shared/skeletal2d';
import {walkContacts,solePosition,type FootContact2D} from '../shared/cutout-foot-lock';
import type {CutoutDocument} from '../shared/cutout-studio';
export function CutoutFootContacts({doc,clip,time,change,disabled=false}:{doc:CutoutDocument;clip:Clip2D;time:number;change:(clip:Clip2D)=>void;disabled?:boolean}){
 const [chain,setChain]=useState(doc.rig.footRig?.chains[0]?.id??''),[start,setStart]=useState(0),[end,setEnd]=useState(clip.duration/2),[cycles,setCycles]=useState(1),[error,setError]=useState(''),chains=doc.rig.footRig?.chains??[];
 function defaultTarget(c:FootContact2D):[number,number]{const chain=chains.find(v=>v.id===c.chainId);return chain?[solePosition(doc.rig,chain,sampleMotion2D(clip,c.start))[0],doc.rig.footRig!.groundY]:[0,doc.rig.footRig?.groundY??0];}
 function save(contacts:FootContact2D[],footLock=clip.footLock!==false){try{const next={...clip,contacts,footLock};validateRig2D({...doc.rig,clips:[next]});change(next);setError('');}catch(e){setError((e as Error).message);}}
 return <section className="cutout-key-editor"><h3>自动脚底锁定</h3>{!chains.length?<p>请先在第三步设置 髋→膝→脚 骨链和地面。</p>:<>
  <label><input aria-label="启用动作脚底锁定" type="checkbox" disabled={disabled} checked={clip.footLock!==false&&!!clip.contacts?.length} onChange={e=>save(clip.contacts??[],e.target.checked)}/>启用此动作的支撑脚锁定</label>
  <p>支撑期间固定脚底目标，自动调整髋、膝与脚。超出腿长或角度范围时会显示误差。</p>
  <label>行走周期数<input aria-label="脚底行走周期数" disabled={disabled} type="number" min="1" max="8" value={cycles} onChange={e=>setCycles(Math.max(1,Math.min(8,Math.floor(+e.target.value||1))))}/></label>
  <button aria-label="生成交替脚底支撑" disabled={disabled} onClick={()=>save(walkContacts(doc.rig,clip.duration,cycles),true)}>生成交替支撑区间</button>
  <div className="cutout-contact-form"><select aria-label="接触区间骨链" value={chains.some(c=>c.id===chain)?chain:chains[0].id} disabled={disabled} onChange={e=>setChain(e.target.value)}>{chains.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
   <label>开始<input aria-label="脚底支撑开始" type="number" min="0" max={clip.duration} step=".01" value={start} disabled={disabled} onChange={e=>setStart(+e.target.value)}/></label>
   <label>结束<input aria-label="脚底支撑结束" type="number" min="0" max={clip.duration} step=".01" value={end} disabled={disabled} onChange={e=>setEnd(+e.target.value)}/></label>
   <button aria-label="从播放头设置支撑开始" disabled={disabled} onClick={()=>setStart(Math.min(time,clip.duration))}>从当前时间开始</button>
   <button aria-label="添加脚底支撑区间" disabled={disabled} onClick={()=>save([...(clip.contacts??[]),{chainId:chains.some(c=>c.id===chain)?chain:chains[0].id,start,end}],true)}>添加支撑区间</button>
  </div>
  {clip.contacts?.map((c,i)=><div className="cutout-contact-row" data-foot-contact={i} key={i}>
   <span>{chains.find(v=>v.id===c.chainId)?.name} {c.start.toFixed(2)}–{c.end.toFixed(2)}s</span><button aria-label={'删除脚底支撑 '+i} disabled={disabled} onClick={()=>save(clip.contacts!.filter((_,index)=>i!==index))}>删除</button>
   <details><summary>{c.target?'手动目标':'自动落脚目标'}</summary>{[0,1].map(axis=><label key={axis}>目标 {'XY'[axis]}<input key={(c.target??defaultTarget(c))[axis]} aria-label={'脚底目标 '+i+' '+'XY'[axis]} type="number" min="-16384" max="16384" disabled={disabled} defaultValue={(c.target??defaultTarget(c))[axis]} onBlur={e=>{if(!e.target.value.trim())return;const target=[...(c.target??defaultTarget(c))] as [number,number];target[axis]=+e.target.value;save(clip.contacts!.map((v,index)=>index===i?{...v,target}:v));}}/></label>)}
    <button disabled={disabled} onClick={()=>save(clip.contacts!.map((v,index)=>index===i?{...v,target:undefined}:v))}>恢复自动目标</button>
   </details>
  </div>)}
 </>}{error&&<p role="alert">{error}</p>}</section>;
}
