import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompletionTracker,TaskNotifications,type TaskCompletion,type CompletionNotice} from '../electron/task-notifications';
import {emptyWorkspace,type Task} from '../src/shared/types';
import {Workbenches} from '../electron/workbenches';
const task=(id:string,state:Task['state']):Task=>({id,state,requestId:id,kind:'image',createdAt:0,updatedAt:0,prompt:'private prompt',assetIds:[],mode:'text',discussion:false,settings:emptyWorkspace().settings,outputAssetIds:[]});
test('completion tracker skips saved history, interim updates, failures and cancelled tasks',()=>{
 const w=emptyWorkspace(),events:TaskCompletion[]=[];w.tasks=[task('old','succeeded'),task('resumed','running')];
 const tracker=new CompletionTracker(w,e=>events.push(e));tracker.observe(w);assert.equal(events.length,0);
 w.tasks.push(task('new','preparing'));tracker.observe(w);w.tasks[2].state='saving';tracker.observe(w);assert.equal(events.length,0);
 w.tasks[2].state='succeeded';tracker.observe(w);tracker.observe(w);assert.deepEqual(events,[{id:'task:new',label:'图片生成'}]);
 w.tasks[1].state='succeeded';tracker.observe(w);assert.equal(events.length,2);
 w.tasks.push(task('failed','preparing'),task('cancelled','running'));tracker.observe(w);w.tasks[3].state='failed';w.tasks[4].state='cancelled';tracker.observe(w);assert.equal(events.length,2);
});
test('notification deduplication is scoped to workbench, click opens owner and stale click is ignored',()=>{
 const names=new Map([['a','图片台'],['b','动作台']]),notices:CompletionNotice[]=[],opened:string[]=[];
 const hub=new TaskNotifications(id=>names.get(id),id=>opened.push(id),n=>notices.push(n));
 hub.complete('a',{id:'same',label:'图片生成'});hub.complete('a',{id:'same',label:'图片生成'});hub.complete('b',{id:'same',label:'视频导出'});
 assert.equal(notices.length,2);assert.match(notices[0].body,/图片台/);assert.ok(!notices[0].body.includes('private prompt'));notices[0].click();assert.deepEqual(opened,['a']);names.delete('b');notices[1].click();assert.deepEqual(opened,['a']);
});
test('unavailable notification delivery cannot fail successful task',()=>{
 const hub=new TaskNotifications(()=> '工作台',()=>{},()=>{throw new Error('notifications disabled');});assert.doesNotThrow(()=>hub.complete('a',{id:'1',label:'视频生成'}));
});
test('workbench service reports persisted completion for background workbench once and never replays on restart',()=>{
 const directory=mkdtempSync(join(tmpdir(),'laputa-notifications-')),vault={secure:false,get:()=>undefined,set:()=>{}},events:{id:string;event:TaskCompletion}[]=[];
 let manager=new Workbenches(directory,vault,()=>{},undefined,(id,event)=>events.push({id,event}));const entry=manager.create('image-video'),s=manager.get(entry.id);
 s.workspace.tasks.push(task('generation','running'));s.changed();s.update(s.workspace.tasks[0],{state:'succeeded'});s.changed();
 assert.equal(events.length,1);assert.equal(events[0].id,entry.id);assert.equal(s.store.load().tasks[0].state,'succeeded');manager.close();
 manager=new Workbenches(directory,vault,()=>{},undefined,(id,event)=>events.push({id,event}));manager.get(entry.id).changed();assert.equal(events.length,1);manager.close();
});
test('frame extraction notifies once after frames are saved',()=>{
 const w=emptyWorkspace(),events:TaskCompletion[]=[],tracker=new CompletionTracker(w,e=>events.push(e));w.frameWorkspace={mode:'split',frameCount:1,sequences:[{id:'sequence',requestId:'request',videoId:'video',count:1,status:'extracting',createdAt:0,frames:[]}]};tracker.observe(w);w.frameWorkspace.sequences[0].status='succeeded';tracker.observe(w);tracker.observe(w);assert.deepEqual(events,[{id:'frames:sequence',label:'视频拆帧'}]);
});
