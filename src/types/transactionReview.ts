// Modèle de revue de transaction — LECTURE SEULE, aucun effet de bord.
// Ce module ne contient ni appel réseau, ni fonction de signature, ni hook :
// il ne décrit que ce qu'un écran de confirmation doit afficher, et fournit
// les helpers de formatage exacts utilisés pour l'affichage.

/** État de décodage d'une instruction. */
export type DecodeStatus = 'decoded' | 'partial' | 'unknown';

/**
 * Champ dont la présence n'est pas garantie. `known: false` signifie
 * « information absente » : elle doit être affichée comme « Unknown »,
 * jamais devinée ni reconstruite par défaut.
 */
export type ReviewField<T> = { known: true; value: T } | { known: false };

export const unknownField = <T>(): ReviewField<T> => ({ known: false });
export const knownField = <T>(value: T): ReviewField<T> => ({ known: true, value });

export interface ProgramDescriptor {
  /** Adresse base58 du programme appelé. */
  id: string;
  /** Libellé lisible, ex. « System Program ». */
  label: string;
}

export interface SolAmount {
  /**
   * Montant en lamports, conservé en `bigint` : un `number` perdrait de la
   * précision au-delà de 2^53 lamports (~9 M SOL) et ne doit jamais être
   * utilisé pour transporter une valeur monétaire.
   */
  lamports: bigint;
  /** Unité toujours explicite à l'affichage. */
  unit: 'SOL';
}

export interface TransactionReviewModel {
  network: 'devnet';
  multisigAddress: string;
  vaultAddress: string;
  proposalIndex: number;
  proposalStatus: string;
  /** Adresse publique du wallet qui signerait (aucune donnée privée). */
  signerWallet: string;
  program: ReviewField<ProgramDescriptor>;
  action: ReviewField<string>;
  /** Compte source réellement décodé (distinct du vault attendu). */
  source: ReviewField<string>;
  destination: ReviewField<string>;
  amount: ReviewField<SolAmount>;
  /** Renseigné uniquement si les frais sont réellement connus. */
  fee: ReviewField<SolAmount>;
  decodeStatus: DecodeStatus;
  /** Vrai pour un jeu de données local de démonstration. */
  isPreview: boolean;
  /** Messages techniques lisibles (avertissements de revue). */
  notes: string[];
}

/** Program ID du System Program : seul programme « interprétable » du MVP. */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/**
 * Abrège une adresse publique pour l'affichage mobile (`7QYS…NKXg`).
 * Purement cosmétique : la valeur complète reste disponible dans le modèle et
 * n'est jamais modifiée par cette fonction.
 */
export function abbreviateAddress(address: string, keep = 4): string {
  if (address.length <= keep * 2 + 1) return address;
  return `${address.slice(0, keep)}…${address.slice(-keep)}`;
}

/**
 * Convertit des lamports en SOL **sans arrondi** : la partie entière et la
 * partie fractionnaire sont calculées en arithmétique entière (`bigint`),
 * jamais via une division flottante.
 */
export function formatLamportsExact(lamports: bigint): string {
  const negative = lamports < 0n;
  const absolute = negative ? -lamports : lamports;
  const whole = absolute / 1_000_000_000n;
  const fraction = absolute % 1_000_000_000n;
  const sign = negative ? '-' : '';
  if (fraction === 0n) return `${sign}${whole} SOL`;
  const digits = fraction.toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole}.${digits} SOL`;
}