import {dailyBackup} from './backup.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
export function openLedger(folder){
 mkdirSync(folder,{recursive:true});const db=new DatabaseSync(join(folder,'gondolupa.sqlite'));db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, product TEXT NOT NULL, store TEXT NOT NULL, scope TEXT NOT NULL, branch TEXT NOT NULL, name TEXT NOT NULL, price REAL NOT NULL, available INTEGER, url TEXT NOT NULL, checked TEXT NOT NULL, bucket TEXT NOT NULL, UNIQUE(product,store,scope,branch,bucket));CREATE INDEX IF NOT EXISTS product_time ON observations(product,checked);CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, detail TEXT NOT NULL, created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sources(store TEXT PRIMARY KEY,status TEXT NOT NULL,checked TEXT NOT NULL,count INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS watch(product TEXT,store TEXT,query TEXT,branch TEXT, checked TEXT,PRIMARY KEY(product,store,branch));`);
 if(!db.prepare('PRAGMA table_info(reports)').all().some(c=>c.name==='status'))db.exec("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
 const insert=db.prepare('INSERT OR IGNORE INTO observations(product,store,scope,branch,name,price,available,url,checked,bucket) VALUES(?,?,?,?,?,?,?,?,?,?)');
 return {
 record(results,branchId=null){const stamp=new Date().toISOString();db.exec('BEGIN');try{for(const r of results){db.prepare('INSERT OR REPLACE INTO sources VALUES(?,?,?,?)').run(r.storeId||r.store,r.status,stamp,r.offers.length);for(const o of r.offers){if(!(o.price>0)||!o.checkedAt||!['https:'].includes(new URL(o.url).protocol))continue;const branch=o.selectedBranchId||o.branch||'online';insert.run(o.key,o.storeId,o.scope||'unknown',branch,o.name,o.price,o.available===null?null:Number(o.available),o.url,o.checkedAt,o.checkedAt.slice(0,13));db.prepare('INSERT OR REPLACE INTO watch VALUES(?,?,?,?,?)').run(o.key,o.storeId,o.name.slice(0,100),o.scope==='selected-branch'?branchId||'':'',stamp);}}db.prepare("DELETE FROM observations WHERE checked < ?").run(new Date(Date.now()-366*86400000).toISOString());db.prepare('DELETE FROM reports WHERE created < ?').run(new Date(Date.now()-90*86400000).toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},
 prune(){db.prepare('DELETE FROM reports WHERE created < ?').run(new Date(Date.now()-90*86400000).toISOString());db.prepare('DELETE FROM observations WHERE checked < ?').run(new Date(Date.now()-366*86400000).toISOString());},
 history(key){return db.prepare('SELECT store,scope,branch,name,price,available,url,checked FROM observations WHERE product=? ORDER BY checked DESC LIMIT 500').all(key).reverse();},
 status(){return db.prepare('SELECT * FROM sources').all();},
 report(kind,detail){return db.prepare('INSERT INTO reports(kind,detail,created) VALUES(?,?,?)').run(kind,detail,new Date().toISOString()).lastInsertRowid.toString();},
 watches(){return db.prepare("SELECT * FROM watch WHERE checked < ? ORDER BY checked LIMIT 4").all(new Date(Date.now()-30*60000).toISOString());},
 counts(){return db.prepare('SELECT COUNT(*) observations,COUNT(DISTINCT product) products,MIN(checked) since FROM observations').get();},
 backup(options){return dailyBackup(db,folder,options);},
 reportStats(){return db.prepare("SELECT status,COUNT(*) count FROM reports GROUP BY status").all();},
 close(){db.close();}
 };
}
