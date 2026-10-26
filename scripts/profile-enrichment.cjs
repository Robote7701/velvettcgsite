// Offline metadata ingestion only. No browser storage and no image analysis.
const { isDeepStrictEqual } = require('node:util');
const info = require('../profile-info.js');
function sourceValid(source) {
  info.validate({id:1,stage_name:'Validation',...info.defaults(),sources:[source]});
  return source;
}
function mergeClaims(profile, claims) {
  const next = structuredClone({...info.defaults(),...profile});
  for (const {field,value,source} of claims) {
    if (![...info.fields,'stage_name'].includes(field)) throw Error('Champ documentaire non autorisé : ' + field);
    if (field === 'stage_name' && value !== next.stage_name) throw Error('Le nom du catalogue ne peut pas être remplacé.');
    sourceValid(source);
    const previousSource = next.sources.find(item => item.id === source.id);
    if (previousSource && !isDeepStrictEqual(previousSource,source)) throw Error('Identifiant de source réutilisé : ' + source.id);
    if (!previousSource) next.sources.push(source);
    // Validate each candidate even when it will only be recorded as a conflict.
    info.validate({...info.defaults(),id:next.id,stage_name:next.stage_name,[field]:value,sources:[source],field_sources:{[field]:[source.id]}});
    if (value === null || value === '' || Array.isArray(value) && !value.length) continue;
    const existingIds = next.field_sources[field] || [];
    const current = next[field];
    const empty = current === null || current === undefined || current === '' || Array.isArray(current) && !current.length;
    if (empty) {
      next[field] = structuredClone(value);
      next.field_sources[field] = [source.id];
    } else if (isDeepStrictEqual(current,value)) {
      next.field_sources[field] = [...new Set([...existingIds,source.id])];
    } else {
      // Unsourced seed values are retained as an explicit catalogue claim.
      if (!existingIds.length) throw Error('Valeur existante sans source à vérifier : ' + field);
      let conflict = next.conflicts.find(item => item.field === field);
      if (!conflict) {
        conflict = {field,status:'pending',values:[{value:structuredClone(current),source_ids:[...existingIds]}]};
        next.conflicts.push(conflict);
      }
      const candidate = conflict.values.find(item => isDeepStrictEqual(item.value,value));
      if (candidate) candidate.source_ids = [...new Set([...candidate.source_ids,source.id])];
      else conflict.values.push({value:structuredClone(value),source_ids:[source.id]});
    }
  }
  return info.validate(next);
}
function tpdbClaims(profile, record, retrievedAt) {
  if (!record || typeof record.name !== 'string' || record.name.normalize('NFC').toLowerCase() !== profile.stage_name.normalize('NFC').toLowerCase()) throw Error('Identité ThePornDB à vérifier pour #' + profile.id);
  if (typeof record.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(record.id)) throw Error('Identifiant ThePornDB invalide.');
  const source = sourceValid({id:'tpdb:'+record.id+':'+retrievedAt,provider:'ThePornDB',record_id:record.id,url:'https://api.theporndb.net/performers/'+encodeURIComponent(record.id),retrieved_at:retrievedAt});
  const extras = record.extras || {};
  const values = {
    stage_name:profile.stage_name,
    aliases:record.aliases,
    nationalities:typeof extras.nationality === 'string' && extras.nationality.trim() ? [extras.nationality.trim()] : null,
    birth_place:extras.birthplace,
    career_start_year:extras.career_start_year,
    height:extras.height,weight:extras.weight,body_measurements:extras.measurements,
    cup_size:extras.cupsize,waist:extras.waist,hips:extras.hips
  };
  if (extras.birthplace_code && /^[A-Z]{2}$/.test(extras.birthplace_code)) {
    const country = new Intl.DisplayNames('fr',{type:'region'}).of(extras.birthplace_code);
    if (country && country !== extras.birthplace_code) values.birth_country = country;
  }
  // DAY_MONTH, MONTH_YEAR and YEAR do not establish a full date or an exact age.
  if (extras.birthday && !extras.birthday_type) { values.birth_date=extras.birthday;values.birth_date_precision='day'; }
  if (extras.birthday && ['MONTH_YEAR','YEAR'].includes(extras.birthday_type)) {
    values.birth_date=extras.birthday;values.birth_date_precision=extras.birthday_type==='YEAR'?'year':'month';
  }
  if (extras.deathday) values.death_date=extras.deathday;
  // Never infer city from a free-form place, status from an end year, fame from
  // a ranking, occupations from membership, or facts from images / promotional bio.
  return Object.entries(values).filter(([,value])=>value!==undefined && value!==null && value!=='').map(([field,value])=>({field,value,source}));
}
function enrich(database, batch) {
  if (!Array.isArray(batch.profiles)) throw Error('Lot documentaire invalide.');
  const next=structuredClone(database);
  const seen = new Set();
  for (const item of batch.profiles) {
    if (seen.has(item.id)) throw Error('Identifiant répété dans le lot.');
    seen.add(item.id);
    const index=next.profiles.findIndex(p=>p.id===item.id);
    if (index===-1) throw Error('Personnalité inconnue.');
    const profile=next.profiles[index];
    if (batch.provider === 'ThePornDB') next.profiles[index]=mergeClaims(profile,tpdbClaims(profile,item.data,item.retrieved_at));
    else if (batch.format === 'velvet-documentary-evidence' && batch.version === 1 && item.stage_name === profile.stage_name && Array.isArray(item.claims)) next.profiles[index]=mergeClaims(profile,item.claims);
    else throw Error('Format ou identité du lot invalide.');
  }
  return next;
}
module.exports = { mergeClaims, tpdbClaims, enrich };
