import type {TaskCompletion} from './task-notifications';
import {startCodex} from './codex-chat';
import {spawn,type IPty} from 'node-pty';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ShellOutput,transcriptText} from './terminal-output';
import type {Service} from './service';
import type {TerminalPane,TerminalPaneState,TerminalEvent,TerminalView} from '../src/shared/terminal';
interface Session {workbenchId:string;service:Service;state:TerminalPaneState;pty:IPty;cwd:string;cols:number;rows:number;running:boolean;ready:boolean;commandRunning:boolean;submitting:boolean;history:string;rawOutput:string;sequence:number;timer?:ReturnType<typeof setTimeout>;pending:string;filesChanged?:boolean;exitCode?:number;closing?:boolean;stop:()=>void}
const shellFiles={
 '.zshenv':`typeset -g LAPUTA_INTEGRATION_DIR="$ZDOTDIR"
if [[ -f "$LAPUTA_USER_ZDOTDIR/.zshenv" ]]; then source "$LAPUTA_USER_ZDOTDIR/.zshenv"; fi
ZDOTDIR="$LAPUTA_INTEGRATION_DIR"
`,
 '.zprofile':`if [[ -f "$LAPUTA_USER_ZDOTDIR/.zprofile" ]]; then source "$LAPUTA_USER_ZDOTDIR/.zprofile"; fi
ZDOTDIR="$LAPUTA_INTEGRATION_DIR"
`,
 '.zshrc':`if [[ -f "$LAPUTA_USER_ZDOTDIR/.zshrc" ]]; then source "$LAPUTA_USER_ZDOTDIR/.zshrc"; fi
function _laputa_preexec() {
 local encoded="$(printf '%s' "$1" | /usr/bin/base64)"
 printf '\\033]633;Laputa;command;%s\\007' "\${encoded//$'\\n'/}"
}
function _laputa_precmd() {
 local result=$? encoded="$(printf '%s' "$PWD" | /usr/bin/base64)"
 printf '\\033]633;Laputa;prompt;%s;%s\\007' "$result" "\${encoded//$'\\n'/}"
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec _laputa_preexec
add-zsh-hook precmd _laputa_precmd
ZDOTDIR="$LAPUTA_INTEGRATION_DIR"
`,
 '.zlogin':`if [[ -f "$LAPUTA_USER_ZDOTDIR/.zlogin" ]]; then source "$LAPUTA_USER_ZDOTDIR/.zlogin"; fi
`,
};
export class Terminals {
 sessions=new Map<string,Session>();
 codexJobs=new Map<string,()=>void>();
 constructor(public owner:(id:string)=>{service:Service;cwd:string},public emit:(event:TerminalEvent)=>void,public codex=startCodex,public shellDirectory?:string,public onComplete:(id:string,event:TaskCompletion)=>void=()=>{}){}
 scope(workbenchId:string){const owner=this.owner(workbenchId);if(owner.service.workspace.workbenchType!=='terminal')throw new Error('请在终端工作台操作。');return owner;}
 session(workbenchId:string,id:string){this.scope(workbenchId);const s=this.sessions.get(id);if(!s||s.workbenchId!==workbenchId||s.closing)throw new Error('此终端会话不存在。');return s;}
 snapshot(s:Session):TerminalPane{return {...structuredClone(s.state),pid:s.pty.pid,cwd:s.cwd,cols:s.cols,rows:s.rows,running:s.running,ready:s.ready,commandRunning:s.commandRunning||s.submitting,codexRunning:this.codexJobs.has(s.state.id),history:s.history,sequence:s.sequence,exitCode:s.exitCode};}
 list(workbenchId:string){const {service,cwd}=this.scope(workbenchId);if(!service.workspace.terminalWorkspace){service.workspace.terminalWorkspace={panes:[]};this.create(workbenchId);}
  for(const state of service.workspace.terminalWorkspace!.panes)if(!this.sessions.has(state.id))this.launch(workbenchId,service,state,cwd);
  // Establish a replay boundary before returning the screen snapshot. Otherwise
  // a pending event can append the same output again after remounting a pane.
  for(const state of service.workspace.terminalWorkspace!.panes){const s=this.session(workbenchId,state.id);if(s.timer||s.pending)this.flush(s);}
  return service.workspace.terminalWorkspace!.panes.map(state=>this.snapshot(this.session(workbenchId,state.id)));
 }
 create(workbenchId:string,afterId?:string){const {service,cwd}=this.scope(workbenchId);const state=service.workspace.terminalWorkspace??={panes:[]};if(state.panes.length>=8)throw new Error('一个工作台最多打开 8 个终端。');const previous=afterId?this.session(workbenchId,afterId):undefined;
  const pane:TerminalPaneState={id:randomUUID(),name:`Terminal ${Math.max(0,...state.panes.map(p=>Number(p.name.match(/\d+$/)?.[0])||0))+1}`,view:'terminal',messages:[]};
  const session=this.launch(workbenchId,service,pane,previous?.cwd||cwd);const index=afterId?state.panes.findIndex(p=>p.id===afterId)+1:state.panes.length;state.panes.splice(index,0,pane);service.changed();return this.snapshot(session);
 }
 launch(workbenchId:string,service:Service,state:TerminalPaneState,cwd:string){
  for(const message of state.messages)if(message.kind==='codex'&&message.running){message.running=false;message.text+='\n上次回复被应用退出中断，可以继续发送。';}
  // macOS zsh may fail to load integration when ZDOTDIR contains Unicode project
  // names. Keep its private configuration in the app profile, separate from cwd.
  const integration=join(this.shellDirectory||service.store.directory,'.terminal-shell',state.id);mkdirSync(integration,{recursive:true,mode:0o700});for(const [name,code]of Object.entries(shellFiles))writeFileSync(join(integration,name),code,{mode:0o600});
  const env:Record<string,string>={};for(const [key,value]of Object.entries(process.env))if(value!==undefined&&!['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','TOOLKIT_DATA_DIR','TOOLKIT_DEV_URL','TOOLKIT_SELF_TEST_OUTPUT','TOOLKIT_SELF_TEST_FIXTURES'].includes(key))env[key]=value;
  Object.assign(env,{TERM:'xterm-256color',COLORTERM:'truecolor',TERM_PROGRAM:'Laputa',LAPUTA_USER_ZDOTDIR:process.env.ZDOTDIR||homedir(),ZDOTDIR:integration});
  const pty=spawn('/bin/zsh',['-il'],{name:'xterm-256color',cols:80,rows:24,cwd:existsSync(cwd)?cwd:service.store.directory,env});
  const s:Session={workbenchId,service,state,pty,cwd,cols:80,rows:24,running:true,ready:false,commandRunning:false,submitting:false,history:'',rawOutput:'',sequence:0,pending:'',stop:()=>{}};
  this.sessions.set(state.id,s);
  const output=new ShellOutput(data=>{if(!data)return;s.history=(s.history+data).slice(-2*1024*1024);s.pending+=data;if(s.commandRunning){s.rawOutput=(s.rawOutput+data).slice(-65536);const message=s.state.messages.at(-1);if(message?.role==='assistant'&&message.kind!=='codex')message.text=transcriptText(s.rawOutput);}if(s.pending.length>256*1024)s.pty.pause();this.schedule(s);},command=>{
   s.submitting=false;s.commandRunning=true;s.rawOutput='';s.state.messages.push({id:randomUUID(),role:'user',kind:'shell',text:command,createdAt:Date.now()},{id:randomUUID(),role:'assistant',kind:'shell',text:'',createdAt:Date.now(),running:true});this.schedule(s);
  },(code,current)=>{s.ready=true;if(current)s.cwd=current;const last=s.state.messages.at(-1);if(s.commandRunning&&last?.role==='assistant'&&last.kind!=='codex'){last.exitCode=code;last.running=false;s.filesChanged=true;if(code===0&&!s.closing)this.onComplete(workbenchId,{id:`shell:${last.id}`,label:'Shell 命令'});}s.commandRunning=false;s.submitting=false;this.schedule(s);});
  const data=pty.onData(chunk=>output.feed(chunk)),exit=pty.onExit(event=>{s.running=false;s.commandRunning=false;s.submitting=false;s.exitCode=event.exitCode;const last=s.state.messages.at(-1);if(last?.running&&last.kind!=='codex'){last.running=false;last.exitCode=event.exitCode;}if(!s.closing)this.flush(s);});
  s.stop=()=>{data.dispose();exit.dispose();};return s;
 }
 schedule(s:Session){if(!s.timer)s.timer=setTimeout(()=>this.flush(s),100);}
 flush(s:Session){clearTimeout(s.timer);s.timer=undefined;if(s.closing||s.service.closed)return;s.sequence++;
  let size=0;s.state.messages=s.state.messages.slice(-200).reverse().filter(m=>{size+=m.text.length;return size<=512*1024;}).reverse();
  // Save transcript without waking every workspace panel for every PTY chunk.
  s.service.store.save(s.service.workspace);
  const {history,...pane}=this.snapshot(s);const data=s.pending;s.pending='';if(s.running)s.pty.resume();const filesChanged=s.filesChanged;s.filesChanged=false;this.emit({workbenchId:s.workbenchId,pane,data,filesChanged});
 }
 write(workbenchId:string,id:string,data:string){const s=this.session(workbenchId,id);if(!s.running)throw new Error('终端进程已退出，请新建终端。');if(typeof data!=='string'||data.length>1024*1024)throw new Error('终端输入过长。');s.pty.write(data);}
 submit(workbenchId:string,id:string,text:string){const s=this.session(workbenchId,id);if(this.codexJobs.has(id))throw new Error('Codex 正在回复，请等待或停止当前回复。');if(typeof text!=='string'||!text.trim()||text.length>30000)throw new Error('请输入不超过 30000 字符的消息。');
  const response={id:randomUUID(),role:'assistant' as const,kind:'codex' as const,text:'',createdAt:Date.now(),running:true};s.state.messages.push({id:randomUUID(),role:'user',kind:'codex',text,createdAt:Date.now()},response);
  let failed=false,cancelled=false;const parts=new Map<string,string>();this.codexJobs.set(id,()=>{});
  try{const stop=this.codex(this.scope(workbenchId).cwd,s.state.codexThreadId,text,event=>{if(s.closing)return;if(event.type==='thread.started'&&event.thread_id)s.state.codexThreadId=event.thread_id;
   const item=event.item;if(item?.type==='agent_message'&&item.text!==undefined){parts.set(item.id,item.text);response.text=[...parts.values()].join('\n\n');}
   if(event.type==='error'||event.type==='turn.failed'){failed=true;if(event.message||event.error?.message)response.text+='\n'+(event.message||event.error?.message);}
   this.schedule(s);
  },error=>{this.codexJobs.delete(id);response.running=false;if(error)response.text+=(response.text?'\n\n':'')+error;if(!response.text)response.text='Codex 未返回文本。';s.filesChanged=true;if(!s.closing){this.flush(s);if(!error&&!failed&&!cancelled)this.onComplete(workbenchId,{id:`codex:${response.id}`,label:'Codex 回复'});}});if(this.codexJobs.has(id))this.codexJobs.set(id,()=>{cancelled=true;stop();});this.schedule(s);
  }catch(e){this.codexJobs.delete(id);response.running=false;response.text=(e as Error).message;this.flush(s);throw e;}
 }
 cancelCodex(workbenchId:string,id:string){this.session(workbenchId,id);this.codexJobs.get(id)?.();}

 resize(workbenchId:string,id:string,cols:number,rows:number){const s=this.session(workbenchId,id);if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>1000||rows<1||rows>500)throw new Error('终端尺寸不合法。');if(s.running)s.pty.resize(cols,rows);s.cols=cols;s.rows=rows;}
 view(workbenchId:string,id:string,view:TerminalView){if(!['terminal','chat'].includes(view))throw new Error('终端视图不支持。');const s=this.session(workbenchId,id);s.state.view=view;s.service.changed();this.flush(s);}
 close(workbenchId:string,id:string){const s=this.session(workbenchId,id);this.dispose(s);const state=s.service.workspace.terminalWorkspace!;state.panes=state.panes.filter(p=>p.id!==id);s.service.changed();}
 dispose(s:Session){s.closing=true;this.codexJobs.get(s.state.id)?.();this.codexJobs.delete(s.state.id);clearTimeout(s.timer);s.stop();if(s.running){try{process.kill(-s.pty.pid,'SIGHUP');}catch{}try{s.pty.kill();}catch{}}this.sessions.delete(s.state.id);}
 closeWorkbench(id:string){for(const s of [...this.sessions.values()])if(s.workbenchId===id)this.dispose(s);}
 closeAll(){for(const s of [...this.sessions.values()]){if(!s.service.closed)this.flush(s);this.dispose(s);}}
}
