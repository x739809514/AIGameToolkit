const {app,BrowserWindow,net,session,ipcMain}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),output=join(root,'output/api-balance-review');mkdirSync(output,{recursive:true});
process.env.TOOLKIT_DATA_DIR=mkdtempSync('/private/tmp/laputa-credit-smoke-');delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
let credit=4489,denied=false,queries=0,loginUnavailable=true;
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,(...args)=>{if(channel==='account:minimax-credits'&&loginUnavailable)throw new Error('No handler registered for account:minimax-credits');return listener(...args);});const fetch=net.fetch.bind(net);
net.fetch=(input,init)=>{
 if(String(input)==='https://www.minimaxi.com/account/query_balance')return Promise.resolve(Response.json({base_resp:{status_code:0},available_amount:'0',credit_balance:'0'}));
 if(String(input)==='https://www.minimax.cn/backend/account/token_plan_credit')throw Error('API key must not be sent to the console endpoint');
 return fetch(input,init);
};
app.whenReady().then(()=>{session.fromPartition('persist:minimax-credits-cn').protocol.handle('https',request=>{
 const headers={'access-control-allow-origin':'https://platform.minimax.cn','access-control-allow-credentials':'true','access-control-allow-headers':'X-Group-Id','access-control-allow-methods':'GET, OPTIONS'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(new URL(request.url).pathname==='/backend/account/token_plan_credit'){
  queries++;assert.equal(request.headers.get('authorization'),null);
  return Response.json({base_resp:{status_code:denied?1004:0},balance_breakdown:{total_balance:credit}},{status:denied?401:200,headers});
 }
 return new Response('<html><body>Fixture console <script>fetch("https://www.minimax.cn/backend/account/token_plan_credit",{headers:{"X-Group-Id":"fixture-group"},credentials:"include"})</script></body></html>',{headers:{'content-type':'text/html'}});
});});
require(process.env.BALANCE_TEST_PACKAGED?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
let win;const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true);
async function until(code){for(let i=0;i<200;i++){if(await js(code))return;await wait(100);}throw new Error('Timed out: '+code);}
async function nativeClick(selector){
 win.show();win.focus();await wait(200);
 const point=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);return {x:Math.round(x),y:Math.round(y),hit:e===top||e.contains(top),stack:document.elementsFromPoint(x,y).slice(0,4).map(n=>n.className)}})()`);
 assert.equal(point.hit,true,'button obscured: '+JSON.stringify(point.stack));
 win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});await wait(100);
}
setTimeout(()=>{console.error('Credits desktop timeout');app.exit(2);},90000);
app.whenReady().then(async()=>{try{
 for(let i=0;i<50;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await wait(100);}await until('!!window.toolkit');
 await js('window.toolkit.createWorkbench({type:"image-video",name:"积分验证"})');await until('!!document.querySelector(\'[aria-label="API 余额"]\')');
 await js('window.toolkit.boot().then(b=>window.toolkit.saveSettings(b.workspace.settings,{minimax:"video-smoke",minimaxCredits:"legacy-unsupported-key"}))');await until('document.querySelector(\'[aria-label="API 余额"]\').textContent.includes("请登录查看积分")');assert.equal(queries,0);
 await nativeClick('[aria-label="API 余额"]');await until('document.querySelector(\'[data-provider="minimax"]\').textContent.includes("按量付费余额：¥0.00")');
 win.setSize(1080,740);await wait(250);assert.ok(await js('document.querySelector(\'[aria-label="登录查看 MiniMax 积分"]\').getBoundingClientRect().height>=32'));await nativeClick('[aria-label="登录查看 MiniMax 积分"]');await until('document.querySelector(".api-credit-login-error")?.textContent.includes("退出并重新打开")');assert.equal(BrowserWindow.getAllWindows().length,1);loginUnavailable=false;await nativeClick('[aria-label="登录查看 MiniMax 积分"]');await until('document.querySelector(\'[aria-label="API 余额"]\').textContent.includes("4,489 积分")');
 const consoleWindow=BrowserWindow.getAllWindows().find(w=>w!==win);assert.ok(consoleWindow);assert.equal(consoleWindow.getParentWindow()?.id,win.id);assert.equal(consoleWindow.isVisible(),true);assert.equal(consoleWindow.webContents.getLastWebPreferences().nodeIntegration,false);assert.equal(consoleWindow.webContents.getLastWebPreferences().sandbox,true);
 await nativeClick('[aria-label="登录查看 MiniMax 积分"]');assert.equal(BrowserWindow.getAllWindows().length,2);assert.equal(consoleWindow.isFocused(),true);await wait(500);const before=queries;await wait(1000);assert.equal(queries,before,'login refresh must not cause a query loop');
 win.focus();await wait(300);writeFileSync(join(output,'minimax-login-points.png'),(await win.webContents.capturePage()).toPNG());
 await wait(5100);credit=0;await js('document.querySelector(\'[aria-label="刷新 API 余额"]\').click()');await until('document.querySelector(".api-credit-balance").textContent.includes("0 积分")');
 await wait(5100);denied=true;await js('document.querySelector(\'[aria-label="刷新 API 余额"]\').click()');await until('document.querySelector(".api-credit-balance").textContent.includes("网页登录已失效")');assert.ok((await js('document.querySelector(\'[aria-label="API 余额"]\').textContent')).includes('积分查询失败'));assert.ok(!(await js('document.querySelector(".api-credit-balance").textContent')).includes('0 积分'));
 denied=false;credit=555;consoleWindow.reload();await until('document.querySelector(\'[aria-label="API 余额"]\').textContent.includes("555 积分")');consoleWindow.close();await wait(300);
 writeFileSync(join(output,'minimax-console-points.png'),(await win.webContents.capturePage()).toPNG());console.log('Credits desktop passed: native mouse login in compact layout; visible local error and retry; visible parented login window; repeated click focuses same window; ignored unsupported keys; explicit login state; renderer-origin console query; 4489 points with zero cash; no query loop; zero points; expired login; login refresh.');app.exit(0);
}catch(error){console.error(error);if(win)writeFileSync(join(output,'minimax-points-failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}});
