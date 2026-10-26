/** One real provider request for the isolated 2D rig experiment. Never auto-retry. */
import {app,net,safeStorage} from 'electron';
import {readFileSync,writeFileSync,mkdirSync,existsSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {PNG} from 'pngjs';
import {generateImage} from '../electron/providers';
import {setNetworkFetch} from '../electron/network';
import {defaults,type Task,type Asset} from '../src/shared/types';

const root=resolve(__dirname,'../..'),out=join(root,'output/skeletal2d-review');
const credentialFile=join(app.getPath('appData'),'ai-assets-toolkit','credentials.enc.json');
app.setName('Laputa');app.setPath('userData',mkdtempSync('/private/tmp/laputa-rig2d-api-'));
mkdirSync(out,{recursive:true});
app.whenReady().then(async()=>{
 try {
  if(existsSync(join(out,'generation-request.json')))throw Error('A request was already recorded. Inspect its outcome before deliberately starting another experiment.');
  if(!safeStorage.isEncryptionAvailable())throw Error('Encrypted credential storage unavailable.');
  const stored=JSON.parse(readFileSync(credentialFile,'utf8'));
  if(!stored.openai)throw Error('No configured image credential.');
  const key=safeStorage.decryptString(Buffer.from(stored.openai,'base64'));
  const png=new PNG({width:600,height:760});png.data.fill(255);
  const rect=(x:number,y:number,w:number,h:number,c:number[])=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*600+xx)*4;png.data.set([...c,255],i);}};
  rect(250,170,100,100,[255,184,69]);rect(285,270,30,30,[83,97,113]);
  rect(240,300,120,190,[53,136,190]);
  rect(150,310,90,40,[235,112,73]);rect(90,310,60,40,[240,175,58]);rect(50,305,40,50,[85,100,114]);
  rect(360,310,90,40,[235,112,73]);rect(450,310,60,40,[240,175,58]);rect(510,305,40,50,[85,100,114]);
  rect(250,490,40,190,[73,132,113]);rect(310,490,40,190,[73,132,113]);
  rect(235,680,55,30,[85,100,114]);rect(310,680,55,30,[85,100,114]);
  const source=PNG.sync.write(png);writeFileSync(join(out,'pose-reference.png'),source);
  const prompt='Create one clean front-view 2D cutout animation test robot from the provided exact layout. White plain background. Preserve the reference canvas aspect ratio, exact placement, proportions and horizontal T-pose. Head is a yellow rounded rectangular robot head with two dark eyes. Blue rectangular torso. Orange upper arms, yellow forearms, gray mitten hands, green straight legs, gray feet. Flat solid colors with a dark thin outline. Keep body centered, arms perfectly horizontal, all parts visible and symmetric. This is a flat orthographic technical character sheet, no perspective, no shadows, no text, no floor, no extra parts. Clearly visible joints at shoulders, elbows and wrists. No accessories. Follow the reference silhouette closely.';
  const task:Task={id:'rig2d-front-once',requestId:'rig2d-front-once',kind:'image',state:'submitting',createdAt:Date.now(),updatedAt:Date.now(),prompt,assetIds:['pose-reference'],mode:'reference',discussion:false,settings:{...defaults,imageSize:'1024x1536',imageQuality:'medium'},outputAssetIds:[]};
  const asset:Asset={id:'pose-reference',name:'pose-reference.png',type:'image',mime:'image/png',size:source.length,url:'',createdAt:Date.now(),width:600,height:760};
  const record={status:'submitted',model:task.settings.imageModel,requestCount:1,startedAt:new Date().toISOString(),prompt,reference:'pose-reference.png'};
  writeFileSync(join(out,'generation-request.json'),JSON.stringify(record,null,2));
  setNetworkFetch(net.fetch as typeof fetch);
  console.log(JSON.stringify({stage:'provider-submit',model:task.settings.imageModel,requestCount:1}));
  try {
   const image=await generateImage(task,[asset],()=>source,key);
   writeFileSync(join(out,'generated-front.png'),image);
   writeFileSync(join(out,'generation-request.json'),JSON.stringify({...record,status:'succeeded',completedAt:new Date().toISOString(),bytes:image.length},null,2));
   console.log(JSON.stringify({stage:'provider-completed',bytes:image.length}));
  }catch(e){writeFileSync(join(out,'generation-request.json'),JSON.stringify({...record,status:'failed-or-uncertain',error:(e as Error).message},null,2));throw e;}
  app.exit(0);
 }catch(e){console.error((e as Error).message);app.exit(1);}
});
