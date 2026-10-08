'use strict';

/* Montants en toutes lettres — français (Dirham marocain) et arabe.
   Ex. : WORDS.fr(1200.5) → « mille deux cents dirhams et cinquante centimes »
         WORDS.ar(1200.5) → « ألف مائتان درهم وخمسون سنتيماً »            */

const WORDS = (() => {

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  /* ---------------- Français ---------------- */

  const FR_SMALL = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const FR_TENS = ['vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

  function fr100(n) { // 0..99
    if (n < 20) return FR_SMALL[n];
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (t <= 6) { // 20..69 : vingt, trente, quarante, cinquante, soixante (pas de « s » final)
      const base = FR_TENS[t - 2];
      if (u === 0) return base;
      return base + (u === 1 ? '-et-un' : '-' + FR_SMALL[u]);
    }
    if (t === 7) { // 70..79
      if (u === 0) return 'soixante-dix';
      if (u === 1) return 'soixante-et-onze';
      return 'soixante-' + FR_SMALL[10 + u];
    }
    if (t === 8) { // 80..89
      if (u === 0) return 'quatre-vingts';
      return 'quatre-vingt' + (u === 1 ? '-un' : '-' + FR_SMALL[u]);
    }
    // 90..99
    if (u === 0) return 'quatre-vingt-dix';
    return 'quatre-vingt-' + FR_SMALL[10 + u];
  }

  const FR_HUND = ['', 'cent', 'deux cent', 'trois cent', 'quatre cent', 'cinq cent',
    'six cent', 'sept cent', 'huit cent', 'neuf cent'];

  function frInt(n) {
    n = Math.floor(Math.abs(n));
    if (n < 100) return fr100(n);
    if (n < 1000) {
      const c = Math.floor(n / 100);
      const r = n % 100;
      if (r === 0) return FR_HUND[c] + (c > 1 ? 's' : '');
      return FR_HUND[c] + ' ' + fr100(r);
    }
    if (n < 1000000) {
      const th = Math.floor(n / 1000);
      const r = n % 1000;
      const head = th === 1 ? 'mille' : frInt(th) + ' mille';
      return r ? head + ' ' + frInt(r) : head;
    }
    if (n < 1000000000) {
      const mi = Math.floor(n / 1000000);
      const r = n % 1000000;
      const head = mi === 1 ? 'un million' : frInt(mi) + ' millions';
      return r ? head + ' ' + frInt(r) : head;
    }
    return String(n);
  }

  /* 1200.5 → « mille deux cents dirhams et cinquante centimes » */
  function fr(n) {
    const v = Math.abs(round2(Number(n) || 0));
    const dirh = Math.floor(v);
    const cents = Math.round((v - dirh) * 100);
    let s = frInt(dirh) + (dirh <= 1 ? ' dirham' : ' dirhams');
    if (cents > 0) s += ' et ' + fr100(cents) + (cents === 1 ? ' centime' : ' centimes');
    return s;
  }

  /* ---------------- Arabe ---------------- */

  const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
    'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const AR_TENS = ['عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const AR_HUND = ['مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة',
    'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function arUnits(n) { // 0..99
    if (n < 10) return AR_ONES[n];
    if (n < 20) return AR_TEENS[n - 10];
    const t = Math.floor(n / 10); // 2..9 → index 0..7
    const u = n % 10;
    return u ? AR_ONES[u] + ' و' + AR_TENS[t - 2] : AR_TENS[t - 2];
  }

  function arGroup(n) { // 0..999
    const h = Math.floor(n / 100);
    const r = n % 100;
    const head = h ? (h === 1 ? 'مائة' : AR_HUND[h - 1]) : '';
    if (!r) return head;
    return head ? head + ' و' + arUnits(r) : arUnits(r);
  }

  /* Accord du nom compté : 1 / 2 / 3-10 / 11+ */
  function arCount(v, one, two, few, many) {
    if (v === 1) return one;
    if (v === 2) return two;
    if (v <= 10) return arInt(v) + ' ' + few;
    return arInt(v) + ' ' + many;
  }

  function arInt(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'صفر';
    const parts = [];
    const mi = Math.floor(n / 1000000);
    const th = Math.floor((n % 1000000) / 1000);
    const un = n % 1000;
    if (mi) parts.push(arCount(mi, 'مليون', 'مليونان', 'ملايين', 'مليوناً'));
    if (th) parts.push(arCount(th, 'ألف', 'ألفان', 'آلاف', 'ألفاً'));
    if (un) parts.push(arGroup(un));
    return parts.join(' و');
  }

  function ar(n) {
    const v = Math.abs(round2(Number(n) || 0));
    const dirh = Math.floor(v);
    const cents = Math.round((v - dirh) * 100);

    let s;
    if (dirh === 0) s = 'صفر درهم';
    else if (dirh === 1) s = 'درهم واحد';
    else if (dirh === 2) s = 'درهمان';
    else if (dirh <= 10) s = arInt(dirh) + ' دراهم';
    else s = arInt(dirh) + ' درهماً';

    if (cents > 0) {
      let c;
      if (cents === 1) c = 'سنتيم واحد';
      else if (cents === 2) c = 'سنتيمان';
      else if (cents <= 10) c = arInt(cents) + ' سنتيمات';
      else c = arInt(cents) + ' سنتيماً';
      s += ' و' + c;
    }
    return s;
  }

  return { fr, ar, frInt, arInt };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WORDS;
