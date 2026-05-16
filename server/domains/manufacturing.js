export default function registerManufacturingActions(registerLensAction) {
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
    let totalCost = 0;
    const breakdown = components.map(c => {
      const lineCost = (c.quantity || 0) * (c.unitCost || 0);
      totalCost += lineCost;
      return { part: c.name || c.partRef, quantity: c.quantity, unitCost: c.unitCost, lineCost };
    });
    return { ok: true, result: { product: artifact.title, components: breakdown, totalCost: Math.round(totalCost * 100) / 100, componentCount: components.length } };
  });

  registerLensAction("manufacturing", "oeeCalculate", (ctx, artifact, params) => {
    const plannedTime = artifact.data?.plannedTime || params.plannedTime || 480;
    const downtime = artifact.data?.downtime || params.downtime || 0;
    const idealCycleTime = artifact.data?.idealCycleTime || params.idealCycleTime || 1;
    const totalPieces = artifact.data?.totalPieces || params.totalPieces || 0;
    const goodPieces = artifact.data?.goodPieces || params.goodPieces || totalPieces;
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
    const hoursWorked = artifact.data?.hoursWorked || params.hoursWorked || 200000;
    const recordable = incidents.filter(i => i.oshaRecordable).length;
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
  });
};
