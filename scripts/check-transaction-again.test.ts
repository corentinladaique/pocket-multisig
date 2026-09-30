import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isTemporaryNetworkFailure } from '../src/wallet/operationState';
import {
  deriveVaultVisibleState,
  VAULT_VISIBLE_LABELS,
} from '../src/wallet/vaultCreationState';

/**
 * Hotfix « Check transaction again » : relecture reelle apres une creation
 * confirmee dont le read-back initial a echoue, etat utilisateur coherent, et
 * recheck strictement en LECTURE (aucun wallet, aucun envoi).
 * Aucun wallet, aucun reseau. npx tsx scripts/check-transaction-again.test.ts
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

const CREATE = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');

/** Bloc du handler de relecture seule. */
const CHECK = CREATE.slice(
  CREATE.indexOf('const onCheckTransactionAgain = useCallback'),
  CREATE.indexOf('const onCreateOnDevnet = useCallback'),
);
const SIGNED_BLOCK = CREATE.slice(
  CREATE.indexOf("vaultVisibleState === 'signed-pending-confirmation' ? ("),
  CREATE.indexOf("vaultVisibleState === 'confirmed-pending-readback' ||"),
);
const CONFIRMED_BLOCK = CREATE.slice(
  CREATE.indexOf("vaultVisibleState === 'confirmed-pending-readback' ||"),
  CREATE.indexOf('{createdAndVerified ? ('),
);
const SUCCESS_BLOCK = CREATE.slice(
  CREATE.indexOf('{createdAndVerified ? ('),
  CREATE.indexOf('{/* TROUBLESHOOTING DETAILS'),
);
const BACK_HANDLER = CREATE.slice(
  CREATE.indexOf("BackHandler.addEventListener('hardwareBackPress'"),
  CREATE.indexOf('}, [createdAndVerified'),
);

// --- Etats visibles (module pur partage) ---
check('1. signature absente : aucun bouton Check transaction again', () => {
  const state = deriveVaultVisibleState({
    confirmed: false,
    creating: false,
    hasAttempt: true,
    networkFailure: false,
    signatureObtained: false,
    verified: false,
  });
  assert.equal(state, 'idle', 'sans signature, aucun etat Check');
  // Le handler abandonne immediatement sans signature.
  assert.ok(CHECK.includes('if (signature === null)'));
  assert.ok(!CREATE.includes("vaultVisibleState === 'idle' ? ('"), 'aucun bouton en idle');
});

check('2. signature presente, confirmation pending : signed-pending-confirmation', () => {
  const state = deriveVaultVisibleState({
    confirmed: false,
    creating: false,
    hasAttempt: true,
    networkFailure: false,
    signatureObtained: true,
    verified: false,
  });
  assert.equal(state, 'signed-pending-confirmation');
  assert.equal(
    VAULT_VISIBLE_LABELS['signed-pending-confirmation'],
    'Transaction signed, confirmation pending.',
  );
});

check('3. signature confirmee, read-back absent : confirmed-pending-readback', () => {
  const state = deriveVaultVisibleState({
    confirmed: true,
    creating: false,
    hasAttempt: true,
    networkFailure: false,
    signatureObtained: true,
    verified: false,
  });
  assert.equal(state, 'confirmed-pending-readback');
  assert.equal(
    VAULT_VISIBLE_LABELS['confirmed-pending-readback'],
    'Transaction confirmed, vault verification pending.',
  );
});

check('4. confirmee + UnknownHostException : temporarily unavailable', () => {
  assert.ok(isTemporaryNetworkFailure('UnknownHostException: api.devnet.solana.com'));
  assert.equal(
    deriveVaultVisibleState({
      confirmed: true,
      creating: false,
      hasAttempt: true,
      networkFailure: true,
      signatureObtained: true,
      verified: false,
    }),
    'confirmed-readback-temporarily-unavailable',
  );
});

check('7/8/9. recheck confirme + compte lisible : verified, adresses affichees', () => {
  assert.equal(
    deriveVaultVisibleState({
      confirmed: true,
      creating: false,
      hasAttempt: true,
      networkFailure: false,
      signatureObtained: true,
      verified: true,
    }),
    'verified',
  );
  // Le handler delegue le verdict a la MEME fonction pure que le read-back initial.
  assert.ok(CHECK.includes('validateMultisigCreationReadBack'), 'validation commune');
  assert.ok(CHECK.includes('decodeMultisigCreationReadBack'), 'decodage commun');
  assert.ok(CHECK.includes('expectedAddress: expectedPda'), 'adresse attendue conservee');
  assert.ok(CHECK.includes('verified: true'), 'bascule verified seulement si conforme');
  assert.ok(SUCCESS_BLOCK.includes('Multisig configuration address'));
  assert.ok(SUCCESS_BLOCK.includes('Main vault address'));
  assert.ok(SUCCESS_BLOCK.includes('mainVaultAddress'));
});

check('5/6. recheck : message immediat et checking toujours relache', () => {
  assert.ok(CHECK.includes("setCheckReport('Checking transaction…')"), 'message immediat');
  assert.ok(CHECK.includes('setChecking(true)'));
  assert.ok(/finally \{[\s\S]*setChecking\(false\)/.test(CHECK), 'checking libere dans finally');
});

check('10. recheck reussi : ancienne erreur reseau retiree du bloc principal', () => {
  // Sur succes, le resultat est complete ET l'erreur effacee.
  assert.ok(CHECK.includes('errorMessage: null'));
  assert.ok(CHECK.includes('setCreateError(null)'));
  // Les blocs principaux signes/confirmes ne montrent jamais l'erreur brute.
  assert.ok(!SIGNED_BLOCK.includes('createError'), 'aucune erreur brute signee');
  assert.ok(!CONFIRMED_BLOCK.includes('createError'), 'aucune erreur brute confirmee');
  assert.ok(!CONFIRMED_BLOCK.includes('errorMessage'), 'aucune erreur brute confirmee');
});

check('11. reseau indisponible : bouton conserve apres le check', () => {
  assert.ok(CONFIRMED_BLOCK.includes('Check transaction again'));
  assert.ok(CONFIRMED_BLOCK.includes('disabled={checking}'));
});

check('12. confirmed ne regresse jamais vers signed pending', () => {
  for (const verified of [false, true]) {
    const state = deriveVaultVisibleState({
      confirmed: true,
      creating: false,
      hasAttempt: true,
      networkFailure: false,
      signatureObtained: true,
      verified,
    });
    assert.notEqual(state, 'signed-pending-confirmation');
  }
  // L'etat est derive d'une confirmation monotone (jamais remise a faux).
  assert.ok(CREATE.includes("const transactionConfirmed =\n    createResult?.confirmed === true || checkEvidence?.status === 'confirmed';"));
});

check('13/14/15. recheck : aucun wallet, aucun envoi, aucun nouveau createKey', () => {
  assert.ok(
    !/signAndSendTransactions|sendRawTransaction|partialSign|multisigCreateV2|prepareCreation|\btransact\b|\bauthorize\b|\breauthorize\b/.test(
      CHECK,
    ),
    'aucune methode d envoi ni wallet dans le recheck',
  );
  assert.ok(!/Keypair\.generate|buildMultisigCreationTransaction|createKey/.test(CHECK), 'aucune nouvelle cle');
  assert.ok(CHECK.includes('confirmSignature'), 'lecture du statut de signature');
  assert.ok(CHECK.includes('getAccountInfo'), 'lecture du compte multisig');
  assert.ok(CHECK.includes('expectedMultisigPda'), 'adresse attendue reutilisee');
});

check('16. plusieurs taps rapides : une seule relecture simultanee', () => {
  assert.ok(CHECK.includes('if (checking) return;'));
  assert.ok(CONFIRMED_BLOCK.includes('disabled={checking}'));
});

check('17/18. succes : Open vault et Go to Inbox disponibles', () => {
  assert.ok(SUCCESS_BLOCK.includes('Open vault'));
  assert.ok(SUCCESS_BLOCK.includes('Go to Inbox'));
  assert.ok(SUCCESS_BLOCK.includes('onGoToInbox'));
});

check('19. succes : retour Android vers Inbox', () => {
  assert.ok(BACK_HANDLER.includes('if (createdAndVerified)'));
  assert.ok(BACK_HANDLER.includes('onGoToInbox()'));
});

check('20. Troubleshooting details ferme par defaut', () => {
  assert.ok(
    CREATE.includes('const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);'),
    'section fermee par defaut',
  );
});

check('21. confirmed + erreur reseau : aucun grand bloc rouge', () => {
  assert.ok(CONFIRMED_BLOCK.includes('styles.noticeBox'), 'bloc neutre informatif');
  assert.ok(!CONFIRMED_BLOCK.includes('styles.errorBox'), 'jamais un grand encadre rouge');
});

check('F. erreurs techniques reservees a Troubleshooting details', () => {
  // Les erreurs brutes ne sont rendues que dans la section repliable.
  const troubleshooting = CREATE.slice(CREATE.indexOf('{/* TROUBLESHOOTING DETAILS'));
  assert.ok(troubleshooting.includes('technicalErrors.map'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
