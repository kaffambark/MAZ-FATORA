'use strict';

/* ===================================================================
   MAZ-FATORA — moteur du Centre d'aide

   Affiche le contenu de help-content.js (FR/AR) dans un panneau
   accessible : sommaire, recherche, navigation entre articles, aide
   contextuelle (bouton « ? » de chaque écran + touche F1).

   100 % local : aucune ressource réseau. Le balisage du panneau est
   statique dans index.html (data-i18n) ; ce script ne remplit que le
   contenu dynamique (sommaire, résultats, article).
   =================================================================== */

(function () {
  const HELP = window.HELP;
  const I18N = window.I18N;
  if (!HELP || !I18N) return;

  const tr = (k, v) => I18N.tr(k, v);
  const lang = () => I18N.getLang();
  const pick = (obj) => (obj ? (obj[lang()] || obj.fr || obj.ar || '') : '');

  const q = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  /* Texte indexé d'un article, dans la langue courante. */
  function searchText(a) {
    const L = lang();
    const parts = [a.title[L] || '', a.goal[L] || ''];
    ['prereq', 'steps', 'tips', 'errors'].forEach((f) => {
      if (a[f] && a[f][L]) parts.push(a[f][L].join(' '));
    });
    return norm(parts.join(' '));
  }

  const ARTICLES = Object.keys(HELP.articles);
  const state = { current: null };

  /* ------------------------------------------------------------------ */
  /* Rendu                                                              */
  /* ------------------------------------------------------------------ */

  function categoryArticles(catId) {
    return ARTICLES
      .filter((id) => HELP.articles[id].category === catId)
      .sort((a, b) => (HELP.articles[a].priority || 1) - (HELP.articles[b].priority || 1));
  }

  function renderToc() {
    const toc = q('#help-toc');
    if (!toc) return;
    let html = '';
    HELP.categories.forEach((cat) => {
      const ids = categoryArticles(cat.id);
      if (!ids.length) return;
      html += '<div class="help-cat"><div class="help-cat-title">'
        + '<svg class="ic"><use href="#' + esc(cat.icon) + '"/></svg>'
        + '<span>' + esc(pick(cat.title)) + '</span></div><ul>';
      ids.forEach((id) => {
        const a = HELP.articles[id];
        html += '<li><button type="button" class="help-toc-link' + (id === state.current ? ' active' : '')
          + '" data-help-article="' + esc(id) + '">' + esc(pick(a.title)) + '</button></li>';
      });
      html += '</ul></div>';
    });
    toc.innerHTML = html;
  }

  function listBlock(titleKey, arr) {
    if (!arr || !arr.length) return '';
    return '<div class="help-block"><h4>' + esc(tr(titleKey)) + '</h4><ul>'
      + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
  }

  function renderArticle(id) {
    const a = HELP.articles[id];
    const el = q('#help-article');
    if (!el) return;
    if (!a) { el.innerHTML = '<p class="muted">' + esc(tr('help.notFound')) + '</p>'; return; }
    state.current = id;

    let html = '<h3 class="help-h">' + esc(pick(a.title)) + '</h3>';
    html += '<p class="help-goal">' + esc(pick(a.goal)) + '</p>';
    if (a.prereq) html += listBlock('help.prereq', a.prereq[lang()]);
    if (a.steps) html += listBlock('help.steps', a.steps[lang()]);
    if (a.tips) html += listBlock('help.tips', a.tips[lang()]);
    if (a.errors) html += listBlock('help.errors', a.errors[lang()]);
    if (a.related && a.related.length) {
      html += '<div class="help-block"><h4>' + esc(tr('help.seeAlso')) + '</h4><div class="help-related">'
        + a.related.map((rid) => (HELP.articles[rid]
          ? '<button type="button" class="help-link" data-help-article="' + esc(rid) + '">'
            + esc(pick(HELP.articles[rid].title)) + '</button>'
          : '')).join('') + '</div></div>';
    }
    el.innerHTML = html;
    el.scrollTop = 0;

    const toc = q('#help-toc');
    if (toc) {
      toc.querySelectorAll('.help-toc-link').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-help-article') === id);
      });
      const act = toc.querySelector('.help-toc-link.active');
      if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }
  }

  function runSearch(term) {
    const box = q('#help-results');
    const toc = q('#help-toc');
    if (!box) return;
    const n = norm(term);
    if (!n) {
      box.hidden = true; box.innerHTML = '';
      if (toc) toc.hidden = false;
      return;
    }
    const hits = ARTICLES.filter((id) => searchText(HELP.articles[id]).indexOf(n) !== -1);
    if (toc) toc.hidden = true;
    box.hidden = false;
    box.innerHTML = hits.length
      ? '<ul>' + hits.map((id) => '<li><button type="button" class="help-toc-link" data-help-article="' + esc(id) + '">'
        + esc(pick(HELP.articles[id].title)) + '</button></li>').join('') + '</ul>'
      : '<p class="muted">' + esc(tr('help.noResult', { q: term })) + '</p>';
  }

  /* ------------------------------------------------------------------ */
  /* Ouverture / fermeture / focus                                       */
  /* ------------------------------------------------------------------ */

  function overlay() { return q('#help-root'); }
  function isOpen() { const o = overlay(); return !!o && !o.hidden; }

  function focusables() {
    const o = overlay();
    if (!o) return [];
    return Array.prototype.filter.call(
      o.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      (el) => !el.disabled && el.offsetParent !== null
    );
  }

  function openArticle(id) {
    const o = overlay();
    if (!o) return;
    if (!HELP.articles[id]) id = 'start.welcome';
    o.hidden = false;
    document.documentElement.classList.add('help-open');
    const box = q('#help-results'); if (box) { box.hidden = true; box.innerHTML = ''; }
    const search = q('#help-search'); if (search) search.value = '';
    const toc = q('#help-toc'); if (toc) toc.hidden = false;
    renderToc();
    renderArticle(id);
    const close = q('#help-close');
    if (close) close.focus();
  }

  function closeHelp() {
    const o = overlay();
    if (!o) return;
    o.hidden = true;
    document.documentElement.classList.remove('help-open');
  }

  function currentScreen() {
    const nav = document.querySelector('.nav-item.active');
    if (nav && nav.dataset.view) return nav.dataset.view;
    const view = document.querySelector('.view.active');
    return view ? view.id.replace(/^view-/, '') : '';
  }

  function openContextual() {
    const s = currentScreen();
    openArticle(HELP.SCREENS.indexOf(s) !== -1 ? ('screen.' + s) : 'start.welcome');
  }

  /* ------------------------------------------------------------------ */
  /* Boutons « ? » de chaque écran                                       */
  /* ------------------------------------------------------------------ */

  function injectScreenButtons() {
    document.querySelectorAll('.view').forEach((view) => {
      const name = (view.id || '').replace(/^view-/, '');
      if (HELP.SCREENS.indexOf(name) === -1) return;
      const header = view.querySelector('.view-header');
      if (!header) return;
      const host = header.querySelector('.actions') || header;
      let btn = host.querySelector('.help-screen-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn small help-screen-btn';
        btn.setAttribute('data-help-screen', name);
        btn.innerHTML = '<svg class="ic"><use href="#i-help"/></svg>';
        host.appendChild(btn);
      }
      btn.title = tr('help.contextual');
      btn.setAttribute('aria-label', tr('help.contextual'));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Événements                                                          */
  /* ------------------------------------------------------------------ */

  document.addEventListener('click', (e) => {
    const art = e.target.closest('[data-help-article]');
    if (art) { openArticle(art.getAttribute('data-help-article')); return; }
    const scr = e.target.closest('[data-help-screen]');
    if (scr) { openArticle('screen.' + scr.getAttribute('data-help-screen')); return; }
    if (e.target.closest('#btn-help')) { openContextual(); return; }
    if (e.target.closest('#help-close')) { closeHelp(); return; }
    if (e.target.id === 'help-root') { closeHelp(); }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'help-search') runSearch(e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); isOpen() ? closeHelp() : openContextual(); return; }
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closeHelp(); return; }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* La langue a changé : on rafraîchit le contenu et les libellés. */
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => {
      injectScreenButtons();
      if (isOpen()) { renderToc(); renderArticle(state.current); }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScreenButtons);
  } else {
    injectScreenButtons();
  }

  window.HELPUI = { open: openArticle, openContextual: openContextual, close: closeHelp, isOpen: isOpen };
})();
