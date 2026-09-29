import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { MemoryStore, makeParticipant } from './memoryStore';
import { assist } from '../src/lib/study';
import type { Participant } from '../src/lib/types';

// v5.12: a reader may cancel a mistaken highlight before answering; 看完了 frees the passage.
async function setup(arm: Participant['arm']) {
  const store = new MemoryStore();
  const p = makeParticipant(arm);
  p.stageEnteredTs.S2 = new Date().toISOString();
  await store.createParticipant(p);
  const base = async () => {
    const active = (await store.getParticipant(p.id))!.active!;
    return { token: p.token, interactionId: active.interactionId, turnIndex: active.turnIndex };
  };
  return { store, p, base };
}

describe('cancel a selection (v5.12)', () => {
  it('lets the direct arm cancel at the perspective step and select again', async () => {
    const { store, p, base } = await setup('direct');
    const first = await assist(store, { token: p.token, action: 'highlight', selection: '平' });
    assert.equal(first.kind, 'perspective');
    const out = await assist(store, { ...(await base()), action: 'cancel' });
    assert.equal(out.cancelled, true);
    assert.equal(out.completed, false);
    assert.equal((await store.getParticipant(p.id))!.active, null);
    const ev = (await store.listEvents()).find((e) => e.event === 'selection_cancelled')!;
    assert.equal(ev.payload.step, 'perspective');
    assert.equal(ev.payload.selection, '平');
    const again = await assist(store, { token: p.token, action: 'highlight', selection: '擎' });
    assert.equal(again.kind, 'perspective');
  });

  it('lets the socratic arm cancel at layer 1 before its first answer, without completing the target', async () => {
    const { store, p, base } = await setup('socratic');
    const first = await assist(store, { token: p.token, action: 'highlight', selection: '擊之' });
    assert.equal(first.kind, 'question');
    await assist(store, { ...(await base()), action: 'cancel' });
    const saved = (await store.getParticipant(p.id))!;
    assert.equal(saved.active, null);
    assert.deepEqual(saved.completedTargets, []);
  });

  it('refuses to cancel once the reader has submitted an answer, accepted or rejected', async () => {
    const accepted = await setup('socratic');
    await assist(accepted.store, { token: accepted.p.token, action: 'highlight', selection: '擊之' });
    await assist(accepted.store, { ...(await accepted.base()), action: 'answer', text: '錯誤判斷', reason: '因為原文寫擊之' });
    await assert.rejects(assist(accepted.store, { ...(await accepted.base()), action: 'cancel' }));

    const rejected = await setup('socratic');
    await assist(rejected.store, { token: rejected.p.token, action: 'highlight', selection: '擊之' });
    await assist(rejected.store, { ...(await rejected.base()), action: 'answer', text: '不確定', reason: '嗯' });
    assert.equal((await rejected.store.getParticipant(rejected.p.id))!.active?.ladder.step, 'layer1');
    await assert.rejects(assist(rejected.store, { ...(await rejected.base()), action: 'cancel' }));
  });

  it('refuses to cancel once an explanation is on screen', async () => {
    const { store, p, base } = await setup('direct');
    const first = await assist(store, { token: p.token, action: 'highlight', selection: '以鐵如意擊之，應手而碎' });
    assert.equal(first.kind, 'explanation');
    await assert.rejects(assist(store, { ...(await base()), action: 'cancel' }));
    const done = await assist(store, { ...(await base()), action: 'read_done' });
    assert.equal(done.completed, true);
    // 看完了 closes the interaction server-side, so the next highlight is accepted at once.
    assert.equal((await store.getParticipant(p.id))!.active, null);
    const next = await assist(store, { token: p.token, action: 'highlight', selection: '平' });
    assert.equal(next.kind, 'perspective');
  });

  it('has nothing to cancel in the control arm', async () => {
    const { store, p } = await setup('control');
    await assist(store, { token: p.token, action: 'highlight', selection: '平' });
    assert.equal((await store.getParticipant(p.id))!.active, null);
    await assert.rejects(assist(store, { token: p.token, interactionId: 'x', turnIndex: 0, action: 'cancel' }));
  });
});
