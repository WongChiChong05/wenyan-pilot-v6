import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { MemoryStore, makeParticipant } from './memoryStore';
import { assist } from '../src/lib/study';
import { buildStageView } from '../src/lib/view';
import { T5_PASSAGE } from '../src/content/passages';
import { TRANSLATION_ITEMS } from '../src/content/translation';
import type { Participant } from '../src/lib/types';

async function onPassage(arm: Participant['arm'], index: number) {
  const store = new MemoryStore();
  const p = makeParticipant(arm);
  const now = new Date().toISOString();
  p.stageEnteredTs.S2 = now;
  p.progress = { trainingIndex: index, passageEnteredTs: Array.from({ length: index + 1 }, () => now) };
  await store.createParticipant(p);
  const base = async () => {
    const active = (await store.getParticipant(p.id))!.active!;
    return { token: p.token, interactionId: active.interactionId, turnIndex: active.turnIndex };
  };
  return { store, p, base };
}

describe('v6 training passages', () => {
  it('works on the current passage only and tags every interaction row with it', async () => {
    const { store, p } = await onPassage('socratic', 1);
    await assert.rejects(assist(store, { token: p.token, action: 'highlight', selection: '以鐵如意擊之' }));
    const target = T5_PASSAGE.targets[0];
    const turn = await assist(store, { token: p.token, action: 'highlight', selection: target.text, start: T5_PASSAGE.text.indexOf(target.text) });
    assert.equal(turn.kind, 'question');
    assert.equal(turn.text, target.layer1);
    const rows = await store.listInteractions(p.id);
    assert.ok(rows.length > 0 && rows.every(r => r.passageId === 'T5'));
    assert.equal((await store.getParticipant(p.id))!.active?.passageId, 'T5');
  });

  it('force-accepts the third reason on a rung and records it (D7)', async () => {
    const { store, p, base } = await onPassage('socratic', 1);
    const target = T5_PASSAGE.targets[0];
    await assist(store, { token: p.token, action: 'highlight', selection: target.text, start: T5_PASSAGE.text.indexOf(target.text) });
    // 「嗯」 fails the rule layer (too short) every time.
    for (let i = 0; i < 2; i++) {
      await assist(store, { ...(await base()), action: 'answer', text: '王愷', reason: '嗯' });
      assert.equal((await store.getParticipant(p.id))!.active?.ladder.step, 'layer1');
    }
    await assist(store, { ...(await base()), action: 'answer', text: '王愷', reason: '嗯' });
    const active = (await store.getParticipant(p.id))!.active!;
    assert.equal(active.ladder.step, 'layer2');
    assert.equal(active.ladder.reasonInsufficient, true);
    const forced = (await store.listEvents()).filter(e => e.event === 'reason_forced');
    assert.equal(forced.length, 1);
    assert.equal(forced[0].payload.passageId, 'T5');
  });

  it('shows the current passage with its two required targets shaded, to control as well', async () => {
    const { p } = await onPassage('control', 2);
    const view = buildStageView(p);
    assert.equal(view.passage?.id, 'T6');
    assert.deepEqual(view.passage?.targets.map(t => t.id), ['TS7', 'TS8']);
    assert.deepEqual(view.training, { index: 2, total: 3 });
    assert.equal(view.lowerBound?.applies, false);
  });
});

describe('v6 translation view', () => {
  it('never sends the reference or rubric, and sends help only once opened', () => {
    const p = makeParticipant('direct');
    const now = new Date().toISOString();
    p.stage = 'S5a';
    p.progress = { trainingIndex: 2, passageEnteredTs: [], translation: { stage: 'S5a', index: 1, shownTs: now } };
    const view = buildStageView(p);
    const text = JSON.stringify(view);
    for (const item of TRANSLATION_ITEMS) {
      assert.ok(!text.includes(item.reference), `${item.id} reference leaked`);
      assert.ok(!text.includes(item.rubric.A), `${item.id} rubric leaked`);
    }
    assert.equal(view.translation?.sentence, '涉春爛敗，都督白之');
    assert.equal(view.translation?.hint, null);
    assert.equal(view.translation?.explanation, null);
    p.progress.translation!.hintTs = now;
    assert.ok(buildStageView(p).translation?.hint);
    assert.equal(buildStageView(p).translation?.explanation, null);
  });
  it('S5b shows the sentences first and the decode items only afterwards', () => {
    const p = makeParticipant('socratic');
    const now = new Date().toISOString();
    p.stage = 'S5b';
    p.progress = { trainingIndex: 2, passageEnteredTs: [], translation: { stage: 'S5b', index: 0, shownTs: now } };
    let view = buildStageView(p);
    assert.equal(view.passage?.id, 'J1'); assert.equal(view.items, undefined); assert.equal(view.translation?.allowHelp, false);
    p.progress.translation!.translationsDone = true;
    view = buildStageView(p);
    assert.equal(view.passage?.id, 'J9'); assert.equal(view.items?.length, 5);
    assert.ok(!JSON.stringify(view.items).includes('answerIndex'));
  });
});
