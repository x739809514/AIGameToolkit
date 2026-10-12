import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listWorkspaceFiles,readWorkspaceFile,workspaceFilePath} from '../electron/workspace-files';
test('file tree shows actual nested files, links and asset metadata without traversing other Worktrees',async()=>{
 const root=mkdtempSync(join(tmpdir(),'file-tree-'));mkdirSync(join(root,'design'));mkdirSync(join(root,'assets'));mkdirSync(join(root,'worktrees'));writeFileSync(join(root,'design','README.md'),'# 工作台说明');writeFileSync(join(root,'assets','image-id.png'),'test');writeFileSync(join(root,'worktrees','private.txt'),'other');writeFileSync(join(root,'credentials.enc.json'),'credential');symlinkSync(join(root,'design'),join(root,'shortcut'));
 const tree=await listWorkspaceFiles(root,[{id:'image-id',name:'生成图片.png',type:'image',mime:'image/png',size:4,url:'asset://local/image-id',createdAt:0}]);
 assert.ok(!tree.files.some(f=>f.name==='worktrees'||f.name==='credentials.enc.json'));const image=tree.files.find(f=>f.name==='assets')!.children![0];assert.equal(image.name,'image-id.png');assert.equal(image.assetId,'image-id');assert.equal(image.displayName,'生成图片.png');assert.equal(tree.files.find(f=>f.name==='shortcut')!.kind,'link');assert.equal(tree.files.find(f=>f.name==='design')!.children![0].path,'design/README.md');
});
test('file previews remain inside the active root and refuse escaped paths and links',async()=>{
 const root=mkdtempSync(join(tmpdir(),'file-preview-')),outside=mkdtempSync(join(tmpdir(),'file-outside-'));writeFileSync(join(root,'notes.md'),'你好，工作台');writeFileSync(join(outside,'other.txt'),'other workbench');symlinkSync(outside,join(root,'external'));writeFileSync(join(root,'credentials.enc.json'),'credential');
 assert.equal((await readWorkspaceFile(root,'notes.md')).text,'你好，工作台');
 for(const path of [join(outside,'other.txt'),'../'+outside.split('/').at(-1)+'/other.txt','external/other.txt','credentials.enc.json'])await assert.rejects(()=>workspaceFilePath(root,path));
});
test('large text previews are bounded and binary files never expose decoded database text',async()=>{
 const root=mkdtempSync(join(tmpdir(),'file-preview-limit-'));writeFileSync(join(root,'large.txt'),'x'.repeat(300000));writeFileSync(join(root,'binary.bin'),Buffer.from([0,1,2,3]));
 const text=await readWorkspaceFile(root,'large.txt');assert.equal(text.size,300000);assert.equal(text.text!.length,256*1024);assert.equal(text.truncated,true);const binary=await readWorkspaceFile(root,'binary.bin');assert.equal(binary.binary,true);assert.equal(binary.text,undefined);
});
