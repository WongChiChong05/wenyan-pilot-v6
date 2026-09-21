# Task brief 2 — wenyan-pilot

**This supersedes `docs/claude-code-task.md`.** Read that file too, but obey this one where
they conflict — my instructions changed after I ran the app again.

Paste this into Claude Code, or say: `讀 docs/claude-code-task-2.md 並依序執行`.

Before starting: read `CLAUDE.md` (invariants, decisions) and `README.md` §3 (rule → code →
test map). Reply to me in Traditional Chinese. Run `npm test` and `npm run typecheck` after
each task and report the numbers — do not call a task done without having run them.

Baseline: **59 tests pass** (engine 15, llm 6, unit 38).

---

## First: undo Task 1 of the old brief if you already did it

The old brief asked you to expand a highlight to the whole sentence it sits in
("snap to sentence"). **I changed my mind — I do not want that.** If you already
implemented `normaliseSelection` or anything that rewrites the reader's selection before
storing it, revert that part. The selection must be stored **exactly as the reader made
it**, any length.

Keep these from the old brief if you did them:

- the offset/position work (old Task 2) — still wanted, see Task B below for why it matters now
- the chat panel (old Task 3) — unchanged, still wanted

---

## Task A — every question the AI asks must be multiple choice

### Where it stands

Target sentences are already fully MCQ: three rungs, each a pre-written choice plus a
required reason (`layer1Choice`, `layer2Choice`, `choice` in `src/content/passages.ts`).

**Free highlights are not.** Any selection that is not one of the four target sentences
still gets an open text box at layers 1 and 2, because the question is model-generated and
I did not want unvalidated generated options. Look at `Engine.socraticStep` in
`src/lib/engine.ts`: it returns `kind: 'choice'` only when the target has a pre-written
spec, otherwise it falls through to `socraticQuestion` and an open box.

### What I want

**Layers 1 and 2 of a free highlight become model-generated multiple choice**, with the
same required reason. No open text boxes anywhere in the questioning arm.

The model returns options as well as the question:

```json
{"type":"question","strategy":"A|B|C|D","text":"<question>",
 "options":["...","...","..."],"answerIndex":0}
```

### This changes what the intervention *is* — handle it, don't ignore it

Until now every question the questioning arm could see was either hand-written and checked,
or an open prompt that could not contain an answer because it had no options. Generated
options can contain an answer. So generation has to be validated at run time and audited
afterwards. Build all four of these:

1. **Leak-check the options, not just the question.** `checkSocraticOutput` in
   `src/lib/leak.ts` runs on the question text today. Run it over **every option** too,
   at layers 1 and 2 only. An option like 「代詞，指珊瑚樹」 on rung 1 is a leak.
   Layer 3 is the bottom-out — its options *are* the answer, and that is by design, so do
   not leak-check those.
2. **Structural validation.** Reject a response with fewer than 3 options, an empty or
   duplicate option, or `answerIndex` outside the range. Treat a rejected response exactly
   like a leaking one: regenerate once, then fall back.
3. **A usable fallback.** When generation fails or keeps leaking, fall back to a fixed
   generic observation MCQ, and set `degraded: true` so it is visible in the data. The
   fallback cannot know which option is right — in that one case, accept any pick with an
   accepted reason and advance a rung, never end the ladder early.
4. **Full post-hoc audit.** Store the generated options in the interaction row so every
   generated item can be read afterwards — `rawResponse` already holds the raw reply; make
   sure the options survive into the export. With N = 45 I can read 100% of generated
   items. That audit is what replaces the pre-validation I am giving up, and it goes in
   the paper: how many items were generated, how many leaked, how many fell back.

### How the generated options must be written — this is the part I got wrong

I ran it and the generated item was bad. For the selection 「擎」 the options came back as:

```
○ 前接「手」（名詞），後接「飲食」（名詞）
○ 前接「以」（介詞），後接「手」（名詞）
○ 前接「皆」（副詞），後接「綾羅」（名詞）
```

The options **quote the neighbouring characters**. The reader does not have to think about
anything — they look at the passage, find 「擎」, read the characters either side, and match.
It is a find-the-string exercise. Worse, each option writes the part of speech in brackets
next to the character, so it answers its own question.

**Rule: an option may name the grammatical category, never the text.**

```
○ 前面是一個東西，後面也是一個東西
○ 前面是一個動作，後面是一個東西
○ 前面是形容的詞，後面是一個動作
```

Now the reader has to locate the word AND decide what the neighbours are. That is the
observation the rung is supposed to test.

Two more rules that fall out of the same problem:

- **One question per rung.** The example asked 「在句中是什麼位置？它前後分別是什麼詞？」 —
  two questions, and the options answer both. Ask one.
- **Match the house style of the four hand-written items.** They read like
  「一個動作（敲、打）」 / 「都是人或身分（名詞）」 — a functional description first, the
  technical term in brackets if at all. Generated items should be indistinguishable in
  register from those. Put the twelve hand-written options in front of the model as the
  style reference (not as few-shot content — that comes later and from a different passage).

This also keeps the existing ban intact: system prompt rule 5 forbids teaching analysis
terminology (賓語前置、定語後置、通假字…). Basic word-class words (名詞/動詞) are used by the
hand-written items and stay allowed.

### A defect this also fixes — check it and say so when you are done

`choiceForSelection` in `src/lib/engine.ts` hands every free highlight the SAME generic
bottom-out MCQ, with `answerIndex: 0` hardcoded. That index is arbitrary: option 0
(「表示一個動作的對象」) is scored correct no matter what the reader selected or what the
passage says. So `ladder.choiceCorrect`, and therefore `endPosition` (`choice_correct` vs
`choice_wrong`), is **meaningless for every free highlight** in the data as it stands.

Generated options with a real key fix this. When you finish Task A, confirm in writing that
`endPosition` now means the same thing for both kinds of highlight, and tell me whether any
data already collected under the old behaviour has to be discarded.

### Decision I have already made — do not re-open

The model's own `answerIndex` is **trusted at run time** (logged, audited later), so a free
highlight can end early at rung 1 exactly like a target sentence does. The alternative —
never ending early on generated items — would make the two kinds of highlight behave
differently and would make `endPosition` mean two things at once. The reason gate still
stops a lucky guess from skipping the ladder, which is the risk that actually matters.

Report generated and pre-written items separately in any `endPosition` analysis.
`interactions.inTargetSentence` is null for exactly the generated ones.

### Acceptance

- Socratic arm, free highlight (e.g. 「帝甚不平」): rung 1 comes back as `kind: 'choice'`
  with options, not `kind: 'question'`.
- A mocked model returning an option that states a meaning → regenerated, then the fallback,
  with `degraded: true` and an `llm_failure`-style event.
- A mocked model returning 2 options, or a duplicate, or `answerIndex: 9` → same path.
- Target sentences still use their pre-written specs, untouched.
- The direct arm is unaffected — it explains, it never asks.

### Do not break

- CLAUDE.md invariant 1: the ladder state machine, not the model, decides when the
  explanation appears. Generated options change what is *asked*, never *when* the answer
  is shown.
- Invariant 3: both AI arms still receive the identical explanation for a target sentence.

---

## Task B — highlight granularity: leave it completely free

### What I want

The reader selects whatever they want — one character, three characters, half a clause,
two sentences. **Store it verbatim. Never rewrite it.**

`classifyGranularity` stays, but only as a **recorded label** (`word` / `sentence` /
`passage`) for the analysis. Nothing branches on it to change the reader's selection.

### The real fix: the AI must bring in the surrounding text when it is needed

My reason for not wanting snapping: if the text before or after the selection is what makes
the selection explicable, **the questioning AI should say so and point at it** — that is
itself good questioning, and it is more informative than silently widening the selection
behind the reader's back.

So instead of normalising the selection, give the model what it needs and tell it what to do:

1. **Send position and neighbourhood.** `socraticTurnPrompt` in `src/lib/prompts.ts`
   currently gets the whole passage plus the raw selection, and nothing about where the
   selection sits. Add: the character offset, the full sentence containing the selection,
   and the sentence before and after — each clearly labelled. Without the offset the model
   cannot tell which 「之」 the reader clicked (this is why the old brief's offset work is
   still wanted).
2. **Add a rule to `socraticSystemPrompt`:** when the selection cannot be understood on its
   own, the question must **quote the neighbouring text it depends on** and ask about the
   relation — not ask about the selection in isolation, and not silently answer it. Example
   shape: 「你選的『之』，要看它前面的『擊』才判斷得出來。『擊』是什麼詞？」 This is still
   a question, still states no meaning, and it teaches the move I want the reader to learn.
3. **Refer to the selection accurately.** Never 「這個字」 for a multi-character selection.
   Quote the selection back instead. I hit this bug twice already.

### Reconsider what I added earlier

There is a `LOCALISE_QUESTION` in `prompts.ts` and a granularity branch in
`socraticTurnPrompt` that tells the model "the reader selected a whole sentence, ask them
to point at the character that blocks them first". With granularity free and the context
rule above, that move is probably redundant — the model should just ask a good question
about whatever was selected. **Keep it only as the degraded fallback** when the model is
unavailable. Delete the branch from the live prompt path.

### Acceptance

- `startAssist(p, '以鐵如意擊')` stores `active.selection === '以鐵如意擊'`, unchanged.
- `classifyGranularity` still returns the three labels and is still exported in the data.
- The prompt sent to the model contains the offset and the neighbouring sentences — assert
  this in a test against `socraticTurnPrompt`'s output string.
- No generated question contains 「這個字」 when the selection is longer than one character.

---

## Task B2 — S3 now shows the passage (already done, verify it)

I changed `src/lib/view.ts` `case 'S3'`: the learning passage is now displayed during the
S3 quiz, matching S5 and S6. Answering about a text you cannot see tests memory, which is
not what this study measures.

**The annotations are deliberately NOT shown there.** S3-01 and S3-02 are check-level items
that ask what the annotation said; putting the annotation list on the same screen turns them
into a lookup and they stop measuring whether the reader used the annotations during S2.

Verify this renders, and check `README.md` §3 does not now contain a stale claim about S3.

---

## Task C — the chat panel (unchanged from the old brief)

Do old Task 3 as written: full-height panel, role-distinguished messages, composer always
visible (disabled with a hint when there is no open interaction), pending state, keep the
`標記了：「⋯⋯」` divider, keep the <1100px fold and the 680px passage column.

**The line not to cross is unchanged:** the reader can only respond to the rung they are
on. Now that every rung is a multiple choice (Task A), the composer is mostly radio buttons
plus a reason box — it should still *look* like a chat panel, but it is not free chat. If
you think I want free-form chat, stop and ask me.

---

## Definition of done

1. `npm test` — green, with new tests for Tasks A and B.
2. `npm run typecheck` — clean.
3. `npm run validate:content` — still exits 1 with only "awaiting reviewer sign-off" and
   `verified: false` errors. New error kinds mean you broke something.
4. `npm run dev` with `LLM_PROVIDER=mock` first, then with a real key, and walk S2 once per
   arm. Tell me what each arm looked like and paste one generated MCQ so I can see its
   quality.
5. Tell me what in `CLAUDE.md` or `README.md` §3 these changes made untrue, and update it.
   In particular: the rule that says free highlights keep an open question is now wrong.
