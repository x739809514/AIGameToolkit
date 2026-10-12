import {createServer} from 'node:http';
import {once} from 'node:events';
import {jsonRequest} from './providers';
export async function networkSelfTest(){
  const requests:{path:string;type:string;body:string}[]=[];
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));requests.push({path:req.url||'',type:req.headers['content-type']||'',body:Buffer.concat(chunks).toString()});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('本地网络测试服务未启动');
  try{
    const url=`http://127.0.0.1:${address.port}`;
    await jsonRequest(url+'/json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'test-only'})},5000);
    const form=new FormData();form.set('prompt','测试遮罩');form.append('image[]',new Blob([new Uint8Array([1,2,3])],{type:'image/png'}),'source.png');form.set('mask',new Blob([new Uint8Array([4,5,6])],{type:'image/png'}),'mask.png');
    await jsonRequest(url+'/multipart',{method:'POST',body:form},5000);
    if(requests.length!==2||JSON.parse(requests[0].body).model!=='test-only'||!requests[1].type.includes('multipart/form-data; boundary=')||!requests[1].body.includes('name="image[]"')||!requests[1].body.includes('filename="mask.png"'))throw new Error('桌面网络请求序列化失败');
    return {json:true,multipart:true};
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
