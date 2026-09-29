import { NextResponse } from 'next/server';
import { ITEMS_BY_STAGE } from '@/content/items';
import { ALL_TARGETS, TRAINING_PASSAGES } from '@/content/passages';
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
  const translations = await store.listTranslations();

  const started = participants.filter((p) => p.stage !== 'S0');
  const finishedMain = participants.filter((p) => p.stage === 'DONE');

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
      requiredTargets: ALL_TARGETS.filter((t) => t.required).length,
    };
  });

  /**
   * v6 PRIMARY OUTCOME, descriptively: share of sentences tried before any help, per arm
   * and phase (S1b baseline, S5a post-test). The mixed-effects model runs offline on the
   * exported translations table; this is only the dashboard view.
   */
  const triedFirstByArm = (['socratic', 'direct', 'control'] as Arm[]).map((arm) => {
    const ids = new Set(participants.filter((p) => p.arm === arm).map((p) => p.id));
    const rate = (stage: 'S1b' | 'S5a') => {
      const rows = translations.filter((r) => ids.has(r.participantId) && r.stage === stage && !r.timedOut);
      return { n: rows.length, triedFirst: rows.length ? rows.filter((r) => r.triedFirst).length / rows.length : null };
    };
    return { arm, S1b: rate('S1b'), S5a: rate('S5a') };
  });

  // A descriptive flag is not an exclusion. Counting "chose not to use the assistant" as
  // an excluded record would quietly undo intention-to-treat.
  const reallyExcluded = participants.filter((p) =>
    p.excludeFlags.some((f) => !CONFIG.exclusion.descriptiveOnly.includes(f))
  ).length;

  const s5Items = ITEMS_BY_STAGE.S5b;
  const matrix: number[][] = [];
  for (const p of participants) {
    const rows = responses.filter((r) => r.participantId === p.id && r.stage === 'S5b');
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
    triedFirstByArm,
    progression: {
      completionRate: started.length ? finishedMain.length / started.length : 0,
      completionRateThreshold: CONFIG.progression.completionRate,
      leakRateSocratic: leakRate(socraticTurns),
      leakRateThreshold: CONFIG.progression.maxLeakRate,
      // v6: one lower_bound_met event per training passage finished on its required targets.
      requiredPassagesMetRate: started.length ? lowerBoundMetCount / (started.length * TRAINING_PASSAGES.length) : 0,
      requiredPassagesMetReference: CONFIG.progression.lowerBoundMetRate,
      reasonInsufficientRate: readDone ? reasonInsufficient / readDone : 0,
      reasonInsufficientThreshold: CONFIG.progression.maxReasonInsufficientRate,
      alphaS5bDecode: matrix.length >= 2 ? cronbachAlpha(matrix) : null,
      alphaThreshold: CONFIG.progression.minAlphaS5,
    },
    itemStatsS5bDecode:
      matrix.length >= 2
        ? itemStats(matrix).map((s, i) => ({ itemId: s5Items[i].id, ...s }))
        : [],
  });
}
