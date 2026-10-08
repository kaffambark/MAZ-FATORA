'use strict';

/* MAZ-FATORA — Sécurité de niveau 1 + 2 (version MONOPOSTE).
   Niveau 1 : un mot de passe (hash scrypt + sel, jamais en clair) verrouille
             l'application au démarrage ; anti force-brute ; mot de passe oublié
             = réinitialisation contrôlée (réponse à une question de sécurité).
   Niveau 2 : l'application n'est utilisable que sur le poste où la protection a
             été activée (empreinte matérielle). Sur tout autre poste, un écran
             « Poste non autorisé » bloque l'accès — il n'y a PAS de gestion
             multijoueur : la version est monoposte.

   Le fichier security.json vit dans <userData> (PAS dans le dossier de données,
   qui est déplaçable) : la protection va avec l'installation de l'application. */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { verifyKey, readPublicPem } = require('./license');

const MAX_ATTEMPTS = 5;             // échecs avant temporisation
const LOCK_MS = 5 * 60 * 1000;      // 5 minutes
const MIN_PASSWORD = 4;             // longueur minimale du mot de passe

/* ---- Empreinte matérielle (stable par poste) ---- */
function detectDeviceId() {
  if (process.env.MAZ_FATORA_DEVICE_ID) return process.env.MAZ_FATORA_DEVICE_ID;
  try {
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 4000 });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m && m[1]) return m[1];
    } else if (process.platform === 'win32') {
      const out = execSync('wmic csproduct get uuid', { encoding: 'utf8', timeout: 4000 });
      const v = String(out || '').split(/\r?\n/).map((s) => s.trim()).find((s) => /^[\w-]{8,}$/.test(s));
      if (v) return v;
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const v = fs.readFileSync(f, 'utf8').trim();
          if (v) return v;
        } catch (e) { /* essai suivant */ }
      }
    }
  } catch (e) { /* repli ci-dessous */ }
  return os.hostname() + '|' + process.platform + '|' + os.arch();
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* Code lisible affiché / saisi pour identifier un poste (12 caractères hex). */
function deviceCode(raw) {
  const h = String(raw || '').toUpperCase();
  if (!h) return '';
  const x = sha256(h).toUpperCase().slice(0, 12);
  return `${x.slice(0, 4)}-${x.slice(4, 8)}-${x.slice(8, 12)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^0-9A-F]/g, '');

/* ---- Hachage des secrets (scrypt) ---- */
function hashSecret(secret, salt) {
  return crypto.scryptSync(String(secret), String(salt), 64).toString('hex');
}
function makeVerifier(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashSecret(secret, salt) };
}
function verifyVerifier(secret, ver) {
  if (!ver || !ver.salt || !ver.hash) return false;
  try {
    const a = Buffer.from(hashSecret(secret, ver.salt), 'hex');
    const b = Buffer.from(ver.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}
function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= MIN_PASSWORD;
}

class Security {
  constructor(filePath, deviceId) {
    this.file = filePath;
    this.deviceId = deviceId || detectDeviceId();
    this.code = deviceCode(this.deviceId);
    this.record = this.load();
    this.unlocked = false; // session : déverrouillé après saisie correcte du mot de passe
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { return {}; }
  }
  save() {
    try {
      fs.mkdirSync(require('path').dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.record, null, 2), 'utf8');
    } catch (e) { console.error('Sécurité : écriture impossible :', e.message); }
  }

  /* Protection active ? (mot de passe créé et activé) */
  isProtected() { return !!(this.record && this.record.verifier && this.record.enabled); }
  isUnlocked() { return this.unlocked; }
  isLocked() { return !this.isProtected() ? false : !this.unlocked; }

  /* Poste autorisé ? Tant qu'aucun poste n'est enregistré, tout poste est autorisé
     (c'est le cas avant l'activation de la protection). */
  isAuthorized() {
    const devs = (this.record && Array.isArray(this.record.devices)) ? this.record.devices : [];
    if (!devs.length) return true;
    return devs.some((d) => d.code === this.code);
  }

  deviceInfo() {
    const devs = (this.record && Array.isArray(this.record.devices)) ? this.record.devices : [];
    return devs.find((d) => d.code === this.code) || null;
  }

  status() {
    const protectedApp = this.isProtected();
    const attempts = (this.record && this.record.attempts) || {};
    const now = Date.now();
    let lockRemainingMs = 0;
    if (protectedApp && attempts.lockedUntil && attempts.lockedUntil > now) {
      lockRemainingMs = attempts.lockedUntil - now;
    }
    const me = this.deviceInfo();
    return {
      configured: protectedApp,
      enabled: protectedApp,
      locked: this.isLocked(),
      authorized: this.isAuthorized(),
      recovery: protectedApp && !!(this.record.question && this.record.answerHash),
      question: protectedApp ? (this.record.question || '') : '',
      deviceId: this.deviceId,
      code: this.code,
      deviceName: (me && me.name) || '',
      owner: !!(me && me.owner),
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - (attempts.count || 0)),
      lockRemainingMs,
      devices: protectedApp
        ? ((this.record.devices || []).map((d) => ({
            code: d.code, name: d.name || '', owner: !!d.owner,
            current: d.code === this.code, addedAt: d.addedAt
          })))
        : []
    };
  }

  /* ---- Activation (première fois, ou réactivation après désactivation) ----
     La licence d'utilisation est CONSERVÉE : on ne réenregistre jamais une
     clé déjà validée sur ce poste. */
  setup(data) {
    if (this.isProtected()) return { error: 'already' };
    if (!data || !validPassword(data.password)) return { error: 'weak' };
    const question = String(data.question || '').trim();
    const licence = this.record.license;
    this.record = {
      enabled: true,
      verifier: makeVerifier(data.password),
      question,
      answerHash: question && data.answer ? makeVerifier(data.answer) : null,
      devices: [{ code: this.code, name: 'poste principal', owner: true, addedAt: new Date().toISOString() }],
      attempts: { count: 0 }
    };
    if (licence) this.record.license = licence;
    this.save();
    this.unlocked = true;
    return { ok: true };
  }

  /* ---- Déverrouillage (avec anti force-brute) ---- */
  unlock(password) {
    if (!this.isProtected()) return { ok: true };
    const attempts = (this.record.attempts || {});
    const now = Date.now();
    if (attempts.lockedUntil && attempts.lockedUntil > now) {
      return { ok: false, code: 'locked', lockRemainingMs: attempts.lockedUntil - now };
    }
    if (verifyVerifier(password, this.record.verifier)) {
      this.record.attempts = { count: 0 };
      this.save();
      this.unlocked = true;
      return { ok: true };
    }
    const count = (attempts.count || 0) + 1;
    const attemptsLeft = MAX_ATTEMPTS - count;
    let lockedUntil = 0;
    if (attemptsLeft <= 0) lockedUntil = now + LOCK_MS;
    this.record.attempts = { count, lockedUntil: lockedUntil || 0 };
    this.save();
    return {
      ok: false,
      code: 'bad',
      attemptsLeft: Math.max(0, attemptsLeft),
      lockRemainingMs: lockedUntil ? lockedUntil - now : 0
    };
  }

  lockSession() { this.unlocked = false; return { ok: true }; }

  /* ---- Mot de passe oublié : réponse à la question de sécurité requise ---- */
  resetPassword(data) {
    if (!this.isProtected()) return { error: 'none' };
    if (!data || !validPassword(data.newPassword)) return { error: 'weak' };
    if (!this.record.answerHash || !verifyVerifier(data.answer, this.record.answerHash)) {
      return { error: 'answer' };
    }
    this.record.verifier = makeVerifier(data.newPassword);
    this.record.attempts = { count: 0 };
    this.save();
    this.unlocked = true;
    return { ok: true };
  }

  /* ---- Changement de mot de passe (mot de passe actuel requis) ---- */
  changePassword(data) {
    if (!this.isProtected()) return { error: 'none' };
    if (!data || !verifyVerifier(data.currentPassword, this.record.verifier)) return { error: 'bad' };
    if (!validPassword(data.newPassword)) return { error: 'weak' };
    const question = String(data.question || '').trim();
    this.record.verifier = makeVerifier(data.newPassword);
    if (data.question !== undefined) {
      this.record.question = question;
      this.record.answerHash = (question && data.answer) ? makeVerifier(data.answer) : null;
    }
    this.save();
    return { ok: true };
  }

  /* ---- Désactivation complète (mot de passe actuel requis) ----
     La licence reste active : le client a payé pour l'application. */
  disable(password) {
    if (!this.isProtected()) return { error: 'none' };
    if (!verifyVerifier(password, this.record.verifier)) return { error: 'bad' };
    const licence = this.record.license;
    this.record = licence ? { license: licence } : {};
    this.save();
    this.unlocked = true;
    return { ok: true };
  }

  /* ---- Licence d'utilisation (clé signée fournie par le vendeur) ---- */

  /* Ce poste est-il autorisé par la licence ? */
  licenseActive() {
    const lic = this.record && this.record.license;
    return !!(lic && Array.isArray(lic.devices) && lic.devices.includes(this.code));
  }

  licenseStatus() {
    const lic = this.record && this.record.license;
    if (!lic) return { active: false, configured: false };
    const bound = Array.isArray(lic.devices) ? lic.devices : [];
    return {
      active: bound.includes(this.code),
      configured: true,
      customer: lic.customer || '',
      maxDevices: lic.maxDevices || 1,
      bound: bound.length,
      currentBound: bound.includes(this.code),
      code: this.code
    };
  }

  /* Le poste courant est inscrit dans les postes autorisés (Niveau 2) :
     un poste lié à la licence est toujours autorisé. */
  ensureDeviceListed() {
    const devs = (this.record.devices || (this.record.devices = []));
    if (!devs.some((d) => d.code === this.code)) {
      const hasOwner = devs.some((d) => d.owner);
      devs.push({
        code: this.code,
        name: 'poste lié à la licence',
        owner: !hasOwner,
        addedAt: new Date().toISOString()
      });
    }
  }

  /* Enregistre la clé de licence : vérifie la signature (clé publique), puis
     lie le poste courant si la licence n'a pas atteint son nombre max de postes. */
  registerLicense(key) {
    const payload = verifyKey(key, readPublicPem());
    if (!payload) return { error: 'invalid' };
    let lic = this.record.license;
    if (!lic) {
      lic = this.record.license = {
        key: String(key).trim(),
        customer: payload.customer,
        maxDevices: payload.maxDevices,
        devices: [],
        activated: new Date().toISOString()
      };
    }
    const bound = lic.devices || (lic.devices = []);
    if (bound.includes(this.code)) {
      this.ensureDeviceListed();
      this.save();
      return { ok: true, already: true, customer: lic.customer, maxDevices: lic.maxDevices, bound: bound.length };
    }
    if (bound.length >= (lic.maxDevices || 1)) return { error: 'slots', maxDevices: lic.maxDevices };
    bound.push(this.code);
    lic.customer = payload.customer;
    lic.maxDevices = payload.maxDevices;
    this.ensureDeviceListed();
    this.save();
    return { ok: true, customer: lic.customer, maxDevices: lic.maxDevices, bound: bound.length };
  }
}

module.exports = { Security, detectDeviceId, deviceCode, normCode, validPassword };