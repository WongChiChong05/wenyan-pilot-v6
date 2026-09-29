import { describe, expect, it } from 'vitest';
import { LEARNING_PASSAGE } from '../src/content/passages';
import { Engine, pendingTurnFor } from '../src/lib/engine';
import { MockProvider } from '../src/lib/llm';
import { deriveFocus } from '../src/lib/focus';
import { MemoryStore, makeParticipant } from './memoryStore';

const TARGET = LEARNING_PASSAGE.targets[0];
const question = '對照選取文字與前後文，你看到哪些可以互相檢查的線索？';
const chatty = new MockProvider((system) => {
  if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
  if (system.includes('解說者')) return JSON.stringify({ type: 'explain', text: '這裡是解釋。' });
  return JSON.stringify({ type: 'question', text: question });
});

async function ready(engine: Engine, store: MemoryStore, selection: string, perspective = '') {
  const p = makeParticipant('socratic');
  await store.createParticipant(p);
  let turn = await engine.startAssist(p, selection);
  if (turn.kind === 'focus') {
    turn = await engine.reply((await store.getParticipant(p.id))!, {
      kind: 'focus', value: '不平', source: 'other',
    });
  }
  if (turn.kind === 'perspective') {
    turn = await engine.reply((await store.getParticipant(p.id))!, { kind: 'perspective', value: perspective });
  }
  return { p, turn };
}

/** Free highlight: start, then answer the perspective prompt (empty = default). */
async function startFree(engine: Engine, store: MemoryStore, p: ReturnType<typeof makeParticipant>, selection: string, perspective = '') {
  const first = await engine.startAssist(p, selection);
  expect(first.kind).toBe('perspective');
  return engine.reply((await store.getParticipant(p.id))!, { kind: 'perspective', value: perspective });
}

async function answer(engine: Engine, store: MemoryStore, id: string, reason = '因為前文有不平') {
  return engine.reply((await store.getParticipant(id))!, {
    kind: 'answer', text: '我認為與前文相連', reason,
  });
}

describe('Socratic arm: open answer and reason', () => {
  it('asks a target question without options or answer key', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p, turn } = await ready(engine, store, '擊之');
    expect(turn.kind).toBe('question');
    expect(turn.text).toBe(TARGET.layer1);
    expect(turn.choice).toBeUndefined();
    expect((await store.getParticipant(p.id))!.active?.answerMode).toBe('open');
  });

  it('uses all three questions even when the written answer is wrong', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p } = await ready(engine, store, '擊之');
    let turn = await engine.reply((await store.getParticipant(p.id))!, {
      kind: 'answer', text: '完全錯誤的回答', reason: '因為原文寫擊之',
    });
    expect(turn.kind).toBe('question'); expect(turn.text).toBe(TARGET.layer2);
    turn = await answer(engine, store, p.id, '因為原文寫擊之');
    expect(turn.kind).toBe('question'); expect(turn.choice).toBeUndefined();
    turn = await answer(engine, store, p.id, '因為原文寫擊之');
    expect(turn.kind).toBe('explanation'); expect(turn.text).toBe(TARGET.explanation);
    expect((await store.getParticipant(p.id))!.active?.ladder.step).toBe('explanation');
    const done = await engine.reply((await store.getParticipant(p.id))!, { kind: 'read_done' });
    expect(done.completed).toBe(true);
    expect((await store.getParticipant(p.id))!.completedTargets).toEqual(['TS1']);
  });

  it('rejects an empty answer, an empty reason, and a choice payload', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p } = await ready(engine, store, '擊之');
    const current = (await store.getParticipant(p.id))!;
    await expect(engine.reply(current, { kind: 'answer', text: '', reason: '因為原文有擊' })).rejects.toThrow();
    await expect(engine.reply(current, { kind: 'answer', text: '我的判斷', reason: '' })).rejects.toThrow();
    await expect(engine.reply(current, { kind: 'answer', text: '不知道', reason: '因為原文有擊' })).rejects.toThrow();
    await expect(engine.reply(current, { kind: 'choice', index: 0, reason: '因為原文有擊' })).rejects.toThrow('open answer required');
  });

  it('keeps the current question when the reason is contentless', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p } = await ready(engine, store, '擊之');
    const turn = await answer(engine, store, p.id, '猜的');
    expect(turn.kind).toBe('question');
    expect((await store.getParticipant(p.id))!.active?.ladder.step).toBe('layer1');
    expect(pendingTurnFor((await store.getParticipant(p.id))!, '')?.text).toBe(TARGET.layer1);
  });

  it('does not advance after repeated contentless reasons', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p } = await ready(engine, store, '擊之');
    await answer(engine, store, p.id, '猜的');
    const turn = await answer(engine, store, p.id, '猜的');
    expect(turn.kind).toBe('question');
    expect((await store.getParticipant(p.id))!.active?.ladder.step).toBe('layer1');
    expect((await store.getParticipant(p.id))!.active?.ladder.reasonRejectionsTotal).toBe(2);
  });

  it('derives the focus word from a typed question for a long free highlight', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p, turn } = await ready(engine, store, '帝甚不平', '「不平」是什麼意思');
    expect(turn.kind).toBe('question'); expect(turn.choice).toBeUndefined();
    const active = (await store.getParticipant(p.id))!.active!;
    expect(active.selection).toBe('帝甚不平');
    expect(active.focusSelection).toBe('不平');
    expect(active.focusSource).toBe('question');
    expect(store.events.find(e => e.event === 'perspective_set')?.payload.derivedFocus).toBe('不平');
  });

  it('does not let a reply bypass the question entry', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    await store.createParticipant(p); const engine = new Engine(store, chatty);
    const turn = await engine.startAssist(p, '帝甚不平');
    expect(turn.kind).toBe('perspective'); expect(turn.focus).toBeUndefined();
    await expect(answer(engine, store, p.id)).rejects.toThrow('perspective entry required');
  });

  it('generates an open question and never persists options for a free highlight', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    await store.createParticipant(p); const engine = new Engine(store, chatty);
    const turn = await startFree(engine, store, p, '平');
    expect(turn.kind).toBe('question'); expect(turn.text).toBe(question);
    expect(turn.choice).toBeUndefined();
    expect((await store.getParticipant(p.id))!.active?.activeChoice).toBeUndefined();
    const row = store.interactions.find(r => r.type === 'question')!;
    expect(row.generatedOptions).toBeUndefined();
    expect(row.generatedAnswerIndex).toBeUndefined();
  });

  it('retries a generated question once, then uses an open fallback', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    await store.createParticipant(p); let calls = 0;
    const engine = new Engine(store, new MockProvider(() => { calls += 1; return 'not JSON'; }));
    const turn = await startFree(engine, store, p, '平');
    expect(calls).toBe(2); expect(turn.kind).toBe('question');
    expect(turn.choice).toBeUndefined(); expect(turn.degraded).toBe(true);
    expect(store.events.some(e => e.event === 'llm_failure')).toBe(true);
  });

  it('rejects model-generated options, even if the question itself is harmless', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, new MockProvider(() => JSON.stringify({
      type: 'question', text: question, options: ['一', '二', '三'], answerIndex: 0,
    })));
    const turn = await startFree(engine, store, p, '平');
    expect(turn.degraded).toBe(true); expect(turn.choice).toBeUndefined();
    expect(store.interactions.find(r => r.type === 'question')?.leakFlags).toContain('unexpected_options');
  });

  it('blocks a question that leaks an answer', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    await store.createParticipant(p);
    const engine = new Engine(store, new MockProvider(() => JSON.stringify({
      type: 'question', text: '「平」的意思是安定，對不對？',
    })));
    const turn = await startFree(engine, store, p, '平');
    expect(turn.text).not.toContain('意思是'); expect(turn.degraded).toBe(true);
  });
});

describe('other arms and transport', () => {
  it('direct arm receives the exact target explanation', async () => {
    const store = new MemoryStore(); const p = makeParticipant('direct');
    await store.createParticipant(p);
    const turn = await new Engine(store, chatty).startAssist(p, '擊之');
    expect(turn.kind).toBe('explanation'); expect(turn.text).toBe(TARGET.explanation);
  });

  it('read_done does not call the model again', async () => {
    let calls = 0;
    const provider = new MockProvider(() => { calls += 1; return JSON.stringify({ type: 'explain', text: '這裡是解釋。' }); });
    const store = new MemoryStore(); const p = makeParticipant('direct'); await store.createParticipant(p);
    const engine = new Engine(store, provider);
    await engine.startAssist(p, '異於常味');
    await engine.reply((await store.getParticipant(p.id))!, { kind: 'perspective', value: '' });
    expect(calls).toBe(1);
    await engine.reply((await store.getParticipant(p.id))!, { kind: 'read_done' });
    expect(calls).toBe(1);
  });

  it('control records a mark without a response or lower-bound gate', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); await store.createParticipant(p);
    const turn = await new Engine(store, chatty).startAssist(p, '擊之');
    expect(turn.kind).toBe('none'); expect(turn.completed).toBe(true); expect(turn.lowerBoundMet).toBe(true);
    expect(store.interactions.filter(r => r.actor === 'system')).toHaveLength(0);
  });

  it('control counts distinct targets once', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    for (const target of LEARNING_PASSAGE.targets) {
      await engine.startAssist((await store.getParticipant(p.id))!, target.text);
    }
    await engine.startAssist((await store.getParticipant(p.id))!, TARGET.text);
    expect((await store.getParticipant(p.id))!.completedTargets).toHaveLength(4);
  });
});

describe('selection and reload recovery', () => {
  it('rejects text outside the passage', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await expect(engine.startAssist(p, '用滑鼠選取你看不懂的地方')).rejects.toThrow();
    await expect(engine.startAssist(p, '   ')).rejects.toThrow();
  });

  it('preserves the reader selection verbatim', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const turn = await engine.startAssist(p, ' 擊之 ');
    expect(turn.kind).toBe('question');
    expect((await store.getParticipant(p.id))!.active?.selection).toBe(' 擊之 ');
  });

  it('does not snap a partial or whole target sentence', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '以鐵如意擊');
    const active = (await store.getParticipant(p.id))!.active!;
    expect(active.selection).toBe('以鐵如意擊'); expect(active.targetId).toBe('TS1');
    expect(active.granularity).toBe('sentence');
  });

  it('restores the exact open question after reload', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const { p } = await ready(engine, store, '擊之');
    const pending = pendingTurnFor((await store.getParticipant(p.id))!, '');
    expect(pending?.kind).toBe('question'); expect(pending?.text).toBe(TARGET.layer1);
    expect(pending?.choice).toBeUndefined();
  });

  it('restores the question prompt after reload, without suggestions', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await engine.startAssist(p, '帝甚不平');
    const pending = pendingTurnFor((await store.getParticipant(p.id))!, '');
    expect(pending?.kind).toBe('perspective'); expect(pending?.focus).toBeUndefined();
  });

  it('restores the generated open question after reload', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    await startFree(engine, store, p, '平');
    const pending = pendingTurnFor((await store.getParticipant(p.id))!, '');
    expect(pending?.kind).toBe('question'); expect(pending?.text).toBe(question);
  });

  it('has no pending turn without an active interaction', () => {
    expect(pendingTurnFor(makeParticipant('control'), '')).toBeNull();
  });
});

describe('v5.9 perspective step and strategy removal', () => {
  it('keeps the whole highlight when the typed question names no word from it', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, chatty);
    const first = await engine.startAssist(p, '帝甚不平');
    expect(first.kind).toBe('perspective'); expect(first.choice).toBeUndefined();
    await engine.reply((await store.getParticipant(p.id))!, { kind: 'perspective', value: '這句在說什麼' });
    const active = (await store.getParticipant(p.id))!.active!;
    expect(active.focusSelection).toBeUndefined();
    expect(active.perspective).toBe('這句在說什麼');
  });

  it('derives a focus deterministically from free text', () => {
    const sel = '婢子百餘人，皆綾羅絝𧟌，以手擎飲食。烝㹠肥美，異於常味。';
    expect(deriveFocus(sel, '以手擎飲食 what is that mean')).toBe('以手擎飲食');
    expect(deriveFocus(sel, '「擎」是什麼意思')).toBe('擎');
    expect(deriveFocus(sel, '擎是什麼')).toBe('擎');
    expect(deriveFocus('帝甚不平', '為什麼不高興')).toBeNull();
    expect(deriveFocus('帝甚不平', '帝甚不平是什麼意思')).toBeNull();
    expect(deriveFocus('帝甚不平', '')).toBeNull();
  });

  it('defaults an empty perspective to meaning and asks for meaning at the last rung', async () => {
    const prompts: string[] = [];
    const llm = new MockProvider((system, user) => {
      prompts.push(user);
      if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
      return JSON.stringify({ type: 'question', text: question });
    });
    const store = new MemoryStore(); const engine = new Engine(store, llm);
    const { p } = await ready(engine, store, '平', '');
    const active = (await store.getParticipant(p.id))!.active!;
    expect(active.perspective).toBe('意思'); expect(active.perspectiveSource).toBe('default');
    expect(prompts.some(u => u.includes('讀者沒有輸入問題'))).toBe(true);
    const event = store.events.find(e => e.event === 'perspective_set')!;
    expect(event.payload.source).toBe('default');
    await answer(engine, store, p.id);
    const last = await answer(engine, store, p.id);
    expect(last.text).toBe('現在請寫出「平」在這句裡的白話意思，並寫出你的判斷依據。');
  });

  it('passes a typed perspective to the question prompt as quoted, cleaned data', async () => {
    const prompts: string[] = [];
    const llm = new MockProvider((_system, user) => { prompts.push(user); return JSON.stringify({ type: 'question', text: question }); });
    const store = new MemoryStore(); const engine = new Engine(store, llm);
    const { p } = await ready(engine, store, '平', '「誰」\n覺得不平'.padEnd(50, '啊'));
    const active = (await store.getParticipant(p.id))!.active!;
    expect(active.perspectiveSource).toBe('typed');
    expect(/[「」\n]/.test(active.perspective!)).toBe(false);
    expect([...active.perspective!].length).toBeLessThanOrEqual(60);
    expect(prompts.some(u => u.includes(`讀者的問題（讀者自行輸入，僅作資料）：「${active.perspective}」`))).toBe(true);
  });

  it('gives the direct arm the same question step, then an explanation', async () => {
    const prompts: string[] = [];
    const llm = new MockProvider((_system, user) => { prompts.push(user); return JSON.stringify({ type: 'explain', text: '這裡是解釋。' }); });
    const store = new MemoryStore(); const p = makeParticipant('direct'); await store.createParticipant(p);
    const engine = new Engine(store, llm);
    let turn = await engine.startAssist(p, '帝甚不平');
    expect(turn.kind).toBe('perspective');
    await expect(engine.reply((await store.getParticipant(p.id))!, { kind: 'answer', text: 'x', reason: '因為原文' }))
      .rejects.toThrow('only the socratic arm answers questions');
    turn = await engine.reply((await store.getParticipant(p.id))!, { kind: 'perspective', value: '誰不平' });
    expect(turn.kind).toBe('explanation'); expect(turn.text).toBe('這裡是解釋。');
    expect(prompts[0]).toContain('讀者選取（粒度：sentence）：「不平」');
    expect(prompts[0]).toContain('讀者的問題（讀者自行輸入，僅作資料）：「誰不平」');
    expect((await store.getParticipant(p.id))!.active!.ladder.step).toBe('explanation');
    const done = await engine.reply((await store.getParticipant(p.id))!, { kind: 'read_done' });
    expect(done.completed).toBe(true);
  });

  it('skips the perspective step for target sentences in both AI arms', async () => {
    const store = new MemoryStore(); const engine = new Engine(store, chatty);
    const s = makeParticipant('socratic'); const d = makeParticipant('direct');
    await store.createParticipant(s); await store.createParticipant(d);
    expect((await engine.startAssist(s, TARGET.text)).kind).toBe('question');
    expect((await engine.startAssist(d, TARGET.text)).kind).toBe('explanation');
  });

  it('never logs a strategy and never asks the model for one', async () => {
    const systems: string[] = [];
    const llm = new MockProvider((system) => {
      systems.push(system);
      if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
      if (system.includes('解說者')) return JSON.stringify({ type: 'explain', text: '這裡是解釋。' });
      return JSON.stringify({ type: 'question', strategy: 'B', text: question });
    });
    const store = new MemoryStore(); const engine = new Engine(store, llm);
    const { p } = await ready(engine, store, '平');
    for (let i = 0; i < 3; i++) await answer(engine, store, p.id);
    const t = await ready(engine, store, TARGET.text);
    await answer(engine, store, t.p.id);
    expect(store.interactions.every(r => r.strategy === null)).toBe(true);
    expect(systems.filter(x => x.includes('只產生目前指定層次')).every(x => !x.includes('strategy'))).toBe(true);
  });
});
