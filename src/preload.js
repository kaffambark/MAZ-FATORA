'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('factapi', {
  // Application
  appVersion: () => ipcRenderer.invoke('app:version'),

  // Sécurité : mot de passe + postes autorisés
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authSetup: (data) => ipcRenderer.invoke('auth:setup', data),
  authUnlock: (password) => ipcRenderer.invoke('auth:unlock', password),
  authLock: () => ipcRenderer.invoke('auth:lock'),
  authReset: (data) => ipcRenderer.invoke('auth:reset', data),
  authChange: (data) => ipcRenderer.invoke('auth:change', data),
  authDisable: (password) => ipcRenderer.invoke('auth:disable', password),

  // Licence d'utilisation (clé signée fournie par le vendeur)
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  licenseRegister: (key) => ipcRenderer.invoke('license:register', key),

  // Données
  storeGet: () => ipcRenderer.invoke('store:get'),
  storeSave: (collection, items) => ipcRenderer.invoke('store:save', collection, items),

  // Import CSV / PDF
  pickStatement: () => ipcRenderer.invoke('file:pick-statement'),
  pickLogo: () => ipcRenderer.invoke('file:pick-logo'),

  // Factures
  exportPdf: (invoiceId) => ipcRenderer.invoke('invoice:export-pdf', invoiceId),
  previewInvoice: (invoiceId) => ipcRenderer.invoke('invoice:preview', invoiceId),

  // Devis
  quoteExportPdf: (quoteId) => ipcRenderer.invoke('quote:export-pdf', quoteId),
  quotePreview: (quoteId) => ipcRenderer.invoke('quote:preview', quoteId),

  // Avoirs / notes de crédit
  creditExportPdf: (creditId) => ipcRenderer.invoke('credit:export-pdf', creditId),
  creditPreview: (creditId) => ipcRenderer.invoke('credit:preview', creditId),

  // Balance âgée (export CSV)
  agingExportCsv: (payload) => ipcRenderer.invoke('aging:export-csv', payload),

  // Guide d'utilisation imprimable
  guidePreview: (lang) => ipcRenderer.invoke('guide:preview', lang),
  guideExportPdf: (lang) => ipcRenderer.invoke('guide:export-pdf', lang),

  // Sauvegarde / restauration de la base (choix de l'emplacement)
  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupImport: () => ipcRenderer.invoke('backup:import'),
  backupDataPath: () => ipcRenderer.invoke('backup:data-path'),
  backupOpenFolder: () => ipcRenderer.invoke('backup:open-folder'),

  // Sauvegarde automatique quotidienne (P0 fiabilisation)
  autoBackupStatus: () => ipcRenderer.invoke('backup:auto-status'),
  autoBackupRestore: () => ipcRenderer.invoke('backup:auto-restore'),

  // Journal d'application (remontée du renderer vers le fichier log)
  log: (...args) => ipcRenderer.invoke('log:write', ...args),

  // Mise à jour automatique (electron-updater)
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdateStatus: (cb) => {
    ipcRenderer.removeAllListeners('update:status');
    ipcRenderer.on('update:status', (_event, payload) => cb(payload));
  },

  // Menu applicatif natif (actions envoyées par le process principal)
  onMenuAction: (cb) => {
    ipcRenderer.removeAllListeners('menu:action');
    ipcRenderer.on('menu:action', (_event, action) => cb(action));
  },

  // Export comptable : paquet « clôture de période » (zip + empreinte)
  exportClosePeriod: (period) => ipcRenderer.invoke('export:close-period', period),

  // Emplacement de la base de données (choix du dossier + redémarrage)
  dataPick: () => ipcRenderer.invoke('data:pick'),
  dataApply: (target, opts) => ipcRenderer.invoke('data:apply', target, opts || {}),
  dataReset: () => ipcRenderer.invoke('data:reset'),
  dataRestart: () => ipcRenderer.invoke('data:restart'),

  // Fenêtre d'impression de facture
  invoiceReady: () => ipcRenderer.send('invoice:ready'),
  invoiceWindowPrint: () => ipcRenderer.invoke('win:print'),
  invoiceWindowPdf: (name) => ipcRenderer.invoke('win:save-pdf', name),
  invoiceWindowClose: () => ipcRenderer.invoke('win:close')
});
