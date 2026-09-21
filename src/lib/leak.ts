/**
 * Leakage detection for the socratic arm (manipulation check layers 1, 2 and 4 of the
 * design doc). Runs on every model output BEFORE it reaches the reader; a hit causes
 * one regeneration, and a second hit downgrades to the pre-written step text.
 */

/** Phrases that state a meaning outright. */
export const BANNED_PHRASES = [
  '意思是',
  '意思為',
  '即是',
  '就是說',
  '也就是說',
  '換句話說',
  '翻譯成',
  '翻譯為',
  '白話是',
  '指的是',
  '可解釋為',
  '解釋為',
  '相當於',
];

/** Grammar terminology the socratic arm may not teach (design doc §7.2). */
export const BANNED_TERMS = [
  '賓語前置',
  '定語後置',
  '通假字',
  '名詞活用',
  '使動用法',
  '意動用法',
  '判斷句',
];

const YESNO_MARKERS = ['是不是', '對不對', '有沒有', '會不會', '能不能', '可不可以', '是否'];
const LOW_VALUE_COPY_PATTERNS = [
  /(?:前面|後面)(?:緊)?(?:接著|接的|是)什麼(?:字|詞)?/,
  /哪個字(?:緊)?(?:接在|跟在).*(?:前面|後面)/,
  /第幾個字/,
];

export interface LeakReport {
  ok: boolean;
  flags: string[];
}

export function checkSocraticOutput(text: string): LeakReport {
  const flags: string[] = [];
  for (const p of BANNED_PHRASES) if (text.includes(p)) flags.push(`phrase:${p}`);
  for (const t of BANNED_TERMS) if (text.includes(t)) flags.push(`term:${t}`);
  if (isYesNoQuestion(text)) flags.push('yesno');
  if (LOW_VALUE_COPY_PATTERNS.some(pattern => pattern.test(text))) flags.push('low_value:adjacent_copy');
  if ([...text].length > 60) flags.push('too_long');
  return { ok: flags.length === 0, flags };
}

/**
 * Task-A: leak-check every option of a generated MCQ at layers 1 or 2.
 *
 * A layer-1 option like 「代詞，指珊瑚樹」 states the answer the ladder is meant to
 * reach at layer 3, so it must be treated as a leak the same way a question stem
 * containing 「意思是」 is. This runs the socratic checker over each option and
 * prefixes the flags with `option{i}:`.
 *
 * Layer 3 is the bottom-out — its options *are* the answer, by design. Do not
 * call this on layer-3 options.
 */
export function checkSocraticOptions(options: string[]): LeakReport {
  const flags: string[] = [];
  options.forEach((opt, i) => {
    const inner = checkSocraticOutput(opt);
    for (const f of inner.flags) flags.push(`option${i}:${f}`);
  });
  return { ok: flags.length === 0, flags };
}

/**
 * Task-A structural validation of a generated MCQ shape. Same regen-once, then
 * fall back semantics as the leak check.
 *
 * Reject: <3 options, an empty option, duplicates, answerIndex out of range.
 */
export function validateChoiceStructure(
  options: string[],
  answerIndex: number
): LeakReport {
  const flags: string[] = [];
  if (options.length < 3) flags.push(`structure:too_few_options:${options.length}`);
  if (options.length > 3) flags.push(`structure:too_many_options:${options.length}`);
  const trimmed = options.map((o) => (o ?? '').trim());
  if (trimmed.some((o) => o.length === 0)) flags.push('structure:empty_option');
  if (new Set(trimmed).size < trimmed.length) flags.push('structure:duplicate_option');
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
    flags.push(`structure:answer_index_out_of_range:${answerIndex}`);
  }
  return { ok: flags.length === 0, flags };
}

/** "加了問號的答案" — a yes/no question that carries the answer inside it. */
export function isYesNoQuestion(text: string): boolean {
  return YESNO_MARKERS.some((m) => text.includes(m)) && /[?？]/.test(text);
}

/** The direct arm may explain, but never dump a whole translation at once. */
export function checkDirectOutput(text: string, passageText: string): LeakReport {
  const flags: string[] = [];
  if ([...text].length > 60) flags.push('too_long');
  const sentences = passageText.split(/[。！？]/).filter((s) => s.trim().length > 0);
  const covered = sentences.filter((s) => text.includes(s.slice(0, 4))).length;
  if (covered >= 3) flags.push('whole_passage_translation');
  return { ok: flags.length === 0, flags };
}

/** Reported in the paper: share of socratic turns that leaked, target < 5%. */
export function leakRate(rows: { leakFlags: string[]; actor: string }[]): number {
  const systemTurns = rows.filter((r) => r.actor === 'system');
  if (systemTurns.length === 0) return 0;
  return systemTurns.filter((r) => r.leakFlags.length > 0).length / systemTurns.length;
}
