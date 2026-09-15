import { describe, expect, it } from 'vitest';
import { LEARNING_PASSAGE } from '../src/content/passages';
import { Engine } from '../src/lib/engine';
import { MockProvider } from '../src/lib/llm';
import { MemoryStore, makeParticipant } from './memoryStore';

/** A model that always answers, so any "explanation too early" is the engine's fault. */
const chatty = new MockProvider((system) => {
  if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
  if (system.includes('是否與參考答案一致')) return JSON.stringify({ correct: false });
  if (system.includes('解說者')) return JSON.stringify({ type: 'explain', text: '這裡是解釋。' });
  return JSON.stringify({ type: 'question', strategy: 'C', text: '這個字在句子什麼位置？' });
});

const TARGET = LEARNING_PASSAGE.targets[0]; // 以鐵如意擊之

describe('socratic arm end to end', () => {
  it('reaches the explanation only after two wrong answers, a choice and a reason', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);

    const t1 = await engine.startAssist(p, '擊之');
    expect(t1.kind).toBe('question');
    expect(t1.text).toBe(TARGET.layer1);

    let cur = (await store.getParticipant(p.id))!;
    const t2 = await engine.reply(cur, { kind: 'answer', text: '不知道' });
    expect(t2.kind).toBe('question');
    expect(t2.text).toBe(TARGET.layer2);

    cur = (await store.getParticipant(p.id))!;
    const t3 = await engine.reply(cur, { kind: 'answer', text: '還是不知道' });
    expect(t3.kind).toBe('choice');
    expect(t3.choice?.options).toEqual(TARGET.choice.options);

    cur = (await store.getParticipant(p.id))!;
    const t4 = await engine.reply(cur, { kind: 'choice', index: 0, reason: '感覺' });
    expect(t4.kind).toBe('reject'); // contentless reason

    cur = (await store.getParticipant(p.id))!;
    const t5 = await engine.reply(cur, { kind: 'choice', index: 0, reason: '因為前面是擊' });
    expect(t5.kind).toBe('explanation');
    expect(t5.text.startsWith(TARGET.explanation)).toBe(true);
    expect(t5.text).toContain(TARGET.choice.whyWrong[0]); // wrong option gets its reason

    cur = (await store.getParticipant(p.id))!;
    const t6 = await engine.reply(cur, { kind: 'read_done' });
    expect(t6.completed).toBe(true);
    const after = (await store.getParticipant(p.id))!;
    expect(after.completedTargets).toEqual(['TS1']);
    expect(after.active).toBeNull();
  });

  it('lets a correct, justified answer finish at layer 1', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '擊之');
    const cur = (await store.getParticipant(p.id))!;
    const turn = await engine.reply(cur, { kind: 'answer', text: '是代詞，因為前面是擊' });
    expect(turn.kind).toBe('explanation');
  });

  it('does not count 「真的不知道」 as the one-character answer 「的」', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '愷之甥也'); // TS2, whose acceptable answer includes 「的」
    let cur = (await store.getParticipant(p.id))!;
    let turn = await engine.reply(cur, { kind: 'answer', text: '真的不知道' });
    expect(turn.kind).toBe('question'); // moved to layer 2, not treated as correct
    cur = (await store.getParticipant(p.id))!;
    turn = await engine.reply(cur, { kind: 'answer', text: '真的不知道' });
    expect(turn.kind).toBe('choice');
  });

  it('probes once when the answer is right but unjustified', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '擊之');
    const cur = (await store.getParticipant(p.id))!;
    const turn = await engine.reply(cur, { kind: 'answer', text: '代詞' });
    expect(turn.text).toBe('你怎麼判斷的？');
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

  it('needs all four targets before the lower bound is met', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('control');
    await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    let met = false;
    for (const t of LEARNING_PASSAGE.targets) {
      const cur = (await store.getParticipant(p.id))!;
      const turn = await engine.startAssist(cur, t.text);
      met = turn.lowerBoundMet;
    }
    expect(met).toBe(true);
  });
});

describe('degraded path', () => {
  it('falls back to the fixed stem when the model fails on a free highlight', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const broken = new MockProvider(() => 'not json at all');
    const engine = new Engine(store, broken);
    const turn = await engine.startAssist(p, '帝甚不平');
    expect(turn.degraded).toBe(true);
    expect(turn.text).toBe('這個字在句子什麼位置？前後是什麼詞性？');
    expect(store.events.some((e) => e.event === 'llm_failure')).toBe(true);
  });

  it('never lets a leaking model output reach the reader', async () => {
    const store = new MemoryStore();
    const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const leaky = new MockProvider(() =>
      JSON.stringify({ type: 'question', text: '「之」的意思是珊瑚樹，對不對？' })
    );
    const engine = new Engine(store, leaky);
    const turn = await engine.startAssist(p, '帝甚不平');
    expect(turn.text).not.toContain('意思是');
  });
});
