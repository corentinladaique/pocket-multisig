# PRODUCT.md — Pocket Multisig

## Problème

Un membre d'un multisig Squads doit aujourd'hui utiliser un navigateur desktop
pour voir l'état d'une proposition et voter. Un détenteur de Seeker n'a aucun
outil mobile natif pour approuver ou exécuter une transaction de son multisig.

## Proposition

Application Android (Expo / React Native) qui se connecte au wallet du Seeker
via Mobile Wallet Adapter, découvre les multisigs Squads v4 dont l'adresse
connectée est membre, et permet de lire les propositions puis de voter.

## Hors périmètre MVP

- Création de multisig
- Modification des membres / seuil / config authority
- Vault transactions (création de proposition)
- Batch, spending limits, time locks
- Historique, notifications push, indexer externe
- Backend, base de données, clés serveur
- iOS, mainnet, smart contract maison

## User stories et critères d'acceptation

| # | Story | Critère d'acceptation |
| --- | --- | --- |
| 1 | Connecter un wallet MWA | Le wallet s'ouvre, l'autorisation est accordée, aucune seed demandée |
| 2 | Voir son adresse | L'adresse publique est affichée en base58, jamais tronquée sans copie |
| 3 | Voir ses multisigs | Liste des multisigs Squads v4 où l'adresse est membre, ou saisie manuelle d'une adresse |
| 4 | Voir la config | Membres (pubkey + permissions), seuil, adresse du vault, solde du vault |
| 5 | Voir les propositions | Index, statut (Draft/Active/Approved/Rejected/Executed/Cancelled), votes/approbations |
| 6 | Lire une proposition | Message décodé : programme cible, comptes, instruction si reconnaissable, transfert SOL le cas échéant |
| 7 | Approuver | Écran de confirmation, puis `proposalApprove` signé via MWA |
| 8 | Exécuter | Bouton actif seulement si le seuil est atteint ; `vaultTransactionExecute` signé via MWA |
| 9 | Traçabilité | Signature de transaction affichée + lien `explorer.solana.com/tx/<sig>?cluster=devnet` |

## Métrique de succès hackathon

Sur un émulateur Android avec le mock MWA wallet : découvrir un multisig devnet,
afficher une proposition en attente, l'approuver depuis le téléphone, la voir
passer en `Approved`, puis l'exécuter. En moins de 3 minutes, sans desktop.

## Contraintes produit

- Devnet exclusivement. Le cluster est une constante de build, pas un réglage.
- Zéro dépendance à une infra que nous opérons : RPC public devnet + chaîne.
- Aucun secret dans le binaire ni dans le dépôt.
- Le français est la langue de l'UI (terminologie on-chain en anglais).
