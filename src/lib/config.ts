/**
 * Every number the design documents fix. Changing one of these changes the experiment,
 * so they live in one file and are echoed into the export so the analysis can prove
 * which configuration produced the data.
 *
 * Source: claude/實驗設計-Pilot版-十五項決定.md (v5.2)
 */
export const CONFIG = {
  version: 'v5.6',

  /** Stage time limits in seconds. Upper bound auto-advances; lower bound flags. */
  stageSeconds: {
    S0: { min: 20, max: 600 },
    S1: { min: 60, max: 360 },
    S2: { min: 180, max: 840 }, // 14 minutes, hard
    S3: { min: 60, max: 300 },
    S4: { min: 10, max: 120 },
    S5: { min: 120, max: 600 },
    S6: { min: 120, max: 600 },
  } as const,

  /** Highlight granularity: <= 4 characters is a word. */
  wordMaxChars: 4,

  /** Lower bound: every target sentence must be used at least once. No upper bound. */
  lowerBoundIsAllTargets: true,

  /**
   * WHICH ARMS THE LOWER BOUND APPLIES TO.
   *
   * NOW EMPTY: no arm is required to use the assistant at all.
   *
   * It began as all three arms, then dropped control (telling the control reader which
   * four sentences matter is itself an attention scaffold), and is now off everywhere.
   * In a PILOT, "will students voluntarily use a questioning AI, or give up and read
   * alone?" is a finding, not noise — and a forced minimum makes that question
   * unanswerable by construction. Voluntary usage becomes an outcome we report rather
   * than a variable we suppress.
   *
   * WHAT THIS COSTS, to be written into the limitations:
   *  1. The socratic-vs-direct comparison loses its exposure match. If one arm marks five
   *     sentences and the other two, an S5 difference mixes "questioned rather than told"
   *     with "consumed more assistance". Amount of use has to enter the analysis as a
   *     covariate or a mediator; it can no longer be assumed equal.
   *  2. A reader who marks nothing is, for that session, an untreated participant in a
   *     treated arm. Intention-to-treat still includes them — that is the point of ITT —
   *     but with fifteen per arm a few non-users noticeably dilute any effect.
   *  3. `progression.lowerBoundMetRate` changes meaning: it was a feasibility check on a
   *     requirement, and is now a straight measure of how many readers chose to use all
   *     four. It stays on the dashboard because that number is now the interesting one.
   *
   * WHAT REPLACES IT: `minReadingSeconds`, for every arm, so time on the passage stays
   * comparable even when usage does not. That is now the only matched quantity.
   */
  lowerBoundArms: [] as readonly string[],

  /**
   * Which arms see the four target sentences shaded.
   *
   * NOW EMPTY: nobody sees them. A shaded sentence is a cue whether or not it is also a
   * requirement — the reader reads it as "this is the bit that matters" — so leaving the
   * shading in while removing the quota still shapes where people look. Reading is now
   * entirely unguided in all three arms.
   *
   * THIS DOES NOT DISABLE THE PRE-WRITTEN LADDERS. `matchTarget` keys off the selected
   * TEXT, not off the shading: a reader who happens to select 「以鐵如意擊之」 still gets
   * TS1's hand-written rungs. What is lost is the nudge towards them, so expect a larger
   * share of socratic-arm turns to come from model-generated questions, which nothing
   * validates at run time. That share is worth reporting: `interactions.inTargetSentence`
   * is null for exactly those turns.
   */
  targetHintArms: [] as readonly string[],

  /**
   * Minimum dwell time on S2, in seconds, before the continue button unlocks — now for
   * EVERY arm, since nothing else is matched. Without it a reader can leave S2 in twenty
   * seconds and the passage was never read at all. Set to 0 to remove it entirely.
   */
  minReadingSeconds: 180,

  /**
   * DELAYED TEST (S6) WINDOW.
   *
   * `minHours` is the gap between finishing the main session and the delayed link
   * becoming usable; `maxDays` is how long it stays usable. Both are enforced on the
   * server in src/app/api/state/route.ts — before this they were hardcoded there and
   * the minimum was not enforced at all, so a participant could take the delayed test
   * minutes after the main session and it would have been recorded as a delayed result.
   */
  delayedTest: {
    minHours: 24, // opens the next day
    maxHours: 48, // and closes a day after that: a one-day window, not a week
  },

  /**
   * PROCTORING. Read the honest limits before relying on any of this.
   *
   * A web page CANNOT stop someone leaving. It cannot block Alt-Tab, a second monitor,
   * a phone beside the laptop, or closing the lid. What it can do is make leaving
   * deliberate, visible, and recorded:
   *   - ask for fullscreen on every test stage, and notice when it is left
   *   - log every window blur and visibility change
   *   - let the browser ask "leave site?" on navigation away
   * Everything here is deterrence plus measurement, not enforcement. The exclusion
   * thresholds below are what actually protect the analysis.
   *
   * The consent page promises the reader may close the page and withdraw at any time.
   * Nothing here may break that promise: the "leave site?" dialog is one click to
   * confirm, and leaving fullscreen is never blocked, only noticed.
   */
  proctor: {
    fullscreen: true,
    warnBeforeLeaving: true,
    /** stages where a test is actually in progress */
    stages: ['S1', 'S2', 'S3', 'S5', 'S6'] as readonly string[],
  },

  /** Reason gate. */
  maxReasonRejections: 2, // third attempt is force-accepted and flagged
  reasonMinChars: 4,

  /** Socratic ladder: layer1 -> layer2 -> layer3(choice+reason) -> explanation. */
  maxSocraticLayers: 3,

  /** LLM call settings; both arms MUST share these. */
  llm: {
    /**
     * No default on purpose. A hardcoded fallback here was a trap: model ids get retired,
     * and a stale one fails at request time with an opaque 404 mid-session. `getProvider`
     * refuses to build a real provider when this is empty, so the failure happens at
     * startup with a message saying what to set.
     *
     * Pin the exact dated id (not an alias) and freeze it for the whole study — it goes
     * into the paper's method section.
     */
    model: process.env.LLM_MODEL ?? '',
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0),
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 300),
    maxCharsPerTurn: 60, // identical cap for both arms
    timeoutMs: 20000,
    retries: 1,
  },

  /** Exclusion rules decided before data collection. */
  exclusion: {
    maxVisibilityChanges: 3,
    minSecondsPerItem: 3,
    /**
     * Flags that DESCRIBE a participant without excluding them.
     *
     * `excludeFlags` is one bag holding two different kinds of mark, and confusing them
     * would break intention-to-treat: a reader who chose not to use the assistant is a
     * result, not a spoiled record, and ITT keeps them in. Only the flags NOT listed here
     * count as exclusions in the dashboard.
     */
    descriptiveOnly: ['targets_incomplete', 'no_assist_used'] as readonly string[],
  },

  /** Pilot progression criteria (CONSORT pilot extension item 6c). Self-set thresholds. */
  progression: {
    completionRate: 0.8,
    delayedReturnRate: 0.7,
    maxLeakRate: 0.05,
    lowerBoundMetRate: 0.9,
    minReasonKappa: 0.6,
    maxReasonInsufficientRate: 0.2,
    minAlphaS5: 0.7,
  },
} as const;

export type Config = typeof CONFIG;
