import { Keypair, PublicKey, type Connection, type Transaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { describeMwaError } from '../wallet/mwaDiagnostics';
import type { SignatureConfirmationStatus } from '../wallet/operationState';
import { confirmSignature, type SignatureConfirmation } from '../solana/confirmSignature';
import {
  blockhashBundleFromTransaction,
  DEFAULT_BLOCK_MARGIN,
  evaluateSigningWindow,
  signingStateFromEvidence,
  type SigningState,
} from '../wallet/signingWindow';

/**
 * Envoi de la transaction de creation d'un multisig Squads v4.
 *
 * Sequence exacte, dans cet ordre :
 *   blockhash frais -> recentBlockhash + lastValidBlockHeight -> partialSign(createKey)
 *   -> signAndSendTransactions (wallet MWA) -> relecture du multisig cree.
 *
 * Ce module n'a AUCUN effet de bord au chargement, aucun effet React, aucun
 * bouton, aucune minuterie : la fonction n'est jamais appelee automatiquement.
 * Elle doit etre invoquee depuis un geste utilisateur explicite, une seule
 * fois, apres un preflight et une simulation frais (SECURITY.md §4). Le
 * respect du "un seul envoi" reste la responsabilite de l'appelant.
 */

/** Callback MWA minimal attendu (compatible `signAndSendTransactions` du provider). */
export type SignAndSendTransactionsFn = (
  transaction: Transaction,
  minContextSlot: number,
) => Promise<string | string[]>;

export type MultisigCreationExpectation = {
  threshold: number;
  memberCount: number;
  /** `null` = configuration figee (Pubkey::default() on-chain). */
  configAuthority: string | null;
};

/** Blockhash explicitement applique a la transaction avant simulation/envoi. */
export type MultisigCreationBlockhash = {
  blockhash: string;
  lastValidBlockHeight: number;
};

/**
 * Pose un blockhash FRAIS sur la transaction et le retourne.
 *
 * Indispensable avant toute simulation : le chemin legacy de
 * `simulateTransaction` injecte sinon un blockhash issu du cache interne de
 * `Connection`, qui peut etre devenu inconnu de la grappe (BlockhashNotFound).
 * Le blockhash retourne doit etre celui utilise pour la simulation, la
 * signature partielle et l'envoi.
 */
export async function applyFreshBlockhash(
  connection: Connection,
  transaction: Transaction,
): Promise<MultisigCreationBlockhash> {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
  return { blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
}

export type MultisigCreationReadBack = {
  address: string;
  owner: string;
  threshold: number;
  memberCount: number;
  configAuthority: string;
  rentCollector: string | null;
};

export type MultisigCreationSignSendResult = {
  /** Signature de la transaction envoyee, `null` si aucun envoi n'a abouti. */
  signature: string | null;
  errorMessage: string | null;
  /** Code MWA exact de l'échec d'envoi, `null` s'il n'y en a pas — jamais inventé. */
  errorCode?: string | null;
  /** Preuve n°2 : statut de confirmation de la signature, relu sur la grappe. */
  confirmationStatus?: SignatureConfirmationStatus | null;
  confirmed?: boolean;
  /** Blockhash effectivement utilisé pour l'envoi, avec sa limite en blocs. */
  blockhash?: string | null;
  lastValidBlockHeight?: number | null;
  /** État affichable du parcours de signature. */
  signingState?: SigningState;
  readBack: MultisigCreationReadBack | null;
  /** Vrai seulement si l'envoi a reussi ET que la relecture confirme le contenu. */
  verified: boolean;
  validationErrors: string[];
  validationWarnings: string[];
};

const READ_BACK_ATTEMPTS = 4;
const READ_BACK_DELAY_MS = 1500;

const SINGLE_SEND_WARNING =
  'Call this once, from an explicit user gesture, with the same transaction instance that was simulated.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function sameAddress(decoded: PublicKey, expected: string): boolean {
  const expectedKey = toPublicKey(expected);
  return expectedKey !== null && decoded.equals(expectedKey);
}

/**
 * Signe (partiellement, avec la cle ephemere) et envoie la transaction de
 * creation, puis relit le multisig pour verifier ce qui a reellement ete cree.
 *
 * @param input.transaction instance EXACTE issue de `buildMultisigCreationTransaction`
 *   et deja simulee : aucune autre instance ne doit etre signee ou envoyee ;
 * @param input.ephemeralCreateKey signataire ephemere du meme build (memoire seule) ;
 * @param input.signAndSendTransactions fonction du provider MWA, passee en
 *   parametre pour que ce module reste sans React et testable ;
 * @param input.expectation valeurs attendues on-chain, pour la relecture.
 */
export async function signAndSendMultisigCreation(input: {
  connection: Connection;
  transaction: Transaction;
  ephemeralCreateKey: Keypair;
  signAndSendTransactions: SignAndSendTransactionsFn;
  multisigPda: string;
  expectation: MultisigCreationExpectation;
  /**
   * Blockhash deja pose (celui de la simulation finale). S'il est fourni, il
   * est reapplique tel quel : simulation, signature partielle et envoi
   * partagent alors le meme blockhash. Sinon un blockhash frais est demande.
   */
  blockhash?: MultisigCreationBlockhash;
}): Promise<MultisigCreationSignSendResult> {
  const errors: string[] = [];
  const warnings: string[] = [SINGLE_SEND_WARNING];

  const multisigPda = toPublicKey(input.multisigPda);
  if (multisigPda === null) {
    errors.push('InvalidMultisigPda: multisigPda is not a valid public address.');
  }
  if (input.transaction.feePayer === undefined || input.transaction.feePayer === null) {
    errors.push('MissingFeePayer: the transaction has no fee payer.');
  }
  if (input.transaction.instructions.length === 0) {
    errors.push('EmptyTransaction: the transaction carries no instruction.');
  }
  if (
    input.transaction.feePayer !== undefined &&
    input.transaction.feePayer !== null &&
    input.transaction.feePayer.equals(input.ephemeralCreateKey.publicKey)
  ) {
    errors.push(
      'InvalidSigners: the ephemeral createKey must not be the fee payer (creator pays).',
    );
  }

  if (errors.length > 0 || multisigPda === null) {
    return {
      signature: null,
      errorMessage: null,
      readBack: null,
      verified: false,
      validationErrors: errors,
      validationWarnings: warnings,
    };
  }

  // 1. Blockhash frais : indispensable avant partialSign, et utilise tel quel
  //    par le wallet (la bibliotheque MWA serialise la transaction sans la
  //    reconstruire, donc la signature partielle reste valide).
  let minContextSlot: number;
  try {
    if (input.blockhash !== undefined) {
      // Meme blockhash que la simulation finale : rien n'est re-demande au RPC.
      input.transaction.recentBlockhash = input.blockhash.blockhash;
      input.transaction.lastValidBlockHeight = input.blockhash.lastValidBlockHeight;
    } else {
      await applyFreshBlockhash(input.connection, input.transaction);
    }
    minContextSlot = await input.connection.getSlot('confirmed');
  } catch (caught: unknown) {
    errors.push(
      `BlockhashUnavailable: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return {
      signature: null,
      errorMessage: null,
      readBack: null,
      verified: false,
      validationErrors: errors,
      validationWarnings: warnings,
    };
  }

  // 1bis. Fenetre de signature : verdict rendu AVANT d'ouvrir le wallet.
  // La validite est jugee en BLOCS (jamais au chronometre) : sans marge
  // suffisante, le wallet n'est pas ouvert du tout.
  const bundle = blockhashBundleFromTransaction(input.transaction);
  let blockHeight: number | null = null;
  try {
    blockHeight = await input.connection.getBlockHeight('confirmed');
  } catch (caught: unknown) {
    errors.push(
      `BlockHeightUnavailable: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
  const signingWindow =
    bundle === null
      ? null
      : evaluateSigningWindow({ blockHeight, bundle, marginBlocks: DEFAULT_BLOCK_MARGIN });
  if (bundle === null || signingWindow === null || !signingWindow.usable) {
    if (signingWindow !== null && !signingWindow.usable) {
      errors.push(`SignatureWindowNotUsable: ${signingWindow.reason}`);
    }
    return {
      blockhash: bundle?.blockhash ?? null,
      errorMessage: null,
      lastValidBlockHeight: bundle?.lastValidBlockHeight ?? null,
      readBack: null,
      signature: null,
      signingState: 'signature-request-expired',
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 2. Signature locale du signataire ephemere, sur CETTE instance.
  try {
    input.transaction.partialSign(input.ephemeralCreateKey);
  } catch (caught: unknown) {
    errors.push(
      `PartialSignFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return {
      signature: null,
      errorMessage: null,
      readBack: null,
      verified: false,
      validationErrors: errors,
      validationWarnings: warnings,
    };
  }

  // 3. MWA : le wallet ajoute la signature du payeur et envoie.
  let signature: string | null = null;
  let errorMessage: string | null = null;
  let errorCode: string | null = null;
  let confirmation: SignatureConfirmation | null = null;
  try {
    const returned = await input.signAndSendTransactions(input.transaction, minContextSlot);
    signature = Array.isArray(returned) ? returned[0] ?? null : returned;
    if (signature === null || signature.length === 0) {
      errors.push('NoSignatureReturned: the wallet returned no transaction signature.');
    }
  } catch (caught: unknown) {
    errorMessage = caught instanceof Error ? caught.message : String(caught);
    // Le code MWA est conservé séparément : sans lui, l'erreur devient
    // indiagnosticable une fois reformulée en message lisible.
    errorCode = describeMwaError(caught, 'signAndSendTransactions').code;
    errors.push(`SendFailed: ${errorMessage}`);
  }

  if (signature === null) {
    return {
      signature: null,
      errorMessage,
      errorCode,
      readBack: null,
      verified: false,
      validationErrors: errors,
      validationWarnings: warnings,
    };
  }

  // 4. Relecture on-chain : ce qui a REELLEMENT ete cree, pas ce qu'on suppose.
  let readBack: MultisigCreationReadBack | null = null;
  for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt += 1) {
    try {
      const accountInfo = await input.connection.getAccountInfo(multisigPda, 'confirmed');
      if (accountInfo !== null) {
        const decoded = multisig.accounts.Multisig.fromAccountInfo(accountInfo)[0];
        readBack = {
          address: multisigPda.toString(),
          owner: accountInfo.owner.toString(),
          threshold: decoded.threshold,
          memberCount: decoded.members.length,
          configAuthority: decoded.configAuthority.toString(),
          rentCollector: decoded.rentCollector?.toString() ?? null,
        };
        break;
      }
    } catch (caught: unknown) {
      errors.push(
        `ReadBackFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      break;
    }
    if (attempt < READ_BACK_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, READ_BACK_DELAY_MS);
      });
    }
  }

  // Preuve n°2 : la transaction est-elle confirmée ? Sans elle, aucun succès.
  try {
    confirmation = await confirmSignature({ connection: input.connection, signature });
  } catch (caught: unknown) {
    errors.push(
      `ConfirmationCheckFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  if (readBack === null) {
    errors.push('ReadBackMissing: the multisig account is not readable yet.');
  } else {
    if (readBack.owner !== multisig.PROGRAM_ID.toString()) {
      errors.push(
        `OwnerMismatch: owner is ${readBack.owner}, expected ${multisig.PROGRAM_ID.toString()}.`,
      );
    }
    if (readBack.threshold !== input.expectation.threshold) {
      errors.push(
        `ThresholdMismatch: on-chain ${readBack.threshold}, expected ${input.expectation.threshold}.`,
      );
    }
    if (readBack.memberCount !== input.expectation.memberCount) {
      errors.push(
        `MemberCountMismatch: on-chain ${readBack.memberCount}, expected ${input.expectation.memberCount}.`,
      );
    }
    const expectedAuthority = input.expectation.configAuthority;
    const authorityMatches =
      expectedAuthority === null
        ? readBack.configAuthority === PublicKey.default.toString()
        : sameAddress(new PublicKey(readBack.configAuthority), expectedAuthority);
    if (!authorityMatches) {
      errors.push(
        `ConfigAuthorityMismatch: on-chain ${readBack.configAuthority}, expected ${
          expectedAuthority ?? PublicKey.default.toString()
        }.`,
      );
    }
  }

  return {
    blockhash: bundle.blockhash,
    lastValidBlockHeight: bundle.lastValidBlockHeight,
    signature,
    errorMessage,
    errorCode,
    confirmationStatus: confirmation?.status ?? null,
    confirmed: confirmation?.status === 'confirmed',
    readBack,
    signingState: signingStateFromEvidence({
      confirmed: confirmation?.status === 'confirmed',
      readBackVerified: errors.length === 0 && readBack !== null,
      signatureObtained: true,
    }),
    // Trois preuves exigees : signature obtenue, transaction confirmee,
    // compte metier relu et coherent. Aucune n'est optionnelle.
    verified:
      readBack !== null && errors.length === 0 && confirmation?.status === 'confirmed',
    validationErrors: errors,
    validationWarnings: warnings,
  };
}