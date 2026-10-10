# Plan — Avoirs, balance âgée, achats & dépenses

Statut : **en cours de réalisation** (v1.24 → v1.27).
Principes : tout est **hors ligne**, **bilingue FR/AR à parité testée**, les données
restent des collections JSON avec **migrations de schéma**, et le **rendu des
documents reste un moteur unique** (`print-doc.js`).

---

## 1. Objectifs et périmètre

| Version | Livrable | Schéma |
|---|---|---|
| **v1.24** | **Avoir / note de crédit** (collection `creditNotes`, numérotation `AV-AAAA-NNNN`, PDF, impact TVA/reste dû) | v3 |
| **v1.25** | **Balance âgée clients** in-app (module d'ancienneté partagé, vue + export/impression) | — |
| **v1.26** | **Achats & dépenses** (collection `expenses`, catégories, fournisseurs, TVA déductible, **import des débits du relevé**) | v4 |

Hors périmètre immédiat (plus tard) : factures fournisseurs avec lignes &
échéances + balance âgée fournisseurs, rapprochement des débits, déclaration TVA
`collectée − déductible`, e-facture DGI.

---

## 2. Modèle de données

### `creditNotes` (avoir) — v1.24
```
{
  id, status: 'draft'|'validated', number: 'AV-AAAA-NNNN'|null,
  clientId, clientName,
  issueDate, refInvoiceId, refNumber, reason,   // motif de l'avoir
  lines: [{ desc, qty, price, tva }],
  notes, seq, seqYear,
  createdAt, validatedAt, accountedAt?, accountedPeriod?
}
```
- Numérotation **contiguë** : `meta.creditSeq` + préfixe `settings.creditPrefix` (`AV`).
- Garde-fous identiques aux factures : suppression de la **dernière** seulement,
  blocage si **comptabilisé**, rembobinage du compteur à la suppression.
- Un avoir est **toujours rattaché à une facture d'origine** (`refInvoiceId`).
- Impact : **reste dû client** diminué, **TVA collectée** diminuée (mois de l'avoir),
  journal de ventes en lignes négatives.

### `expenses` (achats & dépenses) — v1.26
```
{
  id, date, label, category, supplier, supplierId?,
  amountTTC, tvaRate, amountHT,             // HT dérivé du TTC et du taux
  method, reference, note,
  source: 'import'|'manual', sourceKey,     // dédoublonnage à l'import
  createdAt
}
```
- `settings.expenseCategories` : catégories proposées (liste éditable, comme les
  désignations).
- `settings.suppliers` / collection `suppliers` : fournisseurs nommés (nom, ICE/IF,
  coordonnées).
- À l'import du relevé : les **débits** dans la période deviennent des dépenses
  (`source:'import'`), **dédoublonnées** via `sourceKey` (date|montant|libellé).

---

## 3. Décisions retenues (recommandations)

1. **Avoir = collection dédiée** (pas `invoices.type='credit'`) : n'endommage pas
   la numérotation / l'ancienneté / la comptabilisation des factures.
2. **Avoir toujours lié à une facture** validée.
3. **Achats & dépenses = une seule collection `expenses`** (une dépense peut porter
   un fournisseur et un taux de TVA), pour éviter la duplication d'éditeur/export.
4. **TVA déductible** portée par la dépense (taux par dépense, `0 %` par défaut à
   l'import — l'utilisateur ajuste).
5. **Balance âgée = clients** (créances) ; les fournisseurs (dettes) viendront plus tard.
6. Termes arabes : avoir = **إشعار دائن**, achats = **المشتريات**, dépenses =
   **المصاريف**, fournisseur = **المورد** (à valider).

---

## 4. Découpage détaillé

### v1.24 — Avoir / note de crédit
- `store.js` : collection `creditNotes`, `meta.creditSeq`, `settings.creditPrefix`,
  migration **v2 → v3**.
- `backup.js` : ajout de `creditNotes` à la sauvegarde/restauration.
- Moteur documents : `DOC_KIND='credit'` → titre **AVOIR / إشعار دائن**, mention
  « Annule et remplace partiellement la facture N° … », pas de tampon « Payée ».
  `print-credit.html` + `print-credit.js` + `doc-config.js` + `main.js`
  (`credit:preview`, `credit:export-pdf`) + `preload.js`.
- UI : vue **Avoirs** (liste, filtres), bouton **Créer un avoir** depuis une
  facture validée, éditeur dédié (client, date, motif, lignes, notes).
- Impact : `renderAll`, `collectStats`, journal de ventes de l'export comptable.

### v1.25 — Balance âgée clients
- Module **UMD partagé** `src/renderer/aging.js` (`window.AGING` + `module.exports`)
  : `ageDays(date, ref)`, `bucket(days)`, `buildRows(invoices, credits, opts)`.
  Source **unique** utilisée par la vue **et** par `export-pack.js`.
- Vue « Balance âgée » : KPI (total dû / échu / +90 j), tableau par facture
  (client, n°, dates, ancienneté, tranche, TTC, encaissé, reste), filtres, tri,
  **export CSV / impression**.
- Les avoirs entrent en déduction du reste dû.

### v1.26 — Achats & dépenses (avec import de relevé)
- `store.js` : collection `expenses`, `settings.expenseCategories`,
  `settings.suppliers`, migration **v3 → v4**.
- Vue « Achats & dépenses » : KPI (total, TVA déductible), filtres (période,
  catégorie, fournisseur), éditeur (date, libellé, catégorie, fournisseur, montant
  TTC, taux de TVA, mode, référence, note).
- **Import** : les débits de la période sont listés, sélectionnables, puis créés
  comme dépenses ; dédoublonnage par `sourceKey`. Le hint « les débits sont
  écartés » est remplacé.
- Impact export comptable : journal des achats/dépenses + TVA déductible.

---

## 5. Impacts transverses

- `store.js` **et** `backup.js` ont chacun leur liste de collections → mettre à jour les deux.
- `i18n.js` : clés FR **et** AR (parité vérifiée par `test/unit/i18n.test.js`).
- `index.html` : nouvel élément de navigation + sections (les `data-i18n` doivent
  exister dans les deux dictionnaires).
- `test/smoke.js` : stubs de collections + phases de test ; `test:unit` : migrations.
- `README.md` + `package.json` (bump) ; commit + tag `vX.Y.0` par version.
- Le look `classic` des documents reste le défaut (aucune régression).

---

## 6. Ordre et dépendances

`v1.24 Avoir` → `v1.25 Balance âgée` (intègre les avoirs) → `v1.26 Achats & dépenses`
→ **v1.27 Fournisseurs & paiements fournisseurs**.

### v1.27 — Fournisseurs & paiements fournisseurs
Décisions validées : **règlements par achat** (comme les factures clients) et
**écran « Fournisseurs » séparé** (comme « Clients »).

- `store.js` : collection **`suppliers`** (nom, contact, ICE/IF, adresse),
  normalisation de `expenses` (`payments: []`, `supplierId`), migration **v4 → v5**.
- `backup.js` : ajout de `suppliers` à la sauvegarde/restauration.
- **Modèle dépense étendu** : `supplierId` (référence optionnelle à un fournisseur),
  `payments: [{id, date, amount, method, reference, note}]`. Reste à payer =
  `amountTTC − Σ règlements`. Une dépense importée d'un débit de relevé est **réglée
  d'office** (un règlement = montant TTC) ; une dépense saisie est « à payer » par
  défaut (sauf case « déjà payée »).
- **Vue « Fournisseurs »** : créer / modifier / supprimer un fournisseur (nom,
  contact, ICE/IF, coordonnées), total achats et **reste à payer** par fournisseur.
  La suppression d'un fournisseur référencé par des dépenses les détache
  (`supplierId = null`) sans supprimer les dépenses.
- **Paiements fournisseurs** : dans « Achats & dépenses », bouton **Régler** par
  achat (acomptes/partiels, historique, modification/suppression), colonnes
  **Payé** / **Reste**, indicateurs **Total payé** et **Reste à payer (dettes)`.
  Modèle identique aux règlements de factures clients.
- L'éditeur de dépense choisit le **fournisseur dans la liste** (bouton « + nouveau
  fournisseur » sur place).
- `store.js` schéma **v5**, migration **v4 → v5**.

## 7. Suite (v1.27)

`v1.27 Fournisseurs & paiements fournisseurs` : collection `suppliers` (schéma v5),
écran Fournisseurs, rattachement dépense → fournisseur, règlements par achat
(reste à payer), KPI dédiés, aide bilingue, tests.
