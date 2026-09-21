# Task brief — wenyan-pilot

Paste this whole file into Claude Code, or say: `讀 docs/claude-code-task.md 並依序執行`.

**Before starting:** read `CLAUDE.md` (invariants and decisions), then `README.md` §3
(the rule → code → test map). Reply to me in Traditional Chinese. Run `npm test` and
`npm run typecheck` after each task and tell me the numbers — do not report a task done
without having run them.

Baseline right now: **59 tests pass** (engine 15, llm 6, unit 38), `npm run typecheck` has
never been run with real `node_modules`, so expect it may surface something.

---

## Already done — do not redo

- The four target sentences are **no longer shaded** for any arm (`CONFIG.targetHintArms`
  is empty). Nothing on the passage is visually marked any more.
- There is **no usage requirement** in any arm (`CONFIG.lowerBoundArms` is empty). The only
  gate to leave S2 is `CONFIG.minReadingSeconds` (180s), the same for all three arms.
- The pre-written ladders still fire: `matchTarget` keys off the selected **text**, so a
  reader who happens to select 「以鐵如意擊之」 still gets TS1's hand-written rungs.

---

## Task 1 — snap a highlight to the whole sentence

### The problem

`classifyGranularity` in `src/lib/highlight.ts` currently treats anything up to
`CONFIG.wordMaxChars` (4 characters) as word-level. That is wrong for this study in two
ways:

1. A reader who drags across 「以鐵如意擊」 (5 chars, a fragment) gets a "sentence" label
   but the **fragment itself** is what gets stored, sent to the model, and shown in the
   transcript. The AI is then asked about half a clause.
2. A 2–4 character drag like 「綾羅絝」 is labelled word-level, but the reader almost
   certainly meant "this bit of this sentence", not "this exact string".

### The rule I want

- Exactly **one** Chinese character selected (after stripping punctuation and whitespace)
  → word-level. Keep the selection as-is.
- **Two or more** characters → treat it as the whole sentence. Not just the label: the
  stored `selection` must be **expanded to the full sentence** the drag sits in.
- A drag that crosses a sentence boundary → `passage`, expanded to the full span of every
  sentence it touches.

I know this loses the ability to ask about a multi-character word like 「綾羅」 on its own.
That is the trade I want: an over-snapped selection is a coherent question, a fragment is
not.

### Where

- `src/lib/highlight.ts` — `classifyGranularity`, plus a new exported function, something
  like `normaliseSelection(passageText, selection)` returning `{ text, granularity }`.
- `src/lib/engine.ts` — `startAssist` currently does `classifyGranularity(selection)` then
  stores the raw selection. It must store the **normalised** text instead, because that is
  what goes into `active.selection`, the interaction log, the prompt, and the transcript.
- `CONFIG.wordMaxChars` becomes meaningless. Delete it and every reference, or leave it
  with a comment saying it is unused — your call, but do not leave a stale number that
  looks live.

### Sentence boundaries

`SENTENCE_ENDINGS` already exists in `highlight.ts`: `。！？；」：`. Watch the quote
marks — the passage contains 「以人乳飲㹠。」 where `」` follows `。`. Expanding must not
leave a dangling `」` or swallow the next sentence. Write the tests for that case first.

### Acceptance

Add tests to `tests/unit.test.ts`:

- `normaliseSelection(T2_TEXT, '之')` → word, text unchanged
- `normaliseSelection(T2_TEXT, '以鐵如意擊')` → sentence, text `'崇視訖，以鐵如意擊之，應手而碎。'`
  (or whatever your boundary rule produces — decide it, then assert it)
- a drag spanning two sentences → passage, text covering both in full
- the 「以人乳飲㹠。」 quote case does not produce a dangling bracket

And one in `tests/engine.test.ts`: after `startAssist(p, '以鐵如意擊')`, the participant's
`active.selection` is the expanded sentence, and `active.targetId` is `'TS1'`.

### Do not break

- `startAssist` rejects any selection that is not a substring of the passage. The expanded
  text must still satisfy that — expansion only ever grows within the passage.
- `matchTarget` must still return the right target. Expansion should make it *more*
  reliable, not less.

---

## Task 2 — resolve a selection by position, not by text

### The problem

`matchTarget(passage, selection)` matches by substring. Select a single 「之」 and it
returns whichever target sentence happens to contain a 「之」 first — TS1 — even if you
clicked the 「之」 in 「愷之甥也」. The same ambiguity hits Task 1's sentence expansion:
「愷」 appears many times, so "which sentence is this in?" has no answer from the text alone.

### The fix

Send the character **offset** from the client and resolve from that.

This just became easy: with the shading gone, `PassageText` renders the passage as a single
segment, so it is one text node and `window.getSelection()` gives offsets directly against
the passage string. Check `src/app/run/page.tsx` — if `segments` still produces one entry
per target, simplify it to one span now that `passage.targets` is always empty.

- Client sends `{ action: 'highlight', selection, start }` where `start` is the index into
  the passage text.
- Server validates `passageText.slice(start, start + selection.length) === selection` and
  **falls back to the current substring search if it does not match** — the offset is an
  optimisation, not a trust boundary. A hostile or buggy client must not be able to make
  the server believe a selection came from somewhere it did not.
- `normaliseSelection` and `matchTarget` take the offset when it is available.

### Acceptance

- Selecting the 「之」 in 「愷之甥也」 resolves to TS2, not TS1.
- Omitting `start` entirely still works (old behaviour, substring search).
- A `start` that does not match the text is ignored, not trusted.

---

## Task 3 — make the S2 sidebar read like a chat panel

### What exists

`src/app/run/page.tsx` has `ChatPanel`: a sticky right-hand `<aside>` (360px, class
`.s2-aside` in `src/app/globals.css`) with a header, a scrolling transcript, and a footer
that holds whatever widget the current rung needs. The transcript comes from
`/api/transcript` so it survives a reload.

### What I want instead

The form of Claude in Chrome's side panel:

- **Full height.** The panel should fill the viewport height beside the passage, not stop
  at its content. Its transcript scrolls inside it; the page itself does not scroll to
  reach the composer.
- **Messages read as a conversation.** Reader turns and AI turns visually distinct and
  clearly attributed — alignment, or a small role label, or both. Right now they are two
  background colours and it is not obvious which is which.
- **The composer is always there**, pinned at the bottom. When there is no open
  interaction it stays visible in a disabled state with a hint like
  「在左邊選一段文字開始」, instead of vanishing. Its disappearing is the thing that makes
  the panel feel unlike a chat.
- **A pending state.** While the server is answering, show the AI side as thinking rather
  than leaving the panel frozen.
- **Auto-scroll to the newest message**, which `ChatPanel` already does — keep it.
- **Keep the divider** that names which selection each stretch of conversation is about
  (`標記了：「⋯⋯」`). That is what makes this readable as a session rather than one long
  thread.

### The line not to cross

The reader can still only respond to **the rung they are on** — a free-text box, a set of
options, or 看完了. Do **not** turn this into free-form chat where they can type anything
at any time. That would put the model outside the ladder and destroy the manipulation
(CLAUDE.md invariant 1). The composer looks like a chat input; what it accepts is still
governed by the server's state machine.

If you think free-form chat is what I actually want, stop and ask me before building it.

### Constraints

- Below 1100px the panel folds under the passage (`@media` block in `globals.css`). Keep
  that working.
- The passage column stays 680px wide in every arm (`.s2-main`). Control has no sidebar and
  its line length must not change — that is a deliberate anti-confound.
- Control gets no panel at all (`view.assist.sidebar === false`).
- `/api/transcript` deliberately does not send `inTargetSentence`, `strategy`,
  `rawResponse` or `leakFlags`. Do not add them to make the UI nicer.

---

## Definition of done

1. `npm test` — all green, with new tests for Tasks 1 and 2.
2. `npm run typecheck` — clean.
3. `npm run validate:content` — still exits 1 with only "awaiting reviewer sign-off" and
   `verified: false` errors. If new errors appear, you broke something.
4. `npm run dev`, then walk S2 once per arm in three incognito windows and tell me what
   each arm looked like.
5. Tell me anything in `CLAUDE.md` or `README.md` §3 that these changes made untrue, and
   update it.
