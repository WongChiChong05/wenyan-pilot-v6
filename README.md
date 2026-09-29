# wenyan-pilot（v6）

提問式 vs 直答式 AI 輔助對文言文閱讀遷移表現之影響 — 先導研究（pilot study）線上施測平台。

> **v6.0（2026-09-29）：主要結果改為行為（求助前是否先自己翻譯）。** 流程、指標、評分方式見 [v6 變更說明](docs/v6-變更說明.md)。本 README 以下各節記錄的是 v5.x，凡與 v6 變更說明衝突之處，以 v6 變更說明與 CLAUDE.md 為準。

對應設計文件：`claude/實驗設計-Pilot版-十五項決定.md`（v5.2）、`claude/設計與材料-修訂建議v5.md`（v5.1）。

2026-09-22 審閱入口：先讀 [三組提示詞與程式審閱指南](docs/程式與提示詞審閱指南.md)，再讀 [介面測試指南](docs/介面測試指南.md)、[認知負荷量表](docs/認知負荷量表.md)、[後端資料匯出指南](docs/資料匯出指南.md) 與 [Supabase 後端部署與驗證](docs/後端部署與驗證.md)。上述外部設計文件未全部包含於本工作目錄；本 README 的歷史紀錄不應取代現行程式或最新驗證紀錄。

---

## 0. 先讀這一節：哪些東西我驗證過，哪些沒有

| 項目 | 狀態 |
|---|---|
| 自動測試（含儲存契約與 SQL 結構） | **113 項通過**；完整證據範圍見部署文件 |
| 三臂完整流程（9 位假受試者）離線模擬 | **已執行，通過** |
| 內容檢查器會擋住佔位題目 | **已執行，如預期以 exit code 1 失敗** |
| 套件安裝 / `npm run build` / `npm run typecheck` | **已執行通過**；部署追蹤包含驅動，已移除本機私密資料參照 |
| 瀏覽器互動（選取文字、計時器、UI） | S2 已開啟檢視並修正提交 403；全螢幕切換阻礙完整操作，**未完成全部手動檢查** |
| LLM 供應商請求格式（Anthropic 與 Gemini）契約測試 | **已執行，6 項通過**（用假的 fetch 驗證送出的 URL、標頭、body 與回應解析） |
| 真實 API 呼叫（Anthropic） | 舊版焦點選項與選擇題曾在 Vercel dry-run 驗證；v5.8 開放作答流程尚未經真實 API 與瀏覽器驗證；Gemini 未驗證 |
| Supabase 後端 | **已在 Vercel dry-run 驗證**建立參與者、保存測驗、AI 互動及量表並跨請求讀回；正式多人負載仍未驗證 |

新增 `pg` 資料庫驅動與 PGlite 測試環境。教材仍未簽核；工程測試通過不代表可正式收案。自由選取第三層、理由退回次數及指標分母問題列於審閱指南。

---

## 0.5 要換成 Gemini（或 Claude）只改 `.env.local`

程式支援三種供應商，切換不需要改任何程式碼：

```
LLM_PROVIDER=gemini            # mock | anthropic | gemini
GEMINI_API_KEY=你的金鑰
LLM_MODEL=已在供應商帳號確認的模型版本     # 寫進論文方法章，整批固定
LLM_TEMPERATURE=0
LLM_MAX_TOKENS=300
```

- 換成 Claude：`LLM_PROVIDER=anthropic`、填 `ANTHROPIC_API_KEY`，另確認並固定可用的模型版本
- 離線開發：`LLM_PROVIDER=mock`（不需要金鑰）
- **不要用 `gemini-2.0-flash`**：官方已列為停用（最早 2026-06-01 關閉），見 https://ai.google.dev/gemini-api/docs/deprecations
- 模型可用性以帳號及[官方清單](https://ai.google.dev/gemini-api/docs/models)確認，不把 README 的舊型號當成持續有效的保證
- 不要用 preview 版本：收案期間可能改變或消失

程式位置：`src/lib/llm.ts` 的 `GeminiProvider`、`AnthropicProvider`、`getProvider()`；
兩臂共用的模型與參數只有一個來源：`src/lib/config.ts` 的 `CONFIG.llm`。
**換供應商會同時換掉兩臂**，這正是兩臂可比的前提；正式收案用哪一個，就把那個 model 字串寫進論文。

Gemini 的請求格式依官方 REST 參考（https://ai.google.dev/api/generate-content）：
`POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<KEY>`，
body 含 `systemInstruction`、`contents`、`generationConfig`，回應取 `candidates[0].content.parts[].text`。

---

## 0.8 程式碼導覽：從哪裡開始讀

沒寫過 React／Next.js 也能讀。**照這個順序看，大約 40 分鐘。**

### 第一步：資料長什麼樣（10 分鐘）

| 順序 | 檔案 | 看什麼 |
|---|---|---|
| 1 | `src/lib/types.ts` | 所有名詞的定義：一位受試者、一道題目、一句目標句、一筆互動紀錄各有哪些欄位。**這份看懂，其他都好懂。** |
| 2 | `src/lib/config.ts` | 所有數字：階段時限、字數上限、退回次數上限、模型設定、判準門檻。改實驗參數只改這裡。 |
| 3 | `src/content/passages.ts` | 四篇原文、註解、四句目標句；已撰寫，待人工校勘簽核。 |
| 4 | `src/content/items.ts` | 40 道題；已撰寫，待人工簽核。 |

### 第二步：核心規則怎麼實作（15 分鐘）

這四個檔案都是純函式，沒有畫面、沒有資料庫，可以單獨讀懂。

| 順序 | 檔案 | 看什麼 |
|---|---|---|
| 5 | `src/lib/ladder.ts` | **整個實驗的心臟。** 提問組的三層階梯狀態機。函式 `reduce(state, event)` 決定下一步；`explanationAllowed()` 就是「解釋能不能出現」的唯一判斷。 |
| 6 | `src/lib/reasonGate.ts` | 理由的接受與退回規則、黑名單、退回訊息。 |
| 7 | `src/lib/leak.ts` | 洩答偵測：禁用句式、語法術語、是非題。 |
| 8 | `src/lib/highlight.ts` | 粒度判定與下限判定。 |

搭配 `tests/unit.test.ts` 一起看：每個規則都有一個對應的測試，測試本身就是規格說明書。

### 第三步：一次 highlight 從頭到尾發生什麼（15 分鐘）

跟著這條路徑讀，就懂整個系統：

```
瀏覽器：讀者選取「擊之」
  src/app/run/page.tsx   → Reading 元件的 onMouseUp，送出 POST /api/assist
      ↓
伺服器：src/app/api/assist/route.ts
      ↓  找出這位受試者，建立 Engine
  src/lib/engine.ts  startAssist()
      ├─ 判斷粒度          → src/lib/highlight.ts
      ├─ 判斷是不是目標句   → src/lib/highlight.ts matchTarget()
      ├─ 依組別分三條路：
      │    對照組 → 只記錄，直接完成
      │    直答組 → 取出事先寫好的解釋（src/content/passages.ts）
      │    提問組 → 非目標多字自由選取先確認想問的字詞，再進第 1 層問題
      └─ 寫入互動紀錄       → src/lib/store.ts
      ↓
瀏覽器：顯示 AI 的話

讀者回答 → POST /api/assist（action: 'answer'）
  src/lib/engine.ts  reply()
      ├─ 判斷答案對不對     → 先比對 acceptableAnswers，比不出來才問模型
      ├─ 判斷有沒有理由     → src/lib/reasonGate.ts
      ├─ 推進狀態機        → src/lib/ladder.ts reduce()
      └─ 依狀態決定下一句話：再問一次／給選擇題／退回理由／給解釋
```

### 檔案總覽

| 檔案 | 做什麼 | 你會不會改 |
|---|---|---|
| `src/content/passages.ts` | 原文、註解、目標句 | **會，這是你的主要工作** |
| `src/content/items.ts` | 測驗題目 | **會** |
| `src/lib/config.ts` | 所有參數 | 可能（調時限、門檻） |
| `src/lib/prompts.ts` | 兩臂的 system prompt | 可能（試跑後微調） |
| `src/lib/types.ts` | 型別定義 | 不太會 |
| `src/lib/ladder.ts` | 提問階梯狀態機 | 不太會 |
| `src/lib/reasonGate.ts` | 理由把關 | 可能（調黑名單） |
| `src/lib/leak.ts` | 洩答偵測 | 可能（加禁用句式） |
| `src/lib/highlight.ts` | 粒度與下限 | 不太會 |
| `src/lib/engine.ts` | 把上面全部串起來 | 不太會 |
| `src/lib/scoring.ts` | 計分、α、鑑別度、κ | 不會 |
| `src/lib/randomize.ts` | 分層隨機分派 | 不會 |
| `src/lib/store.ts` | 資料存取 | 不會（除非換資料庫） |
| `src/lib/llm.ts` | 呼叫 Gemini／Claude | 不會 |
| `src/lib/view.ts` | 決定前端能看到什麼（答案在這裡被拿掉） | 不會 |
| `src/app/api/*/route.ts` | 網址端點 | 不會 |
| `src/app/*.tsx` | 畫面 | 只有要改畫面文字時 |
| `tests/*.test.ts` | 測試 | 不會 |
| `scripts/*` | 內容檢查、離線驗證、模擬 | 不會 |

### 讀 TypeScript 的三個提示

1. `interface X { a: string }` 是在定義「X 這種東西有哪些欄位」，不會產生任何執行時的程式碼。
2. `a: string`、`: Promise<void>` 這種冒號後面的東西都是型別標註，執行時會被拿掉。**第一次讀可以直接忽略冒號後面的部分。**
3. `async` / `await` 表示要等一件事完成（例如等資料庫或等模型回應）。

---

## 1. 教材現況：已經填好的、還缺的

所有內容都在 `src/content/`。`npm run validate:content` 在全部簽核完成前一律失敗（exit 1），
這是刻意的閘門，避免帶著草稿收資料。

### 1.1 已經填好（2026-09）

| 項目 | 狀態 | 來源 |
|---|---|---|
| 三篇《世說新語·汰侈》原文 | 已逐字比對維基文庫，已刪劉孝標注 | 維基文庫 |
| 註解釋義（前測 3 條、T2 10 條） | **已填**，每條帶 `source` 欄位 | 萌典／教育部《重編國語辭典修訂本》、漢典（教育部辭典無「甲煎」「𧟌」時）、法鼓人名規範資料庫、維基百科（專名） |
| S6 延遲篇原文《周書·王褒傳》節選 | **已填** | 澳門四校聯考 2024 中文科官方「試題及參考答案」PDF |
| S1／S3／S5 共 30 題 | **已寫完**（題幹、選項、正解、證據句、答案來源） | 見下 |
| S6-01..05 官方題 | **已照錄**，官方答案 26.B 27.B 28.A 29.D 30.C | 同一份官方 PDF |
| S6-06..10 自編題 | **已寫完** | 教育部辭典 |

答案來源怎麼寫的：

- **decode（虛詞／實詞）**：每題的 `source` 直接指向教育部《重編國語辭典修訂本》的某一個義項，並附該字條網址，例如 `https://www.moedict.tw/uni/畢`（副詞義「皆、全部」）。
- **comprehend（理解）**：只出「答案整句都落在證據句裡」的題。這是因為我們沒有兩種注譯本可以互校，所以不出任何需要靠注家解釋才能判定的題。
- **infer（推論）**：題幹一律用「最能」，`source` 欄位寫明推論必須靠哪一句。
- **check（注解檢核）**：答案就是本篇注解本身，而注解又有自己的字典出處。

驗證閘門新增了一條：每題的**證據句必須是該篇原文的子字串**，否則 `validate:content` 直接報錯。
寫題時這條規則抓到 5 處我自己抄錯標點的地方。

### 1.2 還缺的（需要人做，程式做不了）

| 缺什麼 | 誰做 | 為什麼程式不能代 |
|---|---|---|
| 三篇原文以**注譯本**核校（三民《新譯世說新語》＋余嘉錫《世說新語箋疏》），核校後把 `verified` 改 `true` | 你（借書即可） | 兩本書都沒有可自動擷取的電子版 |
| S6 原文以**人眼對照官方 PDF 版面**一次（特別是「左仆射」是否應作「左僕射」） | 你 | 目前文字是 PDF 轉文字取得，可能有正簡轉換誤差 |
| 四句目標句的**解釋文字與選項**簽核（目前 `draft: true`） | 指導教授一次性審查 | 這是實驗操弄本身，必須有人負責 |
| 40 題全部**簽核**（目前 `draft: true`） | 指導教授一次性審查 | 同上 |
| decode 題再以《古代漢語虛詞詞典》（商務）或《王力古漢語字典》**交叉檢核** | 你 | 兩本都無公開電子版 |

**`draft: true` 不等於「沒寫」。** 它的意思是「還沒有人簽核」。把某題改成 `draft: false`
是審查者的動作，不是作者的動作 —— 這個區分寫在 `src/content/items.ts` 檔頭，
`validate:content` 的錯誤訊息也分開兩種：`still a placeholder (content not written)`
與 `written but awaiting reviewer sign-off (draft: true)`。

### 1.3 授權提醒

S6-01..05 是澳門四校聯考的官方試題原文，此處作為研究用測驗工具照錄並標明出處。
若論文要**全文刊出**這五題，建議先向四校聯考辦公室確認授權。

---

## 2. 安裝與執行

```bash
cp .env.example .env.local      # 先不填 API key，預設 LLM_PROVIDER=mock 可離線跑
npm install
npm run typecheck               # TypeScript 型別檢查
npm test                        # 單元測試（vitest）
npm run smoke                   # 三臂離線模擬
npm run validate:content        # 內容檢查（現在應該失敗，因為題目還沒填）
npm run dev                     # http://localhost:3000
```

### 沒有 npm 也能驗證

```bash
node scripts/verify-offline.mjs
```

需要 Node ≥ 22.6（用內建的 TypeScript type stripping）。這支程式會把 `src/`、`tests/`、兩支 script 複製到 `.verify/`，改寫 import，再用同一份測試檔跑一次。**它不做型別檢查**，型別請用 `npm run typecheck`。

早期版本在 Node v22.22.2 的歷史輸出（不是本次測試數量；最新結果見部署文件）：

```
engine.test.ts: 9 passed, 0 failed
unit.test.ts: 28 passed, 0 failed
passages: 4, items: 40
...（62 個 ERROR，全部是「題目仍是佔位」「原文未核校」）
CONTENT NOT READY: 62 error(s)
content gate exit code: 1 (1 = placeholders still present, as expected)
participants: 9
arm counts  : { socratic: 3, direct: 3, control: 3 }
interactions: 132
events      : 45
leaking socratic questions: 0
socratic interactions checked: 36
SMOKE OK
OFFLINE VERIFICATION: OK
```

---

## 3. 設計規則 → 程式位置 → 驗證方式

這張表是給你逐條檢查用的。左邊每一條都是設計文件裡不可違反的規則。

| # | 設計規則 | 程式位置 | 自動驗證 |
|---|---|---|---|
| 1 | AI 不主動介入，只在讀者 highlight 後回應 | `src/app/api/assist/route.ts`（只有 `highlight` 才會開啟互動） | `engine.test.ts` 全部流程都由 `startAssist` 起頭 |
| 2 | highlight 粒度**完全自由**：讀者選什麼就存什麼（任意長度）；`classifyGranularity` 產出的 `word`／`sentence`／`passage` 只是 log 用的分類標籤，不再重寫選取 | `src/lib/highlight.ts: classifyGranularity`；`engine.ts: startAssist` 逐字存入 `active.selection` | `unit.test.ts > sentenceRanges + neighborhoodOf`、`engine.test.ts > selection is stored verbatim` |
| 3 | **三組都沒有使用下限**：用多用少是觀察對象，不是要求 | `src/lib/config.ts: lowerBoundArms`（空陣列）、`highlight.ts: lowerBoundApplies` | `unit.test.ts > gates no arm` |
| 3b | 四句目標句仍然**逐句記錄**，作為使用量指標與 S5 的共變項 | `engine.ts: completeInteraction`、`api/admin/summary` 的 `usageByArm` | `engine.test.ts > records each target sentence exactly once` |
| 3c | 唯一的門檻是**停留時間**，三組相同 | `CONFIG.minReadingSeconds`、`api/advance/route.ts` | 讀該檔 |
| 3d | 「完全沒用過」要被記下來，但**不得當成排除** | `advance/route.ts` 的 `no_assist_used`、`CONFIG.exclusion.descriptiveOnly` | 讀該檔；summary 的 `excluded` 不含描述性旗標 |
| 4 | 提問組：解釋只在「嘗試過且給過理由」之後出現 | `src/lib/ladder.ts`（伺服器端狀態機，模型無權決定） | `unit.test.ts > socratic ladder`、`smoke-run.ts` 逐一互動檢查 |
| 4b | v5.8 提問組每層均自行輸入答案與理由；答案即使不正確，理由有內容才進下一層；三層後顯示解釋 | `src/lib/ladder.ts: open_response`、`src/lib/engine.ts: replyOpen` | `engine.test.ts > Socratic arm: open answer and reason` |
| 4c | 層一層二只問「觀察」，不問意思，不得預告最後解釋 | `src/content/passages.ts: layer1/layer2`、`src/lib/prompts.ts: socraticOpenSystemPrompt` | `validate:content` 檢查預寫問句，`engine.test.ts` 檢查模型問句洩答 |
| 4d | 自由 highlight 的層一／層二由模型產生開放題；問題洩答、含選項或格式錯誤時重試一次，再退到固定開放觀察題 | `src/lib/engine.ts: socraticOpenQuestion`、`src/lib/leak.ts: checkSocraticOutput` | `engine.test.ts > retries a generated question once` |
| 4e | 模型原始回覆與檢查旗標存入互動列，生成選項與答案索引不再供新互動使用 | `src/lib/engine.ts: socraticStep`、`src/lib/types.ts: InteractionRow` | `engine.test.ts > never persists options` |
| 4f | 非目標多字反白由讀者自行輸入焦點，必須出現在原反白內，不提供建議選項 | `src/lib/engine.ts: startAssist`／`reply`、`src/app/run/page.tsx` | `engine.test.ts > focus as free text` |
| 5 | 理由把關看「有沒有理由」，不看對錯 | `src/lib/reasonGate.ts` | `unit.test.ts > reason gate rules` |
| 6 | v5.8 開放作答：理由不足會停留原層，不能用重複「猜的」繞過；舊選擇題互動仍保留舊版退回上限 | `src/lib/engine.ts: replyOpen`、`src/lib/reasonGate.ts` | `engine.test.ts > does not advance after repeated contentless reasons` |
| 7 | 目標句的解釋兩臂逐字相同 | `src/lib/engine.ts: explanationFor`（目標句一律用 content 裡的文字） | `engine.test.ts > gives the direct arm the SAME explanation` |
| 8 | 提問組不得洩答（含「加了問號的答案」），不得使用只抄相鄰字的低價值題；新流程不產生選項 | `src/lib/leak.ts: checkSocraticOutput` + `engine.ts: socraticOpenQuestion` 的重生成與降級 | `unit.test.ts > leak detection`、`engine.test.ts > blocks a question that leaks an answer` |
| 9 | 直答組不得一次給整篇譯文 | `src/lib/leak.ts: checkDirectOutput` | `unit.test.ts > flags a whole-passage translation` |
| 10 | 對照組 highlight 只記錄、不回應；沒有側欄；三組都不看到底色 | `src/lib/config.ts: targetHintArms`（空陣列）、`src/lib/view.ts`（targets 給空陣列）、`view.ts: assist.sidebar` | `unit.test.ts > shades the target sentences for nobody` |
| 11 | 兩臂共用同一模型與參數 | `src/lib/config.ts: CONFIG.llm`（唯一來源） | system/user prompt 及呼叫次數不同；不能稱為只有 system prompt 不同 |
| 12 | 分派在伺服器端、依前測分層、三臂平衡 | `src/lib/randomize.ts`、`src/app/api/quiz/route.ts` | `unit.test.ts > randomisation`；smoke 產出 3/3/3 |
| 13 | 計分只在伺服器端，前端拿不到答案 | `src/lib/view.ts: publicItem`（唯一輸出給前端的形狀） | 搜尋 `answerIndex` 只會出現在 server 檔案 |
| 14 | 遷移篇沒有註解、沒有查檢題 | `src/content/passages.ts`（T1 annotations 為空）、`validate-content.ts` | `npm run validate:content` |
| 15 | 逾時不刪人，只標記（ITT） | `src/app/api/advance/route.ts` | 讀該檔；`excludeFlags` 只加標記，不刪資料 |
| 16 | 分頁切換超過 3 次標記 | `src/app/api/event/route.ts` | 同上 |
| 16b | 作答階段全螢幕、離開會被記錄（**只嚇阻與記錄，不是強制**） | `src/lib/config.ts: proctor`、`run/page.tsx: useProctor`／`FullscreenGate` | 讀該檔；`visibility_change` 與 `fullscreen_exit` 共用同一個排除門檻 |
| 17 | 延遲測驗只能用專屬連結；電郵另表保存，只供人工寄送並於完成或逾期後清除 | `src/app/api/state/route.ts`、`participant_contacts`、`api/admin/export?table=contact-reminders` | 讀該檔及 migration 003 |
| 18 | 只有正文可以 highlight | CSS：`src/app/globals.css` 的 `.passage-body`；**保證**：`src/lib/engine.ts: startAssist` 檢查選取字串是否為正文子字串 | `engine.test.ts > only the passage body can be highlighted` |
| 19 | 一次只能開一個互動（鎖定），換句要手動解鎖 | 伺服器：`src/app/api/assist/route.ts` 對進行中的互動回 409；前端：`run/page.tsx` 的 `LockState` | 讀該檔；`assist/route.ts` 的守衛在 `startAssist` 之前 |
| 20 | 重新整理不能把讀者鎖死 | `src/lib/engine.ts: pendingTurnFor` + `src/app/api/state/route.ts` | `engine.test.ts > reload recovery` |
| 21 | 側欄對話紀錄不得洩漏 `inTargetSentence`／`strategy`／`rawResponse` | `src/app/api/transcript/route.ts`（明列送出欄位） | 讀該檔的欄位白名單 |
| 22 | **同一階段的題目不得互相洩答** | `scripts/validate-content.ts` 的 cross-item leakage 檢查 | `validate:content`；把舊的洩漏改回去會立刻報錯（已實測） |
| 23 | 受試者看到的篇名不得帶內部編號或篇章名 | `Passage.displayTitle`（`title` 只給研究者，不送前端） | `validate:content` 擋下含數字／＋／等於內部標題的 displayTitle |
| 24 | 延遲測驗只開一天：前一天做完，隔天開放，再隔一天關閉 | `CONFIG.delayedTest = { minHours: 24, maxHours: 48 }`、`api/state/route.ts` 兩端都擋 | 讀該檔 |
| 25 | 選取超過一個字時不得說「這個字」；選取單獨無法理解時**必須引述鄰句**（Task B） | `src/lib/prompts.ts: socraticSystemPrompt`（絕對禁令＋鄰句規則）、`socraticTurnPrompt` 帶入 offset 與前後句 (`neighborhoodOf`)；`fallbackQuestion`／`LOCALISE_QUESTION` 只在降級路徑保留 | `unit.test.ts > Task-B: socratic prompts carry offset + neighbourhood`、`unit.test.ts > system prompt forbids saying 「這個字」` |
| 26 | 沒接模型時的 mock 必須長得像真的 | `src/lib/llm.ts: getProvider` 依 system prompt 分支；解釋文字自稱「示範模式」 | 讀該檔；不接 key 跑 `npm run dev` 時直答組應出現解釋而非問題 |

手動檢查建議（5 分鐘）：

```bash
grep -rn "answerIndex" src/ | grep -v "src/lib\|src/content\|src/app/api"   # 應該沒有輸出
grep -rn "CONFIG.llm" src/                                                  # 兩臂共用設定的唯一來源
```

---

## 4. 提示詞設計與依據

完整說明寫在 `src/lib/prompts.ts` 的檔頭註解，對應文獻：

| 設計 | 依據 |
|---|---|
| 通用提問策略（A–D 為本專案改寫，不是論文逐字引文） | Rosenshine et al. (1996) 研究學生生成問題；不能將效果量直接套在 AI 提問介面 |
| 提問處理「澄清」而非論辯 | Palincsar & Brown (1984), *Cognition and Instruction* 1(2), 117–175 |
| 階梯最後一定給答案 | Aleven, Roll, McLaren & Koedinger (2016), *IJAIED* 26(1), 205–223（bottom-out hint；並建議加上自我解釋） |
| 先嘗試再給答案 | Kornell, Hays & Bjork (2009), *JEP:LMC*；Sinha & Kapur (2021), *RER* 91(5)：g = 0.36 |
| 必須寫理由才看到解釋 | Bisra, Liu, Nesbit, Salimi & Winne (2018), *Educational Psychology Review*：g = .55 |
| 直答臂是有護欄的解說者 | Bastani et al. (2025), *PNAS*：無護欄 GPT 使後測低 17%，有護欄則無顯著差異 |
| 不教指定語法術語 | 本專案操弄選擇；劉潔玲、谷屹欣（2017）是閱讀困難背景，不是禁止術語的實驗證據；舊未核實引文已移除 |

各篇完整題名、可取得的原文、支持範圍與不能推出的主張，見 [審閱指南 §7](docs/程式與提示詞審閱指南.md#7-文獻支持到哪一層不能推出什麼)。不是每篇全文都已取得。

連結：
- https://www.formapex.com/telechargementpublic/rosenshine1996a.pdf
- https://images.scholastic.co.uk/assets/a/d6/6f/palincsar-reciprocal-teaching-1619152.pdf
- https://www.cs.cmu.edu/~aleven/Papers/2016/Aleven_etal_IJAIED2016-Helpseeking.pdf
- https://web.williams.edu/Psychology/Faculty/Kornell/Publications/Kornell.Hays.Bjork.2009.pdf
- https://journals.sagepub.com/doi/10.3102/00346543211019105
- https://link.springer.com/article/10.1007/s10648-018-9434-x
- https://www.pnas.org/doi/10.1073/pnas.2422633122

---

## 4.5 S2 閱讀畫面：版面與互動

```
┌──────────── 1064px ────────────┐
│ ┌── 680 ──────┐  ┌── 360 ────┐ │
│ │ 計時器       │  │ 對話紀錄   │ │
│ │ 說明        │  │  （整段 S2  │ │
│ │ 正文（可選取）│  │   連續顯示） │ │
│ │ 註解        │  │            │ │
│ │ 下一階段     │  │ ─────────  │ │
│ │             │  │ 輸入／選項／ │ │
│ │             │  │ 解鎖按鈕    │ │
│ └─────────────┘  └───────────┘ │
└────────────────────────────────┘
螢幕 < 1100px 時側欄改排到正文下方。
```

**四條互動規則**

1. **只有正文可選取。** 說明、註解、側欄都是 `user-select: none`。這只是方便；
   真正的保證在伺服器：`startAssist` 會拒絕不是正文子字串的選取字串。
2. **一次一句（鎖定）。** 標記之後正文變淡、不能再選，直到這一句結束。
   伺服器對進行中的互動回 409，所以繞過前端也沒用。
3. **解鎖是手動的。** 對話結束後正文仍鎖著，要按「解鎖，換下一句」才能標下一處。
   這是刻意的：換句是一個明確的動作，不會因為手滑拖到別處就把爬到一半的 ladder 丟掉。
4. **側欄是一整條連續對話**，不是每句一條。讀者可以往上捲看之前問過的句子與答案。

**提問組的階梯（目標句）**

```
層一  開放式觀察題＋自行作答與說理 ─► 層二
層二  開放式觀察題＋自行作答與說理 ─► 層三
層三  開放式理解題＋自行作答與說理 ─► 解釋
理由不足：留在同層重答，直到提供有內容的理由
解釋  按「看完了」 ─► 這一句結束，正文解鎖
```

層一層二只問**觀察**，第三層才問理解。讀者每層都需自行寫出判斷與理由；理由門檻只檢查有無依據，不判答案真假。這避免選擇題的猜中機率與選項提示，但也失去機器直接判定每層答對率的資料。

**自由標記（非目標句）** 的第一、二層由模型產生開放題；洩答或格式不合格重試一次，仍失敗則回退固定開放觀察題。生成問題的語義品質仍需人工稽核。舊選擇題欄位與處理路徑僅供既有互動恢復，不用於 v5.8 新互動。

**三臂的版面差異**

| | 底色四句 | 側欄 | 使用下限 | 進入下一階段的門檻 | 鎖定 |
|---|---|---|---|---|---|
| 提問組 | **沒有** | 有 | **沒有** | 停留 180 秒 | 有 |
| 直答組 | **沒有** | 有 | **沒有** | 停留 180 秒 | 有 |
| 對照組 | **沒有**（伺服器連 targets 清單都不給） | **沒有** | **沒有** | 停留 180 秒 | 有 |

**三組都沒有使用下限。** 用多用少是這個先導研究要觀察的東西之一——「學生會不會自願使用一個一直反問的 AI，還是乾脆放棄自己讀」本身就是結果。強迫一個最低使用量，等於讓這個問題在設計上無法回答。

代價（要寫進限制）：

1. **提問組 vs 直答組失去曝光量對等。** 一組平均問五句、另一組問兩句時，S5 的差異就混了「被提問而非被告知」與「用得比較多」。使用量必須進入分析當共變項或中介變項，不能再假設相等。
2. **完全沒用的人是「治療組裡的未治療者」。** ITT 仍然把他們算進去（那正是 ITT 的意思），但每組 15 人時，幾個沒用的人就會明顯稀釋效果。
3. `lowerBoundMetRate` **換了意思**：原本是「規定有沒有被遵守」的可行性檢核，現在是「有多少人自己選擇用完四句」。儀表板上改名為 `usedAllFourRate`，門檻值留著只當參考線，不再是及格線。

`/api/admin/summary` 新增 `usageByArm`：每組的平均標記次數、平均用掉幾句目標句、完全沒用的比率、用滿四句的比率。這四個數字就是上面那個共變項的描述統計。

`no_assist_used` 旗標記錄「一次都沒用」，但列在 `CONFIG.exclusion.descriptiveOnly` 裡，**不會**被算成排除——把「選擇不用」當成廢卷會悄悄毀掉 ITT。

正文欄在三臂一律 680px，所以行長一致——對照組雖然沒有側欄，閱讀難度不會因為行變長而不同。

---

## 4.8 作答期間的「防離開」：能做到什麼、做不到什麼

**做得到**

| 手段 | 程式位置 | 效果 |
|---|---|---|
| 作答階段要求全螢幕 | `FullscreenGate` | 開始前要按一次按鈕（瀏覽器只在使用者手勢下給全螢幕） |
| 離開全螢幕時擋一層並要求回來 | 同上 | 記 `fullscreen_exit`，畫面蓋上提示，計時器不停 |
| 切換視窗記錄 | `useProctor` | 記 `window_blur`，補 `visibilitychange` 在部分平台漏掉的情況 |
| 關閉或離開頁面時瀏覽器詢問 | `beforeunload` | 顯示瀏覽器自己的「離開網站？」，文字無法自訂 |
| 超過門檻標記排除 | `api/event/route.ts` | `visibility_change` ＋ `fullscreen_exit` 合計超過 `maxVisibilityChanges` 就加 `tab_switching` 旗標 |

**做不到（不要在論文裡寫成做得到）**

- 擋不住 Alt-Tab、第二個螢幕、旁邊放一支手機、直接闔上筆電。
- 擋不住 Esc 離開全螢幕。任何瀏覽器 API 都沒有這個權限，只能事後知道。
- 擋不住截圖、拍照、或請別人代答。
- `beforeunload` 只是一個確認框，按一下就能離開，而且**本來就該如此**。

**為什麼不做更硬的封鎖**

同意書寫著「你可以隨時關閉頁面退出，不會有任何影響」。真的把出口堵死會和這句話衝突。
所以這裡的做法是：讓離開變成一個需要刻意做的動作，而且一定留下紀錄；
真正保護分析的是排除旗標與 `events` 表，不是封鎖。

`window_blur` 刻意**不計入**排除門檻——點一下網址列或跳出一個通知都會觸發，
拿來當排除標準會把幾乎所有人都排掉。它只記錄下來供你檢視。

---

## 4.9 題目互相洩答的檢查

同一階段的題目是**一次全部呈現**的，所以 A 題的題幹或選項如果寫出 B 題的答案，B 題就變成送分題。

手動讀過一遍，加上一支掃描程式，找出並修掉這些：

| 洩漏 | 情況 | 處理 |
|---|---|---|
| S5-05 → S5-08 | S5-05 考「駛」＝**跑得快**，S5-08 的題幹開頭就寫「石崇的牛**跑得快**」 | 改題幹為「真正的差別在哪裡」 |
| S5-04 → S5-06 | S5-04 考「豫」＝**事先**，S5-06 的正解寫「**事先**把豆子做成熟末」 | 正解改為「把豆子做成熟末備用」 |
| S5-09 → S5-12 | S5-09 的正解就是「用二十頭肥牛來換」，S5-12 要推的正是這個交換的用意 | S5-09 改問「牛最初怎麼到王太尉手上」 |
| S3-08 → S3-09 | S3-08 的正解（石崇拿出更多更好的珊瑚樹）直接給出舊 S3-09 的推論 | S3-09 改問石崇「不足恨，今還卿」的態度 |
| S1-05 ↔ S1-06 | 兩題的正解都寫「換上新衣」 | S1-06 改問態度差別，不再重複換衣機制 |
| 官方 Q30 → 自編 S6-08/09/10 | 官方第 30 題選項 B 寫出「姑父蕭子雲…書法」、選項 D 寫出「不以官位**誇耀**於人，反而愈加**謙虛**」，一次洩漏三題 | 官方題不能動，三題自編題全部改到官方碰不到的段落（襲爵、起家官職、家世三句） |

**自動檢查**：`validate:content` 現在會擋下「A 題的正解原文（三個中文字以上）出現在同階段 B 題的題幹或選項裡」。規則刻意寫窄——同一篇文章的題目必然共用專名（珊瑚樹、王褒、王僧辯），那不是洩答。語意層次的洩漏（換句話說、理解題答案蘊含推論題答案）仍然要靠人讀，這條只保證機械式的不會再回來。

這條規則已經實測過會觸發：把 S5-08 的題幹改回舊版，`validate:content` 立刻報
`item S5-05's answer 「跑得快」 is repeated in S5-08`。

---

## 5. 手動瀏覽器檢查清單

1. `npm run dev`，開 `http://localhost:3000`，填同意書 → 應轉到 `/run?t=...`
2. S1 作答 → 交卷後看 `data/db.json`：該participant 應該有 `arm`、`stratum`、`pretestScore`
3. S2：
   - 用滑鼠選一個字 → 提問組應出現問題、直答組應出現解釋、對照組沒有回應
   - 提問組第一層有答案與理由欄，沒有選項；即使答案錯誤，有理由也進下一層
   - 理由寫「猜的」→ 應被退回，訊息為「請說說你為什麼這樣判斷…」
   - 每層寫有內容的答案與理由；第三層後才出現解釋與「看完了」
   - 不使用協助也能在 180 秒後繼續；不設四句完成下限
4. 切換分頁 4 次 → `data/db.json` 中該人應出現 `tab_switching` 標記
5. 嘗試複製文章文字 → 應該複製不到
6. 走到最後 → 應顯示延遲測驗連結與最早可作答日期
7. 管理者以 `Authorization: Bearer <ADMIN_PASSWORD>` 讀取 `/api/admin/summary`；正式環境不接受網址密碼

可用 `npm run demo:seed` 建立三組本機假資料連結；完整步驟及未驗證項目見 [介面測試指南](docs/介面測試指南.md)。

---

## 6. 資料與匯出

五張研究表：`participants`、`responses`、`interactions`、`events`、`scales`。直接識別資料另存於 `participant_contacts`；分析用一人一列檔由 `api/admin/export?table=wide` 產生。

逐步操作與欄位說明見 [後端資料匯出指南](docs/資料匯出指南.md)。

```
Authorization: Bearer <ADMIN_PASSWORD>
GET /api/admin/export?table=responses     # CSV
GET /api/admin/summary                    # 營運摘要，正式分析另核對分母
```

`interactions` 保留生成文字的原始回傳（`rawResponse`）與檢查旗標（`leakFlags`），理由判定另在 `events.reason_judgement`。旗標包括攔截後重新生成，不等於讀者實際看到洩答；正式操弄檢核需要人工判讀。
`events` 的 `read_done_click` 內含每句的結束位置（v5.8 為 `open_response`）、退回次數、是否「理由不足」、花費毫秒。

---

## 7. 已知限制

- 檔案式儲存限單程序開發；Supabase/PostgreSQL 已完成單一 dry-run 流程驗證，正式多人負載仍待驗證。
- 非目標句前兩層由模型生成；生成問題的語義有效性仍需人工稽核。第三層改為固定開放式理解題。
- 階段計時與延遲窗口已由伺服器驗證；前端 `rtMs` 仍非真正逐題反應時間。
- 理由退回次數與規格註解衝突；教材簽核、模型語義、摘要指標及暴露量限制見審閱指南。
- 手機版沒有特別處理，建議只開放桌機作答。
