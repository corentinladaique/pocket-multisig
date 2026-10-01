# ARCHITECTURE.md — Pocket Multisig

## 1. Vue d'ensemble

```
[ Seeker / appareil Android ]
        │
        │  Mobile Wallet Adapter (intent Android, session IPC)
        ▼
[ Wallet app MWA ]  ──signe──►  [ Pocket Multisig (Expo dev build) ]
                                        │
                                        │ JSON-RPC HTTPS
                                        ▼
                              [ https://api.devnet.solana.com ]
                                        │
                                        ▼
                        [ Programme Squads v4 SQDS4ep65…vj52pCf ]
```

Trois couches, aucune infra à nous :

1. **Wallet** : détient les clés (Seed Vault sur Seeker). L'application ne voit
   jamais de clé privée, seulement des signatures et l'adresse publique.
2. **App** : lit l'état on-chain via RPC public, construit les instructions,
   les fait signer par le wallet, relit le résultat. Aucun backend.
3. **Chaîne** : Squads v4 est la seule source de vérité (config, propositions,
   votes, exécution).

## 2. Arborescence (réelle)

```
pocket-multisig/
├── App.tsx                     # navigation par état local (pas d'expo-router)
├── index.ts / polyfill.js      # entry + polyfill crypto (react-native-quick-crypto)
├── app.json                    # config Expo (package Android, permissions)
├── src/
│   ├── config.ts               # DEVNET, endpoint RPC, identité dApp — constantes gelées
│   ├── screens/
│   │   ├── OnboardingScreen.tsx
│   │   ├── ConnectScreen.tsx            # accueil : wallet, RPC, vault, entrée
│   │   ├── MultisigDetailsScreen.tsx    # détail d'un multisig + entrées
│   │   ├── MultisigInboxScreen.tsx      # actions en attente
│   │   ├── ProposalListScreen.tsx       # liste (lecture, refresh on-chain)
│   │   ├── ProposalDetailsScreen.tsx    # détail, Approve / Execute
│   │   ├── NewProposalScreen.tsx        # création d'une proposition SOL
│   │   ├── CreateVaultScreen.tsx        # création d'un multisig + read-back
│   │   ├── TransactionReviewScreen.tsx  # vue technique READ-ONLY
│   │   ├── TransactionTechnicalDetails.tsx
│   │   └── reviewScreenCapabilities.ts  # capacités de la vue technique (pur)
│   ├── solana/
│   │   ├── connection.ts       # singleton Connection devnet + pingDevnet
│   │   ├── useRpcHealth.ts     # Checking / Online / Offline
│   │   ├── confirmSignature.ts # confirmation on-chain (bornée)
│   │   ├── decodeTransactionMessage.ts  # décodage (System Program only)
│   │   └── decodeVaultTransaction.ts
│   ├── squads/
│   │   ├── multisig.ts / useMultisigLookup.ts / proposals.ts
│   │   ├── instructionAllowlist.ts      # liste blanche de revue
│   │   ├── approvalOutcome.ts           # libellés/actions d'approbation (pur)
│   │   ├── proposalActionState.ts       # états exclusifs Approval/Action (pur)
│   │   ├── buildProposalCreation.ts / simulateProposalCreation.ts
│   │   ├── proposalCreationPreflight.ts / proposalApproval.ts
│   │   ├── signAndSendProposalCreation.ts
│   │   ├── signAndSendProposalApproval.ts
│   │   └── signAndSendProposalExecution.ts
│   ├── vault/
│   │   ├── vaultDraft.ts / multisigCreationPlan.ts
│   │   ├── buildMultisigCreation.ts / simulateMultisigCreation.ts
│   │   ├── multisigCreationPreflight.ts / signAndSendMultisigCreation.ts
│   │   ├── multisigCreationReadBack.ts  # invariants de read-back (pur, partagé)
│   │   ├── multisigCreationCost.ts / thresholdRecommendation.ts
│   │   ├── maxTransfer.ts / solAmount.ts
│   │   ├── multisigRegistry.ts / multisigRegistryStorage.ts
│   │   └── deviceRegistryStorage.ts / useMultisigRegistry.ts
│   ├── wallet/
│   │   ├── useWalletGuard.ts   # refus si cluster != devnet (gelé)
│   │   ├── operationState.ts   # machine d'état d'une tentative
│   │   ├── signingWindow.ts    # fenêtre de signature jugée EN BLOCS
│   │   ├── asyncDeadline.ts    # bornes de temps (préparation / wallet)
│   │   ├── vaultCreationState.ts
│   │   ├── vaultBalance.ts / fiatEstimate.ts
│   │   └── mwaDiagnostics.ts
│   ├── onboarding/ (profile.ts, content.ts, useOnboarding.ts)
│   ├── ui/ (AddressInput.tsx, addressPaste.ts, safeArea.ts, safeAreaPadding.ts)
│   └── types/transactionReview.ts
└── scripts/                    # fixtures devnet (manuelles) + tests purs *.test.ts
```

## 3. ADR (décisions + justification)

**ADR-1 — `@wallet-ui/react-native-web3js` (web3.js v1), pas @solana/kit.**
`@sqds/multisig@2.1.4` dépend de `@solana/web3.js` v1. Mélanger les familles
duplique les types `PublicKey` et casse les builders. On reste sur web3.js v1.

**ADR-2 — Découverte automatique : reportée.** Pas d'index inverse « membre →
multisig » on-chain ; un `getProgramAccounts` balayé serait coûteux et fragile.
L'utilisateur saisit l'adresse du multisig.

**ADR-3 — Ne jamais parser l'account `Multisig` à la main.** La disposition
binaire réelle n'est pas celle qu'on croit (`rentCollector: COption<PublicKey>`
décale les champs suivants). Toute désérialisation passe par le SDK officiel.

**ADR-4 — Énumération des propositions par dérivation de PDA.** On itère
`index ∈ [staleTransactionIndex, transactionIndex]`, on dérive les PDA
`Proposal` / `VaultTransaction`, et on lit en un `getMultipleAccountsInfo`.

**ADR-5 — Pas de dépendance nouvelle.** Candidats refusés : `@solana/spl-token`,
indexers tiers, libs d'état global — remplacés par des hooks locaux.

**ADR-6 — Un seul verdict de read-back, partagé.** Les invariants qui
autorisent « vérifié » (propriétaire, configAuthority, threshold, membres et
permissions, timeLock, rentCollector, adresse attendue) vivent dans un module
pur unique (`vault/multisigCreationReadBack.ts`) utilisé par le read-back
initial **et** par `Check transaction again`. Deux chemins ne peuvent plus
diverger.

**ADR-7 — Toute opération d'écriture est bornée dans le temps.** Un `finally`
ne s'exécute que si la promesse se règle : les préparations et l'attente wallet
sont donc bornées (`wallet/asyncDeadline.ts`) pour qu'aucun écran ne reste
bloqué, et « un seul envoi » reste garanti par la machine d'état.

## 4. Flux de données

**Lecture** : multisig par adresse (SDK officiel) → propositions par
dérivation de PDA + `getMultipleAccountsInfo` → décodage du message
(System Program only). Un `transactionIndex === 0` ne dérive aucun PDA et
n'appelle aucun RPC.

**Écriture** (quatre flux, même discipline) :
1. Construction locale (plan → instructions → `Transaction`, `feePayer` = membre).
2. Préflight et **simulation** avec un blockhash frais.
3. **Fenêtre de signature** jugée en blocs : si la marge est insuffisante, le
   wallet n'est pas ouvert.
4. Un seul `signAndSendTransactions` (MWA).
5. **Confirmation** on-chain, puis **read-back métier**.
6. Aucun second envoi automatique ; la reprise (`Check … again`) est en lecture
   seule. Succès seulement si les preuves concordent.

## 5. Contraintes d'environnement constatées

- Node 20.x, JDK 17, `adb` présent, SDK Android dans `~/Android/Sdk`
  (`android/local.properties` requis pour Gradle, ignoré par Git).
- MWA utilise des modules natifs Kotlin → **Expo Go inutilisable**, development
  build obligatoire.
- Polyfill nécessaire : `crypto` seul (`react-native-quick-crypto`).

## 6. Ce que nous ne construisons pas (et pourquoi)

| Écarté | Raison |
| --- | --- |
| Backend d'indexation | Coût, secrets à gérer ; la chaîne suffit pour un MVP |
| Base locale (SQLite) | L'état on-chain est la vérité ; un cache mémoire suffit |
| Smart contract maison | Inutile ; Squads v4 fournit le protocole |
| Support SPL / tokens (SKR, ORE) | Hors périmètre MVP, surface de sécurité supplémentaire |
| iOS | MWA n'existe pas sur iOS |
| Mainnet | Interdit jusqu'à instruction explicite (SECURITY §1) |
| Address Lookup Tables | Non supportées à l'exécution (échec explicite) |
