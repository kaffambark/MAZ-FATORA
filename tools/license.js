#!/usr/bin/env node
'use strict';

/* MAZ-FATORA — Console du vendeur : clés de licence signées (anti-contrefaçon).

   Usage :
     node tools/license.js init                    → crée la paire de clés
     node tools/license.js issue "Nom du client" --max 1   → émet une clé
     node tools/license.js verify MAZF-xxxx.xxx    → contrôle une clé
     node tools/license.js status                  → état de la paire

   Le fichier .license-keys.json contient la CLÉ PRIVÉE : il doit rester chez
   vous (jamais dans l'application distribuée). */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require(path.join(__dirname, '..', 'src', 'main', 'license.js'));

const KEYS_FILE = path.join(__dirname, '.license-keys.json');
const PUB_FILE = path.join(__dirname, '..', 'src', 'main', 'license-pub.json');

function loadKeys() {
  try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); }
  catch (e) {
    console.error('Aucune paire de clés : lancez d’abord  node tools/license.js init');
    process.exit(1);
  }
}
function emprunte(pem) {
  return crypto.createHash('sha256').update(pem).digest('hex').slice(0, 16);
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'init') {
  const pair = L.genKeyPair();
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(pair, null, 2));
  fs.writeFileSync(PUB_FILE, JSON.stringify({ publicPem: pair.publicPem, note: 'Clé publique embarquée dans l’application. Ne jamais y mettre la clé privée.' }, null, 2));
  console.log('Paire de clés créée.');
  console.log('  Clé PRIVÉE   : ' + KEYS_FILE + '   (à garder précieusement, jamais distribuée)');
  console.log('  Clé PUBLIQUE : ' + PUB_FILE + '   (embarquée dans l’application)');
  console.log('  Empreinte clé publique : ' + emprunte(pair.publicPem));
} else if (cmd === 'issue') {
  const keys = loadKeys();
  const customer = String(rest[0] || '').trim();
  const mi = rest.indexOf('--max');
  const max = mi >= 0 ? parseInt(rest[mi + 1], 10) : 1;
  if (!customer) { console.error('Nom du client manquant :  node tools/license.js issue "Nom du client" --max 1'); process.exit(1); }
  if (!(max >= L.MIN_MAX && max <= L.MAX_MAX)) { console.error('--max doit être entre ' + L.MIN_MAX + ' et ' + L.MAX_MAX + ' postes.'); process.exit(1); }
  const payload = { c: customer, m: max, i: new Date().toISOString().slice(0, 10) };
  const key = L.issueKey(payload, keys.privatePem);
  console.log('');
  console.log('Client : ' + customer);
  console.log('Postes : ' + max);
  console.log('Clé    : ' + key);
  console.log('');
} else if (cmd === 'verify') {
  const keys = loadKeys();
  const out = L.verifyKey(rest[0] || '', keys.publicPem);
  if (out) {
    console.log('Clé valide ✔  ' + out.customer + ' — ' + out.maxDevices + ' poste(s), émise le ' + out.issued);
  } else {
    console.error('Clé invalide ou signature refusée ✘');
    process.exit(1);
  }
} else if (cmd === 'status') {
  if (!fs.existsSync(KEYS_FILE)) {
    console.log('Aucune paire — lancez :  node tools/license.js init');
  } else {
    const k = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    console.log('Paire de clés présente ✔');
    console.log('  Empreinte clé publique : ' + emprunte(k.publicPem));
  }
} else {
  console.log('Usage :  node tools/license.js <init|issue|verify|status>');
  console.log('Ex.    :  node tools/license.js issue "SARL Dupont" --max 2');
  process.exit(cmd ? 1 : 0);
}