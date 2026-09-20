// Garde réseau + garde de revue : verdict typé `allowed` / `blocked` avec la
// liste des raisons.
//
// Contraintes :
// - aucun appel RPC : le guard ne lit que des données DÉJÀ chargées, passées en
//   paramètres, plus `chain` / `rpcEndpoint` du provider (propriétés en mémoire) ;
// - aucune adresse de fixture codée en dur ;
// - aucun chemin d'écriture, aucune signature.
import { useMemo } from 'react';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import { DEVNET_CHAIN, DEVNET_ENDPOINT } from '../config';
import { SYSTEM_PROGRAM_ID, type TransactionReviewModel } from '../types/transactionReview';

/** Membre du multisig, structurellement compatible avec `MemberView`. */
export interface GuardMember {
  address: string;
  roles: readonly string[];
}

/** Données déjà chargées, injectées par l'appelant. Aucune n'est relue ici. */
export interface ReviewGuardContext {
  review: TransactionReviewModel;
  multisig: {
    address: string;
    vaultAddress: string;
    members: readonly GuardMember[];
  } | null;
  proposal: {
    index: number;
    status: string;
    approvedAddresses: readonly string[];
  } | null;
  walletAddress: string | null;
}

export interface GuardNetwork {
  chain: string;
  endpoint: string;
}

export type GuardVerdict =
  | { status: 'allowed'; reasons: string[] }
  | { status: 'blocked'; reasons: string[] };

/** Marque d'une ALT non résolue posée par le décodeur. */
const ALT_MARKER = 'Address lookup table data is required';

/**
 * Verdict pur, sans I/O. Évalue l'ensemble des contrôles exigés avant toute
 * future confirmation. `allowed` n'active rien : l'appelant décide.
 */
export function evaluateReviewGuard(
  network: GuardNetwork,
  context: ReviewGuardContext,
): GuardVerdict {
  const reasons: string[] = [];
  const { review, multisig, proposal, walletAddress } = context;

  // 1. Réseau
  if (network.chain !== DEVNET_CHAIN) {
    reasons.push(`Wallet chain is ${network.chain}, expected ${DEVNET_CHAIN}.`);
  }
  if (network.endpoint !== DEVNET_ENDPOINT) {
    reasons.push(`RPC endpoint is ${network.endpoint}, expected ${DEVNET_ENDPOINT}.`);
  }

  // 2. Wallet connecté
  if (walletAddress === null || walletAddress.length === 0) {
    reasons.push('No wallet is connected.');
  }

  // 3. Multisig chargé et conforme à la revue
  if (multisig === null) {
    reasons.push('No multisig is loaded.');
  } else {
    if (review.multisigAddress !== multisig.address) {
      reasons.push(
        `Review multisig ${review.multisigAddress} differs from the loaded multisig ${multisig.address}.`,
      );
    }
    if (review.vaultAddress !== multisig.vaultAddress) {
      reasons.push(
        `Review vault ${review.vaultAddress} differs from the expected vault ${multisig.vaultAddress}.`,
      );
    }
  }

  // 4. Wallet membre et porteur du droit de vote
  if (walletAddress !== null && multisig !== null) {
    const member = multisig.members.find((entry) => entry.address === walletAddress);
    if (member === undefined) {
      reasons.push(`${walletAddress} is not a member of the loaded multisig.`);
    } else if (!member.roles.includes('Vote')) {
      reasons.push(`${walletAddress} has no Vote permission (roles: ${member.roles.join(', ')}).`);
    }
  }

  // 5. Proposition attendue et active
  if (proposal === null) {
    reasons.push('No proposal data is available.');
  } else {
    if (proposal.index !== review.proposalIndex) {
      reasons.push(
        `Proposal index ${review.proposalIndex} differs from the loaded proposal index ${proposal.index}.`,
      );
    }
    if (proposal.status !== 'Active') {
      reasons.push(`Proposal status is ${proposal.status}, expected Active.`);
    }
    if (walletAddress !== null && proposal.approvedAddresses.includes(walletAddress)) {
      reasons.push(`${walletAddress} has already approved this proposal.`);
    }
  }

  // 6. Décodage et contenu de l'instruction
  if (review.decodeStatus !== 'decoded') {
    reasons.push(`Decode status is ${review.decodeStatus}, expected decoded.`);
  }
  if (!review.program.known || review.program.value.id !== SYSTEM_PROGRAM_ID) {
    reasons.push('Called program is not System Program.');
  }
  if (!review.action.known || !/transfer/i.test(review.action.value)) {
    reasons.push('Action is not a recognised SOL transfer.');
  }
  if (multisig !== null && (!review.source.known || review.source.value !== multisig.vaultAddress)) {
    reasons.push('Decoded source does not match the expected vault.');
  }
  if (review.notes.some((note) => note.includes(ALT_MARKER))) {
    reasons.push('An unresolved address lookup table blocks this review.');
  }

  return reasons.length === 0
    ? { status: 'allowed', reasons: [] }
    : { status: 'blocked', reasons };
}

/**
 * Hook : compose le verdict à partir du réseau du provider et des données
 * déjà chargées. Ne déclenche aucune lecture et n'active aucune confirmation.
 */
export function useWalletGuard(
  context: ReviewGuardContext | null,
): GuardVerdict | { status: 'blocked'; reasons: string[] } {
  const { chain, connection } = useMobileWallet();
  const endpoint = connection.rpcEndpoint;

  return useMemo(() => {
    if (context === null) {
      return {
        status: 'blocked' as const,
        reasons: ['No guard context was provided.'],
      };
    }
    return evaluateReviewGuard({ chain, endpoint }, context);
  }, [chain, endpoint, context]);
}