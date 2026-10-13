const {app,BrowserWindow}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),data=mkdtempSync('/private/tmp/laputa-terminal-desktop-'),output=join(root,'output/terminal-review');mkdirSync(output,{recursive:true});
process.env.ZDOTDIR=join(data,'shell-profile');mkdirSync(process.env.ZDOTDIR);writeFileSync(join(process.env.ZDOTDIR,'.zshrc'),'PROMPT="laputa> "\n');process.env.TOOLKIT_DATA_DIR=data;delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
require(process.env.TERMINAL_TEST_PACKAGED?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let win;
const js=code=>win.webContents.executeJavaScript(code,true).catch(error=>{throw new Error(code+'\n'+error.message);});
async function until(code){for(let i=0;i<300;i++){if(await js(code))return;await sleep(100);}throw new Error('Timed out: '+code);}
async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function shot(name){await sleep(150);writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function fill(selector,text){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
setTimeout(()=>{console.error('Terminal desktop smoke timeout');app.exit(2);},180000);
app.whenReady().then(async()=>{try{
 for(let i=0;i<50;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await sleep(100);}win.webContents.setBackgroundThrottling(false);
 await until('!!document.querySelector("[data-template-id=terminal]")');await click('[data-template-id=terminal]');await until('!!document.querySelector(".new-workbench-dialog")');await js('document.querySelector(".new-workbench-dialog form")?.requestSubmit()||document.querySelector("form.new-workbench-dialog").requestSubmit()');
 await until('document.querySelectorAll(".terminal-pane").length===1');await until('window.toolkit.terminalSessions().then(p=>p[0]?.ready)');const first=(await js('window.toolkit.terminalSessions()'))[0];
 await js('document.querySelector(".xterm-helper-textarea").focus()');win.webContents.insertText('export LAPUTA_DESKTOP_TEST=first; printf "keyboard:%s\\n" "$LAPUTA_DESKTOP_TEST"');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
 await until('window.toolkit.terminalSessions().then(p=>p[0].messages.some(m=>m.role==="assistant"&&m.text.includes("keyboard:first")&&!m.running))');await shot('terminal-single');
 await click('[aria-label="Split Terminal Right"]');await until('document.querySelectorAll(".terminal-pane").length===2');await until('window.toolkit.terminalSessions().then(p=>p[1]?.ready)');let panes=await js('window.toolkit.terminalSessions()');const second=panes[1];assert.notEqual(first.pid,second.pid);
 await js(`window.toolkit.writeTerminal(${JSON.stringify(second.id)},${JSON.stringify('printf "separate:%s\\n" "${LAPUTA_DESKTOP_TEST:-empty}"\r')})`);await until('window.toolkit.terminalSessions().then(p=>p[1].messages.some(m=>m.role==="assistant"&&m.text.includes("separate:empty")&&!m.running))');await shot('terminal-split');
 assert.equal(await js('!!document.querySelector(".workspace-heading")'),false);
 await click(`[data-terminal-id="${first.id}"] [aria-label="Show Chat View"]`);await until('!!document.querySelector(".terminal-chat-welcome")');await fill('.terminal-chat-composer textarea','请记住口令：青色火箭。只回复这个口令，不调用工具。');await click(`[aria-label="发送到 ${first.name}"]`);await until('Array.from(document.querySelectorAll(".terminal-chat-message.assistant")).some(e=>e.textContent.includes("青色火箭"))');await until('window.toolkit.terminalSessions().then(p=>!p[0].codexRunning)');assert.equal((await js('window.toolkit.terminalSessions()'))[0].pid,first.pid);await shot('terminal-chat');
 await fill('.terminal-chat-composer textarea','我刚才给你的口令是什么？只回复口令，不调用工具。');await click(`[aria-label="发送到 ${first.name}"]`);await until('window.toolkit.terminalSessions().then(p=>p[0].messages.filter(m=>m.kind==="codex"&&m.role==="assistant"&&m.text.includes("青色火箭")&&!m.running).length===2)');
 await fill('.terminal-chat-composer textarea','只回复停止测试，不调用工具。');await click(`[aria-label="发送到 ${first.name}"]`);await until('!!document.querySelector(".terminal-chat-composer .secondary")');await click('.terminal-chat-composer .secondary');await until('window.toolkit.terminalSessions().then(p=>!p[0].codexRunning)');
 await click('[aria-label="Show Terminal View"]');await until('document.querySelector(".terminal-pane").dataset.view==="terminal"');assert.equal((await js('window.toolkit.terminalSessions()'))[0].pid,first.pid);
 win.setSize(1080,740);await sleep(250);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);await shot('terminal-compact');
 const current=await js('window.toolkit.currentWorkbench()');await js('window.toolkit.createWorkbench({type:"image-video",name:"媒体工作台"})');await until('!!document.querySelector(".workbench")');await js(`window.toolkit.openWorkbench(${JSON.stringify(current)})`);await until('document.querySelectorAll(".terminal-pane").length===2');assert.equal((await js('window.toolkit.terminalSessions()'))[0].pid,first.pid);
 await click(`[aria-label="Close ${second.name}"]`);await until('document.querySelectorAll(".terminal-pane").length===1');await assert.rejects(()=>js(`window.toolkit.writeTerminal(${JSON.stringify(second.id)},'echo closed')`),/不存在/);
 await click(`[aria-label="Close ${first.name}"]`);await until('!!document.querySelector(".terminal-empty button")');assert.equal((await js('window.toolkit.terminalSessions()')).length,0);await click('.terminal-empty button');await until('document.querySelectorAll(".terminal-pane").length===1');await shot('terminal-reopened');
 console.log('Terminal desktop passed: template creation; keyboard input into real PTY; independent split shells; natural-language Codex chat and remembered follow-up; same PID across view/workbench switching; stop Codex reply; close last pane and reopen; compact layout.');app.exit(0);
 }catch(error){console.error(error);if(win)await shot('terminal-failure').catch(()=>{});app.exit(1);}});
