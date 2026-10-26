import type {SkinMesh2D} from './cutout-skinning';
import type {Point2D} from './skeletal2d';
/** Add an outer ring; retain every hand-edited vertex, UV and weight in the existing mesh. */
export function extendRepairMesh(mesh:SkinMesh2D,frame:[number,number,number,number]):SkinMesh2D {
 const xs=mesh.uvs.map(p=>p[0]),ys=mesh.uvs.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
 const x=Math.min(left,frame[0]),y=Math.min(top,frame[1]),r=Math.max(right,frame[0]+frame[2]),b=Math.max(bottom,frame[1]+frame[3]);
 if(x===left&&y===top&&r===right&&b===bottom)return mesh;
 const edges=new Map<string,{a:number;b:number;count:number}>();
 for(let i=0;i<mesh.triangles.length;i+=3)for(let j=0;j<3;j++){const a=mesh.triangles[i+j],b=mesh.triangles[i+(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');const edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{a,b,count:1});}
 const boundary=[...edges.values()].filter(e=>e.count===1),next=new Map(boundary.map(e=>[e.a,e.b])),ring:number[]=[];
 let at:number|undefined=boundary[0]?.a;while(at!==undefined&&!ring.includes(at)&&ring.length<=boundary.length){ring.push(at);at=next.get(at);}
 if(ring.length!==boundary.length||at!==ring[0]||ring.length<3||right===left||bottom===top)throw Error('当前网格边界无法安全延伸，请在高级编辑中调整网格后重试。');
 const cross=(a:Point2D,b:Point2D,c:Point2D)=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
 const turns=ring.map((id,i)=>cross(mesh.uvs[id],mesh.uvs[ring[(i+1)%ring.length]],mesh.uvs[ring[(i+2)%ring.length]])).filter(n=>Math.abs(n)>1e-6);
 if(turns.some(n=>n*turns[0]<0)||ring.some(i=>{const [u,v]=mesh.uvs[i];return Math.min(Math.abs(u-left),Math.abs(u-right),Math.abs(v-top),Math.abs(v-bottom))>1e-5;})||mesh.vertices.length+ring.length>1024||mesh.triangles.length+ring.length*6>6144)throw Error('当前网格无法安全扩展补画区域，请先调整网格边界。');
 const vertices=mesh.vertices.map(p=>[...p] as Point2D),uvs=mesh.uvs.map(p=>[...p] as Point2D),weights=mesh.weights.map(w=>w.map(v=>({...v}))),triangles=[...mesh.triangles],outer=new Map<number,number>();
 // Extend only changed sides. A .01px ring on an unchanged side collapses under
 // tiny skin-weight differences. Reuse its vertices instead of adding slivers.
 const lengths=boundary.map(({a,b})=>Math.hypot(mesh.uvs[a][0]-mesh.uvs[b][0],mesh.uvs[a][1]-mesh.uvs[b][1])).sort((a,b)=>a-b);
 const margin=Math.max(1,Math.min(8,lengths[Math.floor(lengths.length/2)]*.25));
 const xx=x<left?Math.min(x,left-margin):left,yy=y<top?Math.min(y,top-margin):top,rr=r>right?Math.max(r,right+margin):right,bb=b>bottom?Math.max(b,bottom+margin):bottom;
 for(const id of ring){
  const uv=mesh.uvs[id],u:Point2D=[Math.abs(uv[0]-left)<1e-5?xx:Math.abs(uv[0]-right)<1e-5?rr:uv[0],Math.abs(uv[1]-top)<1e-5?yy:Math.abs(uv[1]-bottom)<1e-5?bb:uv[1]];
  if(u[0]===uv[0]&&u[1]===uv[1]){outer.set(id,id);continue;}
  outer.set(id,vertices.length);uvs.push(u);vertices.push([u[0]+mesh.vertices[id][0]-uv[0],u[1]+mesh.vertices[id][1]-uv[1]]);weights.push(mesh.weights[id].map(w=>({...w})));
 }
 for(const {a,b} of boundary)for(const [i,j,k] of [[b,a,outer.get(a)!],[b,outer.get(a)!,outer.get(b)!]])if(Math.abs(cross(uvs[i],uvs[j],uvs[k]))>1e-6)triangles.push(i,j,k);
 return {...mesh,vertices,uvs,weights,triangles};
}
