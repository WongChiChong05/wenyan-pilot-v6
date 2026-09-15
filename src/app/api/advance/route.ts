import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { LEARNING_PASSAGE } from '@/content/passages';
import { nextStage, stageLimits } from '@/lib/engine';
import { lowerBoundMet } from '@/lib/highlight';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Stage advance. Two ways out of S2:
 *   - the reader finished the lower bound and pressed continue
 *   - the 14 minutes ran out (reason = 'timeout'), which flags the record but keeps it
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    token: string;
    delayed?: boolean;
    reason: 'user' | 'timeout';
    elapsedSeconds: number;
  };
  const store = getStore();
  const p = await store.getParticipantByToken(body.token, body.delayed ? 'delayed' : 'main');
  if (!p) return NextResponse.json({ error: 'unknown token' }, { status: 404 });

  const limits = stageLimits(p.stage);
  const flags = [...p.excludeFlags];

  if (p.stage === 'S2') {
    const met = lowerBoundMet(LEARNING_PASSAGE, p.completedTargets);
    if (!met && body.reason === 'user') {
      return NextResponse.json({ error: 'lower bound not met' }, { status: 409 });
    }
    if (!met) flags.push('lower_bound_unmet');
  }
  if (body.elapsedSeconds < limits.min) flags.push(`below_min_time_${p.stage}`);

  const now = new Date().toISOString();
  await store.addEvent({
    id: randomUUID(),
    participantId: p.id,
    event: 'stage_leave',
    payload: { stage: p.stage, reason: body.reason, elapsedSeconds: body.elapsedSeconds },
    ts: now,
  });

  const target = nextStage(p.stage);
  const updated = await store.updateParticipant(p.id, {
    stage: target,
    excludeFlags: Array.from(new Set(flags)),
    stageEnteredTs: { ...p.stageEnteredTs, [target]: now },
    active: null,
  });
  return NextResponse.json({ ok: true, stage: updated.stage });
}
