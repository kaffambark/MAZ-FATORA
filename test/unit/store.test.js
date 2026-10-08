'use strict';

/* Tests unitaires (node:test) : store (chargement, fusion de défauts, écriture
   atomique) et version de schéma + mécanisme de migrations (P0). */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const storeMod = require(path.join(__dirname, '..', '..', 'src', 'main', 'store.js'));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mzf-store-'));
}

test('store : valeurs par défaut fusionnées, écriture/relecture', () => {
  const store = storeMod.createStore(tmpDir());
  const first = store.loadAll();
  assert.strictEqual(first.settings.language, 'fr');
  assert.strictEqual(first.settings.currency, 'MAD');
  assert.deepStrictEqual(first.meta, { invoiceSeq: 0 });

  // Le renderer persiste l'objet settings COMPLET : on repart du chargement.
  const all = store.loadAll();
  store.save('settings', Object.assign({}, all.settings, { language: 'ar' }));
  const reloaded = store.loadAll();
  assert.strictEqual(reloaded.settings.language, 'ar');
  assert.strictEqual(reloaded.settings.currency, 'MAD');
});

test('store : collection inconnue refusée', () => {
  const store = storeMod.createStore(tmpDir());
  assert.throws(() => store.save('bogus', []), /inconnue/);
});

test('schéma : version initiale 0 → migration à SCHEMA_VERSION', () => {
  const dir = tmpDir();
  const store = storeMod.createStore(dir);
  assert.strictEqual(store.schemaVersion, 0);
  const v = store.migrate();
  assert.strictEqual(v, storeMod.SCHEMA_VERSION);
  assert.strictEqual(v >= 1, true);

  const written = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8'));
  assert.strictEqual(written.version, storeMod.SCHEMA_VERSION);

  // À la réouverture, la base est déjà à jour.
  const reopened = storeMod.createStore(dir);
  assert.strictEqual(reopened.schemaVersion, storeMod.SCHEMA_VERSION);
  const again = reopened.migrate();
  assert.strictEqual(again, storeMod.SCHEMA_VERSION);
});