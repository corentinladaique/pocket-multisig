# Pocket Multisig

Application Android pour **créer et gérer un multisig Squads Protocol v4
depuis un téléphone Solana Mobile (Seeker)**, via Mobile Wallet Adapter.
Prototype développé pour un hackathon.

> **DEVNET UNIQUEMENT.** Aucun réseau mainnet n'est accessible depuis cette
> application. Aucune transaction n'est signée sans action explicite de
> l'utilisateur.

## Why Pocket Multisig

Gérer une trésorerie d'équipe, ça se fait à plusieurs : deux signatures plutôt
qu'une. Mais voter se fait encore sur un ordinateur. Pocket Multisig amène la
proposition, l'approbation et l'exécution **directement sur Solana Seeker** :
les clés ne sortent jamais du wallet, et chaque étape est relue on-chain.

- Android, **devnet uniquement**, Mobile Wallet Adapter + Squads Protocol v4.
- Quatre flux complets : créer un multisig, proposer, approuver, exécuter.
- Reprise après coupure réseau sans jamais renvoyer de transaction.

## Problème résolu

Un membre d'un multisig Squads doit aujourd'hui passer par un navigateur
desktop pour consulter une proposition et voter. Sur un téléphone, aucun outil
natif ne permet d'approuver une transaction de son multisig : l'appareil sait
signer, l'application manquait. Pocket Multisig comble ce vide en restant dans
le périmètre de sécurité du téléphone : **le wallet garde les clés**,
l'application lit l'état on-chain et fait signer.

## Fonctionnalités (devnet, validées manuellement sur Seeker)

Quatre flux d'écriture, tous avec simulation, confirmation et read-back :

- **Créer un multisig** — membres, seuil, permissions ; signature unique du
  créateur ; read-back vérifié (propriétaire, threshold, membres, permissions,
  timeLock, rentCollector) avant d'afficher « Vault created and verified ».
- **Créer une proposition** — transfert SOL vers une adresse ; montant saisi en
  SOL (conversion exacte en lamports) ; simulation puis une seule transaction.
- **Approuver** — un votant approuve ; anti-double-approbation à trois niveaux ;
  refus on-chain si le wallet a déjà approuvé.
- **Exécuter** — dès que le seuil est atteint et que le wallet a la permission
  `Execute` ; solde relu avant envoi ; read-back de la proposition et du vault.

Plus, en lecture seule :

- **Connexion / déconnexion** via Mobile Wallet Adapter (Seed Vault, Solflare,
  Ledger via Solflare).
- **Lecture d'un multisig** par son adresse : seuil, membres, permissions,
  adresse du vault index 0, solde du Main vault.
- **Liste des propositions** et **détail d'une proposition** (décodage officiel
  du message, source, destination, montant).
- **Reprise après interruption réseau** : `Check transaction again` (création)
  et `Check approval again` (approbation) — strictement en lecture, sans second
  envoi, avec les mêmes invariants que le read-back initial.

## Fixture devnet contrôlée

Un multisig Squads v4 **contrôlé** est disponible sur devnet (2/2, les deux
membres nous appartiennent) :

- cluster : **devnet**
- multisig (adresse de configuration) :
  `BbNr77iyMyn8ipzX2PLGN8mDTCA1cMconfZSzzDcW7xi`
- vault d'index 0 :
  `GLcZLbQZpMed3m8dAFF7XtNEn4TjedeLGKZeJSAG6yGG`
- seuil : **2 / 2**, permissions Initiate + Vote + Execute pour les deux membres

Toutes ces adresses sont des **données publiques de devnet, sans valeur
réelle**.

## Stack technique

| Brique | Version |
| --- | --- |
| Expo | 57.0.24 |
| React Native | 0.86.3 |
| React | 19.2.3 |
| TypeScript (strict) | 6.0.3 |
| @solana/web3.js | 1.99.x (v1) |
| @sqds/multisig (Squads Protocol v4) | 2.1.4 |
| @wallet-ui/react-native-web3js (Mobile Wallet Adapter) | 4.3.0 |
| react-native-quick-crypto | 1.1.x |
| expo-dev-client | 57.0.x |

Programme Squads Protocol v4 : `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`

## Architecture simplifiée

```
[ Seeker ]
    │  Mobile Wallet Adapter (session Android, signatures)
    ▼
[ Wallet MWA ] ──signe──► [ Pocket Multisig (Expo dev build) ]
                                │  JSON-RPC HTTPS
                                ▼
                    [ api.devnet.solana.com ]
                                │
                                ▼
            [ Programme Squads Protocol v4 ]
```

Trois couches, aucune infrastructure serveur :

- le **wallet** détient les clés ; l'application ne voit jamais de clé privée ;
- l'**application** lit l'état on-chain et construit les instructions ;
- la **chaîne** est l'unique source de vérité (aucun backend, aucune base de
  données, aucune clé de service).

## Prérequis

- Node.js 20+ et npm, JDK 17.
- Android SDK (`ANDROID_HOME`), `platform-tools`, `build-tools`, `android-36`.
- Un appareil Android avec un wallet compatible MWA. **Expo Go ne fonctionne
  pas** (modules natifs Kotlin) : un *development build* est obligatoire.

## Installation

```bash
git clone <url-du-depot> pocket-multisig
cd pocket-multisig
npm ci                      # ou npm install
adb devices
npm run typecheck
npm test                    # tests purs (aucun réseau, aucune transaction)
npx expo run:android        # build natif + installation sur l'appareil
```

Installer un APK déjà construit sur un Seeker branché :

```bash
adb install -r <chemin>/app-release.apk
```

(`-r` conserve les données de l'application.) Aucun APK publié n'est fourni à
ce jour : le build se fait localement.

En cas de « SDK location not found », créer `android/local.properties`
(fichier ignoré par Git) contenant `sdk.dir=/chemin/vers/Android/Sdk`.

Scripts : `npm run typecheck`, `npm run doctor`, `npm test`, `npm run android`.

## Utilisation

1. **Connect wallet**, autoriser dans le wallet.
2. Coller l'adresse d'un multisig et **Load multisig** (ou **Create vault**
   pour en créer un sur devnet).
3. Depuis l'accueil : ouvrir les propositions, en **créer** une, **approuver**
   avec un second wallet, **exécuter** quand le seuil est atteint.
4. Après une coupure réseau, **Check transaction again / Check approval again**
   permet de retrouver l'état on-chain sans rien renvoyer.

## Demo flow

Démo de référence (détail complet et checklists : `DEMO-RUNBOOK.md`) :

1. Configurer un vault **2-of-3** et montrer le seuil recommandé.
2. Créer une proposition de transfert SOL et la relire avant de signer.
3. Faire approuver par un second wallet → « Approval threshold reached ».
4. **Execute transaction** → « ✓ Transaction executed ».
5. Optionnel, en insert : couper le réseau puis `Check approval again`.

Le take principal ne dépend jamais d'une coupure réseau.

## Sécurité

- **Ne fournissez jamais votre seed phrase ou votre clé privée à quiconque, y
  compris à cette application.** Elle ne les demande pas, ne les lit pas et ne
  les stocke pas.
- Aucun secret dans le dépôt : aucun `.env`, aucune clé d'API, aucun token.
- Ce prototype **n'a pas été audité.** Voir `SECURITY.md` pour les règles
  appliquées et les **risques ouverts** (RPC public unique, identité dApp de
  développement, dépendances vulnérables transitives, listes d'adresses
  dynamiques non supportées, absence de CI).

## Avertissement hackathon

Prototype fourni tel quel, sans garantie. Non audité. Ne pas l'utiliser pour
gérer des actifs ayant une valeur réelle.

## État d'avancement

| Étape | Statut |
| --- | --- |
| Cadrage, architecture, sécurité | Terminé |
| Socle natif Expo + polyfills | Terminé |
| Connexion / déconnexion MWA | Validé sur Seeker |
| État réseau et RPC devnet | Validé sur Seeker |
| Lecture d'un multisig, des propositions, décodage | Validé sur Seeker |
| Création de multisig + read-back vérifié | Validé sur Seeker |
| Création de proposition SOL | Validé sur Seeker |
| Approbation + reprise réseau | Validé sur Seeker |
| Exécution | Validé sur Seeker |
| Tests purs (`npm test`) | 33 fichiers, lancés manuellement |
| CI | Non implémentée |
| Découverte automatique des multisigs | Reportée après le MVP |

## Limitations connues

- `expo-doctor` signale une dépendance React dupliquée transitive
  (`@wallet-standard/react`) ; aucun impact observé.
- Deux wallets MWA installés font apparaître le sélecteur Android à la première
  connexion.
- Les Address Lookup Tables ne sont pas supportées à l'exécution.
- `LICENSE` conserve la mention de copyright héritée du modèle Expo.

## Remerciements

Squads Protocol v4, Mobile Wallet Adapter, le wallet Seed Vault et l'appareil
Seeker sont des projets Solana Mobile / Squads Labs. Ce dépôt n'y est ni
affilié ni approuvé par eux.
