# welding — capability map (Wave 3 rebuild audit, 2026-07-10)

Category leader: Jobber / ServiceTitan (trades field-service management) for
the operations console + Lincoln Electric / Miller Weld Setting Calculator
apps for the engineering-calculator surface.

## Backend surface

`server/domains/welding.js` — **28 macros**, all registered via
`registerLensAction("welding", ...)` (no `MACROS`/`register()` entries, no
inline re-registration under domain `"welding"` in `server.js` — confirmed
no shadowing):

```
node -e "const s=require('fs').readFileSync('server/domains/welding.js','utf8'); console.log((s.match(/registerLensAction\(\"welding\"/g)||[]).length)"
# => 28
grep -n 'register.*"welding"' server/server.js   # => no matches (no shadowing re-registration)
```

Four pure engineering calculators (Tier-A, read `artifact.data`):
`jointStrength`, `rodSelection`, `heatInput`, `inspectionChecklist`.

Twenty-four field-service operations macros (Tier-B, read `params`,
STATE-backed per-user Maps in `STATE.weldingLens`): scheduling calendar
(`job-schedule`, `job-update`, `calendar`), quote→job workflow
(`estimate-create`, `estimate-list`, `estimate-send`, `estimate-to-job`),
invoicing (`invoice-from-job`, `invoice-list`, `invoice-payment`), WPS
builder (`wps-create`, `wps-list`, `wps-approve`), welder-cert tracking
(`cert-add`, `cert-status`, `cert-renew`), weld photo docs (`photo-attach`,
`photo-list`, `photo-remove`), a searchable AWS D1.1/ASME IX/API 1104 code
library (`code-search`), a client portal (`portal-view`, `portal-approve`,
`portal-pay`), and an ops dashboard rollup (`ops-summary`).

## What's real / already-wired

- **`components/welding/WeldingOperations.tsx`** (785 LOC) — a genuine
  Jobber/ServiceTitan-parity console. Seven tabs (Schedule / Quotes /
  Invoices / WPS / Certs / Photos / Codes), each calling its own
  `welding.*` macro directly via `lensRun('welding', action, input)` with
  flat field shapes matching the handlers exactly (`title`, `client`,
  `scheduledDate`, `durationDays`, `crew`, `lineItems`, `taxRate`,
  `estimateId`, `jobId`, `amount`, `method`, `wpsNumber`, `process`,
  `positions[]`, `welder`, `certType`, `expiryDate`, `warnDays`, `url`,
  `stage`, `caption`, `weldId`, `query`, `code`). Covers 20 of the 28
  macros. No fabricated data — every rendered value traces to a macro
  result (confirmed by reading every `run()`/`lensRun()` call site).
- **`components/welding/WelderProcedures.tsx`** (438 LOC) — four bespoke
  Lincoln/Miller-style calculator widgets (`JointStrengthCalc`,
  `RodSelector`, `HeatInputCalc`, `WeldInspection`), each calling its
  matching Tier-A macro through `apiHelpers.lens.runDomain('welding',
  action, { input: { artifact: { data } } })`. Every field name in the
  TypeScript result interfaces is a literal copy of the field names the
  handler in `server/domains/welding.js` actually returns (the file's own
  header comment says so, and it's true on inspection) — no fabricated
  fields. Each calculator has a `SaveAsDtuButton` that mints a DTU from the
  real computed result (honest artifact creation, not a fake "save").
- **`components/welding/WeldingFeed.tsx`** (69 LOC) — real external content
  (live Reddit r/Welding / r/metalworking / r/TIG / r/StickWelding feed via
  a direct client-side `fetch` to reddit's public JSON API), not fabricated.

## The defect + what changed

**Defect: a whole fabricated generic-CRUD dashboard sat in `page.tsx`,
duplicating — and disconnected from — the real, already-wired console
above.** This is defect pattern (c) from the rebuild-program brief: a
parallel fake system beside an already-real, already-wired component doing
the same job.

`app/lenses/welding/page.tsx` (pre-fix, 737 LOC) ran an 8-tab dashboard
(Jobs / Estimates / Codes / Materials / CRM / Invoices / Inspections /
Certs) built on `useLensData<TradeArtifact>('welding', activeArtifactType,
...)` and `useRunArtifact('welding')`. Tracing those hooks:

- `useLensData` fetches/creates against the **generic** `/api/lens/welding`
  artifact store (`GET/POST /api/lens/:domain`) — a key/value artifact CRUD
  system with no relationship to the 28 registered `welding.*` macros or
  the `STATE.weldingLens` Maps those macros read/write. Creating a "Job"
  through this dashboard never touched `job-schedule`; it never appears on
  the real Schedule tab, in `ops-summary`, or anywhere the real backend
  looks.
- The "Activate" (⚡) button on every row called `useRunArtifact('welding')`
  → `POST /api/lens/welding/:id/run` with `{ action: 'analyze' }` — one of
  the three generic `UNIVERSAL_ACTIONS = ["analyze","generate","suggest"]`
  catch-all actions (`server.js` line ~31939), not a real welding macro.
  This is the exact GENERIC-STRIP-ONLY pattern the "zero generic
  tendencies" invariant calls out — a button that *looks* domain-specific
  but reaches a generic LLM action, never a designed feature.
- `docs/lens-specs/plumbing.md` (the sibling trades lens's older spec doc)
  confirms this generic 9-tab artifact CRUD was the *original* design for
  the trades-lens family, written before the real field-service macro
  substrate (`job-schedule`/`estimate-create`/`invoice-from-job`/
  `cert-add`/`code-search`/...) existed. The real substrate was added
  later (`WeldingOperations.tsx`'s own header comment: "Wires the
  welding-domain operational macros into one purpose-built surface") but
  the superseded generic dashboard was never removed from `page.tsx`.

**Fix:** rewrote `app/lenses/welding/page.tsx` to drop the entire generic
CRUD dashboard (8 tabs, editor modal, dashboard-stats toggle, fake top
stats grid, `UniversalActions` generic action bar, `useLensData`/
`useRunArtifact` imports and all related state) and mount the two already
real, already-wired, bespoke components as the page's primary content
(`WeldingOperations` for field-service ops, `WelderProcedures` for the
engineering calculators, `WeldingFeed` for the real-world content feed).
Page shrank from 737 LOC of fabricated-then-duplicated surface to 78 LOC of
composition. Platform primitives kept unchanged: `LensShell`,
`FirstRunTour`, `ManifestActionBar`, `DepthBadge`, `LensPageShell`,
`RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

No backend code was touched — `server/domains/welding.js` was read-only
throughout this pass. No macro field shapes were changed; `WeldingOperations`
and `WelderProcedures` were already calling the real macros with the
correct field shapes (verified below), so nothing in those two files needed
a fix.

## Investigated and honestly deferred

**`welding.portal-view` / `portal-approve` / `portal-pay` — unsurfaced.**
These three macros implement a token-based client portal (a customer
receives a `portalToken` when a welder sends an estimate via
`estimate-send`, and could use it to view/approve the estimate or pay an
invoice without a Concord login). `WeldingOperations.tsx`'s Quotes tab
already generates and displays the token after "Send to client" — but
nothing renders a page a client can actually open with that token; no
`/portal/...`-shaped route exists anywhere in `concord-frontend/app`.

Triage: **ENGINEERING**, not fabrication and not a missing backend. This is
a genuinely deferred build, not a defect to paper over — the reasons it's
out of scope for this pass:
1. It isn't part of the welding *lens* in the strict sense the rebuild
   program scopes to (`app/lenses/welding/` + `components/welding/`) — a
   customer-portal landing page is necessarily a new **public,
   unauthenticated** route outside `/lenses/*`, and in production
   `_lensActionForbiddenForAnon` (`server.js` line ~6653) requires a real
   authenticated actor for any `/api/lens/run` call — so a truly
   anonymous client-portal page needs either a `publicReadDomains` /
   `WRITE_AUTH_PUBLIC_PATHS` allowlist change or a dedicated
   non-lens-action route. That's a cross-cutting auth-surface decision,
   not a welding-lens-local fix.
2. There is a separate, already-shipped, differently-shaped customer
   portal for the trades family: `components/trades/CustomerPortalPanel.tsx`
   calls `trades.customer-list` / `trades.portal-view` /
   `trades.portal-quote-respond` (a *logged-in-operator-previews-what-the-
   customer-sees* pattern, not a public link). Building a second, redundant
   portal mechanism specific to welding's token macros without first
   confirming whether the `trades`-domain portal is meant to be the
   platform's one true customer-portal surface would risk exactly the kind
   of parallel-system duplication this pass just removed.
3. `docs/lens-specs/plumbing.md` shows plumbing (the closest sibling trades
   lens) has **no** `portal-*` macros at all — so this isn't a pattern
   repeated across the trades family that a shared component could close
   in one shot; it's welding-specific and would need its own design pass.

Recommendation for a future pass (not this one): decide whether
`welding.portal-*` should be retired in favor of routing through the
existing `trades.portal-view` shape, or given its own public
`/portal/welding/[token]` route with the auth-gate change explicitly
called out above. Either way, it's a cross-lens/auth-surface design
decision, not a welding-page fix.

## Verification

- `node --check server/domains/welding.js` → passes (file untouched).
- `node --test server/tests/depth/welding-behavior.test.js` → `1 pass`,
  `0 fail`.
- `cd concord-frontend && npx eslint app/lenses/welding/page.tsx
  components/welding/*.tsx` → clean, no output.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors tree-wide (0
  matches for `lenses/welding` or `components/welding`).
- `node scripts/verify-lens-backends.mjs` → `{"verdicts":{"WIRED":258,
  "NO-BACKEND-CALL":2},"total":260}` — same totals as before the change;
  `welding` is not in the `NO-BACKEND-CALL` list (only `narrative-walk` and
  `ux-suite`, both by design).
- `node scripts/grade-ux-polish.mjs` → welding still `tier: "polished"`,
  `pillarsPresent: 5/5`, `antiPatterns: 0` (unchanged from before the
  edit — removing the fake dashboard didn't cost any structural pillar,
  because `WeldingOperations.tsx`/`WelderProcedures.tsx`/`WeldingFeed.tsx`
  already independently carry loading/empty/error/aria/responsive/
  animation signals). Note: this worktree's `scripts/grade-ux-polish.mjs`
  does not implement the `--honest` flag / `isGenericScaffold` field
  described in the rebuild-program brief (checked directly — no match for
  `GENERIC_TRIO`/`isGenericScaffold`/`--honest` anywhere in the script);
  ran the grader as it actually exists in this worktree instead.
- Macro field-shape + computation correctness verified live via
  `server/tests/depth/_harness.js#lensRun` (compute-don't-guess, per
  CLAUDE.md's method) with inputs deliberately chosen to differ from every
  handler's default fallback value (so a wrong/absent field wouldn't
  silently read as "correct by coincidence" — the first pass of this check
  used the exact default values and was retracted for that reason):
  - `jointStrength({weldType:"butt", material:"stainless-steel",
    thickness:12, length:250})` → throat 12mm, tensile 520 MPa, capacity
    936 kN, safe load 624 kN, rating "heavy-duty" — hand-verified against
    the formula in `server/domains/welding.js` (`throatSize = thickness *
    1.0` for butt, `shearStrength = tensile*0.6`, `loadCapacity =
    round(throat*length*shear/1000)`, `safeLoad = round(capacity/1.5)`).
  - `rodSelection({baseMetal:"aluminum", position:"overhead",
    jointType:"groove", thickness:10})` → correctly filtered to
    all-position aluminum rods, picked `ER5356` (marine-grade, `positions:
    ["all"]`), diameter 4.0mm (10mm falls in the `<=12` bracket), and
    correctly appended the overhead-specific tip.
  - `heatInput({voltage:30, amperage:200, travelSpeed:4,
    efficiency:0.85})` → 1.27 kJ/mm, matches `30*200*0.85/4 = 1275
    J/mm`.
  - `job-schedule({title:"Distinct Test Job", client:"DistinctClient",
    address:"123 Foo St", scheduledDate:"2026-09-15", durationDays:3,
    crew:["Alice","Bob"]})` → every field round-tripped into the returned
    job record unchanged.
  This confirms `WelderProcedures.tsx`'s `{ input: { artifact: { data } } }`
  wrapping (peeled server-side by `server/lib/lens-input-normalize.js#
  peelRedundantArtifactWrapper` back to a flat `artifact.data`) and
  `WeldingOperations.tsx`'s flat `lensRun(action, input)` calls both reach
  the handlers with the exact field names the handlers read — no
  field-shape mismatch bug exists in either component.

## Left alone, with reason

- `server/domains/welding.js` — not touched. All 28 macros are correct,
  tested (`server/tests/welding-domain-parity.test.js`,
  `server/tests/welding-lens-macros.test.js`,
  `server/tests/depth/welding-behavior.test.js`), and already reached by
  real UI with correct field shapes.
- `components/welding/WeldingOperations.tsx`,
  `components/welding/WelderProcedures.tsx`,
  `components/welding/WeldingFeed.tsx` — not touched. Already DESIGNED
  (bespoke, in-context UI, no generic action walls), already honest (no
  fabricated data), already correctly wired. Editing exemplary code here
  would only add risk.
- The sibling trades lenses (`plumbing`, `hvac`, `carpentry`, `masonry`,
  `landscaping`) share the exact same superseded generic-CRUD-dashboard
  pattern in their own `page.tsx` files (confirmed by grep — each imports
  `useLensData`/`useRunArtifact` the same way). Out of scope for this
  task, which is welding-only; each is presumably a separate rebuild unit
  in this same wave.
