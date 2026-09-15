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
  /** Model answers accepted at layer 1/2 (server-side judging aid, never shown). */
  acceptableAnswers: string[];
  /** true until the wording has been collated against the two annotated editions */
  draft?: boolean;
}

export interface Passage {
  id: string;
  title: string;
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
  choiceIndex?: number;
  choiceCorrect?: boolean;
}

export type InteractionType =
  | 'question' // socratic layer 1/2 question
  | 'probe' // "你怎麼判斷的"
  | 'choice' // layer 3 multiple choice
  | 'reject' // reason rejected, ask again
  | 'explain' // the shared explanation (both AI arms end here)
  | 'user'; // a reader turn

export interface InteractionRow {
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
  ts: string;
}

export interface Participant {
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
  granularity: Granularity;
  turnIndex: number;
  ladder: LadderState;
  startedTs: string;
}

export interface ResponseRow {
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
    | 'llm_failure';
  payload: Record<string, unknown>;
  ts: string;
}

export interface ScaleRow {
  id: string;
  participantId: string;
  load: number;
  frustration: number;
  selfEfficacy: number;
  ts: string;
}
