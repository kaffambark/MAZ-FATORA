'use strict';

/* Tests unitaires (node:test) : parité des dictionnaires FR/AR de l'interface,
   et cohérence avec les clés référencées dans les pages HTML. */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const I18N = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'i18n.js'));

function flatKeys(obj, prefix) {
  const out = new Set();
  for (const k of Object.keys(obj || {})) {
    const p = prefix ? prefix + '.' + k : k;
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
      for (const sub of flatKeys(obj[k], p)) out.add(sub);
    } else {
      out.add(p);
    }
  }
  return out;
}

test('i18n : FR et AR ont exactement les mêmes clés', () => {
  const fr = flatKeys(I18N.DICT.fr);
  const ar = flatKeys(I18N.DICT.ar);
  const onlyFr = [...fr].filter((k) => !ar.has(k));
  const onlyAr = [...ar].filter((k) => !fr.has(k));
  assert.deepStrictEqual(onlyFr, [], 'clés manquantes en arabe');
  assert.deepStrictEqual(onlyAr, [], 'clés présentes seulement en arabe');
  assert.ok(fr.size > 200, 'dictionnaire suffisamment fourni');
});

test('i18n : aucune valeur vide dans les deux langues', () => {
  let empty = [];
  for (const key of flatKeys(I18N.DICT.fr)) {
    if (!I18N.DICT.fr[key]) empty.push('fr/' + key);
  }
  for (const key of flatKeys(I18N.DICT.ar)) {
    if (!I18N.DICT.ar[key]) empty.push('ar/' + key);
  }
  assert.deepStrictEqual(empty, [], 'valeurs vides détectées');
});

test('i18n : les clés référencées dans les pages HTML existent en FR et AR', () => {
  const files = [
    path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'),
    path.join(__dirname, '..', '..', 'src', 'renderer', 'print-invoice.html'),
    path.join(__dirname, '..', '..', 'src', 'renderer', 'print-quote.html'),
    path.join(__dirname, '..', '..', 'src', 'renderer', 'print-credit.html'),
    path.join(__dirname, '..', '..', 'src', 'renderer', 'print-guide.html')
  ];
  const attrs = ['data-i18n', 'data-i18n-html', 'data-i18n-ph', 'data-i18n-title', 'data-i18n-aria'];
  const used = new Set();
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const attr of attrs) {
      const re = new RegExp(attr + '="([^"]+)"', 'g');
      let m;
      while ((m = re.exec(html))) used.add(m[1]);
    }
  }
  const missing = [];
  for (const key of used) {
    if (!I18N.DICT.fr[key]) missing.push('fr/' + key);
    if (!I18N.DICT.ar[key]) missing.push('ar/' + key);
  }
  assert.deepStrictEqual(missing, [], 'clés HTML absentes d’un dictionnaire');
  assert.ok(used.size > 100, 'un nombre significatif de clés vérifiées');
});

test('i18n : tr() ne renvoie pas le nom de la clé pour les clés connues', () => {
  I18N.setLang('fr');
  assert.strictEqual(I18N.tr('nav.dashboard'), 'Tableau de bord');
  assert.notStrictEqual(I18N.tr('nav.dashboard'), 'nav.dashboard');
  // Une clé inconnue reste inchangée (retour fallback).
  assert.strictEqual(I18N.tr('cle.inexistante'), 'cle.inexistante');
});