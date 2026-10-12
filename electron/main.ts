import {createFrameArchive} from './frame-export';
import {listWorkspaceFiles,readWorkspaceFile,workspaceFilePath} from './workspace-files';
import {app,BrowserWindow,dialog,ipcMain,protocol,safeStorage,shell,net,session} from 'electron';
import {setNetworkFetch} from './network';
import {readFileSync,writeFileSync,existsSync,renameSync,copyFileSync,statSync,createReadStream,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {parseRange} from './range';
import {Workbenches} from './workbenches';
import type {Service,Vault} from './service';
import {selfTest} from './self-test';
import type {Provider,Workspace,ImageTool,WorkbenchInfo} from '../src/shared/types';
protocol.registerSchemesAsPrivileged([{scheme:'asset',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
interface WindowContext {window:BrowserWindow;role:'main'|'editor';workbenchId?:string}
let launcher:BrowserWindow|undefined;let manager:Workbenches;
const editors=new Map<string,BrowserWindow>(),contexts=new Map<number,WindowContext>(),assetSessions=new Set<string>();
if(process.env.TOOLKIT_DATA_DIR)app.setPath('userData',process.env.TOOLKIT_DATA_DIR);
class SecureVault implements Vault {
  secure=safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');
  memory:Partial<Record<Provider,string>>={};encrypted:Partial<Record<Provider,string>>={};file=join(app.getPath('userData'),'credentials.enc.json');
  constructor(){if(existsSync(this.file)){try{this.encrypted=JSON.parse(readFileSync(this.file,'utf8'));}catch{/* keep corrupted vault untouched until user replaces credentials */}}}
  get(p:Provider){if(this.memory[p])return this.memory[p];if(this.secure&&this.encrypted[p]){try{return safeStorage.decryptString(Buffer.from(this.encrypted[p]!,'base64'));}catch{return undefined;}}return undefined;}
  set(p:Provider,value:string){
    if(!['openai','anthropic','minimax'].includes(p))throw new Error('供应商不存在。');
    if(this.secure){if(value)this.encrypted[p]=safeStorage.encryptString(value).toString('base64');else delete this.encrypted[p];writeFileSync(this.file+'.tmp',JSON.stringify(this.encrypted),{mode:0o600});renameSync(this.file+'.tmp',this.file);}else{if(value)this.memory[p]=value;else{delete this.memory[p];delete this.encrypted[p];if(existsSync(this.file))writeFileSync(this.file,JSON.stringify(this.encrypted),{mode:0o600});}}
  }
}
function loadView(owner:BrowserWindow,query:Record<string,string>){
  owner.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  owner.webContents.on('will-navigate',(event,url)=>{if(url!==owner.webContents.getURL())event.preventDefault();});
  if(process.env.TOOLKIT_DEV_URL){const url=new URL(process.env.TOOLKIT_DEV_URL);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);void owner.loadURL(url.toString());}else void owner.loadFile(join(__dirname,'../dist/index.html'),{query});
}
function register(owner:BrowserWindow,role:WindowContext['role'],workbenchId?:string){const contentsID=owner.webContents.id;contexts.set(contentsID,{window:owner,role,workbenchId});owner.on('closed',()=>contexts.delete(contentsID));}
function focus(owner:BrowserWindow){if(owner.isMinimized())owner.restore();owner.show();owner.focus();}
function worktreeBoot(id:string){const workbench=structuredClone(manager.info(id)),worktree=structuredClone(manager.treeInfo(workbench.worktreeId));return {workbench,worktree,dataDirectory:manager.treePath(worktree.id)};}
function changedCatalog(){if(launcher&&!launcher.isDestroyed())launcher.webContents.send('workbenches:changed',manager.catalog(new Set(launcher&&!launcher.isDestroyed()&&contexts.get(launcher.webContents.id)?.workbenchId?[contexts.get(launcher.webContents.id)!.workbenchId!]:[])));}
function changedWorkspace(id:string,w:Workspace){for(const context of contexts.values())if(context.workbenchId&&!context.window.isDestroyed()&&manager.info(context.workbenchId).worktreeId===manager.info(id).worktreeId)context.window.webContents.send('worktree:files-changed');for(const context of contexts.values())if(context.workbenchId===id&&!context.window.isDestroyed())context.window.webContents.send('workspace:changed',w,id);}
function showLauncher(){
  if(launcher&&!launcher.isDestroyed()){focus(launcher);return launcher;}
  launcher=new BrowserWindow({width:1540,height:1000,minWidth:1080,minHeight:740,title:'选择工作台 · AI Assets Toolkit',backgroundColor:'#171717',titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:16},webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const owner=launcher;register(owner,'main');registerMainAssets();loadView(owner,{view:'main'});owner.on('closed',()=>{launcher=undefined;});return owner;
}
function registerAssets(id:string){
  const partition=`persist:workbench-${id}`;const ses=session.fromPartition(partition);
  if(assetSessions.has(id))return partition;
  const service=manager.get(id);ses.protocol.handle('asset',request=>{try{return assetResponse(manager.get(id),request);}catch{return new Response('Not found',{status:404});}});assetSessions.add(id);return partition;
}
function assetResponse(service:Service,request:Request){
    const u=new URL(request.url);if(u.hostname!=='local')return new Response('Invalid asset',{status:404});const parts=u.pathname.split('/').filter(Boolean);const a=service.workspace.assets.find(a=>a.id===parts[0]);
    if(!a)return new Response('Not found',{status:404});let file=service.assets.path(a);
    if(parts.length>1){if(parts.length!==3||parts[1]!=='frame'||!['0','1','2'].includes(parts[2])||!a.frameUrls?.[Number(parts[2])])return new Response('Not found',{status:404});file=service.assets.framePath(a.id,Number(parts[2]));}
    if(!existsSync(file))return new Response('Not found',{status:404});
    const size=statSync(file).size;const range=parseRange(request.headers.get('range'),size);if(!range)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    const headers:Record<string,string>={'Content-Type':parts.length>1?'image/jpeg':a.mime,'Accept-Ranges':'bytes','Cache-Control':'no-store','Content-Length':String(range.end-range.start+1)};
    if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
    return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file,{start:range.start,end:range.end})) as ReadableStream,{status:range.partial?206:200,headers});

}
function selectWorkbench(id?:string){
  const owner=showLauncher();if(id)manager.info(id);
  contexts.set(owner.webContents.id,{window:owner,role:'main',workbenchId:id});
  if(id){manager.opened(id);owner.setTitle(`${manager.info(id).name} · AI Assets Toolkit`);}else owner.setTitle('选择工作台 · AI Assets Toolkit');
  owner.webContents.send('workbench:selected',id);changedCatalog();return owner;
}
function openWorkbench(id:string){return selectWorkbench(id);}
function registerMainAssets(){
  if(assetSessions.has('main'))return;
  session.defaultSession.protocol.handle('asset',request=>{
    const id=launcher&&!launcher.isDestroyed()?contexts.get(launcher.webContents.id)?.workbenchId:undefined;
    return id?assetResponse(manager.get(id),request):new Response('Not found',{status:404});
  });assetSessions.add('main');
}
function openEditor(workbenchId:string,assetId:string,tool:ImageTool){
  const asset=manager.get(workbenchId).imageAsset(assetId);if(!['edit','brush','crop','remove_background'].includes(tool))throw new Error('修改工具不支持。');
  const key=`${workbenchId}:${assetId}`;const existing=editors.get(key);if(existing&&!existing.isDestroyed()){focus(existing);existing.webContents.send('editor:tool',tool);return existing;}
  const editor=new BrowserWindow({width:1280,height:900,minWidth:960,minHeight:700,title:`修改图片 · ${asset.name}`,backgroundColor:'#171717',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:registerAssets(workbenchId)}});
  editors.set(key,editor);register(editor,'editor',workbenchId);
  editor.webContents.on('will-prevent-unload',event=>{const choice=dialog.showMessageBoxSync(editor,{type:'question',buttons:['继续编辑','关闭窗口'],defaultId:0,cancelId:0,message:'编辑窗口中有未提交的修改。',detail:'关闭会丢弃尚未提交的圈选和文字。已保存的图片和已提交的任务会保留。'});if(choice===1)event.preventDefault();});
  loadView(editor,{view:'image-editor',workbenchId,assetId,tool});editor.on('closed',()=>editors.delete(key));return editor;
}
async function packagedSelfTest(){
  try{
    const picker=launcher!;for(let i=0;i<300;i++){if(await picker.webContents.executeJavaScript("!!document.querySelector('.template-card')").catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
    if(!await picker.webContents.executeJavaScript("!!document.querySelector('.template-card')&&!document.querySelector('.launcher-recents,.launcher-name')"))throw new Error('模板 Gallery 未加载');
    if(process.env.TOOLKIT_SELF_TEST_OUTPUT){mkdirSync(process.env.TOOLKIT_SELF_TEST_OUTPUT,{recursive:true});writeFileSync(join(process.env.TOOLKIT_SELF_TEST_OUTPUT,'packaged-launcher.png'),(await picker.webContents.capturePage()).toPNG());}
    const entry=await picker.webContents.executeJavaScript("window.toolkit.createWorkbench({type:'image-video'})") as WorkbenchInfo;
    const other=await picker.webContents.executeJavaScript("window.toolkit.createWorkbench({type:'image-video',name:'打包检查 · 第二个工作台'})") as WorkbenchInfo;
    for(let i=0;i<200;i++){if(await picker.webContents.executeJavaScript(`document.querySelector('.app-shell[data-workbench-id="${other.id}"]')`).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
    await picker.webContents.executeJavaScript("window.toolkit.saveDraft('image',{prompt:'打包工作台的独立草稿',attachmentIds:[],mode:'first_frame',discussion:false})");
    if(manager.get(entry.id).workspace.drafts.image.prompt||manager.get(other.id).workspace.drafts.image.prompt!=='打包工作台的独立草稿'||entry.id===other.id||BrowserWindow.getAllWindows().length!==1)throw new Error('打包后单窗口工作台未隔离');
    await picker.webContents.executeJavaScript(`window.toolkit.openWorkbench(${JSON.stringify(entry.id)})`);
    await selfTest(picker,manager.get(entry.id),(assetId,tool)=>openEditor(entry.id,assetId,tool));
  }catch(e){console.error('Launcher smoke failed:',e);app.exit(1);}
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(launcher&&!launcher.isDestroyed())focus(launcher);else showLauncher();});
  void app.whenReady().then(()=>{
    setNetworkFetch((input,init)=>net.fetch(input instanceof URL?input.toString():input,{...init,credentials:'omit'}));
    manager=new Workbenches(app.getPath('userData'),new SecureVault(),changedWorkspace);
    const handle=(name:string,fn:(context:WindowContext,...args:any[])=>any)=>ipcMain.handle(name,async(event,...args)=>{
      const context=contexts.get(event.sender.id);if(!context||context.window.isDestroyed()||event.senderFrame!==context.window.webContents.mainFrame)throw new Error('无权访问。');
      try{return await fn(context,...args);}catch(e){throw new Error(context.workbenchId&&manager.entries.some(entry=>entry.id===context.workbenchId)&&!manager.deleting.has(context.workbenchId)?manager.get(context.workbenchId).error(e):e instanceof Error?e.message:'操作失败。');}
    });
    const scoped=(name:string,fn:(service:Service,context:WindowContext,...args:any[])=>any)=>handle(name,(context,input)=>{if(!input||!Array.isArray(input.args))throw new Error('请求格式不合法。');const id=input.workbenchId||context.workbenchId;if(!id)throw new Error('请先选择工作台。');if(context.role==='editor'&&id!==context.workbenchId)throw new Error('无权访问其他工作台。');return fn(manager.get(id),{...context,workbenchId:id},...input.args);});
    handle('workbenches:list',()=>manager.catalog(new Set(launcher&&!launcher.isDestroyed()&&contexts.get(launcher.webContents.id)?.workbenchId?[contexts.get(launcher.webContents.id)!.workbenchId!]:[])));
    handle('workbenches:create',(_context,input)=>{if(!input||typeof input!=='object')throw new Error('工作台参数不合法。');const entry=manager.create(input.type,input.name,input.worktreeId||(_context.workbenchId?manager.info(_context.workbenchId).worktreeId:undefined));openWorkbench(entry.id);return entry;});
    handle('worktrees:create',(_context,input)=>{const tree=manager.createWorktree(input?.name);changedCatalog();return tree;});
    handle('workbenches:delete',async(context,id:string)=>{
      if(context.role!=='main')throw new Error('请从工作台列表删除实例。');
      const entry=await manager.deleteWorkbench(id,path=>shell.trashItem(path));
      for(const [key,editor] of editors)if(contexts.get(editor.webContents.id)?.workbenchId===id){editor.destroy();editors.delete(key);}
      const active=launcher&&!launcher.isDestroyed()?contexts.get(launcher.webContents.id)?.workbenchId:undefined;
      if(active===id){const next=manager.entries.filter(e=>e.worktreeId===entry.worktreeId).sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt)[0]||manager.catalog().workbenches[0];selectWorkbench(next?.id);}else changedCatalog();
      for(const ctx of contexts.values())if(ctx.workbenchId&&!ctx.window.isDestroyed()&&manager.info(ctx.workbenchId).worktreeId===entry.worktreeId)ctx.window.webContents.send('worktree:files-changed');
    });
    handle('workbenches:open',(_context,id)=>{openWorkbench(id);});handle('workbenches:show',()=>{selectWorkbench();});handle('workbenches:current',context=>context.workbenchId);
    scoped('boot',(service,context)=>({...service.boot(),...worktreeBoot(context.workbenchId!)}));
    scoped('settings:save',(service,_context,s,k)=>{const boot=service.saveSettings(s,k);for(const [id,other] of manager.services)changedWorkspace(id,structuredClone(other.workspace));return {...boot,...worktreeBoot(_context.workbenchId!)};});
    scoped('settings:test',(service,_context,p)=>service.testConnection(p));
    scoped('model-video:begin',(s,_c,input)=>s.modelVideo.begin(input));scoped('model-video:frame',(s,_c,id,index,bytes)=>s.modelVideo.frame(id,index,bytes));scoped('model-video:finish',(s,_c,id)=>s.modelVideo.finish(id));scoped('model-video:cancel',(s,_c,id)=>s.modelVideo.cancel(id));
    scoped('model:base',s=>{if(s.workspace.workbenchType!=='motion-editor')throw new Error('请在动作编辑器中加载基础模型。');const bytes=readFileSync(join(__dirname,'assets/y-bot.fbx'));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;});
    scoped('model:data',(service,_context,id)=>service.modelData(id));scoped('model:save',(service,_context,state)=>service.saveModelEditor(state));
    scoped('draft:save',(service,_context,k,d)=>service.saveDraft(k,d));scoped('files:import',(service,_context,f)=>service.importFiles(f));
    scoped('files:pick',async(service,context)=>{const result=await dialog.showOpenDialog(context.window,{properties:['openFile','multiSelections'],filters:service.workspace.workbenchType==='motion-editor'?[{name:'FBX 模型与动作',extensions:['fbx']}]:[{name:'素材',extensions:['png','jpg','jpeg','webp','mp4','mov','txt','md','pdf']}]});if(result.canceled)return [];return service.importFiles(result.filePaths.map(p=>{if(statSync(p).size>50*1024*1024)throw new Error('上传文件须小于 50 MB。');const bytes=readFileSync(p);return {name:p.split(/[\\/]/).pop()!,bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer};}));});
    scoped('pose:edit',(s,_c,id,j)=>s.motions.editPose(id,j));scoped('pose:reset',s=>s.motions.resetPose());scoped('pose:save',(s,_c,name)=>s.motions.savePose(name));scoped('pose:load',(s,_c,id)=>s.motions.loadPose(id));
    scoped('motion:begin',(s,_c,input)=>s.motions.begin(input));scoped('motion:append',(s,_c,id,frames)=>s.motions.append(id,frames));scoped('motion:finish',(s,_c,id)=>s.motions.finish(id));scoped('motion:fail',(s,_c,id,error)=>s.motions.fail(id,error));scoped('motion:cancel',(s,_c,id)=>s.motions.fail(id,'用户取消提取。',true));scoped('motion:select',(s,_c,id)=>s.motions.select(id));scoped('motion:edit',(s,_c,id,index,joints)=>s.motions.edit(id,index,joints));scoped('motion:reset',(s,_c,id)=>s.motions.reset(id));scoped('motion:clean',(s,_c,id,options)=>s.motions.clean(id,options));scoped('motion:save',(s,_c,id,name,tags)=>s.motions.save(id,name,tags));scoped('motion:compose',(s,_c,parts,transition)=>s.motions.compose(parts,transition));scoped('motion:retarget',(s,_c,id)=>s.motions.retarget(id));scoped('motion:preview',(s,_c,id)=>s.motions.preview(id));
    scoped('motion:export',async(s,c,id)=>{const clip=s.motions.clip(id);const result=await dialog.showSaveDialog(c.window,{defaultPath:clip.name+'.motion.json',filters:[{name:'动作数据',extensions:['json']}]});if(result.canceled||!result.filePath)return;writeFileSync(result.filePath,JSON.stringify({format:'ai-assets-motion',version:1,clip},null,2));return result.filePath;});
    scoped('pose:source',(service,_context,id)=>service.setPoseSource(id));scoped('pose:analyze',(service,_context,id)=>service.analyzePose(id));
    scoped('editor:open',(_service,context,id,tool)=>{openEditor(context.workbenchId!,id,tool);});scoped('image:data',(service,_context,id)=>service.imageData(id));scoped('image:edit',(service,_context,input)=>service.editImage(input));scoped('image:crop',(service,_context,input)=>service.cropImage(input));
    scoped('frames:export',(service,context,id:string)=>service.localOperation(async()=>{const archive=await createFrameArchive(service,id);try{const result=await dialog.showSaveDialog(context.window,{defaultPath:archive.name,filters:[{name:'动画帧 ZIP',extensions:['zip']}]});if(result.canceled||!result.filePath)return;copyFileSync(archive.path,result.filePath);return result.filePath;}finally{rmSync(archive.directory,{recursive:true,force:true});}}));
    scoped('frames:options',(service,_context,input)=>service.saveFrameOptions(input));scoped('frames:split',(service,_context,input)=>service.splitVideo(input));scoped('frames:select',(service,_context,id,index)=>service.selectFrame(id,index));scoped('frames:restore',(service,_context,id,index)=>service.restoreFrame(id,index));scoped('frames:delete',(service,_context,id,indices)=>service.deleteFrames(id,indices));
    scoped('generate',(service,_context,input)=>service.generate(input));scoped('task:retry',(service,_context,id)=>service.retryTask(id));scoped('asset:select',(service,_context,k,id)=>service.select(k,id));
    scoped('asset:delete-image',(service,_context,id:string)=>service.deleteGeneratedImage(id,path=>shell.trashItem(path)));
    scoped('asset:export',async(service,context,id:string)=>{const a=service.workspace.assets.find(a=>a.id===id);if(!a)throw new Error('素材不存在。');const result=await dialog.showSaveDialog(context.window,{defaultPath:a.name});if(result.canceled||!result.filePath)return;copyFileSync(service.assets.path(a),result.filePath);return result.filePath;});
    scoped('workspace:files',(_service,context)=>{const files=manager.files(manager.info(context.workbenchId!).worktreeId);return listWorkspaceFiles(files.root,[],files.assets,files.folders);});
    scoped('workspace:file-read',(_service,context,path:string)=>readWorkspaceFile(worktreeBoot(context.workbenchId!).dataDirectory,path));
    scoped('workspace:file-reveal',async(_service,context,path:string)=>{shell.showItemInFolder(await workspaceFilePath(worktreeBoot(context.workbenchId!).dataDirectory,path));});
    scoped('worktree:file-use',async(service,context,path:string)=>{const files=manager.files(manager.info(context.workbenchId!).worktreeId),target=await workspaceFilePath(files.root,path),source=files.assets.get(path);if(!source||source.type==='document')throw new Error('请选择 Worktree 中的图片或视频素材。');const own=service.workspace.assets.find(a=>a.id===source.id);if(own)return own;if(statSync(target).size>50*1024*1024)throw new Error('素材须小于 50 MB。');const bytes=readFileSync(target);return (await service.importFiles([{name:source.name,bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer}]))[0];});
    scoped('data:open',(_service,context)=>shell.openPath(worktreeBoot(context.workbenchId!).dataDirectory));
    showLauncher();manager.resume();if(process.argv.includes('--self-test'))void packagedSelfTest();
    app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)showLauncher();});
  }).catch(e=>{dialog.showErrorBox('无法打开工作台',e instanceof Error?e.message:'启动失败，请保留本地数据。');app.quit();});
  app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>manager?.close());
}
