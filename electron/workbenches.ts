import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,rmdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isBusy,defaultFrameWorkspace,defaultModelEditor,workbenchTypes,type Asset,type WorktreeInfo,type WorkbenchInfo,type WorkbenchType,type Workspace,type WorkbenchCatalog} from '../src/shared/types';
import {Store} from './store';
import {Service,type Vault} from './service';
export class Workbenches {
  entries:WorkbenchInfo[]=[];worktrees:WorktreeInfo[]=[];services=new Map<string,Service>();file:string;deleting=new Set<string>();
  constructor(public directory:string,public vault:Vault,public onChange:(id:string,w:Workspace)=>void){
    mkdirSync(directory,{recursive:true});this.file=join(directory,'workbenches.json');
    if(existsSync(this.file)){
      const data=JSON.parse(readFileSync(this.file,'utf8'));
      if(![1,2].includes(data.version)||!Array.isArray(data.workbenches))throw new Error('工作台目录格式不支持。');
      if(data.version===2){if(!Array.isArray(data.worktrees))throw new Error('Worktree 目录格式不支持。');const treeIDs=new Set<string>();for(const tree of data.worktrees){if(!tree||!this.validID(tree.id)||typeof tree.name!=='string'||treeIDs.has(tree.id))throw new Error('Worktree 目录损坏。');treeIDs.add(tree.id);this.worktrees.push(tree);}}
      else this.worktrees=[{id:'legacy',name:'默认 Worktree',createdAt:Date.now()}];
      let migrated=false;const ids=new Set<string>();for(const entry of data.workbenches){
        if(entry?.type==='video-frames'){entry.type='motion-editor';entry.name=entry.name.replace(/^视频与动画帧/, '动作编辑器');migrated=true;}
        if(!entry||typeof entry.id!=='string'||!this.validID(entry.id)||!workbenchTypes.some(t=>t.id===entry.type)||typeof entry.name!=='string'||ids.has(entry.id))throw new Error('工作台目录损坏，请保留数据并检查目录文件。');
        entry.worktreeId=entry.worktreeId||'legacy';if(!this.worktrees.some(t=>t.id===entry.worktreeId))throw new Error('工作台所属 Worktree 不存在。');ids.add(entry.id);this.entries.push(entry);
      }
      if(data.version===1||migrated)this.save();
    }else if(existsSync(join(directory,'workspace.sqlite'))){
      this.worktrees=[{id:'legacy',name:'默认 Worktree',createdAt:Date.now()}];this.entries=[{id:'legacy',worktreeId:'legacy',type:'image-video',name:'图片与视频创作 1',createdAt:Date.now(),lastOpenedAt:0}];this.save();
    }
  }
  validID(id:string){return id==='legacy'||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);}
  save(){writeFileSync(this.file+'.tmp',JSON.stringify({version:2,worktrees:this.worktrees,workbenches:this.entries}),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
  info(id:string){const info=this.entries.find(e=>e.id===id);if(!info)throw new Error('工作台不存在。');return info;}
  treeInfo(id:string){const tree=this.worktrees.find(t=>t.id===id);if(!tree)throw new Error('Worktree 不存在。');return tree;}
  treePath(id:string){this.treeInfo(id);return id==='legacy'?this.directory:join(this.directory,'worktrees',id);}
  path(id:string){const entry=this.info(id);return id==='legacy'?this.directory:join(this.treePath(entry.worktreeId),'workbenches',id);}
  createWorktree(name?:string){if(name!==undefined&&(typeof name!=='string'||name.trim().length>60))throw new Error('Worktree 名称最多 60 个字符。');const tree:WorktreeInfo={id:randomUUID(),name:name?.trim()||`Worktree ${this.worktrees.length+1}`,createdAt:Date.now()};this.worktrees.push(tree);mkdirSync(this.treePath(tree.id),{recursive:true});this.save();return structuredClone(tree);}
  get(id:string){if(this.deleting.has(id))throw new Error('工作台正在删除。');this.info(id);let service=this.services.get(id);if(!service){service=new Service(new Store(this.path(id)),this.vault,w=>this.onChange(id,w));this.services.set(id,service);if(service.workspace.workbenchType!==this.info(id).type){service.workspace.workbenchType=this.info(id).type;if(this.info(id).type==='video-frames'&&!service.workspace.frameWorkspace){service.workspace.frameWorkspace=defaultFrameWorkspace();service.workspace.drafts.video.mode='text';}if(this.info(id).type==='motion-editor'&&!service.workspace.modelEditor)service.workspace.modelEditor=defaultModelEditor();service.changed();}}return service;}
  create(type:WorkbenchType,name?:string,worktreeId?:string){
    if(type==='video-frames')type='motion-editor';
    const kind=workbenchTypes.find(t=>t.id===type);if(!kind)throw new Error('工作台种类尚不支持。');
    if(name!==undefined&&(typeof name!=='string'||name.trim().length>60))throw new Error('工作台名称最多 60 个字符。');
    if(!worktreeId){if(!this.worktrees.length)this.worktrees.push({id:'legacy',name:'默认 Worktree',createdAt:Date.now()});worktreeId=this.entries.slice().sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt)[0]?.worktreeId||this.worktrees[0].id;}this.treeInfo(worktreeId);
    const previous=this.entries.filter(e=>e.worktreeId===worktreeId).slice().sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt)[0];const settings=previous?{...this.get(previous.id).workspace.settings}:undefined;
    const id=worktreeId==='legacy'&&this.entries.length===0&&!existsSync(join(this.directory,'workspace.sqlite'))?'legacy':randomUUID();const now=Date.now();
    const entry:WorkbenchInfo={id,worktreeId,type,name:name?.trim()||`${kind.name} ${this.entries.length+1}`,createdAt:now,lastOpenedAt:now};
    this.entries.push(entry);this.save();const service=this.get(id);if(settings)service.workspace.settings=settings;if(type==='motion-editor')service.workspace.settings.optimize=false;service.changed();return structuredClone(entry);
  }
  async deleteWorkbench(id:string,trash:(path:string)=>Promise<void>){
    const entry=structuredClone(this.info(id));if(this.deleting.has(id))throw new Error('工作台正在删除。');
    const service=this.get(id);
    if(service.workspace.motionWorkspace?.extraction?.status==='extracting'||service.localOperations||service.workspace.tasks.some(t=>isBusy(t)||t.state==='submission_unknown'))throw new Error('此工作台有正在运行或提交状态未确认的任务，请等待任务完成或核实状态后再删除。');
    const source=this.path(id),staging=join(this.directory,'.deleted-workbenches',randomUUID()),moved:{from:string;to:string}[]=[];
    this.deleting.add(id);service.close();service.store.close();this.services.delete(id);
    try{
      mkdirSync(staging,{recursive:true});
      if(id==='legacy'){
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
  files(id:string){const root=this.treePath(id),assets=new Map<string,Asset>(),folders=new Map<string,string>();for(const entry of this.entries.filter(e=>e.worktreeId===id)){const service=this.get(entry.id);const folder=relative(root,this.path(entry.id)).replaceAll('\\','/');if(folder)folders.set(folder,entry.name);for(const asset of service.workspace.assets)assets.set(relative(root,service.assets.path(asset)).replaceAll('\\','/'),asset);}return {root,assets,folders};}
  opened(id:string){this.info(id).lastOpenedAt=Date.now();this.save();}
  catalog(openIDs=new Set<string>()):WorkbenchCatalog{return {types:workbenchTypes,worktrees:structuredClone(this.worktrees),workbenches:this.entries.slice().sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt).map(e=>({...e,isOpen:openIDs.has(e.id)}))};}
  resume(){for(const entry of this.entries)this.get(entry.id).resume();}
  close(){for(const service of this.services.values()){service.close();service.store.close();}this.services.clear();}
}
