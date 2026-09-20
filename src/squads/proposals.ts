// Lecture en LECTURE SEULE des propositions d'un multisig Squads v4.
// Aucune écriture, aucun scan de programme, aucun parsing manuel de buffer :
// toute la désérialisation passe par les classes officielles du SDK.
import { useCallback, useEffect, useState } from 'react';
import { PublicKey, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { connection } from '../solana/connection';

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
      });
    } catch {
      // Compte illisible (autre type ou version) : ignoré sans casser la liste.
      unreadable += 1;
    }
  }

  return { proposals, unreadable, rpcCalls: 1 };
}

export type ProposalsStatus = 'idle' | 'loading' | 'loaded' | 'error';

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