const fs = require('node:fs');
const path = require('node:path');
const { enrich } = require('./profile-enrichment.cjs');
try {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || args.slice(1).some(arg => arg !== '--apply')) throw Error('Usage : node scripts/enrich-profiles.cjs fichier.json [--apply]');
  const target = path.join(__dirname,'../data/personalities.json');
  const original = fs.readFileSync(target,'utf8');
  const database = JSON.parse(original);
  const batch = JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
  const next = enrich(database,batch);
  const changed=next.profiles.filter((p,i)=>JSON.stringify(p)!==JSON.stringify(database.profiles[i])).length;
  console.log(changed+' profil(s) modifié(s), '+next.profiles.reduce((sum,p)=>sum+p.conflicts.length,0)+' divergence(s) à vérifier.');
  if (args.includes('--apply') && changed) {
    // Validate the complete batch, then replace it atomically on the same volume.
    const tmp=target+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(next,null,2)+'\n');
    fs.renameSync(tmp,target);
    console.log('Catalogue enregistré. Aucune sauvegarde joueur modifiée.');
  } else console.log('Simulation uniquement. Ajouter --apply pour enregistrer après vérification des sources.');
} catch(error) { console.error(error.message);process.exitCode=1; }
