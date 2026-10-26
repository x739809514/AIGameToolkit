export interface CutoutCropRect {x:number;y:number;width:number;height:number}
export function fitCutoutCrop(rect:CutoutCropRect,width:number,height:number):CutoutCropRect {
 const w=Math.max(1,Math.min(width,Math.round(rect.width))),h=Math.max(1,Math.min(height,Math.round(rect.height)));
 return {x:Math.max(0,Math.min(width-w,Math.round(rect.x))),y:Math.max(0,Math.min(height-h,Math.round(rect.y))),width:w,height:h};
}
export function validCutoutCrop(rect:CutoutCropRect,width:number,height:number):boolean {
 return !!rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isSafeInteger)&&rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0&&rect.x+rect.width<=width&&rect.y+rect.height<=height;
}
export function dragCutoutCrop(rect:CutoutCropRect,start:{x:number;y:number},end:{x:number;y:number},handle:string,width:number,height:number):CutoutCropRect {
 const dx=Math.round(end.x-start.x),dy=Math.round(end.y-start.y);
 if(handle==='move')return fitCutoutCrop({...rect,x:rect.x+dx,y:rect.y+dy},width,height);
 if(handle==='new'){const x=Math.max(0,Math.min(width-1,Math.round(Math.min(start.x,end.x)))),y=Math.max(0,Math.min(height-1,Math.round(Math.min(start.y,end.y))));return fitCutoutCrop({x,y,width:Math.max(1,Math.round(Math.max(start.x,end.x))-x),height:Math.max(1,Math.round(Math.max(start.y,end.y))-y)},width,height);}
 let left=rect.x,right=rect.x+rect.width,top=rect.y,bottom=rect.y+rect.height;
 if(handle.includes('w'))left=Math.max(0,Math.min(right-1,left+dx));if(handle.includes('e'))right=Math.min(width,Math.max(left+1,right+dx));
 if(handle.includes('n'))top=Math.max(0,Math.min(bottom-1,top+dy));if(handle.includes('s'))bottom=Math.min(height,Math.max(top+1,bottom+dy));
 return {x:left,y:top,width:right-left,height:bottom-top};
}
