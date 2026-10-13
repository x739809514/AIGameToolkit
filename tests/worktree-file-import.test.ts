import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Workbenches} from '../electron/workbenches';
const vault={secure:false,get:()=>undefined,set:()=>{}};
function setup(){const root=mkdtempSync(join(tmpdir(),'tree-import-')),manager=new Workbenches(join(root,'profile'),vault,()=>{},join(root,'projects')),board=manager.create('motion-editor');return {manager,board,service:manager.get(board.id),raw:readFileSync('tests/fixtures/dancing.fbx')};}
test('raw project FBX imports without registration, reuses unchanged copies, and preserves the original',async()=>{
 const {manager,board,service,raw}=setup();try{const folder=manager.treePath(board.worktreeId);mkdirSync(join(folder,'下载资源'));writeFileSync(join(folder,'下载资源','舞蹈.FBX'),raw);
  const first=await manager.useFile(board.id,'下载资源/舞蹈.FBX',board.worktreeId),second=await manager.useFile(board.id,'下载资源/舞蹈.FBX',board.worktreeId);assert.equal(first.type,'model');assert.equal(first.name,'舞蹈.FBX');assert.equal(first.id,second.id);assert.equal(service.workspace.assets.length,1);assert.deepEqual(readFileSync(join(folder,'下载资源','舞蹈.FBX')),raw);assert.deepEqual(Buffer.from(service.modelData(first.id)),raw);assert.equal(first.projectFile?.path,'下载资源/舞蹈.FBX');assert.equal(service.store.load().assets[0].projectFile?.path,'下载资源/舞蹈.FBX');
  writeFileSync(join(folder,'下载资源','舞蹈.FBX'),Buffer.concat([raw,Buffer.from('\n')]));const updated=await manager.useFile(board.id,'下载资源/舞蹈.FBX',board.worktreeId);assert.notEqual(updated.id,first.id);assert.deepEqual(Buffer.from(service.modelData(first.id)),raw);
 }finally{manager.close();}
});
test('owned and sibling-workbench FBX assets reuse correctly without duplicating the source',async()=>{
 const {manager,board,service,raw}=setup();try{const path='dance.fbx';writeFileSync(join(manager.treePath(board.worktreeId),path),raw);const first=await manager.useFile(board.id,path,board.worktreeId);assert.equal((await manager.useFile(board.id,path,board.worktreeId)).id,first.id);assert.equal(service.workspace.assets.length,1);
 const sibling=manager.create('motion-editor','other',board.worktreeId),copy=await manager.useFile(sibling.id,path,board.worktreeId);assert.notEqual(copy.id,first.id);assert.equal(copy.sourceAssetId,first.id);assert.equal((await manager.useFile(sibling.id,path,board.worktreeId)).id,copy.id);assert.equal(manager.get(sibling.id).workspace.assets.length,1);
 }finally{manager.close();}
});
test('foreign projects, escaped paths, links, directories and files disguised as FBX are rejected',async()=>{
 const {manager,board,service,raw}=setup();try{const root=manager.treePath(board.worktreeId),other=manager.createWorktree('foreign');writeFileSync(join(root,'dance.fbx'),raw);writeFileSync(join(root,'fake.fbx'),Buffer.from([137,80,78,71,13,10,26,10]));mkdirSync(join(root,'folder.fbx'));symlinkSync(join(root,'dance.fbx'),join(root,'link.fbx'));
 for(const [path,tree] of [['dance.fbx',other.id],['../outside.fbx',board.worktreeId],['link.fbx',board.worktreeId],['folder.fbx',board.worktreeId],['fake.fbx',board.worktreeId]])await assert.rejects(()=>manager.useFile(board.id,path,tree));assert.equal(service.workspace.assets.length,0);assert.equal(service.localOperations,0);
 }finally{manager.close();}
});
