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
The second-vs-third rejected-reason discrepancy was resolved in v6 (D7: third reason
force-accepted and flagged). Do not silently resolve the ungrounded generic free-highlight
layer-3 options by changing the study design.

## v6 handoff — 2026-09-29 (read this first)

v6 moves the primary outcome from performance to **behaviour**: after training, does a
reader try to translate a sentence before asking for help? The plan is the Claude Doc
「實驗計畫：行為導向版（v6 草案）」; the supervisor delegated the open decisions to WCC.

- Flow: `S0 S1 S1b S2 S4 S5b S5a DONE` (`engine.ts: STAGE_ORDER`). S3 and the S6 delayed
  test are gone from the flow; their stage names stay in the `Stage` union only so v5 rows
  still import.
- S1b / S5a: three sentences each, translated one at a time, with 提示 / 解釋 / 跳過 buttons
  whose text is pre-written and identical for every arm (`src/content/translation.ts`).
  S5b: four sentences with no help, then five decode MC items on another passage.
- Primary outcome `translations.triedFirst`: at least `CONFIG.translation.triedFirstMinHan`
  Han characters in the box when the reader first pressed help or skip (or at submit).
  The server keeps the clocks and the first-help snapshot (`study.ts: translate`).
- S2 is three 汰侈 passages (`TRAINING_PASSAGES`), each timed on its own (min 180 s, max
  480 s). The AI arms must finish each passage's two `required` targets; every arm sees
  those two shaded. Every interaction row carries `passageId`.
- Open-answer reasons are force-accepted after two rejections on a rung and logged as
  `reason_forced` (D7 decided).
- Standard translation = 三民本語譯, quoted in explanations and references. The repo must
  stay private.
- Scoring of translations is offline: `scripts/blind-sheet.ts`, `scripts/grade.ts`
  (LLM, three 0/1 points per sentence), `scripts/agreement.ts` (Cohen's kappa).
- DB: `db/migrations/004_v6_behaviour_design.sql` (never edit `db/schema.sql`; it is
  migration 1 and is checksummed).

## What this is

A **research instrument**, not a product. It runs a three-arm randomised pilot study on
Classical Chinese (文言文) reading: does an AI that *asks questions* help more than one that
*gives answers*, and than no AI at all? From v6 the question is about what readers DO
afterwards when help is one click away.

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
npm test                  # vitest (v6.1: 149 tests)
npm run typecheck         # tsc --noEmit
npm run validate:content  # exits 1 by design while content is unsigned
npm run smoke             # offline end-to-end through the study services, S1 -> DONE
npm run dev               # http://localhost:3000
```

`npm run validate:content` **failing is currently correct.** In v6.0 it reports 39
errors, all "awaiting reviewer sign-off" (13 MC items, 10 translation sentences, 8 target
sentences) plus the 8 passages' `verified: false`. The gate stops the platform collecting
real data with unsigned content. Do not "fix" it by flipping `draft` flags: WCC removes
them after the 中文碩士 reviewer signs off (the supervisor delegated this to WCC).

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
10. **Timeouts flag, never delete.** ITT again. A translation timeout keeps what was typed
    and records unseen sentences as `timedOut`.
11. **(v6) The translation-stage help is identical for every arm and never generated.**
    S1b/S5a are where behaviour is measured; any arm-specific or model-written text there
    would turn the measurement into a second manipulation.
12. **(v6) The reference translation and rubric never leave the server.** `view.ts` sends a
    hint or explanation only after the reader asked for it; `tests/v6.test.ts` checks that
    no reference or rubric string appears in any stage view.
13. **(v6) The post-test passages (儉嗇 J1/J7/J9) never appear in training.** Validation
    fails if one does.
14. **(v6) S5b comes before S5a.** The performance score must be taken before the reader has
    seen any hint or explanation; S1 -> S1b mirrors the same no-help -> help order.

## Decisions already made — do not silently revert

| Decision | Why | Where |
|---|---|---|
| (v6, reverses v5.5) The two AI arms must finish each passage's two required targets | Behaviour change needs every AI-arm reader to go through the manipulation; voluntary use left some readers untreated. Voluntary use is now measured only on free highlights | `CONFIG.lowerBoundArms: ['socratic','direct']`; `TargetSentence.required` |
| 180s minimum on EACH training passage, all arms (max 480 s) | Time stays matched across arms | `CONFIG.minReadingSeconds`, `CONFIG.stageSeconds.S2` |
| (v6, reverses v5.4) Every arm sees the required targets shaded; control only reads them | Once required they must be visible, and control sees the same shading. Control does not write translations there: forced try-first practice would itself raise its S5a score | `CONFIG.targetHintArms` (all three) |
| (v6) Reasons force-accepted after two rejections on a rung | Required targets would otherwise trap a reader the gate keeps rejecting (D7). Flagged `reasonInsufficient`, logged `reason_forced` | `engine.ts: replyOpen`; `CONFIG.maxReasonRejections` |
| (v6) Delayed test removed | Attrition at N=45; stated as a limitation (cannot separate lasting change from carry-over) | `STAGE_ORDER` |
| (v6) Standard translation = 三民本語譯, stored in the repo | WCC's decision; keep the repo private, cite pages, never reprint in the thesis | `content/passages.ts`, `content/translation.ts` |
| Highlight granularity is COMPLETELY FREE — the reader's selection is stored verbatim, whatever the length | The old snap-to-sentence behaviour silently widened the selection behind the reader's back. Task 2 replaces it: if the selection cannot stand alone, the questioning AI must **quote the surrounding text** (Task B), which is itself the move we want the reader to learn. `classifyGranularity` remains as a recorded label for analysis; nothing rewrites the selection | `engine.ts: startAssist` stores `selection` verbatim; `prompts.ts: socraticTurnPrompt` receives the offset and `neighborhoodOf(...)` sentences; `highlight.ts` no longer exports `normaliseSelection` |
| Free (non-target) highlights get MODEL-GENERATED MCQ at layers 1/2, not open text (Task A) | The old open-text path made "reader gets stuck on an unfamiliar clause" and "reader can't see what would count as an answer" the two most common failure modes in dev testing. MCQ + required reason (same shape as target sentences) fixes both, at the cost of trusting the model's `answerIndex` at run time. That cost is bounded by (a) option-level leak-check + structural check + regen-once-then-fallback, and (b) 100% post-hoc audit of the stored `generatedOptions` at N=45 | `engine.ts: socraticChoice`; `leak.ts: checkSocraticOptions`/`validateChoiceStructure`; `types.ts: InteractionRow.generatedOptions`/`generatedAnswerIndex`/`degraded` |
| The client sends the selection offset | Resolving 「之」 by substring returns whichever target contains a 「之」 first (TS1). The offset disambiguates by position; the server verifies and falls back to substring if it does not match | `run/page.tsx: PassageText` sends `start`; `assist/route.ts` passes it; `matchTarget` / `normaliseSelection` accept it |
| Passage column fixed at 680px in every arm | Control has no sidebar; without this its line length would differ and become a confound | `globals.css .s2-main` |
| One open interaction at a time; 看完了 frees the passage (v5.12, no separate unlock); a highlight can be cancelled before the first answer | A stray drag mid-conversation used to silently discard a half-climbed ladder, so the passage stays locked while an interaction is open. Cancelling is allowed only before any answer and before any explanation (`isCancellable`), so it cannot preview answers; each cancel is logged as `selection_cancelled` | `api/assist/route.ts` 409; `engine.ts: isCancellable/cancel` |
| Reader-facing titles are 短文（一）…（八） | Internal labels leaked entry numbers, and the chapter name 「汰侈」 is itself the theme | `Passage.displayTitle` |
| Proctoring is deterrence + measurement only | The consent page promises the reader may leave at any time. Never block exit | `CONFIG.proctor` |

## Layout

```
src/lib/          ladder.ts (the manipulation) · engine.ts (orchestration) · leak.ts
                  reasonGate.ts · highlight.ts · randomize.ts · scoring.ts
                  config.ts (every number lives here) · prompts.ts · view.ts · llm.ts
src/content/      passages.ts (8 passages; 3 training passages with 8 targets, 6 required)
                  items.ts (S1 8 + S5b 5 MC) · translation.ts (10 sentences, S1b/S5a/S5b)
src/lib/          grading.ts (v6 offline scoring prompt, parser, kappa)
src/app/api/      session state quiz assist advance translate event scale transcript admin/{export,summary}
src/app/run/      the whole participant UI
scripts/          validate-content.ts · smoke-run.ts · verify-offline.mjs
                  blind-sheet.ts · grade.ts · agreement.ts (v6 translation scoring)
docs/             socratic-ladder.html / .md — the ladder figure for the viva
```

Read `README.md` §0.8 for the guided code tour, §3 for the rule-to-test map.

## Content status

Every item, target sentence and translation sentence is **written but `draft: true`** —
nobody has signed them off, not that they are empty.

Still owed by a human, and not something you can do:

- Collate 汰侈 6 (T6) against 張撝之; record both editions' publication details
  (張撝之 publisher, 三民 year) from their copyright pages
- Review hints, explanations and the three scoring points of every translation sentence
- Check that the S1b (汰侈 11) and S5a (儉嗇 7) sentences are of similar difficulty (pilot)
- Freeze `CONFIG.translation` thresholds after the pilot run, before real collection

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
