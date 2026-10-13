import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {Workbenches} from '../electron/workbenches';
import {listWorkspaceFiles,readWorkspaceFile} from '../electron/workspace-files';
import {Terminals} from '../electron/terminals';
const vault={secure:false,get:()=>undefined,set:()=>{}};
function setup(){const root=mkdtempSync(join(tmpdir(),'laputa-project-root-'));return {profile:join(root,'profile'),projects:join(root,'Laputa')};}
test('new named projects live under Laputa and persist directory identity across restart',async()=>{
 const {profile,projects}=setup();let manager=new Workbenches(profile,vault,()=>{},projects);
 try{
  assert.ok(existsSync(projects));const tree=manager.createWorktree('精品 AI 游戏'),board=manager.create('terminal','开发终端',tree.id);
  assert.equal(manager.treePath(tree.id),join(projects,'精品 AI 游戏'));assert.ok(manager.path(board.id).startsWith(join(profile,'.workbench-data')+'/'));assert.deepEqual(require('node:fs').readdirSync(manager.treePath(tree.id)),[]);
  writeFileSync(join(manager.treePath(tree.id),'game.md'),'游戏世界设定');await manager.get(board.id).importFiles([{name:'brief.md',bytes:new TextEncoder().encode('project brief').buffer}]);
  const files=manager.files(tree.id),listing=await listWorkspaceFiles(files.root,[],files.assets,files.folders);assert.ok(listing.files.some(f=>f.name==='game.md'));assert.equal((await readWorkspaceFile(files.root,'game.md')).text,'游戏世界设定');assert.equal(manager.catalog().projectsDirectory,projects);
  manager.close();manager=new Workbenches(profile,vault,()=>{},projects);assert.equal(manager.treePath(tree.id),join(projects,'精品 AI 游戏'));assert.equal(manager.get(board.id).workspace.assets[0].text,'project brief');
 }finally{manager.close();}
});
test('first workspace creates a default project and repeated names never reuse existing directories',()=>{
 const {profile,projects}=setup(),manager=new Workbenches(profile,vault,()=>{},projects);
 try{
  const board=manager.create('image-video');assert.equal(manager.treePath(board.worktreeId),join(projects,'默认项目'));assert.notEqual(board.id,'legacy');
  mkdirSync(join(projects,'新游戏'));writeFileSync(join(projects,'新游戏','keep.txt'),'existing files');const first=manager.createWorktree('新游戏'),second=manager.createWorktree('新游戏');assert.equal(first.projectFolder,'新游戏-2');assert.equal(second.projectFolder,'新游戏-3');assert.equal(readFileSync(join(projects,'新游戏','keep.txt'),'utf8'),'existing files');
  const unsafe=manager.createWorktree('../../outside\\escape');assert.ok(!relative(projects,manager.treePath(unsafe.id)).startsWith('..'));assert.ok(!unsafe.projectFolder!.includes('/'));assert.ok(!unsafe.projectFolder!.includes('\\'));
 }finally{manager.close();}
});
test('existing app-profile projects keep original paths and data while new projects use Laputa',()=>{
 const {profile,projects}=setup();let manager=new Workbenches(profile,vault,()=>{});const old=manager.create('image-video'),oldTree=manager.createWorktree('旧项目'),other=manager.create('image-video','旧工作台',oldTree.id);const legacyPath=manager.path(old.id),otherPath=manager.path(other.id);manager.get(old.id).saveDraft('image',{prompt:'保留旧数据',attachmentIds:[],mode:'text',discussion:false});manager.close();
 manager=new Workbenches(profile,vault,()=>{},projects);
 try{assert.equal(manager.path(old.id),legacyPath);assert.equal(manager.path(other.id),otherPath);assert.equal(manager.get(old.id).workspace.drafts.image.prompt,'保留旧数据');const added=manager.createWorktree('新项目');assert.equal(manager.treePath(added.id),join(projects,'新项目'));assert.equal(manager.worktrees.length,3);}finally{manager.close();}
});
test('deleting a workbench under Laputa preserves project files and another workbench',async()=>{
 const {profile,projects}=setup(),manager=new Workbenches(profile,vault,()=>{},projects),tree=manager.createWorktree('共享项目'),first=manager.create('image-video','删除实例',tree.id),second=manager.create('terminal','保留实例',tree.id),trash=join(mkdtempSync(join(tmpdir(),'laputa-project-trash-')),'deleted');writeFileSync(join(manager.treePath(tree.id),'game.txt'),'project file');
 try{await manager.deleteWorkbench(first.id,async path=>renameSync(path,trash));assert.equal(readFileSync(join(manager.treePath(tree.id),'game.txt'),'utf8'),'project file');assert.ok(existsSync(join(manager.path(second.id),'workspace.sqlite')));assert.ok(existsSync(join(trash,'workbench','workspace.sqlite')));}finally{manager.close();}
});
test('persisted project folders cannot escape the configured root',()=>{
 const {profile,projects}=setup();let manager=new Workbenches(profile,vault,()=>{},projects);manager.createWorktree('有效项目');manager.close();const file=join(profile,'workbenches.json'),catalog=JSON.parse(readFileSync(file,'utf8'));catalog.worktrees[0].projectFolder='../outside';writeFileSync(file,JSON.stringify(catalog));assert.throws(()=>new Workbenches(profile,vault,()=>{},projects),/目录配置/);
});
test('terminal starts and records commands in a Chinese project directory using app-profile shell configuration',async()=>{
 const {profile,projects}=setup(),manager=new Workbenches(profile,vault,()=>{},projects),tree=manager.createWorktree('中文 游戏项目'),entry=manager.create('terminal','终端',tree.id),terminals=new Terminals(id=>({service:manager.get(id),cwd:manager.treePath(manager.info(id).worktreeId)}),()=>{},undefined,profile);
 async function until(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Chinese project terminal timeout');}
 try{
  const pane=terminals.list(entry.id)[0];await until(()=>terminals.session(entry.id,pane.id).ready);assert.equal(pane.cwd,join(projects,'中文 游戏项目'));
  terminals.write(entry.id,pane.id,'pwd\r');await until(()=>terminals.session(entry.id,pane.id).state.messages.some(m=>m.role==='assistant'&&m.text.includes(pane.cwd)&&!m.running));
  assert.ok(existsSync(join(profile,'.terminal-shell',pane.id,'.zshrc')));assert.ok(!existsSync(join(manager.path(entry.id),'.terminal-shell')));
 }finally{terminals.closeAll();manager.close();}
});
