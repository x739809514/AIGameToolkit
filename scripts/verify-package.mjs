import { spawn } from 'node:child_process';
import { mkdtempSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const root=resolve('.');mkdirSync(resolve(root,'.local-data'),{recursive:true});
const env={...process.env,TOOLKIT_DATA_DIR:mkdtempSync(resolve(root,'.local-data','package-smoke-')),TOOLKIT_SELF_TEST_OUTPUT:resolve(root,'output/mvp-review'),TOOLKIT_SELF_TEST_FIXTURES:resolve(root,'tests/fixtures')};delete env.ELECTRON_RUN_AS_NODE;delete env.TOOLKIT_DEV_URL;
const {build:{productName}}=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const child=spawn(resolve(root,`release/mac-arm64/${productName}.app/Contents/MacOS/${productName}`),['--self-test'],{env,stdio:'inherit'});child.on('error',error=>{console.error(error);process.exit(1);});child.on('exit',code=>process.exit(code??1));
