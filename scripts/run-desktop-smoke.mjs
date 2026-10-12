import { spawn } from 'node:child_process';
import electron from 'electron';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.TOOLKIT_DEV_URL;
const child=spawn(electron,['scripts/desktop-smoke.cjs'],{env,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exit(1);});child.on('exit',(code,signal)=>{if(signal)console.error('Desktop test interrupted:',signal);process.exit(code??1);});
