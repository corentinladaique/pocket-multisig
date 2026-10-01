# HACKATHON-SUBMISSION.md — Pocket Multisig

Dossier de soumission. Chaque affirmation de ce document est vérifiable dans le
dépôt ; aucune fonctionnalité n'est décrite sans être implémentée.

---

## 1. Proposition de valeur

**Gérer une trésorerie multisig Squads v4 depuis un téléphone Solana, sans
jamais sortir une clé du wallet.** Consulter, proposer, approuver et exécuter —
directement sur un Seeker, en devnet.

## 2. Problème

« Multisig treasury management is still designed around desktop workflows.

Pocket Multisig brings proposal, approval and execution directly to Solana
Seeker. »

Un membre de multisig doit aujourd'hui ouvrir un navigateur desktop pour voter.
Sur mobile, l'appareil sait signer, mais l'outil manque. Résultat : une
approbation à deux peut être bloquée par une simple absence d'ordinateur.

## 3. Solution

Une application Android (Expo / React Native + Mobile Wallet Adapter) qui :

- lit l'état d'un multisig Squads v4 (seuil, membres, permissions, vault) ;
- crée un multisig, des propositions SOL, approuve et exécute ;
- affiche **ce qui va être signé** et **ce qui a été créé on-chain** ;
- survit à une coupure réseau sans jamais renvoyer une transaction.

## 4. Pourquoi mobile-first

Le signataire est mobile. Une approbation d'urgence n'attend pas qu'on
retrouve un ordinateur. Le téléphone est aussi le seul endroit où la clé est
protégée par un élément matériel grand public (Seed Vault).

## 5. Rôle du Seeker et de Mobile Wallet Adapter

- **Seeker** : l'appareil cible. Wallet intégré (Seed Vault), sélection de
  wallet, signature hors application.
- **MWA** : protocole Android. L'application ne voit **jamais** de clé privée ;
  elle construit une transaction, l'envoie au wallet, reçoit une signature.
  Testé avec Seed Vault et Solflare (Ledger via Solflare).
- Aucun backend, aucun secret côté application.

## 6. Fonctionnement 2-of-3

Configuration de démonstration : **3 membres, seuil 2**.

« Two approvals protect the treasury, while one unavailable member cannot block
the team. »

L'interface recommande explicitement 2-of-3 (`Recommended: 2 of 3` — « Two
members must approve. One unavailable member cannot block the vault. »). Le
seuil 3-of-3 n'est jamais imposé automatiquement, et 1-of-3 reste possible mais
signalé comme configuration à faible sécurité.

## 7. Les quatre flux

| Flux | Ce qui est signé | Vérification |
| --- | --- | --- |
| Create Multisig | création du compte multisig (SDK officiel) | read-back : propriétaire, configAuthority, seuil, membres, permissions, timeLock, rentCollector |
| Create Proposal | `vaultTransactionCreate` + `proposalCreate` | simulation avant envoi ; read-back Proposition + VaultTransaction |
| Approve | `proposalApprove` | refus on-chain si déjà approuvé ; read-back de la Proposition |
| Execute | `vaultTransactionExecute` | seuil réellement atteint, permission `Execute`, solde relu |

Chaque flux : préflight → simulation → blockhash frais → fenêtre de signature
jugée en blocs → **un seul envoi** → confirmation → read-back.

## 8. Sécurité et récupération réseau

- Aucune clé privée, aucune seed phrase manipulée par l'application.
- Un seul envoi par tentative ; aucun second envoi automatique.
- `Check transaction again` (création) et `Check approval again`
  (approbation) : **strictement en lecture**, réappliquent les mêmes
  invariants, et ne rouvrent jamais le wallet.
- Un solde insuffisant bloque l'exécution avant toute signature.
- Détail complet : `SECURITY.md`, y compris les **risques ouverts**.

## 9. Limites Devnet

- Devnet uniquement : aucune bascule mainnet n'est possible depuis l'app.
- Le RPC est l'endpoint public devnet (`https://api.devnet.solana.com`), sans
  clé d'API ni fallback.
- Les fonds manipulés n'ont **aucune valeur**.

## 10. Risques connus

RPC public unique ; garde réseau dérivée de la constante de connexion ;
identité dApp de développement présentée aux wallets ; vulnérabilités hautes
transitives dans les dépendances (dont `bigint-buffer` via la chaîne Squads) ;
Address Lookup Tables non supportées à l'exécution ; **pas d'audit
professionnel** ; couverture de tests limitée aux fonctions pures et à des
vérifications de source (aucun test d'intégration on-chain automatisé).

## 11. Instructions de démonstration

Voir `DEMO-RUNBOOK.md` (pitch, script 3 minutes, storyboard 2-of-3, données
devnet à préparer, plans de secours, checklists).

Séquence courte : configuration 2-of-3 → vault prêt → premier wallet déjà
approbateur → second wallet approuve → seuil atteint → Execute → résultat
vérifié. L'insert « coupure réseau » est **préenregistré**, jamais une
dépendance du take principal.

## 12. Checklist de soumission

- [ ] APK : build release locale + installation vérifiée sur Seeker
      (`adb install -r`), ou instructions de build testées sur une machine
      neuve.
- [ ] GitHub : dépôt public, branche de démo à jour, `README.md` à jour,
      CI verte, aucune donnée sensible dans l'historique.
- [ ] Vidéo : 3 minutes, voix off, sous-titres si disponible, config 2-of-3
      visible, aucun élément personnel à l'écran.
- [ ] Deck : problème, solution, démo, sécurité, limites, différenciants.
- [ ] Formulaire : texte court + description longue (sections 13 et 14).

## 13. Texte court pour le formulaire

> Pocket Multisig : approuver et exécuter une trésorerie multisig Squads v4
> depuis un téléphone Solana. L'app ne touche jamais les clés — le wallet
> signe. Créer, proposer, approuver à deux, exécuter, et retrouver l'état
> on-chain après une coupure réseau. Devnet, Seeker, Mobile Wallet Adapter.

## 14. Description longue

Pocket Multisig est une application Android qui apporte la gestion d'une
trésorerie multisig Squads Protocol v4 sur Solana Seeker. Elle couvre les
quatre flux qui comptent — création du multisig, création d'une proposition de
transfert SOL, approbation, exécution — avec une discipline constante :
préflight local, simulation, blockhash frais, fenêtre de signature vérifiée
**avant** d'ouvrir le wallet, un seul envoi, confirmation on-chain, puis
read-back métier.

La sécurité est structurelle plutôt que déclarative : l'application ne voit
jamais de clé privée (Mobile Wallet Adapter), la création de vault n'annonce
« verified » que si la configuration relue on-chain correspond exactement à
celle qui a été signée (propriétaire, seuil, membres, permissions, timeLock,
rentCollector), et la reprise après coupure réseau est strictement en lecture —
elle n'autorise jamais un second envoi.

La démonstration utilise un vault 2-of-3 : deux approbations protègent la
trésorerie, et un membre indisponible ne bloque pas l'équipe. Le prototype est
devnet uniquement, n'a pas été audité, et documente ses risques ouverts.

## 15. Cinq points différenciants

1. **Mobile-first réel** : les quatre flux complets sur téléphone, pas
   seulement la consultation.
2. **Read-back vérifié** : « verified » n'est jamais déduit — la config ou la
   proposition est relue on-chain et comparée à ce qui a été signé.
3. **Reprise réseau sûre** : un recheck en lecture seule qui réapplique les
   mêmes invariants, sans jamais rouvrir le wallet ni renvoyer.
4. **Anti-double-approbation à trois niveaux** : UI, verrou local, refus
   on-chain (« Already approved » dérivé du read-back).
5. **Une seule source de vérité pour les invariants** : le même module pur
   valide le read-back initial et le recheck — les deux chemins ne peuvent plus
   diverger.
