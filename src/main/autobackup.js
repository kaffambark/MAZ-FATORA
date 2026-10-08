'use strict';

/* MAZ-FATORA — sauvegarde automatique quotidienne (P0 fiabilisation).
   - Une copie complète des 6 collections est écrite UNE FOIS par jour dans
     <dataDir>/auto-backups/auto-YYYY-MM-DD.json (2 copies glissantes).
   - L'horodatage du dernier passage est mémorisé dans <dataDir>/.auto-backup.json.
   - La restauration lit le dernier fichier et le renvoie dans le même format
     qu'une sauvegarde manuelle (parseBackup de backup.js).
   - Jamais bloquant : en cas d'erreur, le passage est silencieusement sauté. */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = 'auto-backups';
const STATE_FILE = '.auto-backup.json';
const KEEP_COPIES = 2;

function dateStamp(d) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function createAutoBackup(store) {
  const dataDir = store.dir;
  const bkDir = path.join(dataDir, BACKUP_DIR);

  function readState() {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, STATE_FILE), 'utf8')) || {}; }
    catch (e) { return {}; }
  }

  function writeState(s) {
    try { fs.writeFileSync(path.join(dataDir, STATE_FILE), JSON.stringify(s), 'utf8'); }
    catch (e) { /* non bloquant */ }
  }

  function list() {
    try {
      return fs.readdirSync(bkDir)
        .filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
    } catch (e) { return []; }
  }

  function latest() {
    const files = list();
    if (!files.length) return null;
    return path.join(bkDir, files[files.length - 1]);
  }

  function write() {
    fs.mkdirSync(bkDir, { recursive: true });
    const today = dateStamp(new Date());
    const file = path.join(bkDir, `auto-${today}.json`);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store.loadAll(), null, 2), 'utf8');
    fs.renameSync(tmp, file);
    // 2 copies glissantes : suppression des plus anciennes.
    const files = list();
    while (files.length > KEEP_COPIES) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(bkDir, old)); } catch (e) { /* ignoré */ }
    }
    writeState({ last: today });
    return file;
  }

  /* Un passage par jour : si un fichier existe déjà pour aujourd'hui, on ne
     réécrit pas (les sauvegardes multiples quotidiennes sont inutiles). */
  function maybe() {
    try {
      const st = readState();
      if (st.last === dateStamp(new Date())) return null;
      return write();
    } catch (e) { return null; }
  }

  function status() {
    const files = list();
    const st = readState();
    const lastFile = latest();
    const last = st.last || (lastFile ? (path.basename(lastFile).match(/^auto-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1] || '' : '');
    return {
      dir: bkDir,
      last,
      available: files.length > 0,
      count: files.length
    };
  }

  function restore() {
    const file = latest();
    if (!file) return { error: 'none' };
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { name: path.basename(file), data };
    } catch (e) {
      return { error: 'unreadable', msg: String(e && e.message ? e.message : e) };
    }
  }

  return { maybe, write, latest, status, restore, dir: bkDir };
}

module.exports = { createAutoBackup, BACKUP_DIR, KEEP_COPIES, dateStamp };