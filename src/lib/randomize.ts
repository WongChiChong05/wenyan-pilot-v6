import type { Arm } from './types';

export const ARMS: Arm[] = ['socratic', 'direct', 'control'];

export type Stratum = 'low' | 'mid' | 'high';

/**
 * Stratified block randomisation, run on the server after the pretest is scored.
 * Cut points may be tuned during the dry run and are FROZEN once collection starts
 * (design doc, platform constraint 6).
 */
export function stratumOf(score: number, cuts: { low: number; high: number }): Stratum {
  if (score <= cuts.low) return 'low';
  if (score >= cuts.high) return 'high';
  return 'mid';
}

/**
 * Within a stratum, assign to the arm that is currently least filled; ties broken
 * randomly. This keeps the three arms balanced at every point during recruitment,
 * which matters when the sample is 45 and recruitment may stop early.
 */
export function assignArm(
  countsInStratum: Record<Arm, number>,
  rand: () => number = Math.random
): Arm {
  const min = Math.min(...ARMS.map((a) => countsInStratum[a] ?? 0));
  const candidates = ARMS.filter((a) => (countsInStratum[a] ?? 0) === min);
  return candidates[Math.floor(rand() * candidates.length)] ?? candidates[0];
}

/** Deterministic PRNG so a dry run can be replayed exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
