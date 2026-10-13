import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readdirSync,lstatSync,renameSync,cpSync,rmSync,rmdirSync,readFileSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';

function relocate(from:string,to:string){
 mkdirSync(dirname(to),{recursive:true});
 try{renameSync(from,to);}catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;cpSync(from,to,{recursive:true,errorOnExist:true,force:false});rmSync(from,{recursive:true});}
}
export function migrateWorkbenchStorage(source:string,target:string){
 const moved:{from:string;to:string}[]=[],duplicates:string[]=[];
 const empty=(path:string)=>{if(!existsSync(path)||!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())return;const names=readdirSync(path);if(names.some(name=>name!=='.DS_Store'))return;try{for(const name of names)relocate(join(path,name),join(target,'.folder-metadata',randomUUID()+'.dsstore'));rmdirSync(path);}catch{ /* Keep the original folder if metadata cannot be preserved. */ }};
 const undo=()=>{for(const {from,to} of [...moved].reverse())if(existsSync(to))relocate(to,from);};
 const cleanup=()=>{for(const path of duplicates)rmSync(path);empty(join(source,'assets'));if(source!==dirname(target)){empty(source);if(basename(dirname(source))==='workbenches')empty(dirname(source));}};
 if(!existsSync(join(source,'workspace.sqlite'))){return {undo,cleanup};}
 if(lstatSync(source).isSymbolicLink()||lstatSync(join(source,'workspace.sqlite')).isSymbolicLink())throw new Error('旧工作台数据目录包含链接，迁移已停止。');
 if(existsSync(join(target,'workspace.sqlite')))throw new Error('内部工作台数据目录冲突，原数据保留。');
 const db=new DatabaseSync(join(source,'workspace.sqlite'));let state:any;
 try{const row=db.prepare('SELECT data FROM workspace WHERE id=1').get() as {data:string}|undefined;state=row?JSON.parse(row.data):{};db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}
 const prefixes=new Set<string>([...(state.assets||[]).map((a:any)=>a.id),...(state.tasks||[]).map((t:any)=>t.id),...(state.frameWorkspace?.sequences||[]).map((s:any)=>s.id)]);
 const move=(from:string,to:string)=>{if(existsSync(to)){if(lstatSync(from).isFile()&&lstatSync(to).isFile()&&readFileSync(from).equals(readFileSync(to))){duplicates.push(from);return;}throw new Error('工作台缓存迁移发生文件冲突，原文件保留。');}relocate(from,to);moved.push({from,to});};
 try{
  const assets=join(source,'assets');if(existsSync(assets)){if(lstatSync(assets).isSymbolicLink())throw new Error('旧素材目录为链接，迁移已停止。');for(const name of readdirSync(assets)){const path=join(assets,name);if(lstatSync(path).isSymbolicLink())continue;if([...prefixes].some(id=>name===id||name.startsWith(id+'.')||name.startsWith(id+'-'))||/^model-video-[A-Za-z0-9]+$/.test(name))move(path,join(target,'assets',name));}}
  for(const name of readdirSync(source))if(/^(frame-export-|motion-render-)[A-Za-z0-9]+$/.test(name)&&lstatSync(join(source,name)).isDirectory()&&!lstatSync(join(source,name)).isSymbolicLink())move(join(source,name),join(target,name));
  for(const name of ['workspace.sqlite-wal','workspace.sqlite-shm','workspace.sqlite'])if(existsSync(join(source,name)))move(join(source,name),join(target,name));
  return {undo,cleanup};
 }catch(error){undo();throw error;}
}
