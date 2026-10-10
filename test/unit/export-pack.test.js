'use strict';

/* Tests unitaires (node:test, sans Electron) sur le paquet comptable :
   CSV + ODS + manifeste + empreinte, et la stabilité de l'empreinte. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const pack = require(path.join(__dirname, '..', '..', 'src', 'main', 'export-pack.js'));

function fixture() {
  return {
    settings: {
      language: 'fr',
      currency: 'MAD',
      tvaRegime: 'reel',
      tvaRate: 20,
      company: {
        name: 'Société Test',
        nameAr: 'شركة تجريبية',
        ice: '002548793000054',
        idFiscal: '45879300',
        rc: '123456',
        city: 'Casablanca'
      }
    },
    clients: [],
    invoices: [
      {
        id: 'f1', number: 'FA-0001', issueDate: '2026-09-15', dueDate: '2026-10-15',
        clientId: 'c1', clientName: 'Dupont SARL', status: 'validated', paid: true,
        lines: [{ desc: 'Conseil', qty: 2, price: 500, tva: 20 }],
        payments: [{ id: 'p1', date: '2026-09-20', amount: 1200 }]
      },
      {
        id: 'f2', number: 'FA-0002', issueDate: '2026-09-28', dueDate: '2026-10-28',
        clientId: 'c1', clientName: 'Dupont SARL', status: 'validated', paid: false,
        lines: [{ desc: 'Prestation', qty: 1, price: 1000, tva: 14 }],
        payments: []
      }
    ],
    transactions: [
      { id: 't1', date: '2026-09-20', label: 'VIREMENT DUPONT', amount: 1200, status: 'matched', linkedInvoiceId: 'f1' }
    ],
    suppliers: [{ id: 's1', name: 'Fournitures Maroc' }],
    expenses: [
      { id: 'e1', supplierId: 's1', supplier: 'Fournitures Maroc', label: 'Achat papier', category: 'Fournitures', date: '2026-09-08', amountTTC: 1200, tvaRate: 20, payments: [{ id: 'sp1', date: '2026-09-09', amount: 400 }] },
      { id: 'e2', supplier: 'Bailleur', label: 'Loyer', category: 'Loyer', date: '2026-09-01', amountTTC: 1000, tvaRate: 0, payments: [] }
    ],
    rules: [],
    meta: { invoiceSeq: 2 }
  };
}

const PERIOD = { from: '2026-09-01', to: '2026-09-30', appVersion: '1.14.0' };

test('paquet : 15 fichiers au périmètre, dont les 6 ODS', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  assert.strictEqual(p.files.length, 15);
  const names = p.files.map((f) => f.name);
  assert.ok(names.some((n) => n.endsWith('journal.ods')));
  assert.ok(names.some((n) => n.endsWith('tva.ods')));
  assert.ok(names.some((n) => n.endsWith('encaissements.ods')));
  assert.ok(names.some((n) => n.endsWith('balance-agee.ods')));
  assert.ok(names.some((n) => n.endsWith('achats.ods')));
  assert.ok(names.some((n) => n.endsWith('balance-agee-fournisseurs.ods')));
  assert.ok(names.some((n) => n.endsWith('infos.json')));
  assert.ok(names.some((n) => n.endsWith('empreinte.txt')));
});

test('achats : journal des achats (HT / TVA déductible / TTC, payé, reste)', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  const csv = p.files.find((f) => f.name.endsWith('achats.csv')).buf.toString('utf8');
  assert.ok(csv.includes('Fournisseur'));
  assert.ok(csv.includes('TVA déductible'));
  // e1 : 1200 TTC à 20 % → 1000 HT + 200 TVA ; 400 payé, reste 800.
  assert.ok(/Fournitures Maroc;Achat papier;Fournitures;1000\.00;200\.00;1200\.00;400\.00;800\.00;Partiel/.test(csv), csv);
});

test('balance âgée fournisseurs : reste à payer par fournisseur (reste net des règlements)', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  const csv = p.files.find((f) => f.name.endsWith('balance-agee-fournisseurs.csv')).buf.toString('utf8');
  assert.ok(csv.includes('Fournisseur'));
  assert.ok(/Fournitures Maroc;Achat papier;2026-09-08;1200\.00;400\.00;800\.00;\d+;/.test(csv), csv);
  assert.ok(/Bailleur;Loyer;2026-09-01;1000\.00;0\.00;1000\.00;\d+;/.test(csv), csv);
});

test('manifeste : compteurs achats et règlements fournisseurs', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  assert.strictEqual(p.manifest.counts.expenses, 2);
  assert.strictEqual(p.manifest.counts.supplierPayments, 1);
});

test('manifeste : empreinte = recalcul sur les fichiers de données', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  const dataFiles = p.files.filter((f) => !/infos\.json$/.test(f.name) && !/empreinte\.txt$/.test(f.name));
  const recomputed = pack.fullHash(dataFiles);
  assert.strictEqual(p.manifest.fullHash, recomputed);
  // Le fichier « empreinte » porte bien la même valeur.
  const fiche = p.files.find((f) => f.name.endsWith('empreinte.txt')).buf.toString('utf8');
  assert.ok(fiche.includes(p.manifest.fullHash));
});

test('déterminisme : deux exports identiques → même empreinte d’ensemble', () => {
  const a = pack.buildPack(fixture(), PERIOD);
  const b = pack.buildPack(fixture(), PERIOD);
  assert.strictEqual(a.manifest.fullHash, b.manifest.fullHash);
  assert.deepStrictEqual(
    a.files.map((f) => f.name),
    b.files.map((f) => f.name)
  );
});

test('ODS : mimetype en première entrée, content.xml bien formé', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  const zip = pack.zipBuffer(p.files);
  const odsName = p.files.find((f) => f.name.endsWith('journal.ods')).name;
  const odsBuf = pack.zipExtract(zip, odsName);
  assert.ok(odsBuf, 'entrée .ods extraite');
  const entries = pack.zipEntries(odsBuf);
  assert.strictEqual(entries[0].name, 'mimetype');
  const mt = pack.zipExtract(odsBuf, 'mimetype').toString('utf8');
  assert.strictEqual(mt, 'application/vnd.oasis.opendocument.spreadsheet');
  const content = pack.zipExtract(odsBuf, 'content.xml').toString('utf8');
  assert.ok(content.includes('Journal de ventes'));
  assert.ok(content.includes('office:value=')); // montants typés numériques
});

test('ODS : en-têtes bilingues FR (ligne 1) puis AR (ligne 2)', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  const zip = pack.zipBuffer(p.files);
  const odsName = p.files.find((f) => f.name.endsWith('journal.ods')).name;
  const content = pack.zipExtract(pack.zipExtract(zip, odsName), 'content.xml').toString('utf8');
  // Ligne 1 FR : « Date » et « Montant TTC » ; ligne 2 AR : « التاريخ » et « المجموع شامل الضريبة ».
  const frIdx = content.indexOf('Date');
  const arIdx = content.indexOf('التاريخ');
  assert.ok(frIdx >= 0 && arIdx >= 0, 'en-têtes FR et AR présents');
  assert.ok(arIdx > frIdx, 'ligne arabe après la ligne française');
});

test('CSV : journal de ventes avec en-tête FR explicite', () => {
  const p = pack.buildPack(fixture(), PERIOD);
  const csv = p.files.find((f) => f.name.endsWith('journal.csv')).buf.toString('utf8');
  assert.ok(csv.includes('Date'));
  assert.ok(csv.includes('Total TTC'));
  assert.ok(csv.includes('Dupont SARL'));
});

test('invoiceTotals : HT/TVA/TTC attendus', () => {
  const inv = fixture().invoices[0];
  const t = pack.invoiceTotals(inv);
  assert.strictEqual(t.ttc, 1200);
  assert.strictEqual(t.tva, 200); // 1000 HT × 20 %
  assert.strictEqual(t.ht, 1000);
});