# Ops Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below is backed by a grep or a full
> read of the file it's about.

**What this lens is.** `ops` is TWO surfaces sharing one page: (1) a
PagerDuty-shape **incident-management console** (`IncidentConsole` +
`OpsActionPanel` — incidents/alerts/services/on-call/escalation/analytics/
status-page), which is per-user and correctly NOT admin-gated, and (2) an
operator-only **"Substrate Ops" observability dashboard** (Attention /
Repair Net / Physical DTUs / Explorations tabs) over system-wide simulation
state, which the frontend has always treated as admin/operator-only
(`AdminRequiredState` on forbidden; `ops` is listed among the 6 operator
lenses in `concord-frontend/tests/e2e/admin-gated-lenses.spec.ts`). Category
leader for the incident-management half: PagerDuty. See `docs/lens-specs/ops.md`
for that half's full feature-parity audit (~88%, unchanged by this pass).

## Finding: substrate-ops macros had zero server-side role check (fixed)

The four domains the "Substrate Ops" tabs call —
`attention_alloc` (`server/server.js:17161-17196` pre-fix, `emergent/attention-allocator.js`),
`repair_network` (`server/server.js:17181-17184` pre-fix, `emergent/repair-network.js`),
`physical` (`server/server.js:17117-17124` pre-fix, `emergent/physical-dtu.js`),
`explore` (`server/server.js:17242-17244` pre-fix, `emergent/reality-explorer.js`)
— registered 21 macros total with **no `ctx.actor.role` check at all**. Only
`concord-frontend/app/lenses/ops/page.tsx` calls these four domains
(confirmed by grep across the whole frontend for `runDomain('attention_alloc'`
etc. — zero other call sites), so gating them admin-only cannot break any
other lens.

This was a real, exploitable gap, same class as the psyops (`0de13bbe`) and
`domains/admin.js` (`7b0a52f1`) fixes earlier in this wave:

- `attention_alloc.focus` — any authenticated user could force-focus up to
  90% of the shared civilization-wide LLM attention budget onto one domain
  (`server/emergent/attention-allocator.js:269` `setFocusOverride`, module-level
  state shared by every user — "Sovereign can force-focus a domain" per the
  file's own header comment).
- `attention_alloc.budget` — any authenticated user could resize the total
  shared compute budget for every domain.
- `repair_network.disconnect` — any authenticated user could tear down the
  shared distributed repair network for everyone.
- `physical.*` / `explore.*` — lower blast-radius (DTU creation / adjacent-
  reality exploration cycles) but still meant to be an operator surface, and
  `explore.run` triggers real work over the DTU corpus.

### Fix

Added a dedicated local gate — `requireOpsSubstrateAdminRole(ctx)` in
`server/server.js` (declared once, top-level, right before `initGhostFleet()`)
— as the first statement in all 21 macro handlers across the four domains.
Deliberately NOT the existing `requireAdminRole` (used only by the
server.js-inline `admin.dashboard/logs/metrics` macros, which rely on their
own dedicated `/api/admin/*` REST routes translating a denial into a real
HTTP 403): this lens's substrate-ops macros are only reachable through the
generic `POST /api/lens/run` gateway, which **always answers HTTP 200** with
`{ ok: true, result }` — the macro's own `{ ok: false, error }` on denial
lives one layer down, inside `result`. `requireOpsSubstrateAdminRole`'s
denial text (`"Insufficient permissions: admin role required"`) matches the
frontend's `isForbidden()` regex (`/insufficient permission/i`), following
the exact idiom the psyops/admin fixes established.

### Fix, part 2 — the frontend gate was unreachable

Even with the server-side gate in place, `app/lenses/ops/page.tsx`'s four
`useQuery` calls read `r.data?.result` directly as data with no check —
because `/api/lens/run` always returns HTTP 200, a denial would have landed
in `query.data` (as `{ ok: false, error: ... }`), never in `query.error`, so
`isForbidden(query.error)` — which the page's `forbidden` gate depends on —
would never have fired. A non-admin user would not have seen the fabricated
data the pre-fix backend leaked, but would have hit a **permanently stuck
loading spinner** instead of the friendly "Admin access required" state (the
`attention.data?.allocations` field would stay `undefined` forever, so the
tab's `Loader2` branch never resolves). Added `runGatedDomain<T>()`, a small
wrapper that checks the inner `result.ok === false` and throws so react-query
captures it as a real query error; all four queries (`attention`, `repairNet`,
`physical`, `explore`) now route through it.

### Verification

- `server/tests/ops-substrate-admin-gate.test.js` (new, 4/4 passing) — every
  one of the 21 macros denies a plain-`user`-role caller with the
  isForbidden-matching error text, denies a caller with no role at all,
  admits owner/admin/founder, and proves the denial happens before any
  mutation (a denied `repair_network.disconnect` doesn't affect a
  subsequent admin `status` read).
- Existing `server/tests/ops-domain-macros.test.js` (47/47),
  `server/tests/ops-domain-parity.test.js`, `server/tests/depth/ops-behavior.test.js`,
  and the frontend `tests/ops-incident-console-states.test.tsx` (4/4) all
  still pass unchanged — none of them touch the four gated domains (they
  exercise the separate, correctly-per-user `ops.*` PagerDuty macros), so
  this fix has zero blast radius on the incident-console half of the lens.
- `node scripts/verify-lens-backends.mjs` — unchanged at
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (the fix only adds a
  server-side gate; it doesn't change lens reachability).
- `node scripts/grade-ux-polish.mjs --honest` — `ops` unchanged at
  `tier: "polished"`, `isGenericScaffold: false` (the fix is a security/
  correctness change, not a UI-polish one).

## No other defect class found

The incident-management half of the lens (`IncidentConsole`,
`OpsActionPanel`, `server/domains/ops.js`'s 4 legacy + 17 2026-parity macros)
was read in full and is genuinely clean: every field the components render
comes straight from a macro result with no fabricated/parallel data, no
generic macro-button-wall (the 8 `OpsActionPanel` actions are individually
designed — on-call/runbook/escalation/postmortem/mint/DM/publish/agent, each
with its own bespoke input form and result card), and no unsurfaced macros —
`incidentCreate/Transition/List/Note`, `alertIngest/List`,
`policyCreate/List/Evaluate`, `shiftCreate/Override`, `calendarView`,
`notifyDispatch/List`, `serviceCreate/List/Graph`, `analytics`, `statusPage`,
plus the 4 legacy `pageOnCall/runbookLookup/postmortemDraft/escalationCheck`,
are all called from `IncidentConsole.tsx` or `OpsActionPanel.tsx`. The `dtu`
substrate tab is honestly presentation-only (a static macro-name reference
list with an explicit "reserved for the v1.1 admin console" note) — it makes
no live calls, so it isn't a fabricated-data surface.
