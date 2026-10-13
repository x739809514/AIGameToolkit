import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
export interface CodexEvent {type:string;thread_id?:string;message?:string;error?:{message?:string};item?:{id:string;type:string;text?:string;command?:string;aggregated_output?:string;status?:string}}
export function codexBinary(){const path=['/opt/homebrew/bin/codex','/usr/local/bin/codex',join(homedir(),'.local/bin/codex'),...(process.env.PATH||'').split(':').map(p=>join(p,'codex'))].find(existsSync);if(!path)throw new Error('请先安装 Codex CLI，并在终端执行 codex login 登录。');return path;}
export function startCodex(cwd:string,threadId:string|undefined,text:string,onEvent:(event:CodexEvent)=>void,onDone:(error?:string)=>void){
 const args=['exec','-c','approval_policy="never"','-s','workspace-write'];
 if(threadId)args.push('resume',threadId,'--json','--skip-git-repo-check','-');else args.push('--json','--skip-git-repo-check','-');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;env.PATH='/opt/homebrew/bin:/usr/local/bin:'+(env.PATH||'/usr/bin:/bin');
 const child=spawn(codexBinary(),args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});let buffer='',errors='',ended=false,cancelled=false;
 const done=(error?:string)=>{if(ended)return;ended=true;clearTimeout(timer);onDone(cancelled?'Codex 回复已停止。':error);};
 const timer=setTimeout(()=>{kill();done('Codex 等待超时。');},15*60*1000);
 const consume=(line:string)=>{try{const event=JSON.parse(line) as CodexEvent;onEvent(event);}catch{/* stdout must be JSONL; diagnostics stay out of chat */}};
 child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>2*1024*1024){kill();done('Codex 输出过长。');return;}let at;while((at=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,at));buffer=buffer.slice(at+1);}});
 child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-4000);});child.on('error',error=>done(error.message));child.on('close',code=>{if(buffer.trim())consume(buffer);done(code===0?undefined:errors.trim()||`Codex 进程退出（${code}）。请检查登录状态。`);});
 child.stdin.on('error',()=>{});child.stdin.end(text);
 function kill(){try{globalThis.process.kill(-child.pid!,'SIGTERM');}catch{child.kill('SIGTERM');}}
 return ()=>{cancelled=true;kill();done();};
}
