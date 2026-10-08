'use strict';

/* Débogage de l'extraction PDF : node test/debug-pdf.js [fichier.pdf] */

const path = require('path');
const { extractLines, entriesFromLines } = require('../src/main/pdf-statement');

const file = process.argv[2] || path.join(__dirname, '.tmp', 'releve-colonnes.pdf');

(async () => {
  const lines = await extractLines(file);
  console.log('--- LIGNES (' + lines.length + ') ---');
  lines.forEach((l, i) => {
    console.log(i, JSON.stringify(l.text.slice(0, 130)));
    console.log('    items:', JSON.stringify(l.items.map((it) => [it.str, Math.round(it.transform[4]), Math.round(it.width || 0)])));
  });
  console.log('--- ENTRÉES ---');
  const out = entriesFromLines(lines, { debug: true });
  console.log(JSON.stringify(out.entries, null, 1));
  console.log('warnings:', out.warnings);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
