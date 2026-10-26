const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {readToken,createClient,selectMatch,metadata}=require('../scripts/tpdb-client.cjs');
const {parseArgs,collect,main}=require('../scripts/sync-tpdb.cjs');
const {buildSite,publicFiles}=require('../scripts/build-site.cjs');
const info=require('../profile-info.js');

const fixtureToken='fixture-token-never-public';
const timestamp='2026-01-02T12:00:00.000Z';
const profile=id=>({id,stage_name:'Personnalité de test '+id,rarity:'Commune',...info.defaults()});
const record=id=>({id:'uuid-'+id,name:profile(id).stage_name,aliases:[],extras:{height:'170cm'}});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const fixtureClient=()=>({search:async name=>[{id:'uuid-'+name.split(' ').at(-1),name}],detail:async id=>record(Number(id.split('-').at(-1)))});
function temp(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'velvet-tpdb-'));
 t.after(()=>{
  const resolved=path.resolve(root);
  if(path.dirname(resolved)!==path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('velvet-tpdb-'))throw Error('Dossier temporaire inattendu.');
  fs.rmSync(resolved,{recursive:true,force:true});
 });
 return root;
}
function catalogue(root) {
 fs.mkdirSync(path.join(root,'data'),{recursive:true});
 const target=path.join(root,'data/personalities.json');
 fs.writeFileSync(target,JSON.stringify({profiles:Array.from({length:100},(_,i)=>profile(i+1))}));
 return target;
}
test('token comes from ignored local file or environment; Bearer prefix and quotes supported',t=>{
 const root=temp(t);
 assert.throws(()=>readToken(root,{}),/Clé manquante/);
 fs.writeFileSync(path.join(root,'.env.local'),'TPDB_TOKEN="Bearer '+fixtureToken+'"\n');
 assert.equal(readToken(root,{}),fixtureToken);
 assert.equal(readToken(root,{TPDB_TOKEN:'environment-priority'}),'environment-priority');
 assert.throws(()=>readToken(root,{TPDB_TOKEN:''}),/Clé manquante/);
 assert.throws(()=>readToken(root,{TPDB_TOKEN:'fixture\r\nsecret'}),error=>!error.message.includes('secret'));
});
test('API token stays in Authorization header; requests use fixed API and reject redirects',async()=>{
 const calls=[];
 const client=createClient(fixtureToken,{wait:async()=>{},fetchFn:async(url,options)=>{calls.push({url,options});return json({data:[record(1)]});}});
 await client.search(profile(1).stage_name);
 assert.equal(new URL(calls[0].url).origin,'https://api.theporndb.net');
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+fixtureToken);
 assert.equal(calls[0].options.redirect,'error');
 assert.ok(!calls[0].url.includes(fixtureToken));
});
test('authentication, invalid JSON and network errors do not reveal token or response body',async()=>{
 for(const status of [401,403]) {
  const client=createClient(fixtureToken,{fetchFn:async()=>new Response(fixtureToken,{status})});
  await assert.rejects(client.search('Test'),error=>/Accès ThePornDB refusé/.test(error.message)&&!error.message.includes(fixtureToken));
 }
 for(const fetchFn of [async()=>new Response(fixtureToken),async()=>{throw Error(fixtureToken)}]) {
  await assert.rejects(createClient(fixtureToken,{fetchFn}).search('Test'),error=>!error.message.includes(fixtureToken));
 }
});
test('rate limits are retried with a bounded wait; excessive wait aborts safely',async()=>{
 const waits=[];let calls=0;
 const client=createClient(fixtureToken,{wait:async ms=>waits.push(ms),fetchFn:async()=>++calls===1?new Response('',{status:429,headers:{'retry-after':'2'}}):json({data:[]})});
 assert.deepEqual(await client.search('Test'),[]);assert.equal(calls,2);assert.deepEqual(waits,[2000]);
 const blocked=createClient(fixtureToken,{wait:async()=>{throw Error('Must not sleep')},fetchFn:async()=>new Response('',{status:429,headers:{'retry-after':'120'}})});
 await assert.rejects(blocked.search('Test'),/Réessayez plus tard/);
 let attempts=0;
 const down=createClient(fixtureToken,{wait:async()=>{},fetchFn:async()=>{attempts++;return new Response('',{status:503})}});
 await assert.rejects(down.search('Test'),/HTTP 503/);assert.equal(attempts,3);
});
test('search checks every page, detects exact homonyms and refuses fuzzy matches',async()=>{
 const client=createClient(fixtureToken,{wait:async()=>{},fetchFn:async url=>json({data:[{...record(1),id:new URL(url).searchParams.get('page')==='1'?'first':'second'}],meta:{last_page:2}})});
 const candidates=await client.search(profile(1).stage_name);
 assert.equal(candidates.length,2);assert.equal(selectMatch(profile(1),candidates).status,'ambiguous');
 assert.equal(selectMatch(profile(1),[{id:'fuzzy',name:profile(1).stage_name+' Bis',aliases:[profile(1).stage_name]}]).status,'not_found');
 assert.equal(selectMatch(profile(1),[record(1)]).match.id,'uuid-1');
});
test('mismatched detail IDs and malformed pagination are rejected',async()=>{
 await assert.rejects(createClient(fixtureToken,{fetchFn:async()=>json({data:record(2)})}).detail('uuid-1'),/incohérente/);
 await assert.rejects(createClient(fixtureToken,{fetchFn:async()=>json({data:[],meta:{last_page:'invalid'}})}).search('Test'),/Pagination/);
});
test('metadata excludes raw biographies, portraits, arbitrary fields and credential-shaped fields',()=>{
 const data=metadata({...record(1),bio:'raw biography',image:'image',api_key:fixtureToken,extras:{height:'170cm',token:fixtureToken}});
 assert.equal(JSON.stringify(data).includes(fixtureToken),false);
 assert.equal(Object.hasOwn(data,'bio'),false);assert.equal(Object.hasOwn(data,'image'),false);
 assert.equal(data.extras.height,'170cm');
});
test('collection preserves IDs and catalogue, and dates each successfully fetched source',async()=>{
 const database={profiles:[profile(1),profile(2)]};const original=structuredClone(database);
 const client=fixtureClient();client.search=async name=>name===profile(1).stage_name?[record(1)]:[];
 const result=await collect(database,[1,2],client,()=>timestamp);
 assert.equal(result.batch.profiles.length,1);assert.equal(result.batch.profiles[0].id,1);
 assert.equal(result.batch.profiles[0].retrieved_at,timestamp);
 assert.equal(result.report[1].status,'not_found');assert.deepEqual(database,original);
});
test('invalid metadata is skipped; wrong detail identity aborts without mutation',async()=>{
 const db={profiles:[profile(1)]};
 const invalid=fixtureClient();invalid.detail=async()=>({...record(1),extras:{birthday:'1990-02-30'}});
 const result=await collect(db,[1],invalid,()=>timestamp);
 assert.equal(result.batch.profiles.length,0);assert.equal(result.report[0].status,'invalid');
 const mismatch=fixtureClient();mismatch.detail=async()=>record(2);
 await assert.rejects(collect(db,[1],mismatch),/Identité.*incohérente/);
});
test('CLI requires an explicit selection and validates IDs',()=>{
 assert.throws(()=>parseArgs([]));assert.throws(()=>parseArgs(['--all','--id','1']));
 for(const id of ['0','101','-1','1.5','01'])assert.throws(()=>parseArgs(['--id',id]));
 assert.deepEqual(parseArgs(['--id','1','--id','1','--apply']).ids,[1]);
 assert.equal(parseArgs(['--all']).apply,false);
});
test('dry run writes private reports only; apply preserves a backup and never writes secrets',async t=>{
 const root=temp(t);const target=catalogue(root);const original=fs.readFileSync(target,'utf8');const logs=[];
 const options={environment:{TPDB_TOKEN:fixtureToken},clientFactory:fixtureClient,log:text=>logs.push(text)};
 await main(['--id','1'],root,options);
 assert.equal(fs.readFileSync(target,'utf8'),original);
 const directory=path.join(root,'.local/tpdb');
 const batch=JSON.parse(fs.readFileSync(path.join(directory,'batch.json'),'utf8'));
 assert.equal(batch.profiles[0].id,1);
 assert.equal(fs.readFileSync(path.join(directory,'review.json'),'utf8').includes(fixtureToken),false);
 await main(['--id','1','--apply'],root,options);
 const backups=fs.readdirSync(directory).filter(name=>name.startsWith('catalogue-before-'));
 assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(directory,backups[0]),'utf8'),original);
 const next=JSON.parse(fs.readFileSync(target,'utf8'));
 assert.equal(next.profiles[0].height,'170cm');assert.equal(next.profiles[0].id,1);
 assert.deepEqual(next.profiles.slice(1),JSON.parse(original).profiles.slice(1));
 assert.equal(next.profiles[0].known_for,null);assert.equal(logs.join('\n').includes(fixtureToken),false);
});
test('failed authentication and missing keys leave no imported file and no changed catalogue',async t=>{
 const root=temp(t);const target=catalogue(root);const before=fs.readFileSync(target,'utf8');
 await assert.rejects(main(['--all','--apply'],root,{environment:{},log:()=>{}}),/Clé manquante/);
 const client={search:async()=>{throw Error('Accès refusé')}};
 await assert.rejects(main(['--all','--apply'],root,{environment:{TPDB_TOKEN:fixtureToken},clientFactory:()=>client,log:()=>{}}),/Accès refusé/);
 assert.equal(fs.readFileSync(target,'utf8'),before);assert.equal(fs.existsSync(path.join(root,'.local')),false);
});
test('concurrent catalogue edits are preserved and reviewed batch remains available',async t=>{
 const root=temp(t);const target=catalogue(root);const edited=fs.readFileSync(target,'utf8')+'\n';
 const client=fixtureClient();client.search=async()=>{fs.writeFileSync(target,edited);return [record(1)]};
 await assert.rejects(main(['--id','1','--apply'],root,{environment:{TPDB_TOKEN:fixtureToken},clientFactory:()=>client,log:()=>{}}),/Catalogue modifié/);
 assert.equal(fs.readFileSync(target,'utf8'),edited);assert.ok(fs.existsSync(path.join(root,'.local/tpdb/batch.json')));
});
test('public build includes only runtime assets and excludes secrets and private reports',t=>{
 const root=temp(t);
 for(const name of publicFiles){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),name);}
 fs.writeFileSync(path.join(root,'data/portraits.json'),JSON.stringify({schema_version:1,portraits:{}}));
 fs.writeFileSync(path.join(root,'.env.local'),fixtureToken);
 fs.mkdirSync(path.join(root,'.local'),{recursive:true});fs.writeFileSync(path.join(root,'.local/private.json'),fixtureToken);
 buildSite(root);buildSite(root);
 assert.equal(fs.existsSync(path.join(root,'dist/.env.local')),false);
 assert.equal(fs.existsSync(path.join(root,'dist/.local')),false);
 assert.deepEqual(fs.readdirSync(path.join(root,'dist')).sort(),['booster-audio.js','booster-effects.css','data','index.html','portrait-info.js','profile-info.css','profile-info.js','save-storage.js']);
 fs.writeFileSync(path.join(root,'dist/secret.txt'),fixtureToken);
 assert.throws(()=>buildSite(root),/Fichier inattendu/);
});
