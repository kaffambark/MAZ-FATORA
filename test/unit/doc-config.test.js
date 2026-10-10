'use strict';

/* Tests unitaires (node:test) : configuration des documents (modèles,
   palettes, normalisation) — src/renderer/doc-config.js. */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DOC = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'doc-config.js'));

test('doc : normalisation — valeurs par défaut quand rien n’est fourni', () => {
  const d = DOC.normalize(undefined);
  assert.strictEqual(d.template, 'classic');
  assert.strictEqual(d.accent, 'auto');
  assert.strictEqual(d.paper, 'A4');
  assert.strictEqual(d.margins, 'normal');
  assert.strictEqual(d.density, 'normal');
  assert.strictEqual(d.font, 'sans');
  assert.strictEqual(d.watermark, 'none');
  assert.strictEqual(d.bilingual, 'both');
  assert.strictEqual(d.blocks.logo, true);
  assert.strictEqual(d.blocks.signature, false);
  assert.strictEqual(d.blocks.words, 'both');
  assert.strictEqual(d.texts.header, '');
});

test('doc : normalisation — valeurs inconnues → défauts', () => {
  const d = DOC.normalize({ doc: {
    template: 'zzz', accent: 'rose', paper: 'A3', margins: 'xx',
    density: 'yy', font: 'comic', watermark: 'zz', bilingual: 'en',
    blocks: { logo: 0, signature: 1, words: 'latin' }
  } });
  assert.strictEqual(d.template, 'classic');
  assert.strictEqual(d.accent, 'auto');
  assert.strictEqual(d.paper, 'A4');
  assert.strictEqual(d.margins, 'normal');
  assert.strictEqual(d.density, 'normal');
  assert.strictEqual(d.font, 'sans');
  assert.strictEqual(d.watermark, 'none');
  assert.strictEqual(d.bilingual, 'both');
  assert.strictEqual(d.blocks.logo, false);
  assert.strictEqual(d.blocks.signature, true);
  assert.strictEqual(d.blocks.words, 'both');
});

test('doc : couleur d’accent — auto (bleu facture / sarcelle devis) et personnalisée', () => {
  const auto = DOC.normalize({});
  assert.strictEqual(DOC.accentHex(auto, 'invoice'), DOC.AUTO_INVOICE);
  assert.strictEqual(DOC.accentHex(auto, 'quote'), DOC.AUTO_QUOTE);
  const custom = DOC.normalize({ doc: { accent: 'custom', accentColor: '#abcdef' } });
  assert.strictEqual(DOC.accentHex(custom, 'invoice'), '#abcdef');
  const named = DOC.normalize({ doc: { accent: 'green' } });
  assert.strictEqual(DOC.accentHex(named, 'invoice'), DOC.PALETTES.green);
});

test('doc : modèle effectif par type de document (surcharge)', () => {
  const d = DOC.normalize({ doc: { template: 'classic', quoteTemplate: 'modern' } });
  assert.strictEqual(DOC.templateFor(d, 'invoice'), 'classic');
  assert.strictEqual(DOC.templateFor(d, 'quote'), 'modern');
});

test('doc : identifiants légaux — sélection individuelle + rétro-compatibilité', () => {
  const d = DOC.normalize({ doc: { blocks: { ids: { ice: true, if: false, rc: false, patente: false, cnss: false, tva: false } } } });
  assert.strictEqual(d.blocks.ids.ice, true);
  assert.strictEqual(d.blocks.ids['if'], false);
  assert.strictEqual(d.blocks.ids.tva, false);
  /* Ancien réglage global `companyIds` : conservé comme valeur de repli. */
  const off = DOC.normalize({ doc: { blocks: { companyIds: false } } });
  assert.strictEqual(off.blocks.ids.ice, false);
  assert.strictEqual(off.blocks.ids.tva, false);
  const on = DOC.normalize({ doc: { blocks: { companyIds: true } } });
  assert.strictEqual(on.blocks.ids.ice, true);
  assert.strictEqual(on.blocks.ids.cnss, true);
});

test('doc : couleur personnalisée invalide → défaut', () => {
  const d = DOC.normalize({ doc: { accent: 'custom', accentColor: 'bleu' } });
  assert.strictEqual(d.accentColor, DOC.DEFAULT.accentColor);
});
