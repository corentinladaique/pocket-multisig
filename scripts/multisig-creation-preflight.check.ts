import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { connection } from '../src/solana/connection';
import { buildMultisigCreationTransaction } from '../src/vault/buildMultisigCreation';
import { buildMultisigCreationPlan } from '../src/vault/multisigCreationPlan';
import { runMultisigCreationPreflight } from '../src/vault/multisigCreationPreflight';
import {
  buildVaultCreationRequest,
  createMember,
  createEmptyDraft,
  evaluateDraft,
} from '../src/vault/vaultDraft';

/**
 * Verification LECTURE SEULE de runMultisigCreationPreflight() sur Devnet.
 *
 * Lectures autorisees uniquement : programConfig, frais, rent minimum, solde du
 * createur, existence du compte cible. Aucune signature, aucun MWA, aucune
 * simulation, aucun envoi, aucune ecriture.
 *
 * Execution : npx tsx scripts/multisig-creation-preflight.check.ts
 */

const FIXTURE_PUBLIC = join(homedir(), '.config', 'pocket-multisig', 'devnet', 'fixture-public.json');

type FixturePublic = {
  multisigPda: string;
  members: string[];
  threshold: number;
  creationFeeLamports: number;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PUBLIC, 'utf8')) as FixturePublic;

function lamports(value: number): string {
  return `${value} lamports (${(value / 1_000_000_000).toFixed(9)} SOL)`;
}

async function main(): Promise<void> {
  console.log(`RPC devnet        : ${connection.rpcEndpoint}`);
  console.log('');

  // 1. Contre-verification independante de la formule de taille utilisee par le
  //    preflight : taille reelle du multisig de la fixture vs byteSize calcule.
  const observed = await connection.getAccountInfo(new PublicKey(fixture.multisigPda));
  const decoded =
    observed === null
      ? null
      : multisig.accounts.Multisig.fromAccountInfo(observed)[0];
  const computedSize = multisig.accounts.Multisig.byteSize({
    createKey: new PublicKey(fixture.members[0] as string),
    configAuthority: new PublicKey(fixture.members[0] as string),
    threshold: fixture.threshold,
    timeLock: 0,
    transactionIndex: 0,
    staleTransactionIndex: 0,
    rentCollector: null,
    bump: 0,
    members: fixture.members.map((member) => ({
      key: new PublicKey(member),
      permissions: { mask: 7 },
    })),
  });
  console.log('--- Contre-verification taille de compte ---');
  console.log(`multisigPda fixture        : ${fixture.multisigPda}`);
  console.log(`taille on-chain observee   : ${observed === null ? 'compte absent' : observed.data.length}`);
  console.log(`Multisig.byteSize calcule  : ${computedSize}`);
  console.log(`ecart observe - calcule    : ${observed === null ? 'n/a' : observed.data.length - computedSize}`);
  if (decoded !== null) {
    console.log(`membres reels on-chain     : ${decoded.members.length}`);
    console.log(`configAuthority on-chain   : ${decoded.configAuthority.toString()}`);
    console.log(`rentCollector on-chain     : ${decoded.rentCollector?.toString() ?? 'aucun'}`);
    console.log(
      `byteSize des donnees reelles: ${multisig.accounts.Multisig.byteSize(decoded)}`,
    );
  }
  console.log('');

  // 2. Preflight reel sur un plan 2 of 3 (deux membres de la fixture + le
  //    programme Squads comme troisieme signataire de test).
  const plan = buildMultisigCreationPlan(
    buildVaultCreationRequest(
      evaluateDraft({
        ...createEmptyDraft(),
        setupType: 'recommended',
        vaultName: 'Preflight check',
        members: [fixture.members[0] as string, fixture.members[1] as string, 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'].map(
          (publicKey, index) =>
            createMember({ index, label: `Signer ${index + 1}`, publicKey }),
        ),
        threshold: 2,
      }),
    ),
  );

  const build = buildMultisigCreationTransaction({
    plan,
    creator: fixture.members[0] as string,
    treasury: null,
  });

  const preflight = await runMultisigCreationPreflight({
    connection,
    creator: fixture.members[0] as string,
    createKey: build.createKeyPublicKey,
    plan,
  });

  console.log('--- Preflight devnet (lecture seule) ---');
  console.log(`createKey (ephemere)       : ${build.createKeyPublicKey}`);
  console.log(`multisigPda derivee        : ${build.multisigPda}`);
  console.log(`programConfigPda derivee   : ${build.programConfigPda}`);
  console.log(`treasury                   : ${preflight.treasury}`);
  console.log(`multisigCreationFee        : ${lamports(preflight.multisigCreationFee)}`);
  console.log(
    `rent minimum (3 membres)   : ${lamports(
      preflight.estimatedRequiredLamports - preflight.multisigCreationFee,
    )}`,
  );
  console.log(`solde du creator           : ${lamports(preflight.creatorBalance)}`);
  console.log(`estimation totale requise  : ${lamports(preflight.estimatedRequiredLamports)}`);
  console.log(`solde suffisant            : ${preflight.sufficientBalance}`);
  console.log(`readyForSimulation         : ${preflight.readyForSimulation}`);
  console.log('');
  console.log('--- Diagnostic ---');
  console.log(`erreurs  : ${preflight.validationErrors.length === 0 ? 'aucune' : preflight.validationErrors.join(' | ')}`);
  console.log(`alertes  : ${preflight.validationWarnings.join(' | ')}`);
  console.log('');
  console.log(
    `fee on-chain = fixture (${fixture.creationFeeLamports}) : ${
      preflight.multisigCreationFee === fixture.creationFeeLamports
    }`,
  );
  console.log('Aucune signature, aucun envoi, aucune simulation, aucune ecriture.');
}

void main().catch((caught: unknown) => {
  console.error(`ECHEC : ${caught instanceof Error ? caught.message : String(caught)}`);
  process.exit(1);
});