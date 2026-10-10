'use strict';

/* MAZ-FATORA — logique côté renderer */

const state = {
  settings: {},
  clients: [],
  invoices: [],
  transactions: [],
  rules: [],
  quotes: [],
  meta: {}
};

let pendingImport = null; // { fileName, entries }
let dataPath = '';        // emplacement du dossier de données (base locale)

/* P0 fiabilisation : remontée d'événements vers le journal du process principal.
   Silencieux si l'IPC n'est pas disponible (tests, versions antérieures). */
function appLog(...args) {
  try {
    const fn = window.factapi && window.factapi.log;
    if (typeof fn !== 'function') return;
    Promise.resolve(fn(...args)).catch(() => { /* non bloquant */ });
  } catch (e) { /* non bloquant */ }
}

window.addEventListener('error', (e) => {
  appLog('renderer:error', e.message, String(e.filename || ''), Number(e.lineno || 0));
});
window.addEventListener('unhandledrejection', (e) => {
  appLog('renderer:unhandledRejection', String((e.reason && e.reason.stack) || e.reason));
});

/* ---------------- Utilitaires ---------------- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* Montants en Dirham marocain : « 1 234,56 MAD » (format français) */
const numFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function currency() { return (state.settings && state.settings.currency) || 'MAD'; }
const money = (n) => numFmt.format(round2(Number(n) || 0)) + ' ' + currency();

const todayISO = () => new Date().toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date((iso || todayISO()) + 'T12:00:00');
  d.setDate(d.getDate() + Number(n || 0));
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateFR(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('fr-FR');
}
const monthKey = (iso) => String(iso || '').slice(0, 7);
const norm = (s) => CSV.norm(s);

/* ---- Date de facture par défaut : le début de la période choisie ----
   Un champ de date marqué « auto » (drapeau dataset.auto) suit le début de la
   période (ou de la sélection) tant que l'utilisateur ne le modifie pas à la main. */
function autoDate(el, value) {
  if (!el || !value) return;
  if (!el.value || el.dataset.auto === '1') {
    el.value = value;
    el.dataset.auto = '1';
  }
}
function manualDate(el) { if (el) delete el.dataset.auto; }
function firstDateOf(list) {
  const d = (list || []).map((t) => (t && t.date) || '').filter(Boolean).sort();
  return d.length ? d[0] : '';
}

let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = type;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

async function persist(...collections) {
  for (const c of collections) await window.factapi.storeSave(c, state[c]);
}

/* ---------------- Données métier ---------------- */

function paymentDelay() { return Number(state.settings.paymentDelay) || 0; }

/* Durée de validité par défaut d'un devis (jours) — réglable dans les Paramètres. */
function quoteValidityDays() {
  const v = Number(state.settings.quoteValidityDays);
  return (v && v > 0) ? v : 30;
}

/* Un devis est « expiré » dès que sa date de validité est passée, sauf si un
   changement de statut le fige (converti, refusé) — l'expiration reste un état
   dérivé affiché en liste, le statut stocké reste celui de l'utilisateur. */
function quoteExpired(q) {
  if (!q) return false;
  if (q.status === 'converted' || q.status === 'rejected') return false;
  return Boolean(q.validUntil) && q.validUntil < todayISO();
}

/* TVA — taux marocains en vigueur : 20 %, 14 %, 10 %, 7 % + exonération 0 % */
const TVA_RATES_MA = [20, 14, 10, 7, 0];
function tvaDefault() {
  const v = state.settings.tvaRate;
  return (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) ? Number(v) : 20;
}
function tvaRates() {
  const base = (Array.isArray(state.settings.tvaRates) && state.settings.tvaRates.length)
    ? state.settings.tvaRates : TVA_RATES_MA;
  return base.map(Number).filter((n) => !isNaN(n));
}
/* Options d'un <select> de taux, la valeur courante étant toujours proposée */
function tvaOptionsHTML(value) {
  const v = Number(value);
  const rates = [...tvaRates()];
  if (rates.indexOf(v) === -1) rates.push(isNaN(v) ? 0 : v);
  rates.sort((a, b) => b - a);
  return rates.map((r) => `<option value="${r}" ${r === v ? 'selected' : ''}>${r} %</option>`).join('');
}
function clientById(id) { return state.clients.find((c) => c.id === id) || null; }
function invoiceById(id) { return state.invoices.find((i) => i.id === id) || null; }
function quoteById(id) { return state.quotes.find((q) => q.id === id) || null; }
function txById(id) { return state.transactions.find((t) => t.id === id) || null; }

function clientNameOf(inv) {
  const c = clientById(inv.clientId);
  if (c) return c.name;
  return inv.clientName || tr('common.noClient');
}

function totals(inv) {
  let ht = 0, tva = 0;
  for (const l of inv.lines || []) {
    const lineHT = (Number(l.qty) || 0) * (Number(l.price) || 0);
    ht += lineHT;
    tva += lineHT * ((Number(l.tva) || 0) / 100);
  }
  ht = round2(ht); tva = round2(tva);
  return { ht, tva, ttc: round2(ht + tva) };
}

/* ---------------- Suivi des paiements ---------------- */

const METHODS = ['cash', 'transfer', 'cheque', 'card', 'direct', 'other'];
const METHOD_KEYS = {
  cash: 'paym.mCash',
  transfer: 'paym.mTransfer',
  cheque: 'paym.mCheque',
  card: 'paym.mCard',
  direct: 'paym.mDirect',
  other: 'paym.mOther'
};
const methodLabel = (m) => tr(METHOD_KEYS[m] || 'paym.mOther');

/* Historique des règlements d'une facture */
function paymentList(inv) {
  return Array.isArray(inv.payments) ? inv.payments : [];
}

/* Montant encaissé : liste de règlements, sinon l'ancien booléen « payée » */
function paidAmount(inv) {
  const recs = paymentList(inv);
  if (recs.length) return round2(recs.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  return inv.paid ? round2(totals(inv).ttc) : 0;
}

function restDue(inv) {
  return Math.max(0, round2(totals(inv).ttc - paidAmount(inv)));
}

function isPaid(inv) { return restDue(inv) <= 0.005; }

/* 'paid' | 'partial' | 'unpaid' */
function payStatus(inv) {
  if (isPaid(inv)) return 'paid';
  return paidAmount(inv) > 0 ? 'partial' : 'unpaid';
}

function isLate(inv) {
  return inv.status === 'validated' && !isPaid(inv) && !!inv.dueDate && inv.dueDate < todayISO();
}

function payPill(inv) {
  const st = payStatus(inv);
  const cls = st === 'paid' ? 'green' : (st === 'partial' ? 'amber' : 'red');
  const label = st === 'paid' ? tr('pay.pillPaid') : (st === 'partial' ? tr('pay.pillPartial') : tr('pay.pillUnpaid'));
  let html = `<span class="pill ${cls}">${label}</span>`;
  if (isLate(inv)) html += ` <span class="pill red">${tr('pay.pillLate')}</span>`;
  return html;
}

/* Encours : total facturé / encaissé / restant à encaisser (factures validées) */
function collectStats() {
  const list = state.invoices.filter((i) => i.status === 'validated');
  const billed = round2(list.reduce((s, i) => s + totals(i).ttc, 0));
  const received = round2(list.reduce((s, i) => s + paidAmount(i), 0));
  const due = round2(list.reduce((s, i) => s + restDue(i), 0));
  const lateList = list.filter((i) => isLate(i));
  const late = round2(lateList.reduce((s, i) => s + restDue(i), 0));
  return {
    list,
    billed,
    received,
    due,
    late,
    nBilled: list.length,
    nReceived: list.reduce((s, i) => s + paymentList(i).length, 0),
    nUnpaid: list.filter((i) => !isPaid(i)).length,
    nLate: lateList.length
  };
}

function findRule(label) {
  const n = norm(label);
  let best = null, bestScore = 0;
  for (const r of state.rules) {
    const kws = (r.keywords || []).map((k) => norm(k)).filter(Boolean);
    if (!kws.length) continue;
    const score = kws.filter((k) => n.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function draftFromTx(tx) {
  const rule = findRule(tx.label);
  const client = rule && rule.clientId ? clientById(rule.clientId) : null;
  const tvaRate = rule && rule.tva !== undefined && rule.tva !== null && rule.tva !== ''
    ? Number(rule.tva) : tvaDefault();
  const derivedHT = round2(tx.amount / (1 + tvaRate / 100));
  /* Date de facture par défaut : date de la transaction facturée */
  const issue = tx.date || todayISO();
  let price = derivedHT;
  if (rule && rule.price !== undefined && rule.price !== null && rule.price !== '') {
    price = Number(rule.price);
  }
  return {
    id: uid(),
    status: 'draft',
    number: null,
    clientId: client ? client.id : null,
    clientName: client ? client.name : '',
    issueDate: issue,
    dueDate: addDays(issue, paymentDelay()),
    lines: [{
      desc: desigForClient(client ? client.id : null) || (rule && rule.desc) || tx.label,
      qty: 1,
      price,
      tva: tvaRate
    }],
    notes: '',
    transactionId: tx.id,
    transactionIds: [tx.id],
    paid: true,
    createdAt: new Date().toISOString(),
    validatedAt: null
  };
}

/* Facture rattachée à un client choisi (période + client unique) */
function draftForClient(tx, o) {
  const tva = Number(o.tva) || 0;
  const price = round2(tx.amount / (1 + tva / 100));
  const desig = o.desig !== undefined && o.desig !== null ? o.desig : desigForClient(o.clientId);
  return {
    id: uid(),
    status: 'draft',
    number: null,
    clientId: o.clientId || null,
    clientName: o.clientName || '',
    issueDate: o.issueDate,
    dueDate: o.dueDate,
    lines: [{ desc: desig || tx.label, qty: 1, price, tva }],
    notes: '',
    transactionId: tx.id,
    transactionIds: [tx.id],
    paid: true,
    createdAt: new Date().toISOString(),
    validatedAt: null
  };
}

/* ---------------- Désignations de facture (paramétrées par client) ----------------
   Liste gérée dans Paramètres (settings.designations) ; chaque client peut avoir
   une désignation par défaut (client.desig) appliquée aux lignes des factures
   générées à l'import — toujours modifiable ensuite dans l'éditeur. */
function desigList() {
  const l = state.settings.designations;
  return Array.isArray(l) ? l : [];
}

function desigForClient(clientId) {
  if (!clientId) return '';
  const c = clientById(clientId);
  return (c && c.desig) ? c.desig : '';
}

function buildGroupInvoice(list, o) {
  const tva = Number(o.tva) || 0;
  const desig = o.desig !== undefined && o.desig !== null ? o.desig : desigForClient(o.clientId);
  return {
    id: uid(),
    status: 'draft',
    number: null,
    clientId: o.clientId || null,
    clientName: o.clientName || '',
    issueDate: o.issueDate,
    dueDate: o.dueDate,
    lines: list.map((t) => ({ desc: desig || t.label, qty: 1, price: round2(t.amount / (1 + tva / 100)), tva })),
    notes: o.notes || '',
    transactionId: null,
    transactionIds: list.map((t) => t.id),
    paid: true,
    createdAt: new Date().toISOString(),
    validatedAt: null
  };
}

function generateDrafts(txs, opts) {
  const created = [];
  for (const tx of txs) {
    if (!(tx.amount > 0)) continue;
    if (tx.status === 'ignored') continue;
    if (tx.linkedInvoiceId && invoiceById(tx.linkedInvoiceId)) continue;
    const inv = draftFromTx(tx);
    /* Les factures générées reprennent la date de facture choisie (début de la période par défaut) */
    if (opts && opts.issueDate) {
      inv.issueDate = opts.issueDate;
      inv.dueDate = opts.dueDate || addDays(opts.issueDate, paymentDelay());
    }
    state.invoices.push(inv);
    tx.linkedInvoiceId = inv.id;
    created.push(inv);
  }
  return created;
}

function assignNumber(inv) {
  const year = String(inv.issueDate || todayISO()).slice(0, 4);
  /* Début de numérotation paramétré (Paramètres) : le premier numéro attribué
     ne descend jamais en dessous de cette valeur. */
  const start = Math.max(1, Math.floor(Number(state.settings.invoiceStart) || 1));
  let seq = Number(state.meta.invoiceSeq || 0);
  if (seq < start - 1) seq = start - 1;
  seq += 1;
  state.meta.invoiceSeq = seq;
  const prefix = String(state.settings.invoicePrefix || 'FA').trim() || 'FA';
  inv.number = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
  /* Séquence mémorisée sur la facture : permet d'identifier la « dernière »
     (numéro le plus élevé) et de rembobiner le compteur à sa suppression. */
  inv.seq = seq;
  inv.seqYear = year;
  inv.status = 'validated';
  inv.validatedAt = new Date().toISOString();
  if (inv.transactionId) inv.paid = true;
}

/* Séquence d'une facture : champ `seq` (v1.16+), sinon extraite du numéro
   FA-AAAA-NNNN pour les factures créées avant cette version. 0 = inconnue. */
function invoiceSeqOf(inv) {
  if (inv && Number(inv.seq)) return Number(inv.seq);
  const m = /-(\d{3,})$/.exec(String((inv && inv.number) || ''));
  return m ? Number(m[1]) : 0;
}

/* Dernière facture validée ? (aucune autre facture validée n'a une séquence
   supérieure). Sert de verrou de suppression pour ne jamais créer de trou. */
function isLastValidatedInvoice(inv) {
  const seq = invoiceSeqOf(inv);
  if (!seq) return false;
  return !state.invoices.some((i) => i.status === 'validated' && i.id !== inv.id && invoiceSeqOf(i) > seq);
}

/* Verrou de suppression d'une facture : renvoie { ok, reason (clé i18n) }.
   - brouillon : toujours supprimable ;
   - facture validée : seulement la dernière, sans règlement et non comptabilisée. */
function deleteInvoiceGuard(inv) {
  if (!inv) return { ok: false, reason: 'common.notFound' };
  if (inv.status !== 'validated') return { ok: true };
  if (isAccounted(inv)) return { ok: false, reason: 'di.errAccounted' };
  if (paymentList(inv).length) return { ok: false, reason: 'di.errPaid' };
  if (!isLastValidatedInvoice(inv)) return { ok: false, reason: 'di.errNotLast' };
  return { ok: true };
}

/* ---------------- Comptabilisation des factures (mois transmis) ----------------
   Une facture « comptabilisée » (comptable) n'est plus modifiable ni supprimable ;
   les encaissements restent possibles (évènement postérieur à la comptabilisation). */

function isAccounted(inv) { return !!(inv && inv.accountedAt); }

/* Mois de rattachement = année-mois de la date de facture (AAAA-MM). */
function monthKeyOf(inv) { return String((inv && inv.issueDate) || '').slice(0, 7); }

function pushAccountingLog(entry) {
  if (!Array.isArray(state.meta.accountingLog)) state.meta.accountingLog = [];
  state.meta.accountingLog.unshift(entry);
  if (state.meta.accountingLog.length > 500) state.meta.accountingLog.length = 500;
}

/* Marque comme comptabilisées toutes les factures validées non comptabilisées
   du mois (AAAA-MM). Réversible via unaccountPeriod(). */
async function accountPeriod(period) {
  const list = state.invoices.filter((i) => i.status === 'validated' && !isAccounted(i) && monthKeyOf(i) === period);
  if (!list.length) { toast(tr('acc.none', { m: period }), 'error'); return false; }
  if (!(await confirmBox(tr('acc.confirm', { m: period, n: list.length }), { okLabel: tr('acc.do') }))) return false;
  const at = new Date().toISOString();
  list.forEach((i) => { i.accountedAt = at; i.accountedPeriod = period; });
  pushAccountingLog({ action: 'account', period, count: list.length, at });
  await persist('invoices', 'meta');
  renderAll();
  toast(tr('acc.done', { n: list.length, m: period }), 'success');
  return true;
}

/* Dé-comptabilise un mois (correction) : trace conservée dans le journal. */
async function unaccountPeriod(period) {
  const list = state.invoices.filter((i) => isAccounted(i) && i.accountedPeriod === period);
  if (!list.length) { toast(tr('acc.noneAccounted', { m: period }), 'error'); return false; }
  if (!(await confirmBox(tr('acc.unconfirm', { m: period, n: list.length }), { okLabel: tr('acc.undo'), okClass: 'danger' }))) return false;
  const at = new Date().toISOString();
  list.forEach((i) => { delete i.accountedAt; delete i.accountedPeriod; });
  pushAccountingLog({ action: 'unaccount', period, count: list.length, at });
  await persist('invoices', 'meta');
  renderAll();
  toast(tr('acc.undone', { n: list.length, m: period }), 'success');
  return true;
}

/* Boîte de dialogue « Comptabiliser le mois… » (choix du mois + actions). */
function openAccountPeriodModal(defPeriod) {
  const months = state.invoices.filter((i) => i.status === 'validated').map(monthKeyOf).filter(Boolean).sort();
  const def = defPeriod || months[months.length - 1] || todayISO().slice(0, 7);
  openModal(`
    <h2>${tr('acc.title')}</h2>
    <p class="modal-sub">${tr('acc.sub')}</p>
    <div class="form-grid">
      <label>${tr('acc.month')} <input type="month" id="acc-month" value="${esc(def)}"></label>
    </div>
    <p class="hint" id="acc-info"></p>
    <div class="modal-actions">
      <button class="btn" id="acc-cancel">${tr('common.cancel')}</button>
      <button class="btn danger" id="acc-unaccount">${tr('acc.undo')}</button>
      <button class="btn primary" id="acc-do">${tr('acc.do')}</button>
    </div>`);
  function refresh() {
    const m = $('#acc-month').value;
    const todo = state.invoices.filter((i) => i.status === 'validated' && !isAccounted(i) && monthKeyOf(i) === m).length;
    const done = state.invoices.filter((i) => isAccounted(i) && i.accountedPeriod === m).length;
    $('#acc-info').textContent = tr('acc.info', { todo, done, m });
    $('#acc-do').disabled = todo === 0;
    $('#acc-unaccount').disabled = done === 0;
  }
  refresh();
  $('#acc-month').addEventListener('change', refresh);
  $('#acc-cancel').addEventListener('click', closeModal);
  $('#acc-do').addEventListener('click', async () => {
    const m = $('#acc-month').value;
    if (m && await accountPeriod(m)) closeModal();
  });
  $('#acc-unaccount').addEventListener('click', async () => {
    const m = $('#acc-month').value;
    if (m && await unaccountPeriod(m)) closeModal();
  });
}

/* Numérotation des DEVIS : séquence distincte (DV-AAAA-NNNN) — meta.quoteSeq
   est indépendant de meta.invoiceSeq ; attribuée à la création, jamais réattribuée. */
function assignQuoteNumber(q) {
  const year = String(q.issueDate || todayISO()).slice(0, 4);
  let seq = Number(state.meta.quoteSeq || 0) + 1;
  state.meta.quoteSeq = seq;
  const prefix = String(state.settings.quotePrefix || 'DV').trim() || 'DV';
  q.number = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

/* ---------------- Navigation ---------------- */

function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'import') {
    /* Date de facture par défaut : le début de la période choisie */
    const lot = pendingImport
      ? pendingImport.entries.filter((e) => inImportPeriod(e) && e.amount > 0)
      : [];
    autoDate($('#import-issue-date'), $('#import-from').value || firstDateOf(lot) || todayISO());
    autoDate($('#import-due-date'), addDays($('#import-issue-date').value || todayISO(), paymentDelay()));
  }
}

/* ---------------- Rendu ---------------- */

function renderAll() {
  renderSidebar();
  renderDashboard();
  renderTransactions();
  renderDrafts();
  renderValidated();
  renderQuotes();
  renderPayments();
  renderClients();
  renderRules();
  renderSettings();
  renderDesignations();
}

function renderSidebar() {
  const co = state.settings.company || {};
  const name = co.name || (licState.configured && licState.customer ? licState.customer : '');
  $('#sidebar-company').textContent = name || tr('side.noCompany');
}

/* ---- Tableau de bord : graphiques + variations (axe C) ---- */

/* Décalage d'un mois (clé 'AAAA-MM', signé) */
function shiftMonth(mk, n) {
  const d = new Date(String(mk || todayISO()).slice(0, 7) + '-01T12:00:00');
  d.setMonth(d.getMonth() + Number(n || 0));
  const pad = (v) => String(v).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

/* Libellé court d'un mois selon la langue courante */
function monthLabel(mk) {
  const d = new Date(mk + '-01T12:00:00');
  if (isNaN(d.getTime())) return mk;
  const locale = (typeof I18N !== 'undefined' && I18N.getLang() === 'ar') ? 'ar' : 'fr-FR';
  try { return d.toLocaleDateString(locale, { month: 'short' }); } catch (e) { return mk; }
}

/* Variation en % vs la période précédente (puce colorée ↗ / ↘ / —) */
function trendChip(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (p <= 0) return '<span class="trend flat">—</span>';
  const r = Math.round(((c - p) / p) * 100);
  const cls = r > 0 ? 'up' : (r < 0 ? 'down' : 'flat');
  const ic = r > 0 ? 'i-arrow-up' : (r < 0 ? 'i-arrow-down' : 'i-chev');
  return `<span class="trend ${cls}" title="${esc(tr('dash.prevMonth'))}"><svg class="ic"><use href="#${ic}"/></svg>${r > 0 ? '+' : ''}${r} %</span>`;
}

/* Graphiques : CA des 12 derniers mois (barres) + donut encaissé / à encaisser */
function renderCharts(mk) {
  const months = [];
  for (let k = 11; k >= 0; k--) months.push(shiftMonth(mk, -k));
  const vals = months.map((mm) => state.invoices.reduce((s, i) => {
    if (i.status !== 'validated') return s;
    return s + ((monthKey(i.validatedAt || i.issueDate) === mm) ? totals(i).ttc : 0);
  }, 0));
  const max = Math.max.apply(null, vals.concat([1]));
  const curIdx = months.indexOf(mk);
  const bars = $('#chart-bars');
  if (bars) {
    bars.innerHTML = vals.map((v, idx) => `
      <div class="bar" title="${esc(money(v))}">
        <div class="bar-tt">${esc(money(v))}</div>
        <div class="bar-fill${(idx !== curIdx && v === 0) ? ' quiet' : ''}" style="height:${Math.max(2, Math.round((v / max) * 100))}%"></div>
        <span class="bar-label">${esc(monthLabel(months[idx]))}</span>
      </div>`).join('');
  }
  const allValidated = state.invoices.filter((i) => i.status === 'validated');
  const billed = allValidated.reduce((s, i) => s + totals(i).ttc, 0);
  const rest = allValidated.reduce((s, i) => s + Math.max(0, restDue(i)), 0);
  const got = Math.max(0, billed - rest);
  const donut = $('#chart-donut');
  if (donut) {
    const C = 2 * Math.PI * 54;
    const pGot = (billed > 0) ? Math.min(1, got / billed) : 0;
    donut.innerHTML = `
      <div class="donut">
        <svg width="138" height="138" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle class="donut-bg" cx="60" cy="60" r="54"/>
          <circle class="donut-seg" cx="60" cy="60" r="54"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pGot)).toFixed(1)}"/>
        </svg>
        <div class="donut-center">
          <b>${esc(money(billed))}</b>
          <span>${esc(tr('pay.statBilled'))}</span>
        </div>
      </div>
      <div class="donut-legend">
        <span class="lk"><span class="sw got"></span>${esc(tr('dash.chartCollected'))}<b>${esc(money(got))}</b></span>
        <span class="lk"><span class="sw rest"></span>${esc(tr('dash.chartRest'))}<b>${esc(money(rest))}</b></span>
      </div>`;
  }
}

function renderDashboard() {
  const drafts = state.invoices.filter((i) => i.status === 'draft');
  const validated = state.invoices.filter((i) => i.status === 'validated');
  const curMonth = monthKey(todayISO());

  /* Mois affiché : celui du sélecteur (par défaut le mois courant) */
  const mSel = $('#dash-month');
  if (mSel && !mSel.value) mSel.value = curMonth;
  const m = (mSel && mSel.value) || curMonth;

  const thisMonth = validated.filter((i) => monthKey(i.validatedAt || i.issueDate) === m);
  const prevMonth = shiftMonth(m, -1);
  const thisTtc = thisMonth.reduce((s, i) => s + totals(i).ttc, 0);
  const prevTtc = validated
    .filter((i) => monthKey(i.validatedAt || i.issueDate) === prevMonth)
    .reduce((s, i) => s + totals(i).ttc, 0);
  const credits = state.transactions.filter((t) => t.amount > 0 && t.status !== 'ignored');
  const pending = state.transactions.filter((t) => t.amount > 0 && t.status !== 'ignored' && !t.linkedInvoiceId);

  $('#stat-drafts').textContent = drafts.length;
  $('#stat-drafts-total').textContent = money(drafts.reduce((s, i) => s + totals(i).ttc, 0));
  $('#stat-validated').textContent = thisMonth.length;
  $('#stat-validated-total').innerHTML = money(thisTtc) + trendChip(thisTtc, prevTtc);
  $('#stat-credits').textContent = credits.length;
  $('#stat-credits-total').textContent = money(credits.reduce((s, t) => s + t.amount, 0));
  $('#stat-pending').textContent = pending.length;

  /* Encours à encaisser (factures validées) */
  const enc = collectStats();
  $('#stat-due').textContent = money(enc.due);
  $('#stat-due-sub').textContent = enc.nUnpaid ? tr('pay.nUnpaid', { n: enc.nUnpaid }) : tr('pay.nInvoices', { n: 0 });

  /* Onboarding : invite tant que l'entreprise n'est pas configurée */
  const coName = (state.settings.company && state.settings.company.name) || '';
  const wel = $('#welcome-banner');
  if (wel) wel.hidden = !!coName;

  /* Onboarding : checklist « Mise en route » (masquée une fois complète) */
  if (window.ONBOARD) window.ONBOARD.renderChecklist();

  renderCharts(m);

  $('#dash-drafts').innerHTML = drafts.slice(0, 6).map((inv) => `
    <div class="list-item">
      <div>
        <div class="li-main">${esc(clientNameOf(inv))}</div>
        <div class="li-sub">${tr('dash.dueLine', { d: dateFR(inv.issueDate), e: dateFR(inv.dueDate) })}</div>
      </div>
      <div class="row">
        <strong>${money(totals(inv).ttc)}</strong>
        <button class="btn small" data-action="edit-invoice" data-id="${inv.id}">${tr('common.open')}</button>
      </div>
    </div>`).join('') || '<div class="empty">' + tr('dash.emptyDrafts') + '</div>';

  const recent = [...validated].sort((a, b) => String(b.validatedAt || '').localeCompare(String(a.validatedAt || ''))).slice(0, 6);
  $('#dash-recent').innerHTML = recent.map((inv) => `
    <div class="list-item">
      <div>
        <div class="li-main">${esc(inv.number)} · ${esc(clientNameOf(inv))}</div>
        <div class="li-sub">${dateFR(inv.issueDate)} · ${payPill(inv)}</div>
      </div>
      <div class="row">
        <strong>${money(totals(inv).ttc)}</strong>
        <button class="btn small" data-action="preview-invoice" data-id="${inv.id}">${tr('common.preview')}</button>
      </div>
    </div>`).join('') || '<div class="empty">' + tr('dash.emptyValidated') + '</div>';
}

function txStatusPill(tx) {
  if (tx.status === 'ignored') return '<span class="pill">' + tr('tx.pillIgnored') + '</span>';
  if (tx.linkedInvoiceId) {
    const inv = invoiceById(tx.linkedInvoiceId);
    const ref = inv ? (inv.number || tr('common.draft')) : '';
    return `<span class="pill blue">${esc(tr('tx.pillInvoice', { ref }))}</span>`;
  }
  if (tx.amount < 0) return '<span class="pill">' + tr('tx.pillExpense') + '</span>';
  return '<span class="pill amber">' + tr('tx.pillTodo') + '</span>';
}

function renderTransactions() {
  const q = norm($('#tx-search').value);
  const f = $('#tx-filter').value;

  let list = [...state.transactions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  list = list.filter((tx) => {
    if (f === 'new' && (tx.linkedInvoiceId || tx.status === 'ignored')) return false;
    if (f === 'linked' && !tx.linkedInvoiceId) return false;
    if (f === 'ignored' && tx.status !== 'ignored') return false;
    if (f === 'credit' && !(tx.amount > 0)) return false;
    if (f === 'debit' && !(tx.amount < 0)) return false;
    if (q && !norm(tx.label).includes(q)) return false;
    return true;
  });

  $('#tx-count').textContent = tr('tx.count', { n: list.length, total: state.transactions.length });

  const rows = list.map((tx) => `
    <tr>
      <td>${dateFR(tx.date)}</td>
      <td>${esc(tx.label)}</td>
      <td class="num ${tx.amount >= 0 ? 'amount-credit' : 'amount-debit'}">${money(tx.amount)}</td>
      <td>${txStatusPill(tx)}</td>
      <td>
        <div class="row-actions">
          ${tx.amount > 0 && !tx.linkedInvoiceId && tx.status !== 'ignored'
            ? `<button class="btn small" data-action="draft-from-tx" data-id="${tx.id}">${tr('tx.create')}</button>` : ''}
          ${tx.status !== 'ignored'
            ? `<button class="btn small" data-action="ignore-tx" data-id="${tx.id}">${tr('tx.ignore')}</button>`
            : `<button class="btn small" data-action="restore-tx" data-id="${tx.id}">${tr('tx.restore')}</button>`}
        </div>
      </td>
    </tr>`).join('');

  $('#tx-table').innerHTML = `
    <thead><tr><th>${tr('common.date')}</th><th>${tr('common.label')}</th><th class="num">${tr('common.amount')}</th><th>${tr('common.status')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="empty">${tr('tx.empty')}</td></tr>`}</tbody>`;
}

function renderDrafts() {
  const drafts = state.invoices.filter((i) => i.status === 'draft');
  $('#drafts-count').textContent = drafts.length;
  $('#drafts-count').classList.toggle('zero', drafts.length === 0);
  $('#nav-drafts-count').textContent = drafts.length;
  $('#nav-drafts-count').classList.toggle('zero', drafts.length === 0);

  const rows = [...drafts]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((inv) => {
      const txnIds = [inv.transactionId, ...(inv.transactionIds || [])].filter(Boolean);
      const txs = txnIds.map(txById).filter(Boolean);
      const src = txs.length > 1
        ? `<span class="pill green">${tr('drafts.srcMulti', { n: txs.length, v: money(txs.reduce((s, t) => s + t.amount, 0)) })}</span>`
        : txs.length === 1
          ? `<span class="pill green">${tr('drafts.srcOne', { v: money(txs[0].amount) })}</span>`
          : '<span class="pill">' + tr('drafts.srcManual') + '</span>';
      return `
      <tr>
        <td>${esc(clientNameOf(inv))}</td>
        <td>${dateFR(inv.issueDate)}</td>
        <td>${dateFR(inv.dueDate)}</td>
        <td class="num"><strong>${money(totals(inv).ttc)}</strong></td>
        <td>${src}</td>
        <td>
          <div class="row-actions">
            <button class="btn small" data-action="edit-invoice" data-id="${inv.id}">${tr('common.open')}</button>
            <button class="btn small success" data-action="validate-invoice" data-id="${inv.id}">${tr('common.validate')}</button>
            <button class="btn small" data-action="preview-invoice" data-id="${inv.id}">${tr('common.preview')}</button>
            <button class="btn small danger" data-action="delete-invoice" data-id="${inv.id}">${tr('common.delete')}</button>
          </div>
        </td>
      </tr>`;
    }).join('');

  $('#draft-table').innerHTML = `
    <thead><tr><th>${tr('common.client')}</th><th>${tr('common.date')}</th><th>${tr('common.due')}</th><th class="num">${tr('common.total')}</th><th>${tr('common.source')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="empty">${tr('drafts.empty')}</td></tr>`}</tbody>`;
}

function renderValidated() {
  const q = norm($('#inv-search').value);
  const f = $('#inv-filter') ? $('#inv-filter').value : 'all';
  let list = state.invoices.filter((i) => i.status === 'validated');
  if (f === 'accounted') list = list.filter(isAccounted);
  else if (f === 'open') list = list.filter((i) => !isAccounted(i));
  if (q) list = list.filter((i) => norm(i.number + ' ' + clientNameOf(i)).includes(q));
  list.sort((a, b) => String(b.number || '').localeCompare(String(a.number || '')));

  const rows = list.map((inv) => {
    const accounted = isAccounted(inv);
    const guard = deleteInvoiceGuard(inv);
    /* Une facture comptabilisée n'est plus modifiable ni supprimable (encaissements
       toujours possibles). Le verrou explique la raison dans son infobulle. */
    const editBtn = accounted
      ? `<button class="btn small" data-action="noop" disabled title="${esc(tr('inv.lockedEdit'))}">🔒 ${tr('common.open')}</button>`
      : `<button class="btn small" data-action="edit-invoice" data-id="${inv.id}">${tr('common.open')}</button>`;
    const delBtn = accounted
      ? `<button class="btn small" data-action="noop" disabled title="${esc(tr('di.errAccounted'))}">🔒</button>`
      : guard.ok
        ? `<button class="btn small danger" data-action="delete-invoice" data-id="${inv.id}">${tr('common.delete')}</button>`
        : `<button class="btn small" data-action="noop" disabled title="${esc(tr(guard.reason))}">🔒</button>`;
    return `
    <tr>
      <td><strong>${esc(inv.number)}</strong></td>
      <td>${esc(clientNameOf(inv))}</td>
      <td>${dateFR(inv.issueDate)}</td>
      <td>${dateFR(inv.dueDate)}</td>
      <td class="num"><strong>${money(totals(inv).ttc)}</strong></td>
      <td>${payPill(inv)}<div class="muted small">${tr('inv.paidOf', { p: money(paidAmount(inv)), r: money(restDue(inv)) })}</div></td>
      <td>${accounted ? `<span class="pill blue" title="${esc(tr('inv.accountedOn', { d: dateFR(String(inv.accountedAt).slice(0, 10)) }))}">${tr('inv.accounted')}</span>` : ''}</td>
      <td>
        <div class="row-actions">
          ${editBtn}
          <button class="btn small" data-action="preview-invoice" data-id="${inv.id}">${tr('common.preview')}</button>
          <button class="btn small" data-action="pdf-invoice" data-id="${inv.id}">PDF</button>
          <button class="btn small" data-action="pay-invoice" data-id="${inv.id}">${isPaid(inv) ? tr('pay.history') : tr('pay.action')}</button>
          ${delBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  $('#inv-table').innerHTML = `
    <thead><tr><th>${tr('inv.number')}</th><th>${tr('common.client')}</th><th>${tr('common.date')}</th><th>${tr('common.due')}</th><th class="num">${tr('common.total')}</th><th>${tr('inv.reglement')}</th><th>${tr('inv.accountedCol')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" class="empty">${tr('inv.empty')}</td></tr>`}</tbody>`;
}

/* ---------------- Devis (vue) ---------------- */

/* Libellés i18n des statuts éditables d'un devis (le smoke contrôle que chaque
   clé référencée existe en FR et AR). */
const QUOTE_STATUS_KEY = {
  draft: 'quo.statusDraft',
  sent: 'quo.statusSent',
  accepted: 'quo.statusAccepted',
  rejected: 'quo.statusRejected'
};

/* Pastille d'état d'un devis — la couleur reflète le statut réel (l'expiration
   est un état dérivé : elle ne remplace jamais le statut enregistré). */
function quoteStatusMeta(q) {
  const expired = quoteExpired(q);
  if (expired) return { label: tr('quo.statusExpired'), cls: 'amber' };
  switch (q.status) {
    case 'sent': return { label: tr('quo.statusSent'), cls: 'blue' };
    case 'accepted': return { label: tr('quo.statusAccepted'), cls: 'green' };
    case 'converted': return { label: tr('quo.statusConverted'), cls: 'blue' };
    case 'rejected': return { label: tr('quo.statusRejected'), cls: 'red' };
    default: return { label: tr('quo.statusDraft'), cls: '' };
  }
}

function renderQuotes() {
  const q = norm($('#quote-search').value);
  const f = $('#quote-filter').value;
  let list = state.quotes.slice();
  if (f !== 'all') list = list.filter((it) => (f === 'expired' ? quoteExpired(it) : it.status === f));
  if (q) list = list.filter((it) => norm((it.number || '') + ' ' + (it.clientName || '')).includes(q));
  list.sort((a, b) => String(b.number || '').localeCompare(String(a.number || '')));

  const total = state.quotes.length;
  $('#quotes-count').textContent = total;
  $('#quotes-count').classList.toggle('zero', total === 0);
  $('#nav-quotes-count').textContent = total;
  $('#nav-quotes-count').classList.toggle('zero', total === 0);

  const rows = list.map((qo) => {
    const meta = quoteStatusMeta(qo);
    const st = qo.status;
    const convertedInv = qo.convertedInvoiceId ? invoiceById(qo.convertedInvoiceId) : null;
    const convertable = ['draft', 'sent', 'accepted'].includes(st) && !quoteExpired(qo);
    return `
    <tr>
      <td><strong>${esc(qo.number || '—')}</strong>
        ${convertedInv ? `<div class="muted small">${tr('quo.quoteRef', { n: convertedInv.number || '' })}</div>` : ''}
      </td>
      <td>${esc(qo.clientName || tr('common.noClient'))}</td>
      <td>${dateFR(qo.issueDate)}</td>
      <td>${dateFR(qo.validUntil)}${quoteExpired(qo) ? ` <span class="pill small amber">${tr('quo.statusExpired')}</span>` : ''}</td>
      <td class="num"><strong>${money(totals(qo).ttc)}</strong></td>
      <td><span class="pill ${meta.cls}">${esc(meta.label)}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn small" data-action="edit-quote" data-id="${qo.id}">${tr('common.open')}</button>
          ${convertable ? `<button class="btn small success" data-action="convert-quote" data-id="${qo.id}">${tr('quo.convert')}</button>` : ''}
          <button class="btn small" data-action="preview-quote" data-id="${qo.id}">${tr('common.preview')}</button>
          <button class="btn small" data-action="pdf-quote" data-id="${qo.id}">PDF</button>
          <button class="btn small danger" data-action="delete-quote" data-id="${qo.id}">${tr('common.delete')}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $('#quote-table').innerHTML = `
    <thead><tr><th>${tr('quo.number')}</th><th>${tr('common.client')}</th><th>${tr('common.date')}</th><th>${tr('quo.validity')}</th><th class="num">${tr('common.total')}</th><th>${tr('common.status')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="empty">${tr('quo.empty')}</td></tr>`}</tbody>`;
}

/* ---------------- Suivi des paiements (vue) ---------------- */

function renderPayments() {
  const enc = collectStats();

  $('#pay-stat-billed').textContent = money(enc.billed);
  $('#pay-stat-billed-sub').textContent = tr('pay.nInvoices', { n: enc.nBilled });
  $('#pay-stat-received').textContent = money(enc.received);
  $('#pay-stat-received-sub').textContent = tr('pay.nPayments', { n: enc.nReceived });
  $('#pay-stat-due').textContent = money(enc.due);
  $('#pay-stat-due-sub').textContent = tr('pay.nUnpaid', { n: enc.nUnpaid });
  $('#pay-stat-late').textContent = money(enc.late);
  $('#pay-stat-late-sub').textContent = tr('pay.nLate', { n: enc.nLate });

  const q = norm($('#pay-search').value);
  const f = $('#pay-filter').value;
  let list = enc.list;
  if (q) list = list.filter((i) => norm((i.number || '') + ' ' + clientNameOf(i)).includes(q));
  if (f === 'unpaid') list = list.filter((i) => payStatus(i) === 'unpaid');
  else if (f === 'partial') list = list.filter((i) => payStatus(i) === 'partial');
  else if (f === 'paid') list = list.filter((i) => payStatus(i) === 'paid');
  else if (f === 'late') list = list.filter((i) => isLate(i));

  list.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));

  const rows = list.map((inv) => {
    const rest = restDue(inv);
    return `
    <tr>
      <td><strong>${esc(inv.number)}</strong></td>
      <td>${esc(clientNameOf(inv))}</td>
      <td>${dateFR(inv.dueDate)}</td>
      <td class="num">${money(totals(inv).ttc)}</td>
      <td class="num">${money(paidAmount(inv))}</td>
      <td class="num">${rest > 0 ? '<strong>' + money(rest) + '</strong>' : money(0)}</td>
      <td>${payPill(inv)}</td>
      <td>
        <div class="row-actions">
          <button class="btn small" data-action="pay-invoice" data-id="${inv.id}">${isPaid(inv) ? tr('pay.history') : tr('pay.action')}</button>
          <button class="btn small" data-action="preview-invoice" data-id="${inv.id}">${tr('common.preview')}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $('#pay-table').innerHTML = `
    <thead><tr><th>${tr('pay.hNumber')}</th><th>${tr('pay.hClient')}</th><th>${tr('pay.hDue')}</th><th class="num">${tr('pay.hTotal')}</th><th class="num">${tr('pay.hPaid')}</th><th class="num">${tr('pay.hRest')}</th><th>${tr('pay.hStatus')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" class="empty">${tr('pay.empty')}</td></tr>`}</tbody>`;
}

function renderClients() {
  const rows = state.clients.map((c) => {
    const count = state.invoices.filter((i) => i.clientId === c.id).length;
    return `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.email || '—')}</td>
        <td>${esc(c.address || '—')}</td>
        <td>${esc(c.tvaNumber || '—')}</td>
        <td class="num">${count}</td>
        <td>
          <div class="row-actions">
            <button class="btn small" data-action="edit-client" data-id="${c.id}">${tr('common.edit')}</button>
            <button class="btn small danger" data-action="delete-client" data-id="${c.id}">${tr('common.delete')}</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  $('#client-table').innerHTML = `
    <thead><tr><th>${tr('cl.hName')}</th><th>${tr('cl.hEmail')}</th><th>${tr('cl.hAddress')}</th><th>${tr('cl.hTva')}</th><th class="num">${tr('cl.hCount')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="empty">${tr('cl.empty')}</td></tr>`}</tbody>`;
}

function renderRules() {
  const rows = state.rules.map((r) => {
    const c = clientById(r.clientId);
    return `
      <tr>
        <td>${(r.keywords || []).map((k) => `<span class="pill blue">${esc(k)}</span>`).join(' ') || '—'}</td>
        <td>${esc(c ? c.name : '—')}</td>
        <td>${esc(r.desc || '—')}</td>
        <td class="num">${r.price === undefined || r.price === null || r.price === '' ? tr('ru.perTx') : money(r.price)}</td>
        <td class="num">${esc(r.tva === undefined || r.tva === null || r.tva === '' ? tvaDefault() : r.tva)} %</td>
        <td>
          <div class="row-actions">
            <button class="btn small" data-action="edit-rule" data-id="${r.id}">${tr('common.edit')}</button>
            <button class="btn small danger" data-action="delete-rule" data-id="${r.id}">${tr('common.delete')}</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  $('#rule-table').innerHTML = `
    <thead><tr><th>${tr('ru.hKeywords')}</th><th>${tr('ru.formClient')}</th><th>${tr('ru.hLine')}</th><th class="num">${tr('ru.hPU')}</th><th class="num">${tr('ru.hTVA')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="empty">${tr('ru.empty')}</td></tr>`}</tbody>`;
}

function renderDesignations() {
  const inp = $('#desig-new');
  if (!inp) return;
  const list = desigList();

  $('#desig-list').innerHTML = list.length
    ? list.map((d, i) => `
        <li class="desig-item"><span class="pill blue">${esc(d)}</span>
          <button class="btn small danger" data-action="delete-desig" data-i="${i}" title="${tr('common.delete')}">✕</button>
        </li>`).join('')
    : `<li class="empty muted">${tr('set.desigEmpty')}</li>`;

  const wrap = $('#desig-clients');
  if (!state.clients.length) {
    wrap.innerHTML = `<p class="hint">${tr('set.desigNoClient')}</p>`;
    return;
  }
  wrap.innerHTML = state.clients.map((c) => {
    const opts = list.slice();
    if (c.desig && opts.indexOf(c.desig) === -1) opts.push(c.desig);
    return `<label><span>${esc(c.name)}</span>
      <select class="desig-client" data-id="${c.id}">
        <option value="">${tr('set.desigNone')}</option>
        ${opts.map((d) => `<option value="${esc(d)}" ${c.desig === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
      </select></label>`;
  }).join('');
}

function renderSettings() {
  const co = state.settings.company || {};
  /* Nom / Raison sociale : dès qu'une licence est active, le nom est celui du
     CLIENT de la clé (choisi par le vendeur) — champ figé, non modifiable. */
  const licName = licState.configured && licState.customer ? licState.customer : '';
  const nameInput = $('#set-name');
  nameInput.value = licName || co.name || '';
  nameInput.disabled = !!licName;
  nameInput.title = licName ? tr('set.nameLocked') : '';
  const nameHint = $('#set-name-hint');
  if (nameHint) nameHint.hidden = !licName;
  $('#set-name-ar').value = co.nameAr || '';
  $('#set-ice').value = co.ice || '';
  $('#set-if').value = co.idFiscal || '';
  $('#set-rc').value = co.rc || '';
  $('#set-patente').value = co.patente || '';
  $('#set-cnss').value = co.cnss || '';
  $('#set-tva').value = co.tvaNumber || '';
  $('#set-address').value = co.address || '';
  $('#set-zip').value = co.zip || '';
  $('#set-city').value = co.city || '';
  $('#set-country').value = co.country || '';
  $('#set-email').value = co.email || '';
  $('#set-theme').value = (state.settings.theme === 'dark') ? 'dark' : 'light';
  $('#set-phone').value = co.phone || '';
  $('#set-web').value = co.web || '';
  $('#set-iban').value = co.iban || '';
  $('#set-tvarate').innerHTML = tvaOptionsHTML(tvaDefault());
  $('#set-regime').value = state.settings.tvaRegime || 'reel';
  $('#set-delay').value = state.settings.paymentDelay !== undefined ? state.settings.paymentDelay : 30;
  $('#set-prefix').value = state.settings.invoicePrefix || 'FA';
  $('#set-quote-prefix').value = state.settings.quotePrefix || 'DV';
  $('#set-quote-validity').value = state.settings.quoteValidityDays !== undefined ? state.settings.quoteValidityDays : 30;
  /* Début de numérotation : modifiable UNIQUEMENT tant qu'aucune facture n'existe */
  const startNum = $('#set-startnum');
  if (startNum) {
    startNum.value = state.settings.invoiceStart || 1;
    const locked = state.invoices.length > 0;
    startNum.disabled = locked;
    startNum.title = locked ? tr('set.startNumLocked') : '';
    const hint = $('#set-startnum-hint');
    if (hint) hint.hidden = !locked;
  }
  const dbPath = $('#set-db-path');
  if (dbPath) dbPath.value = dataPath || tr('side.data');

  /* ---- Logo de la société (affiché sur les factures) ---- */
  const lg = (state.settings.company && state.settings.company.logo) || null;
  const logoEl = $('#set-logo-preview');
  if (logoEl) {
    if (lg && lg.dataUri) {
      logoEl.src = lg.dataUri;
      logoEl.hidden = false;
    } else {
      logoEl.removeAttribute('src');
      logoEl.hidden = true;
    }
  }
  const rmLogo = $('#btn-remove-logo');
  if (rmLogo) rmLogo.hidden = !(lg && lg.dataUri);

  /* ---- Modèle des documents (factures & devis) ---- */
  renderDocSettings();

  /* ---- Export comptable : période par défaut = mois précédent (clôture) ---- */
  const cf = $('#set-close-from');
  const ct = $('#set-close-to');
  if (cf && ct) {
    const n = new Date();
    /* mois précédent (gestion du passage d'année) */
    const py = (n.getMonth() === 0) ? n.getFullYear() - 1 : n.getFullYear();
    const pm = (n.getMonth() === 0) ? 12 : n.getMonth(); /* 1..12 */
    const last = new Date(py, pm, 0).getDate(); /* dernier jour du mois précédent */
    const pad = (v) => String(v).padStart(2, '0');
    if (!cf.value) cf.value = `${py}-${pad(pm)}-01`;
    if (!ct.value) ct.value = `${py}-${pad(pm)}-${pad(last)}`;
  }

  /* ---- Sécurité : état (secState) + postes autorisés ---- */
  renderSecuritySettings();

  /* ---- Sauvegarde automatique quotidienne (P0) ---- */
  renderAutoBackup();

  /* ---- Mise à jour automatique (electron-updater) ---- */
  renderUpdateStatus();
}

/* ---------------- Mise à jour automatique (electron-updater) ---------------- */

let updateState = { state: 'idle', version: '', percent: 0, message: '', synced: false };

function applyUpdateStatus(payload) {
  if (!payload || typeof payload !== 'object') return;
  updateState = Object.assign({ state: 'idle', version: '', percent: 0, message: '', synced: true }, payload);
  renderUpdateStatus();
}

function updateStatusText() {
  switch (updateState.state) {
    case 'dev': return tr('upd.dev');
    case 'checking': return tr('upd.checking');
    case 'available': return tr('upd.available', { version: updateState.version });
    case 'not-available': return tr('upd.notAvailable');
    case 'downloading': return tr('upd.downloading', { percent: updateState.percent });
    case 'downloaded': return tr('upd.downloaded');
    case 'error': return tr('upd.error', { msg: updateState.message });
    default: return tr('upd.idle');
  }
}

async function renderUpdateStatus() {
  const statusEl = $('#update-status');
  if (!statusEl) return;
  const btnCheck = $('#btn-check-update');
  const btnInstall = $('#btn-install-update');
  /* Premier affichage : état courant du process principal (une seule fois). */
  if (!updateState.synced) {
    try {
      if (window.factapi && typeof window.factapi.updateStatus === 'function') {
        const st = await window.factapi.updateStatus();
        if (st && st.state) applyUpdateStatus(st);
      }
    } catch (e) {
      updateState.message = String(e && e.message ? e.message : e);
      updateState.state = 'error';
    }
    updateState.synced = true;
  }
  statusEl.textContent = updateStatusText();
  const downloaded = updateState.state === 'downloaded';
  if (btnCheck) btnCheck.hidden = downloaded;
  if (btnInstall) btnInstall.hidden = !downloaded;
}

async function checkUpdates() {
  applyUpdateStatus({ state: 'checking' });
  try {
    const fn = window.factapi && window.factapi.updateCheck;
    const res = fn ? await fn() : null;
    if (res && typeof res === 'object' && res.state) applyUpdateStatus(res);
    else if (res === 'ok') applyUpdateStatus({ state: 'not-available' });
  } catch (e) {
    applyUpdateStatus({ state: 'error', message: String(e && e.message ? e.message : e) });
  }
}

async function installUpdate() {
  try {
    if (!(await confirmBox(tr('upd.installConfirm', { version: updateState.version || '' })))) return;
    if (window.factapi && window.factapi.updateInstall) await window.factapi.updateInstall();
  } catch (e) { /* silencieux : l'utilisateur peut quitter puis réinstaller à la main */ }
}

async function renderAutoBackup() {
  const statusEl = $('#auto-backup-status');
  const btn = $('#btn-restore-auto');
  if (!statusEl) return;
  try {
    const st = window.factapi && typeof window.factapi.autoBackupStatus === 'function'
      ? await window.factapi.autoBackupStatus()
      : null;
    if (!st || !st.last) {
      statusEl.textContent = tr('set.autoBackupIdle');
      if (btn) { btn.disabled = true; btn.title = tr('set.autoBackupNone'); }
      return;
    }
    statusEl.textContent = tr('set.autoBackupLast', { date: st.last });
    if (btn) { btn.disabled = !st.available; btn.title = st.available ? '' : tr('set.autoBackupNone'); }
  } catch (e) {
    statusEl.textContent = tr('set.autoBackupIdle');
  }
}

function renderSecuritySettings() {
  const st = $('#sec-status');
  if (st) {
    st.textContent = secState.configured
      ? tr('sec.statusOn', { device: secState.deviceName || secState.code })
      : tr('sec.statusOff');
  }
  const lic = $('#lic-status');
  if (lic) {
    lic.textContent = licState.configured
      ? tr('lic.status', { c: licState.customer, n: licState.bound, m: licState.maxDevices })
      : tr('lic.none');
  }
  const bEnable = $('#btn-sec-enable');
  const bChange = $('#btn-sec-change');
  const bDisable = $('#btn-sec-disable');
  if (bEnable) bEnable.hidden = secState.configured;
  if (bChange) bChange.hidden = !secState.configured;
  if (bDisable) bDisable.hidden = !secState.configured;
  /* « Verrouiller à la fermeture » : visible seulement quand la protection est active. */
  const lockRow = $('#sec-lock-row');
  const lockHint = $('#sec-lock-hint');
  const lockChk = $('#set-lock-on-quit');
  if (lockRow) lockRow.hidden = !secState.configured;
  if (lockHint) lockHint.hidden = !secState.configured;
  if (lockChk) lockChk.checked = !!(state.settings && state.settings.lockOnQuit);
}

/* ---------------- Modal ---------------- */

function openModal(html) {
  $('#modal-box').innerHTML = html;
  $('#modal-root').hidden = false;
}

/* Confirmation intégrée : bilingue, sans dialogue natif bloquant */
let pendingConfirm = null;

function closeModal() {
  if (pendingConfirm) {
    const pending = pendingConfirm;
    pendingConfirm = null;
    pending(false);
  }
  $('#modal-root').hidden = true;
  $('#modal-box').innerHTML = '';
}

function confirmBox(message, opts = {}) {
  return new Promise((resolve) => {
    if (pendingConfirm) pendingConfirm(false);
    openModal(`
      <h2>${esc(opts.title || tr('common.confirmTitle'))}</h2>
      <p class="modal-sub" style="white-space:pre-line">${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn" id="cf-cancel">${esc(opts.cancelLabel || tr('common.cancel'))}</button>
        <button class="btn ${esc(opts.okClass || 'primary')}" id="cf-ok">${esc(opts.okLabel || tr('common.confirm'))}</button>
      </div>`);
    const done = (v) => {
      pendingConfirm = null;
      closeModal();
      resolve(v);
    };
    pendingConfirm = done;
    $('#cf-cancel').addEventListener('click', () => done(false));
    $('#cf-ok').addEventListener('click', () => done(true));
  });
}
$('#modal-root').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modal-root') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-root').hidden) closeModal();
});

/* ---------------- Éditeur de facture ---------------- */

function openInvoiceEditor(id) {
  const existing = id ? invoiceById(id) : null;
  /* id fourni mais introuvable : on n'ouvre PAS un éditeur vide (facture « disparue ») */
  if (id && !existing) { toast(tr('common.notFound'), 'error'); return; }
  /* Facture comptabilisée : édition bloquée (le mois est transmis au comptable). */
  if (existing && isAccounted(existing)) { toast(tr('inv.lockedEdit'), 'error'); return; }
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        id: null,
        status: 'draft',
        number: null,
        clientId: null,
        clientName: '',
        issueDate: todayISO(),
        dueDate: addDays(todayISO(), paymentDelay()),
        lines: [{ desc: '', qty: 1, price: 0, tva: tvaDefault() }],
        notes: '',
        transactionId: null,
        paid: false,
        createdAt: new Date().toISOString(),
        validatedAt: null
      };

  const clientOptions = state.clients.map((c) =>
    `<option value="${c.id}" ${draft.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  const txnIds = [draft.transactionId, ...(draft.transactionIds || [])].filter(Boolean);
  const txs = txnIds.map(txById).filter(Boolean);
  const txInfo = txs.length > 1
    ? ' ' + tr('ed.txMulti', { n: txs.length, v: money(txs.reduce((s, t) => s + t.amount, 0)) })
    : txs.length === 1 ? ' ' + tr('ed.txOne', { v: money(txs[0].amount), d: dateFR(txs[0].date) }) : '';

  openModal(`
    <h2>${draft.number ? esc(tr('ed.number', { n: draft.number })) : tr('ed.new')}</h2>
    <p class="modal-sub">${tr(draft.status === 'validated' ? 'ed.subValidated' : 'ed.subDraft')}${txInfo}</p>

    <div class="form-grid">
      <label>${tr('ed.client')}
        <select id="ie-client">
          <option value="">${tr('ed.pickClient')}</option>
          ${clientOptions}
        </select>
      </label>
      <label>${tr('ed.issueDate')} <input type="date" id="ie-issue" value="${esc(draft.issueDate)}"></label>
      <label>${tr('ed.due')} <input type="date" id="ie-due" value="${esc(draft.dueDate)}"></label>
    </div>

    <details class="modal-section" id="ie-client-details">
      <summary style="cursor:pointer;font-weight:600;color:var(--primary)">${tr('ed.addClientToggle')}</summary>
      <div class="form-grid" style="margin-top:10px">
        <label>${tr('ed.formName')} <input type="text" id="ie-nc-name" placeholder="Dupont SAS"></label>
        <label>${tr('ed.formEmail')} <input type="email" id="ie-nc-email"></label>
        <label class="wide">${tr('ed.formAddress')} <input type="text" id="ie-nc-address"></label>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" id="ie-nc-add">${tr('ed.addClient')}</button>
      </div>
    </details>

    <div class="modal-section">
      <h3>${tr('ed.lines')}</h3>
      <table class="lines-table">
        <thead>
          <tr>
            <th>${tr('ed.desc')}</th>
            <th class="num">${tr('ed.qty')}</th>
            <th class="num">${tr('ed.pu')}</th>
            <th class="num">${tr('ed.tvaPct')}</th>
            <th class="num">${tr('ed.totalHT')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="ie-lines"></tbody>
      </table>
      <div class="row" style="margin-top:8px">
        <button class="btn small" id="ie-add-line">${tr('ed.addLine')}</button>
      </div>
      <div class="totals" id="ie-totals"></div>
      <p class="hint" id="ie-words" style="margin-top:10px"></p>
    </div>

    <div class="modal-section">
      <label>${tr('ed.notesLabel')}
        <textarea id="ie-notes" rows="2" placeholder="${tr('ed.notesPh')}">${esc(draft.notes)}</textarea>
      </label>
    </div>

    <div class="modal-actions">
      <button class="btn" id="ie-cancel">${tr('common.cancel')}</button>
      <button class="btn" id="ie-save">${tr('ed.saveDraft')}</button>
      <button class="btn success" id="ie-validate">${tr(draft.status === 'validated' ? 'common.save' : 'ed.validate')}</button>
    </div>
  `);

  function renderLines() {
    const tbody = $('#ie-lines');
    tbody.innerHTML = draft.lines.map((l, i) => `
      <tr>
        <td><input type="text" data-i="${i}" data-f="desc" value="${esc(l.desc)}" placeholder="${tr('ed.linePh')}"></td>
        <td class="num"><input type="number" data-i="${i}" data-f="qty" step="0.01" min="0" value="${esc(l.qty)}" style="width:80px"></td>
        <td class="num"><input type="number" data-i="${i}" data-f="price" step="0.01" value="${esc(l.price)}" style="width:110px"></td>
        <td class="num"><select data-i="${i}" data-f="tva" style="width:78px">${tvaOptionsHTML(l.tva)}</select></td>
        <td class="num" data-total="${i}">${money((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
        <td><button class="btn small danger" data-del-line="${i}" title="${tr('ed.delLine')}">✕</button></td>
      </tr>`).join('');
    renderTotals();
  }

  function renderTotals() {
    const t = totals(draft);
    $('#ie-totals').innerHTML = `
      <div class="t-row"><span>${tr('ed.totalHT')}</span><span>${money(t.ht)}</span></div>
      <div class="t-row"><span>${tr('ed.tva')}</span><span>${money(t.tva)}</span></div>
      <div class="t-row t-total"><span>${tr('ed.totalTTC')}</span><span>${money(t.ttc)}</span></div>`;
    const w = $('#ie-words');
    if (w && typeof WORDS !== 'undefined') {
      w.innerHTML = `<strong>${tr('ed.wordsLabel')}</strong> ${esc(WORDS.fr(t.ttc))}` +
        `<span class="ar" dir="rtl">${esc(WORDS.ar(t.ttc))}</span>`;
    }
    draft.lines.forEach((l, i) => {
      const cell = $(`[data-total="${i}"]`);
      if (cell) cell.textContent = money((Number(l.qty) || 0) * (Number(l.price) || 0));
    });
  }

  renderLines();

  function onLinesEdit(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.f) return;
    const i = Number(el.dataset.i);
    const f = el.dataset.f;
    draft.lines[i][f] = (f === 'desc') ? el.value : (el.value === '' ? 0 : Number(el.value));
    renderTotals();
  }
  $('#ie-lines').addEventListener('input', onLinesEdit);
  $('#ie-lines').addEventListener('change', onLinesEdit);

  $('#ie-lines').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-line]');
    if (!del) return;
    if (draft.lines.length === 1) { toast(tr('ed.errOneLine'), 'error'); return; }
    draft.lines.splice(Number(del.dataset.delLine), 1);
    renderLines();
  });

  $('#ie-add-line').addEventListener('click', () => {
    draft.lines.push({ desc: '', qty: 1, price: 0, tva: tvaDefault() });
    renderLines();
    const inputs = $$('#ie-lines input[data-f="desc"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('#ie-nc-add').addEventListener('click', async () => {
    const name = $('#ie-nc-name').value.trim();
    if (!name) { toast(tr('ed.errName'), 'error'); return; }
    const c = { id: uid(), name, email: $('#ie-nc-email').value.trim(), address: $('#ie-nc-address').value.trim(), phone: '', tvaNumber: '' };
    state.clients.push(c);
    await persist('clients');
    draft.clientId = c.id;
    const sel = $('#ie-client');
    sel.insertAdjacentHTML('beforeend', `<option value="${c.id}" selected>${esc(c.name)}</option>`);
    $('#ie-client-details').open = false;
    renderClients();
    toast(tr('ed.clientAdded'), 'success');
  });

  $('#ie-cancel').addEventListener('click', closeModal);

  async function save(validate) {
    /* Garde défensive : une facture comptabilisée ne doit jamais être modifiée. */
    if (draft.id && isAccounted(invoiceById(draft.id))) { toast(tr('inv.lockedEdit'), 'error'); return; }
    draft.clientId = $('#ie-client').value || null;
    draft.issueDate = $('#ie-issue').value || todayISO();
    draft.dueDate = $('#ie-due').value || addDays(draft.issueDate, paymentDelay());
    draft.notes = $('#ie-notes').value;
    const c = clientById(draft.clientId);
    draft.clientName = c ? c.name : '';

    if (!draft.clientId) { toast(tr('ed.errPickClient'), 'error'); return; }
    draft.lines = draft.lines.filter((l) => String(l.desc).trim() !== '' || Number(l.price) !== 0);
    if (!draft.lines.length) { toast(tr('ed.errLine'), 'error'); return; }

    const isNew = !draft.id;
    if (isNew) {
      /* Identifiant obligatoire : sans lui la facture ne se rouvre pas
         (éditeur vide) et le bouton « Régler » ne la trouve pas. */
      draft.id = uid();
      state.invoices.push(draft);
    } else {
      const idx = state.invoices.findIndex((i) => i.id === draft.id);
      if (idx !== -1) state.invoices[idx] = draft;
    }

    if (validate && draft.status !== 'validated') assignNumber(draft);

    await persist('invoices', 'meta');
    renderAll();
    closeModal();
    toast(validate && draft.number ? tr('ed.validated', { n: draft.number }) : tr('ed.draftSaved'), 'success');
  }

  $('#ie-save').addEventListener('click', () => save(false));
  $('#ie-validate').addEventListener('click', () => save(true));
}

async function validateInvoice(id) {
  const inv = invoiceById(id);
  if (!inv) return;
  if (!inv.clientId) { toast(tr('vi.errNoClient'), 'error'); openInvoiceEditor(id); return; }
  if (!(await confirmBox(tr('vi.confirm', { client: clientNameOf(inv), total: money(totals(inv).ttc) }), { okLabel: tr('common.validate') }))) return;
  assignNumber(inv);
  await persist('invoices', 'meta');
  renderAll();
  toast(tr('ed.validated', { n: inv.number }), 'success');
}

async function deleteInvoice(id) {
  const inv = invoiceById(id);
  if (!inv) return;
  /* Verrou de numérotation : on ne supprime qu'une facture validée qui est la
     dernière (sinon un trou apparaîtrait), sans règlement et non comptabilisée. */
  const guard = deleteInvoiceGuard(inv);
  if (!guard.ok) { toast(tr(guard.reason), 'error'); return; }
  const label = inv.number || tr('common.draft');
  if (!(await confirmBox(tr('di.confirm', { label }), { okLabel: tr('common.delete'), okClass: 'danger' }))) return;
  /* Rembobinage du compteur : le numéro supprimé est réutilisé (série contiguë). */
  if (inv.status === 'validated') {
    const start = Math.max(1, Math.floor(Number(state.settings.invoiceStart) || 1));
    state.meta.invoiceSeq = Math.max(start - 1, invoiceSeqOf(inv) - 1);
  }
  const txnIds = [inv.transactionId, ...(inv.transactionIds || [])].filter(Boolean);
  for (const tid of txnIds) {
    const tx = txById(tid);
    if (tx && tx.linkedInvoiceId === inv.id) tx.linkedInvoiceId = null;
  }
  state.invoices = state.invoices.filter((i) => i.id !== id);
  await persist('invoices', 'transactions', 'meta');
  renderAll();
  closeModal();
  toast(tr('di.done'));
}

/* Suppression de TOUTE la liste « Factures à valider » (brouillons seulement) :
   les encaissements rattachés sont déliés, aucun montant n'est perdu. */
async function deleteAllDrafts() {
  const drafts = state.invoices.filter((i) => i.status === 'draft');
  if (!drafts.length) { toast(tr('drafts.none'), 'error'); return; }
  const msg = tr('drafts.deleteAllConfirm', { n: drafts.length });
  if (!(await confirmBox(msg, { okLabel: tr('drafts.deleteAll'), okClass: 'danger' }))) return;
  const ids = new Set(drafts.map((i) => i.id));
  state.invoices = state.invoices.filter((i) => !ids.has(i.id));
  state.transactions.forEach((t) => {
    if (t.linkedInvoiceId && ids.has(t.linkedInvoiceId)) t.linkedInvoiceId = null;
  });
  await persist('invoices', 'transactions');
  renderAll();
  toast(tr('drafts.deleteAllDone', { n: drafts.length }), 'success');
}

/* ---------------- Éditeur de devis ---------------- */

function openQuoteEditor(id) {
  const existing = id ? quoteById(id) : null;
  if (id && !existing) { toast(tr('quo.notFound'), 'error'); return; }
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        id: null,
        status: 'draft',
        number: null,
        clientId: null,
        clientName: '',
        issueDate: todayISO(),
        validUntil: addDays(todayISO(), quoteValidityDays()),
        validityDays: quoteValidityDays(),
        lines: [{ desc: '', qty: 1, price: 0, tva: tvaDefault() }],
        notes: '',
        convertedInvoiceId: null,
        convertedAt: null,
        createdAt: new Date().toISOString()
      };

  const clientOptions = state.clients.map((c) =>
    `<option value="${c.id}" ${draft.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  const statusOptions = ['draft', 'sent', 'accepted', 'rejected'].map((s) =>
    `<option value="${s}" ${draft.status === s ? 'selected' : ''}>${tr(QUOTE_STATUS_KEY[s])}</option>`).join('');

  openModal(`
    <h2>${draft.number ? esc(tr('quo.edNumber', { n: draft.number })) : tr('quo.edNew')}</h2>
    <p class="modal-sub">${tr('quo.edSub')}</p>

    <div class="form-grid">
      <label>${tr('ed.client')}
        <select id="qe-client">
          <option value="">${tr('ed.pickClient')}</option>
          ${clientOptions}
        </select>
      </label>
      <label>${tr('ed.issueDate')} <input type="date" id="qe-issue" value="${esc(draft.issueDate)}"></label>
      <label>${tr('quo.edValidity')} <input type="number" id="qe-validity" min="1" step="1" value="${esc(draft.validityDays)}"></label>
      <label>${tr('quo.edStatus')}
        <select id="qe-status">${statusOptions}</select>
      </label>
    </div>

    <details class="modal-section" id="qe-client-details">
      <summary style="cursor:pointer;font-weight:600;color:var(--primary)">${tr('ed.addClientToggle')}</summary>
      <div class="form-grid" style="margin-top:10px">
        <label>${tr('ed.formName')} <input type="text" id="qe-nc-name" placeholder="Dupont SAS"></label>
        <label>${tr('ed.formEmail')} <input type="email" id="qe-nc-email"></label>
        <label class="wide">${tr('ed.formAddress')} <input type="text" id="qe-nc-address"></label>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" id="qe-nc-add">${tr('ed.addClient')}</button>
      </div>
    </details>

    <div class="modal-section">
      <h3>${tr('quo.edLines')}</h3>
      <table class="lines-table">
        <thead>
          <tr>
            <th>${tr('ed.desc')}</th>
            <th class="num">${tr('ed.qty')}</th>
            <th class="num">${tr('ed.pu')}</th>
            <th class="num">${tr('ed.tvaPct')}</th>
            <th class="num">${tr('ed.totalHT')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="qe-lines"></tbody>
      </table>
      <div class="row" style="margin-top:8px">
        <button class="btn small" id="qe-add-line">${tr('ed.addLine')}</button>
      </div>
      <div class="totals" id="qe-totals"></div>
      <p class="hint" id="qe-words" style="margin-top:10px"></p>
    </div>

    <div class="modal-section">
      <label>${tr('quo.edNotesLabel')}
        <textarea id="qe-notes" rows="2" placeholder="${tr('quo.edNotesPh')}">${esc(draft.notes)}</textarea>
      </label>
    </div>

    <div class="modal-actions">
      <button class="btn" id="qe-cancel">${tr('common.cancel')}</button>
      ${draft.id && ['draft', 'sent', 'accepted'].includes(draft.status) && !quoteExpired(draft)
        ? `<button class="btn success" id="qe-convert">${tr('quo.convert')}</button>` : ''}
      <button class="btn primary" id="qe-save">${tr('quo.edSave')}</button>
    </div>
  `);

  function renderLines() {
    const tbody = $('#qe-lines');
    tbody.innerHTML = draft.lines.map((l, i) => `
      <tr>
        <td><input type="text" data-i="${i}" data-f="desc" value="${esc(l.desc)}" placeholder="${tr('ed.linePh')}"></td>
        <td class="num"><input type="number" data-i="${i}" data-f="qty" step="0.01" min="0" value="${esc(l.qty)}" style="width:80px"></td>
        <td class="num"><input type="number" data-i="${i}" data-f="price" step="0.01" value="${esc(l.price)}" style="width:110px"></td>
        <td class="num"><select data-i="${i}" data-f="tva" style="width:78px">${tvaOptionsHTML(l.tva)}</select></td>
        <td class="num" data-total="${i}">${money((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
        <td><button class="btn small danger" data-del-line="${i}" title="${tr('ed.delLine')}">✕</button></td>
      </tr>`).join('');
    renderTotals();
  }

  function renderTotals() {
    const t = totals(draft);
    $('#qe-totals').innerHTML = `
      <div class="t-row"><span>${tr('ed.totalHT')}</span><span>${money(t.ht)}</span></div>
      <div class="t-row"><span>${tr('ed.tva')}</span><span>${money(t.tva)}</span></div>
      <div class="t-row t-total"><span>${tr('ed.totalTTC')}</span><span>${money(t.ttc)}</span></div>`;
    const w = $('#qe-words');
    if (w && typeof WORDS !== 'undefined') {
      w.innerHTML = `<strong>${tr('quo.wordsLabel')}</strong> ${esc(WORDS.fr(t.ttc))}` +
        `<span class="ar" dir="rtl">${esc(WORDS.ar(t.ttc))}</span>`;
    }
    draft.lines.forEach((l, i) => {
      const cell = $(`[data-total="${i}"]`);
      if (cell) cell.textContent = money((Number(l.qty) || 0) * (Number(l.price) || 0));
    });
  }

  renderLines();

  function onLinesEdit(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.f) return;
    const i = Number(el.dataset.i);
    const f = el.dataset.f;
    draft.lines[i][f] = (f === 'desc') ? el.value : (el.value === '' ? 0 : Number(el.value));
    renderTotals();
  }
  $('#qe-lines').addEventListener('input', onLinesEdit);
  $('#qe-lines').addEventListener('change', onLinesEdit);

  $('#qe-lines').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-line]');
    if (!del) return;
    if (draft.lines.length === 1) { toast(tr('ed.errOneLine'), 'error'); return; }
    draft.lines.splice(Number(del.dataset.delLine), 1);
    renderLines();
  });

  $('#qe-add-line').addEventListener('click', () => {
    draft.lines.push({ desc: '', qty: 1, price: 0, tva: tvaDefault() });
    renderLines();
    const inputs = $$('#qe-lines input[data-f="desc"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('#qe-nc-add').addEventListener('click', async () => {
    const name = $('#qe-nc-name').value.trim();
    if (!name) { toast(tr('ed.errName'), 'error'); return; }
    const c = { id: uid(), name, email: $('#qe-nc-email').value.trim(), address: $('#qe-nc-address').value.trim(), phone: '', tvaNumber: '' };
    state.clients.push(c);
    await persist('clients');
    draft.clientId = c.id;
    const sel = $('#qe-client');
    sel.insertAdjacentHTML('beforeend', `<option value="${c.id}" selected>${esc(c.name)}</option>`);
    $('#qe-client-details').open = false;
    renderClients();
    toast(tr('ed.clientAdded'), 'success');
  });

  $('#qe-cancel').addEventListener('click', closeModal);

  async function save() {
    draft.clientId = $('#qe-client').value || null;
    draft.issueDate = $('#qe-issue').value || todayISO();
    let days = Math.max(1, Math.floor(Number($('#qe-validity').value)) || quoteValidityDays());
    draft.validityDays = days;
    draft.validUntil = addDays(draft.issueDate, days);
    draft.status = $('#qe-status').value || 'draft';
    draft.notes = $('#qe-notes').value;
    const c = clientById(draft.clientId);
    draft.clientName = c ? c.name : '';

    if (!draft.clientId) { toast(tr('ed.errPickClient'), 'error'); return; }
    draft.lines = draft.lines.filter((l) => String(l.desc).trim() !== '' || Number(l.price) !== 0);
    if (!draft.lines.length) { toast(tr('ed.errLine'), 'error'); return; }

    const isNew = !draft.id;
    if (isNew) {
      draft.id = uid();
      assignQuoteNumber(draft);
      state.quotes.push(draft);
    } else {
      const idx = state.quotes.findIndex((q) => q.id === draft.id);
      if (idx !== -1) state.quotes[idx] = draft;
    }

    await persist('quotes', 'meta');
    renderAll();
    closeModal();
    toast(isNew ? tr('quo.edSaved', { n: draft.number }) : tr('quo.edUpdated', { n: draft.number }), 'success');
  }

  $('#qe-save').addEventListener('click', save);

  const convertBtn = $('#qe-convert');
  if (convertBtn) convertBtn.addEventListener('click', async () => {
    /* sauvegarde des champs avant conversion, pour ne pas perdre la saisie
       en cours d'édition */
    draft.clientId = $('#qe-client').value || null;
    const c = clientById(draft.clientId);
    draft.clientName = c ? c.name : '';
    draft.notes = $('#qe-notes').value;
    const ok = await convertQuoteToInvoice(draft.id, draft);
    if (ok) closeModal();
  });
}

/* Conversion d'un devis en facture (à sens unique) :
   - crée une facture VALIDÉE, numérotée FA, datée du jour, en copiant les
     lignes et la TVA du devis (les données sont figées à ce moment) ;
   - marque le devis « Converti » avec la référence croisée de la facture ;
   - la facture porte la mention « Devis N° DV-… » (réf. conservée). */
async function convertQuoteToInvoice(qid, editorDraft) {
  const q = editorDraft || quoteById(qid);
  if (!q) { toast(tr('quo.notFound'), 'error'); return false; }
  if (q.status === 'converted') {
    const existing = q.convertedInvoiceId ? invoiceById(q.convertedInvoiceId) : null;
    toast(tr('quo.convertAlready', { n: existing && existing.number ? existing.number : '' }), 'error');
    return false;
  }
  if (!q.clientId) { toast(tr('quo.convertNoClient'), 'error'); return false; }
  const t = totals(q);
  const ok = await confirmBox(tr('quo.convertConfirm', { number: q.number || '—', client: q.clientName || '', total: money(t.ttc) }), { okLabel: tr('quo.convert') });
  if (!ok) return false;

  const inv = {
    id: uid(),
    status: 'draft' /* assignNumber le passe à validated */,
    number: null,
    clientId: q.clientId,
    clientName: q.clientName || '',
    issueDate: todayISO(),
    dueDate: addDays(todayISO(), paymentDelay()),
    lines: JSON.parse(JSON.stringify(q.lines || [])),
    notes: q.notes
      ? `${q.notes}\n— ${tr('quo.quoteRef', { n: q.number || '' })}`
      : tr('quo.quoteRef', { n: q.number || '' }),
    transactionId: null,
    paid: false,
    quoteRef: { id: q.id, number: q.number || '' },
    createdAt: new Date().toISOString(),
    validatedAt: null
  };
  assignNumber(inv);
  state.invoices.push(inv);

  q.status = 'converted';
  q.convertedInvoiceId = inv.id;
  q.convertedAt = new Date().toISOString();
  const idx = state.quotes.findIndex((x) => x.id === q.id);
  if (idx !== -1) state.quotes[idx] = q;

  await persist('invoices', 'quotes', 'meta');
  renderAll();
  showView('invoices');
  toast(tr('quo.convertDone', { n: inv.number, q: q.number || '' }), 'success');
  return true;
}

async function deleteQuote(id) {
  const q = quoteById(id);
  if (!q) return;
  const label = q.number || tr('quo.edNew');
  const warn = q.status === 'converted' && q.convertedInvoiceId
    ? `\n\n${tr('quo.delConvertedWarn', { n: (invoiceById(q.convertedInvoiceId) || {}).number || '' })}`
    : '';
  if (!(await confirmBox(tr('quo.delConfirm', { label }) + warn, { okLabel: tr('common.delete'), okClass: 'danger' }))) return;
  state.quotes = state.quotes.filter((x) => x.id !== id);
  await persist('quotes');
  renderAll();
  closeModal();
  toast(tr('quo.delDone'));
}

/* ---------------- Paiements : modale de règlement ---------------- */

function paymentHistoryHTML(inv) {
  const recs = paymentList(inv);
  if (!recs.length) {
    const legacy = inv.paid ? `<div class="hint" style="margin-top:8px">${tr('paym.legacy')}</div>` : '';
    return `<div class="empty">${tr('paym.none')}</div>${legacy}`;
  }
  return recs.slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map((p) => `
    <div class="list-item">
      <div>
        <div class="li-main">${money(p.amount)} · ${dateFR(p.date)} · ${esc(methodLabel(p.method))}</div>
        <div class="li-sub">${[p.reference, p.note].filter(Boolean).map(esc).join(' · ') || '—'}</div>
      </div>
      <div class="row">
        ${isAccounted(inv) ? '' : `<button class="btn small" data-action="pay-edit" data-id="${esc(inv.id)}" data-pay="${esc(p.id)}" title="${tr('paym.edit')}">✎</button>`}
        <button class="btn small danger" data-action="pay-delete" data-id="${esc(inv.id)}" data-pay="${esc(p.id)}" title="${tr('paym.delete')}">✕</button>
      </div>
    </div>`).join('');
}

function openPaymentModal(id) {
  const inv = invoiceById(id);
  if (!inv) { toast(tr('common.notFound'), 'error'); return; }

  const t = totals(inv);
  const paid = paidAmount(inv);
  const rest = restDue(inv);
  const methodOptions = METHODS.map((m) => `<option value="${m}">${esc(methodLabel(m))}</option>`).join('');

  openModal(`
    <h2>${tr('paym.title')}</h2>
    <p class="modal-sub">${esc(tr('paym.for', { n: inv.number || tr('common.draft'), client: clientNameOf(inv) }))} · ${esc(tr('paym.rest', { v: money(rest) }))}</p>

    <div class="import-summary">
      <div class="is-item"><span class="is-value">${money(t.ttc)}</span><span class="is-label">${tr('pay.hTotal')}</span></div>
      <div class="is-item"><span class="is-value">${money(paid)}</span><span class="is-label">${tr('pay.hPaid')}</span></div>
      <div class="is-item"><span class="is-value">${money(rest)}</span><span class="is-label">${tr('pay.hRest')}</span></div>
    </div>

    ${rest > 0 ? `
    <div class="form-grid" style="margin-top:14px">
      <label>${tr('paym.amount')} <input type="number" id="pay-amount" step="0.01" min="0" value="${rest.toFixed(2)}"></label>
      <label>${tr('paym.date')} <input type="date" id="pay-date" value="${todayISO()}"></label>
      <label>${tr('paym.method')} <select id="pay-method">${methodOptions}</select></label>
      <label class="wide">${tr('paym.reference')} <input type="text" id="pay-ref" placeholder="CHQ 123456 / VIR 789"></label>
      <label class="wide">${tr('paym.note')} <input type="text" id="pay-note"></label>
    </div>` : `<p class="hint" style="margin-top:14px">${tr('paym.settled')}</p>`}

    <div class="modal-section">
      <h3>${tr('paym.list')}</h3>
      <div class="list" id="pay-history">${paymentHistoryHTML(inv)}</div>
    </div>

    <div class="modal-actions">
      ${rest > 0 ? `
      <button class="btn" id="pay-cancel">${tr('common.cancel')}</button>
      <button class="btn" id="pay-settle">${tr('paym.settleAll')}</button>
      <button class="btn success" id="pay-save">${tr('paym.save')}</button>` : `
      <button class="btn" id="pay-close">${tr('common.close')}</button>`}
    </div>
  `);

  ($('#pay-cancel') || $('#pay-close')).addEventListener('click', closeModal);

  const settleBtn = $('#pay-settle');
  if (settleBtn) settleBtn.addEventListener('click', () => { $('#pay-amount').value = rest.toFixed(2); });

  const saveBtn = $('#pay-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const amount = round2(Number($('#pay-amount').value));
    if (!(amount > 0)) { toast(tr('paym.errAmount'), 'error'); return; }
    if (amount > rest + 0.005) { toast(tr('paym.errOver', { v: money(amount), r: money(rest) }), 'error'); return; }

    inv.payments = paymentList(inv).concat([{
      id: uid(),
      date: $('#pay-date').value || todayISO(),
      amount,
      method: $('#pay-method').value || 'other',
      reference: $('#pay-ref').value.trim(),
      note: $('#pay-note').value.trim()
    }]);
    inv.paid = isPaid(inv);

    await persist('invoices');
    renderAll();
    closeModal();
    toast(tr('paym.done', { v: money(amount), n: inv.number || tr('common.draft') }), 'success');
  });
}

async function deletePayment(invId, payId) {
  const inv = invoiceById(invId);
  if (!inv) return;
  const rec = paymentList(inv).find((p) => p.id === payId);
  if (!rec) return;
  const ok = await confirmBox(tr('paym.delConfirm', { v: money(rec.amount), d: dateFR(rec.date) }), {
    okLabel: tr('paym.delete'),
    okClass: 'danger'
  });
  if (!ok) return;

  inv.payments = paymentList(inv).filter((p) => p.id !== payId);
  inv.paid = isPaid(inv);
  await persist('invoices');
  renderAll();
  toast(tr('paym.deleted'));
  openPaymentModal(invId);
}

/* Modification d'un règlement existant : formulaire pré-rempli. Le montant ne
   peut pas dépasser le total encaissable (reste dû actuel + ancien montant),
   afin de ne jamais encaisser plus que le TTC. Bloqué si la facture est
   comptabilisée (comme l'édition de la facture elle-même). */
function openEditPaymentModal(invId, payId) {
  const inv = invoiceById(invId);
  if (!inv) { toast(tr('common.notFound'), 'error'); return; }
  if (isAccounted(inv)) { toast(tr('inv.lockedEdit'), 'error'); return; }
  const rec = paymentList(inv).find((p) => p.id === payId);
  if (!rec) { toast(tr('common.notFound'), 'error'); return; }

  const rest = restDue(inv);
  const maxAmount = round2(rest + Number(rec.amount || 0));
  const methodOptions = METHODS.map((m) =>
    `<option value="${m}"${m === rec.method ? ' selected' : ''}>${esc(methodLabel(m))}</option>`).join('');

  openModal(`
    <h2>${tr('paym.editTitle')}</h2>
    <p class="modal-sub">${esc(tr('paym.for', { n: inv.number || tr('common.draft'), client: clientNameOf(inv) }))} · ${esc(tr('paym.rest', { v: money(rest) }))}</p>

    <div class="form-grid" style="margin-top:14px">
      <label>${tr('paym.amount')} <input type="number" id="pay-amount" step="0.01" min="0" value="${Number(rec.amount).toFixed(2)}"></label>
      <label>${tr('paym.date')} <input type="date" id="pay-date" value="${esc(rec.date || todayISO())}"></label>
      <label>${tr('paym.method')} <select id="pay-method">${methodOptions}</select></label>
      <label class="wide">${tr('paym.reference')} <input type="text" id="pay-ref" value="${esc(rec.reference || '')}" placeholder="CHQ 123456 / VIR 789"></label>
      <label class="wide">${tr('paym.note')} <input type="text" id="pay-note" value="${esc(rec.note || '')}"></label>
    </div>

    <div class="modal-actions">
      <button class="btn" id="pay-cancel">${tr('common.cancel')}</button>
      <button class="btn success" id="pay-save">${tr('paym.saveEdit')}</button>
    </div>
  `);

  /* Annuler : on revient à la fiche de la facture (historique intact). */
  $('#pay-cancel').addEventListener('click', () => openPaymentModal(invId));

  $('#pay-save').addEventListener('click', async () => {
    const amount = round2(Number($('#pay-amount').value));
    if (!(amount > 0)) { toast(tr('paym.errAmount'), 'error'); return; }
    if (amount > maxAmount + 0.005) { toast(tr('paym.errOverEdit', { v: money(amount), r: money(maxAmount) }), 'error'); return; }

    rec.date = $('#pay-date').value || todayISO();
    rec.amount = amount;
    rec.method = $('#pay-method').value || 'other';
    rec.reference = $('#pay-ref').value.trim();
    rec.note = $('#pay-note').value.trim();
    inv.paid = isPaid(inv);

    await persist('invoices');
    renderAll();
    openPaymentModal(invId);
    toast(tr('paym.edited'), 'success');
  });
}

/* ---------------- Génération par période + client unique ---------------- */

function openGenerateModal() {
  const candidates = state.transactions.filter((t) => t.amount > 0 && t.status !== 'ignored' && !t.linkedInvoiceId);
  if (!candidates.length) {
    toast(tr('gen.noCandidates'), 'error');
    return;
  }
  const sorted = [...candidates].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const minDate = sorted[0].date || todayISO();
  const maxDate = sorted[sorted.length - 1].date || todayISO();

  const clientOptions = state.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  openModal(`
    <div id="gen-wrap">
      <h2>${tr('gen.title')}</h2>
      <p class="modal-sub">${tr('gen.sub')}</p>

      <div class="form-grid" style="margin-top:14px">
        <label>${tr('gen.periodFrom')} <input type="date" id="gen-from" value="${esc(minDate)}"></label>
        <label>${tr('gen.periodTo')} <input type="date" id="gen-to" value="${esc(maxDate)}"></label>
        <label>${tr('gen.client')}
          <select id="gen-client">
            <option value="">${tr('ed.pickClient')}</option>
            <option value="__rules__">${tr('gen.rulesOption')}</option>
            ${clientOptions}
          </select>
        </label>
        <label>${tr('gen.formTva')} <select id="gen-tva">${tvaOptionsHTML(tvaDefault())}</select></label>
        <label>${tr('gen.issueDate')} <input type="date" id="gen-issue"></label>
        <label>${tr('gen.due')} <input type="date" id="gen-due"></label>
      </div>
      <p class="hint" style="margin:6px 0 0">${tr('gen.issueHint')}</p>

      <div class="modal-section">
        <h3>${tr('gen.grouping')}</h3>
        <label class="check"><input type="radio" name="gen-mode" value="single" checked> ${tr('gen.modeSingle')}</label>
        <label class="check" style="margin-top:6px"><input type="radio" name="gen-mode" value="group"> ${tr('gen.modeGroup')}</label>
      </div>

      <div class="card" style="margin:14px 0 0;box-shadow:none" id="gen-summary"></div>

      <div class="modal-actions">
        <button class="btn" id="gen-cancel">${tr('common.cancel')}</button>
        <button class="btn success" id="gen-run">${tr('gen.run')}</button>
      </div>
    </div>
  `);

  function selected() {
    const from = $('#gen-from').value || minDate;
    const to = $('#gen-to').value || maxDate;
    const list = candidates.filter((t) => (t.date || '') >= from && (t.date || '') <= to);
    const checked = $$('input[name="gen-mode"]:checked')[0];
    const mode = checked ? checked.value : 'single';
    const clientSel = $('#gen-client').value;
    return { from, to, list, mode, clientSel, client: clientById(clientSel) };
  }

  function refresh() {
    const s = selected();
    /* Date de facture par défaut : le début de la période choisie */
    autoDate($('#gen-issue'), s.from || todayISO());
    autoDate($('#gen-due'), addDays($('#gen-issue').value || todayISO(), paymentDelay()));
    const total = s.list.reduce((sum, t) => sum + t.amount, 0);
    const n = s.list.length;
    const rulesMode = s.clientSel === '__rules__';
    const nInv = n === 0 ? 0 : (s.mode === 'group' && !rulesMode ? 1 : n);

    let msg;
    if (!n) msg = tr('gen.msgNone');
    else if (!s.clientSel) msg = tr('gen.msgPick');
    else if (rulesMode) msg = tr('gen.msgRules');
    else if (s.mode === 'group') msg = tr('gen.msgGroup', { n, client: s.client.name || '' });
    else msg = tr('gen.msgSingle', { n, client: s.client.name || '' });

    $('#gen-summary').innerHTML = `
      <div class="import-summary" style="margin-bottom:0">
        <div class="is-item"><span class="is-value">${n}</span><span class="is-label">${tr('gen.sumCredits', { d: dateFR(s.from), e: dateFR(s.to) })}</span></div>
        <div class="is-item"><span class="is-value">${money(total)}</span><span class="is-label">${tr('gen.sumTotal')}</span></div>
        <div class="is-item"><span class="is-value">${nInv}</span><span class="is-label">${tr('gen.sumInvoices')}</span></div>
      </div>
      <p class="hint" style="margin:8px 0 0">${esc(msg)}</p>`;

    $$('input[name="gen-mode"]').forEach((r) => { r.disabled = rulesMode; });
  }

  $('#gen-cancel').addEventListener('click', closeModal);
  /* saisi à la main → le champ n'est plus recalculé automatiquement */
  $('#gen-issue').addEventListener('change', () => manualDate($('#gen-issue')));
  $('#gen-due').addEventListener('change', () => manualDate($('#gen-due')));
  $('#gen-wrap').addEventListener('change', refresh);
  refresh();

  $('#gen-run').addEventListener('click', async () => {
    const s = selected();
    if (!s.list.length) { toast(tr('gen.errNone'), 'error'); return; }
    if (!s.clientSel) { toast(tr('gen.errPick'), 'error'); return; }
    if (s.clientSel === '__rules__' && !state.rules.length) { toast(tr('gen.errNoRules'), 'error'); return; }

    const issue = $('#gen-issue').value || todayISO();
    const due = $('#gen-due').value || addDays(issue, paymentDelay());
    const tvaInput = Number($('#gen-tva').value);
    const tvaRate = isNaN(tvaInput) ? tvaDefault() : tvaInput;
    const clientId = s.clientSel === '__rules__' ? null : s.clientSel;
    const client = clientId ? clientById(clientId) : null;

    const created = [];
    if (s.mode === 'group' && clientId) {
      const inv = buildGroupInvoice(s.list, {
        clientId,
        clientName: client ? client.name : '',
        issueDate: issue,
        dueDate: due,
        tva: tvaRate,
        notes: tr('gen.notes', { a: dateFR(s.from), b: dateFR(s.to) })
      });
      state.invoices.push(inv);
      s.list.forEach((t) => { t.linkedInvoiceId = inv.id; });
      created.push(inv);
    } else {
      for (const t of s.list) {
        let inv;
        if (clientId) {
          inv = draftForClient(t, {
            clientId,
            clientName: client ? client.name : '',
            tva: tvaRate,
            issueDate: issue,
            dueDate: due
          });
        } else {
          inv = draftFromTx(t); // règles automatiques
          inv.issueDate = issue;
          inv.dueDate = due;
        }
        state.invoices.push(inv);
        t.linkedInvoiceId = inv.id;
        created.push(inv);
      }
    }

    await persist('invoices', 'transactions');
    renderAll();
    closeModal();
    showView('drafts');
    toast(tr('gen.created', { n: created.length, client: client ? client.name : tr('gen.forRules') }), 'success');
  });
}

/* ---------------- Import CSV / PDF ---------------- */

function txKey(e) {
  return `${e.date}|${Number(e.amount).toFixed(2)}|${norm(e.label)}`;
}

async function pickStatement() {
  let res;
  try {
    res = await window.factapi.pickStatement();
  } catch (e) {
    toast(tr('imp.readError', { msg: e.message }), 'error');
    return;
  }
  if (!res) return;
  $('#csv-file-name').textContent = res.name;

  if (res.error) {
    pendingImport = null;
    $('#import-preview').hidden = true;
    toast(tr('imp.pdfError', { msg: res.error }), 'error');
    return;
  }

  let parsed;
  if (res.kind === 'pdf') {
    parsed = { entries: res.entries || [], skipped: res.skipped || 0, warnings: res.warnings || [], source: 'PDF' };
  } else {
    try {
      parsed = Object.assign(CSV.toEntries(res.content), { source: 'CSV', warnings: [] });
    } catch (e) {
      pendingImport = null;
      $('#import-preview').hidden = true;
      toast(e.message, 'error');
      return;
    }
  }

  if (!parsed.entries.length) {
    toast(tr('imp.noTx'), 'error');
    return;
  }
  pendingImport = { fileName: res.name, entries: parsed.entries, parsed };
  setImportPeriod(parsed.entries); /* période par défaut = toutes les dates du fichier */
  renderImportPreview(parsed);
}

/* ---------------- Période d'import ---------------- */

/* Par défaut, la période couvre toutes les dates du fichier sélectionné ;
   on peut ensuite la resserrer pour n'importer qu'un extrait du relevé. */
function setImportPeriod(entries) {
  const dates = entries.map((e) => e.date).filter(Boolean).sort();
  $('#import-from').value = dates[0] || '';
  $('#import-to').value = dates[dates.length - 1] || '';
}

/* Une transaction est retenue si sa date figure dans [du ; au].
   Sans date exploitable, elle est conservée (aucun moyen de la classer). */
function inImportPeriod(e) {
  const from = $('#import-from').value;
  const to = $('#import-to').value;
  if (!e.date) return true;
  if (from && e.date < from) return false;
  if (to && e.date > to) return false;
  return true;
}

function renderImportPreview(parsed) {
  /* Les commandes de l'aperçu (client, TVA, mode, génération) ne sont pas
     relues depuis les paramètres si l'aperçu est déjà affiché : un re-rendu
     (changement de période, case à cocher) ne doit pas écraser les choix
     en cours de saisie. */
  const wasVisible = !$('#import-preview').hidden;
  const liveClient = wasVisible ? ($('#import-client') || {}).value : '';
  const liveTva = wasVisible ? ($('#import-tva') || {}).value : '';
  const liveMode = wasVisible ? ($$('input[name="import-mode"]:checked')[0] || {}).value : '';
  const liveAutogen = wasVisible ? $('#opt-autogen').checked : undefined;

  /* D'abord la PÉRIODE choisie (tout le reste du fichier est écarté),
     puis seuls les virements reçus (crédits) sont retenus :
     les débits ne sont ni importés, ni affichés, ni facturés. */
  const inPeriod = parsed.entries.filter(inImportPeriod);
  const outPeriod = parsed.entries.filter((e) => !inImportPeriod(e));
  const entries = inPeriod.filter((e) => e.amount > 0);
  const discarded = inPeriod.filter((e) => !(e.amount > 0));
  /* Transactions visibles (aperçu limité à 50) — avec cases à cocher (toutes cochées par défaut) */
  const visible = entries.slice(0, 50);
  if (!pendingImport.credits || pendingImport.credits.length !== entries.length || !pendingImport.selected) {
    /* Nouveau fichier ou période resserrée : (ré)initialiser la sélection = tout coché */
    pendingImport.credits = entries.slice();
    pendingImport.selected = new Set(pendingImport.credits.map((_, i) => i));
  }
  const selCount = pendingImport.selected.size;
  const credCount = pendingImport.credits.length;
  const selTotal = credCount > 0 ? (selCount === credCount ? ' (toutes)' : ` (${selCount}/${credCount})`) : '';
  const existingKeys = new Set(state.transactions.map((t) => txKey(t)));
  const newCount = entries.filter((e) => !existingKeys.has(txKey(e))).length;

  $('#opt-autogen').checked = liveAutogen !== undefined
    ? liveAutogen
    : (state.settings.autoGenerateOnImport !== false);

  /* Date de facture par défaut : le début de la période choisie */
  autoDate($('#import-issue-date'), $('#import-from').value || firstDateOf(entries) || todayISO());
  autoDate($('#import-due-date'), addDays($('#import-issue-date').value || todayISO(), paymentDelay()));

  $('#import-summary').innerHTML = `
    <div class="is-item"><span class="is-value">${esc(parsed.source || 'CSV')}</span><span class="is-label">${tr('imp.sumFormat')}</span></div>
    <div class="is-item"><span class="is-value">${parsed.entries.length}</span><span class="is-label">${tr('imp.sumLines', { n: parsed.skipped })}</span></div>
    <div class="is-item"><span class="is-value">${inPeriod.length}</span><span class="is-label">${tr('imp.sumInPeriod', { n: outPeriod.length })}</span></div>
    <div class="is-item"><span class="is-value">${credCount}</span><span class="is-label">${tr('imp.sumCredits', { v: money(pendingImport.credits.reduce((s, e) => s + e.amount, 0)) })}</span></div>
    <div class="is-item"><span class="is-value">${discarded.length}</span><span class="is-label">${tr('imp.sumDiscarded', { v: money(Math.abs(discarded.reduce((s, e) => s + e.amount, 0))) })}</span></div>
    <div class="is-item"><span class="is-value">${newCount}</span><span class="is-label">${tr('imp.sumNew')}</span></div>
    <div class="is-item"><span class="is-value">${selCount}${selTotal}</span><span class="is-label">${tr('imp.selCount')}</span></div>`;

  $('#import-warnings').innerHTML = (parsed.warnings || [])
    .map((w) => `<p class="hint" style="color:var(--warning);margin:6px 0">⚠ ${esc(w)}</p>`).join('');

  const head = `<thead><tr><th style="width:36px"><input type="checkbox" id="imp-all" ${selCount === credCount && credCount > 0 ? 'checked' : ''} title="${tr('imp.checkAll')}"></th><th>${tr('common.date')}</th><th>${tr('common.label')}</th><th class="num">${tr('common.amount')}</th></tr></thead>`;
  const body = visible.map((e, idx) => `
    <tr>
      <td><input type="checkbox" class="imp-chk" data-idx="${idx}" ${pendingImport.selected.has(idx) ? 'checked' : ''}></td>
      <td>${dateFR(e.date)}</td>
      <td>${esc(e.label)}</td>
      <td class="num ${e.amount >= 0 ? 'amount-credit' : 'amount-debit'}">${money(e.amount)}</td>
    </tr>`).join('');
  $('#import-table').innerHTML = head + `<tbody>${body}</tbody>`;

  /* Client + taux + mode de facturation de l'import (mémorisés entre deux imports) */
  const clientSel = $('#import-client');
  const savedClient = liveClient && (liveClient === '__rules__' || clientById(liveClient))
    ? liveClient
    : (state.settings.importClientId || '');
  clientSel.innerHTML = `<option value="">${tr('ed.pickClient')}</option>` +
    `<option value="__rules__">${tr('gen.rulesOption')}</option>` +
    state.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  clientSel.value = savedClient && (savedClient === '__rules__' || clientById(savedClient))
    ? savedClient
    : (state.clients.length === 1 ? state.clients[0].id : '__rules__');
  if (!clientSel.value) clientSel.value = '__rules__';

  $('#import-tva').innerHTML = tvaOptionsHTML(
    state.settings.importTva !== undefined && state.settings.importTva !== null &&
    state.settings.importTva !== '' && !isNaN(Number(state.settings.importTva))
      ? Number(state.settings.importTva) : tvaDefault());
  if (liveTva && Array.prototype.some.call($('#import-tva').options, (o) => o.value === liveTva)) {
    $('#import-tva').value = liveTva;
  }
  const mode = (liveMode === 'single' || liveMode === 'group')
    ? liveMode
    : (state.settings.importMode === 'single' ? 'single' : 'group');
  $$('input[name="import-mode"]').forEach((r) => { r.checked = r.value === mode; });
  syncImportModeUI();
  syncDesigHint();

  $('#import-preview').hidden = false;

  /* Listeners de sélection */
  $('#import-table').onclick = (ev) => {
    const cb = ev.target.closest('.imp-chk');
    if (cb) {
      const idx = Number(cb.dataset.idx);
      if (pendingImport.selected) {
        if (cb.checked) pendingImport.selected.add(idx);
        else pendingImport.selected.delete(idx);
      }
      renderImportPreview(parsed);
      return;
    }
    const all = ev.target.closest('#imp-all');
    if (all) {
      if (pendingImport.selected && pendingImport.credits) {
        if (all.checked) visible.forEach((_, idx) => pendingImport.selected.add(idx));
        else visible.forEach((_, idx) => pendingImport.selected.delete(idx));
      }
      renderImportPreview(parsed);
    }
  };
}

/* Le mode « une seule facture » exige un client précis : radios désactivées
   (et rappel affiché) quand on reste sur les règles automatiques. */
function syncImportModeUI() {
  const sel = $('#import-client');
  const rulesMode = !sel || !sel.value || sel.value === '__rules__';
  $$('input[name="import-mode"]').forEach((r) => { r.disabled = rulesMode; });
  const hint = $('#import-mode-hint');
  if (hint) hint.hidden = !rulesMode;
}

async function doImport() {
  if (!pendingImport) { toast(tr('imp.chooseFirst'), 'error'); return; }
  const issue = $('#import-issue-date').value || todayISO();
  const due = $('#import-due-date').value || addDays(issue, paymentDelay());
  const dedupe = $('#opt-dedupe').checked;
  const autogen = $('#opt-autogen').checked;

  const clientSel = $('#import-client').value;
  const modeRadio = $$('input[name="import-mode"]:checked')[0];
  const tvaInput = Number($('#import-tva').value);
  const tvaRate = isNaN(tvaInput) ? tvaDefault() : tvaInput;
  const client = !clientSel || clientSel === '__rules__' ? null : clientById(clientSel);
  const mode = client && modeRadio && modeRadio.value === 'group' ? 'group' : 'single';

  /* Période choisie puis SEULEMENT les transactions SÉLECTIONNÉES dans l'aperçu
     (toutes cochées par défaut) — hors période et désélection écartées. */
  const inPeriod = pendingImport.entries.filter(inImportPeriod);
  const outPeriod = pendingImport.entries.length - inPeriod.length;
  const inPeriodCredits = inPeriod.filter((e) => e.amount > 0);
  const kept = pendingImport.credits && pendingImport.selected
    ? pendingImport.credits.filter((_, i) => pendingImport.selected.has(i))
    : inPeriodCredits;
  const debitsDiscarded = inPeriod.length - inPeriodCredits.length;
  const unchecked = inPeriodCredits.length - kept.length;
  const discarded = debitsDiscarded;
  const existingKeys = new Set(state.transactions.map((t) => txKey(t)));
  const importedTx = [];
  let added = 0, skipped = 0;

  for (const e of kept) {
    const k = txKey(e);
    if (dedupe && existingKeys.has(k)) {
      skipped++;
      const ex = state.transactions.find((t) => txKey(t) === k);
      if (ex) importedTx.push(ex);
      continue;
    }
    existingKeys.add(k);
    const tx = {
      id: uid(),
      date: e.date,
      label: e.label,
      amount: e.amount,
      status: 'new',
      linkedInvoiceId: null,
      fileName: pendingImport.fileName,
      importedAt: new Date().toISOString()
    };
    state.transactions.push(tx);
    importedTx.push(tx);
    added++;
  }
  await persist('transactions');

  let created = [];
  let grouped = null;
  if (autogen) {
    /* Seules les transactions SÉLECTIONNÉES et importées par CE import
       (et de la période) sont facturées. */
    const targets = importedTx.filter((t) =>
      t.amount > 0 && t.status !== 'ignored' && !t.linkedInvoiceId && inImportPeriod(t));
    if (mode === 'group' && targets.length) {
      /* Une seule facture : une ligne par encaissement */
      const dates = targets.map((t) => t.date || '').filter(Boolean).sort();
      grouped = buildGroupInvoice(targets, {
        clientId: client.id,
        clientName: client.name || '',
        issueDate: issue,
        dueDate: due,
        tva: tvaRate,
        notes: dates.length ? tr('gen.notes', { a: dateFR(dates[0]), b: dateFR(dates[dates.length - 1]) }) : ''
      });
      state.invoices.push(grouped);
      targets.forEach((t) => { t.linkedInvoiceId = grouped.id; });
      created = [grouped];
    } else if (client) {
      /* Une facture par encaissement, toutes rattachées au client choisi */
      for (const t of targets) {
        const inv = draftForClient(t, {
          clientId: client.id,
          clientName: client.name || '',
          tva: tvaRate,
          issueDate: issue,
          dueDate: due
        });
        state.invoices.push(inv);
        t.linkedInvoiceId = inv.id;
        created.push(inv);
      }
    } else {
      created = generateDrafts(targets, { issueDate: issue, dueDate: due }); /* règles automatiques */
    }
    await persist('invoices', 'transactions');
  }

  /* mémorise les choix pour le prochain import */
  state.settings.importClientId = clientSel;
  state.settings.importMode = mode;
  state.settings.importTva = tvaRate;
  state.settings.autoGenerateOnImport = autogen;
  await persist('settings');

  const fileName = pendingImport.fileName;
  pendingImport = null;
  $('#import-preview').hidden = true;
  $('#csv-file-name').textContent = '';
  renderAll();

  toast(tr('imp.done', { file: fileName, n: added }) +
    (skipped ? tr('imp.doneSkipped', { n: skipped }) : '') +
    (unchecked ? tr('imp.doneUnchecked', { n: unchecked }) : '') +
    (discarded ? tr('imp.doneDiscarded', { n: discarded }) : '') +
    (outPeriod ? tr('imp.doneOutPeriod', { n: outPeriod }) : '') +
    (grouped ? tr('imp.doneGrouped', { n: grouped.lines.length })
      : created.length ? tr('imp.doneCreated', { n: created.length }) : '') + '.', 'success');
  showView(created.length ? 'drafts' : 'transactions');
}

/* ---------------- Clients ---------------- */

function openClientEditor(id) {
  const c = id ? clientById(id) : null;
  openModal(`
    <h2>${c ? tr('cl.edit') : tr('cl.create')}</h2>
    <div class="form-grid" style="margin-top:14px">
      <label>${tr('cl.formName')} <input type="text" id="cl-name" value="${esc(c ? c.name : '')}"></label>
      <label>${tr('cl.formEmail')} <input type="email" id="cl-email" value="${esc(c ? c.email : '')}"></label>
      <label>${tr('cl.formPhone')} <input type="text" id="cl-phone" value="${esc(c ? c.phone : '')}"></label>
      <label>${tr('cl.formTva')} <input type="text" id="cl-tva" value="${esc(c ? c.tvaNumber : '')}"></label>
      <label class="wide">${tr('cl.formAddress')} <input type="text" id="cl-address" value="${esc(c ? c.address : '')}"></label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="cl-cancel">${tr('common.cancel')}</button>
      <button class="btn primary" id="cl-save">${tr('common.save')}</button>
    </div>`);

  $('#cl-cancel').addEventListener('click', closeModal);
  $('#cl-save').addEventListener('click', async () => {
    const name = $('#cl-name').value.trim();
    if (!name) { toast(tr('cl.nameRequired'), 'error'); return; }
    const data = {
      name,
      email: $('#cl-email').value.trim(),
      phone: $('#cl-phone').value.trim(),
      tvaNumber: $('#cl-tva').value.trim(),
      address: $('#cl-address').value.trim()
    };
    if (c) Object.assign(c, data);
    else state.clients.push({ id: uid(), ...data });
    await persist('clients');
    renderAll();
    closeModal();
    toast(tr('cl.saved'), 'success');
  });
}

async function deleteClient(id) {
  const c = clientById(id);
  if (!c) return;
  const used = state.invoices.filter((i) => i.clientId === id).length;
  if (!(await confirmBox(tr('cl.delConfirm', { name: c.name }) + (used ? tr('cl.delKeep', { n: used }) : ''), { okLabel: tr('common.delete'), okClass: 'danger' }))) return;
  state.clients = state.clients.filter((x) => x.id !== id);
  await persist('clients');
  renderAll();
  toast(tr('cl.deleted'));
}

/* ---------------- Règles ---------------- */

function openRuleEditor(id) {
  const r = id ? state.rules.find((x) => x.id === id) : null;
  const options = state.clients.map((c) =>
    `<option value="${c.id}" ${r && r.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  openModal(`
    <h2>${r ? tr('ru.edit') : tr('ru.create')}</h2>
    <p class="modal-sub">${tr('ru.sub')}</p>
    <div class="form-grid" style="margin-top:14px">
      <label class="wide">${tr('ru.formKeywords')}
        <input type="text" id="rl-keywords" value="${esc(r ? (r.keywords || []).join(', ') : '')}" placeholder="virement, dupont, 3S21">
      </label>
      <label>${tr('ru.formClient')} <select id="rl-client"><option value="">${tr('ru.none')}</option>${options}</select></label>
      <label>${tr('ru.formTva')} <select id="rl-tva">${tvaOptionsHTML(r && r.tva !== undefined && r.tva !== null && r.tva !== '' ? r.tva : tvaDefault())}</select></label>
      <label class="wide">${tr('ru.formDesc')} <input type="text" id="rl-desc" value="${esc(r ? r.desc || '' : '')}" placeholder="${tr('ru.formDescPh')}"></label>
      <label class="wide">${tr('ru.formPrice')}
        <input type="number" id="rl-price" step="0.01" value="${esc(r && r.price !== undefined && r.price !== null ? r.price : '')}">
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="rl-cancel">${tr('common.cancel')}</button>
      <button class="btn primary" id="rl-save">${tr('common.save')}</button>
    </div>`);

  $('#rl-cancel').addEventListener('click', closeModal);
  $('#rl-save').addEventListener('click', async () => {
    const keywords = $('#rl-keywords').value.split(',').map((k) => k.trim()).filter(Boolean);
    if (!keywords.length) { toast(tr('ru.needKeyword'), 'error'); return; }
    const data = {
      keywords,
      clientId: $('#rl-client').value || null,
      desc: $('#rl-desc').value.trim(),
      tva: $('#rl-tva').value === '' ? '' : Number($('#rl-tva').value),
      price: $('#rl-price').value === '' ? '' : Number($('#rl-price').value)
    };
    if (r) Object.assign(r, data);
    else state.rules.push({ id: uid(), ...data });
    await persist('rules');
    renderAll();
    closeModal();
    toast(tr('ru.saved'), 'success');
  });
}

async function deleteRule(id) {
  if (!(await confirmBox(tr('ru.delConfirm'), { okLabel: tr('common.delete'), okClass: 'danger' }))) return;
  state.rules = state.rules.filter((r) => r.id !== id);
  await persist('rules');
  renderAll();
  toast(tr('ru.deleted'));
}

/* ---------------- Langue (FR ⇄ AR) ---------------- */

function currentLang() {
  return (typeof I18N !== 'undefined' && I18N.getLang) ? I18N.getLang() : 'fr';
}

function syncLangButtons() {
  const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'fr';
  $$('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
}

/* Thème clair / sombre, mémorisé dans les paramètres et appliqué dès le rendu. */
function applyTheme() {
  const t = (state.settings && state.settings.theme) || 'light';
  const dark = (t === 'dark');
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('#btn-theme');
  if (btn) {
    const key = dark ? 'ui.themeToLight' : 'ui.themeToDark';
    const icon = dark ? 'i-sun' : 'i-moon';
    btn.setAttribute('aria-label', tr(key));
    btn.setAttribute('title', tr(key));
    btn.innerHTML = `<svg class="ic"><use href="#${icon}"/></svg>`;
  }
  const sel = $('#set-theme');
  if (sel) sel.value = dark ? 'dark' : 'light';
}

/* Bascule de langue : <html lang dir> + libellés statiques, puis rendu dynamique
   (toujours setLang avant renderAll). Le choix est mémorisé dans les paramètres. */
function setLanguage(lang) {
  if (typeof I18N === 'undefined') return;
  const l = I18N.setLang(lang);
  state.settings.language = l;
  syncLangButtons();
  renderAll();
  persist('settings');
}

/* ---------------- Sauvegarde / restauration de la base ---------------- */

/* L'emplacement du fichier est CHOISI dans le dialogue natif (export comme import). */
async function exportBackup() {
  try {
    await persist('settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta');
    const res = await window.factapi.backupExport();
    if (!res || res.canceled) return;
    if (res.error) { toast(tr('set.exportFail', { msg: res.msg || res.error }), 'error'); return; }
    toast(tr('set.exportDone', { path: res.path }), 'success');
    /* Sauvegarde faite : coche l'étape correspondante de la mise en route. */
    if (window.ONBOARD) window.ONBOARD.markBackup();
  } catch (e) {
    toast(tr('set.exportFail', { msg: e.message }), 'error');
  }
}

/* Remplace l'état courant par le contenu d'une sauvegarde déjà validée */
function applyBackupData(data) {
  state.settings = (data && data.settings) || {};
  if (!state.settings.language) state.settings.language = 'fr';
  if (!state.settings.currency) state.settings.currency = 'MAD';
  if (!state.settings.tvaRegime) state.settings.tvaRegime = 'reel';
  state.clients = (data && data.clients) || [];
  state.invoices = (data && data.invoices) || [];
  state.transactions = (data && data.transactions) || [];
  state.rules = (data && data.rules) || [];
  state.quotes = (data && data.quotes) || [];
  state.meta = (data && (data.meta && (data.meta.invoiceSeq !== undefined || data.meta.quoteSeq !== undefined))) ? data.meta : { invoiceSeq: 0, quoteSeq: 0 };
  if (typeof I18N !== 'undefined') I18N.setLang(state.settings.language || 'fr');
  syncLangButtons();
  renderAll();
}

async function importBackup() {
  try {
    const res = await window.factapi.backupImport();
    if (!res || res.canceled) return;
    if (res.error) {
      if (res.error === 'json' || res.error === 'unreadable') toast(tr('set.importFail', { msg: res.msg || res.error }), 'error');
      else toast(tr('set.importInvalid'), 'error');
      return;
    }
    const ok = await confirmBox(tr('set.importConfirm', { file: res.name }), { okClass: 'danger', okLabel: tr('common.confirm') });
    if (!ok) return;
    applyBackupData(res.data);
    await persist('settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta');
    toast(tr('set.importDone', { i: state.invoices.length, c: state.clients.length }), 'success');
  } catch (e) {
    toast(tr('set.importFail', { msg: e.message }), 'error');
  }
}

async function openDataFolder() {
  try {
    const fn = window.factapi.backupOpenFolder;
    const ok = fn ? await fn() : false;
    if (!ok) toast(tr('set.folderFail', { msg: dataPath || '—' }), 'error');
  } catch (e) {
    toast(tr('set.folderFail', { msg: e.message }), 'error');
  }
}

/* Restaure la dernière sauvegarde AUTOMATIQUE (P0) : même parcours que
   l'import manuel, mais la source est le dossier auto-backups. */
async function restoreAutoBackup() {
  try {
    const res = await window.factapi.autoBackupRestore();
    if (!res || res.error) { toast(tr('set.restoreAutoFail', { msg: (res && res.msg) || 'none' }), 'error'); return; }
    const ok = await confirmBox(tr('set.restoreAutoConfirm'), { okClass: 'danger', okLabel: tr('common.confirm') });
    if (!ok) return;
    applyBackupData(res.data);
    await persist('settings', 'clients', 'invoices', 'transactions', 'rules', 'quotes', 'meta');
    toast(tr('set.restoreAutoDone', { i: state.invoices.length, c: state.clients.length }), 'success');
  } catch (e) {
    toast(tr('set.restoreAutoFail', { msg: e.message }), 'error');
  }
}

/* ---------------- Emplacement de la base de données ----------------
   Dossier choisi → copie des 6 fichiers → mémorisation (config.json,
   côté process principal) → redémarrage pour recharger depuis là. */

function dataFail(msg) { toast(tr('set.dbFail', { msg }), 'error'); }

function setShownDataPath(dir) {
  dataPath = dir;
  const el = $('#set-db-path');
  if (el) el.value = dir;
}

async function confirmDataRestart(dir) {
  setShownDataPath(dir);
  if (await confirmBox(tr('set.dbRestart', { path: dir }))) {
    await window.factapi.dataRestart();
  } else {
    toast(tr('set.dbRestartLater'), 'success');
  }
}

async function applyDataDir(target, opts) {
  try {
    const res = await window.factapi.dataApply(target, opts || {});
    if (!res || res.error) { if (res) dataFail(res.error); return; }
    if (res.noop) { toast(tr('set.dbSame'), 'success'); return; }
    if (res.needConfirm) {
      if (await confirmBox(tr('set.dbReplaceWarn', { path: target }))) {
        await applyDataDir(target, { replace: true });
      }
      return;
    }
    await confirmDataRestart(res.path);
  } catch (e) { dataFail(e.message); }
}

async function chooseDataDir() {
  try {
    const res = await window.factapi.dataPick();
    if (!res || res.error) { if (res) dataFail(res.error); return; }
    if (res.canceled) return;
    await applyDataDir(res.path);
  } catch (e) { dataFail(e.message); }
}

async function resetDataDir() {
  try {
    const res = await window.factapi.dataReset();
    if (!res || res.error) { if (res) dataFail(res.error); return; }
    if (res.noop) { toast(tr('set.dbSame'), 'success'); return; }
    await confirmDataRestart(res.path);
  } catch (e) { dataFail(e.message); }
}

/* ---------------- Sécurité : mot de passe + postes autorisés ---------------- */

/* État de la protection (rempli par auth:status). Non protégé par défaut. */
const secState = {
  configured: false, enabled: false, locked: false, authorized: true,
  recovery: false, question: '', deviceId: '', code: '', deviceName: '',
  owner: false, attemptsLeft: 5, lockRemainingMs: 0, devices: []
};

/* État de la licence d'utilisation (rempli par license:status).
   Par défaut « active » : l'application s'ouvre normalement tant que le
   process principal n'a pas statué (défensif, aucun écran parasite). */
const licState = {
  active: true, configured: true, customer: '', maxDevices: 1,
  bound: 0, currentBound: true, code: ''
};

/* Écran affiché sur la protection : 'setup' | 'unlock' | 'forgot' | 'device'
   ou 'license' (enregistrement de la clé fournie par le vendeur).
   secForceScreen : le voile est ouvert alors que la protection n'est pas encore
   active (activation choisie depuis Paramètres → Sécurité). */
let lockMode = 'unlock';
let secForceScreen = false;

async function refreshLicenseStatus() {
  if (!window.factapi || !window.factapi.licenseStatus) return licState;
  try {
    const l = await window.factapi.licenseStatus() || {};
    Object.assign(licState, l);
  } catch (e) { /* état par défaut (licence active) */ }
  renderSecScreen();
  renderSecSidebar();
  return licState;
}

/* Verrou licence : une licence est obligatoire ; elle doit être configurée ET
   avoir lié CE poste (sinon écran d'enregistrement / poste refusé). */
function licGateActive() {
  return !(licState.configured && licState.currentBound);
}

async function refreshSecStatus() {
  if (!window.factapi || !window.factapi.authStatus) return secState;
  try {
    const a = await window.factapi.authStatus() || {};
    Object.assign(secState, a);
    if (secState.configured && !secState.authorized) lockMode = 'device';
    else if (secState.configured && secState.locked && lockMode !== 'forgot') lockMode = 'unlock';
  } catch (e) {
    secState.configured = false; secState.locked = false; secState.authorized = true;
  }
  renderSecScreen();
  renderSecSidebar();
  return secState;
}

function renderSecSidebar() {
  const btn = $('#btn-lock');
  if (btn) btn.hidden = !(secState.configured && !secState.locked && secState.authorized);
}

function secMsg(text, isError) {
  const el = $('#lock-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lock-msg' + (text ? (isError ? ' error' : ' info') : '');
}

function fmtMs(ms) {
  const s = Math.max(1, Math.round(Number(ms || 0) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60}s` : `${s} s`;
}

function renderSecScreen() {
  const el = $('#lock-screen');
  const mode = $('#lock-mode');
  const gate = licGateActive() ||
               (secState.configured && (secState.locked || !secState.authorized)) ||
               (secForceScreen && !secState.configured);
  if (el) el.hidden = !gate;
  if (!gate || !mode) return;
  renderSecSidebar();

  const screen = licGateActive()
    ? 'license'
    : (secForceScreen && !secState.configured
      ? 'setup'
      : (!secState.authorized ? 'device' : (lockMode === 'forgot' ? 'forgot' : 'unlock')));

  if (screen === 'license') {
    mode.innerHTML = `
      <h2>${tr('lic.title')}</h2>
      <p class="hint">${tr('lic.hint')}</p>
      ${licState.configured ? `<p class="hint">${tr('lic.boundInfo', { n: licState.bound, m: licState.maxDevices })}</p>` : ''}
      <label>${tr('lic.key')} <input type="text" id="lic-key" spellcheck="false" autocomplete="off" placeholder="${tr('lic.keyPh')}"></label>
      <button class="btn primary" id="lic-activate">${tr('lic.activate')}</button>
      <p class="lock-msg" id="lock-msg"></p>`;
  } else if (screen === 'device') {
    /* Version monoposte : aucun autre poste ne peut utiliser l'application. */
    mode.innerHTML = `
      <h2>${tr('lock.unauthorizedTitle')}</h2>
      <p class="hint">${tr('lock.unauthorizedText')}</p>
      <p class="lock-msg" id="lock-msg"></p>`;
  } else if (screen === 'setup') {
    mode.innerHTML = `
      <h2>${tr('lock.setupTitle')}</h2>
      <p class="hint">${tr('lock.setupHint')}</p>
      <label>${tr('sec.newPw')} <input type="password" id="lock-pw1" autocomplete="new-password"></label>
      <label>${tr('sec.confirmPw')} <input type="password" id="lock-pw2" autocomplete="new-password"></label>
      <label>${tr('sec.question')} <input type="text" id="lock-q" data-i18n-ph="sec.questionPh"></label>
      <label>${tr('sec.answer')} <input type="text" id="lock-a1" data-i18n-ph="sec.answerPh"></label>
      <label>${tr('sec.answer2')} <input type="text" id="lock-a2" data-i18n-ph="sec.answerPh"></label>
      <button class="btn primary" id="lock-setup">${tr('lock.activate')}</button>
      <p class="lock-msg" id="lock-msg"></p>`;
  } else if (lockMode === 'forgot') {
    mode.innerHTML = `
      <h2>${tr('lock.forgot')}</h2>
      <p class="hint">${tr('lock.forgotHint')}</p>
      <p><strong>${tr('lock.question')} :</strong> ${esc(secState.question || tr('lock.noQuestion'))}</p>
      <label>${tr('lock.answer')} <input type="text" id="lock-a" autocomplete="off"></label>
      <label>${tr('sec.newPw')} <input type="password" id="lock-pw1" autocomplete="new-password"></label>
      <label>${tr('sec.confirmPw')} <input type="password" id="lock-pw2" autocomplete="new-password"></label>
      <div class="row">
        <button class="btn primary" id="lock-reset">${tr('lock.reset')}</button>
        <button class="btn" id="lock-back">${tr('lock.back')}</button>
      </div>
      <p class="lock-msg" id="lock-msg"></p>`;
  } else {
    mode.innerHTML = `
      <h2>${tr('lock.title')}</h2>
      <p class="hint">${tr('lock.sub')}</p>
      <label>${tr('lock.password')} <input type="password" id="lock-pw" autocomplete="current-password"></label>
      <div class="row">
        <button class="btn primary" id="lock-unlock">${tr('lock.unlock')}</button>
        ${secState.recovery ? `<button class="btn" id="lock-forgot">${tr('lock.forgot')}</button>` : ''}
      </div>
      <p class="lock-msg" id="lock-msg"></p>`;
  }
  secMsg('');
  bindLockActions();
}

const lockField = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

async function doUnlock() {
  const pw = lockField('lock-pw');
  if (!pw) return;
  const res = await window.factapi.authUnlock(pw);
  if (res && res.ok) {
    await refreshSecStatus();
    await loadAppData();
  } else if (res && res.code === 'locked') {
    await refreshSecStatus();
    secMsg(tr('lock.locked', { ms: fmtMs(res.lockRemainingMs) }), true);
  } else {
    await refreshSecStatus();
    const left = (res && res.attemptsLeft !== undefined) ? ' — ' + tr('lock.left', { n: res.attemptsLeft }) : '';
    secMsg(tr('lock.bad') + left, true);
  }
}

async function doSetup() {
  const pw1 = lockField('lock-pw1'), pw2 = lockField('lock-pw2');
  const q = lockField('lock-q'), a1 = lockField('lock-a1'), a2 = lockField('lock-a2');
  if (pw1.length < 4) return secMsg(tr('sec.weak'), true);
  if (pw1 !== pw2) return secMsg(tr('sec.mismatch'), true);
  if (q && a1 !== a2) return secMsg(tr('sec.mismatch'), true);
  const res = await window.factapi.authSetup({ password: pw1, question: q, answer: a1 });
  if (res && res.ok) {
    secForceScreen = false;
    await refreshSecStatus();
    await loadAppData();
    toast(tr('sec.enabledToast'), 'success');
  } else {
    secMsg(res && res.error === 'weak' ? tr('sec.weak') : tr('lock.bad'), true);
  }
}

async function doReset() {
  const a = lockField('lock-a'), pw1 = lockField('lock-pw1'), pw2 = lockField('lock-pw2');
  if (pw1.length < 4) return secMsg(tr('sec.weak'), true);
  if (pw1 !== pw2) return secMsg(tr('sec.mismatch'), true);
  const res = await window.factapi.authReset({ answer: a, newPassword: pw1 });
  if (res && res.ok) {
    await refreshSecStatus();
    await loadAppData();
    toast(tr('lock.resetOk'), 'success');
  } else {
    secMsg(tr('lock.answerBad'), true);
  }
}

/* Enregistrement de la clé de licence fournie par le vendeur. */
async function doLicense() {
  const key = lockField('lic-key').trim();
  if (!key) return secMsg(tr('lic.needKey'), true);
  if (!window.factapi.licenseRegister) return secMsg(tr('lic.invalid'), true);
  const res = await window.factapi.licenseRegister(key);
  if (res && res.ok) {
    await refreshLicenseStatus();
    if (licGateActive()) { secMsg(tr('lic.slots', { m: licState.maxDevices }), true); return; }
    toast(tr('lic.activated'), 'success');
    /* Licence OK : on enchaîne sur l'éventuel écran de mot de passe, sinon on charge. */
    if (!(secState.configured && (secState.locked || !secState.authorized))) await loadAppData();
  } else if (res && res.error === 'slots') {
    secMsg(tr('lic.slots', { m: res.maxDevices || licState.maxDevices }), true);
  } else {
    secMsg(tr('lic.invalid'), true);
  }
}

/* Les écrans sont régénérés : on réattache via les propriétés (pas d'accumulation). */
function bindLockActions() {
  const mode = $('#lock-mode');
  if (!mode) return;
  mode.onclick = async (e) => {
    const id = e.target && e.target.id;
    if (id === 'lock-unlock') await doUnlock();
    else if (id === 'lock-forgot') { lockMode = 'forgot'; renderSecScreen(); }
    else if (id === 'lock-back') { lockMode = 'unlock'; renderSecScreen(); }
    else if (id === 'lock-retry') await refreshSecStatus();
    else if (id === 'lic-activate') await doLicense();
    else if (id === 'lock-setup') await doSetup();
    else if (id === 'lock-reset') await doReset();
  };
  mode.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'lock-pw') doUnlock();
    else if (e.target.id === 'lic-key') doLicense();
    else if (e.target.id === 'lock-pw2' && lockMode === 'forgot') doReset();
    else if (e.target.id === 'lock-pw2' && !secState.configured) doSetup();
  };
}

async function lockNow() {
  if (!window.factapi || !window.factapi.authLock) return;
  await window.factapi.authLock();
  await refreshSecStatus();
  showView('dashboard');
}

/* ---- Modale de saisie (mot de passe, nouveau nom de poste…) ---- */
function openPromptModal(title, opts = {}) {
  return new Promise((resolve) => {
    if ($('#modal-root').hidden === false) { resolve(null); return; }
    openModal(`
      <h2>${esc(title)}</h2>
      <div class="form-grid">
        <label>${esc(title)} <input type="${opts.password ? 'password' : 'text'}" id="pm-input" value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}"></label>
      </div>
      <div class="modal-actions">
        <button class="btn" id="pm-cancel">${tr('common.cancel')}</button>
        <button class="btn primary" id="pm-ok">${tr('common.save')}</button>
      </div>`);
    const done = (v) => { closeModal(); resolve(v); };
    $('#pm-cancel').addEventListener('click', () => done(null));
    $('#pm-ok').addEventListener('click', () => done($('#pm-input').value));
    $('#pm-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done($('#pm-input').value);
      if (e.key === 'Escape') done(null);
    });
    setTimeout(() => { const i = $('#pm-input'); if (i) i.focus(); }, 30);
  });
}

/* ---- Paramètres → Sécurité ---- */
async function disableProtection() {
  if (!(await confirmBox(tr('sec.disableConfirm'), { okClass: 'danger', okLabel: tr('sec.disable') }))) return;
  const pw = await openPromptModal(tr('sec.disableTitle'), { password: true });
  if (pw === null) return;
  const res = await window.factapi.authDisable(pw);
  if (res && res.ok) {
    await refreshSecStatus();
    renderAll();
    renderSecSidebar();
    toast(tr('sec.disabled'), 'success');
  } else {
    toast(tr('sec.badCurrent'), 'error');
  }
}

function openChangePasswordModal() {
  openModal(`
    <h2>${tr('sec.changeTitle')}</h2>
    <div class="form-grid">
      <label>${tr('sec.currentPw')} <input type="password" id="sc-current" autocomplete="current-password"></label>
      <label>${tr('sec.newPw')} <input type="password" id="sc-new1" autocomplete="new-password"></label>
      <label>${tr('sec.confirmPw')} <input type="password" id="sc-new2" autocomplete="new-password"></label>
      <label>${tr('sec.question')} <input type="text" id="sc-q" value="${esc(secState.question || '')}" data-i18n-ph="sec.questionPh"></label>
      <label>${tr('sec.answer')} <input type="text" id="sc-a1" data-i18n-ph="sec.answerPh"></label>
      <label>${tr('sec.answer2')} <input type="text" id="sc-a2" data-i18n-ph="sec.answerPh"></label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="sc-cancel">${tr('common.cancel')}</button>
      <button class="btn primary" id="sc-save">${tr('common.save')}</button>
    </div>`);
  $('#sc-cancel').addEventListener('click', closeModal);
  $('#sc-save').addEventListener('click', async () => {
    const current = $('#sc-current').value;
    const pw1 = $('#sc-new1').value, pw2 = $('#sc-new2').value;
    const q = $('#sc-q').value.trim(), a1 = $('#sc-a1').value, a2 = $('#sc-a2').value;
    if (pw1.length < 4) { toast(tr('sec.weak'), 'error'); return; }
    if (pw1 !== pw2 || (q && a1 !== a2)) { toast(tr('sec.mismatch'), 'error'); return; }
    const res = await window.factapi.authChange({ currentPassword: current, newPassword: pw1, question: q, answer: a1 });
    if (res && res.ok) {
      await refreshSecStatus();
      renderAll();
      closeModal();
      toast(tr('sec.changed'), 'success');
    } else if (res && res.error === 'bad') {
      toast(tr('sec.badCurrent'), 'error');
    } else {
      toast(tr('sec.weak'), 'error');
    }
  });
}

/* ---------------- Événements ---------------- */

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) { showView(nav.dataset.view); return; }

  const goto = e.target.closest('[data-goto]');
  if (goto) { showView(goto.dataset.goto); return; }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;

  switch (el.dataset.action) {
    case 'edit-invoice': openInvoiceEditor(id); break;
    case 'validate-invoice': await validateInvoice(id); break;
    case 'delete-invoice': await deleteInvoice(id); break;
    case 'preview-invoice': await window.factapi.previewInvoice(id); break;
    case 'pdf-invoice': {
      const res = await window.factapi.exportPdf(id);
      if (res && !res.canceled) toast(tr('inv.pdfSaved', { path: res.path }), 'success');
      break;
    }
    case 'edit-quote': openQuoteEditor(id); break;
    case 'convert-quote': await convertQuoteToInvoice(id); break;
    case 'preview-quote': await window.factapi.quotePreview(id); break;
    case 'pdf-quote': {
      const res = await window.factapi.quoteExportPdf(id);
      if (res && !res.canceled) toast(tr('quo.pdfSaved', { path: res.path }), 'success');
      break;
    }
    case 'delete-quote': await deleteQuote(id); break;
    case 'pay-invoice': openPaymentModal(id); break;
    case 'pay-edit': openEditPaymentModal(id, el.dataset.pay); break;
    case 'pay-delete': await deletePayment(id, el.dataset.pay); break;
    case 'draft-from-tx': {
      const tx = txById(id);
      if (!tx) break;
      const inv = draftFromTx(tx);
      state.invoices.push(inv);
      tx.linkedInvoiceId = inv.id;
      await persist('invoices', 'transactions');
      renderAll();
      openInvoiceEditor(inv.id);
      break;
    }
    case 'ignore-tx': {
      const tx = txById(id);
      if (tx) { tx.status = 'ignored'; await persist('transactions'); renderAll(); }
      break;
    }
    case 'restore-tx': {
      const tx = txById(id);
      if (tx) { tx.status = 'new'; await persist('transactions'); renderAll(); }
      break;
    }
    case 'edit-client': openClientEditor(id); break;
    case 'delete-client': await deleteClient(id); break;
    case 'edit-rule': openRuleEditor(id); break;
    case 'delete-rule': await deleteRule(id); break;
    case 'delete-desig': {
      const i = Number(el.dataset.i);
      const list = desigList();
      const removed = list[i];
      if (removed !== undefined) {
        list.splice(i, 1);
        state.settings.designations = list;
        /* Les clients qui utilisaient cette désignation repassent par défaut */
        state.clients.forEach((c) => { if (c.desig === removed) delete c.desig; });
        await persist('settings', 'clients');
        renderDesignations();
        toast(tr('set.desigDeleted'), 'success');
      }
      break;
    }
  }
});

$('#btn-pick-csv').addEventListener('click', pickStatement);
$('#btn-do-import').addEventListener('click', doImport);
/* Affiche la désignation par défaut qui sera posée sur les lignes des factures
   générées (modifiable ensuite dans l'éditeur). */
function syncDesigHint() {
  const el = $('#imp-desig-hint');
  if (!el) return;
  const sel = $('#import-client');
  const d = sel && sel.value && sel.value !== '__rules__' ? desigForClient(sel.value) : '';
  if (d) { el.textContent = tr('imp.desig', { t: d }); el.hidden = false; }
  else { el.hidden = true; }
}

$('#import-client').addEventListener('change', () => { syncImportModeUI(); syncDesigHint(); });
$('#btn-cancel-import').addEventListener('click', () => {
  pendingImport = null;
  $('#import-preview').hidden = true;
  $('#csv-file-name').textContent = '';
});
$('#import-issue-date').addEventListener('change', (e) => {
  manualDate(e.target); /* saisi à la main : le re-rendu ne l'écrasera plus */
  $('#import-due-date').value = addDays(e.target.value || todayISO(), paymentDelay());
});
$('#import-due-date').addEventListener('change', (e) => manualDate(e.target));

/* Changement de période : l'aperçu est immédiatement recalculé */
$$('#import-from, #import-to').forEach((el) => el.addEventListener('change', () => {
  if (pendingImport && pendingImport.parsed) renderImportPreview(pendingImport.parsed);
}));

$('#tx-search').addEventListener('input', renderTransactions);
$('#tx-filter').addEventListener('change', renderTransactions);
$('#inv-search').addEventListener('input', renderValidated);
$('#inv-filter').addEventListener('change', renderValidated);
$('#btn-account-month').addEventListener('click', () => openAccountPeriodModal());
$('#pay-search').addEventListener('input', renderPayments);
$('#pay-filter').addEventListener('change', renderPayments);

$('#btn-generate').addEventListener('click', openGenerateModal);

$('#btn-new-invoice').addEventListener('click', () => openInvoiceEditor(null));
$('#btn-delete-all-drafts').addEventListener('click', deleteAllDrafts);
$('#btn-new-invoice-dash').addEventListener('click', () => openInvoiceEditor(null));
$('#btn-new-invoice-inv').addEventListener('click', () => openInvoiceEditor(null));
$('#btn-new-quote').addEventListener('click', () => { showView('quotes'); openQuoteEditor(null); });
/* Filtres de la liste des devis */
$('#quote-search').addEventListener('input', renderQuotes);
$('#quote-filter').addEventListener('change', renderQuotes);
$('#btn-new-client').addEventListener('click', () => openClientEditor(null));
$('#btn-new-rule').addEventListener('click', () => openRuleEditor(null));

$$('.lang-btn').forEach((b) => b.addEventListener('click', () => setLanguage(b.dataset.lang)));

/* ---- Sécurité ---- */
$('#btn-lock').addEventListener('click', lockNow);
const secEls = ['btn-sec-change', 'btn-sec-disable'];
secEls.forEach((sel) => {
  const el = $('#' + sel);
  if (el) el.addEventListener('click', async () => {
    if (sel === 'btn-sec-change') openChangePasswordModal();
    else if (sel === 'btn-sec-disable') await disableProtection();
  });
});
const btnSecEnable = $('#btn-sec-enable');
if (btnSecEnable) btnSecEnable.addEventListener('click', async () => {
  /* Réactivation : même parcours que l'écran d'activation initial */
  lockMode = 'setup';
  secForceScreen = true;
  secState.configured = false; secState.locked = false; secState.authorized = true;
  renderSecScreen();
});

/* « Verrouiller à la fermeture » : option enregistrée dans les Paramètres ;
   le process principal la relit au quit / à la fermeture de la fenêtre. */
const lockOnQuitChk = $('#set-lock-on-quit');
if (lockOnQuitChk) lockOnQuitChk.addEventListener('change', async () => {
  state.settings.lockOnQuit = lockOnQuitChk.checked;
  await persist('settings');
});

$('#btn-export-db').addEventListener('click', exportBackup);
$('#btn-import-db').addEventListener('click', importBackup);
$('#btn-open-folder').addEventListener('click', openDataFolder);
$('#btn-choose-db').addEventListener('click', chooseDataDir);
$('#btn-reset-db').addEventListener('click', resetDataDir);
const btnRestoreAuto = $('#btn-restore-auto');
if (btnRestoreAuto) btnRestoreAuto.addEventListener('click', restoreAutoBackup);

/* ---- Mise à jour automatique (electron-updater) ---- */
const btnCheckUpdate = $('#btn-check-update');
if (btnCheckUpdate) btnCheckUpdate.addEventListener('click', checkUpdates);
const btnInstallUpdate = $('#btn-install-update');
if (btnInstallUpdate) btnInstallUpdate.addEventListener('click', installUpdate);

/* ---- Désignations des factures (Paramètres) ---- */
async function addDesignation() {
  const inp = $('#desig-new');
  const text = inp.value.trim();
  if (!text) return;
  const list = desigList();
  if (list.indexOf(text) === -1) {
    list.push(text);
    state.settings.designations = list;
    await persist('settings');
    toast(tr('set.desigAdded'), 'success');
  }
  inp.value = '';
  renderDesignations();
}
$('#btn-add-desig').addEventListener('click', addDesignation);
$('#desig-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDesignation(); } });
$('#desig-clients').addEventListener('change', async (e) => {
  const sel = e.target.closest('.desig-client');
  if (!sel) return;
  const c = clientById(sel.dataset.id);
  if (!c) return;
  if (sel.value) c.desig = sel.value; else delete c.desig;
  await persist('clients');
});

/* ===================================================================
   Modèle des documents (factures & devis) — Paramètres
   Le schéma et la normalisation vivent dans doc-config.js (window.DOC).
   =================================================================== */
function renderDocSettings() {
  if (typeof DOC === 'undefined') return;
  const dc = DOC.normalize(state.settings);
  const set = (id, val) => { const el = $('#' + id); if (el) el.value = val; };
  const chk = (id, val) => { const el = $('#' + id); if (el) el.checked = !!val; };
  set('doc-template', dc.template);
  set('doc-accent', dc.accent);
  set('doc-accent-color', dc.accentColor);
  set('doc-paper', dc.paper);
  set('doc-margins', dc.margins);
  set('doc-density', dc.density);
  set('doc-font', dc.font);
  set('doc-bilingual', dc.bilingual);
  set('doc-watermark', dc.watermark);
  set('doc-invoice-template', dc.invoiceTemplate);
  set('doc-quote-template', dc.quoteTemplate);
  set('doc-words', dc.blocks.words);
  chk('doc-logo', dc.blocks.logo);
  chk('doc-namear', dc.blocks.nameAr);
  chk('doc-id-ice', dc.blocks.ids.ice);
  chk('doc-id-if', dc.blocks.ids['if']);
  chk('doc-id-rc', dc.blocks.ids.rc);
  chk('doc-id-patente', dc.blocks.ids.patente);
  chk('doc-id-cnss', dc.blocks.ids.cnss);
  chk('doc-id-tva', dc.blocks.ids.tva);
  chk('doc-clientids', dc.blocks.clientIds);
  chk('doc-tvadetail', dc.blocks.tvaDetail);
  chk('doc-regime', dc.blocks.regime);
  chk('doc-rib', dc.blocks.rib);
  chk('doc-notes', dc.blocks.notes);
  chk('doc-legal', dc.blocks.legal);
  chk('doc-signature', dc.blocks.signature);
  chk('doc-duedate', dc.blocks.dueDate);
  chk('doc-validity', dc.blocks.validity);
  chk('doc-colsqty', dc.blocks.colsQty);
  chk('doc-colspu', dc.blocks.colsPu);
  chk('doc-colstva', dc.blocks.colsTva);
  chk('doc-colstotal', dc.blocks.colsTotal);
  const th = $('#doc-header'); if (th) th.value = dc.texts.header;
  const tt = $('#doc-terms'); if (tt) tt.value = dc.texts.terms;
  const tf = $('#doc-footer'); if (tf) tf.value = dc.texts.footer;
  /* la couleur personnalisée n'est utile que si l'accent « custom » est choisi */
  const cc = $('#doc-accent-color');
  if (cc) cc.disabled = (dc.accent !== 'custom');
  updateDocIdsWarn();
}

/* Affiche un avertissement lorsqu'un identifiant légal RENSEIGNÉ est masqué
   (garde-fou de conformité : ICE / IF / RC / CNSS / TVA). */
function updateDocIdsWarn() {
  const el = $('#doc-ids-warn');
  if (!el) return;
  const co = state.settings.company || {};
  const map = [
    ['doc-id-ice', co.ice], ['doc-id-if', co.idFiscal], ['doc-id-rc', co.rc],
    ['doc-id-patente', co.patente], ['doc-id-cnss', co.cnss], ['doc-id-tva', co.tvaNumber]
  ];
  const hidden = map.some(([id, value]) => {
    const c = $('#' + id);
    return c && !c.checked && String(value || '').trim();
  });
  el.hidden = !hidden;
}

/* Lit le formulaire du modèle de documents et renvoie un objet normalisé. */
function readDocSettings() {
  if (typeof DOC === 'undefined') return null;
  const val = (id) => { const el = $('#' + id); return el ? el.value : ''; };
  const box = (id) => { const el = $('#' + id); return el ? !!el.checked : false; };
  return DOC.normalize({
    doc: {
      template: val('doc-template'),
      accent: val('doc-accent'),
      accentColor: val('doc-accent-color'),
      paper: val('doc-paper'),
      margins: val('doc-margins'),
      density: val('doc-density'),
      font: val('doc-font'),
      bilingual: val('doc-bilingual'),
      watermark: val('doc-watermark'),
      invoiceTemplate: val('doc-invoice-template'),
      quoteTemplate: val('doc-quote-template'),
      blocks: {
        logo: box('doc-logo'),
        nameAr: box('doc-namear'),
        ids: {
          ice: box('doc-id-ice'),
          if: box('doc-id-if'),
          rc: box('doc-id-rc'),
          patente: box('doc-id-patente'),
          cnss: box('doc-id-cnss'),
          tva: box('doc-id-tva')
        },
        clientIds: box('doc-clientids'),
        tvaDetail: box('doc-tvadetail'),
        regime: box('doc-regime'),
        rib: box('doc-rib'),
        notes: box('doc-notes'),
        legal: box('doc-legal'),
        signature: box('doc-signature'),
        dueDate: box('doc-duedate'),
        validity: box('doc-validity'),
        colsQty: box('doc-colsqty'),
        colsPu: box('doc-colspu'),
        colsTva: box('doc-colstva'),
        colsTotal: box('doc-colstotal'),
        words: val('doc-words')
      },
      texts: {
        header: (($('#doc-header') || {}).value || ''),
        terms: (($('#doc-terms') || {}).value || ''),
        footer: (($('#doc-footer') || {}).value || '')
      }
    }
  });
}

/* Applique immédiatement le modèle de document : lit le formulaire, met à jour
   l'état et persiste. Évite de dépendre du bouton « Enregistrer les paramètres »
   situé dans une autre carte (cause d'un réglage non appliqué aux factures). */
let docSaveTimer = null;
function applyDocSettings(opts) {
  const dc = readDocSettings();
  if (!dc) return;
  state.settings.doc = dc;
  updateDocIdsWarn();
  if (opts && opts.immediate) {
    if (docSaveTimer) { clearTimeout(docSaveTimer); docSaveTimer = null; }
    return persist('settings');
  }
  if (docSaveTimer) clearTimeout(docSaveTimer);
  docSaveTimer = setTimeout(() => { docSaveTimer = null; persist('settings'); }, 400);
}

/* Active/désactive la pipette selon le choix « couleur personnalisée ». */
const docAccentSel = $('#doc-accent');
if (docAccentSel) {
  docAccentSel.addEventListener('change', () => {
    const cc = $('#doc-accent-color');
    if (cc) cc.disabled = (docAccentSel.value !== 'custom');
  });
}

/* Réglages « live » : toute modification de la carte est enregistrée aussitôt
   (immédiat pour les listes/cases, différé de 400 ms pour les zones de texte). */
const cardDoc = $('#card-doc');
if (cardDoc) {
  cardDoc.querySelectorAll('select, input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => applyDocSettings({ immediate: true }));
  });
  cardDoc.querySelectorAll('textarea, input[type="color"]').forEach((el) => {
    el.addEventListener('input', () => applyDocSettings());
  });
}

/* Réinitialiser le modèle aux valeurs par défaut. */
const btnResetDoc = $('#btn-reset-doc');
if (btnResetDoc) {
  btnResetDoc.addEventListener('click', () => {
    if (typeof DOC === 'undefined') return;
    state.settings.doc = JSON.parse(JSON.stringify(DOC.DEFAULT));
    renderDocSettings();
    applyDocSettings({ immediate: true });
    toast(tr('set.docReset'), 'success');
  });
}

/* Aperçu : enregistre d'abord le réglage courant, puis ouvre la dernière
   facture (sinon le dernier devis) avec ce modèle. */
const btnPreviewDoc = $('#btn-preview-doc');
if (btnPreviewDoc) {
  btnPreviewDoc.addEventListener('click', async () => {
    await applyDocSettings({ immediate: true });
    const inv = (state.invoices || []).slice().sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')))[0];
    const q = (state.quotes || []).slice().sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')))[0];
    if (inv) { await window.factapi.previewInvoice(inv.id); return; }
    if (q) { await window.factapi.quotePreview(q.id); return; }
    toast(tr('set.docNoDoc'), 'info');
  });
}

$('#btn-save-settings').addEventListener('click', async () => {
  /* Nom de société = nom du client de la licence (figé) quand elle est active. */
  const licName = licState.configured && licState.customer ? licState.customer : '';
  state.settings.company = {
    name: licName || $('#set-name').value.trim(),
    nameAr: $('#set-name-ar').value.trim(),
    ice: $('#set-ice').value.trim(),
    idFiscal: $('#set-if').value.trim(),
    rc: $('#set-rc').value.trim(),
    patente: $('#set-patente').value.trim(),
    cnss: $('#set-cnss').value.trim(),
    tvaNumber: $('#set-tva').value.trim(),
    address: $('#set-address').value.trim(),
    zip: $('#set-zip').value.trim(),
    city: $('#set-city').value.trim(),
    country: $('#set-country').value.trim() || 'Maroc',
    email: $('#set-email').value.trim(),
    phone: $('#set-phone').value.trim(),
    web: $('#set-web').value.trim(),
    iban: $('#set-iban').value.trim(),
    /* le logo est conservé tel quel (il n'est pas saisi dans le formulaire) */
    logo: (state.settings.company && state.settings.company.logo) || undefined
  };
  state.settings.currency = 'MAD';
  state.settings.tvaRate = Number($('#set-tvarate').value) || 0;
  state.settings.tvaRegime = $('#set-regime').value || 'reel';
  state.settings.paymentDelay = Number($('#set-delay').value) || 0;
  state.settings.theme = ($('#set-theme') && $('#set-theme').value === 'dark') ? 'dark' : 'light';
  state.settings.invoicePrefix = $('#set-prefix').value.trim() || 'FA';
  state.settings.quotePrefix = $('#set-quote-prefix').value.trim() || 'DV';
  const qv = Math.floor(Number($('#set-quote-validity').value));
  state.settings.quoteValidityDays = (qv && qv > 0) ? qv : 30;
  /* Début de numérotation : figé dès qu'une facture existe */
  const startNum = $('#set-startnum');
  if (startNum) {
    state.settings.invoiceStart = startNum.disabled
      ? (state.settings.invoiceStart || 1)
      : Math.max(1, Math.floor(Number(startNum.value) || 1));
  }
  /* Modèle des documents (factures & devis) */
  const dcNew = readDocSettings();
  if (dcNew) state.settings.doc = dcNew;
  await persist('settings');
  applyTheme();
  renderAll();
  $('#settings-saved').textContent = tr('set.saved');
  setTimeout(() => { $('#settings-saved').textContent = ''; }, 2500);
  toast(tr('set.toast'), 'success');
});

/* ---- Apparence : bascule clair / sombre (bouton sidebar + sélecteur Paramètres) ---- */
$('#btn-theme').addEventListener('click', () => {
  state.settings.theme = (state.settings.theme === 'dark') ? 'light' : 'dark';
  applyTheme();
  persist('settings');
});

/* Le sélecteur de thème des Paramètres est appliqué sur le champ « change »
   et persisté au moment de la sauvegarde des paramètres. */
const themeSel = $('#set-theme');
if (themeSel) {
  themeSel.addEventListener('change', () => {
    state.settings.theme = (themeSel.value === 'dark') ? 'dark' : 'light';
    applyTheme();
  });
}

/* ---- Onboarding : bouton « Plus tard » (ferme l'invite) ---- */
$('#btn-hide-welcome').addEventListener('click', () => {
  const w = $('#welcome-banner');
  if (w) w.hidden = true;
});

/* ---- Onboarding : relancer la visite guidée depuis Paramètres → Aide ---- */
const tourRestartBtn = $('#btn-tour-restart');
if (tourRestartBtn) tourRestartBtn.addEventListener('click', () => {
  if (window.ONBOARD) window.ONBOARD.start();
});

/* ---- Guide d'utilisation : aperçu et export PDF (Paramètres → Aide) ---- */
const guideOpenBtn = $('#btn-guide-open');
if (guideOpenBtn) guideOpenBtn.addEventListener('click', async () => {
  try {
    const ok = await window.factapi.guidePreview(currentLang());
    if (ok === false) toast(tr('main.previewFail'), 'error');
  } catch (e) {
    toast(tr('main.previewFail'), 'error');
  }
});

const guidePdfBtn = $('#btn-guide-pdf');
if (guidePdfBtn) guidePdfBtn.addEventListener('click', async () => {
  try {
    const res = await window.factapi.guideExportPdf(currentLang());
    if (!res || res.canceled) return;
    if (res.error) { toast(tr('set.exportFail', { msg: res.msg || res.error }), 'error'); return; }
    toast(tr('set.exportDone', { path: res.path }), 'success');
  } catch (e) {
    toast(tr('set.exportFail', { msg: e.message }), 'error');
  }
});

/* ---- Menu applicatif natif : actions envoyées par le process principal ----
   (Quitter ⌘Q et rôles sont gérés nativement ; ici : Aide F1, Verrouiller ⌘L,
   Paramètres ⌘,, Guide…). */
if (window.factapi && typeof window.factapi.onMenuAction === 'function') {
  window.factapi.onMenuAction((action) => {
    if (action === 'help') { if (window.HELPUI) window.HELPUI.openContextual(); }
    else if (action === 'lock') { lockNow(); }
    else if (action === 'settings') { showView('settings'); }
    else if (action === 'guide') { const b = $('#btn-guide-open'); if (b) b.click(); }
  });
}

/* ---- Sélecteur de mois du tableau de bord ---- */
const dashMonthSel = $('#dash-month');
if (dashMonthSel) {
  dashMonthSel.addEventListener('change', () => renderDashboard());
}

/* ---- Logo de la société (choix du fichier, aperçu, retrait) ---- */
$('#btn-pick-logo').addEventListener('click', async () => {
  if (!window.factapi || !window.factapi.pickLogo) return;
  const res = await window.factapi.pickLogo();
  if (!res || !res.dataUri) return; /* annulé */
  const co = state.settings.company || {};
  co.logo = { path: res.path, name: res.name, dataUri: res.dataUri };
  await persist('settings');
  renderAll();
  toast(tr('set.logoToast'), 'success');
});

$('#btn-remove-logo').addEventListener('click', async () => {
  if (state.settings.company) delete state.settings.company.logo;
  await persist('settings');
  renderAll();
  toast(tr('set.logoToast'), 'success');
});

/* ---- Export comptable : paquet « clôture de période » ---- */
$('#btn-export-close-period').addEventListener('click', async () => {
  const from = $('#set-close-from').value;
  const to = $('#set-close-to').value;
  if (!from || !to) { toast(tr('set.closeErrPeriod'), 'error'); return; }
  if (!window.factapi || !window.factapi.exportClosePeriod) { toast(tr('set.closeErr'), 'error'); return; }
  const res = await window.factapi.exportClosePeriod({ from, to });
  if (!res || res.canceled) return;
  if (res.error) {
    toast(tr('set.closeErr') + (res.msg || res.error), 'error');
    return;
  }
  const msg = $('#close-export-msg');
  if (msg) msg.textContent = tr('set.closeDone', { n: res.nFiles, p: res.path });
  toast(tr('set.closeToast'), 'success');
  /* Le mois transmis peut être marqué « comptabilisé » : on propose le dernier
     mois de la période exportée qui contient encore des factures non comptabilisées. */
  const inRange = state.invoices
    .filter((i) => i.status === 'validated' && !isAccounted(i) && i.issueDate >= from && i.issueDate <= to)
    .map(monthKeyOf).filter(Boolean).sort();
  if (inRange.length) openAccountPeriodModal(inRange[inRange.length - 1]);
});

/* ---------------- Démarrage ---------------- */

/* Langue immédiate (dir/labels) avant même la lecture du stockage */
if (typeof I18N !== 'undefined') I18N.setLang(state.settings.language || 'fr');
syncLangButtons();

/* Version affichée dans la sidebar : elle est incrémentée à CHAQUE
   modification dans package.json (1.0 → 1.1 → 1.2 …), affichée « major.minor » */
(async function showVersion() {
  try {
    if (window.factapi && window.factapi.appVersion) {
      const v = await window.factapi.appVersion();
      if (v) $('#app-version').textContent = 'v' + v;
    }
  } catch (e) { /* la version n'est pas bloquante */ }
})();

(async function init() {
  try {
    /* Licence d'utilisation (anti-contrefaçon) : l'application n'est active que
       sur les postes liés à une clé valide. Sinon : écran d'enregistrement. */
    if (window.factapi && window.factapi.licenseStatus) {
      await refreshLicenseStatus();
      if (licGateActive()) return;
    }
    /* Sécurité : verrouillage / activation / poste autorisé avant toute donnée */
    if (window.factapi && window.factapi.authStatus) {
      await refreshSecStatus();
      /* Sans protection configurée, l'application s'ouvre normalement :
         l'activation se fait depuis Paramètres → Sécurité. */
      if (secState.configured && (secState.locked || !secState.authorized)) return;
    }
    await loadAppData();
  } catch (e) {
    toast(tr('common.loadError', { msg: e.message }), 'error');
  }
})();

/* Chargement des données + premier rendu (après déverrouillage ou au démarrage). */
async function loadAppData() {
  try {
    const data = await window.factapi.storeGet();
    if (data && data.error === 'locked') { await refreshSecStatus(); return; }
    try {
      dataPath = (window.factapi.backupDataPath ? await window.factapi.backupDataPath() : '') || '';
    } catch (e) { dataPath = ''; }
    state.settings = data.settings || {};
    if (!state.settings.language) state.settings.language = 'fr';
    if (!state.settings.currency) state.settings.currency = 'MAD';
    if (!state.settings.tvaRegime) state.settings.tvaRegime = 'reel';
    state.clients = data.clients || [];
    state.invoices = data.invoices || [];
    state.transactions = data.transactions || [];
    state.rules = data.rules || [];
    state.quotes = data.quotes || [];
    state.meta = data.meta || { invoiceSeq: 0, quoteSeq: 0 };
    /* Réparation : factures enregistrées sans identifiant (bug antérieur) —
       sans id, l'éditeur se rouvrait vide et « Régler » ne trouvait pas la facture. */
    let repairedIds = false;
    state.invoices.forEach((i) => { if (!i.id) { i.id = uid(); repairedIds = true; } });
    if (typeof I18N !== 'undefined') I18N.setLang(state.settings.language);
    syncLangButtons();
    /* Mise à jour : les états poussés par le process principal alimentent la
       carte Paramètres → Mises à jour (aucune action tant que la CA est verrouillée). */
    if (window.factapi && typeof window.factapi.onUpdateStatus === 'function') {
      window.factapi.onUpdateStatus(applyUpdateStatus);
    }
    renderAll();
    applyTheme();
    if (repairedIds) persist('invoices');
    /* Onboarding : visite guidée à la première utilisation (jamais deux fois). */
    if (window.ONBOARD) window.ONBOARD.maybeStart();
  } catch (e) {
    toast(tr('common.loadError', { msg: e.message }), 'error');
  }
}
