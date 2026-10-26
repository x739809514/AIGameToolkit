import {lstatSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readPNG} from './image-processing';
export function validateCutoutCropPNG(bytes:unknown):Buffer {
 if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>32_000_000)throw Error('裁切 PNG 超过 32 MB 或数据无效。');
 const buffer=Buffer.from(bytes),image=readPNG(buffer);if(image.width>4096||image.height>4096)throw Error('裁切 PNG 不能超过 4096px。');return buffer;
}
export function writeCutoutCropPNG(path:string,bytes:ArrayBuffer):string {
 const buffer=validateCutoutCropPNG(bytes),target=/\.png$/i.test(path)?path:path+'.png';
 try{if(!lstatSync(target).isFile())throw Error('保存目标须为普通文件，不能替换文件夹或符号链接。');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const temp=target+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,buffer,{flag:'wx'});renameSync(temp,target);}finally{rmSync(temp,{force:true});}return target;
}
