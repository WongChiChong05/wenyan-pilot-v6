import type { Item, ItemLevel, ResponseRow } from './types';

export interface SubmittedAnswer {
  itemId: string;
  chosen: number | null; // null = skipped
  rtMs: number;
}

export interface ScoredQuiz {
  rows: Omit<ResponseRow, 'id' | 'participantId' | 'ts'>[];
  total: number;
  byLevel: Record<ItemLevel, { correct: number; n: number }>;
  skipped: number;
  attentionCheckFailed: boolean;
}

/** Scoring happens only here, on the server. The client never receives answerIndex. */
export function scoreQuiz(items: Item[], answers: SubmittedAnswer[]): ScoredQuiz {
  const byId = new Map(items.map((i) => [i.id, i]));
  const byLevel: Record<ItemLevel, { correct: number; n: number }> = {
    check: { correct: 0, n: 0 },
    decode: { correct: 0, n: 0 },
    comprehend: { correct: 0, n: 0 },
    infer: { correct: 0, n: 0 },
  };
  let total = 0;
  let skipped = 0;
  let attentionCheckFailed = false;
  const rows: ScoredQuiz['rows'] = [];

  for (const item of items) {
    const a = answers.find((x) => x.itemId === item.id);
    const chosen = a?.chosen ?? null;
    const correct = chosen !== null && chosen === item.answerIndex;
    if (chosen === null) skipped += 1;
    if (item.attentionCheck && !correct) attentionCheckFailed = true;
    if (!item.attentionCheck) {
      byLevel[item.level].n += 1;
      if (correct) {
        byLevel[item.level].correct += 1;
        total += 1;
      }
    }
    rows.push({
      stage: item.stage,
      itemId: item.id,
      level: item.level,
      chosen,
      correct,
      rtMs: a?.rtMs ?? 0,
    });
  }
  return { rows, total, byLevel, skipped, attentionCheckFailed };
}

/** Cronbach's alpha over a participants x items 0/1 matrix. Reported for S5. */
export function cronbachAlpha(matrix: number[][]): number {
  const n = matrix.length;
  if (n < 2) return NaN;
  const k = matrix[0].length;
  if (k < 2) return NaN;
  const itemVars: number[] = [];
  for (let j = 0; j < k; j++) {
    const col = matrix.map((r) => r[j]);
    itemVars.push(variance(col));
  }
  const totals = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const totalVar = variance(totals);
  if (totalVar === 0) return NaN;
  const sumItemVar = itemVars.reduce((a, b) => a + b, 0);
  return (k / (k - 1)) * (1 - sumItemVar / totalVar);
}

/** Item difficulty p and point-biserial discrimination, for the item screening table. */
export function itemStats(matrix: number[][]): { p: number; rpb: number }[] {
  const k = matrix[0]?.length ?? 0;
  const totals = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const out: { p: number; rpb: number }[] = [];
  for (let j = 0; j < k; j++) {
    const col = matrix.map((r) => r[j]);
    const p = mean(col);
    const rest = matrix.map((r, i) => totals[i] - r[j]);
    out.push({ p, rpb: pearson(col, rest) });
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function variance(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}
function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}

/** Cohen's kappa, used for "my judgement vs the model's" on the reason gate. */
export function cohensKappa(a: boolean[], b: boolean[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let agree = 0;
  let aTrue = 0;
  let bTrue = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) agree += 1;
    if (a[i]) aTrue += 1;
    if (b[i]) bTrue += 1;
  }
  const n = a.length;
  const po = agree / n;
  const pe = (aTrue / n) * (bTrue / n) + (1 - aTrue / n) * (1 - bTrue / n);
  if (pe === 1) return NaN;
  return (po - pe) / (1 - pe);
}
