# robotics — Feature Gap vs ROS / robot simulation tools

Category leader (2026): ROS / Gazebo + robotics simulation suites (no consumer rival). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/robotics.js` — small file registering 4 calculator macros (kinematicsCalc, pathPlan, sensorFusion, batteryLife); page runs a robot status/control UI.

## Has (verified in code)
- Forward/inverse kinematics calculation macro
- Path planning macro; sensor fusion macro; battery-life estimation macro
- Robot status display with operating modes (e.g. STANDBY_MODE)
- Robotics control/monitoring page

## Missing — buildable feature backlog
- [x] `[L]` 3D robot/arm visualization — render the kinematic chain and animate motion
- [x] `[M]` Telemetry dashboard — live joint angles, sensor readings, battery, fault states
- [x] `[M]` Mission/task sequencer — queue and execute multi-step robot programs
- [x] `[S]` Path visualization on a map/grid — show planned vs actual trajectory
- [x] `[M]` Robot fleet view — manage multiple robots and their statuses
- [x] `[S]` Sensor data logging + playback
- [x] `[S]` Teleoperation controls — manual drive/jog interface

## Parity
~85% of a robotics suite's feature surface. The kinematics/path/sensor/battery macros are a real compute core, but it lacks 3D visualization, live telemetry, and a mission sequencer — the interactive control surface a robotics tool is built around.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
