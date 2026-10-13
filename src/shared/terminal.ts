export type TerminalView='terminal'|'chat';
export interface TerminalMessage {id:string;role:'user'|'assistant';text:string;createdAt:number;kind?:'shell'|'codex';exitCode?:number;running?:boolean}
export interface TerminalPaneState {id:string;name:string;view:TerminalView;messages:TerminalMessage[];codexThreadId?:string}
export interface TerminalWorkspace {panes:TerminalPaneState[]}
export interface TerminalPane extends TerminalPaneState {pid:number;cwd:string;cols:number;rows:number;running:boolean;ready:boolean;commandRunning:boolean;codexRunning:boolean;history:string;sequence:number;exitCode?:number}
export interface TerminalEvent {workbenchId:string;pane:Omit<TerminalPane,'history'>;data:string;filesChanged?:boolean}
