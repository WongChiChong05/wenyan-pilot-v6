import { CONFIG } from './config';
import type { TargetSentence } from './types';

/**
 * PROMPT DESIGN — what each rule comes from
 *
 * 1. Fixed generic question stems (strategies A–D), repeated verbatim.
 *    Rosenshine, Meister & Chapman (1996), RER 66(2), 181–221: generic question stems
 *    produced the largest effect of all prompt types (ES = 1.12).
 * 2. The socratic arm clarifies rather than argues.
 *    Palincsar & Brown (1984), Cognition and Instruction 1(2), 117–175: "clarifying" is
 *    one of the four reciprocal-teaching strategies and is the one that addresses decoding.
 * 3. The ladder always ends with the answer (bottom-out).
 *    Aleven, Roll, McLaren & Koedinger (2016), IJAIED 26(1), 205–223: keep a bottom-out
 *    hint so learners do not get stuck; supplement hints with prompted self-explanation.
 * 4. The reader must attempt before the explanation appears.
 *    Kornell, Hays & Bjork (2009), JEP:LMC: failed retrieval attempts still improve later
 *    learning. Sinha & Kapur (2021), RER 91(5): problem solving before instruction,
 *    g = 0.36 for conceptual knowledge and transfer.
 * 5. The reader must give a reason before the explanation appears.
 *    Bisra, Liu, Nesbit, Salimi & Winne (2018), Educational Psychology Review: prompting
 *    self-explanation, g = .55.
 * 6. The direct arm is a guardrailed explainer, not a free chatbot.
 *    Bastani et al. (2025), PNAS: unguarded GPT access lowered later unassisted exam
 *    performance by 17%; the guardrailed tutor did not.
 * 7. No grammar terminology in the socratic arm.
 *    劉潔玲、谷屹欣 (2017)：「僅僅知道一些專有名詞並未能幫助他們理解文言文的字義」.
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

## 回應規則
- 一次只問一個問題。
- 每則回應不超過 ${CONFIG.llm.maxCharsPerTurn} 字。
- 問題必須指向文本中的具體線索。
- 讀者答出結果後，若未說明依據，追問一次「你怎麼判斷的？」。
${SHARED_SCOPE}
## 四類策略句幹（逐字使用，不要改寫）
A 多策略交叉：${STRATEGY_STEMS.A}
B 語境一致性檢核：${STRATEGY_STEMS.B}
C 詞性與位置：${STRATEGY_STEMS.C}
D 白話遷移：${STRATEGY_STEMS.D}

## 輸出格式（只輸出 JSON，不要其他文字）
{"type":"question"|"probe","strategy":"A"|"B"|"C"|"D","text":"呈現給讀者的內容"}`;
}

export function directSystemPrompt(): string {
  return `你是文言文閱讀的解說者。你的任務是提供清楚、簡短的解釋。

## 絕對規則
1. 不得一次輸出整篇譯文。只解釋讀者選取的範圍。
2. 每則回應不超過 ${CONFIG.llm.maxCharsPerTurn} 字（與引導者版等長）。
3. 不提問，不要求讀者作答。
4. 可以使用語法術語。

## 依選取範圍回應
- 字詞（4 字以內）：給該詞在此句中的意思與詞性。
- 句子：給該句白話翻譯，並說明結構特點。
- 整段：給該段主旨說明，可指出關鍵句。
${SHARED_SCOPE}
## 輸出格式（只輸出 JSON，不要其他文字）
{"type":"explain","text":"呈現給讀者的內容"}`;
}

/** Layer-specific user message for the socratic arm. */
export function socraticTurnPrompt(args: {
  passage: string;
  selection: string;
  layer: 1 | 2;
  target?: TargetSentence;
  lastReaderTurn?: string;
}): string {
  const { passage, selection, layer, target, lastReaderTurn } = args;
  const fixed = target
    ? `\n這是目標句，第 ${layer} 層請使用以下固定問法（逐字）：\n${layer === 1 ? target.layer1 : target.layer2}`
    : '';
  return `原文：\n${passage}\n\n讀者選取：「${selection}」
${lastReaderTurn ? `讀者上一句回答：「${lastReaderTurn}」\n` : ''}目前在第 ${layer} 層。${
    layer === 1 ? '請以策略 C 的句幹起手提問。' : '請縮小範圍，或提供文中另一個對照句，再問一個問題。'
  }${fixed}`;
}

export function directTurnPrompt(args: {
  passage: string;
  selection: string;
  granularity: 'word' | 'sentence' | 'passage';
}): string {
  return `原文：\n${args.passage}\n\n讀者選取（粒度：${args.granularity}）：「${args.selection}」
請依粒度規則給出解釋。`;
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
