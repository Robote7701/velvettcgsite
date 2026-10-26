const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readToken, createClient, selectMatch, metadata, normalize } = require('./tpdb-client.cjs');
const { enrich, tpdbClaims, mergeClaims } = require('./profile-enrichment.cjs');
const info = require('../profile-info.js');

function parseArgs(args) {
  const options={ids:[],all:false,apply:false,help:false};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help')options.help=true;
    else if(args[i]==='--all')options.all=true;
    else if(args[i]==='--apply')options.apply=true;
    else if(args[i]==='--id') {
      const raw=args[++i];
      if(!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw || ''))throw Error('ID attendu entre 1 et 100 après --id.');
      options.ids.push(Number(raw));
    } else throw Error('Option inconnue. Utilisez --help.');
  }
  if(!options.help && (options.all===Boolean(options.ids.length)))throw Error('Choisissez --id 1 (ou plusieurs --id) ou --all.');
  options.ids=[...new Set(options.ids)];
  return options;
}
async function collect(database, ids, client, now = () => new Date().toISOString(), onProgress = () => {}) {
  const batch={provider:'ThePornDB',profiles:[]};
  const report=[];
  for(const id of ids) {
    const profile=database.profiles.find(p=>p.id===id);
    if(!profile)throw Error('Personnalité inconnue : #'+id);
    const selection=selectMatch(profile,await client.search(profile.stage_name));
    if(!selection.match){report.push({id,stage_name:profile.stage_name,...selection});onProgress(id,selection.status);continue;}
    const record=await client.detail(selection.match.id);
    if(normalize(record.name)!==normalize(profile.stage_name))throw Error('Identité ThePornDB incohérente pour #'+id+'.');
    const item={id,retrieved_at:now(),data:metadata(record)};
    try {
      mergeClaims(profile,tpdbClaims(profile,item.data,item.retrieved_at));
    } catch {
      report.push({id,stage_name:profile.stage_name,status:'invalid',message:'Métadonnées à vérifier ; aucun import de cette fiche.'});
      onProgress(id,'invalid');
      continue;
    }
    batch.profiles.push(item);
    report.push({id,stage_name:profile.stage_name,status:'ready',record_id:record.id});
    onProgress(id,'ready');
  }
  return {batch,report};
}

async function main(args=process.argv.slice(2), root=path.join(__dirname,'..'), {environment=process.env,clientFactory=createClient,log=console.log}={}) {
  const options=parseArgs(args);
  if(options.help) {
    log('Renseignez TPDB_TOKEN dans .env.local.\nSimulation : node scripts/sync-tpdb.cjs --id 1\nTous les profils : node scripts/sync-tpdb.cjs --all\nImporter les résultats : ajouter --apply.\nLes homonymes et fiches invalides sont laissés à vérifier.');
    return;
  }
  const token=readToken(root,environment);
  const target=path.join(root,'data/personalities.json');
  const original=fs.readFileSync(target,'utf8');
  const database=JSON.parse(original);
  if(database.profiles?.length!==100 || new Set(database.profiles.map(p=>p.id)).size!==100)throw Error('Catalogue de 100 identités attendu.');
  for(const profile of database.profiles)info.validate(profile);
  const ids=options.all ? database.profiles.map(p=>p.id) : options.ids;
  log('Récupération de '+ids.length+' fiche(s) ThePornDB. La clé reste locale.');
  const {batch,report}=await collect(database,ids,clientFactory(token),undefined,(id,status)=>log('#'+id+' : '+({ready:'prête',ambiguous:'homonymes à vérifier',not_found:'correspondance exacte absente',invalid:'données à vérifier'}[status] || status)));
  const next=enrich(database,batch);
  const changed=next.profiles.filter((p,i)=>JSON.stringify(p)!==JSON.stringify(database.profiles[i])).length;
  const conflicts=next.profiles.reduce((sum,p)=>sum+p.conflicts.length,0);
  const directory=path.join(root,'.local/tpdb');
  fs.mkdirSync(directory,{recursive:true});
  const summary={requested:ids.length,ready:batch.profiles.length,skipped:ids.length-batch.profiles.length,changed,conflicts};
  fs.writeFileSync(path.join(directory,'batch.json'),JSON.stringify(batch,null,2)+'\n');
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify({generated_at:new Date().toISOString(),summary,profiles:report},null,2)+'\n');
  log(summary.ready+' fiche(s) prête(s), '+summary.skipped+' à vérifier, '+conflicts+' divergence(s).');
  log('Résultats : .local/tpdb/batch.json et .local/tpdb/review.json');
  if(options.apply && changed) {
    if(fs.readFileSync(target,'utf8')!==original)throw Error('Catalogue modifié pendant la collecte. Import annulé ; le lot reste disponible.');
    const backup=path.join(directory,'catalogue-before-'+Date.now()+'-'+randomUUID()+'.json');
    fs.writeFileSync(backup,original,{flag:'wx'});
    const tmp=target+'.'+randomUUID()+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});
    fs.renameSync(tmp,target);
    log('Catalogue enrichi. Copie précédente conservée dans .local/tpdb. Sauvegardes joueur inchangées.');
  } else log('Catalogue inchangé.'+(options.apply ? '' : ' Simulation : ajouter --apply pour importer, ou utiliser le lot après vérification.'));
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parseArgs,collect,main};
