// server/domains/construction.js
// Domain actions for construction: takeoff estimation, schedule critical path,
// safety compliance, change order tracking, progress reporting.

export default function registerConstructionActions(registerLensAction) {
  // Calculator inputs arrive as `artifact.data`. Some callers (the GC bench
  // panel) post `{ input: { artifact: { data } } }`, which the /api/lens/run
  // dispatcher unwraps to virtualArtifact.data = { artifact: { data } } — a
  // double-wrap that silently strands every calculator on its empty default
  // (the carpentry-sibling dead-calculator class). `calcData(artifact)` peels
  // exactly one such redundant layer so the calculator reads the real payload
  // whether the caller single- or double-wrapped.
  const calcData = (artifact) => {
    const d = artifact?.data;
    if (d && typeof d === "object" && d.artifact && typeof d.artifact === "object" && d.artifact.data && typeof d.artifact.data === "object") {
      return d.artifact.data;
    }
    return d || {};
  };
  // Fail-CLOSED numeric coercion: parseFloat lets 'Infinity'/'1e999' through as
  // a non-finite value, which would propagate Infinity/NaN through the cost
  // roll-ups and TRIR. finNum collapses any non-finite (or absurd-magnitude)
  // input to a fallback so every downstream total stays FINITE.
  const finNum = (v, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : fallback;
  };

  registerLensAction("construction", "takeoffEstimate", (ctx, artifact, _params) => {
    const cdata = calcData(artifact);
    const items = cdata.lineItems || [];
    if (items.length === 0) return { ok: true, result: { message: "Add line items with quantity, unit, and unit cost." } };
    const estimated = items.map(item => {
      const qty = finNum(item.quantity, 0);
      const unitCost = finNum(item.unitCost, 0);
      const wastePercent = Number.isFinite(finNum(item.wastePercent, NaN)) ? finNum(item.wastePercent, 10) : 10;
      const adjustedQty = qty * (1 + wastePercent / 100);
      return { description: item.description || item.name, quantity: qty, unit: item.unit || "each", unitCost, wastePercent, adjustedQuantity: Math.ceil(adjustedQty), lineCost: Math.round(adjustedQty * unitCost * 100) / 100 };
    });
    const subtotalMaterials = estimated.reduce((s, e) => s + e.lineCost, 0);
    const laborPercent = Number.isFinite(finNum(cdata.laborPercent, NaN)) ? finNum(cdata.laborPercent, 40) : 40;
    const laborCost = Math.round(subtotalMaterials * (laborPercent / 100) * 100) / 100;
    const overhead = Math.round((subtotalMaterials + laborCost) * 0.15 * 100) / 100;
    const profit = Math.round((subtotalMaterials + laborCost + overhead) * 0.10 * 100) / 100;
    const total = Math.round((subtotalMaterials + laborCost + overhead + profit) * 100) / 100;
    const sqft = finNum(cdata.squareFootage, 0);
    return { ok: true, result: { lineItems: estimated, subtotalMaterials: Math.round(subtotalMaterials * 100) / 100, laborCost, overhead, profit, grandTotal: total, costPerSqFt: sqft > 0 ? Math.round(total / sqft * 100) / 100 : null } };
  });

  registerLensAction("construction", "criticalPath", (ctx, artifact, _params) => {
    const tasks = calcData(artifact).tasks || [];
    if (tasks.length === 0) return { ok: true, result: { message: "Add tasks with duration and dependencies." } };
    const taskMap = {};
    tasks.forEach(t => { taskMap[t.name || t.id] = { name: t.name || t.id, duration: parseInt(t.duration) || 1, deps: t.dependencies || [], earlyStart: 0, earlyFinish: 0, lateStart: 0, lateFinish: 0, slack: 0 }; });
    // Forward pass
    const order = Object.values(taskMap);
    for (const t of order) {
      const maxPredFinish = t.deps.reduce((m, d) => Math.max(m, taskMap[d]?.earlyFinish || 0), 0);
      t.earlyStart = maxPredFinish;
      t.earlyFinish = t.earlyStart + t.duration;
    }
    const projectDuration = Math.max(...order.map(t => t.earlyFinish));
    // Backward pass
    for (const t of [...order].reverse()) {
      const successors = order.filter(s => s.deps.includes(t.name));
      t.lateFinish = successors.length > 0 ? Math.min(...successors.map(s => s.lateStart)) : projectDuration;
      t.lateStart = t.lateFinish - t.duration;
      t.slack = t.lateStart - t.earlyStart;
    }
    const criticalPath = order.filter(t => t.slack === 0).map(t => t.name);
    return { ok: true, result: { projectDuration, criticalPath, tasks: order.map(t => ({ name: t.name, duration: t.duration, earlyStart: t.earlyStart, earlyFinish: t.earlyFinish, slack: t.slack, onCriticalPath: t.slack === 0 })), totalTasks: tasks.length } };
  });

  registerLensAction("construction", "safetyCompliance", (ctx, artifact, _params) => {
    const data = calcData(artifact);
    const checklistItems = data.safetyChecklist || [];
    const incidents = data.incidents || [];
    const workers = parseInt(data.workerCount) || 1;
    const hoursWorked = parseInt(data.totalHoursWorked) || 0;
    const compliant = checklistItems.filter(c => c.passed || c.compliant).length;
    const total = checklistItems.length || 1;
    const complianceRate = Math.round((compliant / total) * 100);
    const incidentRate = hoursWorked > 0 ? Math.round((incidents.length / hoursWorked) * 200000 * 100) / 100 : 0; // OSHA incident rate formula
    return { ok: true, result: { complianceRate, checklistResults: { passed: compliant, failed: total - compliant, total }, incidentRate, incidentRateLabel: "per 200,000 hours worked", incidents: incidents.length, workers, hoursWorked, rating: complianceRate >= 95 ? "excellent" : complianceRate >= 80 ? "acceptable" : "needs-improvement", criticalFailures: checklistItems.filter(c => !c.passed && c.critical).map(c => c.item || c.name) } };
  });

  registerLensAction("construction", "progressReport", (ctx, artifact, _params) => {
    const phases = calcData(artifact).phases || [];
    if (phases.length === 0) return { ok: true, result: { message: "Add project phases with planned vs actual progress." } };
    const analyzed = phases.map(p => {
      const planned = finNum(p.plannedPercent, 0);
      const actual = finNum(p.actualPercent, 0);
      const variance = actual - planned;
      return { phase: p.name, plannedPercent: planned, actualPercent: actual, variance, status: variance >= 0 ? "on-track" : variance >= -10 ? "slightly-behind" : "behind-schedule" };
    });
    const overallPlanned = analyzed.reduce((s, p) => s + p.plannedPercent, 0) / analyzed.length;
    const overallActual = analyzed.reduce((s, p) => s + p.actualPercent, 0) / analyzed.length;
    return { ok: true, result: { phases: analyzed, overallPlannedPercent: Math.round(overallPlanned), overallActualPercent: Math.round(overallActual), overallVariance: Math.round(overallActual - overallPlanned), projectStatus: overallActual >= overallPlanned ? "on-schedule" : overallActual >= overallPlanned - 10 ? "minor-delay" : "significant-delay", behindPhases: analyzed.filter(p => p.status === "behind-schedule").map(p => p.phase) } };
  });

  // ─── Parity-sprint: field-management core (RFI, submittals, daily log,
  //     punch list, change orders, drawings, budget) ──

  function getConState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.conLens) STATE.conLens = {};
    const s = STATE.conLens;
    for (const k of ["rfis", "submittals", "dailyLogs", "punchItems", "changeOrders", "drawings", "budgets"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveConState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actorId = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const list = (state, key, userId) => state[key].get(userId) || [];

  // ── RFI workflow — submit / respond / track with ball-in-court ──
  registerLensAction("construction", "rfi-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "rfis", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      if (params.status) rows = rows.filter(r => r.status === params.status);
      const open = rows.filter(r => r.status !== "closed").length;
      const overdue = rows.filter(r => r.status !== "closed" && r.dueDate && new Date(r.dueDate) < new Date()).length;
      return { ok: true, result: { rfis: rows, open, overdue, total: rows.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "rfi-submit", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const subject = String(params.subject || "").trim();
      if (!subject) return { ok: false, error: "subject required" };
      if (!state.rfis.has(userId)) state.rfis.set(userId, []);
      const rows = state.rfis.get(userId);
      const number = `RFI-${String(rows.length + 1).padStart(3, "0")}`;
      const rfi = {
        id: uid("rfi"), number, jobId: params.jobId || null,
        subject, question: String(params.question || ""),
        discipline: params.discipline || "General",
        priority: ["low", "normal", "high", "critical"].includes(params.priority) ? params.priority : "normal",
        ballInCourt: params.ballInCourt || "Architect",
        status: "open", response: "", respondedBy: "", respondedAt: null,
        dueDate: params.dueDate || null,
        submittedBy: params.submittedBy || "GC",
        createdAt: new Date().toISOString(),
      };
      rows.push(rfi);
      saveConState();
      return { ok: true, result: { rfi } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "rfi-respond", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.rfis.get(actorId(ctx)) || [];
      const rfi = rows.find(r => r.id === params.id);
      if (!rfi) return { ok: false, error: "RFI not found" };
      const response = String(params.response || "").trim();
      if (!response) return { ok: false, error: "response required" };
      rfi.response = response;
      rfi.respondedBy = params.respondedBy || "Architect";
      rfi.respondedAt = new Date().toISOString();
      rfi.status = "answered";
      rfi.ballInCourt = "GC";
      saveConState();
      return { ok: true, result: { rfi } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "rfi-close", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.rfis.get(actorId(ctx)) || [];
      const rfi = rows.find(r => r.id === params.id);
      if (!rfi) return { ok: false, error: "RFI not found" };
      rfi.status = "closed";
      rfi.ballInCourt = "—";
      saveConState();
      return { ok: true, result: { rfi } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "rfi-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.rfis.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "RFI not found" };
      rows.splice(idx, 1);
      state.rfis.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Submittals log — spec-section tracking with review cycles ──
  registerLensAction("construction", "submittal-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "submittals", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      const byStatus = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      return { ok: true, result: { submittals: rows, byStatus, total: rows.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "submittal-create", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const title = String(params.title || "").trim();
      const specSection = String(params.specSection || "").trim();
      if (!title || !specSection) return { ok: false, error: "title and specSection required" };
      if (!state.submittals.has(userId)) state.submittals.set(userId, []);
      const rows = state.submittals.get(userId);
      const sub = {
        id: uid("sub"), number: `SUB-${String(rows.length + 1).padStart(3, "0")}`,
        jobId: params.jobId || null, title, specSection,
        type: ["product_data", "shop_drawing", "sample", "mockup", "certificate"].includes(params.type) ? params.type : "shop_drawing",
        contractor: params.contractor || "",
        status: "draft", revision: 0,
        reviewCycles: [],
        requiredOnSite: params.requiredOnSite || null,
        createdAt: new Date().toISOString(),
      };
      rows.push(sub);
      saveConState();
      return { ok: true, result: { submittal: sub } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "submittal-review", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.submittals.get(actorId(ctx)) || [];
      const sub = rows.find(r => r.id === params.id);
      if (!sub) return { ok: false, error: "submittal not found" };
      const action = params.action;
      const valid = ["approved", "approved_as_noted", "revise_resubmit", "rejected", "for_record"];
      if (!valid.includes(action)) return { ok: false, error: `action must be one of ${valid.join(", ")}` };
      sub.reviewCycles.push({
        cycle: sub.reviewCycles.length + 1, action,
        reviewer: params.reviewer || "Architect",
        comments: String(params.comments || ""),
        at: new Date().toISOString(),
      });
      if (action === "revise_resubmit" || action === "rejected") {
        sub.status = "revise";
        sub.revision += 1;
      } else {
        sub.status = "closed";
      }
      saveConState();
      return { ok: true, result: { submittal: sub } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "submittal-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.submittals.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "submittal not found" };
      rows.splice(idx, 1);
      state.submittals.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Daily log / field reports — weather, manpower, equipment, photos ──
  registerLensAction("construction", "dailylog-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "dailyLogs", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      rows = [...rows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const totalManHours = rows.reduce((s, r) => s + (r.totalManHours || 0), 0);
      return { ok: true, result: { logs: rows, total: rows.length, totalManHours } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "dailylog-create", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const date = String(params.date || "").trim();
      if (!date) return { ok: false, error: "date required" };
      if (!state.dailyLogs.has(userId)) state.dailyLogs.set(userId, []);
      const rows = state.dailyLogs.get(userId);
      const manpower = Array.isArray(params.manpower) ? params.manpower : [];
      const totalManHours = manpower.reduce((s, m) => s + (parseFloat(m.workers) || 0) * (parseFloat(m.hours) || 0), 0);
      const log = {
        id: uid("dlog"), jobId: params.jobId || null, date,
        weather: params.weather || "Clear", tempHigh: params.tempHigh ?? null,
        tempLow: params.tempLow ?? null, conditions: params.conditions || "",
        manpower, equipment: Array.isArray(params.equipment) ? params.equipment : [],
        workCompleted: String(params.workCompleted || ""),
        delays: String(params.delays || ""),
        photos: Array.isArray(params.photos) ? params.photos : [],
        totalManHours: Math.round(totalManHours * 10) / 10,
        author: params.author || "Superintendent",
        createdAt: new Date().toISOString(),
      };
      rows.push(log);
      saveConState();
      return { ok: true, result: { log } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "dailylog-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.dailyLogs.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "log not found" };
      rows.splice(idx, 1);
      state.dailyLogs.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Punch list — photo markup, assignee, due-date close-out ──
  registerLensAction("construction", "punch-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "punchItems", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      const open = rows.filter(r => r.status === "open").length;
      const ready = rows.filter(r => r.status === "ready_to_verify").length;
      const closed = rows.filter(r => r.status === "closed").length;
      const completionPct = rows.length ? Math.round((closed / rows.length) * 100) : 0;
      return { ok: true, result: { items: rows, open, ready, closed, total: rows.length, completionPct } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "punch-add", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const description = String(params.description || "").trim();
      if (!description) return { ok: false, error: "description required" };
      if (!state.punchItems.has(userId)) state.punchItems.set(userId, []);
      const rows = state.punchItems.get(userId);
      const item = {
        id: uid("pl"), number: rows.length + 1, jobId: params.jobId || null,
        description, location: params.location || "",
        trade: params.trade || "General", assignee: params.assignee || "",
        priority: ["low", "normal", "high"].includes(params.priority) ? params.priority : "normal",
        status: "open", dueDate: params.dueDate || null,
        photos: Array.isArray(params.photos) ? params.photos : [],
        markup: String(params.markup || ""),
        createdAt: new Date().toISOString(), closedAt: null,
      };
      rows.push(item);
      saveConState();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "punch-update", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.punchItems.get(actorId(ctx)) || [];
      const item = rows.find(r => r.id === params.id);
      if (!item) return { ok: false, error: "item not found" };
      if (params.status) {
        if (!["open", "in_progress", "ready_to_verify", "closed"].includes(params.status))
          {return { ok: false, error: "invalid status" };}
        item.status = params.status;
        item.closedAt = params.status === "closed" ? new Date().toISOString() : null;
      }
      if (params.assignee !== undefined) item.assignee = params.assignee;
      if (params.markup !== undefined) item.markup = String(params.markup);
      if (Array.isArray(params.photos)) item.photos = params.photos;
      saveConState();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "punch-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.punchItems.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "item not found" };
      rows.splice(idx, 1);
      state.punchItems.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Change orders — request → approval → contract-value sync ──
  registerLensAction("construction", "changeorder-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "changeOrders", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      const approved = rows.filter(r => r.status === "approved");
      const pending = rows.filter(r => r.status === "pending");
      const approvedValue = approved.reduce((s, r) => s + (r.amount || 0), 0);
      const pendingValue = pending.reduce((s, r) => s + (r.amount || 0), 0);
      return { ok: true, result: { changeOrders: rows, total: rows.length, approvedValue: Math.round(approvedValue * 100) / 100, pendingValue: Math.round(pendingValue * 100) / 100, approvedCount: approved.length, pendingCount: pending.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "changeorder-create", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const amount = parseFloat(params.amount);
      if (!Number.isFinite(amount)) return { ok: false, error: "amount must be a number" };
      if (!state.changeOrders.has(userId)) state.changeOrders.set(userId, []);
      const rows = state.changeOrders.get(userId);
      const co = {
        id: uid("co"), number: `CO-${String(rows.length + 1).padStart(3, "0")}`,
        jobId: params.jobId || null, title,
        reason: String(params.reason || ""), description: String(params.description || ""),
        amount: Math.round(amount * 100) / 100,
        scheduleImpactDays: parseInt(params.scheduleImpactDays) || 0,
        status: "pending", requestedBy: params.requestedBy || "GC",
        decidedBy: "", decidedAt: null,
        createdAt: new Date().toISOString(),
      };
      rows.push(co);
      saveConState();
      return { ok: true, result: { changeOrder: co } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "changeorder-decide", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.changeOrders.get(actorId(ctx)) || [];
      const co = rows.find(r => r.id === params.id);
      if (!co) return { ok: false, error: "change order not found" };
      if (!["approved", "rejected"].includes(params.decision))
        {return { ok: false, error: "decision must be approved or rejected" };}
      co.status = params.decision;
      co.decidedBy = params.decidedBy || "Owner";
      co.decidedAt = new Date().toISOString();
      // contract-value sync: cumulative revised contract value for the job
      const jobCOs = rows.filter(r => r.jobId === co.jobId && r.status === "approved");
      const totalApprovedDelta = jobCOs.reduce((s, r) => s + (r.amount || 0), 0);
      saveConState();
      return { ok: true, result: { changeOrder: co, revisedContractDelta: Math.round(totalApprovedDelta * 100) / 100 } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "changeorder-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.changeOrders.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "change order not found" };
      rows.splice(idx, 1);
      state.changeOrders.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Drawing / plan viewer — sheet navigation, markup, version compare ──
  registerLensAction("construction", "drawing-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "drawings", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      if (params.discipline) rows = rows.filter(r => r.discipline === params.discipline);
      rows = [...rows].sort((a, b) => (a.sheetNumber || "").localeCompare(b.sheetNumber || ""));
      const disciplines = [...new Set(rows.map(r => r.discipline))];
      return { ok: true, result: { drawings: rows, total: rows.length, disciplines } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "drawing-add", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const sheetNumber = String(params.sheetNumber || "").trim();
      const title = String(params.title || "").trim();
      if (!sheetNumber || !title) return { ok: false, error: "sheetNumber and title required" };
      if (!state.drawings.has(userId)) state.drawings.set(userId, []);
      const rows = state.drawings.get(userId);
      const dwg = {
        id: uid("dwg"), jobId: params.jobId || null, sheetNumber, title,
        discipline: params.discipline || "Architectural",
        currentRevision: "A",
        revisions: [{ revision: "A", date: new Date().toISOString(), notes: params.notes || "Issued for construction", url: params.url || "" }],
        markups: [],
        createdAt: new Date().toISOString(),
      };
      rows.push(dwg);
      saveConState();
      return { ok: true, result: { drawing: dwg } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "drawing-revise", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.drawings.get(actorId(ctx)) || [];
      const dwg = rows.find(r => r.id === params.id);
      if (!dwg) return { ok: false, error: "drawing not found" };
      const nextRev = String.fromCharCode(dwg.currentRevision.charCodeAt(0) + 1);
      dwg.revisions.push({ revision: nextRev, date: new Date().toISOString(), notes: String(params.notes || ""), url: params.url || "" });
      dwg.currentRevision = nextRev;
      saveConState();
      return { ok: true, result: { drawing: dwg } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "drawing-markup", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.drawings.get(actorId(ctx)) || [];
      const dwg = rows.find(r => r.id === params.id);
      if (!dwg) return { ok: false, error: "drawing not found" };
      const note = String(params.note || "").trim();
      if (!note) return { ok: false, error: "note required" };
      const markup = {
        id: uid("mk"), note, revision: dwg.currentRevision,
        author: params.author || "Field", x: parseFloat(params.x) || 0, y: parseFloat(params.y) || 0,
        at: new Date().toISOString(),
      };
      dwg.markups.push(markup);
      saveConState();
      return { ok: true, result: { drawing: dwg, markup } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "drawing-compare", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.drawings.get(actorId(ctx)) || [];
      const dwg = rows.find(r => r.id === params.id);
      if (!dwg) return { ok: false, error: "drawing not found" };
      const revA = dwg.revisions.find(r => r.revision === params.revA);
      const revB = dwg.revisions.find(r => r.revision === params.revB);
      if (!revA || !revB) return { ok: false, error: "revision not found" };
      return { ok: true, result: { sheetNumber: dwg.sheetNumber, revA, revB, markupsOnA: dwg.markups.filter(m => m.revision === params.revA), markupsOnB: dwg.markups.filter(m => m.revision === params.revB) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "drawing-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.drawings.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "drawing not found" };
      rows.splice(idx, 1);
      state.drawings.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Budget vs actual — committed-cost forecasting ──
  registerLensAction("construction", "budget-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      let rows = list(state, "budgets", actorId(ctx));
      if (params.jobId) rows = rows.filter(r => r.jobId === params.jobId);
      const totalBudget = rows.reduce((s, r) => s + (r.budgetAmount || 0), 0);
      const totalCommitted = rows.reduce((s, r) => s + (r.committed || 0), 0);
      const totalActual = rows.reduce((s, r) => s + (r.actual || 0), 0);
      const forecastAtCompletion = rows.reduce((s, r) => s + Math.max(r.budgetAmount || 0, (r.actual || 0) + Math.max((r.committed || 0) - (r.actual || 0), 0)), 0);
      const variance = totalBudget - forecastAtCompletion;
      return { ok: true, result: { lines: rows, totalBudget: Math.round(totalBudget * 100) / 100, totalCommitted: Math.round(totalCommitted * 100) / 100, totalActual: Math.round(totalActual * 100) / 100, forecastAtCompletion: Math.round(forecastAtCompletion * 100) / 100, variance: Math.round(variance * 100) / 100, status: variance >= 0 ? "under-budget" : "over-budget" } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "budget-add", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const costCode = String(params.costCode || "").trim();
      const description = String(params.description || "").trim();
      if (!costCode || !description) return { ok: false, error: "costCode and description required" };
      const budgetAmount = parseFloat(params.budgetAmount);
      if (!Number.isFinite(budgetAmount)) return { ok: false, error: "budgetAmount must be a number" };
      if (!state.budgets.has(userId)) state.budgets.set(userId, []);
      const rows = state.budgets.get(userId);
      const line = {
        id: uid("bl"), jobId: params.jobId || null, costCode, description,
        category: params.category || "General",
        budgetAmount: Math.round(budgetAmount * 100) / 100,
        committed: Math.round((parseFloat(params.committed) || 0) * 100) / 100,
        actual: Math.round((parseFloat(params.actual) || 0) * 100) / 100,
        createdAt: new Date().toISOString(),
      };
      rows.push(line);
      saveConState();
      return { ok: true, result: { line } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "budget-update", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const rows = state.budgets.get(actorId(ctx)) || [];
      const line = rows.find(r => r.id === params.id);
      if (!line) return { ok: false, error: "budget line not found" };
      if (params.committed !== undefined) line.committed = Math.round((parseFloat(params.committed) || 0) * 100) / 100;
      if (params.actual !== undefined) line.actual = Math.round((parseFloat(params.actual) || 0) * 100) / 100;
      if (params.budgetAmount !== undefined && Number.isFinite(parseFloat(params.budgetAmount)))
        {line.budgetAmount = Math.round(parseFloat(params.budgetAmount) * 100) / 100;}
      const overBudget = (line.actual || 0) > (line.budgetAmount || 0);
      saveConState();
      return { ok: true, result: { line, overBudget } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("construction", "budget-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getConState(); if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const rows = state.budgets.get(userId) || [];
      const idx = rows.findIndex(r => r.id === params.id);
      if (idx < 0) return { ok: false, error: "budget line not found" };
      rows.splice(idx, 1);
      state.budgets.set(userId, rows);
      saveConState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Gantt timeline — draws the CPM result as schedule bars ──
  registerLensAction("construction", "ganttSchedule", (ctx, artifact, params = {}) => {
    try {
      const tasks = calcData(artifact).tasks || params.tasks || [];
      if (tasks.length === 0) return { ok: true, result: { message: "Add tasks with duration and dependencies.", bars: [] } };
      const taskMap = {};
      tasks.forEach(t => { taskMap[t.name || t.id] = { name: t.name || t.id, duration: parseInt(t.duration) || 1, deps: t.dependencies || [], earlyStart: 0, earlyFinish: 0, lateStart: 0, lateFinish: 0, slack: 0 }; });
      const order = Object.values(taskMap);
      for (const t of order) {
        const maxPredFinish = t.deps.reduce((m, d) => Math.max(m, taskMap[d]?.earlyFinish || 0), 0);
        t.earlyStart = maxPredFinish;
        t.earlyFinish = t.earlyStart + t.duration;
      }
      const projectDuration = Math.max(...order.map(t => t.earlyFinish));
      for (const t of [...order].reverse()) {
        const successors = order.filter(s => s.deps.includes(t.name));
        t.lateFinish = successors.length > 0 ? Math.min(...successors.map(s => s.lateStart)) : projectDuration;
        t.lateStart = t.lateFinish - t.duration;
        t.slack = t.lateStart - t.earlyStart;
      }
      // Guard against a malformed startDate (Invalid Date would throw on
      // .toISOString()); fall back to now so the schedule still renders.
      let start = params.startDate ? new Date(params.startDate) : new Date();
      if (Number.isNaN(start.getTime())) start = new Date();
      const dayMs = 86400000;
      const bars = order.map((t, i) => ({
        id: `gt_${i}`, name: t.name, duration: t.duration,
        startDay: t.earlyStart, endDay: t.earlyFinish, slack: t.slack,
        onCriticalPath: t.slack === 0,
        startDate: new Date(start.getTime() + t.earlyStart * dayMs).toISOString().slice(0, 10),
        endDate: new Date(start.getTime() + t.earlyFinish * dayMs).toISOString().slice(0, 10),
        deps: t.deps,
      }));
      return { ok: true, result: { bars, projectDuration, criticalPath: order.filter(t => t.slack === 0).map(t => t.name), totalTasks: order.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
