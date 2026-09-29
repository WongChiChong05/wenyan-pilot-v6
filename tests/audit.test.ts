import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { LEARNING_PASSAGE } from '../src/content/passages';
import { Engine } from '../src/lib/engine';
import { MockProvider } from '../src/lib/llm';
import { MemoryStore, makeParticipant } from './memoryStore';

describe('prompt execution and audit regressions', () => {
  it('uses the identical full explanation for both arms at every target', async () => {
    const noGeneration = new MockProvider(() => { throw new Error('fixed content should not generate'); });
    for (const target of LEARNING_PASSAGE.targets) {
      const store = new MemoryStore();
      const direct = makeParticipant('direct'); const socratic = makeParticipant('socratic');
      await store.createParticipant(direct); await store.createParticipant(socratic);
      const engine = new Engine(store, noGeneration);
      const explanation = await engine.startAssist(direct, target.text);
      let shown = await engine.startAssist(socratic, target.text);
      for (let layer = 0; layer < 3; layer++) {
        shown = await engine.reply((await store.getParticipant(socratic.id))!, {
          kind: 'answer', text: '我的判斷', reason: '因為前後線索一致',
        });
      }
      assert.equal(explanation.text, target.explanation);
      assert.equal(shown.text, explanation.text);
      assert.equal((await store.listInteractions(socratic.id)).map(r => r.turnIndex).join(','), '1,2,3,4,5,6,7');
    }
  });
  it('regenerates an invalid direct output and retains both attempts', async () => {
    const store = new MemoryStore(); const p = makeParticipant('direct'); await store.createParticipant(p);
    let calls = 0;
    const userPrompts: string[] = [];
    const llm = new MockProvider((_system, user) => {
      userPrompts.push(user);
      return JSON.stringify({ text: ++calls === 1 ? '長'.repeat(61) : '這裡是簡短說明。' });
    });
    const engine = new Engine(store, llm);
    await engine.startAssist(p, '帝甚不平');
    const turn = await engine.reply((await store.getParticipant(p.id))!, { kind: 'perspective', value: '' });
    assert.equal(calls, 2); assert.equal(turn.text, '這裡是簡短說明。');
    assert.doesNotMatch(userPrompts[0], /上一次回覆未通過/);
    assert.match(userPrompts[1], /45 個字內/);
    const row = (await store.listInteractions()).find(r => r.type === 'explain')!;
    assert.equal(JSON.parse(row.rawResponse!).length, 2); assert.ok(row.leakFlags.includes('too_long'));
  });
  it('records malformed reason-model output and keeps a new open answer on its rung', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); await store.createParticipant(p);
    const engine = new Engine(store, new MockProvider(() => 'not JSON'));
    const target = LEARNING_PASSAGE.targets[0];
    await engine.startAssist(p, target.text);
    const turn = await engine.reply((await store.getParticipant(p.id))!, { kind: 'answer', text: '我的判斷', reason: 'abcd' });
    const audit = (await store.listEvents()).find(e => e.event === 'reason_judgement')!;
    assert.equal(audit.payload.source, 'model'); assert.equal(audit.payload.modelFailed, true);
    assert.equal(audit.payload.failOpen, false);
    assert.equal(audit.payload.accepted, false);
    assert.equal(turn.kind, 'question');
    assert.equal((await store.getParticipant(p.id))!.active?.ladder.step, 'layer1');
    assert.equal(audit.payload.rawResponse, 'not JSON');
  });
  it('preserves the received selection including surrounding whitespace', async () => {
    const store = new MemoryStore(); const p = makeParticipant('direct'); await store.createParticipant(p);
    await new Engine(store, new MockProvider(() => '')).startAssist(p, ' 擊之 ');
    assert.equal((await store.getParticipant(p.id))!.active!.selection, ' 擊之 ');
    assert.equal((await store.listInteractions())[0].highlightText, ' 擊之 ');
  });
});
