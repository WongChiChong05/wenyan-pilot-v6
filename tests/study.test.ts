import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore, makeParticipant } from './memoryStore';
import { advanceStage, assist, readState, recordEvent, submitQuiz, submitScale, createSession } from '../src/lib/study';
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
  it('enforces S6 token, window, and start on submission as well as viewing', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); p.stage = 'S6';
    p.stageEnteredTs.S6 = new Date().toISOString(); await store.createParticipant(p);
    await store.createContact({ participantId: p.id, email: 'reader@example.com', createdTs: new Date().toISOString() });
    const submission = { token: p.delayedToken, delayed: true, stage: 'S6', answers: [] };
    await assert.rejects(submitQuiz(store, submission));
    await store.updateParticipant(p.id, { stageEnteredTs: { S6: new Date(Date.now() - 25 * 3600000).toISOString() } });
    await assert.rejects(submitQuiz(store, { ...submission, token: p.token, delayed: false }));
    await assert.rejects(submitQuiz(store, submission));
    const view = await store.transaction(tx => readState(tx, p.delayedToken, true));
    assert.equal(view.stage, 'S6'); assert.equal(view.seconds.max, CONFIG.stageSeconds.S6.max);
    await submitQuiz(store, submission);
    assert.equal((await store.getParticipant(p.id))?.stage, 'DONE');
    assert.equal((await store.listContacts())[0].email, null);
    assert.ok((await store.listContacts())[0].emailDeletedTs);
    assert.equal((await readState(store, p.delayedToken, true)).stage, 'DONE');
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
  it('refuses expired delayed submissions without deleting the participant', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control'); p.stage = 'S6';
    p.stageEnteredTs.S6 = new Date(Date.now() - 49 * 3600000).toISOString(); p.delayedStartedTs = new Date().toISOString();
    await store.createParticipant(p);
    await assert.rejects(submitQuiz(store, { token: p.delayedToken, delayed: true, stage: 'S6', answers: [] }));
    assert.equal((await store.listParticipants()).length, 1);
  });
  it('keeps voluntary nonusers when leaving S2', async () => {
    const store = new MemoryStore(); const p = makeParticipant('control');
    p.stageEnteredTs.S2 = new Date(Date.now() - 181000).toISOString(); await store.createParticipant(p);
    await advanceStage(store, { token: p.token, reason: 'user' });
    const after = (await store.getParticipant(p.id))!;
    assert.equal(after.stage, 'S4'); assert.ok(after.excludeFlags.includes('no_assist_used'));
    assert.ok(after.excludeFlags.every(flag => CONFIG.exclusion.descriptiveOnly.includes(flag)));
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
    assert.equal((await store.getParticipant(p.id))?.stage, 'S3');
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
