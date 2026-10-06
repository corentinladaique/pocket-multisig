import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * TEST-GARDIEN : la regle des Hooks de React.
 *
 * Un composant ne peut JAMAIS appeler un hook apres un `return` anticipe : le
 * nombre de hooks appeles changerait entre deux rendus, React leve une erreur,
 * et l'application CRASHE a l'ouverture de l'ecran concerne.
 *
 * Bug reel de ce projet, corrige le 05/10 : un `useCallback` (pull-to-refresh)
 * ajoute pres du `return` final de ConnectScreen faisait crasher, sur simple tap,
 * l'Inbox — ainsi que la creation de vault et la vue detaillee, qui sont rendues
 * par le meme mecanisme de retour anticipe.
 *
 * Ni `tsc` ni le reste de la suite ne pouvaient l'attraper : c'est une regle
 * d'EXECUTION, pas de typage. D'ou ce gardien.
 *
 * Execution : npx tsx scripts/hook-order.test.ts
 */

const SRC_DIR = join(process.cwd(), 'src');
const HOOK_CALL = /\buse[A-Z]\w*\s*\(/;
const EARLY_RETURN_HEAD = /^ {2}if \(.*\) \{$/;
const RETURN_STMT = /^\s*return \(/;

let passed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    console.log(`FAIL ${name}`);
    console.log(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  }
}

function tsxFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...tsxFilesUnder(full));
    } else if (entry.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Index de la PREMIERE sortie anticipee du composant, ou -1.
 * Motif reconnu : un `if (...)` de niveau composant dont les lignes suivantes
 * contiennent un `return (`. On ne regarde pas les `return null` inline, qui ne
 * sortent pas du corps de la meme facon.
 */
function firstEarlyReturnIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (!EARLY_RETURN_HEAD.test(lines[i])) {
      continue;
    }
    const window = lines.slice(i, i + 6);
    if (window.some((line) => RETURN_STMT.test(line))) {
      return i;
    }
  }
  return -1;
}

/** Les hooks appeles APRES la premiere sortie anticipee (donc dangereux). */
function hooksAfterEarlyReturn(source: string): number[] {
  const lines = source.split('\n');
  const boundary = firstEarlyReturnIndex(lines);
  if (boundary === -1) {
    return [];
  }
  const offenders: number[] = [];
  for (let i = boundary + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('//')) {
      continue;
    }
    if (HOOK_CALL.test(lines[i])) {
      offenders.push(i + 1);
    }
  }
  return offenders;
}

check('1. Aucun hook apres un retour anticipe, dans TOUS les ecrans', () => {
  const offenders: string[] = [];
  for (const file of tsxFilesUnder(SRC_DIR)) {
    const hits = hooksAfterEarlyReturn(readFileSync(file, 'utf8'));
    if (hits.length > 0) {
      offenders.push(`${relative(process.cwd(), file)} : ligne(s) ${hits.join(', ')}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `un hook est appele apres un retour anticipe (crash a l'ouverture) :\n${offenders.join('\n')}`,
  );
});

check('2. ConnectScreen : Inbox, Create vault et Details restent surs', () => {
  // Ces trois ecrans sont rendus par retour anticipe AVANT le rendu principal.
  // Ce controle nomme explicitement le cas qui a crashe, pour que la cause reste
  // identifiable meme si le fichier est reorganisationne.
  const screen = readFileSync(join(SRC_DIR, 'screens', 'ConnectScreen.tsx'), 'utf8');
  assert.ok(
    screen.includes('if (inboxOpen)'),
    'le rendu anticipe de l Inbox existe toujours',
  );
  assert.ok(
    screen.includes('if (vaultCreationOpen)'),
    'le rendu anticipe de la creation de vault existe toujours',
  );
  const offenders = hooksAfterEarlyReturn(screen);
  assert.deepEqual(
    offenders,
    [],
    `ConnectScreen appelle un hook apres un retour anticipe aux lignes ${offenders.join(', ')}`,
  );
});

check('3. Auto-controle : le detecteur repere bien le motif (non vacue)', () => {
  // Sans ce controle, un detecteur casse rendrait un gardien vert pour rien :
  // il validerait l'absence de bug sans etre capable d'en voir un.
  const piege = [
    'export function Ecran() {',
    '  const [x, setX] = useState(0);',
    '  if (ouvert) {',
    '    return (',
    '      <Vue />',
    '    );',
    '  }',
    '  const danger = useCallback(() => setX(1), [x]);',
    '  return <Rendu />;',
    '}',
  ].join('\n');
  const hits = hooksAfterEarlyReturn(piege);
  assert.deepEqual(hits, [8], 'le hook piege de la ligne 8 doit etre signale');

  const sain = [
    'export function Ecran() {',
    '  const [x, setX] = useState(0);',
    '  const ok = useCallback(() => setX(1), [x]);',
    '  if (ouvert) {',
    '    return (',
    '      <Vue />',
    '    );',
    '  }',
    '  return <Rendu />;',
    '}',
  ].join('\n');
  assert.deepEqual(hooksAfterEarlyReturn(sain), [], 'un composant sain ne doit rien signaler');
});

console.log(`\n${passed} test(s) OK`);
