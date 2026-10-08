'use strict';

/* Extraction de relevés bancaires au format PDF.
   - mise en page restituée (texte + coordonnées x)
   - détection des colonnes Date / Libellé / Débit / Crédit / Solde
   - repli heuristique (signes du fichier, delta de solde) si pas d'en-tête */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const I18N = require('../renderer/i18n.js');

let pdfjsPromise = null;

/* Dans l'application packagée, pdfjs-dist est extrait de l'archive (asarUnpack) :
   les chemins doivent pointer vers app.asar.unpacked, seul lisible « en dur »
   pour un import ESM ainsi que pour les polices / cmaps. */
function unpacked(p) {
  return String(p).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

function pdfjsRoot() {
  return unpacked(path.dirname(path.dirname(require.resolve('pdfjs-dist'))));
}

async function loadPdfjs() {
  if (!pdfjsPromise) {
    const entry = path.join(pdfjsRoot(), 'legacy', 'build', 'pdf.mjs');
    pdfjsPromise = import(pathToFileURL(entry).href);
  }
  return pdfjsPromise;
}

/* ---------- petits utilitaires ---------- */

function normText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return NaN;
  let t = String(raw);
  const neg = /^\s*\(/.test(t) || /^[-−–]/.test(t) || /\(\s*$/.test(t);
  t = t.replace(/[()\s\u00a0]/g, '').replace(/[-−–]/g, '');
  if (!/\d/.test(t)) return NaN;
  if (t.includes(',') && t.includes('.')) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (t.includes(',')) {
    const parts = t.split(',');
    const after = parts.length > 1 ? parts[1] : '';
    t = (parts.length > 2 || after.length === 3) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if ((t.match(/\./g) || []).length > 1) {
    t = t.replace(/\./g, '');
  }
  const n = parseFloat(t);
  if (isNaN(n)) return NaN;
  return neg ? -n : n;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function pad(n) { return String(n).padStart(2, '0'); }

/* Normalise une date trouvée en début de ligne → AAAA-MM-JJ */
function makeFrDate(y, d, m) {
  // format français : JJ/MM/AAAA (inversion automatique si MM/JJ)
  y = Number(y); d = Number(d); m = Number(m);
  if (m > 12 && d <= 12) { const t = m; m = d; d = t; }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += y > 70 ? 1900 : 2000;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function makeIsoDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += y > 70 ? 1900 : 2000;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/* ---------- lecture du PDF ---------- */

function clusterRows(items) {
  const rows = [];
  const sorted = items
    .filter((it) => it && typeof it.str === 'string' && it.str !== '')
    .sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]));
  for (const it of sorted) {
    const y = it.transform[5];
    let row = rows.length ? rows[rows.length - 1] : null;
    if (!row || Math.abs(row.y - y) > 4) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
  }
  return rows;
}

/* Fusionne les fragments d'une ligne en conservant l'abscisse de chaque caractère */
function mergeLine(items) {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  let text = '';
  const xs = [];
  let prevEnd = null;
  for (const it of sorted) {
    const s = it.str;
    const x0 = it.transform[4];
    const width = typeof it.width === 'number' && it.width > 0 ? it.width : s.length * 4;
    if (prevEnd !== null) {
      const gap = x0 - prevEnd;
      if (gap > 1.5 && !/\s$/.test(text) && !/^\s/.test(s)) {
        text += ' ';
        xs.push((prevEnd + x0) / 2);
      }
    }
    const cw = width / Math.max(1, s.length);
    for (let i = 0; i < s.length; i++) {
      text += s[i];
      xs.push(x0 + i * cw);
    }
    prevEnd = x0 + width;
  }
  return { text, xs, items: sorted };
}

async function extractLines(filePath) {
  const pdfjs = await loadPdfjs();
  const pkgRoot = pdfjsRoot();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: path.join(pkgRoot, 'standard_fonts') + path.sep,
    cMapUrl: path.join(pkgRoot, 'cmaps') + path.sep,
    cMapPacked: true
  }).promise;

  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const row of clusterRows(content.items)) lines.push(mergeLine(row.items));
    if (typeof page.cleanup === 'function') page.cleanup();
  }
  if (typeof doc.cleanup === 'function') await doc.cleanup();
  if (typeof doc.destroy === 'function') await doc.destroy();
  return lines;
}

/* ---------- analyse ---------- */

/* Un montant ne peut pas commencer au milieu d'un nombre plus long :
   « 2026 800,00 » (date de valeur suivie du montant) ne doit pas être lu
   comme « 026 800,00 ». */
const NUM_SRC = '(?<!\\d)(?:\\(?[-−–]?\\d{1,3}(?:[\\s\u00a0.,]\\d{3})*(?:[.,]\\d{2})\\)?' +
  '|\\(?[-−–]?\\d+[.,]\\d{2}\\)?' +
  '|\\(?[-−–]\\d{1,3}(?:[\\s\u00a0.,]\\d{3})+\\)?)';

/* Dates : séparateur / - . ou espaces (relevés Attijariwafa :
   « 0016BK 01 09 LIBELLÉ 02 09 2026 800,00 »). Classes strictes
   (jour 01-31, mois 01-12) pour éviter les faux positifs dans les libellés. */
const DAY_SRC = '(?:3[01]|[12][0-9]|0[1-9]|[1-9])';
const MON_SRC = '(?:1[0-2]|0[1-9]|[1-9])';
const YEAR4_SRC = '(?:19|20)[0-9]{2}';
const SEP_SRC = '[\\s\\-/.]';

const DATE_ANY_RE = new RegExp(
  '(?<![0-9])(?:' +
  `(${YEAR4_SRC})${SEP_SRC}(${MON_SRC})${SEP_SRC}(${DAY_SRC})` +             // AAAA-MM-JJ
  `|(${DAY_SRC})${SEP_SRC}(${MON_SRC})${SEP_SRC}(${YEAR4_SRC}|[0-9]{2})` +  // JJ MM AAAA
  `|(${DAY_SRC})${SEP_SRC}(${MON_SRC})` +                                    // JJ MM (sans année)
  ')(?![0-9])', 'g');

/* Date de valeur accolée en fin de libellé : « …RECU DE MLLE AWTOUL SOPHIA01 09 2026 » */
const TRAIL_DATE_RE = /(?<![0-9])\d{1,2}[\s\-/.]\d{1,2}(?:[\s\-/.](?:\d{4}|\d{2}))?\s*$/;

/* Sens d'un mouvement quand le relevé n'affiche ni colonnes ni signe :
   « VIR…EMIS », « PRELEVEMENT », « PAIEMENT » = débit ;
   « RECU DE », « VERSEMENT », « REMISE » = crédit. */
const DEBIT_RE = /\b(emis|emises?|sortants?|paiement|prelevement|prlv|debit|debites?|frais|commission|comm|agios|impot|cotisation|retrait|dgi|assurance)\b/i;
const CREDIT_RE = /\b(recu|versement|versements|remise|remises|encaissement|recette|crediteur)\b/i;

function detectSense(label) {
  const s = normText(label);
  if (DEBIT_RE.test(s)) return 'debit';   // conflit → débit : ne jamais transformer une sortie en facture
  if (CREDIT_RE.test(s)) return 'credit';
  return null;
}

function hasExplicitSign(s) {
  return /^[-−–]/.test(s.trim()) || /^\(/.test(s.trim());
}

/* Cherche une date dans `text` à partir de `from`.
   anchored = true : elle doit commencer après les espaces de `from`
   (date de valeur placée juste après la date d'opération). */
function matchDate(text, from, anchored) {
  let i = from || 0;
  if (anchored) {
    while (i < text.length && /\s/.test(text[i])) i++;
  }
  DATE_ANY_RE.lastIndex = i;
  let m;
  while ((m = DATE_ANY_RE.exec(text))) {
    if (anchored && m.index !== i) return null;
    if (m[1] !== undefined) return { iso: true, y: m[1], mo: m[2], d: m[3], start: m.index, end: m.index + m[0].length };
    if (m[4] !== undefined) return { iso: false, y: m[6], mo: m[5], d: m[4], start: m.index, end: m.index + m[0].length };
    return { iso: false, y: null, mo: m[8], d: m[7], start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/* Date ISO (AAAA-MM-JJ) à partir d'un matchDate ; defaultYear si année absente */
function buildDate(hit, defaultYear) {
  if (hit.iso) return makeIsoDate(hit.y, hit.mo, hit.d);
  return makeFrDate(hit.y || defaultYear, hit.d, hit.mo);
}

function entriesFromLines(lines, opts) {
  const debug = !!(opts && opts.debug);
  const entries = [];
  const warnings = [];
  const texts = lines.map((l) => l.text);
  const allText = texts.join('\n');

  // Année par défaut (certains relevés n'affichent que JJ/MM)
  const years = {};
  const yearRe = /\b(20\d{2})\b/g;
  let ym;
  while ((ym = yearRe.exec(allText))) years[ym[1]] = (years[ym[1]] || 0) + 1;
  let defaultYear = new Date().getFullYear();
  let bestY = 0;
  for (const y of Object.keys(years)) {
    if (years[y] > bestY) { bestY = years[y]; defaultYear = Number(y); }
  }

  // En-tête de colonnes (fonctionne avec en-têtes alignés à gauche ou à droite)
  let cols = null;
  for (let i = 0; i < lines.length && !cols; i++) {
    const t = normText(texts[i]);
    if (!t.includes('debit') || !t.includes('credit')) continue;
    let d = null, c = null, s = null;
    for (const it of lines[i].items) {
      const n = normText(it.str);
      const w = typeof it.width === 'number' && it.width > 0 ? it.width : it.str.length * 5;
      if (n.includes('debit') && d === null) d = { x: it.transform[4], w };
      else if (n.includes('credit') && c === null) c = { x: it.transform[4], w };
      else if (n.includes('solde') && s === null) s = { x: it.transform[4], w };
    }
    if (d && c) {
      cols = {
        b1: Math.max(d.x + d.w, c.x),        // limite débit | crédit
        b2: s ? Math.max(c.x + c.w, s.x) : Infinity,  // limite crédit | solde
        xDebit: d.x
      };
    }
  }
  if (!cols) warnings.push(I18N.tr('pdf.warnCols'));
  if (debug) console.log('[cols]', JSON.stringify(cols));

  let prevBalance = null;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const text = texts[i];
    const xs = lines[i].xs;
    const tNorm = normText(text);
    if (tNorm.includes('debit') && tNorm.includes('credit')) continue; // en-tête

    // date d'opération : en début de ligne ou après un code (« 0016BK 01 09 »)
    const hit = matchDate(text, 0, false);
    let date = null;
    let dateEnd = 0;

    if (hit) {
      date = buildDate(hit, defaultYear);
      if (date) dateEnd = hit.end;
    }

    if (!date) {
      // ligne « Solde au 30/09 : 12 400,00 » → solde initial
      if (/solde/.test(tNorm) && prevBalance === null) {
        const nums0 = [...text.matchAll(new RegExp(NUM_SRC, 'g'))];
        if (nums0.length) prevBalance = round2(parseAmount(nums0[nums0.length - 1][0]));
      }
      continue;
    }

    // éventuelle date de valeur (2e date, juste après)
    const second = matchDate(text, dateEnd, true);
    if (second) {
      const sd = buildDate(second, defaultYear);
      if (sd) dateEnd = second.end;
    }

    // montants de la ligne (après les dates)
    const nums = [];
    const re = new RegExp(NUM_SRC, 'g');
    let mm;
    while ((mm = re.exec(text))) {
      if (mm.index < dateEnd) continue;
      const val = parseAmount(mm[0]);
      if (isNaN(val)) continue;
      nums.push({
        s: mm[0],
        val,
        index: mm.index,
        end: mm.index + mm[0].length,
        x: xs[mm.index] !== undefined ? xs[mm.index] : null,
        xEnd: xs[mm.index + mm[0].length - 1] !== undefined ? xs[mm.index + mm[0].length - 1] : null
      });
    }
    if (!nums.length) { skipped++; continue; }
    if (debug) console.log('[row]', JSON.stringify(text.slice(0, 110)),
      '\n   nums=', JSON.stringify(nums.map((n) => ({ s: n.s, x: n.x === null ? null : Math.round(n.x), c: n.x === null ? null : Math.round((n.x + n.xEnd) / 2) }))));

    let amount = null;
    let balance = null;
    let amountIndex = null;
    let signed = false; // signe certain : nombre signé, colonne Débit/Crédit ou delta de solde

    if (cols) {
      let credit = null, debit = null, solde = null;
      for (const n of nums) {
        if (n.x === null || n.xEnd === null) continue;
        const center = (n.x + n.xEnd) / 2;
        if (center < cols.xDebit - 15) continue; // nombre noyé dans le libellé
        if (center >= cols.b2) { if (!solde) solde = n; }
        else if (center >= cols.b1) { if (!credit) credit = n; }
        else { if (!debit) debit = n; }
      }
      if (credit) { amount = Math.abs(credit.val); amountIndex = credit.index; signed = true; }
      else if (debit) { amount = -Math.abs(debit.val); amountIndex = debit.index; signed = true; }
      if (solde) { balance = solde.val; if (amountIndex === null || amountIndex > solde.index) amountIndex = solde.index; }
    }

    if (amount === null) {
      if (cols && balance !== null && prevBalance !== null) {
        amount = round2(balance - prevBalance); // fiable : delta de solde
        amountIndex = nums[0].index;
        signed = true;
      } else if (nums.length === 1) {
        const n = nums[0];
        const around = text.slice(Math.max(0, n.index - 5), n.end + 5);
        if (hasExplicitSign(n.s)) { amount = n.val; signed = true; }
        else if (/(^|\W)DB(\W|$)/i.test(around)) { amount = -Math.abs(n.val); signed = true; }
        else { amount = Math.abs(n.val); }
        amountIndex = n.index;
      } else {
        const first = nums[0];
        const last = nums[nums.length - 1];
        if (prevBalance !== null) {
          if (Math.abs(prevBalance + first.val - last.val) < 0.02) amount = first.val;
          else if (Math.abs(prevBalance - Math.abs(first.val) - last.val) < 0.02) amount = -Math.abs(first.val);
          else amount = first.val;
          signed = true;
        } else {
          signed = hasExplicitSign(first.s);
          amount = signed ? first.val : Math.abs(first.val);
        }
        balance = last.val;
        amountIndex = first.index;
      }
    }

    if (amount === null || isNaN(amount)) { skipped++; continue; }
    if (debug) console.log('   → amount=', amount, 'balance=', balance, 'labelEnd=', amountIndex);

    const labelEnd = amountIndex !== null ? amountIndex : nums[0].index;
    const label = text.slice(dateEnd, labelEnd)
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—:•]+|[\s\-–—:•]+$/g, '')
      .trim()
      .replace(TRAIL_DATE_RE, '') // date de valeur accolée au libellé
      .replace(/^[\s\-–—:•]+|[\s\-–—:•]+$/g, '')
      .trim();

    if (!label) {
      // « SOLDE DEPART AU 31 08 2026 263,97 » → solde initial (ligne sans libellé)
      if (prevBalance === null && /solde/.test(tNorm) && nums.length) {
        const v = round2(Math.abs(nums[nums.length - 1].val));
        prevBalance = /debiteur/.test(tNorm) ? -v : v;
      }
      skipped++;
      continue;
    }

    /* relevé sans colonnes ni signe (type Attijariwafa) : sens déduit du libellé */
    if (!signed && !cols) {
      const sense = detectSense(label);
      if (sense) amount = sense === 'debit' ? -Math.abs(amount) : Math.abs(amount);
    }

    if (balance !== null && !isNaN(balance)) prevBalance = round2(balance);

    entries.push({ date, label, amount: round2(amount) });
  }

  if (!entries.length) {
    throw new Error(I18N.tr('pdf.noTx'));
  }

  return { entries, skipped, warnings };
}

async function extractEntries(filePath) {
  const lines = await extractLines(filePath);
  return entriesFromLines(lines);
}

module.exports = { extractEntries, extractLines, entriesFromLines, parseAmount };
