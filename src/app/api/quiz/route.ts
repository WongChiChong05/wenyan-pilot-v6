import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ITEMS_BY_STAGE } from '@/content/items';
import { CONFIG } from '@/lib/config';
import { nextStage } from '@/lib/engine';
import { assignArm, stratumOf, type Stratum } from '@/lib/randomize';
import { scoreQuiz, type SubmittedAnswer } from '@/lib/scoring';
import { getStore } from '@/lib/store';
import type { Arm, Participant, ResponseRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Cut points for the pretest strata. Frozen once collection starts. */
const CUTS = {
  low: Number(process.env.STRATUM_LOW ?? 3),
  high: Number(process.env.STRATUM_HIGH ?? 6),
};

export async function POST(req: Request) {
  const body = (await req.json()) as {
    token: string;
    delayed?: boolean;
    stage: 'S1' | 'S3' | 'S5' | 'S6';
    answers: SubmittedAnswer[];
  };
  const store = getStore();
  const p = await store.getParticipantByToken(body.token, body.delayed ? 'delayed' : 'main');
  if (!p) return NextResponse.json({ error: 'unknown token' }, { status: 404 });
  if (p.stage !== body.stage) {
    return NextResponse.json({ error: 'stage mismatch', stage: p.stage }, { status: 409 });
  }

  const items = ITEMS_BY_STAGE[body.stage];
  const scored = scoreQuiz(items, body.answers);
  const now = new Date().toISOString();
  const rows: ResponseRow[] = scored.rows.map((r) => ({
    ...r,
    id: randomUUID(),
    participantId: p.id,
    ts: now,
  }));
  await store.addResponses(rows);

  const flags = [...p.excludeFlags];
  if (scored.attentionCheckFailed) flags.push(`attention_fail_${body.stage}`);
  const tooFast = body.answers.some((a) => a.rtMs < CONFIG.exclusion.minSecondsPerItem * 1000);
  if (tooFast) flags.push(`too_fast_${body.stage}`);
  for (let i = 0; i < scored.skipped; i++) {
    await store.addEvent({
      id: randomUUID(),
      participantId: p.id,
      event: 'item_skip',
      payload: { stage: body.stage },
      ts: now,
    });
  }

  const patch: Partial<Participant> = {
    excludeFlags: Array.from(new Set(flags)),
    stage: nextStage(p.stage),
    stageEnteredTs: { ...p.stageEnteredTs, [nextStage(p.stage)]: now },
  };

  // Arm assignment happens exactly once, right after the pretest is scored,
  // on the server, using the stratum counts that already exist.
  if (body.stage === 'S1') {
    const stratum: Stratum = stratumOf(scored.total, CUTS);
    const all = await store.listParticipants();
    const counts = { socratic: 0, direct: 0, control: 0 } as Record<Arm, number>;
    for (const other of all) {
      if (other.id !== p.id && other.stratum === stratum) counts[other.arm] += 1;
    }
    patch.pretestScore = scored.total;
    patch.stratum = stratum;
    patch.arm = assignArm(counts);
  }

  const updated = await store.updateParticipant(p.id, patch);
  return NextResponse.json({ ok: true, stage: updated.stage });
}
