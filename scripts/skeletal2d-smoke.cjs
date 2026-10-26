const {app,BrowserWindow}=require('electron');
const {resolve,join}=require('node:path');
const {writeFileSync,readFileSync,mkdtempSync}=require('node:fs');
const {PNG}=require('pngjs');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const out=resolve('output/skeletal2d-review');
app.setPath('userData',mkdtempSync('/private/tmp/laputa-rig2d-review-'));
const dataURL=v=>Buffer.from(v.split(',')[1],'base64');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1220,height:1120,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const js=s=>win.webContents.executeJavaScript(s);
 try {
  await win.loadFile(join(out,'index.html'));
  for(let i=0;i<100;i++){if(await js('window.rigReview?.ready'))break;await sleep(100);}
  assert.ok(await js('window.rigReview?.ready'));await js('window.rigReview.pause()');
  const rig=await js('window.rigReview.document()');
  for(const p of rig.parts.filter(p=>['right-upper','right-lower','right-hand'].includes(p.id)))assert.ok(p.crop[1]>=522&&p.crop[1]+p.crop[3]<=618,'Torso pixels must not be assigned to moving arm');
  const rebuilt=PNG.sync.read(dataURL(await js('window.rigReview.draw(0,{fills:false,bones:false})'))),original=PNG.sync.read(dataURL(await js('window.rigReview.sourceRender()')));
  let restDifferences=0;for(let i=0;i<rebuilt.data.length;i++)if(rebuilt.data[i]!==original.data[i])restDifferences++;
  assert.equal(restDifferences,0,'Trimmed parts must reconstruct the source without shifts');
  const before=[];let maxJoinError=0;
  for(let i=0;i<13;i++){const t=i/6;before.push(await js(`window.rigReview.draw(${t},{fills:true,bones:false})`));maxJoinError=Math.max(maxJoinError,await js(`window.rigReview.joinError(${t})`));}
  assert.ok(maxJoinError<1e-8);
  const encoded=await js('window.rigReview.exportPackage()');
  await js(`window.rigReview.importPackage(Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0)))`);
  for(let i=0;i<13;i++)assert.equal(await js(`window.rigReview.draw(${i/6},{fills:true,bones:false})`),before[i],'ZIP roundtrip changed rendered pixels');
  const beforeBad=await js('JSON.stringify(window.rigReview.document())');
  const corrupt=await js('window.rigReview.importPackage(window.rigReview.corruptPackage()).then(()=>false,e=>e.message)');
  assert.match(corrupt,/integrity/);assert.equal(await js('JSON.stringify(window.rigReview.document())'),beforeBad);
  for(const [name,fills] of [['bend-without-fill',false],['bend-with-fill',true]]){
   writeFileSync(join(out,name+'.png'),dataURL(await js(`window.rigReview.draw(1,{fills:${fills},bones:false})`)));
  }
  const raw=PNG.sync.read(readFileSync(join(out,'bend-without-fill.png'))),fixed=PNG.sync.read(readFileSync(join(out,'bend-with-fill.png')));
  // Examine the concealed elbow disk, independently of the sprite transform code.
  const gap=(p)=>{let count=0;for(let y=495;y<530;y++)for(let x=765;x<800;x++)if((x-782)**2+(y-528)**2<28**2&&p.data[(y*p.width+x)*4+3]<16)count++;return count;};
  const without=gap(raw),withFill=gap(fixed);
  assert.ok(without>0&&withFill<without,'Concealed elbow fill should reduce exposed transparent gaps');
  // Save a frame sequence from the actual rendered parts, then encode it.
  for(let i=0;i<60;i++)writeFileSync(join(out,`frame-${String(i).padStart(3,'0')}.png`),dataURL(await js(`window.rigReview.draw(${i/30},{fills:true,bones:false})`)));
  const ffmpeg=require('ffmpeg-static');
  execFileSync(ffmpeg,['-y','-framerate','30','-i',join(out,'frame-%03d.png'),'-vf','scale=512:768:flags=lanczos,split[s0][s1];[s0]palettegen=reserve_transparent=1:stats_mode=diff[p];[s1][p]paletteuse=alpha_threshold=128','-loop','0',join(out,'arm-bend.gif')],{stdio:'pipe'});
  const report={scope:'single front-view rigid cutout, one arm bend; motion API not called',imageProvider:JSON.parse(readFileSync(join(out,'generation-request.json'),'utf8')),segmentation:'manual source-space regions; sample-specific white removal',registration:'manually measured actual generated image; original reference coordinates were not reused',parts:15,bones:13,restReconstructionDifferentChannels:restDifferences,roundtripFramesCompared:13,roundtripPixelDifference:0,maxJoinErrorPixels:maxJoinError,corruptedAssetRejected:true,armOwnershipBoundsPassed:true,elbowProbe:{withoutFill:without,withFill},frames:60,fps:30,visualAcceptance:'pending visual review; numeric joins do not prove seam quality'};
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
  await js('window.rigReview.draw(1,{fills:true,bones:true})');await sleep(150);writeFileSync(join(out,'review.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({...report,imageProvider:{status:report.imageProvider.status,requestCount:report.imageProvider.requestCount}},null,2));app.exit(0);
 }catch(e){console.error(e);writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
});
setTimeout(()=>{console.error('2D review timed out');app.exit(2);},120000);
