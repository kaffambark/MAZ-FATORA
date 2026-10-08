'use strict';

/* Tests unitaires (node:test) : montants en toutes lettres (FR/AR). */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WORDS = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'words.js'));

test('words : français — montants simples', () => {
  assert.strictEqual(WORDS.fr(1), 'un dirham');
  assert.strictEqual(WORDS.fr(2), 'deux dirhams');
  assert.strictEqual(WORDS.fr(1200), 'mille deux cents dirhams');
  assert.strictEqual(WORDS.fr(1200.5), 'mille deux cents dirhams et cinquante centimes');
});

test('words : français — cas particuliers (quatre-vingts, soixante-dix)', () => {
  assert.strictEqual(WORDS.fr(80), 'quatre-vingts dirhams');
  assert.strictEqual(WORDS.fr(71), 'soixante-et-onze dirhams');
  assert.strictEqual(WORDS.fr(0.5), 'zéro dirham et cinquante centimes');
});

test('words : arabe — contenu attendu', () => {
  const s1200 = WORDS.ar(1200.5);
  assert.ok(s1200.includes('ألف'));
  assert.ok(s1200.includes('درهماً'));
  assert.ok(s1200.includes('سنتيماً'));
  const s2 = WORDS.ar(2);
  assert.strictEqual(s2, 'درهمان');
});

test('words : valeurs dégénérées → zéro', () => {
  assert.strictEqual(WORDS.fr(0), 'zéro dirham');
  assert.strictEqual(WORDS.ar(0), 'صفر درهم');
});