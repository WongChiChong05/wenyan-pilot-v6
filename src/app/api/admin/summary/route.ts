import { NextResponse } from 'next/server';
import { ITEMS_BY_STAGE } from '@/content/items';
import { CONFIG } from '@/lib/config';
import { leakRate } from '@/lib/leak';
import { cronbachAlpha, itemStats } from '@/lib/scoring';
import { getStore } from '@/lib/store';
import type { Arm } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The progression-criteria dashboard (CONSORT pilot extension item 6c).
 * Every number here is one of the pre-set thresholds in CONFIG.progression.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!process.env.ADMIN_PASSWORD || url.searchParams.get('key') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const store = getStore();
  const participants = await store.listParticipants();
  const responses = await store.listResponses();
  const interactions = await store.listInteractions();
  const events = await store.listEvents();

  const started = participants.filter((p) => p.stage !== 'S0');
  const finishedMain = participants.filter((p) => ['S6', 'DONE'].includes(p.stage));
  const finishedDelayed = participants.filter((p) => p.stage === 'DONE');

  const byArm = (arm: Arm) => participants.filter((p) => p.arm === arm).length;

  const s5Items = ITEMS_BY_STAGE.S5;
  const matrix: number[][] = [];
  for (const p of participants) {
    const rows = responses.filter((r) => r.participantId === p.id && r.stage === 'S5');
    if (rows.length === s5Items.length) {
      matrix.push(s5Items.map((i) => (rows.find((r) => r.itemId === i.id)?.correct ? 1 : 0)));
    }
  }

  const socraticTurns = interactions.filter(
    (r) => participants.find((p) => p.id === r.participantId)?.arm === 'socratic'
  );
  const lowerBoundMetCount = events.filter((e) => e.event === 'lower_bound_met').length;
  const reasonInsufficient = events.filter(
    (e) => e.event === 'read_done_click' && e.payload.reasonInsufficient === true
  ).length;
  const readDone = events.filter((e) => e.event === 'read_done_click').length;

  return NextResponse.json({
    configVersion: CONFIG.version,
    n: {
      total: participants.length,
      byArm: { socratic: byArm('socratic'), direct: byArm('direct'), control: byArm('control') },
      excluded: participants.filter((p) => p.excludeFlags.length > 0).length,
    },
    progression: {
      completionRate: started.length ? finishedMain.length / started.length : 0,
      completionRateThreshold: CONFIG.progression.completionRate,
      delayedReturnRate: finishedMain.length ? finishedDelayed.length / finishedMain.length : 0,
      delayedReturnRateThreshold: CONFIG.progression.delayedReturnRate,
      leakRateSocratic: leakRate(socraticTurns),
      leakRateThreshold: CONFIG.progression.maxLeakRate,
      lowerBoundMetRate: started.length ? lowerBoundMetCount / started.length : 0,
      lowerBoundThreshold: CONFIG.progression.lowerBoundMetRate,
      reasonInsufficientRate: readDone ? reasonInsufficient / readDone : 0,
      reasonInsufficientThreshold: CONFIG.progression.maxReasonInsufficientRate,
      alphaS5: matrix.length >= 2 ? cronbachAlpha(matrix) : null,
      alphaThreshold: CONFIG.progression.minAlphaS5,
    },
    itemStatsS5:
      matrix.length >= 2
        ? itemStats(matrix).map((s, i) => ({ itemId: s5Items[i].id, ...s }))
        : [],
  });
}
