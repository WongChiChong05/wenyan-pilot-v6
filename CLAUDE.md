# CLAUDE.md — wenyan-pilot

Read this before changing anything. It is the handoff from the sessions that built this repo.

## Backend handoff — 2026-09-21

The backend now uses PostgresStore when DATABASE_URL is set; production refuses
file-store fallback. Canonical schema: db/schema.sql (not supabase/schema.sql).
study.ts contains validated stage services; API writes run in Store transactions.
Content validation is shared by the CLI and collection-mode session creation.
Read docs/程式與提示詞審閱指南.md for prompt execution paths, literature limits and
unresolved research decisions. Read docs/後端部署與驗證.md for actual verification
status. Historical test counts below are not the current test inventory.
Do not silently resolve the second-vs-third rejected-reason discrepancy or the
ungrounded generic free-highlight layer-3 options by changing the study design.

## What this is

A **research instrument**, not a product. It runs a three-arm randomised pilot study on
Classical Chinese (文言文) reading: does an AI that *asks questions* help more than one that
*gives answers*, and than no AI at all?

Undergraduate HCI capstone, NTHU. N = 45 (15 per arm). The user is WCC.

The consequence of that framing: **a change that makes the app nicer but breaks a design
invariant destroys the study.** Those invariants are listed below. Some of them look like
awkward code. They are awkward on purpose.

## How to talk to the user

- **Reply in Traditional Chinese.** Code comments and this file stay in English.
- Direct, no filler, no praise. Say what changed and what it costs. Stop when done.
- Label anything unverified: `[Inference]` / `[Speculation]` / `[Unverified]`. If you did
  not run it, say you did not run it.
- Push back when a request would damage the study — name the cost, propose the version
  that keeps the finding intact, then do what they decide.
- Prefer targeted edits over rewrites.

## Verify before you claim anything works

```bash
npm test                  # 58 tests: engine 15, llm 6, unit 37
npm run typecheck         # tsc --noEmit
npm run validate:content  # exits 1 by design while content is unsigned
npm run smoke             # offline end-to-end, one participant per arm
npm run dev               # http://localhost:3000
```

`npm run validate:content` **failing is currently correct.** It reports ~48 errors, all of
them "written but awaiting reviewer sign-off" plus the four passages' `verified: false`.
The gate is what stops the platform collecting real data with unsigned content. Do not
"fix" it by flipping `draft` flags — that is the supervisor's act, not yours.

`scripts/verify-offline.mjs` exists only because the cloud sandbox that built this had no
`node_modules`. On a real machine `npm test` supersedes it. Keep it working anyway; it is
the only way a sandboxed session can check itself.

## The invariants

Break any of these and the study stops meaning anything. Each has a test; README §3 maps
all 26 design rules to their code location and test.

1. **The model never decides when the explanation appears.** A server-side state machine
   does (`src/lib/ladder.ts`). The model only writes text for the rung the machine is
   already on. This makes "the explanation came too early" impossible by construction
   rather than by prompt discipline. Never move this decision into a prompt.
2. **Both AI arms receive the identical explanation string.** Target sentences use the
   pre-written text in `src/content/passages.ts`, never a regeneration. The questioning arm
   reaching it later is the manipulation; reaching something *different* is a confound.
3. **A correct pick alone never opens the explanation.** The reason must pass the gate too.
   A 3-option choice is right 1 in 3 by luck; without this, a third of readers skip the
   ladder and the manipulation never happened for them.
4. **Layers 1 and 2 ask about observations, never meaning.** `validate:content` fails the
   build if a rung's options duplicate the layer-3 answer options.
5. **The questioning arm must not leak answers.** `src/lib/leak.ts` checks banned phrases,
   grammar terms and answer-carrying yes/no questions. Task A extends the check to every
   *option* of a generated free-highlight MCQ (`checkSocraticOptions`) plus a structural
   check (`validateChoiceStructure`). A leaking or malformed generation is regenerated
   once, then falls back to a fixed observation MCQ with `degraded: true`; the fallback
   rung's `answerIndex` is null so no pick can ever end the ladder early from it.
   Layer 3 is exempt — its options *are* the answer, by design (bottom-out hint).
6. **The client never receives an answer key.** `src/lib/view.ts: publicItem` is the single
   place items are shaped for the client. `grep -rn "answerIndex" src/` must only hit
   `src/lib`, `src/content`, `src/app/api`.
7. **Same model, same parameters, both arms.** `CONFIG.llm` is the only source. Only the
   system prompt differs.
8. **Items in one stage must not answer each other.** `validate:content` blocks a correct
   option repeated verbatim (3+ Chinese characters) in another item of the same stage.
   Semantic leakage still needs a human read — see 教材來源與查核紀錄 §3.4.
9. **Nothing excludes a participant for choosing not to use the assistant.**
   `CONFIG.exclusion.descriptiveOnly` lists flags that describe without excluding.
   Intention-to-treat keeps non-users in.
10. **Timeouts flag, never delete.** ITT again.

## Decisions already made — do not silently revert

| Decision | Why | Where |
|---|---|---|
| No usage lower bound in **any** arm | Voluntary usage is a pilot *finding*, not noise. Forcing a minimum makes "will students actually use a questioning AI?" unanswerable | `CONFIG.lowerBoundArms: []` |
| 180s minimum on S2, all arms | With usage unmatched, time is the only matched quantity | `CONFIG.minReadingSeconds` |
| No arm sees shaded sentences | Even without a quota, shading reads as 「這句才重要」 and steers where the reader looks. The pre-written ladders still fire — `matchTarget` keys off the selected text — so a reader who happens to select 「以鐵如意擊之」 still gets TS1's hand-written rungs | `CONFIG.targetHintArms: []` |
| Highlight granularity is COMPLETELY FREE — the reader's selection is stored verbatim, whatever the length | The old snap-to-sentence behaviour silently widened the selection behind the reader's back. Task 2 replaces it: if the selection cannot stand alone, the questioning AI must **quote the surrounding text** (Task B), which is itself the move we want the reader to learn. `classifyGranularity` remains as a recorded label for analysis; nothing rewrites the selection | `engine.ts: startAssist` stores `selection` verbatim; `prompts.ts: socraticTurnPrompt` receives the offset and `neighborhoodOf(...)` sentences; `highlight.ts` no longer exports `normaliseSelection` |
| Free (non-target) highlights get MODEL-GENERATED MCQ at layers 1/2, not open text (Task A) | The old open-text path made "reader gets stuck on an unfamiliar clause" and "reader can't see what would count as an answer" the two most common failure modes in dev testing. MCQ + required reason (same shape as target sentences) fixes both, at the cost of trusting the model's `answerIndex` at run time. That cost is bounded by (a) option-level leak-check + structural check + regen-once-then-fallback, and (b) 100% post-hoc audit of the stored `generatedOptions` at N=45 | `engine.ts: socraticChoice`; `leak.ts: checkSocraticOptions`/`validateChoiceStructure`; `types.ts: InteractionRow.generatedOptions`/`generatedAnswerIndex`/`degraded` |
| The client sends the selection offset | Resolving 「之」 by substring returns whichever target contains a 「之」 first (TS1). The offset disambiguates by position; the server verifies and falls back to substring if it does not match | `run/page.tsx: PassageText` sends `start`; `assist/route.ts` passes it; `matchTarget` / `normaliseSelection` accept it |
| Passage column fixed at 680px in every arm | Control has no sidebar; without this its line length would differ and become a confound | `globals.css .s2-main` |
| One open interaction at a time; 看完了 frees the passage (v5.12, no separate unlock); a highlight can be cancelled before the first answer | A stray drag mid-conversation used to silently discard a half-climbed ladder, so the passage stays locked while an interaction is open. Cancelling is allowed only before any answer and before any explanation (`isCancellable`), so it cannot preview answers; each cancel is logged as `selection_cancelled` | `api/assist/route.ts` 409; `engine.ts: isCancellable/cancel` |
| Reader-facing titles are 短文（一）…（四） | Internal labels leaked entry numbers, and the chapter name 「汰侈」 is itself the theme | `Passage.displayTitle` |
| Delayed test opens +24h, closes +48h | Enforced server-side at both ends; it used to be unenforced entirely | `CONFIG.delayedTest` |
| Proctoring is deterrence + measurement only | The consent page promises the reader may leave at any time. Never block exit | `CONFIG.proctor` |

## Layout

```
src/lib/          ladder.ts (the manipulation) · engine.ts (orchestration) · leak.ts
                  reasonGate.ts · highlight.ts · randomize.ts · scoring.ts
                  config.ts (every number lives here) · prompts.ts · view.ts · llm.ts
src/content/      passages.ts (4 passages, 4 target sentences) · items.ts (40 items)
src/app/api/      session state quiz assist advance event scale transcript admin/{export,summary}
src/app/run/      the whole participant UI
scripts/          validate-content.ts · smoke-run.ts · verify-offline.mjs
docs/             socratic-ladder.html / .md — the ladder figure for the viva
```

Read `README.md` §0.8 for the guided code tour, §3 for the rule-to-test map.

## Content status

All 40 items and all 4 target sentences are **written but `draft: true`** — meaning nobody
has signed them off, not that they are empty. Flipping a `draft` to `false` is the
supervisor's decision.

Still owed by a human, and not something you can do:

- Collate the three 世說新語 passages against 三民《新譯世說新語》 and 余嘉錫《世說新語箋疏》
- Eye-check the S6 passage against the official PDF (known suspect: 「左仆射」 vs 「左僕射」)
- Cross-check the decode items against 《古代漢語虛詞詞典》 or 《王力古漢語字典》

Every gloss carries a `source` field. Never add one without it.

## Running it

Copy `.env.example` to `.env.local`. With no API key the app falls back to a mock provider
that **says so in its output** (`（示範模式：未接上模型）`) — that string is deliberate, so a
session accidentally run without a key is obvious in the data. For real runs set
`LLM_PROVIDER=gemini` and `GEMINI_API_KEY`. Do not use `gemini-2.0-flash`; it is retired.

Fullscreen proctoring needs HTTPS in production. `localhost` is exempt.

## Where the design lives

The full design rationale is in the user's claude.ai Project "Motivational Agent", not in
this repo. The ones that matter most for code changes:

- 實驗設計-Pilot版-十五項決定 — the authoritative design
- S2介面與對照組設計變更-v5.4 — why the control arm has no constraints
- 教材來源與查核紀錄 — every gloss's source, and the item-leakage audit
- 無評分者情況下的驗證替代方案 — what replaces human raters

If a change contradicts one of those, say so before making it.
