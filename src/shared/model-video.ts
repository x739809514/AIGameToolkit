import {normalizeMotionBlend,type MotionBlendTree} from './motion-blend';
import {normalizeMotionTimeline,motionTimelineDuration,type MotionTimelineItem} from './motion-timeline';
export interface ModelVideoInput {blendTree?:MotionBlendTree;timelineItems?:MotionTimelineItem[];assetId:string;clipIndex:number;start:number;end:number;speed:number;width:number;height:number;fps:number}
export function modelVideoFrames(input:ModelVideoInput){
  if(!input||typeof input.assetId!=='string'||!Number.isInteger(input.clipIndex)||input.clipIndex<0||![24,30,60].includes(input.fps)||![.25,.5,1,1.5,2].includes(input.speed)||!Number.isFinite(input.start)||!Number.isFinite(input.end)||input.start<0||input.end<=input.start)throw new Error('请选择有效的动画范围、帧率和播放速度。');
  if(![input.width,input.height].every(n=>Number.isInteger(n)&&n>=128&&n<=4096&&n%2===0)||input.width*input.height>4096*2160)throw new Error('视频尺寸不支持，请调整分辨率。');
  const duration=(input.end-input.start)/input.speed;if(duration>300)throw new Error('单次导出最多 5 分钟，请缩短动画范围。');
  if(input.blendTree){const tree=normalizeMotionBlend(input.blendTree);if(!tree.enabled||!tree.nodes.length||input.timelineItems||input.end>tree.cycle+.00001)throw new Error('导出范围或混合树配置不合法。');}
  if(input.timelineItems){const items=normalizeMotionTimeline(input.timelineItems);if(!items.length||input.end>motionTimelineDuration(items)+.00001)throw new Error('导出范围超出动作时间轴。');}
  return Math.max(1,Math.ceil(duration*input.fps-1e-8));
}
export function modelVideoFrameTime(input:ModelVideoInput,index:number){return Math.min(input.end,input.start+index*input.speed/input.fps);}
