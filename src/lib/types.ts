// Core domain types. Every field that the design documents depend on is named here.

export type Arm = 'socratic' | 'direct' | 'control';

export type Stage = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'DONE';

export type Granularity = 'word' | 'sentence' | 'passage';

export type ItemLevel = 'check' | 'decode' | 'comprehend' | 'infer';

/** One multiple-choice test item. `answer` never leaves the server. */
export interface Item {
  id: string;
  passageId: string;
  stage: Extract<Stage, 'S1' | 'S3' | 'S5' | 'S6'>;
  level: ItemLevel;
  stem: string;
  options: string[]; // exactly 4 for self-written items; official items may differ
  answerIndex: number; // 0-based; server-side only
  evidence: string; // the sentence in the passage that forces the answer
  source: string; // reference work + page, or "澳門四校聯考 2024 官方答案"
  attentionCheck?: boolean;
  /** true = placeholder that must be replaced before collection */
  draft?: boolean;
}

export interface Annotation {
  term: string; // surface form as it appears in the passage
  gloss: string; // meaning; rare words and proper nouns ONLY
  kind: 'rare_word' | 'proper_noun' | 'allusion';
  /** Where the gloss came from. Required in practice: every gloss must be traceable. */
  source?: string;
}

/** A target sentence in the learning passage. Both AI arms use the SAME explanation text. */
export interface TargetSentence {
  id: string;
  text: string; // must be an exact substring of the learning passage
  languagePoint: string; // e.g. 之＝代詞
  /** Pre-written, identical for both AI arms (design rule: explanation parity). */
  explanation: string;
  /** Layer-3 multiple choice presented by the socratic arm. */
  choice: {
    prompt: string;
    options: string[];
    answerIndex: number;
    /** why each wrong option is wrong; shown only after the reader has answered */
    whyWrong: string[];
  };
  /** Layer-1 and layer-2 question stems (fixed wording, per Rosenshine generic stems). */
  layer1: string;
  layer2: string;
  /**
   * Layer-1 and layer-2 answer options.
   *
   * Every layer of a TARGET sentence is a multiple choice plus a required reason.
   * The reader never faces a blank box asking "what is the answer" — only "why did you
   * pick that". Recognition for the what, production for the why.
   *
   * These two layers ask about OBSERVATIONS (what part of speech sits next to the word,
   * what the phrase is doing), never about the meaning itself, so they cannot give away
   * the layer-3 answer.
   *
   * Free (non-target) highlights have no pre-written options and keep the model-generated
   * open question at layers 1-2: generated options cannot be quality-checked at run time.
   */
  layer1Choice?: { options: string[]; answerIndex: number };
  layer2Choice?: { options: string[]; answerIndex: number };
  /** Model answers accepted at layer 1/2 (server-side judging aid, never shown). */
  acceptableAnswers: string[];
  /** true until the wording has been collated against the two annotated editions */
  draft?: boolean;
}

export interface Passage {
  id: string;
  /** Researcher-facing label. Carries the entry numbers; never sent to the client. */
  title: string;
  /**
   * What the reader sees above the text.
   *
   * Kept separate from `title` for two reasons: the internal label contains entry numbers
   * (「汰侈 3＋8」) that mean nothing to a participant and read as a bug, and naming the
   * chapter 「汰侈」 would hand every reader the theme of all three passages before they
   * start. Provenance lives in `source`, which the client never receives.
   */
  displayTitle: string;
  source: string;
  verified: boolean; // true only after collation against the two annotated editions
  text: string;
  charCount: number;
  annotations: Annotation[];
  targets: TargetSentence[]; // non-empty only for the learning passage
}

export type LadderStep =
  | 'layer1'
  | 'layer2'
  | 'layer3_choice'
  | 'reason_rejected'
  | 'explanation'
  | 'done';

export interface LadderState {
  step: LadderStep;
  /** how many times the reason was rejected for this interaction */
  reasonRejections: number;
  /** set when the reader answered correctly before layer 3 */
  correctBefore: boolean;
  /** which free-answer layer the reader got it right on */
  correctAtLayer?: 1 | 2;
  /** set when the third reason was force-accepted */
  reasonInsufficient: boolean;
  /** the bottom-out (layer 3) choice */
  choiceIndex?: number;
  choiceCorrect?: boolean;
  /**
   * What the reader picked at layers 1 and 2, kept separate from the bottom-out fields
   * so `endPosition` keeps meaning exactly what it meant before.
   */
  layer1Pick?: { index: number; correct: boolean };
  layer2Pick?: { index: number; correct: boolean };
  /** every rejection in this interaction; `reasonRejections` resets when a layer advances */
  reasonRejectionsTotal?: number;
}

export type InteractionType =
  | 'focus' // reader chooses the exact word/character inside a multi-word highlight
  | 'question' // socratic layer 1/2 question
  | 'probe' // "你怎麼判斷的"
  | 'choice' // layer 3 multiple choice
  | 'reject' // reason rejected, ask again
  | 'explain' // the shared explanation (both AI arms end here)
  | 'user'; // a reader turn

export interface InteractionRow {
  configVersion?: string;
  id: string;
  participantId: string;
  interactionId: string; // groups the turns of one highlight
  inTargetSentence: string | null; // target id, or null for free highlights
  granularity: Granularity | null;
  highlightText: string;
  turnIndex: number;
  actor: 'system' | 'user';
  type: InteractionType;
  text: string;
  strategy: 'A' | 'B' | 'C' | 'D' | null;
  latencyMs: number | null;
  rawResponse: string | null;
  leakFlags: string[];
  /**
   * Task-A audit trail for FREE-highlight generated MCQs at layers 1/2.
   *
   * Task-A gives up run-time validation of the "is this option itself the answer"
   * question (structural checks + option-level leak-check catch the obvious cases,
   * but semantic quality still needs a human read). The paper replaces that with a
   * full post-hoc audit: with N=45 every generated MCQ can be re-read afterwards.
   * These three fields are what the auditor reads.
   *
   * generatedOptions        the three options as sent to the reader
   * generatedAnswerIndex    the model's claimed answer, trusted at run time.
   *                         null on the degraded fallback path (a pick can never
   *                         "match" the fallback, so the ladder cannot end early)
   * degraded                the fallback fired (structure/leak/parse failed twice
   *                         in a row); flagged in `leakFlags` too as 'fallback_choice'
   */
  generatedOptions?: string[];
  generatedAnswerIndex?: number | null;
  degraded?: boolean;
  ts: string;
}

export interface Participant {
  configVersion?: string;
  /** Actual first access to S6, separate from the main-session completion timestamp. */
  delayedStartedTs?: string;
  /** Per-participant immutable run metadata, never sent to the reader. */
  studyConfig?: Record<string, unknown>;
  id: string;
  token: string;
  delayedToken: string;
  arm: Arm;
  stage: Stage;
  stratum: 'low' | 'mid' | 'high' | null;
  pretestScore: number | null;
  consentTs: string;
  demographics: Record<string, string | number | boolean>;
  excludeFlags: string[];
  stageEnteredTs: Partial<Record<Stage, string>>;
  /** target sentences whose interaction reached 'done' */
  completedTargets: string[];
  /** the one interaction currently open, if any */
  active: ActiveInteraction | null;
}

export interface ActiveInteraction {
  interactionId: string;
  targetId: string | null;
  selection: string;
  /** Character offsets of `selection` inside the learning passage. Used by the
   *  client to draw the highlight and the inline unlock button next to it, and
   *  by the server to resolve targets by position. Absent for pre-existing rows
   *  written before the field was added. */
  selectionStart?: number;
  selectionEnd?: number;
  granularity: Granularity;
  /** Original highlight remains `selection`; these fields record the narrower word or
   * character the Socratic reader explicitly chose before the ladder began. */
  focusSelection?: string;
  focusStart?: number;
  focusEnd?: number;
  focusOptions?: string[];
  focusPending?: boolean;
  focusSource?: 'suggestion' | 'other';
  turnIndex: number;
  ladder: LadderState;
  startedTs: string;
  /**
   * Free highlights only: the generated MCQ currently on display at the active rung
   * (Task A). Persisted on the participant so a reload can rebuild the exact widget
   * the reader was looking at, and so the reply handler can compare the reader's
   * pick against the model's own claimed answerIndex.
   *
   * `answerIndex` is null on the degraded fallback path — no pick can ever match a
   * null, so the ladder can only descend a rung from that state, never end early.
   */
  activeChoice?: {
    options: string[];
    answerIndex: number | null;
    degraded: boolean;
  };
}

export interface ResponseRow {
  configVersion?: string;
  id: string;
  participantId: string;
  stage: Stage;
  itemId: string;
  level: ItemLevel;
  chosen: number | null; // null = skipped
  correct: boolean;
  rtMs: number;
  ts: string;
}

export interface EventRow {
  configVersion?: string;
  id: string;
  participantId: string;
  event:
    | 'annotation_click'
    | 'visibility_change'
    | 'item_skip'
    | 'stage_enter'
    | 'stage_leave'
    | 'read_done_click'
    | 'lower_bound_met'
    | 'llm_failure'
    | 'duplicate_submission'
    | 'reason_judgement'
    | 'focus_selected'
    // proctoring: recorded, never enforced
    | 'fullscreen_enter'
    | 'fullscreen_exit'
    | 'window_blur';
  payload: Record<string, unknown>;
  ts: string;
}

export interface ScaleRow {
  configVersion?: string;
  id: string;
  participantId: string;
  /** Paas (1992) single-item invested mental-effort rating, 1–9. */
  /** Present for the Paas 1–9 scale introduced in v5.5. Legacy rows omit it. */
  mentalEffort?: number;
  /** Legacy fields from the pre-Paas three-item screen; absent on new rows. */
  load?: number;
  frustration?: number;
  selfEfficacy?: number;
  ts: string;
}
