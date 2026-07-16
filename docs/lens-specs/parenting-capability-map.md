# Parenting Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/parenting.js` (1,590 LOC) in full — no inline
> `registerLensAction("parenting", …)` calls exist in `server/server.js`
> (confirmed by grep) and no delegate library in `server/lib/` for this
> domain; the file above is the entire backend surface. Classification
> follows the Frontend Rebuild Program's distinction: **DESIGNED** /
> **GENERIC-STRIP-ONLY** / **UNSURFACED**.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("parenting"' server/domains/parenting.js`

## Backend surface — 49 macros, two generations, no stubs

The domain has two distinct layers, both real:

- **Gen 1 — 5 legacy stateless calculators** (`milestoneCheck`,
  `growthPercentile`, `sleepAnalysis`, `routineOptimizer`,
  `immunizationTracker`, all camelCase, all first in the file): each takes
  raw data in `artifact.data` (a free-text `childAge` string like `"2y 3m"`,
  parsed by a regex) and returns a computed result with **no persistence** —
  no child records, no history.
- **Gen 2 — 44 macros, a real Huckleberry-2026-parity baby-care tracker**
  (`STATE.parentingLens`-backed, per-user `Map`s: `children`, `feeds`,
  `sleeps`, `diapers`, `pumps`, `growth`, `milestones`, `meds`,
  `activities`, plus `appointments`/`caregivers`/`timers`/`shareCodes`):
  child profiles, one-touch feed/sleep/diaper/medicine/activity/pumping
  logging, live nursing/sleep timers, WHO Child Growth Standards
  percentiles + full percentile-band charting, CDC "Learn the Signs"
  milestone checklist, a genuine SweetSpot-style nap-window predictor and
  full-day schedule predictor (age-based wake windows chained from the
  child's own logged sleep), weekly trends + anomaly detection, age-targeted
  expert content, appointment scheduling with real RFC-5545 iCalendar
  export, and multi-caregiver share-code sync (one canonical log, several
  caregivers). Plus one real external-data macro, `feed`, that ingests
  CPSC (U.S. Consumer Product Safety Commission) children's-product safety
  recalls as DTUs.

| Macro | Real result shape (key fields) | Classification (before this rebuild) | Classification (after) |
|---|---|---|---|
| `milestoneCheck` | age-banded CDC benchmark completion `{milestoneResults[], overallCompletionRate, assessment}` | **BROKEN** — `ChildBriefPanel` called it with `{childName, ageMonths}`; the handler reads `artifact.data.childAge` (a string) and never saw `ageMonths`, so it always computed against age 0 and returned "Enter child age to assess milestones" regardless of input. The panel also read invented response fields (`expected`/`behind`/`ahead`) that don't exist in the real output, so nothing rendered even on a lucky path. A real "fabricated success" bug — the button showed a green "Milestones loaded." toast every time while computing nothing real | **FIXED — DESIGNED**. `ChildBriefPanel` now builds the `"Xy Ym"` string the handler's regex expects and renders the real `milestoneResults[]`/`assessment`/`overallCompletionRate` shape |
| `growthPercentile` | crude percentile vs. a hardcoded "2-year-old reference point" median, `sex`-only, no per-child persistence | UNSURFACED | **UNSURFACED — honest non-issue.** Gen 2's `growth-percentile` supersedes it entirely (real age-adjusted WHO medians, per-child persisted history) — wiring both would create two conflicting "percentile" numbers for the same child. Not wired; documented why here rather than silently dropped |
| `sleepAnalysis` | generic sleep-debt estimate from a caller-supplied `sleepLogs[]` array, no persistence | UNSURFACED | **UNSURFACED — honest non-issue.** Superseded by Gen 2's `sleep-stats` + `sleep-schedule` + `sweet-spot`, all real per-child, all wired. Same reasoning as `growthPercentile` |
| `routineOptimizer` | age-bracket daily routine template `{stage, suggestedRoutine[], categoryBreakdown}` | **BROKEN** — same param-shape bug as `milestoneCheck` (`ageMonths` sent, `childAge` string expected); silently defaulted to the toddler-stage template regardless of the real age typed in, and the panel read invented fields (`napWindow`/`sleepWindow`/`suggestions`) that don't exist in the real output | **FIXED — DESIGNED**. `ChildBriefPanel` sends the correct `childAge` string and renders the real `suggestedRoutine[]` slot list with `stage`/`newSuggestions`/`categoryBreakdown` |
| `immunizationTracker` | CDC 10-vaccine schedule status `{immunizations[], summary, action}` | UNSURFACED (zero callers anywhere) | **DESIGNED** — new `PgImmunizationsPanel`, "Immunizations" tab. Age auto-derives from the selected child's real birth date; caller checks off vaccines received |
| `child-add`/`child-list`/`child-delete` | child roster CRUD | DESIGNED (`ParentingSection` roster) | DESIGNED — unchanged |
| `feed-log` | logs a feed (nursing/bottle/solid) | DESIGNED (`PgTodayPanel` quick-log) | DESIGNED — unchanged |
| `feed-history` | 7-day feed entry list | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Feeding sub-tab |
| `feed-stats` | today's feed counts by kind + bottle ml + nursing min + last feed | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Feeding sub-tab |
| `sleep-log` | logs a nap/night sleep entry | DESIGNED (`PgSleepPanel`) | DESIGNED — unchanged |
| `sleep-history` | 7-day sleep entry list | DESIGNED (`PgSleepPanel`) | DESIGNED — unchanged |
| `sleep-stats` | naps today, longest stretch, 7-day avg/day | UNSURFACED | **DESIGNED** — wired into `PgSleepPanel` (a real gap found while auditing; it had `sweet-spot` + `sleep-history` but not this) |
| `sweet-spot` | SweetSpot-style predicted next nap window from wake windows + this child's own logs | DESIGNED (`PgSleepPanel`) | DESIGNED — unchanged |
| `diaper-log` | logs a diaper change | DESIGNED (`PgTodayPanel` quick-log) | DESIGNED — unchanged |
| `diaper-history` | 7-day diaper list + today's kind breakdown | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Diapers sub-tab |
| `pump-log` | logs a pumping session (per-caregiver, not per-child — see note below) | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Pumping sub-tab |
| `pump-history` | 7-day pumping session list + today's ml total | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Pumping sub-tab |
| `growth-log` | logs a weight/height/head measurement | DESIGNED (`PgGrowthPanel`) | DESIGNED — unchanged |
| `growth-history` | measurement history | DESIGNED (`PgGrowthPanel`) | DESIGNED — unchanged |
| `growth-percentile` | real age-adjusted WHO-median percentile for the latest measurement | DESIGNED (`PgGrowthPanel`) | DESIGNED — unchanged |
| `growth-chart` | full 3rd/15th/50th/85th/97th WHO percentile-band curve + this child's plotted points | DESIGNED (`PgGrowthChartPanel`) | DESIGNED — unchanged |
| `milestone-checklist` | CDC checklist for the child's current age bracket | DESIGNED (`PgMilestonesPanel`) | DESIGNED — unchanged |
| `milestone-record` | marks a milestone achieved/unachieved | DESIGNED (`PgMilestonesPanel`) | DESIGNED — unchanged |
| `milestone-progress` | cumulative achieved/eligible by category | DESIGNED (`PgMilestonesPanel`) | DESIGNED — unchanged |
| `medicine-log` | logs a medicine dose | DESIGNED (`PgTodayPanel` quick-log) | DESIGNED — unchanged |
| `medicine-history` | 14-day medicine dose list | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Medicine sub-tab |
| `activity-log` | logs an activity (tummy time/bath/play/potty/outdoors/reading/other) | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Activities sub-tab (log form + history) |
| `activity-history` | 7-day activity list | UNSURFACED | **DESIGNED** — new `PgCarePanel`, Activities sub-tab |
| `day-timeline` | today's merged feed/sleep/diaper/medicine/activity timeline | DESIGNED (`PgTodayPanel`) | DESIGNED — unchanged |
| `parenting-dashboard` | today's feed/sleep/diaper summary for the active child | DESIGNED (`PgTodayPanel`) | DESIGNED — unchanged |
| `sleep-schedule` | full-day nap + bedtime window chain predicted from wake windows | DESIGNED (`PgSchedulePanel`) | DESIGNED — unchanged |
| `caregiver-invite`/`-redeem`/`-list`/`-remove` | share-code multi-caregiver sync | DESIGNED (`PgCaregiversPanel`) | DESIGNED — unchanged |
| `timer-start`/`-list`/`-stop`/`-cancel` | live nursing/sleep timers that commit a real log entry on stop | DESIGNED (`PgTimersPanel`) | DESIGNED — unchanged |
| `expert-content` | age-targeted developmental tips | DESIGNED (`PgInsightsPanel`) | DESIGNED — unchanged |
| `trends-insights` | weekly feed/sleep/diaper averages + anomaly flags + sleep trend | DESIGNED (`PgInsightsPanel`) | DESIGNED — unchanged |
| `appointment-add`/`-list`/`-update`/`-delete` | pediatric appointment CRUD | DESIGNED (`PgAppointmentsPanel`) | DESIGNED — unchanged |
| `appointment-ical` | real RFC-5545 `.ics` export with a 24h-ahead `VALARM` reminder | DESIGNED (`PgAppointmentsPanel`) | DESIGNED — unchanged |
| `feed` | ingests CPSC children's-product safety recalls as DTUs | DESIGNED (generic `LensFeedButton`) | DESIGNED — unchanged (was already correctly wired, just buried under the fake CRUD scaffold's footer) |

**Pumping is per-caregiver, not per-child.** `pump-log`/`pump-history`
carry no `childId` in the real handler (`server/domains/parenting.js:723`)
— pumping is tracked once per logged-in user, not once per child. The new
Pumping sub-tab in `PgCarePanel` labels this explicitly instead of
implying it's scoped to whichever child is selected.

**47 of 49 macros are DESIGNED** after this rebuild (up from ~35). The 2
non-designed items (`growthPercentile`, `sleepAnalysis`) are honestly
superseded duplicates, not silent gaps — see their table rows.

## 1.5 Reference-parity checklist

**Reference apps:** [Huckleberry](https://huckleberrycare.com/) (baby
sleep/feed/growth tracker, 5M+ families, "SweetSpot" nap-prediction
feature — the backend code's own doc comment literally says "Huckleberry
2026 parity") and [Cozi](https://www.cozi.com/) (family organizer —
shared calendar, multi-member coordination; the existing
`ChildBriefPanel` doc comment already calls itself "Wonder Weeks / Cozi-
shape"). Researched via WebSearch, 2026-07-09 — not recalled from
training data.

**Parity statement:** for the Huckleberry-shape tracking half, the only
difference should be catalog scale (Huckleberry's 5M-family telemetry vs.
Concord's per-user substrate) and Huckleberry's paid-tier AI sleep-
coaching, nothing else. For the Cozi-shape coordination half, Concord's
scope is deliberately narrower — child-development tracking, not general
household organization — so grocery lists, meal planning, and a general
family calendar are correctly out of scope; only the multi-caregiver
share/coordination angle applies.

| # | Checklist item (source) | Disposition | Justification |
|---|---|---|---|
| 1 | Multi-child profiles | ALREADY REAL | `child-add`/`child-list`/`child-delete` |
| 2 | One-touch feed logging (bottle/nurse/solid) | ALREADY REAL | `feed-log` via `PgTodayPanel` quick-log buttons |
| 3 | Live nursing/sleep timers | ALREADY REAL | `timer-start`/`-stop`/`-cancel`/`-list`, committing a real log entry on stop |
| 4 | Sleep tracking (naps + night) | ALREADY REAL | `sleep-log`/`sleep-history` |
| 5 | SweetSpot-style nap-window prediction | ALREADY REAL | `sweet-spot` — literally named after the Huckleberry feature, computed from age-based wake windows + this child's own logged wake times |
| 6 | Full-day schedule prediction (nap chain + bedtime) | ALREADY REAL | `sleep-schedule` |
| 7 | Diaper tracking with daily breakdown | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | `diaper-log` was wired, `diaper-history` (7-day list + today's wet/dirty/mixed breakdown) was not — now in `PgCarePanel` |
| 8 | Growth tracking with percentiles + chart | ALREADY REAL | `growth-log`/`-history`/`-percentile`/`-chart`, real WHO Child Growth Standards median tables + full percentile-band curve |
| 9 | Milestone tracking (CDC-grounded) | ALREADY REAL | `milestone-checklist`/`-record`/`-progress`, real CDC "Learn the Signs. Act Early." 2022 checklist |
| 10 | Insights / weekly trends with anomaly flags | ALREADY REAL | `trends-insights` — real anomaly detection (today vs. trailing average) + linear sleep-trend classification |
| 11 | Pumping tracking | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | `pump-log`/`pump-history` existed with zero UI callers anywhere — now in `PgCarePanel` (honestly labeled as per-caregiver, not per-child, matching the real data model) |
| 12 | Activity tracking (tummy time, bath, play, etc.) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | `activity-log`/`activity-history` existed with zero UI callers (the day-timeline READ activity entries but nothing could WRITE one) — now in `PgCarePanel` |
| 13 | Medicine/medication tracking | **PARTIAL → COMPLETED THIS SESSION** | `medicine-log` was wired (quick-log), `medicine-history` was not — now in `PgCarePanel` |
| 14 | Vaccine/immunization schedule tracking | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | `immunizationTracker` (real CDC 10-vaccine schedule, computed compliance rate + overdue flags) had zero callers anywhere — now `PgImmunizationsPanel` |
| 15 | Multi-caregiver / shared log access (Cozi angle) | ALREADY REAL | `caregiver-invite`/`-redeem`/`-list`/`-remove` — a 6-character share code puts every caregiver on one canonical log |
| 16 | Personalized expert content by age | ALREADY REAL | `expert-content` |
| 17 | Real calendar export for appointments (Cozi angle) | ALREADY REAL | `appointment-ical` — genuine RFC-5545 `.ics` with a 24h-ahead reminder alarm, arguably stronger than Cozi's in-app-only reminders since it's a portable file any device calendar can import |
| 18 | Paid-tier personalized AI sleep coaching / real-time chat with a sleep expert | GENUINELY MISSING — HONEST, NO FAKE SUBSTITUTE | No dedicated sleep-coach backend exists. The closest real analog, `ChildBriefPanel`'s "Developmental brief (agent)" button (`chat_agent.do`), is a general-purpose agent call, not a specialized sleep-coaching product — it is labeled for what it is (a developmental brief), not oversold as sleep coaching |
| 19 | Shared grocery/to-do lists, meal planner (Cozi core features) | GENUINELY MISSING — OUT OF SCOPE, NOT FLAGGED FOR BUILD | Concord's `parenting` domain is child-development tracking, not general household management; no macro in this domain touches groceries/tasks/meals. Building this would be a different domain entirely, not a parenting-lens gap |
| 20 | General shared family calendar (all events, not just pediatric appointments) | ~~GENUINELY MISSING — SCOPED, DEFERRED~~ **CLOSED (2026-07-16, `10fd710e`)** | New `event-add`/`list`/`update`/`delete`/`ical` macros, structurally cloned from `appointment-*` but with `childId` genuinely OPTIONAL (a family event like "soccer practice" or "school closed" may not belong to any one child, unlike `appointment-add`'s required `childId`) and a broader non-medical category set. Real RFC-5545 export with correct all-day exclusive-DTEND math (mirroring, and sharing two extracted helpers with, `appointment-ical`). New `PgFamilyCalendarPanel.tsx` mounted as a new top-level "Family Calendar" destination tab — not nested inside the child-gated Baby Care section, since a family-wide calendar shouldn't require picking a child first. |

**Coverage summary:** 10 of 20 checklist items ALREADY REAL before this
session; 5 fixed this session (diaper history, pumping, activities,
medicine history, immunizations — all real backend capability that had
zero or partial UI); 1 real integration bug fixed (milestone/routine
calculators were silently computing garbage due to a param-shape
mismatch, not a missing-feature gap — closest to "item 5/6 above,
implicitly," fixed as part of `ChildBriefPanel`); 1 honestly out-of-scope
non-issue (Cozi's household-list features); 2 genuinely missing items
explicitly scoped/deferred with a named reason (AI sleep coaching,
general family calendar). **No silent gaps.**

## 2. What this rebuild changed

**Killed the fake generic CRUD library that was the page's PRIMARY
surface.** `app/lenses/parenting/page.tsx` used to model "Milestones /
Routines / Health / Activities / Growth / Education" as 6 generic
`useLensData`-backed DTU-artifact types (`Milestone`, `Schedule`,
`HealthCheck`, `Activity`, `GrowthRecord`, `LearningGoal`) — free-form
user-typed records with **zero connection to any of the 49 real parenting
macros above**. A caregiver could type a fabricated `percentile`
("e.g. 75th"), `diagnosis`, `medications`, and `vaccinations` into free-
text fields and see them rendered as if they were tracked child-health
records, positioned as the FIRST thing on the page — while the real
WHO-percentile growth chart, the real CDC milestone checklist, and the
real appointment/vaccine tracking sat crammed into a small "Baby Care"
section further down the page. This is exactly the "fabricated success
state presented as real data" pattern CLAUDE.md's honest-by-construction
rule prohibits, and matches the defect class found in every prior Wave 2
batch (supplychain's fake PO library, mentorship's fake match-score
badge). Retired entirely.

**Retired the generic-scaffold dependency**: removed
`ManifestActionBar`, `AutoActionStrip`, `RecentMineCard`,
`CrossLensRecentsPanel`, `UniversalActions`, `LensFeaturePanel`, and the
permanently-dark `useRealtimeLens`/`LiveIndicator`/`RealtimeDataPanel`
trio (confirmed via `grep parenting hooks/useRealtimeLens.ts` — this
domain has no `DOMAIN_EVENTS` entry, so `isLive` was always `false`; a
permanently-dark "live" indicator is its own honesty smell).

**Fixed a real, previously-invisible integration bug in
`ChildBriefPanel.tsx`** (the single most important code-correctness fix
in this rebuild — not fake data, but a real "looks like it worked but
computed nothing real" defect): the panel called `parenting.milestoneCheck`
and `parenting.routineOptimizer` with `{childName, ageMonths}`, but both
handlers read `artifact.data.childAge` as a **string** like `"2y 3m"`
(parsed by a regex) and never look at an `ageMonths` field — so
`milestoneCheck` silently computed against age 0 every single time
(`ageMonths` local var defaulted to 0, `assessment: "Enter child age to
assess milestones"` regardless of what was typed), and `routineOptimizer`
silently defaulted to the toddler-stage template regardless of the real
age. On top of the request-shape bug, the panel's TypeScript interfaces
invented response fields (`expected`/`behind`/`ahead`/`suggestions`/
`napWindow`) that don't exist anywhere in the real macro output, so even a
correct request would have rendered nothing. The net effect: both buttons
showed a green "Milestones loaded." / "Routine optimized." success toast
on every click while doing nothing real underneath — the exact "fabricated
success" shape CLAUDE.md's honest-by-construction rule targets, produced
by an integration bug rather than deliberate fakery. Fixed both the
request shape and the response interfaces/rendering to match the real
macro contracts (verified by reading `server/domains/parenting.js`
directly, not guessed).

**Promoted the pre-existing `ParentingSection` + 10 `Pg*Panel` components
to the page's primary surface.** These were already real, already honest,
already macro-wired (verified by reading all ~1,700 LOC before touching
anything) — 30 of 44 Gen-2 macros were already well covered across 9 tabs
(Today / Timers / Sleep / Schedule / Growth / Milestones / Insights /
Appointments / Caregivers). The rebuild's job was retiring the fake
scaffold around them and closing the remaining coverage gap, not
rebuilding what already worked.

**New `PgCarePanel.tsx`** — a "Care Log" tab with 5 sub-views (Feeding /
Diapers / Activities / Medicine / Pumping) closing the 8 previously-
unsurfaced history/stats/log macros (`feed-history`, `feed-stats`,
`diaper-history`, `pump-log`, `pump-history`, `activity-log`,
`activity-history`, `medicine-history`). Activities and Pumping needed new
log-entry forms (nothing could write those before); the rest are
history/stats reads. Honest loading/empty/error states throughout.

**New `PgImmunizationsPanel.tsx`** — wires `immunizationTracker`, a real
CDC 10-vaccine-category compliance checker that had zero callers anywhere
in the app. Age auto-derives from the child's real birth date (no
re-typing); the caller checks off vaccines already received via real
toggle buttons, and the panel renders the real per-vaccine
completed/overdue/upcoming status + compliance rate + action
recommendation.

**Closed one more real gap in `PgSleepPanel.tsx`**: `sleep-stats` (naps
today, longest stretch, 7-day average) existed with zero callers even
though its sibling `sweet-spot`/`sleep-history` were already wired in the
same panel — added as a stat row.

**New page shell** (`app/lenses/parenting/page.tsx`) — 3 bespoke
destinations (Baby Care / Quick Actions & Brief / Community & Safety)
replacing the old fake 6-tab CRUD library. `1`/`2`/`3` keyboard shortcuts
per destination via `useLensCommand`. Kept `FirstRunTour`, `DepthBadge`,
and `DTUExportButton` (none of these are the flagged generic-scaffold
trio — they're honest, lightweight, degrade-to-no-op substrate
components). `ParentingFeed` (a real, honestly-labeled `reddit ·
top {window}` community pull) and `LensFeedButton` (the real CPSC
child-safety recall feed, which was already correctly wired but buried
under the fake scaffold's footer) both moved into the "Community &
Safety" destination where they honestly belong, next to each other.

## Files touched

- `concord-frontend/app/lenses/parenting/page.tsx` — rewritten (fake CRUD scaffold killed, 3-destination shell)
- `concord-frontend/components/parenting/ChildBriefPanel.tsx` — fixed the milestoneCheck/routineOptimizer request-shape + response-shape bug
- `concord-frontend/components/parenting/ParentingSection.tsx` — added Care Log + Immunizations tabs
- `concord-frontend/components/parenting/PgSleepPanel.tsx` — wired the previously-unsurfaced `sleep-stats` macro
- `concord-frontend/components/parenting/PgCarePanel.tsx` — new; Feeding/Diapers/Activities/Medicine/Pumping history+log sub-views
- `concord-frontend/components/parenting/PgImmunizationsPanel.tsx` — new; wires `immunizationTracker`

No backend changes — every macro used above already existed and worked
correctly in `server/domains/parenting.js`; this was a pure frontend-shell
rebuild plus one frontend-side integration-bug fix.

## Tests

No existing test file references the `parenting` lens's behavior —
confirmed via `grep -rl "parenting" tests/ __tests__/` (repo-wide) and a
file-name search for `*parenting*.test.*`/`*parenting*.spec.*`. The only
hit, `tests/lens-e2e/lens-list.ts`, is a generic `{id, name, path}` lens
directory entry unaffected by this rebuild (same id, same path). No test
needed updating; none was added, since the rebuild program's Wave 2 scope
for this lens is the frontend shell + capability audit, not new test
authoring.
