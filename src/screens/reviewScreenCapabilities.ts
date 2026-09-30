/**
 * Capacités déclarées de la VUE TECHNIQUE de transaction
 * (`src/screens/TransactionReviewScreen.tsx`).
 *
 * Module PUR : aucune I/O, aucun RPC, aucun wallet, aucune signature, aucun
 * import React Native. Il rend explicite — et donc testable sans monter
 * l'écran — que cette vue ne peut QUE lire et revenir en arrière.
 *
 * Règle produit : l'approbation d'une proposition se fait UNIQUEMENT depuis
 * `ProposalDetailsScreen` (via `signAndSendProposalApproval`). Cette vue ne
 * doit jamais exposer d'action d'écriture.
 */

export type ReviewScreenCapabilities = {
  /** Ouvre-t-elle une autorisation wallet (MWA) ? */
  authorizesWallet: boolean;
  /** Signe-t-elle une transaction ? */
  signsTransaction: boolean;
  /** Envoie-t-elle une transaction ? */
  sendsTransaction: boolean;
  /** Peut-elle approuver une proposition ? */
  approvesProposal: boolean;
  /** Peut-elle exécuter une proposition ? */
  executesProposal: boolean;
  /** Affiche uniquement des informations décodées, en lecture seule. */
  readOnly: boolean;
};

export const REVIEW_SCREEN_CAPABILITIES: ReviewScreenCapabilities = {
  authorizesWallet: false,
  signsTransaction: false,
  sendsTransaction: false,
  approvesProposal: false,
  executesProposal: false,
  readOnly: true,
};

/**
 * Vrai si et seulement si l'écran n'expose AUCUNE action d'écriture.
 * Fonction pure : sert de garde-fou documentaire et de point de test.
 */
export function reviewScreenIsReadOnly(
  capabilities: ReviewScreenCapabilities = REVIEW_SCREEN_CAPABILITIES,
): boolean {
  return (
    capabilities.readOnly === true &&
    capabilities.authorizesWallet === false &&
    capabilities.signsTransaction === false &&
    capabilities.sendsTransaction === false &&
    capabilities.approvesProposal === false &&
    capabilities.executesProposal === false
  );
}
