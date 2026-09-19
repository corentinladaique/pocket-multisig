# Pocket Multisig

Application Android pour **consulter et gérer un multisig Squads Protocol v4
depuis un téléphone Solana Mobile (Seeker)**, en utilisant Mobile Wallet
Adapter. Prototype développé pour un hackathon.

> **DEVNET UNIQUEMENT.** Aucun réseau mainnet n'est accessible depuis cette
> application. Aucune transaction ne peut y être signée sans action explicite
> de l'utilisateur.

## Problème résolu

Un membre d'un multisig Squads doit aujourd'hui passer par un navigateur
desktop pour consulter l'état d'une proposition et voter. Sur un téléphone,
aucun outil natif ne permet d'approuver une transaction de son multisig :
l'appareil sait signer, mais l'application manque. Pocket Multisig comble ce
vide en restant dans le périmètre de sécurité du téléphone : le wallet garde
les clés, l'application ne fait que lire l'état on-chain et faire signer.

## Fonctionnalités actuellement validées

Validées sur un Seeker physique (Android 16, devnet) :

- **Connexion wallet via Mobile Wallet Adapter** : ouverture du wallet,
  autorisation, retour dans l'application.
- **Affichage de l'adresse publique** connectée (complète et abrégée).
- **Déconnexion** et retour à l'état déconnecté.
- **Contrôle de l'état du réseau** : `Network: Devnet`, `RPC: Online` /
  `Checking…` / `Offline`, avec détail de l'erreur et bouton Retry.
- **Lecture d'un multisig Squads v4 par son adresse** : seuil, nombre de
  membres, adresses publiques des membres, permissions décodées
  (Initiate / Vote / Execute), adresse du vault index 0, réseau.
- Validation locale des adresses saisies et messages d'erreur lisibles
  (adresse invalide, compte absent).

## Non implémenté à ce stade

- Découverte automatique des multisigs d'un wallet (reportée après le MVP).
- Création de multisig, propositions, approbation et exécution depuis
  l'application : à venir.
- Aucun multisig de test contrôlé n'a encore été déployé sur devnet
  (le faucet public a refusé les financements demandés).

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
(identique sur devnet et mainnet — seule la constante d'endpoint distingue les
deux, et elle est gelée sur devnet dans ce prototype).

## Architecture simplifiée

```
[ Seeker ]
    │  Mobile Wallet Adapter (session Android, signatures)
    ▼
[ Wallet MWA ] ──signe──► [ Pocket Multisig (Expo dev build) ]
                                │  JSON-RPC HTTPS (lecture seule)
                                ▼
                    [ api.devnet.solana.com ]
                                │
                                ▼
            [ Programme Squads Protocol v4 ]
```

Trois couches, aucune infrastructure serveur :

- le **wallet** détient les clés (Seed Vault sur Seeker) ; l'application ne
  voit jamais de clé privée, seulement des signatures et des adresses ;
- l'**application** lit l'état on-chain et construit les instructions ;
- la **chaîne** est l'unique source de vérité (aucun backend, aucune base de
  données, aucune clé de service).

Les signataires éventuels vivent dans `scripts/` et servent uniquement à créer
des fixtures de test ; aucune clé de test n'est stockée dans ce dépôt.

## Prérequis

- Node.js 20+ et npm.
- JDK 17.
- Android SDK (`ANDROID_HOME` défini), `platform-tools`, `build-tools`,
  une plateforme `android-36`.
- Un appareil Android avec un wallet compatible Mobile Wallet Adapter
  (sur Seeker : le Seed Vault Wallet). **Expo Go ne fonctionne pas** : Mobile
  Wallet Adapter utilise des modules natifs Kotlin et exige un *development
  build*. Un appareil physique est recommandé.

## Installation

```bash
npm install
adb devices                 # vérifier que l'appareil est en état "device"
npm run typecheck           # vérification TypeScript stricte
npx expo-doctor             # cohérence du projet Expo
npx expo run:android        # build natif + installation sur l'appareil
```

En cas de « SDK location not found », créer `android/local.properties`
(fichier ignoré par Git) contenant `sdk.dir=/chemin/vers/Android/Sdk`.

Scripts disponibles :

- `npm run typecheck` — `tsc --noEmit`
- `npm run doctor` — `npx expo-doctor`
- `npm run android` — `expo start --android`

## Utilisation

1. Ouvrir l'application, appuyer sur **Connect wallet**.
2. Autoriser l'application dans le wallet.
3. L'adresse publique connectée s'affiche ; l'état du RPC devnet aussi.
4. Coller l'adresse d'un multisig Squads v4 devnet, appuyer sur
   **Load multisig** : seuil, membres, permissions et adresse du vault
   s'affichent. **Clear** revient au formulaire.

L'application n'écrit rien : aucune transaction, aucune signature à ce stade.

## Sécurité

- **Ne fournissez jamais votre seed phrase ou votre clé privée à quiconque, y
  compris à cette application.** L'application ne les demande pas, ne les lit
  pas et ne les stocke pas. Si un outil vous demande votre seed phrase, c'est
  une tentative d'hameçonnage.
- L'application ne voyage aucun secret : aucun `.env`, aucune clé d'API,
  aucun token dans le dépôt.
- Les adresses affichées sont publiques et vérifiables sur un explorateur
  devnet.
- Ce prototype **n'a pas été audité**. Voir `SECURITY.md` pour les règles de
  sécurité appliquées pendant le développement (devnet seulement, écran de
  confirmation obligatoire avant toute signature, aucune transaction envoyée
  sans action explicite de l'utilisateur).

## Avertissement hackathon

Ce projet est un **prototype de hackathon**, fourni tel quel et sans garantie
d'aucune sorte. Il n'a pas été audité, il n'offre aucune garantie de sécurité
financière, et il ne doit pas être utilisé pour gérer des fonds réels.
N'utilisez pas ce logiciel pour un multisig contenant des actifs ayant une
valeur. Aucun engagement de support, de disponibilité ou de correction n'est
pris.

## État d'avancement

| Étape | Statut |
| --- | --- |
| Cadrage, architecture, sécurité | Terminé |
| Socle natif Expo + polyfills | Terminé |
| Connexion / déconnexion Mobile Wallet Adapter | Validé sur Seeker |
| État réseau et RPC devnet | Validé sur Seeker |
| Lecture d'un multisig Squads v4 par adresse | Validé sur Seeker |
| Fixture devnet contrôlée (multisig 2/2) | Bloqué : faucet devnet indisponible |
| Découverte automatique des multisigs | Reportée après le MVP |
| Propositions et approbations depuis l'application | À venir |

Détail des tâches : `TASKS.md`. Décisions d'architecture : `ARCHITECTURE.md`.
Périmètre produit : `PRODUCT.md`.

## Roadmap

1. Fixture devnet contrôlée (multisig 2/2 dont nous maîtrisons les membres).
2. Lecture des propositions en attente et de leur contenu décodé.
3. Écran de confirmation avant signature, puis approbation d'une proposition
   depuis le Seeker.
4. Exécution d'une proposition lorsque le seuil est atteint.
5. Découverte automatique des multisigs d'un wallet connecté.
6. Publication sur le Solana dApp Store.

## Limitations connues

- `npx expo-doctor` signale une dépendance React dupliquée introduite par une
  dépendance transitive de Mobile Wallet Adapter (`@wallet-standard/react`).
  Aucun impact observé jusqu'ici ; à traiter si un conflit réel apparaît.
- L'identifiant Android par défaut de `prebuild` n'a pas encore été
  personnalisé.
- Deux wallets compatibles installés sur l'appareil font apparaître le
  sélecteur d'application Android lors de la première connexion.

## Licence

MIT (voir `LICENSE`). Le fichier de licence actuel contient encore la mention
de copyright héritée du modèle Expo et doit être corrigé avant publication.

## Remerciements

Le protocole et le SDK Squads Protocol v4, Mobile Wallet Adapter, le wallet
Seed Vault et l'appareil Seeker sont des projets Solana Mobile / Squads Labs.
Ce dépôt n'est ni affilié à ces équipes, ni approuvé par elles.