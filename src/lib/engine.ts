import { randomUUID } from 'node:crypto';
import { LEARNING_PASSAGE } from '../content/passages';
import { CONFIG } from './config';
import { classifyGranularity, lowerBoundMet, matchTarget, neighborhoodOf } from './highlight';
import { endPosition, initialLadder, reduce, explanationAllowed } from './ladder';
import { checkDirectOutput, checkSocraticOptions, checkSocraticOutput, validateChoiceStructure } from './leak';
import { deriveFocus, fallbackFocusOptions, focusOccursInSelection, validateFocusOptions } from './focus';
import { getProvider, parseJsonObject, type LlmProvider } from './llm';
import {
  answerJudgePrompt,
  cleanPerspective,
  DEFAULT_PERSPECTIVE,
  directSystemPrompt,
  directTurnPrompt,
  FALLBACK_SOCRATIC_MCQ,
  fallbackQuestion,
  focusOptionsPrompt,
  focusOptionsSystemPrompt,
  reasonJudgePrompt,
  openFallbackQuestion,
  openFinalQuestion,
  PERSPECTIVE_PROMPT,
  perspectivePrompt,
  socraticOpenSystemPrompt,
  socraticSystemPrompt,
  socraticTurnPrompt,
} from './prompts';
import { REASON_REJECT_MESSAGE, ruleCheckReason } from './reasonGate';
import type { Store } from './store';
import type { ActiveInteraction, InteractionRow, Participant, TargetSentence } from './types';

export interface AssistTurn {
  interactionId: string;
  /** what the reader sees next */
  kind: 'focus' | 'perspective' | 'question' | 'choice' | 'reject' | 'explanation' | 'none';
  text: string;
  choice?: { prompt: string; options: string[] };
  focus?: { options: string[]; allowOther: true };
  /** true once this interaction counts towards the lower bound */
  completed: boolean;
  /** arm-aware: always true for an arm the bound does not apply to (control) */
  lowerBoundMet: boolean;
  /**
   * The DISTINCT target sentences finished so far. Authoritative — the client must not
   * keep its own tally: it used to increment on every completed highlight, free ones
   * included, which is how the counter reached 10/4 while the gate stayed shut.
   */
  completedTargetIds: string[];
  degraded?: boolean;
  /** Character offsets of the active selection in the passage. Sent so the client
   *  can mark the highlight while the interaction is open. */
  range?: { start: number; end: number };
  /** v5.12: the interaction was dropped by the reader (see isCancellable). */
  cancelled?: boolean;
  /** v5.12: whether the reader may still cancel; filled in by the API layer. */
  cancellable?: boolean;
}

/** Task-A: generated free-highlight MCQ, before the engine decides what to log. */
interface GeneratedChoice {
  text: string;
  options: string[];
  /** null on the degraded fallback path — engine treats a pick as "cannot end early". */
  answerIndex: number | null;
  strategy: 'A' | 'B' | 'C' | 'D' | null;
  degraded: boolean;
  rawResponse: string | null;
  latencyMs: number;
  leakFlags: string[];
}

interface GeneratedFocus {
  options: string[];
  degraded: boolean;
  rawResponse: string | null;
  latencyMs: number;
  flags: string[];
}

interface GeneratedOpenQuestion {
  text: string;
  degraded: boolean;
  rawResponse: string | null;
  latencyMs: number;
  leakFlags: string[];
}

export class Engine {
  private readonly store: Store;
  private readonly llm: LlmProvider;

  constructor(store: Store, llm: LlmProvider = getProvider()) {
    this.store = store;
    this.llm = llm;
  }

  private target(id: string | null): TargetSentence | null {
    if (!id) return null;
    return LEARNING_PASSAGE.targets.find((t) => t.id === id) ?? null;
  }

  private async log(row: Omit<InteractionRow, 'id' | 'ts'>) {
    await this.store.addInteraction({ ...row, id: randomUUID(), ts: new Date().toISOString() });
  }

  /**
   * A highlight. The service rejects a new highlight while an interaction is open.
   *
   * Task-2 undo of the old snap: the selection is stored VERBATIM. `classifyGranularity`
   * still runs but its output is a recorded label only — nothing in this method
   * rewrites the selection text based on it.
   */
  async startAssist(p: Participant, selection: string, start?: number): Promise<AssistTurn> {
    // Only the passage body may be highlighted. The CSS stops a reader dragging across
    // the instructions, the annotation list or the sidebar; this is the actual guarantee,
    // because CSS is trivially bypassed and a highlight of UI chrome would be logged as a
    // real free highlight and then fed to the model.
    const strip = (s: string) => s.replace(/\s/g, '');
    const trimmed = selection.trim();
    const bare = strip(trimmed);
    if (bare.length === 0 || !strip(LEARNING_PASSAGE.text).includes(bare)) {
      throw new Error('selection is not part of the passage');
    }

    // Resolve where the raw selection sits in the passage (offset first, indexOf
    // fallback). This drives the target resolver, the client-side inline highlight
    // and the neighbourhood the socratic prompt quotes. A hostile client can only
    // make it fall back to substring.
    const validOffset =
      typeof start === 'number' &&
      LEARNING_PASSAGE.text.slice(start, start + trimmed.length) === trimmed;
    const selStart = validOffset ? (start as number) : LEARNING_PASSAGE.text.indexOf(trimmed);
    const selEnd = selStart >= 0 ? selStart + trimmed.length : -1;

    const granularity = classifyGranularity(trimmed);
    const targetId = matchTarget(LEARNING_PASSAGE, trimmed, selStart >= 0 ? selStart : undefined);
    const target = this.target(targetId);
    const active: ActiveInteraction = {
      interactionId: randomUUID(),
      answerMode: 'open',
      targetId,
      selection,
      selectionStart: selStart >= 0 ? selStart : undefined,
      selectionEnd: selEnd >= 0 ? selEnd : undefined,
      granularity,
      turnIndex: -1, // first system turn is 1; subsequent reader/system turns are 2/3
      ladder: initialLadder(),
      startedTs: new Date().toISOString(),
    };

    if (p.arm === 'control') {
      // No response. The act of marking is recorded so all three arms mark identically.
      await this.log({
        participantId: p.id,
        interactionId: active.interactionId,
        inTargetSentence: targetId,
        granularity,
        highlightText: selection,
        turnIndex: 0,
        actor: 'user',
        type: 'user',
        text: selection,
        strategy: null,
        latencyMs: null,
        rawResponse: null,
        leakFlags: [],
      });
      const completed = await this.completeInteraction(p, active, 'control');
      return {
        ...completed,
        kind: 'none',
        text: '',
        interactionId: active.interactionId,
        range: rangeOf(active),
      };
    }

    // v5.9: free highlights in BOTH AI arms first clarify (focus word if the highlight is
    // longer than one character, then the reader's typed perspective). Target sentences
    // skip this: their ladder and explanation are fixed so the two arms see identical text.
    if (!target) return this.beginClarify(p, active, trimmed);

    if (p.arm === 'direct') {
      const { text, degraded } = await this.directExplanation(p, active, target);
      const saved = await this.store.updateParticipant(p.id, {
        active: { ...active, ladder: { ...active.ladder, step: 'explanation' }, turnIndex: 1 },
      });
      return {
        interactionId: active.interactionId,
        kind: 'explanation',
        text,
        completed: false,
        lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets, p.arm),
        completedTargetIds: saved.completedTargets,
        degraded,
        range: rangeOf(active),
      };
    }

    // socratic arm, target sentence: layer 1 (pre-written)
    const focused = active;
    const step = await this.socraticStep(p, focused, target, 1);
    const activeAfter: ActiveInteraction = {
      ...focused,
      turnIndex: 1,
      activeChoice: step.storeChoice,
      pendingQuestion: step.kind === 'question' ? step.text : undefined,
    };
    const saved = await this.store.updateParticipant(p.id, { active: activeAfter });
    return {
      interactionId: active.interactionId,
      kind: step.kind,
      text: step.text,
      choice: step.choice,
      completed: false,
      lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets, p.arm),
      completedTargetIds: saved.completedTargets,
      degraded: step.degraded,
      range: rangeOf(active),
    };
  }

  /**
   * v5.9 clarification for a FREE highlight, both AI arms.
   * Step 1 (only when more than one character is highlighted and it is not an annotated
   * term): the reader types the word they mean. Step 2: the reader types what they want to
   * understand about it; an empty entry means DEFAULT_PERSPECTIVE (guide towards meaning).
   * Nothing is offered as an option in either step.
   */
  private async beginClarify(p: Participant, active: ActiveInteraction, trimmed: string): Promise<AssistTurn> {
    // v5.10: one free-text question replaces the separate focus step. The reader may type a
    // question, a word, or nothing; the focus word is derived from what they typed
    // (focus.ts: deriveFocus) when the perspective is submitted. Nothing is length-limited
    // on the reader's side. The legacy multiple-choice focus path below is unreachable.
    if (active.answerMode === 'open') {
      const annotated = LEARNING_PASSAGE.annotations.find(a => a.term === trimmed)?.term;
      return this.askPerspective(p, annotated ? withFocus(active, annotated, 'suggestion') : active);
    }
    // Readers in either AI arm who highlighted more than one possible word first type the
    // exact word/character they meant. The model only proposes substrings; the reader
    // remains the authority, and "other" is validated against the original highlight.
    const knownTerm = LEARNING_PASSAGE.annotations.find(a => a.term === trimmed)?.term;
    const visibleChars = [...trimmed.replace(/[^\u3400-\u9fff]/gu, '')];
    // Target sentences keep their pre-written ladder (handled by the caller). Replacing it with a generated
    // focus-specific ladder would break explanation parity between the two AI arms.
    // The clarification fixes arbitrary/free highlights, which are where the model
    // otherwise has to guess what a long selection means.
    if (visibleChars.length > 1 && !knownTerm) {
      if (active.answerMode === 'open') {
        const prompt = '你主要想問這段文字裡的哪一個字或詞？請自行輸入反白範圍內的字詞。';
        await this.logSystem(p, active, prompt, 'focus', null, []);
        const saved = await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: 1, focusPending: true },
        });
        return {
          interactionId: active.interactionId,
          kind: 'focus',
          text: prompt,
          completed: false,
          lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets, p.arm),
          completedTargetIds: saved.completedTargets,
          range: rangeOf(active),
        };
      }
      const generated = await this.focusCandidates(p, active);
      if (generated.options.length > 1) {
        const prompt = '你主要想問這一段裡的哪一個字或詞？';
        await this.log({
          participantId: p.id,
          interactionId: active.interactionId,
          inTargetSentence: active.targetId,
          granularity: active.granularity,
          highlightText: active.selection,
          turnIndex: 1,
          actor: 'system',
          type: 'focus',
          text: prompt,
          strategy: null,
          latencyMs: generated.latencyMs,
          rawResponse: generated.rawResponse,
          leakFlags: generated.flags,
          generatedOptions: generated.options,
          generatedAnswerIndex: null,
          degraded: generated.degraded,
        });
        const saved = await this.store.updateParticipant(p.id, {
          active: {
            ...active,
            turnIndex: 1,
            focusOptions: generated.options,
            focusPending: true,
          },
        });
        return {
          interactionId: active.interactionId,
          kind: 'focus',
          text: prompt,
          focus: { options: generated.options, allowOther: true },
          completed: false,
          lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets, p.arm),
          completedTargetIds: saved.completedTargets,
          range: rangeOf(active),
        };
      }
    }

    const focused = knownTerm ? withFocus(active, knownTerm, 'suggestion') : active;
    return this.askPerspective(p, focused);
  }

  /** Logs the perspective prompt one system turn after `active.turnIndex` and waits for it. */
  private async askPerspective(p: Participant, active: ActiveInteraction): Promise<AssistTurn> {
    const prompt = perspectivePrompt(effectiveSelection(active));
    await this.logSystem(p, active, prompt, 'perspective', null, []);
    const saved = await this.store.updateParticipant(p.id, {
      active: { ...active, turnIndex: active.turnIndex + 2, focusPending: false, perspectivePending: true },
    });
    return {
      interactionId: active.interactionId,
      kind: 'perspective',
      text: prompt,
      completed: false,
      lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets, p.arm),
      completedTargetIds: saved.completedTargets,
      range: rangeOf(active),
    };
  }

  /**
   * One rung of the ladder, in whichever form this highlight uses.
   *
   * Target sentences: a pre-written multiple choice (+ the reader must still justify).
   * Free highlights : Task-A model-generated MCQ, validated and audited. The stored
   *                   `activeChoice` on the caller side is what lets the reply handler
   *                   compare the pick against the model's own answerIndex.
   */
  private async socraticStep(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null,
    layer: 1 | 2,
    lastReaderTurn?: string
  ): Promise<{
    kind: AssistTurn['kind'];
    text: string;
    choice?: { prompt: string; options: string[] };
    degraded: boolean;
    /** For free highlights only: what to persist on `active.activeChoice`. */
    storeChoice?: ActiveInteraction['activeChoice'];
  }> {
    if (active.answerMode === 'open') {
      if (target) {
        const prompt = layer === 1 ? target.layer1 : target.layer2;
        await this.logSystem(p, active, prompt, 'question', null, []);
        return { kind: 'question', text: prompt, degraded: false };
      }
      const question = await this.socraticOpenQuestion(p, active, layer, lastReaderTurn);
      await this.log({
        participantId: p.id,
        interactionId: active.interactionId,
        inTargetSentence: active.targetId,
        granularity: active.granularity,
        highlightText: active.selection,
        turnIndex: active.turnIndex + 2,
        actor: 'system',
        type: 'question',
        text: question.text,
        strategy: null,
        latencyMs: question.latencyMs,
        rawResponse: question.rawResponse,
        leakFlags: question.leakFlags,
        degraded: question.degraded,
      });
      return { kind: 'question', text: question.text, degraded: question.degraded };
    }
    const spec = layer === 1 ? target?.layer1Choice : target?.layer2Choice;
    if (target && spec) {
      const prompt = layer === 1 ? target.layer1 : target.layer2;
      await this.logSystem(p, active, prompt, 'choice', layer === 1 ? 'C' : 'A', []);
      return {
        kind: 'choice',
        text: prompt,
        choice: { prompt, options: spec.options },
        degraded: false,
      };
    }
    // Free highlight: Task-A generated MCQ.
    const gc = await this.socraticChoice(p, active, layer);
    await this.log({
      participantId: p.id,
      interactionId: active.interactionId,
      inTargetSentence: active.targetId,
      granularity: active.granularity,
      highlightText: active.selection,
      turnIndex: active.turnIndex + 2,
      actor: 'system',
      type: 'choice',
      text: gc.text,
      strategy: gc.strategy,
      latencyMs: gc.latencyMs,
      rawResponse: gc.rawResponse,
      leakFlags: gc.leakFlags,
      generatedOptions: gc.options,
      generatedAnswerIndex: gc.answerIndex,
      degraded: gc.degraded,
    });
    return {
      kind: 'choice',
      text: gc.text,
      choice: { prompt: gc.text, options: gc.options },
      degraded: gc.degraded,
      storeChoice: { options: gc.options, answerIndex: gc.answerIndex, degraded: gc.degraded },
    };
  }

  /**
   * The options and key for the rung the reader is standing on.
   *
   * Free-highlight layers 1/2 (Task A): read the persisted `activeChoice` off `active`
   * so a reply can be scored against the exact MCQ the reader saw, including through
   * a reload. `answerIndex === null` means the fallback fired — treat any pick as
   * "cannot end the ladder early" (choiceForStep returns -1 so nothing matches).
   */
  private choiceForStep(target: TargetSentence | null, active: ActiveInteraction) {
    const step = active.ladder.step;
    if (step === 'layer1' && target?.layer1Choice) {
      return {
        prompt: target.layer1,
        options: target.layer1Choice.options,
        answerIndex: target.layer1Choice.answerIndex,
        whyWrong: [] as string[],
      };
    }
    if (step === 'layer2' && target?.layer2Choice) {
      return {
        prompt: target.layer2,
        options: target.layer2Choice.options,
        answerIndex: target.layer2Choice.answerIndex,
        whyWrong: [] as string[],
      };
    }
    if ((step === 'layer1' || step === 'layer2') && active.activeChoice) {
      const ac = active.activeChoice;
      return {
        prompt: '',
        options: ac.options,
        // null (fallback) becomes -1 so no pick can ever match: the ladder can only
        // descend from a fallback rung, never end early.
        answerIndex: ac.answerIndex ?? -1,
        whyWrong: [] as string[],
      };
    }
    return choiceForSelection(target, effectiveSelection(active));
  }

  /** A reader turn: free-text answer, a multiple-choice answer with a reason, or 看完了. */
  async reply(
    p: Participant,
    payload:
      | { kind: 'answer'; text: string; reason?: string }
      | { kind: 'focus'; value: string; source: 'suggestion' | 'other' }
      | { kind: 'perspective'; value: string }
      | { kind: 'choice'; index: number; reason: string }
      | { kind: 'read_done' }
  ): Promise<AssistTurn> {
    const active = p.active;
    if (!active) throw new Error('no open interaction');
    const target = this.target(active.targetId);

    if (payload.kind === 'read_done') {
      if (active.ladder.step !== 'explanation') throw new Error('explanation not yet shown');
      const done = await this.completeInteraction(p, active, 'read_done');
      return { ...done, kind: 'none', text: '', interactionId: active.interactionId };
    }

    if (p.arm === 'control') throw new Error('control has no reader turns');
    // v5.9: the direct arm types a focus word and a perspective, but never answers questions.
    if (p.arm === 'direct' && payload.kind !== 'focus' && payload.kind !== 'perspective') {
      throw new Error('only the socratic arm answers questions');
    }

    if (active.focusPending && payload.kind !== 'focus') {
      throw new Error('focus choice required');
    }
    if (active.perspectivePending && payload.kind !== 'perspective') {
      throw new Error('perspective entry required');
    }

    if (payload.kind === 'perspective') {
      if (!active.perspectivePending) throw new Error('perspective entry unavailable');
      const typed = cleanPerspective(payload.value);
      const derived = active.focusSelection ? null : deriveFocus(active.selection, payload.value);
      const base = derived ? withFocus(active, derived, 'question') : active;
      const withPerspective: ActiveInteraction = {
        ...base,
        perspective: typed || DEFAULT_PERSPECTIVE,
        perspectiveSource: typed ? 'typed' : 'default',
        perspectivePending: false,
      };
      await this.logUser(p, active, typed ? `想問：${typed}` : `（未輸入，預設：${DEFAULT_PERSPECTIVE}）`);
      await this.store.addEvent({
        id: randomUUID(),
        participantId: p.id,
        event: 'perspective_set',
        payload: {
          interactionId: active.interactionId,
          selection: effectiveSelection(active),
          perspective: withPerspective.perspective,
          source: withPerspective.perspectiveSource,
          derivedFocus: derived,
          raw: payload.value.slice(0, 200),
        },
        ts: new Date().toISOString(),
      });
      if (p.arm === 'direct') {
        const { text, degraded } = await this.explanationFor(p, withPerspective, null);
        await this.store.updateParticipant(p.id, {
          active: {
            ...withPerspective,
            turnIndex: active.turnIndex + 2,
            ladder: { ...active.ladder, step: 'explanation' },
          },
        });
        return { ...(await this.turn(withPerspective, 'explanation', text, p)), degraded };
      }
      const step = await this.socraticStep(p, withPerspective, null, 1);
      await this.store.updateParticipant(p.id, {
        active: {
          ...withPerspective,
          turnIndex: active.turnIndex + 2,
          activeChoice: step.storeChoice,
          pendingQuestion: step.kind === 'question' ? step.text : undefined,
        },
      });
      return {
        ...(await this.turn(withPerspective, step.kind, step.text, p)),
        choice: step.choice,
        degraded: step.degraded,
      };
    }

    if (payload.kind === 'focus') {
      if (!active.focusPending || (active.answerMode !== 'open' && !active.focusOptions)) throw new Error('focus choice unavailable');
      const value = payload.value.trim();
      if (!focusOccursInSelection(active.selection, value)) throw new Error('focus must occur in selection');
      if (payload.source === 'suggestion' && !active.focusOptions?.includes(value)) {
        throw new Error('unknown focus suggestion');
      }
      const focused = withFocus(active, value, payload.source);
      await this.logUser(p, active, `想問：「${value}」`);
      await this.store.addEvent({
        id: randomUUID(),
        participantId: p.id,
        event: 'focus_selected',
        payload: {
          interactionId: active.interactionId,
          originalSelection: active.selection,
          options: active.focusOptions ?? [],
          focusSelection: value,
          source: payload.source,
        },
        ts: new Date().toISOString(),
      });
      // v5.9: the focus word is followed by the reader's perspective, in both AI arms.
      return this.askPerspective(p, focused);
    }

    if (active.answerMode === 'open') {
      if (payload.kind !== 'answer') throw new Error('open answer required');
      return this.replyOpen(p, active, target, payload.text, payload.reason ?? '');
    }

    if (payload.kind === 'answer') {
      if (pendingTurnFor(p, '')?.kind !== 'question') throw new Error('text answer unavailable');
      // Reachable only for the probe path (target sentence with no layer1/2 spec).
      // Current content gives every target a spec; kept for defensive parity with the
      // old open-text path.
      await this.logUser(p, active, payload.text);
      const correct = await this.judgeAnswer(payload.text, target, effectiveSelection(active));
      const hasReason =
        ruleCheckReason(payload.text, {
          sentenceText: target?.text ?? effectiveSelection(active),
          optionTexts: target?.choice.options ?? [],
        }).verdict === 'accept';
      const next = reduce(active.ladder, { kind: 'free_answer', correct, hasReason });

      if (correct && !hasReason) {
        const probe = '你怎麼判斷的？';
        await this.logSystem(p, active, probe, 'probe', null, []);
        await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
        });
        return this.turn(active, 'question', probe, p);
      }

      if (explanationAllowed(next)) {
        const { text, degraded } = await this.explanationFor(p, active, target, undefined, true);
        await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
        });
        return { ...(await this.turn(active, 'explanation', text, p)), degraded };
      }

      if (next.step === 'layer2') {
        const step2 = await this.socraticStep(p, { ...active, ladder: next }, target, 2);
        await this.store.updateParticipant(p.id, {
          active: {
            ...active,
            turnIndex: active.turnIndex + 2,
            ladder: next,
            activeChoice: step2.storeChoice ?? active.activeChoice,
          },
        });
        return {
          ...(await this.turn(active, step2.kind, step2.text, p)),
          choice: step2.choice,
          degraded: step2.degraded,
        };
      }

      // layer 3: the bottom-out multiple choice
      const bottom = choiceForSelection(target, effectiveSelection(active));
      await this.logSystem(p, active, bottom.prompt, 'choice', null, []);
      await this.store.updateParticipant(p.id, {
        active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
      });
      return {
        ...(await this.turn(active, 'choice', bottom.prompt, p)),
        choice: { prompt: bottom.prompt, options: bottom.options },
      };
    }

    // ---- payload.kind === 'choice' ----
    const atLayer12 = active.ladder.step === 'layer1' || active.ladder.step === 'layer2';
    const choice = this.choiceForStep(target, active);
    if (!['layer1', 'layer2', 'layer3_choice', 'reason_rejected'].includes(active.ladder.step) ||
      !Number.isInteger(payload.index) || payload.index < 0 || payload.index >= choice.options.length) {
      throw new Error('invalid choice for current step');
    }
    const isFreeHighlightFallback =
      !target && atLayer12 && active.activeChoice?.degraded === true;
    // For a fallback free-highlight MCQ, no pick can be "right" — Task-A design:
    // never end the ladder early from the fallback rung. answerIndex is -1 above
    // so pickedRight is false, which is what makes the ladder descend.
    const pickedRight = payload.index === choice.answerIndex && choice.answerIndex >= 0;
    await this.logUser(p, active, `選項${payload.index + 1}｜理由：${payload.reason}`);
    const gate = await this.judgeReason(p.id, payload.reason, target, active, choice.options);

    if (atLayer12) {
      const layer = active.ladder.step === 'layer1' ? 1 : 2;
      const afterPick = reduce(active.ladder, {
        kind: 'layer_choice',
        index: payload.index,
        correct: pickedRight,
      });
      const next = reduce(afterPick, { kind: 'reason', accepted: gate });

      // Reason not good enough: same rung, same options, ask again.
      if (next.step === active.ladder.step) {
        await this.logSystem(p, active, REASON_REJECT_MESSAGE, 'reject', null, []);
        await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
        });
        return {
          ...(await this.turn(active, 'reject', REASON_REJECT_MESSAGE, p)),
          choice: { prompt: choice.prompt, options: choice.options },
        };
      }

      // Right pick, reason accepted: the explanation is earned here.
      // (Unreachable for a fallback free-highlight MCQ — answerIndex is -1 so
      //  pickedRight is false there, and the ladder descends instead.)
      if (explanationAllowed(next)) {
        void isFreeHighlightFallback; // documented above; used to reason about the branch
        const { text, degraded } = await this.explanationFor(p, active, target, undefined, true);
        await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
        });
        return { ...(await this.turn(active, 'explanation', text, p)), degraded };
      }

      // Wrong pick (or fallback rung): down a rung.
      if (next.step === 'layer2') {
        const step2 = await this.socraticStep(p, { ...active, ladder: next }, target, 2);
        await this.store.updateParticipant(p.id, {
          active: {
            ...active,
            turnIndex: active.turnIndex + 2,
            ladder: next,
            activeChoice: step2.storeChoice ?? active.activeChoice,
          },
        });
        return {
          ...(await this.turn(active, step2.kind, step2.text, p)),
          choice: step2.choice,
          degraded: step2.degraded,
        };
      }
      // Descending into layer 3 — clear the layer-1/2 generated MCQ so the reload
      // path rebuilds the bottom-out choice from choiceForSelection.
      const bottom = choiceForSelection(target, effectiveSelection(active));
      await this.logSystem(p, active, bottom.prompt, 'choice', null, []);
      await this.store.updateParticipant(p.id, {
        active: {
          ...active,
          turnIndex: active.turnIndex + 2,
          ladder: next,
          activeChoice: undefined,
        },
      });
      return {
        ...(await this.turn(active, 'choice', bottom.prompt, p)),
        choice: { prompt: bottom.prompt, options: bottom.options },
      };
    }

    // Layer-3 bottom-out: use `choiceForSelection` (unchanged; generic for free
    // highlights, pre-written for targets). Its options ARE the answer by design,
    // so option-level leak-checking is deliberately NOT applied here.
    const bottom = choiceForSelection(target, effectiveSelection(active));
    const bottomRight = payload.index === bottom.answerIndex;
    const afterChoice = reduce(active.ladder, {
      kind: 'choice',
      index: payload.index,
      correct: bottomRight,
    });
    const next = reduce(afterChoice, { kind: 'reason', accepted: gate });

    if (!explanationAllowed(next)) {
      await this.logSystem(p, active, REASON_REJECT_MESSAGE, 'reject', null, []);
      await this.store.updateParticipant(p.id, {
        active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
      });
      return {
        ...(await this.turn(active, 'reject', REASON_REJECT_MESSAGE, p)),
        choice: { prompt: bottom.prompt, options: bottom.options },
      };
    }

    const { text, degraded } = await this.explanationFor(p, active, target, {
      chosen: payload.index,
      answerIndex: bottom.answerIndex,
      whyWrong: bottom.whyWrong,
    });
    await this.store.updateParticipant(p.id, {
      active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
    });
    return { ...(await this.turn(active, 'explanation', text, p)), degraded };
  }

  /** v5.8: each rung requires a self-written answer and reason, even when uncertain. */
  private async replyOpen(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null,
    answerText: string,
    reasonText: string
  ): Promise<AssistTurn> {
    if (!['layer1', 'layer2', 'layer3_choice'].includes(active.ladder.step) || !active.pendingQuestion) {
      throw new Error('text answer unavailable');
    }
    const answer = answerText.trim();
    const reason = reasonText.trim();
    if (!answer || !reason || /^(不知道|不清楚|不會|我不確定|猜的|隨便|idk)$/i.test(answer)) {
      throw new Error('answer and reason required');
    }
    await this.logUser(p, active, `答案：${answer}｜理由：${reason}`);
    const accepted = await this.judgeReason(p.id, reason, target, active, [], false, {
      question: active.pendingQuestion,
      answer,
    });
    if (!accepted) {
      const ladder = {
        ...active.ladder,
        reasonRejections: active.ladder.reasonRejections + 1,
        reasonRejectionsTotal: (active.ladder.reasonRejectionsTotal ?? 0) + 1,
      };
      await this.logSystem(p, active, REASON_REJECT_MESSAGE, 'reject', null, []);
      await this.store.updateParticipant(p.id, {
        active: { ...active, turnIndex: active.turnIndex + 2, ladder },
      });
      return this.turn(active, 'question', REASON_REJECT_MESSAGE, p);
    }

    const next = {
      ...reduce(active.ladder, { kind: 'open_response' }),
      reasonRejections: 0,
    };
    if (explanationAllowed(next)) {
      const { text, degraded } = await this.explanationFor(p, active, target);
      await this.store.updateParticipant(p.id, {
        active: { ...active, turnIndex: active.turnIndex + 2, ladder: next, pendingQuestion: undefined },
      });
      return { ...(await this.turn(active, 'explanation', text, p)), degraded };
    }

    if (next.step === 'layer2') {
      const step = await this.socraticStep(p, { ...active, ladder: next }, target, 2, `答案：${answer}；理由：${reason}`);
      await this.store.updateParticipant(p.id, {
        active: {
          ...active,
          turnIndex: active.turnIndex + 2,
          ladder: next,
          pendingQuestion: step.text,
        },
      });
      return { ...(await this.turn(active, 'question', step.text, p)), degraded: step.degraded };
    }

    const prompt = target
      ? openFinalQuestion(target.text)
      : openFinalQuestion(effectiveSelection(active), perspectiveOf(active));
    await this.logSystem(p, active, prompt, 'question', null, []);
    await this.store.updateParticipant(p.id, {
      active: { ...active, turnIndex: active.turnIndex + 2, ladder: next, pendingQuestion: prompt },
    });
    return this.turn(active, 'question', prompt, p);
  }

  // ---------- helpers ----------

  private async turn(
    active: ActiveInteraction,
    kind: AssistTurn['kind'],
    text: string,
    p: Participant
  ): Promise<AssistTurn> {
    const fresh = await this.store.getParticipant(p.id);
    return {
      interactionId: active.interactionId,
      kind,
      text,
      completed: false,
      lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, fresh?.completedTargets ?? [], p.arm),
      completedTargetIds: fresh?.completedTargets ?? [],
      range: rangeOf(active),
    };
  }

  private async judgeAnswer(
    answer: string,
    target: TargetSentence | null,
    selection: string
  ): Promise<boolean> {
    if (!target) return false;
    const norm = answer.replace(/\s/g, '');
    // Single-character model answers (e.g. 「的」) must not be matched by substring:
    // "真的不知道" would otherwise count as correct.
    const hit = target.acceptableAnswers.some((a) =>
      a.length >= 2 ? norm.includes(a) : norm === a || norm.includes(`「${a}」`)
    );
    if (hit) return true;
    const { system, user } = answerJudgePrompt({
      answer,
      acceptable: target.acceptableAnswers,
      sentence: target.text || selection,
    });
    const res = await this.llm.complete(system, user);
    if (!res.ok) return false;
    const parsed = parseJsonObject<{ correct: boolean }>(res.text);
    return parsed?.correct === true;
  }

  private async judgeReason(
    participantId: string,
    reason: string,
    target: TargetSentence | null,
    active: ActiveInteraction,
    options: string[],
    failOpen = true,
    open?: { question?: string; answer?: string }
  ): Promise<boolean> {
    const sentenceText = target?.text ?? effectiveSelection(active);
    const rule = ruleCheckReason(reason, {
      sentenceText,
      optionTexts: options,
      passageText: LEARNING_PASSAGE.text,
    });
    const audit = async (accepted: boolean, details: Record<string, unknown>) => {
      await this.store.addEvent({ id: randomUUID(), participantId,
        event: 'reason_judgement', payload: { interactionId: active.interactionId,
          turnIndex: active.turnIndex + 1, accepted, ...details }, ts: new Date().toISOString() });
      return accepted;
    };
    if (rule.verdict !== 'undecided') return audit(rule.verdict === 'accept', { source: 'rule', rule: rule.rule });
    const { system, user } = reasonJudgePrompt({
      reason, sentence: sentenceText, options, question: open?.question, answer: open?.answer,
    });
    const res = await this.llm.complete(system, user);
    const parsed = parseJsonObject<{ verdict: string }>(res.text);
    const failed = !res.ok || !['accept', 'reject'].includes(parsed?.verdict ?? '');
    // Legacy choices remain fail-open. New open answers require a recognizable
    // reason, so an unavailable or malformed model verdict cannot advance them.
    return audit(failed ? failOpen : parsed?.verdict !== 'reject', { source: 'model', rule: rule.rule,
      modelFailed: failed, failOpen: failed && failOpen, rawResponse: res.raw, latencyMs: res.latencyMs });
  }

  /** Target sentences use the pre-written text, so both AI arms are identical there. */
  /**
   * WHY THE EXPLANATION STILL APPEARS WHEN THE READER GOT IT RIGHT.
   *
   * It is tempting to skip it: someone who picked correctly and justified it does not
   * need teaching. But the direct arm sees this exact text for all four target sentences,
   * every time. If the socratic arm saw it only after failing, the two arms would no
   * longer receive the same content — and they would differ in a way that tracks ability,
   * since the stronger readers would be the ones seeing less. Any S3/S5 difference would
   * then confound "was questioned instead of told" with "was shown less". Explanation
   * parity is design rule 7 and it is what makes the primary comparison mean anything.
   *
   * No prefix or per-choice addendum is appended: the entire string must match.
   */
  private async explanationFor(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null,
    _choiceResult?: { chosen: number; answerIndex: number; whyWrong: string[] },
    _confirmed = false
  ): Promise<{ text: string; degraded: boolean }> {
    let text: string;
    let degraded = false;
    let rawResponse: string | null = null;
    let latencyMs: number | null = null;
    const flags: string[] = [];
    if (target) {
      text = target.explanation;
    } else {
      text = '';
      const attempts: { raw: string; flags: string[] }[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await this.llm.complete(
          directSystemPrompt(),
          directTurnPrompt({
            passage: LEARNING_PASSAGE.text,
          selection: effectiveSelection(active),
          granularity: effectiveGranularity(active),
            perspective: perspectiveOf(active),
            retryFlags: attempt === 0 ? undefined : attempts[0]?.flags,
          })
        );
        latencyMs = (latencyMs ?? 0) + res.latencyMs;
        const parsed = parseJsonObject<{ text?: unknown }>(res.text);
        const candidate = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
        const report = checkDirectOutput(candidate, LEARNING_PASSAGE.text);
        const rejected = !res.ok || !candidate ? ['generation_failed'] : report.flags;
        attempts.push({ raw: res.raw, flags: rejected });
        if (!rejected.length) { text = candidate; break; }
        flags.push(...rejected);
      }
      rawResponse = JSON.stringify(attempts);
      if (!text) {
        text = '（系統暫時無法產生說明，請先看註解，稍後再試。）';
        degraded = true;
        await this.store.addEvent({
          id: randomUUID(),
          participantId: p.id,
          event: 'llm_failure',
          payload: { where: 'explanation', flags },
          ts: new Date().toISOString(),
        });
      }
    }
    // Pre-written target explanations are gated by `npm run validate:content`, not at
    // run time; only generated text is checked here.
    await this.log({ participantId: p.id, interactionId: active.interactionId,
      inTargetSentence: active.targetId, granularity: active.granularity,
      highlightText: active.selection, turnIndex: active.turnIndex + 2, actor: 'system',
      type: 'explain', text, strategy: null, latencyMs, rawResponse,
      leakFlags: flags, degraded });
    return { text, degraded };
  }

  /**
   * Task-A: generate a socratic MCQ for a free highlight at layer 1 or 2.
   *
   * Structural check + option-level leak check + question-level leak check.
   * On failure: regenerate ONCE; on second failure fall back to a fixed generic
   * observation MCQ whose answerIndex is not trusted at run time (any pick is
   * treated as "cannot end the ladder early"), and log an `llm_failure` event.
   */
  private async socraticChoice(
    p: Participant,
    active: ActiveInteraction,
    layer: 1 | 2
  ): Promise<GeneratedChoice> {
    const attempt = async (retryFlags?: string[]): Promise<
      | { ok: true; parsed: NonNullable<ParsedChoice>; res: { raw: string; latencyMs: number } }
      | { ok: false; flags: string[]; res: { raw: string; error?: string; ok: boolean; latencyMs: number } }
    > => {
      const start = active.focusStart ?? active.selectionStart;
      const end = active.focusEnd ?? active.selectionEnd;
      const neighborhood =
        start !== undefined && end !== undefined
          ? neighborhoodOf(LEARNING_PASSAGE.text, start, end)
          : undefined;
      const user = socraticTurnPrompt({
        passage: LEARNING_PASSAGE.text,
        selection: effectiveSelection(active),
        selectionStart: start,
        selectionEnd: end,
        neighborhood,
        layer,
        granularity: effectiveGranularity(active),
        withOptions: true,
        retryFlags,
      });
      const res = await this.llm.complete(socraticSystemPrompt(), user);
      const parsed = parseJsonObject<ParsedChoice>(res.text);
      if (!res.ok || !parsed) {
        return { ok: false, flags: ['parse:invalid_json'], res };
      }
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      const options = Array.isArray(parsed.options) && parsed.options.every(o => typeof o === 'string') ? parsed.options as string[] : [];
      const answerIndex = Number.isInteger(parsed.answerIndex) ? Number(parsed.answerIndex) : -1;
      if (!text) return { ok: false, flags: ['parse:empty_text'], res };
      const questionLeak = checkSocraticOutput(text);
      if ([...effectiveSelection(active).replace(/[\s，、。！？；：「」『』（）]/g, '')].length > 1 && text.includes('這個字')) {
        questionLeak.flags.push('selection_reference'); questionLeak.ok = false;
      }
      const optionsLeak = checkSocraticOptions(options);
      const structural = validateChoiceStructure(options, answerIndex);
      if (!questionLeak.ok || !optionsLeak.ok || !structural.ok) {
        return {
          ok: false,
          flags: [...questionLeak.flags, ...optionsLeak.flags, ...structural.flags],
          res,
        };
      }
      return { ok: true, parsed: { ...parsed, text, options, answerIndex }, res };
    };

    const first = await attempt();
    if (first.ok) {
      return {
        text: first.parsed.text as string,
        options: first.parsed.options as string[],
        answerIndex: first.parsed.answerIndex as number,
        strategy: firstStrategy(first.parsed.strategy),
        degraded: false,
        rawResponse: first.res.raw,
        latencyMs: first.res.latencyMs,
        leakFlags: [],
      };
    }
    const second = await attempt(first.flags);
    if (second.ok) {
      return {
        text: second.parsed.text as string,
        options: second.parsed.options as string[],
        answerIndex: second.parsed.answerIndex as number,
        strategy: firstStrategy(second.parsed.strategy),
        degraded: false,
        rawResponse: JSON.stringify([{ raw: first.res.raw, flags: first.flags }, { raw: second.res.raw, flags: [] }]),
        latencyMs: first.res.latencyMs + second.res.latencyMs,
        // flag that this reached the reader on the second try (still no leak)
        leakFlags: ['regenerated'],
      };
    }
    // Fallback MCQ. answerIndex is intentionally null: no pick can end the ladder early.
    await this.store.addEvent({
      id: randomUUID(),
      participantId: p.id,
      event: 'llm_failure',
      payload: {
        where: `socratic_choice_layer${layer}`,
        error: second.res.error ?? 'leak_or_structure_or_empty',
        flags: [...first.flags, ...second.flags],
      },
      ts: new Date().toISOString(),
    });
    return {
      text: fallbackChoiceStem(effectiveGranularity(active)),
      options: FALLBACK_SOCRATIC_MCQ.options,
      answerIndex: null,
      strategy: null,
      degraded: true,
      rawResponse: JSON.stringify([{ raw: first.res.raw, flags: first.flags }, { raw: second.res.raw, flags: second.flags }]),
      latencyMs: first.res.latencyMs + second.res.latencyMs,
      leakFlags: ['fallback_choice', ...first.flags, ...second.flags],
    };
  }

  private async socraticOpenQuestion(
    p: Participant,
    active: ActiveInteraction,
    layer: 1 | 2,
    lastReaderTurn?: string
  ): Promise<GeneratedOpenQuestion> {
    const start = active.focusStart ?? active.selectionStart;
    const end = active.focusEnd ?? active.selectionEnd;
    const neighborhood = start !== undefined && end !== undefined
      ? neighborhoodOf(LEARNING_PASSAGE.text, start, end)
      : undefined;
    const attempts: { raw: string; flags: string[] }[] = [];
    let latencyMs = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.llm.complete(
        socraticOpenSystemPrompt(),
        socraticTurnPrompt({
          passage: LEARNING_PASSAGE.text,
          selection: effectiveSelection(active),
          selectionStart: start,
          selectionEnd: end,
          neighborhood,
          layer,
          granularity: effectiveGranularity(active),
          lastReaderTurn,
          perspective: perspectiveOf(active),
          retryFlags: attempt ? attempts[0].flags : undefined,
        })
      );
      latencyMs += result.latencyMs;
      const parsed = parseJsonObject<{ type?: unknown; text?: unknown; options?: unknown; answerIndex?: unknown }>(result.text);
      const candidate = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
      const flags = !result.ok || !parsed || parsed.type !== 'question' || !candidate
        ? ['parse:invalid_question']
        : [...checkSocraticOutput(candidate).flags];
      if (candidate && !/[？?]/.test(candidate)) flags.push('not_question');
      if (parsed && ('options' in parsed || 'answerIndex' in parsed)) flags.push('unexpected_options');
      if ([...effectiveSelection(active).replace(/[\s，、。！？；：「」『』（）]/g, '')].length > 1 && candidate.includes('這個字')) {
        flags.push('selection_reference');
      }
      attempts.push({ raw: result.raw, flags });
      if (!flags.length) {
        return {
          text: candidate,
          degraded: false,
          rawResponse: attempts.length === 1 ? result.raw : JSON.stringify(attempts),
          latencyMs,
          leakFlags: attempts.length === 1 ? [] : ['regenerated'],
        };
      }
    }
    await this.store.addEvent({
      id: randomUUID(), participantId: p.id, event: 'llm_failure',
      payload: { where: `socratic_question_layer${layer}`, flags: attempts.flatMap(a => a.flags) },
      ts: new Date().toISOString(),
    });
    return {
      text: openFallbackQuestion(effectiveSelection(active), layer),
      degraded: true,
      rawResponse: JSON.stringify(attempts),
      latencyMs,
      leakFlags: ['fallback_question', ...attempts.flatMap(a => a.flags)],
    };
  }

  private async directExplanation(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null
  ) {
    return this.explanationFor(p, active, target);
  }

  private async focusCandidates(p: Participant, active: ActiveInteraction): Promise<GeneratedFocus> {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    const neighborhood = start !== undefined && end !== undefined
      ? neighborhoodOf(LEARNING_PASSAGE.text, start, end)
      : undefined;
    const attempts: { raw: string; flags: string[] }[] = [];
    let latencyMs = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.llm.complete(
        focusOptionsSystemPrompt(),
        focusOptionsPrompt({ selection: active.selection, neighborhood })
      );
      latencyMs += result.latencyMs;
      const parsed = parseJsonObject<{ options?: unknown }>(result.text);
      const report = result.ok
        ? validateFocusOptions(parsed?.options, active.selection, LEARNING_PASSAGE.annotations)
        : { ok: false, options: [] as string[], flags: ['focus:generation_failed'] };
      attempts.push({ raw: result.raw, flags: report.flags });
      if (report.ok) {
        return {
          options: report.options,
          degraded: false,
          rawResponse: attempts.length === 1 ? result.raw : JSON.stringify(attempts),
          latencyMs,
          flags: attempts.length === 1 ? [] : ['regenerated'],
        };
      }
    }
    const options = fallbackFocusOptions(active.selection, LEARNING_PASSAGE.annotations);
    await this.store.addEvent({
      id: randomUUID(),
      participantId: p.id,
      event: 'llm_failure',
      payload: { where: 'focus_options', flags: attempts.flatMap(item => item.flags) },
      ts: new Date().toISOString(),
    });
    return {
      options,
      degraded: true,
      rawResponse: JSON.stringify(attempts),
      latencyMs,
      flags: ['fallback_focus', ...attempts.flatMap(item => item.flags)],
    };
  }

  /** v5.12: drop the open interaction without completing it (see isCancellable). */
  async cancel(p: Participant): Promise<AssistTurn> {
    const active = p.active;
    if (!active) throw new Error('no open interaction');
    if (!isCancellable(active)) throw new Error('cannot cancel after answering');
    await this.logUser(p, active, '（取消這次選取）');
    await this.store.addEvent({
      id: randomUUID(),
      participantId: p.id,
      event: 'selection_cancelled',
      payload: {
        interactionId: active.interactionId,
        targetId: active.targetId,
        selection: active.selection,
        granularity: active.granularity,
        step: active.perspectivePending ? 'perspective' : active.ladder.step,
        elapsedMs: Date.now() - new Date(active.startedTs).getTime(),
      },
      ts: new Date().toISOString(),
    });
    const saved = await this.store.updateParticipant(p.id, { active: null });
    return {
      interactionId: active.interactionId,
      kind: 'none',
      text: '',
      completed: false,
      cancelled: true,
      lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets, p.arm),
      completedTargetIds: saved.completedTargets,
    };
  }

  private async completeInteraction(
    p: Participant,
    active: ActiveInteraction,
    reason: 'read_done' | 'control'
  ) {
    const ladder = reason === 'read_done' ? reduce(active.ladder, { kind: 'read_done' }) : active.ladder;
    const completedTargets = active.targetId
      ? Array.from(new Set([...p.completedTargets, active.targetId]))
      : p.completedTargets;
    await this.store.addEvent({
      id: randomUUID(),
      participantId: p.id,
      event: 'read_done_click',
      payload: {
        interactionId: active.interactionId,
        targetId: active.targetId,
        granularity: active.granularity,
        endPosition: p.arm === 'socratic' ? endPosition(ladder) : 'n/a',
        reasonRejections: ladder.reasonRejections,
        reasonInsufficient: ladder.reasonInsufficient,
        elapsedMs: Date.now() - new Date(active.startedTs).getTime(),
      },
      ts: new Date().toISOString(),
    });
    const met = lowerBoundMet(LEARNING_PASSAGE, completedTargets, p.arm);
    if (
      lowerBoundMet(LEARNING_PASSAGE, completedTargets) &&
      !lowerBoundMet(LEARNING_PASSAGE, p.completedTargets)
    ) {
      await this.store.addEvent({
        id: randomUUID(),
        participantId: p.id,
        event: 'lower_bound_met',
        payload: { at: new Date().toISOString() },
        ts: new Date().toISOString(),
      });
    }
    await this.store.updateParticipant(p.id, { completedTargets, active: null });
    return { completed: true, lowerBoundMet: met, completedTargetIds: completedTargets };
  }

  private logUser(p: Participant, active: ActiveInteraction, text: string) {
    return this.log({
      participantId: p.id,
      interactionId: active.interactionId,
      inTargetSentence: active.targetId,
      granularity: active.granularity,
      highlightText: active.selection,
      turnIndex: active.turnIndex + 1,
      actor: 'user',
      type: 'user',
      text,
      strategy: null,
      latencyMs: null,
      rawResponse: null,
      leakFlags: [],
    });
  }

  private logSystem(
    p: Participant,
    active: ActiveInteraction,
    text: string,
    type: InteractionRow['type'],
    strategy: InteractionRow['strategy'],
    leakFlags: string[]
  ) {
    return this.log({
      participantId: p.id,
      interactionId: active.interactionId,
      inTargetSentence: active.targetId,
      granularity: active.granularity,
      highlightText: active.selection,
      turnIndex: active.turnIndex + 2,
      actor: 'system',
      type,
      text,
      strategy,
      latencyMs: null,
      rawResponse: null,
      leakFlags,
    });
  }
}

type ParsedChoice = {
  text?: string;
  strategy?: string;
  options?: unknown[];
  answerIndex?: number;
} | null;

function firstStrategy(s: string | undefined): 'A' | 'B' | 'C' | 'D' | null {
  return s === 'A' || s === 'B' || s === 'C' || s === 'D' ? s : null;
}

function fallbackChoiceStem(g: ActiveInteraction['granularity']): string {
  return g === 'word'
    ? '你選的這個字，在句子裡最像扮演下面哪一種角色？'
    : FALLBACK_SOCRATIC_MCQ.stem;
}

function rangeOf(active: ActiveInteraction): { start: number; end: number } | undefined {
  return active.selectionStart !== undefined && active.selectionEnd !== undefined
    ? { start: active.selectionStart, end: active.selectionEnd }
    : undefined;
}

/** The reader's perspective as prompt data; undefined for target sentences and pre-v5.9 rows. */
function perspectiveOf(active: ActiveInteraction): { text: string; source: 'typed' | 'default' } | undefined {
  return active.perspective
    ? { text: active.perspective, source: active.perspectiveSource ?? 'typed' }
    : undefined;
}

function effectiveSelection(active: ActiveInteraction): string {
  return active.focusSelection ?? active.selection;
}

function effectiveGranularity(active: ActiveInteraction): ActiveInteraction['granularity'] {
  return active.focusSelection ? classifyGranularity(active.focusSelection) : active.granularity;
}

function withFocus(
  active: ActiveInteraction,
  value: string,
  source: 'suggestion' | 'other' | 'question'
): ActiveInteraction {
  const local = active.selection.indexOf(value);
  const start = local >= 0 && active.selectionStart !== undefined
    ? active.selectionStart + local
    : undefined;
  return {
    ...active,
    focusSelection: value,
    focusStart: start,
    focusEnd: start === undefined ? undefined : start + value.length,
    focusSource: source,
    focusPending: false,
  };
}

// Mental effort is recorded immediately after S2. Putting S3 first would make the
// retrospective rating mix reading load with the immediate test itself.
export const STAGE_ORDER: Participant['stage'][] = ['S0', 'S1', 'S2', 'S4', 'S3', 'S5', 'S6', 'DONE'];

export function nextStage(stage: Participant['stage']): Participant['stage'] {
  const i = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
}

export function stageLimits(stage: Participant['stage']) {
  const s = CONFIG.stageSeconds as Record<string, { min: number; max: number } | undefined>;
  return s[stage] ?? { min: 0, max: 3600 };
}

/**
 * The layer-3 multiple choice for a highlight. Module-level so the state route can
 * rebuild it after a page reload without instantiating an Engine.
 */
export function choiceForSelection(target: TargetSentence | null, selection: string) {
  if (target) return target.choice;
  // Unresolved research limitation: these generic options/key are NOT grounded in
  // arbitrary selections. Retained pending a researcher-approved design decision;
  // do not treat this as a validated semantic bottom-out (see review guide §6).
  return {
    prompt: `「${selection}」在這句話裡比較像哪一種用法？`,
    options: ['表示一個動作的對象', '連接前後兩件事', '形容前面的名詞'],
    answerIndex: 0,
    whyWrong: ['', '', ''],
  };
}

/**
 * Rebuild the turn the reader is looking at, for a participant who reloaded the page
 * mid-interaction.
 *
 * Task-A free highlights: the layer-1/2 MCQ is restored from `active.activeChoice`
 * (persisted on the participant record). Layer 3 falls back to `choiceForSelection`.
 */
/**
 * v5.12: a reader may drop a mistaken highlight and select again, but only before they have
 * submitted an answer and before any explanation is shown. Both arms can cancel at the
 * 「想問什麼」 step; the socratic arm can also cancel at layer 1 until its first answer. The
 * direct arm reaches the explanation right after that step, so it has nothing later to cancel.
 * An explanation is never shown in a cancelled interaction, so cancelling cannot be used to
 * preview answers.
 */
export function isCancellable(active: ActiveInteraction): boolean {
  if (active.answerMode !== 'open') return false;
  if (active.perspectivePending) return true;
  return active.ladder.step === 'layer1' && (active.ladder.reasonRejectionsTotal ?? 0) === 0;
}

export function pendingTurnFor(
  p: Participant,
  lastSystemText: string
): {
  kind: AssistTurn['kind'];
  text: string;
  choice?: { prompt: string; options: string[] };
  focus?: { options: string[]; allowOther: true };
} | null {
  const active = p.active;
  if (!active) return null;
  if (active.answerMode === 'open') {
    if (active.focusPending) {
      return { kind: 'focus', text: lastSystemText || '你主要想問這段文字裡的哪一個字或詞？請自行輸入反白範圍內的字詞。' };
    }
    if (active.perspectivePending) {
      return { kind: 'perspective', text: lastSystemText || PERSPECTIVE_PROMPT };
    }
    if (['layer1', 'layer2', 'layer3_choice'].includes(active.ladder.step)) {
      return { kind: 'question', text: active.pendingQuestion ?? lastSystemText };
    }
    if (active.ladder.step === 'explanation') return { kind: 'explanation', text: lastSystemText };
    return null;
  }
  if (active.focusPending && active.focusOptions) {
    return {
      kind: 'focus',
      text: lastSystemText || '你主要想問這一段裡的哪一個字或詞？',
      focus: { options: active.focusOptions, allowOther: true },
    };
  }
  const target = LEARNING_PASSAGE.targets.find((t) => t.id === active.targetId) ?? null;
  const bottom = choiceForSelection(target, effectiveSelection(active));

  const layerSpec =
    active.ladder.step === 'layer1'
      ? target?.layer1Choice
      : active.ladder.step === 'layer2'
        ? target?.layer2Choice
        : undefined;

  switch (active.ladder.step) {
    case 'layer1':
    case 'layer2':
      if (layerSpec) {
        const prompt = active.ladder.step === 'layer1' ? target!.layer1 : target!.layer2;
        return {
          kind: 'choice',
          text: lastSystemText || prompt,
          choice: { prompt, options: layerSpec.options },
        };
      }
      // Task-A free highlight: rebuild the generated MCQ from what was persisted.
      if (active.activeChoice) {
        return {
          kind: 'choice',
          text: lastSystemText,
          choice: { prompt: lastSystemText, options: active.activeChoice.options },
        };
      }
      // A pre-Task-A row with no activeChoice: keep the open-text shape rather than
      // guess. The reply handler's 'answer' path still works for that case.
      return { kind: 'question', text: lastSystemText };
    case 'layer3_choice':
      return {
        kind: 'choice',
        text: lastSystemText || bottom.prompt,
        choice: { prompt: bottom.prompt, options: bottom.options },
      };
    case 'reason_rejected':
      return {
        kind: 'reject',
        text: lastSystemText,
        choice: { prompt: bottom.prompt, options: bottom.options },
      };
    case 'explanation':
      return { kind: 'explanation', text: lastSystemText };
    default:
      return null;
  }
}
