const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const API = 'https://api.theporndb.net';
const normalize = value => typeof value === 'string' ? value.normalize('NFC').trim().toLocaleLowerCase('en') : '';
const identifier = value => typeof value === 'string' && /^[a-z0-9-]+$/i.test(value);

function readToken(root, env = process.env) {
  let token = env.TPDB_TOKEN;
  if (token === undefined) {
    const file = path.join(root,'.env.local');
    if (fs.existsSync(file)) token = parseEnv(fs.readFileSync(file,'utf8')).TPDB_TOKEN;
  }
  token = String(token || '').trim().replace(/^Bearer\s+/i,'');
  if (!token) throw Error('Clé manquante : renseignez TPDB_TOKEN dans .env.local à la racine du projet.');
  if (!/^[\x21-\x7e]+$/.test(token)) throw Error('Format de TPDB_TOKEN invalide.');
  return token;
}

function createClient(token, { fetchFn = fetch, wait = ms => new Promise(resolve => setTimeout(resolve,ms)), interval = 500 } = {}) {
  let started = false;
  async function request(route) {
    const url = new URL(route,API);
    if (url.origin !== API || !/^\/performers(?:\/[a-z0-9-]+)?$/i.test(url.pathname)) throw Error('Route ThePornDB non autorisée.');
    if (started) await wait(interval);
    started = true;
    for (let attempt=0; attempt<3; attempt++) {
      let response;
      try {
        response = await fetchFn(url.href,{headers:{Accept:'application/json',Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
      } catch { throw Error('Connexion ThePornDB impossible ou délai dépassé. Aucun détail contenant la clé n’est affiché.'); }
      if ([401,403].includes(response.status)) throw Error('Accès ThePornDB refusé : vérifiez TPDB_TOKEN et les permissions du compte.');
      if ([429,502,503,504].includes(response.status) && attempt<2) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0,(Date.parse(retry)-Date.now())/1000) : 2**attempt;
        if (!Number.isFinite(seconds) || seconds>30) throw Error('Limite ThePornDB atteinte. Réessayez plus tard.');
        await wait(Math.max(1000,seconds*1000));
        continue;
      }
      if (!response.ok) throw Error('ThePornDB HTTP '+response.status+' : aucune modification du catalogue.');
      try { return await response.json(); } catch { throw Error('Réponse ThePornDB invalide : JSON attendu.'); }
    }
  }
  return {
    async search(name) {
      const found = new Map();
      for (let page=1; page<=10; page++) {
        const data = await request('/performers?'+new URLSearchParams({q:name,per_page:'100',page:String(page)}));
        if (!Array.isArray(data.data)) throw Error('Liste ThePornDB invalide.');
        for (const record of data.data) if (identifier(record.id)) found.set(record.id,record);
        const last = data.meta?.last_page ?? (data.data.length<100 ? page : page+1);
        if (!Number.isInteger(last) || last<page) throw Error('Pagination ThePornDB invalide.');
        if (page>=last) return [...found.values()];
      }
      throw Error('Trop de résultats ThePornDB : identité à vérifier manuellement.');
    },
    async detail(id) {
      if (!identifier(id)) throw Error('Identifiant ThePornDB invalide.');
      const result = await request('/performers/'+encodeURIComponent(id));
      if (!result.data || result.data.id!==id) throw Error('Fiche ThePornDB incohérente.');
      return result.data;
    }
  };
}

function selectMatch(profile, candidates) {
  const exact = candidates.filter(record => normalize(record.name) === normalize(profile.stage_name));
  return exact.length===1 ? {match:exact[0]} : {
    status:exact.length ? 'ambiguous' : 'not_found',
    candidates:(exact.length ? exact : candidates).map(record=>({id:record.id,name:record.name}))
  };
}

// Store only documented fields consumed by our adapter. No image, raw bio or token.
function metadata(record) {
  const extras = {};
  for (const field of ['nationality','birthplace','birthplace_code','birthday','birthday_type','deathday','career_start_year','height','weight','measurements','cupsize','waist','hips']) {
    if (Object.hasOwn(record.extras || {},field)) extras[field]=record.extras[field];
  }
  return {id:record.id,name:record.name,aliases:record.aliases || [],extras};
}
module.exports = { readToken, createClient, selectMatch, metadata, normalize };
