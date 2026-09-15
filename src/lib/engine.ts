import { randomUUID } from 'node:crypto';
import { LEARNING_PASSAGE } from '../content/passages';
import { CONFIG } from './config';
import { classifyGranularity, lowerBoundMet, matchTarget } from './highlight';
import { endPosition, initialLadder, reduce, explanationAllowed } from './ladder';
import { checkDirectOutput, checkSocraticOutput } from './leak';
import { getProvider, parseJsonObject, type LlmProvider } from './llm';
import {
  answerJudgePrompt,
  directSystemPrompt,
  directTurnPrompt,
  reasonJudgePrompt,
  socraticSystemPrompt,
  socraticTurnPrompt,
} from './prompts';
import { REASON_REJECT_MESSAGE, ruleCheckReason } from './reasonGate';
import type { Store } from './store';
import type { ActiveInteraction, InteractionRow, Participant, TargetSentence } from './types';

export interface AssistTurn {
  interactionId: string;
  /** what the reader sees next */
  kind: 'question' | 'choice' | 'reject' | 'explanation' | 'none';
  text: string;
  choice?: { prompt: string; options: string[] };
  /** true once this interaction counts towards the lower bound */
  completed: boolean;
  lowerBoundMet: boolean;
  degraded?: boolean;
}

const FALLBACK_QUESTION = '這個字在句子什麼位置？前後是什麼詞性？';

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

  /** A highlight. One open interaction per participant; a new highlight replaces it. */
  async startAssist(p: Participant, selection: string): Promise<AssistTurn> {
    const granularity = classifyGranularity(selection);
    const targetId = matchTarget(LEARNING_PASSAGE, selection);
    const target = this.target(targetId);
    const active: ActiveInteraction = {
      interactionId: randomUUID(),
      targetId,
      selection,
      granularity,
      turnIndex: 0,
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
      return { ...completed, kind: 'none', text: '', interactionId: active.interactionId };
    }

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
        lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets),
        degraded,
      };
    }

    // socratic: layer 1
    const { text, degraded } = await this.socraticQuestion(p, active, target, 1);
    const saved = await this.store.updateParticipant(p.id, { active: { ...active, turnIndex: 1 } });
    return {
      interactionId: active.interactionId,
      kind: 'question',
      text,
      completed: false,
      lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, saved.completedTargets),
      degraded,
    };
  }

  /** A reader turn: free-text answer, a multiple-choice answer with a reason, or 看完了. */
  async reply(
    p: Participant,
    payload:
      | { kind: 'answer'; text: string }
      | { kind: 'choice'; index: number; reason: string }
      | { kind: 'read_done' }
  ): Promise<AssistTurn> {
    const active = p.active;
    if (!active) throw new Error('no open interaction');
    const target = this.target(active.targetId);

    if (payload.kind === 'read_done') {
      const done = await this.completeInteraction(p, active, 'read_done');
      return { ...done, kind: 'none', text: '', interactionId: active.interactionId };
    }

    if (p.arm !== 'socratic') throw new Error('only the socratic arm has reader turns');

    if (payload.kind === 'answer') {
      await this.logUser(p, active, payload.text);
      const correct = await this.judgeAnswer(payload.text, target, active.selection);
      const hasReason =
        ruleCheckReason(payload.text, {
          sentenceText: target?.text ?? active.selection,
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
        const { text, degraded } = await this.explanationFor(p, active, target);
        await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
        });
        return { ...(await this.turn(active, 'explanation', text, p)), degraded };
      }

      if (next.step === 'layer2') {
        const { text, degraded } = await this.socraticQuestion(p, active, target, 2);
        await this.store.updateParticipant(p.id, {
          active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
        });
        return { ...(await this.turn(active, 'question', text, p)), degraded };
      }

      // layer 3: the multiple choice
      const choice = this.choiceFor(target, active);
      await this.logSystem(p, active, choice.prompt, 'choice', null, []);
      await this.store.updateParticipant(p.id, {
        active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
      });
      return {
        ...(await this.turn(active, 'choice', choice.prompt, p)),
        choice: { prompt: choice.prompt, options: choice.options },
      };
    }

    // payload.kind === 'choice'
    const choice = this.choiceFor(target, active);
    await this.logUser(p, active, `選項${payload.index + 1}｜理由：${payload.reason}`);
    const gate = await this.judgeReason(payload.reason, target, active, choice.options);
    const afterChoice = reduce(active.ladder, {
      kind: 'choice',
      index: payload.index,
      correct: payload.index === choice.answerIndex,
    });
    const next = reduce(afterChoice, { kind: 'reason', accepted: gate });

    if (!explanationAllowed(next)) {
      await this.logSystem(p, active, REASON_REJECT_MESSAGE, 'reject', null, []);
      await this.store.updateParticipant(p.id, {
        active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
      });
      return this.turn(active, 'reject', REASON_REJECT_MESSAGE, p);
    }

    const { text, degraded } = await this.explanationFor(p, active, target, {
      chosen: payload.index,
      answerIndex: choice.answerIndex,
      whyWrong: choice.whyWrong,
    });
    await this.store.updateParticipant(p.id, {
      active: { ...active, turnIndex: active.turnIndex + 2, ladder: next },
    });
    return { ...(await this.turn(active, 'explanation', text, p)), degraded };
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
      lowerBoundMet: lowerBoundMet(LEARNING_PASSAGE, fresh?.completedTargets ?? []),
    };
  }

  private choiceFor(target: TargetSentence | null, active: ActiveInteraction) {
    if (target) return target.choice;
    // Free highlights have no pre-written choice; fall back to a generic one so the
    // reader is never stuck. Generated choices are NOT used, because their quality
    // cannot be checked at run time (design doc: pilot checks all generated items).
    return {
      prompt: `「${active.selection}」在這句話裡比較像哪一種用法？`,
      options: ['表示一個動作的對象', '連接前後兩件事', '形容前面的名詞'],
      answerIndex: 0,
      whyWrong: ['', '', ''],
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
    reason: string,
    target: TargetSentence | null,
    active: ActiveInteraction,
    options: string[]
  ): Promise<boolean> {
    const sentenceText = target?.text ?? active.selection;
    const rule = ruleCheckReason(reason, { sentenceText, optionTexts: options });
    if (rule.verdict !== 'undecided') return rule.verdict === 'accept';
    const { system, user } = reasonJudgePrompt({ reason, sentence: sentenceText, options });
    const res = await this.llm.complete(system, user);
    if (!res.ok) return true; // fail open: never trap a reader because the API is down
    const parsed = parseJsonObject<{ verdict: string }>(res.text);
    return parsed?.verdict !== 'reject';
  }

  /** Target sentences use the pre-written text, so both AI arms are identical there. */
  private async explanationFor(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null,
    choiceResult?: { chosen: number; answerIndex: number; whyWrong: string[] }
  ): Promise<{ text: string; degraded: boolean }> {
    let text: string;
    let degraded = false;
    if (target) {
      text = target.explanation;
      if (choiceResult && choiceResult.chosen !== choiceResult.answerIndex) {
        const why = choiceResult.whyWrong[choiceResult.chosen];
        if (why) text += `\n${why}`;
      }
    } else {
      const res = await this.llm.complete(
        directSystemPrompt(),
        directTurnPrompt({
          passage: LEARNING_PASSAGE.text,
          selection: active.selection,
          granularity: active.granularity,
        })
      );
      const parsed = parseJsonObject<{ text: string }>(res.text);
      text = parsed?.text ?? '';
      if (!res.ok || !text) {
        text = '（系統暫時無法產生說明，請先看註解，稍後再試。）';
        degraded = true;
        await this.store.addEvent({
          id: randomUUID(),
          participantId: p.id,
          event: 'llm_failure',
          payload: { where: 'explanation', error: res.error ?? 'empty' },
          ts: new Date().toISOString(),
        });
      }
    }
    // Pre-written target explanations are gated by `npm run validate:content`, not at
    // run time; only generated text is checked here.
    const leak = target ? { ok: true, flags: [] as string[] } : checkDirectOutput(text, LEARNING_PASSAGE.text);
    await this.logSystem(p, active, text, 'explain', null, leak.flags);
    return { text, degraded };
  }

  private async socraticQuestion(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null,
    layer: 1 | 2
  ): Promise<{ text: string; degraded: boolean }> {
    // Target sentences use fixed wording: identical for every participant.
    if (target) {
      const text = layer === 1 ? target.layer1 : target.layer2;
      await this.logSystem(p, active, text, 'question', layer === 1 ? 'C' : 'A', []);
      return { text, degraded: false };
    }
    const res = await this.llm.complete(
      socraticSystemPrompt(),
      socraticTurnPrompt({ passage: LEARNING_PASSAGE.text, selection: active.selection, layer })
    );
    const parsed = parseJsonObject<{ text: string; strategy?: 'A' | 'B' | 'C' | 'D' }>(res.text);
    let text = parsed?.text ?? '';
    let leak = checkSocraticOutput(text);
    let degraded = false;
    if (!res.ok || !text || !leak.ok) {
      // one regeneration, then fall back to the fixed stem
      const retry = await this.llm.complete(
        socraticSystemPrompt(),
        socraticTurnPrompt({ passage: LEARNING_PASSAGE.text, selection: active.selection, layer })
      );
      const retryParsed = parseJsonObject<{ text: string }>(retry.text);
      const retryText = retryParsed?.text ?? '';
      const retryLeak = checkSocraticOutput(retryText);
      if (retry.ok && retryText && retryLeak.ok) {
        text = retryText;
        leak = retryLeak;
      } else {
        text = FALLBACK_QUESTION;
        leak = { ok: true, flags: ['fallback_stem'] };
        degraded = true;
        await this.store.addEvent({
          id: randomUUID(),
          participantId: p.id,
          event: 'llm_failure',
          payload: { where: `socratic_layer${layer}`, error: res.error ?? 'leak_or_empty' },
          ts: new Date().toISOString(),
        });
      }
    }
    await this.logSystem(p, active, text, 'question', parsed?.strategy ?? null, leak.flags);
    return { text, degraded };
  }

  private async directExplanation(
    p: Participant,
    active: ActiveInteraction,
    target: TargetSentence | null
  ) {
    return this.explanationFor(p, active, target);
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
    const met = lowerBoundMet(LEARNING_PASSAGE, completedTargets);
    if (met && !lowerBoundMet(LEARNING_PASSAGE, p.completedTargets)) {
      await this.store.addEvent({
        id: randomUUID(),
        participantId: p.id,
        event: 'lower_bound_met',
        payload: { at: new Date().toISOString() },
        ts: new Date().toISOString(),
      });
    }
    await this.store.updateParticipant(p.id, { completedTargets, active: null });
    return { completed: true, lowerBoundMet: met };
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

export const STAGE_ORDER: Participant['stage'][] = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'DONE'];

export function nextStage(stage: Participant['stage']): Participant['stage'] {
  const i = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
}

export function stageLimits(stage: Participant['stage']) {
  const s = CONFIG.stageSeconds as Record<string, { min: number; max: number } | undefined>;
  return s[stage] ?? { min: 0, max: 3600 };
}
