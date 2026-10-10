'use strict';

/* Tests unitaires (node:test) du moteur d'ancienneté PARTAGÉ (aging.js) :
   reste dû net des avoirs, tranches d'ancienneté déterministes (date de
   référence forcée) et export CSV. Ce module est utilisé à la fois par la vue
   in-app « Balance âgée » et par le paquet comptable : ces tests garantissent
   une seule règle de calcul. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const AGING = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'aging.js'));

const REF = '2026-10-10';

function inv(id, number, dueDate, amount, tva) {
  return {
    id, number, status: 'validated', clientId: 'c1', clientName: 'Dupont SARL',
    issueDate: '2026-09-01', dueDate, paid: false, payments: [],
    lines: [{ desc: 'x', qty: 1, price: amount, tva: tva }]
  };
}

test('aging : totaux TTC et encaissements', () => {
  const d = inv('i1', 'FA-1', '2026-10-20', 1000, 20);
  assert.strictEqual(AGING.docTotals(d).ttc, 1200);
  assert.strictEqual(AGING.paidTotal(d), 0);
  d.payments = [{ amount: 300 }, { amount: 200 }];
  assert.strictEqual(AGING.paidTotal(d), 500);
});

test('aging : ancienneté en jours (échéance passée) et tranche', () => {
  assert.strictEqual(AGING.ageDays('2026-09-10', '2026-09-01', REF), 30);
  assert.strictEqual(AGING.ageDays('2026-10-20', '2026-09-01', REF), 0);
  assert.strictEqual(AGING.bucketId('2026-09-10', 30, REF), '0-30');
  assert.strictEqual(AGING.bucketId('2026-08-01', 70, REF), '61-90');
  assert.strictEqual(AGING.bucketId('2026-06-01', 131, REF), '90+');
  /* Échéance du jour ou future : non échue. */
  assert.strictEqual(AGING.bucketId('2026-10-10', 0, REF), 'notdue');
  assert.strictEqual(AGING.bucketId('2026-11-01', 0, REF), 'notdue');
  assert.strictEqual(AGING.labelFr('90+'), '+90 j');
});

test('aging : les avoirs validés réduisent le reste dû', () => {
  const invoices = [inv('i1', 'FA-1', '2026-10-20', 1000, 20)];
  const credits = [
    { id: 'c1', status: 'validated', refInvoiceId: 'i1', lines: [{ qty: 1, price: 100, tva: 20 }] },
    { id: 'c2', status: 'draft', refInvoiceId: 'i1', lines: [{ qty: 1, price: 999, tva: 20 }] }
  ];
  const built = AGING.rows(invoices, { credits: credits, ref: REF });
  assert.strictEqual(built.rows.length, 1);
  assert.strictEqual(built.rows[0].credited, 120); // seul l'avoir validé compte
  assert.strictEqual(built.rows[0].rest, 1080);
  assert.strictEqual(built.totals.rest, 1080);
});

test('aging : factures soldées ou hors statut exclues, tranches agrégées', () => {
  const invoices = [
    inv('i1', 'FA-1', '2026-10-20', 1000, 20),   // non échue 1200
    inv('i2', 'FA-2', '2026-09-20', 500, 20),    // 0-30 j : 600
    inv('i3', 'FA-3', '2026-06-01', 1000, 0),    // +90 j : 1000
    { id: 'i4', number: 'FA-4', status: 'draft', dueDate: '2026-01-01', lines: [{ qty: 1, price: 999, tva: 0 }] }
  ];
  invoices[1].payments = [{ amount: 600 }]; // soldée → exclue
  const built = AGING.rows(invoices, { ref: REF });
  assert.strictEqual(built.n, 2);
  assert.strictEqual(built.buckets['notdue'], 1200);
  assert.strictEqual(built.buckets['90+'], 1000);
  assert.strictEqual(built.totals.rest, 2200);
});

test('aging : export CSV (séparateur « ; », BOM, montants à point)', () => {
  const built = AGING.rows([inv('i1', 'FA-1', '2026-09-20', 1000, 20)], { ref: REF });
  const csv = AGING.csv(built);
  assert.ok(csv.charCodeAt(0) === 0xFEFF, 'BOM UTF-8');
  assert.ok(csv.includes('Client;N° facture'));
  assert.ok(csv.includes('FA-1'));
  assert.ok(csv.includes('1200.00'), 'reste dû en écriture point');
  assert.ok(csv.includes('0-30 j'));
});
