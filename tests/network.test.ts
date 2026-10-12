import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {networkDetail,setNetworkFetch} from '../electron/network';
import {jsonRequest,ProviderError} from '../electron/providers';
import {Service} from '../electron/service';
import {Store} from '../electron/store';
test('transport errors report the API host and classified reason without leaking low-level content',async()=>{
 const errors=[{error:new TypeError('fetch failed',{cause:{code:'ENOTFOUND',message:'secret-key should never appear'}}),detail:'DNS 解析失败'},{error:new DOMException('timeout','TimeoutError'),detail:'请求超时'},{error:new Error('net::ERR_CERT_AUTHORITY_INVALID'),detail:'TLS／证书连接失败'}];
 try{for(const {error,detail} of errors){assert.equal(networkDetail(error),detail);setNetworkFetch(async()=>{throw error;});await assert.rejects(()=>jsonRequest('https://api.minimax.cn/v2/video_generation',{method:'POST'}),(e:any)=>e instanceof ProviderError&&e.uncertain&&e.message.includes(detail)&&e.message.includes('api.minimax.cn')&&!e.message.includes('secret-key'));await assert.rejects(()=>jsonRequest('https://api.minimax.cn/v2/query/video_generation',{}),(e:any)=>e instanceof ProviderError&&!e.uncertain);}}finally{setNetworkFetch(undefined);}
});
test('failure in prompt optimization does not submit MiniMax and clearly identifies the OpenAI phase',async()=>{
 const store=new Store(mkdtempSync(join(tmpdir(),'prompt-network-')));const service=new Service(store,{secure:false,get:()=> 'test-only',set:()=>{}},()=>{});const urls:string[]=[];
 setNetworkFetch(async input=>{urls.push(String(input));throw new DOMException('timeout','TimeoutError');});
 try{const frame=await service.assets.import('frame.png',readFileSync('tests/fixtures/image.png'));service.workspace.assets.push(frame);service.workspace.settings.optimize=true;const task=await service.generate({kind:'video',requestId:'prompt-fail',draft:{prompt:'缓慢推近',attachmentIds:[frame.id],mode:'reference',discussion:false}});for(let i=0;i<100&&service.workspace.tasks[0].state!=='failed';i++)await new Promise(r=>setTimeout(r,10));const failed=service.workspace.tasks.find(t=>t.id===task.id)!;assert.equal(failed.state,'failed');assert.match(failed.error!,/OpenAI 提示词处理失败/);assert.match(failed.error!,/视频尚未提交到 MiniMax/);assert.match(failed.error!,/api.openai.com/);assert.equal(urls.length,1);assert.ok(!urls.some(u=>u.includes('minimax')));assert.equal(failed.remoteTaskId,undefined);}finally{setNetworkFetch(undefined);service.close();store.close();}
});
