import './prepare-terminal.mjs';
import {mkdir,copyFile} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
await build({entryPoints:['electron/main.ts'],outfile:'dist-electron/main.cjs',bundle:true,platform:'node',format:'cjs',external:['node-pty','electron','ffmpeg-static','ffprobe-static','pdf-parse'],sourcemap:true});
await build({entryPoints:['electron/preload.ts'],outfile:'dist-electron/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
await mkdir('dist-electron/assets',{recursive:true});await copyFile('assets/models/y-bot.fbx','dist-electron/assets/y-bot.fbx');await copyFile('electron/fbx-segment.py','dist-electron/assets/fbx-segment.py');
await copyFile('assets/skeletal2d/sample.laputa2d.zip','dist-electron/assets/sample.laputa2d.zip');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit'});
let desktop;
const stop=()=>{desktop?.kill();vite.kill();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(let i=0;i<80;i++){try{await fetch('http://127.0.0.1:5173');break;}catch{await new Promise(r=>setTimeout(r,250));}}
const env={...process.env,TOOLKIT_DEV_URL:'http://127.0.0.1:5173'};delete env.ELECTRON_RUN_AS_NODE;
desktop=spawn('node_modules/.bin/electron',['.'],{stdio:'inherit',env});
desktop.on('exit',()=>{vite.kill();process.exit();});
