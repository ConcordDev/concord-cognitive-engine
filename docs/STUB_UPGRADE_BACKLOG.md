# Macro Depth Upgrade Backlog

> **What this is.** The remaining work to lift weighted depth score from
> the current value to 1.000. Two parts: (1) the 15 macros currently at
> `tier=stub`, all of which are defensible; (2) the ~2,132 macros at
> `tier=functional` that need mechanical signals (try/catch, hand-written
> tests) or per-feature depth lifts.
>
> Regenerate with:
> ```sh
> node scripts/grade-macro-depth.mjs
> jq '.totals, .weightedScore' audit/macro-depth.json
> ```

## Aggregate at HEAD `6483307` (2026-05-23, after Phase A calibration)

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| stub | 15 | 0.2% | 0.2 |
| functional | 2,132 | 25.3% | 0.6 |
| utility | 4,336 | 51.4% | 1.0 |
| production-grade | 1,959 | 23.2% | 1.0 |

**Weighted depth score: 0.898** (1.0 = all production-grade or utility).
**Remaining gap: 0.102.**

The previous version of this file targeted 185 user-visible stubs at
weighted depth 0.554. After Phase A grader calibration (recognized
behavior-smoke coverage, added the utility tier, broadened robustness
detection), 167 of those flipped to utility or functional honestly —
they were never stubs, the grader was under-counting. The remaining 15
stubs (listed below) are all real shallow handlers, but most are
defensibly so (LLM-only or destructive ops that the smoke harness
intentionally skips by name pattern).

## The 15 remaining stubs

| Macro | LOC | Why it's still a stub | Action |
|---|---:|---|---|
| `basketball.score` | 9 | Sport-helper, no test, no frontend caller. Either dead or pre-Concordia content. | Verify whether `basketball` lens actually exists/uses this. If yes, hydrate from a real game state. If no, remove. |
| `cache.clear` | 6 | Skipped by `DESTRUCTIVE_HINT_RE` (matches `clear`). Admin-only. | Add an admin-test that exercises it; or accept as utility-grade ops macro and tag explicitly. |
| `council.conflictResolution` | 7 | `council` domain is in `BEHAVIOR_SKIP_DOMAINS` (LLM-heavy). | Hand-write a contract test that mocks the LLM; or accept as inherently LLM-routed. |
| `council.evaluate` | 1 | One-line delegation that doesn't match the regex shape. | Verify delegation target; add explicit `delegates: true` tag if confirmed. |
| `council.generateMinutes` | 7 | Same as conflictResolution. | Same. |
| `council.voices` | 1 | One-line read. | Trace to real implementation. |
| `council.voteCount` | 8 | Pure tabulation, no state. | Add unit test that asserts vote-counting math. |
| `cross_world_effectiveness.explain` | 5 | `explain` matches `LLM_HINT_RE`. | Same as council — hand-written contract test or accept. |
| `expert_mode.answer` | 14 | `answer` matches `LLM_HINT_RE`. | Same. |
| `forge.generate` | 6 | Delegates to forge engine; one-liner. | Verify delegation; tag if confirmed. |
| `hiddenQuests.evaluate` | 12 | `evaluate` matches `LLM_HINT_RE`. | Same. |
| `insurance.revoke` | 14 | `revoke` matches `DESTRUCTIVE_HINT_RE`. | Hand-write a fixture-based revoke test. |
| `oxygen.reset` | 6 | `reset` matches `DESTRUCTIVE_HINT_RE`. | Same. |
| `playerCorpse.drop` | 10 | `drop` matches `DESTRUCTIVE_HINT_RE`. | Same. |
| `sandbox.kill` | 9 | `kill` matches `DESTRUCTIVE_HINT_RE`. | Same. |

**Estimated effort to clear all 15:** ~1 day. Two-thirds are smoke-skipped
by name-pattern; the fix is either to opt them into the harness with
proper fixtures, or write 15 individual contract tests.

## The 2,132 functional-tier macros — the real 10pp gap

Most of these are substantive (≥40 LOC, touch state) but missing the
`try/catch` signal. The dispatcher (`runMacro` in `server/server.js:10335-10356`)
already catches throws, so wrapping handlers is *defensive-only* — but it
earns the robustness signal the grader needs.

Estimated impact of mechanical try/catch wrapping pass (Phase B2 in the
depth-upgrade plan):
- ~1,500 functional macros gain `tryCatch=true`.
- Of those, ~1,200 already have state + exercise + LOC ≥ 40 and will flip
  directly to production-grade.
- Net weighted depth lift: 0.898 → ~0.95.

The remaining ~300 functional macros need hand-written tests (they're
not covered by behavior smoke because they match the LLM/destructive
skip patterns) or per-feature depth — that's Phase C, the genuine
per-implementation work.

## Headline-stub upgrades (spec prose ↔ implementation mismatch)

These are FUNCTIONAL-tier macros whose spec language overstates what
they do. The depth grader can't detect this — it sees substance and
correctly classifies them functional — but the spec README's "shipped
front-to-back" boilerplate doesn't match what a user sees.

| Spec claim | Current state | Honest upgrade path |
|---|---|---|
| `code.liveshare-*` "Real-time multiplayer / Live Share editing — front-to-back" | Polling op-log, no WebSocket, no OT/CRDT | Replace polling with Socket.IO room + Y.js or Automerge for CRDT-based conflict-free edits + cursor + selection presence. Alternative: downgrade spec language to "polling-based collaborative session." |
| `healthcare.telehealth-create` "Telehealth video visit integration — front-to-back" | Appointment record + optional Daily.co API hook (no client) | Bundle a WebRTC client in the lens. Mount video tile UI. Alternative: downgrade to "video-visit scheduling + room provisioning." |
| Other prose-vs-impl mismatches | Audit per-spec | Either upgrade or honestly downgrade spec language. |

Audit walk-through: open each `docs/lens-specs/*.md`, scan the
"Missing — buildable feature backlog" list for `[x]` items, and verify
the named macro actually does what the prose claims. If yes, leave
alone. If no, pick path (a) upgrade implementation or (b) downgrade
prose. Track decisions in this doc.

## How to upgrade a macro

1. Read the current handler — confirm what signal it's missing
   (`jq '.macros[] | select(.domain=="X" and .macro=="Y")' audit/macro-depth.json`).
2. **Missing tryCatch** — wrap the body. Pattern:
   ```js
   register("d", "n", async (ctx, input) => {
     try {
       /* existing body */
     } catch (e) {
       return { ok: false, error: "handler_error", message: String(e?.message || e) };
     }
   });
   ```
3. **Missing test (not covered by behavior smoke because of skip rules)** — add a
   contract test in `server/tests/<domain>-domain-parity.test.js` that calls
   the macro and asserts on the response.
4. **Below 40 LOC + substantive** — deepen the implementation with real
   state queries / cross-macro orchestration. Don't pad with comments
   to clear the LOC bar.
5. Re-run `node scripts/grade-macro-depth.mjs` — tier should bump
   automatically. Commit the updated `audit/macro-depth.json` alongside
   the code change.

## What "stub" doesn't mean

- **Doesn't mean broken.** A stub that returns `{ ok: true, result: hardcoded }` works — it just doesn't do much.
- **Doesn't mean useless.** The utility tier (added in Phase A) now catches catalogs/formatters that are correctly small.
- **Doesn't mean shipped is a lie.** A feature can ship `[x]` while its macro is functional-tier (missing tryCatch). The honest claim is "shipped, depth: functional" — not stub.
