# wenyan-pilot

提問式 vs 直答式 AI 輔助對文言文閱讀遷移表現之影響 — 先導研究（pilot study）線上施測平台。

對應設計文件：`claude/實驗設計-Pilot版-十五項決定.md`（v5.2）、`claude/設計與材料-修訂建議v5.md`（v5.1）。

---

## 0. 先讀這一節：哪些東西我驗證過，哪些沒有

| 項目 | 狀態 |
|---|---|
| 純邏輯（階梯、理由把關、洩答偵測、分派、計分、信度）單元測試 | **已執行，37 項全過** |
| 三臂完整流程（9 位假受試者）離線模擬 | **已執行，通過** |
| 內容檢查器會擋住佔位題目 | **已執行，如預期以 exit code 1 失敗** |
| `npm install` / `npm run build` / `npm run typecheck` | **未執行。** 我的沙箱無法連到 npm registry（403）。你要在本機跑一次 |
| 瀏覽器互動（選取文字、計時器、UI） | **未執行**。第 5 節有手動檢查清單 |
| LLM 供應商請求格式（Anthropic 與 Gemini）契約測試 | **已執行，6 項通過**（用假的 fetch 驗證送出的 URL、標頭、body 與回應解析） |
| 真實 API 呼叫（Anthropic / Gemini） | **未執行**。程式用 `fetch` 直打官方端點，請自行以一次真實呼叫確認 |
| Supabase 介面 | **未實作**。已測的儲存層是檔案式 `JsonStore`；`supabase/schema.sql` 只是給你日後搬家用 |

我沒有裝任何外部套件，程式只依賴 Next.js / React 與 Node 內建模組。

---

## 0.5 要換成 Gemini（或 Claude）只改 `.env.local`

程式支援三種供應商，切換不需要改任何程式碼：

```
LLM_PROVIDER=gemini            # mock | anthropic | gemini
GEMINI_API_KEY=你的金鑰
LLM_MODEL=gemini-2.5-flash     # 這個字串要寫進論文方法章
LLM_TEMPERATURE=0
LLM_MAX_TOKENS=300
```

- 換成 Claude：`LLM_PROVIDER=anthropic`、填 `ANTHROPIC_API_KEY`、`LLM_MODEL=claude-3-5-haiku-20241022`
- 離線開發：`LLM_PROVIDER=mock`（不需要金鑰）
- **不要用 `gemini-2.0-flash`**：官方已列為停用（最早 2026-06-01 關閉），見 https://ai.google.dev/gemini-api/docs/deprecations
- 可用的穩定版：`gemini-2.5-flash`、`gemini-3.5-flash-lite`、`gemini-3.6-flash`（見 https://ai.google.dev/gemini-api/docs/models）
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
| 3 | `src/content/passages.ts` | 三篇原文、註解、四句目標句。**你要填的檔案之一。** |
| 4 | `src/content/items.ts` | 40 道題。**你要填的另一個檔案。** |

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
      │    提問組 → 第 1 層問題
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

我在 Node v22.22.2 上執行的實際輸出：

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
| 2 | highlight 粒度：4 字以內＝字詞、跨句＝整段 | `src/lib/highlight.ts` | `unit.test.ts > highlight granularity` |
| 3 | 下限＝四句目標句各完成一次 | `src/lib/highlight.ts: lowerBoundMet`、`src/app/api/advance/route.ts` | `unit.test.ts`、`engine.test.ts > 需要四句` |
| 4 | 提問組：解釋只在「嘗試過且給過理由」之後出現 | `src/lib/ladder.ts`（伺服器端狀態機，模型無權決定） | `unit.test.ts > socratic ladder`、`smoke-run.ts` 逐一互動檢查 |
| 5 | 理由把關看「有沒有理由」，不看對錯 | `src/lib/reasonGate.ts` | `unit.test.ts > reason gate rules` |
| 6 | 最多退回 2 次，第 3 次強制接受並標記 | `src/lib/reasonGate.ts: shouldForceAccept`、`ladder.ts` | `unit.test.ts > rejects at most twice` |
| 7 | 目標句的解釋兩臂逐字相同 | `src/lib/engine.ts: explanationFor`（目標句一律用 content 裡的文字） | `engine.test.ts > gives the direct arm the SAME explanation` |
| 8 | 提問組不得洩答（含「加了問號的答案」） | `src/lib/leak.ts` + `engine.ts` 的重生成與降級 | `unit.test.ts > leak detection`、`engine.test.ts > never lets a leaking output reach the reader` |
| 9 | 直答組不得一次給整篇譯文 | `src/lib/leak.ts: checkDirectOutput` | `unit.test.ts > flags a whole-passage translation` |
| 10 | 對照組 highlight 只記錄、不回應，但一樣計入下限 | `src/lib/engine.ts: startAssist` | `engine.test.ts > records the control arm mark` |
| 11 | 兩臂共用同一模型與參數 | `src/lib/config.ts: CONFIG.llm`（唯一來源） | 讀一次 `config.ts` 即可確認；`prompts.ts` 只改 system prompt |
| 12 | 分派在伺服器端、依前測分層、三臂平衡 | `src/lib/randomize.ts`、`src/app/api/quiz/route.ts` | `unit.test.ts > randomisation`；smoke 產出 3/3/3 |
| 13 | 計分只在伺服器端，前端拿不到答案 | `src/lib/view.ts: publicItem`（唯一輸出給前端的形狀） | 搜尋 `answerIndex` 只會出現在 server 檔案 |
| 14 | 遷移篇沒有註解、沒有查檢題 | `src/content/passages.ts`（T1 annotations 為空）、`validate-content.ts` | `npm run validate:content` |
| 15 | 逾時不刪人，只標記（ITT） | `src/app/api/advance/route.ts` | 讀該檔；`excludeFlags` 只加標記，不刪資料 |
| 16 | 分頁切換超過 3 次標記 | `src/app/api/event/route.ts` | 同上 |
| 17 | 延遲測驗只能用專屬連結，且不寄信 | `src/app/api/state/route.ts`（主 token 在 S6 只給連結） | 讀該檔 |

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
| 固定的通用提問句幹（策略 A–D），逐字重複 | Rosenshine, Meister & Chapman (1996), *RER* 66(2), 181–221：通用句幹 ES = 1.12 |
| 提問處理「澄清」而非論辯 | Palincsar & Brown (1984), *Cognition and Instruction* 1(2), 117–175 |
| 階梯最後一定給答案 | Aleven, Roll, McLaren & Koedinger (2016), *IJAIED* 26(1), 205–223（bottom-out hint；並建議加上自我解釋） |
| 先嘗試再給答案 | Kornell, Hays & Bjork (2009), *JEP:LMC*；Sinha & Kapur (2021), *RER* 91(5)：g = 0.36 |
| 必須寫理由才看到解釋 | Bisra, Liu, Nesbit, Salimi & Winne (2018), *Educational Psychology Review*：g = .55 |
| 直答臂是有護欄的解說者 | Bastani et al. (2025), *PNAS*：無護欄 GPT 使後測低 17%，有護欄則無顯著差異 |
| 不教語法術語 | 劉潔玲、谷屹欣（2017）：「僅僅知道一些專有名詞並未能幫助他們理解文言文的字義」 |

連結：
- https://www.formapex.com/telechargementpublic/rosenshine1996a.pdf
- https://images.scholastic.co.uk/assets/a/d6/6f/palincsar-reciprocal-teaching-1619152.pdf
- https://www.cs.cmu.edu/~aleven/Papers/2016/Aleven_etal_IJAIED2016-Helpseeking.pdf
- https://web.williams.edu/Psychology/Faculty/Kornell/Publications/Kornell.Hays.Bjork.2009.pdf
- https://journals.sagepub.com/doi/10.3102/00346543211019105
- https://link.springer.com/article/10.1007/s10648-018-9434-x
- https://www.pnas.org/doi/10.1073/pnas.2422633122

---

## 5. 手動瀏覽器檢查清單（我沒跑過，你要跑）

1. `npm run dev`，開 `http://localhost:3000`，填同意書 → 應轉到 `/run?t=...`
2. S1 作答 → 交卷後看 `data/db.json`：該participant 應該有 `arm`、`stratum`、`pretestScore`
3. S2：
   - 用滑鼠選一個字 → 提問組應出現問題、直答組應出現解釋、對照組沒有回應
   - 提問組連答兩次「不知道」→ 第三步應出現選擇題與理由欄
   - 理由寫「猜的」→ 應被退回，訊息為「請說說你為什麼選這個…」
   - 理由寫「因為前面是擊」→ 應出現解釋與「看完了」
   - 四句目標句都做完前，「進入下一階段」應該是停用的
4. 切換分頁 4 次 → `data/db.json` 中該人應出現 `tab_switching` 標記
5. 嘗試複製文章文字 → 應該複製不到
6. 走到最後 → 應顯示延遲測驗連結與最早可作答日期
7. `http://localhost:3000/api/admin/summary?key=<ADMIN_PASSWORD>` → 應回傳進入正式實驗的判準數字

---

## 6. 資料與匯出

五張表：`participants`、`responses`、`interactions`、`events`、`scales`。

```
GET /api/admin/export?key=<ADMIN_PASSWORD>&table=responses     # CSV
GET /api/admin/summary?key=<ADMIN_PASSWORD>                    # 判準儀表板 + S5 題目分析
```

`interactions` 保留每一則模型原始回傳（`rawResponse`）與洩答旗標（`leakFlags`），操縱檢核直接從這張表算。
`events` 的 `read_done_click` 內含每句的結束位置（第 1 層答對／第 2 層答對／選對／選錯）、退回次數、是否「理由不足」、花費毫秒。

---

## 7. 已知限制

- 檔案式儲存一次只適合單一伺服器行程；45 人的 pilot 夠用，正式實驗建議換掉。
- 非目標句的臨場選擇題目前用固定的通用選項（`engine.ts: choiceFor`），不是模型生成。理由：生成題的品質無法在執行時檢查。若要改成生成，必須先做人工檢查流程。
- 前端計時器以客戶端時間為準；伺服器端只記錄 `elapsedSeconds`。若要防作弊需改成伺服器端計時。
- 手機版沒有特別處理，建議只開放桌機作答。
