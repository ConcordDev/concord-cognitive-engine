# Consulting Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. This unit's audit read every backend macro handler
> and every frontend component in full, cross-checked field shapes, verified
> the domain's boot-time registration, and ran every existing test file
> plus the two mechanical graders. Conclusion: **the lens was already
> clean.** No code changes were made. This document records the audit so a
> future pass doesn't repeat the discovery work.

## Backend surface

`server/domains/consulting.js` registers 39 `consulting.*` lens-actions via
`registerLensAction`:

- 4 pure-compute calculators (no state): `engagementScope`, `utilizationRate`,
  `proposalScore`, `clientHealth` — fail-closed numeric coercion (`finPos`/
  `finSigned`) so poisoned/`Infinity` input can never leak into a money field
  (pinned by `tests/consulting-lens-macros.test.js`'s "poisoned numerics stay
  FINITE" suite).
- STATE-backed engagement/time substrate: `engagement-create/list/update/
  delete`, `time-log`, `consulting-dashboard`.
- Invoicing: `invoice-create/list/mark-paid/delete/export` — rolls up
  unbilled time entries, computes tax, generates a real plain-text export
  document.
- Proposal builder: `proposal-templates/create/list/update-section/sign/
  delete` — 8 reusable section templates, completeness scoring, e-signature
  acceptance.
- Staffing: `consultant-create/delete`, `allocation-create/delete`,
  `staffing-plan` — per-week utilization + overbooking detection.
- Expenses: `expense-create/list/update/delete` — reimbursable tracking,
  approval status machine.
- Live timer: `timer-start/status/stop/cancel` — server-side elapsed time,
  converts to a time entry on stop.
- Retainers: `retainer-create/list/bill/update/delete` — cadence-aware MRR,
  overage-hours billing periods.
- Profitability: `profitability-report` — per-engagement billed vs. labor
  cost vs. expenses margin, blended cost-rate fallback.
- Client portal: `portal-share/list/respond/delete` — share-token +
  external approval decision recording.

Registration path verified live (not just by static grep, per CLAUDE.md's
"runtime-truth over source-guessing" doctrine — a prior false lead in this
session assumed `registerConsultingActions` was orphaned because it isn't
called directly from `server.js`; it's actually collected into
`server/domains/index.js`'s exported `domainModules` array and invoked via
`domainModules.forEach(mod => mod(registerLensAction))` at `server.js:41742`,
same as every other super-lens domain module). Confirmed no inline
`consulting.*` registrations exist elsewhere in `server.js` (`grep -n
"registerLensAction(\"consulting\"" server/server.js` outside the domain
file returns nothing) — one domain file, one registration path, no split
sources of truth.

## Frontend surface

`app/lenses/consulting/page.tsx` (724 LOC) + 9 bespoke components under
`components/consulting/` (1,830 LOC combined, max single component 287 LOC):

| Component | Macros wired | Verified |
|---|---|---|
| `EngagementTracker.tsx` | `engagement-create/list/update/delete`, `time-log`, `consulting-dashboard` | field-shape exact match |
| `ConsultingWorkbench.tsx` | shell that loads `engagement-list` once and fans it into 9 panels | exact match |
| `LiveTimer.tsx` | `timer-start/status/stop/cancel` | exact match |
| `InvoiceManager.tsx` | `invoice-create/list/mark-paid/delete/export` | exact match |
| `ProposalBuilder.tsx` | `proposal-templates/create/list/update-section/sign/delete` | exact match |
| `StaffingPlanner.tsx` | `consultant-create/delete`, `allocation-create/delete`, `staffing-plan` | exact match |
| `ExpenseTracker.tsx` | `expense-create/list/update/delete` | exact match |
| `RetainerManager.tsx` | `retainer-create/list/bill/update/delete` | exact match |
| `ProfitabilityReport.tsx` | `profitability-report` | exact match |
| `ClientPortal.tsx` | `portal-share/list/respond/delete` | exact match |
| `ConsultingCalculators.tsx` | `engagementScope`, `utilizationRate`, `proposalScore`, `clientHealth` | exact match, including the `{ artifact: { data } }` single-redundant-wrap shape `peelRedundantArtifactWrapper` expects |
| `ConsultingFirmReference.tsx` | live Wikipedia REST API (16 real consulting firms: McKinsey, BCG, Bain, Deloitte, ...) + `SaveAsDtuButton` to mint a citable DTU from real fetched data | honest external data, no fabrication |

Every one of the 39 backend macros has a real, designed UI caller. No
unsurfaced macros, no field-shape mismatches found across ~13 macro groups
and ~40 call sites. The `/api/lens/run` envelope is unwrapped correctly
everywhere (`r.data?.result`, `r.data?.ok`) — no instance of the "checked
outer transport `ok` instead of unwrapping `.result`" bug class.

## Generic-library tier (page.tsx `MODE_TABS` + `useLensData`)

The page also mounts a generic DTU-backed artifact library (7 tabs:
Engagements/Proposals/Deliverables/Clients/Timesheets/Frameworks/Pipeline)
via the shared `useLensData`/`useRunArtifact` hooks — this is the same
shared-primitive pattern documented in CLAUDE.md's "Per-Lens Polish +
Cross-Lens Seamlessness sprint" (`ManifestActionBar`, `RecentMineCard`,
`AutoActionStrip`, `CrossLensRecentsPanel`, `LensPageShell`) used across the
already-rebuilt fleet, not a lens-specific fabrication. It persists to real
DTUs via `/api/lens/consulting` (genuine storage, genuine data, exportable/
citable elsewhere via the Workspace Bus) — not fake data. It is a distinct
concept from the operational `EngagementTracker` below it (different
storage: generic DTU vs. `STATE.consultingLens.engagements`), which could
read as mildly confusing (two different "Engagement" concepts on one page)
but is not a honesty or generic-scaffold violation per the mechanical
grader. **CLOSED (2026-07-17, `29a29a8e`)** — took the re-label option:
the generic DTU tab is now labeled "Engagement Records" with a
distinguishing subtitle/tooltip, and `EngagementTracker.tsx` gained a
matching cross-reference note. Label/copy-only — the underlying
`artifactType: 'Engagement'` storage key is untouched.

## Genuinely missing (deferred) — triage

None found. Every macro in the domain file has a dedicated, designed panel;
no defining category-leader feature (vs. Bonsai/Harvest/Deltek — the real
reference apps for consulting practice management) was found unbuilt. The
lens covers: engagement tracking, time tracking, invoicing, proposals
with e-signature, staffing/resource planning, expense tracking, retainers,
profitability reporting, and a client portal — the full practice-management
loop a real Bonsai or Harvest competitor would need.

## Verification

- `cd server && node --test tests/consulting-engagement-domain-parity.test.js tests/consulting-domain-parity.test.js tests/consulting-lens-macros.test.js tests/depth/consulting-behavior.test.js` → **65/65 pass, 0 fail**.
- `cd concord-frontend && npx vitest run tests/consulting-lens-states.test.tsx` → **5/5 pass** (loading/error/empty/populated + working Retry + correct domain wiring for `useRunArtifact`).
- `cd concord-frontend && npx eslint app/lenses/consulting/page.tsx components/consulting/*.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged from baseline; `consulting` is WIRED).
- `node scripts/grade-ux-polish.mjs --honest` → `consulting`: `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`, `pillarsPresent: 5/5`, `bespokeRatio: 0.717`. (`audit/` output reverted via `git checkout -- audit/` after each run — transient artifact per CLAUDE.md §6.)
- No backend or frontend source files were modified — this was a verify-only pass.
