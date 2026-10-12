import { PNG } from 'pngjs';
export interface CropRect {x:number;y:number;width:number;height:number}
export function readPNG(bytes:Buffer){
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('编辑图片和遮罩必须是 PNG。');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width*height>16000000)throw new Error('编辑图片最多支持 1600 万像素。');
  return PNG.sync.read(bytes);
}
export function validateMask(source:Buffer,mask:Buffer){
  if(mask.length>4*1024*1024)throw new Error('圈选遮罩须小于 4 MB。');
  const image=readPNG(source),selection=readPNG(mask);
  if(image.width!==selection.width||image.height!==selection.height)throw new Error('遮罩尺寸与原图不一致。');
  let selected=false;for(let i=3;i<selection.data.length;i+=4)if(selection.data[i]<255){selected=true;break;}
  if(!selected)throw new Error('请先圈选需要修改的区域。');
  return selection;
}
export function cropPNG(bytes:Buffer,rect:CropRect){
  const image=readPNG(bytes);const {x,y,width,height}=rect;
  if(![x,y,width,height].every(Number.isSafeInteger)||x<0||y<0||width<1||height<1||x+width>image.width||y+height>image.height)throw new Error('裁切区域必须在图片范围内，宽高至少为 1 像素。');
  const result=new PNG({width,height});for(let row=0;row<height;row++)image.data.copy(result.data,row*width*4,((y+row)*image.width+x)*4,((y+row)*image.width+x+width)*4);
  return PNG.sync.write(result);
}
export function compositeSelection(source:Buffer,generated:Buffer,mask:Buffer){
  const image=readPNG(source),result=readPNG(generated),selection=validateMask(source,mask);
  if(image.width!==result.width||image.height!==result.height)throw new Error('修改结果尺寸与原图不一致。');
  for(let i=0;i<image.data.length;i+=4){const weight=1-selection.data[i+3]/255;if(weight===0)continue;for(let c=0;c<4;c++)image.data[i+c]=Math.round(image.data[i+c]*(1-weight)+result.data[i+c]*weight);}
  return PNG.sync.write(image);
}
export function hasTransparency(bytes:Buffer){const png=readPNG(bytes);for(let i=3;i<png.data.length;i+=4)if(png.data[i]<255)return true;return false;}
