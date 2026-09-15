import { CONFIG } from './config';
import type { Granularity, Passage } from './types';

const SENTENCE_ENDINGS = ['。', '！', '？', '；', '」', '：'];

/**
 * Granularity rule (design doc 3.3):
 *   <= 4 characters        -> word
 *   crosses a sentence end -> passage
 *   otherwise              -> sentence
 * Punctuation and whitespace do not count towards the character budget, because
 * Chinese selections routinely pick up a trailing comma.
 */
export function classifyGranularity(selection: string): Granularity {
  const stripped = selection.replace(/[\s，、。！？；：「」『』（）]/g, '');
  if (stripped.length === 0) return 'word';
  if (stripped.length <= CONFIG.wordMaxChars) return 'word';
  const inner = selection.slice(0, -1); // a trailing 。 is not "crossing"
  if (SENTENCE_ENDINGS.some((p) => inner.includes(p))) return 'passage';
  return 'sentence';
}

/** Which target sentence (if any) the selection falls in. Overlap counts. */
export function matchTarget(passage: Passage, selection: string): string | null {
  const sel = selection.trim();
  if (!sel) return null;
  for (const t of passage.targets) {
    if (t.text.includes(sel) || sel.includes(t.text)) return t.id;
  }
  return null;
}

/** Lower bound is met when every target sentence has at least one completed use. */
export function lowerBoundMet(passage: Passage, completedTargetIds: string[]): boolean {
  const done = new Set(completedTargetIds);
  return passage.targets.every((t) => done.has(t.id));
}
