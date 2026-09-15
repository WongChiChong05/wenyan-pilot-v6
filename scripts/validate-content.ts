/**
 * Content gate. Run before every deployment and before collecting a single participant:
 *   npm run validate:content
 *
 * It fails (exit 1) while any placeholder, draft or unverified passage remains, so the
 * platform cannot be run for real with 【待填】 items in it.
 */
import { ALL_ITEMS, ITEMS_BY_STAGE } from '../src/content/items';
import {
  DELAYED_PASSAGE,
  LEARNING_PASSAGE,
  PASSAGES,
  PRETEST_PASSAGE,
  TRANSFER_PASSAGE,
} from '../src/content/passages';

const errors: string[] = [];
const warnings: string[] = [];

const EXPECTED_COUNTS = { S1: 8, S3: 10, S5: 12, S6: 10 } as const;
const EXPECTED_S5_LEVELS = { decode: 5, comprehend: 4, infer: 3 } as const;

for (const [stage, n] of Object.entries(EXPECTED_COUNTS)) {
  const items = ITEMS_BY_STAGE[stage as keyof typeof ITEMS_BY_STAGE];
  if (items.length !== n) errors.push(`${stage}: expected ${n} items, found ${items.length}`);
}

for (const [level, n] of Object.entries(EXPECTED_S5_LEVELS)) {
  const found = ITEMS_BY_STAGE.S5.filter((i) => i.level === level).length;
  if (found !== n) errors.push(`S5 ${level}: expected ${n}, found ${found}`);
}
if (ITEMS_BY_STAGE.S5.some((i) => i.level === 'check')) {
  errors.push('S5 must not contain check-level items (no annotations in the transfer passage)');
}

for (const item of ALL_ITEMS) {
  const fields = [item.stem, ...item.options, item.evidence, item.source];
  if (fields.some((f) => f.includes('\u3010\u5f85\u586b\u3011'))) {
    errors.push(`item ${item.id}: still a placeholder (content not written)`);
  } else if (item.draft) {
    errors.push(`item ${item.id}: written but awaiting reviewer sign-off (draft: true)`);
  }
  // The evidence sentence must actually be in the passage it points at, or the answer
  // source is unfalsifiable. 「……」 marks an intentional cut; each side is checked separately.
  if (!item.attentionCheck && item.evidence.trim().length > 0 && !item.evidence.includes('\u3010')) {
    const passage = PASSAGES[item.passageId];
    if (!passage) {
      errors.push(`item ${item.id}: unknown passageId ${item.passageId}`);
    } else if (passage.text.trim().length > 0) {
      for (const part of item.evidence.split('\u2026\u2026')) {
        const chunk = part.trim();
        if (chunk.length > 0 && !passage.text.includes(chunk)) {
          errors.push(`item ${item.id}: evidence not found in passage ${item.passageId}: 「${chunk}」`);
        }
      }
    }
  }
  if (new Set(item.options).size !== item.options.length) {
    errors.push(`item ${item.id}: duplicate options`);
  }
  if (item.answerIndex < 0 || item.answerIndex >= item.options.length) {
    errors.push(`item ${item.id}: answerIndex out of range`);
  }
  if (!item.attentionCheck && item.evidence.trim().length === 0) {
    errors.push(`item ${item.id}: missing evidence sentence`);
  }
}

for (const p of [PRETEST_PASSAGE, LEARNING_PASSAGE, TRANSFER_PASSAGE, DELAYED_PASSAGE]) {
  if (!p.verified) errors.push(`passage ${p.id}: not collated against the two annotated editions`);
  if (p.text.trim().length === 0) errors.push(`passage ${p.id}: empty text`);
  for (const a of p.annotations) {
    if (a.gloss.includes('待填')) errors.push(`passage ${p.id}: annotation ${a.term} is a placeholder`);
    if (!p.text.includes(a.term)) warnings.push(`passage ${p.id}: annotation ${a.term} not found in text`);
  }
}

if (TRANSFER_PASSAGE.annotations.length > 0) {
  errors.push('T1 must have no annotations (design rule)');
}

if (LEARNING_PASSAGE.targets.length !== 4) {
  errors.push(`learning passage: expected 4 target sentences, found ${LEARNING_PASSAGE.targets.length}`);
}
for (const t of LEARNING_PASSAGE.targets) {
  if (t.draft) errors.push(`target ${t.id}: still a draft`);
  if (!LEARNING_PASSAGE.text.includes(t.text)) {
    errors.push(`target ${t.id}: text is not a substring of the learning passage`);
  }
  if (t.explanation.trim().length === 0) errors.push(`target ${t.id}: empty explanation`);
  // Both arms are capped at 60 characters per turn; the pre-written text must fit too,
  // otherwise the direct arm would effectively get a longer message than the socratic one.
  if ([...t.explanation].length > 60) {
    errors.push(`target ${t.id}: explanation is ${[...t.explanation].length} chars (cap 60)`);
  }
  t.choice.whyWrong.forEach((w, i) => {
    if ([...w].length > 40) errors.push(`target ${t.id}: "why wrong" ${i + 1} is over 40 chars`);
  });
  if (t.choice.options.length < 2) errors.push(`target ${t.id}: needs at least 2 options`);
  if (t.choice.answerIndex < 0 || t.choice.answerIndex >= t.choice.options.length) {
    errors.push(`target ${t.id}: choice answerIndex out of range`);
  }
  t.choice.options.forEach((_, i) => {
    if (i !== t.choice.answerIndex && !t.choice.whyWrong[i]) {
      errors.push(`target ${t.id}: missing "why wrong" for option ${i + 1}`);
    }
  });
  if (t.acceptableAnswers.length === 0) errors.push(`target ${t.id}: no acceptable answers listed`);
}

// The language points taught in T2 must be testable in T1, or nothing transfers.
const T1 = TRANSFER_PASSAGE.text;
for (const key of ['之', '以', '者']) {
  if (!T1.includes(key)) errors.push(`transfer passage is missing the function word ${key}`);
}

console.log(`passages: ${Object.keys(PASSAGES).length}, items: ${ALL_ITEMS.length}`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(errors.length === 0 ? 'CONTENT OK' : `CONTENT NOT READY: ${errors.length} error(s)`);
process.exit(errors.length === 0 ? 0 : 1);
