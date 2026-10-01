# UI-REVIEW.md — Audit UI et accessibilité (lecture seule)

Périmètre : écrans de `src/screens/`. **Aucun écran n'a été modifié dans cette
phase.** Deux sources de preuve :

- **[Source]** : lu dans le code (libellés, props d'accessibilité, styles).
- **[Capture]** : observé sur une capture réelle du Seeker (les écrans qui
  exigent une session wallet n'ont **pas** pu être capturés — notés « non
  observé à l'écran »).

Repères mesurés dans le code (occurrences par écran) :

| Écran | accessibilityRole | accessibilityState | SAFE_TOP_PADDING | KeyboardAvoidingView |
| --- | --- | --- | --- | --- |
| ConnectScreen (Home) | 20 | 1 | oui | 5 |
| CreateVaultScreen | 17 | 5 | oui | 4 |
| NewProposalScreen | 9 | 4 | oui | 3 |
| ProposalDetailsScreen | 9 | 5 | oui | 3 |
| OnboardingScreen | 7 | 1 | oui | **0** |
| MultisigDetailsScreen | 5 | **0** | oui | 3 |
| ProposalListScreen | 4 | **0** | oui | 3 |
| MultisigInboxScreen | 3 | **0** | oui | 3 |
| TransactionReviewScreen | 1 | **0** | oui | 0 |
| TransactionTechnicalDetails | 1 | 1 | **0** | 0 |

---

## 1. OnboardingScreen

- Objectif : profiler l'utilisateur et l'introduire au multisig.
- CTA principal : **aucun visible au premier écran** — le bouton « Next » est en
  bas d'un scroll de 7 étapes. **[Source + Capture]**
- CTA secondaire : retour d'étape (`onBack`).
- Info prioritaire : la question courante ; le compteur « Step X of Y ».
- Info avancée : les leçons (étapes 2 à 7).
- Libellés techniques : « DEVNET · LEARNING » (acceptable).
- accessibilityRole : 7 ; accessibilityLabel : dépend du texte enfant ;
  accessibilityState : **1 seule occurrence** → les options ne déclarent pas
  `selected`. **[Source]**
- Tailles tactiles : options très hautes (> 48 dp) — OK. **[Capture]**
- Contraste : texte noir sur blanc, bordure très claire (#e5e7eb) → les
  options non sélectionnées se lisent comme des zones inactives. **[Capture]**
- Clavier : aucun champ texte → pas de risque.
- Safe Area : `SAFE_TOP_PADDING` présent. **[Source]**
- Scroll : long (7 étapes). État vide / loading / erreur : N/A.
- État réussite : N/A (flux d'apprentissage).
- Constats : message « Choose an option to continue. » ne nomme pas la question
  manquante ; doublon « Built into your Solana Mobile phone. » /
  « Integrated in Solana Mobile. » ; barre de statut blanche ici vs noire sur
  Home. **[Capture]**

## 2. ConnectScreen (Home, avant connexion)

- Objectif : connecter le wallet, montrer l'état réseau, entrer.
- CTA principal : `Connect wallet` (bleu plein, unique, large). **[Capture]** OK.
- CTA secondaire : `Learn about multisig` (dans une carte) ; `Inbox`.
- Info prioritaire : nom du produit, badge DEVNET, état réseau.
- Info avancée : « RPC: Online » (utile mais technique).
- accessibilityRole : 20 (le plus riche) ; accessibilityState : 1.
- Tailles tactiles : boutons hauts — OK. Contraste : bon (bleu/blanc).
- Safe Area : présent ; barre de statut **noire** au-dessus d'un écran blanc →
  incohérence. **[Capture]**
- Scroll : contenu court → grand vide au-dessus et en dessous (composition non
  centrée). **[Capture]**
- États : connexion en cours (loader), RPC Checking/Online/Offline, erreur RPC
  avec Retry — présents. **[Source]**
- Constats : carte `LEARN` contenant un second rectangle gris (double
  contenant) ; `Inbox` en gris clair ressemble à un bouton **désactivé**.

## 3. MultisigDetailsScreen

- Objectif : config du multisig + entrées d'action.
- CTA principal : selon l'état (liste des propositions / création).
- accessibilityRole : 5 ; **accessibilityState : 0** → boutons d'action
  désactivés sans état annoncé. **[Source]** → P1.
- Safe Area + clavier : présents.
- Non observé à l'écran (session wallet requise).
- Constats source : densité forte (config + soldes + actions sur un écran).

## 4. MultisigInboxScreen

- Objectif : actions en attente.
- accessibilityRole : 3 ; **accessibilityState : 0** → P1.
- État vide : à vérifier à l'écran (non observé).
- Safe Area + clavier : présents.

## 5. ProposalListScreen

- Objectif : lister les propositions et en ouvrir une.
- CTA principal : ouvrir une proposition (ligne entière).
- CTA secondaire : `Refresh`.
- accessibilityRole : 4 ; **accessibilityState : 0** → P1.
- Constat corrigé pendant cette session : « RPC calls used for this list » est
  désormais masqué hors `__DEV__` (détail développeur hors premier niveau).
- État vide / erreur / loading : présents. Non observé à l'écran.

## 6. NewProposalScreen

- Objectif : composer une proposition de transfert SOL.
- CTA principal : `Review proposal` (handler existant, inchangé).
- CTA secondaires : `Max`, repliable « How proposal creation works »,
  « Advanced diagnostics ».
- Info prioritaire : montant en SOL, coût, destination.
- Info avancée : lamports, index, PDA, compute units (déjà repliés).
- accessibilityRole : 9 ; accessibilityState : 4 ; Safe Area + clavier OK.
- États : vide (message de saisie), simulation en cours, erreur, succès —
  présents. Non observé à l'écran.

## 7. ProposalDetailsScreen

- Objectif : décider — approuver ou exécuter.
- CTA principal : **un seul à la fois** selon l'état (Approve / Execute
  transaction / Check approval again / rien si terminal).
- CTA secondaire : `Advanced transaction details` (renommé pendant cette
  session — l'ancien libellé « Review proposal » collisionnait avec le CTA de
  Home).
- Info prioritaire : progression « N of M approvals collected », seuil,
  résultat.
- Info avancée : « Troubleshooting details » (repliable, fermé par défaut).
- accessibilityRole : 9 ; accessibilityState : 5 ; statuts en
  `accessibilityRole="text"` (non cliquables) — OK.
- États : 5 familles exclusives (available / pending / approved-by-you /
  threshold-reached / executed). Non observé à l'écran.

## 8. TransactionReviewScreen + TransactionTechnicalDetails

- Objectif : vue technique **facultative, lecture seule**.
- CTA principal : aucun (consultation) ; un seul bouton `Back`.
- accessibilityRole : 1 ; **accessibilityState : 0**.
- KeyboardAvoidingView : absent (aucun champ texte) — OK.
- `TransactionTechnicalDetails` n'a pas `SAFE_TOP_PADDING` : il est rendu à
  l'intérieur de la vue qui le porte **[Source]** → à confirmer visuellement.

## 9. CreateVaultScreen

- Objectif : créer un multisig pas à pas (membres → seuil → review →
  vérification → envoi).
- CTA principal : un seul par étape.
- Info prioritaire : membres, seuil recommandé (2 of 2 / 2 of 3), coût.
- Info avancée : « Troubleshooting details », diagnostics.
- accessibilityRole : 17 ; accessibilityState : 5 ; Safe Area + clavier OK.
- États : étapes multiples, erreurs temporaires vs déterministes, succès
  « Vault created and verified » — présents, y compris l'état
  « Transaction confirmed / Vault verification: failed ».

---

## Classement

### P0 — avant la vidéo
1. **Home : barre de statut noire sur écran blanc** et composition non centrée
   (gros vides haut/bas) — visible au premier plan de la vidéo. **[Capture]**
2. **Onboarding : aucun CTA visible à l'écran 1** (bouton en bas du scroll) et
   aucun état de sélection sur les options. **[Source + Capture]**

### P1 — avant soumission
3. Home : carte `LEARN` à double contenant (carte + bouton gris imbriqué).
4. Home : `Inbox` gris clair = affordance de bouton désactivé (trompeur).
5. Onboarding : message « Choose an option to continue. » non ciblé.
6. Onboarding : doublon de texte sur Seed Vault Wallet.
7. `accessibilityState` absent sur MultisigDetailsScreen, ProposalListScreen,
   MultisigInboxScreen, TransactionReviewScreen → les éléments désactivés/
   sélectionnés ne sont pas annoncés.
8. Badges d'en-tête hétérogènes (« DEVNET » vs « DEVNET · LEARNING »).
9. Barre de statut non homogène entre écrans (noire sur Home, blanche ailleurs).

### P2 — après hackathon
10. Absence de tokens de design (couleurs/rayons/espaces en dur dans chaque
    StyleSheet → dérive visuelle).
11. « RPC: Online » au premier niveau de Home (information d'outil).
12. Vue technique atteignable par défaut depuis Proposal Details (le libellé
    « Advanced » aide, un vrai masquage serait préférable).
13. Densité forte de MultisigDetailsScreen (config + soldes + actions).
