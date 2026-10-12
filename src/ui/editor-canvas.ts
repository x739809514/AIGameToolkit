export interface Point {x:number;y:number}
export type DrawTool='brush'|'erase'|'lasso';
export interface Stroke {tool:DrawTool;size:number;points:Point[]}
export interface Rect {x:number;y:number;width:number;height:number}
export function cropRect(start:Point,end:Point,width:number,height:number):Rect{
  const x=Math.min(width-1,Math.max(0,Math.round(Math.min(start.x,end.x)))),y=Math.min(height-1,Math.max(0,Math.round(Math.min(start.y,end.y))));
  return {x,y,width:Math.min(width-x,Math.max(1,Math.round(Math.abs(end.x-start.x)))),height:Math.min(height-y,Math.max(1,Math.round(Math.abs(end.y-start.y))))};
}
export function renderSelection(canvas:HTMLCanvasElement,strokes:Stroke[]){
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const s of strokes){if(!s.points.length)continue;ctx.save();ctx.globalCompositeOperation=s.tool==='erase'?'destination-out':'source-over';ctx.strokeStyle='#a685ff';ctx.fillStyle='#a685ff';ctx.lineWidth=s.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    if(s.tool==='lasso'){if(s.points.length<3){ctx.restore();continue;}ctx.moveTo(s.points[0].x,s.points[0].y);s.points.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.fill();}
    else if(s.points.length===1){ctx.arc(s.points[0].x,s.points[0].y,s.size/2,0,2*Math.PI);ctx.fill();}
    else{ctx.moveTo(s.points[0].x,s.points[0].y);s.points.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();}ctx.restore();
  }
}
export async function selectionMask(canvas:HTMLCanvasElement):Promise<ArrayBuffer>{
  const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height);const target=document.createElement('canvas');target.width=canvas.width;target.height=canvas.height;const ctx=target.getContext('2d')!;let selected=false;
  for(let i=0;i<pixels.data.length;i+=4){const alpha=pixels.data[i+3];if(alpha>0)selected=true;pixels.data[i]=255;pixels.data[i+1]=255;pixels.data[i+2]=255;pixels.data[i+3]=255-alpha;}
  if(!selected)throw new Error('请先用画笔或自由圈选选中要修改的区域。');ctx.putImageData(pixels,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>target.toBlob(b=>b?resolve(b):reject(new Error('无法导出圈选遮罩。')),'image/png'));return blob.arrayBuffer();
}
