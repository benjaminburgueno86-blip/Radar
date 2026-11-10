import {backup} from 'node:sqlite';
import {mkdir,readdir,stat,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
export async function dailyBackup(db,folder,{force=false,prefix='gondolupa'}={}){
 if(!['gondolupa','alerts'].includes(prefix))throw Error('Tipo de respaldo inválido.');const directory=resolve(folder,'backups');await mkdir(directory,{recursive:true});const target=join(directory,prefix+'-'+new Date().toISOString().slice(0,10)+'.sqlite');
 if(!force)try{if((await stat(target)).size>0)return {file:target,created:false};}catch{}
 await backup(db,target);const files=(await readdir(directory)).filter(n=>n.startsWith(prefix+'-')&&/^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n.slice(prefix.length+1))).sort().reverse();for(const file of files.slice(7))await unlink(join(directory,file));return {file:target,created:true};
}
