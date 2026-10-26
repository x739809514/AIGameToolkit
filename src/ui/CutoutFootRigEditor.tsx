import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {worldBones2D,inverse2D,transform2D,type Point2D} from '../shared/skeletal2d';
import {validateFootRig,type FootChain2D} from '../shared/cutout-foot-lock';
import {inferBoneRole} from '../shared/cutout-motion-templates';
import type {CutoutDocument} from '../shared/cutout-studio';
import {cutoutAlphaBounds} from './cutout-render';
const emptyChain=():FootChain2D=>({id:'',name:'新骨链',hip:'',knee:'',foot:'',sole:[0,0],bend:1});
export function CutoutFootRigEditor({doc,images,canvas,change,boneEditing=false,startEditing=()=>{}}:{doc:CutoutDocument;boneEditing?:boolean;startEditing?:()=>void;images:Map<string,HTMLImageElement>;canvas:HTMLCanvasElement|null;change:(d:CutoutDocument)=>void}){
 const [selected,setSelected]=useState(''),[form,setForm]=useState<FootChain2D>(emptyChain),[placing,setPlacing]=useState(false),[error,setError]=useState(''),chains=doc.rig.footRig?.chains??[],world=worldBones2D(doc.rig);
 useEffect(()=>{if(boneEditing)setPlacing(false);},[boneEditing]);
 useEffect(()=>{const chain=chains.find(c=>c.id===selected);if(chain)setForm(structuredClone(chain));else if(selected){setSelected('');setForm(emptyChain());}setPlacing(false);},[selected,doc.rig.footRig]);
 function commit(chains:FootChain2D[],groundY=doc.rig.footRig?.groundY??doc.rig.canvas[1]*.9){try{const rig={...doc.rig,footRig:{groundY,chains},clips:doc.rig.clips.map(c=>({...c,contacts:c.contacts?.filter(v=>chains.some(chain=>chain.id===v.chainId))}))};validateFootRig(rig);change({...doc,rig});setError('');return true;}catch(e){setError((e as Error).message);return false;}}
 function sole(foot:string):Point2D{const part=doc.rig.parts.find(p=>p.bone===foot),a=doc.artwork.find(a=>a.partId===part?.id),im=images.get(part?.id??'');if(part&&a&&im){const [x,y,w,h]=cutoutAlphaBounds(a,part,im,doc.rig.canvas);return transform2D(inverse2D(world.get(foot)!),[x+w/2+(part.offset?.[0]??0),y+h+(part.offset?.[1]??0)]);}return [0,Math.max(4,doc.rig.canvas[1]*.015)];}
 function suggest(){try{const result:FootChain2D[]=[];for(const side of ['left','right'] as const){const hip=doc.rig.bones.find(b=>inferBoneRole(b)===(side==='left'?'leftThigh':'rightThigh')),knee=doc.rig.bones.find(b=>b.parent===hip?.id&&inferBoneRole(b)===(side==='left'?'leftShin':'rightShin')),foot=doc.rig.bones.find(b=>b.parent===knee?.id&&inferBoneRole(b)===(side==='left'?'leftFoot':'rightFoot'));if(hip&&knee&&foot){const h=world.get(hip.id)!,k=world.get(knee.id)!,f=world.get(foot.id)!,cross=(k[4]-h[4])*(f[5]-k[5])-(k[5]-h[5])*(f[4]-k[4]);result.push({id:side+'-leg',name:side==='left'?'左脚':'右脚',hip:hip.id,knee:knee.id,foot:foot.id,sole:sole(foot.id),bend:cross<0?-1:1});}}if(!result.length)throw Error('请先标记 髋→膝→脚 的用途及直接父子关系，或手动选择骨链。');const ground=Math.max(...result.map(c=>transform2D(world.get(c.foot)!,c.sole)[1]));if(commit(result,ground))setSelected(result[0].id);}catch(e){setError((e as Error).message);}}
 function save(){const value={...form,id:form.id||'leg-'+crypto.randomUUID()};if(commit([...chains.filter(c=>c.id!==value.id),value]))setSelected(value.id);}
 return <section className="cutout-deform-panel"><h3>脚底锁定设置</h3><p>定义髋、膝、脚骨链与脚底点；第五步设置每只脚的支撑区间。</p>
  <button aria-label="识别脚底骨链" onClick={suggest}>按骨骼用途识别腿部</button>
  <label>地面 Y<input key={'ground:'+doc.rig.footRig?.groundY} aria-label="脚底地面 Y" type="number" min="-16384" max="16384" defaultValue={doc.rig.footRig?.groundY??Math.round(doc.rig.canvas[1]*.9)} onBlur={e=>{const v=+e.target.value;if(e.target.value.trim()&&Number.isFinite(v)&&Math.abs(v)<=16384)commit(chains,v);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
  <label>骨链<select aria-label="选择脚底骨链" value={selected} onChange={e=>{setSelected(e.target.value);if(!e.target.value)setForm(emptyChain());}}><option value="">新增骨链</option>{chains.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  <label>名称<input aria-label="脚底骨链名称" maxLength={100} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
  {(['hip','knee','foot'] as const).map((field,i)=><label key={field}>{['髋骨骼','膝骨骼','脚骨骼'][i]}<select aria-label={['脚底髋骨骼','脚底膝骨骼','脚底脚骨骼'][i]} value={form[field]} onChange={e=>{const id=e.target.value;setForm(f=>({...f,[field]:id,...(field==='hip'?{knee:'',foot:''}:field==='knee'?{foot:''}:id?{sole:sole(id)}:{})}));}}><option value="">请选择</option>{doc.rig.bones.filter(b=>field==='hip'||b.parent===(field==='knee'?form.hip:form.knee)).map(b=><option key={b.id} value={b.id}>{b.name??b.id}</option>)}</select></label>)}
  <label>膝盖弯曲<select aria-label="脚底膝盖弯曲方向" value={form.bend} onChange={e=>setForm(f=>({...f,bend:+e.target.value as 1|-1}))}><option value="1">方向 1</option><option value="-1">方向 2</option></select></label>
  {[0,1].map(i=><label key={i}>脚底 {'XY'[i]}<input aria-label={'脚底局部 '+'XY'[i]} type="number" min="-16384" max="16384" value={Math.round(form.sole[i]*100)/100} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v)&&Math.abs(v)<=16384)setForm(f=>({...f,sole:f.sole.map((n,index)=>index===i?v:n) as Point2D}));}}/></label>)}
  <button aria-label="画布设置脚底点" disabled={!form.foot} aria-pressed={placing} onClick={()=>{if(!placing)startEditing();setPlacing(v=>!v);}}>{placing?'点击画布中的脚底接触位置…':'在画布上设置脚底点'}</button>
  <button aria-label="保存脚底骨链" disabled={!form.hip||!form.knee||!form.foot} onClick={save}>保存骨链与脚底点</button>
  {selected&&<button aria-label="删除脚底骨链" onClick={()=>{if(commit(chains.filter(c=>c.id!==selected))){setSelected('');setForm(emptyChain());}}}>删除骨链与接触区间</button>}
  {error&&<p role="alert">{error}</p>}
  {canvas?.parentElement&&(doc.rig.footRig||placing)&&createPortal(<svg className={'cutout-foot-overlay '+(placing?'placing':'')} aria-label="脚底设置画布" viewBox={['0','0',...doc.rig.canvas].join(' ')} onPointerDown={e=>{if(!placing||!form.foot)return;e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect(),p:Point2D=[(e.clientX-r.left)*doc.rig.canvas[0]/r.width,(e.clientY-r.top)*doc.rig.canvas[1]/r.height];setForm(f=>({...f,sole:transform2D(inverse2D(world.get(f.foot)!),p)}));setPlacing(false);}}>
   <line x1="0" x2={doc.rig.canvas[0]} y1={doc.rig.footRig?.groundY??doc.rig.canvas[1]*.9} y2={doc.rig.footRig?.groundY??doc.rig.canvas[1]*.9} stroke="#e7c45f" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>
   {chains.map(c=>{const point=transform2D(world.get(c.foot)!,c.sole);return <circle key={c.id} data-foot-sole={c.id} cx={point[0]} cy={point[1]} r={doc.rig.canvas[0]/Math.max(1,canvas.getBoundingClientRect().width)*5} fill="#e7c45f"/>;})}
   {form.foot&&world.has(form.foot)&&<circle cx={transform2D(world.get(form.foot)!,form.sole)[0]} cy={transform2D(world.get(form.foot)!,form.sole)[1]} r={doc.rig.canvas[0]/Math.max(1,canvas.getBoundingClientRect().width)*7} stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" fill="none"/>}
  </svg>,canvas.parentElement)}
 </section>;
}
