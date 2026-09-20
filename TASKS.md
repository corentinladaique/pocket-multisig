# TASKS.md — Pocket Multisig

Plan de réalisation en tâches atomiques. Règles : une tâche = un commit,
≤ 5 fichiers modifiés, `npx tsc --noEmit` + tests avant de passer à la suivante.
Une commande qui échoue s'analyse avant toute nouvelle modification.

## Phase 0 — Fondations

### T00 · Fixture devnet (validation de la chaîne d'outils)

- Objectif : prouver qu'on sait produire un multisig v4 + une proposition sur
  devnet sans backend, avant d'écrire l'app.
- Statut : FAIT. Fixture Squads v4 devnet contrôlée créée le 2026-09-19 et
  confirmée on-chain ; relecture SDK conforme (seuil, membres, permissions,
  vault) ; validation de l'affichage depuis le Seeker conforme. Le vault
  d'index 0 est dérivé mais **non financé** : aucun SOL n'y a été déposé.
  **Ne pas relancer ce script pour cette fixture** — elle existe déjà ; le
  relancer créerait un multisig différent (nouvelle `createKey`).
- Fixture publique (hors dépôt, `~/.config/pocket-multisig/devnet/fixture-public.json`) :
  - cluster : devnet
  - multisig : `BbNr77iyMyn8ipzX2PLGN8mDTCA1cMconfZSzzDcW7xi`
  - vault index 0 : `GLcZLbQZpMed3m8dAFF7XtNEn4TjedeLGKZeJSAG6yGG`
  - threshold : 2 / 2, deux membres (wallet public du Seeker + approver local
    devnet), permissions Initiate + Vote + Execute pour les deux
  - transaction de création :
    `4sHZmbyiFDeP4LxjYPXh1M7Y9YMrz9UK9WeE4vzG3sBDthmjEWD3Bdgfa6BmhF3cszH7iJXGBNy6a2kAPriofMGc`
  - aucune proposition créée, aucune approbation testée, aucune exécution testée
- Livrable : `scripts/create-devnet-fixture.ts`.
- Contenu (réellement réalisé) : lecture du compte officiel `ProgramConfig`,
  dérivation des PDA `getMultisigPda` / `getVaultPda`, création du multisig
  **2/2** via `multisigCreateV2` (`configAuthority: null`, `timeLock: 0`,
  `rentCollector: null`), puis relecture et contrôle des invariants via le SDK.
  Le vault d'index 0 est dérivé mais **non financé**. Ce multisig ne contient
  encore **aucune vault transaction et aucune proposition**
  (`transactionIndex = 0`) — c'est cet état qui a servi à valider T08.
- Fichiers : `scripts/create-devnet-fixture.ts`, `.gitignore`.
- Commande : `npx tsx scripts/create-devnet-fixture.ts` (avec `--check` pour un
  passage en lecture seule). **Ne pas relancer : la fixture existe.**
- Acceptance : le script imprime `multisigPda`, `vaultPda`, `signature`,
  `transactionIndex` et les contrôles d'invariants ; les comptes existent
  (`getAccountInfo` non nul).
- Risque : *airdrops devnet rate-limités* → prévoir 2 essais et un fallback
  `solana airdrop`.

### T01 · Scaffold Expo + TypeScript strict

- Objectif : projet Expo 57 vierge qui démarre sur le Solana Phone physique.
- Fichiers : `package.json`, `tsconfig.json`, `app.json`, `App.tsx`,
  `index.ts`, `screens/ConnectScreen.tsx`.
- Commande : `npx create-expo-app@latest <tmpdir> --template blank-typescript`
  puis synchronisation dans le dossier projet (create-expo-app refuse un
  dossier non vide). Navigation simple, sans expo-router.
- Acceptance : `npx tsc --noEmit` OK ; `npx expo-doctor` 21/21 ; lancement via
  `npx expo run:android` sur le Solana Phone physique.
- Statut : scaffold FAIT (expo 57.0.24, RN 0.86.3, TS 6.0.3) ; `expo run:android`
  à valider sur le téléphone.
- Dépend de : environnement Android SDK (`ANDROID_HOME`) — LEVÉ.

### T02 · Polyfills

- Objectif : `crypto`, `Buffer` et `assert` disponibles avant tout import Solana.
- Fichiers : `polyfill.js`, `index.ts`, `package.json` (champ `main`),
  `tsconfig.json` (types).
- Dépendances ajoutées : `react-native-quick-crypto`, `react-native-nitro-modules`,
  `buffer` — nécessaires car `@sqds/multisig`/beet/bn.js s'appuient dessus et
  React Native ne les fournit pas.
- Acceptance : `npx tsc --noEmit` OK ; un écran de test affiche
  `sha256("test")` en hexadécimal et le résultat correspond à Node.

### T03 · Connexion wallet (MWA)

- Objectif : `MobileWalletProvider` + bouton connecter/déconnecter.
- Fichiers : `App.tsx`, `src/screens/ConnectScreen.tsx`, `src/config.ts`
  (`src/wallet/useWalletGuard.ts` non créé : le verrou devnet est porté par la
  constante `DEVNET_CHAIN`).
- Dépendances ajoutées : `@wallet-ui/react-native-web3js`, `@solana/web3.js`,
  `expo-dev-client`.
- Acceptance : sur le Seeker, l'adresse publique s'affiche ; `chain` vaut
  `solana:devnet` ; le refus utilisateur est géré.
- Statut : PARTIEL — connexion, affichage de l'adresse et déconnexion VALIDÉS
  sur le Seeker. Le refus/annulation n'a pas pu être reproduit : le wallet du
  Seeker ré-autorise silencieusement une session déjà accordée. À revalider avec
  une session wallet vierge (voir T13).

## Phase 1 — Lecture

### T04 · Couche d'accès RPC

- Objectif : `Connection` singleton devnet + contrôle de disponibilité.
- Fichiers réellement créés : `src/solana/connection.ts` (instance unique,
  `commitment: 'confirmed'`, `pingDevnet` sur `getSlot`, timeout applicatif
  8 s) et `src/solana/useRpcHealth.ts` (états `checking` / `online` / `offline`,
  détail brut de l'erreur, `retry`). `src/solana/explorer.ts` et `src/types.ts`
  ne sont **pas** créés.
- Statut : FAIT — validé sur le Seeker (Network: Devnet, RPC: Online, bascule
  Offline vérifiée avec un endpoint invalide temporaire puis restauration).
- Hors périmètre : aucune lecture de solde, aucun lien explorer ouvert
  automatiquement.

### T05 · Découverte des multisigs

- Objectif : trouver les multisigs v4 dont l'adresse connectée est membre.
- Statut : REPORTÉ après le MVP. La découverte automatique membre -> multisigs
  est reportée après le MVP. Remplacée pour l'instant par T05A (lecture
  manuelle d'une adresse connue), qui couvre déjà `Multisig.fromAccountAddress`.
- Fichiers : `src/squads/discovery.ts`, `src/types.ts`, tests
  `src/squads/__tests__/discovery.test.ts`.
- Implémentation : `getProgramAccounts(program, {filters:[discriminator,
  memcmp(base + 33*slot, member)], dataSlice:{offset:0,length:0}})`, pour
  `base ∈ {100, 132}` et `slot ∈ [0..7]` ; union ; puis lecture complète et
  `Multisig.fromAccountAddress` ; filtrage final sur `members`.
- Acceptance : sur la fixture T00, le multisig est trouvé ; un compte illisible
  est ignoré sans crash ; ≥ 1 test unitaire sur la construction des filtres.
- Risque : *RPC public lent* → requêtes `dataSlice` vides (réponses minuscules),
  limite de concurrence à 4, timeout 20 s, message d'erreur explicite.

### T05A · Lecture manuelle d'un multisig Squads v4

- Objectif : saisir l'adresse d'un multisig devnet et afficher sa configuration.
- Fichiers : `src/squads/multisig.ts`, `src/squads/useMultisigLookup.ts`,
  `src/screens/ConnectScreen.tsx` (bloc de saisie et de résultat).
- Dépendance ajoutée : `@sqds/multisig@2.1.4` (SDK officiel, 31 paquets JS,
  aucun module natif — simple rechargement Metro suffit).
- Implémentation : `multisig.accounts.Multisig.fromAccountAddress(connection, addr)`
  ; vault index 0 via `multisig.getVaultPda` ; rôles via `multisig.types.Permissions`
  et `multisig.types.Permission`. Aucun parsing maison, aucun offset, aucun
  `getProgramAccounts`, aucun memcmp.
- RPC : 1 seul appel par chargement (`getAccountInfo`).
- Statut : FAIT — validé sur le Seeker. Les trois tests exigés sont réalisés :
  compte devnet chargé, threshold affiché, membres et vault affichés.
- Reste à faire : aucune fixture tierce n'est plus nécessaire. La fixture
  contrôlée (voir T00) sert désormais de référence pour les tests de lecture.
  La découverte automatique reste reportée après le MVP (voir T05).

### T06 · Écran liste des multisigs

- Objectif : liste + saisie manuelle d'une adresse de multisig (fallback).
- Fichiers : `screens/MultisigsScreen.tsx`, `src/ui/`, `src/types.ts`.
- Acceptance : la fixture apparaît ; l'état vide et l'état d'erreur sont gérés ;
  la saisie manuelle d'une adresse valide ouvre le détail.

### T07 · Écran config du multisig

- Objectif : membres (pubkey + permissions), seuil, vault PDA, solde du vault.
- Fichiers : `screens/MultisigScreen.tsx`, `src/squads/multisig.ts`, `src/ui/`.
- Acceptance : les **2** membres de la fixture et le seuil 2/2 sont affichés,
  permissions décodées en libellés (Initiate/Vote/Execute), vault d'index 0
  dérivé. Aucune lecture de solde du vault.

### T08 · Énumération des propositions

- Objectif : lire en lecture seule la liste des propositions d'un multisig.
- Fichiers créés : `src/squads/proposals.ts` (`computeProposalIndexes` —
  fonction pure, `loadProposals`, hook `useProposals`) et branchement dans
  `src/screens/ConnectScreen.tsx`. `src/squads/multisig.ts` a reçu une ligne
  (exposition de `staleTransactionIndex`, requis par la lecture). Aucun paquet
  ajouté, aucun fichier de test permanent (pas de runner installé).
- Implémentation réelle : index calculés pour `i ∈ [staleTransactionIndex,
  transactionIndex]` (les index strictement antérieurs à
  `staleTransactionIndex` sont exclus) ; dérivation locale des PDA via
  `getProposalPda` et `getTransactionPda` ; **un seul**
  `getMultipleAccountsInfo` ; désérialisation par `Proposal.fromAccountInfo` ;
  comptes absents ou illisibles comptés et ignorés ; modèle d'affichage
  minimal (index, statut `__kind`, nombre d'approbations).
- Règle dure : si `transactionIndex === 0`, retour immédiat d'une liste vide,
  **aucun PDA dérivé, aucun appel RPC** — instrumenté par le champ `rpcCalls`
  du résultat (vérifié : 0 appel).
- Statut : FAIT — état vide validé sur le Seeker : la fixture affiche
  « No proposals yet » (18 tests hors ligne passés, dont l'absence d'appel RPC
  quand `transactionIndex = 0`).
- Reste à faire : aucune proposition on-chain ne peut être affichée tant
  qu'aucune vault transaction n'existe ; le cas « liste non vide » reste donc
  non démontré sur la chaîne (seuls des comptes absents ont été testés).

### T09 · Écran détail d'une proposition

- Objectif : statut, votes, et message décodé.
- Fichiers : `screens/ProposalScreen.tsx`, `src/squads/decode.ts`,
  `src/ui/`.
- Implémentation : `TransactionMessage.decompile` sur le message de la vault
  transaction ; extraction programme cible, comptes, montant SOL si
  `system_program::transfer`, sinon « instruction illisible ».
- Acceptance : la proposition de la fixture affiche « Transfer X SOL vers Y » ;
  une instruction inconnue est affichée explicitement comme non décodée.

## Phase 2 — Écriture (chemin sensible)

### T10 · Écran de confirmation

- Objectif : implémenter SECURITY §4 avant toute signature (aucun envoi).
- Fichiers : `screens/ConfirmScreen.tsx`, `src/ui/ConfirmCard.tsx`, `src/solana/guards.ts`.
- Implémentation : les 8 informations obligatoires + les 2 validations
  programmatiques (feePayer, liste blanche de programmes).
- Acceptance : test unitaire — une transaction dont `feePayer` n'est pas
  l'adresse connectée est refusée ; un programme hors liste blanche est refusé.

### T11 · Approuver une proposition

- Objectif : `proposalApprove` signé via MWA, après confirmation.
- Fichiers : `src/squads/actions.ts`, `screens/ProposalScreen.tsx`,
  `src/ui/`.
- Acceptance : sur la fixture, l'approbation passe le statut à `Approved` ;
  la signature est affichée avec le lien explorer devnet ; le bouton est
  désactivé si le membre n'a pas la permission Vote.

### T12 · Exécuter une transaction

- Objectif : `vaultTransactionExecute` signé via MWA, après confirmation.
- Fichiers : `src/squads/actions.ts`, `screens/ProposalScreen.tsx`,
  `src/ui/`.
- Acceptance : bouton actif seulement si statut `Approved` et permission
  Execute ; après exécution le statut passe à `Executed` et le programme cible
  a reçu l'instruction.
- Risque : *stale transaction / blockhash expiré* → relecture du blockhash juste
  avant la confirmation, message d'erreur lisible en cas d'échec.

### T13 · Robustesse et traçabilité

- Objectif : états de chargement, d'erreur RPC, de rejet wallet, de rejet on-chain.
- Fichiers : `src/ui/`, `screens/ProposalScreen.tsx`, `src/types.ts`.
- Acceptance : chaque erreur a un message en français + le texte brut du RPC ;
  un rejet utilisateur n'est pas présenté comme un bug.

## Phase 3 — Validation

### T14 · Parcours de bout en bout

- Objectif : dérouler le critère de succès de `PRODUCT.md` sur l'émulateur.
- Livrable : `docs/DEMO.md` (script de démo) + captures.
- Acceptance : connexion → découverte → proposition → approbation depuis le
  téléphone → exécution, en < 3 min, sans desktop.
- Risque : *mock MWA wallet instable* → tester aussi sur Seeker physique si
  disponible.

### T15 · Gel du périmètre

- Objectif : vérifier hors-périmètre, chercher les restes de mainnet.
- Acceptance : `grep` sur `mainnet` dans `src/` et `screens/` → uniquement
  `SECURITY.md`/documentation ; checklist SECURITY §7 passée entièrement.

## Ordonnancement et points de blocage

```
T00 ─┬─► T05 ─► T06 ─► T07 ─► T08 ─► T09 ─► T10 ─► T11 ─► T12 ─► T13 ─► T14 ─► T15
T01 ─┴─► T02 ─► T03 ─► T04
```

Bloquants levés : `ANDROID_HOME` est configuré, le Seeker est détecté comme
`device`, et le wallet MWA (Seed Vault Wallet du Seeker) répond.
Blocage restant, hors app : aucune vault transaction n'existe dans la fixture,
donc les tâches T09 (décodage), T11 (approbation) et T12 (exécution) ne sont pas
testables en l'état — il faudra créer une proposition de test depuis un script
machine, sous autorisation explicite.
