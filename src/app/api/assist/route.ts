import { NextResponse } from 'next/server';
import { Engine } from '@/lib/engine';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Highlight and reader turns. Only available in S2, and only there.
 * The client receives text to display; it never receives ladder state, answer keys,
 * or the arm's prompt.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as
    | { token: string; action: 'highlight'; selection: string }
    | { token: string; action: 'answer'; text: string }
    | { token: string; action: 'choice'; index: number; reason: string }
    | { token: string; action: 'read_done' };

  const store = getStore();
  const p = await store.getParticipantByToken(body.token, 'main');
  if (!p) return NextResponse.json({ error: 'unknown token' }, { status: 404 });
  if (p.stage !== 'S2') return NextResponse.json({ error: 'assist closed' }, { status: 409 });

  const engine = new Engine(store);
  try {
    if (body.action === 'highlight') {
      const turn = await engine.startAssist(p, body.selection);
      return NextResponse.json(turn);
    }
    if (body.action === 'answer') {
      return NextResponse.json(await engine.reply(p, { kind: 'answer', text: body.text }));
    }
    if (body.action === 'choice') {
      return NextResponse.json(
        await engine.reply(p, { kind: 'choice', index: body.index, reason: body.reason })
      );
    }
    return NextResponse.json(await engine.reply(p, { kind: 'read_done' }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 400 });
  }
}
