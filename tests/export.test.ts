import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWideRows, toCsv } from '../src/lib/export';
import { makeParticipant } from './memoryStore';

describe('analysis-ready wide export', () => {
  it('creates fixed per-question and cognitive-load columns without contact data', () => {
    const p = makeParticipant('direct');
    p.demographics = { age: 20, gender: '女性', major: '資訊工程', email: 'must-not-export@example.com' };
    const response = {
      id: randomUUID(), participantId: p.id, stage: 'S1' as const, itemId: 'S1-01', level: 'decode' as const,
      chosen: 1, correct: true, rtMs: 3200, ts: new Date().toISOString(),
    };
    const scale = {
      id: randomUUID(), participantId: p.id,
      intrinsic1: 6, intrinsic2: 4, germane1: 7, germane2: 6, germane3: 5,
      extraneous1: 3, extraneous2: 2, extraneous3: 4,
      intrinsicMean: 5, germaneMean: 6, extraneousMean: 3, ts: new Date().toISOString(),
    };
    const row = buildWideRows([p], [response], [scale])[0];
    expect(Boolean(row.S1_01_stem)).toBe(true);
    expect(row.S1_01_choice_index).toBe(1);
    expect(Boolean(row.S1_01_choice_text)).toBe(true);
    expect(row.S1_01_correct).toBe(true);
    expect(row.S1_01_rt_ms).toBe(3200);
    expect(row.S1_02_choice_index).toBeNull();
    expect(row.intrinsic1).toBe(6);
    expect(row.intrinsic_mean).toBe(5);
    expect(row.email).toBe(undefined);
    const csv = toCsv([row]);
    expect(csv).toContain('S1_01_correct');
    expect(csv).toContain('extraneous_mean');
    expect(csv).not.toContain('must-not-export@example.com');
  });
});
