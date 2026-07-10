# Government Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("government"' server/domains/government.js
```
→ **75** macros in `server/domains/government.js` (1,584 lines → grown by this
pass; see below). No inline `register("government", ...)` in `server.js`
(`grep -c 'register("government"' server/server.js` → 0) — this domain has
no invisible second registration site.

`node scripts/lens-unsurfaced.mjs --lens government` → `7/75 macros never
referenced in the frontend`: `permits-approve`, `permits-deny`,
`permits-issue`, `permits-pay-fee`, `meetings-set-agenda`,
`notifications-emit`, `open-data-ingest`. **4 of these 7 are a false
positive** — the script only greps for a literal `action: '<name>'` string;
`components/government/PermitsPanel.tsx` calls them via a template literal
(`action: \`permits-${act}\``, `act` ∈ `pay-fee|approve|issue|deny`), which
the static check can't see. Verified by reading the component: all four are
genuinely wired with a real status-machine UI (pay fee → approve → issue,
or deny at any pre-terminal state). **The other 3 were genuinely dark** and
are fixed below (`meetings-set-agenda`, `notifications-emit`,
`open-data-ingest`).

## The lens is actually two systems

1. **The real civic-services backend** (55 kebab-case macros, `ensureGov
   Bucket`-backed per-user state) — permits, service requests (311),
   departments + routing rules, inspections, infrastructure assets, open-
   data search, payments/fines, meetings, voter registration/elections,
   advocacy, document library + e-signatures, case-status notifications,
   dashboard summary. Surfaced by 22 of the 24 components (all mounted
   from `app/lenses/government/page.tsx`'s `CivicWorkbenchSection` +
   `MODE_TABS` MyReps/Bills/CivicAlerts/FOIA/Budget branches). This is a
   genuinely deep, well-designed civic-tech product — reference apps:
   **SeeClickFix / Accela** (311 + permitting), **Legistar/Granicus**
   (meeting agendas + minutes), **FOIA.gov / MuckRock** (records requests),
   **Resolve/OpenGov** (municipal budget transparency). Read all 24
   components in full for this pass; found zero fabrication signatures
   (`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" components/
   government/*.tsx app/lenses/government/page.tsx` → empty) and no dead
   creation paths — every list has a real create form.
2. **A legacy generic-artifact case-management module** (16 macros:
   `permitTimeline`/`violationEscalation`/`resourceStaging`/`retentionCheck`
   plus 12 snake_case macros `budget_report`/`citizen_impact_report`/
   `compliance_check`/`docket_report`/`export_record`/
   `fee_collection_status`/`fine_calculation`/`milestone_update`/
   `permit_fee_estimate`/`permit_inspection_schedule`/`redaction_review`/
   `schedule_hearing`) that reads/writes generic `Permit`/`Project`/
   `Violation`/`EmergencyPlan`/`Record`/`CourtCase` artifacts created by
   `GovernmentLensPage`'s own ~3,000-line bespoke editor/dashboard/detail
   system (`renderFormFields`, `handleAction` → `useRunArtifact`). This is
   NOT a fabricated parallel system (every one of the 16 macros is real,
   and the code's own comment at `government.js:1472` says they were built
   specifically "to surface the dashboard buttons that previously hit no
   macro") — but it IS a field-shape mismatch problem: the macros were
   written against field names (`applicationDate`, `zones[]`,
   `retentionPeriod`, structured `requirements[]`/`fees[]`/`hearings[]`
   arrays) that the actual editor form never captures (it captures
   `submittedDate`, a single `zone` string, `retentionYears`, and has no
   multi-entry checklist/fee/hearing UI at all). Every real click through
   this system silently degraded to a null/default/misleading result.

## What changed

### 3 genuinely unsurfaced macros — wired

- **`meetings-set-agenda`** — `MeetingsPanel.tsx` could only set an agenda
  once, at scheduling time; there was no way to amend it afterward (a
  routine civic workflow). Added an "Edit agenda" toggle in the expanded
  meeting view, calling the real macro.
- **`notifications-emit`** — automatic status-change notices already fire
  from the permit/service-request/fine/court-case macros themselves (they
  call the shared `queueGovNotification` helper directly, 5 call sites);
  this is the separate, staff-composed **manual** update
  ("inspection rescheduled due to weather") that had zero UI. Added a
  "Send a manual case update" composer to `NotificationsPanel.tsx`.
- **`open-data-ingest`** — a real Wave-1 shared primitive
  (`docs/NEXT_ARC_PLAN.md`'s "provenance-stamped ingest"): fetches ONE
  real data.gov record and wraps it in a C2PA-style provenance-stamped
  envelope (sourceUrl + contentSha256 + fetchedAt), ready for `dtu.create`.
  `OpenDataExplorer.tsx` only ever rendered search results with no way to
  turn one into a citable DTU. Added an "Ingest as DTU" button per result
  that calls `open-data-ingest` then `dtu.create`, using only the real
  fetched record fields (title/organization/notes/resource URL) plus the
  real provenance stamp — no invented content.

### The legacy case-management module — field-shape fixes (not a rebuild)

Rather than build a second bespoke multi-entry UI for a module the real
civic-services system already supersedes for its live workflows, this pass
made the 16 macros read the field names the actual generic editor produces
(additive aliasing — every existing test's original field names still work):

- **`permitTimeline`** — aliases `submittedDate` (the real field) for
  `applicationDate`; lowercases `type` before the benchmark lookup (the
  editor stores "Building", the lookup table keys are lowercase — was
  silently falling to the 21-day generic benchmark for every real permit).
- **`retentionCheck`** — aliases `retentionYears`/`filedDate` (the real
  fields) for `retentionPeriod`/`date`. Previously always used the
  hardcoded 7-year default and the artifact's creation timestamp, ignoring
  whatever the user actually entered.
- **`resourceStaging`** — falls back to the real single `zone` string +
  flat `resources: string[]` the EmergencyPlan editor produces when no
  structured `zones[]` array is supplied (an explicit array, e.g. from an
  API/MCP caller, still works exactly as before).
- **`budget_report`** — falls back to the real flat `budget`/`spent`
  numbers when there's no itemized `lineItems[]` array (the Public Works
  editor has no line-item repeater UI). Previously `spent` was hardcoded 0
  whenever a user just filled in the two number fields directly.
- **`citizen_impact_report`** — **honesty fix**, not just aliasing: the
  editor only has a free-text "Citizen Impact Assessment" field, never a
  numeric population/area count. Previously an artifact with zero impact
  data silently reported *"affects ~0 residents... [low]"* — a false-
  precision claim. Now reports `affectedPopulation: null`,
  `severity: "unspecified"`, and surfaces the real narrative text instead.
- **`compliance_check`** — **honesty fix**: the Code Enforcement editor has
  no checklist-building UI, so every real violation has zero `requirements`.
  Previously this defaulted to `compliant: true, verdict: "compliant"` — a
  false-positive clearance nobody actually verified. Now reports
  `verdict: "unchecked"`, `compliant: null` when nothing was checked.
- **`fee_collection_status`** — aliases the real flat `feesCollected`/
  `feesOwed` (Court Admin editor) instead of a `fees[]` array that editor
  never produces. **Honesty fix**: zero fee records now reports
  `"no_fees_on_record"` instead of defaulting to `"paid_in_full"`.
- **`permit_fee_estimate`** — lowercases `permitType` before the fee-table
  lookup (was silently falling to the $100 generic base fee for every real
  Title-Case permit type).
- **`schedule_hearing`** — lowercases + first-word-matches `caseType`
  (the editor's two-word labels like "Zoning Violation" wouldn't match the
  single-word lookup table); falls back to `plaintiff`/`defendant` for
  `parties` when no generic `parties[]` array is present (CourtCase has no
  such array field).
- **`redaction_review`** — **honesty fix** with real safety stakes: the
  Public Records editor's free text is `description` (`reviewNotes`/
  `notes`/`redactionNotes` on other types), never `content`/`body`.
  Previously every real FOIA record scanned an empty string and always
  reported `status: "clean" — "Cleared for public release"` without the
  inline-PII scan ever running on the record's actual text. Now scans all
  the real free-text fields.
- **Left as reasonable, non-misleading defaults (no change):**
  `docket_report` (empty hearings → honestly "0 hearings, no next hearing",
  not a false claim), `export_record` (field-name-agnostic by design —
  dumps whatever exists, already correct for any type), `fine_calculation`
  (base fine correctly reads the real `fineAmount`; the late-fee portion
  degrades to $0 when no day-count field exists, which under-states rather
  than over-states a fine — the safer default), `milestone_update`
  (correctly reads the real `milestones[]`; `currentMilestone` starts from
  0 when unset, a reasonable default), `permit_inspection_schedule`
  (defaults to the first inspection stage when none recorded — reasonable).

## Verification

- `server/tests/depth/government-behavior.test.js` — 13 new tests pinning
  every alias/fallback/honesty fix above (each references "Wave 3 fix" or
  "Wave 3 honesty fix" in its title for grep-back), all existing tests
  (which use the macros' original field names directly) still pass
  unmodified.
- `server/tests/government-domain-parity.test.js`,
  `server/tests/depth/government-dashboard-behavior.test.js`,
  `server/tests/lens-actions.test.js` — all still green (112 total across
  the 4 files).

## Left alone, with reason

- **The 22-of-24 components covering the real civic-services backend** — no
  defect found; every macro call site matches the backend's real shape.
- **`CityGovShell.tsx`** — the government lens's rival-shape silhouette
  (mounted via the shared `ShellPreview` component, also used by 15 other
  lenses); its own header comment states all props come from real macros
  (`dashboard-summary` + `service-requests-list` + `permits-list` +
  `assets-list`), confirmed by reading it — no fabrication.
- **The legacy generic-artifact editor/dashboard itself** (the ~3,000-line
  `renderFormFields`/`renderDashboard`/detail-view machinery in
  `page.tsx`) — left structurally as-is. It's a real, working CRUD system
  (create/edit/delete round-trips through `useLensData`) with a large,
  detailed field set per type; the fix here closed the gap between its
  real captured fields and the 16 analysis macros' expectations, not a
  rebuild of the editor itself.
