'use strict';

/* MAZ-FATORA — mise à jour automatique (electron-updater).
   - Feed : GitHub Releases du dépôt public (package.json → build.publish → github).
   - Hors runtime Electron (tests unitaires) ou en développement (application non
     packagée), l'usine est un no-op : AUCUN accès réseau, aucun événement.
   - États poussés au renderer via onStatus :
       idle | dev | checking | available | not-available | downloading | downloaded | error
   - Limite de plateforme, annoncée honnêtement : sur macOS l'auto-install silencieux
     de Squirrel.Mac exige une signature Developer ID (notarisation) ; sans
     certificat, le téléchargement est détecté mais l'installation reste manuelle.
     Sur Windows, l'installateur NSIS s'installe même non signé (avertissement
     SmartScreen). Le câblage et le ciblage zip (requis par Squirrel.Mac) sont
     déjà en place : le jour où la signature existe, rien d'autre à changer. */

function createUpdater({ onStatus, log } = {}) {
  const send = (state, extra) => {
    const payload = Object.assign({ state }, extra || {});
    if (onStatus) onStatus(payload);
    return payload;
  };

  let last = send('idle');
  let electronApp = null;
  let autoUpdater = null;

  /* Requêtes LAZY : hors Electron, require('electron') renvoie le chemin du
     binaire (une chaîne) — electron-updater ne doit jamais être chargé alors. */
  try {
    const electron = require('electron');
    electronApp = (electron && electron.app) ? electron.app : null;
  } catch (e) { /* pas de runtime electron */ }

  if (electronApp) {
    try {
      autoUpdater = require('electron-updater').autoUpdater;
    } catch (e) {
      if (log && log.error) log.error('electron-updater indisponible :', e.message);
    }
  }

  if (autoUpdater) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    /* Les détails d'electron-updater alimentent le journal d'application (P0). */
    autoUpdater.logger = {
      info: (m) => { if (log && log.info) log.info('[updater]', m); },
      warn: (m) => { if (log && log.warn) log.warn('[updater]', m); },
      error: (m) => { if (log && log.error) log.error('[updater]', m); },
      debug: (m) => { /* verbosité inutile en production */ }
    };
    autoUpdater.on('checking-for-update', () => { last = send('checking'); });
    autoUpdater.on('update-available', (info) => { last = send('available', { version: info && info.version }); });
    autoUpdater.on('update-not-available', () => { last = send('not-available'); });
    autoUpdater.on('download-progress', (p) => {
      last = send('downloading', { percent: Math.round((p && p.percent) || 0) });
    });
    autoUpdater.on('update-downloaded', (info) => { last = send('downloaded', { version: info && info.version }); });
    autoUpdater.on('error', (err) => {
      last = send('error', { message: String((err && err.message) || err) });
    });
  }

  return {
    /* Vérification : jamais de réseau hors application packagée. */
    check() {
      if (!autoUpdater || !electronApp || !electronApp.isPackaged) {
        last = send('dev');
        return Promise.resolve('dev');
      }
      try {
        return autoUpdater.checkForUpdates()
          .then(() => 'ok')
          .catch((e) => {
            last = send('error', { message: String((e && e.message) || e) });
            return 'error';
          });
      } catch (e) {
        last = send('error', { message: String((e && e.message) || e) });
        return Promise.resolve('error');
      }
    },
    /* Téléchargement déjà terminé → installation au redémarrage. */
    install() {
      if (autoUpdater) {
        try { autoUpdater.quitAndInstall(false, true); } catch (e) { /* non bloquant */ }
      }
    },
    status() { return last; }
  };
}

module.exports = { createUpdater };