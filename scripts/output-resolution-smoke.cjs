const {app,BrowserWindow}=require('electron');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),out=join(root,'output/output-resolution-review');mkdirSync(out,{recursive:true});
process.env.TOOLKIT_DATA_DIR=mkdtempSync('/private/tmp/laputa-resolution-ui-');delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
require(process.argv.includes('--packaged')?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
let win;const sleep=ms=>new Promise(r=>setTimeout(r,ms)),js=s=>win.webContents.executeJavaScript(s,true);
async function until(s){for(let i=0;i<250;i++){if(await js(s))return;await sleep(60);}throw Error('Timeout: '+s);}
async function set(selector,value){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await sleep(100);}
setTimeout(()=>app.exit(2),90000);
app.whenReady().then(async()=>{try{
 for(let i=0;i<100&&!BrowserWindow.getAllWindows().length;i++)await sleep(100);win=BrowserWindow.getAllWindows()[0];win.setBounds({x:30,y:20,width:1500,height:1080});win.webContents.setBackgroundThrottling(false);win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});win.hide();
 await until('!!window.toolkit');await js('window.toolkit.createWorkbench({type:"image-video",name:"精确尺寸验证"})');await until('!!document.querySelector(".output-resolution")');
 assert.equal(await js('document.querySelectorAll(".chat-panel .output-resolution").length'),0);assert.equal(await js('document.querySelectorAll(".preview-panel > .output-resolution").length'),2);assert.ok(await js('Array.from(document.querySelectorAll(".preview-panel > .output-resolution")).every(e=>e.previousElementSibling.classList.contains("preview-bottom"))'));
 await set('[aria-label="图片创作输出宽度"]',777);await set('[aria-label="图片创作输出高度"]',1111);await set('[aria-label="图片创作尺寸适配"]','crop-scale');
 await set('[aria-label="视频创作尺寸预设"]','1080x1920');await set('[aria-label="视频创作尺寸适配"]','contain');
 let drafts=await js('window.toolkit.boot().then(b=>b.workspace.drafts)');assert.deepEqual(drafts.image.outputResolution,{width:777,height:1111,fit:'crop-scale'});assert.deepEqual(drafts.video.outputResolution,{width:1080,height:1920,fit:'contain'});
 win.webContents.reload();await until('document.querySelector("[aria-label=图片创作输出宽度]")?.value==="777"');assert.equal(await js('document.querySelector("[aria-label=视频创作输出高度]").value'),'1920');
 for(const s of ['.image .generate-button','.video .generate-button']){const r=await js(`(()=>{const r=document.querySelector(${JSON.stringify(s)}).getBoundingClientRect();return {top:r.top,bottom:r.bottom};})()`);assert.ok(r.top>=0&&r.bottom<=1080,JSON.stringify(r));}
 writeFileSync(join(out,process.argv.includes('--packaged')?'packaged.png':'desktop.png'),(await win.webContents.capturePage()).toPNG());win.setBounds({width:1280,height:720});await sleep(200);assert.equal(await js('getComputedStyle(document.querySelector(".chat-column")).overflowY'),'auto');await js('document.querySelector(".video .generate-button").scrollIntoView({block:"nearest"})');await sleep(100);assert.ok(await js('document.querySelector(".video .generate-button").getBoundingClientRect().bottom<720'));console.log('PASS independent custom sizes, presets, adaptation, persistence, visible generation controls');app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
