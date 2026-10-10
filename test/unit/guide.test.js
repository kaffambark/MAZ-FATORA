'use strict';

/* Tests unitaires (node:test) : rendu du guide d'utilisation imprimable
   (print-guide.js). Le rendu est une fonction pure : on vérifie la
   couverture, le sommaire, tous les articles, l'aide-mémoire et la parité
   FR/AR, sans navigateur. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = (f) => path.join(__dirname, '..', '..', 'src', 'renderer', f);
const HELP = require(R('help-content.js'));
const I18N = require(R('i18n.js'));
const GUIDE = require(R('print-guide.js'));

const ARTICLE_IDS = Object.keys(HELP.articles);
const CATEGORIES = HELP.categories.map((c) => c.id);

function trIn(lang) {
  return (k, vars) => {
    let s = I18N.DICT[lang][k];
    if (s == null) s = k;
    if (vars) for (const [key, val] of Object.entries(vars)) s = s.replace('{' + key + '}', val);
    return s;
  };
}

test('guide : la couverture, le sommaire et l’aide-mémoire sont présents (FR)', () => {
  const html = GUIDE.renderGuide(HELP, 'fr', trIn('fr'), { version: 'v1.21', date: '10/10/2026' });
  assert.ok(html.includes('Guide d’utilisation'), 'titre de couverture FR');
  assert.ok(html.includes('MAZ-FATORA'), 'marque sur la couverture');
  assert.ok(html.includes('v1.21'), 'version affichée');
  assert.ok(html.includes('Sommaire'), 'sommaire');
  assert.ok(html.includes('Aide-mémoire'), 'aide-mémoire');
  assert.ok(! html.includes('undefined'), 'aucun libellé non traduit');
});

test('guide : tous les articles et catégories sont rendus', () => {
  const html = GUIDE.renderGuide(HELP, 'fr', trIn('fr'), {});
  const arts = html.match(/<article class="g-art"/g) || [];
  assert.strictEqual(arts.length, ARTICLE_IDS.length, 'un article par entrée de help-content');
  ARTICLE_IDS.forEach((id) => {
    assert.ok(html.includes('id="art-' + id + '"'), 'article manquant : ' + id);
  });
  CATEGORIES.forEach((cat) => {
    const t = (HELP.categories.find((c) => c.id === cat).title.fr);
    assert.ok(html.includes(t), 'catégorie manquante : ' + cat);
  });
});

test('guide : les articles à étapes affichent la section « Étapes »', () => {
  const html = GUIDE.renderGuide(HELP, 'fr', trIn('fr'), {});
  assert.ok(html.includes('Étapes'), 'libellé « Étapes » présent');
  assert.ok((html.match(/<ol>/g) || []).length >= 10, 'plusieurs listes ordonnées (étapes)');
});

test('guide : l’aide-mémoire liste tous les écrans', () => {
  const html = GUIDE.renderGuide(HELP, 'fr', trIn('fr'), {});
  const rows = html.match(/<tr><td>/g) || [];
  assert.strictEqual(rows.length, HELP.SCREENS.length, 'une ligne par écran');
});

test('guide : rendu arabe (titre, catégories, textes)', () => {
  const html = GUIDE.renderGuide(HELP, 'ar', trIn('ar'), { version: 'v1.21' });
  assert.ok(html.includes('دليل الاستعمال'), 'titre AR');
  assert.ok(html.includes('الفهرس'), 'sommaire AR');
  assert.ok(html.includes('مذكّرة سريعة'), 'aide-mémoire AR');
  assert.ok(! html.includes('undefined'), 'aucun libellé non traduit en AR');
});

test('guide : clés i18n présentes en FR et AR', () => {
  const keys = [
    'guide.title', 'guide.subtitle', 'guide.toc', 'guide.memo', 'guide.version',
    'guide.generated', 'guide.screen', 'guide.purpose', 'guide.shortcuts',
    'guide.shortcutHelp', 'guide.shortcutClose',
    'set.helpHint', 'set.helpOpen', 'set.helpPdf',
    'main.winGuide', 'main.saveGuidePdf'
  ];
  keys.forEach((k) => {
    assert.ok(I18N.DICT.fr[k] && String(I18N.DICT.fr[k]).trim(), 'clé FR manquante : ' + k);
    assert.ok(I18N.DICT.ar[k] && String(I18N.DICT.ar[k]).trim(), 'clé AR manquante : ' + k);
  });
});

