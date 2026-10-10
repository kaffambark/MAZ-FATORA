'use strict';

/* Paquet « clôture de période » pour le comptable :
   journal de ventes, récap TVA par taux, encaissements, balance âgée clients,
   journal des achats, balance âgée fournisseurs, rapprochement bancaire,
   factures PDF, manifeste JSON et empreinte SHA-256.
   Module PUR (aucune dépendance Electron) : utilisé par main.js et par le smoke.

   Format des CSV : séparateur « ; », décimales à point, BOM UTF-8 (Excel FR). */

const crypto = require('crypto');
const AGING = require('../renderer/aging.js');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const NUM = (n) => (Number(n) || 0).toFixed(2);

/* Noms de fichiers normalisés : société + période (AAAA-MM) */
function sanitizeBase(name) {
  const s = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'MAZ-FATORA';
}
function periodKey(from) {
  return String(from || '').replace(/^(\d{4})-(\d{2}).*$/, '$1-$2');
}

function invoiceTotals(inv) {
  let ht = 0, tva = 0;
  const byRate = {};      // TVA par taux
  const byRateBase = {};  // base HT par taux
  for (const l of inv.lines || []) {
    const lineHT = (Number(l.qty) || 0) * (Number(l.price) || 0);
    const rate = Number(l.tva) || 0;
    ht += lineHT;
    tva += lineHT * (rate / 100);
    byRate[rate] = round2((byRate[rate] || 0) + lineHT * (rate / 100));
    byRateBase[rate] = round2((byRateBase[rate] || 0) + lineHT);
  }
  ht = round2(ht); tva = round2(tva);
  return { ht, tva, ttc: round2(ht + tva), byRate, byRateBase };
}

function paidTotal(inv) {
  const recs = Array.isArray(inv.payments) ? inv.payments : [];
  if (recs.length) return round2(recs.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  return inv.paid ? invoiceTotals(inv).ttc : 0;
}

const METHODS = { cash: 'Espèces', cheque: 'Chèque', virement: 'Virement', cb: 'Carte bancaire', direct: 'Encaissement direct', other: 'Autre' };
const TX_STATUS = { new: 'Non traitée', linked: 'Rattachée', ignored: 'Ignorée' };
const REGIMES = { reel: 'Réel normal', simplifie: 'Simplifié', liberatoire: 'Versement libératoire', 'non-assujetti': 'Non assujetti à la TVA' };
const STATUT = (inv) => (inv.status === 'validated' ? 'Validée' : 'Brouillon');

/* ---------- CSV ---------- */
function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvText(rows) {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

/* ---------- ODS (OpenDocument Spreadsheet — LibreOffice / Excel) ----------
   Structure minimale valide : mimetype (1er, non compressé) + manifeste +
   content.xml. Chaque classeur a 2 lignes d'en-têtes « normalisés » :
   ligne 1 = FR (mêmes libellés que les CSV), ligne 2 = AR. Les montants sont
   typés numériques (office:value) pour une reprise directe en saisie comptable. */
const XMLE = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/\r?\n/g, ' ');

function odsCell(v) {
  const s = String(v === null || v === undefined ? '' : v).replace(/\r?\n/g, ' ').trim();
  if (s === '') return '<table:table-cell/>';
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return `<table:table-cell office:value-type="float" office:value="${s}"><text:p>${s}</text:p></table:table-cell>`;
  }
  return `<table:table-cell office:value-type="string"><text:p>${XMLE(s)}</text:p></table:table-cell>`;
}

function odsXml(sheetName, rows) {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const body = rows.map((r) => '<table:table-row>' + r.map(odsCell).join('') + '</table:table-row>').join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">' +
    '<office:body><office:spreadsheet>' +
    `<table:table table:name="${XMLE(sheetName)}">` +
    `<table:table-column table:number-columns-repeated="${cols}"/>` +
    body +
    '</table:table>' +
    '</office:spreadsheet></office:body></office:document-content>';
}

function odsBuffer(sheetName, rows) {
  const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${ODS_MIME}"/>` +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '</manifest:manifest>';
  /* Entrées dans l'ordre : mimetype en premier (exigence ODF), tout en STORED —
     zipBuffer est déterministe, l'empreinte du paquet reste stable. */
  return zipBuffer([
    { name: 'mimetype', buf: Buffer.from(ODS_MIME, 'utf8') },
    { name: 'META-INF/manifest.xml', buf: Buffer.from(manifest, 'utf8') },
    { name: 'content.xml', buf: Buffer.from(odsXml(sheetName, rows), 'utf8') }
  ]);
}

/* ---------- Contenus ---------- */
function clientNameOf(data, inv) {
  const c = (data.clients || []).find((x) => x.id === inv.clientId);
  return (c && c.name) || inv.clientName || '';
}
const linkedNumber = (data, tx) => {
  const inv = (data.invoices || []).find((x) => x.id === tx.linkedInvoiceId);
  return inv ? inv.number || '' : '';
};

function journalRows(data, invoices) {
  const rows = [['Date', 'N° facture', 'Client', 'Désignation', 'Qté', 'P.U. HT', 'TVA %', 'Montant HT', 'TVA', 'Total TTC', 'Statut', 'Encaissé', 'Reste à payer']];
  for (const inv of invoices) {
    const cname = clientNameOf(data, inv);
    const t = invoiceTotals(inv);
    const paid = paidTotal(inv);
    const lines = inv.lines && inv.lines.length ? inv.lines : [{ desc: '—', qty: '', price: '', tva: '' }];
    lines.forEach((l, idx) => {
      const lineHT = round2((Number(l.qty) || 0) * (Number(l.price) || 0));
      const rate = Number(l.tva) || 0;
      rows.push([
        inv.issueDate || '', inv.number || 'Brouillon', cname,
        l.desc || '', l.qty !== undefined && l.qty !== null ? l.qty : '',
        l.price !== undefined && l.price !== null ? NUM(l.price) : '',
        rate + ' %', NUM(lineHT), NUM(round2(lineHT * rate / 100)), NUM(t.ttc),
        STATUT(inv),
        idx === 0 ? NUM(paid) : '',
        idx === 0 ? NUM(Math.max(0, t.ttc - paid)) : ''
      ]);
    });
  }
  return rows;
}

function tvaRows(data, invoices) {
  const byRate = {};
  const byRateBase = {};
  let totHT = 0, totTVA = 0;
  for (const inv of invoices) {
    const t = invoiceTotals(inv);
    totHT = round2(totHT + t.ht);
    totTVA = round2(totTVA + t.tva);
    for (const r of Object.keys(t.byRate)) {
      byRate[r] = round2((byRate[r] || 0) + t.byRate[r]);
      byRateBase[r] = round2((byRateBase[r] || 0) + t.byRateBase[r]);
    }
  }
  const rows = [['Taux TVA', 'Base HT', 'TVA collectée']];
  Object.keys(byRate).sort((a, b) => Number(a) - Number(b)).forEach((r) => {
    rows.push([r + ' %', NUM(byRateBase[r] || 0), NUM(byRate[r] || 0)]);
  });
  rows.push(['TOTAL', NUM(totHT), NUM(totTVA)]);
  return rows;
}

function encaissementsRows(data, invoices, from, to) {
  const rows = [['Date', 'N° facture', 'Client', 'Montant', 'Mode', 'Référence', 'Statut facture']];
  const out = [];
  for (const inv of invoices) {
    for (const p of inv.payments || []) {
      if (!p.date || p.date < from || p.date > to) continue;
      out.push([
        p.date, inv.number || 'Brouillon', clientNameOf(data, inv),
        NUM(p.amount), METHODS[p.method] || 'Autre', p.reference || '', STATUT(inv)
      ]);
    }
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows.concat(out);
}

function todayISO() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

/* Balance âgée — moteur d'ancienneté PARTAGÉ (src/renderer/aging.js), le même
   que la vue in-app : les avoirs validés viennent en déduction du reste dû.
   Colonnes : Client, N° facture, Date, Échéance, Total TTC, Encaissé, Avoirs,
   Reste, Ancienneté (jours), Tranche. */
function balanceRows(data, invoices) {
  const rows = [['Client', 'N° facture', 'Date facture', 'Échéance', 'Total TTC', 'Encaissé', 'Avoirs', 'Reste', 'Ancienneté (jours)', 'Tranche']];
  const built = AGING.rows(invoices, { credits: data.creditNotes || [], ref: todayISO(), onlyValidated: false });
  const out = built.rows.map((r) => [
    r.clientName || clientNameOf(data, { clientId: r.clientId, clientName: r.clientName }),
    r.number || 'Brouillon', r.issueDate || '', r.dueDate || '',
    NUM(r.totalTTC), NUM(r.paid), NUM(r.credited), NUM(r.rest), r.days, AGING.labelFr(r.bucket)
  ]);
  return rows.concat(out);
}

/* Achats & dépenses (paiements fournisseurs) — feuille du paquet comptable.
   Chaque ligne : HT / TVA déductible / TTC, montant payé et reste à payer. */
const EXP_STATUS = { paid: 'Payé', partial: 'Partiel', unpaid: 'Impayé' };
function supplierNameOf(data, e) {
  const s = (data.suppliers || []).find((x) => x.id === e.supplierId);
  return (s && s.name) || e.supplier || '';
}
function expenseHtTva(e) {
  const ttc = round2(Number(e && e.amountTTC) || 0);
  const rate = Number(e && e.tvaRate) || 0;
  const ht = round2(ttc / (1 + rate / 100));
  return { ttc, ht, tva: round2(ttc - ht) };
}
function expensePaidTotal(e) {
  const recs = Array.isArray(e && e.payments) ? e.payments : [];
  if (recs.length) return round2(recs.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  return e && e.paid ? round2(Number(e.amountTTC) || 0) : 0;
}
function expenseStatus(e) {
  const paid = expensePaidTotal(e);
  const rest = round2((Number(e.amountTTC) || 0) - paid);
  if (rest <= 0.005) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

/* Journal des achats : achats/dépenses de la période. */
function achatsRows(data, expenses) {
  const rows = [['Date', 'Fournisseur', 'Libellé', 'Catégorie', 'Montant HT', 'TVA déductible', 'Total TTC', 'Payé', 'Reste à payer', 'Statut']];
  const out = expenses.map((e) => {
    const t = expenseHtTva(e);
    const paid = expensePaidTotal(e);
    return [
      e.date || '', supplierNameOf(data, e), e.label || '', e.category || '',
      NUM(t.ht), NUM(t.tva), NUM(t.ttc), NUM(paid), NUM(Math.max(0, t.ttc - paid)),
      EXP_STATUS[expenseStatus(e)] || ''
    ];
  });
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows.concat(out);
}

/* Balance âgée FOURNISSEURS — moteur d'ancienneté PARTAGÉ (AGING.expenseRows),
   le même que la vue in-app : le reste à payer est classé par ancienneté depuis
   la date d'achat. */
function balanceSupRows(data, expenses) {
  const rows = [['Fournisseur', 'Libellé', 'Date', 'Total TTC', 'Payé', 'Reste', 'Ancienneté (jours)', 'Tranche']];
  const built = AGING.expenseRows(expenses, { ref: todayISO() });
  const out = built.rows.map((r) => [
    r.supplierName || supplierNameOf(data, { supplierId: r.supplierId, supplier: r.supplierName }),
    r.label || '', r.date || '',
    NUM(r.totalTTC), NUM(r.paid), NUM(r.rest), r.days, AGING.labelFr(r.bucket)
  ]);
  return rows.concat(out);
}

function rapprochementRows(data, transactions) {
  const rows = [['Date', 'Libellé', 'Montant', 'Sens', 'Statut', 'Facture liée']];
  const out = transactions.map((t) => [
    t.date || '', t.label || '',
    NUM(Math.abs(Number(t.amount) || 0)),
    Number(t.amount) >= 0 ? 'Crédit' : 'Débit',
    TX_STATUS[t.status] || t.status || '',
    linkedNumber(data, t)
  ]);
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows.concat(out);
}

/* ---------- Empreinte ---------- */
function fileHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
/* Empreinte d'ensemble : concaténation canonique (noms triés) des fichiers de
   DONNÉES du paquet (CSV + PDF). Le manifeste et le fichier d'empreinte portent
   cette valeur : ils en sont exclus (sinon circularité). */
function fullHash(files) {
  const h = crypto.createHash('sha256');
  for (const f of files.slice().sort((a, b) => (a.name < b.name ? -1 : 1))) {
    h.update(f.name).update('\n').update(Buffer.isBuffer(f.buf) ? f.buf : Buffer.from(String(f.buf), 'utf8'));
  }
  return h.digest('hex');
}

/* ---------- Paquet ---------- */
function buildPack(data, opts) {
  const from = (opts && opts.from) || '';
  const to = (opts && opts.to) || '';
  const pdfs = (opts && opts.pdfs) || [];
  const version = (opts && opts.appVersion) || '';
  const now = new Date();
  const co = (data.settings && data.settings.company) || {};
  const regime = REGIMES[(data.settings && data.settings.tvaRegime) || 'reel'] || 'Réel normal';

  const inPeriod = (d) => d && d >= from && d <= to;
  const invoices = (data.invoices || []).filter((i) => inPeriod(i.issueDate));
  const transactions = (data.transactions || []).filter((t) => inPeriod(t.date));
  const expenses = (data.expenses || []).filter((e) => inPeriod(e.date));

  const base = sanitizeBase(co.name);
  const pk = periodKey(from);
  const files = [];

  /* En-têtes arabes des classeurs ODS — alignés exactement sur les en-têtes FR */
  const AR_JOURNAL = ['التاريخ', 'رقم الفاتورة', 'العميل', 'البيان', 'الكمية', 'الثمن الوحدوي خارج الضريبة', 'نسبة الضريبة %', 'المبلغ خارج الضريبة', 'الضريبة', 'المجموع شامل الضريبة', 'الحالة', 'المقبوض', 'الباقي'];
  const AR_TVA = ['نسبة الضريبة', 'الوعاء خارج الضريبة', 'الضريبة المحصلة'];
  const AR_ENCAISSEMENTS = ['التاريخ', 'رقم الفاتورة', 'العميل', 'المبلغ', 'وسيلة الأداء', 'المرجع', 'حالة الفاتورة'];
  const AR_BALANCE = ['العميل', 'رقم الفاتورة', 'تاريخ الفاتورة', 'الاستحقاق', 'المجموع شامل الضريبة', 'المقبوض', 'الإشعارات الدائنة', 'الباقي', 'القدم (أيام)', 'الشريحة'];
  const AR_ACHATS = ['التاريخ', 'المورد', 'البيان', 'الفئة', 'المبلغ خارج الضريبة', 'الضريبة القابلة للخصم', 'المجموع شامل الضريبة', 'المدفوع', 'الباقي للدفع', 'الحالة'];
  const AR_BALANCE_SUP = ['المورد', 'البيان', 'التاريخ', 'المجموع شامل الضريبة', 'المدفوع', 'الباقي', 'القدم (أيام)', 'الشريحة'];

  const reports = [
    { csv: 'journal.csv', ods: 'journal.ods', sheet: 'Journal de ventes', rows: journalRows(data, invoices), ar: AR_JOURNAL },
    { csv: 'tva.csv', ods: 'tva.ods', sheet: 'TVA', rows: tvaRows(data, invoices), ar: AR_TVA },
    { csv: 'encaissements.csv', ods: 'encaissements.ods', sheet: 'Encaissements', rows: encaissementsRows(data, invoices, from, to), ar: AR_ENCAISSEMENTS },
    { csv: 'balance-agee.csv', ods: 'balance-agee.ods', sheet: 'Balance âgée', rows: balanceRows(data, invoices.concat((data.invoices || []).filter((i) => !inPeriod(i.issueDate)))), ar: AR_BALANCE },
    { csv: 'achats.csv', ods: 'achats.ods', sheet: 'Achats & dépenses', rows: achatsRows(data, expenses), ar: AR_ACHATS },
    { csv: 'balance-agee-fournisseurs.csv', ods: 'balance-agee-fournisseurs.ods', sheet: 'Balance âgée fournisseurs', rows: balanceSupRows(data, data.expenses || []), ar: AR_BALANCE_SUP },
    { csv: 'rapprochement.csv', ods: null, sheet: null, rows: rapprochementRows(data, transactions), ar: null }
  ];
  for (const r of reports) {
    files.push({ name: `${base}_${pk}_${r.csv}`, buf: Buffer.from(csvText(r.rows), 'utf8') });
    if (r.ods) {
      files.push({
        name: `${base}_${pk}_${r.ods}`,
        buf: odsBuffer(r.sheet, [r.rows[0], r.ar, ...r.rows.slice(1)])
      });
    }
  }
  for (const pdf of pdfs) {
    files.push({ name: `factures/${pdf.name}`, buf: Buffer.isBuffer(pdf.buf) ? pdf.buf : Buffer.from(pdf.buf) });
  }

  const nPayments = invoices.reduce((s, inv) => s + ((inv.payments || []).length), 0);
  const nSupPayments = (data.expenses || []).reduce((s, e) => s + ((e.payments || []).length), 0);
  const hash = fullHash(files);
  const fileList = files.map((f) => ({
    name: f.name, size: Buffer.byteLength(f.buf), sha256: fileHash(Buffer.isBuffer(f.buf) ? f.buf : Buffer.from(f.buf))
  }));

  const manifest = {
    app: 'MAZ-FATORA',
    version,
    exportType: 'close-period',
    base,
    period: { from, to },
    society: {
      name: co.name || '',
      ice: co.ice || '', idFiscal: co.idFiscal || '',
      rc: co.rc || '', tvaNumber: co.tvaNumber || '',
      city: co.city || '', regime
    },
    counts: { invoices: invoices.length, payments: nPayments, transactions: transactions.length, expenses: expenses.length, supplierPayments: nSupPayments },
    exportedAt: now.toISOString(),
    fullHash: hash,
    files: fileList
  };

  const manifestName = `${base}_${pk}_infos.json`;
  files.push({ name: manifestName, buf: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });

  const lines = [
    'MAZ-FATORA — Empreinte du paquet comptable (clôture de période)',
    `Société : ${manifest.society.name || ''}`,
    `Période : ${from} → ${to}`,
    `Exporté le : ${manifest.exportedAt}`,
    'Fichiers :',
    ...fileList.map((f) => `  ${f.sha256}  ${f.name}`),
    '',
    `Empreinte d'ensemble (SHA-256) : ${hash}`
  ];
  files.push({ name: `${base}_${pk}_empreinte.txt`, buf: Buffer.from(lines.join('\n') + '\n', 'utf8') });

  return { base, period: { from, to }, files, manifest };
}

/* ---------- Zip minimal (méthode STORED, CRC-32 manuel) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipBuffer(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.buf) ? f.buf : Buffer.from(String(f.buf), 'utf8');
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms UTF-8
    local.writeUInt16LE(0, 8);      // STORED
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += 30 + name.length + data.length;
  }

  const cdStart = offset;
  const cdChunks = [];
  for (const c of central) {
    const e = Buffer.alloc(46);
    e.writeUInt32LE(0x02014b50, 0);
    e.writeUInt16LE(20, 4);
    e.writeUInt16LE(20, 6);
    e.writeUInt16LE(0x0800, 8);
    e.writeUInt16LE(0, 10);
    e.writeUInt16LE(0, 12);
    e.writeUInt16LE(0, 14);
    e.writeUInt32LE(c.crc, 16);
    e.writeUInt32LE(c.size, 20);
    e.writeUInt32LE(c.size, 24);
    e.writeUInt16LE(c.name.length, 28);
    e.writeUInt16LE(0, 30);
    e.writeUInt16LE(0, 32);
    e.writeUInt16LE(0, 34);
    e.writeUInt16LE(0, 36);
    e.writeUInt32LE(0, 38);
    e.writeUInt32LE(c.offset, 42);
    cdChunks.push(e, c.name);
  }
  const cdSize = cdChunks.reduce((s, c) => s + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...cdChunks, eocd]);
}

/* Lecture des entrées d'un zip (nom + taille) — utilisée par le smoke. */
function zipEntries(buf) {
  const out = [];
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return out;
  const count = buf.readUInt16LE(i + 10);
  const cdStart = buf.readUInt32LE(i + 16);
  let p = cdStart;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    out.push({
      name: buf.toString('utf8', p + 46, p + 46 + nlen),
      size: buf.readUInt32LE(p + 24)
    });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/* Extraction du contenu d'une entrée (méthode STORED uniquement) — le smoke
   s'en sert pour inspecter les .ods embarqués dans le paquet. */
function zipExtract(buf, name) {
  const i = buf.length - 22;
  let eocd = -1;
  for (let p = i; p >= 0; p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdStart = buf.readUInt32LE(eocd + 16);
  let p = cdStart;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nlen);
    const localOffset = buf.readUInt32LE(p + 42);
    if (entryName === name) {
      if (method !== 0) return null; /* STORED requis (nos zips le sont) */
      const lname = buf.readUInt16LE(localOffset + 26);
      const lextra = buf.readUInt16LE(localOffset + 28);
      return buf.slice(localOffset + 30 + lname + lextra, localOffset + 30 + lname + lextra + comp);
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

module.exports = { buildPack, zipBuffer, zipEntries, zipExtract, odsBuffer, fullHash, invoiceTotals, sanitizeBase, csvText };