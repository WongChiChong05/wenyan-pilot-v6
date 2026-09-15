/**
 * Offline end-to-end rehearsal of one participant per arm, without a browser and
 * without the network. Verifies, in order:
 *   1. a participant is created and starts at S1
 *   2. the pretest is scored on the server and the arm is assigned by stratum
 *   3. S2 lower bound: four target sentences must be completed
 *   4. the socratic ladder never shows the explanation before the reader has tried
 *   5. the direct arm receives the identical explanation text
 *   6. the run reaches the delayed test
 *
 * Run: npm run smoke
 */
import { randomUUID } from 'node:crypto';
import { ITEMS_BY_STAGE } from '../src/content/items';
import { LEARNING_PASSAGE } from '../src/content/passages';
import { Engine, nextStage } from '../src/lib/engine';
import { MockProvider } from '../src/lib/llm';
import { assignArm, stratumOf } from '../src/lib/randomize';
import { scoreQuiz } from '../src/lib/scoring';
import type { Arm, Participant } from '../src/lib/types';
import { MemoryStore } from '../tests/memoryStore';

const llm = new MockProvider((system) => {
  if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
  if (system.includes('是否與參考答案一致')) return JSON.stringify({ correct: false });
  if (system.includes('解說者')) return JSON.stringify({ type: 'explain', text: '這裡是解釋。' });
  return JSON.stringify({ type: 'question', strategy: 'C', text: '這個字在句子什麼位置？' });
});

function blank(arm: Arm): Participant {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    token: randomUUID(),
    delayedToken: randomUUID(),
    arm,
    stage: 'S1',
    stratum: null,
    pretestScore: null,
    consentTs: now,
    demographics: {},
    excludeFlags: [],
    stageEnteredTs: { S0: now, S1: now },
    completedTargets: [],
    active: null,
  };
}

async function runOne(store: MemoryStore, forcedArm: Arm | null) {
  const p = blank('control');
  await store.createParticipant(p);

  // S1: everyone answers the first option; the server scores it.
  const scored = scoreQuiz(
    ITEMS_BY_STAGE.S1,
    ITEMS_BY_STAGE.S1.map((i) => ({ itemId: i.id, chosen: 0, rtMs: 8000 }))
  );
  const stratum = stratumOf(scored.total, { low: 3, high: 6 });
  const counts = { socratic: 0, direct: 0, control: 0 } as Record<Arm, number>;
  for (const other of store.participants) if (other.stratum === stratum) counts[other.arm] += 1;
  const arm = forcedArm ?? assignArm(counts);
  await store.updateParticipant(p.id, {
    pretestScore: scored.total,
    stratum,
    arm,
    stage: 'S2',
  });

  // S2
  const engine = new Engine(store, llm);
  for (const t of LEARNING_PASSAGE.targets) {
    let cur = (await store.getParticipant(p.id))!;
    let turn = await engine.startAssist(cur, t.text);
    if (arm === 'socratic') {
      if (turn.kind !== 'question') throw new Error('socratic arm must start with a question');
      cur = (await store.getParticipant(p.id))!;
      turn = await engine.reply(cur, { kind: 'answer', text: '不知道' });
      cur = (await store.getParticipant(p.id))!;
      turn = await engine.reply(cur, { kind: 'answer', text: '真的不知道' });
      if (turn.kind !== 'choice') throw new Error('third layer must be the multiple choice');
      cur = (await store.getParticipant(p.id))!;
      turn = await engine.reply(cur, { kind: 'choice', index: 0, reason: '不知道' });
      if (turn.kind !== 'reject') throw new Error('contentless reason must be rejected');
      cur = (await store.getParticipant(p.id))!;
      turn = await engine.reply(cur, { kind: 'choice', index: 0, reason: `因為看到${t.text.slice(0, 2)}` });
      if (turn.kind !== 'explanation') throw new Error('explanation should appear after a reason');
      if (turn.text.slice(0, 10) !== t.explanation.slice(0, 10)) {
        throw new Error('socratic explanation must be the pre-written one');
      }
    }
    if (arm === 'direct') {
      if (turn.kind !== 'explanation') throw new Error('direct arm explains immediately');
      if (turn.text !== t.explanation) throw new Error('direct explanation must be the pre-written one');
    }
    if (arm !== 'control') {
      const cur2 = (await store.getParticipant(p.id))!;
      await engine.reply(cur2, { kind: 'read_done' });
    }
  }

  const afterS2 = (await store.getParticipant(p.id))!;
  if (afterS2.completedTargets.length !== 4) throw new Error('lower bound not recorded');

  // S3 -> S4 -> S5 -> S6
  let stage = afterS2.stage;
  for (const s of ['S3', 'S5'] as const) {
    const items = ITEMS_BY_STAGE[s];
    const out = scoreQuiz(items, items.map((i) => ({ itemId: i.id, chosen: 0, rtMs: 9000 })));
    if (out.rows.length !== items.length) throw new Error('scoring lost rows');
  }
  stage = 'S6';
  await store.updateParticipant(p.id, { stage });
  return { arm, pretest: scored.total, stratum };
}

async function main() {
  const store = new MemoryStore();
  const results = [];
  for (const arm of ['socratic', 'direct', 'control'] as Arm[]) {
    results.push(await runOne(store, arm));
  }
  for (let i = 0; i < 6; i++) results.push(await runOne(store, null));

  const counts = { socratic: 0, direct: 0, control: 0 } as Record<Arm, number>;
  for (const p of store.participants) counts[p.arm] += 1;

  console.log('participants:', store.participants.length);
  console.log('arm counts  :', counts);
  console.log('interactions:', store.interactions.length);
  console.log('events      :', store.events.length);
  console.log('stage after run:', nextStage('S5'));
  const leaking = store.interactions.filter(
    (r) => r.actor === 'system' && r.type === 'question' && r.leakFlags.length > 0
  );
  console.log('leaking socratic questions:', leaking.length);
  if (leaking.length > 0) throw new Error('a leaking question reached the reader');

  // No explanation may appear before the reader has produced at least one turn.
  const byInteraction = new Map<string, typeof store.interactions>();
  for (const r of store.interactions) {
    const list = byInteraction.get(r.interactionId) ?? [];
    list.push(r);
    byInteraction.set(r.interactionId, list);
  }
  for (const [id, rows] of byInteraction) {
    const armOf = store.participants.find((p) => p.id === rows[0].participantId)?.arm;
    if (armOf !== 'socratic') continue;
    const firstExplain = rows.findIndex((r) => r.type === 'explain');
    const firstUser = rows.findIndex((r) => r.actor === 'user');
    if (firstExplain !== -1 && (firstUser === -1 || firstUser > firstExplain)) {
      throw new Error(`interaction ${id}: explanation appeared before any reader turn`);
    }
  }
  console.log('socratic interactions checked:', [...byInteraction.values()].length);
  console.log('SMOKE OK');
}

void main();
