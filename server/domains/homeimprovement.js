// server/domains/homeimprovement.js
//
// Home-improvement lens. Planning calculators (project estimate, ROI,
// permit check, colour palette) + a per-user renovation-project
// substrate (projects / tasks / expenses) + a real CPSC product-recall
// feed. Free public source, no API key.

export default function registerHomeImprovementActions(registerLensAction) {
  // ─── Planning calculators ───────────────────────────────────────────
  registerLensAction("home-improvement", "projectEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const sqft = parseFloat(data.squareFootage) || 0;
    const projectType = (data.projectType || "general").toLowerCase();
    const costPerSqFt = { kitchen: 150, bathroom: 125, flooring: 8, painting: 4, roofing: 7, deck: 25, basement: 40, addition: 200, general: 50 };
    const rate = costPerSqFt[projectType] || 50;
    const materialsCost = Math.round(sqft * rate * 0.6);
    const laborCost = Math.round(sqft * rate * 0.4);
    const permits = sqft > 200 || projectType === "addition" ? Math.round(sqft * 2) : 0;
    const total = materialsCost + laborCost + permits;
    return { ok: true, result: { projectType, squareFootage: sqft, materialsCost, laborCost, permits, total, diyEstimate: Math.round(total * 0.55), contractorEstimate: total, savings: Math.round(total * 0.45), timeline: sqft > 500 ? "4-8 weeks" : sqft > 200 ? "2-4 weeks" : "1-2 weeks" } };
  });
  registerLensAction("home-improvement", "roiCalculator", (ctx, artifact, _params) => {
    const projects = artifact.data?.projects || [];
    if (projects.length === 0) return { ok: true, result: { message: "Add improvement projects with cost and value-add to calculate ROI." } };
    const analyzed = projects.map(p => { const cost = parseFloat(p.cost) || 0; const valueAdd = parseFloat(p.valueAdded) || 0; const roi = cost > 0 ? Math.round(((valueAdd - cost) / cost) * 100) : 0; return { project: p.name, cost, valueAdded: valueAdd, roi, netGain: valueAdd - cost, worthIt: roi > 0 }; }).sort((a, b) => b.roi - a.roi);
    return { ok: true, result: { projects: analyzed, bestROI: analyzed[0]?.project, worstROI: analyzed[analyzed.length - 1]?.project, totalInvested: analyzed.reduce((s, p) => s + p.cost, 0), totalValueAdded: analyzed.reduce((s, p) => s + p.valueAdded, 0), avgROI: Math.round(analyzed.reduce((s, p) => s + p.roi, 0) / analyzed.length) } };
  });
  registerLensAction("home-improvement", "permitCheck", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const projectType = (data.projectType || "").toLowerCase();
    const requiresPermit = ["addition", "electrical", "plumbing", "structural", "roofing", "hvac", "deck", "fence-over-6ft", "demolition", "foundation"].some(t => projectType.includes(t));
    const noPermit = ["painting", "flooring", "cabinet", "countertop", "landscaping", "minor-repair"].some(t => projectType.includes(t));
    return { ok: true, result: { projectType, requiresPermit: requiresPermit && !noPermit, permitType: requiresPermit ? "building-permit" : "none", estimatedCost: requiresPermit ? "$100-$500" : "$0", processingTime: requiresPermit ? "2-6 weeks" : "N/A", inspectionsRequired: requiresPermit ? ["rough inspection", "final inspection"] : [], tip: requiresPermit ? "Apply for permit before starting work — unpermitted work can affect resale" : "No permit needed for this type of work" } };
  });
  registerLensAction("home-improvement", "colorPalette", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const room = (data.room || "living room").toLowerCase();
    const style = (data.style || "modern").toLowerCase();
    const palettes = { modern: { primary: "#FFFFFF", accent: "#2C2C2C", warm: "#E8D4B8", pop: "#4A90D9" }, farmhouse: { primary: "#F5F0EB", accent: "#8B7355", warm: "#D4A574", pop: "#6B8E5A" }, coastal: { primary: "#FFFFFF", accent: "#5B8FA8", warm: "#E8D6C4", pop: "#2F6682" }, traditional: { primary: "#F0EDE8", accent: "#5C3D2E", warm: "#C4956A", pop: "#8B4513" }, minimalist: { primary: "#FAFAFA", accent: "#333333", warm: "#E0DCD8", pop: "#B0B0B0" } };
    const palette = palettes[style] || palettes.modern;
    return { ok: true, result: { room, style, palette, wallColor: palette.primary, trim: "#FFFFFF", accent: palette.accent, furniture: palette.warm, decor: palette.pop, coverage: data.squareFootage ? `${Math.ceil(parseFloat(data.squareFootage) / 350)} gallons of paint needed` : "Measure walls to estimate paint" } };
  });

  // ─── Renovation-project substrate (per-user, STATE-backed) ──────────
  function getHiState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.homeImprovementLens) STATE.homeImprovementLens = {};
    const s = STATE.homeImprovementLens;
    if (!(s.projects instanceof Map)) s.projects = new Map(); // userId -> Array
    return s;
  }
  function saveHi() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const hiId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const hiActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const hiClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const hiNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const hiProjects = (s, userId) => { if (!s.projects.has(userId)) s.projects.set(userId, []); return s.projects.get(userId); };
  const ROOMS = ["kitchen", "bathroom", "bedroom", "living_room", "basement", "garage", "exterior", "whole_house", "other"];

  registerLensAction("home-improvement", "project-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hiClean(params.name, 160);
    if (!name) return { ok: false, error: "project name required" };
    const project = {
      id: hiId("proj"), name,
      room: ROOMS.includes(params.room) ? params.room : "other",
      budget: Math.max(0, hiNum(params.budget)),
      status: "planning",
      notes: hiClean(params.notes, 1000) || "",
      tasks: [], expenses: [],
      createdAt: new Date().toISOString(),
    };
    hiProjects(s, hiActor(ctx)).push(project);
    saveHi();
    return { ok: true, result: { project } };
  });

  registerLensAction("home-improvement", "project-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projects = hiProjects(s, hiActor(ctx)).map((p) => {
      const spent = p.expenses.reduce((n, e) => n + e.amount, 0);
      return {
        ...p, taskCount: p.tasks.length,
        tasksDone: p.tasks.filter((t) => t.done).length,
        spent: Math.round(spent * 100) / 100,
        budgetRemaining: Math.round((p.budget - spent) * 100) / 100,
      };
    });
    return { ok: true, result: { projects, count: projects.length } };
  });

  registerLensAction("home-improvement", "project-status", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.id);
    if (!project) return { ok: false, error: "project not found" };
    project.status = ["planning", "in_progress", "on_hold", "complete"].includes(params.status) ? params.status : project.status;
    saveHi();
    return { ok: true, result: { project } };
  });

  registerLensAction("home-improvement", "project-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiProjects(s, hiActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("home-improvement", "task-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const task = { id: hiId("task"), label: hiClean(params.label, 200) || "task", done: false };
    project.tasks.push(task);
    saveHi();
    return { ok: true, result: { task } };
  });

  registerLensAction("home-improvement", "task-toggle", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const task = project.tasks.find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    task.done = !task.done;
    saveHi();
    return { ok: true, result: { task } };
  });

  registerLensAction("home-improvement", "expense-log", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const expense = {
      id: hiId("exp"),
      label: hiClean(params.label, 160) || "expense",
      amount: Math.max(0, hiNum(params.amount)),
      kind: ["materials", "labor", "permit", "tools", "other"].includes(params.kind) ? params.kind : "materials",
      date: hiClean(params.date, 30) || new Date().toISOString().slice(0, 10),
    };
    project.expenses.push(expense);
    saveHi();
    return { ok: true, result: { expense } };
  });

  registerLensAction("home-improvement", "home-improvement-dashboard", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projects = hiProjects(s, hiActor(ctx));
    let budget = 0, spent = 0, tasks = 0, tasksDone = 0;
    for (const p of projects) {
      budget += p.budget;
      spent += p.expenses.reduce((n, e) => n + e.amount, 0);
      tasks += p.tasks.length;
      tasksDone += p.tasks.filter((t) => t.done).length;
    }
    return {
      ok: true,
      result: {
        projects: projects.length,
        activeProjects: projects.filter((p) => p.status === "in_progress").length,
        totalBudget: Math.round(budget * 100) / 100,
        totalSpent: Math.round(spent * 100) / 100,
        tasks, tasksDone,
      },
    };
  });

  // feed — ingest real consumer-product recalls from the U.S. Consumer
  // Product Safety Commission as visible DTUs. Free public API, no key.
  registerLensAction("home-improvement", "feed", async (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    try {
      const r = await fetch("https://www.saferproducts.gov/RestWebServices/Recall?format=json");
      if (!r.ok) return { ok: false, error: `cpsc ${r.status}` };
      const data = await r.json();
      const recalls = (Array.isArray(data) ? data : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const rec of recalls) {
        const id = `cpsc_${rec.RecallID || rec.RecallNumber}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const product = (rec.Products?.[0]?.Name || rec.Title || "Product recall").slice(0, 90);
        const hazard = rec.Hazards?.[0]?.Name || "?";
        const title = `Product recall: ${product}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nHazard: ${hazard}\nRemedy: ${(rec.Remedies?.[0]?.Name) || "?"}\nRecall date: ${rec.RecallDate || "?"}\nDescription: ${(rec.Description || "").replace(/<[^>]+>/g, "").slice(0, 600)}\nSource: U.S. Consumer Product Safety Commission`,
          tags: ["home-improvement", "feed", "product-recall", "cpsc"],
          source: "cpsc-feed",
          meta: { recallId: rec.RecallID, product, hazard, recallDate: rec.RecallDate },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveHi();
      return { ok: true, result: { ingested, skipped, source: "cpsc-recalls", dtuIds } };
    } catch (e) {
      return { ok: false, error: `cpsc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
