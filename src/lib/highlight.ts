import { CONFIG } from './config';
import type { Arm, Granularity, Passage } from './types';

/**
 * Sentence terminators. `。！？；：` end a sentence; a closing quote 「」 or 『』
 * immediately after the terminator is absorbed into the same sentence, so
 * 「以人乳飲㹠。」 stays whole and expansion never leaves a dangling 」.
 */
const TERMINATORS = ['。', '！', '？', '；', '：'];
const CLOSING_QUOTES = ['」', '』'];

/** [start, end) ranges of every sentence in the passage, covering the whole string. */
export function sentenceRanges(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (TERMINATORS.includes(text[i])) {
      let end = i + 1;
      while (end < text.length && CLOSING_QUOTES.includes(text[end])) end += 1;
      out.push({ start, end });
      start = end;
      i = end - 1;
    }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

/**
 * Granularity rule (pilot v5.4):
 *   exactly one Chinese character  -> word
 *   crosses a sentence terminator  -> passage
 *   otherwise                      -> sentence
 * Punctuation and whitespace do not count towards the character budget.
 *
 * Pure classifier. Task-2 undo: nothing rewrites the reader's selection any more —
 * this label is exported into the interaction log for analysis, and the socratic
 * prompt uses it to decide phrasing, but the stored `selection` text is always what
 * the reader dragged.
 */
export function classifyGranularity(selection: string): Granularity {
  const stripped = selection.replace(/[\s，、。！？；：「」『』（）]/g, '');
  if (stripped.length <= 1) return 'word';
  const inner = selection.slice(0, -1); // a trailing 。 is not "crossing"
  if (TERMINATORS.some((p) => inner.includes(p))) return 'passage';
  return 'sentence';
}

/**
 * Neighbourhood of a selection in the passage: the sentence(s) the selection sits
 * inside, plus one sentence before and one after. Used by `socraticTurnPrompt` so
 * the model can quote surrounding text instead of asking about a fragment in a vacuum.
 *
 * `containing` covers every sentence range the selection touches (a drag across a 。
 * yields more than one). `prev` and `next` are the single sentences immediately
 * outside that span, or empty strings if the selection is already at an edge.
 */
export function neighborhoodOf(
  passageText: string,
  start: number,
  end: number
): { prev: string; containing: string; next: string } {
  if (start < 0 || end <= start || end > passageText.length) {
    return { prev: '', containing: passageText.slice(Math.max(0, start), Math.max(0, end)), next: '' };
  }
  const ranges = sentenceRanges(passageText);
  const touched = ranges.filter((r) => r.start < end && r.end > start);
  if (touched.length === 0) {
    return { prev: '', containing: passageText.slice(start, end), next: '' };
  }
  const first = touched[0];
  const last = touched[touched.length - 1];
  const firstIdx = ranges.indexOf(first);
  const lastIdx = ranges.indexOf(last);
  const prev = firstIdx > 0 ? passageText.slice(ranges[firstIdx - 1].start, ranges[firstIdx - 1].end) : '';
  const next =
    lastIdx < ranges.length - 1
      ? passageText.slice(ranges[lastIdx + 1].start, ranges[lastIdx + 1].end)
      : '';
  const containing = passageText.slice(first.start, last.end);
  return { prev, containing, next };
}

/**
 * Which target sentence (if any) the selection falls in.
 *
 * If `start` is supplied and lines up with the passage text, resolution is by
 * position: the target whose text-range the selection sits inside wins. This is
 * what makes a single 「之」 clicked in 「愷之甥也」 resolve to TS2 rather than to
 * TS1 (the first 「之」 in the passage). If the offset is missing or does not match,
 * fall back to the substring rule.
 */
export function matchTarget(
  passage: Passage,
  selection: string,
  start?: number
): string | null {
  const sel = selection.trim();
  if (!sel) return null;
  const validOffset =
    typeof start === 'number' &&
    start >= 0 &&
    passage.text.slice(start, start + selection.length) === selection;
  if (validOffset) {
    const s = start as number;
    const e = s + selection.length;
    for (const t of passage.targets) {
      const ts = passage.text.indexOf(t.text);
      if (ts < 0) continue;
      const te = ts + t.text.length;
      if (s < te && e > ts) return t.id;
    }
    return null;
  }
  for (const t of passage.targets) {
    if (t.text.includes(sel) || sel.includes(t.text)) return t.id;
  }
  return null;
}

/**
 * Whether the highlight lower bound gates this arm at all.
 *
 * Currently false for every arm: usage is voluntary and is measured rather than required
 * (see CONFIG.lowerBoundArms). The machinery stays because the four-sentence milestone is
 * still RECORDED for everyone — it is now a result, not a requirement.
 */
export function lowerBoundApplies(arm: Arm): boolean {
  return CONFIG.lowerBoundArms.includes(arm);
}

/** Whether this arm sees the required target sentences shaded (v6: every arm). */
export function showsTargetHints(arm: Arm): boolean {
  return CONFIG.targetHintArms.includes(arm);
}

/**
 * Lower bound is met when every target sentence has at least one completed use.
 * Passing `arm` makes it arm-aware: an arm the bound does not apply to is always met,
 * so the control reader is never blocked and is never told which sentences matter.
 * Called without `arm` it is the pure four-sentence predicate (used by the unit tests).
 */
export function lowerBoundMet(
  passage: Passage,
  completedTargetIds: string[],
  arm?: Arm
): boolean {
  if (arm && !lowerBoundApplies(arm)) return true;
  const done = new Set(completedTargetIds);
  return requiredTargets(passage).every((t) => done.has(t.id));
}

/** v6: the targets that gate a passage and are shaded. Falls back to all targets when a
 *  passage marks none as required (v5 data, unit fixtures). */
export function requiredTargets(passage: Passage) {
  const marked = passage.targets.filter((t) => t.required);
  return marked.length ? marked : passage.targets;
}
