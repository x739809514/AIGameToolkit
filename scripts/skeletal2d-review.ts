/** Build the real-image cutout experiment. Run after the one-shot generation. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {zipSync} from 'fflate';
import {buildSync} from 'esbuild';
import {validateRig2D,type Rig2D,type Bone2D,type Part2D} from '../src/shared/skeletal2d';
const out=resolve('output/skeletal2d-review');mkdirSync(join(out,'parts'),{recursive:true});
const source=readFileSync(join(out,'generated-front.png')),im=PNG.sync.read(source);
if(im.width!==1024||im.height!==1536)throw Error('This manually registered experiment requires its inspected 1024×1536 source.');
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
// This sample has no white character material. White removal is sample-specific,
// not a general semantic segmentation/background-removal implementation.
for(let i=0;i<im.data.length;i+=4){const m=Math.min(im.data[i],im.data[i+1],im.data[i+2]);if(m>240)im.data[i+3]=0;}
const clean=PNG.sync.write(im);writeFileSync(join(out,'clean-source.png'),clean);
const classify=(x:number,y:number)=>{
 if(y<460)return 'head';
 if(y<509)return 'torso';
 if(y<856){
  // Arms occupy a bounded band. Without this condition a torso outline pixel
  // beyond x=626 was incorrectly assigned to the arm and flew out on rotation.
  if(y<522||y>=618)return 'torso';
  if(x<124)return 'left-hand';if(x<236)return 'left-lower';if(x<398)return 'left-upper';if(x<627)return 'torso';if(x<788)return 'right-upper';if(x<900)return 'right-lower';return 'right-hand';
 }
 if(y<1239)return x<512?'left-leg':'right-leg';return x<512?'left-foot':'right-foot';
};
const names=['head','torso','left-upper','left-lower','left-hand','right-upper','right-lower','right-hand','left-leg','right-leg','left-foot','right-foot'];
const buffers=new Map(names.map(n=>[n,new PNG({width:im.width,height:im.height})]));
for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const i=(y*im.width+x)*4;if(im.data[i+3])im.data.copy(buffers.get(classify(x,y))!.data,i,i,i+4);}
const files:Record<string,Uint8Array>={},parts:Part2D[]=[];
function trim(name:string,png:PNG,bone:string,role:Part2D['role']='source',z=0){
 let l=png.width,t=png.height,r=0,b=0;
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(png.data[(y*png.width+x)*4+3]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
 if(r<=l||b<=t)throw Error('Empty part '+name);
 const cut=new PNG({width:r-l,height:b-t});PNG.bitblt(png,cut,l,t,r-l,b-t,0,0);
 const asset='parts/'+name+'.png',bytes=PNG.sync.write(cut);files[asset]=bytes;writeFileSync(join(out,asset),bytes);
 parts.push({id:name,bone,asset,crop:[l,t,r-l,b-t],role,z});
}
names.forEach((n,i)=>trim(n,buffers.get(n)!,n,'source',i));
// Visible source artwork lacks the concealed caps a freely rotating joint needs.
// These explicit, separately toggleable patches are a controlled manual repair.
for(const [name,bone,x,y,sampleX] of [['shoulder-fill','torso',626,570,645],['elbow-fill','right-upper',788,570,760],['wrist-fill','right-lower',900,570,870]] as const){
 const p=new PNG({width:im.width,height:im.height}),color=[...im.data.subarray((570*im.width+sampleX)*4,(570*im.width+sampleX)*4+4)];
 for(let yy=y-34;yy<=y+34;yy++)for(let xx=x-34;xx<=x+34;xx++)if((xx-x)**2+(yy-y)**2<=34**2)p.data.set(color,(yy*im.width+xx)*4);
 trim(name,p,bone,'joint-fill',-10);
}
const bone=(id:string,parent:string|undefined,x:number,y:number):Bone2D=>({id,parent,origin:[x,y],rotation:0});
const rig:Rig2D={format:'laputa-cutout-experiment',version:1,revision:1,canvas:[im.width,im.height],sourceHash:hash(source),
 bones:[bone('root',undefined,512,856),bone('torso','root',0,-347),bone('head','torso',0,-49),
 bone('left-upper','torso',-114,61),bone('left-lower','left-upper',-162,0),bone('left-hand','left-lower',-112,0),
 bone('right-upper','torso',114,61),bone('right-lower','right-upper',162,0),bone('right-hand','right-lower',112,0),
 bone('left-leg','root',-56,0),bone('left-foot','left-leg',0,383),bone('right-leg','root',56,0),bone('right-foot','right-leg',0,383)],parts,
 clips:[{id:'right-arm-bend',duration:2,keys:[
 {time:0,rotations:{'right-upper':0,'right-lower':0}},
 {time:.5,rotations:{'right-upper':-12,'right-lower':-65}},
 {time:1,rotations:{'right-upper':-15,'right-lower':-115}},
 {time:1.5,rotations:{'right-upper':-8,'right-lower':-75}},
 {time:2,rotations:{'right-upper':0,'right-lower':0}}]}]};
validateRig2D(rig);files['project.json']=Buffer.from(JSON.stringify(rig,null,2));
for(const p of rig.parts.filter(p=>p.role==='source'&&p.bone.startsWith('right-')&&!p.bone.includes('leg')&&!p.bone.includes('foot'))){if(p.crop[1]<522||p.crop[1]+p.crop[3]>618)throw Error('Arm mask includes pixels outside the registered arm band: '+p.id);}
const manifest={format:'laputa-cutout-package-v1',sourceHash:rig.sourceHash,files:Object.fromEntries(Object.entries(files).map(([n,v])=>[n,hash(v)]))};
files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2));
writeFileSync(join(out,'project.json'),files['project.json']);writeFileSync(join(out,'manifest.json'),files['manifest.json']);writeFileSync(join(out,'character.laputa2d.zip'),zipSync(files));
const js=buildSync({entryPoints:['scripts/skeletal2d-preview.ts'],bundle:true,platform:'browser',format:'iife',write:false}).outputFiles[0].text;
const assets=Object.fromEntries(parts.map(p=>[p.asset,Buffer.from(files[p.asset]).toString('base64')]));
const payload=JSON.stringify({rig,assets,source:clean.toString('base64'),generated:source.toString('base64'),package:readFileSync(join(out,'character.laputa2d.zip')).toString('base64')});
writeFileSync(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Laputa · 二维骨骼流程验证</title><style>
*{box-sizing:border-box}body{margin:0;background:#10151e;color:#e7edf6;font:14px system-ui}main{max-width:1160px;margin:28px auto;padding:0 24px}h1{font-size:23px;margin-bottom:8px}p{color:#a6b3c8;line-height:1.7}.panels{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{background:#192231;border:1px solid #334259;border-radius:14px;padding:16px}.panel h2{font-size:15px;margin:0 0 12px}canvas{display:block;width:100%;height:auto;max-height:66vh;object-fit:contain;background:repeating-conic-gradient(#253042 0% 25%,#202a39 0% 50%) 50%/20px 20px;border-radius:8px}button,label.action{background:#304662;border:1px solid #4a6380;border-radius:7px;padding:9px 12px;color:white;cursor:pointer}label{display:inline-flex;align-items:center;gap:5px}nav{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:18px 0}input[type=range]{width:220px}#status{color:#8ddbb4}small{color:#afbdd0}.note{padding:12px 16px;background:#202c3e;border-radius:8px}input[type=file]{display:none}</style>
<main><h1>二维骨骼角色 · 小闭环验证</h1><p>真实生图 API → 人工登记拆件与关节 → 刚性骨骼驱动 → ZIP 导出 → 校验并回读。单正面、单动作；没有调用动作生成 API。</p>
<nav><button id="play">暂停</button><input id="time" aria-label="时间" type="range" min="0" max="2" step="0.001" value="0"><span id="clock">0.00 s</span><label><input id="bones" type="checkbox" checked>骨骼接点</label><label><input id="fills" type="checkbox" checked>隐藏关节补全</label><label><input id="isolate" type="checkbox">仅活动手臂</label></nav>
<div class="panels"><section class="panel"><h2>生成原图 / 重新登记实际关节</h2><canvas id="source" width="1024" height="1536"></canvas></section><section class="panel"><h2>拆件后的实际骨骼动画</h2><canvas id="preview" width="1024" height="1536"></canvas></section></div>
<nav><button id="export">导出角色 ZIP</button><label class="action">回读角色 ZIP<input id="import" type="file" accept=".zip"></label><span id="status">正在加载…</span></nav>
<p class="note">关闭「隐藏关节补全」对比弯肘后的缺口。当前拆件、关节与补片为人工校准；白底处理只适用于此无白色材质的样例。数值接点连续不等于美术无接缝。</p>
<small>坐标：图片像素，Y 向下，角度顺时针；裁切偏移保留在源画布中。可离线打开此页面。</small></main>
<script>window.RIG_EXPERIMENT=${payload};</script><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log(JSON.stringify({out,source:[im.width,im.height],parts:parts.length,bones:rig.bones.length,sourceHash:rig.sourceHash}));
