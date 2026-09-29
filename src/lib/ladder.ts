import { shouldForceAccept } from './reasonGate';
import type { LadderState } from './types';

/**
 * The socratic ladder is a server-side state machine. The model never decides
 * whether the explanation may be shown; it only writes the text for the step the
 * machine is in. This is the single most important property for the manipulation
 * check: "the explanation appeared before the reader had tried" becomes impossible
 * by construction rather than by prompt discipline.
 *
 *   v5.8: layer1 --answer+reason--> layer2 --answer+reason-->
 *         layer3_choice --answer+reason--> explanation.
 *   An insufficient reason leaves the reader on the same rung. The step name
 *   layer3_choice is retained in persisted rows, but v5.8 displays open text.
 *   Pre-v5.8 multiple-choice events below remain for already-open interactions.
 *   explanation --reader clicks 看完了--> done
 *
 * The legacy choice path uses `layer_choice` and `reason`; v5.8 uses
 * `open_response` only after answer and reason validation in engine.ts.
 */
export type LadderEvent =
  | { kind: 'open_response' }
  | { kind: 'free_answer'; correct: boolean; hasReason: boolean }
  /** a layer-1 or layer-2 multiple choice (target sentences) */
  | { kind: 'layer_choice'; index: number; correct: boolean }
  /** the layer-3 bottom-out choice */
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
      const layer = state.step === 'layer1' ? 1 : 2;
      const nextStep = state.step === 'layer1' ? ('layer2' as const) : ('layer3_choice' as const);

      // v5.8: a complete open answer and reason advances regardless of correctness.
      if (event.kind === 'open_response') return { ...state, step: nextStep };

      // ---- multiple-choice path (target sentences) ----
      if (event.kind === 'layer_choice') {
        // Record the pick and wait for the reason; the pair arrives as two events.
        const pick = { index: event.index, correct: event.correct };
        return layer === 1 ? { ...state, layer1Pick: pick } : { ...state, layer2Pick: pick };
      }
      if (event.kind === 'reason') {
        const pick = layer === 1 ? state.layer1Pick : state.layer2Pick;
        if (!pick) return state; // a reason with no pick: ignore
        const rejections = event.accepted ? state.reasonRejections : state.reasonRejections + 1;
        const total = (state.reasonRejectionsTotal ?? 0) + (event.accepted ? 0 : 1);
        const forced = !event.accepted && shouldForceAccept(rejections);

        if (!event.accepted && !forced) {
          // stay on this layer and ask for a better reason
          return { ...state, reasonRejections: rejections, reasonRejectionsTotal: total };
        }
        if (pick.correct) {
          return {
            ...state,
            step: 'explanation',
            correctBefore: true,
            correctAtLayer: layer,
            reasonRejections: rejections,
            reasonRejectionsTotal: total,
            reasonInsufficient: state.reasonInsufficient || forced,
          };
        }
        // wrong pick, reason settled: go down a rung. Each layer gets its own two tries.
        return {
          ...state,
          step: nextStep,
          reasonRejections: 0,
          reasonRejectionsTotal: total,
          reasonInsufficient: state.reasonInsufficient || forced,
        };
      }

      // ---- open-text path (free highlights) ----
      if (event.kind !== 'free_answer') return state;
      if (event.correct && event.hasReason) {
        return { ...state, step: 'explanation', correctBefore: true, correctAtLayer: layer };
      }
      if (event.correct && !event.hasReason) {
        // answered right but gave no reason: probe, stay on the same layer
        return state;
      }
      return { ...state, step: nextStep };
    }
    case 'layer3_choice': {
      if (event.kind === 'open_response') return { ...state, step: 'explanation' };
      if (event.kind === 'choice') {
        return { ...state, choiceIndex: event.index, choiceCorrect: event.correct };
      }
      if (event.kind === 'reason') {
        if (event.accepted) return { ...state, step: 'explanation' };
        const rejections = state.reasonRejections + 1;
        const total = (state.reasonRejectionsTotal ?? 0) + 1;
        if (shouldForceAccept(rejections)) {
          return {
            ...state,
            step: 'explanation',
            reasonRejections: rejections,
            reasonRejectionsTotal: total,
            reasonInsufficient: true,
          };
        }
        return {
          ...state,
          step: 'reason_rejected',
          reasonRejections: rejections,
          reasonRejectionsTotal: total,
        };
      }
      return state;
    }
    case 'reason_rejected': {
      if (event.kind === 'reason') {
        if (event.accepted) return { ...state, step: 'explanation' };
        const rejections = state.reasonRejections + 1;
        const total = (state.reasonRejectionsTotal ?? 0) + 1;
        if (shouldForceAccept(rejections)) {
          return {
            ...state,
            step: 'explanation',
            reasonRejections: rejections,
            reasonRejectionsTotal: total,
            reasonInsufficient: true,
          };
        }
        return { ...state, reasonRejections: rejections, reasonRejectionsTotal: total };
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
): 'layer1_correct' | 'layer2_correct' | 'choice_correct' | 'choice_wrong' | 'open_response' | 'unfinished' {
  if (!explanationAllowed(state)) return 'unfinished';
  if (state.correctBefore) return state.correctAtLayer === 1 ? 'layer1_correct' : 'layer2_correct';
  if (state.choiceIndex === undefined) return 'open_response';
  return state.choiceCorrect ? 'choice_correct' : 'choice_wrong';
}
