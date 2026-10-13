import {chmodSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
// node-pty 1.1.0's packaged macOS helper does not carry executable permissions.
if(process.platform==='darwin')for(const directory of [`prebuilds/darwin-${process.arch}`,'build/Release']){
 const helper=resolve('node_modules/node-pty',directory,'spawn-helper');
 if(existsSync(helper))chmodSync(helper,0o755);
}
