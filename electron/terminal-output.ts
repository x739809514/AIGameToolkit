import {stripVTControlCharacters} from 'node:util';
// OSC shell integration can arrive across multiple PTY chunks.
export class ShellOutput {
 pending='';
 constructor(public output:(data:string)=>void,public command:(text:string)=>void,public prompt:(code:number,cwd:string)=>void){}
 feed(data:string){
  this.pending+=data;
  while(this.pending){
   const start=this.pending.indexOf('\x1b]');
   if(start<0){const keep=this.pending.endsWith('\x1b')?1:0;this.output(this.pending.slice(0,this.pending.length-keep));this.pending=this.pending.slice(this.pending.length-keep);return;}
   if(start>0){this.output(this.pending.slice(0,start));this.pending=this.pending.slice(start);}
   const bell=this.pending.indexOf('\x07',2),st=this.pending.indexOf('\x1b\\',2),end=bell<0?st:st<0?bell:Math.min(bell,st);
   if(end<0){if(this.pending.length>65536){this.output(this.pending);this.pending='';}return;}
   const body=this.pending.slice(2,end),whole=this.pending.slice(0,end+(end===bell?1:2));this.pending=this.pending.slice(whole.length);
   if(body.startsWith('633;Laputa;command;'))this.command(Buffer.from(body.slice('633;Laputa;command;'.length),'base64').toString('utf8'));
   else if(body.startsWith('633;Laputa;prompt;')){const [code,cwd]=body.slice('633;Laputa;prompt;'.length).split(';');this.prompt(Number(code)||0,Buffer.from(cwd||'','base64').toString('utf8'));}
   else this.output(whole);
  }
 }
}
export function transcriptText(raw:string){
 return stripVTControlCharacters(raw).replace(/\r\n/g,'\n').replace(/[^\n]*\r/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(-65536);
}
