# Affect Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Two distinct backend systems, both surfaced on one page

The affect lens is the frontend for **two genuinely separate real systems**,
easy to conflate because they share the word "affect":

1. **ATS — Affective Translation Spine** (`server/affect/{engine,defaults,
   policy,projection,schema,store,index}.js`, mounted at `server.js:55020`+).
   A bounded, real-time, per-session **7D state vector** — valence (v),
   arousal (a), stability (s), coherence (c), agency (g), trust (t), fatigue
   (f), all 0..1 — that decays toward baseline over time (`applyDecay`),
   responds to typed events (`SUCCESS`/`ERROR`/`SAFETY_BLOCK`/etc. via
   `computeRawDelta`), and is **read by other subsystems** to derive OS
   control signals: `getAffectPolicy(E)` (`server/affect/policy.js`) computes
   `style` (verbosity/directness/warmth/creativity/caution), `cognition`
   (exploration/riskBudget/depthBudget/latencyBudgetMs/toolUseBias), `memory`
   (writeStrength/summarizeBias/retentionBias), and `safety`
   (strictness/refuseThreshold) — all as **pure derived floats**, never
   user-settable booleans. Exposed at `GET/POST /api/affect/{state,event,
   policy,reset,events,health}` (REST, not the macro system) —
   `server.js:55122-55177`. This is the genuinely load-bearing piece CLAUDE.md
   points at (feeds chat linguistic style, council debate depth, agent-mode
   selection via `ATS.emitAffectEvent` wired into the response-json
   middleware at `server.js:55090-55113`, auto-firing `SYSTEM_RESULT`/`ERROR`/
   `SUCCESS` events off every API response's status code + `body.ok`).
2. **`affect` domain macros** (`server/domains/affect.js`, 1087 lines, 14
   macros via `registerLensAction("affect", …)`) — a **personal mood-tracking
   + text-analysis** toolkit, Daylio/Bearable-parity: `checkin` /
   `checkinHistory` / `trends` / `activityCorrelation` / `journalPrompts` /
   `setReminder` / `nudges` / `exportReport` / `getScale` / `setScale` (mood
   check-in ritual, streaks, per-user custom mood scale, activity
   correlation, CSV/JSON export) plus four **VAD/NLP analysis engines**:
   `sentimentAnalysis` (Valence-Arousal-Dominance lexicon scoring + negation/
   intensifier handling + sarcasm heuristics), `emotionTimeline` (Vonnegut
   emotional-arc classification + turning-point detection over a text
   sequence), `empathyMap` (Think/Feel/Say/Do quadrant classification + pain/
   gain extraction), `detect-patterns` (theme/trigger/cycle/correlation
   mining over journal entries). These are pure computation over
   caller-supplied text/entries/feedback — no relation to the ATS 7D vector.

Both are real. Neither was previously wired correctly end-to-end (see
Defects below).

## Backend surface

```
grep -c 'registerLensAction("affect"' server/domains/affect.js
```
→ **14** macros. Plus the separate ATS REST surface (6 routes, not macros):
`server.js:55122` `GET /api/affect/state`, `:55131` `POST /api/affect/event`,
`:55140` `GET /api/affect/policy`, `:55149` `POST /api/affect/reset`,
`:55158` `GET /api/affect/events`, `:55167` `GET /api/affect/health`.

Also present but NOT part of this lens's frontend: `server/lib/
affect-bridge.js` (Layer 2 — a *different*, DB-persisted, per-entity affect
substrate keyed by `entity_id`/`world_id` against migration 110's
`affect_state`/`affect_events_log` tables, feeding NPC/agent affect into the
existential qualia engine) and migration 326 `affect_trace_temperament` +
`server/emergent/affect-trace-cycle.js` (agent-reasoning-trace temperament,
consumed by the reasoning/agent substrate, not this lens). Confirmed by
reading both files in full: neither is reachable from `/lenses/affect` — the
lens's `sessionId`-scoped ATS (`server/affect/store.js` in-memory
`Map<sessionId,...>`) is architecturally distinct from the DB-backed
per-`entity_id` bridge. Out of scope for this lens; noted so a future reader
doesn't conflate the three affect-shaped systems in the codebase.

## Frontend surface

- `concord-frontend/app/lenses/affect/page.tsx` (~2,290 lines) — 6-tab shell
  (Mood / Dimensions / Event Log / Policies / Health / Analysis Tools), 7D
  state cards, radar chart, warnings/recovery-recommendations panel, event
  timeline with filters, policy display, analysis-tool runners.
- `concord-frontend/components/affect/MoodTracker.tsx` (1,097 lines) — 5
  sub-tabs (Check-in / Trends / Activities / Reminders / Scale), covers all
  10 mood-tracking macros via direct `lensRun('affect', …)` calls.
- `concord-frontend/components/affect/LiveAffectStream.tsx` (130 lines) — a
  compact companion panel polling the ATS REST channel directly.

## Classification

- **Mood-tracking macros (10 of 14): DESIGNED.** `MoodTracker.tsx` is a real,
  bespoke, Daylio-parity UI — mood-emoji picker bound to the user's own
  custom scale, activity tag chips, journal-prompt selection, streak/history
  cards, `ChartKit` line/bar trend charts, activity-correlation lift/drain
  cards, reminder CRUD, scale editor. No generic scaffold anywhere in this
  component.
- **VAD/NLP analysis macros (4 of 14 — `sentimentAnalysis`, `emotionTimeline`,
  `empathyMap`, `detect-patterns`): DESIGNED UI, but wired to the WRONG DATA
  (fixed this pass — see Defects).** Each has a real bespoke results panel
  (VAD bar chart + sarcasm indicators + emotion-word chips; smoothed-valence
  bar chart + arc-type badge + turning points; 4-quadrant empathy grid + pain/
  gain cards + theme chips; pattern/trigger/cycle/correlation cards) — not a
  generic button wall.
- **ATS REST surface (state/policy/health/events/emit/reset): DESIGNED.**
  7D dimension cards with radar chart, event timeline with type/dimension
  filters, health gauge + warnings + recovery recommendations, policy display
  (now correctly labeled read-only-derived — see Defects).

## Defects found and fixed

### 1. Analysis Tools tab was permanently dead (the big one)

`sentimentAnalysis` needs `{ text }`, `emotionTimeline` needs
`{ entries: [{text,timestamp}] }`, `empathyMap` needs
`{ feedback: [{text,...}] }`, `detect-patterns` needs `{ entries }` — all
read `artifact.data.<field>` (`server/domains/affect.js`). The page's
`handleAnalysisAction` instead invoked these through the **artifact-bridge**
system (`useRunArtifact` → `POST /api/lens/affect/:id/run`), whose synced
artifact (`useLensBridge('affect','snapshot')` → `bridge.sync(affectState,
…)`) is the **ATS 7D state vector** (`{v,a,s,c,g,t,f,ts,meta}`) — which has
no `text`/`entries`/`feedback` field at all. Every click on "Analyze
Sentiment" / "Build Timeline" / "Build Empathy Map" / "Detect Patterns"
therefore always received `artifact.data.text === undefined` and the handler
always returned its honest-but-useless `"No text/entries/feedback provided"`
placeholder — regardless of how much real affect data existed. ~700 LOC of
genuine VAD/arc/empathy/pattern analysis logic was unreachable through the UI
in every real session.

**Fix:** rewired all four buttons to call `lensRun('affect', <macro>, …)`
directly (the `/api/lens/run` "prefer `LENS_ACTIONS`" virtual-artifact path —
`server.js:39593-39600` — sets `virtualArtifact.data = <request input>`
verbatim, confirmed by reading `peelRedundantArtifactWrapper`
(`server/lib/lens-input-normalize.js`) end to end), with real data:
- Added a `checkinHistory`-backed `useQuery` + `journalEntries` memo that
  pulls the user's own mood-check-in notes + journal-prompt answers
  (`checkin` macro's `note`/`promptAnswer` fields, with real `createdAt`
  timestamps) — real text the user actually wrote, never fabricated.
- `sentimentAnalysis` gets a free-text `<textarea>` (a legitimate, honest,
  general-purpose "analyze this text" input — the natural shape for a VAD
  sentiment tool) that falls back to the concatenated journal notes when
  left blank.
- `emotionTimeline` / `empathyMap` / `detect-patterns` are fed the real
  journal entries (chronological order, restored from `checkinHistory`'s
  newest-first list).
- All four buttons now disable on `journalEntries.length === 0` (with an
  honest empty-state message pointing at the Mood tab) instead of on
  `!bridge.selectedId` (which was gating on the wrong precondition).
- Removed the now-unused `useRunArtifact`/`bridge.selectedId` dependency for
  this tab; `bridge` itself is kept (still used by `<UniversalActions>`,
  a legitimate separate cross-lens AI-action surface).

### 2. Policy-tab boolean toggle was dead code implying a non-existent capability

The Policies tab rendered a `ToggleLeft`/`ToggleRight` clickable toggle for
any policy field `typeof val === 'boolean'`, wired to a `togglePolicy`
mutation that called `runAction.mutateAsync({ action: 'togglePolicy', … })`.
Traced end to end: (a) `server/domains/affect.js` never registers a
`togglePolicy` action — the unregistered-action fallback in `server.js:38316`
silently routes it through the **utility LLM brain** as a last-resort
catch-all, so a real network+LLM call would fire for a button that does
nothing meaningful; (b) even the documented CUSTOM-event fallback path is
inert — `server/affect/engine.js#computeRawDelta`'s `default:` case for
unrecognized event types is a no-op `break`; (c) most importantly,
`getAffectPolicy(E)` (`server/affect/policy.js`) is a **pure function of the
7D state** — every field in `style`/`cognition`/`memory`/`safety` is
`clamp(...)`-derived from v/a/s/c/g/t/f. There is no boolean field anywhere
in the real schema, so this toggle branch could never actually render with
live data — but its mere presence implied a manual-override capability that
doesn't exist server-side, which is a fabrication risk if a future
schema change ever did introduce a boolean field.

**Fix:** removed the `togglePolicy` mutation, the `isBoolean` branch, and the
unused `ToggleLeft`/`ToggleRight`/`useRunArtifact` imports; the Policies tab
now always renders the honest numeric/read-only display (already the correct
path for 100% of real fields) and its intro copy now says explicitly that
these are derived control signals, not user settings. Also fixed a
side-effect bug in the same block: the progress-bar width used a blind
`clamp(val, 0, 1)`, which is correct for every field except
`latencyBudgetMs` (1000–15000ms) — that field always rendered its bar at
100% regardless of actual value. Now normalized against its real 15000ms
ceiling.

### 3. `LiveAffectStream.tsx` — field-shape mismatch, always showed fake-looking zeros

`GET /api/affect/state` responds `{ ok, state }` where `state` is the ATS
vector `{v,a,s,c,g,t,f,ts,meta}` (confirmed via `server/affect/store.js
#getState` + the route handler). `LiveAffectStream` read
`state.data.intensity`, `.polarity`, `.mood`, `.arousal`, `.valence` directly
off the **un-unwrapped envelope** — none of those keys exist at that level
(and `mood`/`intensity`/`polarity`/`lastEventAt` don't exist on the state
schema *at all*; those are **event**-level fields from a different endpoint).
Every render showed a hardcoded-looking "Intensity: 0.00 · Polarity: +0.00
(neutral) · Mood: —" regardless of the actual affective state — a live
"stream" panel that never moved.

**Fix:** unwrap to `state.data?.state`, and display the real fields
(Valence, Arousal, Fatigue — 3 of the genuine 7 dimensions, matching the
severity/warning logic the main page already uses for fatigue) instead of
the non-existent `intensity`/`polarity`/`mood`. `SaveAsDtuButton`'s exported
content/`rawData` updated to match. "Mood" (which had no backing field) was
dropped in favor of a real "last tick" timestamp derived from `state.ts`.

## What was left alone, with reason

- **ATS REST wiring itself** (`apiHelpers.affect.{state,policy,health,
  events,emit,reset}`) — already correct; `state`/`policy` are unwrapped
  correctly in `page.tsx` (`state?.state || state?.E || state`,
  `policy?.policy || policy`) — only the *separate* `LiveAffectStream`
  companion component had the shape bug.
- **`UniversalActions`/`LensFeaturePanel`/`RecentMineCard`/`AutoActionStrip`**
  — present and rendered, but alongside 1,227 LOC of bespoke components
  (`bespokeRatio: 0.347`) covering all 14 real macros with dedicated,
  domain-appropriate UI; the grader confirms `isGenericScaffold: false`.
  These generic primitives are additive cross-lens affordances here, not a
  substitute for real UI.
- **`affect-bridge.js` / migration 326 agent-affect substrate** — a distinct
  system (see "Backend surface" above); out of scope for this lens.

## Genuinely missing

None triaged as a defining-feature gap for this pass. The lens's category
reference is a personal mood-tracker (Daylio/Bearable) fused with a
real-time OS-control-signal dashboard (no direct commercial analog for the
ATS half — it's Concord-internal infrastructure exposed for
observability/debugging, not a consumer product surface) — both halves are
now genuinely reachable and correctly wired.

## Verification

- `node scripts/lens-unsurfaced.mjs --lens affect` → `affect: 0/14 macros
  never referenced in the frontend`.
- `cd concord-frontend && npx eslint app/lenses/affect/page.tsx
  components/affect/LiveAffectStream.tsx` → clean, zero output.
- `cd concord-frontend && npx vitest run tests/affect-lens-states.test.tsx`
  → **5/5 pass** (LOADING/ERROR/EMPTY/POPULATED four-UX-state contract +
  health-banner session count — unaffected by this pass's changes, confirmed
  green after).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,
  "NO-BACKEND-CALL":2}` total 260 (affect counted as WIRED).
- `node scripts/grade-ux-polish.mjs --honest` → affect `tier: "polished"`,
  `isGenericScaffold: false`, `honestCapped: false`, `bespokeRatio: 0.347`,
  `pillarsPresent: 5`, `antiPatterns: 0`; `audit/ux-polish-honest*` reverted
  via `git checkout` after reading (transient regenerated artifact).
- No backend file was touched (only two frontend files), so
  `node --check server/domains/affect.js` was run anyway as a sanity check
  → clean.
- `npx tsc --noEmit` was **not** run per this Wave's standing instruction (a
  prior parallel batch OOM'd the container running it); `eslint` + the
  vitest run above stand in as the verification signal instead.

## Files changed

- `concord-frontend/app/lenses/affect/page.tsx`
- `concord-frontend/components/affect/LiveAffectStream.tsx`
