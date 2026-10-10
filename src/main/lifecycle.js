'use strict';

/* MAZ-FATORA — logique de fin de session (fermeture « pro »).
   Helpers PURS, testables sans Electron ; main.js les branche sur les
   événements « before-quit » / « window-all-closed » / IPC. */

/* Compteur d'opérations sensibles en cours (export PDF, clôture de période,
   sauvegarde/restauration, déplacement de la base). Tant qu'il est > 0,
   quitter demande une confirmation : on ne coupe jamais une écriture. */
function createBusyTracker() {
  let n = 0;
  return {
    begin() { n += 1; return n; },
    end() { n = Math.max(0, n - 1); return n; },
    count() { return n; },
    reset() { n = 0; }
  };
}

/* Décision de fermeture (pure) :
   - mustConfirm : une opération est en cours et l'utilisateur n'a pas confirmé ;
   - proceed     : la fermeture peut aller au bout ;
   - lockSession : verrouiller la session avant de fermer
                   (option « Verrouiller à la fermeture » + protection active). */
function decideQuit(opts) {
  const o = opts || {};
  const busy = Math.max(0, Number(o.busy) || 0);
  const confirmed = !!o.confirmed;
  const mustConfirm = busy > 0 && !confirmed;
  return {
    mustConfirm,
    proceed: !mustConfirm,
    lockSession: !mustConfirm && !!o.lockOnQuit && !!o.protectedApp
  };
}

/* Durée de session lisible (journal) : « 1 h 05 min », « 12 min 30 s », « 45 s ». */
function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

module.exports = { createBusyTracker, decideQuit, formatDuration };