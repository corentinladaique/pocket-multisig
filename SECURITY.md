# SECURITY.md — Pocket Multisig

Ces règles ne sont pas des recommandations. Elles décrivent le comportement
**réellement implémenté** et vérifié dans ce dépôt, et ce qui reste ouvert.

> **Ce prototype n'a pas été audité professionnellement.** Il est fourni tel
> quel, sans garantie, pour une démonstration **devnet**. Il ne doit pas servir
> à gérer des actifs réels.

## 1. Réseau

- **Devnet uniquement.** Le cluster est une constante (`src/config.ts`) :
  `https://api.devnet.solana.com`, `chain = "solana:devnet"`.
- Aucune variable d'environnement, aucun réglage UI, aucun flag de build ne
  permet de basculer sur mainnet dans le MVP.
- Le programme Squads v4 est identique sur devnet et mainnet
  (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`) : les barrières sont la
  constante RPC gelée et le `chain` passé à `MobileWalletProvider`.
  `src/wallet/useWalletGuard.ts` est actif : il bloque toute session dont
  `chain !== "solana:devnet"` ou dont l'endpoint diffère de l'endpoint devnet
  gelé. Le contrôle de réseau reste **dérivé de la constante qui a servi à
  construire la connexion** (voir §9, risque ouvert).

## 2. Clés et secrets

- Ne **jamais** demander, lire, afficher, stocker ou journaliser une seed
  phrase, un mnémonique ou une clé privée.
- Les seuls `Keypair` du projet vivent dans `scripts/` (fixtures devnet,
  jetables) et dans le signataire éphémère `createKey` d'une création de
  multisig — gardé **en mémoire seule**, jamais persisté, jamais journalisé,
  jamais fee payer.
- Aucun secret dans le dépôt : pas de `.env` commité, pas de clé API, pas de
  fichier de keypair versionné. `.gitignore` couvre `*.json` de keypair et
  `.env*`. Le keystore de signature release n'est jamais versionné.
- Les logs applicatifs ne contiennent que des adresses publiques, des index et
  des signatures.

## 3. RPC et données

- Un seul RPC public, sans clé API. Si un RPC authentifié devient nécessaire,
  la clé passera par la config de build, jamais par le code source.
- Les réponses RPC ne sont pas une source de vérité en soi :
  - toute adresse désérialisée est validée par `PublicKey` (`try/catch`) ;
  - toute donnée d'account est validée par le **désérialiseur officiel**
    `@sqds/multisig`, jamais par un parsing d'offsets maison ;
  - un compte qui échoue à se désérialiser est ignoré (compteur « n comptes
    illisibles » affiché), jamais interprété.

## 4. Les quatre flux d'écriture

Tous suivent la même discipline : **devnet**, construction locale, verdict de
fenêtre de signature **avant** d'ouvrir le wallet, un seul envoi, confirmation
on-chain, read-back métier, aucune seconde tentative automatique.

### 4.1 Créer un multisig — `src/vault/signAndSendMultisigCreation.ts`
1. Plan + preflight + simulation avec un blockhash frais unique.
2. `createKey` éphémère signe en local (`partialSign`) ; il ne paie jamais.
3. Fenêtre de signature évaluée **en blocs** (`evaluateSigningWindow`) : si la
   marge est insuffisante, le wallet n'est pas ouvert.
4. Un seul `signAndSendTransactions` (wallet MWA), une seule fois.
5. Confirmation on-chain puis **read-back vérifié** : propriétaire du compte,
   `configAuthority`, threshold, nombre de membres, **adresses ET masques de
   permissions** des membres (ordre ignoré), `timeLock`, `rentCollector`, et
   l'adresse attendue de la tentative signée.
6. `Vault created and verified.` n'est affiché que si les trois preuves
   concordent. En cas de divergence, l'écran affiche « Transaction confirmed »
   + « Vault verification: failed » et **aucun second envoi**.
7. Reprise : `Check transaction again` est **strictement en lecture**
   (statut de signature, hauteur de bloc, `getAccountInfo`) et applique **les
   mêmes invariants** que le read-back initial (fonction pure commune
   `src/vault/multisigCreationReadBack.ts`).

### 4.2 Créer une proposition — `src/squads/signAndSendProposalCreation.ts`
1. Préflight local, puis simulation ; aucun envoi avant un succès de simulation.
2. Une seule transaction : `vaultTransactionCreate` + `proposalCreate`.
3. Blockhash frais, fenêtre en blocs, un seul envoi, confirmation, read-back
   de la `Proposal` et de la `VaultTransaction`.
4. Le formulaire n'accepte que des montants en **SOL** (conversion entière
   exacte, 9 décimales max, zéro flottant) ; le montant transféré est appliqué
   à l'exécution, pas à la création.

### 4.3 Approuver — `src/squads/signAndSendProposalApproval.ts`
1. Le plan **relit la `Proposal` on-chain** : statut `Active`, rôle `Vote`,
   refus si le wallet a **déjà** approuvé.
2. Blockhash frais, fenêtre en blocs, un seul `proposalApprove`.
3. Bornes de temps : préparation (avant wallet) et attente wallet sont bornées
   ; un dépassement laisse toujours le chargement se terminer proprement.
4. Confirmation + read-back de la `Proposal`. Anti-double-approbation à trois
   niveaux : UI désactivée pendant la tentative, verrou local, refus on-chain.
5. `Already approved` / « Approved by you » est **dérivé du read-back**, jamais
   d'un état mémoire seul. `Check approval again` ne fait que des lectures
   (aucun wallet, aucun envoi).

### 4.4 Exécuter — `src/squads/signAndSendProposalExecution.ts`
1. Préconditions : statut `Approved`, seuil réellement atteint, rôle `Execute`.
2. Solde du vault **relu** avant envoi ; un solde insuffisant refuse.
3. Un seul `vaultTransactionExecute` ; confirmation ; read-back (statut de la
   `Proposal` après exécution, variation de solde du vault).
4. Les Address Lookup Tables non résolues **échouent explicitement**
   (`AddressLookupTablesUnsupported`) : aucune résolution heuristique.

## 5. Instructions autorisées (liste blanche)

`src/squads/instructionAllowlist.ts` évalue la revue d'une instruction
embarquée et bloque tout programme hors liste, en complément du guard (§1).
Aujourd'hui elle ne reconnaît que le **System Program**
(`11111111111111111111111111111111`) — c'est-à-dire le contenu du transfert
SOL stocké dans une proposition. Toute instruction inconnue reste refusée et
la confirmation est bloquée pour tout décodage `partial` ou `unknown`.

Les instructions que **l'application construit elle-même** (Squads v4 :
`multisigCreateV2`, `vaultTransactionCreate`, `proposalCreate`,
`proposalApprove`, `vaultTransactionExecute`) sont, elles, limitées au SDK
officiel et ne sont jamais construites à partir d'une entrée utilisateur
arbitraire.

## 6. Revue et décodage

- `src/solana/decodeTransactionMessage.ts` ne reconnaît que le System Program ;
  toute autre instruction reste `unknown` (adresse brute préservée, aucune
  interprétation).
- Une transaction multi-instructions est `partial` tant que toutes ne sont pas
  reconnues : elle n'est jamais résumée comme un transfert unique.
- `TransactionReviewScreen` est une vue technique **facultative et strictement
  en lecture seule** : aucun wallet, aucune signature, aucun envoi.
- Toute la désérialisation passe par le SDK officiel ; aucun offset maison.

## 7. Journalisation et erreurs

- Erreurs affichées avec contexte utilisateur + message brut dans une section
  « Troubleshooting details » repliable, fermée par défaut.
- Un rejet du wallet n'est jamais présenté comme une erreur technique.
- Les signatures sont affichées et copiables.

## 8. Stockage local

- Registre local (AsyncStorage) : adresses publiques, noms locaux et labels de
  membres. **Rien n'est synchronisé**, aucun label n'est écrit on-chain, aucun
  secret n'y est stocké.
- Un multisig « observé » (adresse collée) est distinct d'un multisig
  « créé » ; les permissions sont toujours revérifiées on-chain.

## 9. Risques ouverts (assumés pour le MVP)

- **RPC public unique**, sans fallback ni RPC authentifié.
- **Garde réseau tautologique** : le contrôle compare la connexion à la
  constante qui a servi à la construire ; il ne prouve pas l'absence de
  mélange de réseaux par un canal indépendant.
- **Identité dApp** présentée aux wallets : valeur de développement à
  remplacer par une identité officielle du projet (voir `src/config.ts`).
- **Dépendances** : `npm audit` remonte des vulnérabilités hautes transitives
  (dont `bigint-buffer` via la chaîne Squads), non corrigées à ce jour.
- **Address Lookup Tables** non supportées à l'exécution.
- **Pas de CI** : les tests purs sont lancés manuellement (`npm test`).
- Aucun test d'intégration on-chain automatisé : les validations réelles sont
  manuelles, sur Seeker.

## 10. Absence d'audit

Ce projet **n'a pas été audité** et n'est pas présenté comme un audit. Les
mécanismes ci-dessus réduisent les risques connus ; ils ne prouvent pas
l'absence de vulnérabilité.

## 11. Checklist de revue

- [ ] Aucune référence à mainnet dans le diff.
- [ ] Aucun secret, aucune clé privée, aucune seed phrase dans le diff.
- [ ] Aucun chemin de signature sans écran de confirmation.
- [ ] Aucun parsing d'account maison.
- [ ] Aucun second envoi après une signature obtenue.
- [ ] `npm run typecheck` passe.
- [ ] Les tests de la tâche passent.
