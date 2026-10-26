import {validateLayoutFlow,validateLayoutFrame,layoutDescendants} from './ui-layout-controls';
import type {UILayout,LayoutNode,LayoutGroup} from './ui-layout';
export function validateLayoutGroups(input:unknown,nodes:LayoutNode[]):LayoutGroup[]{
 if(!Array.isArray(input)||input.length>250)throw new Error('图层组数据无效，最多 250 个组。');
 const nodeIDs=new Set(nodes.map(n=>n.id)),ids=new Set<string>(),members=new Set<string>();
 return input.map(g=>{if(!g||typeof g.id!=='string'||!g.id||g.id.length>100||nodeIDs.has(g.id)||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.length>100||!Array.isArray(g.nodeIds)||!g.nodeIds.length||g.nodeIds.length>500||g.nodeIds.some((id:unknown)=>typeof id!=='string'||!nodeIDs.has(id)||members.has(id))||new Set(g.nodeIds).size!==g.nodeIds.length||typeof(g.hidden??false)!=='boolean'||typeof(g.locked??false)!=='boolean')throw new Error('图层组名称、成员或 ID 无效。');ids.add(g.id);g.nodeIds.forEach((id:string)=>members.add(id));if(new Set(g.nodeIds.map((id:string)=>nodes.find(n=>n.id===id)?.parentId??'')).size>1)throw new Error('同一组中的图层须位于同一个父容器内。');return {...(g.layout!==undefined?{layout:validateLayoutFlow(g.layout)}:{}),...(g.frame!==undefined?{frame:validateLayoutFrame(g.frame)}:{}),id:g.id,name:g.name,nodeIds:[...g.nodeIds],hidden:g.hidden??false,locked:g.locked??false};});
}
export function layoutGroupForNode(doc:UILayout,id:string){return doc.groups?.find(g=>g.nodeIds.includes(id));}
export function layoutSelectionNodes(doc:UILayout,ids:string[]):LayoutNode[]{const selected=new Set(ids);for(const g of doc.groups??[])if(selected.has(g.id))g.nodeIds.forEach(id=>selected.add(id));return doc.nodes.filter(n=>selected.has(n.id));}
export function layoutNodeLocked(doc:UILayout,node:LayoutNode){const seen=new Set<string>();let n:LayoutNode|undefined=node;while(n&&!seen.has(n.id)){seen.add(n.id);if(n.locked||layoutGroupForNode(doc,n.id)?.locked)return true;n=doc.nodes.find(parent=>parent.id===n!.parentId);}return false;}

export function pruneUILayoutGroups(doc:UILayout):UILayout {if(!doc.groups)return doc;const ids=new Set(doc.nodes.map(n=>n.id));return {...doc,groups:doc.groups.map(g=>({...g,nodeIds:g.nodeIds.filter(id=>ids.has(id))})).filter(g=>g.nodeIds.length)};}
export function groupUILayoutLayers(doc:UILayout,ids:string[],id:string,name='Group'):UILayout {
 const members=layoutSelectionNodes(doc,ids).map(n=>({...n,hidden:n.hidden||!!layoutGroupForNode(doc,n.id)?.hidden,locked:layoutNodeLocked(doc,n)}));if(members.length<2)return doc;if(new Set(members.map(n=>n.parentId??'')).size>1)throw new Error('请先选择同一父容器中的图层再成组。');
 if(!id||doc.nodes.some(n=>n.id===id)||doc.groups?.some(g=>g.id===id))throw new Error('图层组 ID 无效。');
 const chosen=new Set(members.map(n=>n.id)),top=Math.max(...doc.nodes.map((n,i)=>chosen.has(n.id)?i:-1)),index=doc.nodes.slice(0,top+1).filter(n=>!chosen.has(n.id)).length,remaining=doc.nodes.filter(n=>!chosen.has(n.id));
 const groups=(doc.groups??[]).map(g=>({...g,nodeIds:g.nodeIds.filter(id=>!chosen.has(id))})).filter(g=>g.nodeIds.length);
 return {...doc,nodes:[...remaining.slice(0,index),...members,...remaining.slice(index)],groups:[...groups,{id,name,nodeIds:members.map(n=>n.id),hidden:false,locked:false}]};
}
export function ungroupUILayoutLayers(doc:UILayout,ids:string[]):UILayout {const selected=new Set(ids);return {...doc,nodes:doc.nodes.map(n=>{const g=layoutGroupForNode(doc,n.id);return g&&selected.has(g.id)?{...n,hidden:n.hidden||g.hidden,locked:n.locked||g.locked}:n;}),groups:(doc.groups??[]).filter(g=>!selected.has(g.id))};}
export interface LayoutLayerRow {id:string;name:string;node?:LayoutNode;group?:LayoutGroup;parent?:string;depth:number}
export function layoutLayerRows(doc:UILayout,collapsed:Record<string,boolean>={}):LayoutLayerRow[]{
 const rows:LayoutLayerRow[]=[];function visit(parentId?:string,depth=0){const seen=new Set<string>();for(const node of doc.nodes.slice().reverse().filter(n=>n.parentId===parentId)){const group=layoutGroupForNode(doc,node.id);if(group){if(seen.has(group.id))continue;seen.add(group.id);rows.push({id:group.id,name:group.name,group,parent:parentId,depth});if(!collapsed[group.id])for(const member of doc.nodes.slice().reverse().filter(n=>group.nodeIds.includes(n.id))){rows.push({id:member.id,name:member.name,node:member,parent:group.id,depth:depth+1});if(member.type==='scrollview'&&!collapsed[member.id])visit(member.id,depth+2);}}else{rows.push({id:node.id,name:node.name,node,parent:parentId,depth});if(node.type==='scrollview'&&!collapsed[node.id])visit(node.id,depth+1);}}}visit();return rows;
}

export function duplicateUILayoutLayers(doc:UILayout,ids:string[],uuid:()=>string):{document:UILayout;selection:string[]}{
 const selectedIDs=layoutDescendants(doc,layoutSelectionNodes(doc,ids).map(n=>n.id));const copies=doc.nodes.filter(n=>selectedIDs.has(n.id)).filter(n=>!layoutNodeLocked(doc,n)),mapping=new Map(copies.map(n=>[n.id,uuid()])),selection:string[]=[];
 const groups=(doc.groups??[]).flatMap(g=>{const members=g.nodeIds.filter(id=>mapping.has(id));if(!members.length||!ids.includes(g.id))return [];const id=uuid();if(ids.includes(g.id))selection.push(id);return [{...g,id,name:(g.name+' 副本').slice(0,100),...(g.frame?{frame:{...g.frame,x:g.frame.x+20,y:g.frame.y+20}}:{}),nodeIds:members.map(id=>mapping.get(id)!)}];});
 for(const n of copies)if(layoutSelectionNodes(doc,ids).some(p=>p.id===n.id)&&!ids.some(id=>doc.groups?.find(g=>g.id===id)?.nodeIds.includes(n.id)))selection.push(mapping.get(n.id)!);
 return {document:{...doc,nodes:[...doc.nodes,...copies.map(n=>({...structuredClone(n),id:mapping.get(n.id)!,name:(n.name+' 副本').slice(0,100),...(n.parentId&&mapping.has(n.parentId)?{parentId:mapping.get(n.parentId)}:{}),...(n.control?{control:{...n.control,targetId:mapping.get(n.control.targetId)??n.control.targetId}}:{}),x:n.x+20,y:n.y+20}))],...(doc.groups||groups.length?{groups:[...(doc.groups??[]),...groups]}:{})},selection};
}
export function moveGroupedUILayoutLayers(doc:UILayout,ids:string[],targetID:string,side:'above'|'below'):UILayout {
 const moving=layoutSelectionNodes(doc,ids),chosen=new Set(moving.map(n=>n.id));let targetGroup=doc.groups?.find(g=>g.id===targetID),target=doc.nodes.find(n=>n.id===targetID);if(!moving.length||ids.includes(targetID)||target&&chosen.has(target.id))return doc;
 const movesGroup=ids.some(id=>doc.groups?.some(g=>g.id===id));if(movesGroup&&target)targetGroup=layoutGroupForNode(doc,target.id);
 if(targetGroup){if(targetGroup.nodeIds.some(id=>chosen.has(id)))return doc;const members=doc.nodes.filter(n=>targetGroup!.nodeIds.includes(n.id));target=side==='above'?members.at(-1):members[0];}
 if(!target)return doc;const remaining=doc.nodes.filter(n=>!chosen.has(n.id)),index=remaining.indexOf(target)+(side==='above'?1:0);let groups=doc.groups;
 if(!movesGroup&&groups){const parent=doc.groups?.some(g=>g.id===targetID)?undefined:layoutGroupForNode(doc,targetID);groups=groups.map(g=>({...g,nodeIds:g.nodeIds.filter(id=>!chosen.has(id))}));if(parent)groups=groups.map(g=>g.id===parent.id?{...g,nodeIds:[...g.nodeIds,...moving.map(n=>n.id)]}:g);groups=groups.filter(g=>g.nodeIds.length);}
 return {...doc,nodes:[...remaining.slice(0,index),...moving,...remaining.slice(index)],...(groups?{groups}:{})};
}
export function alignUILayoutLayers(doc:UILayout,ids:string[],axis:'x'|'y',position:0|.5|1):UILayout {
 const size=axis==='x'?'width':'height',selected=new Set(ids),units=ids.filter(id=>!doc.nodes.some(n=>n.id===id&&selected.has(layoutGroupForNode(doc,id)?.id??''))).map(id=>layoutSelectionNodes(doc,[id]).filter(n=>!layoutNodeLocked(doc,n))).filter(nodes=>nodes.length).map(nodes=>({nodes,low:Math.min(...nodes.map(n=>n[axis])),high:Math.max(...nodes.map(n=>n[axis]+n[size]))}));
 if(!units.length)return doc;const low=units.length===1?0:Math.min(...units.map(u=>u.low)),high=units.length===1?doc[size]:Math.max(...units.map(u=>u.high)),target=low+(high-low)*position,offsets=new Map<string,number>();
 for(const unit of units){const delta=target-unit.low-(unit.high-unit.low)*position;for(const n of unit.nodes)offsets.set(n.id,delta);}
 return {...doc,nodes:doc.nodes.map(n=>offsets.has(n.id)?{...n,[axis]:n[axis]+offsets.get(n.id)!}:n)};
}
