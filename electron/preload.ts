import {contextBridge,ipcRenderer} from 'electron';
import type {Api} from '../src/shared/types';
function createAPI(workbenchId?:string):Api{
  const scoped=(name:string,...args:any[])=>ipcRenderer.invoke(name,{workbenchId,args});
  return {baseModelData:()=>scoped('model:base'),beginModelVideo:input=>scoped('model-video:begin',input),appendModelVideoFrame:(id,index,bytes)=>scoped('model-video:frame',id,index,bytes),finishModelVideo:id=>scoped('model-video:finish',id),cancelModelVideo:id=>scoped('model-video:cancel',id),modelData:id=>scoped('model:data',id),saveModelEditor:state=>scoped('model:save',state),
    editPose:(id,j)=>scoped('pose:edit',id,j),resetPose:()=>scoped('pose:reset'),savePoseSnapshot:name=>scoped('pose:save',name),loadPoseSnapshot:id=>scoped('pose:load',id),
    beginMotionExtraction:input=>scoped('motion:begin',input),appendMotionFrames:(id,f)=>scoped('motion:append',id,f),finishMotionExtraction:id=>scoped('motion:finish',id),failMotionExtraction:(id,e)=>scoped('motion:fail',id,e),cancelMotionExtraction:id=>scoped('motion:cancel',id),selectMotionClip:id=>scoped('motion:select',id),editMotionFrame:(id,i,j)=>scoped('motion:edit',id,i,j),resetMotionClip:id=>scoped('motion:reset',id),cleanMotionClip:(id,o)=>scoped('motion:clean',id,o),saveMotionClip:(id,n,t)=>scoped('motion:save',id,n,t),composeMotionClips:(p,t)=>scoped('motion:compose',p,t),retargetMotionClip:id=>scoped('motion:retarget',id),renderMotionPreview:id=>scoped('motion:preview',id),exportMotionClip:id=>scoped('motion:export',id),

    setPoseSource:id=>scoped('pose:source',id),analyzePose:id=>scoped('pose:analyze',id),
    exportFrames:id=>scoped('frames:export',id),saveFrameOptions:input=>scoped('frames:options',input),splitVideo:input=>scoped('frames:split',input),selectFrame:(id,index)=>scoped('frames:select',id,index),restoreFrame:(id,index)=>scoped('frames:restore',id,index),deleteFrames:(id,indices)=>scoped('frames:delete',id,indices),
    createWorktree:input=>ipcRenderer.invoke('worktrees:create',input),useWorktreeFile:path=>scoped('worktree:file-use',path),onWorktreeFilesChanged:fn=>{const listener=()=>fn();ipcRenderer.on('worktree:files-changed',listener);return()=>ipcRenderer.removeListener('worktree:files-changed',listener);},
    workspaceFiles:()=>scoped('workspace:files'),readWorkspaceFile:path=>scoped('workspace:file-read',path),revealWorkspaceFile:path=>scoped('workspace:file-reveal',path),
    forWorkbench:id=>createAPI(id),currentWorkbench:()=>ipcRenderer.invoke('workbenches:current'),onWorkbenchSelected:fn=>{const listener=(_event:unknown,id:string|undefined)=>fn(id);ipcRenderer.on('workbench:selected',listener);return()=>ipcRenderer.removeListener('workbench:selected',listener);},
    catalog:()=>ipcRenderer.invoke('workbenches:list'),createWorkbench:input=>ipcRenderer.invoke('workbenches:create',input),openWorkbench:id=>ipcRenderer.invoke('workbenches:open',id),deleteWorkbench:id=>ipcRenderer.invoke('workbenches:delete',id),showWorkbenchLauncher:()=>ipcRenderer.invoke('workbenches:show'),subscribeCatalog:fn=>{const listener=(_event:unknown,catalog:any)=>fn(catalog);ipcRenderer.on('workbenches:changed',listener);return ()=>ipcRenderer.removeListener('workbenches:changed',listener);},
    onEditorTool:fn=>{const listener=(_event:unknown,tool:any)=>fn(tool);ipcRenderer.on('editor:tool',listener);return()=>ipcRenderer.removeListener('editor:tool',listener);},
    openImageEditor:(id,tool)=>scoped('editor:open',id,tool),imageData:id=>scoped('image:data',id),editImage:input=>scoped('image:edit',input),cropImage:input=>scoped('image:crop',input),
    boot:()=>scoped('boot'),saveSettings:(s,k)=>scoped('settings:save',s,k),testConnection:p=>scoped('settings:test',p),saveDraft:(k,d)=>scoped('draft:save',k,d),
    importFiles:f=>scoped('files:import',f),pickFiles:()=>scoped('files:pick'),generate:i=>scoped('generate',i),retryTask:id=>scoped('task:retry',id),
    select:(k,id)=>scoped('asset:select',k,id),deleteGeneratedImage:id=>scoped('asset:delete-image',id),exportAsset:id=>scoped('asset:export',id),openDataDirectory:()=>scoped('data:open'),
    subscribe:fn=>{const listener=(_event:unknown,w:any,id:string)=>{if(!workbenchId||id===workbenchId)fn(w);};ipcRenderer.on('workspace:changed',listener);return()=>ipcRenderer.removeListener('workspace:changed',listener);}
  };
}
contextBridge.exposeInMainWorld('toolkit',createAPI());
