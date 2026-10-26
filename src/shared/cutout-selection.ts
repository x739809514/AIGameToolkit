import type {Point2D} from './skeletal2d';
/** Row-major binary RLE, starting with a run of zeroes. Coordinates cover the full character canvas. */
export interface CutoutSelectionMask {width:number;height:number;runs:number[]}
export function validateSelectionMask(mask:CutoutSelectionMask){
 if(!mask||!Number.isInteger(mask.width)||!Number.isInteger(mask.height)||mask.width<1||mask.height<1||mask.width>1024||mask.height>1024||!Array.isArray(mask.runs)||mask.runs.length>mask.width*mask.height+1)throw Error('快速选择遮罩无效。');
 let total=0;for(let i=0;i<mask.runs.length;i++){const n=mask.runs[i];if(!Number.isSafeInteger(n)||n<0||i>0&&n===0)throw Error('快速选择遮罩无效。');total+=n;}if(total!==mask.width*mask.height)throw Error('快速选择遮罩尺寸不一致。');
}
export function encodeSelection(data:Uint8Array,width:number,height:number):CutoutSelectionMask{
 const runs:number[]=[];let bit=0,count=0;for(let i=0;i<data.length;i++){const next=data[i]?1:0;if(next===bit)count++;else{runs.push(count);count=1;bit=next;}}runs.push(count);return {width,height,runs};
}
export function decodeSelection(mask:CutoutSelectionMask){validateSelectionMask(mask);const data=new Uint8Array(mask.width*mask.height);let at=0;mask.runs.forEach((n,i)=>{if(i%2)data.fill(1,at,at+n);at+=n;});return data;}
export interface QuickSelectInput {width:number;height:number;rgba:Uint8ClampedArray;points:Point2D[];diameter:number;tolerance:number;mode:'add'|'subtract';smart?:boolean;previous?:CutoutSelectionMask}
/** Local, colour-aware connected selection. The stroke's dominant colour rejects small overshoots;
 * connected growth repairs undershoot, transparent pixels block growth, and small enclosed holes are filled. */
export function quickSelect(input:QuickSelectInput):CutoutSelectionMask{
 const {width:w,height:h,rgba,points,mode}=input,n=w*h;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>1024||h>1024||rgba.length!==n*4||!points.length||points.length>3000||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))||p[0]<0||p[1]<0||p[0]>w||p[1]>h)||!Number.isFinite(input.diameter)||input.diameter<=0||input.diameter>200||!Number.isFinite(input.tolerance))throw Error('快速选择输入无效。');
 const previous=input.previous;if(previous&&(previous.width!==w||previous.height!==h))throw Error('选区尺寸发生变化，请清除选区后重试。');
 const result=previous?decodeSelection(previous):new Uint8Array(n),r=Math.max(1,input.diameter/2),reach=Math.max(8,r*3),brush=new Uint8Array(n),region=new Uint8Array(n),samples:number[]=[];
 let x0=w,y0=h,x1=0,y1=0;
 const stamp=(x:number,y:number)=>{
  const left=Math.max(0,Math.floor(x-reach)),right=Math.min(w-1,Math.ceil(x+reach)),top=Math.max(0,Math.floor(y-reach)),bottom=Math.min(h-1,Math.ceil(y+reach));x0=Math.min(x0,left);y0=Math.min(y0,top);x1=Math.max(x1,right);y1=Math.max(y1,bottom);
  for(let yy=top;yy<=bottom;yy++){
   const dy=(yy+.5-y)**2,extent=Math.sqrt(Math.max(0,reach*reach-dy));
   region.fill(1,yy*w+Math.max(left,Math.ceil(x-extent-.5)),yy*w+Math.min(right+1,Math.floor(x+extent-.5)+1));
   if(dy<=r*r){const inner=Math.sqrt(r*r-dy);brush.fill(1,yy*w+Math.max(0,Math.ceil(x-inner-.5)),yy*w+Math.min(w,Math.floor(x+inner-.5)+1));}
  }
  const px=Math.max(0,Math.min(w-1,Math.floor(x))),py=Math.max(0,Math.min(h-1,Math.floor(y)));if(rgba[(py*w+px)*4+3]>24)samples.push(py*w+px);
 };
 // Interpolate sparse pointer events so even a fast stroke is continuous.
 for(let k=0;k<points.length;k++){const a=points[Math.max(0,k-1)],b=points[k],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/Math.max(1,r*.5)));for(let j=1;j<=steps;j++)stamp(a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps);}
 if(input.smart===false){for(let i=0;i<n;i++)if(brush[i]&&(mode==='subtract'||rgba[i*4+3]>24))result[i]=mode==='subtract'?0:1;return encodeSelection(result,w,h);}
 if(!samples.length)return encodeSelection(result,w,h);
 const hist=new Map<number,{count:number;r:number;g:number;b:number}>();
 for(const i of samples){const p=i*4,key=(rgba[p]>>4)*256+(rgba[p+1]>>4)*16+(rgba[p+2]>>4),entry=hist.get(key)??{count:0,r:0,g:0,b:0};entry.count++;entry.r+=rgba[p];entry.g+=rgba[p+1];entry.b+=rgba[p+2];hist.set(key,entry);}
 const dominant=[...hist.values()].sort((a,b)=>b.count-a.count)[0],colour=[dominant.r/dominant.count,dominant.g/dominant.count,dominant.b/dominant.count],threshold=Math.max(5,Math.min(100,input.tolerance));
 const thresholdSquared=threshold*threshold*3;
 const matches=(i:number)=>{const p=i*4,dr=rgba[p]-colour[0],dg=rgba[p+1]-colour[1],db=rgba[p+2]-colour[2];return rgba[p+3]>24&&dr*dr+dg*dg+db*db<=thresholdSquared;};
 const selected=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*w+x;if(brush[i]&&matches(i)){queue[tail++]=i;seen[i]=selected[i]=1;}}
 const neighbours=(i:number,visit:(j:number)=>void)=>{const x=i%w;if(x>0)visit(i-1);if(x<w-1)visit(i+1);if(i>=w)visit(i-w);if(i<n-w)visit(i+w);};
 while(head<tail){const i=queue[head++];neighbours(i,j=>{if(!seen[j]&&region[j]){seen[j]=1;if(matches(j)){selected[j]=1;queue[tail++]=j;}}});}
 // Fill small enclosed gaps (e.g. texture/ink inside the painted part), preserving large holes.
 seen.fill(0);const holeLimit=Math.max(9,Math.floor(r*r*.6));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const first=y*w+x;if(selected[first]||seen[first]||!region[first])continue;head=0;tail=1;queue[0]=first;seen[first]=1;let open=false;
  while(head<tail){const i=queue[head++],xx=i%w,yy=Math.floor(i/w);if(xx===0||xx===w-1||yy===0||yy===h-1||rgba[i*4+3]<=24)open=true;neighbours(i,j=>{if(!region[j])open=true;else if(!selected[j]&&!seen[j]){seen[j]=1;queue[tail++]=j;}});}
  if(!open&&tail<=holeLimit)for(let k=0;k<tail;k++)selected[queue[k]]=1;
 }
 // Keep up to three dark outline pixels, stopping before a light adjacent region.
 for(let pass=0;pass<3;pass++){
  const border=selected.slice();for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*w+x;if(border[i])neighbours(i,j=>{const p=j*4;if(region[j]&&rgba[p+3]>24&&rgba[p]<=colour[0]+5&&rgba[p+1]<=colour[1]+5&&rgba[p+2]<=colour[2]+5&&(colour[0]+colour[1]+colour[2]-rgba[p]-rgba[p+1]-rgba[p+2])/3>25)selected[j]=1;});}
 }
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*w+x;if(selected[i])result[i]=mode==='subtract'?0:1;}
 return encodeSelection(result,w,h);
}
