import {PNG} from 'pngjs';
import {validateRepairPlan,type CutoutRepairPlan} from '../src/shared/cutout-repair';
/** Only planned regions and a narrow seam are editable; the opaque core remains exact. */
export function repairRegionMask(source:PNG,plan:CutoutRepairPlan):Buffer {
 validateRepairPlan(plan);const {width:w,height:h}=source,size=w*h,inside=new Uint8Array(size);
 for(let i=0;i<size;i++)inside[i]=source.data[i*4+3]>0?1:0;
 let core=inside;
 const band=Math.max(1,Math.min(3,Math.round(Math.min(w,h)*.008)));
 for(let pass=0;pass<band;pass++){const next=new Uint8Array(size);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;next[i]=core[i]&&core[i-1]&&core[i+1]&&core[i-w]&&core[i+w]?1:0;}core=next;}
 const mask=new PNG({width:w,height:h});mask.data.fill(255);let count=0;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(core[i])continue;if(plan.regions.some(r=>x/w>=r.x&&x/w<r.x+r.width&&y/h>=r.y&&y/h<r.y+r.height)){mask.data[i*4+3]=0;count++;}}
 if(!count)throw Error('定位区域没有可补画的透明区域或接缝，请补充部位描述后重试。');
 return PNG.sync.write(mask);
}
