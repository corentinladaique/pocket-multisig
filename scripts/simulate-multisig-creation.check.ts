import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { connection } from '../src/solana/connection';
import { buildMultisigCreationTransaction } from '../src/vault/buildMultisigCreation';
import { buildMultisigCreationPlan } from '../src/vault/multisigCreationPlan';
import { runMultisigCreationPreflight } from '../src/vault/multisigCreationPreflight';
import { simulateMultisigCreation } from '../src/vault/simulateMultisigCreation';
import {
  buildVaultCreationRequest,
  createMember,
  createEmptyDraft,
  evaluateDraft,
} from '../src/vault/vaultDraft';

/**
 * Simulation REELLE sur Devnet de la creation d'un multisig, sans signature.
 *
 * Aucun signataire n'est fourni, rien n'est signe, rien n'est envoye, aucun
 * compte n'est ecrit. `sigVerify` reste au defaut RPC (false).
 *
 * Execution : npx tsx scripts/simulate-multisig-creation.check.ts
 */

const FIXTURE_PUBLIC = join(homedir(), '.config', 'pocket-multisig', 'devnet', 'fixture-public.json');

type FixturePublic = {
  members: string[];
  threshold: number;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PUBLIC, 'utf8')) as FixturePublic;

async function main(): Promise<void> {
  const plan = buildMultisigCreationPlan(
    buildVaultCreationRequest(
      evaluateDraft({
        ...createEmptyDraft(),
        setupType: 'recommended',
        vaultName: 'Simulation check',
        members: [
          fixture.members[0] as string,
          fixture.members[1] as string,
          'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
        ].map((publicKey, index) =>
          createMember({ index, label: `Signer ${index + 1}`, publicKey }),
        ),
        threshold: 2,
      }),
    ),
  );

  // 1. Premier assemblage : genere une cle ephemere et derive le PDA.
  const firstBuild = buildMultisigCreationTransaction({
    plan,
    creator: fixture.members[0] as string,
    treasury: null,
  });

  // 2. Preflight lecture seule : fournit le treasury reel.
  const preflight = await runMultisigCreationPreflight({
    connection,
    creator: fixture.members[0] as string,
    createKey: firstBuild.createKeyPublicKey,
    plan,
  });

  if (preflight.treasury === null) {
    console.error('ECHEC : treasury introuvable, simulation impossible.');
    console.error(preflight.validationErrors.join(' | '));
    process.exit(1);
  }

  // 3. Second assemblage avec le treasury reel, puis simulation sans signature.
  const build = buildMultisigCreationTransaction({
    plan,
    creator: fixture.members[0] as string,
    treasury: preflight.treasury,
  });

  if (build.transaction === null) {
    console.error('ECHEC : transaction non construite.');
    console.error(build.validationErrors.join(' | '));
    process.exit(1);
  }

  const simulation = await simulateMultisigCreation({
    connection,
    transaction: build.transaction,
    multisigPda: build.multisigPda,
    creator: fixture.members[0] as string,
  });

  console.log(`RPC devnet                 : ${connection.rpcEndpoint}`);
  console.log(`creator                    : ${fixture.members[0] as string}`);
  console.log(`treasury (preflight)       : ${preflight.treasury}`);
  console.log(`createKey                  : ${build.createKeyPublicKey}`);
  console.log(`multisigPda (simule)       : ${build.multisigPda}`);
  console.log(`instructionCount           : ${build.instructionCount}`);
  console.log('');
  console.log('--- Resultat de la simulation (aucune signature) ---');
  console.log(`err                        : ${simulation.err === null ? 'null (succes)' : JSON.stringify(simulation.err)}`);
  console.log(`unitsConsumed              : ${simulation.unitsConsumed ?? 'absent'}`);
  console.log(`creatorBalanceDelta        : ${simulation.creatorBalanceDelta ?? 'absent'} lamports`);
  console.log(`multisigRentLamports       : ${simulation.multisigRentLamports ?? 'absent'} lamports`);
  console.log(`readyToSign                : ${simulation.readyToSign}`);
  console.log('');
  console.log('--- Comparaison avec la borne inferieure du preflight ---');
  console.log(`borne inferieure (SDK)     : ${preflight.estimatedRequiredLamports} lamports`);
  if (simulation.multisigRentLamports !== null) {
    console.log(`rent reel (simulation)     : ${simulation.multisigRentLamports} lamports`);
    console.log(
      `ecart                      : ${
        simulation.multisigRentLamports - preflight.estimatedRequiredLamports
      } lamports`,
    );
  }
  console.log('');
  console.log('--- Erreurs / avertissements ---');
  console.log(`erreurs : ${simulation.validationErrors.length === 0 ? 'aucune' : simulation.validationErrors.join(' | ')}`);
  console.log(`alertes : ${simulation.validationWarnings.join(' | ')}`);
  console.log('');
  console.log(`--- Logs de l instruction (${simulation.logs.length}) ---`);
  for (const line of simulation.logs.slice(0, 40)) {
    console.log(line);
  }
  console.log('');
  console.log('Aucune signature, aucun envoi, aucun vault cree.');
}

void main().catch((caught: unknown) => {
  console.error(`ECHEC : ${caught instanceof Error ? caught.message : String(caught)}`);
  process.exit(1);
});