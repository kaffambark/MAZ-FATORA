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
  assert.deepStrictEqual(first.meta, { invoiceSeq: 0, quoteSeq: 0, creditSeq: 0 });
  assert.ok(Array.isArray(first.creditNotes));
  assert.strictEqual(first.creditNotes.length, 0);

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

test('schéma v1 → vN : migrations en chaîne (devis, avoirs puis dépenses)', () => {
  const dir = tmpDir();
  /* Base v1 (v1.13/v1.14) : pas de quotes, meta sans quoteSeq */
  const v1 = { version: 1 };
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(v1), 'utf8');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ invoiceSeq: 7 }), 'utf8');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ invoicePrefix: 'FA' }), 'utf8');
  fs.writeFileSync(path.join(dir, 'invoices.json'), JSON.stringify([{ id: 'a', number: 'FA-2026-0001' }]), 'utf8');

  const store = storeMod.createStore(dir);
  const v = store.migrate();
  assert.strictEqual(v, storeMod.SCHEMA_VERSION);
  assert.strictEqual(storeMod.SCHEMA_VERSION, 5, 'schéma courant = v5');

  /* Les collections quotes, creditNotes ET expenses existent (matérialisées), meta complet */
  const all = store.loadAll();
  assert.ok(Array.isArray(all.quotes));
  assert.strictEqual(all.quotes.length, 0);
  assert.ok(Array.isArray(all.creditNotes));
  assert.strictEqual(all.creditNotes.length, 0);
  assert.ok(Array.isArray(all.expenses));
  assert.strictEqual(all.expenses.length, 0);
  assert.ok(Array.isArray(all.settings.expenseCategories) && all.settings.expenseCategories.length > 0);
  assert.strictEqual(all.meta.invoiceSeq, 7);
  assert.strictEqual(all.meta.quoteSeq, 0);
  assert.strictEqual(all.meta.creditSeq, 0);
  assert.ok(fs.existsSync(path.join(dir, 'quotes.json')), 'quotes.json matérialisé');
  assert.ok(fs.existsSync(path.join(dir, 'creditNotes.json')), 'creditNotes.json matérialisé');

  /* Une base déjà à jour ne réexécute pas les migrations */
  const reopened = storeMod.createStore(dir);
  assert.strictEqual(reopened.migrate(), storeMod.SCHEMA_VERSION);
  const content = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.deepStrictEqual(content, { invoiceSeq: 7, quoteSeq: 0, creditSeq: 0 });
});

test('schéma v2 → v3 : migration avoirs (collection creditNotes + creditSeq)', () => {
  const dir = tmpDir();
  const v2 = { version: 2 };
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(v2), 'utf8');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ invoiceSeq: 3, quoteSeq: 2 }), 'utf8');

  const store = storeMod.createStore(dir);
  assert.strictEqual(store.migrate(), storeMod.SCHEMA_VERSION);
  const all = store.loadAll();
  assert.ok(Array.isArray(all.creditNotes));
  assert.strictEqual(all.creditNotes.length, 0);
  assert.strictEqual(all.meta.creditSeq, 0);
  assert.strictEqual(all.meta.invoiceSeq, 3);
  assert.strictEqual(all.meta.quoteSeq, 2);
  assert.ok(fs.existsSync(path.join(dir, 'creditNotes.json')), 'creditNotes.json matérialisé');
  assert.ok(fs.existsSync(path.join(dir, 'expenses.json')), 'expenses.json matérialisé');
});

test('schéma v3 → v4 : migration « achats & dépenses » (collection expenses)', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify({ version: 3 }), 'utf8');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ invoicePrefix: 'FA', expenseCategories: undefined }), 'utf8');
  fs.writeFileSync(path.join(dir, 'creditNotes.json'), JSON.stringify([{ id: 'av1', number: 'AV-2026-0001' }]), 'utf8');

  const store = storeMod.createStore(dir);
  assert.strictEqual(store.migrate(), storeMod.SCHEMA_VERSION);
  const all = store.loadAll();
  assert.ok(Array.isArray(all.expenses));
  assert.strictEqual(all.expenses.length, 0);
  /* Les catégories par défaut complètent les paramètres existants. */
  assert.ok(Array.isArray(all.settings.expenseCategories));
  assert.ok(all.settings.expenseCategories.indexOf('Fournitures') !== -1);
  /* Les collections antérieures sont préservées. */
  assert.strictEqual(all.creditNotes[0].number, 'AV-2026-0001');
  assert.ok(fs.existsSync(path.join(dir, 'expenses.json')), 'expenses.json matérialisé');
});

test('schéma v4 → v5 : migration fournisseurs (collection suppliers + règlements dépenses)', () => {
  const dir = tmpDir();
  const v4 = { version: 4 };
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(v4), 'utf8');
  /* Dépenses préexistantes de la v1.26 : ni payments ni supplierId. */
  fs.writeFileSync(path.join(dir, 'expenses.json'), JSON.stringify([
    { id: 'e1', label: 'Loyer', amountTTC: 1000, tvaRate: 0 },
    { id: 'e2', label: 'Fournitures', amountTTC: 120, tvaRate: 20 }
  ]), 'utf8');

  const store = storeMod.createStore(dir);
  assert.strictEqual(store.migrate(), 5);
  const all = store.loadAll();

  /* Nouvelle collection fournisseurs, matérialisée (vide). */
  assert.ok(Array.isArray(all.suppliers));
  assert.strictEqual(all.suppliers.length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'suppliers.json')), 'suppliers.json matérialisé');

  /* Chaque dépense est normalisée : règlements (tableau) + référence fournisseur. */
  assert.strictEqual(all.expenses.length, 2);
  for (const e of all.expenses) {
    assert.ok(Array.isArray(e.payments));
    assert.strictEqual(e.payments.length, 0);
    assert.strictEqual(e.supplierId, null);
  }
  assert.strictEqual(all.expenses[0].label, 'Loyer');

  /* Les migrations ne se rejouent pas. */
  const reopened = storeMod.createStore(dir);
  assert.strictEqual(reopened.migrate(), 5);
});