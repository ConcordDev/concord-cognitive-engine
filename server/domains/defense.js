// server/domains/defense.js
//
// Pure-compute defense helpers (threat assessment, readiness score,
// supply chain, mission plan) plus real USAspending.gov DoD contract
// data. Free, no API key.

const USASPENDING_API = "https://api.usaspending.gov/api/v2";

export default function registerDefenseActions(registerLensAction) {
  registerLensAction("defense", "threatAssessment", (ctx, artifact, _params) => {
    const threats = artifact.data?.threats || [];
    if (threats.length === 0) return { ok: true, result: { message: "Add threats with likelihood and impact to assess." } };
    const assessed = threats.map(t => {
      const likelihood = parseFloat(t.likelihood) || 0.5;
      const impact = parseFloat(t.impact) || 0.5;
      const riskScore = Math.round(likelihood * impact * 100);
      return { threat: t.name || t.description, category: t.category || "general", likelihood: Math.round(likelihood * 100), impact: Math.round(impact * 100), riskScore, severity: riskScore >= 60 ? "critical" : riskScore >= 40 ? "high" : riskScore >= 20 ? "medium" : "low", mitigation: t.mitigation || "Develop response plan" };
    }).sort((a, b) => b.riskScore - a.riskScore);
    return { ok: true, result: { threats: assessed, critical: assessed.filter(t => t.severity === "critical").length, total: assessed.length, overallThreatLevel: assessed[0]?.severity || "low", topThreat: assessed[0]?.threat } };
  });
  registerLensAction("defense", "readinessScore", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const personnel = parseInt(data.personnelReady) || 0;
    const personnelTotal = parseInt(data.personnelTotal) || 1;
    const equipment = parseInt(data.equipmentOperational) || 0;
    const equipmentTotal = parseInt(data.equipmentTotal) || 1;
    const training = parseFloat(data.trainingCompletionPercent) || 0;
    const supplies = parseFloat(data.suppliesPercent) || 0;
    const personnelReady = Math.round((personnel / personnelTotal) * 100);
    const equipmentReady = Math.round((equipment / equipmentTotal) * 100);
    const overall = Math.round(personnelReady * 0.3 + equipmentReady * 0.3 + training * 0.2 + supplies * 0.2);
    return { ok: true, result: { personnelReadiness: personnelReady, equipmentReadiness: equipmentReady, trainingCompletion: training, supplyLevel: supplies, overallReadiness: overall, status: overall >= 80 ? "combat-ready" : overall >= 60 ? "operationally-ready" : overall >= 40 ? "limited-readiness" : "not-ready", gaps: [personnelReady < 80 ? "Personnel" : null, equipmentReady < 80 ? "Equipment" : null, training < 80 ? "Training" : null, supplies < 80 ? "Supplies" : null].filter(Boolean) } };
  });
  registerLensAction("defense", "incidentResponse", (ctx, artifact, _params) => {
    const incident = artifact.data || {};
    const severity = (incident.severity || "medium").toLowerCase();
    const protocols = { critical: { responseTime: "Immediate (< 5 min)", escalation: "Command level", actions: ["Activate emergency response team", "Secure perimeter", "Notify chain of command", "Begin situation assessment", "Deploy response assets"] }, high: { responseTime: "< 15 min", escalation: "Senior officer", actions: ["Alert response team", "Assess situation", "Implement containment", "Report to command"] }, medium: { responseTime: "< 1 hour", escalation: "Watch officer", actions: ["Log incident", "Assess and monitor", "Determine response level", "Update status"] }, low: { responseTime: "< 4 hours", escalation: "Duty officer", actions: ["Document incident", "Monitor for escalation", "Schedule review"] } };
    const protocol = protocols[severity] || protocols.medium;
    return { ok: true, result: { incidentType: incident.type || "unspecified", severity, responseTime: protocol.responseTime, escalationLevel: protocol.escalation, immediateActions: protocol.actions, logEntry: { time: new Date().toISOString(), type: incident.type, severity, location: incident.location || "unspecified", reporter: incident.reporter || ctx?.userId || "system" } } };
  });
  registerLensAction("defense", "resourceAllocation", (ctx, artifact, _params) => {
    const resources = artifact.data?.resources || [];
    const missions = artifact.data?.missions || [];
    if (resources.length === 0) return { ok: true, result: { message: "Add resources and missions to optimize allocation." } };
    const allocated = missions.map(m => {
      const required = m.resourcesNeeded || 1;
      const priority = m.priority || "medium";
      return { mission: m.name, priority, resourcesNeeded: required, resourcesAssigned: 0, status: "unallocated" };
    }).sort((a, b) => { const p = { critical: 0, high: 1, medium: 2, low: 3 }; return (p[a.priority] ?? 2) - (p[b.priority] ?? 2); });
    let available = resources.length;
    for (const m of allocated) { const assign = Math.min(m.resourcesNeeded, available); m.resourcesAssigned = assign; m.status = assign >= m.resourcesNeeded ? "fully-allocated" : assign > 0 ? "partially-allocated" : "unallocated"; available -= assign; }
    return { ok: true, result: { totalResources: resources.length, totalMissions: missions.length, availableAfter: available, allocations: allocated, fullyStaffed: allocated.filter(a => a.status === "fully-allocated").length, understaffed: allocated.filter(a => a.status !== "fully-allocated").length } };
  });

  /**
   * usaspending-dod-contracts — Real DoD prime award (contract) data
   * via USAspending.gov. Free, no API key. Searches the active
   * federal-procurement registry for DoD awards by keyword + date
   * range. Returns recipient, award amount, NAICS code, PSC code,
   * place of performance.
   *
   * params: {
   *   keyword: search term (e.g. "satellite", "aircraft maintenance"),
   *   awardType?: "contracts"|"grants"|"loans"|"idvs" (default contracts),
   *   limit?: 1-100, page?: 1+
   * }
   */
  registerLensAction("defense", "usaspending-dod-contracts", async (_ctx, _artifact, params = {}) => {
    const keyword = String(params.keyword || "").trim();
    if (!keyword) return { ok: false, error: "keyword required" };
    const awardType = ["contracts", "grants", "loans", "idvs"].includes(params.awardType) ? params.awardType : "contracts";
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    const page = Math.max(1, Number(params.page) || 1);
    // DoD agency code is 097 (TLA: Department of Defense).
    // award_type_codes: A,B,C,D = various contract types
    const body = {
      filters: {
        keywords: [keyword],
        agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }],
        time_period: [{ start_date: `${new Date().getFullYear() - 2}-01-01`, end_date: new Date().toISOString().slice(0, 10) }],
        award_type_codes: awardType === "contracts" ? ["A", "B", "C", "D"] : awardType === "grants" ? ["02", "03", "04", "05"] : awardType === "loans" ? ["07", "08"] : ["IDV_A", "IDV_B", "IDV_C", "IDV_D", "IDV_E"],
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Awarding Sub Agency", "Description", "Period of Performance Start Date", "Period of Performance Current End Date", "NAICS code", "PSC code", "Place of Performance State Code"],
      page, limit,
      sort: "Award Amount",
      order: "desc",
    };
    try {
      const r = await fetch(`${USASPENDING_API}/search/spending_by_award/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`usaspending ${r.status}`);
      const data = await r.json();
      const results = (data.results || []).map((row) => ({
        awardId: row["Award ID"],
        recipient: row["Recipient Name"],
        amount: row["Award Amount"],
        agency: row["Awarding Agency"],
        subAgency: row["Awarding Sub Agency"],
        description: row.Description,
        startDate: row["Period of Performance Start Date"],
        endDate: row["Period of Performance Current End Date"],
        naicsCode: row["NAICS code"],
        pscCode: row["PSC code"],
        placeOfPerformanceState: row["Place of Performance State Code"],
      }));
      return {
        ok: true,
        result: {
          keyword, awardType, page, limit,
          results, count: results.length,
          totalPages: data.page_metadata?.total,
          totalAmount: results.reduce((s, r) => s + (r.amount || 0), 0),
          source: "usaspending.gov",
        },
      };
    } catch (e) {
      return { ok: false, error: `usaspending unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /* ================================================================
   *  C2 substrate — persistent per-user defense workspace.
   *  Backs: COP map, mission planner, asset readiness rollup,
   *  threat tracking board, personnel roster, logistics supply
   *  chain, and per-operation secure comms log.
   * ================================================================ */

  function getDefState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.defenseLens) {
      STATE.defenseLens = {
        assets: new Map(),    // userId -> Map<assetId, asset>
        threats: new Map(),   // userId -> Map<threatId, threat>
        ops: new Map(),       // userId -> Map<opId, operation>
        tasks: new Map(),     // userId -> Map<taskId, missionTask>
        personnel: new Map(), // userId -> Map<personId, person>
        supply: new Map(),    // userId -> Map<reqId, resupplyRequest>
        comms: new Map(),     // userId -> Map<msgId, commsMessage>
      };
    }
    return STATE.defenseLens;
  }
  function saveDefState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function defActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextDefId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIso() { return new Date().toISOString(); }
  function userMap(s, key, userId) {
    if (!s[key].has(userId)) s[key].set(userId, new Map());
    return s[key].get(userId);
  }
  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }
  function validLat(v) { const n = Number(v); return Number.isFinite(n) && n >= -90 && n <= 90; }
  function validLon(v) { const n = Number(v); return Number.isFinite(n) && n >= -180 && n <= 180; }

  /* ── Common Operating Picture — geospatial entities ───────────── */

  registerLensAction("defense", "cop-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const kind = String(params.kind || "").toLowerCase();
      if (!["asset", "threat", "operation"].includes(kind)) {
        return { ok: false, error: "kind must be asset|threat|operation" };
      }
      const label = String(params.label || "").trim();
      if (!label) return { ok: false, error: "label required" };
      if (label.length > 80) return { ok: false, error: "label too long (max 80)" };
      if (!validLat(params.lat)) return { ok: false, error: "lat must be -90..90" };
      if (!validLon(params.lon)) return { ok: false, error: "lon must be -180..180" };
      // COP markers live as a tag on the relevant entity map; we use a
      // dedicated lightweight overlay record keyed under ops for plotting.
      const map = userMap(s, "ops", userId);
      const marker = {
        id: nextDefId("cop"),
        kind, label,
        lat: Number(params.lat), lon: Number(params.lon),
        affiliation: ["friendly", "hostile", "neutral", "unknown"].includes(params.affiliation)
          ? params.affiliation : "unknown",
        note: String(params.note || "").slice(0, 240),
        isCopMarker: true,
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      map.set(marker.id, marker);
      saveDefState();
      return { ok: true, result: { marker } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "cop-map", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const markers = [];
      // Explicit COP markers.
      for (const m of (s.ops.get(userId)?.values() || [])) {
        if (m.isCopMarker) markers.push(m);
      }
      // Geolocated assets.
      for (const a of (s.assets.get(userId)?.values() || [])) {
        if (validLat(a.lat) && validLon(a.lon)) {
          markers.push({ id: a.id, kind: "asset", label: a.designation, lat: a.lat, lon: a.lon, affiliation: "friendly", status: a.status });
        }
      }
      // Geolocated threats.
      for (const t of (s.threats.get(userId)?.values() || [])) {
        if (validLat(t.lat) && validLon(t.lon)) {
          markers.push({ id: t.id, kind: "threat", label: t.name, lat: t.lat, lon: t.lon, affiliation: "hostile", severity: t.severity });
        }
      }
      const byKind = { asset: 0, threat: 0, operation: 0 };
      for (const m of markers) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
      return { ok: true, result: { markers, count: markers.length, byKind } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "cop-remove", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const id = String(params.id || "");
      if (!id) return { ok: false, error: "id required" };
      const map = s.ops.get(userId);
      if (!map || !map.has(id) || !map.get(id).isCopMarker) return { ok: false, error: "marker not found" };
      map.delete(id);
      saveDefState();
      return { ok: true, result: { removed: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Mission planner — phased tasks with dependencies ─────────── */

  registerLensAction("defense", "mission-task-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      if (name.length > 100) return { ok: false, error: "name too long (max 100)" };
      const map = userMap(s, "tasks", userId);
      const dependsOn = Array.isArray(params.dependsOn)
        ? params.dependsOn.map(String).filter((d) => map.has(d))
        : [];
      const task = {
        id: nextDefId("task"),
        name,
        phase: ["shaping", "decisive", "sustainment", "transition"].includes(params.phase) ? params.phase : "shaping",
        status: "pending",
        dependsOn,
        owner: String(params.owner || "").slice(0, 60),
        startOffset: clampNum(params.startOffset, 0, 100000, 0),
        durationHours: clampNum(params.durationHours, 1, 100000, 24),
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      map.set(task.id, task);
      saveDefState();
      return { ok: true, result: { task } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "mission-task-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.tasks.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "task not found" };
      const t = map.get(id);
      if (params.status !== undefined) {
        if (!["pending", "in_progress", "complete", "blocked"].includes(params.status)) {
          return { ok: false, error: "invalid status" };
        }
        t.status = params.status;
      }
      if (typeof params.name === "string" && params.name.trim()) t.name = params.name.trim().slice(0, 100);
      if (["shaping", "decisive", "sustainment", "transition"].includes(params.phase)) t.phase = params.phase;
      if (params.durationHours !== undefined) t.durationHours = clampNum(params.durationHours, 1, 100000, t.durationHours);
      t.updatedAt = nowIso();
      saveDefState();
      return { ok: true, result: { task: t } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "mission-task-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.tasks.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "task not found" };
      map.delete(id);
      // Strip dangling dependency references.
      for (const t of map.values()) {
        if (t.dependsOn.includes(id)) t.dependsOn = t.dependsOn.filter((d) => d !== id);
      }
      saveDefState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "mission-plan", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.tasks.get(userId);
      const tasks = map ? Array.from(map.values()) : [];
      if (tasks.length === 0) return { ok: true, result: { tasks: [], phases: [], criticalPath: [], blocked: [] } };
      // Topological earliest-start schedule honoring dependencies.
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const start = new Map();
      const visiting = new Set();
      function earliest(id) {
        if (start.has(id)) return start.get(id);
        if (visiting.has(id)) return 0; // break cycles defensively
        visiting.add(id);
        const t = byId.get(id);
        let es = t.startOffset || 0;
        for (const dep of t.dependsOn) {
          const d = byId.get(dep);
          if (d) es = Math.max(es, earliest(dep) + (d.durationHours || 0));
        }
        visiting.delete(id);
        start.set(id, es);
        return es;
      }
      const scheduled = tasks.map((t) => {
        const es = earliest(t.id);
        return { ...t, earliestStart: es, finish: es + (t.durationHours || 0) };
      }).sort((a, b) => a.earliestStart - b.earliestStart);
      const PHASE_ORDER = ["shaping", "decisive", "sustainment", "transition"];
      const phases = PHASE_ORDER.map((p) => {
        const ts = scheduled.filter((t) => t.phase === p);
        return {
          phase: p, count: ts.length,
          complete: ts.filter((t) => t.status === "complete").length,
        };
      }).filter((p) => p.count > 0);
      const totalDuration = scheduled.reduce((m, t) => Math.max(m, t.finish), 0);
      // Critical path = chain of tasks whose finish equals total duration.
      const criticalPath = scheduled.filter((t) => t.finish === totalDuration).map((t) => t.id);
      const blocked = scheduled.filter((t) =>
        t.status !== "complete" &&
        t.dependsOn.some((d) => byId.get(d) && byId.get(d).status !== "complete")
      ).map((t) => ({ id: t.id, name: t.name }));
      return {
        ok: true,
        result: {
          tasks: scheduled, phases, criticalPath, blocked,
          totalDurationHours: totalDuration,
          completionPct: tasks.length ? Math.round((tasks.filter((t) => t.status === "complete").length / tasks.length) * 100) : 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Asset readiness rollup ───────────────────────────────────── */

  registerLensAction("defense", "asset-upsert", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const designation = String(params.designation || "").trim();
      if (!designation) return { ok: false, error: "designation required" };
      if (designation.length > 80) return { ok: false, error: "designation too long (max 80)" };
      const map = userMap(s, "assets", userId);
      const id = params.id && map.has(String(params.id)) ? String(params.id) : nextDefId("asset");
      const existing = map.get(id) || {};
      const asset = {
        id, designation,
        type: ["vehicle", "aircraft", "vessel", "weapon_system", "sensor", "comms"].includes(params.type)
          ? params.type : (existing.type || "vehicle"),
        status: ["operational", "maintenance", "deployed", "decommissioned"].includes(params.status)
          ? params.status : (existing.status || "operational"),
        readiness: clampNum(params.readiness, 0, 100, existing.readiness ?? 100),
        assignedUnit: String(params.assignedUnit ?? existing.assignedUnit ?? "").slice(0, 60),
        lat: validLat(params.lat) ? Number(params.lat) : (existing.lat ?? null),
        lon: validLon(params.lon) ? Number(params.lon) : (existing.lon ?? null),
        createdAt: existing.createdAt || nowIso(), updatedAt: nowIso(),
      };
      map.set(id, asset);
      saveDefState();
      return { ok: true, result: { asset } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "asset-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.assets.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "asset not found" };
      map.delete(id);
      saveDefState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "asset-rollup", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const assets = Array.from(s.assets.get(userId)?.values() || []);
      const total = assets.length;
      const byStatus = { operational: 0, maintenance: 0, deployed: 0, decommissioned: 0 };
      const byType = {};
      let readinessSum = 0;
      for (const a of assets) {
        byStatus[a.status] = (byStatus[a.status] || 0) + 1;
        byType[a.type] = (byType[a.type] || 0) + 1;
        readinessSum += a.readiness;
      }
      const inService = total - byStatus.decommissioned;
      // Fleet readiness: mean readiness of non-decommissioned assets.
      const inServiceAssets = assets.filter((a) => a.status !== "decommissioned");
      const fleetReadiness = inServiceAssets.length
        ? Math.round(inServiceAssets.reduce((m, a) => m + a.readiness, 0) / inServiceAssets.length)
        : 0;
      const availabilityPct = inService > 0
        ? Math.round(((byStatus.operational + byStatus.deployed) / inService) * 100) : 0;
      const lowReadiness = assets
        .filter((a) => a.status !== "decommissioned" && a.readiness < 60)
        .sort((a, b) => a.readiness - b.readiness)
        .map((a) => ({ id: a.id, designation: a.designation, readiness: a.readiness, status: a.status }));
      return {
        ok: true,
        result: {
          total, inService, byStatus, byType,
          fleetReadiness, availabilityPct,
          meanReadiness: total ? Math.round(readinessSum / total) : 0,
          lowReadiness,
          rollupStatus: fleetReadiness >= 80 ? "green" : fleetReadiness >= 55 ? "amber" : "red",
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Threat tracking board — watchlist + escalation ───────────── */

  registerLensAction("defense", "threat-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      if (name.length > 100) return { ok: false, error: "name too long (max 100)" };
      const map = userMap(s, "threats", userId);
      const threat = {
        id: nextDefId("threat"),
        name,
        category: String(params.category || "general").slice(0, 40),
        severity: ["low", "medium", "high", "critical"].includes(params.severity) ? params.severity : "low",
        status: "watching",
        region: String(params.region || "").slice(0, 60),
        lat: validLat(params.lat) ? Number(params.lat) : null,
        lon: validLon(params.lon) ? Number(params.lon) : null,
        note: String(params.note || "").slice(0, 240),
        history: [{ at: nowIso(), event: "added", severity: ["low", "medium", "high", "critical"].includes(params.severity) ? params.severity : "low" }],
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      map.set(threat.id, threat);
      saveDefState();
      return { ok: true, result: { threat } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "threat-escalate", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.threats.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "threat not found" };
      const t = map.get(id);
      const LADDER = ["low", "medium", "high", "critical"];
      const dir = params.direction === "down" ? -1 : 1;
      const idx = LADDER.indexOf(t.severity);
      const next = LADDER[Math.max(0, Math.min(LADDER.length - 1, idx + dir))];
      const changed = next !== t.severity;
      t.severity = next;
      if (["watching", "engaged", "neutralized"].includes(params.status)) t.status = params.status;
      t.updatedAt = nowIso();
      t.history.push({ at: nowIso(), event: dir > 0 ? "escalated" : "deescalated", severity: next });
      saveDefState();
      return { ok: true, result: { threat: t, changed } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "threat-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.threats.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "threat not found" };
      const t = map.get(id);
      let changed = false;
      if (params.status !== undefined) {
        if (!["watching", "engaged", "neutralized"].includes(params.status)) {
          return { ok: false, error: "invalid status" };
        }
        if (t.status !== params.status) {
          t.status = params.status;
          t.history.push({ at: nowIso(), event: `status:${params.status}`, severity: t.severity });
          changed = true;
        }
      }
      if (typeof params.note === "string") {
        t.note = params.note.slice(0, 240);
        changed = true;
      }
      if (typeof params.region === "string") {
        t.region = params.region.slice(0, 60);
        changed = true;
      }
      if (typeof params.category === "string" && params.category.trim()) {
        t.category = params.category.slice(0, 40);
        changed = true;
      }
      t.updatedAt = nowIso();
      saveDefState();
      return { ok: true, result: { threat: t, changed } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "threat-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.threats.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "threat not found" };
      map.delete(id);
      saveDefState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "threat-board", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const threats = Array.from(s.threats.get(userId)?.values() || []);
      const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
      threats.sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || (a.name.localeCompare(b.name)));
      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
      const byStatus = { watching: 0, engaged: 0, neutralized: 0 };
      for (const t of threats) {
        bySeverity[t.severity] = (bySeverity[t.severity] || 0) + 1;
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      }
      return {
        ok: true,
        result: {
          threats, total: threats.length, bySeverity, byStatus,
          highestSeverity: threats[0]?.severity || "none",
          activeWatch: threats.filter((t) => t.status !== "neutralized").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Personnel roster ─────────────────────────────────────────── */

  registerLensAction("defense", "personnel-upsert", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      if (name.length > 80) return { ok: false, error: "name too long (max 80)" };
      const map = userMap(s, "personnel", userId);
      const id = params.id && map.has(String(params.id)) ? String(params.id) : nextDefId("person");
      const existing = map.get(id) || {};
      const person = {
        id, name,
        rank: String(params.rank ?? existing.rank ?? "").slice(0, 40),
        role: String(params.role ?? existing.role ?? "").slice(0, 60),
        unit: String(params.unit ?? existing.unit ?? "").slice(0, 60),
        assignment: String(params.assignment ?? existing.assignment ?? "").slice(0, 80),
        availability: ["available", "deployed", "transit", "leave", "unavailable"].includes(params.availability)
          ? params.availability : (existing.availability || "available"),
        createdAt: existing.createdAt || nowIso(), updatedAt: nowIso(),
      };
      map.set(id, person);
      saveDefState();
      return { ok: true, result: { person } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "personnel-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.personnel.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "person not found" };
      map.delete(id);
      saveDefState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "personnel-roster", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const roster = Array.from(s.personnel.get(userId)?.values() || [])
        .sort((a, b) => a.name.localeCompare(b.name));
      const byAvailability = { available: 0, deployed: 0, transit: 0, leave: 0, unavailable: 0 };
      const byRole = {};
      for (const p of roster) {
        byAvailability[p.availability] = (byAvailability[p.availability] || 0) + 1;
        if (p.role) byRole[p.role] = (byRole[p.role] || 0) + 1;
      }
      const unassigned = roster.filter((p) => !p.assignment).map((p) => ({ id: p.id, name: p.name }));
      return {
        ok: true,
        result: {
          roster, total: roster.length, byAvailability, byRole, unassigned,
          deployable: byAvailability.available,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Logistics supply-chain tracking ──────────────────────────── */

  registerLensAction("defense", "supply-request", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const item = String(params.item || "").trim();
      if (!item) return { ok: false, error: "item required" };
      if (item.length > 80) return { ok: false, error: "item too long (max 80)" };
      const quantity = Number(params.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: "quantity must be > 0" };
      const map = userMap(s, "supply", userId);
      const req = {
        id: nextDefId("supply"),
        item, quantity: Math.round(quantity),
        category: ["ammunition", "fuel", "rations", "medical", "parts", "equipment"].includes(params.category)
          ? params.category : "equipment",
        priority: ["routine", "priority", "urgent", "flash"].includes(params.priority) ? params.priority : "routine",
        status: "requested",
        destination: String(params.destination || "").slice(0, 80),
        requestedBy: String(params.requestedBy || "").slice(0, 60),
        history: [{ at: nowIso(), status: "requested" }],
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      map.set(req.id, req);
      saveDefState();
      return { ok: true, result: { request: req } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "supply-advance", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.supply.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "request not found" };
      const req = map.get(id);
      const FLOW = ["requested", "approved", "in_transit", "delivered"];
      let next;
      if (params.status !== undefined) {
        if (![...FLOW, "cancelled"].includes(params.status)) return { ok: false, error: "invalid status" };
        next = params.status;
      } else {
        const idx = FLOW.indexOf(req.status);
        next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : req.status;
      }
      req.status = next;
      req.updatedAt = nowIso();
      req.history.push({ at: nowIso(), status: next });
      saveDefState();
      return { ok: true, result: { request: req } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "supply-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.supply.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "request not found" };
      map.delete(id);
      saveDefState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "supply-board", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const requests = Array.from(s.supply.get(userId)?.values() || []);
      const PRANK = { flash: 0, urgent: 1, priority: 2, routine: 3 };
      requests.sort((a, b) => (PRANK[a.priority] - PRANK[b.priority]) || (b.createdAt.localeCompare(a.createdAt)));
      const byStatus = { requested: 0, approved: 0, in_transit: 0, delivered: 0, cancelled: 0 };
      const byCategory = {};
      for (const r of requests) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      }
      const open = requests.filter((r) => r.status !== "delivered" && r.status !== "cancelled");
      const fulfillmentPct = requests.length
        ? Math.round((byStatus.delivered / requests.length) * 100) : 0;
      return {
        ok: true,
        result: {
          requests, total: requests.length, byStatus, byCategory,
          openCount: open.length, fulfillmentPct,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Secure comms log — message board per operation ───────────── */

  registerLensAction("defense", "comms-post", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const channel = String(params.channel || "").trim();
      if (!channel) return { ok: false, error: "channel required" };
      if (channel.length > 60) return { ok: false, error: "channel too long (max 60)" };
      const body = String(params.body || "").trim();
      if (!body) return { ok: false, error: "body required" };
      if (body.length > 1000) return { ok: false, error: "body too long (max 1000)" };
      const map = userMap(s, "comms", userId);
      const msg = {
        id: nextDefId("msg"),
        channel,
        body,
        classification: ["unclassified", "confidential", "secret", "top_secret"].includes(params.classification)
          ? params.classification : "unclassified",
        precedence: ["routine", "priority", "immediate", "flash"].includes(params.precedence) ? params.precedence : "routine",
        sender: String(params.sender || "").slice(0, 60) || userId,
        acknowledged: false,
        postedAt: nowIso(),
      };
      map.set(msg.id, msg);
      saveDefState();
      return { ok: true, result: { message: msg } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "comms-ack", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.comms.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "message not found" };
      const msg = map.get(id);
      msg.acknowledged = true;
      msg.acknowledgedAt = nowIso();
      saveDefState();
      return { ok: true, result: { message: msg } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "comms-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const map = s.comms.get(userId);
      const id = String(params.id || "");
      if (!map || !map.has(id)) return { ok: false, error: "message not found" };
      map.delete(id);
      saveDefState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("defense", "comms-log", (ctx, _artifact, params = {}) => {
    try {
      const s = getDefState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = defActor(ctx);
      const all = Array.from(s.comms.get(userId)?.values() || []);
      const channelFilter = params.channel ? String(params.channel) : null;
      const messages = (channelFilter ? all.filter((m) => m.channel === channelFilter) : all)
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      const channels = [...new Set(all.map((m) => m.channel))].sort();
      const unacknowledged = messages.filter((m) => !m.acknowledged).length;
      return {
        ok: true,
        result: { messages, channels, total: messages.length, unacknowledged },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
