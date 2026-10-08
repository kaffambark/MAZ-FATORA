'use strict';

/* Rendu de la facture bilingue (français / arabe) — impression & export PDF */

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

function dateFR(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('fr-FR');
}

function totals(inv) {
  let ht = 0, tva = 0;
  const byRate = {};
  for (const l of inv.lines || []) {
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

(async function render() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const root = document.getElementById('root');

  try {
    const data = await window.factapi.storeGet();
    if (!data || data.error === 'locked') throw new Error(I18N.tr('pi.locked'));
    // Barre d'outils traduite selon la langue choisie — la facture reste bilingue et en LTR.
    if (typeof I18N !== 'undefined') I18N.setLang((data.settings && data.settings.language) || 'fr', { rtl: false });
    const inv = (data.invoices || []).find((i) => i.id === id);
    if (!inv) throw new Error(I18N.tr('pi.notFound'));

    CUR = (data.settings && data.settings.currency) || 'MAD';
    const co = (data.settings && data.settings.company) || {};
    /* Nom du client de la licence (fourni par le vendeur, non modifiable) :
       utilisé en secours quand aucun nom de société n'a été saisi. */
    let licCustomer = '';
    try {
      const lic = await window.factapi.licenseStatus();
      if (lic && lic.configured && lic.customer) licCustomer = lic.customer;
    } catch (e) { /* licence non requise / inaccessible : nom de société seul */ }
    const coName = co.name || licCustomer || 'Mon entreprise';
    const regime = REGIMES[(data.settings && data.settings.tvaRegime) || 'reel'] || REGIMES['reel'];
    const client = (data.clients || []).find((c) => c.id === inv.clientId);
    const t = totals(inv);

    const companyLines = [
      addressLines(co.address).map(esc).join(', '),
      [co.zip, co.city].filter(Boolean).map(esc).join(' '),
      co.country ? esc(co.country) : '',
      co.email ? esc(co.email) : '',
      co.phone ? esc(co.phone) : '',
      co.web ? esc(co.web) : ''
    ].filter(Boolean);

    /* Identifiants marocains : ICE / IF / RC / Patente / CNSS / TVA */
    const idLines = [
      co.ice ? 'ICE : ' + esc(co.ice) : '',
      co.idFiscal ? 'IF : ' + esc(co.idFiscal) : '',
      co.rc ? 'RC : ' + esc(co.rc) : '',
      co.patente ? 'Patente : ' + esc(co.patente) : '',
      co.cnss ? 'CNSS : ' + esc(co.cnss) : '',
      co.tvaNumber ? 'TVA : ' + esc(co.tvaNumber) : ''
    ].filter(Boolean);

    const clientLines = [
      (client && client.name) || inv.clientName || I18N.tr('common.noClient'),
      ...(client ? addressLines(client.address).map(esc) : []),
      client && client.email ? esc(client.email) : ''
    ].filter(Boolean);

    const tvaRows = Object.keys(t.byRate).sort((a, b) => a - b).map((rate) =>
      `<div class="row">${bi('الرسم على القيمة المضافة ' + esc(rate) + ' %', 'TVA ' + esc(rate) + ' %')}<span>${money(t.byRate[rate])}</span></div>`).join('');

    const title = inv.number || I18N.tr('pi.draftTitle');
    document.title = title;
    document.getElementById('tb-title').textContent = title;

    root.innerHTML = `
      <div class="sheet">
        <div class="head">
          <div class="company">
            ${co.logo && co.logo.dataUri ? `<img class="logo" src="${esc(co.logo.dataUri)}" alt="">` : ''}
            ${co.nameAr ? `<div class="cname ar" dir="rtl">${esc(co.nameAr)}</div>` : ''}
            <div class="cname">${esc(coName)}</div>
            ${companyLines.map((l) => `<div class="cmeta">${l}</div>`).join('')}
            ${idLines.map((l) => `<div class="cmeta id">${l}</div>`).join('')}
          </div>
          <div class="title">
            <div class="ar title-ar" dir="rtl">فاتورة</div>
            <h1>FACTURE</h1>
            <table class="meta">
              <tr>
                <td class="ar" dir="rtl">رقم الفاتورة</td>
                <td class="fr">N° facture</td>
                <td class="v">${esc(inv.number || 'Brouillon')}</td>
              </tr>
              <tr>
                <td class="ar" dir="rtl">تاريخ الفاتورة</td>
                <td class="fr">Date</td>
                <td class="v">${dateFR(inv.issueDate)}</td>
              </tr>
              <tr>
                <td class="ar" dir="rtl">أجل الأداء</td>
                <td class="fr">Échéance</td>
                <td class="v">${dateFR(inv.dueDate)}</td>
              </tr>
            </table>
          </div>
        </div>

        <div class="parties">
          <div class="client-box">
            <div class="lbl"><span class="ar" dir="rtl">فاتورة إلى</span> <span class="fr">/ Facturé à</span></div>
            ${clientLines.map((l, i) => `<div class="${i === 0 ? 'cname' : ''}">${l}</div>`).join('')}
            ${client && client.tvaNumber ? `<div class="cmeta">N° TVA / ICE : ${esc(client.tvaNumber)}</div>` : ''}
          </div>
        </div>

        <table class="lines">
          <thead>
            <tr>
              ${thBi('البيان', 'Désignation')}
              ${thBi('الكمية', 'Qté', 'num')}
              ${thBi('سعر الوحدة', 'P.U. HT', 'num')}
              ${thBi('الضريبة', 'TVA', 'num')}
              ${thBi('المبلغ دون الضريبة', 'Total HT', 'num')}
            </tr>
          </thead>
          <tbody>
            ${(inv.lines || []).map((l) => `
              <tr>
                <td>${esc(l.desc)}</td>
                <td class="num">${esc(l.qty)}</td>
                <td class="num">${money(l.price)}</td>
                <td class="num">${esc(l.tva)} %</td>
                <td class="num">${money((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
              </tr>`).join('')}
          </tbody>
        </table>

        <div class="bottom">
          <div class="notes">
            ${inv.notes ? `<strong>Note :</strong> ${esc(inv.notes)}` : ''}
            <div class="words">
              <div class="lbl"><span class="ar" dir="rtl">المبلغ بالحروف</span> <span class="fr">/ Montant en toutes lettres</span></div>
              <div class="ar-line" dir="rtl">أوقفت هذه الفاتورة على مبلغ : ${esc(WORDINGS.ar(t.ttc))}</div>
              <div class="fr-line">Arrêtée la présente facture à la somme de : ${esc(WORDINGS.fr(t.ttc))}</div>
            </div>
            <div class="regime">
              <strong>Régime de TVA :</strong> ${esc(regime.fr)}
              ${regime.ar ? `<span class="ar" dir="rtl"> — ${esc(regime.ar)}</span>` : ''}
            </div>
            <div class="mentions">
              ${co.iban ? `Mode de règlement : virement — RIB : ${esc(co.iban)}<br>` : ''}
              En cas de retard de paiement, application des pénalités prévues par la réglementation en vigueur
              au Royaume du Maroc. Escompte pour paiement anticipé : néant.
              <span class="ar" dir="rtl" style="display:block;margin-top:4px">في حالة التأخر في الأداء، تُطبَّق الجزاءات المنصوص عليها في التشريع الجاري به العمل.</span>
            </div>
          </div>
          <div class="totals">
            <div class="row">${bi('المجموع دون الضريبة', 'Total HT')}<span>${money(t.ht)}</span></div>
            ${tvaRows}
            <div class="row">${bi('مجموع الضريبة', 'Total TVA')}<span>${money(t.tva)}</span></div>
            <div class="row grand">${bi('المجموع بالضريبة', 'Total TTC')}<span>${money(t.ttc)}</span></div>
          </div>
        </div>

        ${inv.paid ? '<div class="badge-paid" role="note" aria-label="Payée">PAYÉE <span class="ar">مدفوعة</span></div>' : ''}

        <div class="footer">
          <div>${esc(coName)}${co.ice ? ' · ICE ' + esc(co.ice) : ''}${co.idFiscal ? ' · IF ' + esc(co.idFiscal) : ''}${co.rc ? ' · RC ' + esc(co.rc) : ''}${co.patente ? ' · Patente ' + esc(co.patente) : ''}${co.cnss ? ' · CNSS ' + esc(co.cnss) : ''}${co.tvaNumber ? ' · TVA ' + esc(co.tvaNumber) : ''}</div>
          <div>${[co.email, co.phone, co.web].filter(Boolean).map(esc).join(' · ')}</div>
          <div>Facture régulièrement émise — TVA selon la réglementation en vigueur au Royaume du Maroc.</div>
          <div class="ar" dir="rtl">فاتورة محررة طبقا للتشريع المغربي الجاري به العمل.</div>
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
  const title = document.title || 'facture';
  const res = await window.factapi.invoiceWindowPdf(title.replace(/[\\/:*?"<>|]/g, ''));
  if (res && !res.canceled) {
    const btn = document.getElementById('btn-pdf');
    btn.textContent = I18N.tr('common.pdfSaved');
    setTimeout(() => { btn.textContent = I18N.tr('common.pdf'); }, 2500);
  }
});
