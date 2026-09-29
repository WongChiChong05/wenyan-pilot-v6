/**
 * Every number the design documents fix. Changing one of these changes the experiment,
 * so they live in one file and are echoed into the export so the analysis can prove
 * which configuration produced the data.
 *
 * Source: claude/實驗設計-Pilot版-十五項決定.md (v5.2), revised by the v6 plan
 * 「實驗計畫：行為導向版（v6 草案）」 (2026-09-29): primary outcome is behaviour (trying
 * a translation before asking for help), measured in S1b and S5a; S3 and the S6 delayed
 * test are removed; training is three passages.
 */
export const CONFIG = {
  version: 'v6.0',

  /**
   * Stage time limits in seconds. Upper bound auto-advances; lower bound flags.
   * S2 is PER TRAINING PASSAGE in v6 (three passages, so up to 24 minutes in total).
   */
  stageSeconds: {
    S0: { min: 20, max: 600 },
    S1: { min: 60, max: 360 },
    S1b: { min: 60, max: 600 },
    S2: { min: 180, max: 480 },
    S4: { min: 10, max: 120 },
    S5b: { min: 120, max: 720 },
    S5a: { min: 60, max: 600 },
  } as const,

  /**
   * v6 sentence-translation stages (S1b baseline, S5a post-test with help, S5b without).
   * `triedFirstMinHan`: a sentence counts as "tried first" when the answer box held at least
   * this many Han characters before the reader first pressed 提示, 解釋 or 跳過 (or when they
   * submitted without pressing any). Freeze before the first real participant.
   * `tooFastHelpSeconds` is used only by the analysis scripts, never at run time.
   */
  translation: {
    triedFirstMinHan: 2,
    tooFastHelpSeconds: 10,
  },

  /** Highlight granularity: <= 4 characters is a word. */
  wordMaxChars: 4,

  /** Lower bound: every target sentence must be used at least once. No upper bound. */
  lowerBoundIsAllTargets: true,

  /**
   * WHICH ARMS THE LOWER BOUND APPLIES TO.
   *
   * v6: THE TWO AI ARMS. Each training passage carries two `required` target sentences, and
   * an AI-arm reader cannot move to the next passage until both have reached the
   * explanation and been closed with 看完了 (or the passage times out).
   *
   * History: v5.2 applied it to all three arms, v5.4 dropped control, v5.5–v5.12 applied
   * it to nobody because voluntary use was itself a pilot finding. v6 moves the primary
   * outcome to BEHAVIOUR after training, and behaviour change needs every AI-arm reader to
   * have been through the manipulation: under voluntary use some readers never opened the
   * assistant, and with fifteen per arm they dilute any effect (plan §9 #1, decided by WCC
   * under the supervisor's delegation, 2026-09-29).
   *
   * WHAT THIS COSTS: "will students voluntarily use a questioning AI?" can now be answered
   * only from the FREE highlights outside the required targets. Those remain voluntary and
   * are still logged (`interactions.inTargetSentence` is null for them).
   *
   * Control is never gated: it has no AI turn that could "finish" a sentence. It sees the
   * same shaded sentences and only reads (plan: 無 AI 組只讀不寫), so it gets no forced
   * try-first practice that would itself raise its S5a score.
   */
  lowerBoundArms: ['socratic', 'direct'] as readonly string[],

  /**
   * Which arms see the required target sentences shaded.
   *
   * v6: ALL THREE. Once the targets are required in the AI arms they must be visible, and
   * control sees the same shading so all three arms are pointed at the same sentences.
   * Only `required` targets are shaded; optional pre-written ladders (TS2, TS3) still fire
   * when a reader happens to select them, exactly as in v5.
   */
  targetHintArms: ['socratic', 'direct', 'control'] as readonly string[],

  /**
   * Minimum dwell time on EACH training passage, in seconds, before 下一篇 unlocks — every
   * arm. Time is still the matched quantity across arms. Set to 0 to remove it.
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
    stages: ['S1', 'S1b', 'S2', 'S5b', 'S5a'] as readonly string[],
  },

  /** Reason gate. */
  /**
   * After this many rejected reasons on one rung, the next reason is force-accepted,
   * flagged (`ladder.reasonInsufficient`) and logged as `reason_forced`. v6 applies it to
   * the open-answer path too (D7): with required targets, a reader stuck at the gate
   * could otherwise never leave the passage.
   */
  maxReasonRejections: 2,
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
