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
  assert.deepStrictEqual(first.meta, { invoiceSeq: 0, quoteSeq: 0 });

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

test('schéma v1 → v2 : migration devis (collection quotes + quoteSeq)', () => {
  const dir = tmpDir();
  /* Base v1 (v1.13/v1.14) : pas de quotes, meta sans quoteSeq */
  const v1 = { version: 1 };
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(v1), 'utf8');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ invoiceSeq: 7 }), 'utf8');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ invoicePrefix: 'FA' }), 'utf8');
  fs.writeFileSync(path.join(dir, 'invoices.json'), JSON.stringify([{ id: 'a', number: 'FA-2026-0001' }]), 'utf8');

  const store = storeMod.createStore(dir);
  const v = store.migrate();
  assert.strictEqual(v, 2);
  assert.strictEqual(storeMod.SCHEMA_VERSION, 2, 'schéma courant = v2');

  /* La collection quotes existe (matérialisée) et meta porte quoteSeq */
  const all = store.loadAll();
  assert.ok(Array.isArray(all.quotes));
  assert.strictEqual(all.quotes.length, 0);
  assert.strictEqual(all.meta.invoiceSeq, 7);
  assert.strictEqual(all.meta.quoteSeq, 0);
  assert.ok(fs.existsSync(path.join(dir, 'quotes.json')), 'quotes.json matérialisé');

  /* Une base déjà en v2 ne réexécute pas la migration */
  const reopened = storeMod.createStore(dir);
  assert.strictEqual(reopened.migrate(), 2);
  const content = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.deepStrictEqual(content, { invoiceSeq: 7, quoteSeq: 0 });
});