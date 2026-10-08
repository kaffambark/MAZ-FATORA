'use strict';

const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['settings', 'clients', 'invoices', 'transactions', 'rules', 'meta'];

/* Version du schéma de données (P0 fiabilisation).
   - 0 = bases antérieures à la v1.13 (aucun marqueur écrit).
   - 1 = version courante : le marqueur est écrit dans <dir>/schema.json.
   Une base qui n'a pas de marqueur est considérée en version 0 puis migrée
   sans transformation tant qu'aucune évolution de structure n'est requise. */
const SCHEMA_VERSION = 1;

/* Migrations : MIGRATIONS[v] = transformation pour passer de la version v à v+1.
   Actuellement aucune évolution de structure n'est nécessaire ; le mécanisme
   est en place pour les futures versions. */
const MIGRATIONS = [];

const SCHEMA_FILE = 'schema.json';

const DEFAULTS = {
  settings: {
    language: 'fr', // 'fr' ou 'ar' — interface bilingue
    currency: 'MAD',
    tvaRegime: 'reel',
    company: {
      name: '',
      nameAr: '',
      ice: '',
      idFiscal: '',
      rc: '',
      patente: '',
      cnss: '',
      tvaNumber: '',
      address: '',
      zip: '',
      city: '',
      country: 'Maroc',
      email: '',
      phone: '',
      web: '',
      iban: ''
    },
    tvaRate: 20,
    paymentDelay: 30,
    invoicePrefix: 'FA',
    autoGenerateOnImport: true
  },
  clients: [],
  invoices: [],
  transactions: [],
  rules: [],
  meta: { invoiceSeq: 0 }
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function deepMerge(base, extra) {
  if (extra === null || extra === undefined) return clone(base);
  if (Array.isArray(base) || typeof base !== 'object' || typeof extra !== 'object') return clone(extra);
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    out[k] = k in extra ? deepMerge(base[k], extra[k]) : clone(base[k]);
  }
  return out;
}

function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (c) => path.join(dir, c + '.json');
  const cache = {};

  function readSchema() {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, SCHEMA_FILE), 'utf8'));
      return (typeof s.version === 'number') ? s.version : 0;
    } catch (e) { return 0; }
  }

  function writeSchema(version) {
    try {
      const tmp = path.join(dir, SCHEMA_FILE + '.tmp');
      fs.writeFileSync(tmp, JSON.stringify({ version }, null, 2), 'utf8');
      fs.renameSync(tmp, path.join(dir, SCHEMA_FILE));
    } catch (e) { /* non bloquant */ }
  }

  const api = {};

  /* Monte d'étape en étape jusqu'à SCHEMA_VERSION ; chaque migration peut
     lire/écrire les collections via api (read/save). Appelé au démarrage. */
  function migrate() {
    let v = readSchema();
    while (v < SCHEMA_VERSION) {
      const step = MIGRATIONS[v];
      if (typeof step === 'function') step(api);
      v += 1;
      writeSchema(v);
    }
    return v;
  }

  function read(c) {
    if (cache[c] !== undefined) return cache[c];
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(file(c), 'utf8'));
    } catch (e) {
      data = null;
    }
    const merged = deepMerge(DEFAULTS[c], data);
    cache[c] = merged;
    return merged;
  }

  function save(c, items) {
    if (!COLLECTIONS.includes(c)) throw new Error('Collection inconnue : ' + c);
    const tmp = file(c) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
    fs.renameSync(tmp, file(c));
    cache[c] = items;
    return items;
  }

  function loadAll() {
    const out = {};
    for (const c of COLLECTIONS) out[c] = read(c);
    return out;
  }

  Object.assign(api, { dir, loadAll, save, read, migrate, schemaVersion: readSchema(), COLLECTIONS });
  return api;
}

module.exports = { createStore, COLLECTIONS, SCHEMA_VERSION };
