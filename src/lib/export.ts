import { ALL_ITEMS } from '../content/items';
import { TRANSLATION_ITEMS } from '../content/translation';
import type { Participant, ResponseRow, ScaleRow, TranslationRow } from './types';

/** Stable CSV for both storage backends; JSONB may reorder object keys. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function toCsv(rows: object[]): string {
  if (!rows.length) return '';
  const records = rows as Record<string, unknown>[];
  const cols = [...new Set(records.flatMap(Object.keys))].sort();
  const escape = (value: unknown) => {
    const s = value == null ? '' : typeof value === 'object' ? JSON.stringify(canonical(value)) : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...records.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
}

const itemPrefix = (id: string) => id.replace(/[^A-Za-z0-9]+/g, '_');

/** Analysis-ready one-participant-per-row export. Direct identifiers are excluded. */
export function buildWideRows(participants: Participant[], responses: ResponseRow[], scales: ScaleRow[], translations: TranslationRow[] = []) {
  const responsesByParticipant = new Map<string, Map<string, ResponseRow>>();
  for (const response of responses) {
    const mine = responsesByParticipant.get(response.participantId) ?? new Map<string, ResponseRow>();
    mine.set(response.itemId, response);
    responsesByParticipant.set(response.participantId, mine);
  }
  const scalesByParticipant = new Map(scales.map(scale => [scale.participantId, scale]));
  return participants.map(participant => {
    const row: Record<string, unknown> = {
      participant_id: participant.id,
      arm: participant.arm,
      stage: participant.stage,
      stratum: participant.stratum,
      pretest_score: participant.pretestScore,
      config_version: participant.configVersion,
      age: participant.demographics.age,
      gender: participant.demographics.gender,
      major: participant.demographics.major ?? participant.demographics.department,
      grade: participant.demographics.grade,
      ai_usage: participant.demographics.aiUsage,
      chinese_major: participant.demographics.chineseMajor,
      read_before: participant.demographics.readBefore,
    };
    const mine = responsesByParticipant.get(participant.id);
    for (const item of ALL_ITEMS) {
      const prefix = itemPrefix(item.id);
      const response = mine?.get(item.id);
      row[`${prefix}_stem`] = item.stem;
      row[`${prefix}_choice_index`] = response?.chosen ?? null;
      row[`${prefix}_choice_text`] = response?.chosen == null ? null : item.options[response.chosen] ?? null;
      row[`${prefix}_correct`] = response?.correct ?? null;
      row[`${prefix}_rt_ms`] = response?.rtMs ?? null;
    }
    // v6: one block of columns per translated sentence (behaviour + the text for grading).
    for (const t of TRANSLATION_ITEMS) {
      const prefix = itemPrefix(t.id);
      const r = translations.find(x => x.participantId === participant.id && x.itemId === t.id);
      row[`${prefix}_tried_first`] = r?.triedFirst ?? null;
      row[`${prefix}_first_help`] = r?.firstHelpKind ?? null;
      row[`${prefix}_first_help_ms`] = r?.firstHelpMs ?? null;
      row[`${prefix}_first_input_ms`] = r?.firstInputMs ?? null;
      row[`${prefix}_skipped`] = r?.skipped ?? null;
      row[`${prefix}_timed_out`] = r?.timedOut ?? null;
      row[`${prefix}_text`] = r?.text ?? null;
    }
    const scale = scalesByParticipant.get(participant.id);
    for (const key of [
      'intrinsic1', 'intrinsic2', 'germane1', 'germane2', 'germane3',
      'extraneous1', 'extraneous2', 'extraneous3',
      'intrinsicMean', 'germaneMean', 'extraneousMean',
    ] as const) row[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] = scale?.[key] ?? null;
    return row;
  });
}
