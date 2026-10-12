import {useEffect,useRef,useState,useMemo} from 'react';
import {api} from '../browser-api';
import {WorkbenchAPIContext} from './workbench-api';
import {App} from './App';
import {WorkbenchLauncher} from './WorkbenchLauncher';
export function WorkbenchRoot(){
  const [id,setID]=useState<string>();const [ready,setReady]=useState(false);const version=useRef(0);
  useEffect(()=>{let live=true;const unsubscribe=api.onWorkbenchSelected(next=>{version.current++;setID(next);setReady(true);});const current=version.current;void api.currentWorkbench().then(next=>{if(live&&current===version.current){setID(next);setReady(true);}});return()=>{live=false;unsubscribe();};},[]);
  const bound=useMemo(()=>id?api.forWorkbench(id):api,[id]);
  if(!ready)return null;
  return id?<WorkbenchAPIContext.Provider value={bound}><App key={id}/></WorkbenchAPIContext.Provider>:<WorkbenchLauncher/>;
}
