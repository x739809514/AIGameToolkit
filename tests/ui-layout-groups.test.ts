import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createLayoutNode,emptyUILayout,validateUILayout,addUILayoutPage,switchUILayoutPage,moveUILayoutLayers,translateLayoutSelection} from '../src/shared/ui-layout';
import {alignUILayoutLayers,groupUILayoutLayers,ungroupUILayoutLayers,layoutSelectionNodes,layoutLayerRows,layoutNodeLocked,pruneUILayoutGroups,duplicateUILayoutLayers} from '../src/shared/ui-layout-groups';
import {UILayoutArtwork} from '../src/ui/UILayoutArtwork';
import {Workbenches} from '../electron/workbenches';
const fixture=()=>({...emptyUILayout(),nodes:['a','b','c','d'].map((id,i)=>createLayoutNode('rectangle',id,150+i*200,200))});
test('grouping makes a contiguous layer block, keeps geometry, selects unique members and supports ungroup',()=>{
 const before=fixture(),doc=groupUILayoutLayers(before,['a','c'],'g','界面组');assert.deepEqual(doc.nodes.map(n=>n.id),['b','a','c','d']);assert.deepEqual(doc.groups?.[0].nodeIds,['a','c']);for(const n of doc.nodes)assert.deepEqual(n,before.nodes.find(old=>old.id===n.id));
 assert.deepEqual(layoutSelectionNodes(doc,['g','a']).map(n=>n.id),['a','c']);assert.deepEqual(layoutLayerRows(doc).map(r=>r.id),['d','g','c','a','b']);assert.deepEqual(layoutLayerRows(doc,{g:true}).map(r=>r.id),['d','g','b']);assert.deepEqual(validateUILayout(doc),doc);
 assert.deepEqual(ungroupUILayoutLayers(doc,['g']).groups,[]);assert.deepEqual(ungroupUILayoutLayers(doc,['g']).nodes,doc.nodes);
});
test('group metadata validates names, references and single ownership without changing legacy layouts',()=>{
 const doc=groupUILayoutLayers(fixture(),['a','b'],'g');assert.equal(validateUILayout(fixture()).groups,undefined);
 for(const groups of [[{...doc.groups![0],name:' '}],[{...doc.groups![0],nodeIds:['foreign']}],[{...doc.groups![0],nodeIds:['a','a']}],[{...doc.groups![0],id:'a'}],[doc.groups![0],{...doc.groups![0],id:'other'}],[{...doc.groups![0],hidden:'yes'}]])assert.throws(()=>validateUILayout({...doc,groups}));
});
test('group dragging and snapping retain member offsets, group locks protect members, hidden groups do not render',()=>{
 const doc=groupUILayoutLayers(fixture(),['a','b'],'g'),moved=translateLayoutSelection(doc,['g'],17,29,true,'a');const a=doc.nodes.find(n=>n.id==='a')!,b=doc.nodes.find(n=>n.id==='b')!,ma=moved.nodes.find(n=>n.id==='a')!,mb=moved.nodes.find(n=>n.id==='b')!;assert.equal(mb.x-ma.x,b.x-a.x);assert.equal(mb.y-ma.y,b.y-a.y);assert.equal(ma.x%8,0);
 const locked={...doc,groups:doc.groups!.map(g=>({...g,locked:true,hidden:true}))};assert.equal(layoutNodeLocked(locked,a),true);assert.deepEqual(translateLayoutSelection(locked,['g'],50,50).nodes,doc.nodes);
 const markup=renderToStaticMarkup(createElement(UILayoutArtwork,{document:locked}));assert.ok(!markup.includes('data-layout-node="a"'));assert.ok(!markup.includes('data-layout-node="b"'));assert.ok(markup.includes('data-layout-node="c"'));
});
test('duplicating a selected group assigns independent IDs and retains the group name and membership',()=>{
 const doc=groupUILayoutLayers(fixture(),['a','b'],'g','Card');let i=0;const copy=duplicateUILayoutLayers(doc,['g'],()=>`copy-${++i}`);assert.equal(copy.document.groups?.length,2);assert.equal(copy.selection.length,1);const group=copy.document.groups?.find(g=>g.id===copy.selection[0])!;assert.equal(group.name,'Card 副本');assert.equal(group.nodeIds.length,2);assert.ok(group.nodeIds.every(id=>!doc.nodes.some(n=>n.id===id)));assert.deepEqual(validateUILayout(copy.document),copy.document);
});
test('deleting members prunes empty groups; grouped layer reordering moves groups as units and reparents individual members',()=>{
 let doc=groupUILayoutLayers(fixture(),['a','b'],'g');doc=groupUILayoutLayers(doc,['c','d'],'h');const moved=moveUILayoutLayers(doc,['g'],'h','above');assert.deepEqual(moved.nodes.map(n=>n.id),['c','d','a','b']);assert.deepEqual(moved.groups,doc.groups);
 const member=moveUILayoutLayers(doc,['b'],'c','below');assert.deepEqual(member.groups?.find(g=>g.id==='g')?.nodeIds,['a']);assert.ok(member.groups?.find(g=>g.id==='h')?.nodeIds.includes('b'));assert.deepEqual(validateUILayout(member),member);
 const empty=pruneUILayoutGroups({...doc,nodes:doc.nodes.filter(n=>!['a','b'].includes(n.id))});assert.deepEqual(empty.groups?.map(g=>g.id),['h']);
});
test('groups and renamed layers survive page changes, validation and workbench storage',()=>{
 const initial=groupUILayoutLayers(fixture(),['a','b'],'g','角色面板');initial.nodes[0].name='已重命名图层';const next=addUILayoutPage(initial,'second');assert.equal(next.groups,undefined);const back=switchUILayoutPage(next,'page-1');assert.deepEqual(back.groups,initial.groups);assert.equal(back.nodes[0].name,'已重命名图层');assert.deepEqual(validateUILayout(back),back);
 const dir=mkdtempSync(join(tmpdir(),'ui-groups-')),manager=new Workbenches(dir,{secure:false,get:()=>undefined,set:()=>{}},()=>{});try{const board=manager.create('ui-layout');manager.get(board.id).saveUILayout(back);assert.deepEqual(manager.get(board.id).store.load().uiLayout,back);}finally{manager.close();rmSync(dir,{recursive:true,force:true});}
});

test('alignment treats each selected group as one unit and ungroup preserves hidden appearance',()=>{
 const doc=groupUILayoutLayers(fixture(),['a','b'],'g'),aligned=alignUILayoutLayers(doc,['g','d'],'x',1),a=aligned.nodes.find(n=>n.id==='a')!,b=aligned.nodes.find(n=>n.id==='b')!,d=aligned.nodes.find(n=>n.id==='d')!;
 assert.equal(b.x-a.x,doc.nodes.find(n=>n.id==='b')!.x-doc.nodes.find(n=>n.id==='a')!.x);assert.equal(b.x+b.width,d.x+d.width);
 const hidden={...doc,groups:doc.groups!.map(g=>({...g,hidden:true}))},ungrouped=ungroupUILayoutLayers(hidden,['g']);assert.equal(ungrouped.nodes.find(n=>n.id==='a')!.hidden,true);assert.equal(ungrouped.nodes.find(n=>n.id==='c')!.hidden,false);
});
