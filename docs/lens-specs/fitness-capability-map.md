# Fitness Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("fitness"' server/domains/fitness.js   # → 69
grep -n 'registerLensAction("fitness"' server/server.js            # → 0 (no inline dup registrations)
```

69 macros in `server/domains/fitness.js` (2,252 lines), two distinct clusters:

- **6 legacy coaching-calc macros** (`progressionCalc`, `classUtilization`,
  `bodyCompReport`, `attendanceReport`, `periodization`, `recruitProfile`) —
  pure formula handlers over a generic per-lens artifact store
  (`useLensData('fitness','artifact')`). The artifact store itself is a real,
  bespoke personal-trainer / gym-management CRM data model (Client / Program /
  Workout / Class / Team / Athlete types), not a raw-JSON generic form: a real
  workout builder (sets/reps/weight/RPE/superset), a periodization cycle
  planner (macro/meso/micro-cycle + training blocks), a class schedule
  calendar with day/time grid + revenue math, a team roster + season
  schedule, and a staged recruiting pipeline.
- **63 STATE-backed Strava/Garmin/Whoop/Apple-Fitness+ parity macros** —
  workout logger (`workout-list`/`workout-save`), HR zones (Tanaka/Fox/
  Karvonen), recovery (`recovery-history`), activity rings
  (`activity-summary`), a deterministic AI workout-plan generator
  (`workout-plan-generate`/`generate-program`, opt-in LLM enhancement),
  activities CRUD + kudos + comments + photos, segments + leaderboards +
  PR/CR detection, routes with climb-difficulty rating, training load
  (Banister CTL/ATL/TSB), VO2max (Daniels/Gilbert VDOT) + race predictor,
  HRV log/status, training readiness, body battery, goals, personal records,
  gear mileage/wear, clubs, challenges, a dashboard aggregate, real GPS
  recording + GPX import + haversine track summarization + activity heatmap,
  wearable link/sync (Apple Health / Garmin / Fitbit / Whoop), live-share
  "Beacon", a training-plan calendar with adaptive rescheduling, a
  fitness-and-freshness trend, and a real external-API feed
  (`feed` — ingests real exercises from the open wger workout database as
  DTUs, free public API, no key).

## Reference apps

**Strava** (activities/kudos/comments/photos/segments/leaderboards/routes/
clubs/challenges/heatmap/live Beacon) + **Garmin Connect** (training load,
body battery, VO2max, race predictor) + **Whoop** (recovery score/HRV/
strain) + **Apple Fitness+** (activity rings) + a **TrainingPeaks**-style
training-plan calendar — plus a distinct **Trainerize/TrueCoach**-style
personal-trainer CRM (clients/programs/classes/teams/recruiting) layered on
the same lens, since the backend genuinely supports both product shapes.
Parity target: the only difference should be catalog/network scale (no
Strava-scale social graph, no real map-tile provider — `MapView` is a
dependency-free SVG plot, not Mapbox) and live-hardware access (GPS/HRV/HR
require a real device or browser Geolocation permission) — never missing
capability.

## Classification (before this pass)

**Already unusually strong.** Every one of the 17 `components/fitness/*.tsx`
files was read in full. Unlike most Wave-2/3 lenses audited so far, this one
carries explicit honesty comments throughout (`fitness.js`: "No synthetic
Whoop-style data is fabricated", "never invented"; every Strava panel has
real loading/error/empty/populated states with a working Retry) — clear
evidence of a prior deep rebuild pass, just not one recorded in
`docs/FRONTEND_REBUILD_PROGRAM.md`'s ledger. **64 of 69 macros (93%) were
already genuinely wired** to real, bespoke, non-generic UI before this pass.
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem"` across the lens
returns zero hits. Even so, three real defects and one real coverage gap
were found by reading every render path against the actual macro contracts
(the same method the film-studios/reflection/history audits used):

1. **Fabricated data (zero-demo-content violation).** `app/lenses/fitness/
   page.tsx` had a "Daily Tracker" toggle mounting three components —
   `WorkoutStreakCounter` (hardcoded `useState(7)` streak / `useState(14)`
   best streak / a fixed weekday-active boolean array), `DailyGoalsRings`
   (hardcoded Steps 7432/10000, Calories 1840/2500, Minutes 38/60 — no
   macro call at all), `ExerciseSetTracker` (a scratch-pad with hardcoded
   starting sets, never persisted) — presented as live personal data
   directly beside the REAL equivalents one tab over: `ActivityRings`
   (genuinely calls `activity-summary`) and `WorkoutLogger` (genuinely calls
   `workout-list`/`workout-save`). Classic duplicate-fake-next-to-real
   pattern this program has found repeatedly elsewhere.
2. **Silent no-op quick actions.** The page's "Quick Actions" bar has 4
   buttons (`progressionCalc`, `generate-program`, `bodyCompReport`,
   `attendanceReport`); the "Action Result" panel below only had render
   branches for `progressionCalc`'s shape (plus two others reachable from
   elsewhere, `classUtilization`/`recruitProfile`/`periodization`). Clicking
   "Generate Program", "Body Comp Report", or "Attendance Report" ran the
   real macro successfully but rendered nothing — a real, previously
   undetected bug, not fabricated data, but the same user-facing symptom
   (click does nothing trustworthy).
3. **Broken macro-call contracts in `WorkoutFinishPanel.tsx`** (a real,
   bespoke "finish workout → analyze/save/share" surface, 7 real actions).
   Three of the seven called the right macro with the wrong shape:
   - **Progression** sent `{lifts}` (the macro reads
     `artifact.data.exercises`, a flat `{name,weight,reps,rpe}` row per
     exercise) and read the response as `.suggestions`/`.lift`/`.suggestion`
     (the macro returns `.recommendations` with `exercise`/`currentWeight`/
     `currentRPE`/`recommendedWeight`/`recommendation`). Always computed
     against an empty exercise list and always rendered nothing.
   - **HR zones** sent `{avgHr}` (the macro reads `restingHr`, never
     `avgHr`) and read zones as `z.range` (the macro returns `z.lowBpm`/
     `z.highBpm`/`z.name`, no `range` field). Always rendered a blank range
     per zone card.
   - **Save workout** sent `{title, lifts, finishedAt, notes}` as flat
     top-level fields; the macro requires `params.workout` — a single
     object with an `.id` — and returns `{id}`, not `{workoutId}`. This
     button was **completely non-functional**: every click returned
     `"workout payload required"`. Even a naive fix (just adding the
     `workout` wrapper) would have written a shape incompatible with what
     `WorkoutLogger`'s `workout-list` reader expects
     (`{id,title,startedAt,finishedAt,exercises:[{id,name,sets:[{reps,
     weight,rir,done}]}]}`), silently corrupting the shared saved-workout
     list the two components read from the same STATE map.
   All three now match the real contract exactly (verified against
   `server/tests/fitness-lens-macros.test.js`'s pinned shapes — see
   Verification below); Progression derives one row per lift from its
   heaviest completed set, converting logged RIR → RPE via the standard
   `RPE = 10 − RIR` convention (a real derivation, not a fabrication); Save
   now writes the exact `WorkoutLogger`-compatible shape.
4. **Genuine coverage gap — `fitness-dashboard` had zero UI caller.** The
   macro aggregates exactly the "how's my week going" view (this-week
   totals, training load, goals completed, gear needing replacement,
   all-time totals) in one call, but no panel ever mounted it — a user had
   to visit Activities, Training, and Goals tabs separately to answer that
   question. Built and wired (see "What changed").

## Remaining unsurfaced macros — 5 of 69 (down from 6), every one dispositioned

- **`activity-detail`** — **correctly redundant.** `activity-list` already
  returns each activity's full stored object (pace/duration are re-derived
  client-side from the same `paceSecPerKm`/`durationSec` fields
  `activity-detail` would also return). The one genuinely extra field,
  `splitAnalysis`, is unreachable at the *data* layer today: no create path
  (`activity-create` or `gps-record`) ever populates `act.splits`, so the
  macro's split-analysis branch never fires regardless of UI. Not a
  frontend gap — a backend-data gap, out of this pass's scope.
- **`activity-comments`** — **correctly redundant.** `activity-list`/
  `activity-kudos`/`activity-comment-delete`/`activity-photo-add`/`-remove`
  already return the full `comments`/`photos`/`kudos` arrays on every call;
  `StravaActivitiesPanel`'s expandable comment/photo thread never needs a
  separate read-only fetch.
- **`gps-track`** — **BACKEND-CAPABLE-BUT-UNSURFACED, genuinely missing UI.**
  `StravaGpsPanel` only shows the aggregate heatmap (`activity-heatmap`); it
  never lets you open one past GPS-recorded activity and see its own route.
  Scoped follow-up: a "View route" affordance on GPS-sourced activities
  (`activity.hasGps`/`source==='gps_recording'|'gpx_import'`) rendering
  `gps-track`'s point list through the existing `MapView` component —
  ~40-60 LOC, no new dependency.
- **`beacon-list`** — **BACKEND-CAPABLE-BUT-UNSURFACED.** `StravaBeaconPanel`
  keeps the active beacon in local component state only (a page refresh
  loses the share token of an in-progress beacon) and "Follow a Beacon"
  requires manually pasting a token with no way to browse beacons you're
  already following. `beacon-list` (`mine`/`following`) would fix both.
  Scoped follow-up: ~30-40 LOC.
- **`plan-session-move`** — **BACKEND-CAPABLE-BUT-UNSURFACED.**
  `StravaPlanPanel` supports bulk-rescheduling every missed session
  (`plan-reschedule`) but not moving one specific still-upcoming session to
  a different date. Scoped follow-up: an inline date-edit affordance per
  session card, ~20-30 LOC.

These four (`gps-track`/`beacon-list`/`plan-session-move`, plus the two
correctly-redundant ones) were deliberately left as documented, scoped
deferrals rather than built in this pass — the confirmed fabrication +
integration-bug fixes above were the load-bearing findings; these are real
but secondary polish gaps on an otherwise-complete surface.

## What changed

- **`concord-frontend/app/lenses/fitness/page.tsx`** — removed
  `WorkoutStreakCounter`, `DailyGoalsRings`, `ExerciseSetTracker` (100%
  fabricated, zero macro backing) and the "Daily Tracker" toggle panel that
  mounted them; the header's "Daily Tracker" button now jumps to the real
  `Activity` tab (`ActivityRings`, backed by `activity-summary`). Added
  three new Action Result render blocks — `bodyCompReport` (BMI/body-fat/
  lean-mass), `attendanceReport` (attendance rate/streaks), and
  `generate-program`/`workout-plan-generate`'s shared `{plan}` shape
  (weekly template/progression/nutrition) — closing the silent-no-op quick
  actions. Removed now-dead imports (`motion`/`AnimatePresence`,
  `Footprints`/`Clock`, `INTENSITY_COLORS`).
- **`concord-frontend/components/fitness/WorkoutFinishPanel.tsx`** — fixed
  the `progressionCalc` call (now sends `{exercises}` derived from each
  lift's top set, reads `.recommendations`), the `hr-zones` call (now sends
  a distinct `restingHr` field — added alongside the pre-existing `avgHr`,
  which is real workout metadata used by the mint/publish actions and was
  never the bug — reads `.zones[].lowBpm/highBpm/name`), and the
  `workout-save` call (now sends `{workout: {id, title, startedAt,
  finishedAt, exercises, notes}}` in the exact shape `WorkoutLogger` reads
  back, and reads the real `{id}` response instead of a nonexistent
  `{workoutId}`). Added a "Resting HR" input distinct from the existing
  "Avg HR" input, with an inline comment explaining why they're different
  fields feeding different macros.
- **`concord-frontend/components/fitness/StravaDashboardPanel.tsx`** (new,
  ~140 LOC) — wires `fitness-dashboard`: this-week stat tiles (activities/
  distance/time/elevation/relative effort), training-load tiles (fitness/
  fatigue/form), goals-completed + gear-wear summary cards, all-time
  totals. Real loading/error-with-retry/empty/populated states, no
  fabricated fallback values.
- **`concord-frontend/components/fitness/FitnessStravaSection.tsx`** —
  mounted `StravaDashboardPanel` as a new `Dashboard` tab and made it the
  default-selected tab (was `activities`).

## Verification

- `cd concord-frontend && npx eslint app/lenses/fitness/page.tsx components/fitness/WorkoutFinishPanel.tsx components/fitness/StravaDashboardPanel.tsx components/fitness/FitnessStravaSection.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` filtered to `fitness` — 0 errors (one pre-fix type error from a stale `progressionResult.suggestions` reference in `actAgent`'s task-summary string, found and fixed during this pass).
- `cd server && node --test tests/fitness-domain-parity.test.js tests/fitness-lens-macros.test.js` → **103/103 pass, 0 fail** — unchanged (this pass touched no backend code; the frontend fixes now match the contract these tests already pinned, notably the exact `workout-save {workout:{...}}` requirement in `fitness-domain-parity.test.js` and the `recommendations`/`zones[].lowBpm` field-name contracts in `fitness-lens-macros.test.js`).
- `cd concord-frontend && npx vitest run tests/fitness-lens-states.test.tsx` → **10/10 pass** (ActivityRings + SleepRecovery four-UX-state contract, untouched by this pass, re-verified green).
- `node scripts/lens-unsurfaced.mjs --lens fitness` → **5/69 unsurfaced** (was 6/69 — `fitness-dashboard` closed).
- Read but did not modify (confirmed already real, correctly wired, no defects): `StravaActivitiesPanel.tsx`, `StravaSegmentsPanel.tsx`, `StravaGoalsPanel.tsx`, `StravaGpsPanel.tsx`, `StravaWearablePanel.tsx`, `StravaBeaconPanel.tsx`, `StravaPlanPanel.tsx`, `StravaClubsPanel.tsx`, `StravaTrainingPanel.tsx`, `ActivityRings.tsx`, `SleepRecovery.tsx`, `HeartRateZones.tsx`, `WorkoutLogger.tsx`, `WorkoutPlanner.tsx`, `RoutesPanel.tsx`, `FitnessFeed.tsx`.
