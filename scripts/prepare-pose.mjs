import {build} from 'esbuild';
import {mkdirSync,copyFileSync,existsSync} from 'node:fs';
mkdirSync('public/pose/wasm',{recursive:true});
for(const name of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm'])copyFileSync(`node_modules/@mediapipe/tasks-vision/wasm/${name}`,`public/pose/wasm/${name}`);
if(!existsSync('public/pose/pose_landmarker_lite.task'))throw new Error('缺少本地姿态模型，参见 design/motion-library.md 下载说明。');
await build({entryPoints:['src/ui/pose-worker.ts'],outfile:'public/pose/worker.js',bundle:true,platform:'browser',format:'iife',minify:true});
