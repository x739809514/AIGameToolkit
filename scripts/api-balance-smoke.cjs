const {app,BrowserWindow,net,shell}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),output=join(root,'output/api-balance-review');mkdirSync(output,{recursive:true});process.env.TOOLKIT_DATA_DIR=mkdtempSync('/private/tmp/laputa-balance-smoke-');delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
let amount=23.45,calls=0,opened;const originalFetch=net.fetch.bind(net);
net.fetch=(input,init)=>{if(String(input)==='https://www.minimaxi.com/account/query_balance'){calls++;assert.equal(init.headers.Authorization,'Bearer smoke-key');assert.equal(init.method,'GET');return Promise.resolve(Response.json({base_resp:{status_code:0},available_amount:amount,cash_balance:amount,voucher_balance:0,credit_balance:0,owed_amount:0}));}return originalFetch(input,init);};
shell.openExternal=async url=>{opened=url;};
require(process.env.BALANCE_TEST_PACKAGED?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
let win;const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=code=>win.webContents.executeJavaScript(code,true);
async function until(code){for(let i=0;i<300;i++){if(await js(code))return;await sleep(100);}throw new Error('Timed out: '+code);}
async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function shot(name){await sleep(200);writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
setTimeout(()=>{console.error('API balance desktop timeout');app.exit(2);},120000);
app.whenReady().then(async()=>{try{
 for(let i=0;i<50;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await sleep(100);}await until('!!window.toolkit');
 await js('window.toolkit.createWorkbench({type:"image-video",name:"余额验证"})');await until('!!document.querySelector(\'[aria-label="API 余额"]\')');await until('document.querySelector(\'[aria-label="API 余额"]\').textContent.includes("未接入")');assert.equal(calls,0);await click('[aria-label="API 余额"]');await until('!!document.querySelector(\'[aria-label="API 账户余额"]\')');assert.equal(await js('document.querySelectorAll(".api-balance-accounts article").length'),3);await shot('balance-unconfigured');await click('[aria-label="API 余额"]');
 await js('window.toolkit.boot().then(b=>window.toolkit.saveSettings(b.workspace.settings,{openai:"test-openai",anthropic:"test-claude",minimax:"smoke-key"}))');await until('document.querySelector(\'[aria-label="API 余额"]\').textContent.includes("¥23.45")');assert.equal(calls,1);await click('[aria-label="API 余额"]');await until('document.querySelector(\'[data-provider="openai"]\')?.textContent.includes("控制台查看")');assert.equal(await js('document.querySelector(\'[data-provider="minimax"]\').dataset.status'),'available');await shot('balance-configured');
 await click('[aria-label="查看 OpenAI 账单"]');assert.equal(opened,'https://platform.openai.com/settings/organization/billing/overview');await click('[aria-label="刷新 API 余额"]');await until('!document.querySelector(\'[aria-label="刷新 API 余额"]\').disabled');assert.equal(calls,1);await sleep(5100);amount=0;await click('[aria-label="刷新 API 余额"]');await until('document.querySelector(\'[data-provider="minimax"]\').textContent.includes("¥0.00")');await shot('balance-zero');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until('!document.querySelector(\'[aria-label="API 账户余额"]\')');
 await js('window.toolkit.boot().then(b=>window.toolkit.saveSettings(b.workspace.settings,{minimax:""}))');await until('!document.querySelector(\'[aria-label="API 余额"]\').textContent.includes("MiniMax")');await click('[aria-label="API 余额"]');await until('document.querySelector(\'[data-provider="minimax"]\')?.textContent.includes("未接入")');
 win.setSize(1080,740);await shot('balance-compact');assert.equal(await js('document.querySelector(".api-balance-popover").getBoundingClientRect().right<=innerWidth'),true);
 await js('window.toolkit.createWorkbench({type:"motion-editor",name:"本地工作台余额"})');await until('!!document.querySelector(".model-canvas canvas")');assert.equal(await js('!!document.querySelector(\'[aria-label="API 余额"]\')'),true);
 console.log('API balance desktop passed: unconfigured state; MiniMax amount and zero; unsupported OpenAI/Claude; billing link; refresh cooldown; key deletion clears balance; Escape; compact layout; local workbench header.');app.exit(0);
 }catch(error){console.error(error);if(win)await shot('balance-failure').catch(()=>{});app.exit(1);}});
