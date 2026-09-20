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
  *(PLANNED / non implémenté : le module `src/wallet/useWalletGuard.ts`, qui
  refuserait explicitement toute session dont `chain !== "solana:devnet"`.
  Aucune protection de ce type n'est active pour l'instant — il n'existe aucun
  chemin de signature dans l'application.)*

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

**PLANNED / non implémenté.** La liste blanche n'est pas encore appliquée dans
le code : elle n'a de sens qu'accompagnée de l'écran de confirmation (§4).
Liste prévue :

- `multisig.instructions.proposalApprove`
- `multisig.instructions.vaultTransactionExecute`

Rien d'autre. Pas de création, pas de config transaction, pas de transfert
direct depuis le wallet connecté, pas de `system_program::transfer` initié par
nous.

## 6. Journalisation et erreurs

- Erreurs affichées avec : contexte utilisateur + message brut du RPC.
- Un rejet du wallet (refus de l'utilisateur) n'est jamais présenté comme une
  erreur technique.
- Les signatures sont affichées et copiables ; un lien explorer devnet les
  accompagne (`?cluster=devnet` obligatoire).

## 7. Checklist de revue (à passer à chaque tâche)

- [ ] Aucune référence à mainnet dans le diff.
- [ ] Aucun secret, aucune clé privée, aucune seed phrase dans le diff.
- [ ] Aucun chemin de signature sans écran de confirmation.
- [ ] Aucun parsing d'account maison.
- [ ] `npx tsc --noEmit` passe.
- [ ] Les tests de la tâche passent.
