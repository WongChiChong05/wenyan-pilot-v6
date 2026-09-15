import { shouldForceAccept } from './reasonGate';
import type { LadderState } from './types';

/**
 * The socratic ladder is a server-side state machine. The model never decides
 * whether the explanation may be shown; it only writes the text for the step the
 * machine is in. This is the single most important property for the manipulation
 * check: "the explanation appeared before the reader had tried" becomes impossible
 * by construction rather than by prompt discipline.
 *
 *   layer1 --correct+reason--> explanation
 *          --wrong----------> layer2 --correct+reason--> explanation
 *                                    --wrong----------> layer3_choice
 *   layer3_choice --reason accepted--> explanation (right or wrong answer)
 *                 --reason rejected--> reason_rejected --> layer3_choice (max 2x)
 *   explanation --reader clicks 看完了--> done
 */
export type LadderEvent =
  | { kind: 'free_answer'; correct: boolean; hasReason: boolean }
  | { kind: 'choice'; index: number; correct: boolean }
  | { kind: 'reason'; accepted: boolean }
  | { kind: 'read_done' };

export function initialLadder(): LadderState {
  return {
    step: 'layer1',
    reasonRejections: 0,
    correctBefore: false,
    reasonInsufficient: false,
  };
}

export function reduce(state: LadderState, event: LadderEvent): LadderState {
  switch (state.step) {
    case 'layer1':
    case 'layer2': {
      if (event.kind !== 'free_answer') return state;
      if (event.correct && event.hasReason) {
        return {
          ...state,
          step: 'explanation',
          correctBefore: true,
          correctAtLayer: state.step === 'layer1' ? 1 : 2,
        };
      }
      if (event.correct && !event.hasReason) {
        // answered right but gave no reason: probe, stay on the same layer
        return state;
      }
      return { ...state, step: state.step === 'layer1' ? 'layer2' : 'layer3_choice' };
    }
    case 'layer3_choice': {
      if (event.kind === 'choice') {
        return { ...state, choiceIndex: event.index, choiceCorrect: event.correct };
      }
      if (event.kind === 'reason') {
        if (event.accepted) return { ...state, step: 'explanation' };
        const rejections = state.reasonRejections + 1;
        if (shouldForceAccept(rejections)) {
          return { ...state, step: 'explanation', reasonRejections: rejections, reasonInsufficient: true };
        }
        return { ...state, step: 'reason_rejected', reasonRejections: rejections };
      }
      return state;
    }
    case 'reason_rejected': {
      if (event.kind === 'reason') {
        if (event.accepted) return { ...state, step: 'explanation' };
        const rejections = state.reasonRejections + 1;
        if (shouldForceAccept(rejections)) {
          return { ...state, step: 'explanation', reasonRejections: rejections, reasonInsufficient: true };
        }
        return { ...state, reasonRejections: rejections };
      }
      return state;
    }
    case 'explanation':
      return event.kind === 'read_done' ? { ...state, step: 'done' } : state;
    case 'done':
      return state;
  }
}

/** The invariant the manipulation check depends on. */
export function explanationAllowed(state: LadderState): boolean {
  return state.step === 'explanation' || state.step === 'done';
}

/** How this interaction ended, for the per-sentence outcome table. */
export function endPosition(
  state: LadderState
): 'layer1_correct' | 'layer2_correct' | 'choice_correct' | 'choice_wrong' | 'unfinished' {
  if (!explanationAllowed(state)) return 'unfinished';
  if (state.correctBefore) return state.correctAtLayer === 1 ? 'layer1_correct' : 'layer2_correct';
  return state.choiceCorrect ? 'choice_correct' : 'choice_wrong';
}
