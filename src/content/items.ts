import type { Item } from '../lib/types';

/**
 * TEST ITEMS.
 *
 * STATUS (v6, 2026-09-29)
 *   S1   : unchanged from v5 (pretest and stratification).
 *   S5b  : five decode items on 儉嗇 9, answered after the S5b translation sentences.
 *          Answer source = 三民本 注釋／語譯, cited by page.
 *   The v5 S3 / S5 / S6 multiple-choice sets were removed with those stages.
 *
 * `draft: true` is NOT the same as "unwritten". It means "not yet signed off". Flipping an
 * item to `draft: false` is the reviewer's act, not the author's: 指導教授一次性審查
 * (see 無評分者情況下的驗證替代方案 §3). `npm run validate:content` refuses to pass while any
 * item is still draft, so the platform cannot collect real data before that sign-off.
 *
 * Required counts:
 *   S1 pretest        8   (decode 4 / comprehend 2 / infer 1 / attention check 1)
 *   S5b decode        5   (secondary performance measure, with the S5b translations)
 *
 * Answer-source rules (design doc §8.4) and how each level is sourced here:
 *   check      -> the passage's own annotation, which itself cites 教育部《重編國語辭典修訂本》
 *   decode     -> a named sense in 教育部《重編國語辭典修訂本》, with the entry URL.
 *                 The 商務《古代漢語虛詞詞典》 / 《王力古漢語字典》 cross-check is still owed;
 *                 until it is done these items remain draft.
 *   comprehend -> only propositions stated outright in the passage; the evidence sentence
 *                 carries the whole answer. No item here depends on an annotated edition's
 *                 interpretation, because we have no access to two such editions.
 *   infer      -> stem uses 「最能」; the evidence field names the sentence the inference must
 *                 rest on; no 主旨 (whole-passage-theme) items.
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

/** Every written item goes through here, so none of them can silently lose `draft: true`. */
function item(
  id: string,
  stage: Item['stage'],
  passageId: string,
  level: Item['level'],
  stem: string,
  options: string[],
  answerIndex: number,
  evidence: string,
  source: string,
  extra: Partial<Item> = {}
): Item {
  return { id, passageId, stage, level, stem, options, answerIndex, evidence, source, draft: true, ...extra };
}

const MOE = (w: string) => `教育部《重編國語辭典修訂本》「${w}」 https://www.moedict.tw/uni/${w}`;

/* ------------------------------------------------------------------ */
/* S1  前測 — 世說新語·汰侈 2（石崇廁）                                 */
/* ------------------------------------------------------------------ */

export const PRETEST_ITEMS: Item[] = [
  item(
    'S1-01', 'S1', 'P0', 'decode',
    '「置甲煎粉、沉香汁之屬」的「屬」，意思最接近下列何者？',
    ['歸屬、屬於', '這一類、這些東西', '部下、下屬', '連接、接續'],
    1,
    '置甲煎粉、沉香汁之屬，無不畢備。',
    `${MOE('屬')}（ㄕㄨˇ 名詞義「類別」）`
  ),
  item(
    'S1-02', 'S1', 'P0', 'decode',
    '「無不畢備」的「畢」，在這裡的意思是？',
    ['完結、結束', '全、都', '捕鳥的網子', '星宿的名稱'],
    1,
    '置甲煎粉、沉香汁之屬，無不畢備。',
    `${MOE('畢')}（副詞義「皆、全部」）`
  ),
  item(
    'S1-03', 'S1', 'P0', 'decode',
    '「脫故衣，著新衣」的「故」，意思是？',
    ['原來的、舊的', '已經死去的', '因此、所以', '故意、存心'],
    0,
    '王大將軍往，脫故衣，著新衣，神色傲然。',
    `${MOE('故')}（形容詞義「原來的、以前的」）`
  ),
  item(
    'S1-04', 'S1', 'P0', 'decode',
    '「客多羞不能如廁」的「如」，意思是？',
    ['好像、如同', '往、到', '假若', '比得上'],
    1,
    '又與新衣著令出，客多羞不能如廁。',
    `${MOE('如')}（動詞義「往、至」）`
  ),
  item(
    'S1-05', 'S1', 'P0', 'comprehend',
    '依文中所述，客人「多羞不能如廁」的直接原因是什麼？',
    [
      '廁中有十餘名婢女排列侍候，還要客人換上新衣',
      '廁所骯髒，客人不願進去',
      '石崇規定客人不得使用他的廁所',
      '客人怕被婢女當成賊',
    ],
    0,
    '石崇廁，常有十餘婢侍列……又與新衣著令出，客多羞不能如廁。',
    '文本直述：答案完全落在證據句內，不依賴任何注譯本的解釋。'
  ),
  // S1-05 已經把「要換新衣」這件事當成答案。這一題若也把它寫進選項，等於互相洩答，
  // 所以改問態度的差別，選項不再重複換衣的機制。
  item(
    'S1-06', 'S1', 'P0', 'comprehend',
    '王大將軍和文中其他客人最主要的差別在哪裡？',
    ['其他客人覺得難為情，他卻毫不在意', '其他客人是文人，他是武將', '其他客人帶了禮物，他沒有', '其他客人早到，他遲到'],
    0,
    '客多羞不能如廁。王大將軍往，脫故衣，著新衣，神色傲然。',
    '文本直述：答案完全落在證據句內。'
  ),
  item(
    'S1-07', 'S1', 'P0', 'infer',
    '群婢說「此客必能作賊」，最能說明她們對王大將軍的看法是什麼？',
    ['他膽子大、不受世俗拘束', '他家境貧窮，需要偷竊', '他偷走了廁中的香料', '他和石崇早有仇怨'],
    0,
    '脫故衣，著新衣，神色傲然。群婢相謂曰：「此客必能作賊！」',
    '推論題：證據句為「神色傲然」與婢女之語；其餘三個選項在全文中均無任何字句支持。'
  ),
  item(
    'S1-08', 'S1', 'P0', 'decode',
    '這一題用來確認你仍在專心作答。請直接選擇「第二個選項」。',
    ['第一個選項', '第二個選項', '第三個選項', '第四個選項'],
    1,
    '',
    '注意力檢核題，不計入閱讀分數（排除規則見 config.ts exclusion）。',
    { attentionCheck: true }
  ),
];

/* ------------------------------------------------------------------ */
/* S5b 字詞題 — 世說新語·儉嗇 9（郗公聚斂）                              */
/* v6: auto-scored decode items after the S5b translation sentences.    */
/* The v5 S3 / S5 / S6 item sets were removed with those stages (see    */
/* git history before v6.0).                                            */
/* ------------------------------------------------------------------ */

const SANMIN_J9 = '劉正浩等注譯《新譯世說新語》（三民書局）儉嗇第二十九 頁 857';

export const S5B_ITEMS: Item[] = [
  item(
    'S5B-01', 'S5b', 'J9', 'decode',
    '「郗公大聚斂」的「聚斂」，意思最接近？',
    ['大量收集財富', '節省家中開支', '把財物分送出去', '向別人借錢'],
    0,
    '郗公大聚斂，有錢數千萬',
    `${SANMIN_J9} 語譯「郗公大量聚集財富」`
  ),
  item(
    'S5B-02', 'S5b', 'J9', 'decode',
    '「因倚語移時」的「移時」，意思最接近？',
    ['換了一個時間', '過了很久', '立刻、馬上', '按照時間'],
    1,
    '因倚語移時，遂及財貨事',
    `${SANMIN_J9} 語譯「倚靠著東西站著談了很久」`
  ),
  item(
    'S5B-03', 'S5b', 'J9', 'decode',
    '「汝正當欲得吾錢耳」的「正當」，意思最接近？',
    ['正確合理', '應該', '只是', '正好在'],
    2,
    '汝正當欲得吾錢耳',
    `${SANMIN_J9} 注⑤「正當：只是」`
  ),
  item(
    'S5B-04', 'S5b', 'J9', 'decode',
    '「嘉賓遂一日乞與親友」的「乞」，意思最接近？',
    ['乞求', '贈送', '借出', '討回'],
    1,
    '嘉賓遂一日乞與親友',
    `${SANMIN_J9} 注⑦「乞：餽贈」`
  ),
  item(
    'S5B-05', 'S5b', 'J9', 'decode',
    '「驚怪不能已已」的第一個「已」，意思最接近？',
    ['已經', '自己', '停止', '以後'],
    2,
    '驚怪不能已已',
    `${SANMIN_J9} 注⑧「上已字是停止的意思」`
  ),
];

export const ITEMS_BY_STAGE = {
  S1: PRETEST_ITEMS,
  S5b: S5B_ITEMS,
} as const;

export const ALL_ITEMS: Item[] = [...PRETEST_ITEMS, ...S5B_ITEMS];
