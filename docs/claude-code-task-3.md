# Task brief 3 — backend: move storage to Postgres and make it safe to deploy

Paste into Claude Code, or say: `讀 docs/claude-code-task-3.md 並依序執行`.

Before starting: read `CLAUDE.md` (invariants) and `src/lib/store.ts`. Reply to me in
Traditional Chinese. Run `npm test` and `npm run typecheck` after each task and report the
numbers. Do not call a task done without having run them.

This brief is independent of `docs/claude-code-task-2.md`. If you have not done that one,
do not start it now — finish this first, and do not touch `ladder.ts`, `engine.ts`,
`prompts.ts` or `leak.ts` here.

---

## Why

Storage today is `JsonStore`: one file, `data/db.json`, rewritten whole on every write,
serialised by an in-process promise queue. That is correct only while **exactly one Node
process** serves every request. It breaks in the deployment I am going to use:

- **Vercel** (serverless): the function filesystem is not persistent and not shared between
  instances. `db.json` would be lost or split across instances. Data loss, silently.
- Any host running more than one instance: two queues, two views of the file, lost updates.

The data is the study. Losing one participant's S2 interaction rows is not recoverable.

## Decision already made — do not re-open

- **Postgres**, hosted (Neon, or Supabase if Neon is unavailable), reached through
  `DATABASE_URL`. Plain SQL through the `pg` driver. **No ORM** — I want the schema in one
  readable `.sql` file I can put in the paper's appendix.
- **Keep the `Store` interface exactly as it is.** Add `PostgresStore implements Store`.
  Every API route keeps calling `getStore()` and does not change.
- `JsonStore` stays, for tests and local dev with no database.
- Selection: `DATABASE_URL` set → `PostgresStore`; unset → `JsonStore`.
  **In production (`NODE_ENV=production`) with no `DATABASE_URL`, throw at startup** with a
  message that says what to set. A production run writing to a file that disappears is the
  exact failure this brief exists to stop.

---

## Task 1 — schema

Create `db/schema.sql`. Tables mirror the five arrays in `JsonStore`'s `Db`:
`participants`, `responses`, `interactions`, `events`, `scales`.

- Columns follow the TypeScript types in `src/lib/types.ts` field for field.
  Nested objects that are never queried by field (`demographics`, `stageEnteredTs`,
  `active`, `completedTargets`, `excludeFlags`, `leakFlags`) → `jsonb`. Everything the
  analysis filters or joins on (`arm`, `stage`, `stratum`, `participant_id`, `item_id`,
  `interaction_id`, `ts`) → a real column.
- `participants.token` and `participants.delayed_token` are `UNIQUE`.
- Foreign keys from every child table to `participants(id)`. **`ON DELETE RESTRICT`**, never
  cascade — timeouts flag, never delete (CLAUDE.md invariant 10), and a cascade is how a
  stray delete takes a participant's whole record with it.
- `responses`: `UNIQUE (participant_id, stage, item_id)`. A double-clicked submit must not
  create two answers for one item. Decide what a duplicate submit does (reject with 409, or
  keep the first) — keep the first, and log it as an event; tell me which you did.
- `participants.version integer not null default 0` for Task 3.
- Add `config_version text` to every row table, filled from `CONFIG.version`, so each row
  can prove which config produced it. (The export already adds it; the database should
  hold it too.)
- Indexes on `participant_id` for every child table, and on `(stratum, arm)`.

Add `npm run db:migrate` that applies `db/schema.sql` to `DATABASE_URL`, idempotently
(`CREATE TABLE IF NOT EXISTS`, or a `schema_migrations` table — your choice, say which).

## Task 2 — `PostgresStore`

`src/lib/store.postgres.ts`, implementing every method of `Store`.

- Map snake_case columns ↔ camelCase fields in one place, not per query.
- `list*()` methods return rows in insertion order (`ORDER BY ts, id`), same as the arrays
  do today — the export and the summary depend on it.
- Use a connection pool sized for serverless (small `max`, e.g. 5), created once per
  process. Use the pooled connection string the provider gives for serverless.
- Every write is parameterised SQL. No string-built queries.

## Task 3 — the two races `JsonStore` hid

`JsonStore`'s single queue made these safe by accident. Postgres will not.

### 3a. Arm assignment (`src/app/api/quiz/route.ts`, S1 branch)

Today: `listParticipants()` → count per arm in the stratum → `assignArm()` →
`updateParticipant()`. Two participants finishing S1 in the same second in the same stratum
both read the same counts and can land in the same arm. With N = 45 and block balance per
stratum, that is a real imbalance.

Fix: add to `Store` one method, e.g.
`assignArmAtomically(participantId, stratum, pretestScore): Promise<Arm>`, that does the
count and the write in **one transaction under a lock** (`pg_advisory_xact_lock` on a fixed
key, or `SELECT … FOR UPDATE` on the stratum's rows). `JsonStore` implements it inside its
existing `tx`. The route calls it instead of doing the count itself.
Keep `assignArm()` in `randomize.ts` as the pure function that decides; the lock only
wraps it.

Also tell me in writing: the counts currently include participants flagged
`chinese_major` / `read_before`. Is that what the design doc
(實驗設計-Pilot版-十五項決定) wants? Do not change it — report it.

### 3b. Lost updates on `participants`

`updateParticipant(id, patch)` is read-modify-write, and `active` (the whole ladder state)
lives in that row. Two requests for the same participant at once (an `/api/event` beacon and
an `/api/assist` reply, which does happen) can overwrite each other's changes.

Fix with optimistic concurrency: `UPDATE … SET …, version = version + 1 WHERE id = $1 AND
version = $2`; on 0 rows, re-read and re-apply the patch, up to 3 times, then throw. The
`patch` semantics of the current interface stay the same for callers.
Check whether `/api/event` writes to `participants` at all; if it only inserts an event row,
say so — then the realistic collision is narrower, and I want to know that.

## Task 4 — tests

- Write **one** contract test suite, `tests/store.contract.test.ts`, that runs the same
  cases against any `Store`, and run it against `JsonStore` (temp file) and `PostgresStore`.
- For Postgres in tests, use an in-process Postgres (`@electric-sql/pglite`) if it works
  with the query layer you wrote; if it does not, make the Postgres run conditional on a
  `TEST_DATABASE_URL` and skip otherwise — and tell me which you ended up with.
- Cases that must exist: create/get by id and by both tokens; patch semantics; list order;
  duplicate response rejected by the unique constraint; **20 concurrent
  `assignArmAtomically` calls in one stratum end with arm counts differing by at most 1**;
  two concurrent `updateParticipant` calls on one row both take effect.
- Existing 59 tests must still pass unchanged.

## Task 5 — backup and export

- `npm run db:dump` → writes every table to `backups/<ISO timestamp>/*.json` plus the
  output of the existing CSV export. `backups/` goes in `.gitignore` (it holds participant
  data).
- The `/api/admin/export` route must produce **byte-identical CSV** from either store for
  the same data. Add a test that proves it.
- `scripts/import-json.ts`: load an existing `data/db.json` into Postgres, for moving
  dry-run data across. Refuse to run if the target tables are not empty.

## Task 6 — deployment config

- Next.js route segment config on `src/app/api/assist/route.ts`: `export const maxDuration`
  large enough for `CONFIG.llm.timeoutMs × (CONFIG.llm.retries + 1)` plus one regeneration
  after a leak — compute it from CONFIG and state the number. On Vercel Hobby the ceiling is
  300 s.
- `vercel.json` with the function region set to the same region as the database (I will
  create both in Singapore unless the dashboards say otherwise; make the region a single
  constant that is easy to change).
- Update `.env.example`: add `DATABASE_URL` with a comment, and mark `DATA_FILE` as
  dev-only.
- Update `README.md` with a deployment section: create DB → `npm run db:migrate` → set env
  vars in the host → deploy → open `/api/admin/summary` to check. Keep it short.
- Update `CLAUDE.md`: storage layout, the new `Store` method, and that production refuses to
  start without `DATABASE_URL`.

## Do not

- Do not change what any route returns to the client.
- Do not put an answer key anywhere new (invariant 6).
- Do not add a delete method to `Store`.
- Do not commit `.env.local`, any connection string, or `backups/`. The repo is private and
  must stay private; do not add a remote or push unless I ask.

## Definition of done

1. `npm test` green, with the contract suite and the concurrency cases.
2. `npm run typecheck` clean.
3. `npm run smoke` passes with `DATABASE_URL` unset (JsonStore) **and** set (Postgres).
4. `npm run validate:content` still fails only with the known sign-off / `verified: false`
   errors.
5. Tell me: which Postgres test path you used, what `maxDuration` you set and why, what a
   duplicate quiz submit now does, and the answer to the stratum-count question in 3a.
