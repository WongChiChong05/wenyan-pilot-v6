/**
 * Offline LLM scoring of the translations, three scoring points per sentence.
 *
 *   npx tsx scripts/grade.ts <translations.json> [--stage S5b|all] [--run 1] [--allow-mock]
 *
 * Uses the provider and pinned model from .env.local (LLM_PROVIDER, LLM_MODEL, key) at
 * temperature CONFIG.llm.temperature. Rows are shuffled and sent without arm or participant.
 * Empty or skipped answers score 0 without a model call. A malformed or unsupported grade
 * (a 1 whose evidence is not in the answer) is retried once, then written as failed.
 * Run twice with --run 1 and --run 2, then compare the two files with agreement.ts to
 * check self-consistency before comparing with the human sheet.
 *
 * Output: backups/grades-<stage>-run<run>-<time>.csv
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { TRANSLATION_ITEMS } from '../src/content/translation';
import { CONFIG } from '../src/lib/config';
import { GRADING_PROMPT_VERSION, SLOTS, gradingSystemPrompt, gradingUserPrompt, parseGrade, seededShuffle } from '../src/lib/grading';
import { getProvider } from '../src/lib/llm';
import { toCsv } from '../src/lib/export';
import { arg, loadTranslations, stamp } from './grading-io';

async function main() {
  loadEnvConfig(process.cwd());
  const input = process.argv[2];
  if (!input || input.startsWith('--')) throw new Error('usage: grade.ts <translations.json> [--stage S5b|all] [--run 1] [--allow-mock]');
  const stage = arg('stage', 'S5b')!;
  const run = Number(arg('run', '1'));
  const llm = getProvider();
  if (llm.name === 'mock' && !process.argv.includes('--allow-mock')) throw new Error('no real provider configured; set LLM_PROVIDER/LLM_MODEL/key, or pass --allow-mock for a dry run');
  const byId = new Map(TRANSLATION_ITEMS.map(i => [i.id, i]));
  const rows = seededShuffle((await loadTranslations(input)).filter(r => stage === 'all' || r.stage === stage), 1000 + run);
  const out: Record<string, unknown>[] = [];
  let failed = 0;
  for (const r of rows) {
    const item = byId.get(r.itemId);
    if (!item) throw new Error(`unknown item ${r.itemId}`);
    const base = { translation_id: r.id, stage: r.stage, item: r.itemId, run, model: CONFIG.llm.model || llm.name, prompt_version: GRADING_PROMPT_VERSION };
    if (!r.text.trim()) {
      out.push({ ...base, A: 0, B: 0, C: 0, total: 0, A_evidence: '空白', B_evidence: '空白', C_evidence: '空白', failed: false, raw: '' });
      continue;
    }
    let result: ReturnType<typeof parseGrade> = { ok: false, reason: 'not run' };
    let raw = '';
    for (let attempt = 0; attempt < 2 && !result.ok; attempt++) {
      const res = await llm.complete(gradingSystemPrompt(), gradingUserPrompt(item, r.text));
      raw = res.raw;
      result = res.ok ? parseGrade(res.text, r.text) : { ok: false, reason: res.error ?? 'provider error' };
    }
    if (!result.ok) {
      failed++;
      out.push({ ...base, A: '', B: '', C: '', total: '', A_evidence: '', B_evidence: '', C_evidence: '', failed: result.reason, raw });
      continue;
    }
    const g = result.grade;
    out.push({ ...base, ...Object.fromEntries(SLOTS.map(s => [s, g[s].score])), total: SLOTS.reduce((n, s) => n + g[s].score, 0),
      ...Object.fromEntries(SLOTS.map(s => [`${s}_evidence`, g[s].evidence])), failed: false, raw });
  }
  const file = path.resolve('backups', `grades-${stage}-run${run}-${stamp()}.csv`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, toCsv(out), { flag: 'wx' });
  console.log(`${out.length} answers graded, ${failed} failed -> ${file}`);
  if (failed) process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
