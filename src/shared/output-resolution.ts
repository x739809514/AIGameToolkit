export interface OutputResolution {width:number;height:number;fit:'scale-crop'|'crop-scale'|'contain'}
export function validateOutputResolution(value:OutputResolution|undefined){
  if(value===undefined)return;
  if(!value||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<16||value.height<16||value.width>8192||value.height>8192||value.width*value.height>16_000_000)throw new Error('目标宽高须为 16–8192 的整数，且总像素不超过 1600 万。');
  if(!['scale-crop','crop-scale','contain'].includes(value.fit))throw new Error('请选择有效的尺寸适配方式。');
}
// The provider uses its existing supported generation sizes; final pixels are enforced locally.
export function imageGenerationSize(target:OutputResolution){return target.width/target.height>1.2?'1536x1024':target.height/target.width>1.2?'1024x1536':'1024x1024';}
export function outputFilter(target:OutputResolution){
  validateOutputResolution(target);const {width:w,height:h,fit}=target;
  if(fit==='contain')return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  if(fit==='crop-scale')return `crop=w='min(iw,ih*${w}/${h})':h='min(ih,iw*${h}/${w})':exact=1,scale=${w}:${h}:flags=lanczos,setsar=1`;
  return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:exact=1,setsar=1`;
}
