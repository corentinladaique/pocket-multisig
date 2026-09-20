# ARCHITECTURE.md — Pocket Multisig

## 1. Vue d'ensemble

```
[ Seeker / émulateur Android ]
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

1. **Wallet** : détient les clés (Seed Vault sur Seeker). Nous ne voyons jamais
   de clé privée, seulement des signatures et l'adresse publique.
2. **App** : lit l'état on-chain via RPC public, construit les instructions,
   les fait signer par le wallet. Aucun état persistant obligatoire.
3. **Chaîne** : Squads v4 est la seule source de vérité (config, propositions,
   votes). Pas de base de données, pas d'indexer, pas de backend.

## 2. Arborescence cible

```
pocket-multisig/
├── AGENTS.md                  # règles de travail (ce dépôt)
├── PRODUCT.md
├── ARCHITECTURE.md
├── SECURITY.md
├── TASKS.md
├── app.json                   # config Expo (package Android, permissions)
├── package.json               # "main": "index.ts", script android
├── tsconfig.json              # strict: true
├── index.ts                   # entry : importe ./polyfill AVANT tout
├── polyfill.js                # react-native-quick-crypto : crypto uniquement
├── App.tsx                    # navigation simple (état local, sans expo-router)
├── src/
│   ├── config.ts              # DEVNET, endpoint RPC, identité — constantes gelées
│   ├── screens/
│   │   └── ConnectScreen.tsx  # écran unique : wallet, RPC, multisig, propositions
│   ├── solana/
│   │   ├── connection.ts      # singleton Connection devnet + pingDevnet (gelé)
│   │   └── useRpcHealth.ts    # état Checking / Online / Offline (gelé)
│   └── squads/
│       ├── multisig.ts        # [gelé] lecture config + vault PDA (SDK officiel)
│       ├── useMultisigLookup.ts # [gelé] état de la recherche manuelle
│       └── proposals.ts       # [gelé] énumération des propositions (lecture seule)
└── scripts/
    └── create-devnet-fixture.ts  # crée le multisig devnet (ne pas relancer)

Fichiers PRÉVUS, non encore créés (à ne pas confondre avec l'existant) :
    src/solana/explorer.ts        # helpers d'URL explorer + formatage
    src/squads/discovery.ts       # recherche des multisigs d'un membre (reporté)
    src/squads/decode.ts          # décodage du message d'une vault transaction
    src/squads/actions.ts         # builders approve / execute (build only)
    src/wallet/useWalletGuard.ts  # refus si cluster != devnet
    src/types.ts                  # types de vue transverses
    src/ui/                       # composants réutilisables
    src/screens/MultisigScreen.tsx, ProposalScreen.tsx, ConfirmScreen.tsx
```

## 3. ADR (décisions + justification)

**ADR-1 — `@wallet-ui/react-native-web3js` plutôt que `@wallet-ui/react-native-kit`.**
`@sqds/multisig@2.1.4` dépend de `@solana/web3.js` **v1** (`^1.70.3`) et de
`@metaplex-foundation/beet`. Le kit expose des `Address`/@solana/kit : mélanger
les deux familles duplique les types `PublicKey` et casse les builders
d'instructions. On reste donc sur la famille web3.js v1 de bout en bout.

**ADR-2 — Découverte automatique : reportée, non implémentée.**
Il n'existe pas d'index on-chain inverse « membre → multisig » : l'adresse d'un
multisig est dérivée d'un `createKey` arbitraire, et `Multisig.members` est un
`Vec<Member>` sans table d'index. La seule voie sans backend serait un balayage
`getProgramAccounts` filtré. Ce balayage **n'est pas retenu dans le MVP** : il
est coûteux, fragile face à une population de comptes hétérogène, et inutile
pour la démonstration. À la place, l'utilisateur saisit l'adresse du multisig
(T05A). La décision sera réexaminée après le MVP.

**ADR-3 — Ne jamais parser l'account `Multisig` à la main.**
La disposition binaire réelle des comptes Squads v4 n'est pas celle qu'on
croit : le type officiel expose notamment `rentCollector: COption<PublicKey>`,
absent de certaines pages de documentation, ce qui décale les champs suivants.
Une lecture par offsets codés en dur (explorée pendant le cadrage) a été
**abandonnée et n'est pas implémentée** : elle serait fausse sur une partie des
comptes, y compris sur ceux que nous avons créés. Règle définitive : toute
désérialisation passe par `multisig.accounts.Multisig.fromAccountAddress()`
(et les autres classes officielles du SDK) ; un compte qui échoue à se
désérialiser est ignoré proprement, jamais interprété.

**ADR-4 — Énumération des propositions par dérivation de PDA.**
`Proposal` et `VaultTransaction` sont des PDA dérivés de
`["multisig", multisig, "transaction", index]` (+ `"proposal"`). On itère donc
`index ∈ [1, multisig.transactionIndex]`, on dérive les deux PDA, et on lit tout
d'un coup via `getMultipleAccounts`. Pas de `getProgramAccounts` filtré
(les comptes `Proposal` n'ont pas de filtre discriminant utile).

**ADR-5 — Pas de dépendance nouvelle hors liste AGENTS.md.**
Chaque ajout doit être justifié par un besoin non couvert. Candidats refusés :
`@solana/spl-token` (déjà transitif, inutile pour le MVP), indexers tiers,
libs d'état global (`react-query`, `zustand`) — remplacés par des hooks locaux.

## 4. Flux de données

**Découverte — reportée.** Non implémentée dans le MVP (voir ADR-2). Le
multisig est chargé par saisie manuelle de son adresse, puis lu via le SDK
officiel (`Multisig.fromAccountAddress`), ce qui constitue un seul appel RPC.

**Propositions (implémenté, lecture seule)**
1. `transactionIndex` et `staleTransactionIndex` lus sur le compte du multisig.
2. Si `transactionIndex === 0` : liste vide immédiate, **aucun PDA dérivé,
   aucun appel RPC** (règle instrumentée par `rpcCalls = 0`).
3. Sinon, pour `i ∈ [staleTransactionIndex, transactionIndex]` : dérivation
   locale des PDA `Proposal` et `VaultTransaction`.
4. Un seul `getMultipleAccountsInfo` sur les PDA de proposition.
5. Désérialisation par `Proposal.fromAccountInfo` ; les comptes absents ou
   illisibles sont comptés et ignorés, jamais interprétés.
6. Modèle d'affichage minimal : index, statut (`__kind`), nombre d'approbations.

**Vote / exécution**
1. `multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member })`
   → `TransactionInstruction`.
2. `multisig.instructions.vaultTransactionExecute({ multisigPda, transactionIndex, member })`.
3. Instruction → `Transaction` (`new Transaction().add(ix)`), `recentBlockhash`,
   `feePayer = member`.
4. **Écran de confirmation** (SECURITY §4) puis `signAndSendTransactions` du
   hook `useMobileWallet`.
5. Affichage de la signature + lien explorer devnet. Rafraîchissement de l'état.

## 5. Contraintes d'environnement constatées (2026-09-19)

- Node 20.20.2, npm 10.8.2, JDK 17, `adb` présent, Gradle cache présent.
- SDK Android présent dans `~/Android/Sdk` ; `ANDROID_HOME` doit être exporté
  dans le shell courant et `android/local.properties` renseigné pour Gradle.
  Ce n'est **plus** un blocage : le build et l'installation sur Seeker ont été
  réalisés avec succès.
- `@solana-mobile/mobile-wallet-adapter-protocol` 2.3.0 utilise des modules
  Kotlin natifs → **Expo Go est inutilisable**, development build obligatoire.
- Polyfills réellement nécessaires à ce jour : **`crypto` seul**
  (`react-native-quick-crypto`). `Buffer` et `assert` n'ont pas eu à être
  exposés globalement : ils arrivent en dépendances transitives du SDK Squads
  et sont résolus par le bundler.

## 6. Ce que nous ne construisons pas (et pourquoi)

| Écarté | Raison |
| --- | --- |
| Backend d'indexation | Coût, complexité, secrets à gérer ; la chaîne suffit pour un MVP |
| Base locale (SQLite) | L'état on-chain est la vérité ; un cache mémoire suffit |
| Smart contract maison | Interdit par le cahier des charges, inutile |
| iOS | MWA n'existe pas sur iOS |
| Mainnet | Interdit jusqu'à instruction explicite (SECURITY §1) |
