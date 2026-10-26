import {useState,type CSSProperties} from 'react';
import {layoutPages,type UILayout,type LayoutNode} from '../shared/ui-layout';
import {layoutGroupForNode} from '../shared/ui-layout-groups';
import {LayoutShape} from './UILayoutArtwork';
const color=(hex:string,opacity=1)=>hex==='transparent'?'transparent':`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${opacity})`;
export function UILayoutRuntime({document:doc,navigate}:{document:UILayout;navigate:(id:string)=>void}){
 const [values,setValues]=useState<Record<string,boolean|number>>({}),[visibility,setVisibility]=useState<Record<string,boolean>>({}),[message,setMessage]=useState('');
 const page=doc.activePageId??'page-1',key=(id:string)=>page+':'+id;
 function hidden(n:LayoutNode){const g=layoutGroupForNode(doc,n.id);return (visibility[key(n.id)]??n.hidden)||(g&&(visibility[key(g.id)]??g.hidden));}
 function act(n:LayoutNode){const c=n.control!;if(c.action==='navigate'){const target=layoutPages(doc).find(p=>p.id===c.targetPageId);if(target){navigate(target.id);setMessage('');}else setMessage('请先为按钮选择有效的目标页面。');}
  else if(c.action==='toggle'){const target=doc.nodes.find(p=>p.id===c.targetId),g=doc.groups?.find(g=>g.id===c.targetId);if(target||g){const id=key(c.targetId);setVisibility(v=>({...v,[id]:!(v[id]??(target?.hidden??g?.hidden??false))}));setMessage('');}else setMessage('请先为按钮选择有效的目标图层。');}
  else if(c.action==='reset'){setValues({});setVisibility({});setMessage('控件已恢复默认状态。');}
  else setMessage(c.message||'按钮已点击');
 }
 function render(parentId?:string):React.ReactNode{const parent=doc.nodes.find(n=>n.id===parentId);return doc.nodes.filter(n=>n.parentId===parentId&&!hidden(n)).map((n,index)=>{
  const c=n.control,style:CSSProperties={position:'absolute',left:n.x-(parent?.x??0),top:n.y-(parent?.y??0),width:n.width,height:n.height,transform:`rotate(${n.rotation}deg)`,transformOrigin:'center',opacity:n.opacity},appearance:CSSProperties={width:'100%',height:'100%',boxSizing:'border-box',borderRadius:n.radius,background:color(n.fill,n.fillOpacity),border:n.stroke==='transparent'?'none':`${n.strokeWidth}px ${n.strokeStyle==='solid'?'solid':n.strokeStyle==='dotted'?'dotted':'dashed'} ${color(n.stroke,n.strokeOpacity)}`,fontSize:n.fontSize,fontFamily:n.fontFamily,fontWeight:n.fontWeight,color:c?.textColor,opacity:c?.disabled?.5:1};
  let content:React.ReactNode;
  if(n.type==='button')content=<button style={{...appearance,textAlign:n.align}} disabled={c!.disabled} aria-label={n.name} onClick={()=>act(n)}>{n.text}</button>;
  else if(n.type==='checkbox')content=<label className="layout-runtime-checkbox" style={{fontSize:n.fontSize,color:c!.textColor,fontFamily:n.fontFamily,opacity:c!.disabled?.5:1}}><input type="checkbox" disabled={c!.disabled} checked={Boolean(values[key(n.id)]??c!.checked)} onChange={e=>setValues(v=>({...v,[key(n.id)]:e.target.checked}))} aria-label={n.name}/><span>{n.text}</span></label>;
  else if(n.type==='dropdown')content=<select style={appearance} disabled={c!.disabled} aria-label={n.name} value={Number(values[key(n.id)]??c!.selectedIndex)} onChange={e=>setValues(v=>({...v,[key(n.id)]:Number(e.target.value)}))}>{c!.options.map((option,i)=><option key={i} value={i}>{option}</option>)}</select>;
  else if(n.type==='scrollview'){const children=doc.nodes.filter(child=>child.parentId===n.id),width=Math.max(n.width,...children.map(child=>child.x-n.x+child.width+(n.layout?.padding??0))),height=Math.max(n.height,...children.map(child=>child.y-n.y+child.height+(n.layout?.padding??0)));content=<div className="layout-runtime-scroll" role="region" tabIndex={0} aria-label={n.name} aria-disabled={c!.disabled} style={{...appearance,overflowX:c!.disabled||c!.scrollAxis==='vertical'?'hidden':'auto',overflowY:c!.disabled||c!.scrollAxis==='horizontal'?'hidden':'auto'}}><div style={{position:'relative',width,height}}>{render(n.id)}</div></div>;}
  else content=<svg width={n.width} height={n.height} style={{display:'block',overflow:'visible'}}><LayoutShape node={n} clipID={'runtime-'+index+'-'+n.id}/></svg>;
  return <div key={n.id} data-runtime-node={n.id} style={style}>{content}</div>;
 });}
 return <div className="layout-runtime" aria-label="布局交互预览" style={{width:doc.width,height:doc.height,background:color(doc.background,doc.backgroundOpacity??1)}}>{render()}{message&&<output className="layout-runtime-message" role="status">{message}<button aria-label="关闭预览提示" onClick={()=>setMessage('')}>×</button></output>}</div>;
}
