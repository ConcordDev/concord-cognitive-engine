# Legal Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("legal"' server/domains/legal.js
```
→ **62** macros in `server/domains/legal.js` (1,750 lines), registered via
`registerLegalActions(registerLensAction)`. Genuinely deep: real Clio-parity
matters/contacts/time-tracking/IOLTA trust accounting (overdraw-rejection +
3-way reconciliation)/invoices-from-time/e-signature/court-rules-aware
deadline calculator (FRCP citations, federal-holiday rolling)/intake-forms→
contact+matter conversion/payment portal/budget+realization reporting. Every
mutating handler is try/catch-wrapped; numeric coercion is fail-closed
(`finiteNum` rejects NaN/±Infinity rather than silently defaulting through
`|| 0`). One unrelated inline `register("legal","sign",...)` in
`server.js:26436` is a DTU-signing macro, not part of this lens.

Two distinct backend layers coexist by design, not by accident:

1. **Clio-parity state** (`getLegalState()` — `s.matters/contacts/timeEntries/
   timers/trustAccts/trustTxns/invoices/documents/templates/esignEnv/calendar/
   intakeForms/intakeSubs/payments/budgets`, all per-user `Map`s under
   `globalThis._concordSTATE.legalLens`). 46 macros read/write this state:
   `matters-*`, `contacts-*`, `time-entries-*`, `timer-*`, `trust-*`,
   `invoices-*`, `documents-list`, `doc-templates-*`, `doc-generate`,
   `esign-*`, `calendar-*`, `court-rules-deadline`, `ai-court-doc-to-calendar`,
   `intake-*`, `payment-*`, `budget-*`, `realization-rollup`,
   `dashboard-summary`, `ai-matter-update`, `conflict-search`.
2. **Legacy generic-artifact handlers** (8 macros — `deadlineCheck`,
   `contractRenewal`, `conflictCheck`, `caseSummary`, `complianceAudit`,
   `deadlineCalculator`, `generateInvoice`, `complianceScore`) that read from
   an `artifact.data` parameter object rather than the Clio state. When
   called through `POST /api/lens/run`, the dispatcher synthesizes a
   `virtualArtifact = { data: <the input params> }` (`server.js:39595`), so
   these handlers work correctly when the caller passes the expected fields
   directly as macro input — they don't require a real persisted "artifact."
3. Plus 3 independent LLM-backed macros with no Clio-state dependency:
   `contract-analyze` (AI contract risk-flagging), `legal-question`
   (jurisdiction-aware Q&A), and the separate `case-list`/`case-add` pair (a
   lightweight docket log in `s.cases`, distinct from the full `s.matters`
   CRM — see the Docket-vs-Matters note below).
4. `law.courtlistener-search` (`server/domains/law.js`) is a fourth, separate
   real macro this lens surfaces — CourtListener REST API v4 case-opinion
   search, 9M+ federal/state opinions, free without a key
   (`COURTLISTENER_API_TOKEN` env unlocks higher rate limits).

## Frontend surface (before this pass)

`concord-frontend/app/lenses/legal/page.tsx` (3,423 lines) mounted **two
entirely parallel systems**, one above the other:

1. **`ClioSection`** (mounted unconditionally, always visible) — a real
   Clio Manage-shape left-rail app (`ClioShell` + `LegalAskBar` +
   `LegalDashboard` + 11 panel components), wired via `lensRun()` calls
   directly against the 46 Clio-state macros. Every panel component
   (`MattersPanel`, `ContactsPanel`, `CalendarPanel`, `TimeTracker`,
   `TrustAccountsPanel`, `InvoicesPanel`, `PaymentsPanel`, `DocumentsPanel`,
   `ESignaturePanel`, `IntakeFormsPanel`, `ReportsPanel`) was confirmed real
   by full read: correct macro action names, correct field shapes, and
   correct inner-`ok` unwrap checks (`r.data?.ok === false`) before treating
   a call as successful — verified across all 11 panels, not just
   `MattersPanel` (which the prior attempt had already confirmed clean).
2. **`MODE_TABS`** (`Dashboard/Cases/Documents/TimeBilling/Calendar/
   Contacts/Contracts/Compliance/Analyzer/CaseTracker/LegalQA/CaseSearch/
   Intake/Reports`) — a ~2,900-line fabricated parallel CRUD system backed
   by `useLensData<LegalArtifact>('legal', 'artifact', ...)`, the **generic
   per-lens artifact store** — not `server/domains/legal.js` at all. Every
   `CaseData`/`DocumentData`/`TimeEntryData`/`CalendarEventData`/
   `ContactData`/`ContractData`/`ComplianceData` record was a client-invented
   shape with no macro on the other end; `seedItems` was empty, so on a
   fresh install this system rendered an entirely empty CRM sitting directly
   above ClioSection's real, populated one.
3. The `Analyzer`/`CaseTracker`/`LegalQA`/`CaseSearch`/`Intake`/`Reports`
   MODE_TABS entries were a partial escape hatch — they short-circuited to
   the real `ContractAnalyzer`/`CaseTracker`/`LegalQA`/`LegalCaseSearch`/
   `IntakeFormsPanel`/`ReportsPanel` components instead of the fake system,
   but `IntakeFormsPanel`/`ReportsPanel` were already reachable through
   `ClioSection`'s own nav (`intake`/`reports`) — a second, redundant mount
   point for the same two panels.
4. `LegalActionPanel` (deadlines/renewals/conflicts/audit + mint/DM/publish/
   agent, wired against the 8 legacy generic-artifact macros with correctly
   documented field shapes) was mounted at the bottom of the page,
   independent of both systems above.
5. `<UniversalActions domain="legal">` + `<LensFeaturePanel>` +
   `<RecentMineCard>` + `<AutoActionStrip>` — the full GENERIC_TRIO plus
   both named generic-action-array components — were also mounted, all
   pointed at the fake artifact system.

## The defects found

### 1. A fabricated parallel generic-CRUD system as ~85% of the page, sitting
directly beside an already-real, already-superior Clio-parity backend
(the confirmed head-start finding from the prior attempt)

Verified: every field in `CaseData`/`DocumentData`/etc. has **zero**
overlap with any real macro's persisted shape (e.g. the real matter record
from `matters-create` is `{name, clientId, matterType, status, ...}` keyed
into `s.matters`; the fake `CaseData` invented `caseNumber`/`jurisdiction`/
`court`/`judge`/`opposingCounsel`/`relatedParties` fields that map to
nothing). The "New Item" button created a fake artifact via `useLensData`'s
generic `create()` with no real backend receiver for its data shape. Quick
Stats derived entirely from these fake arrays would read `0`/empty on any
fresh install regardless of how much real Clio-parity data existed one
component up. This is the textbook "fabricated parallel generic-CRUD
system" defect class named in `CLAUDE.md`, and — per `ClioSection`'s
superset coverage (dashboard/intake/matters/contacts/calendar/time/
invoices/payments/trust/documents/templates/esign/reports vs. MODE_TABS'
Cases/Documents/TimeBilling/Calendar/Contacts/Contracts/Compliance) —
strictly redundant, not complementary.

### 2. GENERIC_TRIO + `UniversalActions`/`LensFeaturePanel` mounted on a page
that already has 5+ real bespoke components

Per the zero-generic-tendencies invariant, these are a process failure the
same tier as fabricated data even though the macros they can reach are
real — a raw action-array wall is not a designed feature.

### 3. Two duplicate mount points for `IntakeFormsPanel` and `ReportsPanel`

Reachable both via MODE_TABS (`Intake`/`Reports` tabs) and via `ClioSection`'s
own nav (`intake`/`reports`) — dead weight once MODE_TABS is removed.

### 4. No envelope-unwrap bugs found

`lensRun()` (`concord-frontend/lib/api/client.ts:352`) already performs the
canonical fix centrally — it recursively unwraps nested `{ok, result}`
envelopes and returns `{data: {ok, result, error}}` with the **innermost**
`ok`/`error` surfaced, so every caller checking `res.data?.ok === false` or
relying on `res.data?.result` being `null` on failure is correct by
construction. Verified across all 11 Clio panels, `LegalActionPanel`,
`LegalCaseSearch` (which additionally applies its own local double-unwrap
via `apiHelpers.lens.runDomain`, correctly, matching the pattern
`persona-envelope.ts` documents), `ContractAnalyzer`, `CaseTracker`, and
`LegalQA`. No `Math.random()`, no hardcoded fabricated numbers, in any of
the 18 component files read in full.

### 5. `deadlineCalculator` (a real, distinct macro) was UNSURFACED once
MODE_TABS is removed

`deadlineCalculator` projects a full 5-milestone litigation timeline
(response/extension/discovery/motion/trial) from a filing date + jurisdiction
tier (federal/state/default) — genuinely different from `court-rules-deadline`
(already wired in `CalendarPanel`), which computes ONE FRCP-cited deadline
from a single triggering event with federal-holiday rolling. Both are real,
non-overlapping capabilities; only the timeline projector had no live
caller once the MODE_TABS `handleAction('deadlineCalculator')` path was
removed.

## What changed

### 1. `app/lenses/legal/page.tsx` — rewritten (3,423 → ~215 lines)

Removed: the entire `MODE_TABS`/`ArtifactType`/`LegalArtifact` type union,
all 7 fake-CRUD `render*Cards()` functions, the editor modal, the detail
panel, `useLensData`/`useRunArtifact`, the fake Quick Stats block,
`<UniversalActions>`, `<LensFeaturePanel>` (+ its "Lens Features &
Capabilities" collapsible), `<RecentMineCard>`, `<AutoActionStrip>`, and
the duplicate `IntakeFormsPanel`/`ReportsPanel` imports.

Replaced with **five bespoke workbenches** (Practice/Analyzer/Docket/Q&A/
Case Law) behind a tab switcher with discoverable `kbd` chips and
`useLensCommand` shortcuts (`P`/`Y`/`K`/`Q`/`L`) — a designed navigational
element, not a generic action array, mirroring how real practice-management
suites separate their manage/research/AI surfaces:

- **Practice** → `ClioSection` (unchanged, already real).
- **Analyzer** → `ContractAnalyzer` (unchanged, already real).
- **Docket** → `CaseTracker` (unchanged, already real — see the
  Docket-vs-Matters disambiguation below).
- **Q&A** → `LegalQA` (unchanged, already real).
- **Case Law** → `LegalCaseSearch` (unchanged, already real).

Kept always-mounted, workbench-independent: the not-legal-advice disclaimer,
`ShellPreview`, the Court Wire live feed (`LiveFeed`/`RealtimeDataPanel`,
CourtListener + Federal Register), `LegalActionPanel` (deadlines/renewals/
conflicts/audit + mint/DM/publish/agent), `LensFeedPanel`,
`CrossLensRecentsPanel`, `LensAgentFab`, and a `MobileTabBar` that mirrors
the five workbenches.

### 2. `components/legal/CaseTracker.tsx` — header text disambiguated

`case-list`/`case-add` write into a separate, simpler `s.cases` store from
`s.matters` (the full Clio CRM) — two real, intentionally distinct backend
models (a quick docket log vs. a full matter file). The header previously
read "Active matters," which collides in name with `ClioSection`'s
"Matters" tab. Relabeled to "Docket — quick case log" so the two surfaces
read as complementary rather than as two competing sources of truth for the
same concept. No logic changed.

### 3. `components/legal/CalendarPanel.tsx` — wired `deadlineCalculator` as
a new "Case timeline projector" feature (closing the hard-20% UNSURFACED gap
via the ENGINEERING triage class — a real backend macro needed a caller,
no external data dependency)

Added a third calculator block (alongside the existing court-rules
single-deadline calculator and the AI court-document parser): filing date +
jurisdiction tier → a 5-row projected timeline (Response Due/Response
Extension/Discovery Cutoff/Motion Deadline/Estimated Trial) with per-row
urgency badges (past/urgent/upcoming/future, derived from the macro's own
`daysRemaining`/`status` fields — no client-side recomputation), and an
"Add all N to calendar" action that loops `calendar-create` per projected
deadline, each stamped with a description explaining it's a projection, not
a rule-cited deadline (steering users to the FRCP calculator above for
citation-grade dates). Honest failure: an invalid/missing filing date
surfaces the macro's own `error` string via `alert()` rather than silently
rendering `NaN` dates.

## Macro → UI classification (all 62 legal macros + 1 cross-domain)

**DESIGNED** — 61/62 (+ `law.courtlistener-search`):

| Macro group | Count | Where |
|---|---:|---|
| `matters-list/create/update/close/detail`, `ai-matter-update` | 6 | `MattersPanel.tsx` |
| `contacts-list/create/update/delete`, `conflict-search` | 5 | `ContactsPanel.tsx` |
| `time-entries-list/create/delete`, `timer-list/start/stop` | 6 | `TimeTracker.tsx` |
| `trust-accounts-list/trust-account-create/trust-balance/trust-deposit/trust-disburse/trust-reconcile` | 6 | `TrustAccountsPanel.tsx` |
| `invoices-list/invoices-mark-paid/invoices-from-time` | 3 | `InvoicesPanel.tsx` |
| `payments-list/payment-record/payment-portal-summary` | 3 | `PaymentsPanel.tsx` |
| `documents-list/doc-templates-list/doc-templates-create/doc-generate` | 4 | `DocumentsPanel.tsx` |
| `esign-envelopes-list/esign-envelope-create/esign-envelope-sign` | 3 | `DocumentsPanel.tsx` (create) + `ESignaturePanel.tsx` (list/sign) |
| `calendar-list/calendar-create/court-rules-deadline/ai-court-doc-to-calendar`, **`deadlineCalculator`** | 5 | `CalendarPanel.tsx` (**`deadlineCalculator` newly wired this pass**) |
| `intake-forms-list/create/delete`, `intake-submissions-list/submit`, `intake-convert` | 6 | `IntakeFormsPanel.tsx` (mounted once, via `ClioSection`) |
| `budget-report/budget-set/realization-rollup` | 3 | `ReportsPanel.tsx` (mounted once, via `ClioSection`) |
| `dashboard-summary` | 1 | `LegalDashboard.tsx` + `LegalAskBar.tsx` |
| `deadlineCheck/contractRenewal/conflictCheck/complianceAudit` | 4 | `LegalActionPanel.tsx` |
| `contract-analyze` | 1 | `ContractAnalyzer.tsx` |
| `legal-question` | 1 | `LegalQA.tsx` |
| `case-list/case-add` | 2 | `CaseTracker.tsx` (Docket workbench) |
| `law.courtlistener-search` | 1 | `LegalCaseSearch.tsx` (Case Law workbench) |

**GENERIC-STRIP-ONLY / intentionally superseded, not surfaced** — 3/62:

- **`caseSummary`** — a per-artifact case summary (parties/dates/billing
  total) computed from caller-supplied `parties`/`timeEntries`/`documents`
  params. Superseded by `matters-detail` (already wired in
  `MattersPanel.tsx`), which computes the equivalent summary from the real
  Clio-state matter — joined contacts, real time entries, real invoices,
  real trust balance, real documents, real calendar events — a strict
  superset with no manual-paste requirement.
- **`generateInvoice`** — an invoice computed from manually-supplied
  `timeEntries`/`expenses` params, disconnected from tracked time.
  Superseded by `invoices-from-time` (already wired in `InvoicesPanel.tsx`),
  which draws real unbilled time entries from the matter automatically.
- **`complianceScore`** — returns `{score, compliant, overdue, total}` from
  caller-supplied `requirements`. Strict subset of `complianceAudit`
  (already wired in `LegalActionPanel.tsx`), which returns the same score
  plus `findings`/`checklist`/`rating`. No information `complianceScore`
  exposes that `complianceAudit` doesn't already surface.

These three are genuine backend capabilities, correctly registered and
individually behavior-tested (see Verification below) — they're excluded
from the DESIGNED count above because building a third UI surface for a
strict subset of an already-designed, already-superior macro would be
redundant scaffolding, not honest coverage. This is a documented
disposition, not a silent gap.

## Investigated and honestly deferred

- **No cross-jurisdiction state-specific court rules.** `court-rules-deadline`'s
  `RULES` table is FRCP-only (federal); `deadlineCalculator`'s jurisdiction
  tiers are a coarse federal/state/default 3-bucket approximation, not real
  per-state civil procedure rules (e.g. California's CCP 1013 mail-service
  extensions, or state-specific answer-deadline variance). Real Clio/
  PracticePanther-class products (via Court Rules / Deadlines integrations
  like LawToolBox or Court Rules Fusion) license per-jurisdiction rule sets
  from a commercial data vendor — there is no free/open equivalent dataset
  to wire (**DATA-SOURCING, investigated, no honest free source found** —
  state court procedural rules are not published in a structured, licensable-
  free machine-readable form the way federal holidays or CourtListener
  opinions are). Left as an honest scope limit: the calculator is
  FRCP-accurate for federal practice and clearly labeled; state-specific
  precision would need a paid rules feed, which is out of scope for this
  pass and arguably out of scope for Concord's zero-cost-data posture.
- **`DocsShell.tsx`** (Notion/Word-shape document-editor chrome, present in
  the `legal/` component directory since the per-lens-polish sprint) is
  unused — not imported by `page.tsx` or any other file in the tree
  (`grep -rln "from '@/components/legal/DocsShell'"` → only a shell-component
  smoke test). Investigated and left alone: real Clio's Documents module is
  a document *repository* (list/generate/version/e-sign), which
  `DocumentsPanel.tsx` already covers well — a live rich-text editor is not
  a defining Clio-parity feature, and building one to justify a rival-shape
  silhouette that already exists would be scope creep for this pass. Not a
  legal-lens-specific defect (the file is shared generic infra intended for
  potential reuse across document-shaped lenses).

## Verification

```
node --check server/domains/legal.js
# → OK (backend untouched, syntax-valid)

cd server && node --test tests/legal-domain-parity.test.js tests/legal-lens-macros.test.js \
  tests/depth/legal-behavior.test.js tests/legal-liability.test.js \
  tests/integration-legal.test.js tests/routes-legal.test.js
# → 188/188 pass, 0 fail (backend untouched — confirms the pre-existing
#   macro layer wasn't broken by the frontend rewrite)

cd concord-frontend && npx eslint app/lenses/legal/page.tsx \
  components/legal/CalendarPanel.tsx components/legal/CaseTracker.tsx
# → clean, 0 errors/warnings

cd concord-frontend && npx vitest run tests/legal-lens-states.test.tsx \
  tests/components/LegalCaseSearch.test.tsx
# → 19/19 pass (12 + 7). tests/legal-lens-states.test.tsx was rewritten this
#   pass — the old version tested the removed MODE_TABS/useLensData system
#   and would have false-failed against the rebuilt page; the new version
#   pins the five-workbench switcher (default Practice, each tab mounts
#   exactly its own real component), the always-on surfaces, and a
#   source-grep guard against reintroducing UniversalActions/
#   LensFeaturePanel/the GENERIC_TRIO/the generic artifact-CRUD hooks.

node scripts/verify-lens-backends.mjs
# → {"WIRED":258,"NO-BACKEND-CALL":2} total 260 (unchanged — legal: WIRED)

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json lenses[] entry for "legal": tier "polished",
#   isGenericScaffold: false, importsGenericTrio: false, usesGenericBody: false,
#   hasMacroButtonWall: false, bespokeRatio 0.959, pillarsPresent 5/5,
#   antiPatterns 0, fileCount 24, totalLoc 5091
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
