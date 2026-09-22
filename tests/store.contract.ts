import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/lib/store';
import { makeParticipant } from './memoryStore';
import { submitQuiz } from '../src/lib/study';
import { toCsv } from '../src/lib/export';

export function storeContract(name: string, using: (fn: (store: Store) => Promise<void>) => Promise<void>) {
  describe(name, () => {
    it('round-trips both tokens, JSON metadata and partial patches', () => using(async store => {
      const p = makeParticipant('direct');
      p.studyConfig = { mode: 'dry-run', nested: { z: 1, a: true } };
      await store.createParticipant(p);
      assert.equal((await store.getParticipantByToken(p.token, 'main'))?.id, p.id);
      assert.equal((await store.getParticipantByToken(p.delayedToken, 'delayed'))?.id, p.id);
      await Promise.all([store.updateParticipant(p.id, { pretestScore: 6 }), store.updateParticipant(p.id, { completedTargets: ['TS1'] })]);
      const saved = await store.getParticipant(p.id);
      assert.equal(saved?.pretestScore, 6); assert.deepEqual(saved?.completedTargets, ['TS1']);
      assert.deepEqual(saved?.studyConfig, p.studyConfig);
    }));
    it('commits all writes together and rolls back on failure', () => using(async store => {
      const p = makeParticipant('direct'); await store.createParticipant(p);
      await assert.rejects(store.transaction(async tx => {
        await tx.getParticipant(p.id);
        await tx.updateParticipant(p.id, { stage: 'S3' });
        await tx.addEvent({ id: randomUUID(), participantId: p.id, event: 'stage_leave', payload: {}, ts: new Date().toISOString() });
        throw new Error('fail after writes');
      }));
      assert.equal((await store.getParticipant(p.id))?.stage, 'S2');
      assert.equal((await store.listEvents()).length, 0);
    }));
    it('preserves insertion order even when timestamps are equal or reversed', () => using(async store => {
      const p = makeParticipant('direct'); await store.createParticipant(p);
      const a = { id: randomUUID(), participantId: p.id, event: 'window_blur' as const, payload: { z: 1, a: 2 }, ts: '2026-09-21T00:00:00.000Z' };
      const b = { ...a, id: randomUUID(), ts: '2026-09-20T00:00:00.000Z' };
      await store.addEvent(a); await store.addEvent(b);
      const rows = await store.listEvents();
      assert.deepEqual(rows.map(r => r.id), [a.id, b.id]);
      assert.equal(toCsv(rows), toCsv([{ ...a, configVersion: rows[0].configVersion }, { ...b, configVersion: rows[1].configVersion }]));
    }));
    it('round-trips the differentiated cognitive-load row while omitting legacy fields', () => using(async store => {
      const p = makeParticipant('control'); await store.createParticipant(p);
      await store.addScale({
        id: randomUUID(), participantId: p.id,
        intrinsic1: 6, intrinsic2: 4,
        germane1: 7, germane2: 6, germane3: 5,
        extraneous1: 3, extraneous2: 2, extraneous3: 4,
        intrinsicMean: 5, germaneMean: 6, extraneousMean: 3,
        ts: new Date().toISOString(),
      });
      const row = (await store.listScales())[0];
      assert.equal(row.intrinsic1, 6);
      assert.equal(row.germaneMean, 6);
      assert.equal(row.extraneousMean, 3);
      assert.equal(row.mentalEffort, undefined);
      assert.equal(row.load, undefined);
      assert.equal(row.frustration, undefined);
      assert.equal(row.selfEfficacy, undefined);
    }));
    it('rejects duplicate responses without keeping a partial batch', () => using(async store => {
      const p = makeParticipant('control'); await store.createParticipant(p);
      const row = { id: randomUUID(), participantId: p.id, stage: 'S1' as const, itemId: 'S1-01', level: 'decode' as const, chosen: 1, correct: false, rtMs: 3000, ts: new Date().toISOString() };
      await store.addResponses([row]);
      await assert.rejects(store.addResponses([{ ...row, id: randomUUID(), itemId: 'S1-02' }, { ...row, id: randomUUID() }]));
      assert.equal((await store.listResponses()).length, 1);
    }));
    it('balances 20 concurrent pretests and keeps first duplicate submission', () => using(async store => {
      const people = Array.from({ length: 20 }, () => ({ ...makeParticipant('control'), stage: 'S1' as const, stratum: null, stageEnteredTs: { S1: new Date(Date.now() - 90000).toISOString() } }));
      for (const p of people) await store.createParticipant(p);
      await Promise.all(people.map(p => store.transaction(tx => submitQuiz(tx, { token: p.token, stage: 'S1', answers: [] }), { assignment: true })));
      const counts = { socratic: 0, direct: 0, control: 0 };
      for (const p of await store.listParticipants()) counts[p.arm]++;
      assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1);
      const before = await store.listResponses();
      const result = await store.transaction(tx => submitQuiz(tx, { token: people[0].token, stage: 'S1', answers: [] }), { assignment: true });
      assert.equal('duplicate' in result && result.duplicate, true);
      assert.deepEqual(await store.listResponses(), before);
    }));
    it('serializes concurrent read-modify-write operations on the same participant', () => using(async store => {
      const p = makeParticipant('control'); await store.createParticipant(p);
      await Promise.all(['flag_a', 'flag_b'].map(flag => store.transaction(async tx => {
        const current = (await tx.getParticipantByToken(p.token, 'main'))!;
        await tx.updateParticipant(p.id, { excludeFlags: [...current.excludeFlags, flag] });
      })));
      assert.deepEqual((await store.getParticipant(p.id))?.excludeFlags.sort(), ['flag_a', 'flag_b']);
    }));
  });
}
