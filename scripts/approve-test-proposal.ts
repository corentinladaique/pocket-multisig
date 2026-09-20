/**
 * Second vote : UNE SEULE approbation de Proposal #1 par l'approver local.
 *
 * Autorisation : une seule transaction, un seul envoi, devnet uniquement.
 * Aucun vaultTransactionExecute, aucun financement du vault, aucun retry.
 * Les clés sont lues depuis le répertoire privé externe ; leur contenu n'est
 * jamais affiché.
 *
 * Usage :
 *   npx tsx scripts/approve-test-proposal.ts --check   # lecture seule
 *   npx tsx scripts/approve-test-proposal.ts           # une seule écriture
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

const ENDPOINT = 'https://api.devnet.solana.com';
const KEYDIR = join(homedir(), '.config', 'pocket-multisig', 'devnet');

const EXPECTED_MULTISIG = 'BbNr77iyMyn8ipzX2PLGN8mDTCA1cMconfZSzzDcW7xi';
const EXPECTED_APPROVER = '8PdEGQV8GnfTvTsxrmkKyyMPTHCDjb844YGbRABs6Uin';
const TRANSACTION_INDEX = 1n;

const check = process.argv.includes('--check');

function loadKeypair(name: string): Keypair {
  const raw = readFileSync(join(KEYDIR, `${name}.json`), 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

function publicFixture(): { members: string[]; threshold: number } {
  const raw = readFileSync(join(KEYDIR, 'fixture-public.json'), 'utf8');
  const parsed = JSON.parse(raw) as { members: string[]; threshold: number };
  return parsed;
}

function fail(message: string): never {
  console.error(`ARRÊT: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const connection = new Connection(ENDPOINT, 'confirmed');
  const fixture = publicFixture();

  const feePayer = loadKeypair('creator');
  const member = loadKeypair('approver');
  const memberAddress = member.publicKey.toBase58();

  if (memberAddress !== EXPECTED_APPROVER) {
    fail(`adresse publique de l'approver inattendue (${memberAddress})`);
  }

  const multisigPda = new PublicKey(EXPECTED_MULTISIG);
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: TRANSACTION_INDEX,
  });

  // --- Préconditions (lecture seule) --------------------------------------
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  const approved = proposal.approved.map((entry) => entry.toBase58());

  console.log('--- préconditions (lecture) ---');
  console.log(`cluster                  : devnet (${connection.rpcEndpoint})`);
  console.log(`multisig                 : ${multisigPda.toBase58()}`);
  console.log(`proposal PDA             : ${proposalPda.toBase58()}`);
  console.log(`transactionIndex         : ${Number(account.transactionIndex)}`);
  console.log(`staleTransactionIndex    : ${Number(account.staleTransactionIndex)}`);
  console.log(`threshold                : ${account.threshold}`);
  console.log(`proposal status          : ${proposal.status.__kind}`);
  console.log(`approved.length          : ${approved.length}`);
  console.log(`approved (adresses)      : ${approved.join(', ') || '(aucune)'}`);
  console.log(`rejected.length          : ${proposal.rejected.length}`);
  console.log(`approver public          : ${memberAddress}`);
  console.log(`fee payer public         : ${feePayer.publicKey.toBase58()}`);

  if (account.threshold !== 2) fail(`threshold inattendu (${account.threshold})`);
  if (Number(account.transactionIndex) !== 1) fail('transactionIndex != 1');
  if (Number(account.staleTransactionIndex) > 1) fail('proposal index 1 is stale');
  if (proposal.status.__kind !== 'Active') fail(`statut ${proposal.status.__kind}, attendu Active`);
  if (approved.length !== 1) fail(`approved.length = ${approved.length}, attendu 1`);
  if (proposal.rejected.length !== 0) fail('rejected.length != 0');
  if (!approved.includes(fixture.members[0] ?? '')) {
    fail(`le wallet Seeker attendu est absent de approved (${approved.join(', ')})`);
  }
  if (approved.includes(memberAddress)) fail('approver déjà présent dans approved');

  const memberEntry = account.members.find((entry) => entry.key.equals(member.publicKey));
  if (memberEntry === undefined) fail('approver non membre du multisig');
  if (!multisig.types.Permissions.has(memberEntry.permissions, multisig.types.Permission.Vote)) {
    fail('approver sans permission Vote');
  }
  console.log('approver membre + Vote   : OK');

  if (check) {
    console.log('--- mode --check : aucune écriture effectuée ---');
    return;
  }

  // --- Construction : une seule instruction ---------------------------------
  const instruction = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex: TRANSACTION_INDEX,
    member: member.publicKey,
  });

  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const message = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message([]);

  if (message.compiledInstructions.length !== 1) {
    fail(`la transaction contient ${message.compiledInstructions.length} instructions, attendu 1`);
  }

  const transaction = new VersionedTransaction(message);
  transaction.sign([feePayer, member]);

  console.log('--- résumé avant envoi ---');
  console.log(`program ID               : ${instruction.programId.toBase58()}`);
  console.log(`instructions             : ${message.compiledInstructions.length}`);
  console.log(`signataires              : fee payer + approver local`);

  // --- Simulation ----------------------------------------------------------
  const simulation = await connection.simulateTransaction(transaction);
  console.log(`simulation err           : ${simulation.value.err === null ? 'null (OK)' : JSON.stringify(simulation.value.err)}`);
  console.log(`simulation units         : ${simulation.value.unitsConsumed ?? 'n/a'}`);
  if (simulation.value.err !== null) {
    process.stdout.write(JSON.stringify(simulation.value.logs ?? [], null, 2), () => {});
    fail('simulation en erreur : aucun envoi');
  }

  // --- Envoi unique --------------------------------------------------------
  console.log('--- envoi (une seule tentative) ---');
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
  });
  console.log(`signature                : ${signature}`);

  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight },
    'confirmed',
  );
  console.log(`meta.err                 : ${JSON.stringify(confirmation.value.err)}`);
  if (confirmation.value.err !== null) {
    console.log('Confirmation en erreur. NE PAS renvoyer : vérifier la signature existante.');
    return;
  }

  // --- Relecture (lecture seule) -------------------------------------------
  const refreshed = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  const refreshedApproved = refreshed.approved.map((entry) => entry.toBase58());
  console.log('--- après confirmation (lecture) ---');
  console.log(`proposal status          : ${refreshed.status.__kind}`);
  console.log(`approved.length          : ${refreshedApproved.length}`);
  console.log(`approved (adresses)      : ${refreshedApproved.join(', ')}`);
  console.log(`seeker présent           : ${refreshedApproved.includes(fixture.members[0] ?? '')}`);
  console.log(`approver local présent   : ${refreshedApproved.includes(memberAddress)}`);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  console.log(`vault solde              : ${await connection.getBalance(vaultPda, 'confirmed')}`);
  console.log('Aucune exécution : vaultTransactionExecute jamais construite.');
}

main().catch((error: unknown) => {
  console.error(`ERREUR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});