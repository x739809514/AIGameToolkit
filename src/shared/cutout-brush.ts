import type {Point2D} from './skeletal2d';
/** A whole stroke is filled once, so translucent strokes do not bead at samples. */
export function cutoutBrushOutline(points:Point2D[],width:number,pressure?:number[],smooth=true):Point2D[]{
 if(!points.length)return [];
 const input=points.map((p,i)=>({x:p[0],y:p[1],p:Math.max(.05,Math.min(1,pressure?.[i]??1))}));
 const samples:typeof input=[];
 if(smooth&&input.length>2){
  samples.push(input[0]);
  for(let i=0;i<input.length-1;i++){
   const a=input[Math.max(0,i-1)],b=input[i],c=input[i+1],d=input[Math.min(input.length-1,i+2)];
   const count=Math.max(2,Math.min(48,Math.ceil(Math.hypot(c.x-b.x,c.y-b.y)/Math.max(1,width*.16))));
   for(let j=1;j<=count;j++){const t=j/count,t2=t*t,t3=t2*t;const value=(key:'x'|'y')=>.5*(2*b[key]+(-a[key]+c[key])*t+(2*a[key]-5*b[key]+4*c[key]-d[key])*t2+(-a[key]+3*b[key]-3*c[key]+d[key])*t3);samples.push({x:value('x'),y:value('y'),p:b.p+(c.p-b.p)*t});}
  }
 }else samples.push(...input);
 const clean=samples.filter((p,i)=>!i||Math.hypot(p.x-samples[i-1].x,p.y-samples[i-1].y)>.001);
 if(clean.length===1){const p=clean[0],r=width*p.p/2;return Array.from({length:24},(_,i)=>[p.x+Math.cos(i*Math.PI/12)*r,p.y+Math.sin(i*Math.PI/12)*r]);}
 const left:Point2D[]=[],right:Point2D[]=[],normals:Point2D[]=[];
 clean.forEach((p,i)=>{const a=clean[Math.max(0,i-1)],b=clean[Math.min(clean.length-1,i+1)],length=Math.hypot(b.x-a.x,b.y-a.y)||1,n:Point2D=[-(b.y-a.y)/length,(b.x-a.x)/length],r=width*p.p/2;normals.push(n);left.push([p.x+n[0]*r,p.y+n[1]*r]);right.push([p.x-n[0]*r,p.y-n[1]*r]);});
 const outline=[...left],end=clean.at(-1)!,endAngle=Math.atan2(normals.at(-1)![1],normals.at(-1)![0]);
 for(let i=1;i<12;i++){const a=endAngle-i*Math.PI/12,r=width*end.p/2;outline.push([end.x+Math.cos(a)*r,end.y+Math.sin(a)*r]);}
 outline.push(...right.reverse());const start=clean[0],startAngle=Math.atan2(-normals[0][1],-normals[0][0]);
 for(let i=1;i<12;i++){const a=startAngle-i*Math.PI/12,r=width*start.p/2;outline.push([start.x+Math.cos(a)*r,start.y+Math.sin(a)*r]);}return outline;
}
/** Online stabilizer; the final raw endpoint is always included on release. */
export function stabilizeCutoutPoint(previous:Point2D,next:Point2D,amount:number):Point2D{
 const distance=Math.hypot(next[0]-previous[0],next[1]-previous[1]);
 const alpha=amount<=0?1:1-Math.exp(-distance/(1+amount*18));
 return [previous[0]+(next[0]-previous[0])*alpha,previous[1]+(next[1]-previous[1])*alpha];
}
export function simplifyCutoutContour(points:Point2D[],tolerance=1.5):Point2D[]{
 if(points.length<4)return points;
 const squared=tolerance*tolerance,keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
 while(stack.length){const [first,last]=stack.pop()!,a=points[first],b=points[last],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;let best=squared,index=-1;
  for(let i=first+1;i<last;i++){const p=points[i],t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0,d=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;if(d>best){best=d;index=i;}}
  if(index>=0){keep.add(index);stack.push([first,index],[index,last]);}
 }
 return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
