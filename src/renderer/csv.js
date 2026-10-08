'use strict';

/* Parseur de relevés bancaires CSV/TSV.
   Gère : BOM, séparateurs ; , tab | , guillemets, montants à la française
   (1 234,56 MAD / DH / €, suffixe ou symbole acceptés), dates JJ/MM/AAAA et ISO,
   colonnes Débit/Crédit ou Montant. */

const CSV = (() => {

  function stripBom(s) {
    return s && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  }

  function detectDelimiter(text) {
    const line = stripBom(text).split(/\r?\n/)[0] || '';
    const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') inQuote = !inQuote;
      else if (!inQuote && ch in counts) counts[ch]++;
    }
    let best = ';';
    let n = -1;
    for (const k of Object.keys(counts)) {
      if (counts[k] > n) { n = counts[k]; best = k; }
    }
    return n === 0 ? ';' : best;
  }

  function parse(text) {
    text = stripBom(text);
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuote = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }

    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    const headers = (nonEmpty[0] || []).map((h) => String(h).trim());
    return { delimiter: delim, headers, rows: nonEmpty.slice(1) };
  }

  function norm(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s_]+/g, ' ')
      .trim();
  }

  function parseNumber(raw) {
    if (raw === null || raw === undefined) return NaN;
    let t = String(raw).replace(/[^\d,.\-+]/g, '').trim();
    if (t === '' || t === '-' || t === '+' || t === ',' || t === '.') return NaN;
    const neg = /^-/.test(t) || /\(\s*\d/.test(String(raw));
    t = t.replace(/[-+()]/g, '');

    const hasComma = t.includes(',');
    const hasDot = t.includes('.');
    if (hasComma && hasDot) {
      if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
    } else if (hasComma) {
      const parts = t.split(',');
      const after = parts.length > 1 ? parts[1] : '';
      if (parts.length > 2 || after.length === 3) t = t.replace(/,/g, '');
      else t = t.replace(',', '.');
    } else if (hasDot) {
      if (t.split('.').length > 2) t = t.replace(/\./g, '');
    }
    const n = parseFloat(t);
    if (isNaN(n)) return NaN;
    return neg ? -n : n;
  }

  function parseDate(raw) {
    if (raw === null || raw === undefined) return null;
    const t = String(raw).trim();
    if (!t) return null;
    const pad = (n) => String(n).padStart(2, '0');

    let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

    m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let d = Number(m[1]), mo = Number(m[2]), y = m[3];
      if (y.length === 2) y = Number(y) > 70 ? '19' + y : '20' + y;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    }
    const dt = new Date(t);
    if (!isNaN(dt.getTime())) {
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    }
    return null;
  }

  function mapColumns(headers) {
    const h = headers.map(norm);
    const find = (candidates) => {
      for (const c of candidates) {
        const i = h.indexOf(c);
        if (i !== -1) return i;
      }
      for (const c of candidates) {
        const i = h.findIndex((x) => x.includes(c));
        if (i !== -1) return i;
      }
      return null;
    };
    const date = find(['date operation', 'date de operation', 'date', 'jour']);
    const label = find(['libelle operation', 'libelle', 'description', 'motif', 'narration', 'detail', 'reference', 'label', 'contrepartie']);
    const debit = find(['debit', 'sortie', 'retrait', 'montant debit', 'depense']);
    const credit = find(['credit', 'entree', 'montant credit', 'encaissement']);
    const amount = find(['montant', 'amount', 'valeur', 'montant eur', 'somme']);
    const balance = find(['solde', 'balance']);
    return { date, label, debit, credit, amount, balance };
  }

  function firstNumericColumn(rows) {
    for (let i = 0; i < (rows[0] || []).length; i++) {
      let hits = 0;
      for (const r of rows.slice(0, 10)) {
        const v = parseNumber(r[i]);
        if (!isNaN(v)) hits++;
      }
      if (hits >= Math.min(3, rows.length)) return i;
    }
    return null;
  }

  /* Retourne { headers, entries:[{date,label,amount}], skipped, delimiter } */
  function toEntries(text) {
    const p = parse(text);
    let headers = p.headers;
    let rows = p.rows;
    let cols = mapColumns(headers);

    // Pas d'en-tête reconnu mais la première ligne ressemble à des données
    if (cols.date === null && parseDate(headers[0])) {
      rows = [headers, ...rows];
      const n = headers.length;
      cols = { date: 0, label: 1, amount: n === 3 ? 2 : n - 1, debit: null, credit: null, balance: null };
      headers = [
        typeof tr === 'function' ? tr('csv.hDate') : 'Date',
        typeof tr === 'function' ? tr('csv.hLabel') : 'Libellé',
        typeof tr === 'function' ? tr('csv.hAmount') : 'Montant'
      ];
    }

    if (cols.date === null) {
      throw new Error(typeof tr === 'function'
        ? tr('csv.noDate', { h: headers.join(' | ') })
        : 'Colonne de date introuvable. En-têtes détectés : ' + headers.join(' | '));
    }
    if (cols.label === null) cols.label = cols.date === 0 ? Math.min(1, headers.length - 1) : 0;
    if (cols.amount === null && cols.debit === null && cols.credit === null) {
      cols.amount = firstNumericColumn(rows);
    }
    if (cols.amount === null && cols.debit === null && cols.credit === null) {
      throw new Error(typeof tr === 'function'
        ? tr('csv.noAmount', { h: headers.join(' | ') })
        : 'Aucune colonne de montant trouvée. En-têtes : ' + headers.join(' | '));
    }

    const entries = [];
    let skipped = 0;

    for (const r of rows) {
      const date = parseDate(r[cols.date]);
      if (!date) { skipped++; continue; }
      const label = String(r[cols.label] === undefined ? '' : r[cols.label]).replace(/\s+/g, ' ').trim();
      if (!label) { skipped++; continue; }

      let amount = NaN;
      if (cols.debit !== null || cols.credit !== null) {
        const cRaw = cols.credit !== null ? parseNumber(r[cols.credit]) : NaN;
        const dRaw = cols.debit !== null ? parseNumber(r[cols.debit]) : NaN;
        if (!isNaN(cRaw) && cRaw !== 0) amount = cRaw;
        else if (!isNaN(dRaw)) amount = -Math.abs(dRaw);
      }
      if (isNaN(amount) && cols.amount !== null) amount = parseNumber(r[cols.amount]);
      if (isNaN(amount)) { skipped++; continue; }

      entries.push({ date, label, amount: Math.round(amount * 100) / 100 });
    }

    if (!entries.length) {
      throw new Error(typeof tr === 'function'
        ? tr('csv.noRows', { n: skipped })
        : 'Aucune transaction lisible dans ce fichier (' + skipped + ' lignes ignorées).');
    }

    return { headers, entries, skipped, delimiter: p.delimiter };
  }

  return { parse, toEntries, parseNumber, parseDate, norm, detectDelimiter };
})();
