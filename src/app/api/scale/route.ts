import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { nextStage } from '@/lib/engine';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** S4: three single-item scales (1–7): mental load, frustration, self-efficacy. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    token: string;
    load: number;
    frustration: number;
    selfEfficacy: number;
  };
  const store = getStore();
  const p = await store.getParticipantByToken(body.token, 'main');
  if (!p) return NextResponse.json({ error: 'unknown token' }, { status: 404 });
  if (p.stage !== 'S4') return NextResponse.json({ error: 'stage mismatch' }, { status: 409 });

  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 7;
  if (![body.load, body.frustration, body.selfEfficacy].every(inRange)) {
    return NextResponse.json({ error: 'scale values must be integers 1-7' }, { status: 400 });
  }

  const now = new Date().toISOString();
  await store.addScale({
    id: randomUUID(),
    participantId: p.id,
    load: body.load,
    frustration: body.frustration,
    selfEfficacy: body.selfEfficacy,
    ts: now,
  });
  const target = nextStage(p.stage);
  await store.updateParticipant(p.id, {
    stage: target,
    stageEnteredTs: { ...p.stageEnteredTs, [target]: now },
  });
  return NextResponse.json({ ok: true, stage: target });
}
