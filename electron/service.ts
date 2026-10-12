import {ModelVideoExporter} from './model-video-export';
import {Motions} from './motions';
import {analyzePose as requestPose} from './pose';
import type {PoseAnalysis} from '../src/shared/pose';
import { existsSync } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropPNG, validateMask, readPNG, compositeSelection, hasTransparency } from './image-processing';
import { randomUUID } from 'node:crypto';
import type { Asset, Boot, Draft, GenerateInput, ImportFile, Kind, Provider, Settings, Task, Workspace, FrameSequence, ImageEditInput, CropInput, ModelEditorState } from '../src/shared/types';
import { isBusy, defaultFrameWorkspace, validateFrameCount, validateReasoningSettings, deletableGeneratedImage, removeGeneratedImage, minimaxAPI } from '../src/shared/types';
import {fetchHTTP} from './network';
import { Store } from './store';
import { Assets } from './assets';
import * as provider from './providers';
export interface Vault {get(p:Provider):string|undefined;set(p:Provider,value:string):void;secure:boolean}
export class Service {
  workspace:Workspace;assets:Assets;modelVideo=new ModelVideoExporter(this);motions=new Motions(this);timers=new Map<string,ReturnType<typeof setTimeout>>();polling=new Set<string>();saving=new Set<string>();closed=false;localOperations=0;deletingImageIds=new Set<string>();
  constructor(public store:Store,public vault:Vault,public onChange:(w:Workspace)=>void){this.workspace=store.load();this.assets=new Assets(store.directory+'/assets');let interrupted=false;for(const seq of this.workspace.frameWorkspace?.sequences||[])if(seq.status==='extracting'){seq.status='failed';seq.error='应用在拆帧期间退出，请重新拆帧。';interrupted=true;}if(this.workspace.poseWorkspace?.analysis?.status==='analyzing'){this.workspace.poseWorkspace.analysis.status='failed';this.workspace.poseWorkspace.analysis.error='应用在解析期间退出，请重新解析。';interrupted=true;}if(this.workspace.motionWorkspace?.extraction?.status==='extracting'){this.workspace.motionWorkspace.extraction.status='failed';this.workspace.motionWorkspace.extraction.error='应用在提取期间退出，请重新提取。';interrupted=true;}if(interrupted)this.store.save(this.workspace);}
  boot():Boot{return {workspace:structuredClone(this.workspace),credentials:{openai:!!this.vault.get('openai'),anthropic:!!this.vault.get('anthropic'),minimax:!!this.vault.get('minimax')},secureStorage:this.vault.secure,dataDirectory:this.store.directory,desktop:true};}
  changed(){this.store.save(this.workspace);if(!this.closed)this.onChange(structuredClone(this.workspace));}
  assertAI(){if(this.workspace.workbenchType==='motion-editor')throw new Error('动作编辑器为本地工作台，不接入 AI。');}
  modelData(id:string){if(this.workspace.workbenchType!=='motion-editor')throw new Error('请在动作编辑器中打开 FBX。');const asset=this.workspace.assets.find(a=>a.id===id&&a.type==='model');if(!asset)throw new Error('FBX 素材不存在。');const bytes=this.assets.bytes(asset);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;}
  saveModelEditor(state:ModelEditorState){if(this.workspace.workbenchType!=='motion-editor')throw new Error('请在动作编辑器中保存。');if(state.assetId&&!this.workspace.assets.some(a=>a.id===state.assetId&&a.type==='model'))throw new Error('模型不存在。');if(!Number.isInteger(state.clipIndex)||state.clipIndex<0||state.clipIndex>10000||![.25,.5,1,1.5,2].includes(state.speed)||[state.loop,state.showSkeleton,state.showGrid,state.ignoreTranslation??false].some(v=>typeof v!=='boolean'))throw new Error('动作播放参数不合法。');this.workspace.modelEditor={assetId:state.assetId,clipIndex:state.clipIndex,speed:state.speed,loop:state.loop,showSkeleton:state.showSkeleton,showGrid:state.showGrid,ignoreTranslation:state.ignoreTranslation??false};this.changed();}
  key(p:Provider){this.assertAI();const k=this.vault.get(p);if(!k)throw new Error(`请先在设置中配置 ${p==='openai'?'OpenAI':p==='anthropic'?'Claude':'MiniMax'} API Key。`);return k;}
  saveSettings(s:Settings,keys:Partial<Record<Provider,string>>){
    validateReasoningSettings(s);
    if(s.minimaxRegion!=='cn')throw new Error('当前版本使用 MiniMax 中国区 API，请使用中国区配置。');
    if(!s.openaiModel.trim()||!s.imageModel.trim()||!s.claudeModel.trim())throw new Error('模型 ID 不能为空。');
    if(!['openai','anthropic'].includes(s.chatProvider)||!['MiniMax-H3','MiniMax-H3-Max'].includes(s.videoModel))throw new Error('不支持的供应商或视频模型。');
    if(!['1024x1024','1536x1024','1024x1536','auto'].includes(s.imageSize)||!['low','medium','high','auto'].includes(s.imageQuality))throw new Error('图片参数不支持。');
    for(const p of ['openai','anthropic','minimax'] as Provider[])if(typeof keys[p]==='string')this.vault.set(p,keys[p]!.trim());
    this.workspace.settings={...s};this.changed();return this.boot();
  }
  async testConnection(p:Provider){return provider.testConnection(p,this.key(p),this.workspace.settings.minimaxRegion);}
  saveDraft(kind:Kind,draft:Draft){this.assertKind(kind);this.assertDraft(draft);this.workspace.drafts[kind]=structuredClone(draft);this.changed();}
  assertKind(k:string){if(!['image','video'].includes(k))throw new Error('会话不存在。');}
  assertDraft(d:Draft){if(typeof d.prompt!=='string'||d.prompt.length>30000||!Array.isArray(d.attachmentIds)||d.attachmentIds.length>12||!['first_frame','reference','first_last','text'].includes(d.mode))throw new Error('草稿格式不合法。');for(const id of [...d.attachmentIds,d.baseImageId,d.lastImageId,d.editImageId].filter(Boolean)){if(this.deletingImageIds.has(id!))throw new Error('此图片正在删除，请重新选择素材。');if(!this.workspace.assets.some(a=>a.id===id))throw new Error('素材不存在。');}}
  async localOperation<T>(fn:()=>Promise<T>):Promise<T>{if(this.closed)throw new Error('工作台已关闭。');this.localOperations++;try{return await fn();}finally{this.localOperations--;}}
  async importFiles(files:ImportFile[]){return this.localOperation(async()=>{if(files.length>12)throw new Error('一次最多上传 12 个文件。');const imported:Asset[]=[];for(const f of files){if(this.workspace.workbenchType==='motion-editor'&&!/\.fbx$/i.test(f.name))throw new Error('动作编辑器仅支持 FBX 文件。');if(this.workspace.workbenchType!=='motion-editor'&&/\.fbx$/i.test(f.name))throw new Error('请在动作编辑器中导入 FBX。');const a=await this.assets.import(f.name,Buffer.from(f.bytes));this.workspace.assets.push(a);imported.push(a);this.changed();}return imported;});}
  select(kind:Kind,id:string){this.assertKind(kind);if(!this.workspace.assets.some(a=>a.id===id&&a.type===kind))throw new Error('素材不存在。');if(kind==='image')this.workspace.selectedImageId=id;else this.workspace.selectedVideoId=id;this.changed();}
  async deleteGeneratedImage(id:string,trashFile:(path:string)=>Promise<void>){
    const asset=deletableGeneratedImage(this.workspace,id);
    if(this.deletingImageIds.has(id))throw new Error('图片正在删除。');
    this.deletingImageIds.add(id);
    try{
      const path=this.assets.path(asset);if(existsSync(path))await trashFile(path);
      removeGeneratedImage(this.workspace,id);this.changed();return structuredClone(this.workspace);
    }finally{this.deletingImageIds.delete(id);}
  }
  imageAsset(id:string){if(this.deletingImageIds.has(id))throw new Error('图片正在删除，请重新选择素材。');const asset=this.workspace.assets.find(a=>a.id===id&&a.type==='image');if(!asset)throw new Error('图片不存在。');return asset;}
  async imageData(id:string){return `data:image/png;base64,${(await this.assets.normalizedPNG(this.imageAsset(id))).toString('base64')}`;}
  async cropImage(input:CropInput){return this.localOperation(async()=>{
    const source=this.imageAsset(input.assetId),selected=this.workspace.selectedImageId;
    const bytes=cropPNG(await this.assets.normalizedPNG(source),input);
    this.imageAsset(source.id);
    const asset=await this.assets.import(source.name.replace(/\.[^.]+$/,'')+'-裁切.png',bytes);
    asset.sourceAssetId=source.id;asset.imageAction='crop';this.updateFrameVersion(source,asset);this.workspace.assets.push(asset);if(this.workspace.selectedImageId===selected)this.workspace.selectedImageId=asset.id;this.changed();return asset;
  });}
  async editImage(input:ImageEditInput){return this.localOperation(async()=>{
    if(!['edit','inpaint','remove_background'].includes(input.operation))throw new Error('修改工具不支持。');
    if(input.operation!=='inpaint'&&input.mask)throw new Error('文字修改不使用圈选遮罩，请选择局部修改。');
    const duplicate=this.workspace.tasks.find(t=>t.requestId===input.requestId);if(duplicate)return structuredClone(duplicate);
    if(this.workspace.tasks.some(t=>t.kind==='image'&&isBusy(t)))throw new Error('图片窗口已有任务，请等待完成。');
    const source=this.imageAsset(input.assetId);this.key('openai');
    if(typeof input.prompt!=='string'||input.prompt.length>30000)throw new Error('修改 Prompt 不合法。');
    const prompt=input.operation==='remove_background'?'移除整张图片的背景，保留主体的形状、颜色、细节和自然边缘。输出透明背景 PNG，不添加阴影或新背景。'+(input.prompt.trim()?`补充要求：${input.prompt.trim()}`:''):input.prompt.trim();
    if(!prompt)throw new Error('请输入修改要求。');
    const original=await this.assets.normalizedPNG(source);
    if(input.operation==='inpaint'){if(!input.mask)throw new Error('请先圈选需要修改的区域。');validateMask(original,Buffer.from(input.mask));}
    this.imageAsset(source.id);
    if(this.workspace.tasks.some(t=>t.kind==='image'&&isBusy(t)))throw new Error('图片窗口已有任务，请等待完成。');
    const task:Task={id:randomUUID(),requestId:input.requestId,kind:'image',state:'preparing',createdAt:Date.now(),updatedAt:Date.now(),prompt,effectivePrompt:input.operation==='inpaint'?`仅修改遮罩的透明区域，尽量保留其余画面。修改要求：${prompt}`:prompt,assetIds:[],editImageId:source.id,mode:'first_frame',discussion:false,settings:{...this.workspace.settings,optimize:false},previewAtSubmit:this.workspace.selectedImageId,outputAssetIds:[],imageEdit:{sourceAssetId:source.id,operation:input.operation}};
    if(input.operation==='inpaint'){task.imageEdit!.maskFile=`${task.id}-mask.png`;writeFileSync(join(this.assets.directory,task.imageEdit!.maskFile!),Buffer.from(input.mask!));}
    this.workspace.tasks.push(task);this.workspace.messages.push({id:randomUUID(),kind:'image',role:'user',text:input.operation==='remove_background'?'去除图片背景':prompt,assetIds:[source.id],taskId:task.id,createdAt:Date.now()});this.changed();void this.run(task);return structuredClone(task);
  });}
  assertPoseWorkbench(){if(this.workspace.workbenchType!=='video-frames')throw new Error('骨骼功能仅用于视频与动画帧工作台。');}
  setPoseSource(assetId:string){this.assertPoseWorkbench();this.imageAsset(assetId);if(this.workspace.poseWorkspace?.analysis?.status==='analyzing')throw new Error('骨骼解析正在进行，请等待完成。');const state=this.workspace.poseWorkspace;if(state?.sourceAssetId!==assetId)this.workspace.poseWorkspace={sourceAssetId:assetId};this.workspace.selectedImageId=assetId;this.changed();}
  async analyzePose(assetId:string):Promise<PoseAnalysis>{return this.localOperation(async()=>{this.assertPoseWorkbench();this.imageAsset(assetId);if(this.workspace.poseWorkspace?.sourceAssetId!==assetId)throw new Error('请先选择骨骼源图片。');if(this.workspace.poseWorkspace.analysis?.status==='analyzing')throw new Error('骨骼解析正在进行，请勿重复提交。');const analysis:PoseAnalysis={assetId,requestId:randomUUID(),status:'analyzing',model:this.workspace.settings.openaiModel,createdAt:Date.now(),joints:[]};this.workspace.poseWorkspace.analysis=analysis;this.changed();try{const key=this.key('openai'),settings={...this.workspace.settings};const result=await requestPose(settings,key,await this.imageData(assetId));Object.assign(analysis,result,{status:'succeeded',originalJoints:structuredClone(result.joints)});this.changed();return structuredClone(analysis);}catch(e){analysis.status='failed';analysis.error=this.error(e);this.changed();throw e;}});}
  frameState(){if(!this.workspace.frameWorkspace)this.workspace.frameWorkspace=defaultFrameWorkspace();return this.workspace.frameWorkspace;}
  saveFrameOptions(input:{mode:'normal'|'split';frameCount:number}){if(!['normal','split'].includes(input.mode))throw new Error('工作模式不支持。');validateFrameCount(input.frameCount);Object.assign(this.frameState(),input);this.changed();}
  async splitVideo(input:{assetId:string;count:number;requestId:string}):Promise<FrameSequence>{return this.localOperation(async()=>{
    validateFrameCount(input.count);const state=this.frameState();const duplicate=state.sequences.find(s=>s.requestId===input.requestId);if(duplicate)return structuredClone(duplicate);
    if(state.sequences.some(s=>s.status==='extracting'))throw new Error('正在拆帧，请等待当前视频处理完成。');
    const video=this.workspace.assets.find(a=>a.id===input.assetId&&a.type==='video');if(!video)throw new Error('请先上传或选择视频。');
    const sequence:FrameSequence={id:randomUUID(),requestId:input.requestId,videoId:video.id,count:input.count,status:'extracting',createdAt:Date.now(),frames:[]};state.sequences.push(sequence);state.selectedSequenceId=sequence.id;state.selectedFrameIndex=0;this.changed();
    try{const frames=await this.assets.extractFrames(video,input.count,sequence.id);this.workspace.assets.push(...frames);sequence.frames=frames.map((a,index)=>({index,time:a.frame!.time,assetId:a.id,originalAssetId:a.id,versions:[a.id]}));sequence.status='succeeded';
      if(state.selectedSequenceId===sequence.id){state.selectedFrameIndex=0;this.workspace.selectedImageId=frames[0].id;}
      this.workspace.messages.push({id:randomUUID(),kind:'video',role:'assistant',text:`${video.name} 已拆为 ${frames.length} 个动画帧，可点击 Timeline 预览或修改。`,createdAt:Date.now(),assetIds:[video.id]});this.changed();return structuredClone(sequence);
    }catch(e){sequence.status='failed';sequence.error=`拆帧失败：${this.error(e)}`;this.changed();throw e;}
  });}
  selectFrame(sequenceId:string,index:number){const state=this.frameState(),sequence=state.sequences.find(s=>s.id===sequenceId&&s.status==='succeeded'),frame=sequence?.frames.find(f=>f.index===index);if(sequence&&!sequence.frames.length&&index===-1){state.selectedSequenceId=sequenceId;state.selectedFrameIndex=undefined;this.workspace.selectedImageId=undefined;this.changed();return;}if(!frame||!Number.isInteger(index)||!this.workspace.assets.some(a=>a.id===frame.assetId))throw new Error('此动画帧不存在。');state.selectedSequenceId=sequenceId;state.selectedFrameIndex=index;this.workspace.selectedImageId=frame.assetId;this.changed();}
  restoreFrame(sequenceId:string,index:number){const sequence=this.frameState().sequences.find(s=>s.id===sequenceId),frame=sequence?.frames.find(f=>f.index===index);if(!frame||!this.workspace.assets.some(a=>a.id===frame.originalAssetId))throw new Error('原始帧不存在。');frame.assetId=frame.originalAssetId;this.selectFrame(sequenceId,index);}
  deleteFrames(sequenceId:string,indices:number[]){
    const state=this.frameState(),sequence=state.sequences.find(s=>s.id===sequenceId&&s.status==='succeeded');
    if(!sequence||!Array.isArray(indices)||!indices.length||indices.some(index=>!Number.isInteger(index)||!sequence.frames.some(f=>f.index===index)))throw new Error('请选择此序列中存在的动画帧。');
    const removed=new Set(indices),position=sequence.frames.findIndex(f=>f.index===state.selectedFrameIndex);
    sequence.frames=sequence.frames.filter(f=>!removed.has(f.index));
    if(state.selectedSequenceId===sequenceId&&removed.has(state.selectedFrameIndex??0)){
      const next=sequence.frames[Math.min(Math.max(0,position),sequence.frames.length-1)];
      state.selectedFrameIndex=next?.index;this.workspace.selectedImageId=next?.assetId;
    }
    this.changed();
  }
  updateFrameVersion(source:Asset,result:Asset){if(!source.frame)return;result.frame={...source.frame};const frame=this.frameState().sequences.find(s=>s.id===source.frame!.sequenceId)?.frames.find(f=>f.index===source.frame!.index);if(!frame)return;frame.assetId=result.id;frame.versions.push(result.id);}
  async generate(input:GenerateInput){this.assertAI();
    this.assertKind(input.kind);this.assertDraft(input.draft);
    const duplicate=this.workspace.tasks.find(t=>t.requestId===input.requestId);if(duplicate)return structuredClone(duplicate);
    if(this.workspace.tasks.some(t=>t.kind===input.kind&&isBusy(t)))throw new Error('这个窗口已有生成任务，请等待完成。');
    const d=structuredClone(input.draft);if(!d.prompt.trim())throw new Error('请先输入 prompt。');
    const task:Task={id:randomUUID(),requestId:input.requestId,kind:input.kind,state:'preparing',createdAt:Date.now(),updatedAt:Date.now(),prompt:d.prompt.trim(),assetIds:d.attachmentIds,baseImageId:d.baseImageId,lastImageId:d.lastImageId,autoFrameCount:input.kind==='video'&&this.workspace.workbenchType==='video-frames'?this.frameState().frameCount:undefined,editImageId:d.editImageId,mode:d.mode,discussion:d.discussion,settings:{...this.workspace.settings},previewAtSubmit:input.kind==='image'?this.workspace.selectedImageId:this.workspace.selectedVideoId,outputAssetIds:[]};
    const assets=this.taskAssets(task);for(const a of assets)if(a.warning)throw new Error(`${a.name}：${a.warning}`);
    if(!task.discussion){
      if(task.kind==='video')provider.validateVideo(task,this.videoAssets(task));
      if(task.kind==='image'&&assets.filter(a=>a.type==='image').length>8)throw new Error('首版最多使用 8 张图片参考。');
    }
    {
      if(!task.discussion)this.key(task.kind==='image'?'openai':'minimax');
      if(task.discussion||task.settings.optimize||assets.some(a=>a.type==='video')&&task.kind==='image')this.key(task.settings.chatProvider);
    }
    this.workspace.tasks.push(task);this.workspace.messages.push({id:randomUUID(),kind:task.kind,role:'user',text:task.prompt,assetIds:assets.map(a=>a.id),createdAt:Date.now(),taskId:task.id});this.changed();
    void this.run(task);return structuredClone(task);
  }
  taskAssets(t:Task){const ids=[...t.assetIds,t.kind==='image'?t.editImageId:t.baseImageId,t.kind==='video'?t.lastImageId:undefined].filter(Boolean);return [...new Set(ids)].map(id=>{const a=this.workspace.assets.find(a=>a.id===id);if(!a)throw new Error('素材不存在。');return a;});}
  videoAssets(t:Task){const list=this.taskAssets(t);if(t.mode==='first_frame')return list.filter(a=>a.type==='document'||a.id===t.baseImageId||a.type==='video'||a.type==='image');return list;}
  update(t:Task,patch:Partial<Task>){Object.assign(t,patch,{updatedAt:Date.now()});this.changed();}
  async run(t:Task){
    let phase='准备素材';
    try{
      const list=this.taskAssets(t);const docs=list.filter(a=>a.type==='document').map(a=>`\n文档 ${a.name}：\n${a.text||''}`).join('');
      let prompt=(t.imageEdit?t.effectivePrompt||t.prompt:t.prompt)+docs;
      if(t.discussion||t.settings.optimize||t.kind==='image'&&list.some(a=>a.type==='video')){
        const images:string[]=[];
        for(const a of list){if(a.type==='image')images.push(this.assets.dataUrl(a));else if(a.type==='video')for(let i=0;i<(a.frameUrls?.length||0);i++)images.push(`data:image/jpeg;base64,${(await import('node:fs')).readFileSync(this.assets.framePath(a.id,i)).toString('base64')}`);}
        if(images.length>12)throw new Error('分析素材过多，首版最多分析 12 张图片或关键帧。');
        const history=this.workspace.messages.filter(m=>m.kind===t.kind&&m.taskId!==t.id&&!m.assetIds?.length).map(m=>({role:m.role,text:m.text}));
        phase=t.settings.chatProvider==='openai'?'OpenAI 提示词处理':'Claude 提示词处理';
        prompt=await provider.chat(t.settings,this.key(t.settings.chatProvider),prompt,images,history,t.discussion);
        if(t.discussion){this.finishText(t,prompt);return;}
      }
      this.update(t,{effectivePrompt:prompt});
      phase='准备素材';
      const media=new Map<string,string>();
      if(t.kind==='video')for(const a of this.videoAssets(t))if(a.type!=='document')media.set(a.id,await this.assets.h3DataUrl(a));
      this.update(t,{state:'submitting'});
      if(t.kind==='image'){
        phase='OpenAI 图片生成';
        let edit:{source:Buffer;mask?:Buffer}|undefined;
        if(t.imageEdit)edit={source:await this.assets.normalizedPNG(this.imageAsset(t.imageEdit.sourceAssetId)),mask:t.imageEdit.maskFile?readFileSync(join(this.assets.directory,t.imageEdit.maskFile)):undefined};
        let bytes:Buffer=await provider.generateImage(t,list,a=>this.assets.bytes(a),this.key('openai'),edit);
        if(edit&&t.imageEdit){const size=readPNG(edit.source);bytes=await this.assets.resizePNG(bytes,size.width,size.height,t.id);if(edit.mask)bytes=compositeSelection(edit.source,bytes,edit.mask);else if(t.imageEdit.operation==='remove_background'&&!hasTransparency(bytes))throw new Error('API 返回的图片没有透明背景，请检查模型能力或调整要求后重试。');}
        this.update(t,{state:'saving'});const a=await this.assets.import('生成图片.png',bytes,t.id);if(t.imageEdit){a.sourceAssetId=t.imageEdit.sourceAssetId;a.imageAction=t.imageEdit.operation;}this.finishAsset(t,a);
      }else{
        phase=`MiniMax ${minimaxAPI(t.settings.minimaxRegion).label}视频提交`;
        const remoteTaskId=await provider.createVideo(t,this.videoAssets(t),a=>media.get(a.id)!,this.key('minimax'));
        this.update(t,{remoteTaskId,state:'queued'});this.schedule(t,1000);
      }
    }catch(e){const unknown=e instanceof provider.ProviderError&&e.uncertain&&t.state==='submitting';const note=unknown?'提交结果待核实，请先查看供应商任务记录，不要重复生成。':t.kind==='video'&&t.state==='preparing'&&!t.discussion?'视频尚未提交到 MiniMax。':'';this.update(t,{state:unknown?'submission_unknown':'failed',error:`${phase}失败。${note}\n${this.error(e)}`});}
  }
  finishText(t:Task,text:string){this.workspace.messages.push({id:randomUUID(),kind:t.kind,role:'assistant',text,taskId:t.id,createdAt:Date.now()});this.update(t,{state:'succeeded'});}
  finishAsset(t:Task,a:Asset){if(t.imageEdit){const source=this.workspace.assets.find(a=>a.id===t.imageEdit!.sourceAssetId);if(source)this.updateFrameVersion(source,a);}this.workspace.assets.push(a);if(t.kind==='image'&&this.workspace.selectedImageId===t.previewAtSubmit)this.workspace.selectedImageId=a.id;else if(t.kind==='video'&&this.workspace.selectedVideoId===t.previewAtSubmit)this.workspace.selectedVideoId=a.id;t.outputAssetIds=[a.id];this.finishText(t,'生成完成，素材已保存到本地。');}
  schedule(t:Task,ms=5000){if(this.closed)return;const prev=this.timers.get(t.id);if(prev)clearTimeout(prev);this.timers.set(t.id,setTimeout(()=>{this.timers.delete(t.id);void this.poll(t);},ms));}
  async poll(t:Task){
    if(this.closed||this.polling.has(t.id))return;this.polling.add(t.id);
    try{
      if(Date.now()-t.createdAt>7*86400000)throw new Error('任务超过 MiniMax 的 7 天查询范围，无法保证恢复。');
      const result=await provider.queryVideo(t.remoteTaskId!,this.key('minimax'),t.settings.minimaxRegion);
      if(!result)throw new Error('供应商未返回任务数据。');
      if(result.status==='succeeded'){
        if(!result.content?.url)throw new Error('供应商未返回视频下载地址。');this.update(t,{state:'saving',resultUrl:result.content.url,pollError:undefined});await this.saveVideo(t);
      }else if(result.status==='failed'||result.status==='cancelled')this.update(t,{state:result.status,error:result.error?.message||'远程任务已结束。',pollError:undefined});
      else if(['queued','running'].includes(result.status)){this.update(t,{state:result.status,pollError:undefined});this.schedule(t);}
      else throw new Error('供应商返回未知任务状态。');
    }catch(e){this.update(t,{pollError:this.error(e)});if(Date.now()-t.createdAt<7*86400000)this.schedule(t,20000);else this.update(t,{state:'failed',error:this.error(e)});}
    finally{this.polling.delete(t.id);}
  }
  async saveVideo(t:Task){if(this.saving.has(t.id))return;this.saving.add(t.id);try{
    const u=new URL(t.resultUrl!);if(u.protocol!=='https:')throw new Error('视频下载地址必须使用 HTTPS。');
    const response=await fetchHTTP(u,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`下载失败 (${response.status})`);
    const limit=200*1024*1024;const reader=response.body?.getReader();if(!reader)throw new Error('下载没有内容。');let total=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new Error('视频结果超过 200 MB。');}chunks.push(value);}
    const b=Buffer.concat(chunks);const a=await this.assets.import('生成视频.mp4',b,t.id);if(a.warning)throw new Error(a.warning);this.finishAsset(t,a);if(t.autoFrameCount){try{await this.splitVideo({assetId:a.id,count:t.autoFrameCount,requestId:'auto-'+t.id});}catch{/* The video remains saved; frame extraction can be retried locally. */}}
  }catch(e){this.update(t,{state:'save_failed',error:this.error(e)});}finally{this.saving.delete(t.id);}}
  async retryTask(id:string){this.assertAI();const t=this.workspace.tasks.find(t=>t.id===id);if(!t)throw new Error('任务不存在。');if(t.state==='save_failed'&&t.resultUrl){this.update(t,{state:'saving',error:undefined});await this.saveVideo(t);}else if(t.remoteTaskId&&['queued','running','saving'].includes(t.state)){this.schedule(t,0);}else throw new Error('此任务不能安全地自动重试；请查看错误后主动重新发送。');}
  resume(){if(this.workspace.workbenchType==='motion-editor')return;for(const t of this.workspace.tasks){if(!isBusy(t))continue;if(t.remoteTaskId){this.update(t,{state:'queued'});this.schedule(t,1000);}else this.update(t,{state:t.state==='submitting'?'submission_unknown':'failed',error:'应用在任务期间退出。未自动重新提交，请核实生成结果。'});}}
  error(e:unknown){let m=e instanceof Error?e.message:'发生未知错误。';for(const p of ['openai','anthropic','minimax'] as Provider[]){const k=this.vault.get(p);if(k)m=m.split(k).join('[已隐藏]');}return m.slice(0,1500);}
  close(){this.closed=true;this.modelVideo.close();for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
}
