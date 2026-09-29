# 提問式 AI Prompt 設計與文獻優先閱讀報告

審閱日期：2026-09-26  
對象：wenyan-pilot 研究者 WCC  
範圍：現行程式 prompt、學姐建議、實驗文本安排、highlight 意圖澄清、認知負荷量表及直接相關文獻。

## 0. 證據範圍與限制

- 已直接檢查：`src/lib/prompts.ts`、`src/lib/engine.ts`、`src/lib/leak.ts`、`src/lib/reasonGate.ts`、`src/lib/config.ts`、`src/content/passages.ts`、`scripts/inspect-prompts.ts`、現有審閱與認知負荷文件。
- 已核對：本文列出的出版頁、DOI（Digital Object Identifier，數位物件識別碼）、ACL Anthology 論文頁及可取得全文。
- Claude 網頁停在登入頁，未能讀取 claude.ai「Motivational Agent」專案的即時記憶。`I cannot verify this.` 本文只整理工作目錄內的 `CLAUDE.md`、設計文件、程式與現有審閱文件，不能聲稱已匯出 Claude 專案全部內容。
- `npm run prompts:inspect -- 帝甚不平` 已嘗試執行，但 Node.js 回報 `uv_os_get_passwd returned ENOMEM`，因此未產生本次動態展開結果。以下 prompt 由現行來源碼逐項核對，不把 inspect 指令視為本次已通過。
- RKT：工作區的 `.claude/settings.local.json` 有 `rtk` 權限紀錄；PowerShell 找不到 `rkt`，Bash 檢查亦沒有傳回可用命令。後續以 `rg` 做限定範圍檢索。
- `[Inference]` 表示由現行實作與文獻推導的研究建議，不是論文直接證明。

## 1. 先給結論

### 1.1 現在最需要讀的五篇

閱讀順序不是按年份，而是按對現行 prompt 決策的直接性：

1. **Puech et al. (2025)**：最接近現行架構。核心不是「寫一個很長的好 prompt」，而是把多輪教學策略表示為外部 transition graph（狀態轉移圖），每輪只讓模型完成目前允許的教學意圖。現行 `ladder.ts` 方向正確，但尚未追蹤足夠的 learner state。
2. **Bastani et al. (2025)**：最直接回答為何不能只看使用 AI 時的表現。無護欄 GPT 提高練習表現，撤去 AI 後反而較差；有教師題目資訊與提示護欄的版本緩解此問題。
3. **Macina et al. (2023), MathDial**：提供 tutor moves 分類及「成功引導」與「過早 telling」必須同時測量的設計。這直接對應本專案的 leak audit。
4. **Bisra et al. (2018)**：支持要求 self-explanation（自我解釋）的方向；同時說明目前「四字、共享一字或出現連接詞即接受」只是操作化捷徑，不等於已驗證的自我解釋品質。
5. **Zhang & Choi (2025)**：直接支援 highlight 意圖不明時才 clarification（澄清），而不是每次都增加一步。現行「多字、非目標、非註解詞」才產生焦點選項，是合理的低成本近似，但不是經該論文驗證的演算法。

### 1.2 對學姐第一點的判斷

不建議把 S1、S2、S3、S5、S6 全部改成同一篇文章。

現行結構分別測：

- S3：同篇立即理解／內容保持。
- S5：新篇遷移，是主要結果。
- S6：另一新篇的延宕表現。

[Inference] 若全部改成同篇，分數會混入對原文、選項、題目位置與先前回饋的記憶；研究只能較有把握地談「同篇內容保持」，不能再把 S5 稱為新篇遷移。Barnett 與 Ceci 的 transfer taxonomy（遷移分類）及 National Academies 對 transfer 的定義都要求「把所學延伸至新情境」；完全相同文本不是新情境。

保留現行三層結構。若教授堅持提高文本一致性，較可辯護的版本是：

- 三組在每一個 stage 仍看到相同材料，維持組間公平。
- S3 保留同篇，測近端結果。
- S5 保留同文體、同難度、同語言點分布的平行新篇，測遷移。
- S6 保留另一篇，測延宕遷移。
- 題目由研究者固定並簽核；模型可生成練習提示，不應在正式測驗即時生成題目，否則每位參與者接受不同測量工具。

### 1.3 現在真正的 prompt 問題

現行 prompt 不是主要弱點；主要弱點是 prompt 外的語義保證不足：

1. 自由 highlight 的 layer 3 使用固定泛用選項，`answerIndex` 永遠是 0，並未依選取內容建立有效答案。
2. 自由 highlight 的 layer 1／2 正確答案由模型自報；伺服器只驗結構與禁語，不能證明唯一正解。
3. `socraticTurnPrompt()` 支援 `lastReaderTurn`，但現行 `socraticChoice()` 沒有傳入上一輪選項或理由。第二層不是根據讀者錯誤診斷後追問。
4. `strategy: A/B/C/D` 是模型自標，未經人工或獨立分類器確認。
5. reason gate 主要判「形式上像理由」，不是推理品質。
6. 目標句固定題仍是 `draft: true`，且部分 layer 2 已接近功能或意義判斷，需要人工確認是否違反「前兩層只觀察」原則。

## 2. 現行實驗與 prompt 執行圖

```text
讀者反白
  ├─ control：不呼叫模型
  ├─ direct
  │    ├─ 命中目標句：直接顯示固定 explanation
  │    └─ 自由選取：direct system + direct user → 檢查 → 重試一次 → fallback
  └─ socratic
       ├─ 多字、非目標、非已知註解詞
       │    └─ focus system + focus user → 2–4 個焦點候選 → 讀者選擇
       ├─ 命中目標句
       │    └─ 固定 layer 1 → 固定 layer 2 → 固定 layer 3 → 固定 explanation
       └─ 自由選取
            └─ Socratic system + layer user → 生成 MCQ
                 → 題幹／選項 leak check + 結構檢查
                 → 失敗重試一次 → 固定 observation fallback

每次選擇題都要求理由
  → 規則先判
  → 未定時 reasonJudge prompt
  → ladder 狀態機決定留在本層、下降或顯示 explanation
```

設計上最重要的責任分界：**模型產生本輪文字；伺服器決定本輪允許做什麼及何時顯示解釋。**

## 3. 全部 prompt inventory

以下分為「實際送給模型」與「參與者看到但不送模型」。動態欄位以 `{...}` 表示。

### 3.1 共同策略句幹

```text
A：你用了哪個線索？還有沒有第二個線索可以對照？
B：把你的解釋代回整句，通順嗎？哪裡卡住？
C：這個字在句子什麼位置？前後是什麼詞性？
D：如果這是白話文，你會怎麼判斷？同樣方法用在這裡呢？
```

這四句是本專案改寫，不是論文逐字句幹。A 的「有沒有」可能觸發 yes/no leak checker；B、D 接近意義檢核；C 預設單字範圍。它們只能當策略方向，不能當四個已驗證 treatment component。

### 3.2 `focusOptionsSystemPrompt()`

用途：提問組對多字自由反白先提出 2–4 個可能焦點，讓參與者指定想問哪個字或詞。

```text
你只負責從讀者反白的文言文片段中提出可能想問的字或詞，不解釋意思，也不出題。

規則：
1. options 必須有 2 至 4 個不同項目，每項都必須逐字出現在「讀者反白」中。
2. 每項限 1 至 6 個字；可以是單字或多字詞。
3. 優先列出虛詞、動詞、形容詞、生難詞；人名、官名等專名仍可列出，但排在最後。
4. 不加入字義、提示、括號說明或原文沒有的字。
5. 只輸出 JSON：{"options":["字詞一","字詞二"]}
```

### 3.3 `focusOptionsPrompt()`

```text
讀者反白：「{selection}」
所在句：「{neighborhood.containing}」
請列出最可能想問的字或詞。
```

`所在句` 只有找到 containing sentence 時才加入。

### 3.4 提問組 `socraticSystemPrompt()`

```text
你是文言文閱讀的引導者。你的唯一任務是透過提問，幫助讀者自己推導出理解。

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
- 每則回應不超過 60 字。
- 問題必須指向文本中的具體線索。
- 讀者答出結果後，若未說明依據，追問一次「你怎麼判斷的？」。

## 可以處理
虛詞的非常見義項、詞類活用、省略成分、特殊句式與標誌詞、古今異義、通假、
一詞多義、指代對象、句間邏輯關係、段落功能、語境提示充足的生僻字。

## 不處理（一律轉向註解）
語境提示不足的生僻字、典故、人名、地名、官職名。
固定回覆：「這個詞的解釋在註解裡，點一下就有。我們來看它在這句話裡的作用——」

## 四類策略句幹（只在適合選取範圍時使用，以上禁令優先）
A 多策略交叉：你用了哪個線索？還有沒有第二個線索可以對照？
B 語境一致性檢核：把你的解釋代回整句，通順嗎？哪裡卡住？
C 詞性與位置：這個字在句子什麼位置？前後是什麼詞性？
D 白話遷移：如果這是白話文，你會怎麼判斷？同樣方法用在這裡呢？

## 輸出格式（只輸出 JSON，不要其他文字）
{"type":"question","strategy":"A","text":"觀察問題","options":["觀察一","觀察二","觀察三"],"answerIndex":0}
answerIndex 是三個觀察選項中唯一正確者的零起算索引，只供伺服器評分。不得將答案寫入 text。
```

### 3.5 提問組 `socraticTurnPrompt()`

第一層：

```text
原文：
{passage}

讀者選取（粒度：{granularity}）：「{selection}」
選取位置：第 {selectionStart} 至 {selectionEnd}（零起算 UTF-16，終點不含）
【前一句】{prev}
【所在句】{containing}
【後一句】{next}
目前在第 1 層。請針對這個選取範圍提出一個觀察問題；必要時引述鄰句。
提供三個觀察選項，options 必須是三個不同的非空字串，answerIndex 必須是 0、1 或 2；只問位置、詞類、對照或可見線索間的關係，不問字義，也不得只問前後緊接哪個字。
```

第二層只替換為：

```text
目前在第 2 層。請提供文中另一個具體線索，再問一個觀察問題。
```

若第一次生成失敗，追加：

```text
上一次輸出未通過檢查（{retryFlags}）。請改用另一種題型並嚴格遵守禁令。
```

函式可加入：

```text
讀者上一句回答：「{lastReaderTurn}」
```

但現行自由選取生成路徑沒有傳入 `lastReaderTurn`。因此目前不是根據上一個錯誤或理由做個別化診斷。

### 3.6 直答組 `directSystemPrompt()`

```text
你是文言文閱讀的解說者。你的任務是提供清楚、簡短的解釋。

## 絕對規則
1. 不得一次輸出整篇譯文。只解釋讀者選取的範圍。
2. 每則回應不超過 60 字（與引導者版等長）。
3. 不提問，不要求讀者作答。
4. 可以使用語法術語。

## 依選取範圍回應
- 字詞（粒度標記 word，單一字）：給該字在此句中的意思與詞性。
- 句子：給該句白話翻譯，並說明結構特點。
- 整段：給該段主旨說明，可指出關鍵句。

## 可以處理
虛詞的非常見義項、詞類活用、省略成分、特殊句式與標誌詞、古今異義、通假、
一詞多義、指代對象、句間邏輯關係、段落功能、語境提示充足的生僻字。

## 不處理（一律轉向註解）
語境提示不足的生僻字、典故、人名、地名、官職名。
固定回覆：「這個詞的解釋在註解裡，點一下就有。我們來看它在這句話裡的作用——」

## 輸出格式（只輸出 JSON，不要其他文字）
{"type":"explain","text":"呈現給讀者的內容"}
```

### 3.7 直答組 `directTurnPrompt()`

```text
原文：
{passage}

讀者選取（粒度：{granularity}）：「{selection}」
請依粒度規則給出解釋。
```

重試時依失敗類型追加：

```text
上一次回覆未通過伺服器檢查。請修正後重新輸出：
- too_long：text 必須壓縮至 45 個字內，只保留所選範圍的核心解釋。
- whole_passage_translation：只解釋讀者選取的範圍，不得涵蓋多個其他句子。
- 其他：只輸出指定 JSON，並確保 text 是非空字串。
```

注意：system 上限是 60 字；重試文字要求 45 字。這是現行實作差異，不應在方法章寫成所有輸出都使用同一個 45 字上限。

### 3.8 `reasonJudgePrompt()`

System：

```text
你在判斷一段中文回答「有沒有給出理由」，不判斷理由對不對。

接受：指出原文的字詞或位置／說明因果／和白話或其他句子比較／推論錯誤但有講原因。
退回：空白或過短／沒有內容的說法（不知道、猜的、感覺、隨便）／只重複選項文字／與題目無關。

只輸出 JSON：{"verdict":"accept"|"reject","why":"不超過20字"}
```

User：

```text
句子：「{sentence}」
選項：(1) {option1}　(2) {option2}　(3) {option3}
讀者寫的理由：「{reason}」
```

這個模型只處理規則層無法決定的理由；它不判理由正確與否。

### 3.9 `answerJudgePrompt()`

System：

```text
你在判斷學生對一個文言文語言點的回答是否與參考答案一致（意思相同即可，不要求用語相同）。
只輸出 JSON：{"correct":true|false}
```

User：

```text
句子：「{sentence}」
參考答案（任一相符即算對）：{acceptable answers}
學生回答：「{answer}」
```

這是舊自由文字答案路徑；現行 layer 1／2 的新選擇題主要以索引判分。保留函式不代表每輪都使用。

### 3.10 不送給模型但會影響參與者的固定文字

焦點澄清：

```text
你主要想問這一段裡的哪一個字或詞？
```

焦點候選生成失敗時，候選由伺服器從反白及註解建立，不由 prompt 決定。

生成式 MCQ 失敗兩次的 fallback：

```text
題幹：先對照選取範圍前後的文字，你會從哪一處開始找線索？
選項：
1. 選取範圍之前的文字
2. 選取範圍之後的文字
3. 前後兩處一起對照
```

fallback 的 `answerIndex = null`，不能提早解鎖 explanation。

自由選取 layer 3：

```text
「{selection}」在這句話裡比較像哪一種用法？
1. 表示一個動作的對象
2. 連接前後兩件事
3. 形容前面的名詞
```

此處固定 `answerIndex = 0`。這是未解決限制，不是有效的泛用語義題。

目標句 TS1–TS4 的 layer 1、layer 2、layer 3 和 explanation 全部在 `src/content/passages.ts` 預寫；提問組與直答組命中目標句時不讓模型重寫最終 explanation。

## 4. Prompt 設計原則及現行符合程度

### 4.1 外部狀態機高於 prompt

原則：prompt 只產生目前 rung 的文字；是否進入下一層及顯示答案由伺服器決定。

依據：Puech et al. 將多輪 tutoring strategy 表示為 transition graph，並讓每輪 prompt 服從外部選定 intent。這比讓 LLM 自己決定教學階段更接近可重現的研究操弄。

現況：符合。`ladder.ts` 控制 disclosure；模型不能直接改 ladder。

缺口：現行 transition 只看選項正誤、理由是否存在及退回次數，沒有可靠的 misconception、confidence、request type 等 learner state。

### 4.2 Grounding 與正確答案來源分離

原則：模型可看到正確解法作為 grounding，但不能把它直接輸出；輸出還需獨立檢查。

依據：Bastani et al. 的 GPT Tutor prompt 包含教師提供解法、常見錯誤及對應提示，以降低錯誤回饋；Macina et al. 亦顯示 ground-truth solution 是重要 grounding，但 prompted LLM 仍可能 telling。

現況：目標句採固定教材，強。自由 highlight 沒有經人簽核的正確解法，弱。

[Inference] 自由 highlight 若維持即時生成，應把模型可用的「經簽核語言點資料」與「允許輸出的觀察層」分開，而不是只把完整 passage 丟給模型自判答案。

### 4.3 每輪單一教學意圖

原則：每一輪只執行一個清楚 intent，例如 clarify focus、ask for evidence、contrast cues、provide bottom-out hint。

依據：Puech et al. 把 strategy 拆成 single-turn tutoring intents；MathDial 將 teacher moves 分成 Focus、Probing、Telling、Generic。

現況：system prompt 同時放 A–D、十條禁令、scope、JSON 結構。雖有 layer 欄位，但模型仍自行選 strategy。

[Inference] 在不改實驗操弄的前提下，較乾淨的 prompt 組裝方式是：固定 base contract + server 選定的單一 intent chunk + 本輪文本 context + schema。不要把四種可能策略全部交給模型自由選。

### 4.4 Clarify only when necessary

原則：只有輸入存在多個合理 intent，且澄清的預期收益高於互動成本時才追問。

依據：Zhang & Choi 將決策形式化為「提高任務表現」與「減少澄清次數」的權衡；Rahmani et al. 指出 clarification datasets 與評估方式仍不一致。

現況：只對多字、非目標、非已知註解詞做焦點選擇，避免每次增加負擔。候選 2–4 個且允許「其他」。

缺口：觸發條件是字數／是否命中規則，不是實際 ambiguity。單字也可能多義；長片段也可能意圖明確。

### 4.5 同時測 success 與 telling

原則：不能只評估模型是否幫學生答對，也要評估是否太早透露答案。

依據：MathDial 使用 Success@k 與 Telling@k；Bastani et al. 分開 assisted practice 與 unassisted exam。

現況：有 leak flags、fallback、S5 無 AI 遷移測驗。方向符合。

缺口：regex 通過不代表語義不洩答；正式研究仍需全數人工 audit 所有送達的生成題及 `generatedAnswerIndex`。

### 4.6 Self-explanation 必須有內容，不只形式

原則：要求學生解釋自己的判斷依據，但評分規則要與構念對齊。

依據：Bisra et al. 的 meta-analysis 支持 prompted self-explanation 的整體方向。

現況：每個選項都要求理由；規則層先判，再用模型處理不確定案例。

缺口：共享原句一個字、出現因果連接詞或模型 fail-open 都可能放行。這適合降低卡住，不足以宣稱測得高品質 self-explanation。

## 5. 對學姐五點建議的處理

### 5.1 所有 stage 使用同一篇文章

結論：不直接採用。

研究代價：

- 移除 S5 的新篇遷移構念。
- 增加內容熟悉、題目熟悉及重複檢索效應。
- 生成不同問題不會消除參與者已看過相同句子與回饋的影響。
- 模型即時生成不同題目會增加受試者間 treatment variation；測驗題若也生成，測量工具不再固定。

教授需要決定的不是「模型能不能生成不同題目」，而是主要 outcome 要測：

- 同篇理解／保持；或
- 閱讀策略能否遷移到新篇。

若研究問題仍是提問式 AI 是否幫助文言文閱讀，現行同篇 S3 + 新篇 S5 + 延宕新篇 S6 的解釋力較完整。

### 5.2 深入理解全部 prompt

本文件第 2–4 節是現行 prompt inventory 與設計原則。教授審閱時應逐項回答：

1. 哪些內容是固定教材，哪些由模型生成？
2. 每輪教學 intent 是誰決定？
3. 模型知道哪些答案或教師資訊？
4. 哪些規則由 code enforce，哪些只寫在 prompt？
5. 生成失敗如何處理？
6. 送達內容如何完整稽核？
7. prompt／模型／教材在收案後如何凍結與版本化？

### 5.3 Highlight 後先讓參與者指定意圖

現行版本已部分實作：多字自由反白先提供 2–4 個原文內字詞，參與者可選候選或輸入「其他」。這比讓模型直接猜意圖合理。

需要補的研究規格：

- 把這一步明確命名為 focus clarification，不是第一層教學問題。
- 保存原始 highlight，不以焦點選擇覆寫原選取。
- 記錄觸發率、候選接受率、「其他」使用率及 degraded rate。
- 三組比較時說明只有提問組多這一步；它本身增加互動與認知負荷，是 treatment 的一部分，不是中性 UI。
- 不要每次都問；只在 ambiguity 足以影響下一輪題目時觸發。

### 5.3.1 新建議：取消選項，要求自由作答並說理由；答案即使錯也可繼續

這不是單純刪除三個按鈕，而是把提問組的 response format、階梯規則及測量構念全部改掉。現行設計是「三選項 + 必填理由」，新建議是「自由答案 + 理由，不以答案正確為通過條件」。

#### 教學上可成立的部分

- 自由產生答案比辨認選項更接近 generation（生成）而非 recognition（辨認），猜中機率不再是三分之一。
- 要求參與者同時寫判斷與文本依據，較直接操作化 self-explanation。
- 接受錯誤但有理由的回答，符合現行 `reasonJudgePrompt()` 的原則：判斷「有沒有理由」，不判理由對不對。
- 取消 layer 1／2 的模型生成 `answerIndex`，可移除目前「模型自稱哪一項正確，但伺服器不能驗證語義正確性」的風險。
- 先嘗試、允許失敗、之後再提供 instruction 的方向與 Kornell et al. 及 Sinha & Kapur 的研究機制相容。

#### 研究與介面代價

- 這會明確撤回已記錄的研究決定：自由 highlight 採 MCQ 是因舊 open-text 版本曾出現「不知道怎樣回答」及「不清楚何種回答算數」的問題。不能把這次修改描述成無成本改善。
- 提問組需要更多輸入時間及產出 effort；與直答組的 interaction dose、時間及 cognitive load 差距會更大。
- 若使用 LLM 判斷回答是否「夠像答案」或是否正確，模型重新取得了控制階梯的權力，違反現行 server-side disclosure invariant。
- 若任何答案都直接放行，無內容、複製題目、亂碼及「不知道」也可能形式上完成操弄；仍需要最小 attempt gate。
- 現行四個 target 的 layer 1／2 問法與教材是為三選項設計，移除選項後必須逐題重寫並重新簽核，不能只隱藏 UI 選項。
- 現行測試、interaction schema、reload recovery、audit 欄位與分析計畫都假設 layers 1／2 有選項及 `answerIndex`，需要同步修改。

#### 若教授採用，應使用的版本

不要判「答對才繼續」。改成 deterministic attempt gate（確定性作答門檻）：

```text
Layer 1 問觀察問題
  → 參與者填「我的判斷」及「我的理由／文本依據」
  → server 只檢查兩欄是否有實質嘗試
  → 不顯示正誤，固定進入 Layer 2

Layer 2 問另一個線索
  → 再填判斷及理由
  → server 檢查實質嘗試
  → 固定進入 Layer 3 bottom-out

Layer 3 提供經簽核的明確提示或答案框架
  → 顯示兩組相同的最終 explanation
```

最低 attempt gate 應只處理可確定的無內容輸入：空白、少於預先決定的最低字數、`不知道／猜的／隨便`、只複製題目。錯誤推論只要包含判斷及理由便接受。模型不得判斷是否進入下一層。

參與者提示可以是：

```text
你的判斷是什麼？請指出文中哪個字、位置或前後關係讓你這樣想。答錯沒有關係。
```

`[Inference]` 若採這個版本，最乾淨的研究描述不再是「答對可以提早解鎖」，而是「每位使用者完成固定兩次觀察與自我解釋後才取得 bottom-out hint」。這會提高 treatment consistency，但失去現行依答對縮短階梯的 adaptive path。

#### 建議判斷

這個方案在構念上比「模型生成 MCQ 並自報答案索引」乾淨，但只有在同時接受以下代價時才應採用：

1. 重寫並重新簽核全部 target layer 1／2 問題。
2. 取消 layers 1／2 的 correctness-based early unlock。
3. 固定兩輪作答，使每位提問組參與者接受相同最小提問劑量。
4. 先以 5–8 名不納入正式樣本的學生做認知訪談／可用性試跑，確認不再出現舊 open-text 卡住問題。
5. 把額外輸入時間及認知負荷視為 treatment component，在限制中報告。

若教授只要求「把選項拿掉」，但仍要求系統即時判斷答案正誤並自適應解鎖，則不應執行；它會把最不可靠的語義判斷重新交給 LLM。

### 5.4 使用 PSA service 部署

`[Unverified]` 「PSA service」的意思不明。若指 PaaS（Platform as a Service，平台即服務），這是部署決策，不是 prompt 設計。現行 repo 已有 Vercel 設定並要求 production 使用 PostgreSQL durable storage；不得用無持久磁碟的暫存 JSON store 收正式資料。

### 5.5 訓練後問卷聚焦認知負荷

現行 S4 已使用 Klepsch、Schmitz 與 Seufert（2017）第二版 differentiated cognitive-load questionnaire 的八題繁體中文研究翻譯：2 題 intrinsic、3 題 extraneous、3 題 germane，1–7 分。

可保留，但方法章必須寫：

- 這是研究翻譯，不是經香港大學生文言文閱讀樣本驗證的繁體中文版。
- 三個 subscale 分開分析，不把八題加成總分。
- N = 45 的內部一致性估計不精確。
- 後續 meta-analysis 對三因子提供部分支持，但三類負荷的相關有時不完全符合原理論；germane load 的理論地位仍有爭議。
- 不稱為 NASA-TLX（NASA Task Load Index，工作負荷量表）。

## 6. 文獻閱讀優先級與逐篇摘要

### P0-1 Puech et al. (2025)

Romain Puech, Jakub Macina, Julia Chatain, Mrinmaya Sachan, & Manu Kapur. *Towards the Pedagogical Steering of Large Language Models for Tutoring: A Case Study with Modeling Productive Failure*. Findings of ACL 2025, 26291–26311. https://doi.org/10.18653/v1/2025.findings-acl.1348

- 研究問題：如何讓 LLM 在多輪 tutoring 中服從學習科學定義的策略，而不是回到「有求必應」的 assistant 行為。
- 方法：StratL 先分類 student state，再由 learning scientist 設計的 transition graph 選出下一輪 tutoring intents，最後把短 intent-specific prompt chunks 加到 base prompt。另以模擬學生及 17 名新加坡高中生做初步場域評估。
- 結果：系統較能遵循 Productive Failure 策略；作者同時指出長篇自然語言 prompt 很難完整表達細緻的多輪教學策略。
- 對本專案：最支持 `ladder.ts` 外部控制；也指出下一步應是明確的 intent selection，而不是繼續把禁令塞入單一 system prompt。
- 限制：數學場景、場域樣本只有 17 人；主要證據是策略遵循，不是本研究的文言文學習效果。

### P0-2 Bastani et al. (2025)

Hamsa Bastani, Osbert Bastani, Alp Sungu, Haosen Ge, Özge Kabakcı, & Rei Mariman. *Generative AI without guardrails can harm learning: Evidence from high school mathematics*. PNAS, 122(26), e2422633122. https://doi.org/10.1073/pnas.2422633122

- 研究問題：生成式 AI 提高練習表現時，是否也提高撤去 AI 後的獨立學習表現。
- 方法：近千名高中生的場域隨機實驗，比較 control、一般 GPT Base、加入教師解法／常見錯誤／提示護欄的 GPT Tutor；每次先 assisted practice，再做 unassisted exam。
- 結果：GPT Base 練習分數提高 48%，GPT Tutor 提高 127%；撤去 AI 後 GPT Base 相對 control 低 17%，GPT Tutor 的負面效果大致被緩解。
- 對本專案：支持保留 S5 無 AI 結果；prompt 應使用經教師確認的 grounding 和提示，而不是只叫模型「不要直接給答案」。
- 限制：高中數學，不是文言文；百分比不能直接當本研究預期效果。

### P0-3 Macina et al. (2023), MathDial

Jakub Macina et al. *MathDial: A Dialogue Tutoring Dataset with Rich Pedagogical Properties Grounded in Math Reasoning Problems*. Findings of EMNLP 2023, 5602–5621. https://doi.org/10.18653/v1/2023.findings-emnlp.372

- 研究問題：如何建立包含高品質 pedagogical moves 的 tutoring dialogue data，並評估模型是否既能引導成功又不過早說答案。
- 方法：91 名教師與模擬學生建立約 3,000 段一對一數學 tutoring dialogues；teacher moves 分為 Focus、Probing、Telling、Generic；模型評估同時使用 Success@k 與 Telling@k。
- 結果：教師約 75% 對話主要用 scaffolding questions 解決 confusion，約 14% 需要揭露大部分答案；prompted ChatGPT 在互動評估有較高 telling rate，fine-tuned model telling 較少。
- 對本專案：layer 不應只標 A–D；至少要區分 focus、probe、tell。稽核必須同時報「幫到」與「洩答」。
- 限制：學生由 LLM 模擬；教師與真實學生互動方式可能不同；仍是數學解題。

### P0-4 Bisra et al. (2018)

Kiran Bisra, Qing Liu, John C. Nesbit, Farimah Salimi, & Philip H. Winne. *Inducing Self-Explanation: a Meta-Analysis*. Educational Psychology Review, 30, 703–725. https://doi.org/10.1007/s10648-018-9434-x

- 研究問題：提示學習者 self-explain 是否改善學習。
- 方法：64 份研究報告、69 個 effect sizes 的 meta-analysis。
- 結果：出版摘要報告整體加權 Hedges' g 約 .55。
- 對本專案：支持「選答案後說理由」的方向；prompt 應要求指出文本證據、關係或比較，而不是形式性補字。
- 限制：不能由 g = .55 推論本研究提高 55%；不同材料、prompt 和 self-explanation 深度差異很大；本文未提供本專案四字門檻的依據。

### P0-5 Zhang & Choi (2025)

Michael JQ Zhang & Eunsol Choi. *Clarify When Necessary: Resolving Ambiguity Through Interaction with LMs*. Findings of NAACL 2025, 5541–5558. https://doi.org/10.18653/v1/2025.findings-naacl.306

- 研究問題：LM assistant 應在什麼情況要求澄清，而不是直接作答。
- 方法：建立跨 QA、machine translation、natural language inference 的統一框架；以 intent distribution entropy 評估澄清的效用，並限制 interaction budget。
- 結果：IntentSim 較既有 uncertainty estimates 更能辨識哪些輸入會因 clarification 受益。
- 對本專案：支援「不清楚才問」；focus candidates 應被視為意圖澄清，不是教學 rung。
- 限制：沒有研究教育場景、highlight 或學習結果；現行字數規則不是 IntentSim 的實作。

### P1-1 Aleven et al. (2016)

Vincent Aleven, Ido Roll, Bruce M. McLaren, & Kenneth R. Koedinger. *Help Helps, But Only So Much: Research on Help Seeking with Intelligent Tutoring Systems*. International Journal of Artificial Intelligence in Education, 26, 205–223. https://doi.org/10.1007/s40593-015-0089-1

- 主題：智慧教學系統中的求助、提示序列、help abuse、help avoidance 及 bottom-out hints。
- 對本專案：支持階梯最後提供足夠資訊，避免學生永久卡住；也支持記錄求助行為本身。
- 不能推出：三層一定最佳、第二或第三次放行最佳、目前自由 highlight 的泛用 layer 3 有效。

### P1-2 Sinha & Kapur (2021)

Tanmay Sinha & Manu Kapur. *When Problem Solving Followed by Instruction Works: Evidence for Productive Failure*. Review of Educational Research, 91(5), 761–798. https://doi.org/10.3102/00346543211019105

- 研究問題：先解題再教學相對先教學再解題何時有效。
- 方法：53 項研究、166 個比較的 meta-analysis。
- 結果：PS-I（problem solving followed by instruction）整體 Hedges' g = 0.36，95% CI [0.20, 0.51]；效果受 implementation fidelity、年級與領域影響。
- 對本專案：支持「先嘗試，再提供 explanation」的機制假設。
- 限制：一次選擇題加理由不等於高 fidelity Productive Failure；年幼學習者及 domain-general skills 可能出現不同結果。

### P1-3 Palincsar & Brown (1984)

Annemarie Sullivan Palincsar & Ann L. Brown. *Reciprocal Teaching of Comprehension-Fostering and Comprehension-Monitoring Activities*. Cognition and Instruction, 1(2), 117–175. https://doi.org/10.1207/s1532690xci0102_1

- 研究問題：以 summarizing、questioning、clarifying、predicting 的 reciprocal teaching 改善弱閱讀理解者。
- 方法：七年級弱閱讀者的兩項教學研究；教師與學生輪流主持文本對話。
- 對本專案：最直接支持「遇到不懂時回到文本做 clarification」的閱讀教學背景。
- 限制：完整 reciprocal teaching 是組合介入且有人類導師；不能直接證明只保留 AI clarification 就有效。

### P1-4 Rosenshine, Meister, & Chapman (1996)

Barak Rosenshine, Carla Meister, & Saul Chapman. *Teaching Students to Generate Questions: A Review of the Intervention Studies*. Review of Educational Research, 66(2), 181–221. https://doi.org/10.3102/00346543066002181

- 研究問題：教學生產生問題是否改善閱讀理解。
- 方法：question-generation intervention review；結果測驗使用新材料。
- 結果：標準化測驗 median effect size .36，研究者自編測驗 .86。
- 對本專案：支持結構化 question stems 和新材料 transfer assessment 的方向。
- 限制：學生自己生題與被 AI 問題不同；不能把效果量套到 A–D 或本介面。

### P1-5 Barnett & Ceci (2002)

Susan M. Barnett & Stephen J. Ceci. *When and Where Do We Apply What We Learn? A Taxonomy for Far Transfer*. Psychological Bulletin, 128(4), 612–637. https://doi.org/10.1037/0033-2909.128.4.612

- 主題：以 knowledge domain 與 context dimensions 描述 transfer distance。
- 對本專案：提供 S3 同篇、S5 新篇、S6 延宕新篇的概念框架；不同文本可測是否超越內容記憶。
- 限制：taxonomy 不是指定本研究該用哪四篇文言文；平行難度仍需內容專家確認。

### P1-6 Klepsch, Schmitz, & Seufert (2017)

Melina Klepsch, Florian Schmitz, & Tina Seufert. *Development and Validation of Two Instruments Measuring Intrinsic, Extraneous, and Germane Cognitive Load*. Frontiers in Psychology, 8, 1997. https://doi.org/10.3389/fpsyg.2017.01997

- 研究問題：能否以主觀量表分開測 intrinsic、extraneous、germane cognitive load。
- 方法：開發 expert-rating 與 naïve-rating instruments，進行多項驗證研究。
- 對本專案：直接對應現行 S4 八題分量表；介面支援屬於可影響 extraneous／germane rating 的 treatment component。
- 限制：現行繁體中文題目是研究翻譯，未在香港大學生文言文閱讀驗證。

### P2-1 Kornell, Hays, & Bjork (2009)

Nate Kornell, Matthew J. Hays, & Robert A. Bjork. *Unsuccessful Retrieval Attempts Enhance Subsequent Learning*. Journal of Experimental Psychology: Learning, Memory, and Cognition, 35(4), 989–998. https://doi.org/10.1037/a0015729

- 方法：六項實驗，刻意安排失敗檢索後再顯示答案，與直接閱讀問題及答案比較。
- 結果：失敗檢索仍可改善後續學習。
- 對本專案：支持答錯不必立刻中止，之後仍提供正確資訊。
- 限制：一般知識／弱聯想記憶，不是文言文多輪理解；不能推論更多失敗一定更好。

### P2-2 Rahmani et al. (2023)

Hossein A. Rahmani et al. *A Survey on Asking Clarification Questions Datasets in Conversational Systems*. ACL 2023, 2698–2716. https://doi.org/10.18653/v1/2023.acl-long.152

- 主題：比較 clarification question datasets、tasks、metrics 與 benchmarks。
- 對本專案：提醒 clarification 必須另外評估觸發正確性、問題品質、使用者回應及最終任務改善。
- 限制：survey 指出現有研究資料與評估不一致；不能只引用它便宣稱本 focus UI 已經有效。

### P2-3 Wang et al. (2024), Tutor CoPilot

Rose E. Wang, Ana T. Ribeiro, Carly D. Robinson, Susanna Loeb, & Dora Demszky. *Tutor CoPilot: A Human-AI Approach for Scaling Real-Time Expertise*. EdWorkingPaper 24-1054. https://doi.org/10.26300/81nh-8262

- 方法：預註冊場域 RCT，900 名 tutors、1,800 名 K–12 students；AI 對人類 tutor 提供即時教學策略建議。
- 結果：treatment 學生 mastery 約提高 4 percentage points；低評分 tutor 的學生約提高 9 points；分析超過 550,000 則訊息。
- 對本專案：顯示明確 pedagogical strategy suggestions 可改變 tutor moves，並可用訊息分類器做 manipulation check。
- 限制：AI 輔助的是人類 tutor，不是直接面向學生；目前是 working paper，不應視為與本系統等同。

### P2-4 Krieglstein et al. (2022)

Krieglstein et al. *A Systematic Meta-analysis of the Reliability and Validity of Subjective Cognitive Load Questionnaires in Experimental Multimedia Learning Research*. Educational Psychology Review. https://doi.org/10.1007/s10648-022-09683-4

- 方法：比較四種常用 subjective cognitive-load questionnaires 的 reliability 與 validity。
- 結果：內部一致性整體可接受；三因子模型得到部分支持，但各類 load 間的相關並非完全符合理論。
- 對本專案：支持分量表而非單一總分，也要求如實處理構念爭議。
- 限制：multimedia learning 文獻不能自動驗證現行翻譯題目。

## 7. 建議的 prompt 審閱框架

教授最在意 prompt 時，不要只展示 system prompt。用以下矩陣逐個 scenario 審：

| Scenario | Server 選定 intent | 模型 grounding | 模型可輸出 | 程式檢查 | 人工檢查 |
|---|---|---|---|---|---|
| 多字自由反白 | clarify focus | 原反白、所在句 | 2–4 個原文子字串 | substring、去重、長度 | 候選是否合理 |
| 自由 layer 1 | observe first cue | 原文、offset、鄰句、焦點 | 題幹、3 選項、key | JSON、長度、禁語、結構 | 唯一正解、無語義洩答 |
| 自由 layer 2 | observe second cue | 同上、layer=2 | 題幹、3 選項、key | 同上 | 是否真的不同線索 |
| target layer 1/2 | fixed observation | 預寫教材 | 不呼叫模型 | content validation | 教授／教材審查者簽核 |
| layer 3 | bottom-out | 固定教材或有效語言點資料 | 明確選項 | client 不收 key | 自由選取目前未解決 |
| explanation | explain | target 固定；free 為原文+選取 | 短解釋 | 長度、粗略整篇檢查 | 正確性與範圍 |
| reason judge | reason presence | 句子、選項、理由 | accept/reject | schema、rule-first | 抽樣雙評者驗證 |

每個 prompt 版本至少保存：Git commit、`CONFIG.version`、provider、完整 model id、temperature、max tokens、完整 system/user templates、教材版本、validator 版本及 fallback 文字。

## 8. 收案前的研究優先級

### P0：不完成不能正式收案

1. 教授逐條審閱第 3 節全部 prompt，確認 manipulation definition。
2. 由教授在「三選項 + 理由」與「自由答案 + 理由、不判正誤」之間定案。這兩種是不同 treatment，不能收案後混用。
3. 若採自由作答，定案固定提問輪數、attempt gate、無正誤回饋及 layer 3 教材；不得讓 LLM 決定解鎖。
4. 決定自由 highlight layer 3：建立有效的內容 grounding／固定教材，或取消以正誤決定早解鎖；不能保留固定 key=0 並稱為有效答案。
5. 人工簽核 40 題、4 個 target ladders、4 篇文本；不能翻 `draft` 規避 gate。
6. 定案理由退回到底是第二次還是第三次強制放行，並同步規格、程式與測試。
7. 用實際研究 model 做 scenario matrix：單字、多字、跨句、重複字、非目標片語、註解詞、prompt injection、模型 timeout。
8. 對所有 pilot 中送達的 generated questions/options/answerIndex 做 100% post-hoc audit；若採自由作答，改為 audit 問題本身及 attempt-gate flags。

### P1：教授會問，方法章必須先寫清楚

1. 為何 S3 同篇、S5 新篇、S6 延宕新篇。
2. 為何 clarification 只在特定 highlight 觸發。
3. 兩個 AI 組相同的是 model parameters 與 target explanation；不同的是 prompt、回合、等待、讀者 effort，不能宣稱 treatment dose 完全相同。
4. 認知負荷量表是研究翻譯及三個 subscales，不是 NASA-TLX。
5. prompt 規則、regex guardrail、state machine、人工 audit 分別能證明什麼、不能證明什麼。

### P2：部署前完成

1. 確認「PSA」實際指哪個平台；若是 PaaS，核對 HTTPS、持久 PostgreSQL、backup、concurrency、secret management。
2. 封存正式 model id 與 provider request evidence。
3. 執行 `npm test`、`npm run typecheck`、`npm run smoke`、`npm run validate:content`；最後一項在未簽核前應失敗。

## 9. 可直接向教授說明的版本

本研究不是要求 LLM 自行決定如何教學。伺服器先決定目前是焦點澄清、第一層觀察、第二層觀察、bottom-out hint 或 explanation；LLM 只產生該層允許的文字。這個設計參考 intelligent tutoring、self-explanation、Productive Failure 和近期 pedagogical steering 研究。目標句使用研究者預寫且兩個 AI 組相同的 explanation；自由 highlight 的生成題另做結構、洩答、重試、fallback 及全數 audit。主要未解決問題不是 prompt 措辭，而是自由 highlight 的語義正確答案與 layer 3 尚未被可靠 grounding。

文本方面，S3 用同篇測立即理解，S5 用新篇測遷移，S6 用另一篇測延宕遷移。全部 stage 改成同篇會把內容記憶混入結果，並取消新篇遷移構念。是否接受這個代價必須由教授依主要研究問題定案。
