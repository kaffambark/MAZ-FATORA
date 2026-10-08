'use strict';

/* MAZ-FATORA — Licence d'utilisation signée (anti-contrefaçon).
   Le vendeur génère une clé de licence par client (script tools/license.js,
   clé PRIVÉE jamais distribuée). L'application ne contient que la CLÉ PUBLIQUE
   et vérifie la signature : une clé forgée ne peut pas passer. La clé est de
   plus LIÉE AUX POSTES : elle n'autorise qu'un nombre maximal de machines
   (empreinte matérielle), ensuite toute nouvelle machine est refusée.

   Format d'une clé :    MAZF-<base64url(payload)>.<base64url(signature)>
   payload (JSON) :      { "c": "client", "m": postes max (1..10), "i": "émission" }

   La vérification se fait dans le PROCESS PRINCIPAL (l'écran d'enregistrement
   côté renderer n'a accès qu'à license:status / license:register). */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PREFIX = 'MAZF-';
const MIN_MAX = 1;
const MAX_MAX = 10;

/* Clé publique embarquée par défaut. tools/license.js (init) peut la remplacer :
   il écrit src/main/license-pub.json, qui a PRIORITÉ sur cette constante. */
const DEFAULT_PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVTcbq0lHEqGzmxADXhOo9DjI7aI5KCs4f6fUoyY2cpg=
-----END PUBLIC KEY-----
`;

/* Nouvelle paire ed25519 (utilisée par tools/license.js et par les tests). */
function genKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

/* Clé publique de vérification : le fichier license-pub.json s'il existe
   (généré par le vendeur), sinon la constante embarquée. */
function readPublicPem() {
  try {
    const p = path.join(__dirname, 'license-pub.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j && j.publicPem) return j.publicPem;
  } catch (e) { /* clé par défaut ci-dessous */ }
  return DEFAULT_PUB_PEM;
}

/* Fabrique une clé de licence (côté vendeur / tests uniquement). */
function issueKey(payload, privatePem) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, crypto.createPrivateKey(privatePem)).toString('base64url');
  return KEY_PREFIX + body.toString('base64url') + '.' + sig;
}

/* Vérifie la signature d'une clé et renvoie le payload, ou null. */
function verifyKey(key, publicPem) {
  if (typeof key !== 'string') return null;
  const k = key.trim();
  if (!k.startsWith(KEY_PREFIX)) return null;
  const rest = k.slice(KEY_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(rest.slice(0, dot), 'base64url').toString('utf8'));
  } catch (e) { return null; }
  if (!payload || typeof payload.c !== 'string' || !payload.c.trim() ||
      !Number.isInteger(payload.m) || payload.m < MIN_MAX || payload.m > MAX_MAX) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(JSON.stringify(payload), 'utf8'),
      crypto.createPublicKey(publicPem), Buffer.from(rest.slice(dot + 1), 'base64url'));
    if (!ok) return null;
    return {
      customer: payload.c.trim(),
      maxDevices: payload.m,
      issued: (payload.i && typeof payload.i === 'string') ? payload.i : ''
    };
  } catch (e) { return null; }
}

module.exports = {
  KEY_PREFIX, MIN_MAX, MAX_MAX, DEFAULT_PUB_PEM,
  genKeyPair, readPublicPem, issueKey, verifyKey
};