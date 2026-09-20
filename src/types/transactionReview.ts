// Modèle de revue de transaction — LECTURE SEULE, aucun effet de bord.
// Ce module ne contient aucun appel réseau et aucune fonction d'écriture :
// il décrit uniquement ce qu'un futur écran de confirmation devra afficher.
// Les jeux de données PREVIEW ci-dessous sont locaux et fictifs : ils ne
// représentent aucune donnée on-chain.

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
  lamports: number;
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
  destination: ReviewField<string>;
  amount: ReviewField<SolAmount>;
  /** Renseigné uniquement si les frais sont réellement connus. */
  fee: ReviewField<SolAmount>;
  decodeStatus: DecodeStatus;
  /** Vrai pour un jeu de données local de démonstration. */
  isPreview: boolean;
}

/** Programmes reconnus par le MVP. Liste volontairement minimale. */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

// ---------------------------------------------------------------------------
// Jeux de données PREVIEW uniquement — aucune donnée on-chain.
// Les adresses ci-dessous sont dérivées localement (sha256 de chaînes
// « preview-only ») : format base58 valide, aucun compte existant, aucun lien
// avec les membres réels de la fixture devnet.
// ---------------------------------------------------------------------------

const PREVIEW_MULTISIG = 'DxaHm47inZWeBQmd63hSmEw43kvP9xebNo1H6wVznFXi';
const PREVIEW_VAULT = 'B6seGKSUaxfo7pQK4pUNKfhNbabA4gqKvV9iE6EByPHy';
const PREVIEW_SIGNER = 'GZUrVZnw4QoHf3SvXrYvWfFzVbXXHxoA9UKSajWBfUuM';
const PREVIEW_DESTINATION = '9hvAFWYxp2mbZeF7JmvnWZqrhxNrT8tCA2PMvcshHeuR';
const PREVIEW_UNKNOWN_PROGRAM = 'AhrJ9RJNLuNtS1DWPY5BhnKKakZdbNnr7VaGbyCbvnkX';

const basePreview = {
  network: 'devnet' as const,
  multisigAddress: PREVIEW_MULTISIG,
  vaultAddress: PREVIEW_VAULT,
  proposalIndex: 1,
  proposalStatus: 'Preview',
  signerWallet: PREVIEW_SIGNER,
  fee: unknownField<SolAmount>(), // les frais ne sont connus qu'après simulation
  isPreview: true,
};

/** Cas 1 : instruction reconnue, tous les champs critiques disponibles. */
export const PREVIEW_DECODED: TransactionReviewModel = {
  ...basePreview,
  program: knownField({
    id: SYSTEM_PROGRAM_ID,
    label: 'System Program',
  }),
  action: knownField('System Program: transfer'),
  destination: knownField(PREVIEW_DESTINATION),
  amount: knownField({ lamports: 0, unit: 'SOL' }),
  decodeStatus: 'decoded',
};

/** Cas 2 : instruction reconnue, mais destination inconnue. */
export const PREVIEW_PARTIAL: TransactionReviewModel = {
  ...basePreview,
  program: knownField({
    id: SYSTEM_PROGRAM_ID,
    label: 'System Program',
  }),
  action: knownField('System Program: transfer'),
  destination: unknownField<string>(),
  amount: knownField({ lamports: 0, unit: 'SOL' }),
  decodeStatus: 'partial',
};

/** Cas 3 : programme non reconnu, aucune interprétation tentée. */
export const PREVIEW_UNKNOWN: TransactionReviewModel = {
  ...basePreview,
  // L'adresse du programme est une donnée brute toujours lisible ; en revanche
  // aucun libellé, aucune action et aucun montant ne peuvent en être déduits.
  program: knownField({
    id: PREVIEW_UNKNOWN_PROGRAM,
    label: 'Unrecognized program',
  }),
  action: unknownField<string>(),
  destination: unknownField<string>(),
  amount: unknownField<SolAmount>(),
  decodeStatus: 'unknown',
};

export const PREVIEW_CASES: ReadonlyArray<{
  key: DecodeStatus;
  label: string;
  model: TransactionReviewModel;
}> = [
  { key: 'decoded', label: 'decoded', model: PREVIEW_DECODED },
  { key: 'partial', label: 'partial', model: PREVIEW_PARTIAL },
  { key: 'unknown', label: 'unknown', model: PREVIEW_UNKNOWN },
];