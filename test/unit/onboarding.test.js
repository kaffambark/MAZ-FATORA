'use strict';

/* Tests unitaires (node:test) : onboarding (onboarding.js).
   Vérifie la présence des libellés de la visite guidée et de la checklist
   « Mise en route » en FR et AR, ainsi que la cohérence du moteur. */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const I18N = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'i18n.js'));
const ONBOARD_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'onboarding.js'), 'utf8');

const STEP_KEYS = [];
for (let i = 1; i <= 5; i += 1) { STEP_KEYS.push('tour.title' + i, 'tour.text' + i); }

const KEYS = STEP_KEYS.concat([
  'tour.next', 'tour.prev', 'tour.skip', 'tour.done', 'tour.step',
  'setup.title', 'setup.hint', 'setup.progress', 'setup.done',
  'setup.company', 'setup.client', 'setup.invoice', 'setup.payment', 'setup.backup',
  'setup.goto', 'set.helpCard', 'set.helpTour'
]);

test('onboarding : libellés présents et non vides en FR et AR', () => {
  KEYS.forEach((k) => {
    assert.ok(I18N.DICT.fr[k] && String(I18N.DICT.fr[k]).trim(), 'clé FR manquante : ' + k);
    assert.ok(I18N.DICT.ar[k] && String(I18N.DICT.ar[k]).trim(), 'clé AR manquante : ' + k);
  });
});

test('onboarding : 5 étapes de visite guidée (titres + textes)', () => {
  const matches = ONBOARD_SRC.match(/'tour\.title[1-9]'/g) || [];
  assert.strictEqual(matches.length, 5, 'la visite guidée doit définir 5 étapes');
  assert.ok(/window\.ONBOARD\s*=/.test(ONBOARD_SRC), 'ONBOARD doit être exposé');
});

test('onboarding : expose les points d’entrée attendus', () => {
  ['maybeStart', 'start', 'renderChecklist', 'markBackup'].forEach((fn) => {
    assert.ok(new RegExp('\\b' + fn + '\\b').test(ONBOARD_SRC), 'fonction absente : ' + fn);
  });
});

test('onboarding : cible la checklist et la visite dans index.html', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');
  ['id="tour-root"', 'id="tour-tip"', 'id="tour-next"', 'id="setup-card"', 'id="setup-list"',
    'id="btn-tour-restart"'].forEach((needle) => {
    assert.ok(html.indexOf(needle) !== -1, 'index.html ne contient pas ' + needle);
  });
});
