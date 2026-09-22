# Vault creation — Squads Protocol v4 (devnet)

Document technique local, **aucune exécution** : rien n'est signé, envoyé,
simulé, ni même construit on-chain à ce stade. Toutes les références ci-dessous
proviennent de l'IDL et des types du paquet installé (lecture locale, hors
réseau) :

- `node_modules/@sqds/multisig/lib/instructions/multisigCreateV2.d.ts`
- `node_modules/@sqds/multisig/lib/generated/instructions/multisigCreateV2.d.ts`
- `node_modules/@sqds/multisig/lib/generated/types/MultisigCreateArgsV2.d.ts`
- `node_modules/@sqds/multisig/lib/generated/types/Member.d.ts`
- `node_modules/@sqds/multisig/lib/types.d.ts` (Permission, Permissions)
- `node_modules/@sqds/multisig/lib/pda.d.ts`
- `node_modules/@sqds/multisig/idl/squads_multisig_program.json` (erreurs)

Programme : `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` — devnet uniquement.

## 1. Comptes nécessaires

`multisigCreateV2` (généré solita) déclare exactement cinq comptes :

| Compte | Contrainte | Rôle |
| --- | --- | --- |
| `programConfig` | lecture seule | PDA de configuration du programme (`getProgramConfigPda`) |
| `treasury` | writable | trésorerie du programme, reçoit les frais de création |
| `multisig` | writable | PDA du nouveau multisig (`getMultisigPda({ createKey })`) |
| `createKey` | **signer** | clé éphémère qui détermine l'adresse du multisig |
| `creator` | writable + **signer** | payeur du rent ; devient `configAuthority` par défaut si fourni |

Comptes dérivés (aucun n'est créé par cette instruction) :

- `getMultisigPda({ createKey })` → adresse du compte `Multisig`.
- `getVaultPda({ multisigPda, index: 0 })` → vault (index 0). Sa création
  appartient au programme, pas à `multisigCreateV2` : à confirmer sur
  l'implémentation avant la phase d'écriture réelle.
- `createKey` doit être une `Keypair` générée à la volée, **jamais persistée**
  (SECURITY.md) : elle sert uniquement de graine de dérivation du PDA et de
  signataire de cette transaction.

## 2. Paramètres requis (`MultisigCreateArgsV2`)

| Champ | Type | Valeur Pocket Multisig |
| --- | --- | --- |
| `threshold` | `number` | dérivé du wizard (1..nombre de membres) |
| `members` | `Member[]` | `{ key: PublicKey, permissions: Permissions }` |
| `configAuthority` | `COption<PublicKey>` | `null` = configuration **figée** ; sinon une clé pourra modifier membres/seuil |
| `timeLock` | `number` | `0` (aucun délai on-chain sur le MVP) |
| `rentCollector` | `COption<PublicKey>` | `null` (rent rendu au créateur) |
| `memo` | `COption<string>` | optionnel, aucun secret, jamais d'information personnelle |

`Member` ne contient **que** `key` et `permissions` : le label du wizard
(« Ledger at home ») et le `vaultName` n'existent **pas** on-chain. Ils devront
être conservés localement (fichier/état de l'app) ou réintroduits plus tard via
un mécanisme séparé — décision à prendre avant la Phase 3.

## 3. Structure attendue

- `threshold` : `1 ≤ threshold ≤ members.length`. Le wizard garantit déjà la
  borne haute (et impose 3 signers pour le preset 2 of 3).
- `members` : au moins un membre, aucune clé dupliquée. Chaque membre reçoit un
  masque de permissions.
- `permissions` (`types.d.ts`) : `Initiate = 1`, `Vote = 2`, `Execute = 4` ;
  `Permissions.fromPermissions([...])`, `Permissions.all()` (= 7),
  `Permissions.has(mask, permission)`. Valeur recommandée pour tous les
  signataires du MVP : `Initiate | Vote | Execute`.
- `configAuthority` : `null` pour un vault personnel définitif. Toute valeur non
  nulle crée un pouvoir d'administration hors quorum — à éviter en MVP.

## 4. Instructions Squads à construire

1. `multisigCreateV2({ programConfig, treasury, multisigPda, createKey,
   creator, threshold, members, timeLock, rentCollector, memo, programId })`
   → renvoie une `TransactionInstruction` (`TransactionInstruction[]` de une à
   deux entrées une fois les dérivations ajoutées, si nécessaire).
2. Ne **pas** utiliser `multisigCreate` (v1) : l'IDL expose l'erreur
   `MultisigCreateDeprecated`.
3. Aucune autre instruction n'est nécessaire à la création : ni
   `proposalCreate`, ni `vaultTransactionCreate`, ni activation de proposition.
   Le premier mouvement de fonds est un acte séparé, plus tard.

## 5. Signatures réellement nécessaires

- `creator` (payeur, signé par le wallet Mobile Wallet Adapter connecté) ;
- `createKey` (signataire éphémère, détenu en mémoire le temps de l'envoi).

**Les membres ne signent pas la création.** Un multisig 2 of 3 se crée avec une
seule signature : la double approbation ne concerne que les futures
transactions du vault. C'est un point de sécurité à afficher dans l'écran de
confirmation (SECURITY.md §4) : « ceci ne demande pas l'accord des autres
signataires ».

## 6. Erreurs possibles

Issues de l'IDL (extrait pertinent) :

- `InvalidThreshold` : seuil 0 ou supérieur au nombre de membres ;
- `EmptyMembers`, `DuplicateMember` : liste vide ou clé répétée ;
- `NotAMember`, `RemoveLastMember` : concernent les instructions de gestion
  ultérieures, pas la création ;
- `InvalidRentCollector` : `rentCollector` incohérent ;
- `TimeLockExceedsMaxAllowed` : `timeLock` au-delà du maximum du programme ;
- `MultisigCreateDeprecated` : utilisation de la v1 ;
- `InvalidInstructionArgs`, `InvalidNumberOfAccounts`, `InvalidAccount` :
  arguments ou comptes mal construits (mauvais PDA, `programConfig` erroné).

Erreurs hors programme, attendues côté client :

- solde insuffisant sur `creator` pour le rent **et** les frais
  (`programConfig.multisigCreationFee` est un champ existant du compte
  `ProgramConfig`) ;
- simulation en échec (à traiter comme un refus, jamais comme un avertissement) ;
- rejet utilisateur dans le wallet → message non technique (SECURITY.md §6).

## 7. Préconditions à vérifier avant toute création

1. Réseau devnet confirmé ; aucune constante mainnet importable ; programme
   `SQDS4ep…` présent et exécutable (`getAccountInfo` sur le programme) ;
2. `programConfig` existe (PDA dérivé) et sa `treasury` est joignable ;
3. `createKey` générée en mémoire, non persistée, non journalisée ;
4. wallet connecté (MWA) = `creator`, solde ≥ rent + `multisigCreationFee` ;
5. brouillon validé : `validationErrors` vide, threshold dans les bornes, aucune
   adresse dupliquée, 3 signers si preset 2 of 3 ;
6. permissions décidées explicitement (`Initiate | Vote | Execute`) ;
7. `configAuthority` et `timeLock` figés et affichés dans la revue ;
8. passage obligatoire par l'écran de confirmation + **autorisation explicite
   de l'utilisateur** immédiatement avant l'écriture ;
9. simulation obligatoire avant envoi, un seul envoi, puis relecture on-chain
   (signature de transaction, adresse du multisig, threshold, membres) ;
10. journal local (aucun secret) : adresse du multisig, index, empreinte des
    membres — mais **jamais** `createKey`.

## Hors périmètre de ce document

Aucune transaction, aucune instruction, aucune simulation, aucune connexion
réseau n'a été produite ici. Les phases suivantes (construction réelle,
simulation, envoi, relecture) restent à planifier et exigeront une autorisation
explicite séparée.
