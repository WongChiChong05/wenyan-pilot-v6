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

export function focusOccursInSelection(selection: string, focus: string): boolean {
  const value = focus.trim();
  return value.length > 0 && [...value].length <= 12 && selection.includes(value);
}
