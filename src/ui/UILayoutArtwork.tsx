import {layoutGroupForNode} from '../shared/ui-layout-groups';
import {forwardRef} from 'react';
import {layoutTextPosition,layoutStrokeDasharray,type LayoutArrowhead,type UILayout,type LayoutNode} from '../shared/ui-layout';
export const UILayoutArtwork=forwardRef<SVGSVGElement,{document:UILayout}>(function UILayoutArtwork({document},ref){
 function renderNodes(parentId?:string):React.ReactNode {const parent=document.nodes.find(n=>n.id===parentId);return document.nodes.map((n,index)=>n.parentId===parentId&&!n.hidden&&!layoutGroupForNode(document,n.id)?.hidden&&<g key={n.id} data-layout-node={n.id} opacity={n.opacity} transform={`translate(${n.x-(parent?.x??0)} ${n.y-(parent?.y??0)}) rotate(${n.rotation} ${n.width/2} ${n.height/2})`}>
  <LayoutShape node={n} clipID={'layout-clip-'+index}/>
  <rect width={n.width} height={n.height} fill="transparent" stroke="none"/>
  {n.type==='scrollview'&&<><defs><clipPath id={'layout-scroll-'+index}><rect width={n.width} height={n.height} rx={n.radius}/></clipPath></defs><g clipPath={`url(#layout-scroll-${index})`}>{renderNodes(n.id)}</g></>}
 </g>);}
 return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={document.width} height={document.height} viewBox={`0 0 ${document.width} ${document.height}`} className="layout-artwork" aria-label="UI 设计画布">
  <rect width={document.width} height={document.height} fill={document.background} fillOpacity={document.backgroundOpacity??1}/>
  {renderNodes()}

 </svg>;
});
export function LayoutShape({node:n,clipID}:{node:LayoutNode;clipID:string}){
 const stroke={stroke:n.stroke,strokeOpacity:n.strokeOpacity??1,strokeWidth:n.strokeWidth,strokeDasharray:layoutStrokeDasharray(n),strokeLinecap:n.strokeLinecap??(['line','arrow'].includes(n.type)?'round':'butt'),strokeLinejoin:n.strokeLinejoin??(n.type==='polygon'?'round':'miter')};
 const common={...stroke,fill:n.fill,fillOpacity:n.fillOpacity??1},w=n.width,h=n.height;
 if(['button','checkbox','dropdown','scrollview'].includes(n.type)){
  const c=n.control!,label=n.type==='dropdown'?c.options[c.selectedIndex]:n.text,box=Math.min(22,Math.max(10,h-4)),textColor=c.textColor;
  if(n.type==='scrollview')return <rect {...common} width={w} height={h} rx={n.radius}/>;
  if(n.type==='checkbox')return <g opacity={c.disabled?.5:1}><rect {...common} y={(h-box)/2} width={box} height={box} rx={3} fill={c.checked?'#8875e8':n.fill}/>{c.checked&&<path d={`M ${box*.2} ${h/2} L ${box*.43} ${h/2+box*.22} L ${box*.8} ${h/2-box*.25}`} fill="none" stroke="#ffffff" strokeWidth={2}/>}<text x={box+8} y={h/2} dominantBaseline="central" fill={textColor} fontSize={n.fontSize} fontFamily={n.fontFamily} fontWeight={n.fontWeight}>{label}</text></g>;
  return <g opacity={c.disabled?.5:1}><rect {...common} width={w} height={h} rx={n.radius}/><defs><clipPath id={clipID}><rect x={8} width={Math.max(1,w-(n.type==='dropdown'?40:16))} height={h}/></clipPath></defs><text x={n.type==='dropdown'?12:n.align==='center'?w/2:n.align==='right'?w-12:12} y={h/2} dominantBaseline="central" textAnchor={n.type==='dropdown'?'start':n.align==='center'?'middle':n.align==='right'?'end':'start'} fill={textColor} fontSize={n.fontSize} fontFamily={n.fontFamily} fontWeight={n.fontWeight} clipPath={`url(#${clipID})`}>{label}</text>{n.type==='dropdown'&&<path d={`M ${w-24} ${h/2-3} l 5 5 l 5 -5`} stroke={textColor} strokeWidth={1.5} fill="none"/>}</g>;
 }
 if(n.type==='rectangle')return <rect {...common} width={w} height={h} rx={Math.min(n.radius,w/2,h/2)}/>;
 if(n.type==='ellipse')return <ellipse {...common} cx={w/2} cy={h/2} rx={w/2} ry={h/2}/>;
 if(n.type==='line'||n.type==='arrow'){
  const start=n.strokeWidth>0?(n.arrowStart??'none'):'none',end=n.strokeWidth>0?(n.arrowEnd??(n.type==='arrow'?'triangle':'none')):'none',size=n.arrowSize??16;
  return <g opacity={n.strokeOpacity??1}><defs>{start!=='none'&&<ArrowMarker id={clipID+'-start'} kind={start} node={n} size={size}/>} {end!=='none'&&<ArrowMarker id={clipID+'-end'} kind={end} node={n} size={size}/>}</defs><polyline {...stroke} strokeOpacity={1} fill="none" markerStart={start==='none'?undefined:`url(#${clipID}-start)`} markerEnd={end==='none'?undefined:`url(#${clipID}-end)`} points={n.points.map(p=>`${p.x*w},${p.y*h}`).join(' ')}/></g>;
 }
 if(n.type==='polygon')return <polygon {...common} points={n.points.map(p=>`${p.x*w},${p.y*h}`).join(' ')}/>;
 if(n.type==='text'){const position=layoutTextPosition(n);return <><defs><clipPath id={clipID}><rect width={w} height={h}/></clipPath></defs><text {...common} fontSize={n.fontSize} fontFamily={n.fontFamily} fontWeight={n.fontWeight} textAnchor={n.align==='center'?'middle':n.align==='right'?'end':'start'} clipPath={`url(#${clipID})`}>{position.lines.map((line,i)=><tspan key={i} x={n.align==='center'?w/2:n.align==='right'?w:0} y={position.firstBaseline+i*position.lineHeight} xmlSpace="preserve">{line||' '}</tspan>)}</text></>;}
 const radius=Math.min(n.radius,w/2,h/2);
 return <><defs><clipPath id={clipID}><rect width={w} height={h} rx={radius}/></clipPath></defs><rect {...common} stroke="none" width={w} height={h} rx={radius}/><g clipPath={`url(#${clipID})`}>{n.src?<image href={n.src} width={w} height={h} preserveAspectRatio="xMidYMid slice"/>:n.type==='avatar'?<g fill="#8d7cc7"><circle cx={w*.5} cy={h*.34} r={Math.min(w,h)*.16}/><path d={`M ${w*.14} ${h} Q ${w*.16} ${h*.55} ${w*.5} ${h*.56} Q ${w*.84} ${h*.55} ${w*.86} ${h} Z`}/></g>:<g fill="none" stroke="#a4adbd" strokeWidth={Math.max(1,Math.min(w,h)*.015)}><rect x={w*.3} y={h*.25} width={w*.4} height={h*.5} rx={4}/><circle cx={w*.57} cy={h*.4} r={Math.min(w,h)*.05}/><path d={`M ${w*.3} ${h*.7} L ${w*.44} ${h*.5} L ${w*.54} ${h*.63} L ${w*.62} ${h*.52} L ${w*.7} ${h*.7}`}/></g>}</g><rect width={w} height={h} rx={radius} fill="none" {...stroke}/></>;
}
function ArrowMarker({id,kind,node:n,size}:{id:string;kind:LayoutArrowhead;node:LayoutNode;size:number}){
 return <marker id={id} viewBox="0 0 12 12" refX="11" refY="6" markerWidth={size} markerHeight={size} markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible">
  <g fill={kind==='open'?'none':n.stroke} fillOpacity={1} stroke={n.stroke} strokeOpacity={1} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="none">
   {kind==='circle'?<circle cx="6" cy="6" r="5"/>:<path d={kind==='open'?'M 2 1 L 11 6 L 2 11':kind==='diamond'?'M 1 6 L 6 1 L 11 6 L 6 11 Z':'M 1 1 L 11 6 L 1 11 Z'}/>}
  </g>
 </marker>;
}
export async function layoutPNG(svg:SVGSVGElement,width:number,height:number):Promise<ArrayBuffer>{
 await document.fonts.ready;
 const source=new XMLSerializer().serializeToString(svg),url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
 try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('无法创建 PNG 画布。');context.drawImage(image,0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG 编码失败。')),'image/png'));return await blob.arrayBuffer();}finally{URL.revokeObjectURL(url);}
}
