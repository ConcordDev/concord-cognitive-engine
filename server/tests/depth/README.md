# Depth tests — the behavioral-coverage multiplier

These tests raise the **honest macro-depth floor** (`node scripts/grade-macro-depth.mjs --honest`)
by genuinely exercising lens-action macros — not shape-checking them. They're the
scalable version of the hand-written first batches.

## Why this exists
`--honest` only credits a macro as tested when a test **invokes** it (a literal
`lensRun("domain","action", …)`) — but the grader can't see *assertion quality*.
So a file full of `assert.ok(r.ok)` would credit thousands of macros while proving
nothing. `scripts/check-depth-tests.mjs` (CI-gated) closes that: every test must
carry a **real** assertion, and no scaffold-TODOs may merge. The floor can only
climb on real evidence.

## The loop (≈5 min/domain once tooling is warm)
```
npm run depth:backlog                 # ranks lens-action domains by honest-floor leverage
npm run depth:scaffold <domain>       # boots server, PROBES each action, writes a skeleton
#   → fill in each it(): give real inputs + a REAL assertion (use the // PROBE: comment)
#   → delete the @depth-todo throw
npm run depth:check                   # guard: no todos, every it() has a substantive assertion
node --test --test-force-exit --import=./tests/preload/no-egress.mjs tests/depth/<domain>-behavior.test.js
npm run grade-macros:honest           # confirm the floor ticked up
git commit
```
(Run `depth:check` BEFORE `grade-macros:honest` — a scaffold's literal `lensRun`
calls credit at the grader level even while throwing, so never grade a file that
still has `@depth-todo`.)

## The rule: REAL assertions only
A test must assert **behavior**, one of:
- **exact computed value** — `assert.equal(r.result.throatSize, "4.2mm")` (6 × 0.707).
- **round-trip** — create, then assert it reads back: `assert.ok(list.result.items.some(x => x.id === created.id))`.
- **validation rejection** — `assert.equal(r.result.ok, false); assert.match(r.result.error, /required/)`.
- **output contract** — `assert.deepEqual(Object.keys(r.result).sort(), [...])` for a KPI/summary macro.

NOT allowed (the guard rejects these): `assert.equal(r.ok, true)` alone,
`assert.equal(typeof r.result, "object")`, or a real assertion hidden in a comment.

## Invoking lens-actions: `lensRun`
Trade/professional macros are `registerLensAction(domain, action, handler)` — invoked
through the `lens.run` macro, not `runMacro(domain,action)`. `_harness.js#lensRun`
seeds the artifact and runs it; pass `{ data }` for calc macros (read `artifact.data`)
and `{ params }` for CRUD macros. `lens.run` reports outer `ok:true` on dispatch and
nests a handler refusal under `result` (so a rejection is `r.result.ok === false`).
Share a `ctx` across calls for state round-trips.

## Stopping rule
With `utility` weighted 0.6, testing everything caps at the **~0.75–0.85 ceiling**,
not 1.0 — correctly-small handlers can't become "production-grade" without padding.
Target the ceiling, prioritized by `depth:backlog` leverage. **Do not pad macros to
chase 1.0** — that's gaming, and the whole point of `--honest` is that it can't be gamed.
