import { NextResponse } from 'next/server';
import { ITEMS_BY_STAGE } from '@/content/items';
import { CONFIG } from '@/lib/config';
import { leakRate } from '@/lib/leak';
import { cronbachAlpha, itemStats } from '@/lib/scoring';
import { getStore } from '@/lib/store';
import type { Arm } from '@/lib/types';
import { authorised } from '@/lib/admin';

export const dynamic = 'force-dynamic';

/**
 * The progression-criteria dashboard (CONSORT pilot extension item 6c).
 * Every number here is one of the pre-set thresholds in CONFIG.progression.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorised(req)) {
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

  /**
   * VOLUNTARY USAGE.
   *
   * Nobody is required to use the assistant any more, so how much each arm chose to use
   * it is a result of the pilot rather than a fixed quantity. These are the numbers the
   * write-up needs: did the questioning arm get abandoned? did the direct arm ask for
   * more? how many readers never asked at all?
   *
   * It also matters for the analysis: with usage unmatched, an S5 difference between the
   * two AI arms mixes "questioned rather than told" with "consumed more assistance", so
   * usage has to enter as a covariate. These are the covariate's descriptives.
   */
  const usageByArm = (['socratic', 'direct', 'control'] as Arm[]).map((arm) => {
    const inArm = participants.filter((p) => p.arm === arm && p.stage !== 'S0' && p.stage !== 'S1');
    const perReader = inArm.map((p) => {
      const mine = interactions.filter((r) => r.participantId === p.id);
      const ids = new Set(mine.map((r) => r.interactionId));
      return { highlights: ids.size, targets: p.completedTargets.length };
    });
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      arm,
      n: inArm.length,
      meanHighlights: Number(mean(perReader.map((x) => x.highlights)).toFixed(2)),
      meanTargetsUsed: Number(mean(perReader.map((x) => x.targets)).toFixed(2)),
      neverUsedRate: inArm.length
        ? perReader.filter((x) => x.highlights === 0).length / inArm.length
        : 0,
      usedAllFourRate: inArm.length
        ? perReader.filter((x) => x.targets === 4).length / inArm.length
        : 0,
    };
  });

  // A descriptive flag is not an exclusion. Counting "chose not to use the assistant" as
  // an excluded record would quietly undo intention-to-treat.
  const reallyExcluded = participants.filter((p) =>
    p.excludeFlags.some((f) => !CONFIG.exclusion.descriptiveOnly.includes(f))
  ).length;

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
      excluded: reallyExcluded,
      descriptivelyFlagged: participants.filter((p) =>
        p.excludeFlags.some((f) => CONFIG.exclusion.descriptiveOnly.includes(f))
      ).length,
    },
    usageByArm,
    progression: {
      completionRate: started.length ? finishedMain.length / started.length : 0,
      completionRateThreshold: CONFIG.progression.completionRate,
      delayedReturnRate: finishedMain.length ? finishedDelayed.length / finishedMain.length : 0,
      delayedReturnRateThreshold: CONFIG.progression.delayedReturnRate,
      leakRateSocratic: leakRate(socraticTurns),
      leakRateThreshold: CONFIG.progression.maxLeakRate,
      // No longer a compliance check. Nobody is required to use all four, so this is now
      // a straight measure of how many readers chose to — keep the threshold in view as a
      // reference line, not as a pass/fail.
      usedAllFourRate: started.length ? lowerBoundMetCount / started.length : 0,
      usedAllFourReference: CONFIG.progression.lowerBoundMetRate,
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
