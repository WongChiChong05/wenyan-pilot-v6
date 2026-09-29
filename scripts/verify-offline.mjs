/**
 * Offline verification harness.
 *
 * Why it exists: the normal path is `npm install && npm test` (vitest). If you are on a
 * machine that cannot reach the npm registry, this harness runs the SAME test files with
 * zero dependencies, using Node's built-in TypeScript type stripping (Node >= 22.6).
 *
 *   node scripts/verify-offline.mjs
 *
 * It copies src/, tests/ and scripts/validate-content.ts into .verify/, rewrites import
 * specifiers so Node's ESM resolver accepts them ('@/x' -> relative, './x' -> './x.ts'),
 * maps the 'vitest' import onto a tiny shim, then executes every test file.
 * It does NOT type-check; `npm run typecheck` does that.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.verify');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
cpSync(path.join(root, 'tests'), path.join(out, 'tests'), { recursive: true });
mkdirSync(path.join(out, 'scripts'), { recursive: true });
cpSync(path.join(root, 'scripts', 'validate-content.ts'), path.join(out, 'scripts', 'validate-content.ts'));
cpSync(path.join(root, 'scripts', 'smoke-run.ts'), path.join(out, 'scripts', 'smoke-run.ts'));

writeFileSync(
  path.join(out, 'vitest-shim.ts'),
  `type Fn = () => unknown | Promise<unknown>;
const failures: string[] = [];
let passed = 0;
const queue: { name: string; fn: Fn }[] = [];
let suite = '';

export function describe(name: string, fn: () => void) {
  const prev = suite;
  suite = prev ? prev + ' > ' + name : name;
  fn();
  suite = prev;
}
export function it(name: string, fn: Fn) {
  queue.push({ name: suite + ' > ' + name, fn });
}
export const test = it;

function fail(name: string, msg: string) {
  failures.push(name + ': ' + msg);
}

export function expect(actual: any) {
  const api = {
    toBe(exp: any) {
      if (!Object.is(actual, exp)) throw new Error('expected ' + JSON.stringify(exp) + ', got ' + JSON.stringify(actual));
    },
    toEqual(exp: any) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(exp);
      if (a !== b) throw new Error('expected ' + b + ', got ' + a);
    },
    toBeCloseTo(exp: number, digits = 2) {
      if (Math.abs(actual - exp) > Math.pow(10, -digits) / 2) throw new Error('expected ~' + exp + ', got ' + actual);
    },
    toBeGreaterThan(exp: number) {
      if (!(actual > exp)) throw new Error('expected > ' + exp + ', got ' + actual);
    },
    toBeLessThan(exp: number) {
      if (!(actual < exp)) throw new Error('expected < ' + exp + ', got ' + actual);
    },
    toBeLessThanOrEqual(exp: number) {
      if (!(actual <= exp)) throw new Error('expected <= ' + exp + ', got ' + actual);
    },
    toContain(exp: any) {
      const ok = typeof actual === 'string' ? actual.includes(exp) : Array.isArray(actual) && actual.includes(exp);
      if (!ok) throw new Error('expected to contain ' + JSON.stringify(exp));
    },
    toHaveLength(n: number) {
      if (actual?.length !== n) throw new Error('expected length ' + n + ', got ' + actual?.length);
    },
    toBeNull() {
      if (actual !== null) throw new Error('expected null, got ' + JSON.stringify(actual));
    },
    toBeDefined() {
      if (actual === undefined) throw new Error('expected defined');
    },
    toBeUndefined() {
      if (actual !== undefined) throw new Error('expected undefined, got ' + JSON.stringify(actual));
    },
    get rejects() {
      return {
        async toThrow(message?: string) {
          try {
            await actual;
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            if (message !== undefined && !detail.includes(message)) {
              throw new Error('expected rejection containing ' + JSON.stringify(message) + ', got ' + detail);
            }
            return;
          }
          throw new Error('expected promise to reject');
        },
      };
    },
    get not() {
      return {
        toContain(exp: any) {
          const ok = typeof actual === 'string' ? actual.includes(exp) : Array.isArray(actual) && actual.includes(exp);
          if (ok) throw new Error('expected NOT to contain ' + JSON.stringify(exp));
        },
        toBe(exp: any) {
          if (Object.is(actual, exp)) throw new Error('expected not to be ' + JSON.stringify(exp));
        },
      };
    },
  };
  return api;
}

export async function runAll(label: string) {
  for (const t of queue) {
    try {
      await t.fn();
      passed++;
    } catch (e) {
      fail(t.name, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(label + ': ' + passed + ' passed, ' + failures.length + ' failed');
  for (const f of failures) console.log('  FAIL ' + f);
  if (failures.length > 0) process.exitCode = 1;
}
`
);

/** Rewrite import specifiers so Node's ESM resolver accepts them. */
function rewrite(file) {
  let src = readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  src = src.replace(/from\s+'([^']+)'/g, (m, spec) => {
    if (spec === 'vitest') {
      const rel = path.relative(dir, path.join(out, 'vitest-shim.ts')).split(path.sep).join('/');
      return `from '${rel.startsWith('.') ? rel : './' + rel}'`;
    }
    if (spec.startsWith('@/')) {
      const abs = path.join(out, 'src', spec.slice(2));
      let rel = path.relative(dir, abs).split(path.sep).join('/');
      if (!rel.startsWith('.')) rel = './' + rel;
      return `from '${rel}.ts'`;
    }
    if (spec.startsWith('.') && !spec.endsWith('.ts') && !spec.endsWith('.json')) {
      return `from '${spec}.ts'`;
    }
    return m;
  });
  writeFileSync(file, src, 'utf8');
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) rewrite(p);
  }
}
walk(path.join(out, 'src'));
walk(path.join(out, 'tests'));
walk(path.join(out, 'scripts'));

// The app/ folder needs React/Next, which this harness does not run.
rmSync(path.join(out, 'src', 'app'), { recursive: true, force: true });

// Integration suites need the installed PostgreSQL runtime; npm test runs them.
const testFiles = readdirSync(path.join(out, 'tests')).filter((f) => f.endsWith('.test.ts') && !f.endsWith('.integration.test.ts'));
let failed = false;
for (const f of testFiles) {
  const entry = path.join(out, 'tests', `run-${f.replace('.test.ts', '')}.ts`);
  writeFileSync(
    entry,
    `import './${f}';\nimport { runAll } from '../vitest-shim.ts';\nawait runAll('${f}');\n`,
    'utf8'
  );
  try {
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', entry], {
      encoding: 'utf8',
    });
    process.stdout.write(stdout);
    if (/failed/.test(stdout) && !/0 failed/.test(stdout)) failed = true;
  } catch (e) {
    process.stdout.write(String(e.stdout ?? '') + String(e.stderr ?? ''));
    failed = true;
  }
}

// The content gate must FAIL while placeholders remain; that is the expected state
// of a freshly cloned repository.
let contentExit = 0;
try {
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', path.join(out, 'scripts', 'validate-content.ts')],
    { encoding: 'utf8' }
  );
} catch (e) {
  contentExit = e.status ?? 1;
  process.stdout.write(String(e.stdout ?? ''));
}
console.log(`content gate exit code: ${contentExit} (1 = placeholders still present, as expected)`);

try {
  const smoke = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', path.join(out, 'scripts', 'smoke-run.ts')],
    { encoding: 'utf8' }
  );
  process.stdout.write(smoke);
} catch (e) {
  process.stdout.write(String(e.stdout ?? '') + String(e.stderr ?? ''));
  failed = true;
}

console.log(failed ? 'OFFLINE VERIFICATION: FAILED' : 'OFFLINE VERIFICATION: OK');
process.exit(failed ? 1 : 0);
