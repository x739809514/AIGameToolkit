import {worktreeFileDrag} from '../shared/worktree-drag';
const attachmentDrag='application/x-laputa-model-attachment';
import {useMemo,useRef,useState} from 'react';
import {Bone,Box,ChevronRight,ChevronDown,ChevronsDownUp,ChevronsUpDown,Trash2} from 'lucide-react';
import type {ModelNode} from './model-scene';

// Keep the actual bone parenting, including any containers above bones. Mesh-only
// branches are omitted; IDs distinguish bones that happen to share a name.
function boneTree(nodes:ModelNode[]):ModelNode[]{return nodes.flatMap(node=>{if(node.attachmentId)return [node];const children=boneTree(node.children);return node.type==='Bone'||children.length?[{...node,children}]:[];});}
export function ModelHierarchy({nodes,busy,attach,remove}:{nodes?:ModelNode[];busy:boolean;attach:(node:ModelNode,raw:string,files:File[],attachmentId?:string)=>Promise<void>;remove:(id:string)=>void}){
 const [hover,setHover]=useState<string>();
 const tree=useMemo(()=>boneTree(nodes||[]),[nodes]),[expanded,setExpanded]=useState<Record<string,boolean>>({}),[selected,setSelected]=useState<string>(),host=useRef<HTMLUListElement>(null);
 const all=useMemo(()=>{const result:ModelNode[]=[];const visit=(nodes:ModelNode[])=>nodes.forEach(node=>{result.push(node);visit(node.children);});visit(tree);return result;},[tree]),count=(()=>{let n=0;const visit=(nodes:ModelNode[])=>nodes.forEach(node=>{if(node.attachmentId)return;if(node.type==='Bone')n++;visit(node.children);});visit(tree);return n;})(),active=selected&&all.some(node=>node.id===selected)?selected:tree[0]?.id;
 const isOpen=(node:ModelNode,depth:number)=>expanded[node.id]??depth<4;
 function toggle(node:ModelNode,depth:number){setExpanded(old=>({...old,[node.id]:!isOpen(node,depth)}));}
 function focus(id:string){const element=Array.from(host.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')||[]).find(element=>element.dataset.nodeId===id);element?.focus();}
 function key(event:React.KeyboardEvent<HTMLLIElement>,node:ModelNode,depth:number,parent?:ModelNode){
  if(event.target!==event.currentTarget)return;const visible=Array.from(host.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')||[]),index=visible.indexOf(event.currentTarget);
  if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();}
  if(event.key==='ArrowDown')visible[Math.min(visible.length-1,index+1)]?.focus();
  if(event.key==='ArrowUp')visible[Math.max(0,index-1)]?.focus();
  if(event.key==='Home')visible[0]?.focus();if(event.key==='End')visible.at(-1)?.focus();
  if(event.key==='ArrowRight'&&node.children.length){if(!isOpen(node,depth))toggle(node,depth);else focus(node.children[0].id);}
  if(event.key==='ArrowLeft'){if(node.children.length&&isOpen(node,depth))toggle(node,depth);else if(parent)focus(parent.id);}
  if((event.key==='Enter'||event.key===' ')&&node.children.length)toggle(node,depth);
 }
 function render(nodes:ModelNode[],depth=0,parent?:ModelNode,path:string[]=[],insideAttachment=false):React.ReactNode{return nodes.map(node=>{const branch=node.children.length>0,open=isOpen(node,depth),label=node.name.replace(/^mixamorig\d*:?/i,''),fullPath=[...path,node.name],target=node.type==='Bone'&&!insideAttachment&&!node.attachmentId;return <li key={node.id} role="treeitem" aria-label={label} aria-level={depth+1} aria-selected={active===node.id} aria-expanded={branch?open:undefined} tabIndex={active===node.id?0:-1} data-node-id={node.id} data-node-name={node.name} data-node-type={node.type} data-attachment-id={node.attachmentId} onFocus={event=>{if(event.target===event.currentTarget)setSelected(node.id);}} onKeyDown={event=>key(event,node,depth,parent)}>
   <div className={`model-hierarchy-row ${active===node.id?'selected':''} ${hover===node.id?'attachment-drop-target':''}`}  style={{paddingLeft:8+depth*12}} title={fullPath.join(' / ')} draggable={!!node.attachmentId&&!busy} onDragStart={event=>{if(!node.attachmentId)return;event.stopPropagation();event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(attachmentDrag,node.attachmentId);}} onDragOver={event=>{if(!target||busy)return;if(!event.dataTransfer.types.some(type=>[worktreeFileDrag,attachmentDrag,'Files'].includes(type)))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=event.dataTransfer.types.includes(attachmentDrag)?'move':'copy';setHover(node.id);}} onDragLeave={()=>setHover(undefined)} onDrop={event=>{event.preventDefault();event.stopPropagation();setHover(undefined);if(!target||busy)return;setExpanded(old=>({...old,[node.id]:true}));void attach(node,event.dataTransfer.getData(worktreeFileDrag),Array.from(event.dataTransfer.files),event.dataTransfer.getData(attachmentDrag)||undefined);}} onClick={()=>focus(node.id)} onDoubleClick={()=>{if(branch)toggle(node,depth);}}>
    {branch?<button className="model-hierarchy-toggle" tabIndex={-1} aria-label={`${open?'折叠':'展开'} ${label}`} onClick={event=>{event.stopPropagation();focus(node.id);toggle(node,depth);}} onDoubleClick={event=>event.stopPropagation()}>{open?<ChevronDown size={12}/>:<ChevronRight size={12}/>}</button>:<span className="model-hierarchy-spacer"/>}
    {node.type==='Bone'?<Bone size={12}/>:<Box size={12}/>}<span className="model-hierarchy-name">{label}</span>{node.attachmentId&&<button className="model-attachment-remove icon-button" disabled={busy} aria-label={`移除挂载 ${label}`} title="移除挂载" onClick={event=>{event.stopPropagation();remove(node.attachmentId!);}}><Trash2 size={11}/></button>}
   </div>{branch&&open&&<ul role="group">{render(node.children,depth+1,node,fullPath,insideAttachment||!!node.attachmentId)}</ul>}
  </li>;});}
 const picked=all.find(node=>node.id===selected);
 return <section className="model-hierarchy-section" aria-label="Hierarchy 栏目">
  <header className="model-hierarchy-heading"><Bone size={14}/><h2>Hierarchy</h2><span>{count} 骨骼</span><button className="icon-button" aria-label="展开全部骨骼" title="展开全部" disabled={!tree.length} onClick={()=>setExpanded(Object.fromEntries(all.map(node=>[node.id,true])))}><ChevronsUpDown size={13}/></button><button className="icon-button" aria-label="折叠全部骨骼" title="折叠全部" disabled={!tree.length} onClick={()=>{setExpanded(Object.fromEntries(all.map(node=>[node.id,false])));setSelected(tree[0]?.id);}}><ChevronsDownUp size={13}/></button></header>
  <p className="model-hierarchy-help" role="status">{busy?'正在处理 FBX 挂载…':'拖入 FBX 到骨骼，作为子物体挂载'}</p>
  {tree.length?<ul ref={host} className="model-hierarchy" role="tree" aria-label="角色骨骼层级">{render(tree)}</ul>:<p className="model-hierarchy-empty">正在加载角色骨骼…</p>}
  {picked&&<div className="model-hierarchy-selection" title={picked.name}><Bone size={11}/><span>{picked.name}</span></div>}
 </section>;
}
