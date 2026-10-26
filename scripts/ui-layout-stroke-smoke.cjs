const {app,BrowserWindow,dialog}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {PNG}=require('pngjs');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),profile=mkdtempSync('/private/tmp/laputa-layout-stroke-'),output=join(root,'output/ui-layout-stroke-review');mkdirSync(output,{recursive:true});
process.env.TOOLKIT_DATA_DIR=profile;delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
const destination=join(output,'stroke-design.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[destination]});
require(process.env.UI_LAYOUT_TEST_PACKAGED?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
let win;const sleep=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true).catch(e=>{throw Error(code.slice(0,250)+'\n'+e.message);});
async function until(code){for(let i=0;i<250;i++){if(await js(code))return;await sleep(100);}throw Error('Timed out: '+code);}
async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(80);}
async function set(label,value){await js(`(()=>{const e=document.querySelector('.layout-inspector [aria-label="${label}"]');if(e.closest('details'))e.closest('details').open=true;const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await sleep(80);if(typeof value==='number')await js(`document.querySelector('.layout-inspector [aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await sleep(80);}
const doc=()=>js('window.toolkit.boot().then(b=>b.workspace.uiLayout)');
async function settled(){await until('document.querySelector(".layout-document-name small").textContent==="已保存"');}
async function add(type){await click(`[data-component="${type}"]`);await settled();}
async function dropArrow(){await click('[data-component="arrow"]');await sleep(80);const r=await js(`(()=>{const r=document.querySelector('.layout-canvas').getBoundingClientRect();return {x:r.left,y:r.top,z:r.width/1280};})()`);const at=(x,y)=>({x:Math.round(r.x+x*r.z),y:Math.round(r.y+y*r.z)});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...at(80,110)});for(let i=1;i<=8;i++){win.webContents.sendInputEvent({type:'mouseMove',...at(80+300*i/8,110)});await sleep(20);}win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...at(380,110)});await settled();}

async function shot(name){await sleep(200);writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
setTimeout(()=>{console.error('Stroke smoke timeout');app.exit(2);},150000);
app.whenReady().then(async()=>{try{
 for(let i=0;i<100&&!BrowserWindow.getAllWindows().length;i++)await sleep(100);win=BrowserWindow.getAllWindows()[0];win.show();win.focus();win.webContents.setBackgroundThrottling(false);const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});await until('!!window.toolkit');const board=await js('window.toolkit.createWorkbench({type:"ui-layout",name:"箭头与线条样式验证"})');await until('!!document.querySelector(".ui-layout-workbench")');
 await dropArrow();assert.equal((await doc()).nodes[0].type,'arrow');assert.ok(await js('!!document.querySelector(".layout-artwork polyline[marker-end]")'));
 for(const [key,value]of Object.entries({X:80,Y:110,宽度:300,高度:1,描边宽度:6,描边颜色:'#2457c5',线条样式:'dashed',线条端点:'butt',线条拐角:'bevel',起点箭头:'circle',终点箭头:'triangle',箭头大小:36,'描边不透明度 %':50}))await set(key,value);await settled();
 let arrow=(await doc()).nodes[0];assert.equal(arrow.strokeStyle,'dashed');assert.equal(arrow.arrowStart,'circle');assert.equal(arrow.arrowEnd,'triangle');assert.equal(arrow.arrowSize,36);assert.equal(arrow.strokeOpacity,.5);
 await click('[aria-label="撤销布局编辑"]');await settled();assert.equal((await doc()).nodes[0].strokeOpacity,1);await click('[aria-label="重做布局编辑"]');await settled();assert.equal((await doc()).nodes[0].strokeOpacity,.5);
 await click(`[data-layer-id="${arrow.id}"] button`);await click('.layout-properties button.secondary:not([aria-pressed])');await settled();assert.equal((await doc()).nodes[0].arrowStart,'triangle');await click('.layout-properties button.secondary:not([aria-pressed])');await settled();
 await until('document.querySelectorAll("[data-arrow-endpoint]").length===2');
 const types=['rectangle','ellipse','polygon','line'],styles=['solid','dashed','dotted','dash-dot'];
 for(let i=0;i<types.length;i++){await add(types[i]);for(const [key,value]of Object.entries({X:80+i*270,Y:270,宽度:180,高度:140,描边颜色:'#2457c5',描边宽度:6,线条样式:styles[i],线条端点:'round',线条拐角:'round'}))await set(key,value);await settled();}
 let saved=await doc();assert.equal(saved.nodes.length,5);for(let i=0;i<4;i++)assert.equal(saved.nodes[i+1].strokeStyle,styles[i]);
 await click(`[data-layer-id="${arrow.id}"] button`);await set('终点箭头','open');await settled();assert.ok(await js('document.querySelector(".layout-artwork marker:last-of-type path").getAttribute("d").includes("L 2 11")'));await set('终点箭头','diamond');await settled();await set('终点箭头','triangle');await settled();
 await shot('desktop-stroke-editor');await click('.layout-actions .generate-button');await until('!document.querySelector(".layout-actions .spin")');assert.equal(await js('!!document.querySelector(".layout-error")'),false);
 const exported=JSON.parse(readFileSync(destination,'utf8')),png=PNG.sync.read(readFileSync(destination.replace('.json','.png')));assert.equal(exported.nodes[0].arrowEnd,'triangle');assert.equal(exported.nodes[3].strokeStyle,'dotted');
 const pixel=(x,y)=>Array.from(png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+3)),mixed=[36,87,197].map(v=>Math.round(v*.5+255*.5));
 for(const [x,y] of [[90,110],[95,100],[360,105]]){const actual=pixel(x,y);for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-mixed[i])<=2,`PNG stroke/marker alpha mismatch at ${x},${y}: ${actual}, expected ${mixed}`);}
 assert.deepEqual(pixel(115,110),[255,255,255],'Dashed line must include a transparent gap');
 await js('window.toolkit.showWorkbenchLauncher()');await until('!!document.querySelector(".template-dashboard")');await js(`window.toolkit.openWorkbench(${JSON.stringify(board.id)})`);await until('!!document.querySelector(".ui-layout-workbench")');assert.deepEqual(await doc(),exported);
 await click('.layout-actions .secondary');await until('!document.querySelector(".layout-error")');await settled();assert.deepEqual(await doc(),exported);
 assert.ok(!errors.some(e=>/Uncaught|TypeError|SecurityError/.test(e)),errors.join('\n'));console.log('UI stroke desktop passed: freehand arrow drawing; all shapes stroke styles; caps/joins; start/end markers; marker size; reverse; vertex editing; undo/redo; PNG dash gaps and independent arrow opacity; JSON import; workbench persistence.');app.exit(0);
 }catch(error){console.error(error);if(win&&!win.isDestroyed())await shot('failure').catch(()=>{});app.exit(1);}});
