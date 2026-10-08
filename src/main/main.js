'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./store');
const { createBackup, parseBackup } = require('./backup');
const { extractEntries } = require('./pdf-statement');
const { Security, detectDeviceId } = require('./security');
const log = require('./app-log');
const { createAutoBackup } = require('./autobackup');
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

/* Copie les 6 fichiers de la base vers un autre dossier (écrasement demandé). */
function copyDataFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const c of ['settings', 'clients', 'invoices', 'transactions', 'rules', 'meta']) {
    const src = path.join(from, c + '.json');
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, c + '.json'));
  }
}

let store = null;
let mainWindow = null;
let sec = null;
let autoBk = null; /* sauvegarde automatique quotidienne (P0) */

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
  const win = new BrowserWindow({
    show: visible,
    width: 940,
    height: 1300,
    title: I18N.tr('main.winInvoice'),
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

  await win.loadFile(path.join(RENDERER_DIR, 'print-invoice.html'), { query: { id } });
  armLogging(win);
  await ready;
  return win;
}

function ipcWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

async function printToPdf(win) {
  if (!win || win.isDestroyed()) throw new Error(I18N.tr('main.renderTimeout'));
  return win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.35, bottom: 0.35, left: 0.4, right: 0.4 }
  });
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
    if (collection === 'settings' && items && items.language) I18N.setLang(items.language, { rtl: false });
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

  /* --- Paquet « clôture de période » pour le comptable (export comptable) --- */
  const { buildPack, zipBuffer } = require('./export-pack');

  ipcMain.handle('export:close-period', gated(async (event, period) => {
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

  ipcMain.handle('invoice:export-pdf', gated(async (event, invoiceId) => {
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
  }));

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
  autoBk = createAutoBackup(store);
  try { autoBk.maybe(); } catch (e) { /* non bloquant */ }
  // Langue mémorisée : pilote les dialogues et les fenêtres (le renderer la relit lui-même).
  try {
    const saved = store.read('settings');
    I18N.setLang((saved && saved.language) || 'fr', { rtl: false });
  } catch (e) { /* langue par défaut */ }
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* P0 : une sauvegarde automatique est écrite à la fermeture (toujours à jour,
   même si aucun enregistrement n'a eu lieu aujourd'hui). */
app.on('before-quit', () => {
  if (autoBk) { try { autoBk.write(); } catch (e) { /* non bloquant */ } }
});
