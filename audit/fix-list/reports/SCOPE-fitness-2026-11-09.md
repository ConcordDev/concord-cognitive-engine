# Fitness scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/fitness.js` + `concord-frontend/components/fitness/*` (+ thin `app/lenses/fitness/page.tsx` re-export). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

## Model

- Domain wrapped with `guardAnonWrites(registerLensAction)` (`fitness.js:5`) — anonymous callers can read, not write.
- Actor key: `faid(ctx)` / inline `ctx?.actor?.userId || ctx?.userId || "anon"` (`:716`, `:249`).
- Storage under `globalThis._concordSTATE.fitnessLens` (`getFitState` `:224–238`, `getFitState2` `:1632–1640`):

| Store | Keying | Visibility |
|-------|--------|------------|
| `workouts`, `recoveryEntries`, `activityEntries`, `activities`, `routes`, `goals`, `gear`, `hrvSamples`, `trainingPlans`, `wearableLinks` | **Map\<userId, Array\>** (or userId→list via `flistB`) | Owner-only list/read |
| `gpsTracks` | Map keyed by **activityId** (owner gated via activities.get(userId) on read) | Owner-only |
| `segments`, `segmentEfforts`, `clubs`, `challenges`, `beacons`, `feedLibrary` / `feedSeen` | **Global Maps** (id → record; efforts keyed by segmentId) | **Cross-user** list/join/leaderboard / token follow |
| `feedLibrary` / `feedSeen` | Domain-global (not per-user) | Shared ingest ledger for wger |

- Comment at `:711` claims "All STATE-backed, **per-user** scoped" for the Strava parity block — **false for segments/clubs/challenges** (global Maps + unfiltered lists).
- `fitness` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server/server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only). Generic `POST /api/lens/fitness` artifacts therefore stay owner-filtered.
- Training Hub macros go through `POST /api/lens/run { domain:'fitness', action, … }` → virtualArtifact branch — **does not** call `_lensEmitDTU` (same as manufacturing/logistics).
- Coaching "New record" / New Workout uses `useLensData('fitness','artifact')` → `POST /api/lens/fitness` (`use-lens-data.ts:116–118`) → generic `lens.create` → **does** fire FIX-xl-ws-001 (`_lensEmitDTU` title/tags WS broadcast without userId).
- WGER `fitness.feed` calls `ctx.macro.run("dtu","create", { visibility:"public", visibilityScope:"global", … })` (`:2534–2540`) — public DTUs + likely `_lensEmitDTU`.

## Existing harness rows (hz… / tz… / zukotest10101358)

| Surface | Verdict |
|---------|---------|
| **Segments, Clubs, Challenges** | **Shared cross-user bucket.** `segment-list` / `club-list` / `challenge-list` return `[...Map.values()]` with no owner filter unless `params.mine` (`:967–983`, `:1473–1486`, `:1541–1576`). Live rows with harness-style names are therefore visible to every signed-in user; they may be this QA account **and/or** other accounts that wrote into the same global Maps. Treat as shared fixtures, not "QA-only." |
| **Gear** | **QA account's own bucket.** `gear-list` / `gear-add` use `s.gear.get(faid(ctx))` (`:1415–1443`). Harness gear rows in the signed-in view are prior writes under that userId. |

Caveat (code-only): anon-keyed rows are invisible to a signed-in user and vice versa.

## Verdict table

| Create / surface | UI → API | Storage | Verdict | Delete / side effects |
|------------------|----------|---------|---------|----------------------|
| **New Workout** (coaching New record → Workout type) | `FitnessApp.tsx` `create(payload)` → `POST /api/lens/fitness` | Generic lens artifact, `ownerId=userId`, default private | **SAFE_PRIVATE** (content) + **WS title/tags leak** (FIX-xl-ws-001) | `remove(id)` → `DELETE /api/lens/fitness/:id`. Prefer QA titles; optional skip if WS leak is unacceptable. |
| **Log Start / Finish Save workout** (Log view) | `WorkoutLogger.tsx:138` / `WorkoutFinishPanel.tsx:195` → `workout-save` | `workouts` / userId (`:254–268`) | **SAFE_PRIVATE** | **No `workout-delete`.** Residual logs stay until manual STATE cleanup. Must have ≥1 exercise (`:263–264`). |
| **Training Hub → Log activity** | `StravaActivitiesPanel.tsx:88` → `activity-create` | `activities` / userId (`:827–861`) | **SAFE_PRIVATE** | `activity-delete` (`:904–916`); UI delete `:109`. |
| **Training Hub → New plan** | `StravaPlanPanel.tsx:95` → `plan-create` | `trainingPlans` / userId (`:2201+`) | **SAFE_PRIVATE** | `plan-delete` (`:2296`); UI delete. |
| **Training Hub → New segment** | `StravaSegmentsPanel.tsx:75` → `segment-create` | **Global** `segments` Map (`:939–963`); list returns **all** (`:969`) | **EXPOSED** | **No segment-delete.** Name/location/lat/lon visible to all; `segment-explore` maps geo segments (`:1978–2003`); leaderboard + efforts are public (`:986–1035`). "Use my location" writes real GPS into the shared segment (`:90–103`). |
| **Training Hub → Goals Add** | `StravaGoalsPanel.tsx:57` → `goal-create` | `goals` / userId (`:1303–1320`) | **SAFE_PRIVATE** | `goal-delete` (`:1357`); UI delete. |
| **Training Hub → Gear Add** | `StravaGoalsPanel.tsx:66` → `gear-add` | `gear` / userId (`:1415–1431`) | **SAFE_PRIVATE** | **No hard delete** — only `gear-retire` (`:1446–1452`). |
| **Training Hub → Club Create** | `StravaClubsPanel.tsx:48` → `club-create` | **Global** `clubs` Map (`:1456–1470`); list returns **all** (`:1476`) | **EXPOSED** | **No club-delete.** Anyone can `club-join` / leave (`:1489–1498`). Name/description/ownerDisplayName public; member ids stripped to `memberCount`. |
| **Training Hub → Challenge Create** | `StravaClubsPanel.tsx:64` → `challenge-create` | **Global** `challenges` Map (`:1502–1522`); list returns **all** (`:1545`) | **EXPOSED** | **No challenge-delete.** Creator auto-joined (`participants: [userId]`). Leaderboard computes progress from each participant's **private** `activities` Map and shows `displayName` + value to everyone listing the challenge (`:1548–1574`). Joining another user's challenge also exposes your aggregates. |
| **Beacon → Go live** | `StravaBeaconPanel.tsx:120` → `beacon-start` then `watchPosition` → `beacon-ping` | **Global** `beacons` Map (`:2083–2105`, `:2108–2126`) | **EXPOSED** (live location + share token) | `beacon-stop` ends session (`:2168`). UI **requires browser geolocation** and streams real coords (`:115–163`). `shareToken` (`bcn_` + ~10 chars `Math.random`) grants **anyone** full position + track via `beacon-status` without follower membership (`:2135–2144`). Weak token entropy. Followers array (if set) also authorised. **Do not run with real GPS.** |
| **GPS Start recording** | `StravaGpsPanel.tsx:104` → `gps-record` with live points | `activities` + `gpsTracks` under caller (`:1732–1796`) | **SAFE_PRIVATE** storage | Delete via `activity-delete` (track orphan possible — no gpsTracks cleanup in delete). UI uses **real** `navigator.geolocation` (`:78–89`). Heatmap is owner-only (`:1930–1940`). **Constraint: fake/far GPS or skip live record; prefer GPX with synthetic coords.** |
| **GPS Import GPX** | `StravaGpsPanel.tsx:123` → `gps-record` `{ gpx }` | Same as above | **SAFE_PRIVATE** | Same delete note. Use synthetic GPX far from real homes. |
| **Routes Save** | `RoutesPanel.tsx:52` → `route-create` | `routes` / userId (`:1040–1071`) | **SAFE_PRIVATE** | `route-delete` (`:1081`); UI delete. |
| **Training sleep / recovery Log** | `SleepRecovery.tsx:47` → `recovery-log` | `recoveryEntries` / userId (`:416–438`) | **SAFE_PRIVATE** | **No recovery-delete** (date upsert overwrite). |
| **Training HRV Log** | `StravaTrainingPanel.tsx:77` → `hrv-log` | `hrvSamples` / userId (`:1186–1197`) | **SAFE_PRIVATE** | **No hrv-delete.** |
| **Wearables Link** | `StravaWearablePanel.tsx:62` → `wearable-link` | `wearableLinks` / userId (`:1812–1834`) | **SAFE_PRIVATE** | Unlink via `wearable-link` `{ unlink:true }` (`:1820–1825`). **No real OAuth** to Strava/Garmin/Fitbit/Whoop — local stub only (provider name + optional deviceName). Manual `wearable-sync` posts typed samples into own recovery/activity/hrv Maps (`:1849–1921`) — also SAFE_PRIVATE. |
| **AI Generate plan / Generate Program** | `WorkoutPlanner.tsx:49` / coaching → `workout-plan-generate` / `generate-program` (`:660–662`) | Stateless return (deterministic template `:622–658`) | **SAFE to invoke (display only)** | Persists only if caller then Saves/Keeps. Default path needs **no LLM**. LLM only if `CONCORD_FITNESS_PLAN_LLM=true` **and** `ctx.llm.chat` (`:652–657`) — then paid AI risk. Saving via Keep / `useLensData.create` → private DTU/artifact + FIX-xl-ws-001. **Do not Keep/Mint/Publish during audit unless needed.** |
| **WGER Pull feed** | `WgerFeedPanel.tsx:46` → `fitness.feed` | Outbound `fetch('https://wger.de/api/v2/…')` (`:2514`, `:2436`); creates **public global** DTUs (`:2534–2540`); domain-global `feedLibrary` | **EXPOSED + outbound** | **Keep BLOCKED.** Also corpus-wide seen set; FIX-xl-ws-001 likely on each create. |

### Cross-cutting social / location notes

- **activity-kudos / activity-comments** accept `ownerUserId` and can mutate another user's activity if the id is known (`:919–935`, `:2041–2056`). Lists only return own activities, so discovery is limited, but this is a cross-user write path — do not kudos/comment on others' harness activities.
- **MapView** is SVG-only — **no** OSM/Mapbox tile outbound (`components/viz/MapView.tsx:7`).
- **No** Strava/Garmin/Fitbit OAuth redirect in UI or domain — wearable "Link" is a local flag.
- Coaching artifacts path is private storage but WS-leaks titles; Training Hub macros (except WGER DTUs) skip `_lensEmitDTU`.

## Keep BLOCKED

1. **Club Create / Club Join** — shared club directory; visible to all users.
2. **Challenge Create / Challenge Join** — shared challenges; leaderboard exposes participant progress from private activities.
3. **New segment** (and segment-effort / "Use my location") — global segments + public leaderboards; real lat/lon would publish location.
4. **Beacon → Go live** — live geolocation + shareable token; location exposure.
5. **WGER Pull feed** — outbound to wger.de + public/global DTUs.
6. **Ask about Fitness / Vision / Lever / agent / Publish / share / DM / Reddit community** — standing cost / public / contact rules (shell chrome).
7. **Keep / Mint** of generated plans or activities as DTUs if FIX-xl-ws-001 title broadcast is unacceptable; **Publish** always blocked.
8. **Live GPS Start recording near real homes** — storage is private but writes real coordinates into server STATE; use synthetic GPX instead.
9. Do **not** paste real wearable OAuth tokens, real health data tied to identity, or real home addresses into free-text fields.

## Test-safe (CRUD OK under constraints)

| OK to write | Notes |
|-------------|-------|
| Coaching New Workout / client / program / class / team / athlete artifacts | QA titles; delete after; expect WS title leak |
| Log Start → Finish Save workout | Fake exercises; **no delete verb** — log residual id in ticket |
| Log activity (Training Hub) | Delete after |
| New plan | Delete after |
| Goals Add | Delete after |
| Gear Add | Retire after (no hard delete) |
| Routes Save | Delete after |
| recovery-log / hrv-log | Fake numbers; no delete — unique dates / note residuals |
| Wearables Link + manual sync samples | Fake metrics; unlink after |
| Generate plan (display only) | Do not Keep/Mint unless necessary |
| GPX Import | Synthetic track far from real homes; activity-delete after |
| GPS Start recording | Only if test environment can inject fake geolocation; otherwise BLOCKED → use GPX |

**Constraints (all writes):**

- Titles / names: `QA LT1 fitness 2026-11-09 <thing>`
- Fake GPS / GPX only; coordinates far from real homes (e.g. mid-ocean)
- Stay signed in (`guardAnonWrites`)
- Delete / retire / unlink afterwards where UI/API exists; ticket residuals (workouts, recovery, hrv, gear, gpsTracks orphans, segments/clubs/challenges if any slip through — those should not be created)
- Expect **RCA-form-hotkey-steal** on coaching forms (keys below); mark those checks BLOCKED by RCA and continue others. Training Hub panels have **no** nested bare-letter `useLensCommand`, but parent `c/p/w/l/t/r` still fire while those forms are open if focus is not a true form field.

## Hotkeys (RCA-form-hotkey-steal)

From `FitnessApp.tsx:353–360` and duplicate bindings in `FitnessCoachWorkspace.tsx:305–312` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `c` | Coaching → Clients |
| `p` | Coaching → Programs |
| `w` | Coaching → Workouts |
| `l` | Coaching → Classes |
| `t` | Coaching → Teams |
| `r` | Coaching → Recruiting |
| `/` | Focus search |

Training Hub (`FitnessStravaSection`) tab switches are click-only — no additional bare-letter commands found in Strava* panels.

## Gaps

- Code-only; not live-proven against production STATE Maps or live WebSocket subscribers.
- No delete for: workouts (`workout-save`), segments, clubs, challenges, recovery rows, HRV samples, gear (retire only), beacon records (stop ≠ delete), gpsTracks (not cleared on activity-delete).
- Comment "per-user scoped" at `:711` is inaccurate for segments/clubs/challenges/beacons/feedLibrary — ticket as docs/impl mismatch.
- Beacon `shareToken` entropy is weak (`Math.random` slice); anyone with the token sees live track — security finding even without intentional share.
- `activity-kudos` / comments cross-user by `ownerUserId` without friendship gate.
- Challenge leaderboard reads other users' activity Maps server-side — privacy leak for anyone who joins (or creates) a challenge.
- Whether live deploy has `CONCORD_FITNESS_PLAN_LLM=true` is env-unknown; treat Generate+LLM as possible paid path if that flag is on.
- Coaching `useLensData` bulk seed only runs in development (`use-lens-data.ts:95–98`) — not a prod concern.
- Existing hz/tz/zukotest segment/club/challenge rows: do not join, effort, or delete-attempt; leave for cleanup ticket as shared fixtures.
