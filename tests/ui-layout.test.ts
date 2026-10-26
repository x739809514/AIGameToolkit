import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {layoutMarqueeSelection,translateLayoutSelection,layoutArrowBetween,layoutWorldPoint,createLayoutNode,emptyUILayout,validateUILayout,layoutLocalPoint,resizeLayoutNode,layoutTextLines,layoutTextPosition,moveUILayoutLayers,addUILayoutPage,switchUILayoutPage,layoutPages,syncUILayoutPages} from '../src/shared/ui-layout';
import {UILayoutArtwork} from '../src/ui/UILayoutArtwork';
import {writeUILayoutPair,readUILayout} from '../electron/ui-layout';
import {Workbenches} from '../electron/workbenches';
function fixture(){const d=emptyUILayout();d.width=320;d.height=240;d.name='角色面板';d.nodes=[createLayoutNode('rectangle','panel',100,100),createLayoutNode('text','title',160,80),createLayoutNode('avatar','avatar',60,60)];d.nodes[1].text='你好 <玩家> & 欢迎';return d;}
function png(width=320,height=240){const image=new PNG({width,height});image.data.fill(255);return Uint8Array.from(PNG.sync.write(image)).buffer;}
test('UI layout schema round-trips supported constructs while rejecting unsafe images, duplicate IDs and oversized canvases',()=>{
 const d=fixture();for(const type of ['ellipse','line','polygon','image'] as const)d.nodes.push(createLayoutNode(type,type,100,100));const canonical=validateUILayout({...d,html:'<script>',nodes:d.nodes.map(n=>({...n,onclick:'malicious'}))});assert.deepEqual(canonical,d);assert.ok(!JSON.stringify(canonical).includes('malicious'));
 for(const patch of [{width:0},{width:4097},{width:4096,height:4096},{version:2}])assert.throws(()=>validateUILayout({...d,...patch}));
 assert.throws(()=>validateUILayout({...d,nodes:[d.nodes[0],d.nodes[0]]}));assert.throws(()=>validateUILayout({...d,nodes:[{...d.nodes[0],x:NaN}]}));
 for(const src of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zz4=','javascript:alert(1)'])assert.throws(()=>validateUILayout({...d,nodes:[{...d.nodes[2],src}]}));
});
test('resizing rotated nodes preserves the opposite world-space corner, with optional aspect locking',()=>{
 const n={...createLayoutNode('rectangle','box',200,200),rotation:37};
 const corner=(node:typeof n,sx:number,sy:number)=>{const a=node.rotation*Math.PI/180,x=sx*node.width/2,y=sy*node.height/2;return {x:node.x+node.width/2+Math.cos(a)*x-Math.sin(a)*y,y:node.y+node.height/2+Math.sin(a)*x+Math.cos(a)*y};};
 for(const [sx,sy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const before=corner(n,-sx,-sy),resized=resizeLayoutNode(n,55,-23,sx,sy),after=corner(resized,-sx,-sy);assert.ok(Math.abs(before.x-after.x)<1e-9);assert.ok(Math.abs(before.y-after.y)<1e-9);const local=layoutLocalPoint(resized,after);assert.ok(Math.abs(local.x-(sx===1?0:resized.width))<1e-8);}
 const fixed=resizeLayoutNode(n,50,100,1,1,true);assert.ok(Math.abs(fixed.width/fixed.height-n.width/n.height)<1e-9);
});
test('clean SVG export preserves text, opacity, shapes and layer visibility without selection handles',()=>{
 const d=fixture();d.nodes[0].hidden=true;d.nodes[2].opacity=.5;const markup=renderToStaticMarkup(createElement(UILayoutArtwork,{document:d}));assert.match(markup,/你好/);assert.match(markup,/&lt;玩家&gt; &amp;/);assert.match(markup,/opacity="0.5"/);assert.ok(!markup.includes('data-layout-node="panel"'));assert.ok(!markup.includes('data-transform'));assert.match(markup,/width="320" height="240"/);const text={...d.nodes[1],width:30,text:'你好世界\nabc'};assert.ok(layoutTextLines(text).length>=4);
});
test('UI layouts persist in isolated workbenches, reload from SQLite and cannot be saved to another module',()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-layout-store-')),vault={secure:false,get:()=>undefined,set:()=>{}};let manager=new Workbenches(dir,vault,()=>{});
 try{const a=manager.create('ui-layout'),b=manager.create('ui-layout'),image=manager.create('image-video');manager.get(a.id).saveUILayout(fixture());assert.equal(manager.get(b.id).workspace.uiLayout,undefined);assert.throws(()=>manager.get(image.id).saveUILayout(fixture()),/UI 布局编辑器/);manager.close();manager=new Workbenches(dir,vault,()=>{});assert.deepEqual(manager.get(a.id).workspace.uiLayout,fixture());}finally{manager.close();rmSync(dir,{recursive:true,force:true});}
});
test('paired JSON and PNG export respects chosen destination and dimensions, preserves document content and replaces both files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-layout-export-'));
 try{const d=fixture(),result=writeUILayoutPair(join(dir,'界面'),d,png());assert.equal(result.jsonPath,join(dir,'界面.json'));assert.deepEqual(readUILayout(result.jsonPath),d);assert.equal(PNG.sync.read(readFileSync(result.pngPath)).width,320);d.nodes[1].text='已修改';writeUILayoutPair(result.jsonPath,d,png());assert.equal(readUILayout(result.jsonPath).nodes[1].text,'已修改');assert.deepEqual(readdirSync(dir).sort(),['界面.json','界面.png']);assert.throws(()=>writeUILayoutPair(result.jsonPath,d,png(64,64)),/尺寸/);assert.equal(readUILayout(result.jsonPath).nodes[1].text,'已修改');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed export cannot replace a folder or follow a symlink and leaves the existing JSON intact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-layout-failure-'));
 try{const json=join(dir,'test.json'),image=join(dir,'test.png');writeFileSync(json,'original');mkdirSync(image);assert.throws(()=>writeUILayoutPair(json,fixture(),png()),/普通文件/);assert.equal(readFileSync(json,'utf8'),'original');rmSync(image,{recursive:true});writeFileSync(join(dir,'keep.png'),'original image');symlinkSync(join(dir,'keep.png'),image);assert.throws(()=>writeUILayoutPair(json,fixture(),png()),/普通文件/);assert.equal(readFileSync(join(dir,'keep.png'),'utf8'),'original image');assert.equal(readFileSync(json,'utf8'),'original');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy JSON gains compatible color opacity and vertical text defaults, while invalid additions are rejected',()=>{
 const d=fixture(),legacy=JSON.parse(JSON.stringify(d));for(const n of legacy.nodes){delete n.fillOpacity;delete n.strokeOpacity;delete n.verticalAlign;}
 assert.deepEqual(validateUILayout(legacy),d);
 for(const patch of [{fillOpacity:-.1},{fillOpacity:1.1},{strokeOpacity:NaN},{verticalAlign:'outside'}])assert.throws(()=>validateUILayout({...d,nodes:[{...d.nodes[0],...patch}]}));
 const modified={...d,nodes:d.nodes.map(n=>({...n,fillOpacity:.35,strokeOpacity:.6,verticalAlign:'middle' as const}))};assert.deepEqual(validateUILayout(modified),modified);
});
test('text aligns within its frame for all nine combinations without changing the frame position',()=>{
 const text={...createLayoutNode('text','text',200,200),fontSize:20,width:300,height:160,text:'Hello\n世界'};
 for(const align of ['left','center','right'] as const)for(const verticalAlign of ['top','middle','bottom'] as const){
  const node={...text,align,verticalAlign},d={...emptyUILayout(),nodes:[node]},position=layoutTextPosition(node),markup=renderToStaticMarkup(createElement(UILayoutArtwork,{document:d}));
  assert.equal(position.lines.length,2);assert.equal(position.offset,verticalAlign==='top'?0:verticalAlign==='middle'?55:110);assert.equal(position.firstBaseline,position.offset+20);
  assert.match(markup,new RegExp('text-anchor="'+({left:'start',center:'middle',right:'end'}[align])+'"'));assert.match(markup,new RegExp('x="'+({left:0,center:150,right:300}[align])+'" y="'+position.firstBaseline+'"'));
  assert.equal(node.x,text.x);assert.equal(node.y,text.y);
 }
});
test('fill and stroke opacity remain independent of node opacity, including avatar outlines',()=>{
 const rectangle={...createLayoutNode('rectangle','r',100,100),fillOpacity:.25,stroke:'#ff0000',strokeOpacity:.6,strokeWidth:4,opacity:.8},avatar={...createLayoutNode('avatar','a',300,100),stroke:'#ff0000',strokeOpacity:.4,strokeWidth:4};
 const markup=renderToStaticMarkup(createElement(UILayoutArtwork,{document:{...emptyUILayout(),nodes:[rectangle,avatar]}}));assert.match(markup,/fill-opacity="0.25"/);assert.match(markup,/stroke-opacity="0.6"/);assert.match(markup,/opacity="0.8"/);
 const avatarMarkup=markup.slice(markup.indexOf('data-layout-node="a"'));assert.equal((avatarMarkup.match(/stroke="#ff0000"/g)||[]).length,1);
});

test('layer drag order matches front-to-back panel placement and preserves relative order of selected layers',()=>{
 const nodes=['a','b','c','d'].map(id=>createLayoutNode('rectangle',id,100,100)),doc={...emptyUILayout(),nodes};
 assert.deepEqual(moveUILayoutLayers(doc,['a'],'c','above').nodes.map(n=>n.id),['b','c','a','d']);
 assert.deepEqual(moveUILayoutLayers(doc,['d'],'b','below').nodes.map(n=>n.id),['a','d','b','c']);
 const group=moveUILayoutLayers(doc,['b','a'],'d','above');assert.deepEqual(group.nodes.map(n=>n.id),['c','d','a','b']);assert.deepEqual(group.nodes.slice().reverse().map(n=>n.id),['b','a','d','c']);
 assert.deepEqual(doc.nodes.map(n=>n.id),['a','b','c','d']);assert.deepEqual(group.nodes.find(n=>n.id==='a'),nodes[0]);
});
test('layer drag self-drops, stale targets and unchanged insertion points are no-ops; visibility and locking survive moves',()=>{
 const doc=fixture();doc.nodes[0].hidden=true;doc.nodes[1].locked=true;
 assert.equal(moveUILayoutLayers(doc,['panel'],'panel','above'),doc);assert.equal(moveUILayoutLayers(doc,['missing'],'title','below'),doc);assert.equal(moveUILayoutLayers(doc,['title'],'missing','above'),doc);assert.equal(moveUILayoutLayers(doc,['panel'],'title','below'),doc);
 const reordered=moveUILayoutLayers(doc,['panel'],'avatar','above');assert.deepEqual(reordered.nodes.map(n=>n.id),['title','avatar','panel']);assert.equal(reordered.nodes.at(-1)?.hidden,true);assert.equal(reordered.nodes[0].locked,true);assert.deepEqual(validateUILayout(reordered),reordered);
});

test('arrows and stroke settings round-trip; legacy layouts preserve original stroke appearance',()=>{
 const nodes=(['rectangle','ellipse','polygon','line','arrow'] as const).map(type=>createLayoutNode(type,type,120,100)),d={...emptyUILayout(),nodes};
 assert.equal(nodes[4].arrowEnd,'triangle');assert.equal(nodes[4].strokeWidth,3);assert.equal(nodes[4].points.length,2);
 const old=JSON.parse(JSON.stringify(d));for(const n of old.nodes)for(const key of ['strokeStyle','strokeLinecap','strokeLinejoin','arrowStart','arrowEnd','arrowSize'])delete n[key];assert.deepEqual(validateUILayout(old),d);
 const styled={...d,nodes:nodes.map(n=>({...n,strokeStyle:'dash-dot' as const,strokeLinecap:'square' as const,strokeLinejoin:'bevel' as const,arrowStart:'circle' as const,arrowEnd:'open' as const,arrowSize:32}))};assert.deepEqual(validateUILayout(styled),styled);
 for(const patch of [{strokeStyle:'url(bad)'},{strokeLinecap:'triangle'},{strokeLinejoin:'bad'},{arrowStart:'bad'},{arrowEnd:'bad'},{arrowSize:NaN},{arrowSize:0},{arrowSize:101}])assert.throws(()=>validateUILayout({...d,nodes:[{...nodes[4],...patch}]}),/线条样式或箭头/);
});
test('all shape outlines export dash patterns, caps and joins, with independent arrow markers',()=>{
 const nodes=(['rectangle','ellipse','polygon','line','arrow'] as const).map(type=>({...createLayoutNode(type,type,200,200),stroke:'#336699',strokeWidth:4,strokeOpacity:.6,strokeStyle:'dashed' as const,strokeLinecap:'square' as const,strokeLinejoin:'bevel' as const,arrowStart:'diamond' as const,arrowEnd:'open' as const,arrowSize:28}));
 const markup=renderToStaticMarkup(createElement(UILayoutArtwork,{document:{...emptyUILayout(),nodes}}));
 assert.equal((markup.match(/stroke-dasharray="16 12"/g)||[]).length,5);assert.equal((markup.match(/stroke-linecap="square"/g)||[]).length,5);assert.equal((markup.match(/stroke-linejoin="bevel"/g)||[]).length,5);
 assert.equal((markup.match(/<marker /g)||[]).length,4);assert.equal((markup.match(/orient="auto-start-reverse"/g)||[]).length,4);assert.match(markup,/markerWidth="28"|marker-width="28"/);assert.match(markup,/marker-end="url\(#layout-clip-4-end\)"/);assert.match(markup,/marker-start="url\(#layout-clip-3-start\)"/);
 const invisible=renderToStaticMarkup(createElement(UILayoutArtwork,{document:{...emptyUILayout(),nodes:[{...nodes[4],strokeWidth:0}]}}));assert.ok(!invisible.includes('<marker'));
});

test('pages preserve separate canvas content, unsaved edits and original single-page compatibility',()=>{
 const first=fixture();assert.equal(layoutPages(first).length,1);assert.equal(validateUILayout(first).pages,undefined);
 const added=addUILayoutPage(first,'settings');assert.equal(added.pages?.length,2);assert.equal(added.name,'页面 2');assert.equal(added.nodes.length,0);assert.equal(added.width,320);
 const edited=syncUILayoutPages({...added,name:'设置',width:390,height:844,background:'#112233',nodes:[createLayoutNode('text','settings-title',40,60)]});
 const back=switchUILayoutPage(edited,'page-1');assert.deepEqual(back.nodes,first.nodes);assert.equal(back.width,320);assert.equal(back.name,first.name);
 const activeEdited={...back,nodes:back.nodes.map(n=>({...n,x:n.x+13}))};const settings=switchUILayoutPage(activeEdited,'settings');assert.equal(settings.name,'设置');assert.equal(settings.width,390);assert.equal(settings.height,844);assert.equal(settings.nodes[0].id,'settings-title');
 const restored=switchUILayoutPage(settings,'page-1');assert.equal(restored.nodes[0].x,first.nodes[0].x+13);assert.deepEqual(validateUILayout(JSON.parse(JSON.stringify(restored))),restored);assert.equal(switchUILayoutPage(restored,'missing'),restored);
});
test('pages validate every canvas and reject invalid IDs, active page and page counts',()=>{
 const doc=addUILayoutPage(fixture(),'second');
 assert.throws(()=>validateUILayout({...doc,activePageId:'missing'}));assert.throws(()=>validateUILayout({...doc,pages:[]}));
 assert.throws(()=>validateUILayout({...doc,pages:[doc.pages![0],doc.pages![0]]}));
 assert.throws(()=>validateUILayout({...doc,pages:doc.pages!.map((p,i)=>i?{...p,nodes:[{...createLayoutNode('image','bad',0,0),src:'https://example.com/a.png'}]}:p)}));
 let many=fixture();for(let i=2;i<=30;i++)many=addUILayoutPage(many,`page-${i}`);assert.equal(validateUILayout(many).pages?.length,30);assert.throws(()=>addUILayoutPage(many,'overflow'));assert.throws(()=>validateUILayout({...many,pages:[...many.pages!,{...many.pages![0],id:'overflow'}]}));
});
test('multi-page JSON export and workbench persistence preserve inactive pages and current PNG size',()=>{
 const dir=mkdtempSync(join(tmpdir(),'laputa-pages-'));try{
  const first=fixture(),second=addUILayoutPage(first,'second');const document=validateUILayout({...second,width:390,height:844,nodes:[createLayoutNode('ellipse','second-circle',100,120)]});
  const out=writeUILayoutPair(join(dir,'pages.json'),document,png(390,844));const loaded=readUILayout(out.jsonPath);assert.deepEqual(loaded,document);assert.deepEqual(switchUILayoutPage(loaded,'page-1').nodes,first.nodes);
  const store=new Workbenches(join(dir,'workbenches'),{secure:false,get:()=>undefined,set:()=>{}},()=>{});try{const board=store.create('ui-layout');store.get(board.id).saveUILayout(document);assert.deepEqual(store.get(board.id).workspace.uiLayout,document);}finally{store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('freehand arrow geometry preserves exact endpoints for all quadrants, horizontal and vertical drags',()=>{
 const n={...createLayoutNode('arrow','draw',0,0),strokeStyle:'dashed' as const,arrowSize:30};
 const start={x:200,y:200};for(const end of [{x:400,y:350},{x:70,y:400},{x:50,y:20},{x:400,y:50},{x:200,y:400},{x:200,y:20},{x:400,y:200},{x:20,y:200},start]){
  const arrow=layoutArrowBetween(n,start,end);assert.ok(arrow.width>=1&&arrow.height>=1);assert.equal(arrow.strokeStyle,'dashed');assert.equal(arrow.arrowSize,30);validateUILayout({...emptyUILayout(),nodes:[arrow]});
  for(const [i,target]of [start,end].entries()){const actual=layoutWorldPoint(arrow,arrow.points[i]);assert.ok(Math.abs(actual.x-target.x)<1e-8);assert.ok(Math.abs(actual.y-target.y)<1e-8);}
 }
});
test('Shift drawing locks to 45 degree increments without moving the anchor; rotated endpoint editing preserves the fixed end',()=>{
 const n={...createLayoutNode('arrow','draw',250,250),rotation:37},start={x:120,y:160},end={x:370,y:240},arrow=layoutArrowBetween(n,start,end,true),a=layoutWorldPoint(arrow,arrow.points[0]),b=layoutWorldPoint(arrow,arrow.points[1]);
 assert.ok(Math.hypot(a.x-start.x,a.y-start.y)<1e-8);const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;assert.ok(Math.abs(angle/45-Math.round(angle/45))<1e-8);
 assert.ok(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-Math.hypot(end.x-start.x,end.y-start.y))<1e-8);
 const anchor=layoutWorldPoint(n,n.points[0]),changed=layoutArrowBetween(n,anchor,{x:600,y:40});const fixed=layoutWorldPoint(changed,changed.points[0]);assert.ok(Math.hypot(anchor.x-fixed.x,anchor.y-fixed.y)<1e-8);assert.equal(changed.rotation,0);
});

test('background opacity survives pages and JSON export, with opaque defaults for legacy pages',()=>{
 const original=fixture();assert.equal(validateUILayout(original).backgroundOpacity,undefined);
 for(const backgroundOpacity of [-.1,1.1,NaN,'0.5'])assert.throws(()=>validateUILayout({...original,backgroundOpacity}));
 const second=addUILayoutPage(original,'alpha'),transparent=validateUILayout({...second,backgroundOpacity:.4});
 assert.equal(transparent.pages?.find(p=>p.id==='alpha')?.backgroundOpacity,.4);
 const first=switchUILayoutPage(transparent,'page-1');assert.equal(first.backgroundOpacity,undefined);assert.equal(switchUILayoutPage(first,'alpha').backgroundOpacity,.4);
 assert.deepEqual(validateUILayout(JSON.parse(JSON.stringify(first))),first);
 const markup=renderToStaticMarkup(createElement(UILayoutArtwork,{document:transparent}));assert.match(markup,/<rect[^>]*fill="#ffffff"[^>]*fill-opacity="0.4"/);
 const dir=mkdtempSync(join(tmpdir(),'laputa-alpha-'));try{const out=writeUILayoutPair(join(dir,'alpha.json'),transparent,png());assert.equal(readUILayout(out.jsonPath).backgroundOpacity,.4);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('marquee selects intersecting frames in either direction and excludes hidden or locked components',()=>{
 const a={...createLayoutNode('rectangle','a',100,100),x:50,y:60,width:100,height:80},b={...a,id:'b',x:220},hidden={...a,id:'hidden',hidden:true},locked={...a,id:'locked',locked:true};
 const nodes=[a,b,hidden,locked],start={x:30,y:40},end={x:330,y:150};
 assert.deepEqual(layoutMarqueeSelection(nodes,start,end),['a','b']);assert.deepEqual(layoutMarqueeSelection(nodes,end,start),['a','b']);
 assert.deepEqual(layoutMarqueeSelection(nodes,{x:145,y:130},{x:155,y:145}),['a']);assert.deepEqual(layoutMarqueeSelection(nodes,{x:400,y:400},{x:450,y:450}),[]);
});
test('marquee uses rotated frames rather than their unrotated or axis-aligned bounding rectangles',()=>{
 const diamond={...createLayoutNode('rectangle','diamond',100,100),x:50,y:50,width:100,height:100,rotation:45};
 assert.deepEqual(layoutMarqueeSelection([diamond],{x:28,y:95},{x:32,y:105}),['diamond']);
 assert.deepEqual(layoutMarqueeSelection([diamond],{x:30,y:30},{x:40,y:40}),[]);
 assert.deepEqual(layoutMarqueeSelection([diamond],{x:60,y:60},{x:70,y:70}),['diamond']);
});
test('group dragging preserves offsets with grid snapping and leaves unselected and locked nodes untouched',()=>{
 const d=fixture();d.nodes[0].x=13;d.nodes[0].y=21;d.nodes[1].x=52.5;d.nodes[1].y=83.25;const locked={...d.nodes[2],id:'locked',locked:true};d.nodes.push(locked);
 for(const snap of [false,true]){const moved=translateLayoutSelection(d,['panel','title','locked'],19,11,snap,'panel'),a=moved.nodes[0],b=moved.nodes[1];assert.equal(b.x-a.x,d.nodes[1].x-d.nodes[0].x);assert.equal(b.y-a.y,d.nodes[1].y-d.nodes[0].y);assert.equal(moved.nodes[2],d.nodes[2]);assert.equal(moved.nodes[3],locked);if(snap){assert.equal(a.x%8,0);assert.equal(a.y%8,0);}else{assert.equal(a.x,32);assert.equal(a.y,32);}assert.equal(d.nodes[0].x,13);}
});

test('marquee treats a visible group as one selection and skips hidden or locked groups',()=>{
 const a={...createLayoutNode('rectangle','a',100,100),x:50,y:60,width:100,height:80},b={...a,id:'b',x:220},group={id:'group',name:'Group',nodeIds:['a','b'],hidden:false,locked:false};
 assert.deepEqual(layoutMarqueeSelection([a,b],{x:30,y:40},{x:160,y:150},[group]),['group']);
 assert.deepEqual(layoutMarqueeSelection([a,b],{x:30,y:40},{x:330,y:150},[group]),['group']);
 for(const patch of [{hidden:true},{locked:true}])assert.deepEqual(layoutMarqueeSelection([a,b],{x:30,y:40},{x:330,y:150},[{...group,...patch}]),[]);
 const doc={...emptyUILayout(),nodes:[a,b],groups:[group]},moved=translateLayoutSelection(doc,['group'],17,23,true,'a');assert.equal(moved.nodes[1].x-moved.nodes[0].x,b.x-a.x);
});
