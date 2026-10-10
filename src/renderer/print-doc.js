'use strict';

/* ===================================================================
   MAZ-FATORA — rendu des documents (facture OU devis)

   Un seul moteur, piloté par :
     - window.DOC_KIND : 'invoice' (print-invoice.js) ou 'quote'
       (print-quote.js), posé par le petit script chargé avant celui-ci ;
     - settings.doc (voir doc-config.js) : modèle, couleur, format,
       densité, police, filigrane, blocs affichés, textes.

   Le modèle « classic » + réglages par défaut reproduisent EXACTEMENT
   le document historique (facture bleue / devis sarcelle).
   =================================================================== */

const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const numFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let CUR = 'MAD';
const money = (n) => numFmt.format(round2(Number(n) || 0)) + ' ' + CUR;

const WORDINGS = (typeof WORDS !== 'undefined')
  ? WORDS
  : { fr: () => '', ar: () => '' };

/* Régimes de TVA — libellés bilingues */
const REGIMES = {
  'reel': { fr: 'Réel normal', ar: 'النظام الحقيقي العادي' },
  'simplifie': { fr: 'Simplifié', ar: 'النظام المبسط' },
  'liberatoire': { fr: 'Versement libératoire', ar: 'الإقرار الجبائي' },
  'non-assujetti': { fr: 'Non assujetti à la TVA', ar: 'غير خاضع للضريبة على القيمة المضافة' }
};

const DCONF = (typeof DOC !== 'undefined') ? DOC : null;

/* Mélange deux couleurs hex (poids `t` pour `a`) → hex.
   Sert à dériver les nuances d'accent (bordures, fonds) sans dépendre du
   support de color-mix par le moteur d'impression. */
function mixHex(a, b, t) {
  const p = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h));
    const n = m ? parseInt(m[1], 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = p(a), B = p(b);
  const c = [0, 1, 2].map((i) => Math.round(A[i] * t + B[i] * (1 - t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function dateFR(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('fr-FR');
}

function totals(doc) {
  let ht = 0, tva = 0;
  const byRate = {};
  for (const l of doc.lines || []) {
    const lineHT = (Number(l.qty) || 0) * (Number(l.price) || 0);
    const rate = Number(l.tva) || 0;
    ht += lineHT;
    tva += lineHT * (rate / 100);
    byRate[rate] = round2((byRate[rate] || 0) + lineHT * (rate / 100));
  }
  ht = round2(ht); tva = round2(tva);
  return { ht, tva, ttc: round2(ht + tva), byRate };
}

function addressLines(s) {
  return String(s || '').split(/\n|,;/).map((x) => x.trim()).filter(Boolean);
}

/* Libellé bilingue : arabe (RTL) au-dessus du français */
const bi = (ar, fr) =>
  `<span class="tl"><span class="ar" dir="rtl">${esc(ar)}</span><span class="fr">${esc(fr)}</span></span>`;

/* En-tête de colonne bilingue */
const thBi = (ar, fr, cls) =>
  `<th class="bi ${cls || ''}"><span class="ar" dir="rtl">${esc(ar)}</span><span class="fr">${esc(fr)}</span></th>`;

const WM_TEXT = { paid: 'PAYÉE', draft: 'BROUILLON', quote: 'DEVIS / AR' };

(async function render() {
  const KIND = (typeof window !== 'undefined' && (window.DOC_KIND === 'quote' || window.DOC_KIND === 'credit'))
    ? window.DOC_KIND : 'invoice';
  const isQuote = KIND === 'quote';
  const isCredit = KIND === 'credit';
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const root = document.getElementById('root');

  try {
    const data = await window.factapi.storeGet();
    if (!data || data.error === 'locked') throw new Error(I18N.tr('pi.locked'));
    /* Barre d'outils traduite selon la langue choisie — le document reste
       bilingue et en LTR (sauf mode « arabe seul »). */
    if (typeof I18N !== 'undefined') I18N.setLang((data.settings && data.settings.language) || 'fr', { rtl: false });

    const docConf = DCONF ? DCONF.normalize(data.settings) : null;
    const tmpl = DCONF ? DCONF.templateFor(docConf, KIND) : 'classic';
    const accent = DCONF ? DCONF.accentHex(docConf, KIND) : (isQuote ? '#0891b2' : (isCredit ? '#b91c1c' : '#2563eb'));
    /* Format de page à l'impression : le CSS @page par défaut est A4. */
    if (docConf && docConf.paper === 'A5') {
      const st = document.createElement('style');
      st.textContent = '@media print { @page { size: A5; margin: 10mm; } }';
      document.head.appendChild(st);
    }
    const b = docConf ? docConf.blocks : { logo: 1, nameAr: 1, ids: { ice: 1, if: 1, rc: 1, patente: 1, cnss: 1, tva: 1 }, clientIds: 1, tvaDetail: 1, regime: 1, rib: 1, notes: 1, words: 'both', legal: 1, signature: 0, dueDate: 1, validity: 1, colsQty: 1, colsPu: 1, colsTva: 1, colsTotal: 1 };
    const doc = isQuote ? (data.quotes || []).find((q) => q.id === id)
      : (isCredit ? (data.creditNotes || []).find((c) => c.id === id) : (data.invoices || []).find((i) => i.id === id));
    if (!doc) throw new Error(I18N.tr(isQuote ? 'quo.notFound' : (isCredit ? 'cr.notFound' : 'pi.notFound')));

    CUR = (data.settings && data.settings.currency) || 'MAD';
    const co = (data.settings && data.settings.company) || {};
    /* Nom du client de la licence (fourni par le vendeur) en secours. */
    let licCustomer = '';
    try {
      const lic = await window.factapi.licenseStatus();
      if (lic && lic.configured && lic.customer) licCustomer = lic.customer;
    } catch (e) { /* licence non requise / inaccessible */ }
    const coName = co.name || licCustomer || 'Mon entreprise';
    const regime = REGIMES[(data.settings && data.settings.tvaRegime) || 'reel'] || REGIMES['reel'];
    const client = (data.clients || []).find((c) => c.id === doc.clientId);
    const t = totals(doc);

    const companyLines = [
      addressLines(co.address).map(esc).join(', '),
      [co.zip, co.city].filter(Boolean).map(esc).join(' '),
      co.country ? esc(co.country) : '',
      co.email ? esc(co.email) : '',
      co.phone ? esc(co.phone) : '',
      co.web ? esc(co.web) : ''
    ].filter(Boolean);

    /* Identifiants légaux : seuls ceux cochés dans les Paramètres sont affichés.
       Chaque entrée : [clé de réglage, libellé, valeur]. */
    const ID_DEFS = [
      ['ice', 'ICE', co.ice],
      ['if', 'IF', co.idFiscal],
      ['rc', 'RC', co.rc],
      ['patente', 'Patente', co.patente],
      ['cnss', 'CNSS', co.cnss],
      ['tva', 'TVA', co.tvaNumber]
    ];
    const shownIds = ID_DEFS.filter((e) => (b.ids ? b.ids[e[0]] : true) && e[2]);
    const idLines = shownIds.map((e) => e[1] + ' : ' + esc(e[2]));

    const clientLines = [
      (client && client.name) || doc.clientName || I18N.tr('common.noClient'),
      ...(client ? addressLines(client.address).map(esc) : []),
      client && client.email ? esc(client.email) : ''
    ].filter(Boolean);

    const tvaRows = b.tvaDetail ? Object.keys(t.byRate).sort((a, c) => a - c).map((rate) =>
      `<div class="row">${bi('الرسم على القيمة المضافة ' + esc(rate) + ' %', 'TVA ' + esc(rate) + ' %')}<span>${money(t.byRate[rate])}</span></div>`).join('') : '';

    /* --- Colonnes des lignes --- */
    const headCells = [thBi('البيان', 'Désignation')];
    if (b.colsQty) { headCells.push(thBi('الكمية', 'Qté', 'num')); }
    if (b.colsPu) { headCells.push(thBi('سعر الوحدة', 'P.U. HT', 'num')); }
    if (b.colsTva) { headCells.push(thBi('الضريبة', 'TVA', 'num')); }
    if (b.colsTotal) { headCells.push(thBi('المبلغ دون الضريبة', 'Total HT', 'num')); }

    const lineRows = (doc.lines || []).map((l) => {
      const cells = [`<td>${esc(l.desc)}</td>`];
      if (b.colsQty) cells.push(`<td class="num">${esc(l.qty)}</td>`);
      if (b.colsPu) cells.push(`<td class="num">${money(l.price)}</td>`);
      if (b.colsTva) cells.push(`<td class="num">${esc(l.tva)} %</td>`);
      if (b.colsTotal) cells.push(`<td class="num">${money((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    }).join('');

    /* --- Titres --- */
    const titleFr = isQuote ? 'DEVIS' : (isCredit ? 'AVOIR' : 'FACTURE');
    const titleAr = isQuote ? 'عرض الثمن' : (isCredit ? 'إشعار دائن' : 'فاتورة');
    const draftTitle = isCredit ? I18N.tr('cr.draftTitle') : I18N.tr('pi.draftTitle');
    const docNumber = doc.number || (isQuote ? 'Devis' : draftTitle);
    const tbTitle = doc.number || (isQuote ? 'Devis' : draftTitle);
    document.title = docNumber;
    document.getElementById('tb-title').textContent = tbTitle;

    /* --- Méta (n°, date, échéance OU validité, facture d'origine pour un avoir) --- */
    const metaRows = [];
    const numAr = isQuote ? 'رقم العرض' : (isCredit ? 'رقم الإشعار' : 'رقم الفاتورة');
    const numFr = isQuote ? 'N° devis' : (isCredit ? "N° avoir" : 'N° facture');
    const dateAr = isQuote ? 'تاريخ العرض' : (isCredit ? 'تاريخ الإشعار' : 'تاريخ الفاتورة');
    metaRows.push(`<tr><td class="ar" dir="rtl">${numAr}</td><td class="fr">${numFr}</td><td class="v">${esc(isQuote ? (doc.number || '—') : (doc.number || draftTitle))}</td></tr>`);
    metaRows.push(`<tr><td class="ar" dir="rtl">${dateAr}</td><td class="fr">Date</td><td class="v">${dateFR(doc.issueDate)}</td></tr>`);
    if (isQuote && b.validity) {
      metaRows.push(`<tr><td class="ar" dir="rtl">آخر أجل للصلاحية</td><td class="fr">Validité</td><td class="v">${dateFR(doc.validUntil)}</td></tr>`);
    }
    if (isCredit && doc.refNumber) {
      metaRows.push(`<tr><td class="ar" dir="rtl">الفاتورة الأصلية</td><td class="fr">Facture d'origine</td><td class="v">${esc(doc.refNumber)}</td></tr>`);
    }
    if (!isQuote && !isCredit && b.dueDate) {
      metaRows.push(`<tr><td class="ar" dir="rtl">أجل الأداء</td><td class="fr">Échéance</td><td class="v">${dateFR(doc.dueDate)}</td></tr>`);
    }

    /* --- Mentions / texte libre --- */
    const has = (s) => typeof s === 'string' && s.trim().length > 0;
    const ribLine = (b.rib && co.iban) ? (isQuote ? 'Mode de règlement (si accepté) : virement — RIB : ' : 'Mode de règlement : virement — RIB : ') + esc(co.iban) + '<br>' : '';
    const defaultTermsFr = isQuote
      ? 'Devis sans engagement de vente — les prix et conditions sont valables jusqu\'à la date de validité indiquée ci-dessus, dans le respect de la réglementation en vigueur au Royaume du Maroc.'
      : (isCredit
        ? 'Le présent avoir est émis conformément à la réglementation en vigueur au Royaume du Maroc. Aucun escompte pour paiement anticipé.'
        : 'En cas de retard de paiement, application des pénalités prévues par la réglementation en vigueur au Royaume du Maroc. Escompte pour paiement anticipé : néant.');
    const defaultTermsAr = isQuote
      ? 'عرض غير ملزم بالبيع — الأسعار والشروط صالحة إلى غاية التاريخ المذكور أعلاه.'
      : (isCredit
        ? 'حُرِّر هذا الإشعار الدائن طبقا للتشريع الجاري به العمل بالمملكة المغربية.'
        : 'في حالة التأخر في الأداء، تُطبَّق الجزاءات المنصوص عليها في التشريع الجاري به العمل.');
    const termsFr = (docConf && has(docConf.texts.terms)) ? docConf.texts.terms : defaultTermsFr;
    const termsAr = (docConf && has(docConf.texts.terms)) ? '' : defaultTermsAr;
    const mentionsBlock = b.legal ? `<div class="mentions">${ribLine}${esc(termsFr)}${termsAr ? ` <span class="ar" dir="rtl" style="display:block;margin-top:4px">${esc(termsAr)}</span>` : ''}</div>` : (ribLine ? `<div class="mentions">${ribLine}</div>` : '');

    /* --- Montant en toutes lettres --- */
    const wordsMode = b.words || 'both';
    let wordsBlock = '';
    if (wordsMode !== 'none') {
      const arLine = (wordsMode === 'ar' || wordsMode === 'both')
        ? `<div class="ar-line" dir="rtl">${isQuote ? 'أوقفت هذا العرض على مبلغ :' : (isCredit ? 'أوقفت هذا الإشعار الدائن على مبلغ :' : 'أوقفت هذه الفاتورة على مبلغ :')} ${esc(WORDINGS.ar(t.ttc))}</div>` : '';
      const frLine = (wordsMode === 'fr' || wordsMode === 'both')
        ? `<div class="fr-line">${isQuote ? 'Arrêté le présent devis à la somme de :' : (isCredit ? 'Arrêté le présent avoir à la somme de :' : 'Arrêtée la présente facture à la somme de :')} ${esc(WORDINGS.fr(t.ttc))}</div>` : '';
      wordsBlock = `<div class="words"><div class="lbl"><span class="ar" dir="rtl">المبلغ بالحروف</span> <span class="fr">/ Montant en toutes lettres</span></div>${arLine}${frLine}</div>`;
    }

    /* --- Mention « avoir » : référence à la facture d'origine + motif --- */
    let creditLine = '';
    if (isCredit) {
      const ref = doc.refNumber ? I18N.tr('cr.refDoc', { n: doc.refNumber }) : '';
      const reason = doc.reason ? `${I18N.tr('cr.reasonLabel')} ${esc(doc.reason)}` : '';
      creditLine = `<div class="validity" style="border-color:${accent};background:#fff1f2;color:#991b1b">${ref ? `<span class="ar" dir="rtl">إشعار على الفاتورة :</span> ${esc(ref)}` : ''}${reason ? `${ref ? '<br>' : ''}${reason}` : ''}</div>`;
    }

    /* --- Mention « converti » (devis) --- */
    let convLine = '';
    if (isQuote && doc.status === 'converted') {
      const convInv = (data.invoices || []).find((i) => i.id === doc.convertedInvoiceId);
      convLine = `<div class="validity" style="border-color:#15803d;background:#f0fdf4;color:#166534">${esc(I18N.tr('quo.convDoc', { n: convInv && convInv.number ? convInv.number : '' }))}</div>`;
    }
    const validityBlock = (isQuote && b.validity)
      ? `<div class="validity"><span class="ar" dir="rtl">هذا العرض صالح إلى غاية :</span> ${dateFR(doc.validUntil)}</div>`
      : '';

    /* --- Filigrane --- */
    let wm = '';
    if (docConf && docConf.watermark !== 'none') {
      const isPaid = docConf.watermark === 'paid';
      wm = `<div class="wm ${isPaid ? 'wm-paid' : ''}"><span>${esc(WM_TEXT[docConf.watermark] || '')}</span></div>`;
    }

    /* --- Signature --- */
    const sigBlock = b.signature
      ? `<div class="signature"><div class="sig-line"><span class="ar" dir="rtl">توقيع الطرف</span> / ${isQuote ? 'Bon pour accord' : 'Signature & cachet'}</div></div>`
      : '';

    /* --- Classes de la feuille --- */
    const classes = ['sheet', 'doc', 't-' + tmpl, 'd-' + (docConf ? docConf.density : 'normal'),
      'f-' + (docConf ? docConf.font : 'sans'), 'paper-' + (docConf ? docConf.paper : 'A4'),
      'm-' + (docConf ? docConf.margins : 'normal'), 'b-' + (docConf ? docConf.bilingual : 'both')].join(' ');
    const dir = (docConf && docConf.bilingual === 'ar') ? 'rtl' : 'ltr';

    /* Nuances dérivées de la couleur d'accent (inline → suit le document). */
    const shade = [
      '--accent:' + accent,
      '--accent-2:' + mixHex(accent, '#000000', 0.78),
      '--accent-3:' + mixHex(accent, '#ffffff', 0.52),
      '--accent-soft:' + mixHex(accent, '#ffffff', 0.08),
      '--accent-line:' + mixHex(accent, '#e2e8f0', 0.42)
    ].join(';');

    /* --- Bandeau « acquitté » (facture payée) --- */
    const paidBadge = (!isQuote && !isCredit && doc.paid) ? '<div class="badge-paid" role="note" aria-label="Payée">PAYÉE <span class="ar">مدفوعة</span></div>' : '';

    /* --- En-tête libre --- */
    const headNote = (docConf && has(docConf.texts.header)) ? `<div class="doc-note">${esc(docConf.texts.header)}</div>` : '';

    /* --- Pied --- */
    const legalDefault = isQuote
      ? { fr: 'Devis établi — TVA selon la réglementation en vigueur au Royaume du Maroc.', ar: 'عرض محرر طبقا للتشريع المغربي الجاري به العمل.' }
      : (isCredit
        ? { fr: "Avoir régulièrement émis — TVA selon la réglementation en vigueur au Royaume du Maroc.", ar: 'إشعار دائن محرر طبقا للتشريع المغربي الجاري به العمل.' }
        : { fr: 'Facture régulièrement émise — TVA selon la réglementation en vigueur au Royaume du Maroc.', ar: 'فاتورة محررة طبقا للتشريع المغربي الجاري به العمل.' });
    const footFr = (docConf && has(docConf.texts.footer)) ? docConf.texts.footer : legalDefault.fr;
    const footAr = (docConf && has(docConf.texts.footer)) ? '' : legalDefault.ar;

    root.innerHTML = `
      <div class="${classes}" style="${shade}" dir="${dir}">
        ${wm}${headNote}
        <div class="head">
          <div class="company">
            ${b.logo && co.logo && co.logo.dataUri ? `<img class="logo" src="${esc(co.logo.dataUri)}" alt="">` : ''}
            ${b.nameAr && co.nameAr ? `<div class="cname ar" dir="rtl">${esc(co.nameAr)}</div>` : ''}
            <div class="cname">${esc(coName)}</div>
            ${companyLines.map((l) => `<div class="cmeta">${l}</div>`).join('')}
            ${idLines.map((l) => `<div class="cmeta id">${l}</div>`).join('')}
          </div>
          <div class="title">
            <div class="ar title-ar" dir="rtl">${titleAr}</div>
            <h1>${titleFr}</h1>
            <table class="meta">${metaRows.join('')}</table>
          </div>
        </div>

        ${b.clientIds ? `<div class="parties">
          <div class="client-box">
            <div class="lbl"><span class="ar" dir="rtl">${isQuote ? 'عرض إلى' : (isCredit ? 'إشعار إلى' : 'فاتورة إلى')}</span> <span class="fr">/ ${isQuote ? 'Devis à' : (isCredit ? 'Avoir à' : 'Facturé à')}</span></div>
            ${clientLines.map((l, i) => `<div class="${i === 0 ? 'cname' : ''}">${l}</div>`).join('')}
            ${client && client.tvaNumber ? `<div class="cmeta">N° TVA / ICE : ${esc(client.tvaNumber)}</div>` : ''}
          </div>
        </div>` : ''}

        <table class="lines">
          <thead><tr>${headCells.join('')}</tr></thead>
          <tbody>${lineRows}</tbody>
        </table>

        <div class="bottom">
          <div class="notes">
            ${creditLine}${convLine}${validityBlock}
            ${b.notes && doc.notes ? `<strong>Note :</strong> ${esc(doc.notes)}` : ''}
            ${wordsBlock}
            ${b.regime ? `<div class="regime"><strong>Régime de TVA :</strong> ${esc(regime.fr)}${regime.ar ? ` <span class="ar" dir="rtl"> — ${esc(regime.ar)}</span>` : ''}</div>` : ''}
            ${mentionsBlock}
            ${sigBlock}
          </div>
          <div class="totals">
            <div class="row">${bi('المجموع دون الضريبة', 'Total HT')}<span>${money(t.ht)}</span></div>
            ${tvaRows}
            <div class="row">${bi('مجموع الضريبة', 'Total TVA')}<span>${money(t.tva)}</span></div>
            <div class="row grand">${bi('المجموع بالضريبة', 'Total TTC')}<span>${money(t.ttc)}</span></div>
          </div>
        </div>

        ${paidBadge}

        <div class="footer">
          ${b.legal ? `<div>${esc(coName)}${shownIds.length ? ' · ' + shownIds.map((e) => e[1] + ' ' + esc(e[2])).join(' · ') : ''}</div>` : ''}
          <div>${[co.email, co.phone, co.web].filter(Boolean).map(esc).join(' · ')}</div>
          ${(b.legal || (docConf && has(docConf.texts.footer))) && footFr ? `<div class="ftext">${esc(footFr)}</div>` : ''}
          ${footAr && b.legal ? `<div class="ar" dir="rtl">${esc(footAr)}</div>` : ''}
        </div>
      </div>`;
  } catch (e) {
    root.innerHTML = '<div class="sheet"><p style="color:#dc2626">' + I18N.tr('common.error') + esc(e.message) + '</p></div>';
  }

  window.factapi.invoiceReady();
})();

document.getElementById('btn-print').addEventListener('click', () => window.factapi.invoiceWindowPrint());
document.getElementById('btn-close').addEventListener('click', () => window.factapi.invoiceWindowClose());
document.getElementById('btn-pdf').addEventListener('click', async () => {
  const title = document.title || 'document';
  const res = await window.factapi.invoiceWindowPdf(title.replace(/[\\/:*?"<>|]/g, ''));
  if (res && !res.canceled) {
    const btn = document.getElementById('btn-pdf');
    btn.textContent = I18N.tr('common.pdfSaved');
    setTimeout(() => { btn.textContent = I18N.tr('common.pdf'); }, 2500);
  }
});
