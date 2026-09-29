/**
 * Blind grading sheet for the human raters (WCC and the 中文碩士 reviewer).
 *
 *   npx tsx scripts/blind-sheet.ts <translations.json> [--stage S5b|all] [--sample 0.25] [--seed 20260929]
 *
 * Writes two files into backups/blind-<time>/:
 *   sheet.csv  code, stage, item, sentence, answer, A, B, C, note — no arm, no participant,
 *              shuffled; raters fill A/B/C with 0 or 1 independently, each on their own copy
 *   key.csv    code -> translation id. Keep it away from the raters; agreement.ts joins it.
 * `--sample` draws the agreement subset (the plan: 20–25%); omit it to grade everything.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TRANSLATION_ITEMS } from '../src/content/translation';
import { seededShuffle } from '../src/lib/grading';
import { toCsv } from '../src/lib/export';
import { arg, loadTranslations, stamp } from './grading-io';

async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) throw new Error('usage: blind-sheet.ts <translations.json> [--stage S5b|all] [--sample 0.25] [--seed N]');
  const stage = arg('stage', 'S5b')!;
  const seed = Number(arg('seed', '20260929'));
  const sample = arg('sample') === undefined ? 1 : Number(arg('sample'));
  if (!(sample > 0 && sample <= 1)) throw new Error('--sample must be in (0, 1]');
  const rows = (await loadTranslations(input)).filter(r => stage === 'all' || r.stage === stage);
  const picked = seededShuffle(rows, seed).slice(0, Math.max(1, Math.round(rows.length * sample)));
  const byId = new Map(TRANSLATION_ITEMS.map(i => [i.id, i]));
  const sheet = picked.map((r, n) => ({
    code: `R${String(n + 1).padStart(4, '0')}`,
    stage: r.stage,
    item: r.itemId,
    sentence: byId.get(r.itemId)?.sentence ?? '',
    answer: r.text,
    A: '', B: '', C: '', note: '',
  }));
  const key = picked.map((r, n) => ({ code: sheet[n].code, translation_id: r.id }));
  const folder = path.resolve('backups', `blind-${stamp()}`);
  await fs.mkdir(folder, { recursive: true });
  // Column order matters for people filling the sheet in; toCsv sorts, so write it by hand.
  const cols = ['code', 'stage', 'item', 'sentence', 'answer', 'A', 'B', 'C', 'note'] as const;
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  await fs.writeFile(path.join(folder, 'sheet.csv'), '﻿' + [cols.join(','), ...sheet.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'), { flag: 'wx' });
  await fs.writeFile(path.join(folder, 'key.csv'), toCsv(key), { flag: 'wx' });
  console.log(`${sheet.length} of ${rows.length} answers -> ${folder} (seed ${seed})`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
