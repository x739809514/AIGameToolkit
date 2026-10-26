import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createLayoutNode,emptyUILayout,validateUILayout,translateLayoutSelection,addUILayoutPage,switchUILayoutPage} from '../src/shared/ui-layout';
import {groupUILayoutLayers,layoutLayerRows,duplicateUILayoutLayers} from '../src/shared/ui-layout-groups';
import {defaultLayoutFlow,flowPositions,resolveUILayoutFlows,configureGroupFlow,reparentUILayoutNode,layoutDescendants} from '../src/shared/ui-layout-controls';
import {UILayoutArtwork} from '../src/ui/UILayoutArtwork';
import {UILayoutRuntime} from '../src/ui/UILayoutRuntime';
test('new components round trip safe functional properties and reject invalid configuration and container cycles',()=>{
 const nodes=(['button','checkbox','dropdown','scrollview'] as const).map(type=>createLayoutNode(type,type,200,200)),doc={...emptyUILayout(),nodes};assert.deepEqual(validateUILayout(doc),doc);
 for(const patch of [{action:'javascript'},{options:[]},{options:['']},{selectedIndex:99},{disabled:'yes'},{message:'x'.repeat(1001)}])assert.throws(()=>validateUILayout({...doc,nodes:[{...nodes[0],control:{...nodes[0].control!,...patch} as any}]}));
 assert.throws(()=>validateUILayout({...doc,nodes:[{...nodes[0],parentId:'button'},...nodes.slice(1)]}));assert.throws(()=>validateUILayout({...doc,nodes:nodes.map(n=>n.type==='scrollview'?{...n,parentId:n.id}:n)}));
 const other=createLayoutNode('scrollview','other',0,0);assert.throws(()=>validateUILayout({...doc,nodes:[...nodes.slice(0,3),{...nodes[3],parentId:'other'},{...other,parentId:'scrollview'}]}));
});
test('vertical, horizontal and grid layouts place real components with padding, gap, alignment and stretch',()=>{
 const frame={x:100,y:200,width:400,height:300},nodes=[{x:0,y:0,width:80,height:30},{x:0,y:0,width:100,height:40},{x:0,y:0,width:120,height:50}],flow={...defaultLayoutFlow(),gap:10,padding:20};
 let placed=flowPositions(nodes,frame,{...flow,mode:'vertical',align:'center'});assert.deepEqual(placed.map(n=>n.y),[220,260,310]);assert.equal(placed[0].x,260);
 placed=flowPositions(nodes,frame,{...flow,mode:'horizontal',align:'stretch'});assert.deepEqual(placed.map(n=>n.x),[120,210,320]);assert.equal(placed[0].height,260);
 placed=flowPositions(nodes,frame,{...flow,mode:'grid',columns:2,align:'stretch'});assert.deepEqual(placed.map(n=>[n.x,n.y]),[[120,220],[305,220],[120,270]]);assert.equal(placed[0].width,175);
});
test('group layouts reflow on changes and moving a group retains its layout frame without repeated drift',()=>{
 const nodes=['a','b','c'].map((id,i)=>createLayoutNode('button',id,100+i*200,100)),base=groupUILayoutLayers({...emptyUILayout(),nodes},['a','b','c'],'g'),flow={...defaultLayoutFlow(),mode:'vertical' as const};
 const doc=resolveUILayoutFlows(configureGroupFlow(base,'g',flow),base);assert.ok(doc.nodes[1].y>doc.nodes[0].y);assert.equal(doc.nodes[1].x,doc.nodes[0].x);assert.deepEqual(resolveUILayoutFlows(doc),doc);
 const moved=resolveUILayoutFlows(translateLayoutSelection(doc,['g'],40,30),doc);assert.equal(moved.nodes[0].x,doc.nodes[0].x+40);assert.equal(moved.nodes[2].y,doc.nodes[2].y+30);assert.equal(moved.groups![0].frame!.x,doc.groups![0].frame!.x+40);assert.deepEqual(resolveUILayoutFlows(moved),moved);
 const updated=resolveUILayoutFlows({...doc,nodes:doc.nodes.map(n=>n.id==='a'?{...n,height:90}:n)},doc);assert.equal(updated.nodes[1].y,updated.nodes[0].y+90+flow.gap);
});
test('scroll views arrange, clip and contain real child components, move descendants and duplicate without stale parents',()=>{
 const view=createLayoutNode('scrollview','view',300,300),button=createLayoutNode('button','button',50,50),checkbox=createLayoutNode('checkbox','checkbox',80,80),base={...emptyUILayout(),nodes:[view,button,checkbox]};let doc=reparentUILayoutNode(base,'button','view');doc=reparentUILayoutNode(doc,'checkbox','view');doc=resolveUILayoutFlows(doc);assert.deepEqual(validateUILayout(doc),doc);const a=doc.nodes.find(n=>n.id==='button')!,b=doc.nodes.find(n=>n.id==='checkbox')!;assert.equal(a.x,view.x+16);assert.equal(b.y,a.y+a.height+12);
 const moved=resolveUILayoutFlows({...doc,nodes:doc.nodes.map(n=>n.id==='view'?{...n,x:n.x+100,y:n.y+40}:n)},doc);assert.equal(moved.nodes.find(n=>n.id==='button')!.x,a.x+100);assert.equal(moved.nodes.find(n=>n.id==='checkbox')!.y,b.y+40);assert.deepEqual([...layoutDescendants(doc,['view'])].sort(),['button','checkbox','view']);
 assert.deepEqual(layoutLayerRows(doc).map(r=>r.depth),[0,1,1]);let i=0;const copied=duplicateUILayoutLayers(doc,['view'],()=>`copy-${++i}`);assert.equal(copied.document.nodes.length,6);assert.ok(copied.document.nodes.slice(3).filter(n=>n.type!=='scrollview').every(n=>n.parentId!==view.id));validateUILayout(copied.document);
 const svg=renderToStaticMarkup(createElement(UILayoutArtwork,{document:doc}));assert.match(svg,/clip-path="url\(#layout-scroll-0\)"/);assert.match(svg,/data-layout-node="button"/);assert.match(svg,/translate\(16 16\)/);
});
test('control settings and layout frames persist on inactive pages; runtime uses native semantic controls',()=>{
 const nodes=(['button','checkbox','dropdown','scrollview'] as const).map(type=>createLayoutNode(type,type,200,200)),doc={...emptyUILayout(),nodes};nodes[0].control!.action='navigate';nodes[0].control!.targetPageId='second';nodes[1].control!.checked=true;nodes[2].control!.options=['A','B'];nodes[2].control!.selectedIndex=1;
 const next=addUILayoutPage(doc,'second'),restored=switchUILayoutPage(validateUILayout(next),'page-1');assert.deepEqual(restored.nodes,nodes);
 const markup=renderToStaticMarkup(createElement(UILayoutRuntime,{document:doc,navigate:()=>{}}));assert.match(markup,/<button/);assert.match(markup,/type="checkbox"/);assert.match(markup,/checked=""/);assert.match(markup,/<select/);assert.match(markup,/<option value="1" selected="">B/);assert.match(markup,/role="region"/);
});
