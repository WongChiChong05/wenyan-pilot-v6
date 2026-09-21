import { ITEMS_BY_STAGE } from '../content/items';
import { DELAYED_PASSAGE, LEARNING_PASSAGE, PRETEST_PASSAGE, TRANSFER_PASSAGE } from '../content/passages';
import { CONFIG } from './config';
import { stageLimits } from './engine';
import { lowerBoundApplies, lowerBoundMet, showsTargetHints } from './highlight';
import type { Item, Participant, Stage } from './types';

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
  config: { version: string };
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
        passage: {
          id: PRETEST_PASSAGE.id,
          title: PRETEST_PASSAGE.displayTitle,
          text: PRETEST_PASSAGE.text,
          annotations: [],
          targets: [],
          showAnnotations: false,
        },
        items: ITEMS_BY_STAGE.S1.map(publicItem),
      };
    case 'S2': {
      // Two separate questions now: is this arm GATED (nobody is), and does it see the
      // sentences shaded (the AI arms do).
      const applies = lowerBoundApplies(p.arm);
      const hints = showsTargetHints(p.arm);
      const doneSet = new Set(p.completedTargets);
      return {
        ...base,
        arm: p.arm,
        passage: {
          id: LEARNING_PASSAGE.id,
          title: LEARNING_PASSAGE.displayTitle,
          text: LEARNING_PASSAGE.text,
          annotations: LEARNING_PASSAGE.annotations.map((a) => ({ term: a.term, gloss: a.gloss })),
          targets: hints
            ? LEARNING_PASSAGE.targets.map((t) => ({
                id: t.id,
                text: t.text,
                done: doneSet.has(t.id),
              }))
            : [],
          showAnnotations: true,
        },
        lowerBound: {
          applies,
          required: applies ? LEARNING_PASSAGE.targets.length : 0,
          done: p.completedTargets.length,
          met: lowerBoundMet(LEARNING_PASSAGE, p.completedTargets, p.arm),
        },
        // Every arm now, since usage is voluntary and time is the only matched quantity.
        minSeconds: CONFIG.minReadingSeconds,
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
    case 'S3':
      // The passage IS shown here, matching S5 and S6 — a reader answering about a text
      // they cannot see is being tested on memory, which is not what this study measures.
      //
      // The ANNOTATIONS are not. S3-01 and S3-02 are check-level items that ask what the
      // annotation said; showing the annotation list beside them turns those two into a
      // lookup exercise and they stop measuring whether the reader used the annotations
      // during S2.
      return {
        ...base,
        arm: p.arm,
        passage: {
          id: LEARNING_PASSAGE.id,
          title: LEARNING_PASSAGE.displayTitle,
          text: LEARNING_PASSAGE.text,
          annotations: [],
          targets: [],
          showAnnotations: false,
        },
        items: ITEMS_BY_STAGE.S3.map(publicItem),
      };
    case 'S4':
      return { ...base, arm: 'hidden' };
    case 'S5':
      return {
        ...base,
        arm: 'hidden',
        passage: {
          id: TRANSFER_PASSAGE.id,
          title: TRANSFER_PASSAGE.displayTitle,
          text: TRANSFER_PASSAGE.text,
          annotations: [], // by design: no annotations in the transfer passage
          targets: [],
          showAnnotations: false,
        },
        items: ITEMS_BY_STAGE.S5.map(publicItem),
      };
    case 'S6':
      return {
        ...base,
        arm: 'hidden',
        passage: {
          id: DELAYED_PASSAGE.id,
          title: DELAYED_PASSAGE.displayTitle,
          text: DELAYED_PASSAGE.text,
          annotations: [],
          targets: [],
          showAnnotations: false,
        },
        items: ITEMS_BY_STAGE.S6.map(publicItem),
      };
    default:
      return { ...base, arm: 'hidden' };
  }
}
