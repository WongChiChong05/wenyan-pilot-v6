import { randomUUID } from 'node:crypto';
import { ITEMS_BY_STAGE } from '../content/items';
import { TRAINING_PASSAGES } from '../content/passages';
import { TRANSLATION_BY_STAGE } from '../content/translation';
import { ApiError, delayedFlag, insist, object, string, token } from './api';
import { CONFIG } from './config';
import { cognitiveLoadMeans, validCognitiveLoadRatings, type CognitiveLoadRatings } from './cognitiveLoad';
import { validateContent } from './contentValidation';
import { Engine, isCancellable, nextStage, pendingTurnFor, stageLimits, trainingPassageFor } from './engine';
import { focusOccursInSelection } from './focus';
import { lowerBoundApplies, lowerBoundMet } from './highlight';
import { assignArm, stratumOf } from './randomize';
import { scoreQuiz, type SubmittedAnswer } from './scoring';
import type { Store } from './store';
import type { Arm, EventRow, Participant, Progress, Stage, TranslationRow, TranslationStage } from './types';
import { buildStageView } from './view';

type Body = Record<string, unknown>;
const iso = () => new Date().toISOString();
const quizStage = (value: unknown): value is keyof typeof ITEMS_BY_STAGE => typeof value === 'string' && Object.hasOwn(ITEMS_BY_STAGE, value);
const GENDERS = ['男性', '女性', '非二元／其他', '不願透露'] as const;
const requiredString = (value: unknown, name: string, max: number) => {
  const result = string(value, name, max).trim();
  insist(result.length > 0, `${name} required`);
  return result;
};
const normaliseEmail = (value: unknown) => {
  const result = requiredString(value, 'email', 254).toLowerCase();
  insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result), 'invalid email');
  return result;
};
const addEvent = (store: Store, id: string, event: EventRow['event'], payload: Record<string, unknown>) =>
  store.addEvent({ id: randomUUID(), participantId: id, event, payload, ts: iso() });

export function delayedWindow(p: Participant) {
  const finished = Date.parse(p.stageEnteredTs.S6 ?? '');
  insist(Number.isFinite(finished), 'missing main-session completion time', 409);
  return { opensAt: finished + CONFIG.delayedTest.minHours * 3600000, closesAt: finished + CONFIG.delayedTest.maxHours * 3600000 };
}
export function assertAccess(p: Participant, delayed: boolean) {
  if (delayed) {
    insist(p.stage === 'S6', 'delayed test unavailable', 409);
    const window = delayedWindow(p);
    insist(Date.now() >= window.opensAt, '延遲測驗尚未開放。', 409);
    insist(Date.now() <= window.closesAt, '延遲測驗已超過作答期限。', 409);
  } else insist(p.stage !== 'S6' && p.stage !== 'DONE', 'use delayed test link', 409);
}
export function elapsedSeconds(p: Participant): number {
  // v6: S2 is timed per training passage; every other stage from when it was entered.
  const passageStart = p.stage === 'S2' ? p.progress?.passageEnteredTs[p.progress.trainingIndex] : undefined;
  const start = p.stage === 'S6' ? p.delayedStartedTs : passageStart ?? p.stageEnteredTs[p.stage];
  const time = Date.parse(start ?? '');
  insist(Number.isFinite(time), 'stage not started', 409);
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}
async function participant(store: Store, body: Body) {
  const delayed = delayedFlag(body.delayed);
  const p = await store.getParticipantByToken(token(body.token), delayed ? 'delayed' : 'main');
  insist(p, 'unknown token', 404);
  return { p, delayed };
}
const isTranslationStage = (stage: Stage): stage is TranslationStage => stage === 'S1b' || stage === 'S5a' || stage === 'S5b';
const hanCount = (text: string) => [...text].filter(c => /[\u3400-\u9fff]/u.test(c)).length;

async function enter(store: Store, p: Participant, patch: Partial<Participant> = {}) {
  const stage = nextStage(p.stage);
  const now = iso();
  const base: Progress = patch.progress ?? p.progress ?? { trainingIndex: 0, passageEnteredTs: [] };
  let progress: Progress = { ...base, translation: null };
  // v6: entering S2 starts the first training passage; entering a translation stage shows
  // its first sentence. Both clocks are server-side.
  if (stage === 'S2') progress = { trainingIndex: 0, passageEnteredTs: [now], translation: null };
  if (isTranslationStage(stage)) progress = { ...progress, translation: { stage, index: 0, shownTs: now } };
  await store.updateParticipant(p.id, { ...patch, progress, stage, active: null, stageEnteredTs: { ...p.stageEnteredTs, [stage]: now } });
  await addEvent(store, p.id, 'stage_enter', { stage });
  if (stage === 'S2') await addEvent(store, p.id, 'passage_enter', { index: 0, passageId: TRAINING_PASSAGES[0].id });
  if (isTranslationStage(stage)) await addEvent(store, p.id, 'translation_shown', { stage, index: 0, itemId: TRANSLATION_BY_STAGE[stage][0]?.id });
  return { ok: true, stage };
}

export async function createSession(store: Store, body: Body) {
  insist(body.consent === true, 'consent required');
  insist(typeof body.chineseMajor === 'boolean' && typeof body.readBefore === 'boolean', 'screening answers required');
  insist(Number.isInteger(body.age) && Number(body.age) >= 16 && Number(body.age) <= 80, 'age must be an integer 16-80');
  insist(typeof body.gender === 'string' && GENDERS.includes(body.gender as typeof GENDERS[number]), 'invalid gender');
  const major = requiredString(body.major, 'major', 200);
  const email = normaliseEmail(body.email);
  const mode = process.env.STUDY_MODE ?? (process.env.NODE_ENV === 'production' ? '' : 'dry-run');
  insist(mode === 'dry-run' || mode === 'collection', 'STUDY_MODE must be set', 503);
  if (mode === 'collection') {
    insist(validateContent().errors.length === 0, '教材尚未完成簽核或檢查未通過，不能收案。', 503);
    insist(['gemini', 'anthropic'].includes(process.env.LLM_PROVIDER ?? '') && !!CONFIG.llm.model, 'real provider and model required', 503);
    insist(!!process.env[process.env.LLM_PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'], 'provider key required', 503);
  }
  const now = iso();
  const p: Participant = {
    id: randomUUID(), token: randomUUID(), delayedToken: randomUUID(), arm: 'control', stage: 'S1', stratum: null, pretestScore: null,
    consentTs: now,
    demographics: {
      age: body.age as number,
      gender: body.gender as string,
      major,
      grade: string(body.grade ?? '', 'grade', 200).trim(),
      aiUsage: requiredString(body.aiUsage, 'aiUsage', 200),
      chineseMajor: body.chineseMajor,
      readBefore: body.readBefore,
    },
    excludeFlags: [...(body.chineseMajor ? ['chinese_major'] : []), ...(body.readBefore ? ['read_before'] : [])],
    stageEnteredTs: { S0: now, S1: now }, completedTargets: [], active: null,
    studyConfig: { mode, config: CONFIG, provider: process.env.LLM_PROVIDER ?? 'auto/mock', stratumLow: Number(process.env.STRATUM_LOW ?? 3), stratumHigh: Number(process.env.STRATUM_HIGH ?? 6) },
  };
  await store.createParticipant(p);
  await store.createContact({ participantId: p.id, email, createdTs: now });
  await addEvent(store, p.id, 'stage_enter', { stage: 'S1' });
  return { token: p.token, eligible: p.excludeFlags.length === 0 };
}

export async function submitQuiz(store: Store, body: Body) {
  insist(quizStage(body.stage), 'invalid quiz stage');
  const { p, delayed } = await participant(store, body);
  if (p.stage !== body.stage) {
    // Keep the original responses. A repeated submit is observable, not rescored.
    const previous = (await store.listResponses()).some(r => r.participantId === p.id && r.stage === body.stage);
    if (previous) {
      await addEvent(store, p.id, 'duplicate_submission', { stage: body.stage });
      return { ok: true, stage: p.stage, duplicate: true };
    }
    throw new ApiError(409, 'stage mismatch');
  }
  assertAccess(p, delayed);
  const elapsed = elapsedSeconds(p);
  // v6: the S5b decode items come after its translation sentences.
  if (p.stage === 'S5b') insist(p.progress?.translation?.translationsDone, 'translations not finished', 409);
  const items = ITEMS_BY_STAGE[body.stage];
  insist(Array.isArray(body.answers) && body.answers.length <= items.length, 'invalid answers');
  const seen = new Set<string>();
  const answers: SubmittedAnswer[] = body.answers.map(value => {
    const a = object(value);
    const id = string(a.itemId, 'itemId', 100);
    const item = items.find(i => i.id === id);
    insist(item && !seen.has(id), 'unknown or repeated item'); seen.add(id);
    insist(a.chosen === null || (Number.isInteger(a.chosen) && Number(a.chosen) >= 0 && Number(a.chosen) < item.options.length), 'invalid choice');
    insist(Number.isInteger(a.rtMs) && Number(a.rtMs) >= 0 && Number(a.rtMs) <= 2147483647, 'invalid response time');
    return { itemId: id, chosen: a.chosen as number | null, rtMs: a.rtMs as number };
  });
  const limits = stageLimits(p.stage);
  const timedOut = elapsed >= limits.max;
  insist(body.reason === undefined || body.reason === 'user' || body.reason === 'timeout', 'invalid reason');
  if (body.reason === 'timeout') insist(timedOut, 'timeout not reached', 409);
  const scored = scoreQuiz(items, answers);
  const now = iso();
  await store.addResponses(scored.rows.map(r => ({ ...r, id: randomUUID(), participantId: p.id, ts: now })));
  const flags = [...p.excludeFlags];
  if (scored.attentionCheckFailed) flags.push(`attention_fail_${p.stage}`);
  if (answers.some(a => a.rtMs < CONFIG.exclusion.minSecondsPerItem * 1000)) flags.push(`too_fast_${p.stage}`);
  if (elapsed < limits.min) flags.push(`below_min_time_${p.stage}`);
  if (timedOut) flags.push(`timeout_${p.stage}`);
  for (const row of scored.rows.filter(r => r.chosen === null)) await addEvent(store, p.id, 'item_skip', { stage: p.stage, itemId: row.itemId });
  const patch: Partial<Participant> = { excludeFlags: [...new Set(flags)] };
  if (p.stage === 'S1') {
    const cuts = { low: Number(process.env.STRATUM_LOW ?? 3), high: Number(process.env.STRATUM_HIGH ?? 6) };
    insist(Number.isFinite(cuts.low) && Number.isFinite(cuts.high) && cuts.low < cuts.high, 'invalid stratum cuts', 503);
    const stratum = stratumOf(scored.total, cuts);
    const counts: Record<Arm, number> = { socratic: 0, direct: 0, control: 0 };
    for (const other of await store.listParticipants()) if (other.id !== p.id && other.stratum === stratum) counts[other.arm]++;
    patch.stratum = stratum; patch.pretestScore = scored.total; patch.arm = assignArm(counts);
  }
  await addEvent(store, p.id, 'stage_leave', { stage: p.stage, reason: timedOut ? 'timeout' : 'user', elapsedSeconds: elapsed });
  return enter(store, p, patch);
}

export async function advanceStage(store: Store, body: Body) {
  const { p, delayed } = await participant(store, body);
  assertAccess(p, delayed);
  insist(p.stage === 'S2', 'submit this stage through its own endpoint', 409);
  insist(body.reason === 'user' || body.reason === 'timeout', 'invalid reason');
  const elapsed = elapsedSeconds(p);
  const timedOut = elapsed >= stageLimits('S2').max;
  if (body.reason === 'timeout') insist(timedOut, 'timeout not reached', 409);
  insist(timedOut || elapsed >= CONFIG.minReadingSeconds, 'minimum reading time not reached', 409);
  // v6: the lower bound is checked PER TRAINING PASSAGE (its two required targets).
  const index = p.progress?.trainingIndex ?? 0;
  const passage = trainingPassageFor(p);
  if (lowerBoundApplies(p.arm)) insist(timedOut || lowerBoundMet(passage, p.completedTargets, p.arm), 'lower bound not met', 409);
  const flags = [...p.excludeFlags];
  // Which passage was incomplete or timed out is in the passage_leave event; the flags stay
  // the v5 names so CONFIG.exclusion.descriptiveOnly keeps meaning the same thing.
  const targetsComplete = lowerBoundMet(passage, p.completedTargets);
  if (!targetsComplete) flags.push('targets_incomplete');
  if (timedOut) flags.push('timeout_S2');
  await addEvent(store, p.id, 'passage_leave', { index, passageId: passage.id, reason: timedOut ? 'timeout' : body.reason, elapsedSeconds: elapsed, targetsComplete });
  if (index < TRAINING_PASSAGES.length - 1) {
    const now = iso();
    const progress: Progress = {
      trainingIndex: index + 1,
      passageEnteredTs: [...(p.progress?.passageEnteredTs ?? []), now],
      translation: null,
    };
    // A timeout can land mid-ladder; the open interaction is dropped, never carried over.
    await store.updateParticipant(p.id, { progress, active: null, excludeFlags: [...new Set(flags)] });
    await addEvent(store, p.id, 'passage_enter', { index: index + 1, passageId: TRAINING_PASSAGES[index + 1].id });
    return { ok: true, stage: 'S2', trainingIndex: index + 1 };
  }
  if (!(await store.listInteractions(p.id)).length) flags.push('no_assist_used');
  await addEvent(store, p.id, 'stage_leave', { stage: p.stage, reason: timedOut ? 'timeout' : body.reason, elapsedSeconds: elapsed });
  return enter(store, p, { excludeFlags: [...new Set(flags)] });
}

/**
 * v6 sentence translation (S1b, S5a, S5b). One sentence at a time; the server keeps the
 * position, the clocks and the first-help snapshot, so the behaviour measures do not
 * depend on anything the client claims except the first-keystroke time.
 *
 * Actions: help {kind: hint|explanation, draft} (S1b/S5a only), skip {draft}, submit {text},
 * timeout. Every action carries `index`, the sentence the client is showing; a stale index
 * is refused so a double click cannot answer the next sentence.
 */
export async function translate(store: Store, body: Body) {
  const { p, delayed } = await participant(store, body);
  insist(!delayed && isTranslationStage(p.stage), 'translation closed', 409);
  const stage = p.stage as TranslationStage;
  const state = p.progress?.translation;
  insist(state && state.stage === stage && !state.translationsDone, 'translation closed', 409);
  const items = TRANSLATION_BY_STAGE[stage];
  const elapsed = elapsedSeconds(p);
  const limits = stageLimits(stage);
  const now = Date.now();
  const since = (ts?: string) => (ts ? Math.max(0, now - Date.parse(ts)) : null);
  const draft = (value: unknown) => (value === undefined || value === null ? '' : string(value, 'draft', 2000));
  const firstInput = (value: unknown) => {
    insist(value === undefined || value === null || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647), 'invalid firstInputMs');
    return value === undefined || value === null ? null : Number(value);
  };
  const progressOf = (translation: NonNullable<Progress['translation']>): Progress => ({
    trainingIndex: p.progress?.trainingIndex ?? 0, passageEnteredTs: p.progress?.passageEnteredTs ?? [], translation,
  });
  /** `help` is the sentence's progress snapshot; omitted for sentences never shown. */
  const rowFor = (i: number, fields: Pick<TranslationRow, 'text' | 'skipped' | 'timedOut' | 'firstInputMs'>, help?: typeof state): TranslationRow => {
    const offset = (ts?: string) => (help && ts ? Date.parse(ts) - Date.parse(help.shownTs) : null);
    // Primary outcome: what was in the box when the reader first reached for help or skip;
    // with no help at all, what they submitted.
    const basis = help?.firstHelpKind ? help.draftAtFirstHelp ?? '' : fields.text;
    return {
      id: randomUUID(), participantId: p.id, stage, itemId: items[i].id, ...fields,
      triedFirst: hanCount(basis) >= CONFIG.translation.triedFirstMinHan,
      firstHelpKind: help?.firstHelpKind ?? null,
      firstHelpMs: offset(help?.firstHelpTs),
      draftAtFirstHelp: help?.draftAtFirstHelp ?? null,
      hintMs: offset(help?.hintTs),
      explanationMs: offset(help?.explanationTs),
      submitMs: help ? since(help.shownTs) ?? 0 : 0,
      ts: iso(),
    };
  };
  /** Move to the next sentence, or finish the translation part of the stage. */
  const next = async (flags: string[] = [], timedOut = false) => {
    const index = state.index + 1;
    if (index < items.length && !timedOut) {
      await store.updateParticipant(p.id, { progress: progressOf({ stage, index, shownTs: iso() }) });
      await addEvent(store, p.id, 'translation_shown', { stage, index, itemId: items[index].id });
      return { ok: true, stage, index };
    }
    const allFlags = [...new Set([...p.excludeFlags, ...flags])];
    if (stage === 'S5b') {
      // The decode items follow on the same stage clock.
      await store.updateParticipant(p.id, { excludeFlags: allFlags, progress: progressOf({ ...state, translationsDone: true }) });
      return { ok: true, stage, translationsDone: true };
    }
    if (elapsed < limits.min) allFlags.push(`below_min_time_${stage}`);
    await addEvent(store, p.id, 'stage_leave', { stage, reason: timedOut ? 'timeout' : 'user', elapsedSeconds: elapsed });
    return enter(store, p, { excludeFlags: [...new Set(allFlags)] });
  };

  if (body.action === 'timeout') {
    insist(elapsed >= limits.max, 'timeout not reached', 409);
    // Timeouts flag, never delete: the sentence on screen keeps what was typed; unseen
    // sentences are recorded as not attempted.
    const typed = draft(body.draft);
    await store.addTranslation(rowFor(state.index, { text: typed, skipped: typed.trim().length === 0, timedOut: true, firstInputMs: firstInput(body.firstInputMs) }, state));
    for (let i = state.index + 1; i < items.length; i++) {
      await store.addTranslation(rowFor(i, { text: '', skipped: true, timedOut: true, firstInputMs: null }));
    }
    return next([`timeout_${stage}`], true);
  }
  insist(body.index === state.index, 'stale sentence; reload state', 409);
  const item = items[state.index];

  if (body.action === 'help') {
    insist(stage !== 'S5b', 'no help in this stage', 409);
    insist(body.kind === 'hint' || body.kind === 'explanation', 'invalid help kind');
    const kind = body.kind as 'hint' | 'explanation';
    const opened = kind === 'hint' ? state.hintTs : state.explanationTs;
    if (!opened) {
      const ts = iso();
      const first = state.firstHelpKind ? {} : { firstHelpKind: kind, firstHelpTs: ts, draftAtFirstHelp: draft(body.draft) };
      await store.updateParticipant(p.id, { progress: progressOf({ ...state, ...first, ...(kind === 'hint' ? { hintTs: ts } : { explanationTs: ts }) }) });
      await addEvent(store, p.id, 'translation_help', { stage, itemId: item.id, kind, draft: draft(body.draft), elapsedMs: since(state.shownTs) });
    }
    return { ok: true, kind, text: kind === 'hint' ? item.hint ?? '' : item.explanation ?? '' };
  }
  if (body.action === 'skip') {
    const typed = draft(body.draft);
    const snapshot = state.firstHelpKind ? state : { ...state, firstHelpKind: 'skip' as const, firstHelpTs: iso(), draftAtFirstHelp: typed };
    await store.addTranslation(rowFor(state.index, { text: typed, skipped: true, timedOut: false, firstInputMs: firstInput(body.firstInputMs) }, snapshot));
    await addEvent(store, p.id, 'item_skip', { stage, itemId: item.id });
    return next();
  }
  if (body.action === 'submit') {
    const text = string(body.text, 'text', 2000);
    insist(text.trim().length > 0, 'empty translation; use skip');
    await store.addTranslation(rowFor(state.index, { text, skipped: false, timedOut: false, firstInputMs: firstInput(body.firstInputMs) }, state));
    return next();
  }
  throw new ApiError(400, 'unknown action');
}

export async function assist(store: Store, body: Body) {
  const { p, delayed } = await participant(store, body);
  insist(!delayed && p.stage === 'S2', 'assist closed', 409);
  insist(elapsedSeconds(p) < stageLimits('S2').max, 'reading time ended', 409);
  const engine = new Engine(store);
  if (body.action === 'highlight') {
    insist(!p.active, 'interaction in progress', 409);
    const passage = trainingPassageFor(p);
    const selection = string(body.selection, 'selection', passage.text.length + 100);
    insist(body.start === undefined || (Number.isInteger(body.start) && Number(body.start) >= 0), 'invalid selection offset');
    insist(selection.trim().length && passage.text.replace(/\s/g, '').includes(selection.replace(/\s/g, '')), 'selection is not part of the passage');
    return engine.startAssist(p, selection, body.start as number | undefined);
  }
  insist(p.active, 'no open interaction', 409);
  // Expected turn prevents a retry or a stale browser tab from answering the next rung.
  insist(body.interactionId === p.active.interactionId && body.turnIndex === p.active.turnIndex, 'stale interaction; reload state', 409);
  if (body.action === 'cancel') {
    insist(isCancellable(p.active), 'cannot cancel after answering', 409);
    return engine.cancel(p);
  }
  if (body.action === 'read_done') {
    insist(p.active.ladder.step === 'explanation', 'explanation not yet shown', 409);
    return engine.reply(p, { kind: 'read_done' });
  }
  // v5.9: both AI arms type a focus word and a perspective; only the socratic arm answers.
  insist(p.arm !== 'control', 'reader turns unavailable', 409);
  if (body.action === 'perspective') {
    insist(pendingTurnFor(p, '')?.kind === 'perspective', 'perspective entry unavailable', 409);
    const value = body.value === undefined || body.value === null ? '' : string(body.value, 'perspective', 200);
    return engine.reply(p, { kind: 'perspective', value });
  }
  if (body.action === 'focus') {
    const current = pendingTurnFor(p, '');
    insist(current?.kind === 'focus', 'focus choice unavailable', 409);
    const source = body.source === 'other' ? 'other' : body.source === 'suggestion' ? 'suggestion' : null;
    insist(source, 'invalid focus source');
    insist(p.active.answerMode !== 'open' || source === 'other', 'focus suggestion unavailable', 409);
    const value = string(body.value, 'focus', 12);
    // A client-visible 400 instead of an engine 500: the reader typed something that is
    // not part of the highlight (often a question). The UI explains what to type.
    insist(focusOccursInSelection(p.active.selection, value), 'focus must occur in selection');
    return engine.reply(p, { kind: 'focus', value, source });
  }
  insist(p.arm === 'socratic', 'reader turns unavailable', 409);
  if (body.action === 'choice') {
    insist(p.active.answerMode !== 'open', 'choice unavailable', 409);
    const current = pendingTurnFor(p, '');
    insist(current?.choice && ['choice', 'reject'].includes(current.kind), 'choice unavailable', 409);
    insist(Number.isInteger(body.index) && Number(body.index) >= 0 && Number(body.index) < current.choice.options.length, 'invalid choice index');
    return engine.reply(p, { kind: 'choice', index: body.index as number, reason: string(body.reason, 'reason') });
  }
  if (body.action === 'answer') {
    insist(pendingTurnFor(p, '')?.kind === 'question', 'text answer unavailable', 409);
    const text = string(body.text, 'answer');
    const reason = p.active.answerMode === 'open' ? string(body.reason, 'reason') : undefined;
    insist(text.trim().length > 0 && (p.active.answerMode !== 'open' || reason!.trim().length > 0), 'answer and reason required');
    return engine.reply(p, { kind: 'answer', text, reason });
  }
  throw new ApiError(400, 'unknown action');
}

export async function recordEvent(store: Store, body: Body) {
  const allowed = ['annotation_click', 'visibility_change', 'fullscreen_enter', 'fullscreen_exit', 'window_blur'];
  insist(typeof body.event === 'string' && allowed.includes(body.event), 'event is server-only or unknown');
  const { p, delayed } = await participant(store, body);
  assertAccess(p, delayed);
  insist(CONFIG.proctor.stages.includes(p.stage), 'events closed', 409);
  if (body.event === 'annotation_click') insist(p.stage === 'S2' || isTranslationStage(p.stage), 'annotations closed', 409);
  await addEvent(store, p.id, body.event as EventRow['event'], { ...object(body.payload ?? {}), stage: p.stage });
  const away = ['visibility_change', 'fullscreen_exit'];
  if (away.includes(body.event)) {
    const count = (await store.listEvents()).filter(e => e.participantId === p.id && away.includes(e.event)).length;
    if (count > CONFIG.exclusion.maxVisibilityChanges) await store.updateParticipant(p.id, { excludeFlags: [...new Set([...p.excludeFlags, 'tab_switching'])] });
  }
  return { ok: true };
}

export async function submitScale(store: Store, body: Body) {
  const { p, delayed } = await participant(store, body);
  insist(!delayed && p.stage === 'S4', 'stage mismatch', 409);
  insist(validCognitiveLoadRatings(body.ratings), 'all cognitive-load ratings must be integers 1-7');
  const ratings = body.ratings as CognitiveLoadRatings;
  await store.addScale({
    id: randomUUID(),
    participantId: p.id,
    ...ratings,
    ...cognitiveLoadMeans(ratings),
    ts: iso(),
  });
  await addEvent(store, p.id, 'stage_leave', { stage: p.stage, elapsedSeconds: elapsedSeconds(p), reason: 'user' });
  return enter(store, p);
}

export async function readState(store: Store, value: string, delayed: boolean) {
  let p = await store.getParticipantByToken(token(value), delayed ? 'delayed' : 'main');
  insist(p, 'unknown token', 404);
  if (!delayed && p.stage === 'S6') {
    const window = delayedWindow(p);
    const zh = (time: number) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
    return { stage: 'WAIT_DELAYED', arm: 'hidden', seconds: { min: 0, max: 3600 }, delayedPath: `/run?t=${p.delayedToken}&d=1`, earliest: zh(window.opensAt), latest: zh(window.closesAt), config: { version: CONFIG.version } };
  }
  if (delayed && p.stage !== 'DONE') {
    assertAccess(p, true);
    if (!p.delayedStartedTs) p = await store.updateParticipant(p.id, { delayedStartedTs: iso() });
  }
  const view = buildStageView(p);
  const elapsed = p.stage === 'DONE' ? 0 : elapsedSeconds(p);
  const rows = p.active ? await store.listInteractions(p.id) : [];
  const last = rows.filter(r => r.interactionId === p!.active?.interactionId && r.actor === 'system').at(-1);
  return { ...view, elapsedSeconds: elapsed, seconds: { ...view.seconds, max: Math.max(0, Math.ceil(view.seconds.max - elapsed)) },
    ...(p.active ? { pendingTurn: { ...pendingTurnFor(p, last?.text ?? ''), interactionId: p.active.interactionId, turnIndex: p.active.turnIndex, cancellable: isCancellable(p.active) } } : {}) };
}
