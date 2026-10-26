(function(root){
  'use strict';
  const licenses=/^(CC BY(?:-SA)? (?:1\.0|2\.0|2\.5|3\.0|4\.0)|CC0(?: 1\.0)?|Public domain)$/;
  function valid(entry,id){
    try{
      const url=new URL(entry.url),license=new URL(entry.license_url);
      return /^(?:[1-9]|[1-9][0-9]|100)$/.test(String(id)) && entry.review_status==='approved' &&
        new RegExp('^assets/portraits/'+id+'\\.(jpg|png|webp)$').test(entry.src) &&
        url.protocol==='https:' && url.hostname==='commons.wikimedia.org' && /^\/wiki\/File:/.test(url.pathname) && !url.username && !url.password &&
        license.protocol==='https:' && ['creativecommons.org','commons.wikimedia.org'].includes(license.hostname) && !license.username && !license.password &&
        licenses.test(entry.license_name) && typeof entry.artist==='string' && entry.artist.trim().length>0 &&
        typeof entry.license==='string' && entry.license.includes(entry.license_name) &&
        /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isFinite(Date.parse(entry.retrieved_at));
    }catch{return false;}
  }
  function validate(manifest){
    if(manifest?.schema_version!==1 || !manifest.portraits || typeof manifest.portraits!=='object' || Array.isArray(manifest.portraits))throw Error('Catalogue de portraits invalide.');
    for(const [id,entry]of Object.entries(manifest.portraits))if(!valid(entry,id))throw Error('Portrait invalide #'+id);
    return manifest;
  }
  const api={valid,validate,licenses};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VelvetPortraits=api;
})(typeof globalThis!=='undefined'?globalThis:this);
