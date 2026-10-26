import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent} from 'react';
import {editRigJoint} from '../shared/cutout-rig';
import {worldBones2D,type Rig2D,type Point2D} from '../shared/skeletal2d';

interface JointDrag {
 id:string;pointerId:number;rig:Rig2D;next:Rig2D;start:Point2D;origin:Point2D;
 screen:Point2D;dirty:boolean;moveChildren:boolean;
}
export function CutoutRigOverlay({rig,selected,editable,scale,moveChildren,select,change,error}:{
 rig:Rig2D;selected:string;editable:boolean;scale:number;moveChildren:boolean;
 select:(id:string)=>void;change:(rig:Rig2D)=>void;error:(message:string)=>void;
}){
 const svg=useRef<SVGSVGElement>(null),gesture=useRef<JointDrag|undefined>(undefined),[drag,setDrag]=useState<Rig2D>();
 const latest=useRef({rig,editable});latest.current={rig,editable};
 const shown=drag??rig,world=worldBones2D(shown),pixel=1/Math.max(.01,scale);
 function cancel(){const g=gesture.current;gesture.current=undefined;setDrag(undefined);if(g&&svg.current?.hasPointerCapture(g.pointerId))svg.current.releasePointerCapture(g.pointerId);}
 useLayoutEffect(()=>{cancel();},[rig,editable,scale,moveChildren]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(!gesture.current)return;if(e.key==='Escape'||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z')){e.preventDefault();e.stopImmediatePropagation();cancel();}};
  window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);
  return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);const g=gesture.current;gesture.current=undefined;if(g&&svg.current?.hasPointerCapture(g.pointerId))svg.current.releasePointerCapture(g.pointerId);};
 },[]);
 function point(e:PointerEvent):Point2D|undefined {const matrix=svg.current?.getScreenCTM();if(!matrix)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());return [p.x,p.y];}
 function down(e:PointerEvent<SVGElement>,id:string){
  if(!editable||e.button!==0||gesture.current)return;const start=point(e);if(!start)return;
  e.preventDefault();e.stopPropagation();svg.current?.focus();select(id);
  const m=world.get(id)!;gesture.current={id,pointerId:e.pointerId,rig,next:rig,start,origin:[m[4],m[5]],screen:[e.clientX,e.clientY],dirty:false,moveChildren};
  svg.current!.setPointerCapture(e.pointerId);
 }
 function move(e:PointerEvent<SVGSVGElement>){
  const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;e.preventDefault();e.stopPropagation();
  if(latest.current.rig!==g.rig||!latest.current.editable){cancel();return;}
  if(!g.dirty&&Math.hypot(e.clientX-g.screen[0],e.clientY-g.screen[1])<2)return;
  const at=point(e);if(!at)return;let dx=at[0]-g.start[0],dy=at[1]-g.start[1];
  if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
  const target:Point2D=[Math.max(-16384,Math.min(16384,g.origin[0]+dx)),Math.max(-16384,Math.min(16384,g.origin[1]+dy))];
  try{g.next=editRigJoint(g.rig,g.id,target,undefined,g.moveChildren);g.dirty=target.some((n,i)=>Math.abs(n-g.origin[i])>1e-7);setDrag(g.next);}catch(e){cancel();error((e as Error).message);}
 }
 function up(e:PointerEvent<SVGSVGElement>){const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;move(e);if(gesture.current!==g)return;cancel();if(g.dirty)change(g.next);}
 const order=[...shown.bones.filter(b=>b.id!==selected),...shown.bones.filter(b=>b.id===selected)];
 return <svg ref={svg} className="cutout-rig-overlay" aria-label="可编辑骨架" data-editable={editable} tabIndex={editable?-1:undefined} viewBox={`0 0 ${rig.canvas.join(' ')}`} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
  {order.map(b=>{const m=world.get(b.id)!,p=b.parent?world.get(b.parent):undefined;if(!p)return null;return <g key={b.id} className={selected===b.id?'selected':''}>
   <line className="cutout-bone-line" x1={p[4]} y1={p[5]} x2={m[4]} y2={m[5]} vectorEffect="non-scaling-stroke"/>
   <line data-rig-bone={b.id} x1={p[4]} y1={p[5]} x2={m[4]} y2={m[5]} stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" style={{pointerEvents:editable?'stroke':'none',cursor:'move'}} onPointerDown={e=>down(e,b.id)}><title>{b.name??b.id} · 拖动调整关节</title></line>
  </g>;})}
  {order.map(b=>{const m=world.get(b.id)!,active=b.id===selected;return <g key={b.id} className={active?'selected':''}>
   <circle className="cutout-bone-joint" cx={m[4]} cy={m[5]} r={(active?6:4.5)*pixel} vectorEffect="non-scaling-stroke"/>
   <circle data-rig-joint={b.id} cx={m[4]} cy={m[5]} r={10*pixel} fill="transparent" style={{pointerEvents:editable?'all':'none',cursor:'move'}} onPointerDown={e=>down(e,b.id)}><title>{b.name??b.id} · 拖动调整关节</title></circle>
   {active&&<text className="cutout-bone-label" x={m[4]+12*pixel} y={m[5]-12*pixel} fontSize={12*pixel} strokeWidth={3*pixel}>{b.name??b.id}</text>}
  </g>;})}
 </svg>;
}
