const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'.local-data'),{recursive:true});process.env.TOOLKIT_DATA_DIR=fs.mkdtempSync(path.join(root,'.local-data','desktop-smoke-'));delete process.env.TOOLKIT_DEV_URL;
const output=path.join(root,'output/mvp-review');fs.mkdirSync(output,{recursive:true});
require('../dist-electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let win;
async function evaluate(code){return win.webContents.executeJavaScript(code,true);}
async function until(code,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await evaluate(code);if(value)return value;}catch{}await wait(100);}throw new Error('Timed out: '+code.slice(0,180));}
async function click(label){const found=await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}));if(!b)throw new Error('Button missing');if(b.disabled)throw new Error('Button disabled');b.click();return true;})()`);assert.ok(found);}
async function capture(name){await wait(200);fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG());}
async function fill(label,text){await evaluate(`(()=>{const e=document.querySelector('textarea[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(150);}
app.whenReady().then(async()=>{
 try{
  for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await wait(50);}assert.ok(win);
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.log('Renderer:',message);});
  await until("document.querySelector('.workbench-launcher') && !!window.toolkit");const launcher=win;await capture('desktop-launcher-empty.png');
  assert.equal(await evaluate("window.toolkit.catalog().then(c=>document.querySelectorAll('.template-card').length===c.types.length&&c.types.some(t=>t.id==='image-video')&&c.types.some(t=>t.id==='motion-editor'))"),true);assert.equal(await evaluate("window.toolkit.boot().then(()=>false,()=>true)"),true);
  assert.equal(await evaluate("document.querySelectorAll('.launcher-recents,.launcher-name,.launcher-footer').length"),0);await evaluate("document.querySelector('.template-card').click()");await until("!!document.querySelector('.new-workbench-dialog')");await click('创建工作台');await until("document.querySelector('.workbench') && !!window.toolkit");assert.equal(BrowserWindow.getAllWindows().length,1);
  assert.equal(await evaluate("document.querySelectorAll('.chat-panel').length"),2);assert.equal(await evaluate("document.querySelectorAll('.preview-panel').length"),2);
  assert.equal(await evaluate("document.querySelector('.video .api-region').textContent"),'API · 中国区');
  await capture('desktop-empty.png');await click('设置');await until("document.querySelector('[role=dialog]')");assert.equal(await evaluate("document.querySelectorAll('input[type=password]').length"),3);await capture('desktop-settings.png');await evaluate("document.querySelector('button[aria-label=关闭设置]').click()");await until("!document.querySelector('[role=dialog]')");
  await click('设置');await until("document.querySelector('[aria-label=\"MiniMax API 地区\"]')");assert.ok(await evaluate("document.querySelector('[aria-label=\"MiniMax API 地区\"]').textContent.includes('https://api.minimax.cn')"));await evaluate("document.querySelector('button[aria-label=关闭设置]').click()");await until("!document.querySelector('[role=dialog]')");
  assert.equal(await evaluate("typeof window.toolkit.setDemo"),'undefined');
  assert.equal(await evaluate("document.querySelectorAll('.mode-toggle,.sample-button,.demo-warning').length"),0);
  await fill('图片 Prompt','测试图片生成请求');await click('生成图片');await until("document.querySelector('[role=alert]')?.textContent.includes('OpenAI API Key')");
  assert.equal(await evaluate("window.toolkit.boot().then(b=>b.workspace.tasks.length)"),0);
  await click('关闭错误提示');
  const imageBytes=fs.readFileSync(path.join(root,'tests/fixtures/image.png')).toString('base64');
  const imageId=await evaluate(`window.toolkit.importFiles([{name:'测试图片.png',bytes:Uint8Array.from(atob('${imageBytes}'),c=>c.charCodeAt(0)).buffer}]).then(a=>window.toolkit.select('image',a[0].id).then(()=>a[0].id))`);
  await until("document.querySelector('.image-scroll img')?.naturalWidth>0");
  await fill('视频 Prompt','保留视频草稿，镜头缓慢前移');await click('应用到视频');await until("document.querySelector('.base-image img')");
  assert.equal(await evaluate("document.querySelector('textarea[aria-label=\"视频 Prompt\"]').value"),'保留视频草稿，镜头缓慢前移');await capture('desktop-image-to-video.png');
  const imageEditor=await require('./editor-smoke.cjs')(win,imageId,output);
  const videoBytes=fs.readFileSync(path.join(root,'tests/fixtures/video.mp4')).toString('base64');
  await evaluate(`window.toolkit.importFiles([{name:'测试视频.mp4',bytes:Uint8Array.from(atob('${videoBytes}'),c=>c.charCodeAt(0)).buffer}]).then(a=>window.toolkit.select('video',a[0].id))`);
  await until("document.querySelector('.preview-stage video')?.readyState>=1");win.show();win.focus();await wait(300);await evaluate("document.querySelector('.preview-stage video').play().catch(e=>window.__playError=e.message);true");await until("document.querySelector('.preview-stage video')?.currentTime>0.4");await evaluate("document.querySelector('.preview-stage video').pause()");
  const result=await evaluate("window.toolkit.boot().then(b=>({tasks:b.workspace.tasks.map(t=>({kind:t.kind,state:t.state,baseImageId:t.baseImageId})),assets:b.workspace.assets.length,secureStorage:b.secureStorage,desktop:b.desktop}))");assert.equal(result.tasks.length,0);assert.equal(await evaluate("window.toolkit.boot().then(b=>b.workspace.drafts.video.baseImageId)"),imageId);assert.equal(result.desktop,true);
  await capture('desktop-complete.png');
  await evaluate("window.toolkit.importFiles([{name:'创作要求.md',bytes:new TextEncoder().encode('主题：森林与木屋').buffer}])");
  const imported=await evaluate("window.toolkit.boot().then(b=>b.workspace.assets.find(a=>a.name==='创作要求.md'))");assert.equal(imported.text,'主题：森林与木屋');
  const files=fs.readdirSync(process.env.TOOLKIT_DATA_DIR);assert.ok(files.includes('workspace.sqlite'));fs.writeFileSync(path.join(output,'desktop-smoke.json'),JSON.stringify({...result,checks:['two independent chats','settings with three providers','API credentials required; no simulation controls','imported media fixtures','image applies as first frame','video prompt preserved','asset protocol loads image and video','document extraction','SQLite persistence']},null,2));
  assert.equal(await evaluate("document.querySelectorAll('.pose-source-panel,.skeleton-preview,[data-joint-id],.pose-workbench').length"),0);assert.equal(await evaluate("window.toolkit.analyzePose('any').then(()=>false,e=>e.message.includes('仅用于'))"),true);
  const workbenches=await require('./workbench-smoke.cjs')(win,launcher,output);fs.writeFileSync(path.join(output,'workbench-smoke.json'),JSON.stringify(workbenches,null,2));
  const modelEditor=await require('../dist-electron/model-self-test.cjs').modelEditorSelfTest(win,path.join(root,'tests/fixtures'),output);
  fs.writeFileSync(path.join(output,'editor-smoke.json'),JSON.stringify(imageEditor,null,2));console.log('Desktop smoke passed:',JSON.stringify({...result,imageEditor,workbenches,modelEditor}));app.exit(0);
 }catch(e){console.error('Desktop smoke failed:',e);if(win)console.log('Media diagnostics:',await evaluate("(()=>{const v=document.querySelector('.preview-stage video');return v?{readyState:v.readyState,networkState:v.networkState,paused:v.paused,currentTime:v.currentTime,duration:v.duration,error:v.error?.message,buffered:v.buffered.length,hidden:document.hidden,same:window.__testVideo===v,events:window.__mediaEvents}:null;})()"));if(win)await capture('desktop-failure.png');app.exit(1);}
});
