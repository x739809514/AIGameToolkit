import {apiBalanceReader,queryMiniMaxCredits,setMiniMaxCreditsSession} from './api-balance';
import {randomUUID} from 'node:crypto';
import {TaskNotifications} from './task-notifications';
import {balanceProviderInfo} from '../src/shared/api-balance';
import {saveFBXSegment,motionName} from './fbx-segment';
import {Terminals} from './terminals';
import {createFrameArchive} from './frame-export';
import {listWorkspaceFiles,readWorkspaceFile,workspaceFilePath,createWorkspaceEntry,moveWorkspaceEntry} from './workspace-files';
import {app,BrowserWindow,Notification,dialog,ipcMain,protocol,safeStorage,shell,net,session} from 'electron';
import {setNetworkFetch} from './network';
import {readFileSync,writeFileSync,existsSync,renameSync,copyFileSync,statSync,createReadStream,mkdirSync,rmSync,watch} from 'node:fs';
import {join,basename,relative,sep} from 'node:path';
import {Readable} from 'node:stream';
import {parseRange} from './range';
import {Workbenches} from './workbenches';
import type {Service,Vault} from './service';
import {selfTest} from './self-test';
import type {Provider,Workspace,ImageTool,WorkbenchInfo} from '../src/shared/types';
protocol.registerSchemesAsPrivileged([{scheme:'asset',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
interface WindowContext {window:BrowserWindow;role:'main'|'editor';workbenchId?:string}
let creditsWindow:BrowserWindow|undefined;let creditsGroup:string|undefined;let creditsSessionReady=false;let creditsReadPending:Promise<NonNullable<import('../src/shared/api-balance').APIBalance['credits']>>|undefined;
let launcher:BrowserWindow|undefined;let manager:Workbenches;let terminals:Terminals;
const activeNotifications=new Set<Notification>();
const notifications=new TaskNotifications(id=>manager?.entries.find(e=>e.id===id)?.name,id=>{focus(openWorkbench(id));},notice=>{
  if(process.argv.includes('--self-test')||!Notification.isSupported())return;
  const notification=new Notification({title:notice.title,body:notice.body,silent:false});activeNotifications.add(notification);
  notification.once('click',notice.click);notification.once('close',()=>activeNotifications.delete(notification));notification.once('failed',()=>activeNotifications.delete(notification));try{notification.show();}catch{activeNotifications.delete(notification);}
});
async function completedOperation<T>(service:Service,label:string,operation:()=>Promise<T>|T){const result=await operation();if(result!==undefined)service.completed({id:`local:${randomUUID()}`,label});return result;}
const editors=new Map<string,BrowserWindow>(),contexts=new Map<number,WindowContext>(),assetSessions=new Set<string>();
// Keep the existing data and credential location when changing the app name.
const dataDirectory=process.env.TOOLKIT_DATA_DIR||join(app.getPath('appData'),'ai-assets-toolkit');
mkdirSync(dataDirectory,{recursive:true});app.setPath('userData',dataDirectory);app.setName('Laputa');
class SecureVault implements Vault {
  secure=safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');
  memory:Partial<Record<Provider|'minimaxCredits',string>>={};encrypted:Partial<Record<Provider|'minimaxCredits',string>>={};file=join(app.getPath('userData'),'credentials.enc.json');
  constructor(){if(existsSync(this.file)){try{this.encrypted=JSON.parse(readFileSync(this.file,'utf8'));}catch{/* keep corrupted vault untouched until user replaces credentials */}}}
  getMiniMaxCreditsKey(){return this.get('minimaxCredits');}
  setMiniMaxCreditsKey(value:string){this.set('minimaxCredits',value);}
  get(p:Provider|'minimaxCredits'){if(this.memory[p])return this.memory[p];if(this.secure&&this.encrypted[p]){try{return safeStorage.decryptString(Buffer.from(this.encrypted[p]!,'base64'));}catch{return undefined;}}return undefined;}
  set(p:Provider|'minimaxCredits',value:string){
    if(!['openai','anthropic','minimax','minimaxCredits'].includes(p))throw new Error('供应商不存在。');
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
let projectWatcher:{treeId:string;watcher:ReturnType<typeof watch>;timer?:ReturnType<typeof setTimeout>}|undefined;
function watchProject(id:string){
 const treeId=manager.info(id).worktreeId;if(projectWatcher?.treeId===treeId)return;projectWatcher?.watcher.close();if(projectWatcher?.timer)clearTimeout(projectWatcher.timer);projectWatcher=undefined;
 const root=manager.treePath(treeId);if(root===manager.directory)return;
 try{const watcher=watch(root,{recursive:true}),active={treeId,watcher,timer:undefined as ReturnType<typeof setTimeout>|undefined};projectWatcher=active;watcher.on('change',()=>{if(active.timer)clearTimeout(active.timer);active.timer=setTimeout(()=>{for(const context of contexts.values())if(!context.window.isDestroyed()&&manager.entries.find(entry=>entry.id===context.workbenchId)?.worktreeId===treeId)context.window.webContents.send('worktree:files-changed');},150);});watcher.on('error',()=>{watcher.close();if(projectWatcher===active)projectWatcher=undefined;});}catch{ /* Manual refresh remains available for folders that cannot be watched. */ }
}
app.on('before-quit',()=>{projectWatcher?.watcher.close();if(projectWatcher?.timer)clearTimeout(projectWatcher.timer);});
function notifyProjectFiles(id:string){const treeId=manager.info(id).worktreeId;for(const context of contexts.values())if(!context.window.isDestroyed()&&manager.entries.find(entry=>entry.id===context.workbenchId)?.worktreeId===treeId)context.window.webContents.send('worktree:files-changed');}
function worktreeBoot(id:string){const workbench=structuredClone(manager.info(id)),worktree=structuredClone(manager.treeInfo(workbench.worktreeId));return {workbench,worktree,dataDirectory:manager.treePath(worktree.id)};}
function changedCatalog(){if(launcher&&!launcher.isDestroyed())launcher.webContents.send('workbenches:changed',manager.catalog(new Set(launcher&&!launcher.isDestroyed()&&contexts.get(launcher.webContents.id)?.workbenchId?[contexts.get(launcher.webContents.id)!.workbenchId!]:[])));}
function changedWorkspace(id:string,w:Workspace){for(const context of contexts.values())if(context.workbenchId&&!context.window.isDestroyed()&&manager.info(context.workbenchId).worktreeId===manager.info(id).worktreeId)context.window.webContents.send('worktree:files-changed');for(const context of contexts.values())if(context.workbenchId===id&&!context.window.isDestroyed())context.window.webContents.send('workspace:changed',w,id);}
function showLauncher(){
  if(launcher&&!launcher.isDestroyed()){focus(launcher);return launcher;}
  launcher=new BrowserWindow({width:1540,height:1000,minWidth:1080,minHeight:740,title:'选择工作台 · Laputa',backgroundColor:'#171717',titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:16},webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
  if(id){watchProject(id);manager.opened(id);owner.setTitle(`${manager.info(id).name} · Laputa`);}else owner.setTitle('选择工作台 · Laputa');
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
    if(app.getName()!=='Laputa'||app.getPath('userData')!==dataDirectory)throw new Error('应用名称或数据目录配置不正确');
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
    const projectsDirectory=process.env.TOOLKIT_PROJECTS_DIR||(process.env.TOOLKIT_DATA_DIR?join(app.getPath('userData'),'projects'):join(app.getPath('home'),'Laputa'));
    const creditsSession=session.fromPartition('persist:minimax-credits-cn');
    const creditURL='https://www.minimax.cn/backend/account/token_plan_credit';
    // Observe the console's account selection; authentication uses only its
    // isolated login cookies. Never forward an API key to this console endpoint.
    creditsSession.webRequest.onBeforeSendHeaders({urls:[creditURL]},(details,callback)=>{
      if(creditsWindow&&!creditsWindow.isDestroyed()&&details.webContentsId===creditsWindow.webContents.id){creditsGroup=Object.entries(details.requestHeaders).find(([name])=>name.toLowerCase()==='x-group-id')?.[1];}
      callback({requestHeaders:details.requestHeaders});
    });
    creditsSession.webRequest.onCompleted({urls:[creditURL]},details=>{
      if(details.method==='GET'&&!creditsReadPending&&manager&&creditsWindow&&!creditsWindow.isDestroyed()&&details.webContentsId===creditsWindow.webContents.id){creditsSessionReady=true;apiBalanceReader(manager.vault).invalidate();for(const context of contexts.values())if(!context.window.isDestroyed())context.window.webContents.send('account:changed');}
    });
    setMiniMaxCreditsSession(()=>{
      if(!creditsSessionReady)return;
      if(creditsReadPending)return creditsReadPending;
      creditsReadPending=Promise.resolve().then(()=>queryMiniMaxCredits(undefined,'cn',async(url,init)=>{
        // Run a normal read in the authenticated console origin so SameSite
        // cookies and the site's account selection work exactly as in its UI.
        if(creditsWindow&&!creditsWindow.isDestroyed()){
          const target=new URL(creditsWindow.webContents.getURL());
          if(target.protocol==='https:'&&(target.hostname==='minimax.cn'||target.hostname.endsWith('.minimax.cn'))){
            const headers=creditsGroup?{'X-Group-Id':creditsGroup}:{};
            const result=await creditsWindow.webContents.executeJavaScript(`fetch(${JSON.stringify(url)},{credentials:'include',headers:${JSON.stringify(headers)},signal:AbortSignal.timeout(15000)}).then(async r=>({status:r.status,text:await r.text()}))`);
            return new Response(result.text,{status:result.status});
          }
        }
        return creditsSession.fetch(url,{...init,headers:{...(creditsGroup?{'X-Group-Id':creditsGroup}:{}),Origin:'https://platform.minimax.cn',Referer:'https://platform.minimax.cn/'}});
      })).finally(()=>{creditsReadPending=undefined;});
      return creditsReadPending;
    });
    manager=new Workbenches(app.getPath('userData'),new SecureVault(),changedWorkspace,projectsDirectory,(id,event)=>notifications.complete(id,event));
    terminals=new Terminals(id=>({service:manager.get(id),cwd:manager.treePath(manager.info(id).worktreeId)}),event=>{for(const context of contexts.values())if(context.role==='main'&&context.workbenchId===event.workbenchId&&!context.window.isDestroyed())context.window.webContents.send('terminal:event',event);if(event.filesChanged)for(const context of contexts.values())if(context.workbenchId&&!context.window.isDestroyed()&&manager.info(context.workbenchId).worktreeId===manager.info(event.workbenchId).worktreeId)context.window.webContents.send('worktree:files-changed');},undefined,app.getPath('userData'),(id,event)=>notifications.complete(id,event));
    const handle=(name:string,fn:(context:WindowContext,...args:any[])=>any)=>ipcMain.handle(name,async(event,...args)=>{
      const context=contexts.get(event.sender.id);if(!context||context.window.isDestroyed()||event.senderFrame!==context.window.webContents.mainFrame)throw new Error('无权访问。');
      try{return await fn(context,...args);}catch(e){throw new Error(context.workbenchId&&manager.entries.some(entry=>entry.id===context.workbenchId)&&!manager.deleting.has(context.workbenchId)?manager.get(context.workbenchId).error(e):e instanceof Error?e.message:'操作失败。');}
    });
    const scoped=(name:string,fn:(service:Service,context:WindowContext,...args:any[])=>any)=>handle(name,(context,input)=>{if(!input||!Array.isArray(input.args))throw new Error('请求格式不合法。');const id=input.workbenchId||context.workbenchId;if(!id)throw new Error('请先选择工作台。');if(context.role==='editor'&&id!==context.workbenchId)throw new Error('无权访问其他工作台。');return fn(manager.get(id),{...context,workbenchId:id},...input.args);});
    handle('workbenches:list',()=>manager.catalog(new Set(launcher&&!launcher.isDestroyed()&&contexts.get(launcher.webContents.id)?.workbenchId?[contexts.get(launcher.webContents.id)!.workbenchId!]:[])));
    handle('workbenches:create',(_context,input)=>{if(!input||typeof input!=='object')throw new Error('工作台参数不合法。');const entry=manager.create(input.type,input.name,input.worktreeId||(_context.workbenchId?manager.info(_context.workbenchId).worktreeId:undefined));openWorkbench(entry.id);return entry;});
    handle('worktrees:create',(_context,input)=>{const tree=manager.createWorktree(input?.name);changedCatalog();return tree;});
    handle('worktrees:delete',async(context,id:string,force?:boolean)=>{
      if(context.role!=='main')throw new Error('请从主窗口删除 Worktree。');
      manager.treeInfo(id);const ids=new Set(manager.entries.filter(e=>e.worktreeId===id).map(e=>e.id));
      for(const s of terminals.sessions.values())if(force!==true&&ids.has(s.workbenchId)&&(s.commandRunning||s.submitting||terminals.codexJobs.has(s.state.id)))throw new Error('此 Worktree 中的终端或 Codex 正在执行任务，请等待结束后再删除。');
      await manager.deleteWorktree(id,path=>shell.trashItem(path),entries=>{for(const entry of entries)terminals.closeWorkbench(entry);},force===true);
      for(const [key,editor] of editors)if(ids.has(contexts.get(editor.webContents.id)?.workbenchId||'')){editor.destroy();editors.delete(key);}
      const active=launcher&&!launcher.isDestroyed()?contexts.get(launcher.webContents.id)?.workbenchId:undefined;
      if(active&&ids.has(active))selectWorkbench(manager.catalog().workbenches[0]?.id);else changedCatalog();
      for(const ctx of contexts.values())if(!ctx.window.isDestroyed())ctx.window.webContents.send('worktree:files-changed');
    });
    handle('workbenches:delete',async(context,id:string)=>{
      if(context.role!=='main')throw new Error('请从工作台列表删除实例。');
      let entry;try{entry=await manager.deleteWorkbench(id,path=>shell.trashItem(path));}finally{terminals.closeWorkbench(id);}
      for(const [key,editor] of editors)if(contexts.get(editor.webContents.id)?.workbenchId===id){editor.destroy();editors.delete(key);}
      const active=launcher&&!launcher.isDestroyed()?contexts.get(launcher.webContents.id)?.workbenchId:undefined;
      if(active===id){const next=manager.entries.filter(e=>e.worktreeId===entry.worktreeId).sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt)[0]||manager.catalog().workbenches[0];selectWorkbench(next?.id);}else changedCatalog();
      for(const ctx of contexts.values())if(ctx.workbenchId&&!ctx.window.isDestroyed()&&manager.info(ctx.workbenchId).worktreeId===entry.worktreeId)ctx.window.webContents.send('worktree:files-changed');
    });
    handle('workbenches:open',(_context,id)=>{openWorkbench(id);});handle('workbenches:show',()=>{selectWorkbench();});handle('workbenches:current',context=>context.workbenchId);
    scoped('boot',(service,context)=>({...service.boot(),...worktreeBoot(context.workbenchId!)}));
    scoped('terminal:list',(_s,c)=>terminals.list(c.workbenchId!));scoped('terminal:create',(_s,c,id)=>terminals.create(c.workbenchId!,id));scoped('terminal:close',(_s,c,id)=>terminals.close(c.workbenchId!,id));scoped('terminal:write',(_s,c,id,data)=>terminals.write(c.workbenchId!,id,data));scoped('terminal:submit',(_s,c,id,text)=>terminals.submit(c.workbenchId!,id,text));scoped('terminal:codex-cancel',(_s,c,id)=>terminals.cancelCodex(c.workbenchId!,id));scoped('terminal:resize',(_s,c,id,cols,rows)=>terminals.resize(c.workbenchId!,id,cols,rows));scoped('terminal:view',(_s,c,id,view)=>terminals.view(c.workbenchId!,id,view));
    scoped('settings:save',(service,_context,s,k)=>{const boot=service.saveSettings(s,k);for(const [id,other] of manager.services)changedWorkspace(id,structuredClone(other.workspace));return {...boot,...worktreeBoot(_context.workbenchId!)};});
    scoped('account:balances',(service,_context,force)=>service.apiBalances(force));
    scoped('account:minimax-credits',(_service,context)=>{
      if(creditsWindow&&!creditsWindow.isDestroyed()){focus(creditsWindow);return;}
      const owner=new BrowserWindow({width:1100,height:800,parent:context.window,modal:false,title:'MiniMax 中国区 · 积分',webPreferences:{session:creditsSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});creditsWindow=owner;
      owner.webContents.setWindowOpenHandler(({url})=>{if(new URL(url).protocol==='https:')void shell.openExternal(url);return {action:'deny'};});
      owner.webContents.on('will-navigate',(event,url)=>{const target=new URL(url);if(target.protocol!=='https:'||!(target.hostname==='minimax.cn'||target.hostname.endsWith('.minimax.cn')))event.preventDefault();});
      owner.on('closed',()=>{creditsWindow=undefined;});focus(owner);void owner.loadURL('https://platform.minimax.cn/console/plan').catch(error=>{if(owner.isDestroyed()||String(error).includes('ERR_ABORTED'))return;void dialog.showMessageBox(owner,{type:'error',title:'无法连接 MiniMax 中国区',message:'登录窗口已打开，但暂时无法加载中国区控制台。',detail:'请检查网络连接后，在登录窗口按 ⌘R 重试。'});});
    });
    scoped('account:billing',(_service,_context,provider:Provider)=>{if(!Object.hasOwn(balanceProviderInfo,provider))throw new Error('供应商不存在。');return shell.openExternal(balanceProviderInfo[provider].billingURL);});
    scoped('settings:test',(service,_context,p)=>service.testConnection(p));
    scoped('model-video:begin',(s,_c,input)=>s.modelVideo.begin(input));scoped('model-video:frame',(s,_c,id,index,bytes)=>s.modelVideo.frame(id,index,bytes));scoped('model-video:finish',(s,_c,id)=>completedOperation(s,'相机视频导出',()=>s.modelVideo.finish(id)));scoped('model-video:cancel',(s,_c,id)=>s.modelVideo.cancel(id));
    scoped('model:base',s=>{if(s.workspace.workbenchType!=='motion-editor')throw new Error('请在动作编辑器中加载基础模型。');const bytes=readFileSync(join(__dirname,'assets/y-bot.fbx'));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;});
    scoped('model:data',(service,_context,id)=>service.modelData(id));scoped('model:save',(service,_context,state)=>service.saveModelEditor(state));scoped('model:delete',(service,_context,id)=>service.deleteModel(id,path=>shell.trashItem(path)));scoped('model:blend',(service,_context,input)=>completedOperation(service,'混合动作保存',()=>service.saveModelBlend(input)));scoped('model:segment',(service,_context,input)=>completedOperation(service,'FBX 片段另存',()=>saveFBXSegment(service,input)));scoped('model:rename',(service,_context,id,name)=>{service.modelData(id);const asset=service.workspace.assets.find(a=>a.id===id)!;asset.name=motionName(name)+'.fbx';service.changed();});
    scoped('draft:save',(service,_context,k,d)=>service.saveDraft(k,d));scoped('files:import',(service,_context,f)=>service.importFiles(f));
    scoped('files:pick',async(service,context)=>{const result=await dialog.showOpenDialog(context.window,{properties:['openFile','multiSelections'],filters:service.workspace.workbenchType==='motion-editor'?[{name:'FBX 模型与动作',extensions:['fbx']}]:[{name:'素材',extensions:['png','jpg','jpeg','webp','mp4','mov','txt','md','pdf']}]});if(result.canceled)return [];return service.importFiles(result.filePaths.map(p=>{if(statSync(p).size>50*1024*1024)throw new Error('上传文件须小于 50 MB。');const bytes=readFileSync(p);return {name:p.split(/[\\/]/).pop()!,bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer};}));});
    scoped('pose:edit',(s,_c,id,j)=>s.motions.editPose(id,j));scoped('pose:reset',s=>s.motions.resetPose());scoped('pose:save',(s,_c,name)=>s.motions.savePose(name));scoped('pose:load',(s,_c,id)=>s.motions.loadPose(id));
    scoped('motion:begin',(s,_c,input)=>s.motions.begin(input));scoped('motion:append',(s,_c,id,frames)=>s.motions.append(id,frames));scoped('motion:finish',(s,_c,id)=>s.motions.finish(id));scoped('motion:fail',(s,_c,id,error)=>s.motions.fail(id,error));scoped('motion:cancel',(s,_c,id)=>s.motions.fail(id,'用户取消提取。',true));scoped('motion:select',(s,_c,id)=>s.motions.select(id));scoped('motion:edit',(s,_c,id,index,joints)=>s.motions.edit(id,index,joints));scoped('motion:reset',(s,_c,id)=>s.motions.reset(id));scoped('motion:clean',(s,_c,id,options)=>s.motions.clean(id,options));scoped('motion:save',(s,_c,id,name,tags)=>s.motions.save(id,name,tags));scoped('motion:compose',(s,_c,parts,transition)=>s.motions.compose(parts,transition));scoped('motion:retarget',(s,_c,id)=>s.motions.retarget(id));scoped('motion:preview',(s,_c,id)=>completedOperation(s,'骨骼参考视频导出',()=>s.motions.preview(id)));
    scoped('motion:export',async(s,c,id)=>{const clip=s.motions.clip(id);const result=await dialog.showSaveDialog(c.window,{defaultPath:join(worktreeBoot(c.workbenchId!).dataDirectory,basename(clip.name)+'.motion.json'),filters:[{name:'动作数据',extensions:['json']}]});if(result.canceled||!result.filePath)return;writeFileSync(result.filePath,JSON.stringify({format:'ai-assets-motion',version:1,clip},null,2));s.completed({id:`export:${randomUUID()}`,label:'动作数据导出'});notifyProjectFiles(c.workbenchId!);return result.filePath;});
    scoped('pose:source',(service,_context,id)=>service.setPoseSource(id));scoped('pose:analyze',(service,_context,id)=>service.analyzePose(id));
    scoped('editor:open',(_service,context,id,tool)=>{openEditor(context.workbenchId!,id,tool);});scoped('image:data',(service,_context,id)=>service.imageData(id));scoped('image:edit',(service,_context,input)=>service.editImage(input));scoped('image:crop',(service,_context,input)=>completedOperation(service,'图片裁切',()=>service.cropImage(input)));
    scoped('frames:export',(service,context,id:string)=>service.localOperation(async()=>{const archive=await createFrameArchive(service,id);try{const result=await dialog.showSaveDialog(context.window,{defaultPath:join(worktreeBoot(context.workbenchId!).dataDirectory,basename(archive.name)),filters:[{name:'动画帧 ZIP',extensions:['zip']}]});if(result.canceled||!result.filePath)return;copyFileSync(archive.path,result.filePath);service.completed({id:`export:${randomUUID()}`,label:'动画帧包下载'});notifyProjectFiles(context.workbenchId!);return result.filePath;}finally{rmSync(archive.directory,{recursive:true,force:true});}}));
    scoped('frames:options',(service,_context,input)=>service.saveFrameOptions(input));scoped('frames:split',(service,_context,input)=>service.splitVideo(input));scoped('frames:select',(service,_context,id,index)=>service.selectFrame(id,index));scoped('frames:restore',(service,_context,id,index)=>service.restoreFrame(id,index));scoped('frames:delete',(service,_context,id,indices)=>service.deleteFrames(id,indices));
    scoped('generate',(service,_context,input)=>service.generate(input));scoped('task:retry',(service,_context,id)=>service.retryTask(id));scoped('asset:select',(service,_context,k,id)=>service.select(k,id));
    scoped('asset:delete-image',(service,_context,id:string)=>service.deleteGeneratedImage(id,path=>shell.trashItem(path)));
    scoped('asset:export',async(service,context,id:string)=>{const a=service.workspace.assets.find(a=>a.id===id);if(!a)throw new Error('素材不存在。');const root=worktreeBoot(context.workbenchId!).dataDirectory,result=await dialog.showSaveDialog(context.window,{defaultPath:join(root,basename(a.name))});if(result.canceled||!result.filePath)return;copyFileSync(service.assets.path(a),result.filePath);const path=relative(root,result.filePath).split(sep).join('/');if(path&&!path.startsWith('../')&&path!=='..'&&!path.startsWith('/')){try{await workspaceFilePath(root,path,manager.files(manager.info(context.workbenchId!).worktreeId).hideAppFiles);const stat=statSync(result.filePath);a.projectFile={path,size:stat.size,modifiedAt:stat.mtimeMs};service.changed();}catch{}}notifyProjectFiles(context.workbenchId!);service.completed({id:`export:${randomUUID()}`,label:'素材下载'});return result.filePath;});
    scoped('workspace:files',(_service,context)=>{watchProject(context.workbenchId!);const files=manager.files(manager.info(context.workbenchId!).worktreeId);return listWorkspaceFiles(files.root,[],files.assets,files.folders,files.hideAppFiles);});
    scoped('workspace:file-read',(_service,context,path:string)=>{const files=manager.files(manager.info(context.workbenchId!).worktreeId);return readWorkspaceFile(files.root,path,files.hideAppFiles);});
    scoped('workspace:file-reveal',async(_service,context,path:string)=>{const files=manager.files(manager.info(context.workbenchId!).worktreeId);shell.showItemInFolder(await workspaceFilePath(files.root,path,files.hideAppFiles));});
    scoped('workspace:file-create',(service,context,input)=>service.localOperation(async()=>{const files=manager.files(manager.info(context.workbenchId!).worktreeId),path=await createWorkspaceEntry(files.root,input,files.hideAppFiles);notifyProjectFiles(context.workbenchId!);return path;}));
    scoped('workspace:file-move',(service,context,input)=>service.localOperation(async()=>{const treeId=manager.info(context.workbenchId!).worktreeId,files=manager.files(treeId),next=await moveWorkspaceEntry(files.root,input,files.hideAppFiles);manager.remapProjectFiles(treeId,input.path,next);notifyProjectFiles(context.workbenchId!);return next;}));
    scoped('workspace:file-trash',(service,context,path:string)=>service.localOperation(async()=>{const treeId=manager.info(context.workbenchId!).worktreeId,files=manager.files(treeId);await shell.trashItem(await workspaceFilePath(files.root,path,files.hideAppFiles));manager.remapProjectFiles(treeId,path);notifyProjectFiles(context.workbenchId!);}));
    scoped('worktree:file-use',(_service,context,path:string,worktreeId?:string)=>manager.useFile(context.workbenchId!,path,worktreeId));
    scoped('data:open',(_service,context)=>shell.openPath(worktreeBoot(context.workbenchId!).dataDirectory));
    showLauncher();manager.resume();if(process.argv.includes('--self-test'))void packagedSelfTest();
    app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)showLauncher();});
  }).catch(e=>{dialog.showErrorBox('无法打开工作台',e instanceof Error?e.message:'启动失败，请保留本地数据。');app.quit();});
  app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{terminals?.closeAll();manager?.close();});
}
