export default function registerManufacturingActions(registerLensAction) {
  // Fail-CLOSED numeric guard: true when a caller-supplied field is PRESENT
  // but non-finite (NaN / Infinity / -Infinity / "1e999" / overflow) — or, when
  // requirePositive, present and <= 0. Absent fields (null/undefined) pass so
  // empty/minimal inputs keep their defaults. Lets a handler reject poisoned
  // input instead of silently substituting a default and returning ok:true.
  const presentButBad = (v, requirePositive = false) => {
    if (v == null || v === "") return false;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return true;
    if (requirePositive && n <= 0) return true;
    return false;
  };

  registerLensAction("manufacturing", "scheduleOptimize", (ctx, artifact, _params) => {
    const workOrders = artifact.data?.workOrders || [artifact];
    const sorted = [...workOrders].sort((a, b) => {
      const pa = a.priority || 3; const pb = b.priority || 3;
      if (pa !== pb) return pa - pb;
      const da = a.dueDate || '9999'; const db = b.dueDate || '9999';
      return da.localeCompare(db);
    });
    return { ok: true, result: { sequence: sorted.map((wo, i) => ({ position: i + 1, id: wo.id || wo.title, priority: wo.priority, dueDate: wo.dueDate })), count: sorted.length } };
  });

  registerLensAction("manufacturing", "bomCost", (ctx, artifact, _params) => {
    const components = artifact.data?.components || [];
    // Fail CLOSED: coerce quantity/unitCost to finite numbers so a poisoned
    // string field (e.g. "lots") can never poison the total with NaN.
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    let totalCost = 0;
    const breakdown = components.map(c => {
      const quantity = num(c.quantity);
      const unitCost = num(c.unitCost);
      const lineCost = Math.round(quantity * unitCost * 100) / 100;
      totalCost += lineCost;
      return { part: c.name || c.partRef, quantity, unitCost, lineCost };
    });
    const product = artifact.title || artifact.data?.product || null;
    return { ok: true, result: { product, components: breakdown, totalCost: Math.round(totalCost * 100) / 100, componentCount: components.length } };
  });

  registerLensAction("manufacturing", "oeeCalculate", (ctx, artifact, params) => {
    // Fail CLOSED on any present-but-poisoned numeric input — an Infinity here
    // would silently produce a meaningless OEE and still report ok:true.
    const ad = artifact.data || {};
    for (const f of ["plannedTime", "downtime", "idealCycleTime", "totalPieces", "goodPieces"]) {
      if (presentButBad(ad[f]) || presentButBad(params[f])) return { ok: false, error: `invalid_${f}` };
    }
    const plannedTime = ad.plannedTime || params.plannedTime || 480;
    const downtime = ad.downtime || params.downtime || 0;
    const idealCycleTime = ad.idealCycleTime || params.idealCycleTime || 1;
    const totalPieces = ad.totalPieces || params.totalPieces || 0;
    const goodPieces = ad.goodPieces || params.goodPieces || totalPieces;
    const runTime = plannedTime - downtime;
    const availability = plannedTime > 0 ? runTime / plannedTime : 0;
    const performance = (runTime > 0 && idealCycleTime > 0) ? (idealCycleTime * totalPieces) / runTime : 0;
    const quality = totalPieces > 0 ? goodPieces / totalPieces : 0;
    const oee = availability * performance * quality;
    return {
      ok: true,
      result: {
        machine: artifact.title,
        availability: Math.round(availability * 100),
        performance: Math.round(performance * 100),
        quality: Math.round(quality * 100),
        oee: Math.round(oee * 100),
        rating: oee >= 0.85 ? 'world_class' : oee >= 0.65 ? 'typical' : 'needs_improvement',
      },
    };
  });

  registerLensAction("manufacturing", "safetyRate", (ctx, artifact, params) => {
    const incidents = artifact.data?.incidents || [];
    // Fail CLOSED: a poisoned hoursWorked (Infinity/NaN) would make the
    // OSHA incident-rate denominator a lie while still reporting ok:true.
    if (presentButBad(artifact.data?.hoursWorked, true) || presentButBad(params.hoursWorked, true)) {
      return { ok: false, error: "invalid_hoursWorked" };
    }
    const hoursWorked = artifact.data?.hoursWorked || params.hoursWorked || 200000;
    // OSHA-recordable flag — accept either `oshaRecordable` or the `recordable`
    // alias (both are explicit per-incident flags, never inferred from severity).
    const recordable = incidents.filter(i => i.oshaRecordable || i.recordable).length;
    const rate = hoursWorked > 0 ? (recordable * 200000) / hoursWorked : 0;
    return { ok: true, result: { incidentRate: Math.round(rate * 100) / 100, recordableIncidents: recordable, totalIncidents: incidents.length, hoursWorked, benchmark: rate <= 3 ? 'below_average' : rate <= 5 ? 'average' : 'above_average' } };
  });

  // ─── Parity-sprint macros (real MES/SCADA feeds) ──
  //
  // Manufacturing telemetry (OEE, work orders, SPC) comes from a wired
  // shop-floor feed: OPC-UA endpoint (IEC 62541), MQTT broker
  // (Sparkplug B), MTConnect agent, or a per-shop ERP webhook
  // (Tulip, Plex, NetSuite Manufacturing). Per the "everything must
  // be real" directive, no hardcoded machine list / work-order stream
  // / SPC sample series is synthesized.

  function getMfgState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.manufacturingLens) {
      STATE.manufacturingLens = {
        machines: new Map(),    // userId -> Array<{ id, name, status, availability, performance, quality, oee, lastDowntimeReason }>
        workOrders: new Map(),  // userId -> Array<{ id, number, product, quantity, ... }>
        spcSamples: new Map(),  // `${userId}::${product}` -> Array<{ at, value, outOfSpec, outOfControl }>
      };
    }
    return STATE.manufacturingLens;
  }

  registerLensAction("manufacturing", "oee-status", (ctx, _artifact, _params = {}) => {
    const state = getMfgState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const machines = state.machines.get(userId) || [];
    return {
      ok: true,
      result: {
        machines,
        source: machines.length === 0 ? "empty" : "wired-feed",
        notes: machines.length === 0
          ? "No machines registered. Wire an MES/SCADA feed (OPC-UA, MQTT Sparkplug B, MTConnect agent) or POST machines via manufacturing.machine-register to populate."
          : null,
      },
    };
  });

  registerLensAction("manufacturing", "work-orders", (ctx, _artifact, _params = {}) => {
    const state = getMfgState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const orders = state.workOrders.get(userId) || [];
    return {
      ok: true,
      result: {
        orders,
        source: orders.length === 0 ? "empty" : "wired-feed",
        notes: orders.length === 0
          ? "No work orders. Wire an ERP webhook (Tulip/Plex/NetSuite) or POST via manufacturing.work-order-create to populate."
          : null,
      },
    };
  });

  registerLensAction("manufacturing", "spc-chart", (ctx, _artifact, params = {}) => {
  try {
    const state = getMfgState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const product = String(params.product || "");
    if (!product) return { ok: false, error: "product required" };
    const samples = state.spcSamples.get(`${userId}::${product}`) || [];
    if (samples.length === 0) {
      return {
        ok: true,
        result: {
          product,
          samples: [],
          source: "empty",
          notes: "No SPC samples logged for this product. Wire a QA gauge feed (gauge bridge or POST via manufacturing.spc-sample-log) to populate.",
        },
      };
    }
    // Real-data path: compute statistics over the actual samples.
    const values = samples.map((s) => s.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const std = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
    // upperSpec / lowerSpec come from the sample envelope if provided;
    // otherwise we infer ±3σ control limits from the data.
    const upperSpec = samples[0]?.upperSpec ?? mean + 3 * std;
    const lowerSpec = samples[0]?.lowerSpec ?? mean - 3 * std;
    const cpk = std > 0 ? Math.min((upperSpec - mean) / (3 * std), (mean - lowerSpec) / (3 * std)) : 0;
    const outOfSpec = samples.filter((s) => s.value > upperSpec || s.value < lowerSpec).length;
    const ppm = (outOfSpec / samples.length) * 1_000_000;
    const inControl = !samples.some((s) => Math.abs(s.value - mean) > 3 * std);
    return {
      ok: true,
      result: {
        product,
        upperSpec, lowerSpec,
        upperControl: mean + 3 * std,
        lowerControl: mean - 3 * std,
        centerLine: mean,
        samples,
        cpk: Math.round(cpk * 100) / 100,
        ppm: Math.round(ppm),
        inControl,
        source: "wired-feed",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ───────────────────────────────────────────────────────────────────────
  // Parity backlog (vs Tulip / Plex MES) — full shop-floor execution layer.
  // Persistent per-user data lives in globalThis._concordSTATE.manufacturingLens,
  // extended with extra Maps below. All handlers wrap work in try/catch.
  // ───────────────────────────────────────────────────────────────────────

  function getExtState() {
    const s = getMfgState();
    if (!s) return null;
    if (!s.workInstructions) s.workInstructions = new Map();   // userId -> Array<instructionSet>
    if (!s.iotReadings) s.iotReadings = new Map();             // `${userId}::${machineId}` -> Array<reading>
    if (!s.scheduleJobs) s.scheduleJobs = new Map();           // userId -> Array<job>
    if (!s.lots) s.lots = new Map();                           // userId -> Array<lot>
    if (!s.andonAlerts) s.andonAlerts = new Map();             // userId -> Array<alert>
    if (!s.ncrs) s.ncrs = new Map();                           // userId -> Array<ncr/capa>
    if (!s.maintenancePlans) s.maintenancePlans = new Map();   // userId -> Array<plan>
    if (!s.inventory) s.inventory = new Map();                 // userId -> Array<inventoryItem>
    return s;
  }
  function uid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function getList(map, key) { if (!map.has(key)) map.set(key, []); return map.get(key); }
  function nid(prefix) { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

  // ─── Feature 1: Digital work instructions ──────────────────────────────
  registerLensAction("manufacturing", "work-instruction-create", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const steps = Array.isArray(params.steps) ? params.steps : [];
      if (steps.length === 0) return { ok: false, error: "at least one step required" };
      const set = {
        id: nid("wi"),
        title,
        workOrderId: params.workOrderId || null,
        product: params.product || null,
        revision: params.revision || "A",
        createdAt: new Date().toISOString(),
        steps: steps.map((st, i) => ({
          index: i + 1,
          instruction: String(st.instruction || st.text || `Step ${i + 1}`),
          imageUrl: st.imageUrl || null,
          estimatedSeconds: Number(st.estimatedSeconds) || 0,
          requiredTool: st.requiredTool || null,
          checkpoint: Boolean(st.checkpoint),
          completed: false,
        })),
      };
      getList(s.workInstructions, uid(ctx)).push(set);
      return { ok: true, result: { instructionSet: set } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "work-instructions-list", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let sets = getList(s.workInstructions, uid(ctx));
      if (params.workOrderId) sets = sets.filter((x) => x.workOrderId === params.workOrderId);
      return { ok: true, result: { instructionSets: sets, count: sets.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "work-instruction-step-complete", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const sets = getList(s.workInstructions, uid(ctx));
      const set = sets.find((x) => x.id === params.instructionSetId);
      if (!set) return { ok: false, error: "instruction set not found" };
      const step = set.steps.find((st) => st.index === Number(params.stepIndex));
      if (!step) return { ok: false, error: "step not found" };
      step.completed = Boolean(params.completed ?? true);
      step.completedAt = step.completed ? new Date().toISOString() : null;
      const done = set.steps.filter((st) => st.completed).length;
      return { ok: true, result: { instructionSet: set, progress: { done, total: set.steps.length, pct: Math.round((done / set.steps.length) * 100) } } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 2: Machine / IoT data integration ─────────────────────────
  registerLensAction("manufacturing", "iot-reading-ingest", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const machineId = String(params.machineId || "").trim();
      if (!machineId) return { ok: false, error: "machineId required" };
      const reading = {
        at: params.at || new Date().toISOString(),
        machineState: params.machineState || "running",
        cycleCount: Number(params.cycleCount) || 0,
        spindleLoad: params.spindleLoad != null ? Number(params.spindleLoad) : null,
        temperature: params.temperature != null ? Number(params.temperature) : null,
        downtimeReason: params.downtimeReason || null,
      };
      const list = getList(s.iotReadings, `${uid(ctx)}::${machineId}`);
      list.push(reading);
      if (list.length > 500) list.splice(0, list.length - 500);
      return { ok: true, result: { machineId, reading, totalReadings: list.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "iot-machine-state", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const machineId = String(params.machineId || "").trim();
      if (!machineId) return { ok: false, error: "machineId required" };
      const list = getList(s.iotReadings, `${uid(ctx)}::${machineId}`);
      if (list.length === 0) {
        return { ok: true, result: { machineId, source: "empty", readings: [], notes: "No IoT readings. Ingest via manufacturing.iot-reading-ingest (OPC-UA / MQTT Sparkplug B bridge)." } };
      }
      const latest = list[list.length - 1];
      const downtimeReasons = {};
      let runCount = 0;
      for (const r of list) {
        if (r.machineState === "running") runCount++;
        if (r.downtimeReason) downtimeReasons[r.downtimeReason] = (downtimeReasons[r.downtimeReason] || 0) + 1;
      }
      const cycleSpan = list.length > 1 ? (list[list.length - 1].cycleCount - list[0].cycleCount) : 0;
      return {
        ok: true,
        result: {
          machineId,
          currentState: latest.machineState,
          latestCycleCount: latest.cycleCount,
          cyclesInWindow: cycleSpan,
          uptimePct: Math.round((runCount / list.length) * 100),
          downtimeReasons: Object.entries(downtimeReasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
          latest,
          readings: list.slice(-60),
          source: "wired-feed",
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 3: Production scheduling Gantt (finite-capacity) ───────────
  registerLensAction("manufacturing", "schedule-job-add", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = String(params.name || params.product || "").trim();
      if (!name) return { ok: false, error: "name/product required" };
      const durationHours = Number(params.durationHours);
      if (!(durationHours > 0)) return { ok: false, error: "durationHours must be > 0" };
      const job = {
        id: nid("job"),
        name,
        resource: params.resource || "Line A",
        workOrderId: params.workOrderId || null,
        durationHours,
        priority: Number(params.priority) || 3,
        dueDate: params.dueDate || null,
        startAt: params.startAt || null,
      };
      getList(s.scheduleJobs, uid(ctx)).push(job);
      return { ok: true, result: { job } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "schedule-gantt", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const jobs = getList(s.scheduleJobs, uid(ctx));
      const shiftHoursPerDay = Number(params.shiftHoursPerDay) || 8;
      const horizonStart = params.horizonStart ? new Date(params.horizonStart) : new Date();
      // Finite-capacity forward scheduling: per resource, place jobs back-to-back
      // ordered by priority then due date. No two jobs on a resource overlap.
      const byResource = {};
      const sorted = [...jobs].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
      });
      const placed = [];
      const cursor = {}; // resource -> ms cursor
      for (const j of sorted) {
        const res = j.resource;
        if (cursor[res] == null) cursor[res] = horizonStart.getTime();
        const start = j.startAt ? new Date(j.startAt).getTime() : cursor[res];
        const end = start + j.durationHours * 3600 * 1000;
        cursor[res] = end;
        const lateMs = j.dueDate ? end - new Date(j.dueDate).getTime() : 0;
        const slot = {
          ...j,
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          late: lateMs > 0,
          lateHours: lateMs > 0 ? Math.round(lateMs / 3600000 * 10) / 10 : 0,
        };
        placed.push(slot);
        (byResource[res] = byResource[res] || []).push(slot);
      }
      const resources = Object.keys(byResource);
      const capacity = resources.map((res) => {
        const loadHours = byResource[res].reduce((t, j) => t + j.durationHours, 0);
        return { resource: res, loadHours, jobCount: byResource[res].length, dailyCapacityHours: shiftHoursPerDay };
      });
      return {
        ok: true,
        result: {
          jobs: placed,
          byResource,
          resources,
          capacity,
          lateJobs: placed.filter((j) => j.late).length,
          source: placed.length === 0 ? "empty" : "computed",
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "schedule-job-reschedule", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const jobs = getList(s.scheduleJobs, uid(ctx));
      const job = jobs.find((j) => j.id === params.jobId);
      if (!job) return { ok: false, error: "job not found" };
      if (params.resource) job.resource = params.resource;
      if (params.startAt) job.startAt = params.startAt;
      if (params.priority != null) job.priority = Number(params.priority);
      return { ok: true, result: { job } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 4: Material traceability (lot/serial genealogy) ───────────
  registerLensAction("manufacturing", "lot-register", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const lotNumber = String(params.lotNumber || "").trim();
      if (!lotNumber) return { ok: false, error: "lotNumber required" };
      const material = String(params.material || "").trim();
      if (!material) return { ok: false, error: "material required" };
      const lots = getList(s.lots, uid(ctx));
      if (lots.some((l) => l.lotNumber === lotNumber)) return { ok: false, error: "lot already registered" };
      const lot = {
        id: nid("lot"),
        lotNumber,
        material,
        kind: params.kind || "raw_material", // raw_material | wip | finished_good
        quantity: Number(params.quantity) || 0,
        supplier: params.supplier || null,
        workOrderId: params.workOrderId || null,
        parentLots: Array.isArray(params.parentLots) ? params.parentLots.map(String) : [],
        createdAt: new Date().toISOString(),
      };
      lots.push(lot);
      return { ok: true, result: { lot } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "lot-genealogy", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const lots = getList(s.lots, uid(ctx));
      const target = String(params.lotNumber || "").trim();
      if (!target) return { ok: false, error: "lotNumber required" };
      const root = lots.find((l) => l.lotNumber === target);
      if (!root) return { ok: false, error: "lot not found" };
      const byNumber = new Map(lots.map((l) => [l.lotNumber, l]));
      // Upstream: ancestors (where this lot came from).
      function buildUp(lot, seen) {
        if (!lot || seen.has(lot.lotNumber)) return null;
        seen.add(lot.lotNumber);
        return {
          lotNumber: lot.lotNumber, material: lot.material, kind: lot.kind, supplier: lot.supplier,
          children: lot.parentLots.map((p) => buildUp(byNumber.get(p), seen)).filter(Boolean),
        };
      }
      // Downstream: descendants (lots that consumed this lot).
      function buildDown(lotNumber, seen) {
        if (seen.has(lotNumber)) return [];
        seen.add(lotNumber);
        return lots.filter((l) => l.parentLots.includes(lotNumber)).map((c) => ({
          lotNumber: c.lotNumber, material: c.material, kind: c.kind, workOrderId: c.workOrderId,
          children: buildDown(c.lotNumber, seen),
        }));
      }
      return {
        ok: true,
        result: {
          lot: root,
          upstream: buildUp(root, new Set()),
          downstream: buildDown(target, new Set()),
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "lots-list", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let lots = getList(s.lots, uid(ctx));
      if (params.kind) lots = lots.filter((l) => l.kind === params.kind);
      return { ok: true, result: { lots, count: lots.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 5: Andon / downtime alerting ──────────────────────────────
  registerLensAction("manufacturing", "andon-raise", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const reason = String(params.reason || "").trim();
      if (!reason) return { ok: false, error: "reason required" };
      const alert = {
        id: nid("andon"),
        station: params.station || params.machineId || "Unknown station",
        machineId: params.machineId || null,
        reason,
        category: params.category || "downtime", // downtime | quality | material | safety
        severity: params.severity || "medium", // low | medium | high | critical
        status: "open",
        raisedAt: new Date().toISOString(),
        raisedBy: params.raisedBy || uid(ctx),
        acknowledgedAt: null,
        resolvedAt: null,
        responseSeconds: null,
      };
      getList(s.andonAlerts, uid(ctx)).unshift(alert);
      return { ok: true, result: { alert } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "andon-update", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const alerts = getList(s.andonAlerts, uid(ctx));
      const alert = alerts.find((x) => x.id === params.alertId);
      if (!alert) return { ok: false, error: "alert not found" };
      const action = params.action;
      if (action === "acknowledge") {
        alert.status = "acknowledged";
        alert.acknowledgedAt = new Date().toISOString();
      } else if (action === "resolve") {
        alert.status = "resolved";
        alert.resolvedAt = new Date().toISOString();
        alert.responseSeconds = Math.round((Date.parse(alert.resolvedAt) - Date.parse(alert.raisedAt)) / 1000);
      } else {
        return { ok: false, error: "action must be acknowledge|resolve" };
      }
      return { ok: true, result: { alert } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "andon-board", (ctx, _a, _params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const alerts = getList(s.andonAlerts, uid(ctx));
      const open = alerts.filter((a) => a.status !== "resolved");
      const resolved = alerts.filter((a) => a.status === "resolved");
      const responses = resolved.map((a) => a.responseSeconds).filter((n) => n != null);
      const avgResponseSeconds = responses.length ? Math.round(responses.reduce((t, n) => t + n, 0) / responses.length) : 0;
      return {
        ok: true,
        result: {
          alerts,
          openCount: open.length,
          criticalOpen: open.filter((a) => a.severity === "critical").length,
          avgResponseSeconds,
          source: alerts.length === 0 ? "empty" : "wired-feed",
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 6: Quality non-conformance / CAPA workflow ────────────────
  registerLensAction("manufacturing", "ncr-create", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const ncr = {
        id: nid("ncr"),
        number: `NCR-${(getList(s.ncrs, uid(ctx)).length + 1).toString().padStart(4, "0")}`,
        title,
        product: params.product || null,
        workOrderId: params.workOrderId || null,
        lotNumber: params.lotNumber || null,
        defectType: params.defectType || "unspecified",
        severity: params.severity || "minor", // minor | major | critical
        quantityAffected: Number(params.quantityAffected) || 0,
        disposition: params.disposition || null, // use_as_is | rework | scrap | return_to_supplier
        rootCause: null,
        correctiveAction: null,
        preventiveAction: null,
        stage: "open", // open | investigation | capa | verification | closed
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      getList(s.ncrs, uid(ctx)).unshift(ncr);
      return { ok: true, result: { ncr } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "ncr-advance", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const ncrs = getList(s.ncrs, uid(ctx));
      const ncr = ncrs.find((x) => x.id === params.ncrId);
      if (!ncr) return { ok: false, error: "ncr not found" };
      const STAGES = ["open", "investigation", "capa", "verification", "closed"];
      if (params.rootCause != null) ncr.rootCause = String(params.rootCause);
      if (params.correctiveAction != null) ncr.correctiveAction = String(params.correctiveAction);
      if (params.preventiveAction != null) ncr.preventiveAction = String(params.preventiveAction);
      if (params.disposition != null) ncr.disposition = String(params.disposition);
      if (params.stage) {
        if (!STAGES.includes(params.stage)) return { ok: false, error: "invalid stage" };
        ncr.stage = params.stage;
        if (params.stage === "closed") ncr.closedAt = new Date().toISOString();
      } else {
        const idx = STAGES.indexOf(ncr.stage);
        if (idx < STAGES.length - 1) ncr.stage = STAGES[idx + 1];
        if (ncr.stage === "closed") ncr.closedAt = new Date().toISOString();
      }
      return { ok: true, result: { ncr } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "ncr-list", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let ncrs = getList(s.ncrs, uid(ctx));
      if (params.stage) ncrs = ncrs.filter((n) => n.stage === params.stage);
      const open = ncrs.filter((n) => n.stage !== "closed").length;
      return { ok: true, result: { ncrs, count: ncrs.length, openCount: open, source: ncrs.length === 0 ? "empty" : "wired-feed" } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 7: Maintenance management (preventive) ────────────────────
  registerLensAction("manufacturing", "maintenance-plan-create", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const machineId = String(params.machineId || "").trim();
      if (!machineId) return { ok: false, error: "machineId required" };
      const task = String(params.task || "").trim();
      if (!task) return { ok: false, error: "task required" };
      const intervalDays = Number(params.intervalDays);
      if (!(intervalDays > 0)) return { ok: false, error: "intervalDays must be > 0" };
      const lastDone = params.lastPerformed ? new Date(params.lastPerformed) : new Date();
      const plan = {
        id: nid("pm"),
        machineId,
        machineName: params.machineName || machineId,
        task,
        intervalDays,
        lastPerformed: lastDone.toISOString(),
        nextDue: new Date(lastDone.getTime() + intervalDays * 86400000).toISOString(),
        assignedTo: params.assignedTo || null,
      };
      getList(s.maintenancePlans, uid(ctx)).push(plan);
      return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "maintenance-complete", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const plans = getList(s.maintenancePlans, uid(ctx));
      const plan = plans.find((p) => p.id === params.planId);
      if (!plan) return { ok: false, error: "plan not found" };
      const now = new Date();
      plan.lastPerformed = now.toISOString();
      plan.nextDue = new Date(now.getTime() + plan.intervalDays * 86400000).toISOString();
      return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "maintenance-schedule", (ctx, _a, _params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const plans = getList(s.maintenancePlans, uid(ctx));
      const now = Date.now();
      const annotated = plans.map((p) => {
        const due = Date.parse(p.nextDue);
        const daysUntil = Math.round((due - now) / 86400000);
        return { ...p, daysUntilDue: daysUntil, state: daysUntil < 0 ? "overdue" : daysUntil <= 7 ? "due_soon" : "scheduled" };
      }).sort((a, b) => a.daysUntilDue - b.daysUntilDue);
      return {
        ok: true,
        result: {
          plans: annotated,
          overdueCount: annotated.filter((p) => p.state === "overdue").length,
          dueSoonCount: annotated.filter((p) => p.state === "due_soon").length,
          source: plans.length === 0 ? "empty" : "wired-feed",
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ─── Feature 8: Inventory / WIP tracking tied to work orders ───────────
  registerLensAction("manufacturing", "inventory-upsert", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const sku = String(params.sku || "").trim();
      if (!sku) return { ok: false, error: "sku required" };
      const items = getList(s.inventory, uid(ctx));
      let item = items.find((x) => x.sku === sku);
      if (!item) {
        item = { id: nid("inv"), sku, name: params.name || sku, location: params.location || "Stockroom", kind: params.kind || "raw_material", onHand: 0, allocated: 0, reorderPoint: 0, unitCost: 0, workOrderId: null };
        items.push(item);
      }
      if (params.name != null) item.name = String(params.name);
      if (params.location != null) item.location = String(params.location);
      if (params.kind != null) item.kind = String(params.kind);
      if (params.onHand != null) item.onHand = Number(params.onHand);
      if (params.reorderPoint != null) item.reorderPoint = Number(params.reorderPoint);
      if (params.unitCost != null) item.unitCost = Number(params.unitCost);
      if (params.workOrderId != null) item.workOrderId = params.workOrderId || null;
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "inventory-allocate", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const items = getList(s.inventory, uid(ctx));
      const item = items.find((x) => x.sku === params.sku);
      if (!item) return { ok: false, error: "sku not found" };
      const qty = Number(params.quantity);
      if (!(qty > 0)) return { ok: false, error: "quantity must be > 0" };
      const available = item.onHand - item.allocated;
      if (qty > available) return { ok: false, error: `insufficient stock: ${available} available` };
      item.allocated += qty;
      item.workOrderId = params.workOrderId || item.workOrderId;
      return { ok: true, result: { item, allocated: qty } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("manufacturing", "inventory-status", (ctx, _a, params = {}) => {
    try {
      const s = getExtState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let items = getList(s.inventory, uid(ctx));
      if (params.kind) items = items.filter((x) => x.kind === params.kind);
      if (params.workOrderId) items = items.filter((x) => x.workOrderId === params.workOrderId);
      const enriched = items.map((x) => ({
        ...x,
        available: x.onHand - x.allocated,
        belowReorder: (x.onHand - x.allocated) <= x.reorderPoint,
        value: Math.round(x.onHand * x.unitCost * 100) / 100,
      }));
      return {
        ok: true,
        result: {
          items: enriched,
          totalValue: Math.round(enriched.reduce((t, x) => t + x.value, 0) * 100) / 100,
          belowReorderCount: enriched.filter((x) => x.belowReorder).length,
          wipCount: enriched.filter((x) => x.kind === "wip").length,
          source: items.length === 0 ? "empty" : "wired-feed",
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Work-order / quality / downtime actions (deterministic; artifact-based) ──
  // Surface the manufacturing lens buttons that previously hit no macro
  // (advanceStep / generateTraveler / logDowntime / defectAnalysis). Each reads
  // the work-order/defect data off the artifact and computes a real result.

  registerLensAction("manufacturing", "advanceStep", (ctx, artifact, params = {}) => {
    const steps = Array.isArray(artifact.data?.steps) ? artifact.data.steps
      : Array.isArray(params.steps) ? params.steps : [];
    const total = steps.length;
    const cur = Math.max(0, Number(artifact.data?.currentStep ?? params.currentStep ?? 0));
    const next = Math.min(total, cur + 1);
    const done = total > 0 && next >= total;
    return {
      ok: true,
      result: {
        workOrder: artifact.title || artifact.data?.workOrder || "work order",
        currentStep: next,
        totalSteps: total,
        status: done ? "complete" : total === 0 ? "no_steps_defined" : "in_progress",
        currentStepName: steps[next - 1]?.name || steps[next - 1] || (total ? `Step ${next}` : null),
        nextStepName: done ? null : (steps[next]?.name || steps[next] || (total ? `Step ${next + 1}` : null)),
        percentComplete: total > 0 ? Math.round((next / total) * 100) : 0,
      },
    };
  });

  registerLensAction("manufacturing", "defectAnalysis", (ctx, artifact, params = {}) => {
    const defects = Array.isArray(artifact.data?.defects) ? artifact.data.defects
      : Array.isArray(params.defects) ? params.defects : [];
    const byType = {};
    const bySeverity = { critical: 0, major: 0, minor: 0 };
    for (const d of defects) {
      const type = String(d?.type || d?.category || "unspecified");
      byType[type] = (byType[type] || 0) + 1;
      const sev = String(d?.severity || "minor").toLowerCase();
      if (bySeverity[sev] !== undefined) bySeverity[sev] += 1; else bySeverity.minor += 1;
    }
    const total = defects.length;
    // Fail CLOSED on a present-but-poisoned inspected count — Infinity/NaN would
    // make defectRatePct a non-finite lie while still returning ok:true.
    if (presentButBad(artifact.data?.inspected) || presentButBad(params.inspected)) {
      return { ok: false, error: "invalid_inspected" };
    }
    const inspected = Number(artifact.data?.inspected ?? params.inspected ?? total) || total;
    const defectRate = inspected > 0 ? Math.round((total / inspected) * 10000) / 100 : 0;
    const topDefect = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const riskLevel = bySeverity.critical > 0 ? "high" : bySeverity.major > 2 ? "elevated" : total > 0 ? "low" : "none";
    return {
      ok: true,
      result: { defectCount: total, inspected, defectRatePct: defectRate, byType, bySeverity, topDefect, riskLevel },
    };
  });

  registerLensAction("manufacturing", "generateTraveler", (ctx, artifact, params = {}) => {
    const steps = Array.isArray(artifact.data?.steps) ? artifact.data.steps
      : Array.isArray(params.steps) ? params.steps : [];
    const partNumber = artifact.data?.partNumber || params.partNumber || "N/A";
    const qty = Number(artifact.data?.quantity ?? params.quantity ?? 1) || 1;
    const travelerId = `TRV-${String(artifact.id || artifact.title || "wo").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const lines = [
      `ROUTING TRAVELER  ${travelerId}`,
      `Part: ${partNumber}    Qty: ${qty}    WO: ${artifact.title || "work order"}`,
      `${"-".repeat(48)}`,
      ...(steps.length
        ? steps.map((s, i) => `  ${String(i + 1).padStart(2, "0")}. ${s?.name || s}   [ op:____  insp:____  date:____ ]`)
        : ["  (no routing steps defined on this work order)"]),
      `${"-".repeat(48)}`,
      `Sign-off: __________________   QA: __________________`,
    ];
    return {
      ok: true,
      result: { travelerId, partNumber, quantity: qty, stepCount: steps.length, content: lines.join("\n") },
    };
  });

  registerLensAction("manufacturing", "logDowntime", (ctx, artifact, params = {}) => {
    const machine = artifact.data?.machine || artifact.title || params.machine || "machine";
    const reason = String(params.reason || artifact.data?.reason || "unplanned");
    // Fail CLOSED on present-but-poisoned duration/plannedTime (Infinity/NaN)
    // rather than substituting a default and reporting a wrong impact as ok:true.
    if (presentButBad(params.durationMinutes) || presentButBad(artifact.data?.durationMinutes)) {
      return { ok: false, error: "invalid_durationMinutes" };
    }
    if (presentButBad(params.plannedTime, true) || presentButBad(artifact.data?.plannedTime, true)) {
      return { ok: false, error: "invalid_plannedTime" };
    }
    const safeNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
    const durationMinutes = Math.max(0, safeNum(params.durationMinutes ?? artifact.data?.durationMinutes ?? 0, 0));
    const plannedTime = Math.max(1, safeNum(artifact.data?.plannedTime ?? params.plannedTime ?? 480, 480));
    const availabilityImpactPct = Math.round((durationMinutes / plannedTime) * 10000) / 100;
    const downtimeId = `DT-${Date.now().toString(36).toUpperCase()}`;
    return {
      ok: true,
      result: {
        downtimeId, machine, reason, durationMinutes,
        plannedTimeMinutes: plannedTime,
        availabilityImpactPct,
        category: /maint|repair|break/i.test(reason) ? "maintenance" : /setup|changeover/i.test(reason) ? "setup" : "unplanned",
        loggedAt: new Date().toISOString(),
      },
    };
  });
};
