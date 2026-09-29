import { ITEMS_BY_STAGE } from '../content/items';
import { PASSAGES, PRETEST_PASSAGE, TRAINING_PASSAGES } from '../content/passages';
import { TRANSLATION_BY_STAGE, TRANSLATION_PASSAGE } from '../content/translation';
import { CONFIG } from './config';
import { stageLimits, trainingPassageFor } from './engine';
import { lowerBoundApplies, lowerBoundMet, requiredTargets, showsTargetHints } from './highlight';
import type { Item, Participant, Passage, Stage, TranslationStage } from './types';

/** Items as the client may see them: the answer key is stripped here, once. */
export function publicItem(i: Item) {
  return { id: i.id, stem: i.stem, options: i.options, level: i.level };
}

export interface StageView {
  stage: Stage;
  arm: Participant['arm'] | 'hidden';
  seconds: { min: number; max: number };
  passage?: {
    id: string;
    title: string;
    text: string;
    annotations: { term: string; gloss: string }[];
    /**
     * Only sent for arms the lower bound applies to. Control gets an empty list on
     * purpose: it must never learn which four sentences the outcome measures.
     */
    targets: { id: string; text: string; done: boolean }[];
    showAnnotations: boolean;
  };
  items?: ReturnType<typeof publicItem>[];
  /** `applies: false` means this arm has no highlight gate (control). */
  lowerBound?: { applies: boolean; required: number; done: number; met: boolean };
  /** Seconds the reader must stay on S2 before continuing. 0 = no time gate. */
  minSeconds?: number;
  /**
   * What the page should ask of the reader while a test is in progress. Both are
   * deterrence, not enforcement — see CONFIG.proctor.
   */
  proctor: { fullscreen: boolean; warnBeforeLeaving: boolean };
  /** S2 only. */
  assist?: {
    /** true while an interaction is open: the passage is locked to new highlights */
    locked: boolean;
    /** what the open interaction is about, so a reload can redisplay it */
    pendingSelection: string | null;
    pendingRange: { start: number; end: number } | null;
    /** whether this arm gets the conversation sidebar at all (control does not) */
    sidebar: boolean;
  };
  /** v6 S2: which of the training passages is on screen */
  training?: { index: number; total: number };
  /**
   * v6 translation stages. The reference translation and rubric never leave the server;
   * the hint and explanation are sent only once the reader has asked for them.
   */
  translation?: {
    stage: TranslationStage;
    index: number;
    total: number;
    sentence: string;
    allowHelp: boolean;
    hint: string | null;
    explanation: string | null;
    /** S5b: the sentences are finished and the decode items are on screen */
    done: boolean;
  };
  config: { version: string };
}

/** A passage as the client may see it. */
function publicPassage(passage: Passage, options: { annotations: boolean; targets?: { id: string; text: string; done: boolean }[] }) {
  return {
    id: passage.id,
    title: passage.displayTitle,
    text: passage.text,
    annotations: options.annotations ? passage.annotations.map((a) => ({ term: a.term, gloss: a.gloss })) : [],
    targets: options.targets ?? [],
    showAnnotations: options.annotations,
  };
}

function translationView(p: Participant, stage: TranslationStage): StageView['translation'] {
  const items = TRANSLATION_BY_STAGE[stage];
  const state = p.progress?.translation?.stage === stage ? p.progress.translation : null;
  const index = Math.min(state?.index ?? 0, items.length - 1);
  const item = items[index];
  return {
    stage,
    index,
    total: items.length,
    sentence: item.sentence,
    allowHelp: stage !== 'S5b',
    hint: state?.hintTs ? item.hint ?? null : null,
    explanation: state?.explanationTs ? item.explanation ?? null : null,
    done: Boolean(state?.translationsDone),
  };
}

export function buildStageView(p: Participant): StageView {
  const testing = CONFIG.proctor.stages.includes(p.stage);
  const base = {
    stage: p.stage,
    seconds: stageLimits(p.stage),
    config: { version: CONFIG.version },
    proctor: {
      fullscreen: CONFIG.proctor.fullscreen && testing,
      warnBeforeLeaving: CONFIG.proctor.warnBeforeLeaving && testing,
    },
  };
  switch (p.stage) {
    case 'S1':
      return {
        ...base,
        arm: 'hidden', // the reader never learns the arm, and before S1 there is none
        passage: publicPassage(PRETEST_PASSAGE, { annotations: false }),
        items: ITEMS_BY_STAGE.S1.map(publicItem),
      };
    case 'S1b':
    case 'S5a':
      return {
        ...base,
        arm: 'hidden',
        passage: publicPassage(PASSAGES[TRANSLATION_PASSAGE[p.stage]], { annotations: true }),
        translation: translationView(p, p.stage),
      };
    case 'S5b': {
      const translation = translationView(p, 'S5b')!;
      // Sentences first (儉嗇 1), then the decode items on 儉嗇 9, on one stage clock.
      return translation.done
        ? { ...base, arm: 'hidden', passage: publicPassage(PASSAGES.J9, { annotations: true }), items: ITEMS_BY_STAGE.S5b.map(publicItem), translation }
        : { ...base, arm: 'hidden', passage: publicPassage(PASSAGES[TRANSLATION_PASSAGE.S5b], { annotations: true }), translation };
    }
    case 'S2': {
      // v6: one training passage at a time. The AI arms are gated on its required
      // targets; every arm sees those targets shaded (CONFIG.targetHintArms).
      const passage = trainingPassageFor(p);
      const applies = lowerBoundApplies(p.arm);
      const hints = showsTargetHints(p.arm);
      const doneSet = new Set(p.completedTargets);
      const required = requiredTargets(passage);
      return {
        ...base,
        arm: p.arm,
        passage: publicPassage(passage, {
          annotations: true,
          targets: hints ? required.map((t) => ({ id: t.id, text: t.text, done: doneSet.has(t.id) })) : [],
        }),
        lowerBound: {
          applies,
          required: applies ? required.length : 0,
          done: required.filter((t) => doneSet.has(t.id)).length,
          met: lowerBoundMet(passage, p.completedTargets, p.arm),
        },
        minSeconds: CONFIG.minReadingSeconds,
        training: { index: TRAINING_PASSAGES.indexOf(passage), total: TRAINING_PASSAGES.length },
        assist: {
          locked: p.active !== null,
          pendingSelection: p.active?.selection ?? null,
          pendingRange: p.active?.selectionStart !== undefined && p.active.selectionEnd !== undefined
            ? { start: p.active.selectionStart, end: p.active.selectionEnd } : null,
          // Control gets no sidebar: it has no AI turns to show. The passage column
          // keeps the same max width in every arm, so line length stays matched.
          sidebar: p.arm !== 'control',
        },
      };
    }
    case 'S4':
      return { ...base, arm: 'hidden' };
    default:
      return { ...base, arm: 'hidden' };
  }
}
