# MAZ-FATORA

Application desktop de **facturation** (Electron) adaptée au **contexte marocain** : montants en **MAD**,
mentions **ICE / IF / RC / Patente / CNSS**, taux de **TVA 20/14/10/7 %** et **factures bilingues
français + arabe** (avec montant en toutes lettres dans les deux langues).

**Interface entièrement bilingue français ⇄ arabe** (bascule RTL) et **import de relevé bancaire
(PDF ou CSV)** avec **génération automatique de factures à valider**.

**Identité** : l'application s'appelle **MAZ-FATORA** (titre de la fenêtre, Dock, onglet) et utilise
les images placées à la racine du projet : **`Icon.png`** (icône de l'application / favicon) et
**`Logo.png`** (logo affiché dans la barre latérale).

Trois modules complémentaires :

- **Saisie directe d'une nouvelle facture** (sans import), depuis le tableau de bord ou les
  factures validées ;
- **Paiements** : encaissements partiels ou totaux, historique par facture, vue de suivi
  (facturé / encaissé / reste à encaisser / retards) ;
- **Sauvegarde & restauration** de toute la base à l'**emplacement de votre choix** (fichier JSON).

Et une **protection de l'application** (Paramètres → Sécurité), **version monoposte** : un **mot de
passe de connexion** (4 caractères minimum, réinitialisation contrôlée par **question de
sécurité**), et l'application n'est utilisable que sur **le poste où la protection a été activée**
(empreinte matérielle ; aucun autre poste ne peut l'utiliser). Une **licence d'utilisation signée**
(clé `MAZF-…` fournie par le vendeur) protège l'application contre la contrefaçon : elle n'est
active que sur les postes liés (cf. section **Licence**). Le **nom du client de la licence** devient
le **nom de société** affiché dans Paramètres → Mon entreprise — **non modifiable** — et celui
utilisé sur les factures. Un **logo de société** peut être choisi dans Paramètres (PNG/JPG) :
il est mémorisé et **inséré automatiquement en tête de chaque facture**. Enfin, un **export
comptable** (Paramètres → Export comptable) produit un **paquet .zip de clôture de période**
pour le comptable : journal de ventes, TVA par taux, encaissements, balance âgée, rapprochement
bancaire et factures PDF — noms normalisés et **empreinte SHA-256** pour l'archivage.

## Démarrage

```bash
npm install
npm start
```

Tests automatisés (UI + extraction PDF) :

```bash
npm test
```

## Version

La **version** s'affiche en bas de la barre latérale (ex. `v1.21`). À **chaque modification** du
projet, le champ `version` de `package.json` est incrémenté par la **partie mineure**
(`1.0` → `1.1` → `1.2` …) et l'application affiche `major.minor`. Les noms d'installateurs
reprennent la version complète (`1.21.0`).

## v1.21 — Guide d'utilisation imprimable (bilingue, PDF)

Un **guide complet** généré depuis le **contenu unique** du Centre d'aide, prêt à imprimer ou à
archiver — **aucune ressource réseau** :

- **Paramètres → Aide** : *Ouvrir le guide d'utilisation* (aperçu) et *Enregistrer le guide en
  PDF…* ; nom de fichier `MAZ-FATORA-Guide-FR.pdf` / `…-AR.pdf` ;
- Structure : **couverture** (version + date), **sommaire**, **articles par catégorie**
  (démarrage, écrans, tâches, FAQ, glossaire) puis **aide-mémoire** d'une page (tableau des
  écrans + raccourcis) ;
- **Bilingue FR/AR** : la langue suit celle de l'application, avec bascule **RTL** en arabe ;
- Le guide est rendu à la demande par `print-guide.js` (fonction pure testée) dans une fenêtre
  d'impression dédiée (`print-guide.html`), réutilisant l'export PDF/impression existant.

## v1.20 — Mise en route guidée (onboarding bilingue)

Aide au **premier lancement**, sans ressource réseau :

- **Visite guidée** en 5 bulles, à la **première utilisation** : bienvenue, puis survol de la
  navigation, de l'import, de la validation des factures et des paiements. Les éléments réels
  de l'interface sont **mis en évidence**; navigation *Précédent / Suivant*, **Passer**
  toujours disponible, fermeture par `Échap` ou flèches ←/→ ;
- **Fermée une fois, elle ne réapparaît plus** (`settings.onboarded`) ; elle est
  **réactivable** depuis *Paramètres → Aide → « Revoir la visite guidée »* ;
- **Checklist « Mise en route »** sur le tableau de bord : société configurée, premier client,
  première facture validée, premier encaissement, sauvegarde. Les étapes sont **déduites de
  l'état réel** de l'application et la carte **disparaît une fois tout terminé** ;
- **Bilingue FR/AR** (RTL) avec **parité vérifiée par test** ; contenu dans
  `onboarding.js` / `onboarding.css`, libellés `tour.*` / `setup.*`.

## v1.19 — Centre d'aide intégré (bilingue, hors ligne)

Nouveau **Centre d'aide** consultable dans l'application, **sans aucune ressource réseau** :

- **Bouton « ? »** sur chaque écran (en haut à droite) et **touche `F1`** : ouvre directement
  l'aide de l'écran courant ;
- **Bouton « ? »** en bas de la barre latérale : ouvre le sommaire complet ;
- **Recherche** plein texte (insensible à la casse et aux accents) et navigation par
  **renvois « Voir aussi »** entre articles ;
- **Contenu unique FR/AR** (démarrage, écrans, tâches courantes, FAQ, glossaire) —
  **parité des deux langues vérifiée par test** ;
- Panneau **accessible** : `role="dialog"`, focus piégé, fermeture par `Échap`, bascule
  **RTL** automatique en arabe.

Le plan éditorial complet (vidéos, guide imprimable, onboarding) est documenté dans
**`docs/plan-aide-utilisation.md`**.

## v1.18 — Identifiants légaux au choix + réglages appliqués aussitôt

- **Identifiants légaux sélectionnables un par un** dans « Modèle des documents » :
  **ICE / IF / RC / Patente / CNSS / TVA** peuvent être affichés ou masqués
  indépendamment (dans l'en-tête société comme dans le bandeau de pied) ;
- **Réglages appliqués immédiatement** : toute modification de la carte « Modèle des
  documents » est enregistrée aussitôt — plus besoin de repasser par « Enregistrer les
  paramètres » pour que le changement apparaisse sur les factures/devis ; le bouton
  **Aperçu** enregistre d'abord le réglage courant ;
- **Balance âgée (paquet comptable)** : l'ancienneté est calculée en **jours** (et non
  selon l'heure d'exécution) — une échéance du jour même n'est plus classée « échue ».
  Résultat **déterministe**.

## v1.17 — Modèle des documents personnalisable (PDF factures & devis)

Nouvelle carte **« Modèle des documents »** dans *Paramètres* : l'apparence des PDF
(factures et devis) se règle sans toucher au code. Le rendu est désormais un **moteur
unique** (`print-doc.js` + `print-doc.css`) piloté par `settings.doc`, et le **modèle par
défaut reproduit à l'identique** le document historique.

- **5 modèles de disposition** : *Classique* (historique), *Moderne* (bandeau accent),
  *Minimaliste* (noir & blanc), *Élégant à bande*, *Compact*. Modèles **distincts
  facture / devis** possibles ;
- **Couleur d'accent** : automatique (facture bleue / devis sarcelle), 7 palettes
  (bleu, vert, ardoise, bordeaux, sarcelle, ambre, noir & blanc) ou **couleur
  personnalisée** ;
- **Format** : A4 / A5, **marges** étroites / normales / larges, **densité** et **police**
  (avec ou sans empattement) ;
- **Informations affichées** (cases à cocher) : logo, nom arabe, **identifiants légaux
  sélectionnables un par un** (ICE / IF / RC / Patente / CNSS / TVA), bloc client, TVA
  détaillée par taux, régime de
  TVA, RIB, notes, mentions légales, bloc **signature/cachet**, **échéance** (facture),
  **validité** (devis) et le choix des **colonnes** de lignes (Qté, P.U., TVA, Total HT) ;
- **Montant en toutes lettres** : français + arabe, français seul, arabe seul, ou aucun ;
- **Langues affichées** : bilingue, français seul, ou **arabe seul** (document en RTL) ;
- **Filigrane** : aucun, « PAYÉE », « BROUILLON », « DEVIS » ;
- **Textes libres** : en-tête, conditions de règlement et pied de page personnalisés
  (remplacent les mentions par défaut) ;
- **Aperçu** du dernier document et **réinitialisation** du modèle. Les réglages sont
  **appliqués immédiatement** (enregistrés au changement) : plus besoin de repasser par
  « Enregistrer les paramètres ». Avertissement lorsque les identifiants légaux sont
  masqués (risque de non-conformité).

## v1.16 — Comptabilisation des factures (numérotation continue)

Garde-fous de **suppression** et **état « Comptabilisée »** pour préserver la séquence
légale des factures (aucun trou) et tracer ce qui a été transmis au comptable :

- **Suppression réservée à la dernière facture** : on ne peut supprimer qu'une facture
  validée qui est la **dernière de la série** (numéro le plus élevé). Le compteur
  `meta.invoiceSeq` est **rembobiné** en conséquence : le numéro libéré est **réutilisé**,
  la numérotation reste **contiguë** ;
- **Verrous de suppression** : refusée si la facture porte un **règlement** (supprimer
  d'abord les règlements) ou si elle est **comptabilisée** ;
- **État « Comptabilisée »** : toutes les factures validées d'un **mois** (année-mois de la
  date de facture) peuvent être marquées comme transmises au comptable — **bouton
  « Comptabiliser le mois… »** dans la vue Factures validées, et **proposition
  automatique** après un export de clôture de période. Une facture comptabilisée n'est
  plus **modifiable** ni **supprimable**, mais les **encaissements restent possibles**
  (évènement postérieur à la comptabilisation) ;
- **Réversible et tracé** : « Dé-comptabiliser le mois » avec confirmation, journal
  d'audit conservé dans `meta.accountingLog` ;
- **Filtre** Toutes / Non comptabilisées / Comptabilisées + pastille « Comptabilisée ».

## v1.15 — Devis transformables en factures

Une nouvelle vue **« Devis »** (10ᵉ vue, entre Factures validées et Paiements) permet de
formaliser une proposition commerciale avant facturation :

- **Création / édition** via l'éditeur existant (client, dates, lignes avec TVA détaillée,
  notes, montant en toutes lettres) ;
- **Numérotation dédiée** `DV-AAAA-NNNN` (séquence indépendante des factures, préfixe et
  durée de validité réglables dans Paramètres → Numérotation) ;
- **Statuts manuels** : Brouillon, Envoyé, Accepté, Refusé (l'expiration est calculée et
  affichée quand la date de validité est dépassée) ;
- **Impression / PDF bilingue** (DEVIS / عرض الثمن) : validité mise en avant, TVA par taux,
  montant en toutes lettres — **jamais** de tampon « PAYÉE » ;
- **Transformer en facture** (sens unique) : crée une **facture validée** numérotée FA, datée
  du jour, avec les références croisées (le devis devient « Converti », la facture porte la
  mention « Devis N° … ») ; la conversion est bloquée si le devis est déjà converti ;
- les devis sont **exclus de la clôture comptable** (paquet export), par conception ;
- **schéma v2** : nouvelle collection `quotes` + séquence `meta.quoteSeq` (migration
  automatique des bases existantes).

## v1.14 — Mise à jour automatique (electron-updater)

MAZ-FATORA vérifie **automatiquement les mises à jour au démarrage** et affiche l'état dans
Paramètres → **Mises à jour** (bouton « Vérifier les mises à jour… », progression du
téléchargement, puis « Installer et redémarrer » une fois la version prête). Le flux
s'appuie sur **`electron-updater`** avec le dépôt **GitHub Releases** de ce projet comme
canal de distribution :

- `npm run dist` produit maintenant aussi les **métadonnées de mise à jour**
  (`latest.yml` Windows, `latest-mac.yml` macOS, et le **zip** requis par Squirrel.Mac) ;
- publier une *release* GitHub avec les installateurs de la nouvelle version suffit pour
  que les clients existants soient informés et se mettent à jour ;
- **Windows (NSIS)** : l'auto-install fonctionne, même **non signé** (avertissement
  SmartScreen au premier lancement de la mise à jour) ;
- **macOS (Squirrel.Mac)** : l'installation silencieuse exige une **signature Developer ID +
  notarisation** (abonnement Apple) — le câblage et le ciblage `zip` sont déjà en place, il
  suffira de signer pour activer l'auto-install ; sans certificat, la nouvelle version est
  détectée et téléchargée, l'installation reste manuelle ;
- **aucun réseau en développement** : hors application packagée, la vérification est
  désactivée (état « dev » affiché dans Paramètres).

## v1.13 — P0 « fiabilisation de la fondation technique »

- **Journal d'application** : tout incident (main + renderer) est consigné dans
  `<userData>/logs/app-YYYY-MM-DD.log` (rotation sur 7 jours). Première étape du support
  client : un bug n'est plus invisible.
- **Sauvegarde automatique quotidienne** : une copie complète de la base est écrite chaque
  jour dans `<dataDir>/auto-backups/` (2 copies glissantes), déclenchée au premier
  enregistrement du jour et à la fermeture. Paramètres → Sauvegarde affiche la date de la
  dernière sauvegarde et permet de **restaurer la dernière auto**.
- **Version de schéma + migrations** : un marqueur `schema.json` versionné accompagne la
  base ; le mécanisme de migration est en place pour les évolutions futures.
- **Tests unitaires** (`npm run test:unit`, sans Electron) : paquet comptable (CSV/ODS/
  empreinte/déterminisme), parité FR/AR de l'i18n, montants en lettres, store + migrations,
  sauvegarde auto. Exécutés en **CI** (GitHub Actions) en plus du smoke.

## v1.12 — Reprise comptable en ODS (LibreOffice / Excel)

Le paquet de clôture de période (Paramètres → Export comptable) fournit désormais, en plus des
CSV, **4 classeurs ODS** : journal de ventes, récap TVA, encaissements et balance âgée.
Chaque classeur :
- a des **en-têtes normalisés bilingues** : ligne 1 en français, ligne 2 en arabe ;
- **type les montants en numériques** (`office:value`) pour une reprise directe en saisie
  comptable (Excel / LibreOffice / import Sage) ;
- est produit de façon **déterministe** : ré-exporter la même période donne un paquet identique
  (empreinte SHA-256 stable).

## Refonte « pro » v1.11 (axes A → E)

- **A — Fondation visuelle** : tokens sémantiques (couleurs, ombres, rayons), barre latérale
  « navy » redessinée avec icônes SVG inline (sprite embarqué, conforme CSP `'self'`, aucune
  ressource CDN), logo sur fond blanc préservé pour la lisibilité, chiffres en `tabular-nums`.
- **B — Chrome applicatif** : boutons + icônes, focus visible, états vides redessinés,
  scrollbars soignées, animations respectueuses de `prefers-reduced-motion`.
- **C — Tableau de bord datavis** : sélecteur de mois (défaut = mois courant), tendances
  « vs mois précédent » sur les KPI, graphique CA 12 mois (barres CSS) et donut
  encaissé / à encaisser (SVG), bannière de bienvenue jusqu'à la configuration de l'entreprise.
- **D — Facture « signature »** : masthead (bandeau bleu), boîte client, tableau de lignes
  bandeau sombre, panneau total, tampon « PAYÉE » diagonal, pied légal — reste lisible
  en noir & blanc et le logo/ICE émis comme avant.
- **E — Confort mode sombre** : thème clair/sombre persisté dans les paramètres, bascule
  depuis la barre latérale (`☾` / `☀`) et depuis Paramètres → Apparence. L'interface arabe
  reste entièrement RTL.

## Packaging (`.dmg` macOS et `.exe` Windows)

```bash
npm run dist        # macOS (.dmg + .zip) + Windows (.exe)
npm run dist:mac    # uniquement le .dmg + .zip
npm run dist:win    # uniquement l'installateur Windows
```

Les installateurs sont écrits dans **`dist/`** :

- **macOS** : `MAZ-FATORA-<version>.dmg` — installation par glisser-déposer dans *Applications*
  (build **non signé** : premier lancement à faire via **clic droit → Ouvrir**) ;
- **Windows** : `MAZ-FATORA Setup <version>.exe` — installateur NSIS (dossier au choix,
  raccourci bureau et menu Démarrer).

### Publier une version (mise à jour automatique)

Le build écrit aussi les **métadonnées d'auto-update** dans `dist/` (`latest.yml` /
`latest-mac.yml` + `MAZ-FATORA-<version>-mac.zip` requis par Squirrel.Mac). Pour rendre
la version disponible aux clients existants, la façon la plus fiable est de laisser
**electron-builder publier lui-même** (il garde le zip macOS, calcule des hashs
cohérents et nomme les assets comme les `.yml` les référencent) :

```bash
GH_TOKEN=<token GitHub> npm run dist -- --publish always
```

Cette commande construit `.dmg` + `-mac.zip` (macOS) et `.exe` (Windows), puis crée la
**GitHub Release** `v<version>` (le tag doit exister au préalable) et y upload
`latest.yml`, `latest-mac.yml`, les installeurs et leurs blockmaps. Variante manuelle
équivalente : `gh release create v1.14.0 dist/*.dmg dist/*-mac.zip dist/latest-mac.yml dist/*.exe dist/latest.yml`.

L'application vérifie ce canal **au démarrage** (Paramètres → Mises à jour) : une version
supérieure à la sienne est proposée puis installée au redémarrage.

Chaque installeur est **autoportant** (« contient toutes les dépendances ») : Electron,
l'application (`src/`), `pdfjs-dist` (extraction des relevés PDF, polices et cmaps inclus),
`Logo.png` / `Icon.png` — **aucune installation préalable n'est requise** (Node.js non nécessaire).
La configuration se trouve dans `package.json` → `"build"` (cibles `dmg` / `nsis`, icône générée
à partir de `build/icon.png`, archive asar avec fichiers décompressés listés dans `asarUnpack`).

## Interface bilingue (FR ⇄ AR)

Sélecteur **FR / العربية** en bas de la barre latérale :

- toute l'interface bascule en **arabe avec sens de lecture RTL** (barre latérale à droite,
  tableaux, toasts, champs alignés à droite) — les propriétés CSS logiques suivent la direction ;
- **messages, toasts, confirmations, modales, dialogues natifs** (choix de fichier, enregistrement
  PDF) et **barre d'outils de l'aperçu** suivent la langue choisie ;
- la langue est **mémorisée** dans `settings.json` et relue au démarrage (également par le
  process principal pour ses dialogues) ;
- **dates et montants restent au format français** (`01/10/2026`, `1 200,50 MAD`) dans les deux
  langues ; la **facture A4 reste bilingue FR + AR** et en LTR, quelle que soit l'interface.

Dictionnaires partagés dans `src/renderer/i18n.js` (UMD : utilisé par le renderer *et* par le
process principal via `require`).

## Fonctionnement

1. **Paramètres** : renseignez votre entreprise — nom (français et éventuellement **arabe**),
   **ICE**, **IF**, **RC**, **Patente**, **CNSS**, adresse, contact et **RIB / CCP** —
   puis le **régime de TVA** (réel normal par défaut, avec les taux **20 / 14 / 10 / 7 %** et 0 %),
   le taux de TVA par défaut et le délai de règlement.
2. **Import relevé bancaire** : PDF ou CSV exporté par votre banque
   - **PDF** : le texte et la mise en page sont analysés (colonnes *Date / Libellé / Débit / Crédit / Solde*,
     repli sur les signes et le delta de solde si pas d'en-tête) — un avertissement signale les cas ambigus.
     Relevés marocains type **Attijariwafa** pris en charge : code opération en tête de ligne, dates
     `JJ MM` / `JJ MM AAAA` séparées par **espaces**, date de valeur accolée au libellé, montants
     **sans signe ni colonnes** → le sens du mouvement est déduit du libellé (`…EMIS`, `PAIEMENT`,
     `PRELEVEMENT`, `ASSURANCE`, `FRAIS` = débit ; `RECU DE`, `VERSEMENT`, `REMISE` = crédit)
   - **CSV** : séparateurs `;`, `,` ou tabulation, montants français (`1 234,56 MAD`, suffixes `MAD` / `DH`
     acceptés), dates `JJ/MM/AAAA` ou ISO
   - **seuls les virements reçus (crédits) sont retenus** : les débits du relevé sont écartés
     (ni importés, ni affichés, ni facturés) — le récapitulatif annonce les « débits écartés »
   - **période d'import** : champs *Début de période* / *Fin de période* (par défaut : toutes les
     dates du fichier) qui limitent l'aperçu **et** l'import aux transactions choisies — tout le
     reste du fichier est écarté et annoncé (récapitulatif « hors période » + message de fin) ;
     modifier un champ recalcule l'aperçu immédiatement
   - **sélection des transactions** : chaque ligne de l'aperçu (50 premières) porte une
     **case à cocher**, **toutes cochées par défaut** — décochez celles à écarter (case
     « tout sélectionner » en tête de tableau, récap « Sélectionnées : n/m ») ; seules les
     transactions encore cochées sont importées **et** facturées
   - **désignation par défaut du client** : si le client choisi possède une désignation
     (Paramètres → *Désignations des factures*), elle est **annoncée dans l'aperçu** puis posée
     sur les lignes des factures générées — **toujours modifiable** dans l'éditeur
   - **panneau d'import** : client de la facture, TVA des lignes, dates de facture et d'échéance,
     dédoublonnage et génération automatique — les choix sont **mémorisés pour le prochain import** ;
     **date de facture par défaut = début de la période choisie** du lot (l'échéance suit le
     délai de règlement), recalculée quand la période ou la sélection change, **modifiable à la main**
     (une date saisie n'est plus écrasée)
   - **par défaut : UNE SEULE facture avec plusieurs lignes** — une ligne par encaissement
     (TTC converti en HT selon le taux retenu), crédits rattachés à la facture, débits non facturés ;
     alternative : **une facture par encaissement**. En « Règles automatiques », le regroupement
     est désactivé (un encaissement = une facture attribuée par la règle de son libellé)
3. **✨ Générer des factures (période + client)** :
   - choix de la **période de dates** dans le relevé bancaire (par défaut : toute l'étendue des encaissements)
   - choix du **client unique** auquel attribuer toutes les factures (ou « Règles automatiques »)
   - **Une facture par encaissement** ou **une seule facture regroupée** pour la période
   - TVA, date de facture et échéance paramétrables, récapitulatif en direct —
     **date de facture par défaut = début de la période choisie**
4. **Règles automatiques** : mots-clés du libellé → client, ligne et TVA par défaut (ex. `virement, dupont`).
5. **Factures à valider** : ouvrez le brouillon, corrigez les lignes (taux de TVA proposés :
   20, 14, 10, 7 et 0 %), le **montant en toutes lettres** (français et arabe) s'affiche en direct,
   puis **Valider** → numéro définitif (`FA-2026-0001`) attribué.
   - bouton **➕ Nouvelle facture** : saisie manuelle d'une facture *à partir de zéro*
     (aucun import nécessaire) depuis le **tableau de bord** ou les **factures validées** ;
     client (création rapide possible), lignes, TVA, dates, puis brouillon ou **validation directe**.
   - bouton **🗑 Tout supprimer** : vide **toute la liste** des factures à valider (brouillons
     uniquement, **confirmation intégrée**) — les encaissements rattachés sont déliés,
     aucun montant n'est perdu.
6. **Factures validées** : aperçu, **impression** et **export PDF** de la **facture bilingue** :
   - en-tête société en français et en arabe, identifiants **ICE / IF / RC / Patente / CNSS**
   - titres, colonnes, totaux et mentions légales **FR + AR** (facture A4)
   - **montant en toutes lettres** : « Arrêtée la présente facture à la somme de … dirhams » et
     « أوقفت هذه الفاتورة على مبلغ : … درهماً »
   - régime de TVA, RIB / CCP et mentions marocaines en pied de facture
7. **Clients** : création et gestion des clients (N° TVA / ICE).
8. **💰 Paiements** :
   - depuis les **factures validées** ou la vue **Paiements**, bouton **« Régler »** ;
   - modale d'encaissement : **reste dû pré-rempli**, date, **mode de règlement**
     (espèces, virement, chèque, carte CIB, prélèvement, autre), référence et note ;
     bouton **« Solder le reste »**, refus des montants supérieurs au reste dû ;
   - **paiements partiels** autorisés : la facture passe de *Impayée* → *Partielle* → *Payée* ;
   - **historique** des règlements avec **suppression** (confirmation intégrée, bilingue) ;
   - vue de suivi : **facturé / encaissé / reste à encaisser / retards**, filtres
     (impayées, partielles, payées, en retard) et recherche par numéro ou client ;
   - **échéance dépassée** = pastille « En retard ».
9. **Sauvegarde & restauration** (onglet Paramètres) :
   - **Sauvegarder la base…** : le *dialogue natif vous demande l'emplacement* du fichier JSON
     (paramètres, clients, factures, règlements, transactions, règles) ;
   - **Restaurer une sauvegarde…** : choix du fichier, **confirmation** puis remplacement complet
     des données (langue de la sauvegarde réappliquée) ;
   - **emplacement de la base** affiché + bouton **« Ouvrir le dossier »** ;
   - bouton **« 📂 Choisir l'emplacement de la base… »** : *dialogue natif* pour stocker la base
     sur un **autre disque / dossier** — les données sont **copiées** vers l'endroit choisi, le
     chemin est mémorisé et l'application **redémarre** pour l'utiliser (une base déjà présente
     dans le dossier choisi déclenche une **confirmation** avant remplacement) ;
   - bouton **« ↩ Emplacement par défaut »** : retour dans le dossier d'origine, les données
     actuelles y sont recopiées puis l'application redémarre ;
   - un fichier corrompu ou d'autre structure est **détecté et refusé**.

10. **Désignations des factures** (onglet Paramètres) :
    - **liste de désignations** à créer / supprimer (ex. *Prestation de conseil*, *Licence logicielle*) ;
    - **désignation par défaut, par client** : un sélecteur par client choisit le libellé posé
      automatiquement sur les lignes des factures générées (import, ✨ Générer, règle automatique) ;
    - la désignation appliquée est **toujours modifiable** à la main dans l'éditeur de facture ;
    - supprimer une désignation **réinitialise** les clients qui l'utilisaient.

11. **Début de numérotation** (Paramètres → Facturation) :
    - champ **« Début de numérotation (n° de la 1re facture) »** : le premier numéro attribué
      ne descend jamais sous cette valeur (ex. `42` → `FA-2026-0042`, puis `0043`, `0044`…) ;
    - **modifiable uniquement tant qu'aucune facture n'existe** : dès qu'une facture est créée,
      le champ est **grisé** et un rappel indique que le réglage est verrouillé.

12. **🔒 Sécurité** (Paramètres → Sécurité) — **version monoposte** :
    - **mot de passe de connexion** (4 caractères minimum) : l'application ne s'ouvre (données
      chargées uniquement après déverrouillage), avec **anti force-brute** (5 essais puis
      verrouillage de 5 minutes) ;
    - **monoposte** : à l'activation, le poste courant devient **le seul poste autorisé**
      (empreinte matérielle) ; sur tout autre poste, l'application affiche un écran
      « Poste non autorisé » — il n'existe **aucune gestion multiposte** (ni ajout, ni retrait,
      ni renommage de postes) ;
    - **réinitialisation contrôlée** : mot de passe oublié → **question de sécurité** configurée
      à l'activation (réponse correcte obligatoire pour choisir un nouveau mot de passe) ;
    - bouton **« Verrouiller »** en bas de la barre latérale pour re-verrouiller à tout moment ;
    - tant que le verrou est actif, **aucun accès aux données** (lecture, écriture, import,
      impression, export PDF, sauvegardes) n'est possible.

13. **🔑 Licence d'utilisation (anti-contrefaçon)** :
    - au premier lancement, l'application exige la **clé de licence** fournie par le vendeur
      (format `MAZF-…`, écran « Enregistrement de la licence ») ;
    - la clé est **signée** (ed25519) et **liée aux postes** : elle autorise 1 à 10 machines
      (empreinte matérielle), ensuite toute nouvelle machine est **refusée** ;
    - tant que la licence n'est pas active sur le poste, les données sont **inaccessibles** ;
    - le poste lié figure automatiquement dans les postes autorisés internes (monoposte).

14. **Mon entreprise — nom & logo** (Paramètres → Mon entreprise) :
    - le **nom / raison sociale** est celui du **client de la licence** (choisi par le vendeur à
      l'émission de la clé) : le champ est **figé, non modifiable** ; ce nom est aussi celui
      affiché en bas de la barre latérale et sur les factures ;
    - un **logo de société** peut être choisi (PNG/JPG/SVG…) : il est converti en *data URI*,
      mémorisé dans les paramètres et **inséré en tête de chaque facture** (aperçu, impression
      et PDF).

15. **Export comptable — clôture de période** (Paramètres → Export comptable) :
    - période **du / au** (par défaut : le mois précédent) puis export d'un **paquet .zip** contenant :
      **journal de ventes** (lignes détaillées, statut, encaissé/reste), **récap TVA** par taux
      (20/14/10/7/0) + total, **encaissements** (date, mode, référence), **balance âgée**
      (restes par client avec tranches Non échue / 0-30 / 31-60 / 61-90 / +90 j), **rapprochement
      bancaire** (opérations de la période + facture liée) et **factures PDF** de la période ;
    - chaque table est fournie en **CSV** (`;`, BOM UTF-8) **et en ODS** (LibreOffice/Excel) —
      les classeurs ont des en-têtes **normalisés FR (ligne 1) + AR (ligne 2)** et des montants
      typés numériques pour la reprise directe en saisie comptable ;
    - noms de fichiers **normalisés** (`Société_AAAA-MM_type.csv` / `_type.ods`) et **empreinte
      SHA-256** (manifeste `_infos.json` + fichier `_empreinte.txt`) pour vérifier l'intégrité
      du paquet à la réception.

## Licence d'utilisation (pour le vendeur)

La console `tools/license.js` génère des clés de licence signées avec la **clé privée**
ed25519 conservée **chez vous** (`tools/.license-keys.json`, jamais distribuée) ; l'application
ne contient que la **clé publique** (`src/main/license-pub.json`) et vérifie la signature lors
de l'enregistrement :

```
node tools/license.js init                           # 1 fois : crée la paire de clés
node tools/license.js issue "SARL Dupont" --max 2    # émet une clé pour le client
node tools/license.js verify MAZF-xxxx.xxxx          # contrôle une clé
```

- Le **nom passé à `issue`** (ex. « SARL Dupont ») devient le **nom de société** de l'application
  chez ce client : il s'affiche dans Paramètres (champ verrouillé) et sur les factures — choisissez
  donc le libellé exact à faire figurer sur ses documents.

- Chaque clé autorise un nombre de **postes** (empreinte matérielle) fixé à l'émission
  (`--max 1` à `--max 10`) ; au-delà, un poste supplémentaire est refusé (écran de licence).
- Le dossier `tools/` n'est **pas** embarqué dans l'installateur (ni la clé privée) ;
  gardez `tools/.license-keys.json` précieusement — le perdre rend les clés déjà émises
  invérifiables côté vendeur (l'application, elle, les vérifie avec la clé publique).
- Désactiver le mot de passe ne supprime **pas** la licence ; copier le dossier de données
  vers une autre machine ne la contourne pas (empreinte différente → poste refusé).
- Limites assumées : aucune protection 100 % côté client n'existe — l'objectif est d'arrêter
  le copiage de proximité et de rendre chaque copie **traçable** (clé nominative + postes liés).

## Données

Tout est stocké en local (JSON), dans :

```
~/Library/Application Support/MAZ-FATORA/data/
  settings.json  clients.json  invoices.json  transactions.json  rules.json  meta.json
```

L'**enregistrement de sécurité** (`security.json`) est lui stocké **hors** du dossier de données
déplaçable, dans le dossier de configuration de l'application
(`~/Library/Application Support/MAZ-FATORA/`) : changer l'emplacement de la base (ou la copier)
ne contourne ni le mot de passe ni la liaison monoposte (empreinte matérielle du poste).

> L'ancienne base (`~/Library/Application Support/FACT App/data/`, sous l'ancien nom « FACT App »)
> est **copiée automatiquement au premier lancement** de MAZ-FATORA, sans écraser l'existant.

L'emplacement peut être **changé depuis les Paramètres → Sauvegarde & restauration** : le chemin
choisi est mémorisé dans `config.json` (à côté du dossier `data`, jamais dedans) puis relu à
chaque démarrage ; s'il n'est plus valable, la base par défaut est utilisée.

Un **paiement** est un enregistrement `payments[]` porté par la facture (date, montant, mode,
référence, note) — les factures marquées « payées » avant cette version restent prises en compte.
Les **sauvegardes** sont des JSON lisibles écrits à l'emplacement choisi dans le dialogue natif.

## Échantillons

- `samples/releve-exemple.csv` — relevé CSV (colonnes Débit/Crédit)
- `samples/releve-maroc.csv` — relevé CSV type banques marocaines (libellés VIR / CB CIB / CHEQUE / PRLV / COMMISSION, montants en MAD)
- `samples/releve-exemple.pdf` — relevé PDF avec en-têtes de colonnes

## Structure

```
src/
  main/
    main.js             Fenêtre, dialogues, IPC, export PDF, journal + sauvegarde auto (P0)
    store.js            Stockage JSON local (atomique) + version de schéma et migrations
    app-log.js          Journal d'application <userData>/logs (rotation 7 jours) — P0
    autobackup.js       Sauvegarde automatique quotidienne (2 copies glissantes) — P0
    updater.js          Mise à jour automatique (electron-updater, feed GitHub Releases ;
                        no-op hors application packagée ou hors Electron)
    backup.js           Écriture / lecture / validation des sauvegardes
    security.js         Protection : mot de passe (scrypt), verrou, monoposte (empreinte
                        matérielle), licence signée
    license.js          Licence d'utilisation : vérification des clés signées (ed25519)
    license-pub.json    Clé publique embarquée (vérification des licences)
    export-pack.js      Paquet comptable « clôture de période » : CSV + ODS (FR/AR), manifeste,
                        empreinte SHA-256, zip minimal (module pur, testé par le smoke)
    pdf-statement.js    Extraction des relevés bancaires PDF (pdfjs-dist)
  preload.js            Pont sécurisé renderer ⇄ main
  renderer/
    index.html          Interface (10 vues, libellés data-i18n)
    styles.css          Thème + règles RTL (propriétés logiques)
    i18n.js            Dictionnaires FR / AR + API tr() / setLang() (UMD)
    app.js              Logique applicative (import, génération, factures, paiements, sauvegarde)
    csv.js              Parseur de relevés CSV (MAD / DH / €)
    words.js            Montant en toutes lettres — français (dirhams) et arabe
    doc-config.js       Configuration des documents : schéma `settings.doc`, normalisation,
                        modèles, palettes, formats (partagé app ⇄ impression)
    help-content.js     Contenu du Centre d'aide (source unique FR/AR)
    help.js             Moteur du Centre d'aide (sommaire, recherche, F1, RTL)
    help.css            Styles du Centre d'aide
    onboarding.js       Onboarding : visite guidée + checklist « Mise en route »
    onboarding.css      Styles de l'onboarding (bulles, checklist)
    print-doc.css       Styles des documents : modèles, couleurs, densité, filigrane, RTL
    print-doc.js        Moteur de rendu unique des documents (facture OU devis)
    print-invoice.*     Entrée impression FACTURE (type + moteur partagé)
    print-quote.*       Entrée impression DEVIS (type + moteur partagé)
    print-guide.*       Guide d'utilisation imprimable (rendu depuis help-content.js)
test/
  smoke.js              npm test : UI + langue FR/AR + facture bilingue + facture manuelle,
                        paiements, sauvegarde/restauration + extraction PDF,
                        import PDF → 1 facture à plusieurs lignes, non-régressions
                        (brouillon / Régler / période / base) puis sélection des
                        transactions à l'import + désignations par client, puis date de
                        facture (début de période) et début de numérotation, puis
                        Sécurité monoposte (activation, verrou, mauvais/bon mot de passe,
                        réinitialisation par question, refus d'un autre poste,
                        désactivation) puis Licence (enregistrement d'une clé signée,
                        refus d'une clé forgée, refus d'un poste au-delà du maximum,
                        nom du client figé dans Paramètres + logo de société inséré
                        sur les factures) puis Export comptable (paquet zip : journal, TVA,
                        encaissements, balance âgée, rapprochement, empreinte SHA-256) et
                        Paramètres → Mises à jour (carte + IPC electron-updater),
                        puis Centre d'aide (contenu FR/AR, aide contextuelle, recherche, F1, RTL)
  unit/                 npm run test:unit : tests unitaires sans Electron (node:test)
                        export-pack (CSV/ODS/empreinte/déterminisme), i18n (parité FR/AR),
                        words (montants en lettres), store (migrations), autobackup, updater,
                        help (intégrité et parité du contenu d'aide)
  debug-pdf.js          node test/debug-pdf.js <fichier.pdf> → trace d'extraction
docs/
  plan-aide-utilisation.md  Plan éditorial du dispositif d'aide (contenu, vidéos, guide)
.github/workflows/
  ci.yml                CI : syntaxe + tests unitaires + smoke complet (xvfb)
```
