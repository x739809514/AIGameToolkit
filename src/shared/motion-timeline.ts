export interface MotionTimelineItem {id:string;assetId:string;clipIndex:number;label:string;sourceDuration:number;in:number;out:number;rate:number;blendIn:number}
export interface MotionTimelineSpan {item:MotionTimelineItem;start:number;end:number;duration:number;blend:number}
export function validateMotionTimeline(items:MotionTimelineItem[],owns?:(id:string)=>boolean):MotionTimelineItem[]{
  if(!Array.isArray(items)||items.length>64)throw new Error('时间轴最多包含 64 个动作片段。');
  const ids=new Set<string>();return items.map(item=>{
    if(!item||typeof item.id!=='string'||!item.id||item.id.length>80||ids.has(item.id)||typeof item.assetId!=='string'||owns&&!owns(item.assetId))throw new Error('时间轴动作不存在或片段编号重复。');ids.add(item.id);
    if(!Number.isInteger(item.clipIndex)||item.clipIndex<0||item.clipIndex>10000||typeof item.label!=='string'||item.label.length>180||![item.sourceDuration,item.in,item.out,item.rate,item.blendIn].every(Number.isFinite)||item.sourceDuration<=0||item.sourceDuration>36000||item.in<0||item.out<=item.in||item.out>item.sourceDuration+.00001||item.rate<.25||item.rate>4||item.blendIn<0||item.blendIn>5)throw new Error('动作范围、速度或混合时长不合法。');
    return {id:item.id,assetId:item.assetId,clipIndex:item.clipIndex,label:item.label,sourceDuration:item.sourceDuration,in:item.in,out:Math.min(item.out,item.sourceDuration),rate:item.rate,blendIn:item.blendIn};
  });
}
export function motionTimelineLayout(items:MotionTimelineItem[]):MotionTimelineSpan[]{
  const spans:MotionTimelineSpan[]=[];for(const item of items){const duration=(item.out-item.in)/item.rate,previous=spans.at(-1),blend=previous?Math.min(item.blendIn,duration/2,previous.duration/2):0,start=previous?previous.end-blend:0;spans.push({item,start,end:start+duration,duration,blend});}return spans;
}
export function normalizeMotionTimeline(items:MotionTimelineItem[],owns?:(id:string)=>boolean){return motionTimelineLayout(validateMotionTimeline(items,owns)).map(span=>({...span.item,blendIn:span.blend}));}
export function motionTimelineDuration(items:MotionTimelineItem[]){return motionTimelineLayout(items).at(-1)?.end||0;}
export function motionTimelineSamples(items:MotionTimelineItem[],time:number){
  const spans=motionTimelineLayout(items);if(!spans.length)return [];
  const t=Math.max(0,Math.min(time,spans.at(-1)!.end));let index=spans.reduce((last,span,i)=>span.start<=t?i:last,0);index=Math.max(0,index);const current=spans[index];
  const local=(span:MotionTimelineSpan)=>Math.min(span.item.out,span.item.in+Math.max(0,t-span.start)*span.item.rate);
  if(index>0&&current.blend>0&&t<spans[index-1].end){const weight=(t-current.start)/current.blend;return [{span:spans[index-1],time:local(spans[index-1]),weight:1-weight},{span:current,time:local(current),weight}];}
  return [{span:current,time:local(current),weight:1}];
}
export function moveMotionTimelineItem(items:MotionTimelineItem[],id:string,before?:string){const moving=items.find(item=>item.id===id);if(!moving||id===before)return items;const next=items.filter(item=>item.id!==id),index=before?next.findIndex(item=>item.id===before):-1;next.splice(index<0?next.length:index,0,moving);return normalizeMotionTimeline(next);}
// The horizontal drop position determines both ordering and incoming overlap.
// Gaps snap to the previous clip's end; intersecting clips create a blend.
export function placeMotionTimelineItem(items:MotionTimelineItem[],id:string,start:number,snap=.06){
  if(!Number.isFinite(start))return items;
  const moving=items.find(item=>item.id===id);if(!moving)return items;
  const others=motionTimelineLayout(items).filter(span=>span.item.id!==id),before=others.find(span=>span.start>=start)?.item.id;
  const ordered=moveMotionTimelineItem(items,id,before),index=ordered.findIndex(item=>item.id===id);
  const previous=motionTimelineLayout(ordered.slice(0,index)).at(-1);
  const overlap=previous?Math.max(0,previous.end-start):0;
  return normalizeMotionTimeline(ordered.map(item=>item.id===id?{...item,blendIn:overlap<=snap?0:Math.min(5,overlap)}:item));
}
// Trim only the timeline instance; source bytes and sourceDuration never change.
export function trimMotionTimelineItem(items:MotionTimelineItem[],id:string,edge:'in'|'out',deltaSeconds:number){
  if(!Number.isFinite(deltaSeconds))return items;
  return normalizeMotionTimeline(items.map(item=>{
    if(item.id!==id)return item;
    const minimum=Math.min(.02,item.sourceDuration),delta=deltaSeconds*item.rate;
    const value=edge==='in'?Math.max(0,Math.min(item.out-minimum,item.in+delta)):Math.max(item.in+minimum,Math.min(item.sourceDuration,item.out+delta));
    return {...item,[edge]:value};
  }));
}
