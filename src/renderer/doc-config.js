'use strict';

/* ===================================================================
   MAZ-FATORA — configuration des documents (factures / devis)

   Module PARTAGÉ entre l'application (Paramètres) et les fenêtres
   d'impression (print-invoice.html / print-quote.html). Il définit :
     - le schéma `settings.doc` (valeurs par défaut) ;
     - la normalisation/validation (valeurs inconnues → défauts) ;
     - les modèles (templates), les palettes et les formats.

   Aucune dépendance au DOM : utilisable côté navigateur (window.DOC)
   et côté Node (module.exports) pour les tests unitaires.
   =================================================================== */

(function (root) {
  /* Modèles de disposition disponibles. `classic` reproduit le rendu
     historique — c'est le défaut, donc aucune régression à l'installation. */
  const TEMPLATES = ['classic', 'modern', 'minimal', 'elegant', 'compact'];

  /* Palettes : seule la couleur d'accent est stockée ; les teintes dérivées
     (bordures, fonds légers) sont calculées en CSS via color-mix().
     `auto` reproduit le look historique : bleu pour la facture, sarcelle
     (cyan) pour le devis. */
  const PALETTES = {
    blue: '#2563eb',
    green: '#16a34a',
    slate: '#475569',
    burgundy: '#9f1239',
    teal: '#0d9488',
    amber: '#d97706',
    mono: '#111827'
  };
  const AUTO_INVOICE = '#2563eb';
  const AUTO_QUOTE = '#0891b2';

  const ACCENTS = ['auto', 'custom'].concat(Object.keys(PALETTES));
  const PAPERS = ['A4', 'A5'];
  const MARGINS = ['narrow', 'normal', 'wide'];
  const DENSITIES = ['compact', 'normal', 'airy'];
  const FONTS = ['sans', 'serif'];
  const WATERMARKS = ['none', 'paid', 'draft', 'quote'];
  const BILINGUAL = ['both', 'fr', 'ar'];
  const WORDS_MODES = ['none', 'fr', 'ar', 'both'];
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const DEFAULT = {
    template: 'classic',
    accent: 'auto',
    accentColor: '#2563eb',
    paper: 'A4',
    margins: 'normal',
    density: 'normal',
    font: 'sans',
    watermark: 'none',
    bilingual: 'both',
    /* Blocs affichables dans le document */
    blocks: {
      logo: true,
      nameAr: true,
      companyIds: true,
      clientIds: true,
      tvaDetail: true,
      regime: true,
      rib: true,
      notes: true,
      words: 'both',
      legal: true,
      signature: false,
      dueDate: true,
      validity: true,
      colsQty: true,
      colsPu: true,
      colsTva: true,
      colsTotal: true
    },
    /* Textes libres (remplacent/ajoutent aux mentions par défaut) */
    texts: { header: '', terms: '', footer: '' },
    /* Modèles distincts par type de document ('' = utiliser `template`) */
    invoiceTemplate: '',
    quoteTemplate: ''
  };

  function pick(v, list, def) {
    return (typeof v === 'string' && list.indexOf(v) !== -1) ? v : def;
  }

  /* Normalise un objet `settings.doc` quelconque vers le schéma courant.
     Tolérant aux valeurs manquantes, inconnues ou mal typées. */
  function normalize(settings) {
    const d = (settings && typeof settings === 'object' && settings.doc && typeof settings.doc === 'object')
      ? settings.doc : {};
    const out = {
      template: pick(d.template, TEMPLATES, DEFAULT.template),
      accent: pick(d.accent, ACCENTS, DEFAULT.accent),
      accentColor: HEX.test(d.accentColor) ? d.accentColor.toLowerCase() : DEFAULT.accentColor,
      paper: pick(d.paper, PAPERS, DEFAULT.paper),
      margins: pick(d.margins, MARGINS, DEFAULT.margins),
      density: pick(d.density, DENSITIES, DEFAULT.density),
      font: pick(d.font, FONTS, DEFAULT.font),
      watermark: pick(d.watermark, WATERMARKS, DEFAULT.watermark),
      bilingual: pick(d.bilingual, BILINGUAL, DEFAULT.bilingual),
      blocks: {},
      texts: {},
      invoiceTemplate: pick(d.invoiceTemplate, TEMPLATES, ''),
      quoteTemplate: pick(d.quoteTemplate, TEMPLATES, '')
    };
    const b = (d.blocks && typeof d.blocks === 'object') ? d.blocks : {};
    for (const k of Object.keys(DEFAULT.blocks)) {
      if (k === 'words') out.blocks.words = pick(b.words, WORDS_MODES, DEFAULT.blocks.words);
      else out.blocks[k] = (k in b) ? !!b[k] : DEFAULT.blocks[k];
    }
    const t = (d.texts && typeof d.texts === 'object') ? d.texts : {};
    out.texts.header = typeof t.header === 'string' ? t.header.slice(0, 500) : '';
    out.texts.terms = typeof t.terms === 'string' ? t.terms.slice(0, 1000) : '';
    out.texts.footer = typeof t.footer === 'string' ? t.footer.slice(0, 500) : '';
    return out;
  }

  /* Couleur d'accent effective. `auto` = couleur historique selon le type :
     bleu pour la facture, sarcelle (cyan) pour le devis. */
  function accentHex(doc, kind) {
    if (doc.accent === 'custom') return doc.accentColor;
    if (doc.accent === 'auto') return kind === 'quote' ? AUTO_QUOTE : AUTO_INVOICE;
    return PALETTES[doc.accent] || AUTO_INVOICE;
  }

  /* Modèle effectif pour un type de document donné ('invoice' | 'quote'). */
  function templateFor(doc, kind) {
    const override = kind === 'quote' ? doc.quoteTemplate : doc.invoiceTemplate;
    return override || doc.template || DEFAULT.template;
  }

  const DOC = {
    TEMPLATES, PALETTES, ACCENTS, PAPERS, MARGINS, DENSITIES, FONTS, WATERMARKS, BILINGUAL, WORDS_MODES,
    AUTO_INVOICE, AUTO_QUOTE,
    DEFAULT, normalize, accentHex, templateFor,
    paletteKeys: Object.keys(PALETTES)
  };

  root.DOC = DOC;
  if (typeof module !== 'undefined' && module.exports) module.exports = DOC;
})(typeof window !== 'undefined' ? window : globalThis);
