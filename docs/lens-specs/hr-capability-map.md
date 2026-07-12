# HR Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 7, Docs/B2B SaaS archetype)

Reproduce the macro count:
`grep -c 'registerLensAction("hr"' server/domains/hr.js` → **63** (was 56 before the 2026-07-12 I-9/E-Verify closure added 7 macros)

## Reference apps + parity target

- **BambooHR** — the canonical small/mid-market HRIS: employee directory +
  org chart, time-off requests/balances/approvals, onboarding checklists,
  performance reviews + goals, an applicant-tracking pipeline, benefits
  enrollment, and workforce reports (headcount, turnover, comp bands).
- **Rippling** — the modern "one system of record" competitor that folds
  payroll (real federal-bracket withholding, pay stubs), time & attendance
  (a physical/virtual time clock), and compliance/learning management into
  the same HRIS, plus an employee self-service portal.
- **Parity target, in the owner's framing:** the only difference between
  this lens and BambooHR/Rippling should be the size of the employee
  roster and the absence of real bank-rail money movement (no ACH/direct
  deposit exists here, or should) — every *workflow* BambooHR/Rippling
  ship (records, time off, onboarding, performance, recruiting, benefits,
  payroll math, time clock, learning, compliance, self-service, analytics)
  should be a real, designed feature over this lens's own STATE-backed
  substrate, not a demo.

## Audit finding: the entire HRIS was already real and comprehensive — it was buried behind a duplicate fake-CRUD scaffold

Before this pass, `concord-frontend/app/lenses/hr/page.tsx` (448 lines) ran
**two parallel systems that never touched each other**:

1. **The real HRIS** — three purpose-built, macro-wired components already
   existed and were already mounted on the page: `HrHrisSection` (an
   11-tab workbench: People / Time Off / Payroll / Benefits / Time Clock /
   Performance / Training / Compliance / Recruiting / Analytics /
   Self-Service, each tab a real panel calling real macros —
   `employee-add/list/update/detail/offboard`, `org-chart`,
   `headcount-report`, `timeoff-request/list/approve/balance`,
   `payroll-run/list/stub` with genuine 2024 federal-bracket withholding +
   FICA, `benefit-plan-add/list`, `benefit-enroll/enrollment-list/waive`,
   `clock-in/out`, `review-create/list`, `goal-set/list/update-progress`,
   `job-post/list`, `applicant-add/advance/list`, `course-add/list/assign/
   progress`, `compliance-doc-add/list/acknowledge/status`,
   `self-service-summary/update`, `workforce-analytics`, `hr-dashboard`),
   `HrActionPanel` (a people-ops calculator desk for the four pure-compute
   macros — `compensationBenchmark`, `turnoverAnalysis`,
   `interviewScorecard`, `ptoBalance` — plus mint/DM/publish/agent
   actions), and `BlsSeriesExplorer` (real live US Bureau of Labor
   Statistics series via `bls-series-lookup`, six curated presets:
   unemployment, labor-force participation, nonfarm payrolls, average
   hourly earnings, CPI, JOLTS job openings).
2. **A fully disconnected generic-CRUD scaffold** stacked around and on
   top of that real work — seven `MODE_TABS` (Employees / Recruiting /
   Onboarding / Performance / Benefits / Compliance / Training) each
   backed by `useLensData('hr', <ArtifactType>, { seed: [] })`, a fake
   "employee" data model (`name/type/status/description/notes/
   department/position/salary/hireDate/manager/email/benefitType/
   duration`) with its own create/edit modal, its own search/filter, its
   own "Dashboard" toggle computing a fabricated payroll total and
   "Pending Reviews" count from that fake store — plus the generic
   `ManifestActionBar` + `UniversalActions` + `LensFeaturePanel` +
   `AutoActionStrip` scaffold trio. None of this ever called a single one
   of the 56 real HR macros; it was a second, parallel, empty HR system
   sitting in front of the real one. The honest grader confirmed the
   shape precisely: `bespokeRatio: 0.852` (85% of the lens's code was
   already real, designed, macro-wired panel work) yet `tier: "functional"`
   / `isGenericScaffold: true`, because the page itself was still the
   generic template with the trio + generic body imported.

This is the exact defect class this wave has found repeatedly: real depth
sitting disconnected behind fabricated data/generic scaffold, not a
missing-backend problem.

## What this rebuild changed

- Deleted the entire fake-CRUD system from `page.tsx`: `MODE_TABS`,
  `ArtifactType`/`HRArtifact`, `STATUS_CONFIG`, `DEPARTMENTS`,
  `BENEFIT_TYPES`, `useLensData`/`useRunArtifact`, `renderDashboard`/
  `renderEditor`/`renderLibrary`, the fabricated stat cards, and the
  fabricated department-headcount bar (which read the fake store, not
  `department-list`/`headcount-report`).
- Removed the generic scaffold: `ManifestActionBar`, `UniversalActions`,
  `LensFeaturePanel` (and its show/hide toggle), `DraftedTextarea` (only
  used by the deleted fake editor).
- Rebuilt the page as a clean shell around the three real sections that
  already existed: `HrHrisSection` (People Hub), `HrActionPanel`
  (People-Ops Calculators), `BlsSeriesExplorer` (Labor Market Data), plus
  a real header (title/subtitle/live indicator/DTU export) and
  `RealtimeDataPanel`. Kept `RecentMineCard`/`AutoActionStrip`/
  `CrossLensRecentsPanel` at the bottom (real cross-lens recent-activity
  feeds, not the generic scaffold — `AutoActionStrip` alone doesn't trip
  `isGenericScaffold`, which requires the full trio + the generic body).
- Added three real keyboard shortcuts (`g p` / `g c` / `g w`) that scroll
  to each section — a genuine navigation affordance replacing the old
  dead `/`-focus-search binding (the search input it focused no longer
  exists; it belonged to the deleted fake library).
- No backend changes — `server/domains/hr.js` was untouched; every macro
  was already real.

## Reference-parity checklist

| # | Capability (BambooHR/Rippling) | Disposition |
|---|---|---|
| 1 | Employee directory + profile detail | **ALREADY REAL** — `HrPeoplePanel` via `employee-add/list/update/detail` |
| 2 | Org chart (manager/report tree) | **ALREADY REAL** — `org-chart` macro, rendered in People panel |
| 3 | Headcount / department reporting | **ALREADY REAL** — `department-list`, `headcount-report` |
| 4 | Time-off requests + approval workflow | **ALREADY REAL** — `HrTimeOffPanel` via `timeoff-request/list/approve` |
| 5 | PTO balance / accrual tracking | **ALREADY REAL** — `timeoff-balance` + standalone `ptoBalance` calculator in `HrActionPanel` |
| 6 | Onboarding checklists per employee | **ALREADY REAL** — `onboarding-task-add/list/complete` (in `HrHrisSection`'s dashboard stat + People panel flows) |
| 7 | Performance reviews (rating + summary) | **ALREADY REAL** — `HrPerformancePanel` via `review-create/list` |
| 8 | Goals / OKRs with progress tracking | **ALREADY REAL** — `goal-set/list/update-progress` |
| 9 | Structured interview scorecards | **ALREADY REAL** — `interviewScorecard` in `HrActionPanel` (rubric-dimension scoring → hire/no-hire recommendation) |
| 10 | Applicant tracking pipeline (stages) | **ALREADY REAL** — `HrRecruitingPanel` via `job-post/list`, `applicant-add/advance/list` with stage counts |
| 11 | Benefits plan catalog + enrollment | **ALREADY REAL** — `HrBenefitsPanel` via `benefit-plan-add/list`, `benefit-enroll/enrollment-list/waive` with coverage-tier cost math |
| 12 | Payroll runs with real tax withholding | **ALREADY REAL** — `HrPayrollPanel` via `payroll-run/list/stub`, genuine 2024 federal-bracket + FICA + flat-state-tax computation, not a placeholder number |
| 13 | Time clock (punch in/out, hours) | **ALREADY REAL** — `HrClockPanel` via `clock-in/out`, `timeclock-list` |
| 14 | Learning/training assignments + completion | **ALREADY REAL** — `HrLearningPanel` via `course-add/list/assign/progress` |
| 15 | Compliance document acknowledgment tracking | **ALREADY REAL** — `HrCompliancePanel` via `compliance-doc-add/list/acknowledge/status` with org-wide compliance % |
| 16 | Employee self-service portal | **ALREADY REAL** — `HrSelfServicePanel` via `self-service-summary/update` (profile, PTO, benefits, paystubs, courses, goals in one read-only view + contact-only self-edit) |
| 17 | Workforce analytics (tenure, comp bands, dept mix) | **ALREADY REAL** — `HrAnalyticsPanel` via `workforce-analytics` (tenure distribution, salary quintiles, department payroll) |
| 18 | Compensation benchmarking vs. market | **ALREADY REAL** — `compensationBenchmark` in `HrActionPanel` (role/location-scaled median + range) |
| 19 | Turnover-rate analysis vs. benchmark | **ALREADY REAL** — `turnoverAnalysis` in `HrActionPanel` |
| 20 | Real external labor-market data (not synthetic) | **ALREADY REAL** — `BlsSeriesExplorer`, live US BLS public API series (unemployment, CPI, JOLTS, etc.) — this exceeds most HRIS products, which pay for third-party comp data (Radford/Mercer) rather than pulling it live |
| 21 | ACH/direct-deposit payroll disbursement | **GENUINELY MISSING — honest relabel.** `payroll-run` computes real gross/withholding/net figures and persists pay stubs; it does not move real money to a bank. This is a money-transmission integration (Plaid/Stripe Treasury-class), explicitly out of scope for a compute-and-record HRIS layer per this codebase's existing earned/withdrawal money-transmitter posture (`CLAUDE.md` §"Earned-only, 48-hour-held CC withdrawals"). No UI implies otherwise — `payroll-run` results are labeled "pay run" records, never "deposited." |
| 22 | I-9 / E-Verify employment-eligibility compliance | ~~**GENUINELY MISSING — flagged as a scoped future build.** Would need a dedicated `hr.i9-verify` macro + a document-upload path; roughly a 1-domain-file, ~150-LOC addition following the existing `compliance-doc-*` pattern. Deferred; no fabricated compliance status exists in its place today.~~ **CLOSED (2026-07-12, `99238750`)** — 7 new macros follow the `compliance-doc-*` shape exactly (workspace-scoped `Map`, `hrClean`/`hrDay`/`hrId` helpers, explicit-enum validation instead of silent defaulting): `i9-add` (real USCIS Form I-9 document categories — US passport / permanent resident card / EAD / driver's-license+SSN-card / state-ID+SSN-card / foreign-passport+I-94 / other; documents that always expire, e.g. an EAD, require an `expirationDate` at intake), `i9-list` (per-employee or org-wide, with a lazy expiration sweep that flips past-due `verified`/`pending` records to `expired` and persists it), `i9-verify` / `i9-reject` (status-transition guarded — can't verify a rejected or expired record, can't double-reject), `i9-everify-submit` (validated E-Verify status enum; a `final_nonconfirmation` cascades the I-9 record to `rejected`, matching the real-world consequence), `i9-document-attach` (reuses the existing `hr-document-add` metadata-record store — kind `"i9_support"` — rather than a parallel upload pipeline, per this domain's document-tracking convention of no binary storage layer), and `i9-status` (org-wide `compliancePct`/`missing`/`overdue` — "overdue" follows the real 3-business-day I-9 Section-2 deadline, approximated as 3 calendar days and documented as such). Wired into `HrCompliancePanel` as a real designed sub-section (org-wide stat tiles, a structured intake form with a document-type `<select>`, a per-record roster with status badges + inline Verify/Reject/E-Verify/Attach actions) — not a new disconnected page, not a generic action list. 13 new backend behavioral tests in `server/tests/hr-domain-parity.test.js` (creation, invalid-document-type rejection, EAD-requires-expiration validation, pending→verified/rejected transitions, reject-a-rejected-record rejection, expiration sweep, E-Verify enum validation, final-nonconfirmation cascade, document-attach linking, org-wide + per-employee status, per-user isolation) plus 6 new frontend tests in `concord-frontend/tests/hr-compliance-i9.test.tsx` (summary strip, roster rendering, Track-I-9 wiring, Verify wiring, Reject wiring, error-surfacing). |
| 23 | External job-board syndication (LinkedIn/Indeed) | **GENUINELY MISSING — flagged as a scoped future build.** `job-post` creates an internal posting; there is no outbound connector to a real job board. Would be a `connectorFetch`-chokepoint addition following the Gmail/Calendar connector pattern in `docs/CONNECTORS_GO_LIVE.md`. Deferred, not faked — `job-list` never claims external distribution. |

**Coverage: 21 of 23 checklist items ALREADY REAL (item 22 closed 2026-07-12), 0 BACKEND-CAPABLE-BUT-UNSURFACED (everything real was already surfaced), 2 GENUINELY MISSING with explicit honest dispositions (no fabrication in their place).**

## Verification

- `npx eslint app/lenses/hr/page.tsx components/hr/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (3 pre-existing errors in `components/queue/*.tsx` belong to a concurrent sibling batch, untouched by this pass).
- `npx vitest run tests/hr-lens-states.test.tsx` — 5/5 passing, unchanged (it targets `HrActionPanel` directly, which this pass didn't modify).
- `node scripts/verify-lens-backends.mjs` — `hr` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `hr`: was `tier: "functional"` / `isGenericScaffold: true`; now `tier: "polished"` / `isGenericScaffold: false` (`bespokeRatio` up to `0.961`, `pageLoc` down from 449 to 104).
