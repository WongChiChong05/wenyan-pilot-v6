import { CONFIG } from './config';
import type { TargetSentence } from './types';

/**
 * PROMPT DESIGN — what each rule comes from
 *
 * 1. Generic question stems (strategies A–D are our adaptations, NOT quotations).
 *    Rosenshine, Meister & Chapman (1996), RER 66(2), 181–221: among the procedural
 *    prompts, generic question stems gave the largest effect, ES = 1.12 — but only on
 *    EXPERIMENTER-DEVELOPED comprehension tests. The overall median was 0.86 on those and
 *    0.36 on standardized tests. CAVEAT: that review trains students to GENERATE
 *    questions; here the AI asks them. This is a design analogy, not direct evidence
 *    that our four Chinese stems or being asked questions have the same effect.
 * 2. The socratic arm clarifies rather than argues.
 *    Palincsar & Brown (1984), Cognition and Instruction 1(2), 117–175: "clarifying" is
 *    one of the four reciprocal-teaching strategies and is the one that addresses decoding.
 * 3. The ladder always ends with the answer (bottom-out).
 *    Aleven, Roll, McLaren & Koedinger (2016), IJAIED 26(1), 205–223: keep a bottom-out
 *    hint so learners do not get stuck; supplement hints with prompted self-explanation.
 * 4. The reader must attempt before the explanation appears.
 *    Kornell, Hays & Bjork (2009), JEP:LMC 35(4): failed retrieval attempts still improve
 *    later learning. Sinha & Kapur (2021), RER 91(5): problem solving before instruction,
 *    overall g = 0.36 [0.20, 0.51], 166 comparisons. Neither validates our exact ladder.
 * 5. The reader must give a reason before the explanation appears.
 *    Bisra, Liu, Nesbit, Salimi & Winne (2018), Educational Psychology Review: prompting
 *    self-explanation, g = .55 (69 effect sizes, 64 reports).
 * 6. The direct arm is a guardrailed explainer, not a free chatbot.
 *    Bastani et al. (2025), PNAS 122, e2422633122: unguarded GPT access raised practice
 *    grades 48% but lowered later unassisted exam grades 17%; the guardrailed tutor raised
 *    practice 127% with no significant exam effect. This was high-school mathematics,
 *    not Classical Chinese; it motivates measuring unassisted transfer, not predicting harm.
 * 7. Grammar terminology restriction is OUR manipulation choice, not a proven treatment.
 *    劉潔玲、谷屹欣 (2017)，〈香港高中學生閱讀文言文的表現與困難〉，教育學報 45(2), 161–181：
 *    reports students' reading difficulties; it does not experimentally validate banning
 *    grammatical terminology. The previously listed unverified quotation was removed.
 *
 * Full links, verification scope and limitations: docs/程式與提示詞審閱指南.md.
 *
 * SYMMETRY RULES (must hold or the comparison is not about questioning):
 *   - same model, temperature, max_tokens  (CONFIG.llm)
 *   - same per-turn character cap          (CONFIG.llm.maxCharsPerTurn)
 *   - same scope of topics
 *   - same out-of-scope handling (rare words -> annotation)
 *   - identical explanation text for target sentences (taken from content, not generated)
 */

export const STRATEGY_STEMS = {
  A: '你用了哪個線索？還有沒有第二個線索可以對照？',
  B: '把你的解釋代回整句，通順嗎？哪裡卡住？',
  C: '這個字在句子什麼位置？前後是什麼詞性？',
  D: '如果這是白話文，你會怎麼判斷？同樣方法用在這裡呢？',
} as const;

const SHARED_SCOPE = `
## 可以處理
虛詞的非常見義項、詞類活用、省略成分、特殊句式與標誌詞、古今異義、通假、
一詞多義、指代對象、句間邏輯關係、段落功能、語境提示充足的生僻字。

## 不處理（一律轉向註解）
語境提示不足的生僻字、典故、人名、地名、官職名。
固定回覆：「這個詞的解釋在註解裡，點一下就有。我們來看它在這句話裡的作用——」
`;

export function socraticSystemPrompt(): string {
  return `你是文言文閱讀的引導者。你的唯一任務是透過提問，幫助讀者自己推導出理解。

## 絕對禁令
1. 不得提供任何白話翻譯，無論全句、半句或詞組。
2. 不得說出任何字詞的意思。禁用句式：「意思是」「即是」「就是說」「翻譯成」「指的是」「也就是說」「換句話說」「相當於」。
3. 不得在同一則回應中提問後又自行作答。
4. 不得使用可用「是／不是」回答且含有目標答案的誘導性問句。
5. 不得教授語法術語（賓語前置、定語後置、通假字、名詞活用、判斷句等），改以功能描述提問。
6. 不得提供答案。是否顯示答案由系統決定，不由你決定。
7. 選取超過一個字時，禁用「這個字」指稱整段；請引述讀者選取的文字。
8. 選取不能獨立理解時，必須引述所依賴的鄰句或前後字詞，再問兩者的關係，不得直接解釋。
9. 第一、二層只問文本觀察。每個選項都不得說出字詞的意思，不得含翻譯、語法術語或第三層答案。
10. 不得問只需照抄相鄰字即可回答的問題，例如「後面緊接哪個字」「前一個字是什麼」「第幾個字」。問題必須要求比較至少兩個可見線索，或判斷字詞在句中的可見角色。

## 回應規則
- 一次只問一個問題。
- 每則回應不超過 ${CONFIG.llm.maxCharsPerTurn} 字。
- 問題必須指向文本中的具體線索。
- 讀者答出結果後，若未說明依據，追問一次「你怎麼判斷的？」。
${SHARED_SCOPE}
## 四類策略句幹（只在適合選取範圍時使用，以上禁令優先）
A 多策略交叉：${STRATEGY_STEMS.A}
B 語境一致性檢核：${STRATEGY_STEMS.B}
C 詞性與位置：${STRATEGY_STEMS.C}
D 白話遷移：${STRATEGY_STEMS.D}

## 輸出格式（只輸出 JSON，不要其他文字）
{"type":"question","strategy":"A","text":"觀察問題","options":["觀察一","觀察二","觀察三"],"answerIndex":0}
answerIndex 是三個觀察選項中唯一正確者的零起算索引，只供伺服器評分。不得將答案寫入 text。`;
}

export function directSystemPrompt(): string {
  return `你是文言文閱讀的解說者。你的任務是提供清楚、簡短的解釋。

## 絕對規則
1. 不得一次輸出整篇譯文。只解釋讀者選取的範圍。
2. 每則回應不超過 ${CONFIG.llm.maxCharsPerTurn} 字（與引導者版等長）。
3. 不提問，不要求讀者作答。
4. 可以使用語法術語。

## 依選取範圍回應
- 字詞（粒度標記 word，單一字）：給該字在此句中的意思與詞性。
- 句子：給該句白話翻譯，並說明結構特點。
- 整段：給該段主旨說明，可指出關鍵句。
${SHARED_SCOPE}
## 輸出格式（只輸出 JSON，不要其他文字）
{"type":"explain","text":"呈現給讀者的內容"}`;
}

export function focusOptionsSystemPrompt(): string {
  return `你只負責從讀者反白的文言文片段中提出可能想問的字或詞，不解釋意思，也不出題。

規則：
1. options 必須有 2 至 4 個不同項目，每項都必須逐字出現在「讀者反白」中。
2. 每項限 1 至 6 個字；可以是單字或多字詞。
3. 優先列出虛詞、動詞、形容詞、生難詞；人名、官名等專名仍可列出，但排在最後。
4. 不加入字義、提示、括號說明或原文沒有的字。
5. 只輸出 JSON：{"options":["字詞一","字詞二"]}`;
}

export function focusOptionsPrompt(args: {
  selection: string;
  neighborhood?: { prev: string; containing: string; next: string };
}): string {
  const context = args.neighborhood?.containing
    ? `\n所在句：「${args.neighborhood.containing}」`
    : '';
  return `讀者反白：「${args.selection}」${context}\n請列出最可能想問的字或詞。`;
}

/** Layer-specific user message for the socratic arm. */
/**
 * The opening move when the reader has selected more than a word.
 *
 * Strategy stem C — 「這個字在句子什麼位置？前後是什麼詞性？」 — presumes a word-level
 * selection. Asked about a whole clause it reads as a bug: the reader stares at
 * 「這個字」 with no idea which character is meant. For a sentence or passage selection
 * the first move is therefore to localise, and stem C applies on the next turn.
 *
 * This localisation question is an addition of ours, NOT one of the four cited stems.
 */
export const LOCALISE_QUESTION = '你選的這一段裡，哪一個字最讓你卡住？先指出那個字。';

/** A degraded observation task, never a trusted answer key. */
export const FALLBACK_SOCRATIC_MCQ = {
  stem: '先對照選取範圍前後的文字，你會從哪一處開始找線索？',
  options: ['選取範圍之前的文字', '選取範圍之後的文字', '前後兩處一起對照'],
};

/** What to ask when the model is unavailable, for a selection of any size. */
export function fallbackQuestion(granularity: 'word' | 'sentence' | 'passage'): string {
  return granularity === 'word' ? STRATEGY_STEMS.C : LOCALISE_QUESTION;
}

export function socraticTurnPrompt(args: {
  passage: string;
  selection: string;
  layer: 1 | 2;
  granularity?: 'word' | 'sentence' | 'passage';
  target?: TargetSentence;
  lastReaderTurn?: string;
  selectionStart?: number;
  selectionEnd?: number;
  neighborhood?: { prev: string; containing: string; next: string };
  withOptions?: boolean;
  retryFlags?: string[];
}): string {
  const { passage, selection, layer, granularity = 'word', target, lastReaderTurn } = args;
  const fixed = target
    ? `\n這是目標句，第 ${layer} 層請使用以下固定問法（逐字）：\n${layer === 1 ? target.layer1 : target.layer2}`
    : '';
  const context = args.neighborhood;
  const location = args.selectionStart === undefined ? '' :
    `\n選取位置：第 ${args.selectionStart} 至 ${args.selectionEnd}（零起算 UTF-16，終點不含）`;
  const surroundings = context ?
    `\n【前一句】${context.prev}\n【所在句】${context.containing}\n【後一句】${context.next}` : '';
  const format = args.withOptions ?
    '\n提供三個觀察選項，options 必須是三個不同的非空字串，answerIndex 必須是 0、1 或 2；只問位置、詞類、對照或可見線索間的關係，不問字義，也不得只問前後緊接哪個字。' : '';
  const retry = args.retryFlags?.length
    ? `\n上一次輸出未通過檢查（${args.retryFlags.join('、')}）。請改用另一種題型並嚴格遵守禁令。`
    : '';
  return `原文：\n${passage}\n\n讀者選取（粒度：${granularity}）：「${selection}」
${location}${surroundings}
${lastReaderTurn ? `讀者上一句回答：「${lastReaderTurn}」\n` : ''}目前在第 ${layer} 層。${
    layer === 1 ? '請針對這個選取範圍提出一個觀察問題；必要時引述鄰句。' : '請提供文中另一個具體線索，再問一個觀察問題。'
  }${fixed}${format}${retry}`;
}

export function directTurnPrompt(args: {
  passage: string;
  selection: string;
  granularity: 'word' | 'sentence' | 'passage';
  retryFlags?: string[];
}): string {
  const retry = !args.retryFlags?.length ? '' : `

上一次回覆未通過伺服器檢查。請修正後重新輸出：${
    args.retryFlags.includes('too_long')
      ? 'text 必須壓縮至 45 個字內，只保留所選範圍的核心解釋。'
      : args.retryFlags.includes('whole_passage_translation')
        ? '只解釋讀者選取的範圍，不得涵蓋多個其他句子。'
        : '只輸出指定 JSON，並確保 text 是非空字串。'
  }`;
  return `原文：\n${args.passage}\n\n讀者選取（粒度：${args.granularity}）：「${args.selection}」
請依粒度規則給出解釋。${retry}`;
}

/** Reason gate, used only for cases the rule layer cannot decide. */
export function reasonJudgePrompt(args: {
  reason: string;
  sentence: string;
  options: string[];
}): { system: string; user: string } {
  return {
    system: `你在判斷一段中文回答「有沒有給出理由」，不判斷理由對不對。

接受：指出原文的字詞或位置／說明因果／和白話或其他句子比較／推論錯誤但有講原因。
退回：空白或過短／沒有內容的說法（不知道、猜的、感覺、隨便）／只重複選項文字／與題目無關。

只輸出 JSON：{"verdict":"accept"|"reject","why":"不超過20字"}`,
    user: `句子：「${args.sentence}」
選項：${args.options.map((o, i) => `(${i + 1}) ${o}`).join('　')}
讀者寫的理由：「${args.reason}」`,
  };
}

/** Answer judging for layers 1–2. Wrong judgements only change path length. */
export function answerJudgePrompt(args: {
  answer: string;
  acceptable: string[];
  sentence: string;
}): { system: string; user: string } {
  return {
    system: `你在判斷學生對一個文言文語言點的回答是否與參考答案一致（意思相同即可，不要求用語相同）。
只輸出 JSON：{"correct":true|false}`,
    user: `句子：「${args.sentence}」
參考答案（任一相符即算對）：${args.acceptable.join('；')}
學生回答：「${args.answer}」`,
  };
}
