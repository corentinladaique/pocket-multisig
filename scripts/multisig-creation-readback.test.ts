import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  decodeMultisigCreationReadBack,
  validateMultisigCreationReadBack,
  type MultisigCreationExpectation,
  type MultisigCreationReadBack,
} from '../src/vault/multisigCreationReadBack';
import { deriveVaultVisibleState, VAULT_VISIBLE_LABELS } from '../src/wallet/vaultCreationState';

/**
 * Read-back creation multisig : invariants partages initial == recheck.
 * Aucun wallet, aucun reseau. npx tsx scripts/multisig-creation-readback.test.ts
 */

let passed = 0;
function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    console.log(`FAIL ${name}`);
    const detail = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
    console.log(detail.split('\n').slice(0, 4).join('\n'));
    process.exitCode = 1;
  }
}

const PROGRAM_ID = multisig.PROGRAM_ID.toString();
const DEFAULT_KEY = PublicKey.default.toString(); // 1111…1111
const MEMBER_A = 'So11111111111111111111111111111111111111112';
const MEMBER_B = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const MEMBER_C = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PDA = 'GZUrVZnw4QoHf3SvXrYvWfFzVbXXHxoA9UKSajWBfUuM';

const EXPECTATION: MultisigCreationExpectation = {
  configAuthority: null,
  memberCount: 2,
  members: [
    { key: MEMBER_A, permissions: 7 },
    { key: MEMBER_B, permissions: 7 },
  ],
  rentCollector: null,
  threshold: 2,
  timeLock: 0,
};

function goodReadBack(overrides: Partial<MultisigCreationReadBack> = {}): MultisigCreationReadBack {
  return {
    address: PDA,
    configAuthority: DEFAULT_KEY,
    memberCount: 2,
    members: [
      { address: MEMBER_A, permissions: 7 },
      { address: MEMBER_B, permissions: 7 },
    ],
    owner: PROGRAM_ID,
    rentCollector: null,
    threshold: 2,
    timeLock: 0,
    ...overrides,
  };
}

function validate(readBack: MultisigCreationReadBack | null) {
  return validateMultisigCreationReadBack({
    expectedAddress: PDA,
    expectation: EXPECTATION,
    readBack,
  });
}

const MODULE = readFileSync('src/vault/multisigCreationReadBack.ts', 'utf8');
const SEND = readFileSync('src/vault/signAndSendMultisigCreation.ts', 'utf8');
const SCREEN = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');
const CHECK = SCREEN.slice(
  SCREEN.indexOf('const onCheckTransactionAgain = useCallback'),
  SCREEN.indexOf('const onCreateOnDevnet = useCallback'),
);

// --- Invariants de la fonction commune ---------------------------------
check('1. tous les invariants valides : verified true', () => {
  const result = validate(goodReadBack());
  assert.equal(result.verified, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.readBack !== null);
});

check('2. mauvais owner : verified false', () => {
  const result = validate(goodReadBack({ owner: DEFAULT_KEY }));
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('OwnerMismatch')));
});

check('3. mauvaise configAuthority : verified false', () => {
  const result = validate(goodReadBack({ configAuthority: PDA }));
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('ConfigAuthorityMismatch')));
});

check('4. mauvais threshold : verified false', () => {
  const result = validate(goodReadBack({ threshold: 1 }));
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('ThresholdMismatch')));
});

check('5. membre manquant : verified false', () => {
  const result = validate(
    goodReadBack({ memberCount: 1, members: [{ address: MEMBER_A, permissions: 7 }] }),
  );
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('MemberCountMismatch')));
  assert.ok(result.errors.some((error) => error.startsWith('MemberAddressMismatch')));
});

check('6. membre supplementaire : verified false', () => {
  const result = validate(
    goodReadBack({
      memberCount: 3,
      members: [
        { address: MEMBER_A, permissions: 7 },
        { address: MEMBER_B, permissions: 7 },
        { address: MEMBER_C, permissions: 7 },
      ],
    }),
  );
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('MemberAddressMismatch')));
});

check('7. memes membres dans un ordre different : verified true (ordre non invariant)', () => {
  const result = validate(
    goodReadBack({
      members: [
        { address: MEMBER_B, permissions: 7 },
        { address: MEMBER_A, permissions: 7 },
      ],
    }),
  );
  assert.equal(result.verified, true);
});

check('8. adresse membre differente : verified false', () => {
  const result = validate(
    goodReadBack({
      members: [
        { address: MEMBER_C, permissions: 7 },
        { address: MEMBER_B, permissions: 7 },
      ],
    }),
  );
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('MemberAddressMismatch')));
});

check('9. permissions differentes : verified false', () => {
  const result = validate(
    goodReadBack({
      members: [
        { address: MEMBER_A, permissions: 5 },
        { address: MEMBER_B, permissions: 7 },
      ],
    }),
  );
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('MemberPermissionsMismatch')));
});

check('10. time lock different : verified false', () => {
  const result = validate(goodReadBack({ timeLock: 60 }));
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('TimeLockMismatch')));
});

check('11. rent collector different : verified false', () => {
  const result = validate(goodReadBack({ rentCollector: PDA }));
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('RentCollectorMismatch')));
});

check('11b. adresse du compte differente de l adresse attendue : verified false', () => {
  const result = validateMultisigCreationReadBack({
    expectedAddress: PDA,
    expectation: EXPECTATION,
    readBack: goodReadBack({}),
  });
  assert.equal(result.verified, true);
  const wrong = validateMultisigCreationReadBack({
    expectedAddress: MEMBER_C,
    expectation: EXPECTATION,
    readBack: goodReadBack({}),
  });
  assert.equal(wrong.verified, false);
  assert.ok(wrong.errors.some((error) => error.startsWith('AccountAddressMismatch')));
});

check('12. compte absent : ReadBackMissing', () => {
  const result = validate(null);
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((error) => error.startsWith('ReadBackMissing')));
});

check('13. decodage impossible : ReadBackDecodeFailed (les deux chemins)', () => {
  // Le decodage d'un compte invalide leve : chaque chemin le classe explicitement.
  const bogus = {
    data: Buffer.from([1, 2, 3, 4]),
    executable: false,
    lamports: 0,
    owner: new PublicKey(DEFAULT_KEY),
    rentEpoch: 0,
  } as unknown as AccountInfo<Buffer>;
  assert.throws(() => decodeMultisigCreationReadBack(bogus, PDA));
  assert.ok(SEND.includes('ReadBackDecodeFailed'));
  assert.ok(SCREEN.includes('ReadBackDecodeFailed'));
});

// --- Unification initial == recheck ------------------------------------
check('14. initial et recheck utilisent la MEME fonction', () => {
  assert.ok(SEND.includes('validateMultisigCreationReadBack'), 'initial');
  assert.ok(SCREEN.includes('validateMultisigCreationReadBack'), 'recheck');
  assert.ok(MODULE.includes('export function validateMultisigCreationReadBack'));
});

check('15. aucun chemin ne valide sur threshold + memberCount seuls', () => {
  assert.ok(!SCREEN.includes('sameThreshold && sameMemberCount'));
  assert.ok(!SCREEN.includes('sameMemberCount'));
  assert.ok(!SEND.includes('sameMemberCount'));
});

check('16/17. recheck : aucun wallet, aucune methode d envoi', () => {
  assert.ok(
    !/signAndSendTransactions|sendRawTransaction|partialSign|multisigCreateV2|prepareCreation|\btransact\b|\bauthorize\b|\breauthorize\b|useMobileWallet/.test(
      CHECK,
    ),
  );
  assert.ok(CHECK.includes('confirmSignature'));
  assert.ok(CHECK.includes('getAccountInfo'));
});

check('18. signature confirmee + mismatch : aucun second envoi autorise', () => {
  assert.ok(!CHECK.includes('sendAttemptedRef.current = false'), 'la reference n est jamais rearmee');
  assert.ok(SCREEN.includes('Nothing needs to be sent again.'));
  assert.ok(SCREEN.includes('Verification mismatch'));
  // Le mismatch deterministe conduit a un etat dedie, jamais a Prepare again.
  assert.equal(
    deriveVaultVisibleState({
      confirmed: true,
      creating: false,
      hasAttempt: true,
      networkFailure: false,
      signatureObtained: true,
      verificationMismatch: true,
      verified: false,
    }),
    'confirmed-verification-mismatch',
  );
});

check('19. Main vault derive uniquement apres verification reussie', () => {
  const vaultBlock = SCREEN.slice(
    SCREEN.indexOf('const mainVaultAddress'),
    SCREEN.indexOf('const mwaReport'),
  );
  assert.ok(vaultBlock.includes('if (!createdAndVerified) return null;'), 'gate de verification');
  assert.ok(vaultBlock.includes('multisig.getVaultPda({ index: 0'), 'index 0');
  assert.ok(!vaultBlock.includes('expectedMultisigPda'), 'jamais l adresse attendue brute');
});

check('20. parcours normal : Vault created and verified reste disponible', () => {
  assert.equal(
    deriveVaultVisibleState({
      confirmed: true,
      creating: false,
      hasAttempt: true,
      networkFailure: false,
      signatureObtained: true,
      verificationMismatch: false,
      verified: true,
    }),
    'verified',
  );
  assert.equal(VAULT_VISIBLE_LABELS.verified, 'Vault created and verified.');
  assert.ok(
    SCREEN.includes('setCheckReport(\'Vault created and verified.\')'),
    'le recheck reussi annonce le succes',
  );
});

check('20b. module pur : aucun React Native, aucun Connection, aucune signature', () => {
  for (const forbidden of ['react-native', 'Connection', 'signAndSend', 'Keypair']) {
    assert.ok(!MODULE.includes(forbidden), `interdit dans le module pur: ${forbidden}`);
  }
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
