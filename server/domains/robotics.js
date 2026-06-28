// server/domains/robotics.js
//
// Robotics lens — ROS / Gazebo-shape robot simulation suite.
//
// Two families of macros:
//   1. Pure-compute calculators (kinematicsCalc, pathPlan, sensorFusion,
//      batteryLife) — operate on the artifact data shape.
//   2. STATE-backed interactive control surface (fleet, telemetry,
//      missions, sensor logs, teleop, FK/IK chains) — persisted per-user
//      in globalThis._concordSTATE Maps keyed by userId.
//
// Every interactive macro returns { ok, result } / { ok:false, error }
// and never throws.

export default function registerRoboticsActions(registerLensAction) {
  // Fail-CLOSED numeric coercion: parseFloat lets the strings "Infinity"/"-Infinity"
  // through and `NaN || d` masks them inconsistently, so a poisoned input could leak
  // a non-finite value into a computed result. `fnum` returns the default unless the
  // parsed value is genuinely finite. Use for EVERY user-supplied number in the
  // pure-compute calculators.
  const fnum = (v, d = 0) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };

  // ─── Pure-compute calculators (artifact-shape) ─────────────────────
  registerLensAction("robotics", "kinematicsCalc", (ctx, artifact, _params) => { const joints = Array.isArray(artifact.data?.joints) ? artifact.data.joints : []; if (joints.length === 0) return { ok: true, result: { message: "Add joint parameters for kinematics calculation." } }; const analyzed = joints.map((j,i) => ({ joint: i+1, type: j.type || "revolute", angle: fnum(j.angle, 0), length: fnum(j.length, 100), range: [fnum(j.minAngle, -180), fnum(j.maxAngle, 180)] })); const reach = analyzed.reduce((s,j) => s + j.length, 0); return { ok: true, result: { degreesOfFreedom: analyzed.length, joints: analyzed, maxReach: `${reach}mm`, workspace: analyzed.length >= 6 ? "full-6DOF" : `${analyzed.length}-DOF limited`, type: analyzed.length >= 6 ? "articulated" : analyzed.length >= 3 ? "SCARA-like" : "simple" } }; });
  registerLensAction("robotics", "pathPlan", (ctx, artifact, _params) => { const waypoints = Array.isArray(artifact.data?.waypoints) ? artifact.data.waypoints : []; if (waypoints.length < 2) return { ok: true, result: { message: "Add at least 2 waypoints for path planning." } }; let totalDist = 0; const segments = []; for (let i = 1; i < waypoints.length; i++) { const dx = fnum(waypoints[i].x, 0) - fnum(waypoints[i-1].x, 0); const dy = fnum(waypoints[i].y, 0) - fnum(waypoints[i-1].y, 0); const dz = fnum(waypoints[i].z, 0) - fnum(waypoints[i-1].z, 0); const dist = Math.sqrt(dx*dx + dy*dy + dz*dz); totalDist += dist; segments.push({ from: i, to: i+1, distance: Math.round(dist*10)/10 }); } return { ok: true, result: { waypoints: waypoints.length, segments, totalDistance: Math.round(totalDist*10)/10, estimatedTime: `${Math.round(totalDist / 100 * 10) / 10}s at 100mm/s`, collisionCheck: "Use simulation to verify clearance" } }; });
  registerLensAction("robotics", "sensorFusion", (ctx, artifact, _params) => { const sensors = Array.isArray(artifact.data?.sensors) ? artifact.data.sensors : []; if (sensors.length === 0) return { ok: true, result: { message: "Add sensor data to fuse." } }; const readings = sensors.map(s => ({ sensor: s.name || s.type, value: fnum(s.value, 0), confidence: fnum(s.confidence, 0.8), weight: fnum(s.weight, 1) })); const totalWeight = readings.reduce((s,r) => s + r.weight * r.confidence, 0); const fusedValue = totalWeight > 0 ? readings.reduce((s,r) => s + r.value * r.weight * r.confidence, 0) / totalWeight : 0; const fusedConfidence = Math.round(Math.min(1, readings.reduce((s,r) => s + r.confidence, 0) / readings.length * 1.1) * 100); return { ok: true, result: { sensorCount: readings.length, fusedValue: Math.round(fusedValue * 1000) / 1000, fusedConfidence, method: "weighted-average", sensors: readings } }; });
  registerLensAction("robotics", "batteryLife", (ctx, artifact, _params) => { const data = artifact.data || {}; const capacity = fnum(data.batteryCapacityWh, 50); const motorDraw = fnum(data.motorDrawW, 20); const sensorDraw = fnum(data.sensorDrawW, 5); const computeDraw = fnum(data.computeDrawW, 10); const totalDraw = motorDraw + sensorDraw + computeDraw; const runtime = totalDraw > 0 ? capacity / totalDraw : 0; return { ok: true, result: { batteryCapacity: `${capacity} Wh`, totalPowerDraw: `${totalDraw} W`, breakdown: { motors: `${motorDraw}W`, sensors: `${sensorDraw}W`, compute: `${computeDraw}W` }, estimatedRuntime: `${Math.round(runtime * 60)} minutes`, safeRuntime: `${Math.round(runtime * 60 * 0.8)} minutes (80% reserve)`, recommendation: runtime < 0.5 ? "Battery undersized for application" : runtime < 1 ? "Marginal — consider larger battery" : "Adequate runtime" } }; });

  // ─── STATE helpers ─────────────────────────────────────────────────
  function getRoboState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.roboticsLens) STATE.roboticsLens = {};
    const s = STATE.roboticsLens;
    for (const k of ["robots", "missions", "sensorLogs", "teleop"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveRoboState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const rid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rnow = () => new Date().toISOString();
  const ruid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const rclamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rclean = (v, max = 240) => String(v == null ? "" : v).trim().slice(0, max);
  const rlist = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };

  // Deterministic pseudo-random in [0,1) seeded by a string — used for
  // repeatable sensor simulation without storing every sample.
  function seededRand(seed) {
    let h = 2166136261;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h = (h >>> 0) / 4294967295;
    return h;
  }

  // ─── Fleet management ──────────────────────────────────────────────
  // robotics.fleetList — all robots for the user.
  registerLensAction("robotics", "fleetList", (ctx, _artifact, _params) => {
    try {
      const s = getRoboState();
      const robots = rlist(s.robots, ruid(ctx));
      const online = robots.filter((r) => r.status !== "offline").length;
      const running = robots.filter((r) => r.status === "running").length;
      const errors = robots.filter((r) => r.status === "error").length;
      return { ok: true, result: { robots, total: robots.length, online, running, errors } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.fleetRegister — add a robot to the fleet.
  registerLensAction("robotics", "fleetRegister", (ctx, _artifact, params = {}) => {
    try {
      const name = rclean(params.name, 80);
      if (!name) return { ok: false, error: "Robot name required." };
      const type = ["arm", "mobile", "drone", "humanoid", "swarm", "custom"].includes(params.type) ? params.type : "arm";
      const s = getRoboState();
      const robots = rlist(s.robots, ruid(ctx));
      const robot = {
        id: rid("rbt"), name, type,
        status: "idle",
        firmware: rclean(params.firmware, 24) || "1.0.0",
        battery: rclamp(rnum(params.battery, 100), 0, 100),
        batteryCapacityWh: rclamp(rnum(params.batteryCapacityWh, 50), 1, 5000),
        powerDrawW: rclamp(rnum(params.powerDrawW, 35), 1, 5000),
        uptime: 0, errorCount: 0,
        position: { x: 0, y: 0, z: 0 },
        lastCommand: "INIT_SEQUENCE",
        createdAt: rnow(), updatedAt: rnow(),
      };
      robots.push(robot);
      saveRoboState();
      return { ok: true, result: { robot, total: robots.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.fleetUpdate — change status / battery / command.
  registerLensAction("robotics", "fleetUpdate", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId || params.id, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const s = getRoboState();
      const robots = rlist(s.robots, ruid(ctx));
      const robot = robots.find((r) => r.id === robotId);
      if (!robot) return { ok: false, error: "Robot not found." };
      if (params.status && ["idle", "running", "error", "maintenance", "offline"].includes(params.status)) {
        robot.status = params.status;
        if (params.status === "error") robot.errorCount = (robot.errorCount || 0) + 1;
      }
      if (params.battery != null) robot.battery = rclamp(rnum(params.battery, robot.battery), 0, 100);
      if (params.firmware) robot.firmware = rclean(params.firmware, 24);
      if (params.lastCommand) robot.lastCommand = rclean(params.lastCommand, 120);
      robot.updatedAt = rnow();
      saveRoboState();
      return { ok: true, result: { robot } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.fleetRemove — deregister a robot (+ its missions/logs).
  registerLensAction("robotics", "fleetRemove", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId || params.id, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const s = getRoboState();
      const uid = ruid(ctx);
      const robots = rlist(s.robots, uid);
      const idx = robots.findIndex((r) => r.id === robotId);
      if (idx === -1) return { ok: false, error: "Robot not found." };
      robots.splice(idx, 1);
      const missions = rlist(s.missions, uid);
      for (let i = missions.length - 1; i >= 0; i--) if (missions[i].robotId === robotId) missions.splice(i, 1);
      s.sensorLogs.delete(`${uid}:${robotId}`);
      s.teleop.delete(`${uid}:${robotId}`);
      saveRoboState();
      return { ok: true, result: { removed: robotId, total: robots.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Telemetry — live joint angles, sensors, battery, faults ───────
  // robotics.telemetry — synthesizes a deterministic snapshot from the
  // robot's id + a tick value, so the dashboard can poll for a "live"
  // feed. Real compute: sinusoidal joint motion, battery draw model,
  // fault probability, sensor noise.
  registerLensAction("robotics", "telemetry", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId || params.id, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const s = getRoboState();
      const robots = rlist(s.robots, ruid(ctx));
      const robot = robots.find((r) => r.id === robotId);
      if (!robot) return { ok: false, error: "Robot not found." };
      const tick = rnum(params.tick, Math.floor(Date.now() / 1000));
      const dof = robot.type === "humanoid" ? 12 : robot.type === "arm" ? 6 : robot.type === "drone" ? 4 : 2;
      const phase = tick * 0.15;
      const joints = [];
      for (let i = 0; i < dof; i++) {
        const angle = Math.round(Math.sin(phase + i * 0.7) * 90 * 10) / 10;
        const velocity = Math.round(Math.cos(phase + i * 0.7) * 13.5 * 100) / 100;
        const torque = Math.round((6 + Math.abs(velocity) * 0.4) * 100) / 100;
        joints.push({ joint: i + 1, angle, velocity, torque, unit: "deg" });
      }
      // Sensor block — type-aware channels with seeded noise.
      const noise = (ch) => (seededRand(`${robotId}:${tick}:${ch}`) - 0.5);
      const sensors = {
        imu: { roll: Math.round(noise("r") * 4 * 100) / 100, pitch: Math.round(noise("p") * 4 * 100) / 100, yaw: Math.round((phase * 12) % 360 * 10) / 10 },
        temperature: Math.round((38 + Math.abs(noise("t")) * 14) * 10) / 10,
        proximity: Math.round((0.4 + Math.abs(noise("pr")) * 3) * 100) / 100,
        cpuLoad: Math.round((35 + Math.abs(noise("c")) * 50)),
      };
      // Battery: drain model from registered draw.
      const drainPerTick = (robot.powerDrawW || 35) / (robot.batteryCapacityWh || 50) / 3600 * 100;
      const battery = rclamp(robot.battery - drainPerTick * (tick % 60), 0, 100);
      // Fault detection.
      const faults = [];
      if (sensors.temperature > 48) faults.push({ code: "THERMAL_WARN", severity: "warning", detail: `Core temp ${sensors.temperature}°C exceeds 48°C` });
      if (battery < 15) faults.push({ code: "LOW_BATTERY", severity: "critical", detail: `Battery at ${Math.round(battery)}%` });
      if (sensors.cpuLoad > 90) faults.push({ code: "CPU_SATURATION", severity: "warning", detail: `CPU load ${sensors.cpuLoad}%` });
      if (robot.status === "error") faults.push({ code: "FAULT_STATE", severity: "critical", detail: "Robot in error state — diagnostics required" });
      return {
        ok: true,
        result: {
          robotId, name: robot.name, type: robot.type, status: robot.status,
          tick, timestamp: rnow(),
          joints, dof, sensors,
          battery: Math.round(battery * 10) / 10,
          faults, faultCount: faults.length,
          health: faults.some((f) => f.severity === "critical") ? "critical" : faults.length ? "degraded" : "nominal",
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Kinematic chain — FK / IK with real math ──────────────────────
  // robotics.forwardKinematics — 2D planar chain. Given link lengths
  // and joint angles, computes the (x,y) of every joint + end effector.
  registerLensAction("robotics", "forwardKinematics", (_ctx, _artifact, params = {}) => {
    try {
      const links = Array.isArray(params.links) ? params.links.map((l) => rnum(l, 100)) : [];
      const angles = Array.isArray(params.angles) ? params.angles.map((a) => rnum(a, 0)) : [];
      if (links.length === 0) return { ok: false, error: "links array required." };
      const n = links.length;
      const points = [{ x: 0, y: 0 }];
      let cumAngle = 0;
      let x = 0, y = 0;
      for (let i = 0; i < n; i++) {
        cumAngle += (angles[i] || 0) * Math.PI / 180;
        x += links[i] * Math.cos(cumAngle);
        y += links[i] * Math.sin(cumAngle);
        points.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
      }
      const end = points[points.length - 1];
      const reach = links.reduce((a, b) => a + b, 0);
      return {
        ok: true,
        result: {
          points, endEffector: end,
          orientation: Math.round(cumAngle * 180 / Math.PI * 100) / 100,
          maxReach: reach,
          extension: Math.round(Math.hypot(end.x, end.y) / reach * 1000) / 10 + "%",
          dof: n,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.inverseKinematics — 2D N-link IK via CCD (cyclic coordinate
  // descent). Solves joint angles to reach a target (x,y).
  registerLensAction("robotics", "inverseKinematics", (_ctx, _artifact, params = {}) => {
    try {
      const links = Array.isArray(params.links) ? params.links.map((l) => rnum(l, 100)) : [];
      if (links.length === 0) return { ok: false, error: "links array required." };
      const target = { x: rnum(params.targetX ?? params.target?.x, 0), y: rnum(params.targetY ?? params.target?.y, 0) };
      const reach = links.reduce((a, b) => a + b, 0);
      const dist = Math.hypot(target.x, target.y);
      const reachable = dist <= reach + 1e-6;
      const n = links.length;
      const angles = new Array(n).fill(0);
      const fk = () => {
        const pts = [{ x: 0, y: 0 }];
        let ca = 0, x = 0, y = 0;
        for (let i = 0; i < n; i++) { ca += angles[i] * Math.PI / 180; x += links[i] * Math.cos(ca); y += links[i] * Math.sin(ca); pts.push({ x, y }); }
        return pts;
      };
      const maxIter = 100;
      let iterations = 0, err = Infinity;
      for (let iter = 0; iter < maxIter; iter++) {
        iterations = iter + 1;
        let pts = fk();
        let end = pts[n];
        err = Math.hypot(target.x - end.x, target.y - end.y);
        if (err < 0.5) break;
        for (let j = n - 1; j >= 0; j--) {
          pts = fk();
          end = pts[n];
          const pivot = pts[j];
          const toEnd = Math.atan2(end.y - pivot.y, end.x - pivot.x);
          const toTarget = Math.atan2(target.y - pivot.y, target.x - pivot.x);
          angles[j] += (toTarget - toEnd) * 180 / Math.PI;
          angles[j] = ((angles[j] + 180) % 360 + 360) % 360 - 180;
        }
      }
      const pts = fk();
      const end = pts[n];
      err = Math.hypot(target.x - end.x, target.y - end.y);
      return {
        ok: true,
        result: {
          angles: angles.map((a) => Math.round(a * 100) / 100),
          points: pts.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
          endEffector: { x: Math.round(end.x * 100) / 100, y: Math.round(end.y * 100) / 100 },
          target, reachable, error: Math.round(err * 100) / 100,
          converged: err < 0.5, iterations, method: "CCD",
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Path planning on a grid — A* with obstacle avoidance ──────────
  // robotics.gridPlan — A* over a 2D occupancy grid. Returns the planned
  // path; the page renders it against the grid + obstacles.
  registerLensAction("robotics", "gridPlan", (_ctx, _artifact, params = {}) => {
    try {
      const w = rclamp(rnum(params.width, 20), 2, 80);
      const h = rclamp(rnum(params.height, 20), 2, 80);
      const start = { x: rclamp(rnum(params.startX, 0), 0, w - 1), y: rclamp(rnum(params.startY, 0), 0, h - 1) };
      const goal = { x: rclamp(rnum(params.goalX, w - 1), 0, w - 1), y: rclamp(rnum(params.goalY, h - 1), 0, h - 1) };
      const obstacles = Array.isArray(params.obstacles) ? params.obstacles : [];
      const blocked = new Set(obstacles.map((o) => `${rnum(o.x, -1)},${rnum(o.y, -1)}`));
      const key = (p) => `${p.x},${p.y}`;
      if (blocked.has(key(start))) return { ok: false, error: "Start cell is blocked." };
      if (blocked.has(key(goal))) return { ok: false, error: "Goal cell is blocked." };
      const heur = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const open = [{ ...start, g: 0, f: heur(start, goal) }];
      const came = new Map();
      const gScore = new Map([[key(start), 0]]);
      const closed = new Set();
      let found = false, expansions = 0;
      while (open.length) {
        open.sort((a, b) => a.f - b.f);
        const cur = open.shift();
        const ck = key(cur);
        if (closed.has(ck)) continue;
        closed.add(ck);
        expansions++;
        if (cur.x === goal.x && cur.y === goal.y) { found = true; break; }
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cur.x + d[0], ny = cur.y + d[1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = `${nx},${ny}`;
          if (blocked.has(nk) || closed.has(nk)) continue;
          const tentative = (gScore.get(ck) ?? Infinity) + 1;
          if (tentative < (gScore.get(nk) ?? Infinity)) {
            came.set(nk, ck);
            gScore.set(nk, tentative);
            open.push({ x: nx, y: ny, g: tentative, f: tentative + heur({ x: nx, y: ny }, goal) });
          }
        }
      }
      const path = [];
      if (found) {
        let ck = key(goal);
        while (ck) {
          const [px, py] = ck.split(",").map(Number);
          path.unshift({ x: px, y: py });
          ck = came.get(ck);
        }
      }
      return {
        ok: true,
        result: {
          found, path, length: path.length,
          cost: found ? path.length - 1 : null,
          grid: { width: w, height: h }, start, goal,
          obstacleCount: blocked.size, expansions, algorithm: "A* (4-connected)",
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Mission / task sequencer ──────────────────────────────────────
  // robotics.missionList — all missions for the user.
  registerLensAction("robotics", "missionList", (ctx, _artifact, _params) => {
    try {
      const s = getRoboState();
      const missions = rlist(s.missions, ruid(ctx));
      return { ok: true, result: { missions, total: missions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.missionCreate — queue a multi-step robot program.
  registerLensAction("robotics", "missionCreate", (ctx, _artifact, params = {}) => {
    try {
      const name = rclean(params.name, 100);
      if (!name) return { ok: false, error: "Mission name required." };
      const rawSteps = Array.isArray(params.steps) ? params.steps : [];
      if (rawSteps.length === 0) return { ok: false, error: "At least one step required." };
      const steps = rawSteps.slice(0, 50).map((st, i) => ({
        index: i,
        command: rclean(typeof st === "string" ? st : st.command, 120) || `STEP_${i + 1}`,
        params: typeof st === "object" && st.params ? st.params : {},
        status: "pending",
        durationMs: rclamp(rnum(typeof st === "object" ? st.durationMs : undefined, 1000), 100, 600000),
      }));
      const s = getRoboState();
      const missions = rlist(s.missions, ruid(ctx));
      const mission = {
        id: rid("msn"), name,
        robotId: rclean(params.robotId, 64) || null,
        priority: rclamp(rnum(params.priority, 5), 1, 10),
        status: "queued",
        steps, currentStep: 0,
        createdAt: rnow(), updatedAt: rnow(),
        estimatedMs: steps.reduce((a, b) => a + b.durationMs, 0),
      };
      missions.push(mission);
      saveRoboState();
      return { ok: true, result: { mission, total: missions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.missionAdvance — execute the next step (or start/reset).
  registerLensAction("robotics", "missionAdvance", (ctx, _artifact, params = {}) => {
    try {
      const missionId = rclean(params.missionId || params.id, 64);
      if (!missionId) return { ok: false, error: "missionId required." };
      const s = getRoboState();
      const missions = rlist(s.missions, ruid(ctx));
      const mission = missions.find((m) => m.id === missionId);
      if (!mission) return { ok: false, error: "Mission not found." };
      const op = params.op || "step";
      if (op === "reset") {
        mission.steps.forEach((st) => { st.status = "pending"; });
        mission.currentStep = 0;
        mission.status = "queued";
      } else if (op === "abort") {
        for (let i = mission.currentStep; i < mission.steps.length; i++) mission.steps[i].status = "aborted";
        mission.status = "failed";
      } else {
        // Execute one step.
        if (mission.status === "complete" || mission.status === "failed") {
          return { ok: true, result: { mission, note: "Mission already finished." } };
        }
        mission.status = "running";
        const i = mission.currentStep;
        if (i < mission.steps.length) {
          // Steps may "fail" if their robot is in error — real branch.
          let stepFailed = false;
          if (mission.robotId) {
            const robot = rlist(s.robots, ruid(ctx)).find((r) => r.id === mission.robotId);
            if (robot && robot.status === "error") stepFailed = true;
          }
          mission.steps[i].status = stepFailed ? "failed" : "complete";
          mission.steps[i].executedAt = rnow();
          if (stepFailed) {
            mission.status = "failed";
          } else {
            mission.currentStep = i + 1;
            if (mission.currentStep >= mission.steps.length) mission.status = "complete";
          }
        }
      }
      mission.updatedAt = rnow();
      saveRoboState();
      const done = mission.steps.filter((st) => st.status === "complete").length;
      return { ok: true, result: { mission, progress: { done, total: mission.steps.length, percent: Math.round(done / mission.steps.length * 100) } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.missionRemove — delete a mission.
  registerLensAction("robotics", "missionRemove", (ctx, _artifact, params = {}) => {
    try {
      const missionId = rclean(params.missionId || params.id, 64);
      if (!missionId) return { ok: false, error: "missionId required." };
      const s = getRoboState();
      const missions = rlist(s.missions, ruid(ctx));
      const idx = missions.findIndex((m) => m.id === missionId);
      if (idx === -1) return { ok: false, error: "Mission not found." };
      missions.splice(idx, 1);
      saveRoboState();
      return { ok: true, result: { removed: missionId, total: missions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Sensor data logging + playback ────────────────────────────────
  // robotics.sensorLog — append a sensor sample to a robot's ring buffer.
  registerLensAction("robotics", "sensorLog", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const channel = rclean(params.channel, 48) || "default";
      const value = rnum(params.value, 0);
      const s = getRoboState();
      const k = `${ruid(ctx)}:${robotId}`;
      if (!s.sensorLogs.has(k)) s.sensorLogs.set(k, []);
      const buf = s.sensorLogs.get(k);
      buf.push({ t: rnow(), tick: rnum(params.tick, buf.length), channel, value });
      if (buf.length > 2000) buf.splice(0, buf.length - 2000); // ring buffer cap
      saveRoboState();
      return { ok: true, result: { robotId, channel, samples: buf.length, latest: buf[buf.length - 1] } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.sensorPlayback — read back a logged sensor channel.
  registerLensAction("robotics", "sensorPlayback", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const s = getRoboState();
      const k = `${ruid(ctx)}:${robotId}`;
      const buf = s.sensorLogs.get(k) || [];
      const channel = params.channel ? rclean(params.channel, 48) : null;
      let samples = channel ? buf.filter((x) => x.channel === channel) : buf;
      const limit = rclamp(rnum(params.limit, 200), 1, 2000);
      samples = samples.slice(-limit);
      const channels = [...new Set(buf.map((x) => x.channel))];
      const values = samples.map((x) => x.value);
      const stats = values.length
        ? {
          count: values.length,
          min: Math.round(Math.min(...values) * 1000) / 1000,
          max: Math.round(Math.max(...values) * 1000) / 1000,
          mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000,
        }
        : { count: 0, min: null, max: null, mean: null };
      return { ok: true, result: { robotId, channel, channels, samples, stats } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // robotics.sensorClear — wipe a robot's sensor log.
  registerLensAction("robotics", "sensorClear", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const s = getRoboState();
      s.sensorLogs.delete(`${ruid(ctx)}:${robotId}`);
      saveRoboState();
      return { ok: true, result: { robotId, cleared: true } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Teleoperation — manual drive / jog ────────────────────────────
  // robotics.teleop — apply a jog/drive command and integrate the
  // robot's position. Returns the new pose + a short command trail.
  registerLensAction("robotics", "teleop", (ctx, _artifact, params = {}) => {
    try {
      const robotId = rclean(params.robotId, 64);
      if (!robotId) return { ok: false, error: "robotId required." };
      const s = getRoboState();
      const uid = ruid(ctx);
      const robot = rlist(s.robots, uid).find((r) => r.id === robotId);
      if (!robot) return { ok: false, error: "Robot not found." };
      const cmd = rclean(params.command, 24) || "stop";
      const step = rclamp(rnum(params.step, 0.25), 0.01, 10);
      const pos = robot.position || (robot.position = { x: 0, y: 0, z: 0 });
      const k = `${uid}:${robotId}`;
      if (!s.teleop.has(k)) s.teleop.set(k, []);
      const trail = s.teleop.get(k);
      const moves = {
        forward: () => { pos.y += step; }, back: () => { pos.y -= step; },
        left: () => { pos.x -= step; }, right: () => { pos.x += step; },
        up: () => { pos.z += step; }, down: () => { pos.z -= step; },
        home: () => { pos.x = 0; pos.y = 0; pos.z = 0; },
        stop: () => {},
      };
      if (!moves[cmd]) return { ok: false, error: `Unknown teleop command "${cmd}".` };
      moves[cmd]();
      pos.x = Math.round(pos.x * 1000) / 1000;
      pos.y = Math.round(pos.y * 1000) / 1000;
      pos.z = Math.round(pos.z * 1000) / 1000;
      robot.lastCommand = `TELEOP_${cmd.toUpperCase()}`;
      robot.status = cmd === "stop" ? robot.status : "running";
      robot.updatedAt = rnow();
      trail.push({ t: rnow(), command: cmd, position: { ...pos } });
      if (trail.length > 100) trail.splice(0, trail.length - 100);
      saveRoboState();
      return { ok: true, result: { robotId, command: cmd, position: { ...pos }, trail: trail.slice(-20) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
