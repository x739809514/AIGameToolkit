import type {Point2D} from '../shared/skeletal2d';
import type {SkinMesh2D} from '../shared/cutout-skinning';
/** Piecewise affine texture mapping using the same source registration as rigid cutouts. */
export function drawSkinnedMesh(c:CanvasRenderingContext2D,texture:HTMLCanvasElement,origin:Point2D,mesh:SkinMesh2D,vertices:Point2D[],wire=false){
 const scale=Math.max(.01,Math.hypot(c.getTransform().a,c.getTransform().b)),pad=.25/scale;
 for(let index=0;index<mesh.triangles.length;index+=3){const ids=mesh.triangles.slice(index,index+3),src=ids.map(i=>[mesh.uvs[i][0]-origin[0],mesh.uvs[i][1]-origin[1]]),dst=ids.map(i=>vertices[i]),sx1=src[1][0]-src[0][0],sy1=src[1][1]-src[0][1],sx2=src[2][0]-src[0][0],sy2=src[2][1]-src[0][1],det=sx1*sy2-sx2*sy1;if(Math.abs(det)<1e-10)continue;
  const dx1=dst[1][0]-dst[0][0],dy1=dst[1][1]-dst[0][1],dx2=dst[2][0]-dst[0][0],dy2=dst[2][1]-dst[0][1],a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det,cc=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det,tx=dst[0][0]-a*src[0][0]-cc*src[0][1],ty=dst[0][1]-b*src[0][0]-d*src[0][1];
  c.save();c.beginPath();const center=[dst.reduce((s,p)=>s+p[0],0)/3,dst.reduce((s,p)=>s+p[1],0)/3];dst.forEach((p,i)=>{const dx=p[0]-center[0],dy=p[1]-center[1],length=Math.hypot(dx,dy)||1,x=p[0]+dx/length*pad,y=p[1]+dy/length*pad;if(i)c.lineTo(x,y);else c.moveTo(x,y);});c.closePath();c.clip();c.transform(a,b,cc,d,tx,ty);c.drawImage(texture,0,0);c.restore();
 }
 if(wire){c.save();c.lineWidth=1/scale;c.strokeStyle='#65e9c0';c.globalAlpha=.7;for(let i=0;i<mesh.triangles.length;i+=3){c.beginPath();for(let j=0;j<3;j++){const v=vertices[mesh.triangles[i+j]];if(j)c.lineTo(...v);else c.moveTo(...v);}c.closePath();c.stroke();}c.restore();}
}
