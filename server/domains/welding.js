// server/domains/welding.js
export default function registerWeldingActions(registerLensAction) {
  // Fail-closed numeric coercion for the pure calculators: a non-finite input
  // (NaN / Infinity / "abc") falls back to `dflt` so a poisoned field can never
  // leak NaN/Infinity into a computed result. parseFloat alone passes Infinity
  // through ("Infinity" → Infinity), so Number.isFinite is the real guard.
  const wFinite = (v, dflt) => { const n = parseFloat(v); return Number.isFinite(n) ? n : dflt; };

  registerLensAction("welding", "jointStrength", (ctx, artifact, _params) => {
    try {
    const data = artifact.data || {};
    const thickness = wFinite(data.thickness, 6);
    const weldType = (data.weldType || "fillet").toLowerCase();
    const material = (data.material || "mild-steel").toLowerCase();
    const length = wFinite(data.length, 100);
    const tensileStrengths = { "mild-steel": 400, "stainless-steel": 520, "aluminum": 270, "high-strength": 690, "cast-iron": 200 };
    const tensile = tensileStrengths[material] || 400;
    const weldFactors = { fillet: 0.707, butt: 1.0, groove: 0.9, lap: 0.65, plug: 0.5 };
    const factor = weldFactors[weldType] || 0.707;
    const throatSize = thickness * factor;
    const shearStrength = tensile * 0.6;
    const loadCapacity = Math.round(throatSize * length * shearStrength / 1000);
    const safeLoad = Math.round(loadCapacity / 1.5);
    return { ok: true, result: { material, weldType, thickness: `${thickness}mm`, length: `${length}mm`, throatSize: `${Math.round(throatSize * 10) / 10}mm`, tensileStrength: `${tensile} MPa`, theoreticalCapacity: `${loadCapacity} kN`, safeWorkingLoad: `${safeLoad} kN`, safetyFactor: 1.5, rating: safeLoad > 100 ? "heavy-duty" : safeLoad > 50 ? "structural" : safeLoad > 20 ? "medium-duty" : "light-duty" } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "rodSelection", (ctx, artifact, _params) => {
    try {
    const data = artifact.data || {};
    const baseMetal = (data.baseMetal || data.material || "mild-steel").toLowerCase();
    const position = (data.position || "flat").toLowerCase();
    const jointType = (data.jointType || "fillet").toLowerCase();
    const thickness = wFinite(data.thickness, 6);
    const rodDatabase = {
      "mild-steel": [
        { rod: "E6010", process: "SMAW", positions: ["all"], notes: "Deep penetration, all-position", amps: { min: 75, max: 130 } },
        { rod: "E6013", process: "SMAW", positions: ["flat", "horizontal", "vertical"], notes: "Easy arc, smooth finish", amps: { min: 80, max: 120 } },
        { rod: "E7018", process: "SMAW", positions: ["all"], notes: "Low hydrogen, strongest", amps: { min: 90, max: 140 } },
        { rod: "ER70S-6", process: "MIG", positions: ["all"], notes: "General purpose MIG wire", amps: { min: 100, max: 250 } },
      ],
      "stainless-steel": [
        { rod: "E308L", process: "SMAW", positions: ["all"], notes: "304 stainless", amps: { min: 70, max: 120 } },
        { rod: "E316L", process: "SMAW", positions: ["all"], notes: "316 stainless, corrosion resistant", amps: { min: 70, max: 120 } },
        { rod: "ER308LSi", process: "MIG/TIG", positions: ["all"], notes: "Most common stainless wire", amps: { min: 80, max: 200 } },
      ],
      "aluminum": [
        { rod: "ER4043", process: "MIG/TIG", positions: ["flat", "horizontal"], notes: "General aluminum, good flow", amps: { min: 90, max: 200 } },
        { rod: "ER5356", process: "MIG/TIG", positions: ["all"], notes: "Higher strength, marine grade", amps: { min: 100, max: 220 } },
      ],
    };
    const rods = rodDatabase[baseMetal] || rodDatabase["mild-steel"];
    const suitable = rods.filter(r => r.positions.includes("all") || r.positions.includes(position));
    const recommended = suitable[0] || rods[0];
    const diameter = thickness <= 3 ? 2.4 : thickness <= 6 ? 3.2 : thickness <= 12 ? 4.0 : 5.0;
    return { ok: true, result: { baseMetal, position, jointType, materialThickness: `${thickness}mm`, recommended: { rod: recommended.rod, process: recommended.process, diameter: `${diameter}mm`, amperageRange: `${recommended.amps.min}-${recommended.amps.max}A`, notes: recommended.notes }, alternatives: suitable.slice(1).map(r => ({ rod: r.rod, process: r.process, notes: r.notes })), tips: [`Preheat if thickness > 25mm`, `Clean base metal thoroughly before welding`, position === "overhead" ? "Use lower amperage for overhead position" : null].filter(Boolean) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "heatInput", (ctx, artifact, _params) => {
    try {
    const voltage = wFinite(artifact.data?.voltage, 25);
    const amperage = wFinite(artifact.data?.amperage ?? artifact.data?.current, 150);
    const travelSpeedRaw = wFinite(artifact.data?.travelSpeed, 5);
    // Guard against a zero/negative travel speed: heatInput = V·I·η / v would
    // divide by zero and emit Infinity. Floor at a tiny positive value.
    const travelSpeed = travelSpeedRaw > 0 ? travelSpeedRaw : 5;
    const efficiency = wFinite(artifact.data?.efficiency, 0.8);
    const maxInterpass = wFinite(artifact.data?.maxInterpassTemp, 250);
    // CLAMP-AND-COMPUTE: inputs are wFinite-clamped, but a large-but-finite
    // input (e.g. 1e308) can overflow the product to Infinity. Clamp every
    // COMPUTED numeric output so no NaN/Infinity ever leaks.
    const heatInputJmm = wFinite((voltage * amperage * efficiency) / travelSpeed, 0);
    const heatInputKJmm = wFinite(Math.round(heatInputJmm / 1000 * 100) / 100, 0);
    const risk = heatInputKJmm > 3.0 ? "high" : heatInputKJmm > 1.5 ? "moderate" : "low";
    return { ok: true, result: { voltage: `${voltage}V`, amperage: `${amperage}A`, travelSpeed: `${travelSpeed} mm/s`, efficiency, heatInput: `${heatInputKJmm} kJ/mm`, heatInputJoules: wFinite(Math.round(heatInputJmm), 0), maxInterpassTemp: `${maxInterpass}°C`, distortionRisk: risk, recommendations: [heatInputKJmm > 2.5 ? "Reduce heat input — increase travel speed or reduce amperage" : null, heatInputKJmm < 0.5 ? "Low heat input — risk of incomplete fusion" : null, "Monitor interpass temperature between passes", risk === "high" ? "Use backstep welding technique to reduce distortion" : null].filter(Boolean) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "inspectionChecklist", (ctx, artifact, _params) => {
    try {
    const data = artifact.data || {};
    const weldType = (data.weldType || "fillet").toLowerCase();
    const code = (data.code || "AWS D1.1").toUpperCase();
    const inspections = (Array.isArray(data.inspections) ? data.inspections : []).filter((i) => i && typeof i === "object");
    const baseChecklist = [
      { item: "Visual inspection — surface cracks", category: "visual", required: true },
      { item: "Visual inspection — porosity", category: "visual", required: true },
      { item: "Visual inspection — undercut depth", category: "visual", required: true },
      { item: "Visual inspection — weld profile/contour", category: "visual", required: true },
      { item: "Dimensional — weld size meets spec", category: "dimensional", required: true },
      { item: "Dimensional — leg length (fillet)", category: "dimensional", required: weldType === "fillet" },
      { item: "Dimensional — reinforcement height", category: "dimensional", required: weldType === "butt" || weldType === "groove" },
      { item: "Dimensional — angular distortion within tolerance", category: "dimensional", required: true },
      { item: "NDT — dye penetrant test (PT)", category: "ndt", required: code.includes("AWS") || code.includes("ASME") },
      { item: "NDT — magnetic particle test (MT)", category: "ndt", required: code.includes("AWS") },
      { item: "NDT — ultrasonic test (UT)", category: "ndt", required: code.includes("ASME") },
      { item: "NDT — radiographic test (RT)", category: "ndt", required: weldType === "butt" },
      { item: "Documentation — WPS on file", category: "docs", required: true },
      { item: "Documentation — welder qualification current", category: "docs", required: true },
    ].filter(c => c.required);
    const checklist = baseChecklist.map(c => {
      const inspection = inspections.find(i => i.item === c.item || i.id === c.item);
      return { ...c, status: inspection ? (inspection.passed ? "pass" : "fail") : "pending" };
    });
    const passed = checklist.filter(c => c.status === "pass").length;
    const failed = checklist.filter(c => c.status === "fail").length;
    const pending = checklist.filter(c => c.status === "pending").length;
    return { ok: true, result: { weldType, code, totalItems: checklist.length, passed, failed, pending, passRate: checklist.length > 0 ? Math.round((passed / checklist.length) * 100) : 0, checklist, verdict: failed > 0 ? "FAIL — rework required" : pending > 0 ? "INCOMPLETE — inspections pending" : "PASS — all inspections cleared" } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Field-service operations substrate (per-user, STATE-backed) ──────
  // Powers: scheduling calendar, quote→job→invoice workflow, payments,
  // WPS builder, welder-cert expiry tracking, weld photo docs,
  // searchable AWS/ASME code library, client portal share links.

  function getWeldState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.weldingLens) STATE.weldingLens = {};
    const w = STATE.weldingLens;
    if (!(w.jobs instanceof Map)) w.jobs = new Map();        // userId -> Array<job>
    if (!(w.estimates instanceof Map)) w.estimates = new Map(); // userId -> Array<estimate>
    if (!(w.invoices instanceof Map)) w.invoices = new Map();  // userId -> Array<invoice>
    if (!(w.wps instanceof Map)) w.wps = new Map();           // userId -> Array<wps>
    if (!(w.certs instanceof Map)) w.certs = new Map();       // userId -> Array<cert>
    if (!(w.portal instanceof Map)) w.portal = new Map();     // token -> { ownerId, kind, refId }
    return w;
  }
  function saveWeld() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const wId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const wActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const wClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const wNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const wList = (s, key, userId) => { if (!s[key].has(userId)) s[key].set(userId, []); return s[key].get(userId); };
  const noState = { ok: false, error: "state_unavailable" };
  const DAY_MS = 86400000;
  const daysUntil = (iso) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.round((t - Date.now()) / DAY_MS);
  };

  // ── Scheduling calendar ───────────────────────────────────────────
  registerLensAction("welding", "job-schedule", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const jobs = wList(s, "jobs", userId);
      const job = {
        id: wId("job"),
        title: wClean(params.title, 200) || "Untitled job",
        client: wClean(params.client, 200),
        address: wClean(params.address, 400),
        crew: Array.isArray(params.crew) ? params.crew.map((c) => wClean(c, 80)).filter(Boolean).slice(0, 12) : [],
        scheduledDate: wClean(params.scheduledDate, 40),
        durationDays: Math.max(1, Math.round(wNum(params.durationDays)) || 1),
        status: "scheduled",
        estimateId: wClean(params.estimateId, 80) || null,
        notes: wClean(params.notes, 2000),
        createdAt: new Date().toISOString(),
      };
      jobs.push(job); saveWeld();
      return { ok: true, result: { job } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "job-update", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const jobs = wList(s, "jobs", wActor(ctx));
      const job = jobs.find((j) => j.id === params.jobId);
      if (!job) return { ok: false, error: "job_not_found" };
      if (params.title != null) job.title = wClean(params.title, 200);
      if (params.scheduledDate != null) job.scheduledDate = wClean(params.scheduledDate, 40);
      if (params.durationDays != null) job.durationDays = Math.max(1, Math.round(wNum(params.durationDays)) || 1);
      if (params.crew != null) job.crew = Array.isArray(params.crew) ? params.crew.map((c) => wClean(c, 80)).filter(Boolean).slice(0, 12) : job.crew;
      if (params.status != null && ["scheduled", "in_progress", "completed", "cancelled"].includes(params.status)) job.status = params.status;
      if (params.notes != null) job.notes = wClean(params.notes, 2000);
      saveWeld();
      return { ok: true, result: { job } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "calendar", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const jobs = wList(s, "jobs", wActor(ctx)).filter((j) => j.status !== "cancelled");
      const days = [];
      const range = Math.min(60, Math.max(7, Math.round(wNum(params.rangeDays)) || 30));
      const start = new Date(); start.setHours(0, 0, 0, 0);
      for (let i = 0; i < range; i++) {
        const d = new Date(start.getTime() + i * DAY_MS);
        const key = d.toISOString().slice(0, 10);
        const onDay = jobs.filter((j) => {
          if (!j.scheduledDate) return false;
          const st = Date.parse(j.scheduledDate);
          if (Number.isNaN(st)) return false;
          const end = st + (j.durationDays - 1) * DAY_MS;
          return d.getTime() >= new Date(j.scheduledDate).setHours(0, 0, 0, 0) && d.getTime() <= new Date(end).setHours(0, 0, 0, 0);
        }).map((j) => ({ id: j.id, title: j.title, client: j.client, status: j.status, crew: j.crew }));
        days.push({ date: key, jobs: onDay });
      }
      const crewLoad = {};
      jobs.forEach((j) => (j.crew || []).forEach((c) => { crewLoad[c] = (crewLoad[c] || 0) + (j.durationDays || 1); }));
      return {
        ok: true,
        result: {
          rangeDays: range,
          days,
          unscheduled: jobs.filter((j) => !j.scheduledDate).map((j) => ({ id: j.id, title: j.title, client: j.client })),
          crewLoad,
          scheduledCount: jobs.filter((j) => j.scheduledDate).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Quote → job → invoice workflow ────────────────────────────────
  registerLensAction("welding", "estimate-create", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const estimates = wList(s, "estimates", userId);
      const lineItems = (Array.isArray(params.lineItems) ? params.lineItems : []).map((li) => ({
        description: wClean(li.description, 240),
        quantity: Math.max(0, wNum(li.quantity)),
        unitPrice: Math.max(0, wNum(li.unitPrice)),
        kind: ["labor", "material", "equipment"].includes(li.kind) ? li.kind : "material",
      })).filter((li) => li.description);
      const subtotal = lineItems.reduce((t, li) => t + li.quantity * li.unitPrice, 0);
      const taxRate = Math.min(0.25, Math.max(0, wNum(params.taxRate)));
      const est = {
        id: wId("est"),
        title: wClean(params.title, 200) || "Untitled estimate",
        client: wClean(params.client, 200),
        address: wClean(params.address, 400),
        lineItems,
        subtotal: Math.round(subtotal * 100) / 100,
        taxRate,
        tax: Math.round(subtotal * taxRate * 100) / 100,
        total: Math.round(subtotal * (1 + taxRate) * 100) / 100,
        status: "draft",
        jobId: null,
        createdAt: new Date().toISOString(),
      };
      estimates.push(est); saveWeld();
      return { ok: true, result: { estimate: est } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "estimate-list", (ctx, _a, _params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const estimates = wList(s, "estimates", wActor(ctx));
      return {
        ok: true,
        result: {
          estimates: estimates.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          pipelineValue: estimates.filter((e) => e.status === "draft" || e.status === "sent").reduce((t, e) => t + e.total, 0),
          wonValue: estimates.filter((e) => e.status === "accepted").reduce((t, e) => t + e.total, 0),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "estimate-send", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const est = wList(s, "estimates", userId).find((e) => e.id === params.estimateId);
      if (!est) return { ok: false, error: "estimate_not_found" };
      est.status = "sent";
      const token = wId("pt");
      s.portal.set(token, { ownerId: userId, kind: "estimate", refId: est.id });
      est.portalToken = token;
      saveWeld();
      return { ok: true, result: { estimate: est, portalToken: token } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Convert an accepted estimate into a scheduled job, preserving the link.
  registerLensAction("welding", "estimate-to-job", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const est = wList(s, "estimates", userId).find((e) => e.id === params.estimateId);
      if (!est) return { ok: false, error: "estimate_not_found" };
      if (est.jobId) return { ok: false, error: "estimate_already_converted" };
      est.status = "accepted";
      const jobs = wList(s, "jobs", userId);
      const job = {
        id: wId("job"),
        title: est.title,
        client: est.client,
        address: est.address,
        crew: [],
        scheduledDate: wClean(params.scheduledDate, 40),
        durationDays: Math.max(1, Math.round(wNum(params.durationDays)) || 1),
        status: "scheduled",
        estimateId: est.id,
        contractValue: est.total,
        notes: "",
        createdAt: new Date().toISOString(),
      };
      jobs.push(job);
      est.jobId = job.id;
      saveWeld();
      return { ok: true, result: { job, estimate: est } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Generate an invoice from a completed job (or directly from an estimate).
  registerLensAction("welding", "invoice-from-job", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const job = wList(s, "jobs", userId).find((j) => j.id === params.jobId);
      if (!job) return { ok: false, error: "job_not_found" };
      const est = job.estimateId ? wList(s, "estimates", userId).find((e) => e.id === job.estimateId) : null;
      const invoices = wList(s, "invoices", userId);
      const amount = est ? est.total : Math.max(0, wNum(params.amount));
      const seq = invoices.length + 1;
      const token = wId("pt");
      const inv = {
        id: wId("inv"),
        invoiceNumber: `INV-${String(seq).padStart(4, "0")}`,
        jobId: job.id,
        estimateId: job.estimateId || null,
        client: job.client,
        title: job.title,
        lineItems: est ? est.lineItems : [],
        subtotal: est ? est.subtotal : amount,
        tax: est ? est.tax : 0,
        amount,
        amountPaid: 0,
        balance: amount,
        status: "unpaid",
        issuedDate: new Date().toISOString().slice(0, 10),
        dueDate: wClean(params.dueDate, 40) || new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10),
        payments: [],
        portalToken: token,
        createdAt: new Date().toISOString(),
      };
      invoices.push(inv);
      s.portal.set(token, { ownerId: userId, kind: "invoice", refId: inv.id });
      job.invoiceId = inv.id;
      job.status = "completed";
      saveWeld();
      return { ok: true, result: { invoice: inv } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "invoice-list", (ctx, _a, _params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const invoices = wList(s, "invoices", wActor(ctx));
      const now = Date.now();
      const enriched = invoices.map((inv) => ({
        ...inv,
        overdue: inv.status !== "paid" && inv.dueDate && Date.parse(inv.dueDate) < now,
      }));
      return {
        ok: true,
        result: {
          invoices: enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          outstanding: enriched.filter((i) => i.status !== "paid").reduce((t, i) => t + i.balance, 0),
          collected: enriched.reduce((t, i) => t + i.amountPaid, 0),
          overdueCount: enriched.filter((i) => i.overdue).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Payment processing on invoices ────────────────────────────────
  registerLensAction("welding", "invoice-payment", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const inv = wList(s, "invoices", wActor(ctx)).find((i) => i.id === params.invoiceId);
      if (!inv) return { ok: false, error: "invoice_not_found" };
      const amt = Math.round(Math.max(0, wNum(params.amount)) * 100) / 100;
      if (amt <= 0) return { ok: false, error: "invalid_amount" };
      if (amt > inv.balance + 0.001) return { ok: false, error: "amount_exceeds_balance" };
      const method = ["card", "ach", "cash", "check"].includes(params.method) ? params.method : "card";
      const payment = {
        id: wId("pay"),
        amount: amt,
        method,
        reference: wClean(params.reference, 80),
        recordedAt: new Date().toISOString(),
      };
      inv.payments.push(payment);
      inv.amountPaid = Math.round((inv.amountPaid + amt) * 100) / 100;
      inv.balance = Math.round((inv.amount - inv.amountPaid) * 100) / 100;
      inv.status = inv.balance <= 0.001 ? "paid" : "partial";
      saveWeld();
      return { ok: true, result: { invoice: inv, payment } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── WPS (Welding Procedure Specification) builder ─────────────────
  registerLensAction("welding", "wps-create", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const list = wList(s, "wps", userId);
      const wps = {
        id: wId("wps"),
        wpsNumber: wClean(params.wpsNumber, 60) || `WPS-${String(list.length + 1).padStart(3, "0")}`,
        jobId: wClean(params.jobId, 80) || null,
        process: wClean(params.process, 40) || "SMAW",
        baseMetal: wClean(params.baseMetal, 120) || "mild-steel",
        baseMetalSpec: wClean(params.baseMetalSpec, 80),
        thicknessRange: wClean(params.thicknessRange, 60),
        jointDesign: wClean(params.jointDesign, 120) || "fillet",
        positions: Array.isArray(params.positions) ? params.positions.map((p) => wClean(p, 20)).filter(Boolean).slice(0, 8) : ["flat"],
        fillerMetal: wClean(params.fillerMetal, 80),
        fillerSpec: wClean(params.fillerSpec, 80),
        shieldingGas: wClean(params.shieldingGas, 80),
        currentType: wClean(params.currentType, 40) || "DCEN",
        amperageRange: wClean(params.amperageRange, 60),
        voltageRange: wClean(params.voltageRange, 60),
        travelSpeed: wClean(params.travelSpeed, 60),
        preheat: wClean(params.preheat, 80),
        interpassTemp: wClean(params.interpassTemp, 80),
        pwht: wClean(params.pwht, 120),
        code: wClean(params.code, 60) || "AWS D1.1",
        revision: wClean(params.revision, 20) || "0",
        status: "draft",
        createdAt: new Date().toISOString(),
      };
      list.push(wps); saveWeld();
      return { ok: true, result: { wps } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "wps-list", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      let list = wList(s, "wps", wActor(ctx));
      if (params.jobId) list = list.filter((w) => w.jobId === params.jobId);
      return { ok: true, result: { wps: list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "wps-approve", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const wps = wList(s, "wps", wActor(ctx)).find((w) => w.id === params.wpsId);
      if (!wps) return { ok: false, error: "wps_not_found" };
      const missing = [];
      if (!wps.fillerMetal) missing.push("fillerMetal");
      if (!wps.amperageRange) missing.push("amperageRange");
      if (!wps.thicknessRange) missing.push("thicknessRange");
      if (missing.length) return { ok: false, error: "incomplete_wps", result: { missing } };
      wps.status = "approved";
      wps.approvedBy = wClean(params.approvedBy, 120) || "Certified Welding Inspector";
      wps.approvedAt = new Date().toISOString();
      saveWeld();
      return { ok: true, result: { wps } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Welder-certification tracking with expiry alerts ──────────────
  registerLensAction("welding", "cert-add", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const list = wList(s, "certs", wActor(ctx));
      const cert = {
        id: wId("cert"),
        welder: wClean(params.welder, 160) || "Unnamed welder",
        certType: wClean(params.certType, 120) || "AWS D1.1 Structural",
        certNumber: wClean(params.certNumber, 80),
        process: wClean(params.process, 40),
        position: wClean(params.position, 40),
        issuedBy: wClean(params.issuedBy, 160),
        issuedDate: wClean(params.issuedDate, 40),
        expiryDate: wClean(params.expiryDate, 40),
        lastContinuityDate: wClean(params.lastContinuityDate, 40),
        notes: wClean(params.notes, 1000),
        createdAt: new Date().toISOString(),
      };
      list.push(cert); saveWeld();
      return { ok: true, result: { cert } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "cert-status", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const warnDays = Math.max(7, Math.round(wNum(params.warnDays)) || 60);
      const list = wList(s, "certs", wActor(ctx)).map((c) => {
        const expDays = daysUntil(c.expiryDate);
        // AWS continuity: a welder cert lapses if no use of the process in 6 months.
        const contDays = c.lastContinuityDate ? Math.round((Date.now() - Date.parse(c.lastContinuityDate)) / DAY_MS) : null;
        let standing = "valid";
        if (expDays != null && expDays < 0) standing = "expired";
        else if (contDays != null && contDays > 180) standing = "continuity_lapsed";
        else if (expDays != null && expDays <= warnDays) standing = "expiring_soon";
        return { ...c, daysToExpiry: expDays, daysSinceContinuity: contDays, standing };
      });
      const alerts = list
        .filter((c) => c.standing !== "valid")
        .map((c) => ({
          certId: c.id,
          welder: c.welder,
          certType: c.certType,
          standing: c.standing,
          message: c.standing === "expired"
            ? `${c.certType} expired ${Math.abs(c.daysToExpiry)} days ago`
            : c.standing === "continuity_lapsed"
              ? `${c.welder} — 6-month continuity lapsed (${c.daysSinceContinuity} days since last use)`
              : `${c.certType} expires in ${c.daysToExpiry} days`,
        }));
      return {
        ok: true,
        result: {
          certs: list.sort((a, b) => (a.daysToExpiry ?? 99999) - (b.daysToExpiry ?? 99999)),
          alerts,
          validCount: list.filter((c) => c.standing === "valid").length,
          atRiskCount: alerts.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "cert-renew", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const cert = wList(s, "certs", wActor(ctx)).find((c) => c.id === params.certId);
      if (!cert) return { ok: false, error: "cert_not_found" };
      if (params.expiryDate != null) cert.expiryDate = wClean(params.expiryDate, 40);
      if (params.issuedDate != null) cert.issuedDate = wClean(params.issuedDate, 40);
      // Log a continuity touch — keeps an AWS cert active.
      cert.lastContinuityDate = wClean(params.lastContinuityDate, 40) || new Date().toISOString().slice(0, 10);
      saveWeld();
      return { ok: true, result: { cert } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Weld photo documentation per inspection ───────────────────────
  registerLensAction("welding", "photo-attach", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const jobs = wList(s, "jobs", wActor(ctx));
      const job = jobs.find((j) => j.id === params.jobId);
      if (!job) return { ok: false, error: "job_not_found" };
      if (!Array.isArray(job.photos)) job.photos = [];
      const url = wClean(params.url, 2000);
      if (!url) return { ok: false, error: "url_required" };
      const photo = {
        id: wId("ph"),
        url,
        stage: ["before", "fit-up", "root-pass", "fill", "cap", "after", "ndt"].includes(params.stage) ? params.stage : "after",
        caption: wClean(params.caption, 300),
        weldId: wClean(params.weldId, 80),
        addedAt: new Date().toISOString(),
      };
      job.photos.push(photo);
      saveWeld();
      return { ok: true, result: { photo, photoCount: job.photos.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "photo-list", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const job = wList(s, "jobs", wActor(ctx)).find((j) => j.id === params.jobId);
      if (!job) return { ok: false, error: "job_not_found" };
      const photos = job.photos || [];
      return {
        ok: true,
        result: {
          photos: photos.slice().sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
          byStage: photos.reduce((m, p) => { m[p.stage] = (m[p.stage] || 0) + 1; return m; }, {}),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "photo-remove", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const job = wList(s, "jobs", wActor(ctx)).find((j) => j.id === params.jobId);
      if (!job || !Array.isArray(job.photos)) return { ok: false, error: "job_not_found" };
      const before = job.photos.length;
      job.photos = job.photos.filter((p) => p.id !== params.photoId);
      saveWeld();
      return { ok: true, result: { removed: before - job.photos.length, photoCount: job.photos.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Searchable AWS D1.1 / ASME code reference library ─────────────
  const CODE_LIBRARY = [
    { id: "d1.1-2.4", code: "AWS D1.1", clause: "2.4", title: "Weld Size — Effective throat", body: "The effective throat of a fillet weld is the shortest distance from the joint root to the weld face. Minimum fillet weld sizes are governed by the thicker of the two parts joined.", keywords: ["fillet", "throat", "weld size", "minimum"] },
    { id: "d1.1-3.7", code: "AWS D1.1", clause: "3.7", title: "Preheat and Interpass Temperature", body: "Minimum preheat and interpass temperatures are determined by base-metal category and thickness. Steels above 38mm typically require 65–150°C preheat to avoid hydrogen cracking.", keywords: ["preheat", "interpass", "temperature", "cracking"] },
    { id: "d1.1-6.9", code: "AWS D1.1", clause: "6.9", title: "Visual Inspection Acceptance Criteria", body: "Welds shall have no cracks. Undercut shall not exceed 1mm for material under 25mm. Surface porosity acceptance depends on connection type — cyclically loaded members are stricter.", keywords: ["visual", "undercut", "porosity", "crack", "acceptance"] },
    { id: "d1.1-6.12", code: "AWS D1.1", clause: "6.12", title: "Ultrasonic Testing of Groove Welds", body: "UT is used to evaluate the soundness of complete-joint-penetration groove welds. Discontinuity acceptance is rated by amplitude and length against a reference reflector.", keywords: ["ut", "ultrasonic", "ndt", "groove", "cjp"] },
    { id: "d1.1-4.x", code: "AWS D1.1", clause: "4.0", title: "Welder Qualification", body: "Welders must pass a qualification test on a representative joint. Qualification remains valid as long as the process is used at least once every six months (continuity).", keywords: ["welder", "qualification", "continuity", "certification"] },
    { id: "asme-ix-qw-451", code: "ASME IX", clause: "QW-451", title: "Welder Performance — Thickness Ranges", body: "QW-451 tabulates the base-metal and deposited-weld-metal thickness ranges qualified by a given test coupon thickness.", keywords: ["asme", "thickness", "range", "performance", "coupon"] },
    { id: "asme-ix-qw-153", code: "ASME IX", clause: "QW-153", title: "Acceptance Criteria — Tension Tests", body: "Tension specimens shall have a tensile strength not less than the minimum specified tensile of the base metal, or of the weaker of two base metals.", keywords: ["asme", "tension", "tensile", "acceptance"] },
    { id: "asme-ix-qw-191", code: "ASME IX", clause: "QW-191", title: "Radiographic Examination of Welds", body: "RT acceptance for performance qualification limits the size and distribution of rounded indications and prohibits cracks and incomplete fusion.", keywords: ["asme", "radiographic", "rt", "ndt", "indication"] },
    { id: "api-1104-9", code: "API 1104", clause: "9.0", title: "Acceptance Standards for NDT — Pipeline", body: "API 1104 governs welding of pipelines. NDT acceptance limits are length-based for elongated indications and pipe-wall-percentage-based for burn-through.", keywords: ["api", "pipeline", "ndt", "acceptance", "burn-through"] },
    { id: "d1.1-5.15", code: "AWS D1.1", clause: "5.15", title: "Repair of Base Metal and Welds", body: "Defective welds may be repaired by removal and re-welding. Repair welds must meet the same WPS and acceptance criteria as the original.", keywords: ["repair", "rework", "defect", "wps"] },
  ];

  registerLensAction("welding", "code-search", (_ctx, _a, params = {}) => {
    try {
      const q = wClean(params.query, 120).toLowerCase();
      const codeFilter = wClean(params.code, 40).toUpperCase();
      let results = CODE_LIBRARY;
      if (codeFilter) results = results.filter((c) => c.code.toUpperCase() === codeFilter);
      if (q) {
        results = results
          .map((c) => {
            let score = 0;
            if (c.title.toLowerCase().includes(q)) score += 3;
            if (c.clause.toLowerCase().includes(q)) score += 3;
            if (c.body.toLowerCase().includes(q)) score += 1;
            if (c.keywords.some((k) => k.includes(q) || q.includes(k))) score += 2;
            return { ...c, score };
          })
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score);
      }
      return {
        ok: true,
        result: {
          query: q,
          codes: [...new Set(CODE_LIBRARY.map((c) => c.code))],
          results: results.map(({ score, ...c }) => ({ ...c, ...(score != null ? { relevance: score } : {}) })),
          count: results.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Client portal — quote approval & invoice payment ──────────────
  registerLensAction("welding", "portal-view", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const token = wClean(params.token, 120);
      const ref = s.portal.get(token);
      if (!ref) return { ok: false, error: "invalid_token" };
      if (ref.kind === "estimate") {
        const est = wList(s, "estimates", ref.ownerId).find((e) => e.id === ref.refId);
        if (!est) return { ok: false, error: "estimate_not_found" };
        return { ok: true, result: { kind: "estimate", estimate: est, canApprove: est.status === "sent" } };
      }
      const inv = wList(s, "invoices", ref.ownerId).find((i) => i.id === ref.refId);
      if (!inv) return { ok: false, error: "invoice_not_found" };
      return { ok: true, result: { kind: "invoice", invoice: inv, canPay: inv.status !== "paid" } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "portal-approve", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const ref = s.portal.get(wClean(params.token, 120));
      if (!ref || ref.kind !== "estimate") return { ok: false, error: "invalid_token" };
      const est = wList(s, "estimates", ref.ownerId).find((e) => e.id === ref.refId);
      if (!est) return { ok: false, error: "estimate_not_found" };
      if (params.decision === "reject") {
        est.status = "rejected";
      } else {
        est.status = "accepted";
        est.acceptedAt = new Date().toISOString();
        est.acceptedBy = wClean(params.signature, 160);
      }
      saveWeld();
      return { ok: true, result: { estimate: est } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("welding", "portal-pay", (ctx, _a, params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const ref = s.portal.get(wClean(params.token, 120));
      if (!ref || ref.kind !== "invoice") return { ok: false, error: "invalid_token" };
      const inv = wList(s, "invoices", ref.ownerId).find((i) => i.id === ref.refId);
      if (!inv) return { ok: false, error: "invoice_not_found" };
      const amt = Math.round(Math.max(0, wNum(params.amount)) * 100) / 100;
      if (amt <= 0 || amt > inv.balance + 0.001) return { ok: false, error: "invalid_amount" };
      const payment = {
        id: wId("pay"),
        amount: amt,
        method: ["card", "ach"].includes(params.method) ? params.method : "card",
        reference: wClean(params.reference, 80) || "client-portal",
        recordedAt: new Date().toISOString(),
      };
      inv.payments.push(payment);
      inv.amountPaid = Math.round((inv.amountPaid + amt) * 100) / 100;
      inv.balance = Math.round((inv.amount - inv.amountPaid) * 100) / 100;
      inv.status = inv.balance <= 0.001 ? "paid" : "partial";
      saveWeld();
      return { ok: true, result: { invoice: inv, payment } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Operations dashboard rollup ───────────────────────────────────
  registerLensAction("welding", "ops-summary", (ctx, _a, _params = {}) => {
    try {
      const s = getWeldState(); if (!s) return noState;
      const userId = wActor(ctx);
      const jobs = wList(s, "jobs", userId);
      const estimates = wList(s, "estimates", userId);
      const invoices = wList(s, "invoices", userId);
      const certs = wList(s, "certs", userId);
      const now = Date.now();
      const certAtRisk = certs.filter((c) => {
        const d = daysUntil(c.expiryDate);
        return d != null && d <= 60;
      }).length;
      return {
        ok: true,
        result: {
          activeJobs: jobs.filter((j) => j.status === "scheduled" || j.status === "in_progress").length,
          completedJobs: jobs.filter((j) => j.status === "completed").length,
          pipelineValue: estimates.filter((e) => e.status === "draft" || e.status === "sent").reduce((t, e) => t + e.total, 0),
          outstanding: invoices.filter((i) => i.status !== "paid").reduce((t, i) => t + i.balance, 0),
          collected: invoices.reduce((t, i) => t + i.amountPaid, 0),
          overdueInvoices: invoices.filter((i) => i.status !== "paid" && i.dueDate && Date.parse(i.dueDate) < now).length,
          certAtRisk,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
