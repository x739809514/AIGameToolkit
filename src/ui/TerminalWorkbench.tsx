import {useEffect,useRef,useState} from 'react';
import {Terminal as XTerminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {TerminalSquare,MessageSquare,SquareSplitHorizontal,X,Plus,ArrowUp,Square,Copy,Check} from 'lucide-react';
import type {TerminalPane,TerminalEvent} from '../shared/terminal';
import {useWorkbenchAPI} from './workbench-api';
export function TerminalWorkbench({theme}:{theme:'light'|'dark'}){
 const api=useWorkbenchAPI(),[panes,setPanes]=useState<TerminalPane[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');const panesRef=useRef(panes);panesRef.current=panes;const listeners=useRef(new Map<string,(event:TerminalEvent)=>void>());
 useEffect(()=>{let live=true;const queued:TerminalEvent[]=[];let ready=false;
  const receive=(event:TerminalEvent)=>{if(!ready){queued.push(event);return;}listeners.current.get(event.pane.id)?.(event);setPanes(old=>old.map(p=>p.id===event.pane.id&&event.pane.sequence>p.sequence?{...event.pane,history:(p.history+event.data).slice(-2*1024*1024)}:p));};
  const unsub=api.onTerminalEvent(receive);void api.terminalSessions().then(next=>{if(live){setPanes(next);setLoading(false);ready=true;for(const event of queued)receive(event);}}).catch(e=>{if(live){setError(e.message);setLoading(false);}});return()=>{live=false;unsub();};
 },[api]);
 async function act(fn:()=>Promise<unknown>){setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'终端操作失败');}}
 async function create(afterId?:string){await act(async()=>{const pane=await api.createTerminal(afterId);setPanes(old=>{if(old.some(p=>p.id===pane.id))return old;const next=[...old],index=afterId?old.findIndex(p=>p.id===afterId)+1:old.length;next.splice(index,0,pane);return next;});});}
 async function close(id:string){await act(async()=>{await api.closeTerminal(id);listeners.current.delete(id);setPanes(old=>old.filter(p=>p.id!==id));});}
 return <main className="terminal-workbench" aria-label="终端工作台">{error&&<div className="terminal-error" role="alert">{error}<button className="icon-button" aria-label="关闭终端错误" onClick={()=>setError('')}><X size={14}/></button></div>}
  {loading?<div className="terminal-empty">正在打开终端…</div>:panes.length?<div className="terminal-splits">{panes.map(pane=><TerminalPanel key={pane.id} pane={pane} theme={theme} events={listeners.current} split={()=>void create(pane.id)} close={()=>void close(pane.id)} act={act}/>)}</div>:<div className="terminal-empty"><TerminalSquare size={42}/><h2>打开一个终端</h2><p>在当前 Worktree 中运行命令，或启动你的开发工具。</p><button className="secondary" onClick={()=>void create()}><Plus size={15}/>New Terminal</button></div>}
 </main>;
}
function TerminalPanel({pane,theme,events,split,close,act}:{pane:TerminalPane;theme:'light'|'dark';events:Map<string,(event:TerminalEvent)=>void>;split:()=>void;close:()=>void;act:(fn:()=>Promise<unknown>)=>Promise<void>}){
 const api=useWorkbenchAPI(),host=useRef<HTMLDivElement>(null),terminal=useRef<XTerminal|undefined>(undefined),fit=useRef<FitAddon|undefined>(undefined),sequence=useRef(pane.sequence),messages=useRef<HTMLDivElement>(null),[input,setInput]=useState(''),[copied,setCopied]=useState<string>();
 useEffect(()=>{
  const t=new XTerminal({fontFamily:'"SFMono-Regular", Menlo, Monaco, Consolas, monospace',fontSize:12,lineHeight:1.35,scrollback:10000,cursorBlink:true,allowProposedApi:false});const addon=new FitAddon();t.loadAddon(addon);terminal.current=t;fit.current=addon;t.open(host.current!);if(pane.history)t.write(pane.history);sequence.current=pane.sequence;
  events.set(pane.id,event=>{if(event.pane.sequence>sequence.current){sequence.current=event.pane.sequence;if(event.data)t.write(event.data);}});
  const data=t.onData(text=>{void act(()=>api.writeTerminal(pane.id,text));});const resize=t.onResize(size=>{void act(()=>api.resizeTerminal(pane.id,size.cols,size.rows));});let timer:ReturnType<typeof setTimeout>;
  const observer=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{if(host.current?.offsetWidth&&host.current.offsetHeight){addon.fit();}},40);});observer.observe(host.current!);t.focus();
  return()=>{clearTimeout(timer);observer.disconnect();data.dispose();resize.dispose();events.delete(pane.id);t.dispose();terminal.current=undefined;};
 },[api,pane.id]);
 useEffect(()=>{if(terminal.current)terminal.current.options.theme=theme==='dark'?{background:'#171717',foreground:'#dedede',cursor:'#eeeeee',selectionBackground:'#ffffff30'}:{background:'#ffffff',foreground:'#252525',cursor:'#252525',selectionBackground:'#00000025'};},[theme]);
 useEffect(()=>{if(pane.view==='terminal'){fit.current?.fit();terminal.current?.focus();}},[pane.view]);
 useEffect(()=>{if(pane.view==='chat')messages.current?.scrollTo({top:messages.current.scrollHeight,behavior:'smooth'});},[pane.messages,pane.view]);
 async function send(){if(!input.trim())return;await act(async()=>{await api.submitTerminal(pane.id,input);setInput('');});}
 async function copy(id:string,text:string){await act(async()=>{await navigator.clipboard.writeText(text);setCopied(id);setTimeout(()=>setCopied(undefined),1500);});}
 return <section className="terminal-pane" data-terminal-id={pane.id} data-view={pane.view}>
  <div className="terminal-pane-heading"><div><TerminalSquare size={15}/><strong>{pane.name}</strong><span className={`terminal-status ${pane.running?'running':''}`}/><small>{pane.view==='chat'?'Codex':pane.running?'zsh':`Exited ${pane.exitCode??0}`}</small></div><div className="terminal-pane-actions"><button className="icon-button" aria-label={pane.view==='terminal'?'Show Chat View':'Show Terminal View'} title={pane.view==='terminal'?'Show Chat View':'Show Terminal View'} onClick={()=>void act(()=>api.setTerminalView(pane.id,pane.view==='terminal'?'chat':'terminal'))}>{pane.view==='terminal'?<MessageSquare size={15}/>:<TerminalSquare size={15}/>}</button><button className="icon-button" aria-label="Split Terminal Right" title="Split Terminal Right" onClick={split}><SquareSplitHorizontal size={15}/></button><button className="icon-button" aria-label={`Close ${pane.name}`} title="Close Terminal" onClick={close}><X size={15}/></button></div></div>
  <div className="terminal-cwd" title={pane.cwd}>{pane.cwd}</div>
  <div className="terminal-screen" ref={host} style={{display:pane.view==='terminal'?'block':'none'}}/>
  {pane.view==='chat'&&<div className="terminal-chat"><div className="terminal-chat-messages" ref={messages}>{pane.messages.some(m=>m.kind==='codex')?pane.messages.filter(m=>m.kind==='codex').map(message=><article className={`terminal-chat-message ${message.role}`} key={message.id}><div className="terminal-message-label">{message.role==='user'?'你':'Codex'}<span>{message.running?'回复中…':message.exitCode!==undefined?`Exit ${message.exitCode}`:''}</span><button className="icon-button" aria-label="复制消息" onClick={()=>void copy(message.id,message.text)}>{copied===message.id?<Check size={13}/>:<Copy size={13}/>}</button></div><pre>{message.text|| (message.running?'等待 Codex 回复…':'Codex 未返回文本。')}</pre></article>):<div className="terminal-chat-welcome"><MessageSquare size={30}/><h3>与 Codex 聊天</h3><p>用自然语言描述你的问题或任务，Codex 将在当前 Worktree 中处理。</p></div>}</div>
   <div className="terminal-chat-composer"><textarea aria-label={`${pane.name} 聊天输入`} value={input} disabled={pane.codexRunning} placeholder="向 Codex 描述你想做的事情…" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>Enter 发送 · Shift + Enter 换行</span>{pane.codexRunning?<button className="secondary compact" aria-label="停止 Codex 回复" onClick={()=>void act(()=>api.cancelCodex(pane.id))}><Square size={12}/>停止</button>:<button className="generate-button" aria-label={`发送到 ${pane.name}`} disabled={pane.codexRunning||!input.trim()} onClick={()=>void send()}><ArrowUp size={15}/></button>}</div></div>{pane.codexRunning&&<p className="terminal-interactive-hint">Codex 正在处理当前任务。</p>}
  </div>}
 </section>;
}
