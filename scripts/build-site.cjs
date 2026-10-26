const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const portraitInfo = require('../portrait-info.js');
const publicFiles = ['index.html','favicon.svg','usability.css','save-storage.js','profile-info.js','profile-info.css','booster-effects.css','booster-audio.js','portrait-info.js','data/personalities.json','data/portraits.json'];
function buildSite(root=path.join(__dirname,'..')) {
  const output=path.join(root,'dist');
  const manifest=portraitInfo.validate(JSON.parse(fs.readFileSync(path.join(root,'data/portraits.json'),'utf8')));
  const files=[...publicFiles,...Object.values(manifest.portraits).map(entry=>entry.src)];
  for(const entry of Object.values(manifest.portraits)) {
    if(createHash('sha256').update(fs.readFileSync(path.join(root,entry.src))).digest('hex')!==entry.sha256)throw Error('Portrait modifié depuis son approbation : '+entry.src);
  }
  function inspect(directory, prefix='') {
    if(fs.lstatSync(directory).isSymbolicLink())throw Error('Lien symbolique interdit dans dist.');
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const relative=prefix+entry.name;
      if(entry.isSymbolicLink())throw Error('Lien symbolique interdit dans dist.');
      if(entry.isDirectory() && ['data','assets','assets/portraits'].includes(relative))inspect(path.join(directory,entry.name),relative+'/');
      else if(!entry.isFile() || !files.includes(relative))throw Error('Fichier inattendu dans dist. Utilisez un dossier de sortie propre.');
    }
  }
  if(fs.existsSync(output))inspect(output);
  for(const file of files) {
    const source=path.join(root,file);
    if(fs.lstatSync(source).isSymbolicLink())throw Error('Source publique invalide.');
    fs.mkdirSync(path.dirname(path.join(output,file)),{recursive:true});
    fs.copyFileSync(source,path.join(output,file));
  }
  return output;
}
if(require.main===module) {try{buildSite();console.log('Site préparé dans dist, sans clé ni fichiers de travail. Aucun déploiement effectué.');}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={buildSite,publicFiles};
