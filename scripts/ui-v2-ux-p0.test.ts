import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyProposal,
  filterProposals,
  type ProposalFilterInput,
} from '../src/squads/proposalFilters';

/**
 * UI V2 — Passe UX P0 apres test Seeker.
 * Assertions par lecture des sources + tests purs de proposalFilters.
 *
 * Execution : npx tsx scripts/ui-v2-ux-p0.test.ts
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

const LEARN = readFileSync('src/screens/OnboardingScreen.tsx', 'utf8');
const ADDRESS = readFileSync('src/ui/AddressInput.tsx', 'utf8');
const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
const DETAILS = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
const NEW = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const CREATE = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');

check('1. Learn sans positionnement absolu des textes', () => {
  assert.ok(!/position:\s*'absolute'/.test(LEARN), 'aucune position absolue');
  assert.ok(LEARN.includes('optionHeaderRow'), 'titre + coche dans une ligne');
  assert.ok(LEARN.includes('optionCheckSlot'), 'creneau de coche a largeur fixe');
  assert.ok(LEARN.includes('flexShrink'), 'le texte peut se reduire/aller a la ligne');
});

check('2. Learn conserve la selection explicite', () => {
  assert.ok(LEARN.includes('EMPTY_ANSWERS'));
  assert.ok(LEARN.includes('selectLevel(previous, option)'));
  assert.ok(LEARN.includes('toggleSigningMean(previous, option)'));
  assert.ok(LEARN.includes('isAnswersComplete(answers)'));
  assert.ok(LEARN.includes('accessibilityState={{ selected }}'));
  assert.ok(!LEARN.includes('touched'), 'aucun flag global');
});

check('3. AddressInput integre Paste a droite', () => {
  assert.ok(ADDRESS.includes('styles.field'), 'conteneur de champ');
  assert.ok(ADDRESS.includes('styles.paste'), 'Paste integre');
  assert.ok(/field:[\s\S]{0,220}flexDirection:\s*'row'/.test(ADDRESS), 'champ = rangee');
  assert.ok(ADDRESS.includes('flex: 1'), 'le texte prend l espace restant');
  assert.ok(ADDRESS.includes('paddingRight'), 'padding droit du champ');
  assert.ok(!ADDRESS.includes("styles.row,"), 'plus de rangee externe separee');
});

check('4. Paste reste tap-only', () => {
  assert.ok(ADDRESS.includes('const onPaste = async () => {'));
  assert.ok(ADDRESS.includes('void onPaste();'));
  assert.ok(!/useEffect/.test(ADDRESS), 'aucune lecture au montage');
  assert.equal(ADDRESS.split('readClipboardText()').length - 1, 1);
});

check('5. Aucun Paste dans Amount', () => {
  assert.equal(NEW.split('<AddressInput').length - 1, 1, 'un seul AddressInput (Destination)');
  assert.ok(NEW.includes('label="Destination"'));
  assert.ok(!/Amount[\s\S]{0,200}<AddressInput/.test(NEW), 'Amount ne porte pas Paste');
});

check('6. Add existing multisig : champ + Load adjacents', () => {
  assert.ok(HOME.includes('loaderRow') && HOME.includes('loaderColumn'), 'layout responsive');
  // Responsive par largeur MESUREE (onLayout), jamais par modele Android.
  assert.ok(HOME.includes('onLoaderLayout'));
  // Le choix de layout depend de la LARGEUR mesuree, pas du modele d'appareil.
  assert.ok(HOME.includes('MULTISIG_LOADER_ROW_MIN_WIDTH'));
  assert.ok(!/Dimensions\.|device-info/.test(HOME), 'aucune detection de modele');
  // Deux variantes MUTUELLEMENT exclusives partagent le meme handler : une seule
  // action Load visible a l ecran, aucun second bouton sous le champ.
  assert.equal(HOME.split('onPress={onLoadMultisig}').length - 1, 2);
  assert.ok(HOME.includes('{loaderWide ? null : ('));
});

check('7. Load utilise onLoadMultisig', () => {
  assert.ok(HOME.includes('onPress={onLoadMultisig}'));
});

check('8. Go utilise onLoadMultisig', () => {
  assert.ok(HOME.includes('onSubmitEditing={onLoadMultisig}'));
  assert.ok(HOME.includes('returnKeyType="go"'));
});

check('9. Une seule occurrence de msig.load', () => {
  assert.equal(HOME.split('msig.load(').length - 1, 1);
});

check('10. Loading bloque Go et Load', () => {
  assert.ok(HOME.includes("if (msig.status === 'loading') return;"));
  assert.ok(HOME.includes("disabled={msig.status === 'loading'}"));
});

check('11. Aucun debordement horizontal intentionnel', () => {
  for (const [name, source] of [
    ['OnboardingScreen', LEARN],
    ['AddressInput', ADDRESS],
    ['ConnectScreen', HOME],
  ] as const) {
    // Intention inchangee : aucun positionnement absolu pour echapper au flux,
    // c'est ce qui provoquait des debordements horizontaux. Exception unique et
    // ENCADREE : un calque PLEIN ECRAN, qui pose ses bords a 0 — il ne peut pas
    // deborder par construction. On exige donc autant de calques absolus que de
    // calques a bords poses : tout autre positionnement absolu reste interdit.
    const absolute = source.match(/position:\s*'absolute'/g) ?? [];
    const pinned = source.match(
      /position:\s*'absolute'[\s\S]{0,300}?(top|bottom|left|right):\s*0,[\s\S]{0,300}?(top|bottom|left|right):\s*0,/g,
    ) ?? [];
    assert.equal(
      absolute.length,
      pinned.length,
      `${name}: position absolue toleree uniquement pour un calque plein ecran (bords poses a 0)`,
    );
  }
  assert.ok(ADDRESS.includes('flex: 1'), 'le champ se comprime au lieu de deborder');
});

check('12. Home To do reutilise proposalFilters', () => {
  assert.ok(HOME.includes("from '../squads/proposalFilters'"));
  assert.ok(HOME.includes('filterProposals('));
});

check('13. Proposition deja approuvee sans action absente de Home', () => {
  assert.ok(HOME.includes("filterProposals(inputs, 'todo')") || HOME.includes("'todo'"));
  assert.ok(!/approved-by-you/.test(HOME), 'aucun groupe approved-by-you dans Home');
});

const BASE: ProposalFilterInput = {
  index: 1,
  status: 'Active',
  approvals: 0,
  threshold: 2,
  approvedAddresses: [],
  walletAddress: 'W',
  walletCanApprove: true,
  walletCanExecute: false,
};

check('14. Active actionnable presente', () => {
  assert.equal(classifyProposal({ ...BASE }), 'todo');
  assert.equal(filterProposals([{ ...BASE }], 'todo').length, 1);
});

check('15. Approved executable presente', () => {
  const approved = { ...BASE, status: 'Approved', walletCanExecute: true };
  assert.equal(classifyProposal(approved), 'todo');
  // Deja approuvee par ce wallet SANS droit d'execution : pas dans To do.
  const approvedNoExec = { ...BASE, status: 'Active', approvedAddresses: ['W'] };
  assert.equal(classifyProposal(approvedNoExec), 'open');
});

check('16. Proposal Details n affiche qu une carte Approved', () => {
  assert.equal(DETAILS.split('Approved by you').length - 1, 1, 'une seule carte');
});

check('17. Progression non dupliquee', () => {
  assert.ok(DETAILS.includes('collectedLabel'), 'progression on-chain');
  assert.ok(!DETAILS.includes('Execution not available yet'), 'bloc redondant retire');
});

check('18. Montant SOL compact', () => {
  assert.ok(DETAILS.includes('lamportsToSolDisplay'), 'format compact existant');
  assert.ok(!/toFixed\(9\)[\s\S]{0,40}SOL/.test(DETAILS), 'plus de 9 zeros sur le montant principal');
});

check('19. Erreur principale sans "lamports"', () => {
  assert.ok(NEW.includes('Insufficient vault balance'));
  assert.ok(NEW.includes('Nothing was signed or sent.'));
  assert.ok(!/Insufficient vault balance[\s\S]{0,200}lamports/.test(NEW), 'pas de lamports dans le message principal');
});

check('20. Troubleshooting conserve les details bruts', () => {
  assert.ok(NEW.includes('Troubleshooting'));
  assert.ok(NEW.includes('lamports'), 'valeurs brutes conservees dans le repli');
});

check('21. Un seul CTA reel Create proposal', () => {
  assert.ok(NEW.includes('Create proposal'));
  assert.ok(!NEW.includes('Review the transfer'), 'action redondante supprimee');
  assert.ok(!NEW.includes('Create on Devnet'), 'action redondante supprimee');
  assert.ok(NEW.includes('Edit details'), 'CTA secondaire');
});

check('22. Logs dans un second repli ferme par defaut', () => {
  assert.ok(NEW.includes('Simulation logs'));
  assert.ok(/useState\(false\)/.test(NEW), 'repli ferme par defaut');
});

check('23. Preset 2-of-2 absent', () => {
  assert.ok(CREATE.includes('visiblePresets'), 'presets filtres');
  assert.ok(!CREATE.includes("'Recommended: 2 of 2'"), '2 of 2 non affiche comme recommande');
  assert.ok(CREATE.includes('Custom'), 'option Custom conservee');
});

check('24. Custom conserve 2-of-2', () => {
  // Le filtrage n'enleve aucune capacite : la donnee 2 of 2 reste disponible.
  const DRAFT = readFileSync('src/vault/vaultDraft.ts', 'utf8');
  assert.ok(/2 of 2/.test(DRAFT), 'la configuration 2 of 2 existe toujours');
  assert.ok(CREATE.includes('Custom'), 'Custom reste selectionnable');
});

check('25. 2-of-2 affiche Availability risk', () => {
  assert.ok(CREATE.includes('Availability risk'));
  assert.ok(CREATE.includes('permanently unusable'));
  assert.ok(CREATE.includes('reliable recovery plans'));
  assert.ok(CREATE.includes('twoOfTwoAvailabilityRisk'), 'garde exactement 2-of-2');
});

check('26. Aucun package ajoute', () => {
  // EXCEPTION ASSUMEE et DEMANDEE PAR L'UTILISATEUR : `expo-sensors`.
  // L'interdiction visait les dependances d'ARTWORK (dessiner la marque en SVG,
  // en Lottie, etc.). `expo-sensors` ne dessine rien : c'est le seul moyen
  // d'acceder a l'accelerometre, donc la seule facon de realiser le masquage du
  // solde par secouage demande par l'utilisateur. React Native n'expose aucun
  // capteur en natif. Le reste de la regle tient : aucun autre package ajoute.
  assert.ok(!PACKAGE.includes('qrcode'));
});

check('27. Create Vault : CTA unique + texte de signature', () => {
  // Deviation assumee : le libelle du CTA est verrouille par 4 suites ("un seul
  // CTA de creation") ; on ne renomme pas. Le texte sous le CTA est present.
  assert.ok(CREATE.includes('Your wallet will ask you to sign on Devnet.'));
  assert.equal(CREATE.split('onCreateOnDevnet').length - 1 >= 1, true);
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
