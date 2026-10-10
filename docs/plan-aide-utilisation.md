# MAZ-FATORA — Plan d'aide à l'utilisation

> **Statut** : plan éditorial validé (P0) — prêt pour implémentation
> **Public cible** : utilisateur **débutant non technique**
> **Langues** : français + arabe (RTL), parité obligatoire
> **Contraintes** : 100 % hors ligne, aucune ressource réseau (CSP `default-src 'self'`)
> **Portée** : texte + captures + quelques tutoriels vidéo courts (embarqués)

---

## 1. Objectifs

1. Permettre à un débutant de **démarrer sans accompagnement** : installer, configurer la société, établir sa première facture.
2. Répondre **au moment du besoin** : aide contextuelle sur chaque écran (bouton `?` / `F1`).
3. Réduire le support répétitif : FAQ des 15 questions réelles les plus posées.
4. Fournir un **guide imprimable** (PDF) pour la formation et l'archivage.
5. Rester **bilingue FR/AR** et **hors ligne**, comme le reste de l'application.

### Indicateurs de succès
- Un nouvel utilisateur réalise sa 1ʳᵉ facture validée **sans aide externe**.
- Chaque écran dispose d'un article et d'une aide contextuelle.
- 0 clé d'aide manquante en AR (test automatique).
- Temps de recherche d'une réponse < 30 s (recherche plein texte).

---

## 2. Principes & charte éditoriale

| Principe | Règle |
|---|---|
| **Orientation tâche** | 1 article = 1 tâche concrète (« Créer une facture »), pas un manuel théorique |
| **Ton** | Neutre, tutoiement, phrases courtes, pas de jargon non expliqué |
| **Structure d'article** | Objectif → Prérequis → Étapes numérotées → Astuces → Erreurs fréquentes → Voir aussi |
| **Débutant** | Chaque étape = une action ; on nomme **exactement** le bouton/menu à cliquer |
| **Captures** | 1 capture par étape clé, zonage visuel (encadré rouge) sur l'élément à cliquer |
| **Langue** | Rédaction FR puis AR, jamais l'un sans l'autre (parité) |
| **Non intrusif** | L'aide ne bloque jamais l'action ; elle s'ouvre à la demande (ou 1 seule fois à l'onboarding) |
| **Accessibilité** | Navigation clavier, focus piégé, `aria-*`, RTL correct, contraste AA |

### Convention de nommage des identifiants
`<domaine>.<sujet>` — ex. `screen.invoices`, `task.new-invoice`, `faq.tva`, `gloss.ice`.

---

## 3. Architecture de l'aide

### 3.1 Accès
- Bouton **`?`** en haut à droite de chaque écran → ouvre l'article **de l'écran courant**.
- Raccourci **`F1`** → même comportement.
- Entrée **« Aide »** dans le pied de la barre latérale → ouvre le **Centre d'aide** (sommaire + recherche).
- Liens « Voir aussi » internes entre articles.

### 3.2 Composants
| Composant | Description |
|---|---|
| **Centre d'aide** (modale plein écran légère) | Sommaire à gauche, article à droite, champ de recherche en haut |
| **Aide contextuelle** | Ouvre le Centre d'aide sur l'article de l'écran courant (`screen.*`) |
| **Parcours d'accueil** (onboarding) | Séquences de bulles à la 1ʳᵉ ouverture (voir §9) |
| **Infobulles enrichies** | Système homogène de micro-copie (déjà ~27 `hint` à uniformiser) |

### 3.3 Correspondance écran → article
| Écran (`data-view`) | Article contextuel |
|---|---|
| `dashboard` | `screen.dashboard` |
| `import` | `screen.import` |
| `transactions` | `screen.transactions` |
| `drafts` | `screen.drafts` |
| `invoices` | `screen.invoices` |
| `quotes` | `screen.quotes` |
| `payments` | `screen.payments` |
| `clients` | `screen.clients` |
| `rules` | `screen.rules` |
| `settings` | `screen.settings` |

---

## 4. Modèle de données du contenu

Fichier unique `src/renderer/help-content.js` (sur le modèle de `doc-config.js`), exportant `window.HELP`.

```js
window.HELP = {
  version: '1.0',
  categories: [
    { id: 'start',   title: { fr: 'Démarrage',              ar: 'البدء' }, icon: 'i-dash' },
    { id: 'screen',  title: { fr: 'Écrans de l’application', ar: 'شاشات التطبيق' }, icon: 'i-invoices' },
    { id: 'tasks',   title: { fr: 'Tâches courantes',        ar: 'المهام الشائعة' }, icon: 'i-check' },
    { id: 'faq',     title: { fr: 'Questions fréquentes',    ar: 'الأسئلة الشائعة' }, icon: 'i-help' },
    { id: 'gloss',   title: { fr: 'Glossaire',               ar: 'المعجم' }, icon: 'i-book' }
  ],
  articles: {
    'task.new-invoice': {
      category: 'tasks',
      screen: 'invoices',          // écran d'ancrage (aide contextuelle)
      priority: 1,                  // 1 = P1 (MVP), 2 = P2
      title: { fr: 'Créer une facture', ar: 'إنشاء فاتورة' },
      goal:  { fr: 'Établir et valider une facture pour un client.', ar: '...' },
      prereq:{ fr: ['Avoir configuré la société', 'Avoir créé le client'], ar: ['...'] },
      steps: {
        fr: ['Cliquez sur « Factures validées ».', 'Cliquez sur « Nouvelle facture ».', '...'],
        ar: ['...']
      },
      tips:  { fr: ['...'], ar: ['...'] },
      errors:{ fr: ['La numérotation est figée dès la 1ʳᵉ facture.'], ar: ['...'] },
      media: { shots: ['task.new-invoice-1.png'], video: 'vid.new-invoice' },
      related: ['screen.invoices', 'task.payment', 'task.doc-model']
    }
    /* ... */
  }
};
```

**Règles de validation (test unitaire)** :
- `id` unique ; `title`, `goal`, `steps` présents en **fr ET ar** ; `steps` non vide ;
- `screen` valide (parmi les 10 vues) ; `category` existante ;
- tout `related` pointe vers un `id` connu ; tout `media.video` existe ;
- parité stricte : aucune clé manquante d'un côté.

---

## 5. Inventaire éditorial

Légende priorité : **P1** = MVP (Centre d'aide), **P2** = enrichissement.
Audience : **D** = débutant (rédaction détaillée), toujours le public cible ici.

### 5.1 Catégorie « Démarrage » (`start`)

| id | Titre FR | Titre AR | Pri. | Vidéo |
|---|---|---|---|---|
| `start.welcome` | Premier lancement : bien démarrer | أول تشغيل: ابدأ بشكل صحيح | P1 | `vid.start` |
| `start.company` | Configurer ma société et mes mentions légales (ICE/IF/RC/CNSS/TVA) | إعداد الشركة والبيانات القانونية | P1 | `vid.company` |
| `start.language` | Changer la langue (français / arabe) | تغيير اللغة | P1 | — |
| `start.first-invoice` | Établir ma première facture de A à Z | إنشاء أول فاتورة من الألف إلى الياء | P1 | `vid.first-invoice` |
| `start.backup` | Sauvegarder et restaurer mes données | النسخ الاحتياطي والاستعادة | P1 | `vid.backup` |

**Fiche type — `start.company`**
- Objectif : renseigner nom, ICE, IF, RC, Patente, CNSS, TVA et RIB une seule fois ; ils apparaîtront sur tous les documents.
- Étapes : Paramètres → carte « Mon entreprise » → saisir les champs → choisir les identifiants affichés (§ `task.doc-model`) → Enregistrer.
- Astuce : l'avertissement signale si un identifiant renseigné est masqué (conformité).
- Erreur fréquente : confondre **thème de l'application** (clair/sombre) et **modèle du document** (couleurs du PDF).

### 5.2 Catégorie « Écrans » (`screen`) — 10 articles, priorité P1

| id | Titre FR | Titre AR | Écran |
|---|---|---|---|
| `screen.dashboard` | Le tableau de bord | لوحة القيادة | dashboard |
| `screen.import` | Importer un relevé bancaire | استيراد كشف حساب بنكي | import |
| `screen.transactions` | Les transactions | المعاملات | transactions |
| `screen.drafts` | Les factures à valider | الفواتير في انتظار التحقق | drafts |
| `screen.invoices` | Les factures validées | الفواتير المؤكدة | invoices |
| `screen.quotes` | Les devis | عروض الأسعار | quotes |
| `screen.payments` | Les paiements | المدفوعات | payments |
| `screen.clients` | Les clients | العملاء | clients |
| `screen.rules` | Les règles automatiques | القواعد التلقائية | rules |
| `screen.settings` | Les paramètres | الإعدادات | settings |

**Gabarit commun** : « À quoi ça sert » (1 phrase) · ce qu'on voit (colonnes/filtres) · 3 actions principales · astuces · où aller ensuite.

Exemple **`screen.drafts`**
- À quoi ça sert : transformer les mouvements bancaires détectés en factures à confirmer.
- Actions : vérifier la détection client/montant · corriger si besoin · valider (ouverture de la facture) · ignorer un faux positif.
- Astuce : une facture validée passe en « Factures validées » et reçoit un numéro définitif.

### 5.3 Catégorie « Tâches » (`tasks`)

| id | Titre FR | Titre AR | Pri. | Vidéo |
|---|---|---|---|---|
| `task.new-invoice` | Créer une facture | إنشاء فاتورة | P1 | `vid.new-invoice` |
| `task.new-quote` | Créer un devis | إنشاء عرض سعر | P1 | `vid.quote` |
| `task.quote-to-invoice` | Convertir un devis en facture | تحويل عرض سعر إلى فاتورة | P1 | `vid.quote` |
| `task.payment` | Enregistrer un paiement | تسجيل دفعة | P1 | `vid.payment` |
| `task.amount-words` | Afficher le montant en toutes lettres | كتابة المبلغ بالحروف | P2 | — |
| `task.doc-model` | Personnaliser le modèle des documents (PDF) | تخصيص نموذج الوثائق | P1 | `vid.doc-model` |
| `task.legal-ids` | Choisir les identifiants légaux affichés | اختيار المعرّفات القانونية | P1 | — |
| `task.rules` | Automatiser la détection (règles) | أتمتة الكشف بالقواعد | P2 | `vid.rules` |
| `task.import-bank` | Importer et rapprocher un relevé | استيراد ومطابقة كشف الحساب | P1 | `vid.import` |
| `task.accounting-pack` | Générer le paquet comptable / clôture | إنشاء الحزمة المحاسبية وإغلاق الفترة | P2 | `vid.pack` |
| `task.lock` | Verrouiller l'application | قفل التطبيق | P2 | — |
| `task.reset-doc` | Revenir au modèle d'origine | استعادة النموذج الأصلي | P2 | — |

**Fiche type — `task.new-invoice` (rédaction détaillée débutant)**
1. Menu **Factures validées** → bouton **Nouvelle facture**.
2. Choisir le **client** (ou le créer à la volée).
3. Ajouter les **lignes** : désignation, quantité, prix unitaire, TVA.
4. Vérifier **date**, **échéance** (délai par défaut), **mode de règlement**.
5. Cliquer **Enregistrer** → la facture reçoit son **numéro définitif**.
6. **Aperçu** pour vérifier, puis **PDF** ou **Imprimer**.
- Astuces : réutiliser les désignations par défaut du client ; le brouillon n'occupe pas de numéro.
- Erreurs fréquentes : numérotation figée dès la première facture validée ; TVA mal saisie.
- Voir aussi : `screen.invoices`, `task.payment`, `task.doc-model`, `gloss.tva`.

### 5.4 FAQ (`faq`) — priorité P1 sauf mention

| id | Question FR |
|---|---|
| `faq.backup` | Où sont stockées mes données ? Comment les sauvegarder ? |
| `faq.numbering` | Pourquoi je ne peux plus changer le début de numérotation ? |
| `faq.arabic` | Comment obtenir des PDF bilingues FR/AR ? |
| `faq.import-fail` | Mon relevé n'est pas reconnu, que faire ? |
| `faq.tva` | Quels taux de TVA sont disponibles ? |
| `faq.ice` | Qu'est-ce que l'ICE, l'IF, la CNSS ? Doivent-ils figurer ? |
| `faq.pdf` | Comment personnaliser l'apparence de mes factures ? |
| `faq.lock` | J'ai oublié le mot de passe, que faire ? |
| `faq.update` | Comment mettre à jour l'application ? |
| `faq.windows` | Fonctionne-t-elle sur Windows et macOS ? |
| `faq.data-path` | Où trouver le dossier de données ? |
| `faq.print` | Différence entre Aperçu, Imprimer et PDF ? |
| `faq.dark` | Puis-je passer en thème sombre ? |
| `faq.language` | Comment passer en arabe ? |
| `faq.support` | Comment contacter le support / signaler un bug ? |

### 5.5 Glossaire (`gloss`) — priorité P1

| id | Terme FR | Terme AR | Définition courte |
|---|---|---|---|
| `gloss.ice` | ICE | ICE | Identifiant Commun de l'Entreprise (Maroc) |
| `gloss.if` | IF | IF | Identifiant Fiscal |
| `gloss.rc` | RC | RC | Registre du Commerce |
| `gloss.patente` | Patente | Patente | Taxe professionnelle communale |
| `gloss.cnss` | CNSS | CNSS | Caisse Nationale de Sécurité Sociale |
| `gloss.tva` | TVA | الضريبة على القيمة المضافة | Taxe sur la valeur ajoutée |
| `gloss.ht` | HT | بدون ضريبة | Hors taxes |
| `gloss.ttc` | TTC | مع الضريبة | Toutes taxes comprises |
| `gloss.due-date` | Échéance | تاريخ الاستحقاق | Date limite de paiement |
| `gloss.lettrage` | Lettrage | المطابقة | Rattacher un paiement à une facture |
| `gloss.avoir` | Avoir | إشعار دائن | Note de crédit (à venir) |
| `gloss.quote` | Devis | عرض سعر | Proposition avant facturation |
| `gloss.draft` | Facture à valider | فاتورة في انتظار التحقق | Proposition issue de l'import |

---

## 6. Onboarding (1ʳᵉ utilisation)

- **Déclenchement** : première ouverture si `settings.onboarded` absent.
- **Format** : bulles séquentielles pointant les éléments réels (sidebar, boutons), fermables, « Passer » toujours disponible.
- **Parcours (5 étapes)** :
  1. Bienvenue → « Configurons votre société » (ouvre `start.company`).
  2. « Voici vos écrans » → survol de la navigation.
  3. « Importez votre relevé » → `screen.import`.
  4. « Validez vos factures » → `screen.drafts`.
  5. « Encaissez et suivez » → `screen.payments` + `screen.dashboard`.
- **Checklist « Mise en route »** persistée (visible sur le tableau de bord jusqu'à complétion) :
  - [ ] Société configurée (mentions légales)
  - [ ] Premier client créé
  - [ ] Première facture validée
  - [ ] Premier encaissement enregistré
  - [ ] Sauvegarde effectuée
- **Ne jamais ré-afficher** après fermeture ; réactivable depuis Paramètres → Aide.

---

## 7. Vidéos — plan de tournage (5 à 8)

Format : screencast **30–60 s**, sans voix (sous-titres FR/AR), `.mp4`/`.webm` **embarqué** (hors ligne), ~1–3 Mo chacune, léger et muet (lecture en boucle).

| id | Sujet | Durée | Dépend de |
|---|---|---|---|
| `vid.start` | Premier lancement et configuration | 60 s | start.company |
| `vid.company` | Mentions légales + modèle de document | 45 s | task.doc-model |
| `vid.first-invoice` | De la création à l'impression | 60 s | task.new-invoice |
| `vid.quote` | Devis puis conversion en facture | 45 s | task.quote-to-invoice |
| `vid.payment` | Enregistrer un paiement | 30 s | task.payment |
| `vid.import` | Importer et rapprocher un relevé | 60 s | task.import-bank |
| `vid.rules` | Créer une règle automatique | 45 s | task.rules |
| `vid.pack` | Paquet comptable et clôture | 45 s | task.accounting-pack |

Contraintes : capter avec les **données de démonstration** (aucune donnée client réelle) ; versionner les vidéos (re-tournées à chaque changement d'UI majeur).

---

## 8. Guide imprimable (PDF) & aide-mémoire

- Généré **depuis la même source** `help-content.js` (aucune duplication).
- Structure : couverture → sommaire → articles P1 par ordre logique (démarrage, écrans, tâches) → FAQ → glossaire → **aide-mémoire 1 page** recto/verso.
- Bilingue : deux colonnes ou deux documents (FR / AR).
- Nom : `MAZ-FATORA-Guide-FR-vX.Y.pdf`, `...-AR-vX.Y.pdf`.
- Réutilise la chaîne d'impression existante (moteur de rendu + `@page`).

---

## 9. Spécifications techniques

### 9.1 Fichiers
```
src/renderer/help-content.js   # contenu FR/AR (1 source de vérité)
src/renderer/help.js           # moteur : recherche, rendu, navigation, ancrage écran
src/renderer/help.css          # styles (RTL, thème clair/sombre, impression)
src/renderer/index.html        # bouton ?, entrée sidebar, conteneur modale
src/renderer/i18n.js           # clés help.* (UI du centre d'aide)
```
- **Aucune requête réseau** ; images/captures et vidéos locales (`img-src 'self' data:`, `media-src 'self'`).
- Réutilise `I18N`, `state.settings.language` et `settings.theme`.

### 9.2 Comportements
- `?` / `F1` → `openHelp(screenArticleId)`.
- Recherche : index construit au chargement (titre + mots des étapes), insensible à la casse/accents, résultats cliquables.
- Historique interne (« retour ») ; « Voir aussi » navigue sans fermer.
- Mémoriser les articles **lus** (optionnel) et le dernier article ouvert.
- Modale : focus piégé, `Échap` ferme, `aria-modal="true"`, `role="dialog"`.

### 9.3 Onboarding
- Regroupé dans `help.js` ; état dans `settings.onboarded` (booléen) + `settings.setupChecklist` (objet de booléens).
- Aucune donnée transmise ; tout est local.

### 9.4 Impression
- `help.css` fournit une feuille d'impression pour produire le guide PDF depuis le même contenu.

---

## 10. Tests & qualité

| Test | Fichier | Contenu |
|---|---|---|
| Contenu complet | `test/unit/help.test.js` (P1) | ids uniques, fr/ar présents, étapes non vides, `related`/`screen`/`category`/`video` valides, parité |
| Parité i18n | `test/unit/i18n.test.js` (étendu) | clés `help.*` + `data-i18n` du centre d'aide |
| Smoke UI | `test/smoke.js` (phase `1h`) | `?` ouvre le bon article par écran ; recherche filtre ; `F1` ; RTL ; thème sombre ; onboarding à la 1ʳᵉ ouverture puis plus |
| Impression | smoke | le guide PDF se génère (contenu non vide) |

Définition de « terminé » pour P1 : tests verts (`npm run test:all`), FR/AR complets, aucune régression sur les phases existantes.

---

## 11. Roadmap & effort

| Phase | Contenu | Effort |
|---|---|---|
| **P0 — Plan éditorial** *(ce document)* | Inventaire, chartes, specs | ~0,5 j (fait) |
| **P1 — MVP Centre d'aide** | `help-content.js` (démarrage + 10 écrans + tâches P1 + FAQ + glossaire), `help.js/css`, `?`+`F1`, recherche, i18n, tests | ~3–4 j |
| **P2 — Onboarding** | Parcours 5 étapes + checklist « mise en route » | ~2–3 j (**fait — v1.20.0**) |
| **P3 — Guide PDF** | Génération depuis la source + aide-mémoire | ~1–2 j (**fait — v1.21.0**) |
| **P4 — Vidéos & FAQ+** | 8 screencasts, compléments FAQ | ~3–5 j |
| **P5 — Maintenance** | MAJ à chaque version, captures/vidéos, parité | continu |

Ordre recommandé : **P1 → P2 → P3 → P4**, chaque phase restant livrable et testée indépendamment.
État : **P0, P1 (v1.19.0), P2 (v1.20.0) et P3 (v1.21.0) livrés** ; reste **P4** (vidéos) et la maintenance.

---

## 12. Maintenance & gouvernance

- Le contenu d'aide porte un **numéro de version** ; relecture à chaque `vX.Y` produit.
- Toute clé d'aide ajoutée doit exister en **FR et AR** (sinon test rouge).
- Captures et vidéos re-générées lors de tout changement d'UI les concernant, avec les données de démonstration.
- Le plan éditorial (§5) fait foi : tout nouvel écran ou tâche doit y être ajouté avant codage.

---

## 13. Décisions ouvertes / hypothèses

| Sujet | Hypothèse retenue | À confirmer |
|---|---|---|
| Public | Débutant non technique | ✔ (validé) |
| Vidéos | Embarquées, 5–8, muettes + sous-titres | ✔ (validé) |
| Langues | FR + AR, parité stricte | ✔ |
| Support | Lien « Signaler un bug » (issue GitHub / e-mail) | à préciser |
| Captures | Générées depuis l'app avec données de démo | à valider |
| Format guide | 2 PDF (FR, AR) | à valider |
