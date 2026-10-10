'use strict';

/* Tests unitaires (node:test) : logique de fin de session (Axe A + C + D).
   Helpers purs de src/main/lifecycle.js, branchés par main.js sur
   before-quit / window-all-closed. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createBusyTracker, decideQuit, formatDuration } = require(
  path.join(__dirname, '..', '..', 'src', 'main', 'lifecycle.js')
);

test('lifecycle : le compteur ne descend jamais sous zéro', () => {
  const b = createBusyTracker();
  assert.strictEqual(b.count(), 0);
  b.begin();
  b.begin();
  assert.strictEqual(b.count(), 2);
  b.end();
  assert.strictEqual(b.count(), 1);
  b.end();
  b.end(); /* surplus : ignoré */
  assert.strictEqual(b.count(), 0);
  b.begin();
  b.reset();
  assert.strictEqual(b.count(), 0);
});

test('lifecycle : decideQuit — confirmation seulement si opération en cours', () => {
  assert.deepStrictEqual(decideQuit({ busy: 0 }), { mustConfirm: false, proceed: true, lockSession: false });
  const pending = decideQuit({ busy: 1 });
  assert.strictEqual(pending.mustConfirm, true);
  assert.strictEqual(pending.proceed, false);
  const agreed = decideQuit({ busy: 1, confirmed: true });
  assert.strictEqual(agreed.mustConfirm, false);
  assert.strictEqual(agreed.proceed, true);
});

test('lifecycle : decideQuit — verrou à la fermeture (option + protection active)', () => {
  assert.strictEqual(decideQuit({ lockOnQuit: true, protectedApp: true }).lockSession, true);
  assert.strictEqual(decideQuit({ lockOnQuit: true, protectedApp: false }).lockSession, false);
  assert.strictEqual(decideQuit({ lockOnQuit: false, protectedApp: true }).lockSession, false);
  /* Opération en cours : pas de verrou tant que la confirmation n'est pas passée. */
  assert.strictEqual(decideQuit({ lockOnQuit: true, protectedApp: true, busy: 1 }).lockSession, false);
  assert.strictEqual(decideQuit({ lockOnQuit: true, protectedApp: true, busy: 1, confirmed: true }).lockSession, true);
});

test('lifecycle : formatDuration — durée de session lisible (journal)', () => {
  assert.strictEqual(formatDuration(45 * 1000), '45 s');
  assert.strictEqual(formatDuration(12 * 60 * 1000 + 30 * 1000), '12 min 30 s');
  assert.strictEqual(formatDuration(3600 * 1000 + 5 * 60 * 1000), '1 h 05 min');
  assert.strictEqual(formatDuration(0), '0 s');
  assert.strictEqual(formatDuration(-500), '0 s');
});