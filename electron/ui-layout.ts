import {existsSync,readFileSync,writeFileSync,renameSync,rmSync,lstatSync} from 'node:fs';
import {extname,dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateUILayout,type UILayout} from '../src/shared/ui-layout';
import {readPNG} from './image-processing';
// Stage both outputs before replacing either destination; roll back both on failure.
export function writeUILayoutPair(path:string,input:unknown,png:ArrayBuffer):{jsonPath:string;pngPath:string} {
 const document=validateUILayout(input);if(!(png instanceof ArrayBuffer)||png.byteLength>32*1024*1024)throw new Error('PNG 数据无效或超过 32 MB。');
 const bytes=Buffer.from(png),image=readPNG(bytes);if(image.width!==document.width||image.height!==document.height)throw new Error('PNG 尺寸与布局画布不一致。');
 const jsonPath=extname(path).toLowerCase()==='.json'?path:path+'.json',pngPath=jsonPath.slice(0,-5)+'.png';
 for(const target of [jsonPath,pngPath]){try{if(!lstatSync(target).isFile())throw new Error('保存目标必须是普通文件，不能替换文件夹或符号链接。');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 const token=randomUUID(),paths=[jsonPath,pngPath],temporary=paths.map(p=>join(dirname(p),'.'+basename(p)+'.'+token+'.tmp')),backups=paths.map(p=>p+'.'+token+'.backup'),moved:boolean[]=[],installed:boolean[]=[];
 try{
  writeFileSync(temporary[0],JSON.stringify(document,null,2),{flag:'wx'});writeFileSync(temporary[1],bytes,{flag:'wx'});
  for(let i=0;i<2;i++){if(existsSync(paths[i])){renameSync(paths[i],backups[i]);moved[i]=true;}renameSync(temporary[i],paths[i]);installed[i]=true;}
 }catch(error){for(let i=1;i>=0;i--){if(installed[i])rmSync(paths[i],{force:true});if(moved[i])renameSync(backups[i],paths[i]);}throw error;}
 finally{for(const file of temporary)rmSync(file,{force:true});}
 for(const file of backups)rmSync(file,{force:true});return {jsonPath,pngPath};
}
export function readUILayout(path:string):UILayout {const bytes=readFileSync(path);if(bytes.length>24*1024*1024)throw new Error('布局 JSON 超过 24 MB。');try{return validateUILayout(JSON.parse(bytes.toString('utf8')));}catch(error){throw new Error('无法打开布局：'+(error instanceof Error?error.message:'JSON 无效'));}}
