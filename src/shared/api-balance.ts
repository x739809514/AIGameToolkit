import type {Provider} from './types';
export const balanceProviders:Provider[]=['openai','anthropic','minimax','tripo'];
export const balanceProviderInfo={
 tripo:{name:'Tripo',billingURL:'https://platform.tripo3d.ai'},
 openai:{name:'OpenAI',billingURL:'https://platform.openai.com/settings/organization/billing/overview'},
 anthropic:{name:'Claude',billingURL:'https://platform.claude.com/settings/billing'},
 minimax:{name:'MiniMax',billingURL:'https://platform.minimax.cn/user-center/payment/balance'}
} as const;
export interface APIBalance {
 provider:Provider;status:'available'|'unsupported'|'unconfigured'|'error';
 credits?:{status:'available'|'unconfigured'|'error';amount?:number;message:string};
 amount?:number;currency?:'CNY'|'USD';checkedAt:number;message:string;
 details?:{cash?:number;voucher?:number;credit?:number;owed?:number};
}
export function formatAPIBalance(balance:APIBalance){
 if(balance.credits?.status==='available'&&Number.isFinite(balance.credits.amount))return `${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(balance.credits.amount!)} 积分`;
 if(balance.provider==='minimax'&&balance.credits)return balance.credits.status==='unconfigured'?'请登录查看积分':'积分查询失败';
 if(balance.status==='available'&&Number.isFinite(balance.amount)&&balance.currency)return new Intl.NumberFormat('zh-CN',{style:'currency',currency:balance.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(balance.amount!);
 return {available:'未知',unsupported:'控制台查看',unconfigured:'未接入',error:'查询失败'}[balance.status];
}
