/**
 * v6 offline scoring of the sentence translations (never runs during a session).
 *
 * The supervisor agreed the model may score, because a standard translation exists
 * (三民本語譯). The design keeps the model away from holistic "similarity" judgements,
 * which would favour answers worded like the reference (and so the direct arm, which read
 * pre-written explanations): it judges three scoring points separately, each 0/1, and must
 * quote the words in the answer that earn the point.
 *
 * Blind: the prompt carries no arm, participant or order. Validation against human raters
 * is in scripts/agreement.ts (Cohen's kappa per point).
 */
import type { TranslationItem } from './types';

export const GRADING_PROMPT_VERSION = 'g1-2026-09-29';

export type Slot = 'A' | 'B' | 'C';
export const SLOTS: Slot[] = ['A', 'B', 'C'];

export interface SlotGrade { score: 0 | 1; evidence: string }
export type Grade = Record<Slot, SlotGrade>;

export function gradingSystemPrompt(): string {
  return [
    '你是文言文翻譯的評分員。你只根據三個得分點逐點判斷，不給整體分數，不評論文筆。',
    '每個得分點只有 0 或 1：讀者的白話譯文把這一點的意思譯出來了就是 1，沒有、譯錯或看不出來就是 0。',
    '判斷的是意思，不是措辭：與參考譯文用字不同但意思相同，照樣給 1；照抄了參考譯文的字眼但意思錯了，給 0。',
    '參考譯文只是其中一種正確譯法，另有可接受譯法時一併參考。',
    '給 1 時，evidence 必須逐字引用讀者譯文中支持這一分的字；給 0 時，evidence 寫「無」或簡述缺了什麼（不超過 20 字）。',
    '空白、只寫「不知道」或與句子無關的作答，三點都是 0。',
    '只輸出 JSON：{"A":{"score":0|1,"evidence":"..."},"B":{...},"C":{...}}',
  ].join('\n');
}

export function gradingUserPrompt(item: TranslationItem, answer: string): string {
  const alternatives = item.altReferences?.length ? `\n其他可接受的譯法：${item.altReferences.join('／')}` : '';
  return [
    `原句：${item.sentence}`,
    `參考譯文（三民本語譯）：${item.reference}${alternatives}`,
    '得分點：',
    `A 關鍵字詞：${item.rubric.A}`,
    `B 誰對誰：${item.rubric.B}`,
    `C 前後關係：${item.rubric.C}`,
    `讀者的白話譯文：${answer.trim() || '（空白）'}`,
  ].join('\n');
}

/** Parse and sanity-check a model grade. A 1 without evidence found in the answer is refused. */
export function parseGrade(raw: string, answer: string): { ok: true; grade: Grade } | { ok: false; reason: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, reason: 'no JSON' };
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return { ok: false, reason: 'invalid JSON' }; }
  const out = {} as Grade;
  const compact = (s: string) => s.replace(/[\s，。、；：「」『』！？,.;:!?"'（）()]/g, '');
  for (const slot of SLOTS) {
    const g = (parsed as Record<string, { score?: unknown; evidence?: unknown }>)[slot];
    if (!g || (g.score !== 0 && g.score !== 1) || typeof g.evidence !== 'string') return { ok: false, reason: `slot ${slot} malformed` };
    if (g.score === 1 && !compact(answer).includes(compact(g.evidence))) return { ok: false, reason: `slot ${slot} evidence not in answer` };
    out[slot] = { score: g.score, evidence: g.evidence };
  }
  return { ok: true, grade: out };
}

/** Cohen's kappa for two raters over the same binary judgements. null when undefined. */
export function cohenKappa(a: (0 | 1)[], b: (0 | 1)[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const n = a.length;
  const agree = a.filter((x, i) => x === b[i]).length / n;
  const pa = a.filter(x => x === 1).length / n;
  const pb = b.filter(x => x === 1).length / n;
  const expected = pa * pb + (1 - pa) * (1 - pb);
  if (expected === 1) return agree === 1 ? 1 : null;
  return (agree - expected) / (1 - expected);
}

/** Deterministic shuffle so a blind sheet can be regenerated identically from its seed. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
