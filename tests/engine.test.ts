import { describe, expect, it } from 'vitest';
import { LEARNING_PASSAGE } from '../src/content/passages';
import { Engine, pendingTurnFor } from '../src/lib/engine';
import { MockProvider } from '../src/lib/llm';
import { FALLBACK_SOCRATIC_MCQ } from '../src/lib/prompts';
import { MemoryStore, makeParticipant } from './memoryStore';

/**
 * A model that answers every prompt. Task-A: every socratic reply must include
 * options and answerIndex, so the mock returns the same three neutral observation
 * options each time. They survive the leak check + structural check and pass
 * through as a normal generated turn (not the fallback).
 */
const chatty = new MockProvider((system, user) => {
  if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
  if (system.includes('是否與參考答案一致')) return JSON.stringify({ correct: false });
  if (system.includes('解說者')) return JSON.stringify({ type: 'explain', text: '這裡是解釋。' });
  if (system.includes('可能想問的字或詞')) {
    const selection = user.match(/讀者反白：「([^」]+)」/)?.[1] ?? '';
    return JSON.stringify({ options: [...new Set([...selection.replace(/[^\u3400-\u9fff]/gu, '')])].slice(0, 4) });
  }
  return JSON.stringify({
    type: 'question',
    strategy: 'C',
    text: '選取範圍前後有哪些線索？',
    options: FALLBACK_SOCRATIC_MCQ.options,
    answerIndex: 0,
  });
});

const TARGET = LEARNING_PASSAGE.targets[0]; // 以鐵如意擊之

const L1 = TARGET.layer1Choice!;
const L2 = TARGET.layer2Choice!;
const other = (i: number) => (i === 0 ? 1 : 0);

async function startReady(
  engine: Engine,
  store: MemoryStore,
  p: ReturnType<typeof makeParticipant>,
  selection: string
) {
  let turn = await engine.startAssist(p, selection);
  if (turn.kind === 'focus') {
    const value = turn.focus?.options[0];
    if (!value) throw new Error('focus turn must include suggestions');
    turn = await engine.reply((await store.getParticipant(p.id))!, {
      kind: 'focus', value, source: 'suggestion',
    });
  }
  return turn;
}

describe('socratic arm: multiple choice + a required reason on every rung', () => {
  it('asks the reader to choose a focus for a multi-word free highlight', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const focus = await engine.startAssist(p, '異於常味');
    expect(focus.kind).toBe('focus');
    expect(focus.focus?.options.length).toBeGreaterThan(1);

    const turn = await engine.reply((await store.getParticipant(p.id))!, {
      kind: 'focus', value: '常味', source: 'other',
    });
    expect(turn.kind).toBe('choice');
    const active = (await store.getParticipant(p.id))!.active!;
    expect(active.selection).toBe('異於常味');
    expect(active.focusSelection).toBe('常味');
    expect(active.focusSource).toBe('other');
    expect(store.events.some(event => event.event === 'focus_selected')).toBe(true);
  });

  it('does not let another ladder action bypass a pending focus choice', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '異於常味');
    let message = '';
    try {
      await engine.reply((await store.getParticipant(p.id))!, {
        kind: 'choice', index: 0, reason: '因為原文如此',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('focus choice required');
  });

  it('walks layer1 -> layer2 -> bottom-out when each pick is wrong', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);

    const t1 = await engine.startAssist(p, '擊之');
    expect(t1.kind).toBe('choice');
    expect(t1.text).toBe(TARGET.layer1);
    expect(t1.choice?.options).toEqual(L1.options);

    let cur = (await store.getParticipant(p.id))!;
    const t2 = await engine.reply(cur, {
      kind: 'choice',
      index: other(L1.answerIndex),
      reason: '因為前面寫了鐵如意',
    });
    expect(t2.kind).toBe('choice');
    expect(t2.text).toBe(TARGET.layer2);
    expect(t2.choice?.options).toEqual(L2.options);

    cur = (await store.getParticipant(p.id))!;
    const t3 = await engine.reply(cur, {
      kind: 'choice',
      index: other(L2.answerIndex),
      reason: '因為後面接著應手而碎',
    });
    expect(t3.kind).toBe('choice');
    expect(t3.choice?.options).toEqual(TARGET.choice.options);

    cur = (await store.getParticipant(p.id))!;
    const t4 = await engine.reply(cur, { kind: 'choice', index: 0, reason: '感覺' });
    expect(t4.kind).toBe('reject'); // contentless reason
    expect(t4.choice?.options).toEqual(TARGET.choice.options); // options are resent

    cur = (await store.getParticipant(p.id))!;
    const t5 = await engine.reply(cur, { kind: 'choice', index: 0, reason: '因為前面是擊' });
    expect(t5.kind).toBe('explanation');
    expect(t5.text).toBe(TARGET.explanation);

    cur = (await store.getParticipant(p.id))!;
    const t6 = await engine.reply(cur, { kind: 'read_done' });
    expect(t6.completed).toBe(true);
    const after = (await store.getParticipant(p.id))!;
    expect(after.completedTargets).toEqual(['TS1']);
    expect(after.active).toBeNull();
  });

  it('lets a correct pick with a real reason finish at layer 1', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '擊之');
    const cur = (await store.getParticipant(p.id))!;
    const turn = await engine.reply(cur, {
      kind: 'choice',
      index: L1.answerIndex,
      reason: '因為擊是敲這個動作',
    });
    expect(turn.kind).toBe('explanation');
    const after = (await store.getParticipant(p.id))!;
    expect(after.active?.ladder.correctAtLayer).toBe(1);
  });

  // THE GUESSING GUARD. A 3-option choice is right one time in three by luck; if a
  // correct pick alone opened the explanation, a third of readers would skip the ladder
  // entirely and the questioning manipulation would not have happened for them.
  it('does not open the explanation on a lucky pick with no reason', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '擊之');
    const cur = (await store.getParticipant(p.id))!;
    const turn = await engine.reply(cur, { kind: 'choice', index: L1.answerIndex, reason: '猜的' });
    expect(turn.kind).toBe('reject');
    expect(turn.choice?.options).toEqual(L1.options);
    const after = (await store.getParticipant(p.id))!;
    expect(after.active?.ladder.step).toBe('layer1'); // still on the same rung
  });

  // Task A: free highlights are now MCQ too. The generated MCQ shape is preserved and
  // stored on `active.activeChoice` so the reply is judged against the model's answer.
  it('gives a free highlight a generated MCQ at layer 1', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const turn = await startReady(engine, store, p, '帝甚不平');
    expect(turn.kind).toBe('choice');
    expect(turn.choice?.options).toEqual(FALLBACK_SOCRATIC_MCQ.options);
    const after = (await store.getParticipant(p.id))!;
    expect(after.active?.activeChoice?.options).toEqual(FALLBACK_SOCRATIC_MCQ.options);
    expect(after.active?.activeChoice?.degraded).toBe(false);
  });

  // Model's answerIndex is trusted at run time for free highlights (Task-A design).
  it('lets a free highlight end early when the pick matches the model answer + a real reason', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await startReady(engine, store, p, '帝甚不平');
    const cur = (await store.getParticipant(p.id))!;
    const turn = await engine.reply(cur, {
      kind: 'choice',
      index: 0, // matches chatty's answerIndex
      reason: '因為前面說了以人乳飲豚',
    });
    expect(turn.kind).toBe('explanation');
  });

  // A wrong pick on the free-highlight MCQ descends to layer 2 (also a generated MCQ),
  // then layer 3 (the generic bottom-out).
  it('walks a free highlight down the ladder to the bottom-out choice', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const t1 = await startReady(engine, store, p, '帝甚不平');
    expect(t1.kind).toBe('choice');

    let cur = (await store.getParticipant(p.id))!;
    const t2 = await engine.reply(cur, { kind: 'choice', index: 1, reason: '因為前面說了以人乳飲豚' });
    expect(t2.kind).toBe('choice'); // layer 2, still a generated MCQ
    expect(t2.choice?.options.length).toBe(3);

    cur = (await store.getParticipant(p.id))!;
    const t3 = await engine.reply(cur, { kind: 'choice', index: 1, reason: '因為前面說了以人乳飲豚' });
    expect(t3.kind).toBe('choice'); // layer 3, generic bottom-out
    expect(t3.choice?.options.length).toBe(3);
  });
});

describe('arm symmetry and the control arm', () => {
  it('gives the direct arm the SAME explanation text as the socratic arm', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('direct');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const turn = await engine.startAssist(p, '擊之');
    expect(turn.kind).toBe('explanation');
    expect(turn.text).toBe(TARGET.explanation);
  });

  it('records the control arm mark without any response, and counts it', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('control');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const turn = await engine.startAssist(p, '擊之');
    expect(turn.kind).toBe('none');
    expect(turn.completed).toBe(true);
    const after = (await store.getParticipant(p.id))!;
    expect(after.completedTargets).toEqual(['TS1']);
    expect(store.interactions.filter((r) => r.actor === 'system')).toHaveLength(0);
  });

  it('records each target sentence exactly once, without gating anyone', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('control');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    for (const t of LEARNING_PASSAGE.targets) {
      const cur = (await store.getParticipant(p.id))!;
      const turn = await engine.startAssist(cur, t.text);
      expect(turn.lowerBoundMet).toBe(true);
    }
    const again = (await store.getParticipant(p.id))!;
    await engine.startAssist(again, LEARNING_PASSAGE.targets[0].text);
    const after = (await store.getParticipant(p.id))!;
    expect(after.completedTargets.length).toBe(4);
  });
});

describe('Task-A degraded fallback for free-highlight MCQ', () => {
  // A model that returns garbage: the engine regenerates once, then falls back
  // to the fixed generic MCQ. answerIndex on the fallback is null, so no pick can
  // end the ladder early.
  it('falls back to the fixed MCQ when the model output cannot be parsed', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const broken = new MockProvider(() => 'not json at all');
    const engine = new Engine(store, broken);
    const turn = await engine.startAssist(p, '平'); // free highlight, single character
    expect(turn.kind).toBe('choice');
    expect(turn.degraded).toBe(true);
    expect(turn.choice?.options).toEqual(FALLBACK_SOCRATIC_MCQ.options);
    expect(store.events.some((e) => e.event === 'llm_failure')).toBe(true);
  });

  // On the fallback rung, ANY pick with an accepted reason must descend — never end
  // the ladder early. This is the Task-A design decision that keeps the fallback
  // from smuggling a fake "correct answer" past the guessing guard.
  it('never ends the ladder early on a fallback rung, whatever the reader picks', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const broken = new MockProvider(() => 'not json at all');
    const engine = new Engine(store, broken);
    await startReady(engine, store, p, '帝甚不平');
    let cur = (await store.getParticipant(p.id))!;
    const t2 = await engine.reply(cur, { kind: 'choice', index: 0, reason: '因為前面說了以人乳飲豚' });
    expect(t2.kind).toBe('choice'); // dropped to layer 2, still not explanation
    cur = (await store.getParticipant(p.id))!;
    const t3 = await engine.reply(cur, { kind: 'choice', index: 0, reason: '因為前面說了以人乳飲豚' });
    expect(t3.kind).toBe('choice'); // dropped to layer 3
  });

  // Task-A option-level leak-check: a returned option that states a meaning triggers
  // regeneration; a second leak-through triggers the fallback.
  it('falls back when generated options themselves leak the meaning', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const leaky = new MockProvider(() =>
      JSON.stringify({
        type: 'question',
        strategy: 'C',
        text: '看一下這個字在句子什麼位置？',
        options: ['觀察一', '這裡「之」的意思是珊瑚樹', '觀察三'],
        answerIndex: 0,
      })
    );
    const engine = new Engine(store, leaky);
    const turn = await startReady(engine, store, p, '帝甚不平');
    expect(turn.degraded).toBe(true);
    expect(turn.choice?.options).toEqual(FALLBACK_SOCRATIC_MCQ.options);
  });

  // Task-A structural validation: <3 options, empty option, duplicate option, or
  // answerIndex out of range are all treated the same way as a leak.
  it('falls back when generated options are structurally invalid', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const bad = new MockProvider(() =>
      JSON.stringify({
        type: 'question',
        text: '看一下這個位置',
        options: ['a', 'a'],
        answerIndex: 9,
      })
    );
    const engine = new Engine(store, bad);
    const turn = await startReady(engine, store, p, '帝甚不平');
    expect(turn.degraded).toBe(true);
    expect(turn.choice?.options).toEqual(FALLBACK_SOCRATIC_MCQ.options);
  });

  // The socratic system prompt regeneration still catches a leaking QUESTION stem
  // (checked in unit.test.ts too). Here we just verify no leaking text reaches the reader.
  it('never lets a leaking question stem reach the reader', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const leaky = new MockProvider(() =>
      JSON.stringify({
        type: 'question',
        text: '「之」的意思是珊瑚樹，對不對？',
        options: FALLBACK_SOCRATIC_MCQ.options,
        answerIndex: 0,
      })
    );
    const engine = new Engine(store, leaky);
    const turn = await startReady(engine, store, p, '帝甚不平');
    expect(turn.text).not.toContain('意思是');
  });
});

describe('only the passage body can be highlighted', () => {
  it('rejects a selection that is not in the learning passage', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const failed = async (sel: string) => {
      try {
        await engine.startAssist(p, sel);
        return '';
      } catch (e) {
        return e instanceof Error ? e.message : 'error';
      }
    };
    expect(await failed('用滑鼠選取你看不懂的地方')).toBe('selection is not part of the passage');
    expect(await failed('對話紀錄')).toBe('selection is not part of the passage');
    expect(await failed('   ')).toBe('selection is not part of the passage');
  });
  it('accepts a selection that is in the passage even with stray whitespace', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const turn = await engine.startAssist(p, ' 擊之 ');
    expect(turn.kind).toBe('choice'); // 擊之 is inside TS1, which has pre-written options
  });
});

// Task-2 UNDO of the old snap: the reader's selection must be stored verbatim,
// whatever the length. classifyGranularity still produces a label for the log.
describe('selection is stored verbatim (task-2 undo of snap-to-sentence)', () => {
  it('stores a multi-character drag exactly as the reader made it', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '以鐵如意擊');
    const after = (await store.getParticipant(p.id))!;
    expect(after.active?.selection).toBe('以鐵如意擊');
    // still resolves the target because '以鐵如意擊' is a substring of TS1
    expect(after.active?.targetId).toBe('TS1');
    // granularity is a recorded label, not a rewrite
    expect(after.active?.granularity).toBe('sentence');
  });

  it('stores a whole clause exactly as the reader made it', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '愷既惋惜，又以為疾己之寶');
    const after = (await store.getParticipant(p.id))!;
    expect(after.active?.selection).toBe('愷既惋惜，又以為疾己之寶');
    expect(after.active?.granularity).toBe('sentence');
  });
});

describe('reload recovery', () => {
  it('rebuilds the open turn so a refreshed reader is not locked out', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '擊之');
    const cur = (await store.getParticipant(p.id))!;
    const pending = pendingTurnFor(cur, TARGET.layer1);
    expect(pending?.kind).toBe('choice');
    expect(pending?.choice?.options).toEqual(L1.options);
  });
  it('returns null when nothing is open', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('control');
    await store.createParticipant(p);
    expect(pendingTurnFor(p, '')).toBeNull();
  });

  // Task-A: a reload on a free-highlight MCQ must reconstruct the exact options the
  // reader was looking at, using the persisted activeChoice.
  it('rebuilds a free-highlight generated MCQ from active.activeChoice', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await startReady(engine, store, p, '帝甚不平');
    const cur = (await store.getParticipant(p.id))!;
    const pending = pendingTurnFor(cur, '這個字在句子什麼位置？');
    expect(pending?.kind).toBe('choice');
    expect(pending?.choice?.options).toEqual(FALLBACK_SOCRATIC_MCQ.options);
  });
});
