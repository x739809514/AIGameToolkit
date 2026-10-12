// Desktop uses Chromium's networking so system proxy and TLS settings match Electron.
// Keep Node fetch as the default for isolated provider tests.
let transport:typeof fetch|undefined;
export function setNetworkFetch(value:typeof fetch|undefined){transport=value;}
export function fetchHTTP(input:Parameters<typeof fetch>[0],init?:RequestInit){return (transport||globalThis.fetch)(input,init);}
export function networkDetail(error:unknown){
  const e=error as {name?:string;message?:string;code?:string;cause?:{code?:string;message?:string}};
  const code=e?.cause?.code||e?.code||'';const message=e?.cause?.message||e?.message||'';
  if(e?.name==='TimeoutError'||e?.name==='AbortError'||/TIMEOUT|TIMED_OUT/.test(code)||/timed out/i.test(message))return '请求超时';
  if(/ENOTFOUND|EAI_AGAIN/.test(code)||/ERR_NAME_NOT_RESOLVED/.test(message))return 'DNS 解析失败';
  if(/CERT|TLS|SSL/.test(code)||/ERR_CERT|ERR_SSL/.test(message))return 'TLS／证书连接失败';
  if(/ECONNREFUSED/.test(code)||/ERR_CONNECTION_REFUSED/.test(message))return '连接被拒绝';
  if(/ECONNRESET|UND_ERR_SOCKET/.test(code)||/ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED/.test(message))return '连接中断';
  return '网络连接失败';
}
