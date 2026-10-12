import { defaults, supportsSolReasoning, validateReasoningSettings, minimaxAPI } from '../src/shared/types';
import type { Asset, Settings, Task, MiniMaxRegion } from '../src/shared/types';
import {fetchHTTP,networkDetail} from './network';
export class ProviderError extends Error {constructor(message:string,public uncertain=false){super(message);}}
export async function jsonRequest(url:string,init:RequestInit,timeout=120000):Promise<any>{
  let response:Response;
  try{response=await fetchHTTP(url,{...init,signal:AbortSignal.timeout(timeout)});}catch(e){throw new ProviderError(`${networkDetail(e)}（${new URL(url).hostname}）。请检查网络、代理或稍后再试。`,init.method==='POST');}
  let data:any;
  try{data=await response.json();}catch(e){throw new ProviderError(`${e instanceof SyntaxError?'服务返回了无法解析的响应':networkDetail(e)}（${new URL(url).hostname}）。`,init.method==='POST');}
  if(!response.ok||data.error||data.base_resp?.status_code){
    const labels:Record<number,string>={401:'API Key 无效',403:'账号没有权限',402:'余额不足',429:'请求过于频繁',422:'素材或提示词被拒绝'};
    throw new ProviderError(`${labels[response.status]||'请求失败'}：${data.error?.message||data.base_resp?.status_msg||response.statusText}`,init.method==='POST'&&response.status>=500);
  }
  return data;
}
const auth=(key:string)=>({'Authorization':`Bearer ${key}`,'Content-Type':'application/json'});
export function validateVideo(task:Task,assets:Asset[]){
  const s=task.settings;
  if(!['MiniMax-H3','MiniMax-H3-Max'].includes(s.videoModel))throw new Error('视频模型不支持。');
  if(!Number.isInteger(s.videoDuration)||s.videoDuration<(s.videoModel==='MiniMax-H3'?4:5)||s.videoDuration>15)throw new Error('视频时长不符合模型限制。');
  if(!(s.videoModel==='MiniMax-H3'?['768P','2K']:['480P','768P']).includes(s.videoResolution))throw new Error('所选模型不支持此分辨率。');
  if((task.effectivePrompt||task.prompt).length>7000)throw new Error('视频 prompt 不能超过 7000 字符。');
  const images=assets.filter(a=>a.type==='image');const videos=assets.filter(a=>a.type==='video');
  if(task.mode==='first_frame'){
    if(images.length!==1||videos.length)throw new Error('首帧模式仅支持一张基础图片；视频请切换参考模式。');
  }else if(task.mode==='first_last'){if(!task.baseImageId||!task.lastImageId||task.baseImageId===task.lastImageId||images.length!==2||videos.length||!images.some(a=>a.id===task.baseImageId)||!images.some(a=>a.id===task.lastImageId))throw new Error('首尾帧模式需两张不同的图片，不能混用参考视频。');}
  else if(task.mode==='text'){if(images.length||videos.length)throw new Error('纯文字模式不能包含图片或视频参考。');}
  else if(images.length>9||videos.length>3||!images.length&&!videos.length)throw new Error('参考模式需 1–9 张图片或 1–3 个视频。');
  for(const a of [...images,...videos]){
    if(!a.width||!a.height||a.width<256||a.height<256||a.width>5760||a.height>5760||a.width/a.height<0.4||a.width/a.height>2.5)throw new Error(`${a.name}：宽高须为 256–5760px，比例须为 0.4–2.5。`);
    if(a.size>(a.type==='image'?30:50)*1024*1024)throw new Error(`${a.name} 超过模型文件大小限制。`);
    if(a.type==='video'){
      if(!a.duration||a.duration<2||a.duration>15)throw new Error(`${a.name}：参考视频须为 2–15 秒。`);
      if(!['h264','hevc'].includes(a.videoCodec||'')||a.audioCodec&&!['aac','mp3'].includes(a.audioCodec))throw new Error(`${a.name}：需 H.264/H.265 视频及 AAC/MP3 音轨。`);
      if(!a.fps||a.fps<23.976||a.fps>60)throw new Error(`${a.name}：帧率须为 23.976–60 fps。`);
    }
  }
  if(videos.reduce((n,a)=>n+(a.duration||0),0)>15)throw new Error('参考视频总时长不能超过 15 秒。');
}
export function buildVideoBody(task:Task,assets:Asset[],dataUrl:(a:Asset)=>string){
  validateVideo(task,assets);
  const content:any[]=[{type:'text',text:task.effectivePrompt||task.prompt}];
  for(const a of assets){if(a.type==='document')continue;const type=a.type==='image'?'image_url':'video_url';content.push({type,[type]:{url:dataUrl(a)},role:task.mode==='first_last'?(a.id===task.baseImageId?'first_frame':'last_frame'):task.mode==='first_frame'?'first_frame':a.type==='image'?'reference_image':'reference_video'});}
  const body={model:task.settings.videoModel,content,resolution:task.settings.videoResolution,duration:task.settings.videoDuration,ratio:task.mode==='text'?'16:9':'adaptive'};
  if(Buffer.byteLength(JSON.stringify(body))>64*1024*1024)throw new Error('编码后请求超过 64 MB，请使用更小的参考素材。');
  return body;
}
export async function createVideo(task:Task,assets:Asset[],dataUrl:(a:Asset)=>string,key:string){
  const body=buildVideoBody(task,assets,dataUrl);
  const data=await jsonRequest(`${minimaxAPI(task.settings.minimaxRegion).baseURL}/v2/video_generation`,{method:'POST',headers:auth(key),body:JSON.stringify(body)},300000);
  if(!data.task_id)throw new ProviderError('供应商未返回任务 ID，提交状态不确定。',true);return String(data.task_id);
}
export async function queryVideo(id:string,key:string,region:MiniMaxRegion='cn'){return (await jsonRequest(`${minimaxAPI(region).baseURL}/v2/query/video_generation/${encodeURIComponent(id)}`,{headers:auth(key)},30000)).task;}
export async function generateImage(task:Task,assets:Asset[],bytes:(a:Asset)=>Buffer,key:string,edit?:{source:Buffer;mask?:Buffer}){
  const s=task.settings;const refs=assets.filter(a=>a.type==='image');let body:BodyInit;let headers:Record<string,string>;
  if(refs.length){
    const form=new FormData();form.set('model',s.imageModel);form.set('prompt',task.effectivePrompt||task.prompt);form.set('size',s.imageSize);form.set('quality',s.imageQuality);
    refs.forEach((a,i)=>form.append('image[]',new Blob([new Uint8Array(edit&&i===0?edit.source:bytes(a))],{type:edit&&i===0?'image/png':a.mime}),edit&&i===0?'source.png':a.name));
    if(edit){form.set('size','auto');form.set('output_format','png');if(edit.mask)form.set('mask',new Blob([new Uint8Array(edit.mask)],{type:'image/png'}),'mask.png');if(task.imageEdit?.operation==='remove_background')form.set('background','transparent');}body=form;headers={'Authorization':`Bearer ${key}`};
  }else{body=JSON.stringify({model:s.imageModel,prompt:task.effectivePrompt||task.prompt,size:s.imageSize,quality:s.imageQuality,n:1});headers=auth(key);}
  const data=await jsonRequest(`https://api.openai.com/v1/images/${refs.length?'edits':'generations'}`,{method:'POST',headers,body},600000);
  if(!data.data?.[0]?.b64_json)throw new ProviderError('图片响应没有图片数据，不能确定生成结果。',true);
  return Buffer.from(data.data[0].b64_json,'base64');
}
export async function chat(s:Settings,key:string,prompt:string,images:string[],history:{role:string;text:string}[],discussion:boolean){
  const instruction=discussion?'你是图片与视频创作助手。用中文回答用户，分析素材并给出具体建议。':'整理用户创作需求为一段可直接用于生成的提示词。保留所有明确要求，结合所提供素材，只返回提示词，不加解释。';
  if(s.chatProvider==='anthropic'){
    const content:any[]=[{type:'text',text:prompt}];for(const url of images){const m=url.match(/^data:(.*?);base64,(.*)$/s)!;content.push({type:'image',source:{type:'base64',media_type:m[1],data:m[2]}});}
    const data=await jsonRequest('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:s.claudeModel,max_tokens:1600,system:instruction,messages:[...history.slice(-8).map(m=>({role:m.role,content:m.text})),{role:'user',content}]})});
    const text=data.content?.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');if(!text)throw new Error('Claude 未返回文本。');return text;
  }
  if(supportsSolReasoning(s.openaiModel)){
    const reasoningSettings={...s,openaiReasoningEffort:s.openaiReasoningEffort??defaults.openaiReasoningEffort,openaiReasoningMode:s.openaiReasoningMode??defaults.openaiReasoningMode};
    validateReasoningSettings(reasoningSettings);
    const data=await jsonRequest('https://api.openai.com/v1/responses',{method:'POST',headers:auth(key),body:JSON.stringify({
      model:s.openaiModel,instructions:instruction,store:false,
      reasoning:{effort:reasoningSettings.openaiReasoningEffort,mode:reasoningSettings.openaiReasoningMode},
      input:[...history.slice(-8).map(m=>({role:m.role,content:m.text})),{role:'user',content:[{type:'input_text',text:prompt},...images.map(url=>({type:'input_image',image_url:url,detail:'auto'}))]}]
    })},600000);
    if(data.status!=='completed')throw new Error(`OpenAI 回答未完成：${data.incomplete_details?.reason||data.status||'未知状态'}。`);
    const content=data.output?.filter((item:any)=>item.type==='message'&&item.role==='assistant').flatMap((item:any)=>item.content||[])||[];
    const text=content.filter((item:any)=>item.type==='output_text').map((item:any)=>item.text).join('\n');
    if(!text){const refusal=content.find((item:any)=>item.type==='refusal')?.refusal;throw new Error(refusal||'OpenAI 未返回文本。');}
    return text;
  }
  const data=await jsonRequest('https://api.openai.com/v1/chat/completions',{method:'POST',headers:auth(key),body:JSON.stringify({model:s.openaiModel,messages:[{role:'system',content:instruction},...history.slice(-8).map(m=>({role:m.role,content:m.text})),{role:'user',content:[{type:'text',text:prompt},...images.map(url=>({type:'image_url',image_url:{url}}))]}]})});
  if(!data.choices?.[0]?.message?.content)throw new Error('OpenAI 未返回文本。');return data.choices[0].message.content;
}
export async function testConnection(provider:string,key:string,region:MiniMaxRegion='cn'){
  if(provider==='openai')await jsonRequest('https://api.openai.com/v1/models',{headers:auth(key)},20000);
  else if(provider==='anthropic')await jsonRequest('https://api.anthropic.com/v1/models',{headers:{'x-api-key':key,'anthropic-version':'2023-06-01'}},20000);
  else await jsonRequest(`${minimaxAPI(region).baseURL}/v2/query/video_generation?page_num=1&page_size=1`,{headers:auth(key)},20000);
  return `${provider==='minimax'?`MiniMax ${minimaxAPI(region).label}（${minimaxAPI(region).baseURL}）`:'凭据'}验证成功。指定模型权限、余额和生成能力需通过真实任务验证。`;
}
