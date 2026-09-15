import { ITEMS_BY_STAGE } from '../content/items';
import { DELAYED_PASSAGE, LEARNING_PASSAGE, PRETEST_PASSAGE, TRANSFER_PASSAGE } from '../content/passages';
import { CONFIG } from './config';
import { stageLimits } from './engine';
import { lowerBoundMet } from './highlight';
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
    targets: { id: string; text: string }[];
    showAnnotations: boolean;
  };
  items?: ReturnType<typeof publicItem>[];
  lowerBound?: { required: number; done: number; met: boolean };
  config: { version: string };
}

export function buildStageView(p: Participant): StageView {
  const base = { stage: p.stage, seconds: stageLimits(p.stage), config: { version: CONFIG.version } };
  switch (p.stage) {
    case 'S1':
      return {
        ...base,
        arm: 'hidden', // the reader never learns the arm, and before S1 there is none
        passage: {
          id: PRETEST_PASSAGE.id,
          title: PRETEST_PASSAGE.title,
          text: PRETEST_PASSAGE.text,
          annotations: [],
          targets: [],
          showAnnotations: false,
        },
        items: ITEMS_BY_STAGE.S1.map(publicItem),
      };
    case 'S2':
      return {
        ...base,
        arm: p.arm,
        passage: {
          id: LEARNING_PASSAGE.id,
          title: LEARNING_PASSAGE.title,
          text: LEARNING_PASSAGE.text,
          annotations: LEARNING_PASSAGE.annotations.map((a) => ({ term: a.term, gloss: a.gloss })),
          targets: LEARNING_PASSAGE.targets.map((t) => ({ id: t.id, text: t.text })),
          showAnnotations: true,
        },
        lowerBound: {
          required: LEARNING_PASSAGE.targets.length,
          done: p.completedTargets.length,
          met: lowerBoundMet(LEARNING_PASSAGE, p.completedTargets),
        },
      };
    case 'S3':
      return { ...base, arm: p.arm, items: ITEMS_BY_STAGE.S3.map(publicItem) };
    case 'S4':
      return { ...base, arm: 'hidden' };
    case 'S5':
      return {
        ...base,
        arm: 'hidden',
        passage: {
          id: TRANSFER_PASSAGE.id,
          title: TRANSFER_PASSAGE.title,
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
          title: DELAYED_PASSAGE.title,
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
