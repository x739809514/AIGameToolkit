import {fetchHTTP,networkDetail} from './network';
import {tripoRequest} from './tripo';
import {balanceProviders,type APIBalance} from '../src/shared/api-balance';
import type {MiniMaxRegion,Provider} from '../src/shared/types';
import type {Vault} from './service';

// Keys remain in the main process. Share short-lived results across workbenches,
// with distinct caches for each credential and region; never persist billing data.
let creditsSession:undefined|(()=>Promise<NonNullable<APIBalance['credits']>>|undefined);
export function setMiniMaxCreditsSession(reader:()=>Promise<NonNullable<APIBalance['credits']>>|undefined){creditsSession=reader;}
const readers=new WeakMap<Vault,BalanceReader>();
export function apiBalanceReader(vault:Vault){let reader=readers.get(vault);if(!reader){reader=new BalanceReader(vault);readers.set(vault,reader);}return reader;}
const number=(value:unknown)=>{if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!value.trim())return undefined;const n=Number(value);return Number.isFinite(n)?n:undefined;};
export async function queryMiniMaxBalance(key:string):Promise<APIBalance>{
 const base={provider:'minimax' as const,checkedAt:Date.now()};
 try{
  // MiniMax's console balance endpoint is used by its China platform. This is
  // not a documented public API; unavailable responses are surfaced explicitly.
  const response=await fetchHTTP('https://www.minimaxi.com/account/query_balance',{method:'GET',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok){const message=response.status===401||response.status===403?'余额查询权限不足或 Key 无效':response.status===429?'查询频繁，请稍后刷新':response.status===404?'服务商暂未开放余额查询，请前往控制台':'余额服务暂不可用，请前往控制台';return {...base,status:'error',message};}
  const data=await response.json();if(!data||data.base_resp?.status_code!==0)return {...base,status:'error',message:data?.base_resp?.status_code===1004?'余额查询权限不足或 Key 无效':'服务商未返回可用余额，请前往控制台'};
  const amount=number(data.available_amount);if(amount===undefined)return {...base,status:'error',message:'余额响应格式发生变化，请前往控制台'};
  return {...base,status:'available',amount,currency:'CNY',message:'MiniMax 中国区可用额度，包含账户可用资金及适用额度；实际扣费以服务商为准。',details:{cash:number(data.cash_balance),voucher:number(data.voucher_balance),credit:number(data.credit_balance),owed:number(data.owed_amount)}};
 }catch(error){return {...base,status:'error',message:error instanceof SyntaxError?'服务商返回了无法识别的余额数据':`${networkDetail(error)}，请稍后刷新或前往控制台`};}
}
// The console uses this read-only endpoint for credit packs. It is separate
// from available_amount (CNY) and credit_balance (credit line), neither is points.
export async function queryMiniMaxCredits(key:string|undefined,region:MiniMaxRegion,request:(input:string,init?:RequestInit)=>Promise<Response>=fetchHTTP):Promise<NonNullable<APIBalance['credits']>>{
 try{
  const host=region==='cn'?'https://www.minimax.cn':'https://www.minimax.io';
  const response=await request(`${host}/backend/account/token_plan_credit`,{method:'GET',headers:key?{Authorization:`Bearer ${key}`}:{},credentials:'include',signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)return {status:'error',message:response.status===401||response.status===403?'网页登录已失效，请点击「登录查看积分」重新登录':'积分查询服务暂不可用，请在套餐详情查看'};
  const body=await response.json();if(body?.base_resp?.status_code!==0)return {status:'error',message:'积分查询未获授权，请在中国区控制台重新登录'};
  const data=body.data??body,amount=number(data.balance_breakdown?.total_balance??data.remaining_credits);
  if(amount===undefined||amount<0)return {status:'error',message:'接口未返回积分余量，请在套餐详情查看'};
  return {status:'available',amount,message:'积分包余量，与按量付费账户余额分开计算'};
 }catch{return {status:'error',message:'积分查询失败，请刷新或在套餐详情查看'};}
}
export class BalanceReader {
 private entries=new Map<Provider,{key:string;creditsKey?:string;region:MiniMaxRegion;result?:APIBalance;pending?:Promise<APIBalance>}>();
 constructor(private vault:Vault){}
 invalidate(){this.entries.delete('minimax');}
 async read(region:MiniMaxRegion,force=false):Promise<APIBalance[]>{
  return Promise.all(balanceProviders.map(async provider=>{
   const key=this.vault.get(provider),base={provider,checkedAt:Date.now()};
   if(!key){this.entries.delete(provider);return {...base,status:'unconfigured' as const,message:'在设置中接入 API 后显示账户状态'};}
   if(provider==='tripo'){
    let entry=this.entries.get(provider);if(!entry||entry.key!==key){entry={key,region};this.entries.set(provider,entry);}
    if(entry.pending)return entry.pending;
    const ttl=entry.result?.status==='error'?30000:300000;if(entry.result&&Date.now()-entry.result.checkedAt<(force?5000:ttl))return structuredClone(entry.result);
    const current=entry;current.pending=(async():Promise<APIBalance>=>{try{const data=await tripoRequest('/account/balance',key,new AbortController().signal);if(typeof data.balance!=='number'||!Number.isFinite(data.balance)||data.balance<0)throw new Error('余额格式错误');return {...base,status:'available',credits:{status:'available',amount:data.balance,message:typeof data.frozen==='number'?`冻结积分：${data.frozen}`:'Tripo 可用积分'},message:'Tripo 可用积分，实际消耗以服务商为准。'};}catch{return {...base,status:'error',message:'Tripo 积分查询失败，请检查 Key 或在控制台查看。'};}})().then(result=>{current.result=result;return structuredClone(result);}).finally(()=>{current.pending=undefined;});return current.pending;
   }
   if(provider!=='minimax'||region!=='cn')return {...base,status:'unsupported' as const,message:provider==='minimax'?'当前地区未接入余额接口，请在服务商控制台查看':'当前普通 API Key 未提供可用的余额查询接口，请在服务商控制台查看'};
   const creditsKey=this.vault.getMiniMaxCreditsKey?.()||(key.startsWith('sk-cp-')?key:undefined);
   let entry=this.entries.get(provider);if(!entry||entry.key!==key||entry.creditsKey!==creditsKey||entry.region!==region){entry={key,creditsKey,region};this.entries.set(provider,entry);}
   if(entry.pending)return entry.pending;
   const age=Date.now()-(entry.result?.checkedAt||0),ttl=entry.result?.status==='error'?30000:300000;
   if(entry.result&&age<(force?5000:ttl))return structuredClone(entry.result);
   const current=entry;current.pending=Promise.all([queryMiniMaxBalance(key),creditsSession?.()??Promise.resolve({status:'unconfigured' as const,message:'请点击「登录查看积分」，在中国区控制台登录。积分查询使用网页登录会话，不使用 API Key。'})]).then(([balance,credits])=>({ ...balance,credits })).then(result=>{current.result=result;return structuredClone(result);}).finally(()=>{current.pending=undefined;});return current.pending;
  }));
 }
}
