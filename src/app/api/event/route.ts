import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { CONFIG } from '@/lib/config';
import { getStore } from '@/lib/store';
import type { EventRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Client-side behavioural events: annotation clicks, tab switches, skips. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    token: string;
    delayed?: boolean;
    event: EventRow['event'];
    payload?: Record<string, unknown>;
  };
  const store = getStore();
  const p = await store.getParticipantByToken(body.token, body.delayed ? 'delayed' : 'main');
  if (!p) return NextResponse.json({ error: 'unknown token' }, { status: 404 });

  await store.addEvent({
    id: randomUUID(),
    participantId: p.id,
    event: body.event,
    payload: body.payload ?? {},
    ts: new Date().toISOString(),
  });

  if (body.event === 'visibility_change') {
    const events = await store.listEvents();
    const count = events.filter(
      (e) => e.participantId === p.id && e.event === 'visibility_change'
    ).length;
    if (count > CONFIG.exclusion.maxVisibilityChanges && !p.excludeFlags.includes('tab_switching')) {
      await store.updateParticipant(p.id, { excludeFlags: [...p.excludeFlags, 'tab_switching'] });
    }
  }
  return NextResponse.json({ ok: true });
}
