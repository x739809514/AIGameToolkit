import {useEffect,useId,useRef} from 'react';
import {AlertCircle} from 'lucide-react';
export function FileDropNotice({message,close}:{message:string;close:()=>void}){
 const title=useId(),onClose=useRef(close);onClose.current=close;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose.current();}};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);previous?.focus();};},[]);
 return <div className="modal-backdrop"><section className="file-drop-notice" role="alertdialog" aria-modal="true" aria-labelledby={title} aria-describedby={title+'-message'}><header><AlertCircle size={18}/><h2 id={title}>无法添加动作</h2></header><p id={title+'-message'}>{message}</p><footer><button className="secondary" autoFocus onClick={close}>知道了</button></footer></section></div>;
}
