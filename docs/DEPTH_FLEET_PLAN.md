# Depth Fleet — behavioral-test sweep (carry-over plan)

**Purpose.** Raise the *honest* macro-depth floor (`node scripts/grade-macro-depth.mjs
--honest`) by putting a real behavioral test under every macro that works — proving
correctness and locking it against regression before real users arrive. This file is the
**persistent carry-over** so any future session can resume the sweep without re-deriving
the machinery.

## Status (live)

| Checkpoint | Honest floor |
|---|---:|
| Campaign start | 0.527 |
| After fleet waves 1–6 | **0.568** |

Reproduce: `node scripts/grade-macro-depth.mjs --honest` (writes `audit/macro-depth-honest.json`).
Guard: `node scripts/check-depth-tests.mjs` → currently **982 behavioral tests / 83 files**.

**Ceiling is ~0.73–0.85, not 1.0** — `utility`-tier handlers are weighted 0.6 by design so
correctly-small handlers can't become "production-grade" without padding. Do NOT pad macros
to chase 1.0; `--honest` is meant to be ungameable. Cite the floor, not the generous default (0.999).

## What's DONE (committed on `claude/conkay-prod-audit-B3Mdk`)

Hand-written first batches + fleet waves 1–6 (each `server/tests/depth/<domain>-behavior.test.js`):
logistics, crime, romance, religion, politics, city, electrical, consulting, kingdoms,
mounts, crisis, schemes, healthcare, legal, whiteboard, finance, foundry, code, message,
chat, trades, crypto, realestate, government, agriculture, research, retail, studio, agents,
atlas, aviation, worldmodel, calendar, food, experience, wellness, automotive, events, art,
collab, creative, services, environment, repos, cooking, science, sports, council, markets,
classroom, astronomy, alliance, questmarket, attention, paper, board, reflection.

**Real source bugs found + fixed along the way** (the campaign earning its keep):
- `server/domains/calendar.js` — `scheduleOptimize` `(pOrder[p] || 2)` falsy-coerced
  `critical` rank 0 → 2, sorting critical below high. Fixed `||`→`??`.
- `server/domains/sports.js` — `injuryRisk` `(restDaysPerWeek || 2)` masked 0 rest days
  (highest risk) into 2. Fixed to a `Number.isFinite` guard.
- Earlier: 5 orphan domains (crime/romance/religion/politics/city — 68 dead macros) wired
  into `server.js`; logistics state-store bug; religion ctx fallback.

## The work queue (self-maintaining)

`node scripts/depth-backlog.mjs --all` ranks every untested lens-action domain by
honest-floor leverage, auto-excluding already-credited ones. ~90 domains remain (high-value
tail thinning out). Process top-down in waves.

## The orchestration loop (proven)

1. Pick the next ~6 uncredited domains from `depth:backlog`.
2. Dispatch **6 parallel subagents**, one domain each, with the standardized prompt below.
3. As each reports green, the orchestrator commits its file (commit doesn't boot the server,
   so it never collides with in-flight agent boots).
4. When the wave closes: run `check-depth-tests.mjs` (static guard), refresh
   `grade-macro-depth.mjs --honest`, commit the snapshot, push.
5. Repeat until the backlog is exhausted or the floor plateaus near the ceiling.

**Context-safe verification** (so checking N domains doesn't blow the orchestrator's context):
trust each agent's one-line report + the cheap static guard per wave; the FINAL safety net is
one aggregate full-suite run (`tests/depth/*-behavior.test.js`) + the grader — both O(1) output
regardless of domain count. A misreporting agent shows up as: missing file → absent; broken →
fail; vacuous → guard rejects.

## The standardized per-agent prompt (copy/substitute `<D>`)

> Write REAL behavioral tests for ONE domain to raise the honest macro-depth floor. Domain: **`<D>`**.
> **Do NOT stop at a plan — WRITE the file, RUN it, FIX failures, RE-RUN until `# fail 0`, then report.**
> - Read `server/domains/<D>.js` and detect the family:
>   - `registerLensAction("<D>",…)` → use `lensRun(domain,action,{data|params},ctx)` from
>     `server/tests/depth/_harness.js`. Templates: `logistics-behavior.test.js`, `code-behavior.test.js`.
>     **Wrapping:** `lens.run` unwraps the handler's `result` key → read `r.result.<field>`; a rejection
>     is `r.result.ok === false` + `assert.match(r.result.error,/…/)`. (A handler returning
>     `{ok:false,error,result:{…}}` is unwrapped to the inner `result` — assert the inner field.)
>   - `register("<D>",…)` → use `macroRuntime("<D>")` → `{runMacro, ctx}`. Templates:
>     `crime-behavior.test.js`, `romance-behavior.test.js`. Result returns DIRECTLY: `r.<field>`,
>     rejection `{ok:false,reason}`. If `"macro domain not found"`, the domain isn't wired — report it.
> - **Quality bar:** every `it()` asserts an exact computed value, a round-trip (`.some(…)` read-back),
>   or a validation rejection. NEVER a bare `assert.equal(r.ok,true)`/`typeof`/`Array.isArray` alone
>   (the guard rejects those). Use LITERAL `lensRun("<D>","<a>")`/`runMacro("<D>","<m>")` strings —
>   that's the grader credit. AVOID a standalone `RegExp.test(…)` line (the guard mis-scans `.test(`).
> - **Skip** network/LLM macros (they fail under the no-egress preload); note skips in the file header.
> - **Run to green (isolated DB, mandatory preload or boot hangs ~2min):**
>   `cd server && DB_PATH=/tmp/depth-<D>.db node --test --import=./tests/preload/no-egress.mjs
>   --test-force-exit --test-timeout=60000 tests/depth/<D>-behavior.test.js`
> - **Guard:** `node scripts/check-depth-tests.mjs` — confirm no issue for `<D>`.
> - **Bugs:** a REAL source bug → fix surgically in the domain AND report; never fake/mock/weaken;
>   never change economic constants.
> - **Report ONE line:** `<D>: N/N pass · guard OK · bugs: <none|desc>` + distinct macros covered.

## Open hardening notes (from the 2026-06-07 security audit — NOT blocking, don't lose them)

All 7 CLAUDE.md security claims verified HOLD against code. Two low/info follow-ups remain:
1. **LOW** — `productionWriteAuthMiddleware` (`server.js:6526`) passes if an auth header is merely
   *present* (even garbage). Backstopped by `_lensActionForbiddenForAnon` + the macro layer resolving
   such callers to `actor.userId === "anon"`. TODO: enumerate write/money routes that rely on the
   global gate ALONE (no own `req.user` check) and confirm none trust it solo.
2. **INFO** — Stripe *deposit* checkout-session idempotency key is metadata-only (`stripe.js:102-128`),
   not passed as the Stripe `{ idempotencyKey }` request option the way the *payout* side correctly
   does (`stripe.js:698`). Lower-stakes (webhook/session-id dedup covers it); tighten to match payout.

## Continuation

Next session: `npm run depth:backlog` → dispatch the next wave per the loop above → keep going to
the ceiling. Update the Status table here + CLAUDE.md's depth line after each batch.
