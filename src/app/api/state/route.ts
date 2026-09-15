import { NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import { buildStageView } from '@/lib/view';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const delayed = url.searchParams.get('d') === '1';
  const store = getStore();
  const p = await store.getParticipantByToken(token, delayed ? 'delayed' : 'main');
  if (!p) return NextResponse.json({ error: 'unknown token' }, { status: 404 });
  if (delayed && p.stage !== 'S6') {
    return NextResponse.json({ error: 'delayed test not open yet', stage: p.stage }, { status: 409 });
  }
  // The delayed test is reachable only through its own link, 3–7 days later.
  if (!delayed && p.stage === 'S6') {
    const finished = p.stageEnteredTs.S6 ? new Date(p.stageEnteredTs.S6) : new Date();
    const earliest = new Date(finished.getTime() + 3 * 24 * 3600 * 1000);
    return NextResponse.json({
      stage: 'WAIT_DELAYED',
      arm: 'hidden',
      seconds: { min: 0, max: 3600 },
      delayedPath: `/run?t=${p.delayedToken}&d=1`,
      earliest: earliest.toISOString().slice(0, 10),
      config: { version: 'v5.2' },
    });
  }
  return NextResponse.json(buildStageView(p));
}
