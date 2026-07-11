# Invariant Lens — Capability Map

**Audited:** 2026-07-11 (Frontend Rebuild Program, Wave 3)
**Verdict:** real identity, real backend, one severe live bug + three fully-fabricated
dashboard panels — both fixed this pass. Not an operator-only console (see below).

## What this lens actually is

Despite the copy on the page ("Interactive ethos enforcer and capability tester"),
the real backend (`server/domains/invariant.js`, 1129 LOC, 18 macros registered via
`registerLensAction`) is a genuine **formal-verification workbench** — the closest
category comparison is a lightweight TLA+/Alloy-style tool:

- `invariantCheck` — evaluate a set of boolean invariants over a state object
  (AST-whitelisted expression evaluator via `acorn`, not a raw `Function`
  string-substitution hole — CodeQL `js/code-injection` was closed by adding a
  structural AST walk that rejects `CallExpression`/`NewExpression`/computed
  member access/forbidden globals before the identifier-substitution pass runs).
- `consistencyProof` — Merkle-hash comparison across N replicas, majority-group
  detection, divergent-replica resolution plan.
- `constraintSatisfaction` — real AC-3 arc-consistency solver over finite domains
  with search-space-reduction statistics.
- `registerMonitor` / `listMonitors` / `checkMonitors` / `setMonitorActive` /
  `removeMonitor` — continuous monitoring across simulated "ticks", persisted per
  user in `globalThis._concordSTATE.invariantLens`.
- `counterexample` — runs a failing invariant against a record set and does
  field-level blame attribution.
- `templates` — a real library of invariant templates (uniqueness, referential
  integrity, range, presence, conservation, temporal safety/liveness).
- `temporalCheck` / `recordSnapshot` / `clearHistory` — □ always / ◇ eventually /
  U until over a recorded state-snapshot history.
- `violationHistory` / `resolveViolation` — a real violation ledger with
  severity + resolution workflow.
- `quantifiedCheck` — ∀ / ∃ over a collection, returns witness or counterexample.

All of the above are wired end-to-end and DESIGNED (not generic-scaffold) in
`concord-frontend/components/invariant/FormalVerificationWorkbench.tsx` (798 LOC,
6 purpose-built tabs, zero mock data — every panel calls its macro via `lensRun`).
This component was clearly already built to a high standard before this pass;
this audit did not need to touch it.

`concord-frontend/components/invariant/FormalVerificationRepos.tsx` (68 LOC) is a
real live GitHub API feed (`api.github.com/search/repositories?topic=...`) of
real-world formal-verification projects (TLA+, Alloy, Dafny, Coq, etc.) — genuine
external data, not fabricated.

## Defects found and fixed this pass

### 1. Action Invariant Tester was structurally broken — always reported "blocked" (HIGH)

`page.tsx`'s `testMut` called `apiHelpers.lens.run('invariant', 'test', { action:
'check', params: { text } })`. That helper posts to `/api/lens/:domain/:id/run`,
which treats the second argument as an **artifact id**, not an action name — the
literal string `"test"` was being used as an artifact id. Server-side
(`server.js` `register("lens","run",...)`) does `STATE.lensArtifacts.get(id)`,
which returns `undefined` for `"test"`, so the handler returns `{ ok:false,
error:"not found" }` **as an HTTP 200** (not a thrown error). Because
`testMut.mutateAsync` never threw, the frontend's `catch` fallback (a hardcoded
4-name keyword matcher) never ran either — `result.passed` was `undefined` on
every call, which the render logic treated as falsy, so the UI showed "❌ Action
was blocked" for **every** input, always, regardless of what was typed. This is
the "silently swallows a real failure" pattern the fluidity invariant calls out
by name.

**Fix:** added a real macro, `invariant.testAction` (`server/domains/invariant.js`),
that deterministically checks free text against the caller's own authored
invariants (keyword-derived from `name` + `description`, whole-word match, no
LLM call — reproducible and explainable). The frontend now calls it directly
through the macro system (`lensRun('invariant', 'testAction', { text,
invariants })`), the same path the Formal Verification Workbench already uses —
no artifact id required. A genuine backend failure now surfaces as an honest
"Check failed: …" message rather than a fabricated pass/blocked verdict.
Pinned by 5 new tests in `server/tests/invariant-domain-parity.test.js`
(`describe("invariant.testAction")`).

### 2. Three fully-fabricated dashboard panels (HIGH — honest-by-construction violation)

The "System Invariants Dashboard" section rendered three panels with hardcoded,
static fake numbers presented as live telemetry, with **zero** backend
representation anywhere in `server/domains/invariant.js` or any other domain:

- **"Marketplace Fairness Score"** — a hardcoded array (`Equal Access: 98%`,
  `Price Transparency: 96%`, `No Preferential Treatment: 94%`, `Open
  Competition: 91%`) plus a hardcoded "Composite Score: 94.8%". No marketplace
  or fairness concept exists in this domain at all.
- **"Data Selling Prevention"** — hardcoded guard rows (`Outbound Data Filter:
  142 blocked`, `PII Scrubbing Engine: 89 blocked`, `Third-Party API Gate: 37
  blocked`, `Data Broker Blacklist: 256 blocked`) with a pulsing "active" green
  dot and a hardcoded "Total attempts blocked: 524". No egress-monitoring or
  data-selling telemetry exists anywhere tied to this lens.
- **"Invariant Health Timeline"** — a 24-hour bar chart where `health = i===14
  ? 'warning' : i===7 ? 'warning' : 'healthy'` — literally two hardcoded index
  positions, no time-series data of any kind behind it.

These read as live system health monitoring but were pure decoration — the
`invariant-checking` domain has no marketplace-fairness or data-egress
subsystem to report on.

**Fix:** removed all three. Replaced with two real panels computed from actual
data: **"By Category"** (real per-category counts + frozen count derived from
the caller's own `invariants` array — honestly shows "no invariants authored
yet" when empty, no fake percentage), and **"Live Verification Activity"** (a
real summary fetched via `lensRun('invariant','listMonitors',{})` +
`lensRun('invariant','violationHistory',{resolved:false})` — the same macros
the Formal Verification Workbench already exposes in full detail, just
surfaced as a compact live count here). Also fixed the adjacent "Enforcement
Rate" ring, which fell back to a hardcoded `95%` when `invariants.length ===
0` (implying system health with zero data present) — now shows `—` /
"no invariants yet" honestly.

## Is this an operator-only console requiring server-side role gating?

**No.** Unlike `psyops` (which surfaced platform-wide state to any
authenticated user with no server-side admin check), every piece of state in
this domain is scoped **per-user**: `invState()` keys `monitors` / `violations`
/ `histories` Maps by `invActor(ctx)` (`ctx.actor.userId`), and the "ethos
invariant" CRUD list goes through the generic `lens.list`/`lens.create` path,
which already enforces per-owner visibility (`server.js` `register("lens",
"list", ...)` filters by `ownerId === currentUserId` for non-social domains,
and `invariant` is not in the `SOCIAL_DOMAINS` allowlist). There is no
system-wide invariant state, no cross-user data exposure, and no admin-only
capability implied anywhere in the 18 registered macros — this is a personal
formal-verification sandbox, not a platform health console. No authz gap
found; no fix needed on this axis.

## Verification performed

- `node --check server/domains/invariant.js` — pass.
- `npx eslint server/domains/invariant.js server/tests/invariant-domain-parity.test.js` — 0 errors/warnings.
- `node --test server/tests/invariant-domain-parity.test.js server/tests/invariant-eval.test.js server/tests/depth/invariant-behavior.test.js server/tests/invariants.test.js server/tests/invariant-geometry.test.js server/tests/sovereignty-invariants.test.js` — 94/94 pass (89 pre-existing + 5 new `testAction` tests).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged, matches required baseline).
- `node scripts/grade-ux-polish.mjs --honest` — `invariant` entry: `tier:"polished"`, `isGenericScaffold:false` (unchanged from before the fix). `audit/` outputs reverted via `git checkout -- audit/` after the run.
- Frontend `npx eslint` could **not** be run — `concord-frontend/node_modules` was not installed and a full `npm install` did not fit in the ~1.3GB free on the shared box after the backend install (frontend `package-lock.json` lists 1383 packages). In its place: (a) manually re-read every edited region of `page.tsx` line-by-line; (b) a scripted check confirmed every remaining `lucide-react` icon import is referenced beyond its import line (no unused imports left after removing the three fabricated panels' icons — `Scale`, `ShieldOff`, `Ban`, `Activity`); (c) a scripted brace/paren/bracket balance check over the full file passed. `tsc` was not run per the standing rule for this batch.
