import {defaultLayoutControl,defaultLayoutFlow,validateLayoutControl,validateLayoutFlow,validateLayoutParents,type LayoutControl,type LayoutFlow,type LayoutFrame} from './ui-layout-controls';
import {validateLayoutGroups,moveGroupedUILayoutLayers,layoutSelectionNodes,layoutNodeLocked} from './ui-layout-groups';
export const layoutNodeTypes=['rectangle','ellipse','line','arrow','polygon','text','avatar','image','button','checkbox','dropdown','scrollview'] as const;
export type LayoutNodeType=typeof layoutNodeTypes[number];
export const layoutNames:Record<LayoutNodeType,string>={rectangle:'方块',ellipse:'圆形',line:'线条',arrow:'箭头',polygon:'多边形',text:'文字',avatar:'角色 Avatar',image:'图片',button:'Button',checkbox:'Checkbox',dropdown:'Dropdown',scrollview:'Scroll View'};
export const layoutStrokeStyles=['solid','dashed','dotted','dash-dot'] as const;
export const layoutArrowheads=['none','triangle','open','diamond','circle'] as const;
export type LayoutArrowhead=typeof layoutArrowheads[number];
export interface LayoutPoint {x:number;y:number}
export interface LayoutNode {
 id:string;type:LayoutNodeType;name:string;x:number;y:number;width:number;height:number;rotation:number;
 fill:string;fillOpacity:number;stroke:string;strokeOpacity:number;strokeWidth:number;opacity:number;radius:number;hidden:boolean;locked:boolean;
 strokeStyle:typeof layoutStrokeStyles[number];strokeLinecap:'butt'|'round'|'square';strokeLinejoin:'miter'|'round'|'bevel';arrowStart:LayoutArrowhead;arrowEnd:LayoutArrowhead;arrowSize:number;
 text:string;fontSize:number;fontFamily:'sans-serif'|'serif'|'monospace';fontWeight:400|700;align:'left'|'center'|'right';verticalAlign:'top'|'middle'|'bottom';
 points:LayoutPoint[];src?:string;parentId?:string;control?:LayoutControl;layout?:LayoutFlow;
}
export interface LayoutGroup {layout?:LayoutFlow;frame?:LayoutFrame;id:string;name:string;nodeIds:string[];hidden:boolean;locked:boolean}
export interface LayoutPage {groups?:LayoutGroup[];id:string;name:string;width:number;height:number;background:string;backgroundOpacity?:number;nodes:LayoutNode[]}
export interface UILayout {groups?:LayoutGroup[];format:'laputa-ui-layout';version:1;name:string;width:number;height:number;background:string;backgroundOpacity?:number;nodes:LayoutNode[];pages?:LayoutPage[];activePageId?:string}
export const emptyUILayout=():UILayout=>({format:'laputa-ui-layout',version:1,name:'Untitled UI',width:1280,height:720,background:'#ffffff',nodes:[]});
export function polygonPoints(count=5):LayoutPoint[]{return Array.from({length:count},(_,i)=>({x:.5+.5*Math.cos(i*2*Math.PI/count-Math.PI/2),y:.5+.5*Math.sin(i*2*Math.PI/count-Math.PI/2)}));}
export function createLayoutNode(type:LayoutNodeType,id:string,x:number,y:number):LayoutNode {
 const linear=type==='line'||type==='arrow';
 const width=type==='text'?240:linear?200:type==='avatar'?112:180,height=type==='text'?64:linear?80:type==='avatar'?112:140;
 const node:LayoutNode={id,type,name:layoutNames[type],x:x-width/2,y:y-height/2,width,height,rotation:0,strokeStyle:'solid',strokeLinecap:linear?'round':'butt',strokeLinejoin:type==='polygon'?'round':'miter',arrowStart:'none',arrowEnd:type==='arrow'?'triangle':'none',arrowSize:16,fill:type==='text'?'#252432':linear?'transparent':type==='avatar'?'#e8e2ff':type==='image'?'#edf0f5':'#8875e8',fillOpacity:1,stroke:linear?'#525069':'transparent',strokeOpacity:1,strokeWidth:linear?3:0,opacity:1,radius:type==='avatar'?56:type==='rectangle'?12:0,hidden:false,locked:false,text:type==='text'?'双击编辑文字':'',fontSize:28,fontFamily:'sans-serif',fontWeight:400,align:'left',verticalAlign:'top',points:type==='arrow'?[{x:0,y:.5},{x:1,y:.5}]:linear?[{x:0,y:1},{x:1,y:0}]:polygonPoints()};
 if(['button','checkbox','dropdown','scrollview'].includes(type)){node.width=type==='scrollview'?320:type==='checkbox'?180:type==='dropdown'?200:160;node.height=type==='scrollview'?240:type==='checkbox'?32:type==='dropdown'?40:44;node.x=x-node.width/2;node.y=y-node.height/2;node.fill=type==='button'?'#8875e8':type==='scrollview'?'#f5f6fa':'#ffffff';node.stroke=type==='button'?'transparent':'#c5c9d4';node.strokeWidth=type==='button'?0:1;node.radius=6;node.fontSize=16;node.align=type==='button'?'center':'left';node.verticalAlign='middle';node.text=type==='button'?'Button':type==='checkbox'?'Checkbox':'';node.control=defaultLayoutControl(type);if(type==='scrollview')node.layout={...defaultLayoutFlow(),mode:'vertical'};}return node;
}
const color=(v:unknown)=>typeof v==='string'&&(/^[#][0-9a-f]{6}$/i.test(v)||v==='transparent');
function number(v:unknown,min:number,max:number){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;}
// Import only our explicit schema. No HTML, SVG, arbitrary URLs or execution fields survive.
export function validateUILayout(value:unknown):UILayout {
 const d=value as UILayout;
 if(!d||d.format!=='laputa-ui-layout'||d.version!==1||typeof d.name!=='string'||!d.name.trim()||d.name.length>100||!Number.isInteger(d.width)||!Number.isInteger(d.height)||!number(d.width,64,4096)||!number(d.height,64,4096)||d.width*d.height>16000000||!color(d.background)||!number(d.backgroundOpacity??1,0,1)||!Array.isArray(d.nodes)||d.nodes.length>500)throw new Error('布局格式无效：画布须为 64–4096 像素，最多 1600 万像素和 500 个构件。');
 const ids=new Set<string>();
 const nodes=d.nodes.map(n=>{
  if(!n||typeof n.id!=='string'||!n.id||n.id.length>100||ids.has(n.id)||!layoutNodeTypes.includes(n.type)||typeof n.name!=='string'||n.name.length>100||![n.x,n.y].every(v=>number(v,-20000,20000))||![n.width,n.height].every(v=>number(v,1,20000))||!number(n.rotation,-36000,36000)||!color(n.fill)||!color(n.stroke)||!number(n.strokeWidth,0,100)||!number(n.opacity,0,1)||!number(n.fillOpacity??1,0,1)||!number(n.strokeOpacity??1,0,1)||!['top','middle','bottom'].includes(n.verticalAlign??'top')||!number(n.radius,0,10000)||typeof n.hidden!=='boolean'||typeof n.locked!=='boolean'||typeof n.text!=='string'||n.text.length>10000||!number(n.fontSize,1,512)||!['sans-serif','serif','monospace'].includes(n.fontFamily)||![400,700].includes(n.fontWeight)||!['left','center','right'].includes(n.align)||!Array.isArray(n.points)||n.points.length<2||n.points.length>64||n.points.some(p=>!p||!number(p.x,0,1)||!number(p.y,0,1)))throw new Error('布局构件数据无效，请检查尺寸、颜色、文字和顶点。');
  if(!layoutStrokeStyles.includes(n.strokeStyle??'solid')||!['butt','round','square'].includes(n.strokeLinecap??(n.type==='line'?'round':'butt'))||!['miter','round','bevel'].includes(n.strokeLinejoin??(n.type==='polygon'?'round':'miter'))||!layoutArrowheads.includes(n.arrowStart??'none')||!layoutArrowheads.includes(n.arrowEnd??(n.type==='arrow'?'triangle':'none'))||!number(n.arrowSize??16,4,100))throw new Error('线条样式或箭头参数无效。');
  if(n.src!==undefined&&(typeof n.src!=='string'||n.src.length>8*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(n.src)))throw new Error('图片须为内嵌 PNG，单张编码后不超过 8 MB。');
  ids.add(n.id);
  return {id:n.id,type:n.type,name:n.name,x:n.x,y:n.y,width:n.width,height:n.height,rotation:n.rotation,strokeStyle:n.strokeStyle??'solid',strokeLinecap:n.strokeLinecap??(['line','arrow'].includes(n.type)?'round':'butt'),strokeLinejoin:n.strokeLinejoin??(n.type==='polygon'?'round':'miter'),arrowStart:n.arrowStart??'none',arrowEnd:n.arrowEnd??(n.type==='arrow'?'triangle':'none'),arrowSize:n.arrowSize??16,fill:n.fill,fillOpacity:n.fillOpacity??1,stroke:n.stroke,strokeOpacity:n.strokeOpacity??1,strokeWidth:n.strokeWidth,opacity:n.opacity,radius:n.radius,hidden:n.hidden,locked:n.locked,text:n.text,fontSize:n.fontSize,fontFamily:n.fontFamily,fontWeight:n.fontWeight,align:n.align,verticalAlign:n.verticalAlign??'top',points:n.points.map(p=>({x:p.x,y:p.y})),...(n.src?{src:n.src}:{}),...(n.parentId!==undefined?{parentId:n.parentId}:{}),...(['button','checkbox','dropdown','scrollview'].includes(n.type)?{control:validateLayoutControl(n.control??defaultLayoutControl(n.type),n.type)}:{}),...(n.layout!==undefined?{layout:validateLayoutFlow(n.layout)}:{})};
 });
 validateLayoutParents(nodes);
 const result:UILayout={format:'laputa-ui-layout',version:1,name:d.name,width:d.width,height:d.height,background:d.background,...(d.backgroundOpacity!==undefined?{backgroundOpacity:d.backgroundOpacity}:{}),nodes,...(d.groups!==undefined?{groups:validateLayoutGroups(d.groups,nodes)}:{})};
 if(d.pages!==undefined||d.activePageId!==undefined){
  if(!Array.isArray(d.pages)||!d.pages.length||d.pages.length>30||typeof d.activePageId!=='string')throw new Error('页面数据无效，须保留 1–30 个页面。');
  const pageIDs=new Set<string>();
  result.pages=d.pages.map(page=>{
   if(!page||typeof page.id!=='string'||!page.id||page.id.length>100||pageIDs.has(page.id))throw new Error('页面 ID 无效或重复。');
   pageIDs.add(page.id);
   const content=validateUILayout({format:'laputa-ui-layout',version:1,name:page.name,width:page.width,height:page.height,background:page.background,backgroundOpacity:page.backgroundOpacity,nodes:page.nodes,groups:page.groups});
   return {id:page.id,...layoutPageContent(content)};
  });
  if(!pageIDs.has(d.activePageId))throw new Error('当前页面不存在。');
  result.activePageId=d.activePageId;
  result.pages=result.pages.map(page=>page.id===result.activePageId?{id:page.id,...layoutPageContent(result)}:page);
 }
 if(JSON.stringify(result).length>24*1024*1024)throw new Error('布局超过 24 MB，请减少图片数量或尺寸。');
 return result;
}
function layoutPageContent(document:Pick<UILayout,'name'|'width'|'height'|'background'|'backgroundOpacity'|'nodes'|'groups'>):Omit<LayoutPage,'id'>{
 const {name,width,height,background,backgroundOpacity,nodes,groups}=document;return {name,width,height,background,...(backgroundOpacity!==undefined?{backgroundOpacity}:{}),nodes,...(groups!==undefined?{groups}:{})};
}
// Keep the active canvas mirrored at the root for existing renderers and PNG exports.
export function syncUILayoutPages(document:UILayout):UILayout {
 if(!document.pages)return document;
 return {...document,pages:document.pages.map(page=>page.id===document.activePageId?{id:page.id,...layoutPageContent(document)}:page)};
}
export function layoutPages(document:UILayout):LayoutPage[]{return syncUILayoutPages(document).pages??[{id:'page-1',...layoutPageContent(document)}];}
export function switchUILayoutPage(document:UILayout,id:string):UILayout {
 const pages=layoutPages(document),page=pages.find(page=>page.id===id);
 if(!page||id===(document.activePageId??'page-1'))return document;
 const next={...document,...layoutPageContent(page),pages,activePageId:id};if(page.backgroundOpacity===undefined)delete next.backgroundOpacity;if(page.groups===undefined)delete next.groups;return next;
}
export function addUILayoutPage(document:UILayout,id:string):UILayout {
 const pages=layoutPages(document);if(pages.length>=30)throw new Error('最多可添加 30 个页面。');
 if(!id||pages.some(page=>page.id===id))throw new Error('页面 ID 无效或重复。');
 let index=pages.length+1;while(pages.some(page=>page.name===`页面 ${index}`))index++;
 const page:LayoutPage={id,name:`页面 ${index}`,width:document.width,height:document.height,background:document.background,...(document.backgroundOpacity!==undefined?{backgroundOpacity:document.backgroundOpacity}:{}),nodes:[]};
 const next={...document,...layoutPageContent(page),pages:[...pages,page],activePageId:id};delete next.groups;return next;
}
export function layoutLocalPoint(node:LayoutNode,point:LayoutPoint):LayoutPoint {
 const a=-node.rotation*Math.PI/180,dx=point.x-node.x-node.width/2,dy=point.y-node.y-node.height/2;
 return {x:Math.cos(a)*dx-Math.sin(a)*dy+node.width/2,y:Math.sin(a)*dx+Math.cos(a)*dy+node.height/2};
}
export function resizeLayoutNode(node:LayoutNode,dx:number,dy:number,sx:number,sy:number,keepAspect=false):LayoutNode {
 const a=node.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),lx=c*dx+s*dy,ly=-s*dx+c*dy;
 let width=Math.max(8,node.width+sx*lx),height=Math.max(8,node.height+sy*ly);
 if(keepAspect){const ratio=Math.max(width/node.width,height/node.height);width=node.width*ratio;height=node.height*ratio;}
 const cx=(width-node.width)*sx/2,cy=(height-node.height)*sy/2;
 return {...node,width,height,x:node.x+node.width/2+c*cx-s*cy-width/2,y:node.y+node.height/2+s*cx+c*cy-height/2};
}
// The same line breaks feed both the editor SVG and PNG export.
export function layoutTextLines(node:LayoutNode):string[]{
 const limit=Math.max(1,node.width-4),lines:string[]=[];
 for(const paragraph of node.text.split('\n')){let line='',width=0;for(const ch of paragraph){const step=node.fontSize*(/[\u0000-\u00ff]/.test(ch)?(node.fontFamily==='monospace'?.62:.56):1);if(width+step>limit&&line){lines.push(line);line='';width=0;}line+=ch;width+=step;}lines.push(line);}
 return lines;
}

export function layoutTextPosition(node:LayoutNode){
 const lines=layoutTextLines(node),lineHeight=node.fontSize*1.25,blockHeight=lines.length*lineHeight;
 const free=Math.max(0,node.height-blockHeight),offset=node.verticalAlign==='middle'?free/2:node.verticalAlign==='bottom'?free:0;
 return {lines,lineHeight,offset,firstBaseline:offset+node.fontSize};
}

// Documents paint back to front; the layer panel lists the same nodes front to back.
export function moveUILayoutLayers(document:UILayout,ids:string[],targetID:string,side:'above'|'below'):UILayout {
 if(document.groups?.length)return moveGroupedUILayoutLayers(document,ids,targetID,side);
 const selected=new Set(ids),moving=document.nodes.filter(n=>selected.has(n.id));
 if(!moving.length||selected.has(targetID))return document;
 const remaining=document.nodes.filter(n=>!selected.has(n.id)),target=remaining.findIndex(n=>n.id===targetID);
 if(target<0)return document;
 const index=target+(side==='above'?1:0),nodes=[...remaining.slice(0,index),...moving,...remaining.slice(index)];
 if(nodes.every((node,i)=>node===document.nodes[i]))return document;
 return {...document,nodes};
}

export function layoutStrokeDasharray(node:LayoutNode):string|undefined {
 const w=Math.max(1,node.strokeWidth),dot=node.strokeLinecap==='butt'?w:.01;
 switch(node.strokeStyle){case 'dashed':return `${w*4} ${w*3}`;case 'dotted':return `${dot} ${w*2.5}`;case 'dash-dot':return `${w*4} ${w*2.5} ${dot} ${w*2.5}`;default:return undefined;}
}

// Store world-space endpoints in a fresh local frame, including reverse and axis-aligned drags.
export function layoutArrowBetween(node:LayoutNode,start:LayoutPoint,end:LayoutPoint,constrainAngle=false):LayoutNode {
 if(constrainAngle){const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;end={x:start.x+Math.cos(angle)*length,y:start.y+Math.sin(angle)*length};}
 const x=Math.min(start.x,end.x),y=Math.min(start.y,end.y),width=Math.max(1,Math.abs(end.x-start.x)),height=Math.max(1,Math.abs(end.y-start.y));
 return {...node,x,y,width,height,rotation:0,points:[start,end].map(p=>({x:(p.x-x)/width,y:(p.y-y)/height}))};
}
export function layoutWorldPoint(node:LayoutNode,point:LayoutPoint):LayoutPoint {
 const angle=node.rotation*Math.PI/180,dx=(point.x-.5)*node.width,dy=(point.y-.5)*node.height;
 return {x:node.x+node.width/2+Math.cos(angle)*dx-Math.sin(angle)*dy,y:node.y+node.height/2+Math.sin(angle)*dx+Math.cos(angle)*dy};
}

// Intersect the marquee with each rotated component frame using separating axes.
export function layoutMarqueeSelection(nodes:LayoutNode[],start:LayoutPoint,end:LayoutPoint,groups:LayoutGroup[]=[]):string[]{
 const left=Math.min(start.x,end.x),right=Math.max(start.x,end.x),top=Math.min(start.y,end.y),bottom=Math.max(start.y,end.y);
 const box=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
 return nodes.filter(node=>{
  const group=groups.find(g=>g.nodeIds.includes(node.id));if(node.hidden||node.locked||group?.hidden||group?.locked)return false;
  const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(p=>layoutWorldPoint(node,p)),a=node.rotation*Math.PI/180;
  return [{x:1,y:0},{x:0,y:1},{x:Math.cos(a),y:Math.sin(a)},{x:-Math.sin(a),y:Math.cos(a)}].every(axis=>{
   const component=corners.map(p=>p.x*axis.x+p.y*axis.y),marquee=box.map(p=>p.x*axis.x+p.y*axis.y);
   return Math.max(...component)>=Math.min(...marquee)-1e-8&&Math.max(...marquee)>=Math.min(...component)-1e-8;
  });
 }).map(node=>groups.find(g=>g.nodeIds.includes(node.id))?.id??node.id).filter((id,index,ids)=>ids.indexOf(id)===index);
}
// Snap the drag anchor once so every selected component keeps its relative position.
export function translateLayoutSelection(document:UILayout,ids:string[],dx:number,dy:number,snap=false,anchorID=ids[0]):UILayout {
 const chosen=new Set(layoutSelectionNodes(document,ids).map(n=>n.id)),anchor=document.nodes.find(n=>n.id===anchorID&&!layoutNodeLocked(document,n))??layoutSelectionNodes(document,[anchorID]).find(n=>!layoutNodeLocked(document,n));
 if(snap&&anchor){dx=Math.round((anchor.x+dx)/8)*8-anchor.x;dy=Math.round((anchor.y+dy)/8)*8-anchor.y;}
 return {...document,nodes:document.nodes.map(node=>chosen.has(node.id)&&!layoutNodeLocked(document,node)?{...node,x:node.x+dx,y:node.y+dy}:node)};
}
