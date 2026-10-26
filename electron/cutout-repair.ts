import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import type {Service} from './service';
import {isBusy,type Task} from '../src/shared/types';
import {cutoutRepairSource,cutoutRepairPrompt,cutoutRepairContextSource,cutoutRepairDocumentSource,validateRepairPlan,type CutoutRepairEvidence,type CutoutRepairInput} from '../src/shared/cutout-repair';
import {directorDocument} from '../src/shared/cutout-director';
import {requestCutoutVision} from './cutout-rig';
import {repairRegionMask} from './cutout-repair-mask';
import {readPNG,hasTransparency} from './image-processing';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function pngURL(url:string){if(typeof url!=='string'||url.length>24_000_000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url))throw Error('补画参考图无效。');const bytes=Buffer.from(url.split(',')[1],'base64');readPNG(bytes);return bytes;}
export function repairBase(service:Service,candidateId?:string){const saved=service.workspace.cutoutStudio!;if(!candidateId)return saved;const c=service.workspace.cutoutDirector?.candidate;if(c?.id!==candidateId||c.source!==hash(cutoutRepairDocumentSource(saved)))throw Error('角色候选已变化，请重新发起补画。');return directorDocument(saved,c);}
export function guardRepair(service:Service,t:Task){const r=t.cutoutRepair!;if(service.closed||r.stopped||r.dismissed)throw Error('已停止补画。');if(r.contextVersion&&(r.documentSignature!==hash(cutoutRepairDocumentSource(service.workspace.cutoutStudio!))||r.signature!==hash(cutoutRepairContextSource(repairBase(service,r.candidateId),r.partId))))throw Error('角色或装配已修改，旧补画不会覆盖新设置。');}
export async function submitCutoutRepair(service:Service,input:CutoutRepairInput):Promise<Task>{
 if(service.closed||service.workspace.workbenchType!=='cutout-studio'||!service.workspace.cutoutStudio)throw Error('请先在二维角色绘制台拆分部件。');
 if(!input||typeof input.partId!=='string'||typeof input.requestId!=='string'||!input.requestId||input.requestId.length>100||typeof input.prompt!=='string'||input.prompt.length>3000)throw Error('部件补画参数无效。');
 const duplicate=service.workspace.tasks.find(t=>t.requestId===input.requestId);if(duplicate){if(duplicate.cutoutRepair?.partId!==input.partId)throw Error('请求编号已被使用。');return structuredClone(duplicate);}
 if(service.workspace.tasks.some(t=>t.kind==='image'&&(isBusy(t)||t.state==='submission_unknown'||t.cutoutRepair?.partId===input.partId&&t.state==='save_failed')))throw Error('已有图片任务正在处理或待核实，请先处理该任务。');
 const document=repairBase(service,input.candidateId),layer=document.artwork.find(a=>a.partId===input.partId);if(!layer||layer.locked)throw Error('部件不存在或已锁定。');
 const signature=()=>hash(input.context?cutoutRepairContextSource(repairBase(service,input.candidateId),input.partId):cutoutRepairSource(service.workspace.cutoutStudio!,input.partId));
 const request=service.workspace.cutoutDirector?.repairRequest;
 if(input.directorRequestId&&(!request||request.id!==input.directorRequestId||request.partId!==input.partId||request.source!==hash(cutoutRepairDocumentSource(service.workspace.cutoutStudio!))||request.candidateId!==input.candidateId))throw Error('导演补画要求已过期。');
 const previous=input.retryOf?service.workspace.tasks.find(t=>t.id===input.retryOf):undefined;
 if(input.retryOf&&(!previous?.cutoutRepair?.contextVersion||!input.context||previous.state!=='succeeded'||previous.cutoutRepair.dismissed||previous.cutoutRepair.attempt!==1||previous.cutoutRepair.review?.status!=='done'||!previous.cutoutRepair.review.needsCorrection||previous.cutoutRepair.signature!==input.signature||previous.cutoutRepair.partId!==input.partId||previous.cutoutRepair.candidateId!==input.candidateId||previous.cutoutRepair.directorRequestId!==input.directorRequestId||JSON.stringify(previous.cutoutRepair.frame)!==JSON.stringify(input.frame)||previous.cutoutRepair.stopped||service.workspace.tasks.some(t=>t.cutoutRepair?.retryOf===input.retryOf)))throw Error('此补画不能继续自动重试。');
 if(input.signature!==signature())throw Error('部件已修改，请刷新补画输入后重试。');service.key('openai');
 if(!(input.source instanceof ArrayBuffer)||input.source.byteLength>8_000_000)throw Error('补画输入须为不超过 8 MB 的透明 PNG。');
 const bytes=Buffer.from(input.source),source=readPNG(bytes),frame=input.frame;
 if(!Array.isArray(frame)||frame.length!==4||frame.some(v=>!Number.isSafeInteger(v))||frame.slice(0,2).some(v=>Math.abs(v)>16384)||frame[2]!==source.width||frame[3]!==source.height||source.width>4096||source.height>4096||!hasTransparency(bytes))throw Error('补画区域或透明底图无效。');
 const mask=new PNG({width:source.width,height:source.height});for(let i=0;i<source.data.length;i+=4){mask.data[i]=mask.data[i+1]=mask.data[i+2]=255;mask.data[i+3]=source.data[i+3]>0?255:0;}
 if(!source.data.some((v,i)=>i%4===3&&v>0))throw Error('部件内容为空，请重新拆分。');
 const context=input.context?Object.entries(input.context).map(([name,url])=>({name,url,bytes:pngURL(url)})):[];
 if(input.context&&(['assembly','marked','detail'].some(k=>!context.some(v=>v.name===k))||context.length!==3))throw Error('缺少完整角色、部件定位或接缝参考。');
 const original=await service.assets.import(layer.name+'-补画输入.png',bytes),references=[original];
 for(const name of ['assembly','marked','detail']){const value=context.find(v=>v.name===name);if(value)references.push(await service.assets.import(name+'-补画参考.png',value.bytes));}
 if(document.reference)references.push(await service.assets.import('角色整体参考.png',Buffer.from(document.reference.bitmap.split(',')[1],'base64')));
 if(service.closed)throw Error('工作台已关闭。');if(input.signature!==signature())throw Error('准备期间部件已修改，请重试。');
 const id=randomUUID(),prompt=cutoutRepairPrompt(layer.name,input.prompt),task:Task={id,requestId:input.requestId,kind:'image',state:'preparing',createdAt:Date.now(),updatedAt:Date.now(),prompt,effectivePrompt:prompt,assetIds:references.map(a=>a.id),editImageId:original.id,mode:'first_frame',discussion:false,settings:{...service.workspace.settings,optimize:false},outputAssetIds:[],imageEdit:{sourceAssetId:original.id,operation:'inpaint',maskFile:id+'-mask.png'},cutoutRepair:{partId:input.partId,signature:input.signature,frame:[...frame],instruction:input.prompt,...(input.context?{contextVersion:1,documentSignature:hash(cutoutRepairDocumentSource(service.workspace.cutoutStudio!)),candidateId:input.candidateId,directorRequestId:input.directorRequestId,attempt:previous?2:1,retryOf:input.retryOf,...(previous?.cutoutRepair?.plan?{plan:previous.cutoutRepair.plan}:{})}:{})}};
 writeFileSync(join(service.assets.directory,task.imageEdit!.maskFile!),PNG.sync.write(mask));service.workspace.assets.push(...references);service.workspace.tasks.push(task);if(request&&input.directorRequestId===request.id)request.taskId=id;service.changed();void service.run(task);return structuredClone(task);
}

export async function prepareContextRepair(service:Service,t:Task){
 const r=t.cutoutRepair!;if(!r.contextVersion)return;guardRepair(service,t);
 const d=repairBase(service,r.candidateId),p=d.rig.parts.find(p=>p.id===r.partId)!,a=d.artwork.find(a=>a.partId===r.partId)!,assets=t.assetIds.map(id=>service.workspace.assets.find(a=>a.id===id)!);
 const region={type:'object',additionalProperties:false,properties:{x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}},required:['x','y','width','height']};
 if(!r.plan){r.plan=validateRepairPlan(await requestCutoutVision(t.settings,service.key('openai'),assets.map(a=>service.assets.dataUrl(a)),JSON.stringify({request:r.instruction,target:{id:p.id,name:a.name,bone:p.bone,offset:p.offset??[0,0],frame:r.frame},bones:d.rig.bones,parts:d.rig.parts.map(p=>({id:p.id,bone:p.bone,crop:p.crop,offset:p.offset??[0,0],z:p.z})),canvas:d.rig.canvas}),
  '为二维切片角色定位需要补画的隐藏连接和缺口。图1为待补画透明部件；图2为当前完整装配；图3标出目标部件位置与连接；图4为目标附近原比例局部；图5若有是原始角色参考。结合用户要求、遮挡及骨骼判断，只修当前部件。返回1至4个矩形regions，坐标x/y/width/height均相对于图1归一化到0至1，覆盖缺口及窄接缝，不能选择整个画布，各矩形面积之和不超过画布的75%。原有不透明核心会被保护，允许修整边缘最多3像素；不要补其他肢体或复制周围部件。instruction具体说明补什么、朝什么方向延伸、连接何处和应保留的风格；summary中文解释判断。无法从图中确定时选择最保守的局部区域并在summary说明，不声称看到了隐藏结构。',
  {type:'object',additionalProperties:false,properties:{summary:{type:'string'},instruction:{type:'string'},regions:{type:'array',items:region,minItems:1,maxItems:4}},required:['summary','instruction','regions']},'cutout_repair_plan'));guardRepair(service,t);}
 const source=readPNG(service.assets.bytes(assets[0]));writeFileSync(join(service.assets.directory,t.imageEdit!.maskFile!),repairRegionMask(source,r.plan));
 const correction=r.retryOf?service.workspace.tasks.find(v=>v.id===r.retryOf)?.cutoutRepair?.review?.correction:'';
 t.effectivePrompt=`补画一个二维骨骼角色的独立部件「${a.name}」。第一张是唯一需要输出的透明部件；第二张当前完整角色、第三张带位置标记的角色、第四张接缝局部、第五张若有的原图都仅供参考，绝不能复制到输出。只编辑遮罩透明区域，原有核心像素及位置保持；可调整允许的窄接缝使线条连续。补画规划：${r.plan.instruction}。用户要求：${r.instruction}。${correction?'上一次装回角色并转动检查发现：'+correction+'。此次只修正这些问题。':''}保持第一张图的尺寸、位置、朝向、比例及透明背景。输出单独部件PNG，不画整个人物、其他部件、参考标记、文字、投影或背景。`;
 service.changed();
}

export async function reviewContextRepair(service:Service,id:string,evidence:CutoutRepairEvidence){
 const t=service.workspace.tasks.find(t=>t.id===id),r=t?.cutoutRepair;
 if(!t||!r?.contextVersion||t.state!=='succeeded'||r.dismissed)throw Error('没有可回看的补画候选。');guardRepair(service,t);
 if(evidence.signature!==r.signature||evidence.assetId!==t.outputAssetIds[0]||!Array.isArray(evidence.images)||evidence.images.length!==2||!Array.isArray(evidence.poses)||evidence.poses.length<3||evidence.poses.length>7||evidence.poses.some(v=>typeof v!=='string'||v.length>100))throw Error('补画回看已过期或画面不完整。');
 evidence.images.forEach(pngURL);if(r.review?.status==='done')return structuredClone(r.review);if(r.review?.status==='reviewing')throw Error('补画正在回看。');r.review={status:'reviewing',summary:'正在装回角色检查接缝和转动效果…'};service.changed();
 try{const assets=[t.assetIds[0],t.outputAssetIds[0]].map(id=>service.workspace.assets.find(a=>a.id===id)!);
  const result=await requestCutoutVision(t.settings,service.key('openai'),[...assets.map(a=>service.assets.dataUrl(a)),...evidence.images],JSON.stringify({request:r.instruction,plan:r.plan,poses:evidence.poses,attempt:r.attempt}),
   '回看二维角色部件补画。图1原部件，图2补画候选，图3是同一镜头下补画前后完整装配，图4是实际渲染的关节转动前后对照。只检查目标部件的连接、轮廓、配色、原位对齐、露洞和意外复制其他部件，不能要求重建骨骼或修改其他图片。summary中文说明实际观察到的优缺点，不保证艺术质量；needsCorrection仅在明确可修正的问题时为true，correction给出具体局部修正方向，否则为空。已有核心像素和蒙皮保持，不能依赖改动它们解决问题。第二次是最终回看，仍需修正时如实说明，不能宣称已经修好。',
   {type:'object',additionalProperties:false,properties:{summary:{type:'string'},needsCorrection:{type:'boolean'},correction:{type:'string'}},required:['summary','needsCorrection','correction']},'cutout_repair_review');
  guardRepair(service,t);if(!result||typeof result.summary!=='string'||result.summary.length>3000||typeof result.needsCorrection!=='boolean'||typeof result.correction!=='string'||result.correction.length>2000||result.needsCorrection&&!result.correction.trim())throw Error('补画回看格式无效。');r.review={status:'done',summary:result.summary,needsCorrection:result.needsCorrection,correction:result.correction};service.changed();return structuredClone(r.review);
 }catch(e){r.review={status:'failed',summary:(e as Error).message};service.changed();throw e;}
}
