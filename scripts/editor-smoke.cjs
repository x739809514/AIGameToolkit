const {BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
module.exports=async function editorSmoke(main,imageId,output){
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await main.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.image-tools button')).find(b=>b.textContent.includes('画笔修改')).click()`);
  let editor;for(let i=0;i<100;i++){editor=BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()||'about:blank').searchParams.get('view')==='image-editor');if(editor)break;await wait(100);}assert.ok(editor,'independent editor window');
  const evaluate=code=>editor.webContents.executeJavaScript(code,true);
  async function until(code){for(let i=0;i<200;i++){if(await evaluate(code).catch(()=>false))return;await wait(100);}console.error('Editor diagnostics:',await evaluate("({url:location.href,text:document.body.innerText})"));await capture('desktop-editor-failure.png');throw Error('Editor timed out: '+code);}
  async function click(label){await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Editor button unavailable: '+${JSON.stringify(label)});b.click();})()`);await wait(100);}
  async function input(label,value,tag='input'){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(tag+'[aria-label="'+label+'"]')});Object.getOwnPropertyDescriptor(${tag==='textarea'?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(100);}
  async function capture(name){await wait(150);fs.writeFileSync(path.join(output,name),(await editor.webContents.capturePage()).toPNG());}
  await until("document.querySelector('.editor-selection')?.width>1");editor.show();editor.focus();
  assert.equal(await main.webContents.executeJavaScript("document.querySelector('[role=alert]')?.textContent||''"),'');
  const rect=await evaluate("(()=>{const r=document.querySelector('.editor-selection').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
  const x=Math.round(rect.x+rect.width*.3),y=Math.round(rect.y+rect.height*.45);
  editor.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
  editor.webContents.sendInputEvent({type:'mouseMove',x:x+70,y:y+40,button:'left'});
  editor.webContents.sendInputEvent({type:'mouseUp',x:x+70,y:y+40,button:'left',clickCount:1});
  await until("document.querySelector('.editor-selection').dataset.strokes==='1'");
  await click('撤销圈选');await until("document.querySelector('.editor-selection').dataset.strokes==='0'");await click('重做圈选');
  await input('图片修改 Prompt','将选区改为浅蓝色','textarea');await click('提交局部修改');await until("document.querySelector('.editor-error')?.textContent.includes('OpenAI API Key')");await capture('desktop-editor-brush.png');
  await main.webContents.executeJavaScript("Array.from(document.querySelectorAll('.image-tools button')).find(b=>b.textContent.includes('裁切')).click()");
  await until("!!document.querySelector('input[aria-label=裁切宽度]')");assert.equal(BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()||'about:blank').searchParams.get('view')==='image-editor').length,1,'reuses editor');
  for(const [label,value] of [['裁切X','10'],['裁切Y','20'],['裁切宽度','120'],['裁切高度','100']])await input(label,value);
  await capture('desktop-editor-crop.png');await click('保存裁切图片');await until("document.querySelector('.editor-status')?.textContent.includes('裁切结果已保存')");
  const crop=await main.webContents.executeJavaScript("window.toolkit.boot().then(b=>b.workspace.assets.find(a=>a.imageAction==='crop'))");assert.equal(crop.width,120);assert.equal(crop.height,100);assert.equal(crop.sourceAssetId,imageId);
  assert.equal(await main.webContents.executeJavaScript("window.toolkit.boot().then(b=>b.workspace.selectedImageId)"),crop.id);
  await click('去除背景');await click('生成透明背景图片');await until("document.querySelector('.editor-error')?.textContent.includes('OpenAI API Key')");await capture('desktop-editor-background.png');
  assert.equal(await main.webContents.executeJavaScript("window.toolkit.boot().then(b=>b.workspace.tasks.length)"),0);
  editor.destroy();return {independentWindow:true,brush:true,undoRedo:true,crop:{width:crop.width,height:crop.height},resultSynced:true,credentialsRequired:true};
};
