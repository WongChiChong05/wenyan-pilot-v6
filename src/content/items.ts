import type { Item } from '@/lib/types';

/**
 * TEST ITEMS.
 *
 * Nothing here is a finished item. Every entry is `draft: true` and carries the
 * placeholder marker 【待填】. `npm run validate:content` refuses to pass while any
 * draft remains, so the platform cannot be run for real data collection with
 * placeholder items.
 *
 * Required counts (design doc §8):
 *   S1 pretest        8   (mixed, decode-heavy)
 *   S3 with AI       10   (check 2 / decode 4 / comprehend 2 / infer 2)
 *   S5 transfer      12   (decode 5 / comprehend 4 / infer 3)   <- primary outcome
 *   S6 delayed       10   (5 official + 5 self-written)
 *
 * Answer-source rules (design doc §8.4):
 *   check      -> annotated edition + 教育部《重編國語辭典修訂本》
 *   decode     -> 《古代漢語虛詞詞典》(商務印書館) / 《王力古漢語字典》
 *   comprehend -> only sentences where 三民《新譯世說新語》 and 余嘉錫《世說新語箋疏》 agree
 *   infer      -> must name the evidence sentence; stem uses 「最能」; no 主旨 items
 */

function draft(
  id: string,
  stage: Item['stage'],
  passageId: string,
  level: Item['level'],
  n = 4
): Item {
  return {
    id,
    passageId,
    stage,
    level,
    stem: `【待填】${id} 題幹（${level}）`,
    options: Array.from({ length: n }, (_, i) => `【待填】選項 ${i + 1}`),
    answerIndex: 0,
    evidence: '【待填】證據句',
    source: '【待填】標準答案來源（書名頁碼）',
    draft: true,
  };
}

export const PRETEST_ITEMS: Item[] = [
  draft('S1-01', 'S1', 'P0', 'decode'),
  draft('S1-02', 'S1', 'P0', 'decode'),
  draft('S1-03', 'S1', 'P0', 'decode'),
  draft('S1-04', 'S1', 'P0', 'decode'),
  draft('S1-05', 'S1', 'P0', 'comprehend'),
  draft('S1-06', 'S1', 'P0', 'comprehend'),
  draft('S1-07', 'S1', 'P0', 'infer'),
  { ...draft('S1-08', 'S1', 'P0', 'decode'), attentionCheck: true, stem: '【待填】注意力檢核題（請選第二個選項）' },
];

export const S3_ITEMS: Item[] = [
  draft('S3-01', 'S3', 'T2', 'check'),
  draft('S3-02', 'S3', 'T2', 'check'),
  draft('S3-03', 'S3', 'T2', 'decode'),
  draft('S3-04', 'S3', 'T2', 'decode'),
  draft('S3-05', 'S3', 'T2', 'decode'),
  draft('S3-06', 'S3', 'T2', 'decode'),
  draft('S3-07', 'S3', 'T2', 'comprehend'),
  draft('S3-08', 'S3', 'T2', 'comprehend'),
  draft('S3-09', 'S3', 'T2', 'infer'),
  draft('S3-10', 'S3', 'T2', 'infer'),
];

/** PRIMARY OUTCOME. No check-level items here (no annotations in the transfer passage). */
export const S5_ITEMS: Item[] = [
  draft('S5-01', 'S5', 'T1', 'decode'),
  draft('S5-02', 'S5', 'T1', 'decode'),
  draft('S5-03', 'S5', 'T1', 'decode'),
  draft('S5-04', 'S5', 'T1', 'decode'),
  draft('S5-05', 'S5', 'T1', 'decode'),
  draft('S5-06', 'S5', 'T1', 'comprehend'),
  draft('S5-07', 'S5', 'T1', 'comprehend'),
  draft('S5-08', 'S5', 'T1', 'comprehend'),
  draft('S5-09', 'S5', 'T1', 'comprehend'),
  draft('S5-10', 'S5', 'T1', 'infer'),
  draft('S5-11', 'S5', 'T1', 'infer'),
  draft('S5-12', 'S5', 'T1', 'infer'),
];

/** S6-01..05 are the official items; keep their wording and key exactly as printed. */
export const S6_ITEMS: Item[] = [
  { ...draft('S6-01', 'S6', 'S6', 'decode'), source: '【待填】澳門四校聯考 2024 官方答案' },
  { ...draft('S6-02', 'S6', 'S6', 'decode'), source: '【待填】澳門四校聯考 2024 官方答案' },
  { ...draft('S6-03', 'S6', 'S6', 'comprehend'), source: '【待填】澳門四校聯考 2024 官方答案' },
  { ...draft('S6-04', 'S6', 'S6', 'comprehend'), source: '【待填】澳門四校聯考 2024 官方答案' },
  { ...draft('S6-05', 'S6', 'S6', 'infer'), source: '【待填】澳門四校聯考 2024 官方答案' },
  draft('S6-06', 'S6', 'S6', 'decode'),
  draft('S6-07', 'S6', 'S6', 'decode'),
  draft('S6-08', 'S6', 'S6', 'decode'),
  draft('S6-09', 'S6', 'S6', 'comprehend'),
  draft('S6-10', 'S6', 'S6', 'infer'),
];

export const ITEMS_BY_STAGE = {
  S1: PRETEST_ITEMS,
  S3: S3_ITEMS,
  S5: S5_ITEMS,
  S6: S6_ITEMS,
} as const;

export const ALL_ITEMS: Item[] = [...PRETEST_ITEMS, ...S3_ITEMS, ...S5_ITEMS, ...S6_ITEMS];
