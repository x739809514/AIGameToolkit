import {quickSelect,type QuickSelectInput} from '../shared/cutout-selection';
type SelectionRequest={id:number;sourceId:number;input:Omit<QuickSelectInput,'rgba'>};
type SourceRequest={type:'source';sourceId:number;rgba:Uint8ClampedArray};
let source:SourceRequest|undefined;
self.onmessage=(event:MessageEvent<SelectionRequest|SourceRequest>)=>{
 const request=event.data;if('type' in request){source=request;return;}
 try{if(!source||source.sourceId!==request.sourceId)throw Error('选区原图已变化，请重新涂选。');const started=performance.now();const mask=quickSelect({...request.input,rgba:source.rgba});self.postMessage({id:request.id,mask,duration:performance.now()-started});}catch(error){self.postMessage({id:request.id,error:(error as Error).message});}
};
