import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore, makeParticipant } from './memoryStore';
import { advanceStage, assist, recordEvent, submitQuiz, submitScale, createSession, translate } from '../src/lib/study';
import { api, bodyOf } from '../src/lib/api';
import { CONFIG } from '../src/lib/config';

describe('server-side study boundary', () => {
  it('rejects fake time and fake timeout and cannot skip a quiz through advance', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control');
    p.stageEnteredTs.S2 = new Date().toISOString(); await store.createParticipant(p);
    for (const reason of ['user', 'timeout']) await assert.rejects(advanceStage(store, { token: p.token, reason, elapsedSeconds: 9999 }));
    await store.updateParticipant(p.id, { stage: 'S1' });
    await assert.rejects(advanceStage(store, { token: p.token, reason: 'user', elapsedSeconds: 9999 }));
  });
  it('v6: records the first-help snapshot, refuses stale sentences and gives S5b no help', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); p.stage = 'S1b';
    const now = new Date().toISOString();
    p.stageEnteredTs.S1b = now; p.progress = { trainingIndex: 0, passageEnteredTs: [], translation: { stage: 'S1b', index: 0, shownTs: now } };
    await store.createParticipant(p);
    await assert.rejects(translate(store, { token: p.token, index: 1, action: 'submit', text: '譯文' }));
    const hint = await translate(store, { token: p.token, index: 0, action: 'help', kind: 'hint', draft: '彭' }) as { text: string };
    assert.ok(hint.text.length > 0);
    await translate(store, { token: p.token, index: 0, action: 'help', kind: 'explanation', draft: '彭城王有' });
    await translate(store, { token: p.token, index: 0, action: 'submit', text: '彭城王有快牛', firstInputMs: 1200 });
    const row = (await store.listTranslations())[0];
    // One Han character before the first help press: not tried first, whatever came later.
    assert.equal(row.triedFirst, false); assert.equal(row.firstHelpKind, 'hint'); assert.equal(row.draftAtFirstHelp, '彭');
    assert.ok(row.hintMs !== null && row.explanationMs !== null); assert.equal(row.firstInputMs, 1200);
    await translate(store, { token: p.token, index: 1, action: 'skip', draft: '王太尉' });
    const skipped = (await store.listTranslations())[1];
    assert.equal(skipped.skipped, true); assert.equal(skipped.firstHelpKind, 'skip'); assert.equal(skipped.triedFirst, true);
    await translate(store, { token: p.token, index: 2, action: 'submit', text: '若要吃' });
    assert.equal((await store.getParticipant(p.id))!.stage, 'S2');
    const noHelp = makeParticipant('direct'); noHelp.stage = 'S5b';
    noHelp.stageEnteredTs.S5b = now; noHelp.progress = { trainingIndex: 2, passageEnteredTs: [], translation: { stage: 'S5b', index: 0, shownTs: now } };
    await store.createParticipant(noHelp);
    await assert.rejects(translate(store, { token: noHelp.token, index: 0, action: 'help', kind: 'hint', draft: '' }));
    await assert.rejects(submitQuiz(store, { token: noHelp.token, stage: 'S5b', answers: [] }));
  });
  it('v6: a translation timeout keeps what was typed and marks unseen sentences', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic'); p.stage = 'S5a';
    const then = new Date(Date.now() - 601000).toISOString();
    p.stageEnteredTs.S5a = then; p.progress = { trainingIndex: 2, passageEnteredTs: [], translation: { stage: 'S5a', index: 0, shownTs: then } };
    await store.createParticipant(p);
    await translate(store, { token: p.token, action: 'timeout', draft: '王丞相節儉' });
    const rows = await store.listTranslations();
    assert.equal(rows.length, 3); assert.equal(rows[0].text, '王丞相節儉'); assert.equal(rows[0].triedFirst, true);
    assert.ok(rows.every(r => r.timedOut)); assert.equal(rows[2].triedFirst, false);
    const after = (await store.getParticipant(p.id))!;
    assert.equal(after.stage, 'DONE'); assert.ok(after.excludeFlags.includes('timeout_S5a'));
  });
  it('requires demographics and stores email outside participant research data', async () => {
    const missing = { consent: true, chineseMajor: false, readBefore: false, aiUsage: '每週數次' };
    await assert.rejects(createSession(new MemoryStore(), missing));
    const store = new MemoryStore();
    const result = await createSession(store, {
      ...missing, age: 20, gender: '不願透露', major: '資訊工程', email: 'Student@Example.com', grade: '二年級',
    });
    assert.ok(result.token);
    const p = (await store.listParticipants())[0];
    assert.equal(p.demographics.age, 20);
    assert.equal(p.demographics.gender, '不願透露');
    assert.equal(p.demographics.major, '資訊工程');
    assert.equal(p.demographics.email, undefined);
    assert.equal((await store.listContacts())[0].email, 'student@example.com');
  });
  it('keeps voluntary nonusers when leaving S2, one training passage at a time', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control');
    const early = new Date(Date.now() - 181000).toISOString();
    p.stageEnteredTs.S2 = early; p.progress = { trainingIndex: 0, passageEnteredTs: [early] };
    await store.createParticipant(p);
    for (let i = 0; i < 3; i++) {
      const cur = (await store.getParticipant(p.id))!;
      assert.equal(cur.progress?.trainingIndex, i);
      if (i > 0) await store.updateParticipant(p.id, { progress: { ...cur.progress!, passageEnteredTs: cur.progress!.passageEnteredTs.map((ts, j) => (j === i ? early : ts)) } });
      await advanceStage(store, { token: p.token, reason: 'user' });
    }
    const after = (await store.getParticipant(p.id))!;
    assert.equal(after.stage, 'S4'); assert.ok(after.excludeFlags.includes('no_assist_used'));
    assert.ok(after.excludeFlags.includes('targets_incomplete'));
    assert.ok(after.excludeFlags.every(flag => CONFIG.exclusion.descriptiveOnly.includes(flag)));
    const leaves = (await store.listEvents()).filter(e => e.event === 'passage_leave');
    assert.deepEqual(leaves.map(e => e.payload.passageId), ['T2', 'T5', 'T6']);
  });
  it('v6: an AI-arm reader cannot leave a passage before its two required targets', async () => {
    const store = new MemoryStore(); const p = makeParticipant('direct');
    const early = new Date(Date.now() - 181000).toISOString();
    p.stageEnteredTs.S2 = early; p.progress = { trainingIndex: 0, passageEnteredTs: [early] };
    await store.createParticipant(p);
    await assert.rejects(advanceStage(store, { token: p.token, reason: 'user' }));
    await store.updateParticipant(p.id, { completedTargets: ['TS1', 'TS4'] });
    const out = await advanceStage(store, { token: p.token, reason: 'user' }) as { trainingIndex?: number };
    assert.equal(out.trainingIndex, 1);
  });
  it('rejects forged audit events and malformed requests', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); await store.createParticipant(p);
    await assert.rejects(recordEvent(store, { token: p.token, event: 'read_done_click' }));
    const response = await api(() => bodyOf(new Request('http://localhost/api/session', { method: 'POST', body: '{broken' })));
    assert.equal(response.status, 400); assert.equal((await store.listEvents()).length, 0);
  });
  it('requires all eight 1-7 cognitive-load ratings and stores three subscale means at S4', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); p.stage = 'S4';
    p.stageEnteredTs.S4 = new Date().toISOString();
    await store.createParticipant(p);
    const ratings = {
      intrinsic1: 6, intrinsic2: 4,
      germane1: 7, germane2: 6, germane3: 5,
      extraneous1: 3, extraneous2: 2, extraneous3: 4,
    };
    await assert.rejects(submitScale(store, { token: p.token, ratings: { ...ratings, intrinsic1: 0 } }));
    await assert.rejects(submitScale(store, { token: p.token, ratings: { ...ratings, extraneous3: 8 } }));
    await assert.rejects(submitScale(store, { token: p.token, ratings: { intrinsic1: 4 } }));
    await submitScale(store, { token: p.token, ratings });
    const row = (await store.listScales())[0];
    assert.equal(row.intrinsicMean, 5);
    assert.equal(row.germaneMean, 6);
    assert.equal(row.extraneousMean, 3);
    assert.equal(row.mentalEffort, undefined);
    assert.equal((await store.getParticipant(p.id))?.stage, 'S5b');
  });
  it('accepts the browser-facing host but rejects a foreign origin', async () => {
    const request = (origin: string) => new Request('http://localhost:3001/api/session', {
      method: 'POST', headers: { host: '127.0.0.1:3001', origin }, body: '{}',
    });
    assert.deepEqual(await bodyOf(request('http://127.0.0.1:3001')), {});
    await assert.rejects(bodyOf(request('https://foreign.example')));
  });
  it('rejects early completion, invalid options, stale turns and open-text bypass', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    p.stageEnteredTs.S2 = new Date().toISOString(); await store.createParticipant(p);
    const turn = await assist(store, { token: p.token, action: 'highlight', selection: '擊之' });
    const active = (await store.getParticipant(p.id))!.active!;
    const base = { token: p.token, interactionId: turn.interactionId, turnIndex: active.turnIndex };
    await assert.rejects(assist(store, { ...base, action: 'read_done' }));
    await assert.rejects(assist(store, { ...base, action: 'answer', text: '珊瑚樹因為前面寫擊' }));
    await assert.rejects(assist(store, { ...base, action: 'choice', index: 99, reason: '因為前面寫擊' }));
    await assert.rejects(assist(store, { ...base, turnIndex: -1, action: 'choice', index: 0, reason: '因為前面寫擊' }));
    assert.equal((await store.listInteractions()).length, 1);
  });
  it('accepts a written answer only with a reason and never returns S2 options', async () => {
    const store = new MemoryStore(); const p = makeParticipant('socratic');
    p.stageEnteredTs.S2 = new Date().toISOString(); await store.createParticipant(p);
    const first = await assist(store, { token: p.token, action: 'highlight', selection: '擊之' });
    assert.equal(first.kind, 'question'); assert.equal(first.choice, undefined);
    const active = (await store.getParticipant(p.id))!.active!;
    const base = { token: p.token, interactionId: first.interactionId, turnIndex: active.turnIndex };
    await assert.rejects(assist(store, { ...base, action: 'answer', text: '錯誤判斷' }));
    await assert.rejects(assist(store, { ...base, action: 'choice', index: 0, reason: '因為原文寫擊之' }));
    const second = await assist(store, { ...base, action: 'answer', text: '錯誤判斷', reason: '因為原文寫擊之' });
    assert.equal(second.kind, 'question'); assert.equal(second.choice, undefined);
    assert.equal((await store.getParticipant(p.id))!.active?.ladder.step, 'layer2');
  });
  it('lets the direct arm type a perspective but not answer, and accepts an empty perspective', async () => {
    const store = new MemoryStore(); const p = makeParticipant('direct');
    p.stageEnteredTs.S2 = new Date().toISOString(); await store.createParticipant(p);
    const first = await assist(store, { token: p.token, action: 'highlight', selection: '平' });
    assert.equal(first.kind, 'perspective');
    const active = (await store.getParticipant(p.id))!.active!;
    const base = { token: p.token, interactionId: first.interactionId, turnIndex: active.turnIndex };
    await assert.rejects(assist(store, { ...base, action: 'answer', text: '判斷', reason: '因為原文' }));
    await assert.rejects(assist(store, { ...base, action: 'perspective', value: 'x'.repeat(201) }));
    const second = await assist(store, { ...base, action: 'perspective', value: '' });
    assert.equal(second.kind, 'explanation');
    assert.equal((await store.getParticipant(p.id))!.active?.perspectiveSource, 'default');
  });
  it('marks timeout while retaining answers and the participant', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); p.stage = 'S1';
    p.stageEnteredTs.S1 = new Date(Date.now() - 400000).toISOString(); await store.createParticipant(p);
    await store.transaction(tx => submitQuiz(tx, { token: p.token, stage: 'S1', reason: 'timeout', answers: [{ itemId: 'S1-01', chosen: 0, rtMs: 4000 }] }), { assignment: true });
    assert.equal((await store.listResponses())[0].chosen, 0);
    assert.ok((await store.getParticipant(p.id))?.excludeFlags.includes('timeout_S1'));
  });
  it('does not collect unsigned content even when collection mode is configured', async () => {
    const old = process.env.STUDY_MODE; process.env.STUDY_MODE = 'collection';
    try { await assert.rejects(createSession(new MemoryStore(), { consent: true, chineseMajor: false, readBefore: false })); }
    finally { if (old === undefined) delete process.env.STUDY_MODE; else process.env.STUDY_MODE = old; }
  });
});
