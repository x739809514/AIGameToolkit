import {unzipSync,zipSync} from 'fflate';
import {validateRig2D,worldBones2D,partTransforms2D,transform2D,sampleClip2D,type Rig2D,type Point2D} from '../src/shared/skeletal2d';
declare global {interface Window {RIG_EXPERIMENT:any;rigReview:any}}
const data=window.RIG_EXPERIMENT;
let rig:Rig2D=validateRig2D(data.rig),images=new Map<string,HTMLImageElement>(),playing=true,time=0,last=performance.now();
const $=(s:string)=>document.querySelector(s) as HTMLInputElement;
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const sha=async(v:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(v)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const load=(s:string)=>new Promise<HTMLImageElement>((ok,bad)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>bad(Error('Invalid part image'));im.src='data:image/png;base64,'+s;});
const b64=(v:Uint8Array)=>{let s='';for(let i=0;i<v.length;i+=8192)s+=String.fromCharCode(...v.subarray(i,i+8192));return btoa(s);};
let packageBytes=bytes(data.package),source:HTMLImageElement,generated:HTMLImageElement;
function guides(c:CanvasRenderingContext2D,pose:Record<string,number>){
 const bones=worldBones2D(rig,pose);c.save();c.lineWidth=3;c.strokeStyle='#ea4cd3';c.fillStyle='#fff';
 for(const b of rig.bones){const p=transform2D(bones.get(b.id)!,[0,0]);if(b.parent){const a=transform2D(bones.get(b.parent)!,[0,0]);c.beginPath();c.moveTo(...a);c.lineTo(...p);c.stroke();}c.beginPath();c.arc(...p,6,0,Math.PI*2);c.fill();c.stroke();}c.restore();
}
function draw(t:number,options:{fills?:boolean;bones?:boolean;isolate?:boolean}={}){
 time=t;const cv=$('#preview') as unknown as HTMLCanvasElement,c=cv.getContext('2d')!;
 c.clearRect(0,0,cv.width,cv.height);const pose=sampleClip2D(rig.clips[0],t),transforms=partTransforms2D(rig,pose);
 for(const p of [...rig.parts].sort((a,b)=>a.z-b.z)){
  if((options.fills??$('#fills').checked)===false&&p.role==='joint-fill')continue;
  if((options.isolate??$('#isolate').checked)&&!p.bone.startsWith('right-')&&p.id!=='shoulder-fill')continue;
  c.save();c.setTransform(...transforms.get(p.id)!);c.drawImage(images.get(p.asset)!,...p.crop);c.restore();
 }
 if(options.bones??$('#bones').checked)guides(c,pose);
 $('#time').value=String(t);$('#clock').textContent=t.toFixed(2)+' s';return cv.toDataURL('image/png');
}
async function importPackage(v:Uint8Array){
 const files=unzipSync(v),manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
 if(manifest.format!=='laputa-cutout-package-v1'||!manifest.files||!files['project.json'])throw Error('Unsupported package');
 for(const [name,digest] of Object.entries(manifest.files))if(!files[name]||await sha(files[name])!==digest)throw Error('Asset integrity check failed: '+name);
 if(!manifest.files['project.json'])throw Error('Project integrity record missing');
 const next=validateRig2D(JSON.parse(new TextDecoder().decode(files['project.json'])));
 if(next.canvas[0]!==1024||next.canvas[1]!==1536||next.sourceHash!==data.rig.sourceHash||next.sourceHash!==manifest.sourceHash)throw Error('This review only accepts its registered sample');
 const loaded=new Map<string,HTMLImageElement>();
 for(const p of next.parts){if(!manifest.files[p.asset]||!files[p.asset])throw Error('Missing registered asset');const im=await load(b64(files[p.asset]));if(im.width!==p.crop[2]||im.height!==p.crop[3])throw Error('Sprite dimensions disagree with crop');loaded.set(p.asset,im);}
 // Commit only after every document and asset check passes.
 rig=next;images=loaded;packageBytes=v;$('#status').textContent='回读成功：文档和所有部件哈希匹配';draw(time);
}
function joinError(t:number){
 const pose=sampleClip2D(rig.clips[0],t),m=partTransforms2D(rig,pose),b=worldBones2D(rig,pose);
 const checks:[string,string,Point2D][]=[['right-upper','right-lower',[788,570]],['right-lower','right-hand',[900,570]]];
 return Math.max(...checks.map(([parent,child,p])=>{const a=transform2D(m.get(parent)!,p),target=transform2D(b.get(child)!,[0,0]);return Math.hypot(a[0]-target[0],a[1]-target[1]);}));
}
$('#play').onclick=()=>{playing=!playing;$('#play').textContent=playing?'暂停':'播放';};
$('#time').oninput=()=>{playing=false;$('#play').textContent='播放';draw(Number($('#time').value));};
for(const id of ['bones','fills','isolate'])$('#'+id).onchange=()=>draw(time);
$('#export').onclick=()=>{const blob=new Blob([new Uint8Array(packageBytes)],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='character.laputa2d.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#import').onchange=async()=>{const file=$('#import').files?.[0];if(file)try{await importPackage(new Uint8Array(await file.arrayBuffer()));}catch(e){$('#status').textContent='回读失败：'+(e as Error).message;}};
window.rigReview={ready:false,draw,joinError,importPackage,exportPackage:()=>b64(packageBytes),document:()=>structuredClone(rig),pause:()=>{playing=false;},
 sourceRender:()=>{const cv=document.createElement('canvas');cv.width=1024;cv.height=1536;cv.getContext('2d')!.drawImage(source,0,0);return cv.toDataURL('image/png');},
 corruptPackage:()=>{const f=unzipSync(packageBytes);f['parts/head.png'][50]^=1;return zipSync(f);}};
Promise.all([load(data.source),load(data.generated),...Object.entries(data.assets).map(async([k,v])=>images.set(k,await load(v as string)))]).then(([clean,original])=>{
 source=clean as HTMLImageElement;generated=original as HTMLImageElement;
 const c=($('#source') as unknown as HTMLCanvasElement).getContext('2d')!;c.drawImage(generated,0,0);guides(c,{});
 $('#status').textContent='已加载：12 个源部件 + 3 个隐藏接点补片';window.rigReview.ready=true;
 const animate=(now:number)=>{if(playing)time=(time+Math.min((now-last)/1000,.1))%rig.clips[0].duration;last=now;draw(time);requestAnimationFrame(animate);};requestAnimationFrame(animate);
}).catch(e=>{$('#status').textContent=String(e);});
