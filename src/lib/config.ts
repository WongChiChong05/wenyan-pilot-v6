/**
 * Every number the design documents fix. Changing one of these changes the experiment,
 * so they live in one file and are echoed into the export so the analysis can prove
 * which configuration produced the data.
 *
 * Source: claude/實驗設計-Pilot版-十五項決定.md (v5.2)
 */
export const CONFIG = {
  version: 'v5.2',

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

  /** Reason gate. */
  maxReasonRejections: 2, // third attempt is force-accepted and flagged
  reasonMinChars: 4,

  /** Socratic ladder: layer1 -> layer2 -> layer3(choice+reason) -> explanation. */
  maxSocraticLayers: 3,

  /** LLM call settings; both arms MUST share these. */
  llm: {
    model: process.env.LLM_MODEL ?? 'claude-3-5-haiku-20241022',
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
