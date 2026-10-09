'use strict';

/* Tests unitaires (node:test) : l'usine de mise à jour est sûre hors Electron —
   aucun réseau, aucun crash, un état « dev » explicite. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { createUpdater } = require(path.join(__dirname, '..', '..', 'src', 'main', 'updater.js'));

test('updater : hors Electron, la vérification est un no-op (état dev, pas de réseau)', async () => {
  const seen = [];
  const up = createUpdater({ onStatus: (s) => seen.push(s) });
  assert.ok(up, 'usine opérationnelle');
  assert.strictEqual(up.status().state, 'idle');

  const res = await up.check();
  assert.strictEqual(res, 'dev');
  assert.strictEqual(up.status().state, 'dev');
  /* l'état initial 'idle' (usine) puis 'dev' (vérification) sont publiés */
  assert.strictEqual(seen.length, 2);
  assert.strictEqual(seen[0].state, 'idle');
  assert.strictEqual(seen[1].state, 'dev');

  /* installer sans téléchargement ne doit pas lever */
  up.install();
  assert.strictEqual(up.status().state, 'dev');
});

test('updater : fonctionne sans callback ni journal (tolérant)', async () => {
  const up = createUpdater();
  const res = await up.check();
  assert.strictEqual(res, 'dev');
  up.install();
  assert.ok(up.status());
  assert.strictEqual(up.status().state, 'dev');
});