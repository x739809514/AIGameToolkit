import {migrateWorkbenchStorage} from './workbench-storage';
import {workspaceFilePath} from './workspace-files';
import type {TaskCompletion} from './task-notifications';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,rmdirSync,statSync} from 'node:fs';
import {join,relative,isAbsolute,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isBusy,defaultFrameWorkspace,defaultModelEditor,workbenchTypes,type Asset,type WorktreeInfo,type WorkbenchInfo,type WorkbenchType,type Workspace,type WorkbenchCatalog} from '../src/shared/types';
import {Store} from './store';
import {Service,type Vault} from './service';
export class Workbenches {
  entries:WorkbenchInfo[]=[];worktrees:WorktreeInfo[]=[];services=new Map<string,Service>();file:string;deleting=new Set<string>();deletingTrees=new Set<string>();deletingRoots=new Set<string>();
  constructor(public directory:string,public vault:Vault,public onChange:(id:string,w:Workspace)=>void,public projectsDirectory?:string,public onComplete:(id:string,event:TaskCompletion)=>void=()=>{}){
    mkdirSync(directory,{recursive:true});this.file=join(directory,'workbenches.json');
    if(projectsDirectory){if(!isAbsolute(projectsDirectory))throw new Error('项目根目录必须为绝对路径。');mkdirSync(projectsDirectory,{recursive:true});}
    if(existsSync(this.file)){
      const data=JSON.parse(readFileSync(this.file,'utf8'));
      if(![1,2,3].includes(data.version)||!Array.isArray(data.workbenches))throw new Error('工作台目录格式不支持。');
      if(data.version>=2){if(!Array.isArray(data.worktrees))throw new Error('Worktree 目录格式不支持。');const treeIDs=new Set<string>();for(const tree of data.worktrees){if(!tree||!this.validID(tree.id)||typeof tree.name!=='string'||treeIDs.has(tree.id))throw new Error('Worktree 目录损坏。');treeIDs.add(tree.id);this.worktrees.push(tree);}}
      else this.worktrees=[{id:'legacy',name:'默认 Worktree',createdAt:Date.now()}];
      let migrated=false;const ids=new Set<string>();for(const entry of data.workbenches){
        if(entry?.type==='video-frames'){entry.type='motion-editor';entry.name=entry.name.replace(/^视频与动画帧/, '动作编辑器');migrated=true;}
        if(entry?.storage!==undefined&&entry.storage!=='app')throw new Error('工作台存储配置不合法。');
        if(!entry||typeof entry.id!=='string'||!this.validID(entry.id)||!workbenchTypes.some(t=>t.id===entry.type)||typeof entry.name!=='string'||ids.has(entry.id))throw new Error('工作台目录损坏，请保留数据并检查目录文件。');
        entry.worktreeId=entry.worktreeId||'legacy';if(!this.worktrees.some(t=>t.id===entry.worktreeId))throw new Error('工作台所属 Worktree 不存在。');ids.add(entry.id);this.entries.push(entry);
      }
      const folders=new Set<string>();for(const tree of this.worktrees)if(tree.projectFolder!==undefined){const folder=tree.projectFolder;if(!this.projectsDirectory||typeof folder!=='string'||!folder||folder.length>100||folder==='.'||folder==='..'||/[\/\\:\x00-\x1f]/.test(folder)||folders.has(folder.toLocaleLowerCase()))throw new Error('项目目录配置不合法，请保留本地数据。');folders.add(folder.toLocaleLowerCase());}
      const migrations:ReturnType<typeof migrateWorkbenchStorage>[]=[];
      try{for(const entry of this.entries)if(entry.storage!=='app'){
        const source=entry.id==='legacy'?this.directory:join(this.treePath(entry.worktreeId),'workbenches',entry.id),target=join(this.directory,'.workbench-data',entry.id);
        migrations.push(migrateWorkbenchStorage(source,target));entry.storage='app';migrated=true;
      }if(data.version!==3||migrated)this.save();}catch(error){for(const migration of migrations.reverse())migration.undo();throw error;}
      for(const migration of migrations)migration.cleanup();
    }else if(existsSync(join(directory,'workspace.sqlite'))){
      this.worktrees=[{id:'legacy',name:'默认 Worktree',createdAt:Date.now()}];this.entries=[{id:'legacy',worktreeId:'legacy',type:'image-video',name:'图片与视频创作 1',createdAt:Date.now(),lastOpenedAt:0}];const migration=migrateWorkbenchStorage(this.directory,join(this.directory,'.workbench-data','legacy'));this.entries[0].storage='app';try{this.save();}catch(error){migration.undo();throw error;}migration.cleanup();
    }
  }
  validID(id:string){return id==='legacy'||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);}
  save(){writeFileSync(this.file+'.tmp',JSON.stringify({version:3,worktrees:this.worktrees,workbenches:this.entries}),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
  info(id:string){const info=this.entries.find(e=>e.id===id);if(!info)throw new Error('工作台不存在。');return info;}
  treeInfo(id:string){if(this.deletingTrees.has(id))throw new Error('Worktree 正在删除。');const tree=this.worktrees.find(t=>t.id===id);if(!tree)throw new Error('Worktree 不存在。');return tree;}
  treePath(id:string){const tree=this.treeInfo(id);if(tree.projectFolder)return join(this.projectsDirectory!,tree.projectFolder);return id==='legacy'?this.directory:join(this.directory,'worktrees',id);}
  path(id:string){const entry=this.info(id);return entry.storage==='app'?join(this.directory,'.workbench-data',id):id==='legacy'?this.directory:join(this.treePath(entry.worktreeId),'workbenches',id);}
  createWorktree(name?:string){
    if(name!==undefined&&(typeof name!=='string'||name.trim().length>60))throw new Error('Worktree 名称最多 60 个字符。');
    const tree:WorktreeInfo={id:randomUUID(),name:name?.trim()||`${this.projectsDirectory?'项目':'Worktree'} ${this.worktrees.length+1}`,createdAt:Date.now()};
    if(this.projectsDirectory){
      const base=tree.name.normalize('NFC').replace(/[\/\\:\x00-\x1f<>|"*?]/g,'-').replace(/^\.+/,'').trim()||'Project';
      for(let suffix=1;suffix<=10000;suffix++){const folder=suffix===1?base:`${base}-${suffix}`;if(this.deletingRoots.has(join(this.projectsDirectory,folder)))continue;try{mkdirSync(join(this.projectsDirectory,folder));tree.projectFolder=folder;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
      if(!tree.projectFolder)throw new Error('项目目录重名过多，请换一个项目名称。');
    }else mkdirSync(join(this.directory,'worktrees',tree.id),{recursive:true});
    this.worktrees.push(tree);try{this.save();}catch(error){this.worktrees=this.worktrees.filter(t=>t.id!==tree.id);try{rmdirSync(this.treePathForNew(tree));}catch{}throw error;}return structuredClone(tree);
  }
  private treePathForNew(tree:WorktreeInfo){return tree.projectFolder?join(this.projectsDirectory!,tree.projectFolder):join(this.directory,'worktrees',tree.id);}
  get(id:string){if(this.deleting.has(id))throw new Error('工作台正在删除。');this.info(id);let service=this.services.get(id);if(!service){service=new Service(new Store(this.path(id)),this.vault,w=>this.onChange(id,w),event=>this.onComplete(id,event));this.services.set(id,service);if(service.workspace.workbenchType!==this.info(id).type){service.workspace.workbenchType=this.info(id).type;if(this.info(id).type==='video-frames'&&!service.workspace.frameWorkspace){service.workspace.frameWorkspace=defaultFrameWorkspace();service.workspace.drafts.video.mode='text';}if(this.info(id).type==='motion-editor'&&!service.workspace.modelEditor)service.workspace.modelEditor=defaultModelEditor();service.changed();}}return service;}
  create(type:WorkbenchType,name?:string,worktreeId?:string){
    if(type==='video-frames')type='motion-editor';
    const kind=workbenchTypes.find(t=>t.id===type);if(!kind)throw new Error('工作台种类尚不支持。');
    if(name!==undefined&&(typeof name!=='string'||name.trim().length>60))throw new Error('工作台名称最多 60 个字符。');
    if(!worktreeId){if(!this.worktrees.length){if(this.projectsDirectory)this.createWorktree('默认项目');else if(this.deletingTrees.has('legacy'))this.createWorktree('默认 Worktree');else this.worktrees.push({id:'legacy',name:'默认 Worktree',createdAt:Date.now()});}worktreeId=this.entries.slice().sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt)[0]?.worktreeId||this.worktrees[0].id;}this.treeInfo(worktreeId);
    const previous=this.entries.filter(e=>e.worktreeId===worktreeId).slice().sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt)[0];const settings=previous?{...this.get(previous.id).workspace.settings}:undefined;
    const id=worktreeId==='legacy'&&this.entries.length===0&&!existsSync(join(this.directory,'workspace.sqlite'))?'legacy':randomUUID();const now=Date.now();
    const entry:WorkbenchInfo={id,worktreeId,type,storage:'app',name:name?.trim()||`${kind.name} ${this.entries.length+1}`,createdAt:now,lastOpenedAt:now};
    this.entries.push(entry);this.save();const service=this.get(id);if(settings)service.workspace.settings=settings;if(type==='motion-editor')service.workspace.settings.optimize=false;service.changed();return structuredClone(entry);
  }
  async deleteWorktree(id:string,trash:(path:string)=>Promise<void>,closeSessions:(ids:string[])=>void=()=>{},force=false){
    const tree=structuredClone(this.treeInfo(id)),entries=this.entries.filter(e=>e.worktreeId===id).map(e=>structuredClone(e));
    if(entries.some(e=>this.deleting.has(e.id)))throw new Error('此 Worktree 中有工作台正在删除。');
    const services=entries.map(e=>this.get(e.id));
    if(!force&&services.some(s=>s.localOperations||s.workspace.tasks.some(t=>isBusy(t)||t.state==='submission_unknown')||s.workspace.motionWorkspace?.extraction?.status==='extracting'||s.workspace.frameWorkspace?.sequences.some(seq=>seq.status==='extracting')||s.workspace.poseWorkspace?.analysis?.status==='analyzing'))throw new Error('此 Worktree 有正在运行或提交状态未确认的任务，请等待任务完成或核实状态后再删除。');
    const root=this.treePath(id),sources=entries.map(e=>({id:e.id,path:this.path(e.id)})),staging=join(this.directory,'.deleted-worktrees',randomUUID()),moved:{from:string;to:string}[]=[];
    this.deletingTrees.add(id);this.deletingRoots.add(root);for(const entry of entries)this.deleting.add(entry.id);
    try{
      closeSessions(entries.map(e=>e.id));
      for(const service of services){service.close(force);service.store.close();}for(const entry of entries)this.services.delete(entry.id);
      mkdirSync(staging,{recursive:true});
      for(const source of sources){
        // Shared legacy profile directories contain credentials and app settings.
        // Move only owned workbench data; never trash the profile itself.
        if(source.path===this.directory){for(const name of ['assets','workspace.sqlite','workspace.sqlite-wal','workspace.sqlite-shm']){const from=join(source.path,name);if(existsSync(from)){const to=join(staging,source.id+'-'+name);renameSync(from,to);moved.push({from,to});}}}
        else if(!source.path.startsWith(root+'/')||root===this.directory){if(existsSync(source.path)){const to=join(staging,'workbench-'+source.id);renameSync(source.path,to);moved.push({from:source.path,to});}}
      }
      if(root!==this.directory&&existsSync(root)){const to=join(staging,'project');renameSync(root,to);moved.push({from:root,to});}
      this.entries=this.entries.filter(e=>e.worktreeId!==id);this.worktrees=this.worktrees.filter(t=>t.id!==id);this.save();
      await trash(staging);return {tree,entries};
    }catch(error){
      for(const {from,to} of moved.reverse())if(existsSync(to))renameSync(to,from);
      if(!this.worktrees.some(t=>t.id===id))this.worktrees.push(tree);
      for(const entry of entries)if(!this.entries.some(e=>e.id===entry.id))this.entries.push(entry);
      this.save();if(existsSync(staging)&&!readdirSync(staging).length)rmdirSync(staging);throw error;
    }finally{this.deletingTrees.delete(id);this.deletingRoots.delete(root);for(const entry of entries)this.deleting.delete(entry.id);}
  }
  async deleteWorkbench(id:string,trash:(path:string)=>Promise<void>){
    const entry=structuredClone(this.info(id));if(this.deleting.has(id))throw new Error('工作台正在删除。');
    const service=this.get(id);
    if(service.workspace.motionWorkspace?.extraction?.status==='extracting'||service.localOperations||service.workspace.tasks.some(t=>isBusy(t)||t.state==='submission_unknown'))throw new Error('此工作台有正在运行或提交状态未确认的任务，请等待任务完成或核实状态后再删除。');
    const source=this.path(id),staging=join(this.directory,'.deleted-workbenches',randomUUID()),moved:{from:string;to:string}[]=[];
    this.deleting.add(id);service.close();service.store.close();this.services.delete(id);
    try{
      mkdirSync(staging,{recursive:true});
      if(id==='legacy'&&entry.storage!=='app'){
        for(const name of ['assets','workspace.sqlite','workspace.sqlite-wal','workspace.sqlite-shm']){const from=join(source,name);if(existsSync(from)){const to=join(staging,name);renameSync(from,to);moved.push({from,to});}}
      }else{const to=join(staging,'workbench');if(existsSync(source)){renameSync(source,to);moved.push({from:source,to});}}
      this.entries=this.entries.filter(e=>e.id!==id);this.save();
      await trash(staging);
      return entry;
    }catch(error){
      for(const {from,to} of moved.reverse())if(existsSync(to))renameSync(to,from);
      if(!this.entries.some(e=>e.id===id)){this.entries.push(entry);this.save();}
      if(existsSync(staging)&&!readdirSync(staging).length)rmdirSync(staging);
      throw error;
    }finally{this.deleting.delete(id);}
  }
  async useFile(id:string,path:string,worktreeId?:string){
    const entry=this.info(id);if(worktreeId!==undefined&&worktreeId!==entry.worktreeId)throw new Error('文件不属于当前项目，请从当前文件树重新拖入。');
    const service=this.get(id);
    return service.localOperation(async()=>{
      const files=this.files(entry.worktreeId),target=await workspaceFilePath(files.root,path,files.hideAppFiles),stat=statSync(target);
      if(!stat.isFile())throw new Error('请选择文件，不能拖入文件夹。');
      if(stat.size>50*1024*1024)throw new Error('素材须小于 50 MB。');
      const source=files.assets.get(path),own=source&&service.workspace.assets.find(asset=>asset.id===source.id);
      if(own)return structuredClone(own);
      const existing=service.workspace.assets.find(asset=>asset.projectFile?.path===path&&asset.projectFile.size===stat.size&&asset.projectFile.modifiedAt===stat.mtimeMs);
      if(existing)return structuredClone(existing);
      const bytes=readFileSync(target),[asset]=await service.importFiles([{name:source?.name||basename(target),bytes:Uint8Array.from(bytes).buffer}]);
      asset.projectFile={path,size:stat.size,modifiedAt:stat.mtimeMs};if(source)asset.sourceAssetId=source.id;service.changed();return structuredClone(asset);
    });
  }
  files(id:string){
    const root=this.treePath(id),assets=new Map<string,Asset>(),folders=new Map<string,string>();
    for(const entry of this.entries.filter(entry=>entry.worktreeId===id))for(const asset of this.get(entry.id).workspace.assets){const file=asset.projectFile;if(!file)continue;const target=join(root,file.path);try{const stat=statSync(target);if(stat.isFile()&&stat.size===file.size&&stat.mtimeMs===file.modifiedAt)assets.set(file.path,asset);}catch{}}
    return {root,assets,folders,hideAppFiles:root===this.directory};
  }
  remapProjectFiles(treeId:string,path:string,next?:string){
    for(const entry of this.entries.filter(entry=>entry.worktreeId===treeId)){const service=this.get(entry.id);let changed=false;for(const asset of service.workspace.assets){const file=asset.projectFile;if(file&&(file.path===path||file.path.startsWith(path+'/'))){if(next!==undefined){if(file.path===path&&asset.name===basename(path))asset.name=basename(next);file.path=next+file.path.slice(path.length);}else delete asset.projectFile;changed=true;}}if(changed)service.changed();}
  }

  opened(id:string){this.info(id).lastOpenedAt=Date.now();this.save();}
  catalog(openIDs=new Set<string>()):WorkbenchCatalog{return {types:workbenchTypes,projectsDirectory:this.projectsDirectory,worktrees:structuredClone(this.worktrees),workbenches:this.entries.slice().sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt).map(e=>({...e,isOpen:openIDs.has(e.id)}))};}
  resume(){for(const entry of this.entries)this.get(entry.id).resume();}
  close(){for(const service of this.services.values()){service.close();service.store.close();}this.services.clear();}
}
