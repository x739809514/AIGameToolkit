export const tripoModel='v3.1-20260211';
export type TripoTaskState='preparing'|'submitting'|'submission_unknown'|'queued'|'running'|'saving'|'save_failed'|'succeeded'|'failed'|'cancelled';
export interface TripoDraft {mode:'text'|'image';prompt:string;imageId?:string;texture:boolean;pbr:boolean}
export interface TripoInput extends TripoDraft {requestId:string}
export interface TripoTask extends TripoInput {id:string;model:string;state:TripoTaskState;createdAt:number;updatedAt:number;remoteTaskId?:string;progress:number;assetId?:string;error?:string;pollError?:string;credits?:number}
export interface TripoWorkspace {draft:TripoDraft;tasks:TripoTask[];selectedAssetId?:string}
export const defaultTripoWorkspace=():TripoWorkspace=>({draft:{mode:'text',prompt:'',texture:true,pbr:true},tasks:[]});
export const tripoBusy=(task:TripoTask)=>['preparing','submitting','queued','running','saving'].includes(task.state);
export function validateTripoDraft(input:TripoDraft){
 if(!input||!['text','image'].includes(input.mode)||typeof input.prompt!=='string'||input.prompt.length>1000||typeof input.texture!=='boolean'||typeof input.pbr!=='boolean')throw new Error('3D 生成参数不合法，描述最多 1000 字符。');
 if(input.imageId!==undefined&&typeof input.imageId!=='string')throw new Error('参考图片无效。');
}
