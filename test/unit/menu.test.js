'use strict';

/* Tests unitaires (node:test) : menu applicatif natif bilingue (Axe B).
   Le gabarit est construit par une fonction PURE (buildMenuTemplate) :
   on vérifie les libellés FR/AR, les raccourcis, les rôles natifs et les
   actions envoyées au renderer — sans Electron. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const I18N = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'i18n.js'));
const { buildMenuTemplate } = require(path.join(__dirname, '..', '..', 'src', 'main', 'menu.js'));

test('menu : gabarit FR (macOS) — labels, rôles, raccourcis et actions', () => {
  I18N.setLang('fr');
  const actions = [];
  const template = buildMenuTemplate({
    tr: (k, v) => I18N.tr(k, v),
    isMac: true,
    appName: 'MAZ-FATORA',
    onAction: (name) => actions.push(name),
    onAbout: () => actions.push('about')
  });

  /* Premier menu = menu de l'application, avec Quitter (rôle natif, ⌘Q). */
  assert.strictEqual(template[0].label, 'MAZ-FATORA');
  assert.ok(template[0].submenu.some((i) => i.role === 'quit'));

  const sec = template.find((m) => m.label === 'Sécurité');
  const help = template.find((m) => m.label === 'Aide');

  /* Verrouiller (⌘L) → action « lock ». */
  const lock = sec.submenu.find((i) => i.accelerator === 'CmdOrCtrl+L');
  assert.strictEqual(lock.label, 'Verrouiller');
  lock.click();
  assert.deepStrictEqual(actions, ['lock']);

  /* Centre d'aide (F1) → action « help ». */
  help.submenu.find((i) => i.accelerator === 'F1').click();
  assert.deepStrictEqual(actions, ['lock', 'help']);

  /* Paramètres (⌘,) → action « settings » ; Guide… → « guide ». */
  sec.submenu.find((i) => i.accelerator === 'CmdOrCtrl+,').click();
  help.submenu.find((i) => i.label === 'Guide d’utilisation…').click();
  assert.deepStrictEqual(actions, ['lock', 'help', 'settings', 'guide']);

  /* À propos → onAbout. */
  template[0].submenu.find((i) => i.label === 'À propos de MAZ-FATORA').click();
  assert.deepStrictEqual(actions, ['lock', 'help', 'settings', 'guide', 'about']);

  /* Les menus natifs Édition / Affichage sont présents avec leurs rôles. */
  assert.ok(template.some((m) => m.label === 'Édition' && m.submenu.some((i) => i.role === 'copy')));
  assert.ok(template.some((m) => m.label === 'Affichage' && m.submenu.some((i) => i.role === 'zoomIn')));
});

test('menu : gabarit AR (macOS) — aucune clé non résolue, « Verrouiller » traduit', () => {
  I18N.setLang('ar');
  const template = buildMenuTemplate({
    tr: (k, v) => I18N.tr(k, v),
    isMac: true,
    appName: 'MAZ-FATORA'
  });
  const labels = [];
  const walk = (items) => items.forEach((i) => {
    if (i.label) labels.push(i.label);
    if (i.submenu) walk(i.submenu);
  });
  walk(template);
  assert.ok(labels.length > 8, 'un nombre significatif de libellés');
  assert.ok(labels.every((l) => !/^menu\./.test(l)), 'clé menu.* non résolue en arabe');
  assert.ok(labels.includes('قفل'), '« Verrouiller » traduit en arabe');
});

test('menu : gabarit Windows/Linux — Fichier/Quitter, À propos dans Aide', () => {
  I18N.setLang('fr');
  const template = buildMenuTemplate({
    tr: (k, v) => I18N.tr(k, v),
    isMac: false,
    appName: 'MAZ-FATORA'
  });
  assert.strictEqual(template[0].label, 'Fichier');
  assert.ok(template[0].submenu.some((i) => i.role === 'quit' && i.accelerator === 'CmdOrCtrl+Q'));
  const help = template.find((m) => m.label === 'Aide');
  assert.ok(help.submenu.some((i) => i.label === 'À propos de MAZ-FATORA'),
    'À propos vit dans Aide hors macOS');
  assert.ok(template.every((m) => m.role !== 'quit'),
    'aucun item Quitter à la racine sur Windows/Linux (il est dans Fichier)');
});