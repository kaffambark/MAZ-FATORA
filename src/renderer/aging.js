'use strict';

/* Moteur d'ancienneté (balance âgée) PARTAGÉ — module PUR, sans dépendance
   Electron ni DOM. Utilisé par :
     - le rendu in-app « Balance âgée » (src/renderer/app.js, via window.AGING) ;
     - le paquet comptable (src/main/export-pack.js, via require).
   Une seule règle de calcul garantit que l'écran et l'export concordent.

   Modèle : à partir des factures VALIDÉES, on calcule pour chacune :
     reste dû = total TTC − encaissements − avoirs validés rattachés.
   L'ancienneté est mesurée en JOURS ÉCHUS depuis l'échéance (dueDate), ou la
   date de facture à défaut. La « tranche » classe le reste par ancienneté. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AGING = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var round2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };

  /* Date du jour au format ISO (locale), indépendante de l'heure. Une date de
     référence peut être forcée pour des tests déterministes. */
  function todayISO(ref) {
    if (ref) return ref;
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }

  /* Total d'un document (facture OU avoir) : HT, TVA et TTC. */
  function docTotals(doc) {
    var ht = 0, tva = 0;
    var lines = (doc && doc.lines) || [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i] || {};
      var lht = (Number(l.qty) || 0) * (Number(l.price) || 0);
      ht += lht;
      tva += lht * (Number(l.tva) || 0) / 100;
    }
    return { ht: round2(ht), tva: round2(tva), ttc: round2(ht + tva) };
  }

  /* Encaissements d'une facture (repli sur l'ancien drapeau « paid »). */
  function paidTotal(inv) {
    var recs = Array.isArray(inv && inv.payments) ? inv.payments : [];
    if (recs.length) {
      var s = 0;
      for (var i = 0; i < recs.length; i++) s += Number(recs[i].amount) || 0;
      return round2(s);
    }
    return inv && inv.paid ? docTotals(inv).ttc : 0;
  }

  /* Somme des avoirs VALIDÉS rattachés à une facture (par id ou par numéro). */
  function creditedTotal(invoiceId, invoiceNumber, credits) {
    var sum = 0;
    var list = credits || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.status !== 'validated') continue;
      var matchId = c.refInvoiceId && c.refInvoiceId === invoiceId;
      var matchNum = c.refNumber && c.refNumber === invoiceNumber;
      if (matchId || matchNum) sum += docTotals(c).ttc;
    }
    return round2(sum);
  }

  /* Ancienneté en jours échus (>= 0), au jour, sans dépendre de l'heure. */
  function ageDays(dueDate, issueDate, refISO) {
    var base = dueDate || issueDate;
    if (!base) return 0;
    var ref = new Date(base + 'T00:00:00');
    if (isNaN(ref.getTime())) return 0;
    var t = new Date(todayISO(refISO) + 'T00:00:00');
    var d = Math.round((t.getTime() - ref.getTime()) / 86400000);
    return d > 0 ? d : 0;
  }

  var BUCKETS = ['notdue', '0-30', '31-60', '61-90', '90+'];

  /* Tranche d'ancienneté : une échéance du jour (ou future) n'est pas échue. */
  function bucketId(dueDate, days, refISO) {
    if (!dueDate) return 'notdue';
    if (dueDate >= todayISO(refISO)) return 'notdue';
    if (days <= 30) return '0-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    return '90+';
  }

  var LABEL_FR = { 'notdue': 'Non échue', '0-30': '0-30 j', '31-60': '31-60 j', '61-90': '61-90 j', '90+': '+90 j' };
  var LABEL_AR = { 'notdue': 'غير مستحقة', '0-30': '0-30 يوم', '31-60': '31-60 يوم', '61-90': '61-90 يوم', '90+': '+90 يوم' };
  function labelFr(id) { return LABEL_FR[id] || id; }
  function labelAr(id) { return LABEL_AR[id] || id; }

  /* Construit la balance âgée.
     invoices : liste de factures (par défaut, seules les VALIDÉES sont retenues).
     opts : { credits: [], ref: ISO, onlyValidated: bool } */
  function rows(invoices, opts) {
    opts = opts || {};
    var credits = opts.credits || [];
    var ref = todayISO(opts.ref);
    var onlyValidated = opts.onlyValidated !== false;
    var out = [];
    var list = invoices || [];
    for (var i = 0; i < list.length; i++) {
      var inv = list[i];
      if (!inv) continue;
      if (onlyValidated && inv.status !== 'validated') continue;
      var t = docTotals(inv);
      var paid = paidTotal(inv);
      var credited = creditedTotal(inv.id, inv.number, credits);
      var rest = round2(t.ttc - paid - credited);
      if (rest <= 0) continue;
      var days = ageDays(inv.dueDate, inv.issueDate, ref);
      out.push({
        id: inv.id,
        number: inv.number || '',
        clientId: inv.clientId || '',
        clientName: inv.clientName || '',
        issueDate: inv.issueDate || '',
        dueDate: inv.dueDate || '',
        totalTTC: t.ttc,
        paid: paid,
        credited: credited,
        rest: rest,
        days: days,
        bucket: bucketId(inv.dueDate, days, ref)
      });
    }
    out.sort(function (a, b) {
      var c = String(a.clientName).localeCompare(String(b.clientName));
      if (c !== 0) return c;
      return b.days - a.days;
    });
    var totals = { rest: 0, paid: 0, credited: 0, totalTTC: 0 };
    var buckets = { 'notdue': 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (var j = 0; j < out.length; j++) {
      totals.rest = round2(totals.rest + out[j].rest);
      totals.paid = round2(totals.paid + out[j].paid);
      totals.credited = round2(totals.credited + out[j].credited);
      totals.totalTTC = round2(totals.totalTTC + out[j].totalTTC);
      buckets[out[j].bucket] = round2((buckets[out[j].bucket] || 0) + out[j].rest);
    }
    return { ref: ref, rows: out, totals: totals, buckets: buckets, n: out.length };
  }

  /* CSV de la balance (séparateur « ; », BOM UTF-8 pour Excel FR). */
  function csv(rowsObj, labels) {
    var L = labels || { client: 'Client', number: 'N° facture', issue: 'Date facture', due: 'Échéance', ttc: 'Total TTC', paid: 'Encaissé', credited: 'Avoirs', rest: 'Reste', days: 'Ancienneté (jours)', bucket: 'Tranche' };
    var esc = function (v) {
      var s = String(v === null || v === undefined ? '' : v);
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var num = function (n) { return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2); };
    var lines = [[L.client, L.number, L.issue, L.due, L.ttc, L.paid, L.credited, L.rest, L.days, L.bucket]];
    (rowsObj.rows || []).forEach(function (r) {
      lines.push([r.clientName, r.number || 'Brouillon', r.issueDate, r.dueDate, num(r.totalTTC), num(r.paid), num(r.credited), num(r.rest), r.days, labelFr(r.bucket)]);
    });
    return '\uFEFF' + lines.map(function (r) { return r.map(esc).join(';'); }).join('\r\n');
  }

  /* ---------- Achats fournisseurs (balance âgée « dettes ») ----------
     Même règle que pour les clients, appliquée aux achats/dépenses :
     reste dû = montant TTC − règlements. L'ancienneté se mesure depuis la date
     d'achat (une dépense n'a pas d'échéance propre). */

  /* Somme des règlements d'un achat (repli sur l'ancien drapeau « paid »). */
  function expensePaid(e) {
    var recs = Array.isArray(e && e.payments) ? e.payments : [];
    if (recs.length) {
      var s = 0;
      for (var i = 0; i < recs.length; i++) s += Number(recs[i].amount) || 0;
      return round2(s);
    }
    return e && e.paid ? round2(Number(e.amountTTC) || 0) : 0;
  }

  function expenseRows(expenses, opts) {
    opts = opts || {};
    var ref = todayISO(opts.ref);
    var out = [];
    var list = expenses || [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var ttc = round2(Number(e.amountTTC) || 0);
      var paid = expensePaid(e);
      var rest = round2(ttc - paid);
      if (rest <= 0) continue;
      var due = e.dueDate || e.date || '';
      var days = ageDays(due, e.date, ref);
      out.push({
        id: e.id,
        supplierId: e.supplierId || '',
        supplierName: e.supplier || '',
        label: e.label || '',
        date: e.date || '',
        totalTTC: ttc,
        paid: paid,
        rest: rest,
        days: days,
        bucket: bucketId(due, days, ref)
      });
    }
    out.sort(function (a, b) {
      var c = String(a.supplierName).localeCompare(String(b.supplierName));
      if (c !== 0) return c;
      return b.days - a.days;
    });
    var totals = { rest: 0, paid: 0, totalTTC: 0 };
    var buckets = { 'notdue': 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (var j = 0; j < out.length; j++) {
      totals.rest = round2(totals.rest + out[j].rest);
      totals.paid = round2(totals.paid + out[j].paid);
      totals.totalTTC = round2(totals.totalTTC + out[j].totalTTC);
      buckets[out[j].bucket] = round2((buckets[out[j].bucket] || 0) + out[j].rest);
    }
    return { ref: ref, rows: out, totals: totals, buckets: buckets, n: out.length };
  }

  /* CSV de la balance fournisseurs (mêmes conventions : « ; », BOM UTF-8). */
  function expenseCsv(built, labels) {
    var L = labels || {};
    var esc = function (v) {
      var s = String(v === null || v === undefined ? '' : v);
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var num = function (n) { return (Number(n) || 0).toFixed(2); };
    var lines = [[L.supplier, L.label, L.date, L.ttc, L.paid, L.rest, L.days, L.bucket]];
    (built.rows || []).forEach(function (r) {
      lines.push([r.supplierName, r.label || '', r.date || '', num(r.totalTTC), num(r.paid), num(r.rest), r.days, labelFr(r.bucket)]);
    });
    return '\uFEFF' + lines.map(function (r) { return r.map(esc).join(';'); }).join('\r\n');
  }

  return {
    todayISO: todayISO,
    docTotals: docTotals,
    paidTotal: paidTotal,
    creditedTotal: creditedTotal,
    ageDays: ageDays,
    BUCKETS: BUCKETS,
    bucketId: bucketId,
    labelFr: labelFr,
    labelAr: labelAr,
    rows: rows,
    csv: csv,
    expensePaid: expensePaid,
    expenseRows: expenseRows,
    expenseCsv: expenseCsv
  };
});
