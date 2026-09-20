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
  - proposition de test d'index 1 : créée et confirmée (voir T00bis)
  - aucune approbation testée, aucune exécution testée, vault non financé
- Livrable : `scripts/create-devnet-fixture.ts`.
- Contenu (réellement réalisé) : lecture du compte officiel `ProgramConfig`,
  dérivation des PDA `getMultisigPda` / `getVaultPda`, création du multisig
  **2/2** via `multisigCreateV2` (`configAuthority: null`, `timeLock: 0`,
  `rentCollector: null`), puis relecture et contrôle des invariants via le SDK.
  Le vault d'index 0 est dérivé mais **non financé**. Le multisig ne contenait
  **aucune vault transaction et aucune proposition** (`transactionIndex = 0`)
  lors de sa création — c'est cet état qui a servi à valider T08 en liste vide.
- Fichiers : `scripts/create-devnet-fixture.ts`, `.gitignore`.
- Commande : `npx tsx scripts/create-devnet-fixture.ts` (avec `--check` pour un
  passage en lecture seule). **Ne pas relancer : la fixture existe.**
- Acceptance : le script imprime `multisigPda`, `vaultPda`, `signature`,
  `transactionIndex` et les contrôles d'invariants ; les comptes existent
  (`getAccountInfo` non nul).
- Risque : *airdrops devnet rate-limités* → prévoir 2 essais et un fallback
  `solana airdrop`.

### T00bis · Proposition de test contrôlée (index 1)

- Statut : FAIT. Une **VaultTransaction** et une **Proposal** d'index 1 créées
  et confirmées sur devnet. `transactionIndex = 1`.
- Rôles : `approver.json` (member local, Initiate + Vote + Execute) est le
  **creator Squads** des deux instructions ; `creator.json` est **uniquement
  fee payer et rent payer** — il n'est pas membre du multisig et ne doit jamais
  servir de creator Squads.
- Livrable : `scripts/create-test-proposal.ts` (mode `--check` sans écriture).
- Adresses :
  - Proposal PDA : `7XKcg9tfNATE9GsGh1fDfE5qsBfcghCgYwjpVy7z431M`
  - VaultTransaction PDA : `DApK9oeoSwG8KXWChZEsJ56Z2Gxk2S1CdHP3GZsoz635`
- Contenu enveloppé : une seule instruction `SystemProgram.transfer`, source =
  vault d'index 0, destination = approver local public, **montant = 0 lamport**,
  aucune Address Lookup Table, aucun memo, aucun autre programme.
- État on-chain constaté : statut **Active**, `approved.length = 0`,
  `rejected.length = 0`, vault **non financé** (0 lamport).
- Chaîne d'écriture : simulation sans erreur avant envoi, **un seul envoi**,
  signature vérifiée après coup (jamais de seconde tentative).
- Garde-fous du script : refuse toute création si `transactionIndex != 0`, si un
  PDA d'index 1 existe déjà, si les adresses publiques attendues diffèrent, ou
  si le creator Squads n'a pas Initiate + Vote. Aucune approbation, aucune
  exécution, aucun airdrop, aucun financement du vault.
- Aucune approbation ni exécution n'a été réalisée : T11 et T12 restent **non
  réalisés**.

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
- Statut : FAIT — état vide validé sur le Seeker : la fixture affichait
  « No proposals yet » (18 tests hors ligne passés, dont l'absence d'appel RPC
  quand `transactionIndex = 0`).
- Statut complémentaire : **FAIT avec liste non vide** — après création de la
  proposition d'index 1 (T00bis), l'application affiche sur le Seeker la ligne
  réelle `#1 · Active · 0 approval(s)`, lue depuis la chaîne via ce même chemin
  de lecture (aucune preview).
- Reste à faire : aucun écart connu sur ce périmètre. La lecture n'a été
  démontrée que sur une seule proposition d'index 1 ; les statuts autres que
  `Active` et l'exclusion liée à `staleTransactionIndex` restent non observés
  sur la chaîne.

### T09 · Décodage local + lecture réelle d'une VaultTransaction

- Statut : **FAIT** pour le périmètre « lecture et décodage de
  `SystemProgram.transfer` sans ALT ». Aucune écriture, aucune signature.
- Fichiers : `src/solana/decodeVaultTransaction.ts` (adaptateur
  `VaultTransactionMessage` → `TransactionInstruction[]`),
  `src/solana/decodeTransactionMessage.ts`, `src/squads/proposals.ts`
  (`loadProposalReview`), `src/screens/ConnectScreen.tsx`,
  `src/screens/TransactionReviewScreen.tsx`.
- Lecture réelle : **validée** sur la proposition d'index 1 de la fixture.
- Adaptateur : chaque `TransactionInstruction` web3.js est reconstruite depuis
  `accountKeys`, `programIdIndex`, `accountIndexes` et les données brutes ; les
  `AccountMeta` proviennent **uniquement** de `utils.isSignerIndex` et
  `utils.isStaticWritableIndex` du SDK officiel.
- Contrôles de bornes sur `programIdIndex` et chaque `accountIndex` avant
  reconstruction : toute incohérence donne `unknown` avec une note, sans
  exception levée.
- Les règles de revue ne sont pas dupliquées : les deux chemins (décompilation
  web3.js et reconstruction Squads) passent par le noyau partagé
  `modelFromInstructions()`.
- Résultat réel constaté : `SystemProgram.transfer`, source = vault attendu,
  destination conforme, montant **0 lamport**, `decodeStatus = decoded`.
- Revue réelle validée sur le Seeker ; **un seul appel RPC ciblé** par ouverture
  de revue (`getAccountInfo` sur le PDA de vault transaction dérivé de l'index).
  Aucun `getProgramAccounts`, aucun scan, aucune écriture.
- Fichier créé : `src/solana/decodeTransactionMessage.ts` —
  `decodeTransactionMessage(message, context, args?)`, fonction pure sans
  `Connection`, sans RPC, sans wallet, sans stockage, sans hook React.
- Périmètre d'interprétation : **seul `SystemProgram.transfer` est reconnu**.
  Tout autre programme est classé `unknown` avec son adresse brute préservée et
  aucune interprétation.
- Montants : conservés en **`bigint`** (jamais convertis en `number`) et
  affichés exactement en SOL et en lamports bruts via `formatLamportsExact`.
- La source décodée est **comparée explicitement au vault attendu** ; une source
  différente entraîne `partial` avec un avertissement nommant les deux adresses.
- Plusieurs instructions ⇒ `partial` : pas de résumé présenté comme un transfert
  unique entièrement décodé.
- Address Lookup Tables non résolues ⇒ revue refusée (`unknown`) avec le message
  « Address lookup table data is required to review this transaction. », **sans
  aucune résolution RPC ni heuristique**.
- Données d'instruction System invalides ⇒ `partial`, exception interceptée.
- Validation : **sept scénarios hors ligne** (0 lamport, montant positif, source
  inattendue, programme inconnu, multi-instructions, ALT non résolue, données
  invalides) + le formatage exact, tous passés sans réseau ni signature.
- Hors périmètre (explicitement non traité) : programmes autres que System
  Program ; Address Lookup Tables réelles ; plusieurs propositions réelles ;
  statuts on-chain autres que `Active` ; approbation ; exécution.
- T11 et T12 restent **non réalisés**.

## Phase 2 — Écriture (chemin sensible)

### T10 · Écran de confirmation (revue locale)

- Statut : **PARTIEL**. L'écran de revue réelle on-chain est validé : bandeau
  « On-chain proposal — Devnet », données réelles affichées (proposition #1,
  statut `Active`, source, destination, montant, statut de décodage). Le bouton
  de confirmation reste **désactivé** : aucune action on-chain n'est active.
  Les previews `__DEV__` restent présentes et strictement séparées du réel.
- Fichiers créés : `src/types/transactionReview.ts` (modèle strict +
  `DecodeStatus` + jeux de données preview locaux),
  `src/screens/TransactionReviewScreen.tsx` (composant de revue, lecture seule).
  `src/screens/ConnectScreen.tsx` : ScrollView + bouton de preview sous `__DEV__`.
- Modèle : chaque champ non disponible est modélisé `{ known: false }` et
  affiché « Unknown » — jamais déduit ni inventé. Trois états : `decoded`,
  `partial`, `unknown`, testés sur le Seeker avec les trois jeux preview.
- Sécurité : aucune fonction d'écriture importée, aucun appel RPC, aucune
  action au montage, aucune fermeture automatique, retour par bouton explicite,
  confirmation impossible pour tous les états y compris `decoded`.
- Reste à faire (T11/T12) : activer la confirmation après implémentation de la
  liste blanche et de `useWalletGuard` ; aucune approbation ni exécution n'est
  implémentée à ce jour.

### T11 · Approuver une proposition

- Statut : **RÉALISÉ** pour l'approbation mobile unique.
- Approbation **confirmée on-chain** depuis le Seeker : signature
  `3eEHoPURfothbgacpnWiVqiXpFYjByGZjWV6EBVTG5T6Rpd8UZx5bHFEvWB5aNhV8kQQ7FwgfNLZfBzBVXTJFD6v`,
  slot `501360279`, `meta.err = null`, fee payer = wallet Seeker.
- `approved.length = 1` (`7QYS4eNEF4givC2HPDhu6GYV1tR3bAji6Y5Fz3xdNKXg`), seuil 2/2,
  statut toujours **`Active`** — le SDK ne passe à `Approved` qu'au seuil atteint.
- **Anti-double approbation validé** : le guard repasse en `blocked` (raison
  « wallet a déjà approuvé ») et l'écran affiche un état positif — « Approved by
  this wallet », « 1 of 2 approvals confirmed on Devnet », « Waiting for 1 more
  approval » — le bouton d'approbation restant désactivé.
- Périmètre réellement implémenté : préparation gardée (`planProposalApproval`),
  seconde confirmation locale, une seule tentative d'envoi (`sendAndSendTransactions`
  via MWA), aucune reconstruction après signature, aucun retry.
- Fichiers : `src/squads/proposalApproval.ts`, `src/wallet/useWalletGuard.ts`,
  `src/squads/instructionAllowlist.ts`, `src/screens/TransactionReviewScreen.tsx`,
  `src/screens/ConnectScreen.tsx`.
- Aucune exécution : `vaultTransactionExecute` n'est jamais atteignable, le vault
  reste non financé (0 lamport). T12 reste **non réalisé**.

### T12 · Exécuter une transaction

- Statut : **NON RÉALISÉ**. Aucun code d'exécution, aucun appel
  `vaultTransactionExecute`, aucune dépense du vault.
- Objectif : `vaultTransactionExecute` signé via MWA, après confirmation.
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
