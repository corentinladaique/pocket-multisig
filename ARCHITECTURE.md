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
├── polyfill.js                # react-native-quick-crypto + Buffer + assert
├── App.tsx                    # navigation simple (état local, sans expo-router)
└── screens/                   # écrans (navigation simple)
    ├── ConnectScreen.tsx      # écran 1 : connexion wallet
    ├── MultisigsScreen.tsx    # écran 2 : liste des multisigs du wallet
    ├── MultisigScreen.tsx     # écran 3 : membres / seuil / vault
    ├── ProposalScreen.tsx     # écran 4 : détail proposition
    └── ConfirmScreen.tsx      # écran 5 : confirmation avant signature
├── src/
│   ├── config.ts              # DEVNET, PROGRAM_ID, RPC — constantes gelées
│   ├── solana/
│   │   ├── connection.ts      # singleton Connection devnet
│   │   └── explorer.ts        # helpers d'URL explorer + formatage
│   ├── squads/
│   │   ├── discovery.ts       # rechercher les multisigs d'un membre
│   │   ├── multisig.ts        # lecture config + vault PDA + solde
│   │   ├── proposals.ts       # énumération + lecture des propositions
│   │   ├── decode.ts          # décodage du message d'une vault transaction
│   │   └── actions.ts         # builders approve / execute (build only)
│   ├── wallet/
│   │   └── useWalletGuard.ts  # refus si cluster != devnet
│   ├── ui/                    # composants réutilisables (Card, Row, Badge…)
│   └── types.ts               # types de vue (MultisigView, ProposalView…)
└── scripts/
    └── create-devnet-fixture.ts  # crée un multisig + une proposition devnet
```

## 3. ADR (décisions + justification)

**ADR-1 — `@wallet-ui/react-native-web3js` plutôt que `@wallet-ui/react-native-kit`.**
`@sqds/multisig@2.1.4` dépend de `@solana/web3.js` **v1** (`^1.70.3`) et de
`@metaplex-foundation/beet`. Le kit expose des `Address`/@solana/kit : mélanger
les deux familles duplique les types `PublicKey` et casse les builders
d'instructions. On reste donc sur la famille web3.js v1 de bout en bout.

**ADR-2 — Découverte on-chain par `getProgramAccounts` + filtres `memcmp`.**
Il n'existe pas d'index on-chain inverse « membre → multisig » : l'adresse d'un
multisig est derivée d'un `createKey` arbitraire, et `Multisig.members` est un
`Vec<Member>` sans table d'index. Vérifié : requête `getProgramAccounts` sur le
programme v4 avec `memcmp` sur les offsets de slot membre, filtrée par le
discriminator `e07479ba44a14fec` → résultat exact obtenu sur devnet **et**
mainnet. C'est la seule voie sans backend.

**ADR-3 — Ne jamais parser l'account `Multisig` à la main.**
Constat expérimental (devnet, 17153 comptes ; mainnet, 156 699) : la disposition
réelle diffère de la doc Squads. Le champ `rent_collector: Option<Pubkey>`
(cf. instruction « Set Rent Collector ») **décale le `Vec<Member>` de 0 ou 32
octets**, soit un slot 0 à l'offset 100 ou 132, et non 100 partout. On utilise
toujours `multisig.accounts.Multisig.fromAccountAddress()` et on ignore les
comptes qui échouent à la désérialisation (population hétérogène constatée sur
devnet).

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

**Découverte**
1. Le wallet renvoie l'adresse publique (web3.js `PublicKey`).
2. Pour chaque slot `s ∈ [0..7]` et chaque base `b ∈ {100, 132}` :
   `getProgramAccounts(program, filters=[disc, memcmp(offset=b+33s, member)],
   dataSlice=0)`.
3. Union des adresses (dédupliquées) → jeu de candidats.
4. `getMultipleAccounts` sur les candidats → `Multisig.fromAccountAddress`.
5. Filtrage final : l'adresse est-elle réellement dans `members` ?
   (le `memcmp` peut matcher un compte désérialisé par une autre version)

**Propositions**
1. `transactionIndex` courant depuis la config.
2. Pour `i ∈ [1, transactionIndex]` : dériver `proposalPda` + `vaultTransactionPda`.
3. `getMultipleAccounts` → `Proposal` (statut, approved/rejected) et
   `VaultTransaction` (message à décoder).
4. Écarter les `i < staleTransactionIndex`.

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
- `ANDROID_HOME` **non défini** → `expo run:android` échouera tant que le SDK
  Android n'est pas configuré (`ANDROID_HOME` + `platform-tools`).
- `@solana-mobile/mobile-wallet-adapter-protocol` 2.3.0 utilise des modules
  Kotlin natifs → **Expo Go est inutilisable**, development build obligatoire.
- `@sqds/multisig` a besoin de `Buffer` et `assert` globaux (via beet/bn.js) :
  le polyfill ne se limite pas à `crypto`.

## 6. Ce que nous ne construisons pas (et pourquoi)

| Écarté | Raison |
| --- | --- |
| Backend d'indexation | Coût, complexité, secrets à gérer ; la chaîne suffit pour un MVP |
| Base locale (SQLite) | L'état on-chain est la vérité ; un cache mémoire suffit |
| Smart contract maison | Interdit par le cahier des charges, inutile |
| iOS | MWA n'existe pas sur iOS |
| Mainnet | Interdit jusqu'à instruction explicite (SECURITY §1) |
