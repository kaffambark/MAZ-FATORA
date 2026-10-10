'use strict';

/* Test de fumée complet :
   PHASE 1 — UI : chargement, contexte marocain (MAD, TVA, ICE, lettres),
                 facture regroupée.
   PHASE 1c — Langue : dictionnaires FR/AR, bascule arabe (RTL) puis retour français.
   PHASE 1d — Saisie d'une facture, paiements (partiel / solde / suppression),
              sauvegarde & restauration de la base choisie.
   PHASE 2 — PDF : fabrication d'un relevé bancaire (printToPDF) puis extraction.
   Lancement : npm test  */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const problems = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- stub des handlers IPC (le vrai main.js n'est pas chargé) ---- */
const storeStub = {
  settings: {
    company: {
      name: 'Société Test',
      nameAr: 'شركة تجريبية ش.م.م',
      ice: '002548793000054',
      idFiscal: '45879300',
      rc: '123456',
      patente: '45879300',
      cnss: '123456789',
      tvaNumber: '',
      address: '12 rue des Lilas',
      zip: '20000',
      city: 'Casablanca',
      country: 'Maroc',
      email: 'test@exemple.ma',
      phone: '05 22 00 00 00',
      web: 'www.exemple.ma',
      iban: '0007 7880 0012 3456 7890 1234'
    },
    currency: 'MAD',
    tvaRegime: 'reel',
    tvaRate: 20,
    paymentDelay: 30,
    invoicePrefix: 'FA',
    quotePrefix: 'DV',
    creditPrefix: 'AV',
    quoteValidityDays: 30,
    onboarded: true
  },
  clients: [{ id: 'c1', name: 'Dupont SARL', email: '', address: '', tvaNumber: '', phone: '' }],
  invoices: [],
  quotes: [],
  creditNotes: [],
  transactions: [
    { id: 't1', date: '2026-10-01', label: 'VIREMENT DU CLIENT DUPONT', amount: 1200.5, status: 'new', linkedInvoiceId: null },
    { id: 't2', date: '2026-10-03', label: 'CB LECLERC MARKET', amount: -87.45, status: 'new', linkedInvoiceId: null },
    { id: 't3', date: '2026-10-05', label: 'VIREMENT MARTIN CONSULTING', amount: 960, status: 'new', linkedInvoiceId: null },
    { id: 't4', date: '2026-11-02', label: 'VIREMENT HORS PERIODE', amount: 500, status: 'new', linkedInvoiceId: null }
  ],
  rules: [],
  meta: { invoiceSeq: 0, quoteSeq: 0, creditSeq: 0 }
};

/* ---- Sécurité (stubs alignés sur main.js, via le vrai module security.js) ----
   Le verrou est respecté par store:get / store:save comme dans main.js
   (gated) : quand la protection est active et la session verrouillée,
   l'accès aux données renvoie { error: 'locked', code: 'LOCKED' }. */
const secModule = require(path.join(__dirname, '..', 'src', 'main', 'security.js'));
const SEC_FILE = path.join(__dirname, '.tmp', 'security-test.json');
let secInst = null;

/* Change le poste courant (nouvelle empreinte). Les handlers IPC ci-dessous
   sont enregistrés UNE seule fois et consultent secInst à chaque appel. */
function bindSecurity(deviceId) {
  secInst = new secModule.Security(SEC_FILE, deviceId);
}

ipcMain.handle('auth:status', () => secInst.status());
ipcMain.handle('auth:setup', (e, d) => secInst.setup(d));
ipcMain.handle('auth:unlock', (e, pw) => secInst.unlock(pw));
ipcMain.handle('auth:lock', () => secInst.lockSession());
ipcMain.handle('auth:reset', (e, d) => secInst.resetPassword(d));
ipcMain.handle('auth:change', (e, d) => secInst.changePassword(d));
ipcMain.handle('auth:disable', (e, pw) => secInst.disable(pw));

ipcMain.handle('store:get', () => {
  if (!(licStubState.configured && (licStubState.bound || []).includes(secInst ? secInst.code : ''))) {
    return { error: 'locked', code: 'NO_LICENSE' };
  }
  if (secInst.isProtected() && !secInst.isUnlocked()) return { error: 'locked', code: 'LOCKED' };
  return JSON.parse(JSON.stringify(storeStub));
});
ipcMain.handle('store:save', (e, collection, items) => {
  if (!(licStubState.configured && (licStubState.bound || []).includes(secInst ? secInst.code : ''))) {
    return { error: 'locked', code: 'NO_LICENSE' };
  }
  if (secInst.isProtected() && !secInst.isUnlocked()) return { error: 'locked', code: 'LOCKED' };
  storeStub[collection] = JSON.parse(JSON.stringify(items));
  return true;
});
/* Départ : aucune protection configurée → l'application s'ouvre normalement. */
bindSecurity('MACHINE-A');

/* ---- Licence d'utilisation (anti-contrefaçon) : stubs via le VRAI module
   license.js. La signature des clés est réellement vérifiée (ed25519) ; l'état
   (clé + postes liés) est isolé dans licStub pour ne pas interférer avec la
   phase Sécurité. La licence couvre les deux postes de test par défaut → les
   phases existantes s'ouvrent normalement ; phaseLicence teste l'enregistrement. */
const licModule = require(path.join(__dirname, '..', 'src', 'main', 'license.js'));
const licStubState = {
  configured: true, customer: 'Client Smoke', maxDevices: 2, bound: []
};
function bindLicense(customer, maxDevices, boundCodes) {
  licStubState.configured = true;
  licStubState.customer = customer;
  licStubState.maxDevices = maxDevices;
  licStubState.bound = boundCodes.slice();
}
function unlicense() {
  licStubState.configured = false;
  licStubState.customer = '';
  licStubState.maxDevices = 1;
  licStubState.bound = [];
}
/* Clé de test : paire dédiée (la clé publique de test remplace celle embarquée,
   au sein du smoke uniquement). */
const testPair = licModule.genKeyPair();
licModule.readPublicPem = () => testPair.publicPem;
const testKey = (customer, max) => licModule.issueKey({ c: customer, m: max, i: '2026-10-08' }, testPair.privatePem);
const LIC_KEY_1 = testKey('Client Smoke', 1);
const LIC_KEY_2 = testKey('Client Smoke', 2);

ipcMain.handle('license:status', () => {
  const code = secInst ? secInst.code : '';
  const bound = licStubState.bound || [];
  return {
    active: licStubState.configured && bound.includes(code),
    configured: licStubState.configured,
    customer: licStubState.customer,
    maxDevices: licStubState.maxDevices,
    bound: bound.length,
    currentBound: bound.includes(code),
    code
  };
});
ipcMain.handle('license:register', (e, key) => {
  const payload = licModule.verifyKey(key, licModule.readPublicPem());
  if (!payload) return { error: 'invalid' };
  const code = secInst ? secInst.code : '';
  const bound = licStubState.bound || [];
  if (bound.includes(code)) {
    return { ok: true, already: true, customer: licStubState.customer, maxDevices: licStubState.maxDevices, bound: bound.length };
  }
  const max = licStubState.configured ? licStubState.maxDevices : payload.maxDevices;
  if (bound.length >= max) return { error: 'slots', maxDevices: max };
  licStubState.configured = true;
  licStubState.customer = payload.customer;
  licStubState.maxDevices = payload.maxDevices;
  licStubState.bound = bound.concat([code]);
  return { ok: true, customer: payload.customer, maxDevices: payload.maxDevices, bound: licStubState.bound.length };
});
/* La licence couvre les deux postes de test → l'app s'ouvre normalement partout. */
bindLicense('Client Smoke', 2, [secModule.deviceCode('MACHINE-A'), secModule.deviceCode('MACHINE-B')]);

/* Emplacement de la base « choisi » pour le test (affiché dans les paramètres) */
const DATA_DIR = path.join(__dirname, '.tmp', 'db');
ipcMain.handle('backup:data-path', () => DATA_DIR);

/* P0 : sauvegarde automatique quotidienne — le vrai module n'est pas chargé,
   on simule une sauvegarde existante (statut + restauration testables). */
ipcMain.handle('backup:auto-status', () => ({
  dir: path.join(DATA_DIR, 'auto-backups'),
  last: '2026-10-08',
  available: true,
  count: 1
}));
ipcMain.handle('backup:auto-restore', () => ({
  name: 'auto-2026-10-08.json',
  data: JSON.parse(JSON.stringify(storeStub))
}));

/* P0 : journal d'application — acquis neutre dans les tests. */
ipcMain.handle('log:write', () => true);

/* Mise à jour automatique (electron-updater) : acquis neutre — aucun réseau.
   L'état simulé annonce une vérification « à jour » dès le démarrage. */
ipcMain.handle('update:status', () => ({ state: 'idle' }));
ipcMain.handle('update:check', () => ({ state: 'not-available' }));
ipcMain.handle('update:install', () => true);

/* Logo de société : le sélecteur de fichier est remplacé par une image 1×1 (PNG),
   lue de la même façon que le vrai handler (data URI). */
const LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
ipcMain.handle('file:pick-logo', async () => ({
  path: path.join(__dirname, '.tmp', 'logo.png'),
  name: 'logo.png',
  dataUri: LOGO_DATA_URI
}));

/* Export comptable « clôture de période » : le VRAI module export-pack.js est
   utilisé (CSV + manifeste + empreinte + zip) ; les PDF sont produits par le
   vrai main.js, non chargé ici — la phase se concentre sur le paquet et son
   intégrité. Le zip est écrit dans .tmp, dans le dossier de test. */
const exportPack = require(path.join(__dirname, '..', 'src', 'main', 'export-pack.js'));
ipcMain.handle('export:close-period', async (event, period) => {
  const pack = exportPack.buildPack(storeStub, {
    from: period && period.from,
    to: period && period.to,
    appVersion: '1.23'
  });
  const zipPath = path.join(__dirname, '.tmp', pack.base + '_cloture.zip');
  fs.writeFileSync(zipPath, exportPack.zipBuffer(pack.files));
  return { canceled: false, path: zipPath, nFiles: pack.files.length, period: pack.period };
});

/* Version de l'application (lue dans package.json par le vrai main.js) */
ipcMain.handle('app:version', () => '1.24');

function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else {
    problems.push(name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : ''));
    console.log('  FAIL ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : ''));
  }
}

const ev = (win, code) => win.webContents.executeJavaScript(code, true);

async function phaseUi() {
  console.log('--- PHASE 1 : UI ---');
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on('console-message', (...args) => {
    const s = JSON.stringify(args.map((a) => (typeof a === 'string' ? a : (a && a.message) || (typeof a === 'object' ? a : null))).filter(Boolean));
    if (/"level":\s*3/.test(s) || /Uncaught/.test(s)) problems.push('console: ' + s);
  });
  win.webContents.on('render-process-gone', (e, d) => problems.push('render gone: ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, code, desc) => problems.push('did-fail-load: ' + code + ' ' + desc));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  const base = await ev(win, `(function () {
    const out = { hasApi: !!window.factapi, views: document.querySelectorAll('.view').length };
    out.title = document.title;
    const lg = document.querySelector('.brand-logo');
    out.logo = lg ? { ok: lg.complete && lg.naturalWidth > 0, w: lg.naturalWidth, src: lg.getAttribute('src') } : null;
    out.favicon = (document.querySelector('link[rel="icon"]') || {}).href || '';
    out.version = ((document.querySelector('#app-version') || {}).textContent || '').trim();
    out.brandBg = document.querySelector('.brand')
      ? getComputedStyle(document.querySelector('.brand')).backgroundColor : '';
    out.dashRendered = !!document.querySelector('#dash-drafts') && document.querySelector('#dash-drafts').innerHTML.length > 0;
    try {
      const csvText = [
        'Date;Libelle;Debit;Credit',
        '05/10/2026;"VIREMENT DU CLIENT DUPONT";;1 200,50',
        '06/10/2026;"CB AMAZON MARKET PLACE";-25,50;',
        '07/10/2026;"CB CARREFOUR";;"34,99 EUR"'
      ].join('\\n');
      out.csv = CSV.toEntries(csvText).entries;
    } catch (e) { out.csvError = e.message; }
    return out;
  })()`);

  check('API preload présente', base.hasApi);
  check('11 vues rendues (dont Avoirs, Paiements et Devis)', base.views === 11, base.views);
  check('nom de l\'application = MAZ-FATORA', base.title === 'MAZ-FATORA', base.title);
  check('logo de marque chargé (Logo.png)', base.logo && base.logo.ok, base.logo);
  check('logo posé sur fond blanc (lisibilité sur la sidebar bleue)',
    base.brandBg === 'rgb(255, 255, 255)', base.brandBg);
  check('favicon Icon.png déclaré', /Icon\.png/.test(base.favicon || ''), base.favicon);
  check('version affichée dans la sidebar (v1.24)', base.version === 'v1.24', base.version);
  check('tableau de bord rempli', base.dashRendered);
  check('parseur CSV', !base.csvError && base.csv && base.csv.length === 3 &&
    base.csv[0].amount === 1200.5 && base.csv[1].amount === -25.5 && base.csv[2].amount === 34.99, base.csv || base.csvError);

  /* --- contexte marocain : MAD, taux TVA, mentions, montant en toutes lettres --- */
  const ma = await ev(win, `(function () {
    return {
      money: money(1200.5),
      moneyZero: money(0),
      cur: currency(),
      fr: WORDS.fr(1200.5),
      frEntier: WORDS.fr(2450),
      ar: WORDS.ar(1200.5),
      csvMad: CSV.parseNumber('1 250,50 MAD'),
      csvDh: CSV.parseNumber('-45,00 DH'),
      ice: document.querySelector('#set-ice').value,
      nameAr: document.querySelector('#set-name-ar').value,
      regime: document.querySelector('#set-regime').value,
      country: document.querySelector('#set-country').value,
      tvaOpts: Array.from(document.querySelectorAll('#set-tvarate option')).map(o => o.value),
      siretGone: !document.querySelector('#set-siret')
    };
  })()`);
  check('montants affichés en MAD',
    ma.money.replace(/[\u202f\u00a0\u0020]/g, ' ') === '1 200,50 MAD' && ma.moneyZero === '0,00 MAD', ma);
  check('devise MAD par défaut', ma.cur === 'MAD', ma.cur);
  check('montant en toutes lettres FR', ma.fr === 'mille deux cents dirhams et cinquante centimes', ma.fr);
  check('montant en toutes lettres FR (milliers)', ma.frEntier === 'deux mille quatre cent cinquante dirhams', ma.frEntier);
  check('montant en toutes lettres AR', /^ألف/.test(ma.ar) && /درهم/.test(ma.ar), ma.ar);
  check('parseur CSV accepte le suffixe MAD', ma.csvMad === 1250.5, ma.csvMad);
  check('parseur CSV accepte le suffixe DH', ma.csvDh === -45, ma.csvDh);
  check('paramètres : ICE renseigné', ma.ice === '002548793000054', ma.ice);
  check('paramètres : nom de société arabe', ma.nameAr !== '', ma.nameAr);
  check('paramètres : pays Maroc par défaut', ma.country === 'Maroc', ma.country);
  check('paramètres : régime « réel normal »', ma.regime === 'reel', ma.regime);
  check('taux TVA marocains proposés (20/14/10/7/0)',
    JSON.stringify(ma.tvaOpts) === JSON.stringify(['20', '14', '10', '7', '0']), ma.tvaOpts);
  check('champ SIRET remplacé (contexte marocain)', ma.siretGone, ma.siretGone);

  /* --- visibilité réelle (getComputedStyle) : le voile doit être vraiment masqué --- */
  const vis0 = await ev(win, `(function () {
    const d = (sel) => getComputedStyle(document.querySelector(sel)).display;
    const out = { modal: d('#modal-root'), toast: d('#toast') };
    document.querySelector('#modal-root').hidden = false;
    out.modalOuvert = d('#modal-root');
    document.querySelector('#modal-root').hidden = true;
    out.modalFerme = d('#modal-root');
    return out;
  })()`);
  check('voile de modale réellement masqué au démarrage', vis0.modal === 'none', vis0);
  check('voile réellement affiché quand ouvert', vis0.modalOuvert === 'flex', vis0);
  check('voile réellement re-masqué après fermeture', vis0.modalFerme === 'none', vis0);
  check('toast réellement masqué au démarrage', vis0.toast === 'none', vis0);

  /* --- enregistrement des paramètres (aller-retour) --- */
  await ev(win, `document.querySelector('#btn-save-settings').click(); true`);
  await wait(350);
  const sv = await ev(win, `({
    ice: state.settings.company.ice,
    cur: state.settings.currency,
    regime: state.settings.tvaRegime,
    country: state.settings.company.country,
    iban: state.settings.company.iban
  })`);
  check('paramètres enregistrés (ICE, MAD, régime, RIB)',
    sv.ice === '002548793000054' && sv.cur === 'MAD' && sv.regime === 'reel' &&
    sv.country === 'Maroc' && sv.iban === '0007 7880 0012 3456 7890 1234', sv);
  /* le toast « Paramètres enregistrés » disparaît tout seul (2,5 s) */

  /* --- génération : période + client unique --- */
  const gen1 = await ev(win, `(function () {
    document.querySelector('#btn-generate').click();
    const from = document.querySelector('#gen-from');
    const to = document.querySelector('#gen-to');
    return { modal: !document.querySelector('#modal-root').hidden, visible: getComputedStyle(document.querySelector('#modal-root')).display, from: from && from.value, to: to && to.value };
  })()`);
  check('modale génération ouverte', gen1.modal, gen1);
  check('modale réellement visible (voile en flex)', gen1.visible === 'flex', gen1);
  check('période par défaut = min/max des encaissements', gen1.from === '2026-10-01' && gen1.to === '2026-11-02', gen1);

  await ev(win, `(function () {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#gen-from', '2026-10-01');
    set('#gen-to', '2026-10-07');
    const sel = document.querySelector('#gen-client');
    sel.value = 'c1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#gen-run').click();
    return true;
  })()`);
  await wait(350);

  const gen3 = await ev(win, `({
    drafts: state.invoices.filter(i => i.status === 'draft').length,
    clients: state.invoices.map(i => i.clientId),
    horsPeriode: !!state.transactions.find(t => t.id === 't4').linkedInvoiceId,
    debit: !!state.transactions.find(t => t.id === 't2').linkedInvoiceId,
    badge: document.querySelector('#drafts-count').textContent,
    tva: state.invoices[0] && state.invoices[0].lines[0].tva
  })`);
  check('2 factures pour la période 01→07/10', gen3.drafts === 2, gen3);
  check('toutes attribuées au client unique', gen3.clients.length === 2 && gen3.clients.every((c) => c === 'c1'), gen3);
  check('transaction hors période non liée', !gen3.horsPeriode, gen3);
  check('débit (dépense) non facturé', !gen3.debit, gen3);
  check('badge « à valider » = 2', gen3.badge === '2', gen3);
  check('TVA du formulaire appliquée', gen3.tva === 20, gen3);

  const visFerme = await ev(win, `getComputedStyle(document.querySelector('#modal-root')).display`);
  check('modale réellement fermée après génération', visFerme === 'none', visFerme);

  /* --- génération regroupée : 1 facture pour toute la période --- */
  await ev(win, `state.invoices.length = 0; state.transactions.forEach(t => { t.linkedInvoiceId = null; }); renderAll(); true;`);

  await ev(win, `(function () {
    document.querySelector('#btn-generate').click();
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#gen-from', '2026-10-01');
    set('#gen-to', '2026-10-07');
    const sel = document.querySelector('#gen-client');
    sel.value = 'c1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const r = document.querySelector('input[name="gen-mode"][value="group"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#gen-run').click();
    return true;
  })()`);
  await wait(350);

  const gen5 = await ev(win, `({
    n: state.invoices.length,
    lines: state.invoices[0] ? state.invoices[0].lines.length : 0,
    txnIds: state.invoices[0] ? (state.invoices[0].transactionIds || []).length : 0,
    linked: state.transactions.filter(t => t.linkedInvoiceId).length,
    client: state.invoices[0] ? state.invoices[0].clientId : null
  })`);
  check('1 seule facture regroupée', gen5.n === 1, gen5);
  check('2 lignes (une par encaissement)', gen5.lines === 2, gen5);
  check('2 transactions rattachées', gen5.txnIds === 2 && gen5.linked === 2, gen5);
  check('client unique sur la regroupée', gen5.client === 'c1', gen5);

  /* --- éditeur de facture : taux marocains + montant en toutes lettres --- */
  const ed = await ev(win, `(function () {
    openInvoiceEditor(state.invoices[0].id);
    const sel = document.querySelector('#ie-lines select[data-f="tva"]');
    const out = {
      modal: getComputedStyle(document.querySelector('#modal-root')).display,
      opts: sel ? Array.from(sel.options).map(o => o.value) : null,
      words: (document.querySelector('#ie-words') || {}).textContent || '',
      rate: sel ? sel.value : null
    };
    closeModal();
    return out;
  })()`);
  check('modale éditeur réellement visible', ed.modal === 'flex', ed.modal);
  check('sélecteur de taux marocains dans l\'éditeur',
    !!ed.opts && ed.opts.includes('14') && ed.opts.includes('7') && ed.opts.includes('0'), ed.opts);
  check('taux par défaut sélectionné (20 %)', ed.rate === '20', ed.rate);
  check('montant en toutes lettres dans l\'éditeur',
    /Montant en toutes lettres/.test(ed.words) && /dirhams/.test(ed.words) && /درهم/.test(ed.words), ed.words);

  return win;
}

/* ---- PHASE 1c : interface bilingue FR ⇄ AR ---- */
async function phaseI18n(win) {
  console.log('--- PHASE 1c : LANGUE FR / AR ---');

  /* --- méta-vérification (Node) : toutes les clés citées dans les sources existent --- */
  const i18n = require(path.join(__dirname, '..', 'src', 'renderer', 'i18n.js'));
  const R = path.join(__dirname, '..', 'src', 'renderer');
  const keysUsed = new Set();
  for (const f of ['index.html', 'print-invoice.html']) {
    const html = fs.readFileSync(path.join(R, f), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-ph|-html|-title|-aria)?="([^"]+)"/g)) keysUsed.add(m[1]);
  }
  for (const f of ['app.js', 'csv.js', 'print-invoice.js']) {
    const src = fs.readFileSync(path.join(R, f), 'utf8');
    for (const m of src.matchAll(/\btr\(([^)\n]*)/g)) {
      for (const q of m[1].matchAll(/'([^']+)'/g)) if (q[1].includes('.')) keysUsed.add(q[1]);
    }
  }
  const used = [...keysUsed];
  const missing = used.filter((k) => !i18n.DICT.fr[k] || !i18n.DICT.ar[k]);
  const parity = Object.keys(i18n.DICT.fr).filter((k) => !(k in i18n.DICT.ar))
    .concat(Object.keys(i18n.DICT.ar).filter((k) => !(k in i18n.DICT.fr)));
  check('i18n : toutes les clés citées existent en FR et AR',
    used.length > 120 && missing.length === 0, { utilisees: used.length, absentes: missing });
  check('i18n : dictionnaires FR et AR en parité', parity.length === 0, parity);
  check('i18n : clé inconnue retournée telle quelle',
    i18n.tr('cle.inexistante') === 'cle.inexistante', i18n.tr('cle.inexistante'));
  check('i18n : langue par défaut (contexte Node) = fr', i18n.getLang() === 'fr', i18n.getLang());

  /* --- état initial : français, LTR, sélecteur présent --- */
  const fr0 = await ev(win, `(function () {
    const d = (sel) => { const el = document.querySelector(sel); return el ? (el.innerText || el.textContent || '') : ''; };
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      nav: d('.nav-item[data-view="dashboard"]'),
      btn: d('#btn-save-settings'),
      th: d('#draft-table thead'),
      ph: (document.querySelector('#tx-search') || {}).placeholder || '',
      hasSwitch: !!document.querySelector('.lang-switch .lang-btn[data-lang="ar"]')
    };
  })()`);
  check('langue par défaut : français, LTR', fr0.lang === 'fr' && fr0.dir === 'ltr', fr0);
  check('libellés statiques en français', /Tableau de bord/.test(fr0.nav) && /Enregistrer les paramètres/.test(fr0.btn), fr0);
  /* innerText applique text-transform: uppercase → test insensible à la casse */
  check('libellés dynamiques en français (en-tête de tableau)', /total ttc/i.test(fr0.th), fr0.th);
  check('placeholder traduit (FR)', /Rechercher un libellé/.test(fr0.ph), fr0.ph);
  check('sélecteur de langue dans la barre latérale', fr0.hasSwitch);

  /* --- bascule en arabe --- */
  await ev(win, `document.querySelector('.lang-btn[data-lang="ar"]').click(); true`);
  await wait(450);
  const ar = await ev(win, `(function () {
    const d = (sel) => { const el = document.querySelector(sel); return el ? (el.innerText || el.textContent || '') : ''; };
    const out = {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      nav: d('.nav-item[data-view="dashboard"]'),
      btn: d('#btn-save-settings'),
      th: d('#draft-table thead'),
      ph: (document.querySelector('#tx-search') || {}).placeholder || '',
      stored: state.settings.language
    };
    const sb = document.querySelector('.sidebar').getBoundingClientRect();
    out.sidebarRight = sb.x > window.innerWidth / 2;
    document.querySelector('#btn-new-rule').click();
    out.modalTitle = d('#modal-box h2');
    document.querySelector('#rl-cancel').click();
    document.querySelector('#btn-new-client').click();
    document.querySelector('#cl-save').click();
    out.toast = d('#toast');
    out.toastVisible = getComputedStyle(document.querySelector('#toast')).display !== 'none';
    document.querySelector('#cl-cancel').click();
    return out;
  })()`);
  check('bascule AR : <html lang ar dir rtl>', ar.lang === 'ar' && ar.dir === 'rtl', ar);
  check('bascule AR : barre latérale à droite', ar.sidebarRight, ar.sidebarRight);
  check('bascule AR : menu', /لوحة القيادة/.test(ar.nav), ar.nav);
  check('bascule AR : bouton statique', /حفظ الإعدادات/.test(ar.btn), ar.btn);
  check('bascule AR : en-tête de tableau (rendu dynamique)', /المجموع الإجمالي/.test(ar.th), ar.th);
  check('bascule AR : placeholder', /البحث في البيان/.test(ar.ph), ar.ph);
  check('bascule AR : modale construite à la volée', /قاعدة تلقائية جديدة/.test(ar.modalTitle), ar.modalTitle);
  check('bascule AR : message d\'erreur (toast)', ar.toastVisible && /الاسم إجباري/.test(ar.toast), ar.toast);
  check('langue mémorisée dans l\'état', ar.stored === 'ar', ar.stored);

  const persisted = await ev(win, `window.factapi.storeGet().then((d) => d.settings.language)`);
  check('langue enregistrée dans le stockage', persisted === 'ar', persisted);

  /* --- retour au français --- */
  await ev(win, `document.querySelector('.lang-btn[data-lang="fr"]').click(); true`);
  await wait(450);
  const fr2 = await ev(win, `(function () {
    const nav = document.querySelector('.nav-item[data-view="dashboard"]');
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      nav: nav ? (nav.innerText || nav.textContent || '') : '',
      stored: state.settings.language
    };
  })()`);
  check('retour FR : français, LTR',
    fr2.lang === 'fr' && fr2.dir === 'ltr' && /Tableau de bord/.test(fr2.nav), fr2);
  check('retour FR : mémorisé', fr2.stored === 'fr', fr2.stored);
  const persistedFr = await ev(win, `window.factapi.storeGet().then((d) => d.settings.language)`);
  check('retour FR : enregistré', persistedFr === 'fr', persistedFr);
}

/* ---- PHASE 1b : facture bilingue FR / AR ---- */
async function phasePrint(win) {
  console.log('--- PHASE 1b : FACTURE BILINGUE ---');

  const id = await ev(win, `state.invoices[0] && state.invoices[0].id`);
  if (!id) { check('facture disponible pour l\'aperçu', false, id); return; }

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-invoice.html'), { query: { id } });
  await wait(800);

  const tb = await ev(win, `(function () {
    return {
      dir: document.documentElement.dir,
      btns: Array.from(document.querySelectorAll('.toolbar button')).map((b) => b.textContent).join(' | ')
    };
  })()`);
  check('aperçu : barre d\'outils en français', /Fermer/.test(tb.btns) && /Imprimer/.test(tb.btns), tb);
  check('aperçu : document bilingue maintenu en LTR', tb.dir === 'ltr', tb.dir);

  const txt = await ev(win, `document.getElementById('root').innerText || ''`);
  const flat = txt.replace(/\s+/g, ' ');

  check('aperçu : contenu rendu', flat.length > 200, flat.slice(0, 120));
  check('aperçu : titre bilingue FACTURE / فاتورة', /FACTURE/.test(flat) && /فاتورة/.test(flat));
  check('aperçu : montants en MAD (aucun euro)', /MAD/.test(flat) && !/€/.test(flat));
  check('aperçu : ICE affiché', /ICE\s*:\s*002548793000054/.test(flat), flat.slice(0, 200));
  check('aperçu : IF / RC / Patente / CNSS',
    /IF\s*:\s*45879300/.test(flat) && /RC\s*:\s*123456/.test(flat) &&
    /Patente\s*:\s*45879300/.test(flat) && /CNSS\s*:\s*123456789/.test(flat));
  check('aperçu : nom de société en arabe', /شركة تجريبية/.test(flat));
  check('aperçu : montant en toutes lettres FR',
    /Arrêtée la présente facture à la somme de/.test(flat) && /dirhams/.test(flat));
  check('aperçu : montant en toutes lettres AR',
    /أوقفت هذه الفاتورة على مبلغ/.test(flat) && /درهم/.test(flat));
  check('aperçu : régime de TVA bilingue',
    /Réel normal/.test(flat) && /النظام الحقيقي العادي/.test(flat));
  check('aperçu : RIB / CCP mentionné', /RIB\s*:\s*0007 7880/.test(flat));
  check('aperçu : pas de mentions françaises obsolètes', !/SIRET/.test(flat) && !/40 €/.test(flat));
  check('aperçu : colonnes bilingues', /البيان/.test(flat) && /désignation/i.test(flat), flat.slice(0, 400));

  const grand = await ev(win, `(function () {
    const el = document.querySelector('.row.grand');
    return el ? el.innerText.replace(/\\s+/g, ' ') : '';
  })()`);
  check('aperçu : Total TTC en MAD', /MAD/.test(grand) && /Total TTC/.test(grand), grand);
}

async function printToFile(win, html, htmlPath, out) {
  fs.writeFileSync(htmlPath, html, 'utf8');
  win.webContents.once('did-fail-load', (e, code, desc) => problems.push('did-fail-load fixture: ' + code + ' ' + desc));
  await win.loadFile(htmlPath);
  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  fs.writeFileSync(out, pdf);
}

/* ---------------- PHASE 1d : facture manuelle, paiements, sauvegarde ---------------- */

async function phaseExtras(win) {
  console.log('--- PHASE 1d : FACTURE MANUELLE + PAIEMENTS + SAUVEGARDE ---');

  const backup = require(path.join(__dirname, '..', 'src', 'main', 'backup.js'));
  const tmpDir = path.join(__dirname, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const backupFile = path.join(tmpDir, 'sauvegarde-test.json');

  /* la phase précédente affichait l'aperçu d'impression : on revient à l'application */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* --- A. accès à la saisie d'une nouvelle facture --- */
  const entry = await ev(win, `(function () {
    return {
      views: document.querySelectorAll('.view').length,
      navs: document.querySelectorAll('.nav-item').length,
      dashBtn: !!document.querySelector('#btn-new-invoice-dash'),
      invBtn: !!document.querySelector('#btn-new-invoice-inv'),
      payView: !!document.querySelector('#view-payments'),
      payFilters: !!document.querySelector('#pay-search') && !!document.querySelector('#pay-filter'),
      dbPath: (document.querySelector('#set-db-path') || {}).value || ''
    };
  })()`);
  check('11 vues et 11 entrées de menu (nouvelles vues Avoirs et Paiements)',
    entry.views === 11 && entry.navs === 11, entry);
  check('accès « Nouvelle facture » (tableau de bord + factures validées)',
    entry.dashBtn && entry.invBtn, entry);
  check('vue Paiements : recherche et filtre présents', entry.payFilters, entry);
  check('emplacement de la base affiché dans les paramètres', entry.dbPath === DATA_DIR, entry.dbPath);

  /* --- B. saisie d'une facture sans import, puis validation --- */
  await ev(win, `(function () {
    document.querySelector('#btn-new-invoice-dash').click();
    const sel = document.querySelector('#ie-client');
    sel.value = state.clients[0].id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const desc = document.querySelector('#ie-lines input[data-f="desc"]');
    desc.value = 'Prestation de conseil — octobre 2026';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    const price = document.querySelector('#ie-lines input[data-f="price"]');
    price.value = '1000';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ie-validate').click();
    return true;
  })()`);
  await wait(450);

  const inv1 = await ev(win, `(function () {
    const val = state.invoices.filter(function (i) { return i.status === 'validated'; });
    return {
      n: state.invoices.length,
      nValid: val.length,
      number: val[0] ? val[0].number : '',
      ttc: val[0] ? totals(val[0]).ttc : -1,
      client: val[0] ? val[0].clientId : '',
      modalHidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('facture manuelle saisie et validée (TTC 1 200,00)',
    inv1.n === 2 && inv1.nValid === 1 && inv1.ttc === 1200 && inv1.client === 'c1', inv1);
  check('numéro définitif attribué (FA-AAAA-NNNN)', /^FA-\d{4}-\d{4}$/.test(inv1.number), inv1.number);
  check('modale fermée après validation', inv1.modalHidden, inv1);

  /* --- C. vue de suivi des paiements --- */
  const payView = await ev(win, `(function () {
    showView('payments');
    return {
      rows: document.querySelectorAll('#pay-table tbody tr').length,
      pills: document.querySelectorAll('#pay-table .pill').length,
      billed: document.querySelector('#pay-stat-billed').textContent,
      received: document.querySelector('#pay-stat-received').textContent,
      due: document.querySelector('#pay-stat-due').textContent,
      rowText: document.querySelector('#pay-table tbody').textContent
    };
  })()`);
  check('suivi : facturé = 1 200,00 MAD', /^1[\s\u202f\u00a0]200,00 MAD$/.test(payView.billed), payView.billed);
  check('suivi : reste à encaisser = 1 200,00 MAD', /^1[\s\u202f\u00a0]200,00 MAD$/.test(payView.due), payView.due);
  check('suivi : encaissé = 0,00 MAD', payView.received === '0,00 MAD', payView.received);
  check('suivi : facture listée en impayée', payView.rows === 1 && payView.pills >= 1 &&
    /Impayée/.test(payView.rowText), payView);

  /* --- D. paiement partiel --- */
  const open1 = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    openPaymentModal(inv.id);
    return {
      visible: !document.querySelector('#modal-root').hidden,
      amount: (document.querySelector('#pay-amount') || {}).value || '',
      rest: restDue(inv),
      title: (document.querySelector('#modal-box h2') || {}).textContent || ''
    };
  })()`);
  check('modale de paiement : reste dû pré-rempli (1200.00)',
    open1.visible && open1.rest === 1200 && open1.amount === '1200.00' &&
    /Enregistrer un paiement/.test(open1.title), open1);

  await ev(win, `(function () {
    document.querySelector('#pay-amount').value = '500';
    document.querySelector('#pay-method').value = 'transfer';
    document.querySelector('#pay-ref').value = 'VIR 7890';
    document.querySelector('#pay-save').click();
    return true;
  })()`);
  await wait(400);

  const part = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return {
      paid: paidAmount(inv),
      rest: restDue(inv),
      status: payStatus(inv),
      flag: inv.paid === true,
      tablePartial: document.querySelector('#pay-table').textContent.indexOf('Partielle') >= 0,
      dueStat: document.querySelector('#pay-stat-due').textContent,
      receivedStat: document.querySelector('#pay-stat-received').textContent,
      toast: document.querySelector('#toast').textContent,
      modalHidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('paiement partiel encaissé (500,00 / reste 700,00)',
    part.paid === 500 && part.rest === 700 && part.status === 'partial' && !part.flag, part);
  check('statut « Partielle » affiché dans le tableau', part.tablePartial, part);
  check('statistiques : encaissé 500,00 / reste 700,00',
    part.receivedStat === '500,00 MAD' && part.dueStat === '700,00 MAD', part);
  check('confirmation du paiement (toast)', /500,00/.test(part.toast), part.toast);
  check('modale fermée après enregistrement', part.modalHidden, part);

  const persisted1 = await ev(win, `window.factapi.storeGet().then(function (d) {
    const inv = d.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    const p = (inv.payments || [])[0];
    return { n: (inv.payments || []).length, amount: p && p.amount, method: p && p.method, ref: p && p.reference };
  })`);
  check('paiement persisté dans la base (virement, référence)',
    persisted1.n === 1 && persisted1.amount === 500 &&
    persisted1.method === 'transfer' && persisted1.ref === 'VIR 7890', persisted1);

  /* --- E. montant refusé puis solde complet --- */
  const over = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    openPaymentModal(inv.id);
    document.querySelector('#pay-amount').value = '99999';
    document.querySelector('#pay-save').click();
    return {
      n: inv.payments.length,
      toast: document.querySelector('#toast').textContent,
      modalHidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('montant supérieur au reste dû refusé',
    over.n === 1 && /dépasse/.test(over.toast) && !over.modalHidden, over);

  await ev(win, `(function () {
    document.querySelector('#pay-settle').click();
    const v = document.querySelector('#pay-amount').value;
    document.querySelector('#pay-save').click();
    return v;
  })()`);
  await wait(400);

  const full = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return {
      paid: paidAmount(inv),
      rest: restDue(inv),
      status: payStatus(inv),
      flag: inv.paid === true,
      dueStat: document.querySelector('#pay-stat-due').textContent,
      tablePaid: document.querySelector('#pay-table').textContent.indexOf('Payée') >= 0
    };
  })()`);
  check('facture soldée en deux fois (1 200,00 encaissé)',
    full.paid === 1200 && full.rest === 0 && full.status === 'paid' && full.flag, full);
  check('soldée : reste à encaisser nul', full.dueStat === '0,00 MAD', full.dueStat);
  check('statut « Payée » affiché dans le tableau', full.tablePaid, full);

  /* --- F. suppression d'un paiement (confirmation intégrée) --- */
  const del1 = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    deletePayment(inv.id, inv.payments[0].id);
    return {
      title: (document.querySelector('#modal-box h2') || {}).textContent || '',
      visible: !document.querySelector('#modal-root').hidden
    };
  })()`);
  check('confirmation intégrée avant suppression d’un paiement',
    del1.visible && /Confirmation/.test(del1.title), del1);

  const del2 = await ev(win, `(function () {
    document.querySelector('#cf-cancel').click();
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return { n: inv.payments.length, modalHidden: document.querySelector('#modal-root').hidden };
  })()`);
  check('annulation de la confirmation : rien supprimé',
    del2.n === 2 && del2.modalHidden, del2);

  await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    deletePayment(inv.id, inv.payments[0].id);
    document.querySelector('#cf-ok').click();
    return true;
  })()`);
  await wait(450);

  const del3 = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return {
      n: inv.payments.length,
      paid: paidAmount(inv),
      rest: restDue(inv),
      status: payStatus(inv),
      toast: document.querySelector('#toast').textContent,
      modalTitle: (document.querySelector('#modal-box h2') || {}).textContent || ''
    };
  })()`);
  check('paiement supprimé après confirmation (reste 500,00)',
    del3.n === 1 && del3.paid === 700 && del3.rest === 500 && del3.status === 'partial', del3);
  check('toast « règlement supprimé »', /supprimé/i.test(del3.toast), del3.toast);
  check('modale rouverte sur la facture concernée',
    /Enregistrer un paiement/.test(del3.modalTitle), del3.modalTitle);
  await ev(win, `closeModal(); true`);

  /* --- F-bis. modification d'un paiement existant --- */
  const editOpen = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    openPaymentModal(inv.id);
    const btn = document.querySelector('#pay-history [data-action="pay-edit"]');
    const hasDelete = !!document.querySelector('#pay-history [data-action="pay-delete"]');
    if (btn) btn.click();
    return {
      hasEdit: !!btn,
      hasDelete: hasDelete,
      payId: btn ? btn.getAttribute('data-pay') : '',
      invPayId: inv.payments[0].id,
      title: (document.querySelector('#modal-box h2') || {}).textContent || '',
      amount: (document.querySelector('#pay-amount') || {}).value || ''
    };
  })()`);
  check('paiement : bouton « modifier » dans l’historique',
    editOpen.hasEdit && editOpen.hasDelete && editOpen.payId === editOpen.invPayId, editOpen);
  check('paiement : formulaire de modification pré-rempli',
    /Modifier le paiement/.test(editOpen.title) && editOpen.amount === '700.00', editOpen);

  const editOver = await ev(win, `(function () {
    document.querySelector('#pay-amount').value = '99999';
    document.querySelector('#pay-save').click();
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return {
      amount: inv.payments[0].amount,
      toast: document.querySelector('#toast').textContent,
      hidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('paiement : modification refusée au-delà du maximum encaissable',
    editOver.amount === 700 && /dépasse/.test(editOver.toast) && !editOver.hidden, editOver);

  await ev(win, `(function () {
    document.querySelector('#pay-amount').value = '300';
    document.querySelector('#pay-method').value = 'cash';
    document.querySelector('#pay-save').click();
    return true;
  })()`);
  await wait(400);

  const edited = await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return {
      n: inv.payments.length,
      amount: inv.payments[0].amount,
      method: inv.payments[0].method,
      paid: paidAmount(inv),
      rest: restDue(inv),
      status: payStatus(inv),
      toast: document.querySelector('#toast').textContent,
      modalTitle: (document.querySelector('#modal-box h2') || {}).textContent || ''
    };
  })()`);
  check('paiement modifié (300,00 / reste 900,00), sans doublon',
    edited.n === 1 && edited.amount === 300 && edited.method === 'cash' &&
    edited.paid === 300 && edited.rest === 900 && edited.status === 'partial', edited);
  check('toast « paiement modifié »', /modifié/i.test(edited.toast), edited.toast);
  check('retour à la fiche de paiement après modification',
    /Enregistrer un paiement/.test(edited.modalTitle), edited.modalTitle);
  await ev(win, `closeModal(); true`);

  const persistedEdit = await ev(win, `window.factapi.storeGet().then(function (d) {
    const inv = d.invoices.filter(function (i) { return i.status === 'validated'; })[0];
    return { n: (inv.payments || []).length, amount: (inv.payments || [])[0] && inv.payments[0].amount };
  })`);
  check('modification persistée dans la base', persistedEdit.n === 1 && persistedEdit.amount === 300, persistedEdit);

  /* --- G. sauvegarde / restauration par choix d'emplacement --- */
  const snap = await ev(win, `window.factapi.storeGet()`);
  const written = backup.createBackup(snap, backupFile);
  check('sauvegarde écrite à l’emplacement choisi',
    fs.existsSync(backupFile) && written.bytes > 200, written);

  const onDisk = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  check('sauvegarde complète (7 collections : devis inclus)',
    ['settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta']
      .every((c) => backup.COLLECTIONS.indexOf(c) >= 0 &&
        Object.prototype.hasOwnProperty.call(onDisk.data, c)),
    Object.keys(onDisk.data));

  const parsed = backup.parseBackup(backupFile);
  check('relecture : contenu identique à la base',
    !parsed.error && parsed.data.invoices.length === snap.invoices.length &&
    parsed.data.settings.company.name === snap.settings.company.name &&
    parsed.data.invoices[0].clientId === snap.invoices[0].clientId,
    parsed.error || { n: parsed.data.invoices.length });

  const broken = path.join(tmpDir, 'sauvegarde-corrompue.json');
  fs.writeFileSync(broken, '{ pas du json', 'utf8');
  const badJson = backup.parseBackup(broken);
  check('sauvegarde corrompue détectée', badJson.error === 'json' || badJson.error === 'unreadable', badJson);

  const foreign = path.join(tmpDir, 'sauvegarde-autre.json');
  fs.writeFileSync(foreign, JSON.stringify({ hello: 'world' }), 'utf8');
  const badFmt = backup.parseBackup(foreign);
  check('structure inconnue détectée', badFmt.error === 'format', badFmt);

  const applied = await ev(win, `(async function () {
    const s = await window.factapi.storeGet();
    applyBackupData({ settings: s.settings, clients: s.clients, invoices: [], transactions: [], rules: [], quotes: [], meta: { invoiceSeq: 0, quoteSeq: 0 } });
    await persist('settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta');
    const emptied = (await window.factapi.storeGet()).invoices.length;
    applyBackupData(s);
    await persist('settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta');
    const back = await window.factapi.storeGet();
    return { emptied: emptied, n: back.invoices.length, lang: document.documentElement.lang, dir: document.documentElement.dir };
  })()`);
  check('restauration appliquée dans l’interface (base remplacée puis restaurée)',
    applied.emptied === 0 && applied.n === snap.invoices.length, applied);
  check('langue de la sauvegarde réappliquée (FR / LTR)',
    applied.lang === 'fr' && applied.dir === 'ltr', applied);

  const arRestore = await ev(win, `(async function () {
    const s = await window.factapi.storeGet();
    const payload = JSON.parse(JSON.stringify(s));
    payload.settings.language = 'ar';
    applyBackupData(payload);
    const out = {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      nav: document.querySelector('.nav-item[data-view="payments"]').innerText
    };
    applyBackupData(s);
    return out;
  })()`);
  check('restauration : langue arabe de la sauvegarde appliquée (RTL)',
    arRestore.lang === 'ar' && arRestore.dir === 'rtl' && /المدفوعات/.test(arRestore.nav), arRestore);
  check('retour au français', await ev(win, `document.documentElement.lang`) === 'fr');

  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  check('IPC sauvegarde/restauration déclarés (main + preload)',
    /backup:export/.test(mainSrc) && /backup:import/.test(mainSrc) && /backup:data-path/.test(mainSrc) &&
    /backupExport/.test(preloadSrc) && /backupImport/.test(preloadSrc) && /backupDataPath/.test(preloadSrc));
  check('IPC P0 journal + sauvegarde auto déclarés (main + preload)',
    /log:write/.test(mainSrc) && /backup:auto-status/.test(mainSrc) && /backup:auto-restore/.test(mainSrc) &&
    /autoBackupStatus/.test(preloadSrc) && /autoBackupRestore/.test(preloadSrc) && /log:/.test(preloadSrc));

  const final = await ev(win, `(function () {
    const val = state.invoices.filter(function (i) { return i.status === 'validated'; });
    return {
      views: document.querySelectorAll('.view').length,
      modalHidden: document.querySelector('#modal-root').hidden,
      dbPath: document.querySelector('#set-db-path').value,
      payments: val[0] ? (val[0].payments || []).length : -1
    };
  })()`);
  check('état final propre (11 vues, modale fermée, base affichée, 1 règlement)',
    final.views === 11 && final.modalHidden && final.dbPath === DATA_DIR && final.payments === 1, final);
}

async function phasePdf(uiWin) {
  console.log('--- PHASE 2 : PDF ---');

  const fixtureA = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial;font-size:11px;margin:14mm;color:#000}
    h3{margin:0 0 6px} p{margin:2px 0}
    table{border-collapse:collapse;width:100%;margin-top:14px}
    th,td{padding:4px 6px}
    th{border-bottom:1px solid #000;text-align:right}
    th:first-child,th:nth-child(2){text-align:left}
    td.r{text-align:right}
  </style></head><body>
  <h3>Relevé de compte n° 12345678901</h3>
  <p>Période du 01/10/2026 au 31/10/2026</p>
  <p>Solde au 30/09/2026 : 10&nbsp;000,00</p>
  <table>
    <thead><tr><th>Date</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Solde</th></tr></thead>
    <tbody>
      <tr><td>01/10/2026</td><td>VIREMENT DU CLIENT DUPONT SARL</td><td class="r"></td><td class="r">2&nbsp;400,00</td><td class="r">12&nbsp;400,00</td></tr>
      <tr><td>02/10/2026</td><td>CB LECLERC MARKET</td><td class="r">87,45</td><td class="r"></td><td class="r">12&nbsp;312,55</td></tr>
      <tr><td>05/10/2026</td><td>VIREMENT MARTIN CONSULTING</td><td class="r"></td><td class="r">1&nbsp;500,00</td><td class="r">13&nbsp;812,55</td></tr>
      <tr><td>06/10/2026</td><td>SIG VIR SUISSE</td><td class="r">3&nbsp;200,00</td><td class="r"></td><td class="r">10&nbsp;612,55</td></tr>
    </tbody>
  </table>
  </body></html>`;

  const fixtureB = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial;font-size:11px;margin:16mm}
    div{margin:0 0 8px}
  </style></head><body>
  <div>Relevé simplifié — Octobre 2026</div>
  <div>01/10/2026&nbsp;&nbsp;&nbsp;VIREMENT DU CLIENT MARTIN&nbsp;&nbsp;&nbsp;1&nbsp;500,00</div>
  <div>02/10/2026&nbsp;&nbsp;&nbsp;CB LECLERC MARKET&nbsp;&nbsp;&nbsp;-87,45</div>
  <div>03/10/2026&nbsp;&nbsp;&nbsp;SIG VIR SUISSE&nbsp;&nbsp;&nbsp;-3&nbsp;200,00</div>
  </body></html>`;

  // Relevé Attijariwafa : code opération, dates « JJ MM » en espaces, date de
  // valeur, montants sans signe ni colonnes Débit/Crédit.
  const fixtureC = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial;font-size:11px;margin:16mm}
    div{margin:0 0 8px}
  </style></head><body>
  <div>Relevé de compte ATTIJARIWAFA — Septembre 2026</div>
  <div>0016BK 01 09 VIR.WEB RECU DE CLIENT ATLAS 02 09 2026 1&nbsp;400,00</div>
  <div>0016MI 02 09 PAIEMENT CB 01/09/26 MARJANE MARKET 03 09 2026 362,53</div>
  <div>0016ME 03 09 ASSURANCE SECURICARTE 31 08 2026 3,04</div>
  <div>0016PV 04 09 PRELEVEMENT EN FAV. CNSS 04 09 2026 963,63</div>
  <div>SOLDE FINAL AU 30 09 2026 7&nbsp;014,86 CREDITEUR</div>
  </body></html>`;

  const dir = path.join(__dirname, '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  const fileA = path.join(dir, 'releve-colonnes.pdf');
  const fileB = path.join(dir, 'releve-simplifie.pdf');
  const fileC = path.join(dir, 'releve-attijariwafa.pdf');

  const w = uiWin; // réutilise la fenêtre de la phase 1 (évite une création après destroy)
  await printToFile(w, fixtureA, path.join(dir, 'fixture-a.html'), fileA);
  await printToFile(w, fixtureB, path.join(dir, 'fixture-b.html'), fileB);
  await printToFile(w, fixtureC, path.join(dir, 'fixture-c.html'), fileC);

  const { extractEntries } = require(path.join(__dirname, '..', 'src', 'main', 'pdf-statement'));

  /* A : relevé avec colonnes Débit / Crédit / Solde */
  const a = await extractEntries(fileA);
  const ea = a.entries;
  check('PDF A : 4 transactions', ea.length === 4, ea);
  if (ea.length === 4) {
    check('PDF A : dates', ea[0].date === '2026-10-01' && ea[1].date === '2026-10-02' &&
      ea[2].date === '2026-10-05' && ea[3].date === '2026-10-06', ea);
    check('PDF A : crédit +2400,00', Math.abs(ea[0].amount - 2400) < 0.01, ea[0]);
    check('PDF A : débit -87,45', Math.abs(ea[1].amount + 87.45) < 0.01, ea[1]);
    check('PDF A : crédit +1500,00', Math.abs(ea[2].amount - 1500) < 0.01, ea[2]);
    check('PDF A : débit -3200,00', Math.abs(ea[3].amount + 3200) < 0.01, ea[3]);
    check('PDF A : libellés intacts', /DUPONT SARL/.test(ea[0].label) && /CB LECLERC MARKET/.test(ea[1].label), [ea[0].label, ea[1].label]);
    check('PDF A : pas d\'alerte de colonnes', a.warnings.length === 0, a.warnings);
  }

  /* B : relevé simplifié sans en-tête de colonnes */
  const b = await extractEntries(fileB);
  const eb = b.entries;
  check('PDF B : 3 transactions', eb.length === 3, eb);
  if (eb.length === 3) {
    check('PDF B : montants et signes', Math.abs(eb[0].amount - 1500) < 0.01 &&
      Math.abs(eb[1].amount + 87.45) < 0.01 && Math.abs(eb[2].amount + 3200) < 0.01, eb);
    check('PDF B : dates', eb[0].date === '2026-10-01' && eb[2].date === '2026-10-03', eb);
    check('PDF B : alerte colonnes affichée', b.warnings.length >= 1, b.warnings);
  }

  /* C : relevé sans colonnes, dates en espaces, code opération, date de valeur */
  const c = await extractEntries(fileC);
  const ec = c.entries;
  check('PDF C : 4 transactions', ec.length === 4, ec);
  if (ec.length === 4) {
    check('PDF C : dates (année absente sur la ligne)', ec[0].date === '2026-09-01' &&
      ec[1].date === '2026-09-02' && ec[2].date === '2026-09-03' && ec[3].date === '2026-09-04', ec);
    check('PDF C : crédit +1400,00', Math.abs(ec[0].amount - 1400) < 0.01, ec[0]);
    check('PDF C : débits déduits du libellé', Math.abs(ec[1].amount + 362.53) < 0.01 &&
      Math.abs(ec[2].amount + 3.04) < 0.01 && Math.abs(ec[3].amount + 963.63) < 0.01, ec);
    check('PDF C : date de valeur retirée du libellé',
      ec[0].label === 'VIR.WEB RECU DE CLIENT ATLAS' &&
      ec[1].label === 'PAIEMENT CB 01/09/26 MARJANE MARKET', [ec[0].label, ec[1].label]);
    check('PDF C : pas de montant parasite (date lue comme nombre)',
      ec.every((x) => Math.abs(x.amount) < 5000), ec);
    check('PDF C : alerte colonnes affichée', c.warnings.length >= 1, c.warnings);
  }
}

/* ---- PHASE 2b : import PDF → UNE SEULE facture à plusieurs lignes ---- */
async function phaseImportGroup(uiWin) {
  console.log('--- PHASE 2b : IMPORT PDF → 1 FACTURE À PLUSIEURS LIGNES ---');

  const { extractEntries } = require(path.join(__dirname, '..', 'src', 'main', 'pdf-statement'));
  const fileA = path.join(__dirname, '.tmp', 'releve-colonnes.pdf');

  /* on remplace le sélecteur de fichier natif par le relevé de la phase 2 */
  ipcMain.handle('file:pick-statement', async () => {
    const out = await extractEntries(fileA);
    return {
      path: fileA,
      name: 'releve-colonnes.pdf',
      kind: 'pdf',
      entries: out.entries,
      skipped: out.skipped,
      warnings: out.warnings || []
    };
  });

  const win = uiWin;
  /* la phase précédente affichait les fixtures PDF : on revient à l'application */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  await ev(win, `state.transactions = []; state.invoices = [];
    state.settings.importClientId = ''; state.settings.importMode = null;
    state.settings.importTva = null;
    renderAll(); showView('import'); true;`);

  await ev(win, `document.querySelector('#btn-pick-csv').click(); true`);
  await wait(500);

  const prev = await ev(win, `({
    visible: !document.querySelector('#import-preview').hidden,
    client: document.querySelector('#import-client').value,
    options: document.querySelector('#import-client').options.length,
    groupChecked: document.querySelector('input[name="import-mode"][value="group"]').checked,
    groupDisabled: document.querySelector('input[name="import-mode"][value="group"]').disabled,
    hintHidden: document.querySelector('#import-mode-hint').hidden,
    autogen: document.querySelector('#opt-autogen').checked,
    tva: document.querySelector('#import-tva').value,
    rows: document.querySelectorAll('#import-table tbody tr').length,
    summary: (document.querySelector('#import-summary') || {}).innerText || ''
  })`);
  check('2b : aperçu affiché, seuls les virements reçus listés (2 sur 4 lignes)',
    prev.visible && prev.rows === 2, prev);
  check('2b : débits annoncés comme écartés dans le récapitulatif',
    /Débits écartés/.test(prev.summary) && /2/.test(prev.summary), prev.summary);
  check('2b : client unique pré-sélectionné automatiquement', prev.client === 'c1', prev);
  check('2b : « une seule facture avec plusieurs lignes » coché et actif',
    prev.groupChecked && !prev.groupDisabled, prev);
  check('2b : rappel « règles automatiques » masqué quand un client est choisi', prev.hintHidden, prev);
  check('2b : taux de TVA et case « générer » renseignés', prev.tva === '20' && prev.autogen, prev);

  /* --- période d'import : seules les transactions de la période choisie --- */
  const per = await ev(win, `({
    from: document.querySelector('#import-from').value,
    to: document.querySelector('#import-to').value
  })`);
  check('2b : période par défaut = toutes les dates du relevé',
    per.from === '2026-10-01' && per.to === '2026-10-06', per);

  const narrow = await ev(win, `(function () {
    const to = document.querySelector('#import-to');
    to.value = '2026-10-04';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      rows: document.querySelectorAll('#import-table tbody tr').length,
      summary: (document.querySelector('#import-summary') || {}).innerText || ''
    };
  })()`);
  await wait(150);
  check('2b : période resserrée → 1 seul encaissement affiché',
    narrow.rows === 1, narrow);
  check('2b : récap indique les transactions hors période',
    /Transactions de la période/.test(narrow.summary) && /hors période/.test(narrow.summary),
    narrow.summary);

  await ev(win, `(function () {
    const to = document.querySelector('#import-to');
    to.value = '2026-10-06';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelectorAll('#import-table tbody tr').length;
  })()`);
  await wait(150);
  const perBack = await ev(win, `document.querySelectorAll('#import-table tbody tr').length`);
  check('2b : période rétablie → 2 encaissements de nouveau affichés', perBack === 2, perBack);

  /* passage en règles automatiques : le groupement n'a plus de sens */
  const rules = await ev(win, `(function () {
    const sel = document.querySelector('#import-client');
    sel.value = '__rules__';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      disabled: document.querySelector('input[name="import-mode"][value="group"]').disabled,
      hint: !document.querySelector('#import-mode-hint').hidden
    };
  })()`);
  check('2b : règles automatiques → radios désactivées + rappel affiché',
    rules.disabled && rules.hint, rules);

  await ev(win, `(function () {
    const sel = document.querySelector('#import-client');
    sel.value = 'c1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#btn-do-import').click();
    return true;
  })()`);
  await wait(700);

  const st = await ev(win, `({
    inv: state.invoices.length,
    lines: state.invoices[0] ? state.invoices[0].lines.length : 0,
    txnIds: state.invoices[0] ? (state.invoices[0].transactionIds || []).length : 0,
    client: state.invoices[0] ? state.invoices[0].clientId : null,
    status: state.invoices[0] ? state.invoices[0].status : null,
    tx: state.transactions.length,
    credits: state.transactions.filter(t => t.amount > 0).length,
    debits: state.transactions.filter(t => t.amount < 0).length,
    creditsLinked: state.transactions.filter(t => t.amount > 0 && t.linkedInvoiceId).length,
    debitsLinked: state.transactions.filter(t => t.amount < 0 && t.linkedInvoiceId).length,
    ttc: state.invoices[0] ? state.invoices[0].lines.reduce((s, l) => s + l.price * (1 + l.tva / 100), 0) : 0,
    view: (document.querySelector('.view.active') || {}).id,
    savedClient: state.settings.importClientId,
    toast: (document.querySelector('#toast') || {}).textContent || ''
  })`);
  check('2b : UNE SEULE facture créée pour tout le relevé', st.inv === 1, st);
  check('2b : facture à plusieurs lignes (une par encaissement)',
    st.lines === 2 && st.txnIds === 2, st);
  check('2b : facture rattachée au client choisi, à valider', st.client === 'c1' && st.status === 'draft', st);
  check('2b : seuls les virements reçus importés (2 crédits, 0 débit)',
    st.tx === 2 && st.credits === 2 && st.debits === 0, st);
  check('2b : virements reçus liés à la facture, aucun débit facturé',
    st.creditsLinked === 2 && st.debitsLinked === 0, st);
  check('2b : somme TTC des lignes = total des encaissements (3 900,00)',
    Math.abs(st.ttc - 3900) < 0.5, st.ttc);
  check('2b : toast « débits écartés » + « facture regroupée » + brouillons',
    /débit\(s\) écarté\(s\)/.test(st.toast) && /facture regroupée/.test(st.toast) &&
    st.view === 'view-drafts', st);
  check('2b : choix mémorisé pour le prochain import', st.savedClient === 'c1', st);

  /* --- suppression de TOUTE la liste « Factures à valider » --- */
  const del1 = await ev(win, `(function () {
    document.querySelector('#btn-delete-all-drafts').click();
    return {
      modal: !document.querySelector('#modal-root').hidden,
      title: (document.querySelector('#modal-box h2') || {}).textContent || '',
      n: state.invoices.filter(function (i) { return i.status === 'draft'; }).length
    };
  })()`);
  check('2b : confirmation avant suppression de toute la liste', del1.modal && del1.n === 1, del1);

  const del2 = await ev(win, `(function () {
    document.querySelector('#cf-cancel').click();
    return {
      n: state.invoices.length,
      hidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('2b : annulation → liste intacte', del2.n === 1 && del2.hidden, del2);

  await ev(win, `document.querySelector('#btn-delete-all-drafts').click(); true`);
  await wait(100);
  await ev(win, `document.querySelector('#cf-ok').click(); true`);
  await wait(500);

  const del3 = await ev(win, `({
    invoices: state.invoices.length,
    linked: state.transactions.filter(function (t) { return t.linkedInvoiceId; }).length,
    tx: state.transactions.length,
    badge: (document.querySelector('#drafts-count') || {}).textContent || '',
    toast: (document.querySelector('#toast') || {}).textContent || ''
  })`);
  check('2b : toute la liste supprimée, encaissements déliés (aucun montant perdu)',
    del3.invoices === 0 && del3.linked === 0 && del3.tx === 2, del3);
  check('2b : message de confirmation de la suppression', /supprimée/.test(del3.toast), del3.toast);

  /* --- réimport avec période resserrée : hors période écarté à l'import --- */
  await ev(win, `document.querySelector('#btn-pick-csv').click(); true`);
  await wait(600);
  const reimp = await ev(win, `(function () {
    const to = document.querySelector('#import-to');
    to.value = '2026-10-04';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#opt-autogen').checked = false;
    document.querySelector('#btn-do-import').click();
    return { rows: document.querySelectorAll('#import-table tbody tr').length };
  })()`);
  await wait(700);
  const reimp2 = await ev(win, `({
    tx: state.transactions.length,
    invoices: state.invoices.length,
    toast: (document.querySelector('#toast') || {}).textContent || ''
  })`);
  check('2b : aperçu limité à la période choisie (1 encaissement)', reimp.rows === 1, reimp);
  check('2b : import limité à la période (hors période écarté, rien de double)',
    /hors période/.test(reimp2.toast) && reimp2.tx === 2 && reimp2.invoices === 0, reimp2);
}

/* ---- PHASE 2c : non-régression — brouillon, bouton Régler, période, base ---- */
async function phaseRegressions(uiWin) {
  console.log('--- PHASE 2c : BROUILLON, RÉGLER, PÉRIODE, EMPLACEMENT DE LA BASE ---');
  const win = uiWin;
  /* la phase 2b a laissé l'application chargée : on repart d'un rendu neuf */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* --- a) facture manuelle enregistrée puis réouverte (bug : id manquant → vide) --- */
  await ev(win, `state.invoices = []; state.transactions = [];
    state.settings.importClientId = 'c1'; state.settings.importMode = 'group';
    renderAll(); showView('drafts'); true;`);
  await ev(win, `document.querySelector('#btn-new-invoice').click(); true`);
  await wait(300);
  await ev(win, `(function () {
    const sel = document.querySelector('#ie-client');
    sel.value = 'c1';
    const desc = document.querySelector('#ie-lines input[data-f="desc"]');
    desc.value = 'Prestation conseil';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    const price = document.querySelector('#ie-lines input[data-f="price"]');
    price.value = '1000';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ie-save').click();
    return true;
  })()`);
  await wait(600);

  const st1 = await ev(win, `({
    n: state.invoices.length,
    id: state.invoices[0] ? state.invoices[0].id : null,
    rows: document.querySelectorAll('#draft-table tbody tr').length
  })`);
  check('2c : brouillon enregistré avec un identifiant', st1.n === 1 && !!st1.id && st1.rows === 1, st1);

  await ev(win, `document.querySelector('#draft-table [data-action="edit-invoice"]').click(); true`);
  await wait(300);
  const re = await ev(win, `(function () {
    return {
      modal: !document.querySelector('#modal-root').hidden,
      client: (document.querySelector('#ie-client') || {}).value || '',
      desc: (document.querySelector('#ie-lines input[data-f="desc"]') || {}).value || '',
      price: (document.querySelector('#ie-lines input[data-f="price"]') || {}).value || ''
    };
  })()`);
  check('2c : brouillon réouvert avec ses informations (pas de facture vide)',
    re.modal && re.client === 'c1' && re.desc === 'Prestation conseil' && Number(re.price) === 1000, re);
  await ev(win, `document.querySelector('#ie-cancel').click(); true`);
  await wait(200);

  /* --- b) validation puis bouton « Régler » --- */
  await ev(win, `document.querySelector('#draft-table [data-action="validate-invoice"]').click(); true`);
  await wait(300);
  await ev(win, `document.querySelector('#cf-ok').click(); true`);
  await wait(500);
  const afterVal = await ev(win, `({
    status: state.invoices[0] ? state.invoices[0].status : null,
    number: state.invoices[0] ? state.invoices[0].number : null
  })`);
  check('2c : facture validée et numérotée', afterVal.status === 'validated' && !!afterVal.number, afterVal);

  await ev(win, `showView('invoices'); true`);
  await wait(200);
  const pay = await ev(win, `(function () {
    const btn = document.querySelector('[data-action="pay-invoice"]');
    if (!btn) return { found: false };
    btn.click();
    return {
      found: true,
      modal: !document.querySelector('#modal-root').hidden,
      amount: (document.querySelector('#pay-amount') || {}).value || ''
    };
  })()`);
  await wait(250);
  check('2c : bouton « Régler » ouvre la modale de règlement (montant pré-rempli)',
    pay.found && pay.modal && Number(pay.amount) > 0, pay);
  await ev(win, `const c = document.querySelector('#pay-cancel'); if (c) c.click(); true`);
  await wait(200);

  /* --- c) import DANS la période choisie uniquement --- */
  await ev(win, `state.invoices = []; state.transactions = [];
    renderAll(); showView('import'); true;`);
  await ev(win, `document.querySelector('#btn-pick-csv').click(); true`);
  await wait(700);

  const per = await ev(win, `({
    from: document.querySelector('#import-from').value,
    to: document.querySelector('#import-to').value
  })`);
  check('2c : période par défaut reprise des dates du fichier',
    per.from === '2026-10-01' && per.to === '2026-10-06', per);

  const imp = await ev(win, `(function () {
    const to = document.querySelector('#import-to');
    to.value = '2026-10-04';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    const sel = document.querySelector('#import-client');
    sel.value = 'c1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#opt-autogen').checked = true;
    document.querySelector('#btn-do-import').click();
    return document.querySelectorAll('#import-table tbody tr').length;
  })()`);
  await wait(900);

  const post = await ev(win, `({
    tx: state.transactions.length,
    dates: state.transactions.map(function (t) { return t.date; }),
    drafts: state.invoices.filter(function (i) { return i.status === 'draft'; }).length,
    lines: state.invoices[0] ? state.invoices[0].lines.length : 0,
    toast: (document.querySelector('#toast') || {}).textContent || ''
  })`);
  check('2c : aperçu limité à la période (1 encaissement sur 2)', imp === 1, imp);
  check('2c : import limité à la période (1 transaction, hors période écarté)',
    post.tx === 1 && post.dates[0] === '2026-10-01' && /hors période/.test(post.toast), post);
  check('2c : facture générée uniquement avec les transactions de la période',
    post.drafts === 1 && post.lines === 1, post);

  /* --- d) emplacement de la base de données --- */
  const db = await ev(win, `(function () {
    showView('settings');
    return {
      choose: !!document.querySelector('#btn-choose-db'),
      reset: !!document.querySelector('#btn-reset-db')
    };
  })()`);
  check('2c : boutons d’emplacement de la base présents', db.choose && db.reset, db);

  /* --- d2) sauvegarde automatique quotidienne (P0) --- */
  await wait(250);
  const autoDb = await ev(win, `(function () {
    return {
      status: (document.querySelector('#auto-backup-status') || {}).textContent || '',
      btn: !!document.querySelector('#btn-restore-auto'),
      btnEnabled: !(document.querySelector('#btn-restore-auto') || {}).disabled
    };
  })()`);
  check('2c : sauvegarde auto affichée (statut du jour + bouton actif)',
    autoDb.btn && autoDb.btnEnabled && /2026-10-08/.test(autoDb.status), autoDb);

  /* --- d3) mise à jour automatique (electron-updater) --- */
  await wait(200);
  const upd = await ev(win, `(function () {
    showView('settings');
    return {
      checkBtn: !!document.querySelector('#btn-check-update'),
      installBtn: !!document.querySelector('#btn-install-update'),
      installHidden: (document.querySelector('#btn-install-update') || {}).hidden,
      status: (document.querySelector('#update-status') || {}).textContent || ''
    };
  })()`);
  check('2c : mise à jour automatique affichée (bouton Vérifier + statut initial)',
    upd.checkBtn && upd.installBtn && upd.installHidden === true &&
    /démarrage|بدء/.test(upd.status), upd);

  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const preSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  check('2c : IPC emplacement de la base déclarés (main + preload)',
    /data:pick/.test(mainSrc) && /data:apply/.test(mainSrc) && /data:reset/.test(mainSrc) &&
    /data:restart/.test(mainSrc) && /dataPick/.test(preSrc) && /dataApply/.test(preSrc) &&
    /dataReset/.test(preSrc) && /dataRestart/.test(preSrc));
  check('2c : IPC mise à jour déclarés (main + preload)',
    /update:status/.test(mainSrc) && /update:check/.test(mainSrc) && /update:install/.test(mainSrc) &&
    /app\.isPackaged/.test(mainSrc) && /updateStatus/.test(preSrc) && /updateCheck/.test(preSrc) &&
    /updateInstall/.test(preSrc) && /onUpdateStatus/.test(preSrc));
  check('2c : chemin choisi mémorisé puis relu au démarrage (config.json)',
    /config\.json/.test(mainSrc) && /resolveDataDir\(\)/.test(mainSrc));
}

/* ---- PHASE 2d : sélection des transactions à l'import + désignations par client ---- */
async function phaseSelectionDesig(uiWin) {
  console.log('--- PHASE 2d : SÉLECTION À L\'IMPORT + DÉSIGNATIONS PAR CLIENT ---');
  const win = uiWin;
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* --- a) Paramètres : liste de désignations + défaut par client --- */
  await ev(win, `state.invoices = []; state.transactions = [];
    state.settings.designations = [];
    state.clients.forEach(function (c) { delete c.desig; });
    renderAll(); showView('settings'); true;`);
  await ev(win, `document.querySelector('#desig-new').value = 'Prestation de conseil';
    document.querySelector('#btn-add-desig').click(); true`);
  await wait(400);
  const d1 = await ev(win, `({
    list: (state.settings.designations || []).slice(),
    items: document.querySelectorAll('#desig-list .desig-item').length,
    selects: document.querySelectorAll('.desig-client').length,
    clients: state.clients.length
  })`);
  check('2d : désignation ajoutée dans Paramètres',
    d1.list.length === 1 && d1.list[0] === 'Prestation de conseil' && d1.items === 1, d1);
  check('2d : choix de la désignation proposé pour chaque client',
    d1.selects === d1.clients && d1.selects > 0, d1);

  await ev(win, `(function () {
    const sel = document.querySelector('.desig-client[data-id="c1"]');
    sel.value = 'Prestation de conseil';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await wait(400);
  const d2 = await ev(win, `({
    desig: desigForClient('c1'),
    stored: state.clients.filter(function (c) { return c.id === 'c1'; })[0].desig
  })`);
  check('2d : désignation par défaut rattachée au client',
    d2.desig === 'Prestation de conseil' && d2.stored === 'Prestation de conseil', d2);

  /* --- b) import : toutes les transactions sont présélectionnées --- */
  await ev(win, `state.invoices = []; state.transactions = [];
    renderAll(); showView('import'); true;`);
  await ev(win, `document.querySelector('#btn-pick-csv').click(); true`);
  await wait(700);

  const sel1 = await ev(win, `({
    boxes: document.querySelectorAll('.imp-chk').length,
    checked: document.querySelectorAll('.imp-chk:checked').length,
    all: !!(document.querySelector('#imp-all') && document.querySelector('#imp-all').checked),
    hintHidden: (document.querySelector('#imp-desig-hint') || {}).hidden,
    hintTxt: (document.querySelector('#imp-desig-hint') || {}).textContent || '',
    amount: pendingImport.credits[0].amount
  })`);
  check('2d : aperçu avec cases à cocher, toutes cochées par défaut',
    sel1.boxes === 2 && sel1.checked === 2 && sel1.all, sel1);
  check('2d : désignation par défaut du client annoncée dans l’aperçu',
    sel1.hintHidden === false && /Prestation de conseil/.test(sel1.hintTxt), sel1);

  const firstAmt = sel1.amount;

  /* --- c) une transaction désélectionnée n'est pas importée --- */
  const un = await ev(win, `(function () {
    const sel = document.querySelector('#import-client');
    sel.value = '__rules__';                       /* choix en cours de saisie */
    document.querySelectorAll('.imp-chk')[1].click();  /* on décoche la 2e */
    return {
      checked: document.querySelectorAll('.imp-chk:checked').length,
      all: document.querySelector('#imp-all').checked,
      client: document.querySelector('#import-client').value
    };
  })()`);
  await wait(300);
  check('2d : désélection d’une ligne, case à cocher globale décochée',
    un.checked === 1 && un.all === false, un);
  check('2d : re-rendu de l’aperçu sans perte des choix en cours (client conservé)',
    un.client === '__rules__', un);

  await ev(win, `document.querySelector('#import-client').value = 'c1';
    document.querySelector('#import-client').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#opt-autogen').checked = true;
    document.querySelector('input[name="import-mode"][value="group"]').checked = true;
    document.querySelector('#btn-do-import').click(); true`);
  await wait(900);

  const post = await ev(win, `({
    tx: state.transactions.length,
    amount: state.transactions[0] ? state.transactions[0].amount : null,
    drafts: state.invoices.filter(function (i) { return i.status === 'draft'; }).length,
    lines: state.invoices[0] ? state.invoices[0].lines.length : 0,
    desc: state.invoices[0] && state.invoices[0].lines[0] ? state.invoices[0].lines[0].desc : '',
    toast: (document.querySelector('#toast') || {}).textContent || ''
  })`);
  check('2d : seule la transaction sélectionnée est importée',
    post.tx === 1 && Math.abs(post.amount - firstAmt) < 0.005, post);
  check('2d : transaction désélectionnée signalée dans le message',
    /non sélectionnée/.test(post.toast), post.toast);
  check('2d : facture générée avec la désignation par défaut du client',
    post.drafts === 1 && post.lines === 1 && post.desc === 'Prestation de conseil', post);

  /* --- d) la désignation reste modifiable sur la facture --- */
  await ev(win, `showView('drafts'); true`);
  await wait(200);
  await ev(win, `document.querySelector('#draft-table [data-action="edit-invoice"]').click(); true`);
  await wait(300);
  const ed = await ev(win, `(function () {
    const d = document.querySelector('#ie-lines input[data-f="desc"]');
    if (!d) return { found: false };
    return { found: true, value: d.value, editable: !d.disabled && !d.readOnly };
  })()`);
  check('2d : désignation présente dans l’éditeur et modifiable',
    ed.found && ed.value === 'Prestation de conseil' && ed.editable, ed);
  if (ed.found) {
    const mod = await ev(win, `(function () {
      const d = document.querySelector('#ie-lines input[data-f="desc"]');
      d.value = 'Libellé saisi à la main';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#ie-save').click();
      return true;
    })()`);
    await wait(500);
    const after = await ev(win, `(state.invoices[0] || {}).lines[0].desc`);
    check('2d : désignation modifiée à la main enregistrée',
      mod && after === 'Libellé saisi à la main', after);
  }

  /* --- e) suppression d'une désignation : les clients repassent par défaut --- */
  await ev(win, `showView('settings'); document.querySelector('#desig-list [data-action="delete-desig"]').click(); true`);
  await wait(400);
  const del = await ev(win, `({
    list: (state.settings.designations || []).length,
    desig: desigForClient('c1')
  })`);
  check('2d : désignation supprimée, client réinitialisé',
    del.list === 0 && del.desig === '', del);
}


/* ---- PHASE 2e : date de facture par défaut + début de numérotation ---- */
async function phaseDatesNumerotation(uiWin) {
  console.log('--- PHASE 2e : DATE DE FACTURE + DÉBUT DE NUMÉROTATION ---');
  const win = uiWin;
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* --- a) réglage du début de numérotation (aucune facture : modifiable) --- */
  await ev(win, `state.invoices = []; state.transactions = [];
    state.meta = { invoiceSeq: 0 };
    state.settings.invoiceStart = 1;
    renderAll(); showView('settings'); true`);
  await wait(200);
  const n0 = await ev(win, `(function () {
    const el = document.querySelector('#set-startnum');
    return {
      exists: !!el,
      disabled: el ? el.disabled : null,
      hintHidden: document.querySelector('#set-startnum-hint').hidden,
      value: el ? el.value : ''
    };
  })()`);
  check('2e : réglage du début de numérotation présent et actif sans facture',
    n0.exists && n0.disabled === false && n0.hintHidden === true && n0.value === '1', n0);

  await ev(win, `document.querySelector('#set-startnum').value = '42';
    document.querySelector('#btn-save-settings').click(); true`);
  await wait(500);
  const n1 = await ev(win, `state.settings.invoiceStart`);
  check('2e : début de numérotation enregistré (42)', n1 === 42, n1);

  /* --- b) date de facture par défaut = début de la période choisie --- */
  await ev(win, `state.settings.importClientId = 'c1'; state.settings.importMode = 'group';
    renderAll(); showView('import'); true`);
  await ev(win, `document.querySelector('#btn-pick-csv').click(); true`);
  await wait(700);

  const d1 = await ev(win, `({
    issue: document.querySelector('#import-issue-date').value,
    due: document.querySelector('#import-due-date').value,
    auto: document.querySelector('#import-issue-date').dataset.auto
  })`);
  check('2e : date de facture par défaut = début de la période choisie (2026-10-01)',
    d1.issue === '2026-10-01' && d1.auto === '1', d1);
  check('2e : échéance = date de facture + délai de règlement (30 j)',
    d1.due === '2026-10-31', d1);

  const d2 = await ev(win, `(function () {
    const to = document.querySelector('#import-to');
    to.value = '2026-10-04';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    const narrowed = document.querySelector('#import-issue-date').value;
    const fr = document.querySelector('#import-from');
    fr.value = '2026-10-03';
    fr.dispatchEvent(new Event('change', { bubbles: true }));
    const shifted = document.querySelector('#import-issue-date').value;
    to.value = '2026-10-06';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    fr.value = '2026-10-01';
    fr.dispatchEvent(new Event('change', { bubbles: true }));
    return { narrowed: narrowed, shifted: shifted, restored: document.querySelector('#import-issue-date').value };
  })()`);
  await wait(250);
  check('2e : date recalculée sur la période (début de période retenu)',
    d2.narrowed === '2026-10-01' && d2.shifted === '2026-10-03' && d2.restored === '2026-10-01', d2);

  /* --- c) la facture générée porte cette date --- */
  await ev(win, `document.querySelector('#import-client').value = 'c1';
    document.querySelector('#import-client').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#opt-autogen').checked = true;
    document.querySelector('input[name="import-mode"][value="group"]').checked = true;
    document.querySelector('#btn-do-import').click(); true`);
  await wait(900);
  const c1 = await ev(win, `({
    n: state.invoices.length,
    issue: state.invoices[0] ? state.invoices[0].issueDate : '',
    due: state.invoices[0] ? state.invoices[0].dueDate : ''
  })`);
  check('2e : facture générée datée du début de la période choisie',
    c1.n === 1 && c1.issue === '2026-10-01' && c1.due === '2026-10-31', c1);

  /* --- d) date saisie à la main : conservée malgré les re-rendus --- */
  await ev(win, `document.querySelector('#btn-pick-csv').click(); true`);
  await wait(700);
  const m1 = await ev(win, `(function () {
    const issue = document.querySelector('#import-issue-date');
    issue.value = '2026-10-03';
    issue.dispatchEvent(new Event('change', { bubbles: true }));
    const box = document.querySelector('.imp-chk');
    if (box) box.click();                                  /* re-rendu (sélection) */
    const to = document.querySelector('#import-to');
    to.value = '2026-10-04';
    to.dispatchEvent(new Event('change', { bubbles: true })); /* re-rendu (période) */
    return {
      issue: document.querySelector('#import-issue-date').value,
      due: document.querySelector('#import-due-date').value
    };
  })()`);
  await wait(300);
  check('2e : date de facture saisie à la main conservée après re-rendus',
    m1.issue === '2026-10-03' && m1.due === '2026-11-02', m1);

  /* --- e) validation : premier numéro = 42, le suivant = 43 --- */
  await ev(win, `showView('drafts'); true`);
  await wait(250);
  await ev(win, `(function () {
    const inv = state.invoices[0];
    document.querySelector('[data-action="validate-invoice"][data-id="' + inv.id + '"]').click();
    return true;
  })()`);
  await wait(300);
  await ev(win, `document.querySelector('#cf-ok').click(); true`);
  await wait(500);
  const num1 = await ev(win, `({
    number: state.invoices[0] ? state.invoices[0].number : '',
    seq: state.meta.invoiceSeq
  })`);
  check('2e : premier numéro attribué = début de numérotation (FA-2026-0042)',
    num1.number === 'FA-2026-0042' && num1.seq === 42, num1);

  await ev(win, `document.querySelector('#btn-new-invoice').click(); true`);
  await wait(300);
  await ev(win, `(function () {
    const sel = document.querySelector('#ie-client');
    sel.value = 'c1';
    const desc = document.querySelector('#ie-lines input[data-f="desc"]');
    desc.value = 'Deuxième facture';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    const price = document.querySelector('#ie-lines input[data-f="price"]');
    price.value = '500';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ie-save').click();
    return true;
  })()`);
  await wait(500);
  await ev(win, `(function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'draft'; })[0];
    if (inv) document.querySelector('[data-action="validate-invoice"][data-id="' + inv.id + '"]').click();
    return !!inv;
  })()`);
  await wait(300);
  await ev(win, `document.querySelector('#cf-ok').click(); true`);
  await wait(500);
  const num2 = await ev(win, `state.invoices.map(function (i) { return i.number; }).filter(Boolean)`);
  check('2e : numérotation poursuivie (FA-2026-0043)',
    num2.indexOf('FA-2026-0043') !== -1, num2);

  /* --- f) verrouillage dès qu'une facture existe --- */
  const lock = await ev(win, `(function () {
    renderAll(); showView('settings');
    const el = document.querySelector('#set-startnum');
    const before = state.settings.invoiceStart;
    const disabled = el.disabled;
    const hint = !document.querySelector('#set-startnum-hint').hidden;
    el.value = '99';
    document.querySelector('#btn-save-settings').click();
    return { disabled: disabled, hint: hint, before: before };
  })()`);
  await wait(500);
  const lock2 = await ev(win, `state.settings.invoiceStart`);
  check('2e : début de numérotation verrouillé une fois les factures créées',
    lock.disabled === true && lock.hint === true && lock.before === 42 && lock2 === 42,
    { lock: lock, after: lock2 });

  /* --- g) modale ✨ Générer : date = début de la période choisie --- */
  await ev(win, `state.invoices = []; state.transactions = [
      { id: 'e1', date: '2026-09-10', label: 'VIR A', amount: 500, status: 'new', linkedInvoiceId: null },
      { id: 'e2', date: '2026-09-25', label: 'VIR B', amount: 700, status: 'new', linkedInvoiceId: null }
    ];
    renderAll(); true`);
  await ev(win, `document.querySelector('#btn-generate').click(); true`);
  await wait(400);
  const g = await ev(win, `({
    from: (document.querySelector('#gen-from') || {}).value || '',
    to: (document.querySelector('#gen-to') || {}).value || '',
    issue: (document.querySelector('#gen-issue') || {}).value || '',
    due: (document.querySelector('#gen-due') || {}).value || ''
  })`);
  check('2e : modale de génération : date de facture = début de la période',
    g.from === '2026-09-10' && g.to === '2026-09-25' &&
    g.issue === '2026-09-10' && g.due === '2026-10-10', g);
  await ev(win, `document.querySelector('#gen-cancel').click(); true`);
  await wait(200);
}

/* ---- PHASE 3 : SÉCURITÉ MONOPOSTE (mot de passe min. 4) ----
   Parcours : activation depuis Paramètres → mot de passe trop court refusé →
   verrouillage → mauvais/bon mot de passe → verrous des données →
   « Verrouiller » → réinitialisation par question de sécurité → autre poste
   refusé (« Poste non autorisé », aucune gestion de postes) → désactivation. */
async function phaseSecurite(uiWin) {
  console.log('--- PHASE 3 : SÉCURITÉ MONOPOSTE (MOT DE PASSE, MIN. 4) ---');
  const win = uiWin;
  const codeA = secModule.deviceCode('MACHINE-A');
  const codeB = secModule.deviceCode('MACHINE-B');
  if (fs.existsSync(SEC_FILE)) fs.unlinkSync(SEC_FILE);
  bindSecurity('MACHINE-A');

  const reload = async () => {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await wait(900);
  };
  const secStatus = () => ev(win, 'window.factapi.authStatus()');
  const fill = (id, v) => ev(win, `(function(){ const el = document.getElementById(${JSON.stringify(id.replace(/^#/, ''))}); if (el) el.value = ${JSON.stringify(v)}; return !!el; })()`);
  const clickId = (id) => ev(win, `(function(){ const el = document.getElementById(${JSON.stringify(id.replace(/^#/, ''))}); if (el && el.click) el.click(); return !!el; })()`);
  const lockMeta = () => ev(win, `(function () {
    const g = (id) => document.getElementById(id);
    const mode = g('lock-mode');
    return {
      hidden: g('lock-screen') ? g('lock-screen').hidden : null,
      h2: mode ? ((mode.querySelector('h2') || {}).textContent || '').trim() : '',
      code: g('lock-code') ? (g('lock-code').textContent || '').trim() : '',
      body: mode ? (mode.textContent || '') : '',
      hasSetupFields: !!(g('lock-pw1') && g('lock-pw2') && g('lock-q') && g('lock-a1') && g('lock-a2')),
      hasForgot: !!g('lock-forgot'),
      hasRetry: !!g('lock-retry'),
      msg: g('lock-msg') ? g('lock-msg').textContent : '',
      msgErr: g('lock-msg') ? g('lock-msg').classList.contains('error') : false
    };
  })()`);

  /* --- a) état initial : pas de protection configurée → application normale --- */
  await reload();
  const s0 = await ev(win, `(function () {
    const d = (id) => document.getElementById(id);
    return {
      lockHidden: d('lock-screen').hidden,
      lockBtnHidden: d('btn-lock').hidden,
      hasSecCard: !!d('card-security'),
      enableHidden: d('btn-sec-enable').hidden,
      views: document.querySelectorAll('.view').length,
      dash: (d('dash-drafts') || {}).innerHTML || ''
    };
  })()`);
  check('3 : sans protection, l\'application s\'ouvre normalement (pas d\'écran de verrouillage)',
    s0.lockHidden === true && s0.lockBtnHidden === true && s0.hasSecCard === true &&
    s0.enableHidden === false && s0.views === 11 && s0.dash.length > 0, s0);

  /* --- b) activation : Paramètres → Sécurité → « Activer la protection » --- */
  await ev(win, `showView('settings'); true`);
  await wait(150);
  await clickId('#btn-sec-enable');
  await wait(200);
  const s1 = await lockMeta();
  check('3 : activation → écran de création du mot de passe (avec question de sécurité)',
    s1.hidden === false && s1.h2 === 'Activez la protection' && s1.hasSetupFields, s1);

  /* Mot de passe trop court (< 4) → refusé, minimum 4 caractères. */
  await fill('lock-pw1', 'abc');
  await fill('lock-pw2', 'abc');
  await clickId('#lock-setup');
  await wait(200);
  const s1b = await lockMeta();
  check('3 : mot de passe trop court (3 caractères) → refusé (minimum 4)',
    s1b.hidden === false && s1b.msgErr === true && /court/.test(s1b.msg), s1b);

  await fill('lock-pw1', 'secret123');
  await fill('lock-pw2', 'secret123');
  await fill('lock-q', 'Ville de naissance');
  await fill('lock-a1', 'rosa');
  await fill('lock-a2', 'rosa');
  await clickId('#lock-setup');
  await wait(400);
  const st2 = await secStatus();
  const s2 = await ev(win, `(function () {
    const d = (id) => document.getElementById(id);
    return { lockHidden: d('lock-screen').hidden, lockBtnHidden: d('btn-lock').hidden, dash: (d('dash-drafts') || {}).innerHTML.length };
  })()`);
  check('3 : activation validée → déverrouillé, données chargées, « Verrouiller » visible',
    st2.configured === true && st2.locked === false && st2.authorized === true &&
    st2.recovery === true && st2.devices.length === 1 &&
    st2.devices[0].owner === true && st2.devices[0].current === true &&
    s2.lockHidden === true && s2.lockBtnHidden === false && s2.dash > 0, { st: st2, layout: s2 });

  /* --- c) rechargement → verrou ; données gated ; 3 mauvais mots de passe ; bon --- */
  await secInst.lockSession();
  await reload();
  const s3 = await lockMeta();
  check('3 : rechargement → écran de déverrouillage (authentification requise)',
    s3.hidden === false && s3.h2 === 'Application verrouillée' && s3.hasForgot, s3);
  const gatedGet = await ev(win, 'window.factapi.storeGet()');
  const gatedSave = await ev(win, `window.factapi.storeSave('settings', { test: 1 })`);
  check('3 : données inaccessibles tant que le verrou est actif (store gated)',
    gatedGet && gatedGet.code === 'LOCKED' && gatedSave && gatedSave.code === 'LOCKED',
    { get: gatedGet, save: gatedSave });

  for (let i = 1; i <= 3; i++) {
    await fill('lock-pw', 'wrongpass');
    await clickId('#lock-unlock');
    await wait(200);
    const g = await secStatus();
    const m = await lockMeta();
    check(`3 : mauvais mot de passe ${i}/3 → refusé (compteur anti force-brute)`,
      g.locked === true && g.attemptsLeft === 5 - i && m.msgErr === true && m.msg.length > 0,
      { st: g, msg: m.msg });
  }
  await fill('lock-pw', 'secret123');
  await clickId('#lock-unlock');
  await wait(400);
  const st4 = await secStatus();
  const s4 = await ev(win, `(function () {
    const d = (id) => document.getElementById(id);
    return { lockHidden: d('lock-screen').hidden, lockBtnHidden: d('btn-lock').hidden, dash: (d('dash-drafts') || {}).innerHTML.length };
  })()`);
  check('3 : bon mot de passe → déverrouillé, compteur remis à zéro, données rechargées',
    st4.locked === false && st4.attemptsLeft === 5 &&
    s4.lockHidden === true && s4.lockBtnHidden === false && s4.dash > 0, { st: st4, layout: s4 });

  /* --- d) bouton « Verrouiller » --- */
  await clickId('#btn-lock');
  await wait(300);
  const s5 = await lockMeta();
  check('3 : bouton « Verrouiller » → retour à l\'écran de déverrouillage',
    s5.hidden === false && s5.h2 === 'Application verrouillée', s5);

  /* --- e) mot de passe oublié : question de sécurité --- */
  await clickId('#lock-forgot');
  await wait(200);
  const s6 = await lockMeta();
  check('3 : « Mot de passe oublié » → question de sécurité affichée',
    s6.hidden === false && s6.h2 === 'Mot de passe oublié ?' && /Ville de naissance/.test(s6.body), s6);
  await fill('lock-a', 'toronto');
  await fill('lock-pw1', 'newpass456');
  await fill('lock-pw2', 'newpass456');
  await clickId('#lock-reset');
  await wait(300);
  const s7 = await lockMeta();
  const st7 = await secStatus();
  check('3 : mauvaise réponse → réinitialisation refusée (toujours verrouillé)',
    s7.hidden === false && s7.msgErr === true && /incorrecte/.test(s7.msg) && st7.locked === true, { s7, st7 });
  await fill('lock-a', 'rosa');
  await clickId('#lock-reset');
  await wait(400);
  const st8 = await secStatus();
  check('3 : bonne réponse + nouveau mot de passe → réinitialisé et déverrouillé',
    st8.locked === false && st8.authorized === true, st8);
  await secInst.lockSession();
  await reload();
  await fill('lock-pw', 'newpass456');
  await clickId('#lock-unlock');
  await wait(400);
  const st9 = await secStatus();
  check('3 : le nouveau mot de passe fonctionne au démarrage suivant',
    st9.locked === false && st9.authorized === true, st9);

  /* --- f) MONOPOSTE : un autre poste est refusé sans aucune gestion de postes --- */
  bindSecurity('MACHINE-B');
  await reload();
  const sB = await lockMeta();
  const stB = await secStatus();
  check('3 : autre poste → écran « Poste non autorisé » (monoposte, sans code d\'appareil)',
    sB.hidden === false && sB.h2 === 'Poste non autorisé' && sB.code === '' &&
    sB.hasRetry === false && stB.authorized === false && stB.code === codeB, { sB, stB });

  /* --- g) retour au poste principal : tout fonctionne, plus de gestion de postes --- */
  bindSecurity('MACHINE-A');
  await reload();
  await fill('lock-pw', 'newpass456');
  await clickId('#lock-unlock');
  await wait(400);
  await ev(win, `showView('settings'); true`);
  await wait(150);
  const stG = await secStatus();
  const noDevices = await ev(win, `(function () {
    return {
      noBox: !document.getElementById('sec-devices-box'),
      noAdd: !document.getElementById('btn-sec-add-device'),
      noCodeField: !document.getElementById('sec-device-code'),
      noList: !document.getElementById('sec-devices'),
      disableBtn: !document.getElementById('btn-sec-disable').hidden
    };
  })()`);
  check('3 : Paramètres → Sécurité : plus de gestion « Postes autorisés »',
    stG.locked === false && stG.authorized === true &&
    noDevices.noBox && noDevices.noAdd && noDevices.noCodeField && noDevices.noList &&
    noDevices.disableBtn, { stG, noDevices });

  /* --- g-bis) « Verrouiller à la fermeture » (v1.23) : option + persistance --- */
  const lockRow = await ev(win, `(function () {
    const row = document.getElementById('sec-lock-row');
    const hint = document.getElementById('sec-lock-hint');
    const chk = document.getElementById('set-lock-on-quit');
    return {
      rowVisible: row ? !row.hidden : false,
      hintVisible: hint ? !hint.hidden : false,
      hasChk: !!chk,
      checked0: chk ? chk.checked : null
    };
  })()`);
  check('3 : option « Verrouiller à la fermeture » visible et décochée par défaut',
    lockRow.rowVisible && lockRow.hintVisible && lockRow.hasChk && lockRow.checked0 === false, lockRow);

  await ev(win, `(function () {
    const chk = document.getElementById('set-lock-on-quit');
    chk.checked = true;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await wait(300);
  const lockPersist = await ev(win, `window.factapi.storeGet()`);
  check('3 : cocher l\'option → persistée dans les Paramètres',
    lockPersist && lockPersist.settings && lockPersist.settings.lockOnQuit === true,
    (lockPersist || {}).settings);

  /* Retour au défaut pour ne pas interférer avec le reste du run. */
  await ev(win, `(function () {
    const chk = document.getElementById('set-lock-on-quit');
    chk.checked = false;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await wait(200);

  /* --- h) désactivation (mot de passe requis) ; retour à une app normale --- */
  await clickId('#btn-sec-disable');
  await wait(200);
  await clickId('#cf-ok');
  await wait(200);
  await fill('pm-input', 'newpass456');
  await clickId('#pm-ok');
  await wait(400);
  const stC = await secStatus();
  const sC = await ev(win, `(function () {
    const d = (id) => document.getElementById(id);
    return {
      lockHidden: d('lock-screen').hidden,
      lockBtnHidden: d('btn-lock').hidden,
      enableHidden: d('btn-sec-enable').hidden
    };
  })()`);
  check('3 : désactivation (mot de passe requis) → protection retirée',
    stC.configured === false && stC.authorized === true &&
    sC.lockHidden === true && sC.lockBtnHidden === true &&
    sC.enableHidden === false, { stC, sC });
  await reload();
  const sD = await ev(win, `(function () {
    const d = (id) => document.getElementById(id);
    return { lockHidden: d('lock-screen').hidden, lockBtnHidden: d('btn-lock').hidden, dash: (d('dash-drafts') || {}).innerHTML.length };
  })()`);
  check('3 : après désactivation → l\'application s\'ouvre normalement',
    sD.lockHidden === true && sD.lockBtnHidden === true && sD.dash > 0, sD);

  /* Retour à l'état initial pour le reste du run. */
  if (fs.existsSync(SEC_FILE)) fs.unlinkSync(SEC_FILE);
  bindSecurity('MACHINE-A');
}

async function phaseLicence(uiWin) {
  console.log('--- PHASE 4 : LICENCE (CLÉ SIGNÉE, ANTI-CONTREFAÇON) ---');
  const win = uiWin;
  bindSecurity('MACHINE-A');

  const reload = async () => {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await wait(900);
  };
  const fill = (id, v) => ev(win, `(function(){ const el = document.getElementById(${JSON.stringify(id.replace(/^#/, ''))}); if (el) el.value = ${JSON.stringify(v)}; return !!el; })()`);
  const clickId = (id) => ev(win, `(function(){ const el = document.getElementById(${JSON.stringify(id.replace(/^#/, ''))}); if (el && el.click) el.click(); return !!el; })()`);
  const lockMeta = () => ev(win, `(function () {
    const g = (id) => document.getElementById(id);
    const mode = g('lock-mode');
    return {
      hidden: g('lock-screen') ? g('lock-screen').hidden : null,
      h2: mode ? ((mode.querySelector('h2') || {}).textContent || '').trim() : '',
      hasLicKey: !!g('lic-key'),
      msg: g('lock-msg') ? g('lock-msg').textContent : '',
      msgErr: g('lock-msg') ? g('lock-msg').classList.contains('error') : false
    };
  })()`);

  /* --- a) sans licence → écran d'enregistrement, données bloquées --- */
  unlicense();
  await reload();
  const l1 = await lockMeta();
  const g1 = await ev(win, 'window.factapi.storeGet()');
  check('4 : sans licence → écran « Enregistrement de la licence »',
    l1.hidden === false && l1.h2 === 'Enregistrement de la licence' && l1.hasLicKey === true, l1);
  check('4 : données inaccessibles tant que la licence est inactive (NO_LICENSE)',
    g1 && g1.error === 'locked' && g1.code === 'NO_LICENSE', g1);

  /* --- b) clé forgée → signature invalide, refusée --- */
  await fill('lic-key', 'MAZF-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  await clickId('#lic-activate');
  await wait(300);
  const l2 = await lockMeta();
  check('4 : clé forgée → refusée (signature invalide)',
    l2.hidden === false && l2.msgErr === true && /invalide/.test(l2.msg), l2);

  /* --- c) bonne clé (max 2 postes) → poste A lié, application ouverte --- */
  await fill('lic-key', LIC_KEY_2);
  await clickId('#lic-activate');
  await wait(600);
  const s3 = await ev(win, 'window.factapi.licenseStatus()');
  const l3 = await lockMeta();
  check('4 : bonne clé → licence active sur le poste A (1/2), app ouverte',
    s3.active === true && s3.currentBound === true && s3.bound === 1 &&
    s3.customer === 'Client Smoke' && s3.maxDevices === 2 &&
    l3.hidden === true, { st: s3, layout: l3 });

  /* --- d) la MÊME clé sur un second poste → lié, application ouverte --- */
  bindSecurity('MACHINE-B');
  await reload();
  const l4 = await lockMeta();
  check('4 : nouveau poste non lié → écran de licence, pas d\'accès',
    l4.hidden === false && l4.h2 === 'Enregistrement de la licence', l4);
  await fill('lic-key', LIC_KEY_2);
  await clickId('#lic-activate');
  await wait(600);
  const s4 = await ev(win, 'window.factapi.licenseStatus()');
  const l4b = await lockMeta();
  check('4 : même clé sur le poste B → lié (2/2), app ouverte',
    s4.active === true && s4.currentBound === true && s4.bound === 2 && l4b.hidden === true,
    { st: s4, layout: l4b });

  /* --- e) troisième poste : la clé (max 2, déjà 2/2) est refusée --- */
  bindSecurity('MACHINE-C');
  await reload();
  const l5 = await lockMeta();
  check('4 : 3ᵉ poste non lié → écran de licence, pas d\'accès',
    l5.hidden === false && l5.h2 === 'Enregistrement de la licence', l5);
  await fill('lic-key', LIC_KEY_2);
  await clickId('#lic-activate');
  await wait(300);
  const l5b = await lockMeta();
  check('4 : clé au maximum de postes (2/2) → refusée sur le 3ᵉ poste',
    l5b.hidden === false && l5b.msgErr === true && /maximal/.test(l5b.msg), l5b);

  /* --- f) nom du client de la licence figé dans Paramètres + logo sur les factures --- */
  bindSecurity('MACHINE-A');
  await reload();
  await ev(win, `showView('settings'); true`);
  const nm = await ev(win, `(function () {
    const el = document.getElementById('set-name');
    return {
      value: el.value,
      disabled: el.disabled,
      hintHidden: document.getElementById('set-name-hint').hidden,
      sidebar: document.getElementById('sidebar-company').textContent
    };
  })()`);
  check('4 : licence active → nom de société = client de la clé, champ figé',
    nm.value === 'Client Smoke' && nm.disabled === true && nm.hintHidden === false && nm.sidebar === 'Client Smoke', nm);

  /* choix du logo (dialog stub : 1×1 PNG) puis aperçu + mémorisation */
  await clickId('#btn-pick-logo');
  await wait(500);
  const lg = await ev(win, `(function () {
    const img = document.getElementById('set-logo-preview');
    return {
      shown: !img.hidden && !!img.src && img.src.indexOf('data:image/png') === 0,
      stored: (state.settings.company.logo && state.settings.company.logo.dataUri) || '',
      rmShown: !document.getElementById('btn-remove-logo').hidden
    };
  })()`);
  check('4 : logo choisi → aperçu affiché, mémorisé, bouton « retirer » visible',
    lg.shown && lg.stored.indexOf('data:image/png') === 0 && lg.rmShown, lg);

  /* sauvegarde des paramètres : nom licence conservé, logo conservé */
  await clickId('#btn-save-settings');
  await wait(400);
  const saved = await ev(win, `(function () {
    return {
      name: state.settings.company.name,
      logo: (state.settings.company.logo && state.settings.company.logo.dataUri) || '',
      field: document.getElementById('set-name').value,
      disabled: document.getElementById('set-name').disabled
    };
  })()`);
  check('4 : enregistrement → nom de la licence conservé + logo conservé',
    saved.name === 'Client Smoke' && saved.logo.indexOf('data:image/png') === 0 &&
    saved.field === 'Client Smoke' && saved.disabled === true, saved);

  /* la facture A4 affiche le logo et le nom du client de la licence */
  const invId = await ev(win, `state.invoices[0] && state.invoices[0].id`);
  if (invId) {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-invoice.html'), { query: { id: invId } });
    await wait(800);
    const invHtml = await ev(win, `document.getElementById('root').innerHTML || ''`);
    check('4 : facture → logo inséré en haut + nom du client de la licence',
      /<img class="logo" src="data:image\/png;base64,/.test(invHtml) && /Client Smoke/.test(invHtml), invHtml.slice(0, 200));
    await reload();
  } else {
    check('4 : facture → logo inséré en haut + nom du client de la licence', false, invId);
  }

  /* Retour à l'état initial (licence active sur A et B). */
  bindSecurity('MACHINE-A');
  bindLicense('Client Smoke', 2, [secModule.deviceCode('MACHINE-A'), secModule.deviceCode('MACHINE-B')]);
}

/* Lecture d'une entrée d'un zip maison (méthode STORED) — vérification du paquet. */
function zipRead(buf, target) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return null;
  const count = buf.readUInt16LE(i + 10);
  const cdStart = buf.readUInt32LE(i + 16);
  let p = cdStart;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === target) {
      const localOff = buf.readUInt32LE(p + 42);
      const ln = buf.readUInt16LE(localOff + 26);
      const le = buf.readUInt16LE(localOff + 28);
      const ds = localOff + 30 + ln + le;
      return buf.subarray(ds, ds + buf.readUInt32LE(p + 24));
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

/* ---- PHASE 5 : EXPORT COMPTABLE « CLÔTURE DE PÉRIODE » ---- */
async function phaseExportPack(uiWin) {
  console.log('--- PHASE 5 : EXPORT COMPTABLE (CLÔTURE DE PÉRIODE) ---');
  const win = uiWin;
  bindSecurity('MACHINE-A');

  /* Jeu de données dédié : 2 factures de septembre 2026 (1 partiellement payée,
     1 impayée), 1 facture d'août (hors période, impayée, échue) + 1 transaction. */
  storeStub.clients = [{ id: 'c1', name: 'Dupont SARL', email: '', address: '', tvaNumber: '', phone: '' }];
  storeStub.invoices = [
    { id: 'x1', number: 'FA-2026-0042', issueDate: '2026-09-10', dueDate: '2026-10-10', clientId: 'c1', status: 'validated',
      lines: [{ desc: 'Prestation septembre', qty: 2, price: 500, tva: 20 }],
      payments: [{ id: 'p1', date: '2026-09-15', amount: 600, method: 'virement', reference: 'VIR-1' }] },
    { id: 'x2', number: 'FA-2026-0043', issueDate: '2026-09-20', dueDate: '2026-10-20', clientId: 'c1', status: 'validated',
      lines: [{ desc: 'Conseil', qty: 1, price: 250, tva: 14 }], payments: [], paid: false },
    { id: 'x3', number: 'FA-2026-0044', issueDate: '2026-08-15', dueDate: '2026-09-15', clientId: 'c1', status: 'validated',
      lines: [{ desc: 'Prestation août', qty: 1, price: 100, tva: 20 }], payments: [], paid: false }
  ];
  storeStub.transactions = [
    { id: 't9', date: '2026-09-05', label: 'VIREMENT CLIENT ATLAS', amount: 1000, status: 'new', linkedInvoiceId: null }
  ];

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);
  await ev(win, `showView('settings'); true`);
  await ev(win, `(function () {
    document.getElementById('set-close-from').value = '2026-09-01';
    document.getElementById('set-close-to').value = '2026-09-30';
    return true;
  })()`);

  await ev(win, `document.getElementById('btn-export-close-period').click(); true`);
  await wait(1200);

  const ui = await ev(win, `({
    msg: (document.getElementById('close-export-msg').textContent || ''),
    toastShown: !document.getElementById('toast').hidden
  })`);
  const zipPath = path.join(__dirname, '.tmp', 'Client-Smoke_cloture.zip');
  check('5 : paquet exporté (message chemin + nb de fichiers)',
    /Paquet exporté \(11 fichiers\)/.test(ui.msg) && /_cloture\.zip/.test(ui.msg), ui.msg);
  check('5 : zip écrit sur disque', fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0, zipPath);

  const zb = fs.readFileSync(zipPath);
  const entries = exportPack.zipEntries(zb);
  const expected = [
    'Client-Smoke_2026-09_balance-agee.csv',
    'Client-Smoke_2026-09_balance-agee.ods',
    'Client-Smoke_2026-09_encaissements.csv',
    'Client-Smoke_2026-09_encaissements.ods',
    'Client-Smoke_2026-09_empreinte.txt',
    'Client-Smoke_2026-09_infos.json',
    'Client-Smoke_2026-09_journal.csv',
    'Client-Smoke_2026-09_journal.ods',
    'Client-Smoke_2026-09_rapprochement.csv',
    'Client-Smoke_2026-09_tva.csv',
    'Client-Smoke_2026-09_tva.ods'
  ].sort();
  check('5 : noms de fichiers normalisés (société_période_type)',
    JSON.stringify(entries.map((e) => e.name).sort()) === JSON.stringify(expected),
    entries.map((e) => e.name).sort());

  const journal = zipRead(zb, 'Client-Smoke_2026-09_journal.csv').toString('utf8');
  check('5 : journal de ventes — factures de la période uniquement, lignes détaillées',
    /FA-2026-0042/.test(journal) && /FA-2026-0043/.test(journal) && !/FA-2026-0044/.test(journal) &&
    /Prestation septembre/.test(journal) && /1000\.00/.test(journal) && /1200\.00/.test(journal), journal);

  const tva = zipRead(zb, 'Client-Smoke_2026-09_tva.csv').toString('utf8');
  check('5 : récap TVA — 14 % et 20 % + total (1250.00 / 235.00)',
    /14 %;250\.00;35\.00/.test(tva) && /20 %;1000\.00;200\.00/.test(tva) &&
    /TOTAL;1250\.00;235\.00/.test(tva), tva);

  const enc = zipRead(zb, 'Client-Smoke_2026-09_encaissements.csv').toString('utf8');
  check('5 : encaissements — virement 600,00 rattaché à FA-2026-0042',
    /2026-09-15;FA-2026-0042;Dupont SARL;600\.00;Virement;VIR-1;Validée/.test(enc), enc);

  const bal = zipRead(zb, 'Client-Smoke_2026-09_balance-agee.csv').toString('utf8');
  check('5 : balance âgée — restes + tranches (août échue en 0-30 j)',
    /;FA-2026-0042;2026-09-10;2026-10-10;1200\.00;600\.00;600\.00;0;Non échue/.test(bal) &&
    /;FA-2026-0043;2026-09-20;2026-10-20;285\.00;0\.00;285\.00;0;Non échue/.test(bal) &&
    /;FA-2026-0044;2026-08-15;2026-09-15;120\.00;0\.00;120\.00;\d+;0-30 j/.test(bal), bal);

  const rap = zipRead(zb, 'Client-Smoke_2026-09_rapprochement.csv').toString('utf8');
  check('5 : rapprochement — ligne bancaire de la période, non rattachée',
    /2026-09-05;VIREMENT CLIENT ATLAS;1000\.00;Crédit;Non traitée;/.test(rap), rap);

  /* --- Reprise ODS : mimetype + en-têtes normalisés FR / AR + montants typés --- */
  const journalOds = exportPack.zipExtract(zb, 'Client-Smoke_2026-09_journal.ods');
  const jXml = exportPack.zipExtract(journalOds, 'content.xml').toString('utf8');
  const jMime = exportPack.zipExtract(journalOds, 'mimetype').toString('utf8');
  check('5 : ODS journal — mimetype ODS + en-têtes FR/AR + montants numériques',
    jMime === 'application/vnd.oasis.opendocument.spreadsheet' &&
    /table:name="Journal de ventes"/.test(jXml) &&
    /<text:p>Date<\/text:p>/.test(jXml) && /<text:p>التاريخ<\/text:p>/.test(jXml) &&
    /office:value="1200\.00"/.test(jXml) && /office:value="600\.00"/.test(jXml),
    { mime: jMime, xml: jXml.slice(0, 700) });

  const tvaOds = exportPack.zipExtract(zb, 'Client-Smoke_2026-09_tva.ods');
  const tXml = exportPack.zipExtract(tvaOds, 'content.xml').toString('utf8');
  check('5 : ODS récap TVA — ligne AR + total numérique (1250.00 / 235.00)',
    /<text:p>الضريبة المحصلة<\/text:p>/.test(tXml) &&
    /office:value="1250\.00"/.test(tXml) && /office:value="235\.00"/.test(tXml), tXml.slice(0, 700));

  const balOds = exportPack.zipExtract(zb, 'Client-Smoke_2026-09_balance-agee.ods');
  const balXml = exportPack.zipExtract(balOds, 'content.xml').toString('utf8');
  check('5 : ODS balance âgée — en-tête AR « الاستحقاق » + tranche présente',
    /<text:p>الاستحقاق<\/text:p>/.test(balXml) && /0-30 j/.test(balXml), balXml.slice(0, 700));

  const infos = JSON.parse(zipRead(zb, 'Client-Smoke_2026-09_infos.json').toString('utf8'));
  const seal = zipRead(zb, 'Client-Smoke_2026-09_empreinte.txt').toString('utf8');
  check('5 : manifeste — période, société, compteurs (2 factures / 1 règlement / 1 opération)',
    infos.period.from === '2026-09-01' && infos.period.to === '2026-09-30' &&
    infos.society.name === 'Client Smoke' && infos.society.regime === 'Réel normal' &&
    infos.counts.invoices === 2 && infos.counts.payments === 1 && infos.counts.transactions === 1, infos);

  /* Intégrité : l'empreinte d'ensemble se recalcule à l'identique depuis les
     fichiers du zip (hors empreinte elle-même) et figure dans le manifeste. */
  const filesForHash = entries
    .filter((e) => !e.name.endsWith('_empreinte.txt') && !e.name.endsWith('_infos.json'))
    .map((e) => ({ name: e.name, buf: zipRead(zb, e.name) }));
  const recomputed = exportPack.fullHash(filesForHash);
  check('5 : empreinte SHA-256 — manifeste = empreinte.txt = recalcul',
    infos.fullHash === recomputed && seal.indexOf(recomputed) !== -1,
    { manifeste: infos.fullHash, recalcul: recomputed });
}

/* ---- PHASE 1e : devis (v1.15) — DV, aperçu bilingue, conversion en facture ---- */
async function phaseQuotes(win) {
  console.log('--- PHASE 1e : DEVIS → FACTURE (v1.15) ---');

  /* Retour à l'application (l'aperçu devis est chargé ensuite) */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* a) création d'un devis : numéro DV attribué à la création */
  const q0 = await ev(win, `(async function () {
    document.querySelector('#btn-new-quote').click();
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const sel = document.querySelector('#qe-client');
    sel.value = state.clients[0].id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    set('#qe-lines input[data-f="desc"]', 'Prestation de conseil — novembre 2026');
    set('#qe-lines input[data-f="qty"]', '3');
    set('#qe-lines input[data-f="price"]', '1000');
    document.querySelector('#qe-save').click();
    await new Promise(function (r) { setTimeout(r, 350); });
    const q = state.quotes[0];
    const days = q ? Math.round((new Date(q.validUntil + 'T12:00:00') - new Date(q.issueDate + 'T12:00:00')) / 86400000) : 0;
    return {
      n: state.quotes.length,
      number: q && q.number,
      status: q && q.status,
      client: q && q.clientName,
      ttc: q && totals(q).ttc,
      tva20: q && totals(q).tva,
      validDays: days,
      modalHidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('devis créé : numéro DV-AAAA-0001, brouillon, TVA 20 % détaillée (600,00 / 3 600,00)',
    q0.n === 1 && /^DV-\d{4}-0001$/.test(q0.number) && q0.status === 'draft' &&
    q0.client === 'Dupont SARL' && q0.ttc === 3600 && q0.tva20 === 600 &&
    q0.validDays === 30 && q0.modalHidden, q0);

  const persisted = await ev(win, `window.factapi.storeGet()`);
  check('devis persisté (collection quotes + meta.quoteSeq)',
    Array.isArray(persisted.quotes) && persisted.quotes.length === 1 &&
    persisted.meta.quoteSeq === 1 &&
    /^DV-\d{4}-0001$/.test(persisted.quotes[0].number),
    { quotes: persisted.quotes.length, seq: persisted.meta.quoteSeq, n: persisted.quotes[0] && persisted.quotes[0].number });

  /* b) changement de statut dans l'éditeur : brouillon → accepté */
  const st = await ev(win, `(function () {
    openQuoteEditor(state.quotes[0].id);
    const sel = document.querySelector('#qe-status');
    sel.value = 'accepted';
    document.querySelector('#qe-save').click();
    return { status: state.quotes[0].status };
  })()`);
  check('statut du devis passé à « Accepté » dans l\'éditeur', st.status === 'accepted', st);

  /* c) aperçu d'impression : DEVIS bilingue, validité, TVA — AUCUN tampon PAYÉE */
  const qid = await ev(win, `state.quotes[0].id`);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-quote.html'), { query: { id: qid } });
  await wait(800);
  const pq = await ev(win, `(function () {
    const body = document.body.textContent;
    return {
      h1: (document.querySelector('.title h1') || {}).textContent || '',
      ar: (document.querySelector('.title-ar') || {}).textContent || '',
      metaRows: document.querySelectorAll('table.meta tr').length,
      badge: !!document.querySelector('.badge-paid'),
      words: /Arrêté le présent devis/.test(body),
      validity: /Validité/.test(body),
      tva20: /TVA 20 %/.test(body),
      ttc: /3[ \u202f\u00a0]?600,00 MAD/.test(body),
      toolbar: Array.from(document.querySelectorAll('.toolbar button')).map(function (b) { return b.textContent; }).join(' | ')
    };
  })()`);
  check('aperçu devis : DEVIS / عرض الثمن, n° + date + validité, sans PAYÉE',
    pq.h1 === 'DEVIS' && pq.ar.indexOf('عرض الثمن') !== -1 && pq.metaRows === 3 &&
    !pq.badge && pq.words && pq.validity && pq.tva20 && pq.ttc, pq);
  check('aperçu devis : barre d\'outils en français', /Fermer/.test(pq.toolbar), pq.toolbar);

  /* d) retour application + conversion en facture (sens unique) */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);
  await ev(win, `(function () {
    const btn = document.querySelector('[data-action="convert-quote"]');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await wait(350);
  const convDlg = await ev(win, `(function () {
    return { open: !document.querySelector('#modal-root').hidden, ok: !!document.querySelector('#cf-ok') };
  })()`);
  check('conversion : confirmation demandée avant création de la facture',
    convDlg.open && convDlg.ok, convDlg);
  await ev(win, `document.querySelector('#cf-ok').click(); true;`);
  await wait(450);

  const conv = await ev(win, `(function () {
    const q = state.quotes[0];
    const inv = state.invoices.filter(function (i) { return i.quoteRef && i.quoteRef.id === q.id; })[0];
    return {
      qStatus: q.status,
      qConvertedId: !!q.convertedInvoiceId,
      num: inv && inv.number,
      invStatus: inv && inv.status,
      ref: inv && inv.quoteRef && inv.quoteRef.number,
      notes: inv && inv.notes,
      due: inv && inv.dueDate,
      view: (document.querySelector('.view.active') || {}).id
    };
  })()`);
  check('conversion : facture FA validée, devis « Converti » + référence croisée',
    conv.qStatus === 'converted' && conv.qConvertedId &&
    /^FA-\d{4}-\d{4}$/.test(conv.num) && conv.invStatus === 'validated' &&
    /^DV-\d{4}-0001$/.test(conv.ref) && /DV-\d{4}-0001/.test(conv.notes) &&
    conv.due && conv.view === 'view-invoices', conv);

  /* e) re-conversion bloquée : aucun doublon de facture */
  const again = await ev(win, `(async function () {
    const before = state.invoices.length;
    const res = await convertQuoteToInvoice(state.quotes[0].id);
    return { res: res, nBefore: before, n: state.invoices.length };
  })()`);
  check('re-conversion bloquée : aucun doublon de facture',
    again.res === false && again.n === again.nBefore, again);

  /* f) le devis converti reste exportable : mention « Converti en facture FA-… »,
        toujours sans tampon PAYÉE */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-quote.html'), { query: { id: qid } });
  await wait(800);
  const pc = await ev(win, `(function () {
    return {
      conv: /Converti en facture FA-\\d{4}-\\d{4}/.test(document.body.textContent),
      badge: !!document.querySelector('.badge-paid'),
      title: (document.querySelector('.title h1') || {}).textContent
    };
  })()`);
  check('aperçu devis converti : mention de la facture, toujours sans PAYÉE',
    pc.conv && !pc.badge && pc.title === 'DEVIS', pc);

  /* g) persistance : statut converti + facture + séquences dans la base stub */
  const persisted2 = await ev(win, `window.factapi.storeGet()`);
  check('conversion persistée (quotes + invoices + meta)',
    persisted2.quotes.length === 1 && persisted2.quotes[0].status === 'converted' &&
    persisted2.invoices.filter(function (i) { return i.status === 'validated'; }).length >= 1 &&
    persisted2.meta.invoiceSeq >= 1 && persisted2.meta.quoteSeq === 1,
    { q: persisted2.quotes[0].status, seqQ: persisted2.meta.quoteSeq,
      seqF: persisted2.meta.invoiceSeq, inv: persisted2.invoices.length });
}

/* ---- PHASE 1f : comptabilisation des factures (v1.16) ----
   Suppression réservée à la dernière facture (numérotation continue sans trou),
   verrou de suppression (règlement / comptabilisée), état « comptabilisée » par
   mois, édition bloquée, encaissements toujours possibles, réversibilité tracée. */
async function phaseComptabilisation(win) {
  console.log('--- PHASE 1f : COMPTABILISATION DES FACTURES (v1.16) ---');

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* Scénario déterministe : 3 factures validées FA-2026-0001..0003 (octobre). */
  await ev(win, `(async function () {
    const mk = function (seq, date) {
      return { id: 'acc-' + seq, status: 'validated', number: 'FA-2026-' + String(seq).padStart(4, '0'),
        seq: seq, seqYear: '2026', issueDate: date, dueDate: '2026-11-04', clientId: 'c1', clientName: 'Dupont SARL',
        lines: [{ desc: 'Prestation', qty: 1, price: 100, tva: 20 }], payments: [], notes: '',
        createdAt: date + 'T10:00:00.000Z', validatedAt: date + 'T10:00:00.000Z' };
    };
    state.invoices = [ mk(1, '2026-10-05'), mk(2, '2026-10-06'), mk(3, '2026-10-07') ];
    state.settings.invoiceStart = 1;
    state.meta.invoiceSeq = 3;
    renderAll();
    await persist('invoices', 'meta', 'settings');
    return state.invoices.length;
  })()`);

  /* a) suppression refusée pour une facture non-dernière (pas de trou) */
  const a = await ev(win, `(async function () {
    const before = state.invoices.length;
    await deleteInvoice('acc-1');
    return { before: before, after: state.invoices.length, seq: state.meta.invoiceSeq };
  })()`);
  check('comptabilisation — suppression refusée pour une facture non-dernière',
    a.before === 3 && a.after === 3 && a.seq === 3, a);

  /* b) suppression refusée si la dernière porte un règlement */
  const b = await ev(win, `(async function () {
    invoiceById('acc-3').payments = [{ id: 'p1', date: '2026-10-09', amount: 120, method: 'virement' }];
    const before = state.invoices.length;
    await deleteInvoice('acc-3');
    return { before: before, after: state.invoices.length, seq: state.meta.invoiceSeq };
  })()`);
  check('comptabilisation — suppression refusée si la dernière a un règlement',
    b.before === 3 && b.after === 3 && b.seq === 3, b);

  /* c) dernière facture (sans règlement) supprimable : compteur rembobiné 3 → 2 */
  const c = await ev(win, `(async function () {
    invoiceById('acc-3').payments = [];
    const p = deleteInvoice('acc-3');
    await new Promise(function (r) { setTimeout(r, 80); });
    if (document.querySelector('#cf-ok')) document.querySelector('#cf-ok').click();
    await p;
    return { n: state.invoices.length, seq: state.meta.invoiceSeq, gone: !invoiceById('acc-3') };
  })()`);
  check('comptabilisation — dernière facture supprimée et compteur rembobiné (3 → 2)',
    c.n === 2 && c.seq === 2 && c.gone, c);

  /* d) le numéro libéré est réutilisé (série contiguë) */
  await ev(win, `(function () {
    openInvoiceEditor(null);
    const set = function (sel, v) { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const cs = document.querySelector('#ie-client'); cs.value = state.clients[0].id; cs.dispatchEvent(new Event('change', { bubbles: true }));
    set('#ie-lines input[data-f="desc"]', 'Réutilisation du numéro');
    set('#ie-lines input[data-f="price"]', '100');
    document.querySelector('#ie-validate').click();
    return true;
  })()`);
  await wait(450);
  const d = await ev(win, `(function () {
    const nums = state.invoices.filter(function (i) { return i.status === 'validated'; }).map(function (i) { return i.number; }).sort();
    return { seq: state.meta.invoiceSeq, last: nums[nums.length - 1], n: state.invoices.length };
  })()`);
  check('comptabilisation — numéro réutilisé après suppression de la dernière (FA-2026-0003)',
    d.seq === 3 && d.n === 3 && /FA-2026-0003/.test(d.last), d);

  /* e) comptabilisation du mois (3 factures) + journal */
  const e = await ev(win, `(async function () {
    const p = accountPeriod('2026-10');
    await new Promise(function (r) { setTimeout(r, 80); });
    if (document.querySelector('#cf-ok')) document.querySelector('#cf-ok').click();
    await p;
    return { n: state.invoices.filter(function (i) { return !!i.accountedAt; }).length,
             period: state.invoices[0].accountedPeriod,
             log: (state.meta.accountingLog || []).length };
  })()`);
  check('comptabilisation — mois 2026-10 marqué comptabilisé (3 factures) + journal',
    e.n === 3 && e.period === '2026-10' && e.log === 1, e);

  /* f) suppression refusée pour une facture comptabilisée (même la dernière) */
  const f = await ev(win, `(async function () {
    const inv = state.invoices.filter(function (i) { return i.status === 'validated'; })
      .sort(function (x, y) { return invoiceSeqOf(x) - invoiceSeqOf(y); }).pop();
    const before = state.invoices.length;
    await deleteInvoice(inv.id);
    return { before: before, after: state.invoices.length, accounted: isAccounted(inv) };
  })()`);
  check('comptabilisation — suppression refusée pour une facture comptabilisée',
    f.before === 3 && f.after === 3 && f.accounted, f);

  /* g) édition refusée pour une facture comptabilisée */
  const g = await ev(win, `(function () {
    closeModal();
    const acc = state.invoices.filter(function (i) { return isAccounted(i); })[0];
    openInvoiceEditor(acc.id);
    return { hidden: document.querySelector('#modal-root').hidden };
  })()`);
  check('comptabilisation — édition refusée pour une facture comptabilisée', g.hidden === true, g);

  /* h) encaissement toujours possible, édition retirée dans la liste */
  const h = await ev(win, `(async function () {
    showView('invoices');
    renderValidated();
    const acc = state.invoices.filter(function (i) { return isAccounted(i); })[0];
    const pay = document.querySelector('#inv-table [data-action="pay-invoice"][data-id="' + acc.id + '"]');
    const edit = document.querySelector('#inv-table [data-action="edit-invoice"][data-id="' + acc.id + '"]');
    const badge = /Comptabilisée/.test(document.querySelector('#inv-table').textContent);
    return { pay: !!pay, edit: !!edit, badge: badge };
  })()`);
  check('comptabilisation — encaissement possible, édition retirée, pastille visible',
    h.pay && !h.edit && h.badge, h);

  /* i) dé-comptabilisation réversible (journal conservé) */
  const i = await ev(win, `(async function () {
    const p = unaccountPeriod('2026-10');
    await new Promise(function (r) { setTimeout(r, 80); });
    if (document.querySelector('#cf-ok')) document.querySelector('#cf-ok').click();
    await p;
    return { still: state.invoices.filter(function (x) { return isAccounted(x); }).length,
             log: (state.meta.accountingLog || []).length,
             canDelete: deleteInvoiceGuard(state.invoices[state.invoices.length - 1]).ok };
  })()`);
  check('comptabilisation — dé-comptabilisation réversible (journal tracé, suppression à nouveau possible)',
    i.still === 0 && i.log === 2 && i.canDelete, i);

  /* j) persistance : accountedAt + journal dans la base stub */
  await ev(win, `(async function () {
    const p = accountPeriod('2026-10');
    await new Promise(function (r) { setTimeout(r, 80); });
    if (document.querySelector('#cf-ok')) document.querySelector('#cf-ok').click();
    await p;
    return true;
  })()`);
  const persisted = await ev(win, `window.factapi.storeGet()`);
  check('comptabilisation — persistée (accountedAt + journal dans meta)',
    persisted.invoices.filter(function (x) { return x.accountedAt; }).length === 3 &&
    Array.isArray(persisted.meta.accountingLog) && persisted.meta.accountingLog.length >= 3,
    { acc: persisted.invoices.filter(function (x) { return x.accountedAt; }).length,
      log: persisted.meta.accountingLog && persisted.meta.accountingLog.length });
}

/* ---- PHASE 1g : MODÈLE DES DOCUMENTS (v1.17) ----
   Vérifie qu'un modèle non-défaut change bien le rendu : classes de modèle,
   couleur d'accent, format, blocs masqués, textes libres et modèle de devis
   séparé. À la fin, aucune donnée n'est laissée dans un état gênant (dernière
   phase exécutée). */
async function phaseDocModel(win) {
  console.log('--- PHASE 1g : MODÈLE DES DOCUMENTS (v1.17) ---');

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  const hasInv = await ev(win, `state.invoices.length > 0`);
  const hasQuote = await ev(win, `state.quotes.length > 0`);
  const invId0 = await ev(win, `state.invoices[0] ? state.invoices[0].id : ''`);
  const qid0 = await ev(win, `state.quotes[0] ? state.quotes[0].id : ''`);
  if (!hasInv) { check('modèle doc : facture disponible', false, 'aucune facture'); return; }

  /* (a) Réglage appliqué IMMÉDIATEMENT via l'interface (sans passer par le
     bouton « Enregistrer les paramètres ») : on décoche « bloc client ». */
  await ev(win, `(function () {
    const c = document.querySelector('#doc-clientids');
    c.checked = false;
    c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await wait(600);
  const uiSave = await ev(win, `(async function () {
    const s = await window.factapi.storeGet();
    return { live: !!(state.settings.doc && state.settings.doc.blocks && state.settings.doc.blocks.clientIds),
      saved: !!(s.settings.doc && s.settings.doc.blocks && s.settings.doc.blocks.clientIds) };
  })()`);
  check('modèle doc : réglage appliqué immédiatement (sans « Enregistrer »)',
    uiSave.live === false && uiSave.saved === false, uiSave);

  /* (b) Garde-fou : masquer un identifiant légal RENSEIGNÉ (ICE) doit afficher
     un avertissement de conformité. On le rétablit ensuite. */
  await ev(win, `(function () {
    const c = document.querySelector('#doc-id-ice');
    c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await wait(200);
  const warnShown = await ev(win, `!document.querySelector('#doc-ids-warn').hidden`);
  check('modèle doc : avertissement si un identifiant renseigné est masqué', warnShown === true, warnShown);
  await ev(win, `(function () {
    const c = document.querySelector('#doc-id-ice');
    c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await wait(200);
  const warnHidden = await ev(win, `document.querySelector('#doc-ids-warn').hidden`);
  check('modèle doc : avertissement masqué quand tous les identifiants sont affichés', warnHidden === true, warnHidden);

  await ev(win, `(async function () {
    state.settings.doc = {
      template: 'modern', accent: 'green', accentColor: '#123456',
      paper: 'A5', margins: 'wide', density: 'compact', font: 'serif',
      watermark: 'draft', bilingual: 'fr',
      blocks: { logo: true, nameAr: true, ids: { ice: true, if: false, rc: false, patente: true, cnss: true, tva: true }, clientIds: false,
        tvaDetail: false, regime: false, rib: false, notes: true, words: 'none',
        legal: true, signature: true, dueDate: false, validity: true,
        colsQty: false, colsPu: false, colsTva: true, colsTotal: true },
      texts: { header: 'ENTETE TEST', terms: 'TERMES TEST', footer: 'PIED TEST' },
      invoiceTemplate: '', quoteTemplate: 'elegant'
    };
    await persist('settings');
    return true;
  })()`);

  const invId = invId0;
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-invoice.html'), { query: { id: invId } });
  await wait(800);
  const d = await ev(win, `(function () {
    const sheet = document.querySelector('.sheet');
    const arTitle = document.querySelector('.title-ar');
    return {
      cls: sheet ? sheet.className : '',
      accent: sheet ? getComputedStyle(sheet).getPropertyValue('--accent').trim() : '',
      accent2: sheet ? getComputedStyle(sheet).getPropertyValue('--accent-2').trim() : '',
      metaRows: document.querySelectorAll('table.meta tr').length,
      words: document.querySelectorAll('.words').length,
      parties: document.querySelectorAll('.parties').length,
      ths: document.querySelectorAll('table.lines thead th').length,
      head: !!document.querySelector('.doc-note'),
      terms: document.body.textContent.indexOf('TERMES TEST') !== -1,
      footer: document.body.textContent.indexOf('PIED TEST') !== -1,
      signature: document.querySelectorAll('.signature').length,
      wm: (document.querySelector('.wm span') || {}).textContent || '',
      ids: Array.from(document.querySelectorAll('.company .cmeta.id')).map(function (e) { return e.textContent; }).join(' | '),
      arHidden: arTitle ? getComputedStyle(arTitle).display === 'none' : false,
      title: (document.querySelector('.title h1') || {}).textContent || ''
    };
  })()`);
  check('modèle doc : classes de modèle/format/densité/police/langue appliquées',
    /\bt-modern\b/.test(d.cls) && /\bpaper-A5\b/.test(d.cls) && /\bd-compact\b/.test(d.cls) &&
    /\bf-serif\b/.test(d.cls) && /\bm-wide\b/.test(d.cls) && /\bb-fr\b/.test(d.cls), d.cls);
  check('modèle doc : couleur d’accent verte appliquée', d.accent === '#16a34a', d.accent);
  const sh = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(d.accent2 || '');
  check('modèle doc : nuances dérivées de l’accent (vert dominant)',
    !!sh && parseInt(sh[2], 16) > parseInt(sh[1], 16) && parseInt(sh[2], 16) > parseInt(sh[3], 16), d.accent2);
  check('modèle doc : échéance masquée (2 lignes méta)', d.metaRows === 2, d.metaRows);
  check('modèle doc : montant en lettres masqué', d.words === 0, d.words);
  check('modèle doc : bloc client masqué', d.parties === 0, d.parties);
  check('modèle doc : colonnes Qté/P.U. masquées (3 colonnes)', d.ths === 3, d.ths);
  check('modèle doc : en-tête, conditions et pied libres', d.head && d.terms && d.footer, { head: d.head, terms: d.terms, footer: d.footer });
  check('modèle doc : bloc signature affiché', d.signature === 1, d.signature);
  check('modèle doc : filigrane « BROUILLON »', d.wm === 'BROUILLON', d.wm);
  check('modèle doc : arabe masqué en mode « français seulement »', d.arHidden === true, d.arHidden);
  check('modèle doc : identifiants légaux sélectionnés individuellement',
    /ICE\s*:/.test(d.ids) && /Patente\s*:/.test(d.ids) && /CNSS\s*:/.test(d.ids) &&
    !/IF\s*:/.test(d.ids) && !/RC\s*:/.test(d.ids), d.ids);

  if (hasQuote) {
    const qid = qid0;
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-quote.html'), { query: { id: qid } });
    await wait(800);
    const q = await ev(win, `(function () {
      const sheet = document.querySelector('.sheet');
      return {
        cls: sheet ? sheet.className : '',
        metaRows: document.querySelectorAll('table.meta tr').length,
        title: (document.querySelector('.title h1') || {}).textContent || ''
      };
    })()`);
    check('modèle doc : modèle de devis séparé (« élégant ») + validité conservée',
      /\bt-elegant\b/.test(q.cls) && q.metaRows === 3 && q.title === 'DEVIS', q);
  }
}

/* ---- PHASE 1h : CENTRE D'AIDE (v1.19) ----
   Vérifie le chargement du contenu, les déclencheurs (bouton latéral + « ? »
   par écran), l'aide contextuelle, la recherche, les renvois « Voir aussi »,
   le raccourci F1, la fermeture par Échap et le rendu arabe (RTL). */
async function phaseHelp(win) {
  console.log('--- PHASE 1h : CENTRE D\'AIDE (v1.19) ---');

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  const loaded = await ev(win, `(function () {
    return {
      hasContent: !!window.HELP,
      hasUi: !!window.HELPUI,
      articles: window.HELP ? Object.keys(window.HELP.articles).length : 0,
      cats: window.HELP ? window.HELP.categories.length : 0,
      screens: window.HELP ? window.HELP.SCREENS.length : 0
    };
  })()`);
  check('aide : contenu et moteur chargés',
    loaded.hasContent && loaded.hasUi && loaded.articles >= 41 && loaded.cats >= 5 && loaded.screens === 11, loaded);

  const triggers = await ev(win, `(function () {
    return {
      side: !!document.querySelector('#btn-help'),
      screenBtns: document.querySelectorAll('.help-screen-btn').length,
      views: document.querySelectorAll('.view').length
    };
  })()`);
  check('aide : bouton latéral présent', triggers.side === true, triggers);
  check('aide : bouton « ? » sur chaque écran', triggers.screenBtns === 11, triggers);

  await ev(win, `(function () {
    showView('invoices');
    document.querySelector('#view-invoices .help-screen-btn').click();
    return true;
  })()`);
  await wait(120);
  const opened = await ev(win, `(function () {
    const h = document.querySelector('#help-article .help-h');
    return {
      open: !document.querySelector('#help-root').hidden,
      ui: window.HELPUI.isOpen(),
      title: h ? h.textContent : '',
      focusInside: document.querySelector('#help-root').contains(document.activeElement)
    };
  })()`);
  check('aide : aide contextuelle de l’écran « Factures validées »',
    opened.open && opened.ui && opened.title === 'Les factures validées', opened);
  check('aide : focus déplacé dans le panneau', opened.focusInside === true, opened);

  const beforeRel = await ev(win, `(document.querySelector('#help-article .help-link') || {}).textContent || ''`);
  await ev(win, `document.querySelector('#help-article .help-link').click(); true`);
  await wait(80);
  const afterRel = await ev(win, `(document.querySelector('#help-article .help-h') || {}).textContent || ''`);
  check('aide : les renvois « Voir aussi » naviguent vers un autre article',
    !!beforeRel && !!afterRel && afterRel !== opened.title, { beforeRel, afterRel });

  await ev(win, `(function () {
    const i = document.querySelector('#help-search');
    i.value = 'facture';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(80);
  const search = await ev(win, `(function () {
    return {
      shown: !document.querySelector('#help-results').hidden,
      tocHidden: document.querySelector('#help-toc').hidden,
      hits: document.querySelectorAll('#help-results .help-toc-link').length
    };
  })()`);
  check('aide : la recherche filtre le sommaire', search.shown && search.tocHidden && search.hits >= 3, search);

  await ev(win, `document.querySelector('#help-results .help-toc-link').click(); true`);
  await wait(60);
  const picked = await ev(win, `(document.querySelector('#help-article .help-h') || {}).textContent || ''`);
  check('aide : un résultat ouvre l’article', !!picked, picked);

  await ev(win, `(function () {
    const i = document.querySelector('#help-search');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(60);
  const cleared = await ev(win, `(function () {
    return { resultsHidden: document.querySelector('#help-results').hidden, tocShown: !document.querySelector('#help-toc').hidden };
  })()`);
  check('aide : effacer la recherche rétablit le sommaire', cleared.resultsHidden && cleared.tocShown, cleared);

  await ev(win, `document.querySelector('#help-close').click(); true`);
  await wait(60);
  const closed = await ev(win, `window.HELPUI.isOpen()`);
  check('aide : le bouton Fermer referme le panneau', closed === false, closed);

  await ev(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true })); true`);
  await wait(60);
  const f1 = await ev(win, `(function () {
    return { open: window.HELPUI.isOpen(), title: (document.querySelector('#help-article .help-h') || {}).textContent || '' };
  })()`);
  check('aide : F1 ouvre l’aide de l’écran courant', f1.open && f1.title === 'Les factures validées', f1);

  await ev(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`);
  await wait(60);
  const esc = await ev(win, `window.HELPUI.isOpen()`);
  check('aide : Échap referme le panneau', esc === false, esc);

  await ev(win, `(function () { window.I18N.setLang('ar'); window.HELPUI.openContextual(); return true; })()`);
  await wait(80);
  const ar = await ev(win, `(function () {
    return {
      dir: document.documentElement.getAttribute('dir'),
      title: (document.querySelector('#help-article .help-h') || {}).textContent || '',
      heading: (document.querySelector('#help-title') || {}).textContent || ''
    };
  })()`);
  check('aide : contenu arabe en lecture de droite à gauche',
    ar.dir === 'rtl' && ar.title === 'الفواتير المؤكدة' && ar.heading === 'مركز المساعدة', ar);
  await ev(win, `window.HELPUI.close(); window.I18N.setLang('fr'); true`);
}

/* ---- PHASE 1i : ONBOARDING (v1.20) ----
   Vérifie la visite guidée (5 étapes, mise en évidence, navigation, « Passer »,
   mémoire « ne plus réafficher », RTL) et la checklist « Mise en route »
   alimentée par l'état réel de l'application. */
async function phaseOnboarding(win) {
  console.log('--- PHASE 1i : ONBOARDING (v1.20) ---');

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  const api = await ev(win, `({
    hasApi: !!window.ONBOARD,
    autoHidden: document.querySelector('#tour-root').hidden,
    checklistVisible: !document.querySelector('#setup-card').hidden
  })`);
  check('onboarding : moteur chargé, pas de visite automatique pour un habitué',
    api.hasApi === true && api.autoHidden === true, api);
  check('onboarding : checklist « Mise en route » affichée sur le tableau de bord',
    api.checklistVisible === true, api);

  /* Démarrage manuel de la visite guidée */
  await ev(win, `(function () { state.settings.onboarded = false; window.ONBOARD.start(); return true; })()`);
  await wait(120);
  const s1 = await ev(win, `(function () {
    return {
      open: !document.querySelector('#tour-root').hidden,
      active: window.ONBOARD.isActive(),
      title: document.querySelector('#tour-title').textContent,
      prevDisabled: document.querySelector('#tour-prev').disabled,
      hlHidden: document.querySelector('#tour-hl').hidden,
      focusInside: document.querySelector('#tour-tip').contains(document.activeElement)
    };
  })()`);
  check('onboarding : 1re bulle centrée (bienvenue), sans mise en évidence',
    s1.open && s1.active && s1.title === 'Bienvenue dans MAZ-FATORA' &&
    s1.prevDisabled === true && s1.hlHidden === true, s1);
  check('onboarding : focus déplacé dans la bulle', s1.focusInside === true, s1);

  await ev(win, `document.querySelector('#tour-next').click(); true`);
  await wait(80);
  const s2 = await ev(win, `({
    title: document.querySelector('#tour-title').textContent,
    hlHidden: document.querySelector('#tour-hl').hidden,
    prevDisabled: document.querySelector('#tour-prev').disabled
  })`);
  check('onboarding : étape « Vos écrans » avec mise en évidence de la navigation',
    s2.title === 'Vos écrans' && s2.hlHidden === false && s2.prevDisabled === false, s2);

  await ev(win, `document.querySelector('#tour-skip').click(); true`);
  await wait(80);
  const skip = await ev(win, `({ hidden: document.querySelector('#tour-root').hidden, active: window.ONBOARD.isActive(), seen: state.settings.onboarded === true })`);
  check('onboarding : « Passer » ferme la visite et la mémorise',
    skip.hidden === true && skip.active === false && skip.seen === true, skip);

  await ev(win, `window.ONBOARD.maybeStart(); true`);
  await wait(60);
  const never = await ev(win, `document.querySelector('#tour-root').hidden`);
  check('onboarding : la visite ne se réaffiche plus une fois vue', never === true, never);

  /* Checklist : états dérivés de l'application */
  const c0 = await ev(win, `(function () {
    window.ONBOARD.renderChecklist();
    return {
      visible: !document.querySelector('#setup-card').hidden,
      items: document.querySelectorAll('#setup-list .setup-item').length,
      done: document.querySelectorAll('#setup-list .setup-item.done').length,
      progress: document.querySelector('#setup-progress').textContent
    };
  })()`);
  check('onboarding : checklist composée de 5 étapes, progression calculée',
    c0.visible === true && c0.items === 5 && c0.done >= 1 && /sur 5/.test(c0.progress), c0);

  const c1 = await ev(win, `(function () {
    state.settings.setupChecklist = { backup: true };
    state.invoices.push({ id: 'tmp-onb', status: 'validated', lines: [], payments: [{ id: 'p1', amount: 10 }] });
    window.ONBOARD.renderChecklist();
    return {
      hidden: document.querySelector('#setup-card').hidden,
      done: document.querySelectorAll('#setup-list .setup-item.done').length
    };
  })()`);
  check('onboarding : checklist masquée une fois la mise en route terminée',
    c1.hidden === true && c1.done === 5, c1);
  await ev(win, `state.invoices = state.invoices.filter((i) => i.id !== 'tmp-onb'); true`);

  /* Arabe : RTL + libellés traduits */
  await ev(win, `(function () { window.I18N.setLang('ar'); state.settings.onboarded = false; window.ONBOARD.start(); return true; })()`);
  await wait(80);
  const ar = await ev(win, `({
    dir: document.documentElement.getAttribute('dir'),
    title: document.querySelector('#tour-title').textContent,
    next: document.querySelector('#tour-next').textContent
  })`);
  check('onboarding : visite en arabe (RTL + libellés traduits)',
    ar.dir === 'rtl' && ar.title === 'مرحبًا بك في MAZ-FATORA' && ar.next === 'التالي', ar);
  await ev(win, `document.querySelector('#tour-skip').click(); window.I18N.setLang('fr'); true`);
}

/* ---- PHASE 1j : GUIDE D'UTILISATION IMPRIMABLE (v1.21) ----
   Vérifie le rendu du guide depuis help-content.js (couverture, sommaire,
   articles, aide-mémoire), la version arabe (RTL), l'export PDF et les
   déclencheurs Paramètres → Aide. */
async function phaseGuide(win) {
  console.log('--- PHASE 1j : GUIDE D\'UTILISATION (v1.21) ---');

  const guidePath = path.join(__dirname, '..', 'src', 'renderer', 'print-guide.html');
  const waitRendered = async () => {
    for (let i = 0; i < 40; i += 1) {
      const n = await ev(win, `document.querySelectorAll('#root .g-art').length`);
      if (n > 0) return;
      await wait(100);
    }
  };

  await win.loadFile(guidePath, { query: { lang: 'fr' } });
  await waitRendered();
  const fr = await ev(win, `(function () {
    const cover = document.querySelector('.g-cover');
    return {
      dir: document.documentElement.getAttribute('dir'),
      title: (document.querySelector('.g-cover-title') || {}).textContent || '',
      toc: !!document.querySelector('.g-toc'),
      memo: !!document.querySelector('.g-memo'),
      articles: document.querySelectorAll('#root .g-art').length,
      coverText: cover ? cover.textContent : ''
    };
  })()`);
  check('guide : couverture, sommaire, articles et aide-mémoire rendus (FR)',
    fr.dir === 'ltr' && fr.title === 'Guide d’utilisation' && fr.toc && fr.memo && fr.articles >= 40, fr);
  check('guide : version affichée sur la couverture', /v1\.24/.test(fr.coverText), fr.coverText.slice(0, 100));

  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  check('guide : export PDF non vide (%PDF)',
    pdf && pdf.length > 20000 && pdf.slice(0, 4).toString() === '%PDF', { size: pdf ? pdf.length : 0 });

  await win.loadFile(guidePath, { query: { lang: 'ar' } });
  await waitRendered();
  const ar = await ev(win, `({
    dir: document.documentElement.getAttribute('dir'),
    title: (document.querySelector('.g-cover-title') || {}).textContent || ''
  })`);
  check('guide : version arabe en RTL', ar.dir === 'rtl' && ar.title === 'دليل الاستعمال', ar);

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);
  const wires = await ev(win, `({
    open: !!document.querySelector('#btn-guide-open'),
    pdf: !!document.querySelector('#btn-guide-pdf'),
    api: typeof window.factapi.guidePreview === 'function' && typeof window.factapi.guideExportPdf === 'function'
  })`);
  check('guide : boutons Paramètres → Aide et API guide disponibles',
    wires.open && wires.pdf && wires.api, wires);
}

/* ---- PHASE : avoirs / notes de crédit (v1.24) ---- *
   - numérotation AV-AAAA-NNNN, rattachement obligatoire à une facture validée,
   - impact sur le reste dû (les avoirs validés viennent en déduction),
   - bornage du montant au reste facturable, rendu bilingue du document,
   - suppression du dernier avoir + rembobinage du compteur. */
async function phaseCredits(uiWin) {
  const win = uiWin;
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);

  /* Base propre : une facture validée de 1 200,00 TTC (1 000 HT + 200 TVA) */
  const inv = await ev(win, `(async function () {
    state.invoices = []; state.creditNotes = [];
    state.meta.invoiceSeq = 0; state.meta.creditSeq = 0;
    openInvoiceEditor(null);
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const cs = document.querySelector('#ie-client'); cs.value = state.clients[0].id; cs.dispatchEvent(new Event('change', { bubbles: true }));
    set('#ie-lines input[data-f="desc"]', 'Prestation A');
    set('#ie-lines input[data-f="qty"]', '1');
    set('#ie-lines input[data-f="price"]', '1000');
    document.querySelector('#ie-validate').click();
    await new Promise(function (r) { setTimeout(r, 300); });
    const i = state.invoices[0];
    return { number: i && i.number, ttc: i && totals(i).ttc, rest: i && restDue(i) };
  })()`);
  check('avoir : facture de base validée (1 200,00 TTC, reste dû 1 200,00)',
    /^FA-\d{4}-0001$/.test(inv.number) && inv.ttc === 1200 && inv.rest === 1200, inv);

  /* Création d'un avoir partiel de 600,00 TTC rattaché à la facture */
  const cr = await ev(win, `(async function () {
    const i = state.invoices[0];
    openCreditEditor(null, i.id);
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('#cre-reason', 'Retour partiel de marchandise');
    set('#cre-lines input[data-f="desc"]', 'Retour partiel');
    set('#cre-lines input[data-f="qty"]', '1');
    set('#cre-lines input[data-f="price"]', '500');
    document.querySelector('#cre-validate').click();
    await new Promise(function (r) { setTimeout(r, 350); });
    const c = state.creditNotes[0];
    const i2 = state.invoices[0];
    return {
      n: state.creditNotes.length,
      number: c && c.number,
      status: c && c.status,
      ttc: c && totals(c).ttc,
      reason: c && c.reason,
      refNumber: c && c.refNumber,
      rest: i2 && restDue(i2),
      credited: i2 && creditedTotal(i2),
      modalHidden: document.querySelector('#modal-root').hidden
    };
  })()`);
  check('avoir créé : AV-AAAA-0001 validé, 600,00 TTC rattaché à FA-0001, reste dû réduit à 600,00',
    cr.n === 1 && /^AV-\d{4}-0001$/.test(cr.number) && cr.status === 'validated' &&
    cr.ttc === 600 && !!cr.reason && /^FA-\d{4}-0001$/.test(cr.refNumber) &&
    cr.rest === 600 && cr.credited === 600 && cr.modalHidden, cr);

  const persisted = await ev(win, `window.factapi.storeGet()`);
  check('avoir persisté (collection creditNotes + meta.creditSeq)',
    Array.isArray(persisted.creditNotes) && persisted.creditNotes.length === 1 &&
    persisted.meta.creditSeq === 1 &&
    /^AV-\d{4}-0001$/.test(persisted.creditNotes[0].number),
    { n: persisted.creditNotes.length, seq: persisted.meta.creditSeq });

  /* Bornage : un second avoir ne peut dépasser le reste facturable (600,00) */
  const over = await ev(win, `(async function () {
    const i = state.invoices[0];
    openCreditEditor(null, i.id);
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('#cre-reason', 'Trop élevé');
    set('#cre-lines input[data-f="desc"]', 'Trop élevé');
    set('#cre-lines input[data-f="price"]', '900');
    document.querySelector('#cre-validate').click();
    await new Promise(function (r) { setTimeout(r, 200); });
    const n = state.creditNotes.length;
    closeModal();
    return { n: n };
  })()`);
  check('avoir borné : un avoir dépassant le reste facturable est refusé',
    over.n === 1, over);

  /* Aperçu d'impression : AVOIR bilingue, facture d'origine, motif, sans PAYÉE.
     On repart des réglages de document par défaut (les phases précédentes ont pu
     masquer le montant en lettres). */
  delete storeStub.settings.doc;
  const cid = await ev(win, `state.creditNotes[0].id`);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'print-credit.html'), { query: { id: cid } });
  await wait(800);
  const pc = await ev(win, `(function () {
    const body = document.body.textContent;
    return {
      h1: (document.querySelector('.title h1') || {}).textContent || '',
      ar: (document.querySelector('.title-ar') || {}).textContent || '',
      ref: /Facture d'origine/.test(body),
      refNum: /FA-\\d{4}-0001/.test(body),
      reason: /Retour partiel de marchandise/.test(body),
      badge: !!document.querySelector('.badge-paid'),
      words: /Arrêté le présent avoir/.test(body),
      ttc: /600,00[\\s\\u202f\\u00a0]*MAD/.test(body),
      toolbar: Array.from(document.querySelectorAll('.toolbar button')).map(function (b) { return b.textContent; }).join(' | ')
    };
  })()`);
  check('aperçu avoir : AVOIR / إشعار دائن, facture d\'origine + motif, montant en lettres, sans PAYÉE',
    pc.h1 === 'AVOIR' && pc.ar.indexOf('إشعار دائن') !== -1 && pc.ref && pc.refNum &&
    pc.reason && !pc.badge && pc.words && pc.ttc, pc);
  check('aperçu avoir : barre d\'outils en français', /Fermer/.test(pc.toolbar), pc.toolbar);

  /* Suppression : l'avoir est le dernier de la série → suppression autorisée,
     le compteur est rembobiné. */
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(900);
  const del = await ev(win, `(async function () {
    showView('credits');
    const btn = document.querySelector('#credit-table [data-action="delete-credit"]');
    if (btn) btn.click();
    await new Promise(function (r) { setTimeout(r, 120); });
    const ok = document.querySelector('#cf-ok');
    if (ok) ok.click();
    await new Promise(function (r) { setTimeout(r, 350); });
    return { n: state.creditNotes.length, seq: state.meta.creditSeq };
  })()`);
  check('avoir supprimé (dernier de la série) et compteur rembobiné',
    del.n === 0 && del.seq === 0, del);
}

(async function main() {
  try {
    await app.whenReady();
    const uiWin = await phaseUi();
    await phaseI18n(uiWin);
    await phasePrint(uiWin);
    await phaseExtras(uiWin);
    await phasePdf(uiWin);
    await phaseImportGroup(uiWin);
    await phaseRegressions(uiWin);
    await phaseSelectionDesig(uiWin);
    await phaseDatesNumerotation(uiWin);
    await phaseSecurite(uiWin);
    await phaseLicence(uiWin);
    await phaseExportPack(uiWin);
    await phaseQuotes(uiWin);
    await phaseComptabilisation(uiWin);
    await phaseDocModel(uiWin);
    await phaseOnboarding(uiWin);
    await phaseGuide(uiWin);
    await phaseHelp(uiWin);
    await phaseCredits(uiWin);
  } catch (e) {
    problems.push('exception: ' + (e && e.stack ? e.stack : e));
  }

  console.log('\n--- PROBLEMS ---');
  console.log(problems.length ? problems.join('\n') : 'aucune');
  console.log(problems.length ? 'SMOKE FAIL' : 'SMOKE OK');
  app.exit(problems.length ? 1 : 0);
})();
