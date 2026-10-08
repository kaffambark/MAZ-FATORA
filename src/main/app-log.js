'use strict';

/* MAZ-FATORA — journal d'application (P0 fiabilisation).
   - Écrit dans <userData>/logs/app-YYYY-MM-DD.log.
   - Rotation : on ne conserve que les 7 derniers jours (7 fichiers).
   - Jamais bloquant : si le journal est indisponible, l'application continue.
   - Sans interface Electron (tests unitaires) : configure(logDir) permet de
     pointer ailleurs ; l'écriture doit rester `.catch`-safe partout. */

const fs = require('fs');
const path = require('path');

let baseDir = null;
const KEEP_DAYS = 7;

function fmt(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function stampDate(d) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ensureDir() {
  if (baseDir) return baseDir;
  let dir = null;
  try {
    // Requête différée : le module est require-able hors Electron (tests unitaires).
    const { app } = require('electron');
    dir = path.join(app.getPath('userData'), 'logs');
  } catch (e) {
    dir = path.join(process.cwd(), '.logs');
  }
  fs.mkdirSync(dir, { recursive: true });
  baseDir = dir;
  return dir;
}

function write(level, args) {
  try {
    const dir = ensureDir();
    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const stamp = `${stampDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const line = `[${stamp}] [${level}] ${args.map(fmt).join(' ')}\n`;
    fs.appendFileSync(path.join(dir, `app-${stampDate(d)}.log`), line, 'utf8');
    // Rotation : suppression des fichiers plus anciens que KEEP_DAYS.
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const m = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(f);
      if (!m) continue;
      const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      if (t < cutoff) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignoré */ } }
    }
  } catch (e) { /* le journal ne doit jamais faire tomber l'application */ }
}

/* Redirige aussi vers la console du process principal (debug lors du dev). */
function out(level, args) {
  write(level, args);
  try { (level === 'ERREUR' ? console.error : console.log).apply(console, [`[app]`, ...args]); } catch (e) { /* ignoré */ }
}

module.exports = {
  info: (...args) => out('INFO', args),
  warn: (...args) => out('WARN', args),
  error: (...args) => out('ERREUR', args),
  setDir(dir) { baseDir = dir; },
  dir: () => ensureDir()
};