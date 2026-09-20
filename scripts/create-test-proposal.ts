/**
 * Crée UNE vault transaction et UNE proposal de test sur la fixture devnet.
 *
 * Autorisation : une seule écriture, sur la fixture contrôlée existante.
 * Rôles : `creator.json` = fee payer + rent payer uniquement ;
 *         `approver.json` = creator Squads (member initiateur) ;
 *         seuls signataires autorisés, aucune signature demandée au Seeker.
 * Aucune approbation, aucune exécution, aucun financement du vault, aucun RPC
 * de type scan. Les clés sont lues depuis le répertoire privé externe et leur
 * contenu n'est jamais affiché.
 *
 * Usage :
 *   npx tsx scripts/create-test-proposal.ts --check   # lecture seule
 *   npx tsx scripts/create-test-proposal.ts           # une seule création
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

const ENDPOINT = 'https://api.devnet.solana.com';
const KEYDIR = join(homedir(), '.config', 'pocket-multisig', 'devnet');

const EXPECTED_MULTISIG = 'BbNr77iyMyn8ipzX2PLGN8mDTCA1cMconfZSzzDcW7xi';
const EXPECTED_VAULT = 'GLcZLbQZpMed3m8dAFF7XtNEn4TjedeLGKZeJSAG6yGG';
const EXPECTED_CREATOR = 'GNhzPfjYdmcb4bJyMyN7szgNMXJQmscURVyWdpEYJN6E';
const EXPECTED_APPROVER = '8PdEGQV8GnfTvTsxrmkKyyMPTHCDjb844YGbRABs6Uin';

const PROGRAM_ID = multisig.PROGRAM_ID;
const TRANSACTION_INDEX = 1n;
const VAULT_INDEX = 0;

const check = process.argv.includes('--check');

/** Charge une clé depuis le répertoire privé externe. Contenu jamais affiché. */
function loadKeypair(name: string): Keypair {
  const raw = readFileSync(join(KEYDIR, `${name}.json`), 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

function fail(message: string): never {
  console.error(`ARRÊT: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const connection = new Connection(ENDPOINT, 'confirmed');

  const creator = loadKeypair('creator');
  const approver = loadKeypair('approver');

  const feePayer = creator; // uniquement fee payer + rent payer
  const member = approver; // seul member local : creator Squads des instructions

  const feePayerAddress = feePayer.publicKey.toBase58();
  const memberAddress = member.publicKey.toBase58();

  if (feePayerAddress !== EXPECTED_CREATOR) {
    fail(`l'adresse publique du fee payer diffère de l'attendue (${feePayerAddress})`);
  }
  if (memberAddress !== EXPECTED_APPROVER) {
    fail(`l'adresse publique du member diffère de l'attendue (${memberAddress})`);
  }

  const multisigPda = new PublicKey(EXPECTED_MULTISIG);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: VAULT_INDEX });
  const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: TRANSACTION_INDEX });
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex: TRANSACTION_INDEX });

  // --- Phase A : préconditions -------------------------------------------
  const accountInfo = await connection.getAccountInfo(multisigPda, 'confirmed');
  if (accountInfo === null) fail('le compte multisig est absent');
  if (!accountInfo.owner.equals(PROGRAM_ID)) {
    fail(`owner inattendu (${accountInfo.owner.toBase58()})`);
  }

  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);

  const transactionIndex = Number(account.transactionIndex);
  const staleTransactionIndex = Number(account.staleTransactionIndex);

  console.log('--- préconditions (lecture) ---');
  console.log(`cluster                  : devnet`);
  console.log(`multisig                 : ${multisigPda.toBase58()}`);
  console.log(`owner                    : ${accountInfo.owner.toBase58()}`);
  console.log(`vault index 0            : ${vaultPda.toBase58()}`);
  console.log(`threshold                : ${account.threshold}`);
  console.log(`transactionIndex         : ${transactionIndex}`);
  console.log(`staleTransactionIndex    : ${staleTransactionIndex}`);
  console.log(`creator public           : ${feePayerAddress}`);
  console.log(`member initiateur        : ${memberAddress}`);
  console.log(`destination public       : ${memberAddress}`);
  console.log(`proposal PDA (index 1)   : ${proposalPda.toBase58()}`);
  console.log(`vaultTransaction PDA (1) : ${transactionPda.toBase58()}`);

  if (vaultPda.toBase58() !== EXPECTED_VAULT) {
    fail('le vault d\'index 0 ne correspond pas à l\'adresse attendue');
  }
  if (account.threshold !== 2) {
    fail(`threshold inattendu (${account.threshold})`);
  }
  if (transactionIndex !== 0) {
    fail(`transactionIndex vaut ${transactionIndex} : aucune création (déjà consommé)`);
  }

  const memberAccount = account.members.find((entry) => entry.key.equals(member.publicKey));
  if (memberAccount === undefined) {
    fail('le member initiateur ne fait pas partie des membres du multisig');
  }
  const hasInitiate = multisig.types.Permissions.has(
    memberAccount.permissions,
    multisig.types.Permission.Initiate,
  );
  const hasVote = multisig.types.Permissions.has(
    memberAccount.permissions,
    multisig.types.Permission.Vote,
  );
  if (!hasInitiate || !hasVote) {
    fail(`permissions insuffisantes (Initiate=${hasInitiate}, Vote=${hasVote})`);
  }
  // Garde-fou : le fee payer ne doit jamais servir de creator Squads.
  if (account.members.some((entry) => entry.key.equals(feePayer.publicKey))) {
    fail('le fee payer est membre du multisig : configuration inattendue');
  }
  console.log(`member Initiate + Vote   : OK`);

  const existing = await connection.getMultipleAccountsInfo([proposalPda, transactionPda], 'confirmed');
  if (existing[0] !== null || existing[1] !== null) {
    fail('un PDA d\'index 1 existe déjà : arrêt, pas d\'index 2 automatique');
  }
  console.log('PDAs index 1             : inexistants (OK)');
  console.log(`vault financé            : ${(await connection.getBalance(vaultPda, 'confirmed')) > 0 ? 'OUI' : 'non'}`);
  console.log(`solde creator (lamports) : ${await connection.getBalance(creator.publicKey, 'confirmed')}`);

  if (check) {
    console.log('--- mode --check : aucune écriture effectuée ---');
    return;
  }

  // --- Phase B/C : construction -------------------------------------------
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  // Message que le vault exécuterait : un unique transfert de 0 lamport.
  const innerInstructions = [
    SystemProgram.transfer({
      fromPubkey: vaultPda,
      toPubkey: approver.publicKey,
      lamports: 0,
    }),
  ];
  const innerMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: innerInstructions,
  });

  const vaultTransactionInstruction = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: TRANSACTION_INDEX,
    creator: member.publicKey,
    rentPayer: feePayer.publicKey,
    vaultIndex: VAULT_INDEX,
    ephemeralSigners: 0,
    transactionMessage: innerMessage,
  });

  const proposalInstruction = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: TRANSACTION_INDEX,
    creator: member.publicKey,
    rentPayer: feePayer.publicKey,
  });

  const outerMessage = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: blockhash,
    instructions: [vaultTransactionInstruction, proposalInstruction],
  }).compileToV0Message([]); // aucune Address Lookup Table

  const transaction = new VersionedTransaction(outerMessage);
  // Seuls signataires : fee payer (local) et member initiateur (local).
  transaction.sign([feePayer, member]);

  console.log('--- résumé avant envoi ---');
  console.log(`program IDs              : ${vaultTransactionInstruction.programId.toBase58()}, ${proposalInstruction.programId.toBase58()}`);
  console.log(`lamports (vault tx)      : 0`);
  console.log(`instructions             : ${outerMessage.compiledInstructions.length}`);

  // --- Phase D : simulation -----------------------------------------------
  const simulation = await connection.simulateTransaction(transaction);
  console.log(`simulation err           : ${simulation.value.err === null ? 'null (OK)' : JSON.stringify(simulation.value.err)}`);
  console.log(`simulation units         : ${simulation.value.unitsConsumed ?? 'n/a'}`);
  if (simulation.value.err !== null) {
    process.stdout.write(JSON.stringify(simulation.value.logs ?? [], null, 2), () => {});
    fail('la simulation a échoué : aucun envoi');
  }

  // --- Phase E : envoi unique ---------------------------------------------
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

  // --- Phase F : vérification en lecture seule ----------------------------
  const refreshed = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  console.log(`transactionIndex après   : ${Number(refreshed.transactionIndex)}`);

  const vaultTransaction = await multisig.accounts.VaultTransaction.fromAccountAddress(
    connection,
    transactionPda,
  );
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);

  console.log(`VaultTransaction index   : ${Number(vaultTransaction.index)}`);
  console.log(`VaultTransaction vault   : ${vaultTransaction.vaultIndex}`);
  console.log(`Proposal transactionIndex: ${Number(proposal.transactionIndex)}`);
  console.log(`Proposal status          : ${proposal.status.__kind}`);
  console.log(`Proposal approved.length : ${proposal.approved.length}`);
  console.log(`vault financé après      : ${await connection.getBalance(vaultPda, 'confirmed')}`);
  console.log('Relancer ce script refusera désormais toute création.');
}

main().catch((error: unknown) => {
  console.error(`ERREUR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});