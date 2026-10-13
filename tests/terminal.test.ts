import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShellOutput,transcriptText} from '../electron/terminal-output';
import {Terminals} from '../electron/terminals';
import {Workbenches} from '../electron/workbenches';
test('shell integration handles split OSC markers and keeps control data out of chat',()=>{
 const commands:string[]=[],prompts:{code:number;cwd:string}[]=[],output:string[]=[];
 const parser=new ShellOutput(d=>output.push(d),text=>commands.push(text),(code,cwd)=>prompts.push({code,cwd}));
 const stream=`\x1b[31mhello\x1b[0m\r\n\x1b]633;Laputa;command;${Buffer.from('printf "你好"').toString('base64')}\x07result\r\n\x1b]633;Laputa;prompt;1;${Buffer.from('/tmp/path with spaces').toString('base64')}\x07`;
 for(const char of stream)parser.feed(char);
 assert.deepEqual(commands,['printf "你好"']);assert.deepEqual(prompts,[{code:1,cwd:'/tmp/path with spaces'}]);assert.equal(transcriptText(output.join('')),'hello\nresult\n');assert.equal(transcriptText('10%\r20%\rFinished\n'),'Finished\n');
});
function shellSubmit(terminals:Terminals,board:string,id:string,text:string){terminals.write(board,id,text+'\r');}
async function until(check:()=>boolean){for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Terminal timeout');}
test('real zsh PTYs isolate split shells, capture commands and exit codes, resize, interrupt and close',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'laputa-terminal-')),profile=join(directory,'profile');mkdirSync(profile);writeFileSync(join(profile,'.zshrc'),'PROMPT="test> "\n');const original=process.env.ZDOTDIR;process.env.ZDOTDIR=profile;
 const manager=new Workbenches(directory,{secure:false,get:()=>undefined,set:()=>{}},()=>{}),entry=manager.create('terminal'),other=manager.create('terminal');
 const terminals=new Terminals(id=>({service:manager.get(id),cwd:manager.treePath(manager.info(id).worktreeId)}),()=>{});
 try{
  const first=terminals.list(entry.id)[0];assert.equal(terminals.list(entry.id).length,1);await until(()=>terminals.session(entry.id,first.id).ready);
  shellSubmit(terminals,entry.id,first.id,'export LAPUTA_PTY_TEST=first; printf "value:%s\\n" "$LAPUTA_PTY_TEST"');await until(()=>terminals.session(entry.id,first.id).state.messages.some(m=>m.role==='assistant'&&m.text.includes('value:first')&&!m.running));
  const second=terminals.create(entry.id,first.id);await until(()=>terminals.session(entry.id,second.id).ready);shellSubmit(terminals,entry.id,second.id,'printf "isolated:%s\\n" "${LAPUTA_PTY_TEST:-empty}"');await until(()=>terminals.session(entry.id,second.id).state.messages.some(m=>m.role==='assistant'&&m.text.includes('isolated:empty')&&!m.running));
  terminals.resize(entry.id,second.id,101,31);shellSubmit(terminals,entry.id,second.id,'stty size');await until(()=>terminals.session(entry.id,second.id).state.messages.some(m=>m.role==='assistant'&&m.text.includes('31 101')));
  await until(()=>!terminals.session(entry.id,second.id).commandRunning);shellSubmit(terminals,entry.id,second.id,'false');await until(()=>terminals.session(entry.id,second.id).state.messages.at(-1)?.exitCode===1);
  terminals.view(entry.id,first.id,'chat');assert.equal(terminals.list(entry.id)[0].view,'chat');assert.throws(()=>terminals.write(other.id,first.id,'echo wrong'),/不存在/);
  shellSubmit(terminals,entry.id,first.id,'sleep 30');await until(()=>terminals.session(entry.id,first.id).commandRunning);await new Promise(r=>setTimeout(r,150));terminals.write(entry.id,first.id,'\x03');await until(()=>!terminals.session(entry.id,first.id).commandRunning);
  terminals.close(entry.id,second.id);await until(()=>{try{process.kill(second.pid,0);return false;}catch{return true;}});assert.equal(terminals.list(entry.id).length,1);assert.throws(()=>terminals.write(entry.id,second.id,'echo closed'),/不存在/);
  terminals.close(entry.id,first.id);assert.deepEqual(terminals.list(entry.id),[]);assert.equal(manager.get(entry.id).store.load().terminalWorkspace!.panes.length,0);
 }finally{terminals.closeAll();manager.close();if(original===undefined)delete process.env.ZDOTDIR;else process.env.ZDOTDIR=original;}
});
test('restart retains chat history and pane layout while starting fresh shells without replaying old commands',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'laputa-terminal-restart-')),vault={secure:false,get:()=>undefined,set:()=>{}};
 let manager=new Workbenches(directory,vault,()=>{}),terminals=new Terminals(id=>({service:manager.get(id),cwd:manager.treePath(manager.info(id).worktreeId)}),()=>{});
 const entry=manager.create('terminal');
 try{
  const first=terminals.list(entry.id)[0];await until(()=>terminals.session(entry.id,first.id).ready);
  shellSubmit(terminals,entry.id,first.id,'printf "restart-message\\n"');await until(()=>terminals.session(entry.id,first.id).state.messages.some(m=>m.role==='assistant'&&m.text.includes('restart-message')&&!m.running));
  terminals.view(entry.id,first.id,'chat');terminals.closeAll();manager.close();
  manager=new Workbenches(directory,vault,()=>{});terminals=new Terminals(id=>({service:manager.get(id),cwd:manager.treePath(manager.info(id).worktreeId)}),()=>{});
  const restored=terminals.list(entry.id);assert.equal(restored.length,1);assert.equal(restored[0].id,first.id);assert.equal(restored[0].view,'chat');assert.notEqual(restored[0].pid,first.pid);assert.ok(restored[0].messages.some(m=>m.role==='assistant'&&m.text.includes('restart-message')));
  await until(()=>terminals.session(entry.id,first.id).ready);assert.equal(terminals.session(entry.id,first.id).state.messages.filter(m=>m.role==='user').length,1);
 }finally{terminals.closeAll();manager.close();}
});

test('natural-language chat is sent to Codex, keeps pane threads and can cancel without executing it in zsh',async()=>{const directory=mkdtempSync(join(tmpdir(),'laputa-codex-')),manager=new Workbenches(directory,{secure:false,get:()=>undefined,set:()=>{}},()=>{}),entry=manager.create('terminal');const completed:string[]=[];const turns:{thread:string|undefined;text:string;event:(e:any)=>void;done:(error?:string)=>void}[]=[];const terminals=new Terminals(id=>({service:manager.get(id),cwd:manager.treePath(manager.info(id).worktreeId)}),()=>{},(_cwd,thread,text,event,done)=>{turns.push({thread,text,event,done});return()=>done('已停止');},undefined,(_id,event)=>completed.push(event.label));try{const pane=terminals.list(entry.id)[0];terminals.submit(entry.id,pane.id,'帮我解释项目');assert.equal(turns[0].text,'帮我解释项目');assert.equal(turns[0].thread,undefined);assert.equal(terminals.snapshot(terminals.session(entry.id,pane.id)).codexRunning,true);assert.throws(()=>terminals.submit(entry.id,pane.id,'重复发送'));turns[0].event({type:'thread.started',thread_id:'thread-one'});turns[0].event({type:'item.completed',item:{id:'reply',type:'agent_message',text:'这是你的项目'}});turns[0].done();assert.deepEqual(completed,['Codex 回复']);assert.equal(terminals.session(entry.id,pane.id).state.messages.at(-1)?.text,'这是你的项目');terminals.submit(entry.id,pane.id,'继续');assert.equal(turns[1].thread,'thread-one');terminals.cancelCodex(entry.id,pane.id);assert.equal(terminals.snapshot(terminals.session(entry.id,pane.id)).codexRunning,false);assert.deepEqual(completed,['Codex 回复']);const second=terminals.create(entry.id);terminals.submit(entry.id,second.id,'你好');assert.equal(turns[2].thread,undefined);turns[2].event({type:'turn.failed',error:{message:'失败'}});turns[2].done();assert.deepEqual(completed,['Codex 回复']);await until(()=>terminals.session(entry.id,pane.id).ready);assert.ok(!terminals.session(entry.id,pane.id).history.includes('帮我解释项目'));assert.equal(manager.get(entry.id).store.load().terminalWorkspace?.panes[0].codexThreadId,'thread-one');}finally{terminals.closeAll();manager.close();}});
