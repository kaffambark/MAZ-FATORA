'use strict';

/* Tests unitaires (node:test) : intégrité du contenu du Centre d'aide
   (help-content.js). Vérifie la structure, la parité FR/AR et la
   cohérence des renvois entre articles et vers les écrans. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const HELP = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'help-content.js'));

const CATEGORIES = HELP.categories.map((c) => c.id);
const STEPS_REQUIRED = ['start', 'screen', 'tasks'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function hasLangPair(obj) {
  return obj && isNonEmptyString(obj.fr) && isNonEmptyString(obj.ar);
}
function listPair(obj) {
  return obj && Array.isArray(obj.fr) && Array.isArray(obj.ar);
}

test('help : catégories bien formées et uniques', () => {
  assert.ok(HELP.categories.length >= 5, 'au moins 5 catégories');
  const seen = new Set();
  HELP.categories.forEach((c) => {
    assert.ok(isNonEmptyString(c.id), 'id de catégorie');
    assert.ok(!seen.has(c.id), 'catégorie dupliquée : ' + c.id);
    seen.add(c.id);
    assert.ok(hasLangPair(c.title), 'titre FR/AR de la catégorie ' + c.id);
    assert.ok(isNonEmptyString(c.icon), 'icône de la catégorie ' + c.id);
  });
});

test('help : chaque article a un titre et un objectif en FR et AR', () => {
  Object.keys(HELP.articles).forEach((id) => {
    const a = HELP.articles[id];
    assert.ok(hasLangPair(a.title), id + ' : titre FR/AR manquant');
    assert.ok(hasLangPair(a.goal), id + ' : objectif FR/AR manquant');
  });
});

test('help : catégorie et priorité valides pour chaque article', () => {
  Object.keys(HELP.articles).forEach((id) => {
    const a = HELP.articles[id];
    assert.ok(CATEGORIES.indexOf(a.category) !== -1, id + ' : catégorie inconnue ' + a.category);
    assert.ok(a.priority === 1 || a.priority === 2, id + ' : priorité attendue 1 ou 2');
  });
});

test('help : étapes FR/AR présentes pour les catégories guide', () => {
  Object.keys(HELP.articles).forEach((id) => {
    const a = HELP.articles[id];
    if (STEPS_REQUIRED.indexOf(a.category) === -1) return;
    assert.ok(listPair(a.steps), id + ' : étapes FR/AR requises');
    assert.ok(a.steps.fr.length > 0 && a.steps.ar.length > 0, id + ' : étapes vides');
  });
});

test('help : listes facultatives complètes en FR et AR quand présentes', () => {
  ['prereq', 'tips', 'errors'].forEach((field) => {
    Object.keys(HELP.articles).forEach((id) => {
      const a = HELP.articles[id];
      if (a[field] === undefined) return;
      assert.ok(listPair(a[field]), id + ' : ' + field + ' doit exister en FR et AR');
    });
  });
});

test('help : l’écran d’ancrage est valide', () => {
  Object.keys(HELP.articles).forEach((id) => {
    const a = HELP.articles[id];
    if (a.screen === undefined) return;
    assert.ok(HELP.SCREENS.indexOf(a.screen) !== -1, id + ' : écran inconnu ' + a.screen);
  });
});

test('help : chaque écran possède son article d’aide contextuelle', () => {
  HELP.SCREENS.forEach((s) => {
    assert.ok(HELP.articles['screen.' + s], 'article manquant : screen.' + s);
  });
});

test('help : les renvois « Voir aussi » pointent vers des articles existants', () => {
  Object.keys(HELP.articles).forEach((id) => {
    const a = HELP.articles[id];
    if (!a.related) return;
    assert.ok(Array.isArray(a.related), id + ' : related doit être un tableau');
    a.related.forEach((r) => {
      assert.ok(HELP.articles[r], id + ' : renvoi inconnu ' + r);
      assert.notStrictEqual(r, id, id + ' : renvoi vers lui-même');
    });
  });
});

test('help : titres uniques en français', () => {
  const seen = new Map();
  Object.keys(HELP.articles).forEach((id) => {
    const t = HELP.articles[id].title.fr;
    assert.ok(!seen.has(t), 'titre FR dupliqué : « ' + t + ' » (' + seen.get(t) + ' et ' + id + ')');
    seen.set(t, id);
  });
});
