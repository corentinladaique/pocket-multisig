import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { modelFromInstructions } from '../src/solana/decodeTransactionMessage';
import { loadProposalReview, summarizeOperation } from '../src/squads/proposals';

/**
 * Tests du parcours unifie des propositions.
 *
 * Aucun wallet, aucun reseau reel : la connexion est un leurre qui enregistre
 * les methodes appelees. Execution : npx tsx scripts/proposal-detail-decode.test.ts
 */

let passed = 0;

function check(name: string, run: () => void | Promise<void>): void {
  try {
    const outcome = run();
    if (outcome instanceof Promise) {
      outcome
        .then(() => {
          passed += 1;
          console.log(`PASS ${name}`);
        })
        .catch((caught: unknown) => {
          console.log(`FAIL ${name}`);
          console.log(`  ${caught instanceof Error ? caught.message : String(caught)}`);
          process.exitCode = 1;
        });
      return;
    }
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    console.log(`FAIL ${name}`);
    const detail = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
    console.log(
      detail
        .split('\n')
        .filter((line) => !line.includes('node:internal'))
        .slice(0, 4)
        .join('\n'),
    );
    process.exitCode = 1;
  }
}

const REVIEW_CONTEXT = {
  multisigAddress: 'MULTI',
  network: 'devnet' as const,
  proposalIndex: 1,
  proposalStatus: 'Active',
  signerWallet: 'WALLET',
  vaultAddress: 'VAULT',
};

check('montant et destination extraits du modele decode', () => {
  const destination = PublicKey.unique().toBase58();
  const instruction = SystemProgram.transfer({
    fromPubkey: PublicKey.unique(),
    lamports: 250_000_000,
    toPubkey: new PublicKey(destination),
  });
  const model = modelFromInstructions([instruction as TransactionInstruction], {
    ...REVIEW_CONTEXT,
    isPreview: false,
  });
  const summary = summarizeOperation(model);
  assert.ok(summary !== null, 'le resume doit exister pour un transfert SOL');
  assert.ok(
    `${summary.amount}`.includes('0.25') || `${summary.amount}`.includes('250000000'),
    `montant inattendu: ${String(summary.amount)}`,
  );
  // Les cartes compactes abregent : c'est ce que l'ecran de detail ne doit plus
  // se contenter d'afficher.
  assert.notEqual(summary.destination, destination, 'summarizeOperation abrege la destination');
  // Le modele, lui, porte l'adresse complete : c'est elle qui est affichee.
  assert.equal(model.destination.known, true);
  assert.equal(model.destination.value, destination);
});

check('l ecran de detail affiche la destination complete', () => {
  const source = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(
    source.includes('model.destination.value'),
    "l'adresse complete doit etre affichee, pas seulement l'abregee",
  );
  assert.ok(source.includes('Amount: {summary.amount}'), 'le montant doit etre visible');
});

check('proposition illisible : etat explicite, jamais un ecran vide', async () => {
  const calls: string[] = [];
  const connection = {
    getAccountInfo: async () => {
      calls.push('getAccountInfo');
      return null;
    },
  } as unknown as Parameters<typeof loadProposalReview>[0];

  const result = await loadProposalReview(connection, PublicKey.unique(), REVIEW_CONTEXT, 1);
  assert.equal(result.model.decodeStatus, 'unknown');
  assert.ok(
    result.model.notes.some((note) => /No vault transaction found/.test(note)),
    'la note doit expliquer pourquoi rien ne peut etre decode',
  );
  assert.deepEqual(calls, ['getAccountInfo']);
});

check('le decodage ne sollicite que la lecture', async () => {
  const calls: string[] = [];
  const connection = {
    getAccountInfo: async () => {
      calls.push('getAccountInfo');
      return null;
    },
  } as unknown as Parameters<typeof loadProposalReview>[0];
  await loadProposalReview(connection, PublicKey.unique(), REVIEW_CONTEXT, 2);
  const allowed = new Set(['getAccountInfo', 'getMultipleAccountsInfo']);
  for (const call of calls) {
    assert.ok(allowed.has(call), `methode non lecture pendant un decodage: ${call}`);
  }
});

check('Proposal Details decode sur place et n est plus bloque par decodedModel', () => {
  const source = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(source.includes('loadProposalReview('), 'le detail doit decoder lui-meme');
  assert.ok(
    source.includes('const model = decodedModel ?? selfModel'),
    'le modele local doit completer le modele fourni',
  );
  // Le bouton de revue ne doit plus dependre du seul modele fourni par le parent.
  assert.ok(
    !/disabled=\{decodedModel === null\}/.test(source),
    'le bouton de revue ne doit pas rester desactive faute de modele',
  );
  assert.ok(source.includes('Refresh proposal'), 'la relecture doit re-decoder');
});

check('Home et Inbox ouvrent le meme ecran de proposition', () => {
  const source = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
  assert.ok(
    source.includes('setOpenDecisionIndex(decision.index)'),
    "l'inbox doit ouvrir l'ecran de detail partage",
  );
  assert.ok(
    source.includes('<ProposalDetailsScreen'),
    "l'inbox doit rendre ProposalDetailsScreen, comme Home",
  );
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);