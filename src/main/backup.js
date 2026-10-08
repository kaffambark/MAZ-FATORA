'use strict';

/* Sauvegarde / restauration de la base locale.
   Le fichier est un JSON lisible, écrit à l'emplacement CHOISI par l'utilisateur
   (dialogue natif) et relu de la même façon pour la restauration. */

const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['settings', 'clients', 'invoices', 'transactions', 'rules', 'meta'];

function normalize(snapshot) {
  const out = {};
  for (const c of COLLECTIONS) {
    const v = snapshot ? snapshot[c] : undefined;
    if (c === 'settings') out.settings = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    else if (c === 'meta') out.meta = (v && typeof v === 'object' && !Array.isArray(v)) ? v : { invoiceSeq: 0 };
    else out[c] = Array.isArray(v) ? v : [];
  }
  return out;
}

/* Ecrit la sauvegarde : { app, format, exportedAt, data:{...} } */
function createBackup(snapshot, filePath) {
  const payload = {
    app: 'MAZ-FATORA',
    format: 1,
    exportedAt: new Date().toISOString(),
    data: normalize(snapshot)
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { path: filePath, bytes: fs.statSync(filePath).size, collections: COLLECTIONS };
}

/* Lit et valide une sauvegarde : { data } en cas de succès, { error, msg? } sinon.
   error : 'unreadable' | 'json' | 'format' */
function parseBackup(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { error: 'unreadable', msg: e.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: 'json', msg: e.message };
  }

  const obj = (parsed && typeof parsed === 'object') ? parsed : null;
  const data = obj && obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? obj.data : obj;
  if (!data || typeof data.settings !== 'object' || data.settings === null || !Array.isArray(data.invoices)) {
    return { error: 'format' };
  }
  return { data: normalize(data) };
}

module.exports = { createBackup, parseBackup, COLLECTIONS };
