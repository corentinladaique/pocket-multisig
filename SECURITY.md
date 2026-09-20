# SECURITY.md — Pocket Multisig

Ces règles ne sont pas des recommandations. Elles sont vérifiées à chaque
étape de `TASKS.md`. Une violation bloque la tâche.

## 1. Réseau

- **Devnet uniquement.** Le cluster est une constante (`src/config.ts`) :
  `https://api.devnet.solana.com`, `chain = "solana:devnet"`.
- Aucune variable d'environnement, aucun réglage UI, aucun flag de build ne
  permet de basculer sur mainnet dans le MVP. Le changement de réseau exige une
  instruction explicite du donneur d'ordre + une revue de sécurité dédiée.
- Le programme Squads v4 est identique sur devnet et mainnet
  (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`) : la seule barrière est donc
  la constante RPC et le `chain` passé à `MobileWalletProvider`. Le second est
  aujourd'hui porté par la constante gelée `DEVNET_CHAIN` (`src/config.ts`).
  Ce refus est **effectif** : le module `src/wallet/useWalletGuard.ts` est actif
  et bloque toute session dont `chain !== "solana:devnet"` ou dont l'endpoint
  RPC diffère de l'endpoint devnet gelé. Validé sur la proposition #1 réelle
  depuis le Seeker. Aucune exécution n'est implémentée à ce jour.

## 2. Clés et secrets

- Ne **jamais** demander, lire, afficher, stocker ou journaliser une seed
  phrase, un mnémonique ou une clé privée.
- Ne jamais générer de keypair destiné à détenir des fonds réels.
- Les seuls `Keypair` autorisés sont ceux de `scripts/` (fixtures devnet,
  jetables, air-dropped) et ne doivent jamais être réutilisés hors devnet.
- Aucun secret dans le dépôt : pas de `.env` commité, pas de clé en dur, pas de
  fichier `id.json` versionné. `.gitignore` couvre `*.json` de keypair, `.env*`.
- Les logs applicatifs ne contiennent que des adresses publiques, des index et
  des signatures — jamais de bytes de signature de message arbitraire.

## 3. RPC et données

- Un seul RPC public, sans clé API. Si un RPC authentifié devient nécessaire,
  la clé passe par la config de build, jamais par le code source.
- Les réponses RPC ne sont pas une source de vérité fiable en soi :
  - toute adresse désérialisée est validée par `PublicKey` (`try/catch`) ;
  - toute donnée d'account est validée par le désérialiseur officiel
    `@sqds/multisig`, jamais par un parsing d'offsets maison ;
  - un compte qui échoue à se désérialiser est ignoré silencieusement côté
    liste, avec un compteur « n comptes illisibles » affiché.

## 4. Signature de transaction — écran de confirmation obligatoire

**PREVIEW LOCALE IMPLÉMENTÉE — AUCUNE ACTION ON-CHAIN.** L'écran de revue
existe (`src/screens/TransactionReviewScreen.tsx`) et affiche tous les champs
exigés ci-dessous, mais il n'est branché à **aucune** donnée on-chain : il ne
reçoit que des modèles locaux de démonstration
(`src/types/transactionReview.ts`), ouverts par un bouton visible uniquement
sous `__DEV__` et étiquetés « Development preview — not on-chain data ».

Aucun chemin de signature n'existe : l'application ne construit aucune
transaction et n'appelle ni `signAndSendTransactions` ni `signMessages`. Le
bouton de confirmation est présent mais **désactivé** (« Confirmation not
available yet ») et le restera tant que T11/T12 ne sont pas implémentés. La
règle ci-dessous reste bloquante pour ce moment-là : aucune fonctionnalité
d'écriture ne doit être livrée avant qu'elle soit satisfaite.

Cet écran affiche, en clair, AVANT toute signature :

1. Réseau : `DEVNET` (libellé visible et non ambigu).
2. Action : « Approuver la proposition #N » ou « Exécuter la transaction #N ».
3. Adresse du multisig (complet, avec bouton copier).
4. Adresse du vault concerné.
5. Index de transaction.
6. Cible et effet de l'instruction quand décodable : programme destinataire,
   montant en SOL, destination, changement de config (membres/seuil).
7. `feePayer` (doit être l'adresse connectée) et blockhash récent.
8. Bouton d'action distinct, libellé par verbe, jamais « OK ».

Deux validations programmatiques précèdent la signature :
- `tx.feePayer` égale l'adresse publique connectée, sinon refus ;
- le programme cible de chaque instruction est un programme connu sur devnet
  (Squads v4, System Program, Memo) ; sinon refus explicite.

Toute instruction non décodable est affichée comme telle (« instruction
illisible — vérifier sur l'explorer »), jamais masquée.

## 5. Instructions autorisées (liste blanche MVP)

**IMPLÉMENTÉE ET ACTIVE.** `src/squads/instructionAllowlist.ts` évalue chaque
revue et bloque tout programme hors liste, en complément du guard (§1) ; les
deux ont été validés sur la proposition #1 réelle. Elle ne reconnaît aujourd'hui
qu'**une seule** instruction : `SystemProgram.transfer`
(`11111111111111111111111111111111`). Toute autre instruction — y compris les
instructions Squads ci-dessous — reste refusée tant qu'elle n'est pas
explicitement autorisée :

- `multisig.instructions.proposalApprove`
- `multisig.instructions.vaultTransactionExecute`

Rien d'autre. Pas de création, pas de config transaction, pas de transfert
direct depuis le wallet connecté, pas de `system_program::transfer` initié par
nous.

## 6. Règles de revue imposées par le décodeur (T09)

Ces règles sont celles **effectivement implémentées** dans
`src/solana/decodeTransactionMessage.ts`. Elles s'appliquent à toute revue
affichée par `TransactionReviewScreen` :

- seul `SystemProgram.transfer` est actuellement reconnu ;
- toute autre instruction reste `unknown` (adresse brute préservée, aucune
  interprétation) ;
- une transaction comportant plusieurs instructions est classée `partial` tant
  que toutes ses instructions ne sont pas reconnues — elle n'est jamais résumée
  comme un transfert unique ;
- une source différente du vault attendu entraîne `partial`, avec un
  avertissement nommant la source décodée et le vault attendu ;
- une Address Lookup Table non résolue bloque la revue (`unknown`) sans aucune
  résolution RPC automatique ;
- les frais restent `Unknown` tant qu'aucune simulation n'a été faite ;
- toute future confirmation devra rester bloquée pour `partial` et pour
  `unknown` ;
- la confirmation est également **inactive aujourd'hui pour `decoded`** : le
  branchement on-chain n'existe pas encore.

Aucune approbation, aucune exécution et aucune signature n'est implémentée.

### 6.1 Revue réelle on-chain (lecture seule)

- La revue réelle est **strictement en lecture seule** : aucun chemin d'écriture
  n'est branché sur l'écran.
- Les comptes `VaultTransaction` et `Proposal` sont désérialisés par le **SDK
  officiel** (`VaultTransaction.fromAccountAddress` / `fromAccountInfo`,
  `Proposal.fromAccountAddress`).
- **Aucun parsing manuel** du compte Squads : aucun offset, aucune lecture
  d'octets bruts du compte.
- Chaque index d'instruction (`programIdIndex`, `accountIndexes`) est **contrôlé
  avant reconstruction** ; une incohérence produit `unknown` sans exception.
- Les drapeaux `isSigner` / `isWritable` viennent des helpers **officiels** du
  SDK (`utils.isSignerIndex`, `utils.isStaticWritableIndex`).
- Les Address Lookup Tables non résolues **bloquent le décodage** (aucun RPC
  automatique, aucune résolution heuristique).

## 7. Journalisation et erreurs

- Erreurs affichées avec : contexte utilisateur + message brut du RPC.
- Un rejet du wallet (refus de l'utilisateur) n'est jamais présenté comme une
  erreur technique.
- Les signatures sont affichées et copiables ; un lien explorer devnet les
  accompagne (`?cluster=devnet` obligatoire).

## 8. Checklist de revue (à passer à chaque tâche)

- [ ] Aucune référence à mainnet dans le diff.
- [ ] Aucun secret, aucune clé privée, aucune seed phrase dans le diff.
- [ ] Aucun chemin de signature sans écran de confirmation.
- [ ] Aucun parsing d'account maison.
- [ ] `npx tsc --noEmit` passe.
- [ ] Les tests de la tâche passent.
