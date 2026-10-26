import {useState,type ReactNode} from 'react';
import {Bone,ChevronDown,ChevronRight} from 'lucide-react';
import {cutoutRigTree,type CutoutRigTreeNode} from '../shared/cutout-rig';
import type {Rig2D} from '../shared/skeletal2d';
export function CutoutRigTree({rig,selected,select,renderPart,bind}:{rig:Rig2D;selected:string;select:(id:string)=>void;renderPart:(id:string,depth:number)=>ReactNode;bind?:(partId:string,boneId:string)=>void}){
 const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
 function toggle(id:string){setCollapsed(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 function node(item:CutoutRigTreeNode,depth:number):ReactNode{
  const bone=rig.bones.find(b=>b.id===item.id)!,children=!!(item.children.length||item.partIds.length),open=!collapsed.has(item.id);
  return <div key={item.id} role="treeitem" aria-level={depth} aria-expanded={children?open:undefined} aria-selected={selected===item.id} data-tree-bone={item.id}>
   <div className={'cutout-bone-row '+(selected===item.id?'selected':'')} style={{paddingLeft:8+(depth-1)*12}} onDragOver={e=>{if(bind&&e.dataTransfer.types.includes('application/x-cutout-part')){e.preventDefault();e.stopPropagation();}}} onDrop={e=>{if(!bind)return;const id=e.dataTransfer.getData('application/x-cutout-part');if(id){e.preventDefault();e.stopPropagation();bind(id,item.id);setCollapsed(previous=>{const next=new Set(previous);next.delete(item.id);return next;});}}}>
    <button aria-label={(open?'折叠骨骼 ':'展开骨骼 ')+(bone.name??bone.id)} className="cutout-tree-toggle" disabled={!children} tabIndex={-1} onClick={()=>toggle(item.id)}>{children?(open?<ChevronDown size={12}/>:<ChevronRight size={12}/>):<span/>}</button>
    <button className="cutout-bone-name" aria-label={'选择骨骼 '+(bone.name??bone.id)} aria-pressed={selected===item.id} onClick={()=>select(item.id)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(children&&((e.key==='ArrowLeft'&&open)||(e.key==='ArrowRight'&&!open)))toggle(item.id);}}}><Bone size={13}/><span>{bone.name??bone.id}</span><small>{item.partIds.length||''}</small></button>
   </div>
   {children&&open&&<div role="group">{item.partIds.map(id=>renderPart(id,depth+1))}{item.children.map(child=>node(child,depth+1))}</div>}
  </div>;
 }
 return <div role="tree" aria-label="骨骼与部件层级" className="cutout-rig-tree">{node(cutoutRigTree(rig),1)}</div>;
}
