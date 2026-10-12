export function parseRange(header:string|null,size:number):{start:number;end:number;partial:boolean}|undefined{
  if(!header)return {start:0,end:size-1,partial:false};
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);if(!m||!m[1]&&!m[2]||size<=0)return;
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start||!m[1]&&Number(m[2])<=0)return;
  return {start,end,partial:true};
}
