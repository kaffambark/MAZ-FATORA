'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./store');
const { createBackup, parseBackup } = require('./backup');
const { extractEntries } = require('./pdf-statement');
const { Security, detectDeviceId } = require('./security');
const log = require('./app-log');
const { createAutoBackup } = require('./autobackup');
const { createUpdater } = require('./updater');
const { buildMenuTemplate } = require('./menu');
const { createBusyTracker, decideQuit, formatDuration } = require('./lifecycle');
const I18N = require('../renderer/i18n.js');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

/* --- P0 fiabilisation : tout incident du process principal est journalisé ---
   sans interrompre l'application (le journal alimente le support client). */
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err && (err.stack || err.message) || String(err));
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason && (reason.stack || reason.message) || String(reason));
});

/* --- Instance unique : une seule instance écrit dans la même base. Une
   seconde instance ne fait que réafficher (et focaliser) la fenêtre existante. --- */
const gotSingleInstance = app.requestSingleInstanceLock();
if (!gotSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (app.isReady()) {
      createMainWindow();
    }
  });
}

/* --- Fin de session « pro » : opérations sensibles en cours comptées,
   sauvegarde + verrou + journal à la fermeture (détail plus bas). --- */
const busy = createBusyTracker();      /* exports / sauvegardes en cours */
const STARTED_AT = Date.now();         /* durée de session (journal) */
let isQuitting = false;               /* fermeture confirmée et acceptée */
let cleaned = false;                  /* nettoyage effectué une seule fois */

/* Nom de l'application (ancien nom conservé pour migrer la base existante) */
const APP_NAME = 'MAZ-FATORA';
const PREVIOUS_APP_NAME = 'FACT App';

/* Version affichée : à CHAQUE modification on incrémente le MINOR dans package.json
   (1.0 → 1.1 → 1.2 …) ; l'application affiche « major.minor ». */
const APP_VERSION = (() => {
  try {
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    const v = String(pkg.version || '0.0.0').split('.');
    return `${v[0] || 0}.${v[1] || 0}`;
  } catch (e) { return '0.0'; }
})();

/* Chemin d'une image de la racine : dans l'application packagée, Icon.png / Logo.png
   sont extraits de l'archive (asarUnpack) et le chemin pointe vers app.asar.unpacked. */
function assetPath(name) {
  const p = path.join(__dirname, '..', '..', name);
  return app.isPackaged ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p;
}

/* Changement de nom : la base quitte « FACT App » pour « MAZ-FATORA ».
   Les données existantes sont copiées au premier lancement, sans jamais écraser. */
function migrateDataDir() {
  try {
    const target = path.join(app.getPath('userData'), 'data');
    const legacy = path.join(app.getPath('appData'), PREVIOUS_APP_NAME, 'data');
    if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(legacy, target, { recursive: true });
  } catch (e) {
    console.error('Migration des données impossible :', e.message);
  }
}

/* Emplacement de la base : par défaut <userData>/data, mais il peut être CHOISI
   dans les Paramètres. Le choix est mémorisé dans config.json (à côté du dossier
   « data », jamais dedans, pour ne pas le recopier dans la base). */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_DATA_DIR = path.join(app.getPath('userData'), 'data');

function readDataConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch (e) { return {}; }
}

function resolveDataDir() {
  const dir = readDataConfig().dataDir;
  try {
    if (dir && fs.statSync(dir).isDirectory()) return dir;
  } catch (e) { /* dossier disparu : retour à l'emplacement par défaut */ }
  return DEFAULT_DATA_DIR;
}

/* Copie les 7 fichiers de la base vers un autre dossier (écrasement demandé). */
function copyDataFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const c of ['settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta']) {
    const src = path.join(from, c + '.json');
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, c + '.json'));
  }
}

let store = null;
let mainWindow = null;
let sec = null;
let autoBk = null; /* sauvegarde automatique quotidienne (P0) */
let updater = null; /* mise à jour automatique (electron-updater) */

/* Verrouillage : tant que la protection est activée et la session verrouillée,
   les accès aux données / fichiers / fenêtres sont refusés (le renderer affiche
   l'écran de déverrouillage et ne peut de toute façon pas init normalement). */
const SECURITY_PATH = path.join(app.getPath('userData'), 'security.json');

function authOk() {
  return !(sec && sec.isProtected() && !sec.isUnlocked());
}
/* Licence : tant qu'aucune clé valide n'a lié CE poste, l'application est
   inutilisable (écran d'enregistrement) — verrou anti-contrefaçon. */
function licOk() {
  return !!(sec && sec.licenseActive());
}
function gated(fn) {
  return (event, ...args) => {
    if (!licOk()) return Promise.resolve({ error: 'locked', code: 'NO_LICENSE' });
    if (!authOk()) return Promise.resolve({ error: 'locked', code: 'LOCKED' });
    try { return Promise.resolve(fn(event, ...args)); }
    catch (e) { return Promise.resolve({ error: e.message }); }
  };
}
function authIpc(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    try { return Promise.resolve(fn(event, ...args)); }
    catch (e) { return Promise.resolve({ error: e.message }); }
  });
}

// Résolution de « invoice:ready » : le renderer de la facture prévient qu'il a rendu le HTML.
const readyWaiters = new Map();

/* P0 fiabilisation : les erreurs du renderer (console de niveau warning/error
   et crash de processus) sont remontées dans le journal du process principal. */
function armLogging(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.on('console-message', (e, level, message, line, sourceId) => {
      if (level < 2) return; // logs de dev : ignorés
      const src = String(sourceId || 'renderer');
      if (level >= 3) log.error(`[renderer] ${src}:${line}`, message);
      else log.warn(`[renderer] ${src}:${line}`, message);
    });
    win.webContents.on('render-process-gone', (e, details) => {
      log.error('render-process-gone', JSON.stringify(details || {}));
    });
  } catch (e) { /* armLogging ne doit jamais bloquer la création de fenêtre */ }
}

/* Après un changement de dossier de base (data:apply / data:reset), le store est
   recréé : la sauvegarde auto et la migration doivent suivre le nouveau dossier. */
function rearmAfterDataMove() {
  try {
    if (store) store.migrate();
    autoBk = createAutoBackup(store);
    autoBk.maybe();
  } catch (e) { /* non bloquant */ }
}

/* Opération « sensible » (export, clôture, sauvegarde…) : comptabilisée pour
   demander une confirmation de fermeture. withBusy(fn) incrémente le compteur
   avant l'appel et le décrémente après (promesse ou non). */
function withBusy(fn) {
  return (event, ...args) => {
    busy.begin();
    let result;
    try { result = fn(event, ...args); }
    catch (e) { busy.end(); throw e; }
    if (result && typeof result.then === 'function') return result.finally(() => busy.end());
    busy.end();
    return result;
  };
}

/* Menu applicatif natif bilingue (Axe B) : reconstruit à chaque changement
   de langue. Les actions envoyées au renderer passent par « menu:action ». */
function installMenu() {
  try {
    const template = buildMenuTemplate({
      tr: (k, v) => I18N.tr(k, v),
      isMac: process.platform === 'darwin',
      appName: APP_NAME,
      onAction: (name) => {
        const win = mainWindow && !mainWindow.isDestroyed()
          ? mainWindow
          : (BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || null);
        if (win) win.webContents.send('menu:action', name);
      },
      onAbout: () => showAbout(mainWindow)
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } catch (e) {
    log.warn('installation du menu impossible :', e.message);
  }
}

function showAbout(parent) {
  const opts = {
    type: 'info',
    title: I18N.tr('menu.aboutTitle'),
    message: `${APP_NAME} — v${APP_VERSION}`,
    detail: I18N.tr('menu.aboutBody'),
    buttons: [I18N.tr('common.close')],
    defaultId: 0,
    noLink: true
  };
  try {
    if (parent && !parent.isDestroyed()) dialog.showMessageBoxSync(parent, opts);
    else dialog.showMessageBoxSync(opts);
  } catch (e) { /* non bloquant */ }
}

/* Nettoyage de fermeture, exécuté UNE seule fois (Axe A + D) : sauvegarde
   automatique, verrou éventuel, fenêtres d'impression fermées, updater
   stoppé, journal de fin de session (durée + version). */
function cleanUpOnQuit() {
  if (cleaned) return;
  cleaned = true;
  try { if (autoBk) autoBk.write(); } catch (e) { /* non bloquant */ }
  try { if (updater && updater.stop) updater.stop(); } catch (e) { /* non bloquant */ }
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === mainWindow) continue;
      if (!w.isDestroyed()) w.destroy();
    }
  } catch (e) { /* non bloquant */ }
  try { readyWaiters.clear(); } catch (e) { /* non bloquant */ }
  log.info('app quit', 'durée', formatDuration(Date.now() - STARTED_AT), 'version', 'v' + APP_VERSION);
}

/* Option « Verrouiller à la fermeture » (Paramètres → Sécurité, Axe C). */
function lockOnQuitEnabled() {
  try {
    const s = store && store.read('settings');
    return !!(s && s.lockOnQuit);
  } catch (e) { return false; }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    title: APP_NAME,
    icon: assetPath('Icon.png'),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));
  armLogging(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function buildInvoiceWindow(id, visible) {
  return buildDocWindow('print-invoice.html', { id }, visible);
}

/* Fenêtre d'un avoir / note de crédit (rendu print-credit.html). */
async function buildCreditWindow(id, visible) {
  return buildDocWindow('print-credit.html', { id }, visible);
}

/* Fenêtre du guide d'utilisation (aperçu / PDF), bilingue. */
async function buildGuideWindow(lang, visible) {
  return buildDocWindow('print-guide.html', { lang: lang === 'ar' ? 'ar' : 'fr' }, visible);
}

/* Fenêtre d'aperçu / PDF partagée (facture, devis OU guide) : le renderer
   charge l'un des print-*.html et prévient via « invoice:ready » (canal
   commun, résolu par readyWaiters clé par webContents.id). `query` porte les
   paramètres de l'URL ({ id } ou { lang }). */
async function buildDocWindow(htmlFile, query, visible) {
  const title = htmlFile === 'print-quote.html' ? I18N.tr('main.winQuote')
    : htmlFile === 'print-credit.html' ? I18N.tr('main.winCredit')
    : (htmlFile === 'print-guide.html' ? I18N.tr('main.winGuide') : I18N.tr('main.winInvoice'));
  const win = new BrowserWindow({
    show: visible,
    width: 940,
    height: 1300,
    title,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  /* Attente du signal « invoice:ready » du renderer de facture. La promesse est
     résolue à ce signal ; si la fenêtre est fermée ou détruite AVANT (aperçu
     refermé vite, application qui quitte, lot d'exports en cours), le délai est
     annulé et la promesse est rejetée proprement — le minuteur ne touche jamais
     à des webContents potentiellement détruits (évite « Object has been destroyed »). */
  const wcId = win.webContents.id;
  const ready = new Promise((resolve, reject) => {
    readyWaiters.set(wcId, resolve);
    let timer = null;
    const fail = () => {
      if (readyWaiters.has(wcId)) {
        readyWaiters.delete(wcId);
        reject(new Error(I18N.tr('main.renderTimeout')));
      }
    };
    const onClosed = () => {
      clearTimeout(timer);
      fail();
    };
    timer = setTimeout(() => {
      win.removeListener('closed', onClosed);
      fail();
    }, 8000);
    win.once('closed', onClosed);
  });

  await win.loadFile(path.join(RENDERER_DIR, htmlFile), { query: query || {} });
  armLogging(win);
  await ready;
  return win;
}

function ipcWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

async function printToPdf(win, override) {
  if (!win || win.isDestroyed()) throw new Error(I18N.tr('main.renderTimeout'));
  /* Format / marges du PDF d'après le « Modèle des documents » choisi.
     Le schéma complet vit dans src/renderer/doc-config.js ; côté processus
     principal on se contente de lire les quelques champs utiles.
     `override` force le format/les marges (ex. guide : A4, marges fixes). */
  let doc = null;
  try { const all = store && store.loadAll(); doc = all && all.settings && all.settings.doc; } catch (e) { /* valeurs par défaut */ }
  const pageSize = (override && override.pageSize) || ((doc && doc.paper === 'A5') ? 'A5' : 'A4');
  let margins;
  if (override && override.margins) {
    margins = override.margins;
  } else {
    const m = (doc && doc.margins) || 'normal';
    const side = m === 'narrow' ? 0.25 : (m === 'wide' ? 0.6 : 0.4);
    const vert = m === 'narrow' ? 0.25 : (m === 'wide' ? 0.6 : 0.35);
    margins = { top: vert, bottom: vert, left: side, right: side };
  }
  return win.webContents.printToPDF({ printBackground: true, pageSize, margins });
}

function registerIpc() {
  ipcMain.handle('app:version', () => APP_VERSION);

  /* --- Sécurité : mot de passe + postes autorisés --- */
  authIpc('auth:status', () => (sec ? sec.status() : { configured: false, locked: false, authorized: true, devices: [] }));
  authIpc('auth:setup', (e, data) => sec.setup(data));
  authIpc('auth:unlock', (e, password) => sec.unlock(password));
  authIpc('auth:lock', () => (sec ? sec.lockSession() : { ok: true }));
  authIpc('auth:reset', (e, data) => sec.resetPassword(data));
  authIpc('auth:change', (e, data) => sec.changePassword(data));
  authIpc('auth:disable', (e, password) => sec.disable(password));

  /* --- Licence d'utilisation (clé signée fournie par le vendeur) --- */
  authIpc('license:status', () => (sec ? sec.licenseStatus() : { active: false, configured: false }));
  authIpc('license:register', (e, key) => sec.registerLicense(key));

  /* --- Emplacement de la base de données (choix dans les Paramètres) --- */
  ipcMain.handle('data:pick', gated(async (event) => {
    try {
      const res = await dialog.showOpenDialog(ipcWindow(event), {
        title: I18N.tr('main.pickDataTitle'),
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: (store && store.dir) || DEFAULT_DATA_DIR
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      return { path: res.filePaths[0] };
    } catch (e) { return { error: e.message }; }
  }));

  /* Copie la base vers le dossier choisi et mémorise le chemin (config.json).
     L'application doit ensuite être redémarrée pour recharger depuis là. */
  ipcMain.handle('data:apply', gated((event, target, opts) => {
    try {
      if (!target || typeof target !== 'string') return { error: 'Chemin invalide' };
      const currentCfg = readDataConfig();
      let src = (currentCfg && currentCfg.dataDir && fs.existsSync(currentCfg.dataDir)) ? currentCfg.dataDir : null;
      if (!src) src = (store && store.dir) || DEFAULT_DATA_DIR;
      if (path.resolve(target) === path.resolve(src)) return { noop: true };
      if (!fs.existsSync(src)) return { error: src };
      const hasData = fs.existsSync(path.join(target, 'settings.json'));
      if (hasData && !(opts && opts.replace)) return { needConfirm: true, path: target };
      copyDataFiles(src, target);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ dataDir: target }, null, 2));
      try { store = require('./store').createStore(target); } catch (e) { /* ignore */ }
      rearmAfterDataMove();
      return { path: target };
    } catch (e) { return { error: e.message }; }
  }));

  /* Retour à l'emplacement par défaut : les données actuelles y sont recopiées
     pour que rien ne se perde, puis config.json est supprimé. */
  ipcMain.handle('data:reset', gated(() => {
    try {
      const target = DEFAULT_DATA_DIR;
      const currentCfg = readDataConfig();
      let src = (currentCfg && currentCfg.dataDir && fs.existsSync(currentCfg.dataDir)) ? currentCfg.dataDir : null;
      if (!src) src = (store && store.dir) || target;
      if (path.resolve(target) === path.resolve(src)) {
        if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
        try { store = require('./store').createStore(target); } catch (e) { /* ignore */ }
        rearmAfterDataMove();
        return { noop: true, path: target };
      }
      copyDataFiles(src, target);
      if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
      try { store = require('./store').createStore(target); } catch (e) { /* ignore */ }
      rearmAfterDataMove();
      return { path: target };
    } catch (e) { return { error: e.message }; }
  }));

  ipcMain.handle('data:restart', gated(() => {
    app.relaunch();
    app.exit(0);
    return true;
  }));

  ipcMain.handle('store:get', gated(() => store.loadAll()));

  ipcMain.handle('store:save', gated((event, collection, items) => {
    store.save(collection, items);
    // La langue choisie dans l'interface pilote les dialogues et fenêtres du process principal.
    if (collection === 'settings' && items && items.language) {
      const before = I18N.getLang();
      I18N.setLang(items.language, { rtl: false });
      if (I18N.getLang() !== before) installMenu();
    }
    // P0 : un passage de sauvegarde automatique par jour (une seule écriture).
    if (autoBk) { try { autoBk.maybe(); } catch (e) { /* non bloquant */ } }
    return true;
  }));

  /* --- Sauvegarde / restauration : l'emplacement est choisi par l'utilisateur --- */
  ipcMain.handle('backup:export', gated(async (event) => {
    const parent = ipcWindow(event);
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(parent, {
      title: I18N.tr('main.exportTitle'),
      defaultPath: path.join(app.getPath('documents'), `FACT-App-sauvegarde-${stamp}.json`),
      filters: [
        { name: I18N.tr('main.filterBackup'), extensions: ['json'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      createBackup(store.loadAll(), res.filePath);
      return { canceled: false, path: res.filePath };
    } catch (e) {
      return { canceled: false, error: 'write', msg: String(e && e.message ? e.message : e) };
    }
  }));

  ipcMain.handle('backup:import', gated(async (event) => {
    const parent = ipcWindow(event);
    const res = await dialog.showOpenDialog(parent, {
      title: I18N.tr('main.importTitle'),
      properties: ['openFile'],
      filters: [
        { name: I18N.tr('main.filterBackup'), extensions: ['json'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const file = res.filePaths[0];
    const out = parseBackup(file);
    if (out.error) return { canceled: false, error: out.error, msg: out.msg || '' };
    return { canceled: false, name: path.basename(file), data: out.data };
  }));

  ipcMain.handle('backup:data-path', gated(() => (store && store.dir) || ''));

  ipcMain.handle('backup:open-folder', gated(async () => {
    const dir = store && store.dir;
    if (!dir) return false;
    try {
      await shell.showItemInFolder(path.join(dir, 'settings.json'));
      return true;
    } catch (e) { /* fichier pas encore écrit : on ouvre le dossier */ }
    try {
      const err = await shell.openPath(dir);
      return !err;
    } catch (e) {
      return false;
    }
  }));

  /* --- P0 fiabilisation : journal d'application (remontée du renderer) --- */
  ipcMain.handle('log:write', (event, ...args) => {
    try { log.info('[renderer]', ...args); } catch (e) { /* non bloquant */ }
    return true;
  });

  /* --- P0 fiabilisation : sauvegarde automatique quotidienne --- */
  ipcMain.handle('backup:auto-status', gated(() => (autoBk ? autoBk.status() : { available: false, count: 0 })));
  ipcMain.handle('backup:auto-restore', gated(() => (autoBk ? autoBk.restore() : { error: 'none' })));

  /* --- Mise à jour automatique (electron-updater, feed GitHub Releases) ---
     Non verrouillé par gated : vérifier une mise à jour ne touche ni données
     ni licence ; l'installation est déclenchée explicitement par l'utilisateur. */
  ipcMain.handle('update:status', () => (updater ? updater.status() : { state: 'idle' }));
  ipcMain.handle('update:check', () => (updater ? updater.check() : Promise.resolve({ state: 'error', message: 'none' })));
  ipcMain.handle('update:install', () => {
    if (updater) updater.install();
    return true;
  });

  /* --- Paquet « clôture de période » pour le comptable (export comptable) --- */
  const { buildPack, zipBuffer } = require('./export-pack');

  ipcMain.handle('export:close-period', withBusy(gated(async (event, period) => {
    const parent = ipcWindow(event);
    const data = store.loadAll();
    const from = (period && period.from) || '';
    const to = (period && period.to) || '';
    if (!from || !to) return { error: 'period' };
    const inPeriod = (d) => d && d >= from && d <= to;
    /* Factures PDF de la période : rendu silencieux (fenêtres masquées) */
    const pdfs = [];
    for (const inv of data.invoices || []) {
      if (!inPeriod(inv.issueDate)) continue;
      let win = null;
      try {
        win = await buildInvoiceWindow(inv.id, false);
        const pdf = await printToPdf(win);
        pdfs.push({ name: (inv.number || 'brouillon') + '.pdf', buf: pdf });
      } catch (e) {
        /* une facture en erreur est sautée : visible dans le manifeste */
      } finally {
        if (win && !win.isDestroyed()) win.destroy();
      }
    }
    let pack = null;
    try {
      pack = buildPack(data, { from, to, pdfs, appVersion: APP_VERSION });
    } catch (e) {
      return { error: 'build', msg: String(e && e.message ? e.message : e) };
    }
    const save = await dialog.showSaveDialog(parent, {
      title: I18N.tr('main.exportCloseTitle'),
      defaultPath: path.join(app.getPath('documents'), `${pack.base}_cloture.zip`),
      filters: [
        { name: I18N.tr('main.filterZip'), extensions: ['zip'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    try {
      fs.writeFileSync(save.filePath, zipBuffer(pack.files));
      return { canceled: false, path: save.filePath, nFiles: pack.files.length, period: pack.period };
    } catch (e) {
      return { canceled: false, error: 'write', msg: String(e && e.message ? e.message : e) };
    }
  })));

  /* Balance âgée : export CSV construit par le rendu (même moteur que l'écran),
     écrit à l'emplacement choisi par l'utilisateur. */
  ipcMain.handle('aging:export-csv', gated(async (event, payload) => {
    const parent = ipcWindow(event);
    const text = (payload && payload.text) || '';
    const suggested = (payload && payload.suggestedName) || 'balance-agee.csv';
    if (!text) return { error: 'empty' };
    const save = await dialog.showSaveDialog(parent, {
      title: I18N.tr('bal.exportTitle'),
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [
        { name: I18N.tr('main.filterCsv'), extensions: ['csv'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    try {
      fs.writeFileSync(save.filePath, text, 'utf8');
      return { canceled: false, path: save.filePath };
    } catch (e) {
      return { canceled: false, error: 'write', msg: String(e && e.message ? e.message : e) };
    }
  }));

  /* Achats & dépenses : export CSV (même principe que la balance âgée). */
  ipcMain.handle('expense:export-csv', gated(async (event, payload) => {
    const parent = ipcWindow(event);
    const text = (payload && payload.text) || '';
    const suggested = (payload && payload.suggestedName) || 'depenses.csv';
    if (!text) return { error: 'empty' };
    const save = await dialog.showSaveDialog(parent, {
      title: I18N.tr('exp.exportTitle'),
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [
        { name: I18N.tr('main.filterCsv'), extensions: ['csv'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    try {
      fs.writeFileSync(save.filePath, text, 'utf8');
      return { canceled: false, path: save.filePath };
    } catch (e) {
      return { canceled: false, error: 'write', msg: String(e && e.message ? e.message : e) };
    }
  }));

  ipcMain.handle('file:pick-statement', gated(async (event) => {
    const parent = ipcWindow(event);
    const res = await dialog.showOpenDialog(parent, {
      title: I18N.tr('main.pickTitle'),
      properties: ['openFile'],
      filters: [
        { name: I18N.tr('main.filterBank'), extensions: ['pdf', 'csv', 'tsv', 'txt'] },
        { name: I18N.tr('main.filterPdf'), extensions: ['pdf'] },
        { name: I18N.tr('main.filterText'), extensions: ['csv', 'tsv', 'txt'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const filePath = res.filePaths[0];
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      try {
        const out = await extractEntries(filePath);
        return { path: filePath, name, kind: 'pdf', entries: out.entries, skipped: out.skipped, warnings: out.warnings || [] };
      } catch (e) {
        return { path: filePath, name, kind: 'pdf', error: (e && e.message) ? e.message : String(e), entries: [], skipped: 0, warnings: [] };
      }
    }

    const buf = fs.readFileSync(filePath);
    let content = buf.toString('utf8');
    // Beaucoup de banques exportent en Latin-1 : on retente si des caractères sont cassés.
    if (content.includes('�')) content = buf.toString('latin1');
    return { path: filePath, name, kind: 'csv', content };
  }));

  /* Logo de la société : l'image choisie est lue puis convertie en data URI
     (elle est mémorisée dans settings et réutilisée telle quelle sur les
     factures, sans jamais dépendre du chemin d'origine). */
  ipcMain.handle('file:pick-logo', gated(async (event) => {
    const parent = ipcWindow(event);
    const res = await dialog.showOpenDialog(parent, {
      title: I18N.tr('main.pickLogoTitle'),
      properties: ['openFile'],
      filters: [
        { name: I18N.tr('main.filterLogo'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'] },
        { name: I18N.tr('main.filterAll'), extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const filePath = res.filePaths[0];
    try {
      const buf = fs.readFileSync(filePath);
      const mimes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml'
      };
      const mime = mimes[path.extname(filePath).toLowerCase()] || 'image/png';
      return {
        path: filePath,
        name: path.basename(filePath),
        dataUri: `data:${mime};base64,${buf.toString('base64')}`
      };
    } catch (e) {
      return null;
    }
  }));

  ipcMain.handle('invoice:export-pdf', withBusy(gated(async (event, invoiceId) => {
    const parent = ipcWindow(event);
    const data = store.loadAll();
    const invoice = data.invoices.find((i) => i.id === invoiceId);
    let win = null;
    try {
      win = await buildInvoiceWindow(invoiceId, false);
      const pdf = await printToPdf(win);
      const suggested = (invoice && (invoice.number || 'facture')) + '.pdf';
      const save = await dialog.showSaveDialog(parent, {
        title: I18N.tr('main.savePdf'),
        defaultPath: suggested,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (save.canceled || !save.filePath) return { canceled: true };
      fs.writeFileSync(save.filePath, pdf);
      return { canceled: false, path: save.filePath };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  })));

  ipcMain.handle('invoice:preview', gated(async (event, invoiceId) => {
    try {
      const win = await buildInvoiceWindow(invoiceId, true);
      win.setTitle(I18N.tr('main.winInvoice'));
      win.focus();
      return true;
    } catch (e) {
      const parent = ipcWindow(event);
      dialog.showErrorBox(I18N.tr('main.previewFail'), String(e && e.message ? e.message : e));
      return false;
    }
  }));

  /* --- Devis : aperçu et sauvegarde en PDF (rendu print-quote.html) --- */
  ipcMain.handle('quote:export-pdf', withBusy(gated(async (event, quoteId) => {
    const parent = ipcWindow(event);
    const data = store.loadAll();
    const quote = data.quotes.find((q) => q.id === quoteId);
    let win = null;
    try {
      win = await buildDocWindow('print-quote.html', { id: quoteId }, false);
      const pdf = await printToPdf(win);
      const suggested = (quote && (quote.number || 'devis')) + '.pdf';
      const save = await dialog.showSaveDialog(parent, {
        title: I18N.tr('main.saveQuotePdf'),
        defaultPath: suggested,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (save.canceled || !save.filePath) return { canceled: true };
      fs.writeFileSync(save.filePath, pdf);
      return { canceled: false, path: save.filePath };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  })));

  ipcMain.handle('quote:preview', gated(async (event, quoteId) => {
    try {
      const win = await buildDocWindow('print-quote.html', { id: quoteId }, true);
      win.setTitle(I18N.tr('main.winQuote'));
      win.focus();
      return true;
    } catch (e) {
      const parent = ipcWindow(event);
      dialog.showErrorBox(I18N.tr('main.previewFail'), String(e && e.message ? e.message : e));
      return false;
    }
  }));

  /* --- Avoirs / notes de crédit : aperçu et sauvegarde en PDF (print-credit.html) --- */
  ipcMain.handle('credit:export-pdf', withBusy(gated(async (event, creditId) => {
    const parent = ipcWindow(event);
    const data = store.loadAll();
    const credit = (data.creditNotes || []).find((c) => c.id === creditId);
    let win = null;
    try {
      win = await buildCreditWindow(creditId, false);
      const pdf = await printToPdf(win);
      const suggested = (credit && (credit.number || 'avoir')) + '.pdf';
      const save = await dialog.showSaveDialog(parent, {
        title: I18N.tr('main.savePdf'),
        defaultPath: suggested,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (save.canceled || !save.filePath) return { canceled: true };
      fs.writeFileSync(save.filePath, pdf);
      return { canceled: false, path: save.filePath };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  })));

  ipcMain.handle('credit:preview', gated(async (event, creditId) => {
    try {
      const win = await buildCreditWindow(creditId, true);
      win.setTitle(I18N.tr('main.winCredit'));
      win.focus();
      return true;
    } catch (e) {
      const parent = ipcWindow(event);
      dialog.showErrorBox(I18N.tr('main.previewFail'), String(e && e.message ? e.message : e));
      return false;
    }
  }));

  /* --- Guide d'utilisation : aperçu et sauvegarde en PDF (print-guide.html) --- */
  ipcMain.handle('guide:export-pdf', withBusy(gated(async (event, lang) => {
    const parent = ipcWindow(event);
    let win = null;
    try {
      win = await buildGuideWindow(lang, false);
      /* Le guide a ses propres marges (indépendantes du modèle des documents). */
      const pdf = await printToPdf(win, {
        pageSize: 'A4',
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      });
      const suggested = 'MAZ-FATORA-Guide-' + (lang === 'ar' ? 'AR' : 'FR') + '.pdf';
      const save = await dialog.showSaveDialog(parent, {
        title: I18N.tr('main.saveGuidePdf'),
        defaultPath: suggested,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (save.canceled || !save.filePath) return { canceled: true };
      fs.writeFileSync(save.filePath, pdf);
      return { canceled: false, path: save.filePath };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  })));

  ipcMain.handle('guide:preview', gated(async (event, lang) => {
    try {
      const win = await buildGuideWindow(lang, true);
      win.setTitle(I18N.tr('main.winGuide'));
      win.focus();
      return true;
    } catch (e) {
      const parent = ipcWindow(event);
      dialog.showErrorBox(I18N.tr('main.previewFail'), String(e && e.message ? e.message : e));
      return false;
    }
  }));

  ipcMain.on('invoice:ready', (event) => {
    const resolve = readyWaiters.get(event.sender.id);
    if (resolve) {
      readyWaiters.delete(event.sender.id);
      resolve();
    }
  });

  ipcMain.handle('win:print', gated((event) => {
    const win = ipcWindow(event);
    if (win) win.webContents.print({ silent: false });
    return true;
  }));

  ipcMain.handle('win:save-pdf', gated(async (event, suggestedName) => {
    const win = ipcWindow(event);
    const pdf = await printToPdf(win);
    const save = await dialog.showSaveDialog(win, {
      title: I18N.tr('main.savePdf'),
      defaultPath: (suggestedName || 'facture') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    fs.writeFileSync(save.filePath, pdf);
    return { canceled: false, path: save.filePath };
  }));

  ipcMain.handle('win:close', (event) => {
    const win = ipcWindow(event);
    if (win) win.close();
    return true;
  });
}

app.whenReady().then(() => {
  /* Seconde instance : l'application quitte immédiatement, rien à initialiser. */
  if (!gotSingleInstance) return;

  /* Icône du Dock / de la barre des tâches */
  try {
    const icon = assetPath('Icon.png');
    if (app.dock && fs.existsSync(icon)) app.dock.setIcon(icon);
  } catch (e) { /* icône non critique */ }

  migrateDataDir();
  sec = new Security(SECURITY_PATH, detectDeviceId());
  store = createStore(resolveDataDir());
  /* P0 : montée de version du schéma (mécanisme de migrations) + sauvegarde auto. */
  try {
    const vUp = store.migrate();
    log.info('schéma de données à jour :', 'v' + vUp);
  } catch (e) {
    log.warn('migration du schéma impossible :', e.message);
  }
  log.info('app start', 'v' + APP_VERSION, process.platform + '/' + process.arch);
  autoBk = createAutoBackup(store);
  try { autoBk.maybe(); } catch (e) { /* non bloquant */ }
  // Langue mémorisée : pilote les dialogues et les fenêtres (le renderer la relit lui-même).
  try {
    const saved = store.read('settings');
    I18N.setLang((saved && saved.language) || 'fr', { rtl: false });
  } catch (e) { /* langue par défaut */ }
  registerIpc();
  createMainWindow();
  /* Menu applicatif natif bilingue (Axe B) : après la langue, rejoué à chaque
     changement de langue depuis Paramètres → Langue. */
  installMenu();

  /* Mise à jour automatique : chaque fenêtre (dont les aperçus de facture)
     reçoit l'état. En développement, aucun réseau n'est consulté (état 'dev'). */
  updater = createUpdater({
    onStatus: (status) => {
      for (const w of BrowserWindow.getAllWindows()) {
        try { if (!w.isDestroyed()) w.webContents.send('update:status', status); } catch (e) { /* non bloquant */ }
      }
    },
    log
  });
  /* Vérification automatique quelques secondes après le démarrage (packagé). */
  if (app.isPackaged) {
    setTimeout(() => { try { if (updater) updater.check(); } catch (e) { /* non bloquant */ } }, 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

/* Fenêtre principale fermée :
   - macOS : l'application reste active (dock). Si « Verrouiller à la fermeture »
     est coché et la protection active, la session est verrouillée : rouvrir
     depuis le dock redemande le mot de passe (Axe C).
   - Windows / Linux : l'application quitte. */
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    if (sec && sec.isProtected() && lockOnQuitEnabled()) {
      try { sec.lockSession(); } catch (e) { /* non bloquant */ }
    }
    return;
  }
  app.quit();
});

/* Séquence de fermeture « pro » :
   1. Sauvegarde automatique + nettoyage (fenêtres d'impression, updater, journal).
   2. Si une opération sensible est en cours (export / clôture / sauvegarde) :
      confirmation native avant de quitter — jamais d'écriture interrompue.
   3. Option « Verrouiller à la fermeture » : la session est verrouillée au quit. */
app.on('before-quit', (e) => {
  const plan = decideQuit({
    busy: busy.count(),
    confirmed: isQuitting,
    lockOnQuit: lockOnQuitEnabled(),
    protectedApp: !!(sec && sec.isProtected())
  });

  if (plan.mustConfirm) {
    e.preventDefault();
    const opts = {
      type: 'warning',
      title: APP_NAME,
      message: I18N.tr('menu.quitBusy'),
      detail: I18N.tr('menu.quitBusyDetail'),
      buttons: [I18N.tr('menu.quitAnyway'), I18N.tr('menu.quitCancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
    const choice = (mainWindow && !mainWindow.isDestroyed())
      ? dialog.showMessageBoxSync(mainWindow, opts)
      : dialog.showMessageBoxSync(opts);
    if (choice === 0) {
      isQuitting = true;
      cleanUpOnQuit();
      app.quit();
    }
    return;
  }

  if (plan.lockSession) {
    try { sec && sec.lockSession(); } catch (e2) { /* non bloquant */ }
  }
  cleanUpOnQuit();
});
