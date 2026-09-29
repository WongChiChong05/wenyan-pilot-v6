import type { Annotation } from './types';

const HAN = /[\u3400-\u9fff\ud840-\ud87f][\udc00-\udfff]?/gu;

export interface FocusOptionReport {
  ok: boolean;
  options: string[];
  flags: string[];
}

/**
 * Candidate words are only a disambiguation aid. Every option must be copied from the
 * reader's own highlight; the model is not allowed to introduce a word or an answer.
 * Proper nouns remain available but are moved behind language-bearing candidates.
 */
export function validateFocusOptions(
  value: unknown,
  selection: string,
  annotations: Annotation[]
): FocusOptionReport {
  const flags: string[] = [];
  if (!Array.isArray(value) || !value.every(option => typeof option === 'string')) {
    return { ok: false, options: [], flags: ['focus:invalid_options'] };
  }
  const options = [...new Set(value.map(option => option.trim()).filter(Boolean))];
  if (options.length < 2) flags.push(`focus:too_few_options:${options.length}`);
  if (options.length > 4) flags.push(`focus:too_many_options:${options.length}`);
  if (options.some(option => !selection.includes(option))) flags.push('focus:not_in_selection');
  if (options.some(option => [...option].length > 6)) flags.push('focus:option_too_long');

  const proper = annotations
    .filter(annotation => annotation.kind === 'proper_noun' && selection.includes(annotation.term))
    .map(annotation => annotation.term);
  const ranked = options
    .map((option, index) => ({
      option,
      index,
      proper: proper.some(term => term.includes(option)),
    }))
    .sort((a, b) => Number(a.proper) - Number(b.proper) || a.index - b.index)
    .map(entry => entry.option);
  return { ok: flags.length === 0, options: ranked, flags };
}

/** Deterministic no-answer fallback when focus-option generation fails. */
export function fallbackFocusOptions(selection: string, annotations: Annotation[]): string[] {
  const rare = annotations
    .filter(annotation => annotation.kind !== 'proper_noun' && selection.includes(annotation.term))
    .map(annotation => annotation.term);
  const proper = annotations
    .filter(annotation => annotation.kind === 'proper_noun' && selection.includes(annotation.term))
    .map(annotation => annotation.term);
  const characters = (selection.match(HAN) ?? []).filter(
    character => !proper.some(term => term.includes(character))
  );
  return [...new Set([...rare, ...characters, ...proper])].slice(0, 4);
}

/**
 * v5.10: after a free highlight the reader types ONE free question ("「擎」是什麼意思",
 * "以手擎飲食 what is that mean", or nothing). The focus word is read off that text
 * deterministically, without a model:
 *   1. quoted text (「」『』"") that occurs in the highlight;
 *   2. otherwise the longest run of Han characters that occurs both in the question and in
 *      the highlight, if it is 2+ characters, or 1 character that opens the question;
 *   3. otherwise null: no narrowing, the whole highlight stays the subject.
 * A result equal to the whole highlight is also null (nothing to narrow).
 */
export function deriveFocus(selection: string, question: string): string | null {
  const sel = selection.trim();
  const q = question.trim();
  if (!sel || !q) return null;
  const narrow = (value: string) => (value && value !== sel && sel.includes(value) ? value : null);
  for (const match of q.matchAll(/[「『"“]([^」』"”]+)[」』"”]/gu)) {
    const quoted = match[1].trim();
    if (quoted && sel.includes(quoted)) return narrow(quoted);
  }
  const chars = [...q];
  const isHan = (c: string) => /\p{Script=Han}/u.test(c);
  let best = '';
  for (let i = 0; i < chars.length; i++) {
    if (!isHan(chars[i])) continue;
    let run = '';
    for (let j = i; j < chars.length && isHan(chars[j]); j++) {
      run += chars[j];
      if (!sel.includes(run)) break;
      if ([...run].length > [...best].length) best = run;
    }
  }
  if ([...best].length >= 2) return narrow(best);
  const firstHan = chars.find(isHan);
  if ([...best].length === 1 && firstHan === best) return narrow(best);
  return null;
}

export function focusOccursInSelection(selection: string, focus: string): boolean {
  const value = focus.trim();
  return value.length > 0 && [...value].length <= 12 && selection.includes(value);
}
