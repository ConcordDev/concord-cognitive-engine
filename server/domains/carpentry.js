// server/domains/carpentry.js
// Domain actions for carpentry: board foot calculation, joint strength analysis,
// wood species selection, finish recommendation, plus a full trade-management
// substrate — cut-list optimization, material takeoffs, job photo logs, crew
// scheduling, estimate→invoice conversion + e-signature, client portal, and
// per-job time tracking for labor costing.

export default function registerCarpentryActions(registerLensAction) {
  registerLensAction("carpentry", "boardFootCalc", (ctx, artifact, _params) => {
    const pieces = artifact.data?.pieces || [];
    if (pieces.length === 0) return { ok: true, result: { message: "Add lumber pieces with thickness, width, and length." } };
    const calculated = pieces.map(p => {
      const t = parseFloat(p.thickness) || 1; // inches
      const w = parseFloat(p.width) || 6;
      const l = parseFloat(p.length) || 96;
      const qty = parseInt(p.quantity) || 1;
      const bf = (t * w * l) / 144;
      const pricePerBF = parseFloat(p.pricePerBF) || 0;
      return { species: p.species || p.name, dimensions: `${t}" x ${w}" x ${l}"`, quantity: qty, boardFeetEach: Math.round(bf * 100) / 100, totalBoardFeet: Math.round(bf * qty * 100) / 100, cost: pricePerBF > 0 ? Math.round(bf * qty * pricePerBF * 100) / 100 : null };
    });
    const totalBF = calculated.reduce((s, c) => s + c.totalBoardFeet, 0);
    const totalCost = calculated.reduce((s, c) => s + (c.cost || 0), 0);
    return { ok: true, result: { pieces: calculated, totalBoardFeet: Math.round(totalBF * 100) / 100, wasteAllowance: Math.round(totalBF * 0.15 * 100) / 100, totalWithWaste: Math.round(totalBF * 1.15 * 100) / 100, totalCost: totalCost > 0 ? Math.round(totalCost * 100) / 100 : "Price per BF not specified" } };
  });

  registerLensAction("carpentry", "jointStrength", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const jointType = (data.jointType || "butt").toLowerCase();
    const species = (data.species || data.wood || "pine").toLowerCase();
    const strengths = { "butt": 15, "pocket-hole": 35, "dowel": 50, "biscuit": 40, "mortise-tenon": 90, "dovetail": 95, "box-joint": 80, "dado": 60, "rabbet": 45, "half-lap": 55, "bridle": 70, "tongue-groove": 50 };
    const speciesMultiplier = { pine: 0.7, oak: 1.2, maple: 1.1, walnut: 1.0, cherry: 0.95, cedar: 0.6, mahogany: 1.0, birch: 1.05, ash: 1.15, poplar: 0.75 };
    const baseStrength = strengths[jointType] || 30;
    const mult = speciesMultiplier[species] || 0.85;
    const effectiveStrength = Math.round(baseStrength * mult);
    const useGlue = data.glued !== false;
    const glueBonus = useGlue ? 20 : 0;
    return { ok: true, result: { jointType, species, baseStrength, speciesMultiplier: mult, glueBonus: useGlue ? "+20" : "none", effectiveStrength: effectiveStrength + glueBonus, rating: effectiveStrength + glueBonus >= 80 ? "excellent" : effectiveStrength + glueBonus >= 50 ? "good" : effectiveStrength + glueBonus >= 30 ? "moderate" : "weak", recommendation: effectiveStrength < 40 ? "Consider upgrading to a stronger joint type" : "Joint is appropriate for the application" } };
  });

  registerLensAction("carpentry", "woodSelection", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const use = (data.application || data.use || "furniture").toLowerCase();
    const budget = (data.budget || "medium").toLowerCase();
    const indoor = data.indoor !== false;
    const woods = [
      { name: "Pine", hardness: 380, cost: "low", indoor: true, outdoor: false, workability: "excellent", best: ["shelving", "framing", "painted-furniture"] },
      { name: "Oak", hardness: 1290, cost: "medium", indoor: true, outdoor: true, workability: "good", best: ["furniture", "flooring", "cabinetry"] },
      { name: "Maple", hardness: 1450, cost: "medium", indoor: true, outdoor: false, workability: "moderate", best: ["cutting-boards", "furniture", "flooring"] },
      { name: "Walnut", hardness: 1010, cost: "high", indoor: true, outdoor: false, workability: "excellent", best: ["fine-furniture", "decorative", "turnings"] },
      { name: "Cherry", hardness: 950, cost: "high", indoor: true, outdoor: false, workability: "excellent", best: ["fine-furniture", "cabinetry"] },
      { name: "Cedar", hardness: 350, cost: "medium", indoor: true, outdoor: true, workability: "excellent", best: ["decking", "fencing", "outdoor-furniture"] },
      { name: "Teak", hardness: 1155, cost: "high", indoor: true, outdoor: true, workability: "moderate", best: ["outdoor-furniture", "boat-building"] },
      { name: "Poplar", hardness: 540, cost: "low", indoor: true, outdoor: false, workability: "excellent", best: ["painted-furniture", "trim", "drawers"] },
    ];
    const suitable = woods.filter(w => {
      if (!indoor && !w.outdoor) return false;
      if (budget === "low" && w.cost === "high") return false;
      return true;
    }).sort((a, b) => {
      const useMatch = (w) => w.best.some(b => use.includes(b) || b.includes(use)) ? 1 : 0;
      return useMatch(b) - useMatch(a);
    });
    return { ok: true, result: { application: use, environment: indoor ? "indoor" : "outdoor", budget, recommendations: suitable.slice(0, 4).map(w => ({ name: w.name, hardness: `${w.hardness} (Janka)`, cost: w.cost, workability: w.workability, bestFor: w.best.join(", ") })), topPick: suitable[0]?.name || "Oak" } };
  });

  registerLensAction("carpentry", "finishRecommendation", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const species = (data.species || data.wood || "oak").toLowerCase();
    const use = (data.application || "furniture").toLowerCase();
    const indoor = data.indoor !== false;
    const finishes = [
      { name: "Danish Oil", durability: 3, ease: 5, appearance: "natural", indoor: true, outdoor: false, toxicity: "low", dryHours: 8, coats: 2 },
      { name: "Polyurethane (Oil)", durability: 5, ease: 3, appearance: "glossy", indoor: true, outdoor: true, toxicity: "medium", dryHours: 24, coats: 3 },
      { name: "Polyurethane (Water)", durability: 4, ease: 4, appearance: "clear", indoor: true, outdoor: false, toxicity: "low", dryHours: 4, coats: 3 },
      { name: "Lacquer", durability: 4, ease: 2, appearance: "mirror", indoor: true, outdoor: false, toxicity: "high", dryHours: 1, coats: 4 },
      { name: "Tung Oil", durability: 3, ease: 5, appearance: "warm", indoor: true, outdoor: true, toxicity: "very-low", dryHours: 24, coats: 3 },
      { name: "Spar Varnish", durability: 5, ease: 3, appearance: "amber", indoor: true, outdoor: true, toxicity: "medium", dryHours: 24, coats: 3 },
      { name: "Shellac", durability: 2, ease: 4, appearance: "warm-amber", indoor: true, outdoor: false, toxicity: "very-low", dryHours: 2, coats: 3 },
      { name: "Wax", durability: 1, ease: 5, appearance: "satin", indoor: true, outdoor: false, toxicity: "none", dryHours: 1, coats: 2 },
    ];
    const suitable = finishes.filter(f => indoor || f.outdoor).sort((a, b) => b.durability + b.ease - (a.durability + a.ease));
    return { ok: true, result: { wood: species, application: use, environment: indoor ? "indoor" : "outdoor", topRecommendation: suitable[0]?.name, options: suitable.slice(0, 4).map(f => ({ name: f.name, durability: `${f.durability}/5`, easeOfApplication: `${f.ease}/5`, appearance: f.appearance, toxicity: f.toxicity, dryTime: `${f.dryHours}h`, coatsNeeded: f.coats })) } };
  });

  // ─── Trade-management substrate (per-user, STATE-backed) ─────────────

  function getCarpentryState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.carpentryLens) STATE.carpentryLens = {};
    const s = STATE.carpentryLens;
    if (!(s.photoLogs instanceof Map)) s.photoLogs = new Map();    // userId -> Array<photoLog>
    if (!(s.scheduleJobs instanceof Map)) s.scheduleJobs = new Map(); // userId -> Array<scheduledJob>
    if (!(s.crew instanceof Map)) s.crew = new Map();              // userId -> Array<crewMember>
    if (!(s.timeEntries instanceof Map)) s.timeEntries = new Map(); // userId -> Array<timeEntry>
    if (!(s.activeTimers instanceof Map)) s.activeTimers = new Map(); // userId -> Map<jobId, startMs>
    if (!(s.invoices instanceof Map)) s.invoices = new Map();      // userId -> Array<invoice>
    if (!(s.portalShares instanceof Map)) s.portalShares = new Map(); // token -> share
    return s;
  }
  function saveCarpentry() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const cpId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cpActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const cpClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const cpNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const cpArr = (map, userId) => { if (!map.has(userId)) map.set(userId, []); return map.get(userId); };

  // ─── Feature: Cut list / lumber optimization ─────────────────────────
  // First-fit-decreasing bin packing — assign required cuts to stock boards,
  // minimizing waste. Pure deterministic computation, no synthesized data.
  registerLensAction("carpentry", "cutListOptimize", (ctx, _a, params = {}) => {
    try {
      const kerf = Math.max(0, cpNum(params.kerf ?? 0.125)); // saw kerf inches
      const stockLength = Math.max(1, cpNum(params.stockLength ?? 96)); // inches per board
      const stockCost = Math.max(0, cpNum(params.stockCostPerBoard ?? 0));
      const rawCuts = Array.isArray(params.cuts) ? params.cuts : [];
      const cuts = [];
      for (const c of rawCuts) {
        const len = cpNum(c.length);
        const qty = Math.max(1, Math.round(cpNum(c.quantity ?? 1)));
        const label = cpClean(c.label || c.name || "cut", 80) || "cut";
        if (len <= 0) continue;
        if (len > stockLength) return { ok: false, error: `cut "${label}" (${len}") exceeds stock length ${stockLength}"` };
        for (let i = 0; i < qty; i++) cuts.push({ label, length: len });
      }
      if (cuts.length === 0) return { ok: false, error: "no valid cuts provided" };
      // first-fit-decreasing
      cuts.sort((a, b) => b.length - a.length);
      const boards = [];
      for (const cut of cuts) {
        let placed = false;
        for (const board of boards) {
          const need = cut.length + (board.cuts.length > 0 ? kerf : 0);
          if (board.remaining >= need) {
            board.cuts.push(cut);
            board.remaining -= need;
            placed = true;
            break;
          }
        }
        if (!placed) {
          boards.push({ remaining: stockLength - cut.length, cuts: [cut] });
        }
      }
      const totalCutLength = cuts.reduce((s, c) => s + c.length, 0);
      const totalStockLength = boards.length * stockLength;
      const wasteLength = Math.round((totalStockLength - totalCutLength) * 100) / 100;
      const wastePct = totalStockLength > 0 ? Math.round((wasteLength / totalStockLength) * 1000) / 10 : 0;
      const layout = boards.map((b, i) => ({
        board: i + 1,
        cuts: b.cuts.map((c) => ({ label: c.label, length: c.length })),
        usedLength: Math.round((stockLength - b.remaining) * 100) / 100,
        offcut: Math.round(b.remaining * 100) / 100,
      }));
      return {
        ok: true,
        result: {
          boardsNeeded: boards.length,
          stockLength,
          kerf,
          totalCutLength: Math.round(totalCutLength * 100) / 100,
          wasteLength,
          wastePct,
          materialCost: stockCost > 0 ? Math.round(boards.length * stockCost * 100) / 100 : null,
          layout,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── Feature: Project material takeoff → auto estimate ───────────────
  // Roll a list of line items (qty × unitCost) into a priced estimate with
  // labor, overhead and margin applied. Deterministic.
  registerLensAction("carpentry", "materialTakeoff", (ctx, _a, params = {}) => {
    try {
      const rawItems = Array.isArray(params.items) ? params.items : [];
      const items = [];
      for (const it of rawItems) {
        const qty = cpNum(it.quantity);
        const unitCost = cpNum(it.unitCost);
        if (qty <= 0) continue;
        const lineTotal = Math.round(qty * unitCost * 100) / 100;
        items.push({
          name: cpClean(it.name || "item", 120) || "item",
          quantity: qty,
          unit: cpClean(it.unit || "ea", 16) || "ea",
          unitCost: Math.round(unitCost * 100) / 100,
          lineTotal,
        });
      }
      if (items.length === 0) return { ok: false, error: "no valid takeoff items provided" };
      const materialSubtotal = items.reduce((s, i) => s + i.lineTotal, 0);
      const wastePct = Math.max(0, Math.min(50, cpNum(params.wastePct ?? 10)));
      const materialWithWaste = Math.round(materialSubtotal * (1 + wastePct / 100) * 100) / 100;
      const laborHours = Math.max(0, cpNum(params.laborHours));
      const laborRate = Math.max(0, cpNum(params.laborRate ?? 65));
      const laborCost = Math.round(laborHours * laborRate * 100) / 100;
      const overheadPct = Math.max(0, Math.min(60, cpNum(params.overheadPct ?? 12)));
      const marginPct = Math.max(0, Math.min(80, cpNum(params.marginPct ?? 20)));
      const baseCost = materialWithWaste + laborCost;
      const overhead = Math.round(baseCost * (overheadPct / 100) * 100) / 100;
      const subtotal = baseCost + overhead;
      const margin = Math.round(subtotal * (marginPct / 100) * 100) / 100;
      const total = Math.round((subtotal + margin) * 100) / 100;
      return {
        ok: true,
        result: {
          projectName: cpClean(params.projectName || "Untitled Project", 160),
          items,
          materialSubtotal: Math.round(materialSubtotal * 100) / 100,
          wastePct,
          materialWithWaste,
          laborHours,
          laborRate,
          laborCost,
          overheadPct,
          overhead,
          marginPct,
          margin,
          total,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── Feature: Photo job-log with before/after per job ────────────────
  registerLensAction("carpentry", "photoLogAdd", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const jobId = cpClean(params.jobId, 120);
      if (!jobId) return { ok: false, error: "jobId required" };
      const url = cpClean(params.imageUrl || params.url, 2000);
      if (!url) return { ok: false, error: "imageUrl required" };
      const phase = ["before", "during", "after"].includes(params.phase) ? params.phase : "during";
      const entry = {
        id: cpId("photo"),
        jobId,
        jobName: cpClean(params.jobName, 160) || jobId,
        imageUrl: url,
        phase,
        caption: cpClean(params.caption, 400) || "",
        takenAt: new Date().toISOString(),
      };
      cpArr(s.photoLogs, cpActor(ctx)).unshift(entry);
      saveCarpentry();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "photoLogList", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      let entries = cpArr(s.photoLogs, cpActor(ctx));
      const jobId = cpClean(params.jobId, 120);
      if (jobId) entries = entries.filter((e) => e.jobId === jobId);
      const byJob = {};
      for (const e of entries) {
        if (!byJob[e.jobId]) byJob[e.jobId] = { jobId: e.jobId, jobName: e.jobName, before: 0, during: 0, after: 0 };
        byJob[e.jobId][e.phase] = (byJob[e.jobId][e.phase] || 0) + 1;
      }
      return { ok: true, result: { entries, count: entries.length, byJob: Object.values(byJob) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "photoLogDelete", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = cpArr(s.photoLogs, cpActor(ctx));
      const i = arr.findIndex((e) => e.id === params.id);
      if (i < 0) return { ok: false, error: "photo entry not found" };
      arr.splice(i, 1);
      saveCarpentry();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── Feature: Crew roster + scheduling / dispatch calendar ───────────
  registerLensAction("carpentry", "crewAdd", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const name = cpClean(params.name, 120);
      if (!name) return { ok: false, error: "crew member name required" };
      const member = {
        id: cpId("crew"),
        name,
        role: cpClean(params.role, 80) || "Carpenter",
        phone: cpClean(params.phone, 40) || "",
        hourlyRate: Math.max(0, cpNum(params.hourlyRate)),
        color: cpClean(params.color, 16) || "#d9a963",
        createdAt: new Date().toISOString(),
      };
      cpArr(s.crew, cpActor(ctx)).push(member);
      saveCarpentry();
      return { ok: true, result: { member } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "crewList", (ctx, _a, _params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const members = cpArr(s.crew, cpActor(ctx));
      return { ok: true, result: { members, count: members.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "crewRemove", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = cpArr(s.crew, cpActor(ctx));
      const i = arr.findIndex((m) => m.id === params.id);
      if (i < 0) return { ok: false, error: "crew member not found" };
      arr.splice(i, 1);
      saveCarpentry();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "scheduleAdd", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const title = cpClean(params.title, 160);
      const date = cpClean(params.date, 30);
      if (!title) return { ok: false, error: "schedule title required" };
      if (!date) return { ok: false, error: "schedule date required" };
      const entry = {
        id: cpId("sched"),
        title,
        date, // YYYY-MM-DD
        startTime: cpClean(params.startTime, 8) || "08:00",
        endTime: cpClean(params.endTime, 8) || "16:00",
        crewIds: Array.isArray(params.crewIds) ? params.crewIds.map((x) => cpClean(x, 80)).filter(Boolean) : [],
        jobId: cpClean(params.jobId, 120) || "",
        address: cpClean(params.address, 300) || "",
        status: ["scheduled", "dispatched", "done"].includes(params.status) ? params.status : "scheduled",
        notes: cpClean(params.notes, 600) || "",
        createdAt: new Date().toISOString(),
      };
      cpArr(s.scheduleJobs, cpActor(ctx)).push(entry);
      saveCarpentry();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "scheduleList", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = cpActor(ctx);
      let entries = cpArr(s.scheduleJobs, userId).slice();
      const from = cpClean(params.from, 30);
      const to = cpClean(params.to, 30);
      if (from) entries = entries.filter((e) => e.date >= from);
      if (to) entries = entries.filter((e) => e.date <= to);
      entries.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
      const crew = cpArr(s.crew, userId);
      const crewMap = {};
      for (const m of crew) crewMap[m.id] = m.name;
      const enriched = entries.map((e) => ({
        ...e,
        crewNames: e.crewIds.map((id) => crewMap[id] || id),
      }));
      return { ok: true, result: { entries: enriched, count: enriched.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "scheduleUpdate", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = cpArr(s.scheduleJobs, cpActor(ctx));
      const entry = arr.find((e) => e.id === params.id);
      if (!entry) return { ok: false, error: "schedule entry not found" };
      if (params.status && ["scheduled", "dispatched", "done"].includes(params.status)) entry.status = params.status;
      if (params.date != null) entry.date = cpClean(params.date, 30) || entry.date;
      if (params.startTime != null) entry.startTime = cpClean(params.startTime, 8) || entry.startTime;
      if (params.endTime != null) entry.endTime = cpClean(params.endTime, 8) || entry.endTime;
      if (Array.isArray(params.crewIds)) entry.crewIds = params.crewIds.map((x) => cpClean(x, 80)).filter(Boolean);
      if (params.notes != null) entry.notes = cpClean(params.notes, 600);
      saveCarpentry();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "scheduleDelete", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = cpArr(s.scheduleJobs, cpActor(ctx));
      const i = arr.findIndex((e) => e.id === params.id);
      if (i < 0) return { ok: false, error: "schedule entry not found" };
      arr.splice(i, 1);
      saveCarpentry();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── Feature: Time tracking per job for labor costing ────────────────
  registerLensAction("carpentry", "timerStart", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const jobId = cpClean(params.jobId, 120);
      if (!jobId) return { ok: false, error: "jobId required" };
      const userId = cpActor(ctx);
      if (!(s.activeTimers.get(userId) instanceof Map)) s.activeTimers.set(userId, new Map());
      const timers = s.activeTimers.get(userId);
      if (timers.has(jobId)) return { ok: false, error: "timer already running for this job" };
      timers.set(jobId, {
        startMs: Date.now(),
        jobName: cpClean(params.jobName, 160) || jobId,
        crewId: cpClean(params.crewId, 80) || "",
        rate: Math.max(0, cpNum(params.rate)),
      });
      saveCarpentry();
      return { ok: true, result: { jobId, startedAt: new Date().toISOString() } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "timerStop", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const jobId = cpClean(params.jobId, 120);
      if (!jobId) return { ok: false, error: "jobId required" };
      const userId = cpActor(ctx);
      const timers = s.activeTimers.get(userId);
      if (!(timers instanceof Map) || !timers.has(jobId)) return { ok: false, error: "no running timer for this job" };
      const t = timers.get(jobId);
      timers.delete(jobId);
      const endMs = Date.now();
      const hours = Math.round(((endMs - t.startMs) / 3600000) * 100) / 100;
      const entry = {
        id: cpId("time"),
        jobId,
        jobName: t.jobName,
        crewId: t.crewId,
        hours,
        rate: t.rate,
        cost: Math.round(hours * t.rate * 100) / 100,
        startedAt: new Date(t.startMs).toISOString(),
        endedAt: new Date(endMs).toISOString(),
        source: "timer",
      };
      cpArr(s.timeEntries, userId).unshift(entry);
      saveCarpentry();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "timeEntryAdd", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const jobId = cpClean(params.jobId, 120);
      if (!jobId) return { ok: false, error: "jobId required" };
      const hours = cpNum(params.hours);
      if (hours <= 0) return { ok: false, error: "hours must be positive" };
      const rate = Math.max(0, cpNum(params.rate));
      const entry = {
        id: cpId("time"),
        jobId,
        jobName: cpClean(params.jobName, 160) || jobId,
        crewId: cpClean(params.crewId, 80) || "",
        hours: Math.round(hours * 100) / 100,
        rate,
        cost: Math.round(hours * rate * 100) / 100,
        date: cpClean(params.date, 30) || new Date().toISOString().slice(0, 10),
        source: "manual",
      };
      cpArr(s.timeEntries, cpActor(ctx)).unshift(entry);
      saveCarpentry();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "timeEntryList", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = cpActor(ctx);
      let entries = cpArr(s.timeEntries, userId).slice();
      const jobId = cpClean(params.jobId, 120);
      if (jobId) entries = entries.filter((e) => e.jobId === jobId);
      const timers = s.activeTimers.get(userId);
      const running = [];
      if (timers instanceof Map) {
        for (const [jid, t] of timers.entries()) {
          if (jobId && jid !== jobId) continue;
          running.push({
            jobId: jid,
            jobName: t.jobName,
            elapsedHours: Math.round(((Date.now() - t.startMs) / 3600000) * 100) / 100,
            startedAt: new Date(t.startMs).toISOString(),
          });
        }
      }
      const totalHours = Math.round(entries.reduce((n, e) => n + e.hours, 0) * 100) / 100;
      const totalCost = Math.round(entries.reduce((n, e) => n + e.cost, 0) * 100) / 100;
      const byJob = {};
      for (const e of entries) {
        if (!byJob[e.jobId]) byJob[e.jobId] = { jobId: e.jobId, jobName: e.jobName, hours: 0, cost: 0 };
        byJob[e.jobId].hours = Math.round((byJob[e.jobId].hours + e.hours) * 100) / 100;
        byJob[e.jobId].cost = Math.round((byJob[e.jobId].cost + e.cost) * 100) / 100;
      }
      return { ok: true, result: { entries, running, totalHours, totalCost, byJob: Object.values(byJob), count: entries.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "timeEntryDelete", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = cpArr(s.timeEntries, cpActor(ctx));
      const i = arr.findIndex((e) => e.id === params.id);
      if (i < 0) return { ok: false, error: "time entry not found" };
      arr.splice(i, 1);
      saveCarpentry();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── Feature: Estimate → invoice conversion + e-signature on quotes ──
  registerLensAction("carpentry", "estimateToInvoice", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const estimateId = cpClean(params.estimateId, 120);
      if (!estimateId) return { ok: false, error: "estimateId required" };
      const amount = cpNum(params.amount);
      if (amount <= 0) return { ok: false, error: "invoice amount must be positive" };
      const userId = cpActor(ctx);
      const arr = cpArr(s.invoices, userId);
      const taxPct = Math.max(0, Math.min(25, cpNum(params.taxPct ?? 0)));
      const tax = Math.round(amount * (taxPct / 100) * 100) / 100;
      const depositPct = Math.max(0, Math.min(100, cpNum(params.depositPct ?? 0)));
      const total = Math.round((amount + tax) * 100) / 100;
      const invoice = {
        id: cpId("inv"),
        invoiceNumber: `INV-${arr.length + 1001}`,
        estimateId,
        client: cpClean(params.client, 160) || "Client",
        clientEmail: cpClean(params.clientEmail, 200) || "",
        subtotal: Math.round(amount * 100) / 100,
        taxPct,
        tax,
        total,
        depositPct,
        depositDue: Math.round(total * (depositPct / 100) * 100) / 100,
        status: "issued",
        signature: null, // estimate signed at quote time
        issuedAt: new Date().toISOString(),
        dueDate: cpClean(params.dueDate, 30) || "",
        paidAt: null,
      };
      arr.unshift(invoice);
      saveCarpentry();
      return { ok: true, result: { invoice } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "invoiceList", (ctx, _a, _params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const invoices = cpArr(s.invoices, cpActor(ctx));
      const outstanding = invoices.filter((i) => i.status !== "paid").reduce((n, i) => n + i.total, 0);
      const collected = invoices.filter((i) => i.status === "paid").reduce((n, i) => n + i.total, 0);
      return {
        ok: true,
        result: {
          invoices,
          count: invoices.length,
          outstanding: Math.round(outstanding * 100) / 100,
          collected: Math.round(collected * 100) / 100,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("carpentry", "invoiceMarkPaid", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const inv = cpArr(s.invoices, cpActor(ctx)).find((i) => i.id === params.id);
      if (!inv) return { ok: false, error: "invoice not found" };
      inv.status = "paid";
      inv.paidAt = new Date().toISOString();
      saveCarpentry();
      return { ok: true, result: { invoice: inv } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // e-signature on a quote/estimate — records a typed signature + timestamp.
  registerLensAction("carpentry", "signEstimate", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const estimateId = cpClean(params.estimateId, 120);
      if (!estimateId) return { ok: false, error: "estimateId required" };
      const signedBy = cpClean(params.signedBy, 160);
      if (!signedBy) return { ok: false, error: "signedBy (typed full name) required" };
      const accepted = params.accepted !== false;
      const signature = {
        estimateId,
        signedBy,
        accepted,
        decision: accepted ? "approved" : "declined",
        signedAt: new Date().toISOString(),
        ip: cpClean(params.ip, 60) || "",
      };
      // attach to any invoice already converted from this estimate
      const invoices = cpArr(s.invoices, cpActor(ctx));
      for (const inv of invoices) {
        if (inv.estimateId === estimateId) inv.signature = signature;
      }
      saveCarpentry();
      return { ok: true, result: { signature } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ─── Feature: Client portal — approve estimates / view progress ──────
  // Creates a shareable read-only token bundling an estimate + job progress.
  registerLensAction("carpentry", "portalCreate", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const client = cpClean(params.client, 160);
      if (!client) return { ok: false, error: "client name required" };
      const token = cpId("portal");
      const share = {
        token,
        ownerId: cpActor(ctx),
        client,
        estimateId: cpClean(params.estimateId, 120) || "",
        estimateAmount: Math.max(0, cpNum(params.estimateAmount)),
        jobId: cpClean(params.jobId, 120) || "",
        jobName: cpClean(params.jobName, 160) || "",
        progressPct: Math.max(0, Math.min(100, Math.round(cpNum(params.progressPct)))),
        milestones: Array.isArray(params.milestones)
          ? params.milestones.map((m) => ({
              label: cpClean(m.label || m, 160),
              done: !!m.done,
            })).filter((m) => m.label)
          : [],
        status: "open",
        clientDecision: null,
        createdAt: new Date().toISOString(),
      };
      s.portalShares.set(token, share);
      saveCarpentry();
      return { ok: true, result: { token, portalUrl: `/portal/carpentry/${token}`, share } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // public read — client opens the portal with the token
  registerLensAction("carpentry", "portalView", (_ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const token = cpClean(params.token, 120);
      const share = s.portalShares.get(token);
      if (!share) return { ok: false, error: "portal not found or expired" };
      return { ok: true, result: { share } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // owner lists their active portals
  registerLensAction("carpentry", "portalList", (ctx, _a, _params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = cpActor(ctx);
      const shares = [];
      for (const share of s.portalShares.values()) {
        if (share.ownerId === userId) shares.push(share);
      }
      shares.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return { ok: true, result: { shares, count: shares.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // client approves/declines the estimate via the portal
  registerLensAction("carpentry", "portalRespond", (_ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const token = cpClean(params.token, 120);
      const share = s.portalShares.get(token);
      if (!share) return { ok: false, error: "portal not found or expired" };
      const decision = ["approved", "declined"].includes(params.decision) ? params.decision : null;
      if (!decision) return { ok: false, error: "decision must be 'approved' or 'declined'" };
      share.clientDecision = {
        decision,
        signedBy: cpClean(params.signedBy, 160) || share.client,
        respondedAt: new Date().toISOString(),
      };
      share.status = decision === "approved" ? "approved" : "declined";
      saveCarpentry();
      return { ok: true, result: { share } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // owner updates job progress shown in the portal
  registerLensAction("carpentry", "portalUpdateProgress", (ctx, _a, params = {}) => {
    try {
      const s = getCarpentryState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const token = cpClean(params.token, 120);
      const share = s.portalShares.get(token);
      if (!share) return { ok: false, error: "portal not found" };
      if (share.ownerId !== cpActor(ctx)) return { ok: false, error: "not authorized" };
      if (params.progressPct != null) {
        share.progressPct = Math.max(0, Math.min(100, Math.round(cpNum(params.progressPct))));
      }
      if (Array.isArray(params.milestones)) {
        share.milestones = params.milestones
          .map((m) => ({ label: cpClean(m.label || m, 160), done: !!m.done }))
          .filter((m) => m.label);
      }
      saveCarpentry();
      return { ok: true, result: { share } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
