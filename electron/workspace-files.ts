import {readdir,lstat,realpath,open,mkdir,rename} from 'node:fs/promises';
import {resolve,relative,sep,join,basename,dirname} from 'node:path';
import type {Asset,WorkspaceFile,WorkspaceFileTree,WorkspaceFilePreview} from '../src/shared/types';
// These belong to the shared app profile, rather than the active workbench.
const shared=new Set(['.workbench-data','.terminal-shell','.deleted-workbenches','.deleted-worktrees','credentials.enc.json','credentials.enc.json.tmp','worktrees','workbenches.json','Partitions','Session Storage','Local Storage','IndexedDB','Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','blob_storage','GPUPersistentCache','GraphiteDawnCache','Shared Dictionary','DIPS','DIPS-wal','Trust Tokens','Trust Tokens-journal','declarative_performance_observer','declarative_performance_observer-wal','Network','Cookies','Cookies-journal','Preferences','Local State','SingletonLock','SingletonCookie','SingletonSocket']);
function allowed(path:string){return !path.split(/[\\/]/).some(p=>shared.has(p)||p.startsWith('declarative_performance_observer')||/^workspace\.sqlite(?:-wal|-shm)?$/.test(p));}
export async function workspaceFilePath(root:string,path:string,hideAppFiles=true){
 if(typeof path!=='string'||!path||hideAppFiles&&!allowed(path))throw new Error('文件不属于当前工作台。');
 const base=await realpath(root),target=resolve(base,path),rel=relative(base,target);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||resolve(path)===path)throw new Error('文件不属于当前工作台。');
 const actual=await realpath(target),actualRel=relative(base,actual);
 if(actualRel==='..'||actualRel.startsWith('..'+sep))throw new Error('无法访问工作台外的链接。');
 let current=base;for(const part of rel.split(sep)){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error('暂不支持打开符号链接。');}
 return target;
}
export async function listWorkspaceFiles(root:string,assets:Asset[],assetPaths?:Map<string,Asset>,folderNames?:Map<string,string>,hideAppFiles=true):Promise<WorkspaceFileTree>{
 let count=0,truncated=false;const assetNames=new Map(assets.map(a=>[a.id,a]));
 async function scan(directory:string,parent='',depth=0):Promise<WorkspaceFile[]>{
  if(depth>20){truncated=true;return [];}
  const entries=(await readdir(directory,{withFileTypes:true})).filter(e=>e.name!=='.DS_Store'&&(!hideAppFiles||allowed(parent?parent+'/'+e.name:e.name))).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));const result:WorkspaceFile[]=[];
  for(const entry of entries){if(count>=2000){truncated=true;break;}count++;const path=parent?parent+'/'+entry.name:entry.name;
   const item:WorkspaceFile={name:entry.name,path,kind:entry.isSymbolicLink()?'link':entry.isDirectory()?'directory':'file'};if(item.kind==='file'){const ext=entry.name.split('.').pop()?.toLowerCase();item.assetType=ext==='fbx'?'model':['png','jpg','jpeg','webp'].includes(ext||'')?'image':['mp4','mov'].includes(ext||'')?'video':['txt','md','pdf'].includes(ext||'')?'document':undefined;}
   if(item.kind==='directory'){try{item.children=await scan(join(directory,entry.name),path,depth+1);}catch{item.unreadable=true;item.children=[];}}
   else if(item.kind==='file'){try{item.size=(await lstat(join(directory,entry.name))).size;}catch{item.unreadable=true;}if(parent==='assets'||assetPaths?.has(path)){const a=assetPaths?.get(path)||assetNames.get(entry.name.replace(/\.[^.]+$/,''));if(a){item.assetId=a.id;item.assetType=a.type;if(assetNames.has(a.id))item.displayName=a.name;}}}
   if(item.kind==='directory'&&folderNames?.has(path))item.displayName=folderNames.get(path);
   result.push(item);
  }return result;
 }
 return {files:await scan(root),truncated};
}
export async function readWorkspaceFile(root:string,path:string,hideAppFiles=true):Promise<WorkspaceFilePreview>{
 const target=await workspaceFilePath(root,path,hideAppFiles),file=await open(target,'r');
 try{const stat=await file.stat();if(!stat.isFile())throw new Error('请选择文件。');const bytes=Buffer.alloc(Math.min(stat.size,256*1024));await file.read(bytes,0,bytes.length,0);const binary=bytes.includes(0);return {size:stat.size,binary,text:binary?undefined:bytes.toString('utf8'),truncated:stat.size>bytes.length};}finally{await file.close();}
}

function entryName(value:string){if(typeof value!=='string'||!value.trim()||value.length>255||value==='.'||value==='..'||/[\x00-\x1f/\\:]/.test(value))throw new Error('名称不能为空，不能包含路径符号，且最多 255 个字符。');return value;}
async function parentDirectory(root:string,path:string,hideAppFiles:boolean){const target=path?await workspaceFilePath(root,path,hideAppFiles):await realpath(root);if(!(await lstat(target)).isDirectory())throw new Error('请选择目标文件夹。');return target;}
async function collision(target:string,source:string){
 let destination;try{destination=await lstat(target);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 const original=await lstat(source);
 if(!destination.isSymbolicLink()&&destination.dev===original.dev&&destination.ino===original.ino){
  const [sourceParent,targetParent,names]=await Promise.all([lstat(dirname(source)),lstat(dirname(target)),readdir(dirname(target))]);
  // On case-insensitive volumes, the new spelling resolves to the source itself.
  // A separately named hard link is still an occupied destination.
  if(sourceParent.dev===targetParent.dev&&sourceParent.ino===targetParent.ino&&!names.includes(basename(target)))return;
 }
 throw new Error('目标位置已有同名文件或文件夹，请更换名称。');
}
const relativePath=(root:string,target:string)=>relative(root,target).split(sep).join('/');
async function createEntry(root:string,input:{parent:string;name:string;kind:'file'|'directory'},hideAppFiles=true){
 if(!input||typeof input.parent!=='string'||!['file','directory'].includes(input.kind))throw new Error('文件操作参数无效。');
 const base=await realpath(root),parent=await parentDirectory(base,input.parent,hideAppFiles),target=join(parent,entryName(input.name));if(hideAppFiles&&!allowed(relativePath(base,target)))throw new Error('此名称属于应用内部数据，请更换名称。');
 try{if(input.kind==='directory')await mkdir(target);else{const file=await open(target,'wx');await file.close();}}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('目标位置已有同名文件或文件夹，请更换名称。');throw error;}
 return relativePath(base,target);
}
async function moveEntry(root:string,input:{path:string;parent:string;name?:string},hideAppFiles=true){
 if(!input||typeof input.path!=='string'||typeof input.parent!=='string')throw new Error('文件操作参数无效。');
 const base=await realpath(root),source=await workspaceFilePath(base,input.path,hideAppFiles),parent=await parentDirectory(base,input.parent,hideAppFiles),target=join(parent,entryName(input.name??basename(source))),next=relativePath(base,target);
 if(hideAppFiles&&!allowed(next))throw new Error('目标位置属于应用内部数据。');if(target===source)return next;
 const nested=relative(source,parent);if((await lstat(source)).isDirectory()&&(parent===source||nested&&!nested.startsWith('..'+sep)&&nested!=='..'))throw new Error('不能将文件夹移动到它自己或子文件夹中。');
 await collision(target,source);await rename(source,target);return next;
}

const fileMutations=new Map<string,Promise<unknown>>();
async function mutate<T>(root:string,operation:(base:string)=>Promise<T>):Promise<T>{
 if((await lstat(root)).isSymbolicLink())throw new Error('项目根目录不能是符号链接。');
 const base=await realpath(root),previous=fileMutations.get(base)||Promise.resolve(),pending=previous.catch(()=>{}).then(()=>operation(base));fileMutations.set(base,pending);
 try{return await pending;}finally{if(fileMutations.get(base)===pending)fileMutations.delete(base);}
}
export function createWorkspaceEntry(root:string,input:{parent:string;name:string;kind:'file'|'directory'},hideAppFiles=true){return mutate(root,base=>createEntry(base,input,hideAppFiles));}
export function moveWorkspaceEntry(root:string,input:{path:string;parent:string;name?:string},hideAppFiles=true){return mutate(root,base=>moveEntry(base,input,hideAppFiles));}
