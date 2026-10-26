import {layoutControlHidden} from '../shared/ui-layout-controls';
import {layoutNodeLocked} from '../shared/ui-layout-groups';
import {useEffect,useRef,type PointerEvent,type MouseEvent} from 'react';
import {ChevronDown,ChevronRight,Folder,FolderOpen,Grip,Eye,EyeOff,LockKeyhole,UnlockKeyhole} from 'lucide-react';
import {layoutLayerRows,type LayoutLayerRow} from '../shared/ui-layout-groups';
import type {UILayout} from '../shared/ui-layout';
interface Props {
 document:UILayout;selection:string[];collapsed:Record<string,boolean>;collapse:(id:string)=>void;dragging:string[];drop?:{id:string;side:'above'|'below'};renaming?:string;
 pick:(id:string,event:MouseEvent)=>void;context:(event:MouseEvent,id:string)=>void;start:(event:PointerEvent,id:string)=>void;move:(event:PointerEvent)=>void;end:(event:PointerEvent,cancel?:boolean)=>void;
 startRename:(id:string)=>void;rename:(id:string,name:string)=>void;cancelRename:()=>void;toggle:(id:string,kind:'hidden'|'locked',value:boolean)=>void;scrolled:()=>void;icon:(row:LayoutLayerRow)=>React.ReactNode;
}
export function UILayoutLayers(p:Props){
 const rows=layoutLayerRows(p.document,p.collapsed);
 return <div className="layout-layers" role="tree" aria-label="布局图层列表" aria-multiselectable="true" onScroll={p.scrolled}>{rows.map(row=>{const group=row.group,owner=row.parent&&p.document.groups?.find(g=>g.id===row.parent),hidden=group?group.hidden:!!row.node&&layoutControlHidden(p.document,row.node),locked=group?group.locked:!!row.node&&layoutNodeLocked(p.document,row.node),selected=p.selection.includes(row.id)||!!row.parent&&p.selection.includes(row.parent);return <div key={row.id} role="treeitem" aria-level={row.depth+1} aria-selected={selected} aria-expanded={group||row.node?.type==='scrollview'?!p.collapsed[row.id]:undefined} className={`layout-layer ${group?'layout-group':''} ${selected?'selected':''} ${hidden?'hidden':''} ${p.dragging.includes(row.id)?'dragging':''} ${p.drop?.id===row.id?'layer-drop-'+p.drop.side:''}`} data-layer-id={row.id} data-group-id={group?.id} data-layer-parent={row.parent} style={{paddingLeft:7+row.depth*16}} onContextMenu={e=>p.context(e,row.id)}>
  {(group||row.node?.type==='scrollview')&&<button className="layout-group-toggle" aria-label={`${p.collapsed[row.id]?'展开':'折叠'}组 ${row.name}`} onClick={()=>p.collapse(row.id)}>{p.collapsed[row.id]?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button>}
  {p.renaming===row.id?<LayerRename key={row.id} name={row.name} save={name=>p.rename(row.id,name)} cancel={p.cancelRename}/>:<button className="layout-layer-main" aria-label={`选择${group?'组':'图层'} ${row.name}`} onPointerDown={e=>p.start(e,row.id)} onPointerMove={p.move} onPointerUp={e=>p.end(e)} onPointerCancel={e=>p.end(e,true)} onClick={e=>p.pick(row.id,e)} onDoubleClick={e=>{e.preventDefault();p.startRename(row.id);}} onKeyDown={e=>{if(e.key==='F2'){e.preventDefault();p.startRename(row.id);}else if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();p.context({preventDefault:()=>{},stopPropagation:()=>{},clientX:r.left+15,clientY:r.bottom} as MouseEvent,row.id);}}} title={`${row.name} · 双击重命名 · 拖动调整层级`}><Grip size={10} className="layout-layer-grip"/>{group?p.collapsed[row.id]?<Folder size={13}/>:<FolderOpen size={13}/>:p.icon(row)}<span>{row.name}</span></button>}
  <button aria-label={`${hidden?'显示':'隐藏'} ${row.name}`} onClick={()=>p.toggle(row.id,'hidden',!(group?.hidden??row.node?.hidden))}>{hidden?<EyeOff size={12}/>:<Eye size={12}/>}</button><button aria-label={`${locked?'解锁':'锁定'} ${row.name}`} onClick={()=>p.toggle(row.id,'locked',!(group?.locked??row.node?.locked))}>{locked?<LockKeyhole size={12}/>:<UnlockKeyhole size={12}/>}</button>
 </div>;})}{!rows.length&&<div className="layout-layers-empty">从上方拖入第一个构件</div>}</div>;
}
function LayerRename({name,save,cancel}:{name:string;save:(name:string)=>void;cancel:()=>void}){
 const input=useRef<HTMLInputElement>(null),done=useRef(false);useEffect(()=>{input.current?.focus();input.current?.select();},[]);
 function finish(){if(done.current)return;done.current=true;const value=input.current?.value.trim();if(value)save(value);else cancel();}
 return <input autoFocus ref={input} className="layout-layer-rename" aria-label="图层或组名称" defaultValue={name} maxLength={100} onPointerDown={e=>e.stopPropagation()} onBlur={finish} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish();}if(e.key==='Escape'){e.preventDefault();done.current=true;cancel();}}}/>;
}
