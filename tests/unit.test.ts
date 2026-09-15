import { describe, expect, it } from 'vitest';
import { classifyGranularity, lowerBoundMet, matchTarget } from '../src/lib/highlight';
import { endPosition, explanationAllowed, initialLadder, reduce } from '../src/lib/ladder';
import { checkDirectOutput, checkSocraticOutput, isYesNoQuestion, leakRate } from '../src/lib/leak';
import { assignArm, mulberry32, stratumOf } from '../src/lib/randomize';
import { ruleCheckReason, shouldForceAccept } from '../src/lib/reasonGate';
import { cohensKappa, cronbachAlpha, itemStats, scoreQuiz } from '../src/lib/scoring';
import { LEARNING_PASSAGE } from '../src/content/passages';
import type { Item } from '../src/lib/types';

describe('highlight granularity (design doc 3.3)', () => {
  it('counts <= 4 characters as a word, ignoring punctuation', () => {
    expect(classifyGranularity('之')).toBe('word');
    expect(classifyGranularity('擊之，')).toBe('word');
  });
  it('treats a span inside one sentence as a sentence', () => {
    expect(classifyGranularity('以鐵如意擊之，應手而碎')).toBe('sentence');
  });
  it('treats a span crossing a sentence end as a passage', () => {
    expect(classifyGranularity('崇視訖，以鐵如意擊之，應手而碎。愷既惋惜')).toBe('passage');
  });
  it('does not count a trailing full stop as crossing', () => {
    expect(classifyGranularity('愷惘然自失。')).toBe('sentence');
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
  it('is met only when every target has been completed', () => {
    expect(lowerBoundMet(LEARNING_PASSAGE, ['TS1', 'TS2', 'TS3'])).toBe(false);
    expect(lowerBoundMet(LEARNING_PASSAGE, ['TS1', 'TS2', 'TS3', 'TS4'])).toBe(true);
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
