import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,emptyWorkspace,minimaxAPI,type Settings,type Task,type Asset} from '../src/shared/types';
import {createVideo,queryVideo,testConnection} from '../electron/providers';
import {Store} from '../electron/store';
import {Service} from '../electron/service';
const task=(settings:Settings={...defaults}):Task=>({id:'region-task',requestId:'region-request',kind:'video',state:'queued',createdAt:Date.now(),updatedAt:Date.now(),prompt:'镜头缓慢推进',assetIds:[],baseImageId:'frame',mode:'first_frame',discussion:false,settings,outputAssetIds:[],remoteTaskId:'remote-region'});
test('new video generation, query and connection test use the China API',async()=>{
 const original=globalThis.fetch;const calls:{url:string;method:string}[]=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),method:init?.method||'GET'});assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-only');return Response.json(init?.method==='POST'?{task_id:'remote-region'}:{task:{status:'running'},tasks:[]});};
 const frame:Asset={id:'frame',name:'frame.png',type:'image',mime:'image/png',size:1,width:1024,height:1024,url:'asset://local/frame',createdAt:0};
 try{assert.equal(defaults.minimaxRegion,'cn');assert.equal(await createVideo(task(),[frame],()=> 'data:image/png;base64,test','test-only'),'remote-region');await queryVideo('remote-region','test-only');const result=await testConnection('minimax','test-only');assert.match(result,/中国区/);assert.deepEqual(calls,[{url:'https://api.minimax.cn/v2/video_generation',method:'POST'},{url:'https://api.minimax.cn/v2/query/video_generation/remote-region',method:'GET'},{url:'https://api.minimax.cn/v2/query/video_generation?page_num=1&page_size=1',method:'GET'}]);assert.throws(()=>minimaxAPI('invalid' as any),/地区/);}finally{globalThis.fetch=original;}
});
test('migration switches the workspace to China but records overseas provenance on old tasks',()=>{
 const store=new Store(mkdtempSync(join(tmpdir(),'region-migration-')));try{const legacy=emptyWorkspace();delete (legacy.settings as Partial<Settings>).minimaxRegion;const old=task();delete (old.settings as Partial<Settings>).minimaxRegion;legacy.tasks.push(old);legacy.settings.imageModel='custom-image-model';store.save(legacy);const migrated=store.load();assert.equal(migrated.settings.minimaxRegion,'cn');assert.equal(migrated.settings.imageModel,'custom-image-model');assert.equal(migrated.tasks[0].settings.minimaxRegion,'global');assert.deepEqual(store.load(),migrated);}finally{store.close();}
});
test('polling follows each task region rather than current workspace settings',async()=>{
 const store=new Store(mkdtempSync(join(tmpdir(),'region-poll-')));const service=new Service(store,{secure:false,get:()=> 'test-only',set:()=>{}},()=>{});const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async(input)=>{urls.push(String(input));return Response.json({task:{status:'running'}});};
 try{const old=task({...defaults,minimaxRegion:'global'}),current=task();current.id='current';current.remoteTaskId='remote-cn';service.workspace.tasks.push(old,current);await service.poll(old);await service.poll(current);assert.deepEqual(urls,['https://api.minimax.io/v2/query/video_generation/remote-region','https://api.minimax.cn/v2/query/video_generation/remote-cn']);assert.equal(service.workspace.settings.minimaxRegion,'cn');}finally{globalThis.fetch=original;service.close();store.close();}
});
