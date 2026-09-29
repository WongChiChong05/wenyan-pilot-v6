/**
 * Offline end-to-end rehearsal of the v6 flow, one participant per arm (plus six assigned
 * by the stratified randomiser), through the same study services the API routes call,
 * without a browser or the network. Verifies, in order:
 *   1. a participant is created at S1; the pretest is scored and the arm assigned
 *   2. S1b: three baseline sentences, with help requested on one of them
 *   3. S2: three training passages; the AI arms are gated on each passage's two required
 *      targets; the socratic ladder never shows the explanation before a reader turn; both
 *      AI arms receive the identical pre-written explanation
 *   4. S4 cognitive load, then S5b (four sentences, then the decode items), then S5a
 *   5. every participant reaches DONE with 10 translation rows
 *
 * Run: npm run smoke
 */
import { ITEMS_BY_STAGE } from '../src/content/items';
import { TRAINING_PASSAGES } from '../src/content/passages';
import { TRANSLATION_BY_STAGE } from '../src/content/translation';
import { advanceStage, assist, createSession, submitQuiz, submitScale, translate } from '../src/lib/study';
import type { Arm, Participant } from '../src/lib/types';
import { MemoryStore } from '../tests/memoryStore';

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

async function runOne(store: MemoryStore, forcedArm: Arm | null) {
  const { token } = await createSession(store, {
    consent: true, chineseMajor: false, readBefore: false, age: 21, gender: '不願透露',
    major: '資訊工程', email: `smoke-${Math.random().toString(36).slice(2)}@example.com`, aiUsage: '每週數次',
  });
  const get = async () => (await store.getParticipantByToken(token, 'main'))!;
  // S1 is timed; pretend the reader spent a realistic time on it.
  let p = await get();
  await store.updateParticipant(p.id, { stageEnteredTs: { ...p.stageEnteredTs, S1: ago(120) } });
  await submitQuiz(store, { token, stage: 'S1', answers: ITEMS_BY_STAGE.S1.map(i => ({ itemId: i.id, chosen: 0, rtMs: 8000 })) });
  p = await get();
  if (p.stage !== 'S1b') throw new Error(`expected S1b after the pretest, got ${p.stage}`);
  if (forcedArm) await store.updateParticipant(p.id, { arm: forcedArm });
  const arm = (await get()).arm;

  // S1b: help on the first sentence (after typing two characters), plain submits after.
  for (let i = 0; i < TRANSLATION_BY_STAGE.S1b.length; i++) {
    if (i === 0) {
      const help = await translate(store, { token, index: i, action: 'help', kind: 'hint', draft: '彭城' }) as { text?: string };
      if (!help.text) throw new Error('hint text missing');
    }
    await translate(store, { token, index: i, action: 'submit', text: '我的翻譯', firstInputMs: 3000 });
  }
  p = await get();
  if (p.stage !== 'S2') throw new Error(`expected S2 after S1b, got ${p.stage}`);

  // S2: three passages.
  for (let n = 0; n < TRAINING_PASSAGES.length; n++) {
    const passage = TRAINING_PASSAGES[n];
    if ((await get()).progress?.trainingIndex !== n) throw new Error(`expected training passage ${n}`);
    // An AI-arm reader cannot leave before the required targets are done.
    p = await get();
    await store.updateParticipant(p.id, { progress: { ...p.progress!, passageEnteredTs: p.progress!.passageEnteredTs.map((ts, i) => (i === n ? ago(200) : ts)) } });
    if (arm !== 'control') {
      let blocked = false;
      try { await advanceStage(store, { token, reason: 'user' }); } catch { blocked = true; }
      if (!blocked) throw new Error('AI arm left a passage before its required targets');
    }
    for (const t of passage.targets.filter(x => x.required)) {
      p = await get();
      let turn = await assist(store, { token, action: 'highlight', selection: t.text, start: passage.text.indexOf(t.text) }) as { kind: string; text: string; interactionId: string };
      if (arm === 'socratic') {
        for (let layer = 1; layer <= 3; layer++) {
          if (turn.kind !== 'question') throw new Error(`${t.id} layer ${layer}: expected an open question, got ${turn.kind}`);
          p = await get();
          turn = await assist(store, { token, interactionId: p.active!.interactionId, turnIndex: p.active!.turnIndex, action: 'answer', text: '我的判斷', reason: `原文寫「${t.text.slice(0, 3)}」` }) as typeof turn;
        }
      }
      if (arm !== 'control') {
        if (turn.kind !== 'explanation' || turn.text !== t.explanation) throw new Error(`${t.id}: explanation must be the pre-written one`);
        p = await get();
        await assist(store, { token, interactionId: p.active!.interactionId, turnIndex: p.active!.turnIndex, action: 'read_done' });
      }
    }
    await advanceStage(store, { token, reason: 'user' });
  }
  p = await get();
  if (p.stage !== 'S4') throw new Error(`expected S4 after training, got ${p.stage}`);
  const required = TRAINING_PASSAGES.flatMap(x => x.targets.filter(t => t.required).map(t => t.id));
  if (!required.every(id => p.completedTargets.includes(id))) throw new Error('required targets not recorded');

  await submitScale(store, { token, ratings: { intrinsic1: 4, intrinsic2: 4, germane1: 4, germane2: 4, germane3: 4, extraneous1: 4, extraneous2: 4, extraneous3: 4 } });
  // S5b: sentences first, then the decode items.
  p = await get();
  await store.updateParticipant(p.id, { stageEnteredTs: { ...p.stageEnteredTs, S5b: ago(300) } });
  let refusedEarly = false;
  try { await submitQuiz(store, { token, stage: 'S5b', answers: [] }); } catch { refusedEarly = true; }
  if (!refusedEarly) throw new Error('S5b decode items accepted before the translations');
  let helpRefused = false;
  try { await translate(store, { token, index: 0, action: 'help', kind: 'explanation', draft: '' }); } catch { helpRefused = true; }
  if (!helpRefused) throw new Error('S5b must offer no help');
  for (let i = 0; i < TRANSLATION_BY_STAGE.S5b.length; i++) {
    if (i === 1) await translate(store, { token, index: i, action: 'skip', draft: '' });
    else await translate(store, { token, index: i, action: 'submit', text: '翻譯', firstInputMs: 2500 });
  }
  await submitQuiz(store, { token, stage: 'S5b', answers: ITEMS_BY_STAGE.S5b.map(i => ({ itemId: i.id, chosen: 0, rtMs: 9000 })) });
  p = await get();
  if (p.stage !== 'S5a') throw new Error(`expected S5a, got ${p.stage}`);
  // S5a: explanation first on the first sentence without typing (not tried first).
  for (let i = 0; i < TRANSLATION_BY_STAGE.S5a.length; i++) {
    if (i === 0) await translate(store, { token, index: i, action: 'help', kind: 'explanation', draft: '' });
    await translate(store, { token, index: i, action: 'submit', text: '王丞相很節儉', firstInputMs: i === 0 ? 20000 : 3000 });
  }
  p = await get();
  if (p.stage !== 'DONE') throw new Error(`expected DONE, got ${p.stage}`);
  const rows = (await store.listTranslations()).filter(r => r.participantId === p.id);
  if (rows.length !== 10) throw new Error(`expected 10 translation rows, got ${rows.length}`);
  const s1b0 = rows.find(r => r.itemId === 'B11-1')!;
  const s5a0 = rows.find(r => r.itemId === 'J7-1')!;
  if (!s1b0.triedFirst || s1b0.firstHelpKind !== 'hint') throw new Error('B11-1 should be tried first, then hint');
  if (s5a0.triedFirst || s5a0.firstHelpKind !== 'explanation') throw new Error('J7-1 should be explanation before trying');
  return { arm, participant: p as Participant };
}

async function main() {
  process.env.STUDY_MODE = 'dry-run';
  const store = new MemoryStore();
  for (const arm of ['socratic', 'direct', 'control'] as Arm[]) await runOne(store, arm);
  for (let i = 0; i < 6; i++) await runOne(store, null);

  const counts = { socratic: 0, direct: 0, control: 0 } as Record<Arm, number>;
  for (const p of store.participants) counts[p.arm] += 1;
  console.log('participants:', store.participants.length);
  console.log('arm counts  :', counts);
  console.log('interactions:', store.interactions.length);
  console.log('translations:', store.translations.length);
  console.log('events      :', store.events.length);

  const leaking = store.interactions.filter(r => r.actor === 'system' && r.type === 'question' && r.leakFlags.length > 0);
  console.log('leaking socratic questions:', leaking.length);
  if (leaking.length > 0) throw new Error('a leaking question reached the reader');
  if (store.interactions.some(r => !r.passageId)) throw new Error('an interaction row has no passageId');

  // No explanation may appear before the reader has produced at least one turn.
  const byInteraction = new Map<string, typeof store.interactions>();
  for (const r of store.interactions) byInteraction.set(r.interactionId, [...(byInteraction.get(r.interactionId) ?? []), r]);
  for (const [id, rows] of byInteraction) {
    if (store.participants.find(p => p.id === rows[0].participantId)?.arm !== 'socratic') continue;
    const firstExplain = rows.findIndex(r => r.type === 'explain');
    const firstUser = rows.findIndex(r => r.actor === 'user');
    if (firstExplain !== -1 && (firstUser === -1 || firstUser > firstExplain)) throw new Error(`interaction ${id}: explanation before any reader turn`);
  }
  console.log('interactions checked:', byInteraction.size);
  console.log('SMOKE OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
