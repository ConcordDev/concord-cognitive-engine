// server/domains/supplychain.js
export default function registerSupplychainActions(registerLensAction) {
  registerLensAction("supplychain", "leadTimeAnalysis", (ctx, artifact, _params) => { const orders = artifact.data?.orders || []; if (orders.length === 0) return { ok: true, result: { message: "Add orders with dates to analyze lead times." } }; const leadTimes = orders.map(o => { const ordered = new Date(o.orderDate || o.created); const received = o.receivedDate ? new Date(o.receivedDate) : null; const days = received ? Math.ceil((received.getTime() - ordered.getTime()) / 86400000) : null; return { order: o.id || o.name, supplier: o.supplier, leadTimeDays: days, status: received ? "delivered" : "pending" }; }).filter(o => o.leadTimeDays !== null); const avg = leadTimes.length > 0 ? Math.round(leadTimes.reduce((s,o) => s + o.leadTimeDays, 0) / leadTimes.length) : 0; return { ok: true, result: { ordersAnalyzed: leadTimes.length, avgLeadTimeDays: avg, minDays: Math.min(...leadTimes.map(o => o.leadTimeDays)), maxDays: Math.max(...leadTimes.map(o => o.leadTimeDays)), reliability: avg <= 7 ? "excellent" : avg <= 14 ? "good" : avg <= 30 ? "acceptable" : "poor" } }; });
  registerLensAction("supplychain", "inventoryOptimize", (ctx, artifact, _params) => { const items = artifact.data?.items || []; if (items.length === 0) return { ok: true, result: { message: "Add inventory items to optimize." } }; const analyzed = items.map(i => { const demand = parseFloat(i.dailyDemand) || 1; const leadTime = parseInt(i.leadTimeDays) || 7; const current = parseInt(i.currentStock) || 0; const safetyStock = Math.ceil(demand * leadTime * 0.5); const reorderPoint = Math.ceil(demand * leadTime + safetyStock); const eoq = Math.round(Math.sqrt(2 * demand * 365 * (parseFloat(i.orderCost) || 50) / (parseFloat(i.holdingCost) || 5))); return { item: i.name, currentStock: current, reorderPoint, safetyStock, eoq, daysOfStock: demand > 0 ? Math.round(current / demand) : 999, needsReorder: current <= reorderPoint }; }); return { ok: true, result: { items: analyzed, needsReorder: analyzed.filter(i => i.needsReorder).length, totalItems: analyzed.length } }; });
  registerLensAction("supplychain", "supplierScore", (ctx, artifact, _params) => { const suppliers = artifact.data?.suppliers || []; if (suppliers.length === 0) return { ok: true, result: { message: "Add suppliers to score." } }; const scored = suppliers.map(s => { const quality = parseFloat(s.qualityScore) || 70; const delivery = parseFloat(s.onTimePercent) || 80; const price = parseFloat(s.priceCompetitiveness) || 70; const responsiveness = parseFloat(s.responsiveness) || 70; const total = Math.round(quality * 0.3 + delivery * 0.3 + price * 0.2 + responsiveness * 0.2); return { supplier: s.name, quality, delivery, price, responsiveness, totalScore: total, tier: total >= 85 ? "preferred" : total >= 70 ? "approved" : total >= 50 ? "conditional" : "at-risk" }; }).sort((a,b) => b.totalScore - a.totalScore); return { ok: true, result: { suppliers: scored, topSupplier: scored[0]?.supplier, atRisk: scored.filter(s => s.tier === "at-risk").length } }; });
  registerLensAction("supplychain", "demandForecast", (ctx, artifact, _params) => { const history = artifact.data?.history || []; if (history.length < 3) return { ok: true, result: { message: "Need 3+ data points to forecast." } }; const values = history.map(h => parseFloat(h.demand || h.value) || 0); const n = values.length; const avg = values.reduce((s,v)=>s+v,0)/n; const trend = (values[n-1] - values[0]) / n; const forecast = [1,2,3].map(p => ({ period: `+${p}`, predicted: Math.round(avg + trend * (n + p - 1)), confidence: p === 1 ? "high" : p === 2 ? "medium" : "low" })); return { ok: true, result: { historicalPeriods: n, avgDemand: Math.round(avg), trend: trend > 0.5 ? "increasing" : trend < -0.5 ? "decreasing" : "stable", forecast } }; });

  // ─── Supply-chain planning substrate (per-user, STATE-backed) ────────
  // Powers the SAP-IBP-parity workbench: live shipment tracking, supply
  // network/BOM graph, multi-echelon inventory, what-if scenarios,
  // seasonal forecasting, exception management, PO workflow, spend.

  function scState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.supplychainLens) STATE.supplychainLens = {};
    const s = STATE.supplychainLens;
    if (!(s.shipments instanceof Map)) s.shipments = new Map();   // userId -> Array<shipment>
    if (!(s.network instanceof Map)) s.network = new Map();       // userId -> { nodes:[], edges:[] }
    if (!(s.scenarios instanceof Map)) s.scenarios = new Map();   // userId -> Array<scenario>
    if (!(s.workOrders instanceof Map)) s.workOrders = new Map(); // userId -> Array<workOrder>
    return s;
  }
  function scSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const scActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const scId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const scClean = (v, max = 240) => String(v == null ? "" : v).trim().slice(0, max);
  const scNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const scArr = (s, map, userId) => { if (!map.has(userId)) map.set(userId, []); return map.get(userId); };

  // Deterministic geo-coordinate lookup for common shipment hubs so the
  // network/route map renders real positions without an external API.
  const HUB_COORDS = {
    shanghai: [31.23, 121.47], shenzhen: [22.54, 114.06], ningbo: [29.87, 121.54],
    singapore: [1.29, 103.85], "hong kong": [22.32, 114.17], busan: [35.18, 129.08],
    rotterdam: [51.95, 4.14], hamburg: [53.55, 9.99], antwerp: [51.26, 4.40],
    "los angeles": [33.74, -118.27], "long beach": [33.75, -118.19], "new york": [40.71, -74.01],
    savannah: [32.08, -81.10], houston: [29.76, -95.37], chicago: [41.88, -87.63],
    dubai: [25.20, 55.27], mumbai: [19.08, 72.88], tokyo: [35.68, 139.69],
    london: [51.51, -0.13], "san francisco": [37.77, -122.42], dallas: [32.78, -96.80],
    atlanta: [33.75, -84.39], seattle: [47.61, -122.33], memphis: [35.15, -90.05],
  };
  function geoFor(place) {
    if (!place) return null;
    const key = String(place).trim().toLowerCase();
    if (HUB_COORDS[key]) return HUB_COORDS[key];
    for (const [k, v] of Object.entries(HUB_COORDS)) if (key.includes(k) || k.includes(key)) return v;
    // Stable pseudo-coordinate derived from the name so a node still maps.
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return [((h % 1400) / 10) - 70, ((h >> 8) % 3600) / 10 - 180];
  }

  // ── 1. Shipment tracking — live status, ETA drift, route map ─────────
  registerLensAction("supplychain", "shipmentCreate", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const userId = scActor(ctx);
      const arr = scArr(s, s.shipments, userId);
      const now = Date.now();
      const sh = {
        id: scId("ship"), reference: scClean(params?.reference) || `SHP-${arr.length + 1}`,
        carrier: scClean(params?.carrier) || "Unassigned",
        trackingNumber: scClean(params?.trackingNumber),
        origin: scClean(params?.origin), destination: scClean(params?.destination),
        status: "booked", value: scNum(params?.value),
        plannedEtaDays: Math.max(1, scNum(params?.plannedEtaDays, 14)),
        createdAt: now, etaAt: now + Math.max(1, scNum(params?.plannedEtaDays, 14)) * 86400000,
        checkpoints: [{ at: now, status: "booked", location: scClean(params?.origin) || "origin" }],
      };
      arr.unshift(sh); scSave();
      return { ok: true, result: { shipment: sh } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "shipmentCheckpoint", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const arr = scArr(s, s.shipments, scActor(ctx));
      const sh = arr.find(x => x.id === params?.shipmentId);
      if (!sh) return { ok: false, error: "shipment not found" };
      const STATUSES = ["booked", "picked_up", "in_transit", "customs", "out_for_delivery", "delivered", "exception"];
      const status = STATUSES.includes(params?.status) ? params.status : "in_transit";
      const now = Date.now();
      sh.checkpoints.push({ at: now, status, location: scClean(params?.location) || "in transit" });
      sh.status = status;
      if (status === "delivered") sh.deliveredAt = now;
      scSave();
      return { ok: true, result: { shipment: sh } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "shipmentList", (ctx, _artifact, _params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const arr = scArr(s, s.shipments, scActor(ctx));
      const now = Date.now();
      const shipments = arr.map(sh => {
        const delivered = sh.status === "delivered";
        const etaDriftDays = delivered
          ? Math.round(((sh.deliveredAt - sh.createdAt) / 86400000) - sh.plannedEtaDays)
          : Math.round((now - sh.etaAt) / 86400000);
        const late = !delivered && now > sh.etaAt;
        return {
          ...sh,
          etaDriftDays,
          late,
          health: sh.status === "exception" ? "exception" : late ? "delayed" : delivered ? "delivered" : "on_track",
          route: [
            { id: `${sh.id}_o`, lat: geoFor(sh.origin)?.[0], lon: geoFor(sh.origin)?.[1], label: sh.origin || "Origin", tone: "info" },
            { id: `${sh.id}_d`, lat: geoFor(sh.destination)?.[0], lon: geoFor(sh.destination)?.[1], label: sh.destination || "Destination", tone: delivered ? "good" : late ? "bad" : "default" },
          ].filter(p => Number.isFinite(p.lat)),
        };
      });
      return {
        ok: true,
        result: {
          shipments,
          inTransit: shipments.filter(x => !["delivered", "exception"].includes(x.status)).length,
          delivered: shipments.filter(x => x.status === "delivered").length,
          delayed: shipments.filter(x => x.late).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "shipmentDelete", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      if (!s.shipments.has(scActor(ctx))) return { ok: true, result: { removed: 0 } };
      const arr = s.shipments.get(scActor(ctx));
      const before = arr.length;
      s.shipments.set(scActor(ctx), arr.filter(x => x.id !== params?.shipmentId));
      scSave();
      return { ok: true, result: { removed: before - s.shipments.get(scActor(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 2. Supply network / BOM — node graph supplier→warehouse→customer ─
  registerLensAction("supplychain", "networkSet", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const userId = scActor(ctx);
      const nodes = Array.isArray(params?.nodes) ? params.nodes.slice(0, 200).map(n => ({
        id: scClean(n?.id) || scId("node"),
        label: scClean(n?.label) || "Node",
        kind: ["supplier", "warehouse", "factory", "customer"].includes(n?.kind) ? n.kind : "warehouse",
        location: scClean(n?.location),
        capacity: scNum(n?.capacity),
      })) : [];
      const ids = new Set(nodes.map(n => n.id));
      const edges = Array.isArray(params?.edges) ? params.edges.slice(0, 400)
        .filter(e => ids.has(e?.from) && ids.has(e?.to))
        .map(e => ({ from: e.from, to: e.to, leadTimeDays: scNum(e?.leadTimeDays, 7), volume: scNum(e?.volume) })) : [];
      s.network.set(userId, { nodes, edges });
      scSave();
      return { ok: true, result: { nodeCount: nodes.length, edgeCount: edges.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "networkGraph", (ctx, _artifact, _params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const net = s.network.get(scActor(ctx)) || { nodes: [], edges: [] };
      const { nodes, edges } = net;
      // Build a supplier-rooted tree for TreeDiagram + map markers + critical-path tier.
      const outgoing = new Map();
      const indeg = new Map();
      for (const n of nodes) { outgoing.set(n.id, []); indeg.set(n.id, 0); }
      for (const e of edges) { if (outgoing.has(e.from)) outgoing.get(e.from).push(e); if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1); }
      const TONE = { supplier: "info", factory: "warn", warehouse: "default", customer: "good" };
      const byId = new Map(nodes.map(n => [n.id, n]));
      const seen = new Set();
      const buildTree = (id, depth) => {
        const n = byId.get(id); if (!n || depth > 8 || seen.has(id)) return null;
        seen.add(id);
        return {
          id: n.id, label: `${n.label} (${n.kind})`,
          detail: n.location || (n.capacity ? `cap ${n.capacity}` : ""),
          tone: TONE[n.kind] || "default",
          children: (outgoing.get(id) || []).map(e => buildTree(e.to, depth + 1)).filter(Boolean),
        };
      };
      const roots = nodes.filter(n => (indeg.get(n.id) || 0) === 0);
      const tree = roots.map(r => buildTree(r.id, 0)).filter(Boolean);
      // Longest cumulative lead-time path = critical path.
      const memo = new Map();
      const longest = (id, guard) => {
        if (memo.has(id)) return memo.get(id);
        if (guard.has(id)) return 0;
        guard.add(id);
        let best = 0;
        for (const e of (outgoing.get(id) || [])) best = Math.max(best, e.leadTimeDays + longest(e.to, guard));
        guard.delete(id);
        memo.set(id, best);
        return best;
      };
      const criticalLeadTime = roots.length ? Math.max(0, ...roots.map(r => longest(r.id, new Set()))) : 0;
      const markers = nodes.map(n => {
        const g = geoFor(n.location || n.label);
        return { id: n.id, lat: g?.[0], lon: g?.[1], label: n.label, value: n.capacity, tone: TONE[n.kind] || "default" };
      }).filter(m => Number.isFinite(m.lat));
      return {
        ok: true,
        result: {
          tree, markers,
          counts: {
            supplier: nodes.filter(n => n.kind === "supplier").length,
            factory: nodes.filter(n => n.kind === "factory").length,
            warehouse: nodes.filter(n => n.kind === "warehouse").length,
            customer: nodes.filter(n => n.kind === "customer").length,
          },
          edgeCount: edges.length,
          criticalLeadTime,
          orphans: nodes.filter(n => (indeg.get(n.id) || 0) === 0 && (outgoing.get(n.id) || []).length === 0).map(n => n.label),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 3. Multi-echelon inventory optimization across warehouses ────────
  registerLensAction("supplychain", "multiEchelonOptimize", (ctx, _artifact, params) => {
    try {
      const echelons = Array.isArray(params?.echelons) ? params.echelons : [];
      if (echelons.length === 0) return { ok: true, result: { message: "Add warehouse echelons (location, dailyDemand, leadTimeDays, currentStock) to optimize." } };
      const Z = scNum(params?.serviceLevelZ, 1.65); // ~95% service level
      const analyzed = echelons.map(ec => {
        const demand = Math.max(0, scNum(ec?.dailyDemand, 1));
        const leadTime = Math.max(1, scNum(ec?.leadTimeDays, 7));
        const sigma = Math.max(0, scNum(ec?.demandStdDev, demand * 0.3));
        const current = Math.max(0, scNum(ec?.currentStock));
        // Echelon safety stock = Z * sigma * sqrt(leadTime).
        const safetyStock = Math.ceil(Z * sigma * Math.sqrt(leadTime));
        const reorderPoint = Math.ceil(demand * leadTime + safetyStock);
        const cycleStock = Math.ceil(demand * leadTime);
        return {
          location: scClean(ec?.location) || "Echelon",
          tier: scClean(ec?.tier) || "regional",
          dailyDemand: demand, leadTimeDays: leadTime,
          currentStock: current, cycleStock, safetyStock, reorderPoint,
          targetStock: cycleStock + safetyStock,
          daysOfStock: demand > 0 ? Math.round(current / demand) : 999,
          imbalance: current - (cycleStock + safetyStock),
          needsReplenish: current <= reorderPoint,
        };
      });
      // Network rebalance: move excess from over-stocked to deficit nodes.
      const surplus = analyzed.filter(a => a.imbalance > 0).sort((a, b) => b.imbalance - a.imbalance);
      const deficit = analyzed.filter(a => a.imbalance < 0).sort((a, b) => a.imbalance - b.imbalance);
      const transfers = [];
      let si = 0;
      for (const d of deficit) {
        let need = -d.imbalance;
        while (need > 0 && si < surplus.length) {
          const src = surplus[si];
          const move = Math.min(need, src.imbalance);
          if (move > 0) {
            transfers.push({ from: src.location, to: d.location, units: move });
            src.imbalance -= move; need -= move;
          }
          if (src.imbalance <= 0) si++;
        }
      }
      return {
        ok: true,
        result: {
          echelons: analyzed,
          totalSafetyStock: analyzed.reduce((s, a) => s + a.safetyStock, 0),
          totalTargetStock: analyzed.reduce((s, a) => s + a.targetStock, 0),
          needsReplenish: analyzed.filter(a => a.needsReplenish).length,
          rebalanceTransfers: transfers,
          serviceLevelZ: Z,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 4. What-if scenario planning — disruption + alternate sourcing ───
  registerLensAction("supplychain", "scenarioSimulate", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const userId = scActor(ctx);
      const baseDemand = Math.max(0, scNum(params?.baseDailyDemand, 100));
      const baseLeadTime = Math.max(1, scNum(params?.baseLeadTimeDays, 14));
      const baseUnitCost = Math.max(0, scNum(params?.baseUnitCost, 10));
      const onHand = Math.max(0, scNum(params?.currentStock, baseDemand * baseLeadTime));
      const disruption = scClean(params?.disruption) || "none";
      // Disruption multipliers: lead-time inflation, demand shock, cost shock.
      const DISRUPTIONS = {
        none: { lead: 1, demand: 1, cost: 1 },
        port_closure: { lead: 2.2, demand: 1, cost: 1.15 },
        supplier_failure: { lead: 1.8, demand: 1, cost: 1.35 },
        demand_spike: { lead: 1, demand: 1.6, cost: 1.1 },
        transport_strike: { lead: 1.7, demand: 1, cost: 1.25 },
        material_shortage: { lead: 1.4, demand: 1, cost: 1.5 },
      };
      const d = DISRUPTIONS[disruption] || DISRUPTIONS.none;
      // NOTE: no Math.max(1, …) floor here — a 0 default must stay 0 so the
      // `altLeadTime > 0` gate below skips a phantom alternate source when the
      // caller supplies none (the floor made every scenario fabricate a magic
      // 1-day alternate that always won the ranking).
      const altLeadTime = Math.max(0, scNum(params?.altLeadTimeDays, 0));
      const altUnitCost = Math.max(0, scNum(params?.altUnitCost, 0));
      const evalSource = (lead, cost, label) => {
        const effLead = Math.ceil(lead * d.lead);
        const effDemand = baseDemand * d.demand;
        const effCost = cost * d.cost;
        const demandDuringLead = effDemand * effLead;
        const stockoutUnits = Math.max(0, demandDuringLead - onHand);
        const daysToStockout = effDemand > 0 ? Math.floor(onHand / effDemand) : 999;
        return {
          source: label,
          effectiveLeadTimeDays: effLead,
          effectiveUnitCost: Math.round(effCost * 100) / 100,
          demandDuringLead: Math.round(demandDuringLead),
          projectedStockoutUnits: Math.round(stockoutUnits),
          daysToStockout,
          replenishCost: Math.round(demandDuringLead * effCost),
          stocksOut: stockoutUnits > 0,
        };
      };
      const primary = evalSource(baseLeadTime, baseUnitCost, "Primary source");
      const options = [primary];
      if (altLeadTime > 0) options.push(evalSource(altLeadTime, altUnitCost || baseUnitCost, "Alternate source"));
      const ranked = [...options].sort((a, b) =>
        (a.projectedStockoutUnits - b.projectedStockoutUnits) || (a.replenishCost - b.replenishCost));
      const scenario = {
        id: scId("scn"), name: scClean(params?.name) || `${disruption} scenario`,
        disruption, baseDemand, baseLeadTime, baseUnitCost, onHand,
        options, recommendation: ranked[0]?.source,
        resilient: !ranked[0]?.stocksOut, createdAt: Date.now(),
      };
      const arr = scArr(s, s.scenarios, userId);
      arr.unshift(scenario);
      if (arr.length > 50) arr.length = 50;
      scSave();
      return { ok: true, result: scenario };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "scenarioList", (ctx, _artifact, _params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      return { ok: true, result: { scenarios: scArr(s, s.scenarios, scActor(ctx)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "scenarioDelete", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      if (!s.scenarios.has(scActor(ctx))) return { ok: true, result: { removed: 0 } };
      const arr = s.scenarios.get(scActor(ctx));
      const before = arr.length;
      s.scenarios.set(scActor(ctx), arr.filter(x => x.id !== params?.scenarioId));
      scSave();
      return { ok: true, result: { removed: before - s.scenarios.get(scActor(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 5. Better forecasting — seasonality + exponential smoothing ──────
  registerLensAction("supplychain", "seasonalForecast", (ctx, _artifact, params) => {
    try {
      const history = Array.isArray(params?.history) ? params.history : [];
      const values = history.map(h => (typeof h === "object" ? scNum(h?.demand ?? h?.value) : scNum(h)));
      if (values.length < 4) return { ok: true, result: { message: "Need 4+ data points for seasonal forecasting." } };
      const n = values.length;
      const periods = Math.max(2, Math.min(scNum(params?.seasonLength, 4), Math.floor(n / 2)));
      const alpha = Math.min(0.95, Math.max(0.05, scNum(params?.alpha, 0.4)));   // level
      const beta = Math.min(0.95, Math.max(0.01, scNum(params?.beta, 0.15)));    // trend
      const gamma = Math.min(0.95, Math.max(0.01, scNum(params?.gamma, 0.25)));  // seasonal
      // Holt-Winters additive triple exponential smoothing.
      const seasonAvg = [];
      const cycles = Math.floor(n / periods);
      for (let c = 0; c < cycles; c++) {
        let sum = 0;
        for (let i = 0; i < periods; i++) sum += values[c * periods + i];
        seasonAvg.push(sum / periods);
      }
      let level = seasonAvg[0];
      let trend = (seasonAvg[Math.min(1, cycles - 1)] - seasonAvg[0]) / periods;
      const seasonal = [];
      for (let i = 0; i < periods; i++) {
        let acc = 0;
        for (let c = 0; c < cycles; c++) acc += values[c * periods + i] - seasonAvg[c];
        seasonal[i] = acc / cycles;
      }
      const fitted = [];
      for (let i = 0; i < n; i++) {
        const si = i % periods;
        const predicted = level + trend + seasonal[si];
        fitted.push(Math.round(predicted));
        const lastLevel = level;
        level = alpha * (values[i] - seasonal[si]) + (1 - alpha) * (level + trend);
        trend = beta * (level - lastLevel) + (1 - beta) * trend;
        seasonal[si] = gamma * (values[i] - level) + (1 - gamma) * seasonal[si];
      }
      // Mean absolute percentage error over the fit.
      let mape = 0, cnt = 0;
      for (let i = periods; i < n; i++) {
        if (values[i] !== 0) { mape += Math.abs((values[i] - fitted[i]) / values[i]); cnt++; }
      }
      mape = cnt > 0 ? Math.round((mape / cnt) * 1000) / 10 : 0;
      const horizon = Math.max(1, Math.min(scNum(params?.horizon, periods), 12));
      const forecast = [];
      for (let h = 1; h <= horizon; h++) {
        const si = (n + h - 1) % periods;
        forecast.push({
          period: `+${h}`,
          predicted: Math.max(0, Math.round(level + h * trend + seasonal[si])),
          confidence: h <= periods ? (h <= periods / 2 ? "high" : "medium") : "low",
        });
      }
      return {
        ok: true,
        result: {
          method: "holt-winters-additive",
          seasonLength: periods, alpha, beta, gamma,
          mapePct: mape,
          accuracy: mape <= 10 ? "excellent" : mape <= 20 ? "good" : mape <= 35 ? "fair" : "poor",
          trend: trend > 0.5 ? "increasing" : trend < -0.5 ? "decreasing" : "stable",
          seasonalIndices: seasonal.map(v => Math.round(v * 10) / 10),
          fitted, forecast,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 6. Alerts / exceptions dashboard ────────────────────────────────
  registerLensAction("supplychain", "exceptionScan", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const userId = scActor(ctx);
      const now = Date.now();
      const alerts = [];
      // Stockouts / low-stock from supplied inventory rows.
      const inventory = Array.isArray(params?.inventory) ? params.inventory : [];
      for (const it of inventory) {
        const cur = scNum(it?.currentStock);
        const rop = scNum(it?.reorderPoint, scNum(it?.dailyDemand) * scNum(it?.leadTimeDays, 7));
        const dd = scNum(it?.dailyDemand);
        if (cur <= 0) alerts.push({ id: scId("alx"), severity: "critical", kind: "stockout", subject: scClean(it?.name) || "item", message: `${scClean(it?.name) || "Item"} is out of stock`, detail: dd > 0 ? `${dd}/day demand unmet` : "" });
        else if (rop > 0 && cur <= rop) alerts.push({ id: scId("alx"), severity: "warning", kind: "low_stock", subject: scClean(it?.name) || "item", message: `${scClean(it?.name) || "Item"} below reorder point`, detail: `${cur} on hand vs ROP ${rop}` });
      }
      // Late / exception shipments from STATE.
      for (const sh of scArr(s, s.shipments, userId)) {
        if (sh.status === "delivered") continue;
        if (sh.status === "exception") alerts.push({ id: scId("alx"), severity: "critical", kind: "shipment_exception", subject: sh.reference, message: `Shipment ${sh.reference} flagged exception`, detail: `${sh.origin || "?"} -> ${sh.destination || "?"}` });
        else if (now > sh.etaAt) { const lateDays = Math.round((now - sh.etaAt) / 86400000); alerts.push({ id: scId("alx"), severity: lateDays > 5 ? "critical" : "warning", kind: "late_shipment", subject: sh.reference, message: `Shipment ${sh.reference} is ${lateDays}d late`, detail: `carrier ${sh.carrier}` }); }
      }
      // At-risk suppliers from supplied supplier scores.
      const suppliers = Array.isArray(params?.suppliers) ? params.suppliers : [];
      for (const sup of suppliers) {
        const q = scNum(sup?.qualityScore, 70), del = scNum(sup?.onTimePercent, 80);
        if (q < 50 || del < 60) alerts.push({ id: scId("alx"), severity: "warning", kind: "at_risk_supplier", subject: scClean(sup?.name) || "supplier", message: `${scClean(sup?.name) || "Supplier"} performance at risk`, detail: `quality ${q}, on-time ${del}%` });
      }
      // Overdue work orders.
      for (const wo of scArr(s, s.workOrders, userId)) {
        if (wo.stage === "received" || wo.stage === "closed") continue;
        if (wo.dueAt && now > wo.dueAt) alerts.push({ id: scId("alx"), severity: "warning", kind: "overdue_po", subject: wo.poNumber || wo.id, message: `PO ${wo.poNumber || wo.id} overdue at stage ${wo.stage}`, detail: scClean(wo.item) });
      }
      const order = { critical: 0, warning: 1, info: 2 };
      alerts.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
      return {
        ok: true,
        result: {
          alerts,
          critical: alerts.filter(a => a.severity === "critical").length,
          warning: alerts.filter(a => a.severity === "warning").length,
          byKind: alerts.reduce((m, a) => { m[a.kind] = (m[a.kind] || 0) + 1; return m; }, {}),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 7. Order → PO → receipt workflow automation ─────────────────────
  const WO_STAGES = ["requisition", "approved", "ordered", "shipped", "received", "closed"];
  registerLensAction("supplychain", "workOrderCreate", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const userId = scActor(ctx);
      const arr = scArr(s, s.workOrders, userId);
      const qty = Math.max(1, scNum(params?.quantity, 1));
      const unitCost = Math.max(0, scNum(params?.unitCost));
      const now = Date.now();
      const wo = {
        id: scId("wo"),
        poNumber: scClean(params?.poNumber) || `PO-${1000 + arr.length}`,
        item: scClean(params?.item) || "Item",
        supplier: scClean(params?.supplier),
        quantity: qty, unitCost, totalCost: Math.round(qty * unitCost * 100) / 100,
        stage: "requisition",
        createdAt: now,
        dueAt: now + Math.max(1, scNum(params?.leadTimeDays, 14)) * 86400000,
        receivedQty: 0,
        history: [{ at: now, stage: "requisition" }],
      };
      arr.unshift(wo); scSave();
      return { ok: true, result: { workOrder: wo } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "workOrderAdvance", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const arr = scArr(s, s.workOrders, scActor(ctx));
      const wo = arr.find(x => x.id === params?.workOrderId);
      if (!wo) return { ok: false, error: "work order not found" };
      const target = params?.stage && WO_STAGES.includes(params.stage)
        ? params.stage
        : WO_STAGES[Math.min(WO_STAGES.indexOf(wo.stage) + 1, WO_STAGES.length - 1)];
      const curIdx = WO_STAGES.indexOf(wo.stage);
      const tgtIdx = WO_STAGES.indexOf(target);
      if (tgtIdx < curIdx) return { ok: false, error: "cannot move work order backward" };
      wo.stage = target;
      if (target === "received") wo.receivedQty = Math.min(wo.quantity, scNum(params?.receivedQty, wo.quantity));
      wo.history.push({ at: Date.now(), stage: target });
      scSave();
      return { ok: true, result: { workOrder: wo } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "workOrderList", (ctx, _artifact, _params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const arr = scArr(s, s.workOrders, scActor(ctx));
      const now = Date.now();
      const workOrders = arr.map(wo => ({
        ...wo,
        overdue: wo.stage !== "received" && wo.stage !== "closed" && wo.dueAt && now > wo.dueAt,
        progressPct: Math.round((WO_STAGES.indexOf(wo.stage) / (WO_STAGES.length - 1)) * 100),
      }));
      const byStage = WO_STAGES.reduce((m, st) => { m[st] = workOrders.filter(w => w.stage === st).length; return m; }, {});
      return {
        ok: true,
        result: {
          workOrders, byStage, stages: WO_STAGES,
          openValue: workOrders.filter(w => w.stage !== "received" && w.stage !== "closed").reduce((s2, w) => s2 + w.totalCost, 0),
          overdueCount: workOrders.filter(w => w.overdue).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("supplychain", "workOrderDelete", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      if (!s.workOrders.has(scActor(ctx))) return { ok: true, result: { removed: 0 } };
      const arr = s.workOrders.get(scActor(ctx));
      const before = arr.length;
      s.workOrders.set(scActor(ctx), arr.filter(x => x.id !== params?.workOrderId));
      scSave();
      return { ok: true, result: { removed: before - s.workOrders.get(scActor(ctx)).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── 8. Cost / spend analytics — supplier-spend breakdown ─────────────
  registerLensAction("supplychain", "spendAnalytics", (ctx, _artifact, params) => {
    try {
      const s = scState(); if (!s) return { ok: false, error: "state unavailable" };
      const userId = scActor(ctx);
      // Aggregate spend from supplied orders + STATE work orders.
      const rows = [];
      for (const o of (Array.isArray(params?.orders) ? params.orders : [])) {
        const total = scNum(o?.totalCost, scNum(o?.quantity) * scNum(o?.unitCost));
        if (total > 0) rows.push({ supplier: scClean(o?.supplier) || "Unknown", category: scClean(o?.category) || "Uncategorized", amount: total });
      }
      for (const wo of scArr(s, s.workOrders, userId)) {
        if (wo.totalCost > 0) rows.push({ supplier: wo.supplier || "Unknown", category: scClean(wo.category) || "Procurement", amount: wo.totalCost });
      }
      if (rows.length === 0) return { ok: true, result: { message: "Add orders or work orders with cost to analyze spend.", totalSpend: 0, bySupplier: [], byCategory: [] } };
      const totalSpend = rows.reduce((sum, r) => sum + r.amount, 0);
      const group = (key) => {
        const m = new Map();
        for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + r.amount);
        return [...m.entries()]
          .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100, sharePct: Math.round((amount / totalSpend) * 1000) / 10 }))
          .sort((a, b) => b.amount - a.amount);
      };
      const bySupplier = group("supplier");
      const byCategory = group("category");
      // Pareto: how many suppliers cover 80% of spend.
      let cum = 0, paretoCount = 0;
      for (const sup of bySupplier) { cum += sup.amount; paretoCount++; if (cum >= totalSpend * 0.8) break; }
      return {
        ok: true,
        result: {
          totalSpend: Math.round(totalSpend * 100) / 100,
          lineItems: rows.length,
          supplierCount: bySupplier.length,
          bySupplier, byCategory,
          topSupplier: bySupplier[0] || null,
          avgLineItem: Math.round((totalSpend / rows.length) * 100) / 100,
          paretoSupplierCount: paretoCount,
          paretoConcentration: bySupplier.length > 0 ? Math.round((paretoCount / bySupplier.length) * 100) : 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
