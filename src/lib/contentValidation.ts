/**
 * Content gate. Run before every deployment and before collecting a single participant:
 *   npm run validate:content
 *
 * It fails (exit 1) while any placeholder, draft or unverified passage remains, so the
 * platform cannot be run for real with 【待填】 items in it.
 */
import { ALL_ITEMS, ITEMS_BY_STAGE } from '../content/items';
import { PASSAGES, TRAINING_PASSAGES } from '../content/passages';
import { TRANSLATION_BY_STAGE, TRANSLATION_ITEMS, TRANSLATION_PASSAGE } from '../content/translation';
import { requiredTargets } from './highlight';
import { checkSocraticOutput } from './leak';

export function validateContent() {
const errors: string[] = [];
const warnings: string[] = [];

const EXPECTED_COUNTS = { S1: 8, S5b: 5 } as const;

for (const [stage, n] of Object.entries(EXPECTED_COUNTS)) {
  const items = ITEMS_BY_STAGE[stage as keyof typeof ITEMS_BY_STAGE];
  if (items.length !== n) errors.push(`${stage}: expected ${n} items, found ${items.length}`);
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

/**
 * CROSS-ITEM LEAKAGE.
 *
 * Within one stage the reader sees every item at once, so an item whose stem or options
 * spell out another item's answer is a free mark. The obvious case found by hand: one
 * item asked what 「駛」 meant (answer 「跑得快」) while another item's stem opened with
 * 「石崇的牛跑得快」.
 *
 * The rule below is deliberately narrow — a correct option repeated VERBATIM, three
 * Chinese characters or more — so it flags real give-aways and not the proper nouns that
 * every item on one passage necessarily shares. Semantic leakage (a paraphrase, or a
 * comprehension answer that implies an inference answer) still has to be caught by
 * reading; this only stops the mechanical kind coming back.
 */
const cjkOnly = (t: string) => t.replace(/[^\u4e00-\u9fff]/g, '');
for (const [stage, list] of Object.entries(ITEMS_BY_STAGE)) {
  for (const a of list) {
    if (a.attentionCheck) continue;
    const key = cjkOnly(a.options[a.answerIndex] ?? '');
    if (key.length < 3) continue; // too short to be diagnostic on its own
    for (const b of list) {
      if (a.id === b.id) continue;
      const haystack = cjkOnly([b.stem, ...b.options].join(''));
      if (haystack.includes(key)) {
        errors.push(
          `${stage}: item ${a.id}'s answer 「${a.options[a.answerIndex]}」 is repeated in ${b.id}`
        );
      }
    }
  }
}

for (const p of Object.values(PASSAGES)) {
  if (!p.verified) errors.push(`passage ${p.id}: not collated and signed off`);
  // The reader-facing title must not carry the internal entry numbers, and must not name
  // the source chapter — 「汰侈」 or 「儉嗇」 would tell every reader the theme.
  if (p.displayTitle.trim().length === 0) errors.push(`passage ${p.id}: no displayTitle`);
  if (/[0-9０-９＋+]/.test(p.displayTitle) || /汰侈|儉嗇/.test(p.displayTitle)) {
    errors.push(`passage ${p.id}: displayTitle 「${p.displayTitle}」 carries entry numbers or the chapter name`);
  }
  if (p.displayTitle === p.title) {
    errors.push(`passage ${p.id}: displayTitle is the internal label; give the reader a neutral one`);
  }
  if (p.text.trim().length === 0) errors.push(`passage ${p.id}: empty text`);
  for (const a of p.annotations) {
    if (a.gloss.includes('待填')) errors.push(`passage ${p.id}: annotation ${a.term} is a placeholder`);
    if (!a.source) errors.push(`passage ${p.id}: annotation ${a.term} has no source`);
    if (!p.text.includes(a.term)) warnings.push(`passage ${p.id}: annotation ${a.term} not found in text`);
  }
}
const titles = Object.values(PASSAGES).map(p => p.displayTitle);
if (new Set(titles).size !== titles.length) errors.push('two passages share a displayTitle');

// v6: every training passage carries exactly two required targets, unique ids throughout.
const targetIds = TRAINING_PASSAGES.flatMap(p => p.targets.map(t => t.id));
if (new Set(targetIds).size !== targetIds.length) errors.push('target ids repeat across training passages');
for (const passage of TRAINING_PASSAGES) {
  const required = passage.targets.filter(t => t.required);
  if (required.length !== 2) errors.push(`training passage ${passage.id}: expected 2 required targets, found ${required.length}`);
  if (requiredTargets(passage).length === 0) errors.push(`training passage ${passage.id}: no targets`);
for (const t of passage.targets) {
  if (t.draft) errors.push(`target ${t.id}: still a draft`);
  if (!passage.text.includes(t.text)) {
    errors.push(`target ${t.id}: text is not a substring of passage ${passage.id}`);
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

  // v5.8: the displayed first two rungs are open questions. Choice specs remain
  // optional solely for interactions saved under the earlier MCQ protocol.
  for (const [layer, spec, prompt] of [
    [1, t.layer1Choice, t.layer1],
    [2, t.layer2Choice, t.layer2],
  ] as const) {
    if (prompt.trim().length === 0) errors.push(`target ${t.id}: layer ${layer} has no prompt`);
    const report = checkSocraticOutput(prompt);
    if (!report.ok) errors.push(`target ${t.id}: layer ${layer} question leaks (${report.flags.join(', ')})`);
    if (!spec) continue;
    if (spec.options.length < 2) errors.push(`target ${t.id}: layer ${layer} needs at least 2 options`);
    if (new Set(spec.options).size !== spec.options.length) {
      errors.push(`target ${t.id}: layer ${layer} has duplicate options`);
    }
    if (spec.answerIndex < 0 || spec.answerIndex >= spec.options.length) {
      errors.push(`target ${t.id}: layer ${layer} answerIndex out of range`);
    }
    // A rung that repeats the bottom-out options would hand over the answer early.
    if (spec.options.join('|') === t.choice.options.join('|')) {
      errors.push(`target ${t.id}: layer ${layer} options are identical to the layer-3 answer options`);
    }
  }
}

}

// v6 translation items: substrings of their passage, three scoring points each, help text
// present exactly where the stage offers it, and never the reference itself as the hint.
const expectedTranslation = { S1b: 3, S5a: 3, S5b: 4 } as const;
for (const [stage, n] of Object.entries(expectedTranslation)) {
  const list = TRANSLATION_BY_STAGE[stage as keyof typeof TRANSLATION_BY_STAGE];
  if (list.length !== n) errors.push(`${stage}: expected ${n} translation sentences, found ${list.length}`);
}
const translationIds = TRANSLATION_ITEMS.map(i => i.id);
if (new Set(translationIds).size !== translationIds.length) errors.push('translation item ids repeat');
for (const item of TRANSLATION_ITEMS) {
  const passage = PASSAGES[item.passageId];
  if (!passage) errors.push(`translation ${item.id}: unknown passage ${item.passageId}`);
  else if (!passage.text.includes(item.sentence)) errors.push(`translation ${item.id}: sentence not found in passage ${item.passageId}`);
  if (TRANSLATION_PASSAGE[item.stage] !== item.passageId) errors.push(`translation ${item.id}: not on its stage's passage`);
  if (item.draft) errors.push(`translation ${item.id}: written but awaiting reviewer sign-off (draft: true)`);
  if (!item.reference.trim()) errors.push(`translation ${item.id}: no reference translation`);
  if (!item.source.trim()) errors.push(`translation ${item.id}: no source`);
  for (const key of ['A', 'B', 'C'] as const) if (!item.rubric[key].trim()) errors.push(`translation ${item.id}: rubric ${key} empty`);
  const helped = item.stage !== 'S5b';
  if (helped && (!item.hint || !item.explanation)) errors.push(`translation ${item.id}: hint and explanation required in ${item.stage}`);
  if (!helped && (item.hint || item.explanation)) errors.push(`translation ${item.id}: S5b offers no help; remove hint/explanation`);
  if (item.hint && item.reference.includes(item.hint.replace(/[。，；：「」（）]/g, '').slice(0, 8))) {
    errors.push(`translation ${item.id}: hint repeats the reference translation`);
  }
}
// Post-test passages must be unseen: nothing from training or baseline may reappear.
const postIds = new Set(['J1', 'J7', 'J9']);
for (const passage of TRAINING_PASSAGES) {
  if (postIds.has(passage.id)) errors.push(`passage ${passage.id} is used in training and in a post-test`);
}

return { errors, warnings, passages: Object.keys(PASSAGES).length, items: ALL_ITEMS.length + TRANSLATION_ITEMS.length };
}
