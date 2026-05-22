// server/domains/diy.js
// Domain actions for DIY/maker: project cost estimation, material calculation,
// tool inventory management, build time estimation, safety assessment.

export default function registerDIYActions(registerLensAction) {
  /**
   * estimateProject
   * Calculate total project cost, time, and material needs.
   * artifact.data: { name, category, materials: [{ name, quantity, unit, unitPrice }], laborHours, hourlyRate }
   */
  registerLensAction("diy", "estimateProject", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const materials = data.materials || [];
    const laborHours = parseFloat(data.estimatedHours || data.laborHours) || 0;
    const hourlyRate = parseFloat(data.hourlyRate) || 25;

    const materialCosts = materials.map(m => {
      const qty = parseFloat(m.quantity) || 0;
      const price = parseFloat(m.unitPrice || m.price) || 0;
      const total = Math.round(qty * price * 100) / 100;
      return { name: m.name, quantity: qty, unit: m.unit || "pcs", unitPrice: price, total };
    });

    const totalMaterials = materialCosts.reduce((s, m) => s + m.total, 0);
    const laborCost = Math.round(laborHours * hourlyRate * 100) / 100;
    const wasteFactor = 1.1; // 10% waste allowance
    const adjustedMaterials = Math.round(totalMaterials * wasteFactor * 100) / 100;

    // Contingency: 15% for beginner, 10% intermediate, 5% advanced
    const difficulty = (data.difficulty || "intermediate").toLowerCase();
    const contingencyRates = { beginner: 0.15, intermediate: 0.10, advanced: 0.05, expert: 0.03 };
    const contingencyRate = contingencyRates[difficulty] || 0.10;
    const contingency = Math.round((adjustedMaterials + laborCost) * contingencyRate * 100) / 100;

    const totalEstimate = Math.round((adjustedMaterials + laborCost + contingency) * 100) / 100;

    return {
      ok: true,
      result: {
        projectName: data.name || artifact.title,
        category: data.category,
        difficulty,
        breakdown: {
          materialsCost: totalMaterials,
          wasteAllowance: Math.round((adjustedMaterials - totalMaterials) * 100) / 100,
          adjustedMaterials,
          laborCost,
          laborHours,
          hourlyRate,
          contingency,
          contingencyRate: `${Math.round(contingencyRate * 100)}%`,
        },
        totalEstimate,
        materialItems: materialCosts,
        perUnit: materials.length > 0 ? Math.round(totalEstimate / materials.length * 100) / 100 : 0,
        budgetTip: totalEstimate > 500 ? "Consider phasing the project — buy materials in stages" : "Project is within a reasonable single-purchase budget",
      },
    };
  });

  /**
   * cutList
   * Generate an optimized cut list to minimize material waste.
   * artifact.data: { stockLength, cuts: [{ length, quantity, label }] }
   */
  registerLensAction("diy", "cutList", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const stockLength = parseFloat(data.stockLength) || 96; // default 8ft board in inches
    const cuts = data.cuts || [];

    if (cuts.length === 0) {
      return { ok: true, result: { message: "Add cuts with length and quantity to generate an optimized cut list." } };
    }

    // Expand cuts by quantity
    const expandedCuts = [];
    for (const cut of cuts) {
      const qty = parseInt(cut.quantity) || 1;
      for (let i = 0; i < qty; i++) {
        expandedCuts.push({ length: parseFloat(cut.length) || 0, label: cut.label || `Cut ${expandedCuts.length + 1}` });
      }
    }

    // Sort cuts by length descending (first-fit decreasing bin packing)
    expandedCuts.sort((a, b) => b.length - a.length);

    const boards = [];
    const kerfWidth = 0.125; // 1/8" saw kerf

    for (const cut of expandedCuts) {
      let placed = false;
      for (const board of boards) {
        if (board.remaining >= cut.length + kerfWidth) {
          board.cuts.push(cut);
          board.remaining -= cut.length + kerfWidth;
          board.used += cut.length + kerfWidth;
          placed = true;
          break;
        }
      }
      if (!placed) {
        boards.push({
          id: boards.length + 1,
          stockLength,
          cuts: [cut],
          remaining: stockLength - cut.length - kerfWidth,
          used: cut.length + kerfWidth,
        });
      }
    }

    // Calculate efficiency
    const totalUsed = boards.reduce((s, b) => s + b.used, 0);
    const totalStock = boards.length * stockLength;
    const efficiency = Math.round((totalUsed / totalStock) * 100);
    const totalWaste = Math.round((totalStock - totalUsed) * 100) / 100;

    return {
      ok: true,
      result: {
        stockLength,
        kerfWidth,
        totalCuts: expandedCuts.length,
        boardsNeeded: boards.length,
        boards: boards.map(b => ({
          board: b.id,
          cuts: b.cuts.map(c => `${c.label}: ${c.length}"`),
          remaining: Math.round(b.remaining * 100) / 100,
          utilization: Math.round(((stockLength - b.remaining) / stockLength) * 100),
        })),
        efficiency,
        totalWaste,
        wasteTip: efficiency < 70 ? "Low efficiency — try adjusting cut sizes or using different stock lengths" : "Good material utilization",
      },
    };
  });

  /**
   * toolCheck
   * Analyze required tools for a project and flag what's missing.
   * artifact.data: { requiredTools: [string], ownedTools: [{ name, condition }] }
   */
  registerLensAction("diy", "toolCheck", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const required = data.requiredTools || [];
    const owned = data.ownedTools || [];

    if (required.length === 0) {
      return { ok: true, result: { message: "List required tools for the project to check availability." } };
    }

    const ownedNames = owned.map(t => (t.name || t).toLowerCase());
    const analysis = required.map(tool => {
      const toolLower = tool.toLowerCase();
      const match = owned.find(o => (o.name || o).toLowerCase().includes(toolLower) || toolLower.includes((o.name || o).toLowerCase()));
      return {
        tool,
        owned: !!match,
        condition: match ? (match.condition || "good") : null,
        needsRepair: match && (match.condition || "").toLowerCase() === "needs repair",
      };
    });

    const missing = analysis.filter(a => !a.owned);
    const needsRepair = analysis.filter(a => a.needsRepair);

    // Rough rental vs buy estimates
    const rentalEstimates = {
      "table saw": { buy: 400, rent: 50 },
      "drill press": { buy: 300, rent: 40 },
      "router": { buy: 150, rent: 30 },
      "sander": { buy: 80, rent: 25 },
      "jigsaw": { buy: 100, rent: 25 },
      "circular saw": { buy: 120, rent: 30 },
      "miter saw": { buy: 250, rent: 45 },
      "welder": { buy: 500, rent: 60 },
      "soldering iron": { buy: 30, rent: 10 },
    };

    const missingCosts = missing.map(m => {
      const estimate = Object.entries(rentalEstimates).find(([k]) => m.tool.toLowerCase().includes(k));
      return {
        tool: m.tool,
        buyEstimate: estimate ? estimate[1].buy : null,
        rentEstimate: estimate ? estimate[1].rent : null,
      };
    });

    return {
      ok: true,
      result: {
        totalRequired: required.length,
        owned: analysis.filter(a => a.owned && !a.needsRepair).length,
        missing: missing.length,
        needsRepair: needsRepair.length,
        readyToStart: missing.length === 0 && needsRepair.length === 0,
        tools: analysis,
        missingCosts,
        totalBuyCost: missingCosts.reduce((s, m) => s + (m.buyEstimate || 0), 0),
        totalRentCost: missingCosts.reduce((s, m) => s + (m.rentEstimate || 0), 0),
        recommendation: missing.length > 3 ? "Consider renting — multiple tools needed" : missing.length > 0 ? "Buy if you'll reuse, rent for one-time projects" : "All tools available — ready to build",
      },
    };
  });

  /**
   * safetyCheck
   * Assess safety requirements for a DIY project.
   * artifact.data: { category, tools: [string], materials: [string], experience }
   */
  registerLensAction("diy", "safetyCheck", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const category = (data.category || "general").toLowerCase();
    const tools = (data.tools || []).map(t => typeof t === "string" ? t.toLowerCase() : (t.name || "").toLowerCase());
    const materials = (data.materials || []).map(m => typeof m === "string" ? m.toLowerCase() : (m.name || "").toLowerCase());
    const experience = (data.difficulty || data.experience || "intermediate").toLowerCase();

    const ppe = new Set(["safety glasses"]);
    const hazards = [];
    const precautions = [];

    // Tool-based hazards
    const hazardousTools = {
      "saw": { ppe: ["safety glasses", "hearing protection"], hazard: "Kickback and blade contact", precaution: "Use push sticks, never reach over blade" },
      "router": { ppe: ["safety glasses", "hearing protection", "dust mask"], hazard: "Flying debris", precaution: "Secure workpiece with clamps" },
      "welder": { ppe: ["welding helmet", "leather gloves", "fire-resistant clothing"], hazard: "Burns, UV exposure, fumes", precaution: "Ensure ventilation, keep fire extinguisher nearby" },
      "drill": { ppe: ["safety glasses"], hazard: "Bit breakage, entanglement", precaution: "Secure loose clothing, clamp workpiece" },
      "solder": { ppe: ["safety glasses", "fume extractor"], hazard: "Burns, flux fumes", precaution: "Work in ventilated area, use solder stand" },
      "grinder": { ppe: ["safety glasses", "face shield", "hearing protection"], hazard: "Flying sparks and fragments", precaution: "Check wheel for cracks before use" },
    };

    for (const tool of tools) {
      for (const [keyword, info] of Object.entries(hazardousTools)) {
        if (tool.includes(keyword)) {
          info.ppe.forEach(p => ppe.add(p));
          hazards.push(`${tool}: ${info.hazard}`);
          precautions.push(info.precaution);
        }
      }
    }

    // Material-based hazards
    if (materials.some(m => m.includes("epoxy") || m.includes("resin"))) {
      ppe.add("nitrile gloves"); ppe.add("respirator");
      hazards.push("Chemical exposure from epoxy/resin");
    }
    if (materials.some(m => m.includes("wood") || m.includes("mdf"))) {
      ppe.add("dust mask");
      hazards.push("Wood dust inhalation");
    }
    if (materials.some(m => m.includes("paint") || m.includes("stain") || m.includes("varnish"))) {
      ppe.add("respirator"); ppe.add("nitrile gloves");
      hazards.push("VOC exposure from finishes");
      precautions.push("Work outdoors or with exhaust ventilation");
    }

    const riskLevel = hazards.length >= 4 ? "high" : hazards.length >= 2 ? "moderate" : "low";

    return {
      ok: true,
      result: {
        riskLevel,
        requiredPPE: [...ppe],
        hazards,
        precautions,
        experienceLevel: experience,
        firstAid: ["Keep first aid kit accessible", "Know location of nearest fire extinguisher", "Have phone nearby for emergencies"],
        safetyScore: Math.max(0, 100 - hazards.length * 15),
        clearToStart: riskLevel !== "high" || experience === "advanced" || experience === "expert",
      },
    };
  });

  /**
   * buildTimeEstimate
   * Estimate total build time based on project complexity and experience.
   * artifact.data: { steps: [{ name, estimatedMinutes }], difficulty, experience }
   */
  registerLensAction("diy", "buildTimeEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const steps = data.steps || [];
    const difficulty = (data.difficulty || "intermediate").toLowerCase();

    if (steps.length === 0) {
      const baseHours = parseFloat(data.estimatedHours) || 0;
      if (baseHours <= 0) return { ok: true, result: { message: "Add project steps or estimated hours to calculate build time." } };

      // Apply experience multiplier to flat estimate
      const multipliers = { beginner: 1.8, intermediate: 1.2, advanced: 1.0, expert: 0.85 };
      const mult = multipliers[difficulty] || 1.2;
      return {
        ok: true,
        result: {
          baseHours,
          adjustedHours: Math.round(baseHours * mult * 10) / 10,
          multiplier: mult,
          difficulty,
        },
      };
    }

    // Per-step estimation
    const experienceMultipliers = { beginner: 1.8, intermediate: 1.2, advanced: 1.0, expert: 0.85 };
    const mult = experienceMultipliers[difficulty] || 1.2;

    const stepEstimates = steps.map(step => {
      const baseMinutes = parseFloat(step.estimatedMinutes || step.duration) || 30;
      const adjusted = Math.round(baseMinutes * mult);
      return {
        step: step.name || step.instruction || "Unnamed step",
        baseMinutes,
        adjustedMinutes: adjusted,
      };
    });

    const totalBaseMinutes = stepEstimates.reduce((s, st) => s + st.baseMinutes, 0);
    const totalAdjustedMinutes = stepEstimates.reduce((s, st) => s + st.adjustedMinutes, 0);

    // Add setup/cleanup time (15% of total)
    const setupMinutes = Math.round(totalAdjustedMinutes * 0.15);
    const grandTotal = totalAdjustedMinutes + setupMinutes;

    return {
      ok: true,
      result: {
        steps: stepEstimates,
        totalBaseMinutes,
        totalAdjustedMinutes,
        setupCleanupMinutes: setupMinutes,
        grandTotalMinutes: grandTotal,
        grandTotalHours: Math.round(grandTotal / 60 * 10) / 10,
        difficulty,
        experienceMultiplier: mult,
        weekends: Math.ceil(grandTotal / (6 * 60)), // ~6 productive hours per weekend day
        tip: grandTotal > 480 ? "Multi-day project — plan stopping points between steps" : "Should be completable in a single session",
      },
    };
  });

  // ─── Project workshop substrate (per-user, STATE-backed) ────────────
  // Powers: illustrated step-builder, BOM cost rollup, progress tracking,
  // tool-availability gate, gallery browse facets, project forking/remix.

  function getDIYState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.diyLens) STATE.diyLens = {};
    if (!(STATE.diyLens.projects instanceof Map)) STATE.diyLens.projects = new Map(); // userId -> Array<project>
    if (!(STATE.diyLens.published instanceof Map)) STATE.diyLens.published = new Map(); // projectId -> {project, owner}
    return STATE.diyLens;
  }
  function saveDIY() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const diyId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const diyActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const diyClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const diyNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const diyProjects = (s, userId) => { if (!s.projects.has(userId)) s.projects.set(userId, []); return s.projects.get(userId); };
  const DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert"];

  function findProject(s, userId, projectId) {
    return diyProjects(s, userId).find((p) => p.id === projectId) || null;
  }
  // Derived rollup so the UI never re-implements project math.
  function projectSummary(p) {
    const bom = p.bom || [];
    const steps = p.steps || [];
    const materialsCost = bom.reduce((sum, b) => sum + (diyNum(b.quantity) * diyNum(b.unitPrice)), 0);
    const ownedCount = bom.filter((b) => b.owned).length;
    const toBuyCost = bom.filter((b) => !b.owned).reduce((sum, b) => sum + (diyNum(b.quantity) * diyNum(b.unitPrice)), 0);
    const doneSteps = steps.filter((st) => st.complete).length;
    return {
      ...p,
      stepCount: steps.length,
      completeSteps: doneSteps,
      progressPct: steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0,
      bomLineCount: bom.length,
      bomOwnedCount: ownedCount,
      materialsCost: Math.round(materialsCost * 100) / 100,
      toBuyCost: Math.round(toBuyCost * 100) / 100,
    };
  }

  // project-create — start a workshop project (optionally a remix of a published one)
  registerLensAction("diy", "project-create", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = diyClean(params.name, 200);
    if (!name) return { ok: false, error: "project name required" };
    const project = {
      id: diyId("proj"),
      name,
      category: diyClean(params.category, 60) || "Other",
      difficulty: DIFFICULTIES.includes(String(params.difficulty).toLowerCase()) ? String(params.difficulty).toLowerCase() : "intermediate",
      description: diyClean(params.description, 2000),
      estimatedHours: Math.max(0, diyNum(params.estimatedHours)),
      tags: Array.isArray(params.tags) ? params.tags.map((t) => diyClean(t, 40)).filter(Boolean).slice(0, 12) : [],
      steps: [],
      bom: [],
      status: "planning",
      forkedFrom: null,
      createdAt: new Date().toISOString(),
    };
    diyProjects(s, diyActor(ctx)).push(project);
    saveDIY();
    return { ok: true, result: { project: projectSummary(project) } };
  });

  // project-list — all projects for the user, with derived rollups
  registerLensAction("diy", "project-list", (ctx, _a, _params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projects = diyProjects(s, diyActor(ctx)).map(projectSummary);
    return {
      ok: true,
      result: {
        projects,
        count: projects.length,
        totalToBuyCost: Math.round(projects.reduce((n, p) => n + p.toBuyCost, 0) * 100) / 100,
      },
    };
  });

  // project-get — full project detail
  registerLensAction("diy", "project-get", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    return { ok: true, result: { project: projectSummary(p) } };
  });

  // project-delete
  registerLensAction("diy", "project-delete", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = diyProjects(s, diyActor(ctx));
    const i = arr.findIndex((p) => p.id === params.projectId);
    if (i < 0) return { ok: false, error: "project not found" };
    arr.splice(i, 1);
    saveDIY();
    return { ok: true, result: { deleted: params.projectId } };
  });

  // Feature: Step-by-step illustrated guide builder ───────────────────
  // step-add — append an ordered step with optional photo
  registerLensAction("diy", "step-add", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const text = diyClean(params.text, 2000);
    if (!text) return { ok: false, error: "step text required" };
    const step = {
      id: diyId("step"),
      order: p.steps.length + 1,
      title: diyClean(params.title, 160) || `Step ${p.steps.length + 1}`,
      text,
      photoUrl: diyClean(params.photoUrl, 600) || "",
      resultPhotoUrl: "",
      estimatedMinutes: Math.max(0, Math.round(diyNum(params.estimatedMinutes))),
      complete: false,
      completedAt: null,
    };
    p.steps.push(step);
    saveDIY();
    return { ok: true, result: { project: projectSummary(p), step } };
  });

  // step-update — edit step text / title / photo / time
  registerLensAction("diy", "step-update", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const step = (p.steps || []).find((st) => st.id === params.stepId);
    if (!step) return { ok: false, error: "step not found" };
    if (params.title !== undefined) step.title = diyClean(params.title, 160);
    if (params.text !== undefined) step.text = diyClean(params.text, 2000);
    if (params.photoUrl !== undefined) step.photoUrl = diyClean(params.photoUrl, 600);
    if (params.estimatedMinutes !== undefined) step.estimatedMinutes = Math.max(0, Math.round(diyNum(params.estimatedMinutes)));
    saveDIY();
    return { ok: true, result: { project: projectSummary(p), step } };
  });

  // step-delete — remove a step and re-number the rest
  registerLensAction("diy", "step-delete", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const i = (p.steps || []).findIndex((st) => st.id === params.stepId);
    if (i < 0) return { ok: false, error: "step not found" };
    p.steps.splice(i, 1);
    p.steps.forEach((st, idx) => { st.order = idx + 1; });
    saveDIY();
    return { ok: true, result: { project: projectSummary(p) } };
  });

  // step-reorder — move a step to a new position
  registerLensAction("diy", "step-reorder", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const from = (p.steps || []).findIndex((st) => st.id === params.stepId);
    if (from < 0) return { ok: false, error: "step not found" };
    let to = Math.round(diyNum(params.toIndex));
    to = Math.max(0, Math.min(p.steps.length - 1, to));
    const [moved] = p.steps.splice(from, 1);
    p.steps.splice(to, 0, moved);
    p.steps.forEach((st, idx) => { st.order = idx + 1; });
    saveDIY();
    return { ok: true, result: { project: projectSummary(p) } };
  });

  // Feature: Project progress tracking ────────────────────────────────
  // step-progress — mark a step complete/incomplete, attach a result photo
  registerLensAction("diy", "step-progress", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const step = (p.steps || []).find((st) => st.id === params.stepId);
    if (!step) return { ok: false, error: "step not found" };
    step.complete = params.complete === undefined ? !step.complete : !!params.complete;
    step.completedAt = step.complete ? new Date().toISOString() : null;
    if (params.resultPhotoUrl !== undefined) step.resultPhotoUrl = diyClean(params.resultPhotoUrl, 600);
    // Auto-advance project status from the progress signal.
    const done = p.steps.filter((st) => st.complete).length;
    if (done === 0) p.status = "planning";
    else if (done >= p.steps.length && p.steps.length > 0) p.status = "completed";
    else p.status = "in_progress";
    saveDIY();
    const summary = projectSummary(p);
    return { ok: true, result: { project: summary, step, progressPct: summary.progressPct } };
  });

  // Feature: Bill of materials with cost rollup + shopping links ───────
  // Shopping links are generated as real, deterministic search URLs (no
  // affiliate fakery) — a search query against the named retailer.
  function shoppingLinks(itemName) {
    const q = encodeURIComponent(String(itemName || "").trim());
    if (!q) return [];
    return [
      { retailer: "Home Depot", url: `https://www.homedepot.com/s/${q}` },
      { retailer: "Lowe's", url: `https://www.lowes.com/search?searchTerm=${q}` },
      { retailer: "Amazon", url: `https://www.amazon.com/s?k=${q}` },
    ];
  }

  // bom-add — add a material line to a project's bill of materials
  registerLensAction("diy", "bom-add", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const item = diyClean(params.item, 200);
    if (!item) return { ok: false, error: "material name required" };
    const line = {
      id: diyId("bom"),
      item,
      quantity: Math.max(0, diyNum(params.quantity) || 1),
      unit: diyClean(params.unit, 20) || "pcs",
      unitPrice: Math.max(0, diyNum(params.unitPrice)),
      supplier: diyClean(params.supplier, 120) || "",
      owned: !!params.owned,
      links: shoppingLinks(item),
    };
    p.bom.push(line);
    saveDIY();
    return { ok: true, result: { project: projectSummary(p), line } };
  });

  // bom-update — edit a BOM line (qty, price, owned flag)
  registerLensAction("diy", "bom-update", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const line = (p.bom || []).find((b) => b.id === params.lineId);
    if (!line) return { ok: false, error: "BOM line not found" };
    if (params.item !== undefined) { line.item = diyClean(params.item, 200); line.links = shoppingLinks(line.item); }
    if (params.quantity !== undefined) line.quantity = Math.max(0, diyNum(params.quantity));
    if (params.unit !== undefined) line.unit = diyClean(params.unit, 20);
    if (params.unitPrice !== undefined) line.unitPrice = Math.max(0, diyNum(params.unitPrice));
    if (params.supplier !== undefined) line.supplier = diyClean(params.supplier, 120);
    if (params.owned !== undefined) line.owned = !!params.owned;
    saveDIY();
    return { ok: true, result: { project: projectSummary(p), line } };
  });

  // bom-delete — remove a BOM line
  registerLensAction("diy", "bom-delete", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const i = (p.bom || []).findIndex((b) => b.id === params.lineId);
    if (i < 0) return { ok: false, error: "BOM line not found" };
    p.bom.splice(i, 1);
    saveDIY();
    return { ok: true, result: { project: projectSummary(p) } };
  });

  // bom-rollup — full cost rollup: per-line totals, owned vs to-buy, links
  registerLensAction("diy", "bom-rollup", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const lines = (p.bom || []).map((b) => ({
      ...b,
      lineTotal: Math.round(diyNum(b.quantity) * diyNum(b.unitPrice) * 100) / 100,
    }));
    const totalCost = Math.round(lines.reduce((n, l) => n + l.lineTotal, 0) * 100) / 100;
    const toBuy = lines.filter((l) => !l.owned);
    const toBuyCost = Math.round(toBuy.reduce((n, l) => n + l.lineTotal, 0) * 100) / 100;
    const bySupplier = {};
    for (const l of toBuy) {
      const k = l.supplier || "Unassigned";
      bySupplier[k] = Math.round(((bySupplier[k] || 0) + l.lineTotal) * 100) / 100;
    }
    return {
      ok: true,
      result: {
        projectName: p.name,
        lines,
        lineCount: lines.length,
        totalCost,
        ownedValue: Math.round((totalCost - toBuyCost) * 100) / 100,
        toBuyCost,
        toBuyCount: toBuy.length,
        bySupplier,
        budgetTip: toBuyCost > p.estimatedHours * 25
          ? "Materials outweigh labor — shop around or buy in stages"
          : "Material spend is reasonable for the project size",
      },
    };
  });

  // Feature: Tool-availability check against inventory ─────────────────
  // project-tool-gate — given the project's required tools and a live
  // tool inventory snapshot, decide whether the build can start.
  registerLensAction("diy", "project-tool-gate", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = findProject(s, diyActor(ctx), params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    const required = Array.isArray(params.requiredTools)
      ? params.requiredTools.map((t) => diyClean(t, 80)).filter(Boolean)
      : [];
    if (required.length === 0) return { ok: false, error: "list requiredTools to gate the project" };
    const inventory = Array.isArray(params.inventory) ? params.inventory : [];
    const owned = inventory.map((t) => ({
      name: String(t.name || t || "").toLowerCase(),
      condition: String(t.condition || "good").toLowerCase(),
    }));
    const checks = required.map((tool) => {
      const tl = tool.toLowerCase();
      const match = owned.find((o) => o.name && (o.name.includes(tl) || tl.includes(o.name)));
      const blocked = match && ["needs repair", "out of service"].includes(match.condition);
      return {
        tool,
        owned: !!match,
        condition: match ? match.condition : null,
        usable: !!match && !blocked,
      };
    });
    const missing = checks.filter((c) => !c.owned).map((c) => c.tool);
    const unusable = checks.filter((c) => c.owned && !c.usable).map((c) => c.tool);
    const cleared = missing.length === 0 && unusable.length === 0;
    if (params.persist) { p.toolGateClear = cleared; saveDIY(); }
    return {
      ok: true,
      result: {
        projectName: p.name,
        checks,
        readyToStart: cleared,
        missing,
        unusable,
        verdict: cleared
          ? "All required tools are on hand and usable — clear to start"
          : `Blocked: ${missing.length} missing, ${unusable.length} need repair`,
      },
    };
  });

  // Feature: Difficulty/time/cost browse facets ───────────────────────
  // project-facets — aggregate counts for browse-by-filter chips
  registerLensAction("diy", "project-facets", (ctx, _a, _params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projects = diyProjects(s, diyActor(ctx)).map(projectSummary);
    const byDifficulty = {};
    const byCategory = {};
    const byStatus = {};
    const costBands = { "under $50": 0, "$50–200": 0, "$200–500": 0, "over $500": 0 };
    const timeBands = { "under 2h": 0, "2–8h": 0, "8–24h": 0, "over 24h": 0 };
    for (const p of projects) {
      byDifficulty[p.difficulty] = (byDifficulty[p.difficulty] || 0) + 1;
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      const c = p.materialsCost;
      if (c < 50) costBands["under $50"]++;
      else if (c < 200) costBands["$50–200"]++;
      else if (c < 500) costBands["$200–500"]++;
      else costBands["over $500"]++;
      const h = p.estimatedHours;
      if (h < 2) timeBands["under 2h"]++;
      else if (h < 8) timeBands["2–8h"]++;
      else if (h < 24) timeBands["8–24h"]++;
      else timeBands["over 24h"]++;
    }
    return { ok: true, result: { total: projects.length, byDifficulty, byCategory, byStatus, costBands, timeBands } };
  });

  // Feature: Project forking / remix ──────────────────────────────────
  // project-publish — make a finished project remixable by others
  registerLensAction("diy", "project-publish", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const owner = diyActor(ctx);
    const p = findProject(s, owner, params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    p.published = true;
    s.published.set(p.id, { project: JSON.parse(JSON.stringify(p)), owner, publishedAt: new Date().toISOString() });
    saveDIY();
    return { ok: true, result: { projectId: p.id, published: true } };
  });

  // project-unpublish — withdraw from the remixable catalog
  registerLensAction("diy", "project-unpublish", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const owner = diyActor(ctx);
    const p = findProject(s, owner, params.projectId);
    if (!p) return { ok: false, error: "project not found" };
    p.published = false;
    s.published.delete(p.id);
    saveDIY();
    return { ok: true, result: { projectId: p.id, published: false } };
  });

  // project-browse-published — the remixable catalog (own + others')
  registerLensAction("diy", "project-browse-published", (ctx, _a, _params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = diyActor(ctx);
    const catalog = [...s.published.values()].map((entry) => {
      const sum = projectSummary(entry.project);
      return {
        projectId: entry.project.id,
        name: sum.name,
        category: sum.category,
        difficulty: sum.difficulty,
        estimatedHours: sum.estimatedHours,
        stepCount: sum.stepCount,
        bomLineCount: sum.bomLineCount,
        materialsCost: sum.materialsCost,
        publishedAt: entry.publishedAt,
        isMine: entry.owner === me,
      };
    });
    return { ok: true, result: { catalog, count: catalog.length } };
  });

  // project-fork — clone a published project into the caller's workshop
  registerLensAction("diy", "project-fork", (ctx, _a, params = {}) => {
    const s = getDIYState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = s.published.get(params.projectId);
    if (!entry) return { ok: false, error: "published project not found" };
    const src = entry.project;
    const fork = {
      id: diyId("proj"),
      name: `${src.name} (remix)`,
      category: src.category,
      difficulty: src.difficulty,
      description: src.description,
      estimatedHours: src.estimatedHours,
      tags: [...(src.tags || [])],
      steps: (src.steps || []).map((st, idx) => ({
        id: diyId("step"),
        order: idx + 1,
        title: st.title,
        text: st.text,
        photoUrl: st.photoUrl || "",
        resultPhotoUrl: "",
        estimatedMinutes: st.estimatedMinutes || 0,
        complete: false,
        completedAt: null,
      })),
      bom: (src.bom || []).map((b) => ({
        id: diyId("bom"),
        item: b.item,
        quantity: b.quantity,
        unit: b.unit,
        unitPrice: b.unitPrice,
        supplier: b.supplier || "",
        owned: false,
        links: shoppingLinks(b.item),
      })),
      status: "planning",
      forkedFrom: { projectId: src.id, name: src.name },
      createdAt: new Date().toISOString(),
    };
    diyProjects(s, diyActor(ctx)).push(fork);
    saveDIY();
    return { ok: true, result: { project: projectSummary(fork), forkedFrom: fork.forkedFrom } };
  });
}
