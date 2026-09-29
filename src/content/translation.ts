import type { TranslationItem, TranslationStage } from '../lib/types';

/**
 * v6 SENTENCE-TRANSLATION ITEMS.
 *
 * S1b (baseline behaviour) and S5a (post-test behaviour): each sentence offers 提示 (one
 * clue, instrumental help), 解釋 (the standard translation, executive help) and 跳過.
 * All three arms see exactly the same text; nothing here is generated at run time.
 * S5b (post-test performance): no help, no hint, no explanation.
 *
 * Standard translation = 三民《新譯世說新語》語譯 (WCC's decision, 2026-09-29), quoted by page.
 * An explanation is that excerpt verbatim plus, in brackets, the key words it turns on.
 * `altReferences` holds 張撝之本譯文 (simplified, as printed) where it was photographed; the
 * grader accepts either. Rubrics are three scoring points per sentence:
 *   A 關鍵字詞  B 誰對誰（主語、對象、代詞所指）  C 前後關係（順序、因果、轉折、條件）
 *
 * Every entry is `draft: true`: written by the system author, awaiting review by the
 * 中文碩士 reviewer; WCC removes the flag after that review.
 */

const SANMIN = '劉正浩等注譯《新譯世說新語》（三民書局）';

export const TRANSLATION_ITEMS: TranslationItem[] = [
  /* ---------------- S1b — 汰侈 11（彭城王快牛）, baseline ---------------- */
  {
    id: 'B11-1',
    stage: 'S1b',
    passageId: 'B11',
    sentence: '彭城王有快牛，至愛惜之',
    hint: '「至」在這裡表示程度；「之」回頭指前面提到的某樣東西。',
    explanation: '彭城王司馬權有一頭跑得很快的牛，極為珍惜。（「至」＝極；「之」指那頭牛）',
    reference: '彭城王司馬權有一頭跑得很快的牛，極為珍惜',
    rubric: {
      A: '「至」譯為極、非常；「快牛」譯為跑得快的牛',
      B: '珍惜的主語是彭城王，對象（之）是那頭牛',
      C: '先說有這頭牛，再說他很珍惜牠（兩件事順接）',
    },
    source: `${SANMIN} 汰侈第三十 頁 868 語譯、注①`,
    draft: true,
  },
  {
    id: 'B11-2',
    stage: 'S1b',
    passageId: 'B11',
    sentence: '王太尉與射，賭得之',
    hint: '「與射」省略了和誰比；「之」和上一句的「之」是同一樣東西。',
    explanation: '後來太尉王衍和他賭射箭，把牛贏去了。（「與」＝和；「得之」＝贏得那頭牛）',
    reference: '後來太尉王衍和他賭射箭，把牛贏去了',
    rubric: {
      A: '「射」譯為射箭；「賭得」譯為賭贏、贏得',
      B: '王太尉和彭城王比射；贏得牛的是王太尉（之＝牛）',
      C: '先比射箭打賭，結果贏走了牛（因果／先後）',
    },
    source: `${SANMIN} 汰侈第三十 頁 868 語譯、注②`,
    draft: true,
  },
  {
    id: 'B11-3',
    stage: 'S1b',
    passageId: 'B11',
    sentence: '若欲噉者，當以二十肥者代之',
    hint: '「噉」是吃；「以……代之」是「拿……來換它」。',
    explanation: '如果想吃的時候，我將用二十頭更肥的替換。（「噉」＝吃；「以」＝用）',
    reference: '如果想吃的時候，我將用二十頭更肥的替換',
    rubric: {
      A: '「噉」譯為吃；「以」譯為用、拿；「代」譯為替換',
      B: '說話的是彭城王：由他拿二十頭肥牛換回那頭快牛（之＝快牛）',
      C: '條件：如果（對方）想吃，就（拿肥牛來換）',
    },
    source: `${SANMIN} 汰侈第三十 頁 868 語譯、注③`,
    draft: true,
  },

  /* ---------------- S5a — 儉嗇 7（王丞相甘果）, post-test behaviour ---------------- */
  {
    id: 'J7-1',
    stage: 'S5a',
    passageId: 'J7',
    sentence: '王丞相性儉節，帳下甘果盈溢，不散',
    hint: '「盈溢」形容東西多到滿出來；「不散」的主語是王丞相。',
    explanation: '王丞相天性節儉，床帳下甜美的水果滿布，他捨不得分給別人。（「不散」＝不分送）',
    reference: '王丞相天性節儉，床帳下甜美的水果滿布，他捨不得分給別人',
    altReferences: ['王导丞相生活节俭，帐下的甜美水果，积得很多也不分发掉'],
    rubric: {
      A: '「甘果」譯為甜美的水果；「盈溢」譯為很多、滿布；「散」譯為分送',
      B: '不肯分送的是王丞相（不是水果自己不散）',
      C: '因為節儉，所以水果多到滿出來也不分給別人（因果）',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 856 語譯、注②③；張撝之譯注 頁 421`,
    draft: true,
  },
  {
    id: 'J7-2',
    stage: 'S5a',
    passageId: 'J7',
    sentence: '涉春爛敗，都督白之',
    hint: '「涉」是進入；「白」在這裡是一個動作，和「說」有關。',
    explanation: '等到入春腐爛了，一名都督向他報告。（「涉」＝進入；「白」＝報告）',
    reference: '等到入春腐爛了，一名都督向他報告',
    altReferences: ['经过春天，果子腐烂了，都督向他报告'],
    rubric: {
      A: '「涉春」譯為到了春天；「白」譯為報告',
      B: '爛的是水果；向王丞相報告的是都督（之＝水果爛了這件事）',
      C: '時間先後：到了春天水果爛了，於是都督去報告',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 856 語譯、注④⑤；張撝之譯注 頁 421`,
    draft: true,
  },
  {
    id: 'J7-3',
    stage: 'S5a',
    passageId: 'J7',
    sentence: '公令舍去，敕曰：「慎不可令大郎知！」',
    hint: '「舍」通「捨」；「敕」是上對下的叮嚀。',
    explanation: '王公才叫他拿去丟掉，並告誡他說：「千萬小心，可不能叫大郎知道！」',
    reference: '王公才叫他拿去丟掉，並告誡他說：「千萬小心，可不能叫大郎知道！」',
    altReferences: ['王导叫他丢掉，并说：“当心，不能让大郎知道。”'],
    rubric: {
      A: '「舍去」譯為丟掉；「慎」譯為小心、千萬；「令」譯為叫、讓',
      B: '下令的是王丞相，丟水果的是都督；不能讓知道的是大郎',
      C: '先下令丟掉，再叮囑保密（前後兩個動作）',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 856 語譯、注⑥⑦⑧；張撝之譯注 頁 421`,
    draft: true,
  },

  /* ---------------- S5b — 儉嗇 1（和嶠李）, post-test performance, no help ---------------- */
  {
    id: 'J1-1',
    stage: 'S5b',
    passageId: 'J1',
    sentence: '和嶠性至儉，家有好李，王武子求之，與不過數十',
    reference: '和嶠生性極為儉樸吝嗇，他家李樹上結有好吃的李子，王武子向他索取，只不過給了數十顆',
    altReferences: ['和峤性情极为吝啬，家里有味美的李子，王济向他索讨，他给王济不过几十颗'],
    rubric: {
      A: '「性至儉」譯為生性極節儉；「求」譯為要、索取；「與」譯為給',
      B: '王武子向和嶠要李子；給的是和嶠，只給了幾十顆（之＝李子）',
      C: '轉折：家有好李，卻只給不過數十',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 853 語譯；張撝之譯注 頁 420`,
    draft: true,
  },
  {
    id: 'J1-2',
    stage: 'S5b',
    passageId: 'J1',
    sentence: '王武子因其上直，率將少年能食之者，持斧詣園',
    reference: '王武子就趁他去值班的時候，率領幾個年輕能吃李子的人，拿著斧頭到他園中',
    altReferences: ['王济就乘他上朝值班的时候，带领一帮能吃的少年，拿了斧头到李园中'],
    rubric: {
      A: '「因」譯為趁；「率將」譯為帶領；「詣」譯為到',
      B: '去值班的是和嶠（其＝和嶠）；帶人拿斧頭去的是王武子',
      C: '時機：趁和嶠不在（去值班）的時候才去',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 853 語譯、注④⑤；張撝之譯注 頁 420`,
    draft: true,
  },
  {
    id: 'J1-3',
    stage: 'S5b',
    passageId: 'J1',
    sentence: '飽共噉畢，伐之，送一車枝與和公',
    reference: '共同飽吃一頓以後，把樹砍斷，還送了一車樹枝給和公',
    altReferences: ['饱吃李子之后，把李树都砍了。然后送了一车李树枝条给和峤'],
    rubric: {
      A: '「噉」譯為吃；「伐」譯為砍；「與」譯為給',
      B: '砍的是李樹（之＝李樹）；收到樹枝的是和嶠',
      C: '順序：先吃飽，再砍樹，再送樹枝',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 853 語譯；張撝之譯注 頁 420`,
    draft: true,
  },
  {
    id: 'J1-4',
    stage: 'S5b',
    passageId: 'J1',
    sentence: '問曰：「何如君李？」和既得，唯笑而已',
    reference: '並問他說：「比起您的李樹，怎麼樣？」和嶠收到以後，只有苦笑而已',
    altReferences: ['问他说：“比您家的李树怎么样？”和峤收到这些李树枝以后，只好笑笑罢了'],
    rubric: {
      A: '「何如」譯為比起……怎麼樣；「唯……而已」譯為只是、只好',
      B: '問話的是王武子，被問的是和嶠；收到樹枝、只能笑的是和嶠',
      C: '先被問話，收到樹枝以後只能笑（反應接在後面）',
    },
    source: `${SANMIN} 儉嗇第二十九 頁 853 語譯；張撝之譯注 頁 420`,
    draft: true,
  },
];

export const TRANSLATION_BY_STAGE: Record<TranslationStage, TranslationItem[]> = {
  S1b: TRANSLATION_ITEMS.filter(i => i.stage === 'S1b'),
  S5a: TRANSLATION_ITEMS.filter(i => i.stage === 'S5a'),
  S5b: TRANSLATION_ITEMS.filter(i => i.stage === 'S5b'),
};

/** Which passage each translation stage shows above the sentences. */
export const TRANSLATION_PASSAGE: Record<TranslationStage, string> = { S1b: 'B11', S5a: 'J7', S5b: 'J1' };
