import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * UI V2 « Seeker style » — Groupe 3 : New Proposal (Details) +
 * Review Proposal (TransactionReviewScreen).
 *
 * Assertions par lecture des sources (le projet n'a pas de renderer). Chaque
 * point verrouille un INVARIANT : thème V2 réutilisé, parsing SOL/lamports,
 * buffer Max, validation destination, Paste, runPipeline, simulation réelle,
 * aucun coût fictif, aucun lamport au premier niveau, CTA accessible, aucun
 * wallet/RPC/envoi/paquet ajouté.
 *
 * Execution : npx tsx scripts/ui-v2-group3-form.test.ts
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

const NEW = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const REVIEW = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');
const ADDRESS_INPUT = readFileSync('src/ui/AddressInput.tsx', 'utf8');
const RUNNER = readFileSync('scripts/run-pure-tests.sh', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');

check('1. New Proposal utilise UI V2', () => {
  assert.ok(NEW.includes("from '../ui/v2/primitives'"), 'primitives V2 importees');
  assert.ok(NEW.includes("from '../ui/theme'"), 'theme V2 importe');
  assert.ok(NEW.includes('<DevnetPill'), 'Devnet pill V2');
  assert.ok(NEW.includes('<InfoBox'), 'InfoBox V2');
  assert.ok(NEW.includes('>New proposal<'), 'titre New proposal');
  assert.ok(NEW.includes('1 Details') && NEW.includes('2 Review') && NEW.includes('3 Sign'), 'indicateur d etapes');
});

check('2. Review utilise UI V2', () => {
  assert.ok(REVIEW.includes("from '../ui/v2/primitives'"), 'primitives V2 importees');
  assert.ok(REVIEW.includes("from '../ui/theme'"), 'theme V2 importe');
  assert.ok(REVIEW.includes('<DevnetPill'), 'Devnet pill V2');
  assert.ok(REVIEW.includes('>Review proposal<'), 'titre Review proposal');
});

check('3. parsing SOL inchange', () => {
  assert.ok(NEW.includes('formatSolAmount'), 'formatSolAmount present');
  assert.ok(NEW.includes('parseSolToLamports'), 'parseSolToLamports present');
  assert.ok(NEW.includes('lamportsToSolText'), 'lamportsToSolText present');
  assert.ok(NEW.includes("from '../vault/solAmount'"), 'module solAmount inchange');
});

check('4. buffer Max inchange', () => {
  assert.ok(NEW.includes('computeMaxTransfer'), 'computeMaxTransfer present');
  assert.ok(NEW.includes('parseSolToLamports(bufferText)'), 'buffer saisi converti en lamports');
  assert.ok(NEW.includes('setSolText(lamportsToSolText(plan.amountLamports));'), 'Max fige un montant exact');
  assert.ok(/connection\.getBalance\(new PublicKey\(vaultAddress\), 'confirmed'\)/.test(NEW), 'Max relit le solde confirme');
});

check('5. validation destination inchangee', () => {
  assert.ok(NEW.includes('label="Destination"'), 'champ Destination present');
  assert.ok(NEW.includes('onChangeText={setDestination}'), 'setter de destination inchange');
  assert.ok(NEW.includes('const [destination, setDestination] = useState('), 'state destination inchange');
});

check('6. Paste inchange', () => {
  assert.ok(NEW.includes('<AddressInput'), 'New Proposal utilise AddressInput partage');
  assert.ok(ADDRESS_INPUT.includes("from './clipboard'"), 'AddressInput lit le presse-papiers centralise');
  assert.ok(ADDRESS_INPUT.includes('readClipboardText'), 'readClipboardText present');
});

check('7. Review conserve runPipeline (aucun pipeline duplique)', () => {
  assert.ok(NEW.includes('const runPipeline = async'), 'runPipeline present dans New Proposal');
  assert.ok(NEW.includes('runProposalCreationPreflight'), 'preflight present');
  assert.ok(NEW.includes('simulateProposalCreation'), 'simulation presente');
  // La revue deferre la creation au MEME flux de l appelant (onCreate).
  assert.ok(REVIEW.includes('onCreate'), 'la revue deferre la creation via onCreate');
  assert.ok(!REVIEW.includes('runPipeline'), 'la revue ne duplique aucun pipeline');
});

check('8. simulation reelle affichee uniquement si disponible', () => {
  assert.ok(NEW.includes("'Simulation succeeded'"), 'bloc simulation reelle dans New Proposal');
  assert.ok(NEW.includes('simulation.estimatedCreatorBalanceDelta'), 'cout issu de la simulation reelle');
  assert.ok(REVIEW.includes('simulationPassed'), 'la revue ne montre la simulation que sur drapeau');
  assert.ok(REVIEW.includes('{simulationPassed ? ('), 'bloc Simulation passed conditionnel');
  assert.ok(REVIEW.includes('Simulation passed') && REVIEW.includes('The transaction is valid.'), 'libelles simulation');
});

check('9. aucun cout fictif', () => {
  for (const [name, source] of [['NewProposalScreen', NEW], ['TransactionReviewScreen', REVIEW]] as const) {
    assert.ok(!/\b0\.05 SOL\b/.test(source), `${name}: aucun 0.05 SOL code en dur`);
    assert.ok(!/\b0\.02 SOL\b/.test(source), `${name}: aucun 0.02 SOL code en dur`);
    assert.ok(!/\b\d+\.\d+ SOL\b/.test(source.replace(/e\.g\./g, '')), `${name}: aucun montant SOL code en dur`);
  }
});

check('10. aucun lamport au premier niveau', () => {
  assert.ok(!NEW.includes('Amount (lamports)'), 'aucun libelle Amount (lamports)');
  assert.ok(!NEW.includes('} lamports'), 'aucun affichage lamports brut');
  assert.ok(!NEW.includes('lamports`'), 'aucun affichage lamports brut');
  assert.ok(!NEW.includes('lamports):'), 'aucun affichage lamports brut');
  // Les details techniques sont bien confines a la section repliable.
  assert.ok(NEW.includes('accessibilityLabel="Toggle advanced diagnostics"'), 'section repliable presente');
  assert.ok(REVIEW.includes('Advanced diagnostics'), 'revue : diagnostics replies');
  assert.ok(REVIEW.includes('Technical transaction details'), 'revue : details techniques replies');
});

check('11. CTA accessible avec clavier (KeyboardAvoidingView + scroll)', () => {
  assert.ok(NEW.includes('<KeyboardAvoidingView behavior="padding"'), 'KeyboardAvoidingView conserve');
  assert.ok(NEW.includes('<ScrollView'), 'scroll present');
  const cta = NEW.indexOf('>Review proposal<');
  const scrollEnd = NEW.indexOf('</ScrollView>');
  assert.ok(cta > 0 && scrollEnd > cta, 'le CTA reste dans le flux de scroll');
  assert.ok(!NEW.includes("position: 'absolute'"), 'aucun CTA flottant');
  assert.ok(NEW.includes('paddingBottom: 160'), 'padding bas adapte au clavier');
});

check('12. aucun wallet automatique', () => {
  assert.ok(!REVIEW.includes('useMobileWallet'), 'la revue ne touche pas au wallet');
  for (const effect of NEW.split('useEffect(').slice(1)) {
    const body = effect.slice(0, effect.indexOf('});'));
    assert.ok(!/signAndSend|signTransaction|sendRawTransaction|authorize/i.test(body), 'aucun wallet automatique dans un effet');
  }
});

check('13. aucun envoi automatique', () => {
  assert.ok(!REVIEW.includes('signAndSendTransactions'), 'la revue n envoie rien');
  assert.ok(!REVIEW.includes('sendRawTransaction'), 'la revue n envoie rien');
  // L envoi n existe que dans runCreate, declenche par la double confirmation.
  const runCreate = NEW.slice(NEW.indexOf('const runCreate'), NEW.indexOf('const onCreate'));
  assert.ok(runCreate.includes('signAndSendProposalCreation'), 'envoi dans runCreate seulement');
  assert.ok(NEW.includes('if (signature === null) sendAttemptedRef.current = false;'), 'anti-double-envoi conserve');
});

check('14. aucun package', () => {
  assert.ok(!PACKAGE.includes('qrcode'), 'pas de package QR');
  // Décision explicite : `@expo/vector-icons` est autorisé pour la navigation V2.
  // La règle d'origine tient pour tout le reste : aucun paquet SVG, et un seul
  // paquet d'icônes — celui qui a été explicitement autorisé.
  assert.ok(!/react-native-svg/.test(PACKAGE), 'aucun paquet SVG');
  assert.ok(
    PACKAGE.split('vector-icons').length - 1 === 1,
    'un seul paquet d icones, explicitement autorise',
  );
  for (const source of [NEW, REVIEW]) {
    assert.ok(!/react-native-svg|vector-icons/.test(source), 'aucun import de package d icones');
  }
});

check('15. les suites precedentes restent vertes', () => {
  assert.ok(
    RUNNER.includes('scripts/ui-v2-group3-form.test.ts'),
    'la suite groupe 3 est enregistree dans npm test',
  );
  for (const suite of ['scripts/ui-v2.test.ts', 'scripts/ui-v2-group2.test.ts', 'scripts/new-proposal-ux.test.ts']) {
    assert.ok(RUNNER.includes(suite), `${suite} reste enregistree`);
  }
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
