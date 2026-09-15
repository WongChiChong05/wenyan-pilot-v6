import { CONFIG } from './config';

export type ReasonVerdict = 'accept' | 'reject' | 'undecided';

export interface ReasonDecision {
  verdict: ReasonVerdict;
  rule: string; // which rule fired; written into the log so the judgement is auditable
}

/** Contentless answers. Rejected regardless of what else is in the text. */
const BLANKLIST = [
  '不知道',
  '唔知',
  '不清楚',
  '猜的',
  '亂猜',
  '用猜的',
  '感覺',
  '直覺',
  '隨便',
  '不會',
  '沒有理由',
  '沒理由',
  'idk',
  'no idea',
];

/** Causal / justification connectives. Their presence is evidence of a reason. */
const CONNECTIVES = ['因為', '所以', '由於', '既然', '可是', '但是', '不然', '否則', '才', '表示'];

/**
 * Rule layer of the three-layer gate (design doc 3.6).
 * Only 'undecided' is forwarded to the model, which keeps the amount of
 * model judgement — and therefore the reliability problem — small.
 */
export function ruleCheckReason(
  reason: string,
  context: { sentenceText: string; optionTexts: string[] }
): ReasonDecision {
  const text = reason.trim();
  const stripped = text.replace(/[\s，、。！？；：「」『』（）,.!?]/g, '');

  if (stripped.length === 0) return { verdict: 'reject', rule: 'empty' };
  if (stripped.length < CONFIG.reasonMinChars) return { verdict: 'reject', rule: 'too_short' };

  const lowered = stripped.toLowerCase();
  if (BLANKLIST.some((b) => lowered.includes(b.toLowerCase()))) {
    // A blanket phrase plus real content is still a reason; require that the rest is empty-ish.
    let rest = lowered;
    for (const b of BLANKLIST) rest = rest.split(b.toLowerCase()).join('');
    if (rest.length < CONFIG.reasonMinChars) return { verdict: 'reject', rule: 'contentless' };
  }

  // Only repeats an option -> not a reason.
  for (const opt of context.optionTexts) {
    const o = opt.replace(/[\s，、。！？；：]/g, '');
    if (o.length > 0 && (stripped === o || stripped === `因為是${o}` || stripped === `是${o}`)) {
      return { verdict: 'reject', rule: 'option_echo' };
    }
  }

  // Quotes a character from the sentence under discussion -> accept.
  const sentenceChars = new Set(
    context.sentenceText.replace(/[\s，、。！？；：「」『』（）]/g, '').split('')
  );
  const quoted = [...stripped].filter((c) => sentenceChars.has(c)).length;
  if (quoted >= 1 && stripped.length >= CONFIG.reasonMinChars) {
    return { verdict: 'accept', rule: 'quotes_text' };
  }

  if (CONNECTIVES.some((c) => text.includes(c))) {
    return { verdict: 'accept', rule: 'causal_connective' };
  }

  return { verdict: 'undecided', rule: 'needs_model' };
}

/** Force-accept on the third try (design doc 3.6), flagged as 理由不足. */
export function shouldForceAccept(rejections: number): boolean {
  return rejections >= CONFIG.maxReasonRejections;
}

export const REASON_REJECT_MESSAGE =
  '請說說你為什麼選這個，可以指出文中哪個字讓你這樣想。答錯沒關係。';
