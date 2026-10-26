export interface ModelAttachment {id:string;assetId:string;parentPath:number[];name:string}
export function normalizeModelAttachments(input:unknown,exists:(id:string)=>boolean):ModelAttachment[]{
 if(!Array.isArray(input)||input.length>100)throw new Error('最多挂载 100 个 FBX 子物体。');
 const ids=new Set<string>();return input.map(value=>{
  if(!value||typeof value.id!=='string'||!value.id||value.id.length>100||ids.has(value.id)||typeof value.assetId!=='string'||!exists(value.assetId)||typeof value.name!=='string'||!value.name.trim()||value.name.length>500||!Array.isArray(value.parentPath)||!value.parentPath.length||value.parentPath.length>128||value.parentPath.some((n:unknown)=>!Number.isInteger(n)||Number(n)<0||Number(n)>10000))throw new Error('FBX 子物体挂载信息无效，或模型不存在。');
  ids.add(value.id);return {id:value.id,assetId:value.assetId,parentPath:[...value.parentPath],name:value.name};
 });
}
