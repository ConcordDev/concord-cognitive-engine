# robotics — capability map (Frontend Rebuild Program, Wave 2 batch 6)

Reference apps: a real robotics-control/simulation stack — **ROS + rviz/Gazebo**
(fleet/robot registry, joint-space kinematics, path planning, sensor
telemetry streaming, teleop) and **Foxglove Studio** (live telemetry
dashboards, sensor-log playback, fault/health surfacing). Both are the
closest real-world category leaders to what this lens's backend already
computes — a per-user robot-fleet workspace with kinematics, planning,
telemetry, mission sequencing, and sensor-log playback.

## Backend macro surface (verified via reading `server/domains/robotics.js`)

`registerLensAction("robotics", ...)` — 20 macros, all pure compute or
in-memory per-user workspace state (`STATE`-backed fleet/mission/sensor-log
tables, no external I/O):

- **Manipulator calculators**: `kinematicsCalc`, `pathPlan`, `sensorFusion`,
  `batteryLife`
- **Fleet CRUD**: `fleetList`, `fleetRegister`, `fleetUpdate`, `fleetRemove`
- **Live state**: `telemetry` (per-robot joint/sensor/fault snapshot, tick-driven)
- **Kinematics engines**: `forwardKinematics`, `inverseKinematics`
- **Path planning**: `gridPlan`
- **Mission sequencing**: `missionList`, `missionCreate`, `missionAdvance`, `missionRemove`
- **Sensor logging**: `sensorLog`, `sensorPlayback`, `sensorClear`
- **Teleop**: `teleop`

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/robotics/` already had 9 files of real,
macro-wired UI — this lens turned out to be much further along than its
line count (191-line page) suggested:

- `FleetManager.tsx` — register/list/update-status/remove robots
  (`fleetList`/`fleetRegister`/`fleetUpdate`/`fleetRemove`), with real
  loading/error/empty states (a try/catch guard around the load call so a
  thrown fetch can't strand the spinner).
- `TelemetryDashboard.tsx` — per-robot live joint angles, IMU/temp/CPU/
  proximity sensors, fault list, and a joint-angle history chart, polling
  `telemetry` on a 1.5s tick while "Stream live" is on.
- `KinematicsStudio.tsx` — `forwardKinematics` / `inverseKinematics` engines.
- `PathPlanner.tsx` — `gridPlan` grid-based path search.
- `MissionSequencer.tsx` — `missionList`/`missionCreate`/`missionAdvance`/`missionRemove`.
- `TeleopConsole.tsx` — `teleop` direct robot control.
- `SensorLogPanel.tsx` — `sensorLog`/`sensorPlayback`/`sensorClear`, with a
  "Log 20-sample burst" convenience button that logs a synthetic sine+noise
  waveform (clearly labeled as a burst-generation convenience, not presented
  as a live sensor feed) so a fresh robot has something to play back.
- `RoboticsActionPanel.tsx` — the manipulator/autonomy calculator bench
  wiring the four pure-compute macros (`kinematicsCalc`/`pathPlan`/
  `sensorFusion`/`batteryLife`) plus mint/DM/publish/agent actions on the
  computed results.
- `RoboticsRepos.tsx` — live GitHub topic search (robotics/ros/autonomous-
  driving/slam/motion-planning/humanoid), real external API data, not a
  fixture list.

All 20 backend macros were already surfaced through real, designed UI before
this rebuild touched anything — confirmed by cross-referencing every
`registerLensAction("robotics", ...)` name against `lensRun('robotics', …)` /
`callMacro(...)` call sites in the component tree. There is no unsurfaced
macro and no disconnected `useLensData` fake-CRUD store anywhere in this
lens.

## What was actually wrong

Exactly one defect class, matching the pattern found across this wave: the
page imported and rendered the generic manifest-driven action bar and the
generic lens-feature-spec panel (behind a "Lens Features & Capabilities"
toggle) alongside the real bespoke depth above. Both are backed by a
domain-agnostic fallback (confirmed neither `analyze`, `generate`, nor
`suggest` is registered anywhere in `robotics.js` — the generic action bar's
manifest query has nothing domain-specific to show), so they contributed
nothing over the bespoke panels already in place. The honest UX grader
(`scripts/grade-ux-polish.mjs --honest`) correctly flagged this as a
generic-scaffold signature and capped the lens at `functional` even though
its actual designed-panel coverage was complete.

No fabricated data, no `Math.random()`-in-render, no dead buttons, and no
generic-CRUD `useLensData` store were found anywhere in the lens.

## What changed

- Removed the generic action-bar and lens-feature-panel body from the page
  (import + JSX usage both gone), along with the now-unused `showFeatures`
  toggle state and its icon imports. Nothing else in the page or its
  components was touched — every tab, panel, and macro call was already a
  real designed feature.

## Reference-parity checklist (ROS/rviz/Gazebo + Foxglove Studio shape)

| Capability | Disposition | Where |
|---|---|---|
| Multi-robot fleet registry (register/status/remove) | ALREADY REAL | `FleetManager` (`fleetList`/`fleetRegister`/`fleetUpdate`/`fleetRemove`) |
| Live telemetry dashboard (joints/sensors/faults) | ALREADY REAL | `TelemetryDashboard` (`telemetry`) |
| Forward/inverse kinematics solver | ALREADY REAL | `KinematicsStudio` (`forwardKinematics`/`inverseKinematics`) |
| Grid-based path planning | ALREADY REAL | `PathPlanner` (`gridPlan`) |
| Mission/waypoint sequencing | ALREADY REAL | `MissionSequencer` (`missionList`/`missionCreate`/`missionAdvance`/`missionRemove`) |
| Direct teleoperation console | ALREADY REAL | `TeleopConsole` (`teleop`) |
| Sensor-log recording + playback (Foxglove-style) | ALREADY REAL | `SensorLogPanel` (`sensorLog`/`sensorPlayback`/`sensorClear`) |
| Manipulator workbench (chain kinematics, path length, sensor fusion, battery-life estimate) | ALREADY REAL | `RoboticsActionPanel` (`kinematicsCalc`/`pathPlan`/`sensorFusion`/`batteryLife`) |
| Real-world tooling reference (ROS/SLAM/motion-planning repos) | ALREADY REAL | `RoboticsRepos` (live GitHub search) |
| Cross-community research feed | ALREADY REAL | `ArxivPanel` (arXiv cs.RO) |
| 3D URDF/mesh robot viewer (Gazebo/rviz-style scene) | ~~GENUINELY MISSING~~ **CLOSED (2026-07-17, `a9b01f28`)** | Real, not a mock. `urdf-parser.ts` parses a user-supplied URDF (real XML: links/joints/origins/axes/limits); `urdf-fk.ts` computes real forward kinematics over the joint chain; `UrdfViewer.tsx` renders the actual parsed link tree in three.js with joint sliders that move by real FK. Unknown/mesh-only geometry returns `null` (honest "not renderable yet"), never a placeholder box passed off as the robot. 24 tests. |
| Simulated physics/collision environment | **PARTIAL (2026-07-17, `a9b01f28`)** | Geometric half built: `urdf-clearance.ts` runs a real AABB/sphere clearance pass over the FK-posed link tree and flags overlapping link pairs, labeled "geometric clearance," explicitly never "collision-verified safe." Full rigid-body dynamics (contact forces, friction, restitution, a stepped physics world à la Gazebo/Bullet) stays honestly deferred — a genuinely large engine, not a UI-parity gap; documented as connector/engine-tier future work. `pathPlan`/`gridPlan` still compute distances/routes without dynamics as before. |

## Verify-gate results

- `npx eslint app/lenses/robotics/page.tsx components/robotics/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `npx vitest run tests/robotics-lens-states.test.tsx` — 5/5 passing (unchanged; this suite targets `FleetManager`/`TelemetryDashboard` state contracts directly, none of which were touched).
- `node scripts/verify-lens-backends.mjs` — `robotics` stays WIRED; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL / 260.
- `node scripts/grade-ux-polish.mjs --honest` — `robotics` now `tier: "polished"`, `isGenericScaffold: false` (was `functional`/`true` before).
