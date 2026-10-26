// Isolated desktop verification. All Tripo responses are fixtures; no paid API calls.
const {app,BrowserWindow,dialog,net}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync}=require('node:fs');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),profile=mkdtempSync('/private/tmp/laputa-tripo-desktop-'),output=join(root,'output/tripo-review');mkdirSync(output,{recursive:true});
process.env.TOOLKIT_DATA_DIR=profile;delete process.env.TOOLKIT_DEV_URL;app.requestSingleInstanceLock=()=>true;
// Self-contained GLB tetrahedron with an orange material, matching the production output format.
const vertices=new Float32Array([0,1,0,-1,-1,1,1,-1,1,0,1,0,1,-1,1,0,-1,-1,0,1,0,0,-1,-1,-1,-1,1,-1,-1,1,0,-1,-1,1,-1,1]);
const position=Buffer.from(vertices.buffer),uv=Buffer.alloc(12*2*4),{PNG}=require('pngjs'),tex=new PNG({width:2,height:2});tex.data.fill(255);const png=PNG.sync.write(tex),binary=Buffer.concat([position,uv,png,Buffer.alloc((4-png.length%4)%4)]),document={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,translation:[0,100,0],scale:[50,50,50]}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,.4,.1,1],baseColorTexture:{index:0},metallicFactor:.1,roughnessFactor:.7}}],textures:[{source:0}],images:[{bufferView:2,mimeType:'image/png'}],buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteLength:position.length},{buffer:0,byteOffset:position.length,byteLength:uv.length},{buffer:0,byteOffset:position.length+uv.length,byteLength:png.length}],accessors:[{bufferView:0,componentType:5126,count:12,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]},{bufferView:1,componentType:5126,count:12,type:'VEC2'}]};
let encoded=Buffer.from(JSON.stringify(document));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);const glb=Buffer.alloc(12+8+encoded.length+8+binary.length);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(encoded.length,12);glb.writeUInt32LE(0x4e4f534a,16);encoded.copy(glb,20);const at=20+encoded.length;glb.writeUInt32LE(binary.length,at);glb.writeUInt32LE(0x004e4942,at+4);binary.copy(glb,at+8);
let submitted=[],queries=0,uploads=0,downloadCount=0,save=false;
const saved=join(profile,'downloaded.glb');dialog.showSaveDialog=async()=>save?{canceled:false,filePath:saved}:{canceled:true};
const originalFetch=net.fetch.bind(net);
net.fetch=async(input,init={})=>{
 const url=String(input);if(!url.includes('tripo3d.ai'))return originalFetch(input,init);
 if(url.includes('/account/balance'))return Response.json({code:0,data:{balance:123.5,frozen:2}});
 if(url.endsWith('/files')){uploads++;assert.ok(init.body instanceof FormData);return Response.json({code:0,data:{file_token:'file_fixture'}});}
 if(url.includes('/generation/')){submitted.push(JSON.parse(init.body));return Response.json({code:0,data:{task_id:'task_fixture_'+submitted.length}});}
 if(url.includes('/tasks/')){queries++;return Response.json({code:0,data:{status:'success',progress:100,credits_consumed:20,output:{model_url:'https://cdn.tripo3d.ai/fixture.glb'}}});}
 if(url.includes('/fixture.glb')){downloadCount++;assert.equal(init.headers,undefined);return new Response(new Uint8Array(glb));}
 throw new Error('Unexpected Tripo request: '+url);
};
require(process.env.TRIPO_TEST_PACKAGED?join(root,'release/mac-arm64/Laputa.app/Contents/Resources/app.asar/dist-electron/main.cjs'):join(root,'dist-electron/main.cjs'));
let win;const sleep=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true).catch(error=>{throw new Error(code.slice(0,250)+'\n'+error.message);});
async function until(code){for(let i=0;i<300;i++){if(await js(code))return;await sleep(100);}throw new Error('Timed out: '+code);}
async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function fill(selector,value,textarea=false){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${textarea?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);}
app.whenReady().then(async()=>{try{
 for(let i=0;i<100&&!BrowserWindow.getAllWindows().length;i++)await sleep(100);win=BrowserWindow.getAllWindows()[0];const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3){errors.push(message);console.error('Renderer:',message);};});
 await until('!!document.querySelector(\'[data-template-id="tripo"]\')');await click('[data-template-id="tripo"]');await until('!!document.querySelector(".new-workbench-dialog")');await click('.new-workbench-actions .generate-button');await until('!!document.querySelector(".tripo-workbench")');
 assert.equal(await js('document.querySelector(".tripo-controls .generate-button").disabled'),true);
 await click('[aria-label="设置"]');await fill('[aria-label="Tripo API Key"]','fixture-key');await click('.modal-footer .generate-button');await until('!document.querySelector(".settings-modal")');
 assert.equal((await js('window.toolkit.boot()')).credentials.tripo,true);
 assert.match(await js('window.toolkit.testConnection("tripo")'),/123.5/);assert.equal(submitted.length,0);
 await fill('[aria-label="3D 模型描述"]','A low poly orange crystal',true);await click('.tripo-controls .generate-button');await until('!!document.querySelector(\'[data-task-state="succeeded"]\')');await until('!!document.querySelector(".tripo-stage canvas")&&!document.querySelector(".tripo-preview-overlay")');
 assert.equal(submitted[0].model,'v3.1-20260211');assert.equal(submitted[0].prompt,'A low poly orange crystal');
 await click('.tripo-result header .secondary');assert.equal(existsSync(saved),false);save=true;await click('.tripo-result header .secondary');await until('!!document.querySelector(".tripo-models button")');await sleep(200);assert.deepEqual(readFileSync(saved),glb);
 await click('.tripo-tabs button:nth-child(2)');const image=Array.from(readFileSync(join(root,'tests/fixtures/image.png')));await js(`window.toolkit.importFiles([{name:'reference.png',bytes:Uint8Array.from(${JSON.stringify(image)}).buffer}])`);await until(`document.querySelector('[aria-label="Tripo 参考图片"]').options.length===2`);await js(`(()=>{const e=document.querySelector('[aria-label="Tripo 参考图片"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,e.options[1].value);e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(150);await click('.tripo-controls .generate-button');await until('document.querySelectorAll(\'[data-task-state="succeeded"]\').length===2');await until('!!document.querySelector(".tripo-stage canvas")&&!document.querySelector(".tripo-preview-overlay")');assert.equal(uploads,1);assert.equal(submitted[1].input,'file_fixture');
 await click('[aria-label="API 余额"]');await until('!!document.querySelector(\'[data-provider="tripo"]\')');assert.match(await js('document.querySelector(\'[data-provider="tripo"]\').innerText'),/123.5/);await click('[aria-label="API 余额"]');
 win.show();win.focus();win.webContents.invalidate();await sleep(1000);const screenshot=(await win.webContents.capturePage()).toPNG();writeFileSync(join(output,'desktop-tripo.png'),screenshot);const rect=await js(`(()=>{const r=document.querySelector('.tripo-stage canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`),shot=PNG.sync.read(screenshot),factor=shot.width/(await js('innerWidth')),offset=(Math.floor(rect.y*factor)*shot.width+Math.floor(rect.x*factor))*4;assert.ok(shot.data[offset]>100&&shot.data[offset+3]===255,'The normalized textured model must be visible in the center of the preview');
 assert.equal(await js('document.querySelector(".tripo-workbench").scrollWidth<=document.querySelector(".tripo-workbench").clientWidth'),true);
 assert.ok(!errors.some(e=>/Content Security Policy|Failed to load|WebGL|GLTFLoader|DRACOLoader/.test(e)),errors.join('\n'));
 writeFileSync(join(output,'desktop-smoke.json'),JSON.stringify({packaged:!!process.env.TRIPO_TEST_PACKAGED,template:true,secureCredentials:true,nonGeneratingConnectionTest:true,textGeneration:true,imageGeneration:true,localGLB:true,webGLPreview:true,embeddedTextures:true,normalizedOriginAndScale:true,pixels:Array.from(shot.data.subarray(offset,offset+4)),downloadCancel:true,download:true,points:true,queries,downloadCount,paidAPICalls:0,errors},null,2));console.log('Tripo desktop smoke passed');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}});
