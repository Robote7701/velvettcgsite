(function (root) {
  'use strict';
  const KEY = 'velvet-v03';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  function validate(value) {
    if (!object(value) || !integer(value.coins) || !object(value.owned)) throw Error('Sauvegarde invalide : crédits ou collection.');
    const result = { ...value, owned: {}, favorites: {} };
    for (const [id, count] of Object.entries(value.owned)) {
      if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(id) || !integer(count)) throw Error('Exemplaire ou identifiant invalide.');
      result.owned[id] = count;
    }
    if (value.favorites !== undefined && !object(value.favorites)) throw Error('Favoris invalides.');
    for (const [id, favorite] of Object.entries(value.favorites || {})) {
      if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(id) || typeof favorite !== 'boolean') throw Error('Favori invalide.');
      result.favorites[id] = favorite;
    }
    if (value.tickets !== undefined && (!integer(value.tickets) || value.tickets > 10)) throw Error('Réserve invalide.');
    if (value.ticketAt !== undefined && !integer(value.ticketAt)) throw Error('Date de recharge invalide.');
    return result;
  }
  function parse(text) {
    const value = JSON.parse(text);
    if (object(value) && value.format === 'velvet-save') {
      if (value.version !== 1) throw Error('Version d’export non prise en charge.');
      return validate(value.state);
    }
    return validate(value);
  }
  function create(storage, report = () => {}) {
    let blocked = false;
    let original = null;
    return {
      load() {
        try {
          original = storage.getItem(KEY);
          if (original !== null) return parse(original);
        } catch (error) {
          blocked = true;
          report('Sauvegarde inaccessible ou invalide. Elle reste intacte ; exportez-la avant toute récupération. ' + error.message);
        }
        return { coins: 600, owned: {}, favorites: {} };
      },
      write(state) {
        try {
          if (blocked) throw Error('Écriture suspendue pour protéger la sauvegarde existante.');
          storage.setItem(KEY, JSON.stringify(validate(state)));
          return true;
        } catch (error) {
          report('Enregistrement impossible. Exportez votre partie pour conserver vos gains. ' + error.message);
          return false;
        }
      },
      import(text) {
        const state = parse(text);
        // Preserve the previous stored collection before any valid replacement.
        const previous = storage.getItem(KEY);
        if (previous !== null) storage.setItem(KEY + '-before-import', previous);
        // Écriture avant remplacement de la partie en mémoire.
        storage.setItem(KEY, JSON.stringify(state));
        blocked = false;
        original = null;
        return state;
      },
      backup() { return storage.getItem(KEY + '-before-import'); },
      export(state) {
        return JSON.stringify({ format: 'velvet-save', version: 1, state: validate(state) }, null, 2);
      },
      original() { return original; }
    };
  }
  const api = { KEY, validate, parse, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VelvetStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
