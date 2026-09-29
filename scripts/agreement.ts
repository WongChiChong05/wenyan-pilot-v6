/**
 * Agreement between two sets of 0/1 scores for the same answers, per scoring point.
 *
 *   model vs model (self-consistency):
 *     npx tsx scripts/agreement.ts --a grades-run1.csv --b grades-run2.csv
 *   human vs model, or human vs human (blind sheets use codes; pass the key):
 *     npx tsx scripts/agreement.ts --a sheet-rater1.csv --a-key key.csv --b grades-run1.csv
 *
 * Rows are joined on translation_id (sheets are mapped through their key). Prints Cohen's
 * kappa for A, B, C and all points pooled, and lists every disagreement for review.
 * The plan's criterion: model–human kappa no lower than human–human kappa minus 0.10, and
 * at least 0.60. Decide the threshold before looking at the numbers.
 */
import { promises as fs } from 'node:fs';
import { SLOTS, cohenKappa, type Slot } from '../src/lib/grading';
import { arg, parseCsv } from './grading-io';

async function load(file: string, keyFile?: string) {
  const rows = parseCsv(await fs.readFile(file, 'utf8'));
  const key = keyFile ? new Map(parseCsv(await fs.readFile(keyFile, 'utf8')).map(r => [r.code, r.translation_id])) : null;
  const out = new Map<string, Record<Slot, 0 | 1>>();
  for (const r of rows) {
    const id = key ? key.get(r.code) : r.translation_id;
    if (!id) continue;
    const scores = SLOTS.map(s => r[s]?.trim());
    if (scores.some(v => v !== '0' && v !== '1')) continue; // ungraded or failed rows are left out
    out.set(id, Object.fromEntries(SLOTS.map((s, i) => [s, Number(scores[i]) as 0 | 1])) as Record<Slot, 0 | 1>);
  }
  return out;
}

async function main() {
  const aFile = arg('a'), bFile = arg('b');
  if (!aFile || !bFile) throw new Error('usage: agreement.ts --a <csv> [--a-key key.csv] --b <csv> [--b-key key.csv]');
  const a = await load(aFile, arg('a-key'));
  const b = await load(bFile, arg('b-key'));
  const ids = [...a.keys()].filter(id => b.has(id));
  console.log(`answers scored by both: ${ids.length} (a: ${a.size}, b: ${b.size})`);
  const pooledA: (0 | 1)[] = [], pooledB: (0 | 1)[] = [];
  for (const s of SLOTS) {
    const xa = ids.map(id => a.get(id)![s]), xb = ids.map(id => b.get(id)![s]);
    pooledA.push(...xa); pooledB.push(...xb);
    const agree = xa.filter((v, i) => v === xb[i]).length;
    const k = cohenKappa(xa, xb);
    console.log(`${s}: kappa ${k === null ? 'undefined' : k.toFixed(3)}, raw agreement ${ids.length ? (agree / ids.length).toFixed(3) : '-'}`);
  }
  const k = cohenKappa(pooledA, pooledB);
  console.log(`pooled: kappa ${k === null ? 'undefined' : k.toFixed(3)}`);
  const disagreements = ids.flatMap(id => SLOTS.filter(s => a.get(id)![s] !== b.get(id)![s]).map(s => `${id} ${s}: a=${a.get(id)![s]} b=${b.get(id)![s]}`));
  if (disagreements.length) console.log(`\ndisagreements (${disagreements.length}):\n${disagreements.join('\n')}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
