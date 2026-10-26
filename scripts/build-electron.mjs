import './prepare-terminal.mjs';
import {mkdir,copyFile} from 'node:fs/promises';
import { build } from 'esbuild';
await build({entryPoints:['electron/main.ts'],outfile:'dist-electron/main.cjs',bundle:true,platform:'node',format:'cjs',external:['node-pty','electron','ffmpeg-static','ffprobe-static','pdf-parse'],sourcemap:true});
await build({entryPoints:['electron/preload.ts'],outfile:'dist-electron/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});

await build({entryPoints:['electron/model-self-test.ts'],outfile:'dist-electron/model-self-test.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','ffprobe-static','ffmpeg-static']});

await mkdir('dist-electron/assets',{recursive:true});await copyFile('assets/models/y-bot.fbx','dist-electron/assets/y-bot.fbx');

await copyFile('electron/fbx-segment.py','dist-electron/assets/fbx-segment.py');

await copyFile('assets/skeletal2d/sample.laputa2d.zip','dist-electron/assets/sample.laputa2d.zip');
