import type {APIBalance} from './api-balance';
import {defaultMotionBlend,type MotionBlendTree} from './motion-blend';
import type {MotionTimelineItem} from './motion-timeline';
import type {TerminalWorkspace,TerminalPane,TerminalEvent,TerminalView} from './terminal';
import type {ModelVideoInput} from './model-video';
import type {PoseWorkspace,PoseAnalysis,MotionWorkspace,MotionExtractInput,MotionExtraction,MotionFrame,MotionClip,MotionPart,PoseJoint,SavedPose} from './pose';
export type Provider = 'openai' | 'anthropic' | 'minimax';
export type Kind = 'image' | 'video';
export type WorkbenchType = 'image-video'|'video-frames'|'motion-editor'|'terminal';
export const workbenchTypes=[{id:'image-video' as WorkbenchType,name:'图片与视频创作',description:'从图片构思、生成与修改，到 MiniMax 视频创作。',features:['图片生成与编辑','图片转视频','素材上传与预览']},{id:'motion-editor' as WorkbenchType,name:'动作编辑器',description:'将 FBX 动作应用到内置基础人形，拖入时间轴混合多个动作，并导出相机视频。无需 API。',features:['Y Bot 动作映射','时间轴与动作混合','相机视频导出']},{id:'terminal' as WorkbenchType,name:'终端',description:'在 Worktree 中使用 macOS zsh，拆分独立终端，或以聊天视图查看命令与输出。',features:['原生 zsh 会话','向右拆分终端','Terminal / Chat View']}];
export interface WorktreeInfo {id:string;name:string;createdAt:number;projectFolder?:string}
export interface WorkbenchInfo {storage?:'app';id:string;worktreeId:string;type:WorkbenchType;name:string;createdAt:number;lastOpenedAt:number;isOpen?:boolean}
export interface WorkbenchCatalog {types:typeof workbenchTypes;worktrees:WorktreeInfo[];workbenches:WorkbenchInfo[];projectsDirectory?:string}
export type MiniMaxRegion = 'cn'|'global';
export const minimaxAPIs={cn:{label:'中国区',baseURL:'https://api.minimax.cn'},global:{label:'海外区',baseURL:'https://api.minimax.io'}} as const;
export function minimaxAPI(region:MiniMaxRegion='global'){if(!Object.hasOwn(minimaxAPIs,region))throw new Error('MiniMax API 地区不支持。');return minimaxAPIs[region];}
export type TaskState = 'preparing'|'submitting'|'submission_unknown'|'queued'|'running'|'saving'|'save_failed'|'succeeded'|'failed'|'cancelled';
export const reasoningEfforts=['low','medium','high','xhigh','max'] as const;
export type ReasoningEffort=typeof reasoningEfforts[number];
export const reasoningModes=['standard','pro'] as const;
export type ReasoningMode=typeof reasoningModes[number];
export const supportsSolReasoning=(model:string)=>/^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
export interface Settings {
  openaiReasoningEffort:ReasoningEffort; openaiReasoningMode:ReasoningMode;
  openaiModel: string; imageModel: string; claudeModel: string; videoModel: 'MiniMax-H3'|'MiniMax-H3-Max';
  chatProvider: 'openai'|'anthropic'; optimize: boolean; imageSize: string; imageQuality: string;
  videoDuration: number; videoResolution: string; minimaxRegion:MiniMaxRegion;
}
export const defaults: Settings = {openaiModel:'gpt-6.1-sol',openaiReasoningEffort:'medium',openaiReasoningMode:'standard',imageModel:'gpt-image-2.5-sunburst',claudeModel:'claude-sonnet-4-5',videoModel:'MiniMax-H3',chatProvider:'openai',optimize:false,imageSize:'1024x1024',imageQuality:'medium',videoDuration:5,videoResolution:'768P',minimaxRegion:'cn'};
export interface Asset {projectFile?:{path:string;size:number;modifiedAt:number};motionBlend?:MotionBlendTree;motionTimeline?:MotionTimelineItem[];id:string;name:string;type:'image'|'video'|'document'|'model';mime:string;size:number;url:string;createdAt:number;sourceTaskId?:string;sourceAssetId?:string;frame?:{videoId:string;sequenceId:string;index:number;time:number};imageAction?:'crop'|'edit'|'inpaint'|'remove_background';width?:number;height?:number;duration?:number;fps?:number;videoCodec?:string;audioCodec?:string;frameUrls?:string[];text?:string;warning?:string}
export interface Draft {prompt:string;attachmentIds:string[];mode:'first_frame'|'reference'|'first_last'|'text';lastImageId?:string;baseImageId?:string;editImageId?:string;discussion:boolean}
export interface Message {id:string;kind:Kind;role:'user'|'assistant';text:string;createdAt:number;taskId?:string;assetIds?:string[]}
export interface Task {id:string;requestId:string;kind:Kind;state:TaskState;createdAt:number;updatedAt:number;prompt:string;effectivePrompt?:string;assetIds:string[];baseImageId?:string;editImageId?:string;mode:Draft['mode'];lastImageId?:string;autoFrameCount?:number;discussion:boolean;settings:Settings;previewAtSubmit?:string;remoteTaskId?:string;resultUrl?:string;outputAssetIds:string[];error?:string;pollError?:string;legacySample?:boolean;imageEdit?:{sourceAssetId:string;operation:'edit'|'inpaint'|'remove_background';maskFile?:string}}
export interface AnimationFrame {index:number;time:number;assetId:string;originalAssetId:string;versions:string[]}
export interface FrameSequence {id:string;requestId:string;videoId:string;count:number;status:'extracting'|'succeeded'|'failed';createdAt:number;frames:AnimationFrame[];error?:string}
export interface FrameWorkspace {mode:'normal'|'split';frameCount:number;sequences:FrameSequence[];selectedSequenceId?:string;selectedFrameIndex?:number}
export const defaultFrameWorkspace=():FrameWorkspace=>({mode:'normal',frameCount:20,sequences:[]});
export function validateFrameCount(count:number){if(!Number.isInteger(count)||count<1||count>240)throw new Error('拆帧数量须为 1–240 之间的整数。');}
export interface ModelEditorState {blendTree?:MotionBlendTree;timelineItems:MotionTimelineItem[];timelineEnabled:boolean;assetId?:string;clipIndex:number;speed:number;loop:boolean;showSkeleton:boolean;showGrid:boolean;ignoreTranslation:boolean}
export const defaultModelEditor=():ModelEditorState=>({timelineItems:[],timelineEnabled:false,clipIndex:0,speed:1,loop:true,showSkeleton:false,showGrid:true,ignoreTranslation:false});
export interface Workspace {terminalWorkspace?:TerminalWorkspace;modelEditor?:ModelEditorState;version:1;workbenchType?:WorkbenchType;frameWorkspace?:FrameWorkspace;poseWorkspace?:PoseWorkspace;motionWorkspace?:MotionWorkspace;imageModelDefaultVersion?:1;chatModelDefaultVersion?:1;settings:Settings;assets:Asset[];messages:Message[];tasks:Task[];drafts:Record<Kind,Draft>;selectedImageId?:string;selectedVideoId?:string}
export type CredentialKeys=Partial<Record<Provider,string>>&{minimaxCredits?:string};
export interface Boot {minimaxCreditsConfigured?:boolean;workspace:Workspace;credentials:Record<Provider,boolean>;secureStorage:boolean;dataDirectory:string;desktop:boolean;workbench?:WorkbenchInfo;worktree?:WorktreeInfo}
export interface ImportFile {name:string;bytes:ArrayBuffer}
export interface GenerateInput {kind:Kind;requestId:string;draft:Draft}
export type ImageTool='edit'|'brush'|'crop'|'remove_background';
export interface ImageEditInput {assetId:string;requestId:string;operation:'edit'|'inpaint'|'remove_background';prompt:string;mask?:ArrayBuffer}
export interface CropInput {assetId:string;x:number;y:number;width:number;height:number}
export interface WorkspaceFile {name:string;path:string;kind:'directory'|'file'|'link';children?:WorkspaceFile[];size?:number;assetId?:string;assetType?:Asset['type'];displayName?:string;unreadable?:boolean}
export interface WorkspaceFileTree {files:WorkspaceFile[];truncated:boolean}
export interface WorkspaceFilePreview {size:number;binary:boolean;text?:string;truncated:boolean}
export interface Api {
  terminalSessions():Promise<TerminalPane[]>;createTerminal(afterId?:string):Promise<TerminalPane>;closeTerminal(id:string):Promise<void>;writeTerminal(id:string,data:string):Promise<void>;submitTerminal(id:string,text:string):Promise<void>;cancelCodex(id:string):Promise<void>;resizeTerminal(id:string,cols:number,rows:number):Promise<void>;setTerminalView(id:string,view:TerminalView):Promise<void>;onTerminalEvent(fn:(event:TerminalEvent)=>void):()=>void;

  beginModelVideo(input:ModelVideoInput):Promise<{id:string;count:number}>;appendModelVideoFrame(id:string,index:number,bytes:ArrayBuffer):Promise<void>;finishModelVideo(id:string):Promise<Asset>;cancelModelVideo(id:string):Promise<void>;
  baseModelData():Promise<ArrayBuffer>;modelData(id:string):Promise<ArrayBuffer>;saveModelEditor(state:ModelEditorState):Promise<void>;saveModelBlend(input:{tree:MotionBlendTree;name:string;bytes:ArrayBuffer}):Promise<Asset>;saveModelSegment(input:{item:MotionTimelineItem;name:string;clipName:string}):Promise<Asset>;renameModel(id:string,name:string):Promise<void>;deleteModel(id:string):Promise<void>;
  forWorkbench(id:string):Api;currentWorkbench():Promise<string|undefined>;onWorkbenchSelected(fn:(id:string|undefined)=>void):()=>void;
  createWorkspaceEntry(input:{parent:string;name:string;kind:'file'|'directory'}):Promise<string>;moveWorkspaceEntry(input:{path:string;parent:string;name?:string}):Promise<string>;trashWorkspaceEntry(path:string):Promise<void>;workspaceFiles():Promise<WorkspaceFileTree>;readWorkspaceFile(path:string):Promise<WorkspaceFilePreview>;revealWorkspaceFile(path:string):Promise<void>;useWorktreeFile(path:string,worktreeId?:string):Promise<Asset>;onWorktreeFilesChanged(fn:()=>void):()=>void;
  catalog():Promise<WorkbenchCatalog>;createWorktree(input:{name?:string}):Promise<WorktreeInfo>;createWorkbench(input:{type:WorkbenchType;name?:string;worktreeId?:string}):Promise<WorkbenchInfo>;openWorkbench(id:string):Promise<void>;deleteWorkbench(id:string):Promise<void>;deleteWorktree(id:string,force?:boolean):Promise<void>;showWorkbenchLauncher():Promise<void>;subscribeCatalog(fn:(catalog:WorkbenchCatalog)=>void):()=>void;
  boot():Promise<Boot>;saveSettings(settings:Settings,keys:CredentialKeys):Promise<Boot>;
  openMiniMaxCredits():Promise<void>;onBalancesChanged(fn:()=>void):()=>void;
  apiBalances(force?:boolean):Promise<APIBalance[]>;openAPIBilling(provider:Provider):Promise<void>;testConnection(provider:Provider):Promise<string>;saveDraft(kind:Kind,draft:Draft):Promise<void>;
  importFiles(files:ImportFile[]):Promise<Asset[]>;pickFiles():Promise<Asset[]>;
  onEditorTool(fn:(tool:ImageTool)=>void):()=>void;openImageEditor(assetId:string,tool:ImageTool):Promise<void>;imageData(assetId:string):Promise<string>;editImage(input:ImageEditInput):Promise<Task>;cropImage(input:CropInput):Promise<Asset>;
  editPose(assetId:string,joints:PoseJoint[]):Promise<void>;savePoseSnapshot(name:string):Promise<SavedPose>;loadPoseSnapshot(id:string):Promise<void>;resetPose():Promise<void>;
  beginMotionExtraction(input:MotionExtractInput):Promise<{job:MotionExtraction;bytes:ArrayBuffer}>;appendMotionFrames(jobId:string,frames:MotionFrame[]):Promise<void>;finishMotionExtraction(jobId:string):Promise<MotionClip>;failMotionExtraction(jobId:string,error:string):Promise<void>;cancelMotionExtraction(jobId:string):Promise<void>;
  selectMotionClip(id:string):Promise<void>;editMotionFrame(id:string,index:number,joints:PoseJoint[]):Promise<void>;resetMotionClip(id:string):Promise<void>;cleanMotionClip(id:string,options:{gap:number;window:number}):Promise<void>;saveMotionClip(id:string,name:string,tags:string[]):Promise<void>;composeMotionClips(parts:MotionPart[],transition:number):Promise<MotionClip>;retargetMotionClip(id:string):Promise<MotionClip>;renderMotionPreview(id:string):Promise<Asset>;exportMotionClip(id:string):Promise<string|undefined>;
  setPoseSource(assetId:string):Promise<void>;analyzePose(assetId:string):Promise<PoseAnalysis>;
  exportFrames(sequenceId:string):Promise<string|undefined>;
  saveFrameOptions(input:{mode:'normal'|'split';frameCount:number}):Promise<void>;splitVideo(input:{assetId:string;count:number;requestId:string}):Promise<FrameSequence>;selectFrame(sequenceId:string,index:number):Promise<void>;restoreFrame(sequenceId:string,index:number):Promise<void>;deleteFrames(sequenceId:string,indices:number[]):Promise<void>;
  generate(input:GenerateInput):Promise<Task>;retryTask(id:string):Promise<void>;
  select(kind:Kind,id:string):Promise<void>;deleteGeneratedImage(id:string):Promise<Workspace>;
  exportAsset(id:string):Promise<string|undefined>;openDataDirectory():Promise<void>;
  subscribe(fn:(workspace:Workspace)=>void):()=>void;
}
export const isBusy=(t:Task)=>['preparing','submitting','queued','running','saving'].includes(t.state);
export const emptyWorkspace=():Workspace=>({version:1,imageModelDefaultVersion:1,chatModelDefaultVersion:1,settings:{...defaults},assets:[],messages:[],tasks:[],drafts:{image:{prompt:'',attachmentIds:[],mode:'first_frame',discussion:false},video:{prompt:'',attachmentIds:[],mode:'first_frame',discussion:false}}});

// Upgrade old defaults once; keep custom models and historical task snapshots intact.
export function upgradeWorkspaceDefaults(workspace:Workspace):boolean {
  let changed=false;
  const legacy=workspace as Workspace & {demo?:boolean};
  if('demo' in legacy){delete legacy.demo;changed=true;}
  for(const task of workspace.tasks){
    if(!task.settings.minimaxRegion){task.settings.minimaxRegion='global';changed=true;}
    const old=task as Task & {demo?:boolean};
    if(old.demo)old.legacySample=true;
    if('demo' in old){delete old.demo;changed=true;}
  }

  if(workspace.imageModelDefaultVersion!==1){
    if(workspace.settings.imageModel==='gpt-image-1.5')workspace.settings.imageModel=defaults.imageModel;
    workspace.imageModelDefaultVersion=1;changed=true;
  }
  if(workspace.chatModelDefaultVersion!==1){
    if(workspace.settings.openaiModel==='gpt-4.1')workspace.settings.openaiModel=defaults.openaiModel;
    workspace.chatModelDefaultVersion=1;changed=true;
  }
  if(!workspace.settings.openaiReasoningEffort){workspace.settings.openaiReasoningEffort=defaults.openaiReasoningEffort;changed=true;}
  if(!workspace.settings.openaiReasoningMode){workspace.settings.openaiReasoningMode=defaults.openaiReasoningMode;changed=true;}
  if(!workspace.settings.minimaxRegion){workspace.settings.minimaxRegion=defaults.minimaxRegion;changed=true;}
  return changed;
}
export function validateReasoningSettings(settings:Settings){
  if(!reasoningEfforts.includes(settings.openaiReasoningEffort)||!reasoningModes.includes(settings.openaiReasoningMode))throw new Error('推理参数不支持。');
}

export function deletableGeneratedImage(workspace:Workspace,id:string):Asset {
  const asset=workspace.assets.find(a=>a.id===id);
  if(!asset||asset.type!=='image'||!asset.sourceTaskId&&!asset.frame)throw new Error('只能删除已生成的图片。');
  if(workspace.tasks.some(t=>(isBusy(t)||t.state==='submission_unknown')&&(t.assetIds.includes(id)||t.baseImageId===id||t.lastImageId===id||t.editImageId===id)))throw new Error('此图片正在被生成任务使用，请等待任务结束或核实提交状态后再删除。');
  return asset;
}
export function removeGeneratedImage(workspace:Workspace,id:string){
  deletableGeneratedImage(workspace,id);
  workspace.assets=workspace.assets.filter(a=>a.id!==id);
  if(workspace.poseWorkspace?.sourceAssetId===id)workspace.poseWorkspace=undefined;
  if(workspace.selectedImageId===id)workspace.selectedImageId=workspace.assets.filter(a=>a.type==='image').at(-1)?.id;
  for(const draft of Object.values(workspace.drafts)){
    draft.attachmentIds=draft.attachmentIds.filter(value=>value!==id);
    if(draft.baseImageId===id)delete draft.baseImageId;
    if(draft.lastImageId===id)delete draft.lastImageId;
    if(draft.editImageId===id)delete draft.editImageId;
  }
  for(const sequence of workspace.frameWorkspace?.sequences||[])for(const frame of sequence.frames){frame.versions=frame.versions.filter(value=>value!==id);if(frame.assetId===id)frame.assetId=frame.versions.at(-1)||'';}
  for(const message of workspace.messages)if(message.assetIds)message.assetIds=message.assetIds.filter(value=>value!==id);
  for(const task of workspace.tasks){
    task.outputAssetIds=task.outputAssetIds.filter(value=>value!==id);
    // Keep input snapshots as provenance; completed tasks are never automatically resubmitted.
  }
}
