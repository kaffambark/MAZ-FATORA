'use strict';

/* ===================================================================
   MAZ-FATORA — guide d'utilisation imprimable

   Rend le contenu de help-content.js (source unique FR/AR) sous forme de
   document prêt à imprimer / exporter en PDF : couverture, sommaire,
   articles par catégorie, aide-mémoire. Aucun réseau.

   Le rendu est une fonction PURE (renderGuide) pour être testable hors
   navigateur ; boot() se contente de câbler le DOM et la barre d'outils.
   =================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GUIDE = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.boot);
    else api.boot();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Liste (à puces ou numérotée) précédée d'un libellé traduit. */
  function block(tr, labelKey, items, ordered) {
    if (!items || !items.length) return '';
    const tag = ordered ? 'ol' : 'ul';
    return '<div class="g-block"><h4 class="g-label">' + esc(tr(labelKey)) + '</h4><' + tag + '>'
      + items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</' + tag + '></div>';
  }

  function articleHtml(a, id, lang, tr) {
    const t = (o) => (o ? (o[lang] || o.fr || '') : '');
    let h = '<article class="g-art" id="art-' + esc(id) + '">';
    h += '<h3 class="g-art-title">' + esc(t(a.title)) + '</h3>';
    h += '<p class="g-goal">' + esc(t(a.goal)) + '</p>';
    h += block(tr, 'help.prereq', a.prereq ? a.prereq[lang] : null, false);
    h += block(tr, 'help.steps', a.steps ? a.steps[lang] : null, true);
    h += block(tr, 'help.tips', a.tips ? a.tips[lang] : null, false);
    h += block(tr, 'help.errors', a.errors ? a.errors[lang] : null, false);
    h += '</article>';
    return h;
  }

  function memoHtml(help, lang, tr) {
    const articles = help.articles || {};
    const screens = (help.SCREENS || []).map((s) => articles['screen.' + s]).filter(Boolean);
    let h = '<section class="g-cat g-memo">';
    h += '<h2 class="g-cat-title">' + esc(tr('guide.memo')) + '</h2>';
    h += '<table class="g-memo-table"><thead><tr><th>' + esc(tr('guide.screen'))
      + '</th><th>' + esc(tr('guide.purpose')) + '</th></tr></thead><tbody>';
    screens.forEach((a) => {
      h += '<tr><td>' + esc(a.title[lang] || a.title.fr) + '</td><td>'
        + esc(a.goal[lang] || a.goal.fr) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += block(tr, 'guide.shortcuts', [tr('guide.shortcutHelp'), tr('guide.shortcutClose')], false);
    h += '</section>';
    return h;
  }

  /* Rendu complet du guide — fonction pure (testable). */
  function renderGuide(help, lang, tr, meta) {
    meta = meta || {};
    const cats = help.categories || [];
    const articles = help.articles || {};
    const ids = Object.keys(articles);
    const catArticles = (catId) => ids
      .filter((id) => articles[id].category === catId)
      .sort((a, b) => (articles[a].priority || 1) - (articles[b].priority || 1));
    const title = (o) => (o ? (o[lang] || o.fr || '') : '');

    let h = '<div class="g-doc">';

    /* Couverture */
    h += '<section class="g-cover">'
      + '<div class="g-brand">MAZ-FATORA</div>'
      + '<h1 class="g-cover-title">' + esc(tr('guide.title')) + '</h1>'
      + '<p class="g-cover-sub">' + esc(tr('guide.subtitle')) + '</p>'
      + '<p class="g-cover-meta">' + esc(tr('guide.version')) + ' ' + esc(String(meta.version || ''))
      + (meta.date ? ' &middot; ' + esc(tr('guide.generated')) + ' ' + esc(meta.date) : '')
      + '</p></section>';

    /* Sommaire */
    h += '<section class="g-toc"><h2 class="g-cat-title">' + esc(tr('guide.toc')) + '</h2>';
    cats.forEach((cat) => {
      const list = catArticles(cat.id);
      if (!list.length) return;
      h += '<div class="g-toc-cat"><h3>' + esc(title(cat.title)) + '</h3><ul>'
        + list.map((id) => '<li>' + esc(title(articles[id].title)) + '</li>').join('')
        + '</ul></div>';
    });
    h += '</section>';

    /* Articles par catégorie */
    cats.forEach((cat) => {
      const list = catArticles(cat.id);
      if (!list.length) return;
      h += '<section class="g-cat"><h2 class="g-cat-title">' + esc(title(cat.title)) + '</h2>';
      list.forEach((id) => { h += articleHtml(articles[id], id, lang, tr); });
      h += '</section>';
    });

    /* Aide-mémoire (1 page) */
    h += memoHtml(help, lang, tr);

    h += '</div>';
    return h;
  }

  /* Câblage DOM (fenêtre d'impression). */
  function boot() {
    const w = (typeof window !== 'undefined') ? window : null;
    if (!w || !w.HELP || !w.I18N) return;
    const I18N = w.I18N;
    const el = document.getElementById('root');
    const params = new URLSearchParams(w.location.search);
    const p = params.get('lang');
    const lang = (p === 'ar' || p === 'fr') ? p : (I18N.getLang ? I18N.getLang() : 'fr');
    I18N.setLang(lang);

    const finish = (version) => {
      let date = '';
      try { date = new Date().toLocaleDateString(lang === 'ar' ? 'ar-MA' : 'fr-FR'); }
      catch (e) { date = new Date().toISOString().slice(0, 10); }
      if (el) el.innerHTML = renderGuide(w.HELP, lang, I18N.tr.bind(I18N), { version, date });
      /* Prévient le processus principal que le rendu est prêt (aperçu/PDF). */
      if (w.factapi && w.factapi.invoiceReady) { try { w.factapi.invoiceReady(); } catch (e) { /* non bloquant */ } }
    };

    if (w.factapi && w.factapi.appVersion) {
      w.factapi.appVersion()
        .then((v) => finish('v' + String(v || '').replace(/^v/, '')))
        .catch(() => finish(''));
    } else {
      finish('');
    }

    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    on('btn-print', () => { if (w.factapi) w.factapi.invoiceWindowPrint(); });
    on('btn-close', () => { if (w.factapi) w.factapi.invoiceWindowClose(); });
    on('btn-pdf', async () => {
      if (!w.factapi || !w.factapi.invoiceWindowPdf) return;
      const res = await w.factapi.invoiceWindowPdf('MAZ-FATORA-Guide-' + (lang === 'ar' ? 'AR' : 'FR'));
      if (res && !res.canceled) {
        const b = document.getElementById('btn-pdf');
        if (b) { b.textContent = I18N.tr('common.pdfSaved'); setTimeout(() => { b.textContent = I18N.tr('common.pdf'); }, 2500); }
      }
    });
  }

  return { renderGuide: renderGuide, boot: boot };
});
