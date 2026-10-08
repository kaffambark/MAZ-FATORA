'use strict';

/* Tests unitaires (node:test) : sauvegarde automatique quotidienne (P0) —
   un passage par jour, 2 copies glissantes, statut et restauration. */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAutoBackup, KEEP_COPIES, dateStamp } = require(path.join(__dirname, '..', '..', 'src', 'main', 'autobackup.js'));

function makeStore(dir) {
  return {
    dir,
    loadAll: () => ({ settings: { language: 'fr', currency: 'MAD' }, invoices: [], clients: [] })
  };
}

test('autobackup : premier passage → fichier écrit, second → aucun le même jour', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mzf-auto-'));
  const ab = createAutoBackup(makeStore(dir));

  assert.strictEqual(ab.status().available, false);

  const first = ab.maybe();
  assert.ok(first, 'une sauvegarde est écrite au premier passage');
  assert.ok(first.endsWith(`auto-${dateStamp(new Date())}.json`));

  assert.ok(!ab.maybe(), 'pas de deuxième écriture le même jour');

  const st = ab.status();
  assert.strictEqual(st.available, true);
  assert.strictEqual(st.last, dateStamp(new Date()));

  const r = ab.restore();
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.data.settings.language, 'fr');
});

test('autobackup : rotation — les copies anciennes sont supprimées', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mzf-auto2-'));
  const ab = createAutoBackup(makeStore(dir));
  // Simule 4 jours plus anciens, puis une écriture aujourd'hui : la rotation
  // doit ramener le total à KEEP_COPIES au plus.
  fs.mkdirSync(ab.dir, { recursive: true });
  for (const d of ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']) {
    fs.writeFileSync(path.join(ab.dir, `auto-${d}.json`), '{}');
  }
  ab.write();
  const st = ab.status();
  assert.ok(st.count <= KEEP_COPIES, `copies conservées : ${st.count} ≤ ${KEEP_COPIES}`);
});

test('autobackup : restauration d’une sauvegarde vide → erreur propre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mzf-auto3-'));
  const ab = createAutoBackup(makeStore(dir));
  const r = ab.restore();
  assert.strictEqual(r.error, 'none');
});