/**
 * Fixture devnet contrôlée : crée un multisig Squads v4 2/2 sur devnet.
 *
 * Usage :
 *   npx tsx scripts/create-devnet-fixture.ts --check   # lecture seule, aucun envoi
 *   npx tsx scripts/create-devnet-fixture.ts           # crée le multisig
 *
 * Ce script est le SEUL endroit du dépôt qui signe une transaction. Il tourne
 * côté machine, jamais depuis l'application. Aucune clé secrète n'est affichée
 * ni journalisée : seules des adresses publiques et des signatures le sont.
 *
 * Clés attendues, HORS du dépôt : ~/.config/pocket-multisig/devnet/*.json
 *   creator.json / createKey.json / approver.json
 *
 * DEVNET UNIQUEMENT. Ne jamais pointer cet endpoint vers mainnet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

/** Endpoint devnet, gelé. Aucun mainnet dans ce fichier. */
const ENDPOINT = 'https://api.devnet.solana.com';

/** Répertoire des clés de test, hors dépôt. */
const KEY_DIR = join(homedir(), '.config', 'pocket-multisig', 'devnet');

/** Fichier public de traçabilité, hors dépôt. */
const PUBLIC_FIXTURE = join(KEY_DIR, 'fixture-public.json');

/**
 * Membre 1 : adresse PUBLIQUE du wallet connecté sur le Seeker.
 * Surchargeable : --member1 <adresse>.
 */
const DEFAULT_MEMBER1 = '7QYS4eNEF4givC2HPDhu6GYV1tR3bAji6Y5Fz3xdNKXg';

const THRESHOLD = 2;
const TIME_LOCK = 0;

/** Charge un keypair depuis le répertoire externe. N'affiche jamais son contenu. */
function loadKeypair(name: string): Keypair {
  const path = join(KEY_DIR, `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Clé absente : ${path} (générer hors dépôt avant de relancer).`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertDevnet(connection: Connection): void {
  if (!connection.rpcEndpoint.includes('devnet')) {
    throw new Error(`Réseau non-devnet détecté : ${connection.rpcEndpoint} — arrêt.`);
  }
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const connection = new Connection(ENDPOINT, 'confirmed');
  assertDevnet(connection);

  const member1 = new PublicKey(argValue('--member1') ?? DEFAULT_MEMBER1);
  const creator = loadKeypair('creator');
  const createKey = loadKeypair('createKey');
  const approver = loadKeypair('approver');

  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
  );
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  const balance = await connection.getBalance(creator.publicKey, 'confirmed');
  const rentBuffer = await connection.getMinimumBalanceForRentExemption(512);
  const creationFee = Number(programConfig.multisigCreationFee);
  const estimatedNeed = creationFee + rentBuffer + 10_000;

  console.log('--- fixture devnet pocket-multisig ---');
  console.log('cluster           : devnet');
  console.log('fee payer / creator:', creator.publicKey.toBase58());
  console.log('createKey         :', createKey.publicKey.toBase58());
  console.log('membre 1 (Seeker) :', member1.toBase58());
  console.log('membre 2 (local)  :', approver.publicKey.toBase58());
  console.log('treasury (program):', programConfig.treasury.toBase58());
  console.log('multisigPda       :', multisigPda.toBase58());
  console.log('vaultPda (index 0):', vaultPda.toBase58());
  console.log('creationFee (lam) :', creationFee);
  console.log('solde creator     :', balance, 'lamports');
  console.log('besoin estimé     :', estimatedNeed, 'lamports');

  if (checkOnly) {
    console.log('mode --check : aucune transaction envoyée.');
    return;
  }
  if (balance < estimatedNeed) {
    throw new Error(
      `Solde insuffisant (${balance} < ${estimatedNeed} lamports) : financer ${creator.publicKey.toBase58()} sur devnet, puis relancer.`,
    );
  }

  const permissions = multisig.types.Permissions.all();
  const members = [
    { key: member1, permissions },
    { key: approver.publicKey, permissions },
  ];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = multisig.transactions.multisigCreateV2({
    blockhash,
    treasury: programConfig.treasury,
    creator: creator.publicKey,
    multisigPda,
    configAuthority: null,
    threshold: THRESHOLD,
    members,
    timeLock: TIME_LOCK,
    createKey: createKey.publicKey,
    rentCollector: null,
  });
  // Signataires exigés par l'API : creator et createKey.
  transaction.sign([creator, createKey]);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
  });
  console.log('signature         :', signature);

  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (confirmation.value.err) {
    throw new Error(`Transaction non confirmée : ${JSON.stringify(confirmation.value.err)}`);
  }
  console.log('statut            : confirmée');

  // Relecture par le SDK officiel, puis contrôle des invariants.
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const memberAddresses = account.members.map((m) => m.key.toBase58());
  const mask = (m: { permissions: { mask: number } }) => m.permissions.mask;

  const checks: [string, boolean][] = [
    ['threshold = 2', account.threshold === 2],
    ['exactement 2 membres', account.members.length === 2],
    ['membre 1 (Seeker) présent', memberAddresses.includes(member1.toBase58())],
    ['membre 2 (local) présent', memberAddresses.includes(approver.publicKey.toBase58())],
    ['permissions membre 1 = 7', mask(account.members[0]) === 7],
    ['permissions membre 2 = 7', mask(account.members[1]) === 7],
    ['configAuthority = null', account.configAuthority.equals(PublicKey.default)],
    ['timeLock = 0', account.timeLock === 0],
    ['rentCollector = null', account.rentCollector === null],
  ];
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${label}`);
  }
  if (!checks.every(([, ok]) => ok)) {
    throw new Error('Invariants non respectés après relecture.');
  }

  // Fichier public uniquement : aucune clé, aucun secret.
  writeFileSync(
    PUBLIC_FIXTURE,
    `${JSON.stringify(
      {
        cluster: 'devnet',
        multisigPda: multisigPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        members: memberAddresses,
        threshold: account.threshold,
        creationFeeLamports: creationFee,
        creationSignature: signature,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log('fichier public    :', PUBLIC_FIXTURE);
}

main().catch((error: unknown) => {
  console.error('ERREUR:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});