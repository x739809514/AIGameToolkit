const {app,BrowserWindow}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),output=join(root,'output/ui-layout-arrow-draw-review');mkdirSync(output,{recursive:true});process.env.TOOLKIT_DATA_DIR=mkdtempSync('/private/tmp/laputa-arrow-draw-');delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
require(process.env.UI_LAYOUT_TEST_PACKAGED?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
let win;const sleep=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true).catch(e=>{throw Error(code.slice(0,200)+'\n'+e.message);});
async function until(code){for(let i=0;i<250;i++){if(await js(code))return;await sleep(100);}throw Error('Timed out: '+code);}
async function click(s){await js(`document.querySelector(${JSON.stringify(s)}).click()`);await sleep(100);}
const doc=()=>js('window.toolkit.boot().then(b=>b.workspace.uiLayout)'),count=async()=>((await doc())?.nodes??[]).length;
async function saved(){await until('document.querySelector(".layout-document-name small").textContent==="已保存"');}
async function screen(x,y){return js(`(()=>{const r=document.querySelector('.layout-canvas').getBoundingClientRect(),z=r.width/1280;return {x:Math.round(r.left+${x}*z),y:Math.round(r.top+${y}*z)};})()`);}
function input(type,p,modifiers=[]){win.webContents.sendInputEvent({type,button:'left',clickCount:1,...p,modifiers});}
async function drag(start,end,{shift=false,cancel=false,preview=false}={}){const a=await screen(...start),b=await screen(...end),mods=shift?['shift']:[];input('mouseDown',a,mods);await sleep(60);for(let i=1;i<=8;i++){input('mouseMove',{x:Math.round(a.x+(b.x-a.x)*i/8),y:Math.round(a.y+(b.y-a.y)*i/8)},mods);await sleep(20);}if(preview){await sleep(450);assert.equal(await count(),0,'Unfinished arrow must not be saved');assert.equal(await js('document.querySelectorAll(".layout-artwork [data-layout-node]").length'),1);}
 if(cancel)await key('Escape');input('mouseUp',b,mods);await saved();}
async function key(keyCode){win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await sleep(100);}
function endPoints(n){const a=n.rotation*Math.PI/180;return n.points.map(p=>{const x=(p.x-.5)*n.width,y=(p.y-.5)*n.height;return [n.x+n.width/2+Math.cos(a)*x-Math.sin(a)*y,n.y+n.height/2+Math.sin(a)*x+Math.cos(a)*y];});}
const close=(actual,expected,tolerance=3)=>assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<tolerance,`${actual} != ${expected}`);
async function shot(name){await sleep(200);writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
setTimeout(()=>{console.error('Arrow drawing timeout');app.exit(2);},120000);
app.whenReady().then(async()=>{try{
 for(let i=0;i<100&&!BrowserWindow.getAllWindows().length;i++)await sleep(100);win=BrowserWindow.getAllWindows()[0];win.show();win.focus();win.webContents.setBackgroundThrottling(false);await until('!!window.toolkit');const board=await js('window.toolkit.createWorkbench({type:"ui-layout",name:"自由绘制箭头验证"})');await until('!!document.querySelector(".ui-layout-workbench")');
 await click('[data-component="arrow"]');assert.equal(await count(),0);assert.equal(await js('document.querySelector("[data-component=arrow]").getAttribute("aria-pressed")'),'true');
 await drag([180,180],[400,280],{preview:true});let nodes=(await doc()).nodes;assert.equal(nodes.length,1);close(endPoints(nodes[0])[0],[180,180]);close(endPoints(nodes[0])[1],[400,280]);assert.equal(await js('document.querySelectorAll("[data-arrow-endpoint]").length'),2);
 await click('[aria-label="撤销布局编辑"]');await saved();assert.equal(await count(),0);await click('[aria-label="重做布局编辑"]');await saved();assert.equal(await count(),1);await click('[data-component="arrow"]');
 const samples=[[[850,250],[650,100]],[[200,500],[500,500]],[[100,200],[100,450]],[[850,150],[1050,80]],[[600,450],[450,550]]];for(const [start,end]of samples){await drag(start,end);const n=(await doc()).nodes.at(-1);close(endPoints(n)[0],start);close(endPoints(n)[1],end);}
 assert.equal(await count(),6);await drag([800,500],[1000,540],{shift:true});const shifted=endPoints((await doc()).nodes.at(-1));const angle=Math.atan2(shifted[1][1]-shifted[0][1],shifted[1][0]-shifted[0][0])*180/Math.PI;assert.ok(Math.abs(angle/45-Math.round(angle/45))<.001);
 const before=await count();await drag([1100,450],[1100,450]);assert.equal(await count(),before);await drag([1100,400],[1150,500],{cancel:true});assert.equal(await count(),before);assert.equal(await js('document.querySelector("[data-component=arrow]").getAttribute("aria-pressed")'),'false');
 const first=(await doc()).nodes[0],original=endPoints(first);await click(`[data-layer-id="${first.id}"] button`);await drag(original[1],[740,550]);let changed=(await doc()).nodes.find(n=>n.id===first.id);close(endPoints(changed)[0],original[0],.001);close(endPoints(changed)[1],[740,550]);assert.ok(changed.width>first.width+200);
 await drag(endPoints(changed)[0],[60,60],{shift:true});changed=(await doc()).nodes.find(n=>n.id===first.id);close(endPoints(changed)[1],[740,550]);
 await click('[data-component="rectangle"]');await saved();const rectangle=(await doc()).nodes.at(-1);await click('[data-component="arrow"]');await drag([640,350],[700,400]);assert.equal(await count(),before+2);assert.deepEqual((await doc()).nodes.find(n=>n.id===rectangle.id),rectangle);
 await key('Escape');await key('A');assert.equal(await js('document.querySelector("[data-component=arrow]").getAttribute("aria-pressed")'),'true');await key('V');assert.equal(await js('document.querySelector("[aria-label=选择工具]").getAttribute("aria-pressed")'),'true');
 await shot('freehand-arrow-desktop');const final=await doc();await js('window.toolkit.showWorkbenchLauncher()');await until('!!document.querySelector(".template-dashboard")');await js(`window.toolkit.openWorkbench(${JSON.stringify(board.id)})`);await until('!!document.querySelector(".ui-layout-workbench")');assert.deepEqual(await doc(),final);
 console.log('Native arrow drawing passed: click arms tool without adding; pointer drag preview; no draft autosave; arbitrary quadrants and axes; sticky tool; 45-degree Shift; click and Escape cancellation; one-step undo/redo; endpoints beyond old bounds with fixed anchor; drawing over existing objects; A/V shortcuts; persistence.');app.exit(0);
 }catch(e){console.error(e);if(win&&!win.isDestroyed())await shot('failure').catch(()=>{});app.exit(1);}});
