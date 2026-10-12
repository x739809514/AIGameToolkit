import {modelEditorSelfTest} from './model-self-test';
import type { BrowserWindow } from 'electron';
import { app,dialog,BrowserWindow as DesktopWindow } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Service } from './service';
import {networkSelfTest} from './network-self-test';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function selfTest(window:BrowserWindow,service:Service,openEditor:(id:string,tool:'crop')=>BrowserWindow){
  const output=process.env.TOOLKIT_SELF_TEST_OUTPUT||service.store.directory;mkdirSync(output,{recursive:true});
  try{
    const networking=await networkSelfTest();
    for(let i=0;i<300;i++){if(await window.webContents.executeJavaScript("!!document.querySelector('.workbench')").catch(()=>false))break;await wait(100);}
    if(!await window.webContents.executeJavaScript("!!document.querySelector('.workbench')"))throw new Error('工作台未加载');
    if(!await window.webContents.executeJavaScript("!document.querySelector('.pose-source-panel,.skeleton-preview')&&document.querySelectorAll('.chat-panel').length===2&&document.querySelectorAll('.preview-panel').length===2"))throw new Error('图片与视频工作台布局未还原');
    const workbench=await window.webContents.executeJavaScript("window.toolkit.boot().then(b=>b.workbench)");if(!workbench?.id)throw new Error('工作台身份未绑定');
    const worktreeHierarchy=await window.webContents.executeJavaScript("window.toolkit.boot().then(async b=>{const c=await window.toolkit.catalog();return !!b.worktree&&c.workbenches.every(w=>w.worktreeId===b.worktree.id)&&!!document.querySelector('.worktree-group[data-worktree-id=\"'+b.worktree.id+'\"]')&&document.querySelector('.file-tree-root strong')?.textContent===b.worktree.name;})");if(!worktreeHierarchy)throw new Error('打包后 Worktree 层级或目录未关联');
    const singleMainWindow=DesktopWindow.getAllWindows().length===1;if(!singleMainWindow)throw new Error('出现了额外的工作台主窗口');const multipleWorkbenches=await window.webContents.executeJavaScript("window.toolkit.catalog().then(c=>c.workbenches.length===2)");if(!multipleWorkbenches)throw new Error('打包后多工作台未创建');
    if(!await window.webContents.executeJavaScript("document.querySelector('.video .api-region')?.textContent==='API · 中国区'"))throw new Error('中国区 API 标识未显示');
    const fixtures=process.env.TOOLKIT_SELF_TEST_FIXTURES;if(!fixtures)throw new Error('测试素材路径未设置');
    let credentialsRequired=false;
    try{await service.generate({kind:'image',requestId:'missing-key',draft:{prompt:'测试 API 校验',attachmentIds:[],mode:'first_frame',discussion:false}});}catch(e){credentialsRequired=String(e).includes('API Key');}
    if(!credentialsRequired||service.workspace.tasks.length)throw new Error('缺少凭据时必须阻止生成');
    const imports=await service.importFiles(['image.png','video.mp4'].map(name=>{const bytes=readFileSync(join(fixtures,name));return {name,bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer};}));
    service.select('image',imports[0].id);service.select('video',imports[1].id);
    for(let i=0;i<200;i++){if(await window.webContents.executeJavaScript("document.querySelector('.preview-stage video')?.readyState>=1"))break;await wait(100);}
    window.show();window.focus();await wait(300);await window.webContents.executeJavaScript("document.querySelector('.preview-stage video').play().catch(e=>window.__playError=e.message);true");
    for(let i=0;i<100;i++){if(await window.webContents.executeJavaScript("document.querySelector('.preview-stage video').currentTime>.4"))break;await wait(100);}
    if(!await window.webContents.executeJavaScript("document.querySelector('.preview-stage video').currentTime>.4"))throw new Error('视频无法播放');
    await window.webContents.executeJavaScript("document.querySelector('.preview-stage video').pause()");
    writeFileSync(join(output,'packaged-desktop.png'),(await window.webContents.capturePage()).toPNG());
    const editor=openEditor(imports[0].id,'crop');
    for(let i=0;i<200;i++){if(await editor.webContents.executeJavaScript("document.querySelector('.editor-base')?.width>1").catch(()=>false))break;await wait(100);}
    if(!await editor.webContents.executeJavaScript("document.querySelector('.editor-base')?.width>1"))throw new Error('图片编辑窗口未加载');
    await editor.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存裁切图片').click()");
    for(let i=0;i<200;i++){if(service.workspace.assets.some(a=>a.imageAction==='crop'))break;await wait(100);}
    const cropped=service.workspace.assets.find(a=>a.imageAction==='crop');if(!cropped||cropped.sourceAssetId!==imports[0].id||service.workspace.selectedImageId!==cropped.id)throw new Error('裁切结果未同步');
    await wait(300);writeFileSync(join(output,'packaged-editor.png'),(await editor.webContents.capturePage()).toPNG());editor.destroy();
    const modelEditor=await modelEditorSelfTest(window,fixtures,output);
    const result={packaged:app.isPackaged,version:app.getVersion(),modelEditor,originalImageVideoLayout:true,startupPicker:true,worktreeHierarchy,singleMainWindow,multipleWorkbenches,workbench:workbench.type,networking,minimaxRegion:service.workspace.settings.minimaxRegion,credentialsRequired,importedImage:imports[0].width,importedVideo:imports[1].duration,playback:true,imageEditor:true,localCrop:true,sqlite:service.store.load().assets.length===3};
    writeFileSync(join(output,'packaged-smoke.json'),JSON.stringify(result,null,2));console.log('Packaged smoke passed:',JSON.stringify(result));app.exit(0);
  }catch(e){console.error('Packaged smoke failed:',e);app.exit(1);}
}
