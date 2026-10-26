(function (root) {
  'use strict';
  const fields = [
    'aliases', 'nationalities', 'birth_country', 'birth_city', 'birth_place',
    'birth_date', 'birth_date_precision', 'death_date', 'career_start_year',
    'activities', 'notable_works', 'awards', 'nominations', 'collaborations',
    'career_status', 'known_for', 'height', 'weight', 'body_measurements',
    'cup_size', 'waist', 'hips'
  ];
  const lists = new Set(['aliases', 'nationalities', 'activities', 'notable_works', 'awards', 'nominations', 'collaborations']);
  const empty = value => value === null || value === undefined || value === '' || Array.isArray(value) && value.length === 0;
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function safeUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value && value >= '1800-01-01';
  }
  function today(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
  }
  function age(birthday, at = today()) {
    if (!validDate(birthday) || !validDate(at) || birthday > at) return null;
    return Number(at.slice(0,4)) - Number(birthday.slice(0,4)) - (at.slice(5) < birthday.slice(5) ? 1 : 0);
  }
  function validSummary(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const sentences = value.trim().split(/(?<=[.!?])\s+(?=[\p{Lu}«“])/u).filter(Boolean);
    return sentences.length >= 2 && sentences.length <= 4 && /[.!?]$/.test(value.trim());
  }
  function defaults() {
    return { ...Object.fromEntries(fields.map(field => [field, lists.has(field) ? [] : null])), sources:[], field_sources:{}, conflicts:[] };
  }
  function validate(profile) {
    if (!profile || !Number.isInteger(profile.id) || profile.id < 1 || profile.id > 100 || typeof profile.stage_name !== 'string') throw Error('Identité de profil invalide.');
    for (const field of fields) {
      const value = profile[field];
      if (empty(value)) continue;
      if (lists.has(field)) {
        if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim())) throw Error('Liste invalide : ' + field);
      } else if (field === 'career_start_year') {
        if (!Number.isInteger(value) || value < 1900 || value > Number(today().slice(0,4))) throw Error('Année invalide.');
      } else if (typeof value !== 'string') throw Error('Texte invalide : ' + field);
    }
    for (const field of ['birth_date', 'death_date']) if (!empty(profile[field]) && (!validDate(profile[field]) || profile[field] > today())) throw Error('Date invalide : ' + field);
    if (profile.birth_date && profile.death_date && profile.death_date < profile.birth_date) throw Error('Dates incohérentes.');
    if (profile.birth_date_precision && !['day','month','year'].includes(profile.birth_date_precision)) throw Error('Précision de naissance invalide.');
    if (!empty(profile.known_for) && !validSummary(profile.known_for)) throw Error('known_for doit contenir deux à quatre phrases.');
    if (!Array.isArray(profile.sources) || !Array.isArray(profile.conflicts) || !profile.field_sources || typeof profile.field_sources !== 'object' || Array.isArray(profile.field_sources)) throw Error('Traçabilité invalide.');
    const ids = new Set();
    for (const source of profile.sources) {
      if (!source || typeof source.id !== 'string' || !source.id || ids.has(source.id) || typeof source.provider !== 'string' || !source.provider || !safeUrl(source.url) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(source.retrieved_at || '') || !validDate(source.retrieved_at.slice(0,10)) || !Number.isFinite(Date.parse(source.retrieved_at))) throw Error('Source invalide.');
      ids.add(source.id);
    }
    for (const [field, sourceIds] of Object.entries(profile.field_sources)) {
      if (![...fields,'stage_name'].includes(field) || !Array.isArray(sourceIds) || !sourceIds.every(id => ids.has(id))) throw Error('Références de source invalides.');
    }
    for (const field of fields) if (!empty(profile[field]) && !profile.field_sources[field]?.length) throw Error('Source manquante : ' + field);
    for (const conflict of profile.conflicts) {
      if (!fields.includes(conflict.field) || conflict.status !== 'pending' || !Array.isArray(conflict.values) || conflict.values.length < 2) throw Error('Divergence invalide.');
      for (const entry of conflict.values) if (!Array.isArray(entry.source_ids) || !entry.source_ids.length || !entry.source_ids.every(id => ids.has(id))) throw Error('Sources de divergence invalides.');
    }
    return profile;
  }
  function documented(profile, field) {
    if (profile.conflicts?.some(conflict => conflict.field === field && conflict.status === 'pending')) return null;
    const sources = profile.sources || [];
    return profile.field_sources?.[field]?.some(id => sources.some(source => source.id === id && safeUrl(source.url))) ? profile[field] : null;
  }
  function render(profile = {}, portrait = null) {
    const p = { ...defaults(), ...profile };
    const sourceLinks = field => (p.field_sources[field] || []).map(id => {
      const source = p.sources.find(source => source.id === id);
      return source && safeUrl(source.url) ? ' <a href="' + escape(safeUrl(source.url)) + '" target="_blank" rel="noopener noreferrer">[' + escape(source.provider) + ']</a>' : '';
    }).join('');
    const display = value => empty(value) ? '' : escape(Array.isArray(value) ? value.join(' · ') : value);
    const row = (field, label, override) => {
      const value = override === undefined ? documented(p,field) : override;
      return empty(value) ? '' : '<div><dt>' + label + '</dt><dd>' + display(value) + sourceLinks(field) + '</dd></div>';
    };
    const details = rows => rows ? '<dl class="encyclopedia-details">' + rows + '</dl>' : '';
    const date = documented(p,'birth_date');
    const precision = documented(p,'birth_date_precision');
    const death = documented(p,'death_date');
    const fullBirthday = (!precision || precision === 'day') && !p.conflicts.some(c => ['birth_date_precision','death_date'].includes(c.field));
    const birthdayDisplay = date && validDate(date) ? precision === 'year' ? date.slice(0,4) : precision === 'month' ? date.slice(0,7) : date : null;
    const years = fullBirthday && !(p.death_date && !death) ? age(date, death || today()) : null;
    const section = (id,title,body) => body ? '<div class="encyclopedia-section" role="region" aria-labelledby="profile-' + id + '"><h3 id="profile-' + id + '">' + title + '</h3>' + body + '</div>' : '';
    const presentation = details(row('stage_name','Nom de scène',p.stage_name || null) + row('aliases','Autres pseudonymes') + row('nationalities','Nationalité(s)') + row('birth_country','Pays de naissance') + row('birth_city','Ville de naissance') + row('birth_place','Lieu de naissance indiqué par la source') + row('birth_date','Date de naissance',birthdayDisplay) + row('birth_date',death ? 'Âge au décès' : 'Âge',years === null ? null : years + ' ans') + (p.death_date ? row('death_date','Date de décès') : ''));
    const measurements = details(row('height','Taille') + row('weight','Poids') + row('body_measurements','Mensurations (notation de la source)') + row('cup_size','Taille de soutien-gorge') + row('waist','Tour de taille (notation de la source)') + row('hips','Tour de hanches (notation de la source)'));
    const summary = documented(p,'known_for');
    const career = details(row('career_start_year','Début de carrière') + row('activities','Activités professionnelles') + row('notable_works','Œuvres et apparitions notables') + row('awards','Récompenses') + row('nominations','Nominations') + row('collaborations','Collaborations professionnelles marquantes') + row('career_status','Statut de carrière documenté')) + (validSummary(summary) ? '<h4>Pourquoi cette personnalité est-elle connue ?</h4><p class="known-for">' + display(summary) + sourceLinks('known_for') + '</p>' : '');
    let sources = p.sources.map(source => '<li><a href="' + escape(safeUrl(source.url) || '#') + '" target="_blank" rel="noopener noreferrer">' + escape(source.provider) + '</a> · Récupéré le ' + escape(source.retrieved_at) + '</li>').join('');
    if (portrait && safeUrl(portrait.url)) sources += '<li>Portrait : <a href="' + escape(safeUrl(portrait.url)) + '" target="_blank" rel="noopener noreferrer">' + escape(portrait.license || 'Source du portrait') + '</a>' + (empty(portrait.retrieved_at) ? '' : ' · Date de récupération : ' + display(portrait.retrieved_at)) + '</li>';
    const conflicts = p.conflicts.length ? '<div class="profile-conflicts" role="status"><strong>Divergences à vérifier</strong><ul>' + p.conflicts.map(c => '<li>' + escape(c.field) + ' : ' + c.values.map(v => display(v.value) + ' [' + escape(v.source_ids.join(', ')) + ']').join(' / ') + '</li>').join('') + '</ul><p>Les champs concernés sont masqués jusqu’à vérification.</p></div>' : '';
    return section('presentation','Présentation',presentation) + section('measurements','Mensurations',measurements) + section('career','Carrière et notoriété',career) + section('sources','Sources',(sources ? '<ul class="profile-sources">' + sources + '</ul>' : '') + conflicts);
  }
  const api = { fields, defaults, validate, safeUrl, validDate, validSummary, age, today, documented, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VelvetProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
