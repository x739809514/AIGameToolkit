export const worktreeFileDrag='application/x-laputa-worktree-file';
export interface WorktreeFileDrag {path:string;name:string;worktreeId:string;kind?:'file'|'directory'}
export function parseWorktreeFileDrag(raw:string):WorktreeFileDrag {
 let input:unknown;try{input=JSON.parse(raw);}catch{throw new Error('文件拖入信息无效，请从右侧文件树重新拖动。');}
 const value=input as Partial<WorktreeFileDrag>|null;
 if(!value||typeof value.path!=='string'||!value.path||value.path.length>4096||typeof value.name!=='string'||!value.name||value.name.length>500||typeof value.worktreeId!=='string'||!value.worktreeId||value.worktreeId.length>100)throw new Error('文件拖入信息无效，请从右侧文件树重新拖动。');
 if(value.kind!==undefined&&!['file','directory'].includes(value.kind))throw new Error('文件拖入信息无效。');return {path:value.path,name:value.name,worktreeId:value.worktreeId,kind:value.kind};
}
