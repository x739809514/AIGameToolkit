import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BalanceReader,queryMiniMaxBalance} from '../electron/api-balance';
import {formatAPIBalance} from '../src/shared/api-balance';
import type {Provider} from '../src/shared/types';
const response=(amount:unknown)=>Response.json({base_resp:{status_code:0},available_amount:amount,cash_balance:'10',voucher_balance:'2.5',credit_balance:0,owed_amount:0});
test('only MiniMax China queries balance; ordinary OpenAI/Claude keys are never sent to billing endpoints',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://www.minimaxi.com/account/query_balance');assert.equal(init?.method,'GET');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer mini-test');assert.equal(init?.redirect,'error');return response(12.5);};
 try{const reader=new BalanceReader({secure:false,get:p=>p==='minimax'?'mini-test':'other-test',set:()=>{}}),results=await reader.read('cn');assert.equal(calls,1);assert.equal(results[0].status,'unsupported');assert.equal(results[1].status,'unsupported');assert.equal(results[2].status,'available');assert.equal(results[2].amount,12.5);assert.equal(results[2].details?.cash,10);assert.equal(results[2].currency,'CNY');assert.equal(formatAPIBalance(results[2]),'请登录查看积分');assert.ok(!JSON.stringify(results).includes('test'));assert.equal((await reader.read('global'))[2].status,'unsupported');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('missing credentials, simultaneous refreshes, replacement and removal do not leak cached balances',async()=>{
 const original=globalThis.fetch;let calls=0;const keys:Partial<Record<Provider,string>>={minimax:'first'};globalThis.fetch=async(_url,init)=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return response((init?.headers as Record<string,string>).Authorization==='Bearer first'?12:99);};
 try{const reader=new BalanceReader({secure:false,get:p=>keys[p],set:()=>{}});const [a,b]=await Promise.all([reader.read('cn'),reader.read('cn',true)]);assert.equal(calls,1);assert.deepEqual(a[2],b[2]);assert.equal(a[0].status,'unconfigured');assert.equal((await reader.read('cn'))[2].amount,12);assert.equal(calls,1);keys.minimax='replacement';assert.equal((await reader.read('cn'))[2].amount,99);assert.equal(calls,2);delete keys.minimax;const result=await reader.read('cn');assert.equal(result[2].status,'unconfigured');assert.equal(result[2].amount,undefined);}finally{globalThis.fetch=original;}
});
test('zero balances are valid; malformed, denied and unavailable responses never become a zero balance or expose errors',async()=>{
 const original=globalThis.fetch;
 try{for(const amount of [0,'0','-2.3']){globalThis.fetch=async()=>response(amount);const result=await queryMiniMaxBalance('secret');assert.equal(result.status,'available');assert.equal(result.amount,Number(amount));}
  for(const amount of [null,undefined,'','oops',{},true]){globalThis.fetch=async()=>response(amount);const result=await queryMiniMaxBalance('secret');assert.equal(result.status,'error');assert.equal(result.amount,undefined);}
  for(const mock of [()=>Response.json({base_resp:{status_code:1004,status_msg:'secret'}}),()=>Response.json({error:'secret'},{status:401}),()=>new Response('secret',{status:404}),()=>new Response('<html>secret</html>'),()=>{throw new Error('secret');}]){globalThis.fetch=async()=>mock();const result=await queryMiniMaxBalance('secret');assert.equal(result.status,'error');assert.equal(result.amount,undefined);assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(formatAPIBalance(result),'查询失败');}
 }finally{globalThis.fetch=original;}
});

test('MiniMax points use the credit pool total, never CNY balance or credit line',async()=>{
 const {queryMiniMaxCredits}=await import('../electron/api-balance');let called='';
 const request=async(url:string,init?:RequestInit)=>{called=url;assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer points-key');assert.equal(init?.redirect,'error');return Response.json({base_resp:{status_code:0},balance_breakdown:{total_balance:'4489'},remaining_credits:50,available_amount:'30',credit_balance:'999'});};
 const credits=await queryMiniMaxCredits('points-key','cn',request);assert.equal(called,'https://www.minimax.cn/backend/account/token_plan_credit');assert.equal(credits.status,'available');assert.equal(credits.amount,4489);
 assert.equal(formatAPIBalance({provider:'minimax',status:'available',amount:30,currency:'CNY',checkedAt:0,message:'',credits}),'4,489 积分');
 const zero=await queryMiniMaxCredits('points-key','cn',async()=>Response.json({base_resp:{status_code:0},remaining_credits:0}));assert.equal(zero.amount,0);
 for(const value of [undefined,null,'oops',-1]){const result=await queryMiniMaxCredits('points-key','cn',async()=>Response.json({base_resp:{status_code:0},remaining_credits:value}));assert.equal(result.status,'error');assert.equal(result.amount,undefined);}
 const denied=await queryMiniMaxCredits('points-key','cn',async()=>Response.json({base_resp:{status_code:1004},remaining_credits:4489}));assert.equal(denied.status,'error');assert.equal(denied.amount,undefined);
});
test('API keys are never used to authenticate the console credit pool',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{calls++;assert.equal(url,'https://www.minimaxi.com/account/query_balance');return response(0);};
 try{const reader=new BalanceReader({secure:false,get:p=>p==='minimax'?'sk-cp-video':undefined,set:()=>{},getMiniMaxCreditsKey:()=> 'legacy-credit-key'});const balance=(await reader.read('cn'))[2];assert.equal(calls,1);assert.equal(balance.amount,0);assert.equal(balance.credits?.status,'unconfigured');assert.equal(formatAPIBalance(balance),'请登录查看积分');}finally{globalThis.fetch=original;}
});
test('logged-in console can read credits using isolated session cookies without a subscription key',async()=>{
 const {setMiniMaxCreditsSession,queryMiniMaxCredits}=await import('../electron/api-balance'),original=globalThis.fetch;
 globalThis.fetch=async()=>response(0);let authorized=false;
 setMiniMaxCreditsSession(()=>authorized?queryMiniMaxCredits(undefined,'cn',async(_url,init)=>{assert.deepEqual(init?.headers,{});assert.equal(init?.credentials,'include');return Response.json({base_resp:{status_code:0},remaining_credits:4489});}):undefined);
 try{const reader=new BalanceReader({secure:false,get:p=>p==='minimax'?'video-key':undefined,set:()=>{}});assert.equal((await reader.read('cn'))[2].credits?.status,'unconfigured');authorized=true;reader.invalidate();const balance=(await reader.read('cn'))[2];assert.equal(balance.credits?.amount,4489);assert.equal(balance.amount,0);assert.equal(formatAPIBalance(balance),'4,489 积分');authorized=false;reader.invalidate();assert.equal((await reader.read('cn'))[2].credits?.status,'unconfigured');}finally{globalThis.fetch=original;setMiniMaxCreditsSession(()=>undefined);}
});

test('failed points query does not masquerade as the successful zero cash balance',()=>{
 assert.equal(formatAPIBalance({provider:'minimax',status:'available',amount:0,currency:'CNY',checkedAt:0,message:'',credits:{status:'error',message:'login expired'}}),'积分查询失败');
});
