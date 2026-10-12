import {readdir,lstat,realpath,open} from 'node:fs/promises';
import {resolve,relative,sep,join} from 'node:path';
import type {Asset,WorkspaceFile,WorkspaceFileTree,WorkspaceFilePreview} from '../src/shared/types';
// These belong to the shared app profile, rather than the active workbench.
const shared=new Set(['.deleted-workbenches','credentials.enc.json','credentials.enc.json.tmp','worktrees','workbenches.json','Partitions','Session Storage','Local Storage','IndexedDB','Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','blob_storage','GPUPersistentCache','GraphiteDawnCache','Shared Dictionary','DIPS','DIPS-wal','Trust Tokens','Trust Tokens-journal','declarative_performance_observer','declarative_performance_observer-wal','Network','Cookies','Cookies-journal','Preferences','Local State','SingletonLock','SingletonCookie','SingletonSocket']);
function allowed(path:string){return !path.split(/[\\/]/).some(p=>shared.has(p)||p.startsWith('declarative_performance_observer')||/^workspace\.sqlite(?:-wal|-shm)?$/.test(p));}
export async function workspaceFilePath(root:string,path:string){
 if(typeof path!=='string'||!path||!allowed(path))throw new Error('文件不属于当前工作台。');
 const base=await realpath(root),target=resolve(base,path),rel=relative(base,target);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||resolve(path)===path)throw new Error('文件不属于当前工作台。');
 const actual=await realpath(target),actualRel=relative(base,actual);
 if(actualRel==='..'||actualRel.startsWith('..'+sep))throw new Error('无法访问工作台外的链接。');
 let current=base;for(const part of rel.split(sep)){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error('暂不支持打开符号链接。');}
 return target;
}
export async function listWorkspaceFiles(root:string,assets:Asset[],assetPaths?:Map<string,Asset>,folderNames?:Map<string,string>):Promise<WorkspaceFileTree>{
 let count=0,truncated=false;const assetNames=new Map(assets.map(a=>[a.id,a]));
 async function scan(directory:string,parent='',depth=0):Promise<WorkspaceFile[]>{
  if(depth>20){truncated=true;return [];}
  const entries=(await readdir(directory,{withFileTypes:true})).filter(e=>allowed(parent?parent+'/'+e.name:e.name)).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));const result:WorkspaceFile[]=[];
  for(const entry of entries){if(count>=2000){truncated=true;break;}count++;const path=parent?parent+'/'+entry.name:entry.name;
   const item:WorkspaceFile={name:entry.name,path,kind:entry.isSymbolicLink()?'link':entry.isDirectory()?'directory':'file'};
   if(item.kind==='directory'){try{item.children=await scan(join(directory,entry.name),path,depth+1);}catch{item.unreadable=true;item.children=[];}}
   else if(item.kind==='file'){try{item.size=(await lstat(join(directory,entry.name))).size;}catch{item.unreadable=true;}if(parent==='assets'||assetPaths?.has(path)){const a=assetPaths?.get(path)||assetNames.get(entry.name.replace(/\.[^.]+$/,''));if(a){item.assetId=a.id;item.assetType=a.type;item.displayName=a.name;}}}
   if(item.kind==='directory'&&folderNames?.has(path))item.displayName=folderNames.get(path);
   result.push(item);
  }return result;
 }
 return {files:await scan(root),truncated};
}
export async function readWorkspaceFile(root:string,path:string):Promise<WorkspaceFilePreview>{
 const target=await workspaceFilePath(root,path),file=await open(target,'r');
 try{const stat=await file.stat();if(!stat.isFile())throw new Error('请选择文件。');const bytes=Buffer.alloc(Math.min(stat.size,256*1024));await file.read(bytes,0,bytes.length,0);const binary=bytes.includes(0);return {size:stat.size,binary,text:binary?undefined:bytes.toString('utf8'),truncated:stat.size>bytes.length};}finally{await file.close();}
}
