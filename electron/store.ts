import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptyWorkspace, upgradeWorkspaceDefaults, type Workspace } from '../src/shared/types';
export class Store {
  db: DatabaseSync;
  constructor(public directory:string){
    mkdirSync(directory,{recursive:true});mkdirSync(join(directory,'assets'),{recursive:true});
    this.db=new DatabaseSync(join(directory,'workspace.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  }
  load():Workspace{const row=this.db.prepare('SELECT data FROM workspace WHERE id=1').get() as {data:string}|undefined;const workspace:Workspace=row?JSON.parse(row.data):emptyWorkspace();if(upgradeWorkspaceDefaults(workspace))this.save(workspace);return workspace;}
  save(workspace:Workspace){this.db.prepare('INSERT INTO workspace(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(workspace));}
  close(){this.db.close();}
}
