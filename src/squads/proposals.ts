// Lecture en LECTURE SEULE des propositions d'un multisig Squads v4.
// Aucune écriture, aucun scan de programme, aucun parsing manuel de buffer :
// toute la désérialisation passe par les classes officielles du SDK.
import { useCallback, useEffect, useState } from 'react';
import { PublicKey, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { connection } from '../solana/connection';
import { decodeVaultTransactionMessage } from '../solana/decodeVaultTransaction';
import {
  modelFromInstructions,
  type ReviewContext,
} from '../solana/decodeTransactionMessage';
import {
  abbreviateAddress,
  formatLamportsExact,
  SYSTEM_PROGRAM_ID,
  type TransactionReviewModel,
} from '../types/transactionReview';

/**
 * Statut de proposition tel qu'exposé par le type officiel du SDK :
 * union discriminée sur `__kind`. On dérive le type depuis la classe
 * `Proposal` installée plutôt que de redéclarer une liste de valeurs.
 */
export type ProposalStatusKind = multisig.accounts.Proposal['status']['__kind'];

export interface ProposalView {
  /** Index de transaction dans le multisig (entier). */
  index: number;
  /**
   * Adresse de la vault transaction correspondante, dérivée localement à
   * partir de `getTransactionPda`. Non affichée et non lue à ce stade :
   * aucun appel RPC supplémentaire n'est fait pour elle (préparée pour T09).
   */
  vaultTransactionAddress: string;
  status: ProposalStatusKind;
  /** Nombre d'approbations déjà enregistrées (`Proposal.approved`). */
  approvals: number;
  /**
   * Adresses publiques ayant déjà approuvé, telles que renvoyées par le SDK
   * officiel. Lues dans le même `getMultipleAccountsInfo` que le reste : aucun
   * appel RPC supplémentaire. Nécessaire au contrôle « wallet absent de
   * approved » du guard.
   */
  approvedAddresses: string[];
}

export interface ProposalList {
  proposals: ProposalView[];
  /** Comptes dérivés absents ou non désérialisables, ignorés proprement. */
  unreadable: number;
  /**
   * Instrumentation : nombre d'appels `getMultipleAccountsInfo` réellement
   * effectués. Vaut 0 dès que la liste d'index est vide, notamment quand
   * `transactionIndex === 0`.
   */
  rpcCalls: number;
}

/**
 * Calcule les index de transactions à interroger.
 *
 * Règles :
 * - `transactionIndex === 0` (ou invalide) → aucune index, aucun PDA, aucun RPC ;
 * - les index strictement antérieurs à `staleTransactionIndex` sont périmés et
 *   sont exclus (sémantique documentée par Squads : une proposition dont
 *   `transactionIndex < staleTransactionIndex` ne peut plus être approuvée) ;
 * - la borne haute est `transactionIndex` inclus.
 *
 * Fonction pure : aucun accès réseau, donc testable hors ligne.
 */
export function computeProposalIndexes(
  transactionIndex: number,
  staleTransactionIndex: number,
): number[] {
  if (!Number.isInteger(transactionIndex) || transactionIndex < 1) return [];

  const indexes: number[] = [];
  for (let index = 1; index <= transactionIndex; index += 1) {
    if (index < staleTransactionIndex) continue;
    indexes.push(index);
  }
  return indexes;
}

/**
 * Charge les propositions d'un multisig. Un seul appel RPC au maximum
 * (`getMultipleAccountsInfo` sur les PDA de proposition dérivés localement).
 *
 * @param multisigPda adresse de configuration du multisig
 * @param transactionIndex index courant lu sur le compte du multisig
 * @param staleTransactionIndex index de péremption lu sur le compte du multisig
 */
export async function loadProposals(
  connection_: Connection,
  multisigPda: PublicKey,
  transactionIndex: number,
  staleTransactionIndex: number,
): Promise<ProposalList> {
  const indexes = computeProposalIndexes(transactionIndex, staleTransactionIndex);

  // Règle obligatoire : rien à interroger, on sort avant tout appel réseau.
  if (indexes.length === 0) {
    return { proposals: [], unreadable: 0, rpcCalls: 0 };
  }

  const derived = indexes.map((index) => ({
    index,
    proposalAddress: multisig.getProposalPda({
      multisigPda,
      transactionIndex: BigInt(index),
    })[0],
    vaultTransactionAddress: multisig.getTransactionPda({
      multisigPda,
      index: BigInt(index),
    })[0],
  }));

  const infos = await connection_.getMultipleAccountsInfo(
    derived.map((entry) => entry.proposalAddress),
    'confirmed',
  );

  const proposals: ProposalView[] = [];
  let unreadable = 0;

  for (let position = 0; position < derived.length; position += 1) {
    const entry = derived[position];
    const info = infos[position];
    if (!entry) continue;
    if (!info) {
      unreadable += 1;
      continue;
    }
    try {
      const [proposal] = multisig.accounts.Proposal.fromAccountInfo(info);
      proposals.push({
        index: entry.index,
        vaultTransactionAddress: entry.vaultTransactionAddress.toBase58(),
        status: proposal.status.__kind,
        approvals: proposal.approved.length,
        approvedAddresses: proposal.approved.map((entry) => entry.toBase58()),
      });
    } catch {
      // Compte illisible (autre type ou version) : ignoré sans casser la liste.
      unreadable += 1;
    }
  }

  return { proposals, unreadable, rpcCalls: 1 };
}

export interface OperationSummary {
  action: string;
  amount: string;
  destination: string;
}

/**
 * Résumé d'opération, purement dérivé d'un modèle DÉJÀ décodé. Renvoie `null`
 * quand aucun modèle n'est disponible : l'appelant décide alors de l'état
 * affiché (chargement / indisponible), sans rien inventer.
 */
export function summarizeOperation(model: TransactionReviewModel | null): OperationSummary | null {
  if (model === null) return null;
  const isTransfer =
    model.program.known &&
    model.program.value.id === SYSTEM_PROGRAM_ID &&
    model.action.known &&
    /transfer/i.test(model.action.value);
  return {
    action: isTransfer
      ? 'SOL transfer'
      : model.action.known
        ? model.action.value
        : 'Unknown action',
    amount: model.amount.known ? formatLamportsExact(model.amount.value.lamports) : 'Unknown amount',
    destination: model.destination.known
      ? abbreviateAddress(model.destination.value)
      : 'Unknown destination',
  };
}

/** État de décision d'une proposition, tel qu'affiché dans la boîte de réception. */
export type ProposalDecisionKind = 'attention' | 'approved' | 'approved-by-you' | 'none';

export interface ProposalDecision {
  index: number;
  kind: ProposalDecisionKind;
  /** Titre de regroupement affiché en tête de la boîte de réception. */
  heading: string;
  /** Ligne d'état, dérivée du statut on-chain réel. */
  stateLabel: string;
  approvals: number;
  threshold: number;
}

export interface ProposalDecisionInput {
  index: number;
  status: ProposalStatusKind;
  approvedAddresses: readonly string[];
  rejectedAddresses?: readonly string[];
  threshold: number;
  walletAddress: string | null;
  /** Vrai si le wallet connecté peut encore approuver (membre avec Vote). */
  walletCanApprove: boolean;
}

/**
 * Décision pure, sans I/O : classe une proposition selon le statut RENVOYÉ par
 * la chaîne et l'état réel des approbations. Aucun état n'est inventé ni codé
 * en dur pour la fixture.
 */
export function computeProposalDecision(input: ProposalDecisionInput): ProposalDecision {
  const { index, status, approvedAddresses, threshold, walletAddress, walletCanApprove } = input;
  const approvals = approvedAddresses.length;
  const walletApproved = walletAddress !== null && approvedAddresses.includes(walletAddress);
  const base = { index, approvals, threshold };

  // Seuil atteint ET statut réellement `Approved` : seule condition pour
  // annoncer une exécution possible.
  if (status === 'Approved' && approvals >= threshold) {
    return { ...base, kind: 'approved', heading: 'Approved proposals', stateLabel: 'Ready to execute' };
  }
  // Le wallet a voté mais le seuil n'est pas atteint.
  if (status === 'Active' && walletApproved) {
    const missing = Math.max(threshold - approvals, 0);
    return {
      ...base,
      kind: 'approved-by-you',
      heading: 'Approved by you',
      stateLabel: `Waiting for ${missing} more approval${missing > 1 ? 's' : ''}`,
    };
  }
  // Proposition encore ouverte et approuvable par ce wallet.
  if (status === 'Active' && !walletApproved && walletCanApprove) {
    return { ...base, kind: 'attention', heading: 'Needs your attention', stateLabel: 'Approval available' };
  }
  return { ...base, kind: 'none', heading: 'Other proposals', stateLabel: `Status: ${status}` };
}

/** Compte les propositions par catégorie de décision. */
export function summarizeDecisions(decisions: readonly ProposalDecision[]): {
  attention: number;
  approved: number;
  approvedByYou: number;
} {
  return {
    attention: decisions.filter((entry) => entry.kind === 'attention').length,
    approved: decisions.filter((entry) => entry.kind === 'approved').length,
    approvedByYou: decisions.filter((entry) => entry.kind === 'approved-by-you').length,
  };
}

export type ProposalsStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Contexte public de revue, sans le marqueur de preview. */
export type ProposalReviewContext = Omit<ReviewContext, 'isPreview'>;

export interface ProposalReviewResult {
  model: TransactionReviewModel;
  /** Instrumentation : nombre d'appels RPC réellement effectués (0 ou 1). */
  rpcCalls: number;
}

/**
 * Charge la revue d'une proposition : un seul appel RPC ciblé sur la
 * VaultTransaction PDA dérivée de l'index déjà connu. Désérialisation
 * exclusivement par le SDK officiel.
 */
export async function loadProposalReview(
  connection_: Connection,
  multisigPda: PublicKey,
  context: ProposalReviewContext,
  index: number,
): Promise<ProposalReviewResult> {
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: BigInt(index),
  });

  const info = await connection_.getAccountInfo(transactionPda, 'confirmed');
  if (info === null) {
    const model = modelFromInstructions([], { ...context, isPreview: false });
    model.decodeStatus = 'unknown';
    model.notes = [`No vault transaction found at ${transactionPda.toBase58()}.`];
    return { model, rpcCalls: 1 };
  }

  const [vaultTransaction] = multisig.accounts.VaultTransaction.fromAccountInfo(info);
  return {
    model: decodeVaultTransactionMessage(vaultTransaction.message, {
      ...context,
      isPreview: false,
    }),
    rpcCalls: 1,
  };
}

export interface ProposalsState {
  error: string | null;
  list: ProposalList | null;
  retry: () => void;
  status: ProposalsStatus;
}

/**
 * État de lecture des propositions du multisig courant. Se réinitialise
 * automatiquement quand le multisig est déchargé (bouton Clear).
 */
export function useProposals(
  multisigAddress: string | null,
  transactionIndex: number,
  staleTransactionIndex: number,
): ProposalsState {
  const [status, setStatus] = useState<ProposalsStatus>('idle');
  const [list, setList] = useState<ProposalList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (multisigAddress === null) {
      setStatus('idle');
      setList(null);
      setError(null);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const multisigPda = new PublicKey(multisigAddress);
      setList(await loadProposals(connection, multisigPda, transactionIndex, staleTransactionIndex));
      setStatus('loaded');
    } catch (caught: unknown) {
      setError(
        `Lecture des propositions impossible : ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
      setStatus('error');
    }
  }, [multisigAddress, transactionIndex, staleTransactionIndex]);

  useEffect(() => {
    void run();
  }, [run]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  return { error, list, retry, status };
}