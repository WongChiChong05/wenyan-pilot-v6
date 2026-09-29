import { describe, expect, it } from 'vitest';
import {
  classifyGranularity,
  lowerBoundApplies,
  lowerBoundMet,
  matchTarget,
  neighborhoodOf,
  requiredTargets,
  sentenceRanges,
  showsTargetHints,
} from '../src/lib/highlight';
import { endPosition, explanationAllowed, initialLadder, reduce } from '../src/lib/ladder';
import {
  checkDirectOutput,
  checkSocraticOptions,
  checkSocraticOutput,
  isYesNoQuestion,
  leakRate,
  validateChoiceStructure,
} from '../src/lib/leak';
import { assignArm, mulberry32, stratumOf } from '../src/lib/randomize';
import { ruleCheckReason, shouldForceAccept } from '../src/lib/reasonGate';
import { cohensKappa, cronbachAlpha, itemStats, scoreQuiz } from '../src/lib/scoring';
import { openFinalQuestion, reasonJudgePrompt, socraticOpenSystemPrompt, socraticSystemPrompt, socraticTurnPrompt } from '../src/lib/prompts';
import { LEARNING_PASSAGE, TRAINING_PASSAGES } from '../src/content/passages';
import type { Item } from '../src/lib/types';
import { fallbackFocusOptions, focusOccursInSelection, validateFocusOptions } from '../src/lib/focus';

describe('highlight granularity (pilot v5.4: one char = word, else at least sentence)', () => {
  it('treats a single Chinese character as a word, ignoring stray punctuation', () => {
    expect(classifyGranularity('之')).toBe('word');
    expect(classifyGranularity('之，')).toBe('word');
  });
  it('treats two or more characters as a sentence when nothing is crossed', () => {
    expect(classifyGranularity('擊之')).toBe('sentence');
    expect(classifyGranularity('以鐵如意擊之，應手而碎')).toBe('sentence');
  });
  it('treats a span crossing a sentence end as a passage', () => {
    expect(classifyGranularity('崇視訖，以鐵如意擊之，應手而碎。愷既惋惜')).toBe('passage');
  });
  it('does not count a trailing full stop as crossing', () => {
    expect(classifyGranularity('愷惘然自失。')).toBe('sentence');
  });
});

describe('focus-option validation', () => {
  it('keeps options inside the highlight and ranks known proper nouns last', () => {
    const report = validateFocusOptions(
      ['武帝', '嘗', '降'],
      '武帝嘗降王武子家',
      LEARNING_PASSAGE.annotations
    );
    expect(report.ok).toBe(true);
    expect(report.options).toEqual(['嘗', '降', '武帝']);
  });
  it('rejects invented options and validates typed other values', () => {
    expect(validateFocusOptions(['異', '不存在'], '異於常味', LEARNING_PASSAGE.annotations).ok).toBe(false);
    expect(focusOccursInSelection('異於常味', '常味')).toBe(true);
    expect(focusOccursInSelection('異於常味', '帝')).toBe(false);
    expect(fallbackFocusOptions('異於常味', LEARNING_PASSAGE.annotations)).toEqual(['異', '於', '常', '味']);
  });
});

// Task-2 undo of the old snap: no more normaliseSelection. The engine stores the
// reader's selection verbatim; sentenceRanges is exported so neighborhoodOf can
// slice the surrounding sentences for the Task-B prompt.
describe('sentenceRanges + neighborhoodOf (Task-B prompt context)', () => {
  const T2 = LEARNING_PASSAGE.text;

  it('covers the whole passage with non-overlapping sentence ranges', () => {
    const ranges = sentenceRanges(T2);
    expect(ranges[0].start).toBe(0);
    expect(ranges[ranges.length - 1].end).toBe(T2.length);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBe(ranges[i - 1].end);
    }
  });

  it('absorbs a closing quote so 「以人乳飲㹠。」 stays whole', () => {
    const start = T2.indexOf('「以人乳飲㹠');
    const ranges = sentenceRanges(T2);
    const r = ranges.find((x) => x.start <= start && x.end > start)!;
    expect(T2.slice(r.start, r.end).endsWith('」')).toBe(true);
  });

  it('returns previous/containing/next sentences around a target selection', () => {
    const start = T2.indexOf('以鐵如意擊之，應手而碎');
    const end = start + '以鐵如意擊之，應手而碎'.length;
    const nb = neighborhoodOf(T2, start, end);
    expect(nb.containing).toContain('以鐵如意擊之，應手而碎');
    // 顏興林 edition punctuates 「愷以示崇，崇視訖，」 as one sentence (wikisource had a 。 after 崇)
    expect(nb.containing.startsWith('愷以示崇，崇視訖，')).toBe(true);
    // there is a sentence before this one in the passage
    expect(nb.prev.length).toBeGreaterThan(0);
    // and one after
    expect(nb.next.length).toBeGreaterThan(0);
  });

  it('returns an empty prev when the selection is in the first sentence', () => {
    const start = 0;
    const end = 3;
    const nb = neighborhoodOf(T2, start, end);
    expect(nb.prev).toBe('');
  });
});

describe('Task-A leak-check on generated options and structural validation', () => {
  it('flags an option that states a meaning', () => {
    const rep = checkSocraticOptions(['觀察一', '意思是珊瑚樹', '觀察三']);
    expect(rep.ok).toBe(false);
    expect(rep.flags.some((f) => f.startsWith('option1:'))).toBe(true);
  });
  it('passes clean structural options', () => {
    const rep = checkSocraticOptions(['前面', '後面', '兩邊']);
    expect(rep.ok).toBe(true);
  });
  it('rejects fewer than 3 options', () => {
    expect(validateChoiceStructure(['a', 'b'], 0).ok).toBe(false);
  });
  it('rejects empty and duplicate options', () => {
    expect(validateChoiceStructure(['a', '', 'c'], 0).ok).toBe(false);
    expect(validateChoiceStructure(['a', 'a', 'b'], 0).ok).toBe(false);
  });
  it('rejects an out-of-range answerIndex', () => {
    expect(validateChoiceStructure(['a', 'b', 'c'], 9).ok).toBe(false);
    expect(validateChoiceStructure(['a', 'b', 'c'], -1).ok).toBe(false);
  });
});

describe('Task-B: socratic prompts carry offset + neighbourhood, no more 「這個字」 branch', () => {
  const T2 = LEARNING_PASSAGE.text;
  it('includes the character offset and the three labelled sentences', () => {
    const start = T2.indexOf('以鐵如意擊');
    const end = start + '以鐵如意擊'.length;
    const nb = neighborhoodOf(T2, start, end);
    const prompt = socraticTurnPrompt({
      passage: T2,
      selection: '以鐵如意擊',
      selectionStart: start,
      selectionEnd: end,
      neighborhood: nb,
      layer: 1,
      granularity: 'sentence',
      withOptions: true,
    });
    expect(prompt).toContain(`選取位置：第 ${start}`);
    expect(prompt).toContain('【前一句】');
    expect(prompt).toContain('【所在句】');
    expect(prompt).toContain('【後一句】');
  });

  it('asks for options+answerIndex when withOptions is set', () => {
    const prompt = socraticTurnPrompt({
      passage: T2,
      selection: '之',
      layer: 1,
      granularity: 'word',
      withOptions: true,
    });
    expect(prompt).toContain('三個觀察選項');
    expect(prompt).toContain('answerIndex');
  });

  it('system prompt forbids saying 「這個字」 for multi-character selections and forbids meaning-stating options', () => {
    const sys = socraticSystemPrompt();
    expect(sys).toContain('禁用');
    expect(sys).toContain('這個字');
    expect(sys).toContain('每個選項都不得說出字詞的意思');
  });
});

describe('target matching and the lower bound', () => {
  it('matches a selection inside a target sentence', () => {
    expect(matchTarget(LEARNING_PASSAGE, '擊之')).toBe('TS1');
    expect(matchTarget(LEARNING_PASSAGE, '愷之甥也')).toBe('TS2');
  });
  it('returns null for a free highlight', () => {
    expect(matchTarget(LEARNING_PASSAGE, '帝甚不平')).toBeNull();
  });
  it('v6: is met when the passage\'s required targets (TS1, TS4) are completed', () => {
    expect(lowerBoundMet(LEARNING_PASSAGE, ['TS1', 'TS2', 'TS3'])).toBe(false);
    expect(lowerBoundMet(LEARNING_PASSAGE, ['TS1', 'TS4'])).toBe(true);
    expect(requiredTargets(LEARNING_PASSAGE).map(t => t.id)).toEqual(['TS1', 'TS4']);
  });

  // v6: the two AI arms must finish each passage's required targets; control is never
  // gated because it has no AI turn that could finish a sentence.
  it('gates the AI arms only', () => {
    expect(lowerBoundApplies('socratic')).toBe(true);
    expect(lowerBoundApplies('direct')).toBe(true);
    expect(lowerBoundApplies('control')).toBe(false);
  });
  it('reports met for control whatever it marked, and not for an AI arm with nothing done', () => {
    expect(lowerBoundMet(LEARNING_PASSAGE, [], 'control')).toBe(true);
    expect(lowerBoundMet(LEARNING_PASSAGE, [], 'socratic')).toBe(false);
    expect(lowerBoundMet(LEARNING_PASSAGE, ['TS1', 'TS4'], 'direct')).toBe(true);
  });
  it('shades the required targets for every arm', () => {
    for (const arm of ['socratic', 'direct', 'control'] as const) {
      expect(showsTargetHints(arm)).toBe(true);
    }
  });
  it('every training passage has exactly two required targets with unique ids', () => {
    const ids = TRAINING_PASSAGES.flatMap(p => p.targets.map(t => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of TRAINING_PASSAGES) expect(p.targets.filter(t => t.required)).toHaveLength(2);
  });
  // ...but the hand-written ladders still fire on the TEXT, not on the shading.
  it('still matches a target sentence the reader happened to select', () => {
    expect(matchTarget(LEARNING_PASSAGE, '以鐵如意擊之')).toBe('TS1');
  });
  it('resolves an ambiguous 「之」 by offset when the client sends one', () => {
    // Two targets contain 「之」: TS1 (擊之) and TS2 (愷之甥也). The character
    // clicked in 「愷之甥也」 must resolve to TS2, not to whichever sentence
    // contains a 「之」 first.
    const start = LEARNING_PASSAGE.text.indexOf('愷之甥也') + 1; // the 之
    expect(matchTarget(LEARNING_PASSAGE, '之', start)).toBe('TS2');
  });
  it('falls back to substring search when the offset does not match the text', () => {
    // A hostile or buggy client cannot make the server believe a selection came
    // from somewhere it did not.
    expect(matchTarget(LEARNING_PASSAGE, '擊之', 0)).toBe('TS1');
  });
});

describe('socratic ladder (the manipulation itself)', () => {
  it('never allows the explanation before an attempt', () => {
    const s = initialLadder();
    expect(explanationAllowed(s)).toBe(false);
    const wrong1 = reduce(s, { kind: 'free_answer', correct: false, hasReason: false });
    expect(explanationAllowed(wrong1)).toBe(false);
    const wrong2 = reduce(wrong1, { kind: 'free_answer', correct: false, hasReason: false });
    expect(wrong2.step).toBe('layer3_choice');
    expect(explanationAllowed(wrong2)).toBe(false);
  });

  it('lets a correct answer with a reason end early', () => {
    const s = reduce(initialLadder(), { kind: 'free_answer', correct: true, hasReason: true });
    expect(s.step).toBe('explanation');
    expect(endPosition(s)).toBe('layer1_correct');
  });

  it('keeps a correct-but-unjustified answer on the same layer (the probe)', () => {
    const s = reduce(initialLadder(), { kind: 'free_answer', correct: true, hasReason: false });
    expect(s.step).toBe('layer1');
  });

  it('shows the explanation after the choice once a reason is accepted, right or wrong', () => {
    let s = initialLadder();
    s = reduce(s, { kind: 'free_answer', correct: false, hasReason: false });
    s = reduce(s, { kind: 'free_answer', correct: false, hasReason: false });
    s = reduce(s, { kind: 'choice', index: 0, correct: false });
    s = reduce(s, { kind: 'reason', accepted: true });
    expect(s.step).toBe('explanation');
    expect(endPosition(s)).toBe('choice_wrong');
  });

  it('rejects at most twice and then force-accepts, flagged', () => {
    let s = initialLadder();
    s = reduce(s, { kind: 'free_answer', correct: false, hasReason: false });
    s = reduce(s, { kind: 'free_answer', correct: false, hasReason: false });
    s = reduce(s, { kind: 'choice', index: 1, correct: true });
    s = reduce(s, { kind: 'reason', accepted: false });
    expect(s.step).toBe('reason_rejected');
    s = reduce(s, { kind: 'reason', accepted: false });
    expect(s.step).toBe('explanation');
    expect(s.reasonInsufficient).toBe(true);
    expect(shouldForceAccept(2)).toBe(true);
  });
});

describe('reason gate rules', () => {
  const ctx = { sentenceText: '以鐵如意擊之，應手而碎', optionTexts: ['的', '指某個東西', '往、去'] };
  it('rejects empty, short and contentless answers', () => {
    expect(ruleCheckReason('', ctx).verdict).toBe('reject');
    expect(ruleCheckReason('嗯', ctx).verdict).toBe('reject');
    expect(ruleCheckReason('不知道', ctx).verdict).toBe('reject');
    expect(ruleCheckReason('用猜的', ctx).verdict).toBe('reject');
  });
  it('rejects a bare echo of an option', () => {
    expect(ruleCheckReason('因為是的', ctx).verdict).toBe('reject');
  });
  it('accepts a reason that quotes the sentence', () => {
    expect(ruleCheckReason('因為前面是擊', ctx).verdict).toBe('accept');
  });
  it('accepts a wrong but reasoned answer', () => {
    expect(ruleCheckReason('因為之常常當的用', ctx).verdict).toBe('accept');
  });
  it('accepts a short reason that is a verbatim quote from the passage (v5.11)', () => {
    const p = { sentenceText: '婢子百餘人，皆綾羅絝𧟌', optionTexts: [], passageText: '武帝嘗降王武子家，武子供饌，並用瑠璃器。婢子百餘人，皆綾羅絝𧟌，以手擎飲食。' };
    expect(ruleCheckReason('百餘人', p)).toEqual({ verdict: 'accept', rule: 'quotes_evidence' });
    expect(ruleCheckReason('瑠璃器', p).verdict).toBe('accept');
    expect(ruleCheckReason('嗯', p).verdict).toBe('reject');
    expect(ruleCheckReason('人多', p).verdict).toBe('reject');
  });
  it('leaves a non-Chinese reason to the model instead of rejecting it', () => {
    expect(ruleCheckReason('since he has a lot of servants', ctx).verdict).toBe('undecided');
  });
  it('gives the model judge the question and the answer (v5.11)', () => {
    const { system, user } = reasonJudgePrompt({ reason: 'since he has a lot of servants', sentence: '婢子百餘人',
      options: [], question: '描寫了哪幾件事？', answer: '王武子很有錢' });
    expect(user).toContain('描寫了哪幾件事？');
    expect(user).toContain('王武子很有錢');
    expect(system).toContain('任何語言');
  });
  it('makes the last rung a translation task (v5.11)', () => {
    expect(openFinalQuestion('以鐵如意擊之，應手而碎')).toBe('現在請把「以鐵如意擊之，應手而碎」譯成白話，並寫出你的判斷依據。');
    expect(openFinalQuestion('帝甚不平', { text: '意思', source: 'default' })).toContain('譯成白話');
    expect(openFinalQuestion('擎', { text: '意思', source: 'default' })).toContain('白話意思');
    expect(socraticOpenSystemPrompt()).toContain('不問主旨、作者意圖');
  });
  it('sends an unclear case to the model', () => {
    expect(ruleCheckReason('語感判斷出來', ctx).verdict).toBe('undecided');
  });
});

describe('leak detection (manipulation check)', () => {
  it('flags a stated meaning', () => {
    expect(checkSocraticOutput('「之」的意思是珊瑚樹').ok).toBe(false);
  });
  it('flags grammar terminology', () => {
    expect(checkSocraticOutput('這句是定語後置').ok).toBe(false);
  });
  it('flags a yes/no question that carries the answer', () => {
    expect(isYesNoQuestion('「莫」是不是讓賓語跑到前面去了？')).toBe(true);
    expect(checkSocraticOutput('「莫」是不是讓賓語跑到前面去了？').ok).toBe(false);
  });
  it('passes a plain question', () => {
    expect(checkSocraticOutput('這個字在句子什麼位置？前後是什麼詞性？').ok).toBe(true);
  });
  it('rejects an adjacent-character copying question', () => {
    const report = checkSocraticOutput('「異」字後面緊接著什麼？');
    expect(report.ok).toBe(false);
    expect(report.flags).toContain('low_value:adjacent_copy');
  });
  it('flags a whole-passage translation from the direct arm', () => {
    const passage = '甲乙丙丁。戊己庚辛。壬癸子丑。';
    expect(checkDirectOutput('甲乙丙丁。戊己庚辛。壬癸子丑。', passage).ok).toBe(false);
    expect(checkDirectOutput('這句是說甲乙。', passage).ok).toBe(true);
  });
  it('computes the leak rate over system turns only', () => {
    const rows = [
      { actor: 'system', leakFlags: [] },
      { actor: 'system', leakFlags: ['phrase:意思是'] },
      { actor: 'user', leakFlags: [] },
    ];
    expect(leakRate(rows)).toBeCloseTo(0.5);
  });
});

describe('randomisation', () => {
  it('puts scores into the right stratum', () => {
    expect(stratumOf(2, { low: 3, high: 6 })).toBe('low');
    expect(stratumOf(5, { low: 3, high: 6 })).toBe('mid');
    expect(stratumOf(7, { low: 3, high: 6 })).toBe('high');
  });
  it('fills the least-filled arm, keeping the three arms balanced', () => {
    const rand = mulberry32(42);
    const counts = { socratic: 0, direct: 0, control: 0 };
    for (let i = 0; i < 30; i++) counts[assignArm(counts, rand)] += 1;
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
  });
});

describe('scoring', () => {
  const items: Item[] = [
    {
      id: 'i1',
      passageId: 'T1',
      stage: 'S5',
      level: 'decode',
      stem: 'q',
      options: ['a', 'b'],
      answerIndex: 1,
      evidence: 'e',
      source: 's',
    },
    {
      id: 'i2',
      passageId: 'T1',
      stage: 'S5',
      level: 'infer',
      stem: 'q',
      options: ['a', 'b'],
      answerIndex: 0,
      evidence: 'e',
      source: 's',
    },
  ];
  it('scores, counts skips and never trusts the client', () => {
    const out = scoreQuiz(items, [
      { itemId: 'i1', chosen: 1, rtMs: 5000 },
      { itemId: 'i2', chosen: null, rtMs: 1000 },
    ]);
    expect(out.total).toBe(1);
    expect(out.skipped).toBe(1);
    expect(out.byLevel.decode).toEqual({ correct: 1, n: 1 });
  });
  it('computes alpha and item statistics', () => {
    const m = [
      [1, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ];
    expect(cronbachAlpha(m)).toBeGreaterThan(0);
    const stats = itemStats(m);
    expect(stats[0].p).toBeCloseTo(0.75);
    expect(stats).toHaveLength(3);
  });
  it('computes Cohen\'s kappa for the reason-gate audit', () => {
    const human = [true, true, false, false, true];
    expect(cohensKappa(human, human)).toBeCloseTo(1);
    expect(cohensKappa(human, [true, false, false, true, true])).toBeLessThan(1);
  });
});

describe('ladder: multiple choice + reason on rungs 1 and 2', () => {
  const pick = (state: ReturnType<typeof initialLadder>, correct: boolean, accepted: boolean) =>
    reduce(reduce(state, { kind: 'layer_choice', index: 0, correct }), {
      kind: 'reason',
      accepted,
    });

  it('opens the explanation only when the pick is right AND the reason is accepted', () => {
    const s0 = initialLadder();
    const won = pick(s0, true, true);
    expect(won.step).toBe('explanation');
    expect(won.correctAtLayer).toBe(1);
    expect(endPosition(won)).toBe('layer1_correct');
  });

  it('keeps a lucky pick on the same rung when the reason is rejected', () => {
    const s0 = initialLadder();
    const stuck = pick(s0, true, false);
    expect(stuck.step).toBe('layer1'); // NOT explanation: guessing must not skip the ladder
    expect(stuck.reasonRejections).toBe(1);
  });

  it('drops a wrong pick with a good reason to the next rung', () => {
    const s0 = initialLadder();
    const down = pick(s0, false, true);
    expect(down.step).toBe('layer2');
    expect(down.reasonRejections).toBe(0); // each rung gets its own two tries
    const down2 = pick(down, false, true);
    expect(down2.step).toBe('layer3_choice');
  });

  // Same budget as the bottom-out: two rejections, then the reader is let through
  // with reasonInsufficient set, so nobody can be trapped on one rung.
  it('force-accepts after two rejections and flags it', () => {
    let s = initialLadder();
    s = pick(s, false, false); // rejection 1
    expect(s.step).toBe('layer1');
    expect(s.reasonRejections).toBe(1);
    s = pick(s, false, false); // rejection 2 -> forced through
    expect(s.step).toBe('layer2');
    expect(s.reasonInsufficient).toBe(true);
    expect(s.reasonRejectionsTotal).toBe(2);
  });

  it('still reaches the bottom-out and records how it ended', () => {
    let s = initialLadder();
    s = pick(s, false, true);
    s = pick(s, false, true);
    expect(s.step).toBe('layer3_choice');
    s = reduce(s, { kind: 'choice', index: 1, correct: false });
    s = reduce(s, { kind: 'reason', accepted: true });
    expect(s.step).toBe('explanation');
    expect(endPosition(s)).toBe('choice_wrong');
  });
});
