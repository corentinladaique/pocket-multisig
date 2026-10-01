# DEMO-RUNBOOK.md — Pocket Multisig

Runbook de tournage. Cible : une vidéo de 3 minutes qui montre les quatre flux
sur un vault **2-of-3**, sans jamais dépendre du réseau en direct.

Formulation imposée (à ne pas durcir en affirmation absolue) :

> « Multisig treasury management is still designed around desktop workflows.
> Pocket Multisig brings proposal, approval and execution directly to Solana
> Seeker. »

---

## 1. Pitch — 30 secondes (texte exact)

> « Gérer une trésorerie d'équipe, ça se fait à plusieurs : deux signatures
> plutôt qu'une. Mais aujourd'hui, voter se fait encore sur un ordinateur.
> Pocket Multisig amène la proposition, l'approbation et l'exécution
> directement sur Solana Seeker. Les clés ne sortent jamais du wallet. Deux
> approuvent, et un membre indisponible ne bloque pas l'équipe. »

## 2. Script vidéo — 3 minutes

| Temps | Scène | Voix off (exacte) |
| --- | --- | --- |
| 0:00–0:18 | Accueil, badge DEVNET visible | « Multisig treasury management is still designed around desktop workflows. Pocket Multisig brings proposal, approval and execution directly to Solana Seeker. » |
| 0:18–0:35 | Connexion wallet (Seed Vault) | « L'application ne voit jamais de clé privée : elle demande une signature, le wallet la fournit. » |
| 0:35–1:00 | Create Vault : 3 membres, seuil | « Pour trois membres, l'application recommande deux approbations. Two approvals protect the treasury, while one unavailable member cannot block the team. » |
| 1:00–1:25 | Review + signature + « Vault created and verified » | « Ce qui est affiché, c'est ce qui a été relu on-chain : seuil, membres, permissions. » |
| 1:25–1:55 | New Proposal : montant en SOL → simulation → signature | « Le montant est saisi en SOL, converti exactement, et simulé avant tout envoi. » |
| 1:55–2:20 | Proposal Details : 1 of 3, waiting | « Une proposition attend. Un premier membre a déjà approuvé. » |
| 2:20–2:45 | Second wallet approuve → threshold reached → Execute | « Deux approuvent : le seuil est atteint, la transaction peut être exécutée. » |
| 2:45–3:00 | « Transaction executed » | « Résultat vérifié on-chain. Rien n'est renvoyé, jamais. » |

## 3. Storyboard (2-of-3)

1. **Accueil** — badge DEVNET, bouton principal `Connect wallet`. (4 s)
2. **Wallet** — Seed Vault, autorisation. (10 s)
3. **Create Vault / Membres** — trois membres ajoutés, dont le wallet connecté. (8 s)
4. **Create Vault / Threshold** — bascule vers 2 : bandeau « Recommended: 2 of 3 » + « Two members must approve. One unavailable member cannot block the vault. » (**plan clé**, 10 s)
5. **Create Vault / Review** — récapitulatif (seuil, membres). (8 s)
6. **Signature** — wallet, une seule signature (créateur). (10 s)
7. **Succès création** — « Vault created and verified. » + adresses. (8 s)
8. **New Proposal** — montant en SOL. (8 s)
9. **Simulation** — bloc de revue, détails techniques repliés. (8 s)
10. **Proposition créée** — résultat. (6 s)
11. **Proposal Details** — progression « 1 of 3 approvals collected ». (8 s)
12. **Second wallet** — approbation. (12 s)
13. **Threshold reached** — progression + `Execute transaction`. (10 s)
14. **Executed** — « ✓ Transaction executed », détails. (10 s)
15. **Insert réseau préenregistré** — coupure puis `Check approval again` → « verified ». (12 s, inséré au montage)
16. **Chute** — nom du projet. (4 s)

## 4. Données Devnet requises (à préparer AVANT de tourner)

- **Vault 2-of-3** : 3 membres, seuil 2, en devnet. Le vault de démonstration
  doit être **prêt et financé** avant le take principal (sinon l'exécution
  échoue).
- **Wallet A** (Seed Vault du Seeker) : créateur.
- **Wallet B** (Solflare) : second signataire, qui approuve à l'écran.
- **Wallet C** : présent dans les membres, **jamais sollicité** (c'est le
  message de la démo).
- Une **proposition déjà créée et déjà approuvée une fois** pour partir d'un
  écran « 1 of 3 » sans attendre.
- Un second jeu de données intact pour le take suivant.

## 5. Ordre des wallets

1. **A (Seeker / Seed Vault)** : se connecte, crée le vault, crée la
   proposition. Approuve si tu veux montrer deux approbations sur le même
   appareil.
2. **B (Solflare)** : se connecte ensuite et **approuve**. C'est le geste
   central de la vidéo.
3. **C** : jamais connecté. À mentionner à la voix.

## 6. Plans de secours

- **Transaction lente** → passer au B-roll préenregistré de l'étape et revenir
  en cut ; ne jamais laisser un spinner occuper l'écran.
- **Wallet qui refuse/plante** → cut vers la capture du résultat déjà obtenu.
- **RPC indisponible** → tourner d'abord les scènes 1–14, faire l'insert réseau
  en dernier.
- **Si un take échoue** → on ne rejoue pas la transaction : on monte la capture
  du take réussi.

## 7. Captures obligatoires (à conserver, avant et après)

①Accueil ②Wallet/autorisation ③Membres ④Threshold 2-of-3 ⑤Review ⑥Signature
⑦Vault verified ⑧Montant SOL ⑨Simulation ⑩Proposition créée ⑪1 of 3
⑫Second approve ⑬Threshold reached + Execute ⑭Executed ⑮Check approval again
⑯Écran de chute.

## 8. Checklist AVANT tournage

- [ ] Seeker chargé (> 50 %), notifications coupées, rotation verrouillée.
- [ ] Mode ne pas déranger activé ; aucune notification personnelle possible.
- [ ] Vault de démo prêt et financé ; proposition « 1 of 3 » en place.
- [ ] Wallet B (Solflare) connecté et **déjà** autorisé pour l'app.
- [ ] Enregistrement 1080p+, badge DEVNET dans le cadre.
- [ ] Script imprimé, minuteur visible hors cadre.
- [ ] Luminosité d'écran stable, pas de reflet.
- [ ] Aucune donnée personnelle à l'écran (labels neutres).

## 9. Checklist APRÈS tournage

- [ ] Relire chaque plan : montant, adresse et statut lisibles.
- [ ] Vérifier qu'aucune clé, seed ou adresse personnelle n'apparaît.
- [ ] Vérifier que la voix off est synchrone avec les libellés à l'écran.
- [ ] Exporter en 1080p, sous-titres si possible, durée ≤ 3 min.
- [ ] Sauvegarder les rushes + les captures ①–⑯ dans un dossier dédié.

## 10. Actions INTERDITES pendant le take

- Appuyer sur une confirmation que tu n'as pas décidée (aucune signature
  « pour la caméra »).
- Exécuter une transaction réelle sans l'avoir annoncée sur un vault non prévu.
- Modifier un montant ou un compte en cours de tournage.
- Laisser un prompt wallet à l'écran sans décision.

## 11. Version SANS coupure réseau

La vidéo doit tenir **sans** l'insert réseau : scènes 1 → 14, puis la chute.
L'insert (scène 15) est un **bonus** que tu ajoutes si le temps le permet. Le
take principal ne doit jamais dépendre d'une coupure de réseau provoquée.

## 12. Insert réseau préenregistré

- Enregistré **séparément**, une fois, hors take principal.
- Contenu : couper le Wi-Fi/4G, ouvrir l'écran de vérification, lancer
  `Check approval again`, montrer « verified ».
- Visiblement un insert (fondu court) pour ne pas laisser croire à une
  dépendance en direct.

## 13. Checklist de confidentialité

- [ ] Aucune seed phrase, aucune clé privée, aucun mot de passe à l'écran.
- [ ] Aucune adresse personnelle (hors adresses devnet publiques de démo).
- [ ] Aucun email, aucune notification, aucun nom de compte visible.
- [ ] Aucun fichier keystore, aucun terminal avec des variables d'environnement.
- [ ] Vérifier les rushes image par image avant publication.
