'use strict';

/* ===================================================================
   MAZ-FATORA — onboarding (aide à la première utilisation)

   Deux dispositifs, 100 % locaux, bilingues FR/AR :
     1. Visite guidée : 5 bulles séquentielles qui pointent les éléments
        réels de l'interface (barre latérale). Fermable à tout moment ;
        fermée, elle ne se réaffiche plus (settings.onboarded = true).
        Réactivable depuis Paramètres → Aide.
     2. Checklist « Mise en route » sur le tableau de bord : suit l'état
        réel de l'application (société, client, facture, encaissement)
        et une sauvegarde manuelle (settings.setupChecklist.backup).

   Aucune donnée n'est transmise : tout est stocké dans les paramètres.
   =================================================================== */

(function () {
  const I18N = window.I18N;
  if (!I18N) return;

  const tr = (k, v) => I18N.tr(k, v);
  const q = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Accès à l'état applicatif (défini par app.js, chargé après ce script). */
  function stateRef() {
    try { return (typeof state !== 'undefined') ? state : null; } catch (e) { return null; }
  }
  function persistSettings() {
    try { if (typeof persist === 'function') persist('settings'); } catch (e) { /* non bloquant */ }
  }

  /* ------------------------------------------------------------------ */
  /* Visite guidée                                                      */
  /* ------------------------------------------------------------------ */

  const STEPS = [
    { title: 'tour.title1', text: 'tour.text1', target: null },
    { title: 'tour.title2', text: 'tour.text2', target: '.nav' },
    { title: 'tour.title3', text: 'tour.text3', target: '.nav-item[data-view="import"]' },
    { title: 'tour.title4', text: 'tour.text4', target: '.nav-item[data-view="drafts"]' },
    { title: 'tour.title5', text: 'tour.text5', target: '.nav-item[data-view="payments"]' }
  ];

  let idx = 0;
  let active = false;

  function overlay() { return q('#tour-root'); }
  function tipEl() { return q('#tour-tip'); }
  function hlEl() { return q('#tour-hl'); }

  function renderDots() {
    const dots = q('#tour-dots');
    if (!dots) return;
    dots.innerHTML = STEPS.map((_, i) =>
      '<span class="tour-dot' + (i === idx ? ' active' : '') + '" aria-hidden="true"></span>').join('');
  }

  function render() {
    const step = STEPS[idx];
    const root = overlay();
    if (!root) return;
    const title = q('#tour-title');
    const text = q('#tour-text');
    const num = q('#tour-stepnum');
    if (title) title.textContent = tr(step.title);
    if (text) text.textContent = tr(step.text);
    if (num) num.textContent = tr('tour.step', { n: idx + 1, total: STEPS.length });

    const prev = q('#tour-prev');
    const next = q('#tour-next');
    const skip = q('#tour-skip');
    if (prev) { prev.textContent = tr('tour.prev'); prev.disabled = idx === 0; }
    if (next) next.textContent = (idx === STEPS.length - 1) ? tr('tour.done') : tr('tour.next');
    if (skip) skip.textContent = tr('tour.skip');

    renderDots();
    position();
  }

  function position() {
    const tip = tipEl();
    const hl = hlEl();
    if (!tip || !hl) return;
    const step = STEPS[idx];
    const target = step.target ? q(step.target) : null;

    if (!target) {
      hl.hidden = true;
      tip.classList.add('tour-center');
      tip.style.left = '';
      tip.style.top = '';
      tip.style.visibility = 'visible';
      return;
    }

    tip.classList.remove('tour-center');
    const r = target.getBoundingClientRect();
    hl.hidden = false;
    hl.style.left = (r.left - 4) + 'px';
    hl.style.top = (r.top - 4) + 'px';
    hl.style.width = (r.width + 8) + 'px';
    hl.style.height = (r.height + 8) + 'px';

    tip.style.visibility = 'hidden';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right + 16;
    let top = r.top + r.height / 2 - th / 2;
    /* Pas assez de place à droite : on place la bulle en dessous. */
    if (left + tw > vw - 12) {
      left = Math.min(Math.max(12, r.left), vw - tw - 12);
      top = r.bottom + 16;
    }
    left = Math.max(12, Math.min(left, vw - tw - 12));
    top = Math.max(12, Math.min(top, vh - th - 12));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.visibility = 'visible';
  }

  function tipFocusables() {
    const tip = tipEl();
    if (!tip) return [];
    return Array.prototype.filter.call(
      tip.querySelectorAll('button'),
      (el) => !el.disabled && el.offsetParent !== null
    );
  }

  function focusTip() {
    const next = q('#tour-next');
    if (next && !next.disabled) next.focus();
  }

  function start() {
    idx = 0;
    active = true;
    const root = overlay();
    if (!root) return;
    root.hidden = false;
    document.documentElement.classList.add('tour-open');
    render();
    focusTip();
  }

  function next() {
    if (idx >= STEPS.length - 1) { finish(); return; }
    idx += 1;
    render();
    focusTip();
  }

  function prev() {
    if (idx <= 0) return;
    idx -= 1;
    render();
    focusTip();
  }

  function markSeen() {
    const st = stateRef();
    if (!st) return;
    st.settings = st.settings || {};
    st.settings.onboarded = true;
    persistSettings();
  }

  function finish() {
    active = false;
    const root = overlay();
    if (root) root.hidden = true;
    document.documentElement.classList.remove('tour-open');
    markSeen();
  }

  /* Démarre la visite si l'utilisateur ne l'a jamais fermée. */
  function maybeStart() {
    const st = stateRef();
    if (!st) return;
    if (st.settings && st.settings.onboarded) return;
    const root = overlay();
    if (!root) return;
    start();
  }

  /* ------------------------------------------------------------------ */
  /* Checklist « Mise en route »                                        */
  /* ------------------------------------------------------------------ */

  /* Un encaissement existe-t-il ? (liste de règlements ou ancien booléen) */
  function hasPayment() {
    const st = stateRef();
    if (!st) return false;
    return st.invoices.some((i) => {
      const recs = Array.isArray(i.payments) ? i.payments : [];
      if (recs.length) return recs.some((p) => Number(p.amount) > 0);
      return !!i.paid;
    });
  }

  function checklistItems() {
    const st = stateRef();
    const s = (st && st.settings) || {};
    const co = s.company || {};
    const clients = (st && st.clients) || [];
    const invoices = (st && st.invoices) || [];
    const sc = s.setupChecklist || {};
    return [
      { key: 'setup.company', goto: 'settings', done: !!(co.name || co.ice) },
      { key: 'setup.client', goto: 'clients', done: clients.length > 0 },
      { key: 'setup.invoice', goto: 'invoices', done: invoices.some((i) => i.status === 'validated') },
      { key: 'setup.payment', goto: 'payments', done: hasPayment() },
      { key: 'setup.backup', goto: 'settings', done: !!sc.backup }
    ];
  }

  function renderChecklist() {
    const card = q('#setup-card');
    const list = q('#setup-list');
    if (!card || !list) return;
    const items = checklistItems();
    const done = items.filter((i) => i.done).length;
    /* Visible tant que la mise en route n'est pas terminée. */
    card.hidden = done >= items.length;
    const prog = q('#setup-progress');
    if (prog) prog.textContent = tr('setup.progress', { done, total: items.length });
    list.innerHTML = items.map((it) => `
      <li class="setup-item${it.done ? ' done' : ''}">
        <span class="setup-ic" aria-hidden="true">${it.done ? '<svg class="ic"><use href="#i-check"/></svg>' : ''}</span>
        <span class="setup-label">${esc(tr(it.key))}</span>
        ${it.done
          ? '<span class="setup-badge">' + esc(tr('setup.done')) + '</span>'
          : '<button type="button" class="btn small" data-setup-goto="' + esc(it.goto) + '">' + esc(tr('setup.goto')) + '</button>'}
      </li>`).join('');
  }

  /* Marque la sauvegarde comme faite (appelé après un export réussi). */
  function markBackup() {
    const st = stateRef();
    if (!st) return;
    st.settings = st.settings || {};
    st.settings.setupChecklist = st.settings.setupChecklist || {};
    st.settings.setupChecklist.backup = true;
    persistSettings();
    renderChecklist();
  }

  /* ------------------------------------------------------------------ */
  /* Événements                                                         */
  /* ------------------------------------------------------------------ */

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-setup-goto]');
    if (go) {
      const v = go.getAttribute('data-setup-goto');
      try { if (typeof showView === 'function') showView(v); } catch (err) { /* non bloquant */ }
      return;
    }
    if (!active) return;
    if (e.target.closest('#tour-next')) { next(); return; }
    if (e.target.closest('#tour-prev')) { prev(); return; }
    if (e.target.closest('#tour-skip')) { finish(); }
  });

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return; }
    if (e.key === 'Tab') {
      const f = tipFocusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  window.addEventListener('resize', () => { if (active) position(); });
  window.addEventListener('scroll', () => { if (active) position(); }, true);

  /* La langue change : on rafraîchit la bulle ouverte, et la checklist. */
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => {
      if (active) render();
      renderChecklist();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  window.ONBOARD = {
    maybeStart: maybeStart,
    start: start,
    renderChecklist: renderChecklist,
    markBackup: markBackup,
    isActive: () => active
  };
})();
