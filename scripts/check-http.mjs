import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercises a separately running local dev server using synthetic seed records only.
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3001');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Local dev server only');
const data = JSON.parse(await readFile('tmp/interface-demo/db.json', 'utf8'));
const privateKeys = new Set(['answerIndex', 'generatedAnswerIndex', 'rawResponse', 'delayedToken', 'acceptableAnswers']);
function assertPublic(value) {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    assert.ok(!privateKeys.has(key), `Private field in participant API: ${key}`); assertPublic(child);
  }
}
async function request(route, body) {
  const response = await fetch(new URL(route, base), body ? { method: 'POST',
    headers: { 'content-type': 'application/json', origin: base.origin }, body: JSON.stringify(body) } : undefined);
  const json = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(json)}`);
  assertPublic(json); return json;
}
for (const arm of ['socratic', 'direct', 'control']) {
  const p = data.participants.findLast(p => p.arm === arm && p.stage === 'S2' && p.studyConfig?.synthetic === true);
  assert.ok(p, 'Run npm run demo:seed first');
  const view = await request(`/api/state?t=${p.token}`);
  assert.equal(view.arm, arm); assert.deepEqual(view.passage.targets, []);
  assert.equal(view.assist.sidebar, arm !== 'control');
  let turn = view.pendingTurn ?? await request('/api/assist', { token: p.token, action: 'highlight', selection: '擊之' });
  if (arm === 'control') assert.equal(turn.kind, 'none');
  else {
    if (arm === 'socratic') {
      for (let step = 0; step < 3 && turn.kind !== 'explanation'; step++) {
        assert.equal(turn.kind, 'choice');
        turn = await request('/api/assist', { token: p.token, action: 'choice',
          interactionId: turn.interactionId, turnIndex: turn.turnIndex, index: 0, reason: '因為前面有擊這個動作' });
      }
    }
    assert.equal(turn.kind, 'explanation');
    await request('/api/assist', { token: p.token, action: 'read_done', interactionId: turn.interactionId, turnIndex: turn.turnIndex });
  }
  await request(`/api/transcript?t=${p.token}`);
  const d = data.participants.findLast(p => p.arm === arm && p.stage === 'S6' && p.studyConfig?.synthetic === true);
  assert.ok(d, 'Missing delayed demo');
  const delayed = await request(`/api/state?t=${d.delayedToken}&d=1`);
  assert.equal(delayed.stage, 'S6');
  await request('/api/quiz', { token: d.delayedToken, delayed: true, stage: 'S6', answers: [] });
  assert.equal((await request(`/api/state?t=${d.delayedToken}&d=1`)).stage, 'DONE');
  console.log(`${arm}: state, interaction, private-field boundary, delayed submission and completion reload OK`);
}
console.log('HTTP CHECK OK (synthetic data and local server only)');
