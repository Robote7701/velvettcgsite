const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const portraits=require('../portrait-info.js');
const root=path.join(__dirname,'..');
const directory=path.join(root,'.local/portraits');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const subjectTitle=value=>String(value||'').replace(/\b(?:photo(?:graph)?\s+credit|photo(?:graph)?\s+by|photographer|credit\s+to)\b[\s\S]*$/i,'');
function plain(value){return String(value||'').replace(/<[^>]+>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,code)=>String.fromCodePoint(code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
function candidates(profile,pages,allProfiles){
 // Use the catalogue name, plus only the explicitly documented Tory/Tori match.
 // Broad upstream alias lists can conflate unrelated people.
 const names=[profile.stage_name,...(profile.id===88?['Tory Lane']:[])].map(normalize);
 return pages.flatMap(page=>{
  const image=page.imageinfo?.[0],meta=image?.extmetadata||{},title=String(page.title||'').replace(/^File:/,'');
  if(!image || !['image/jpeg','image/png','image/webp'].includes(image.mime) || image.width<200 || image.height<200 || image.width>image.height*1.2)return [];
  const normalized=normalize(subjectTitle(title)),license=plain(meta.LicenseShortName?.value),artist=plain(meta.Artist?.value);
  if(!names.some(name=>normalized.includes(name)) || !portraits.licenses.test(license) || !artist || !image.thumburl || !meta.LicenseUrl?.value)return [];
  if(/\b(?:nude|naked|topless|explicit|hardcore|genitals?|masturbat\w*|sexual activity|sex scene|naked breasts)\b/i.test(title+' '+plain(meta.ImageDescription?.value)))return [];
  if(profile.id===30 && !/actress|actrice|performer|\bAVN\b|\bexpo\b|premiere/i.test(title+' '+plain(meta.ImageDescription?.value)))return [];
  if(/\b(?:and|with|versus)\b|&/i.test(title) || allProfiles.some(other=>other.id!==profile.id && normalized.includes(normalize(other.stage_name))))return [];
  const score=(/cropped|portrait|headshot/i.test(title)?12:0)+(image.height>=image.width?6:0)-Math.abs(image.height/image.width-1.5);
  return [{score,title:page.title,remote_src:image.thumburl,url:image.descriptionurl,license_name:license,artist,license_url:meta.LicenseUrl.value,license:license+' · '+artist}];
 }).sort((a,b)=>b.score-a.score);
}
function imageKind(buffer){
 if(buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return 'jpg';
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'webp';
 throw Error('Le fichier reçu n’est pas une image acceptée.');
}
let lastApiRequest=0;
async function request(url){
 const u=new URL(url);
 if(u.protocol!=='https:' || !['commons.wikimedia.org','thumb.wikimedia.org','upload.wikimedia.org'].includes(u.hostname) || u.username || u.password)throw Error('Origine de portrait non autorisée.');
 const limitFile=path.join(directory,'rate-limit.json');
 if(fs.existsSync(limitFile)){
  const remaining=JSON.parse(fs.readFileSync(limitFile,'utf8')).blocked_until-Date.now();
  if(remaining>0){const error=Error('Pause Wikimedia en cours : réessayez dans '+Math.ceil(remaining/1000)+' s.');error.stop=true;throw error;}
 }
 const isApi=u.hostname==='commons.wikimedia.org';
 if(isApi){const pause=Math.max(0,3500-(Date.now()-lastApiRequest));if(pause)await new Promise(resolve=>setTimeout(resolve,pause));}
 for(let attempt=0;attempt<3;attempt++){
  if(isApi)lastApiRequest=Date.now();
  const response=await fetch(u,{headers:{'User-Agent':'VelvetCollectionPortraits/1.0 (local collection; Wikimedia Commons)'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if([429,503].includes(response.status)){
   const header=response.headers.get('retry-after');
   const seconds=header&&/^\d+$/.test(header)?Number(header):header?Math.max(0,(Date.parse(header)-Date.now())/1000):60;
   if(attempt===2||!Number.isFinite(seconds)||seconds>120){
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(limitFile,JSON.stringify({blocked_until:Date.now()+(Number.isFinite(seconds)?Math.max(5,seconds):600)*1000}));
    const error=Error('Limite Wikimedia atteinte ; collecte interrompue.'+(Number.isFinite(seconds)?' Réessayer dans '+Math.ceil(seconds)+' s.':' Réessayez plus tard.'));error.stop=true;throw error;
   }
   console.log('Wikimedia demande une pause de '+Math.max(5,Math.ceil(seconds))+' s.');
   await new Promise(resolve=>setTimeout(resolve,Math.max(5000,seconds*1000)));continue;
  }
  if(!response.ok)throw Error('Wikimedia HTTP '+response.status);
  return response;
 }
}
async function collect(ids){
 const db=JSON.parse(fs.readFileSync(path.join(root,'data/personalities.json'),'utf8'));
 fs.mkdirSync(path.join(directory,'files'),{recursive:true});
 const file=path.join(directory,'candidates.json');
 const report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema_version:1,portraits:{},missing:{}};
 for(const id of ids){
  const profile=db.profiles.find(p=>p.id===id);if(!profile)throw Error('ID inconnu.');
  // This profile is still a documented identity ambiguity; never choose its face.
  if(id===77){report.missing[id]='Identité à vérifier';console.log('#77 : identité à vérifier');continue;}
  const cached=report.portraits[id];
  const named=cached&&[profile.stage_name,...(id===88?['Tory Lane']:[])].some(name=>normalize(subjectTitle(cached.title)).includes(normalize(name)));
  if(cached && named && fs.existsSync(path.join(directory,'files',path.basename(cached.src)))){console.log('#'+id+' : candidat conservé');continue;}
  if(cached&&!named)delete report.portraits[id];
  try{
   const params=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:'filetype:bitmap "'+(id===88?'Tory Lane':profile.stage_name)+'"'+(id===30?' actress -Atropa':''),gsrnamespace:'6',gsrlimit:'25',prop:'imageinfo',iiprop:'url|extmetadata|size|mime',iiurlwidth:'600',maxlag:'5'});
   const data=await(await request('https://commons.wikimedia.org/w/api.php?'+params)).json();
   if(data.error)throw Error('Erreur de recherche Commons.');
   const found=candidates(profile,Object.values(data.query?.pages||{}),db.profiles).filter(candidate=>!(report.rejected_titles||[]).includes(candidate.title));
   let selected=null;
   for(const candidate of found.slice(0,3)){
    try{
     const response=await request(candidate.remote_src);
     if(!/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('Type de fichier inattendu.');
     const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>4*1024*1024)throw Error('Portrait trop volumineux.');
     const ext=imageKind(buffer);
     selected={...candidate,src:'assets/portraits/'+id+'.'+ext,sha256:createHash('sha256').update(buffer).digest('hex'),retrieved_at:new Date().toISOString(),review_status:'pending'};
     fs.writeFileSync(path.join(directory,'files',id+'.'+ext),buffer);
     break;
    }catch(error){if(error.stop)throw error;}
   }
   if(selected){report.portraits[id]=selected;delete report.missing[id];console.log('#'+id+' : candidat téléchargé');}
   else {report.missing[id]='Aucun portrait admissible téléchargé';console.log('#'+id+' : à compléter');}
  }catch(error){report.missing[id]=error.message;console.log('#'+id+' : '+error.message);if(error.stop){fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');throw error;}}
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 console.log(Object.keys(report.portraits).length+' candidats disponibles dans .local/portraits. Vérification visuelle requise avant --approve.');
}
function approve(ids){
 const candidates=JSON.parse(fs.readFileSync(path.join(directory,'candidates.json'),'utf8'));
 const target=path.join(root,'data/portraits.json');
 const manifest=fs.existsSync(target)?portraits.validate(JSON.parse(fs.readFileSync(target,'utf8'))):{schema_version:1,portraits:{}};
 const verified=ids.map(id=>{
  const candidate=candidates.portraits[id];if(!candidate)throw Error('Candidat absent #'+id);
  const entry={...candidate,license_url:candidate.license_url.replace(/^http:\/\/creativecommons\.org\//,'https://creativecommons.org/'),review_status:'approved'};delete entry.score;
  if(!portraits.valid(entry,id))throw Error('Métadonnées invalides #'+id);
  const source=path.join(directory,'files',path.basename(entry.src));
  const bytes=fs.readFileSync(source);
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Image modifiée depuis la collecte.');
  return {id,entry,bytes};
 });
 fs.mkdirSync(path.join(root,'assets/portraits'),{recursive:true});
 for(const {id,entry,bytes}of verified){fs.writeFileSync(path.join(root,entry.src),bytes);manifest.portraits[id]=entry;}
 manifest.updated_at=new Date().toISOString();
 const temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(manifest,null,2)+'\n');fs.renameSync(temp,target);
 console.log(verified.length+' portraits approuvés. Aucune sauvegarde joueur modifiée.');
}
if(require.main===module){
 const args=process.argv.slice(2);
 const ids=args[1]?.split(',').map(Number);
 const valid=ids?.length&&ids.every(id=>Number.isInteger(id)&&id>=1&&id<=100);
 if(args.length===1&&args[0]==='--all')collect(Array.from({length:100},(_,i)=>i+1)).catch(e=>{console.error(e.message);process.exitCode=1});
 else if(args.length===2&&valid&&args[0]==='--id')collect(ids).catch(e=>{console.error(e.message);process.exitCode=1});
 else if(args.length===2&&valid&&args[0]==='--approve'){try{approve(ids)}catch(e){console.error(e.message);process.exitCode=1}}
 else{console.error('Usage : --all, --id 1,2 ou --approve 1,2 (après contrôle visuel).');process.exitCode=1;}
}
module.exports={candidates,imageKind};
