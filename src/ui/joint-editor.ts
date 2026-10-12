import {useEffect,useRef,useState} from 'react';
import type {PoseJoint,PoseJointID} from '../shared/pose';
export function useJointEditor(key:string,input:PoseJoint[],save:(joints:PoseJoint[])=>Promise<void>){
 const [joints,setJoints]=useState(input),[past,setPast]=useState<PoseJoint[][]>([]),[future,setFuture]=useState<PoseJoint[][]>([]),[saving,setSaving]=useState(false),[error,setError]=useState('');const current=useRef(joints),origin=useRef<PoseJoint[]|undefined>(undefined),keyRef=useRef(key),sequence=useRef(0);current.current=joints;const signature=JSON.stringify(input);
 useEffect(()=>{setJoints(structuredClone(input));if(keyRef.current!==key){keyRef.current=key;sequence.current++;setPast([]);setFuture([]);setSaving(false);setError('');}},[key,signature]);
 async function persist(next:PoseJoint[]){const token=sequence.current;setSaving(true);setError('');try{await save(next);}catch(e){if(token===sequence.current){setJoints(structuredClone(input));setError(e instanceof Error?e.message:'保存失败');}}finally{if(token===sequence.current)setSaving(false);}}
 function begin(){if(saving)return;origin.current=structuredClone(current.current);}
 function move(id:PoseJointID,x:number,y:number){setJoints(old=>old.map(j=>j.id===id?{...j,x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),confidence:1,visible:true}:j));}
 function end(){const before=origin.current;origin.current=undefined;if(!before||JSON.stringify(before)===JSON.stringify(current.current))return;setPast(old=>[...old.slice(-29),before]);setFuture([]);void persist(structuredClone(current.current));}
 function undo(){if(saving||!past.length)return;const previous=past.at(-1)!;setFuture(old=>[...old,current.current]);setPast(old=>old.slice(0,-1));setJoints(previous);void persist(previous);}
 function redo(){if(saving||!future.length)return;const next=future.at(-1)!;setPast(old=>[...old,current.current]);setFuture(old=>old.slice(0,-1));setJoints(next);void persist(next);}
 function place(id:PoseJointID){if(saving)return;const next=current.current.map(j=>j.id===id?{...j,x:.5,y:.5,confidence:1,visible:true}:j);setPast(old=>[...old.slice(-29),current.current]);setFuture([]);setJoints(next);void persist(next);}
 function nudge(id:PoseJointID,dx:number,dy:number){const j=current.current.find(j=>j.id===id);if(!j||j.x===null||j.y===null||saving)return;const next=current.current.map(j=>j.id===id?{...j,x:Math.max(0,Math.min(1,j.x!+dx)),y:Math.max(0,Math.min(1,j.y!+dy)),confidence:1,visible:true}:j);setPast(old=>[...old.slice(-29),current.current]);setFuture([]);setJoints(next);void persist(next);}
 return {joints,begin,move,end,undo,redo,place,nudge,saving,error,canUndo:!!past.length,canRedo:!!future.length};
}
