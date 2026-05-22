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

  // ─── Photo gallery — before/after rooms (per-user, STATE-backed) ────
  function hiList(s, key, userId) {
    if (!(s[key] instanceof Map)) s[key] = new Map();
    if (!s[key].has(userId)) s[key].set(userId, []);
    return s[key].get(userId);
  }

  registerLensAction("home-improvement", "gallery-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const room = hiClean(params.room, 80);
    if (!room) return { ok: false, error: "room required" };
    const beforeImg = hiClean(params.beforeImage, 4000);
    const afterImg = hiClean(params.afterImage, 4000);
    if (!beforeImg && !afterImg) return { ok: false, error: "at least one image required" };
    const entry = {
      id: hiId("gal"),
      room: ROOMS.includes(room) ? room : room,
      title: hiClean(params.title, 160) || `${room} renovation`,
      beforeImage: beforeImg || "",
      afterImage: afterImg || "",
      projectId: hiClean(params.projectId, 60) || "",
      caption: hiClean(params.caption, 600) || "",
      createdAt: new Date().toISOString(),
    };
    hiList(s, "gallery", hiActor(ctx)).push(entry);
    saveHi();
    return { ok: true, result: { entry } };
  });

  registerLensAction("home-improvement", "gallery-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = hiList(s, "gallery", hiActor(ctx));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("home-improvement", "gallery-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiList(s, "gallery", hiActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "gallery entry not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Idea boards / inspiration collections ─────────────────────────
  registerLensAction("home-improvement", "board-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hiClean(params.name, 120);
    if (!name) return { ok: false, error: "board name required" };
    const board = {
      id: hiId("board"), name,
      room: hiClean(params.room, 80) || "whole_house",
      description: hiClean(params.description, 600) || "",
      ideas: [],
      createdAt: new Date().toISOString(),
    };
    hiList(s, "boards", hiActor(ctx)).push(board);
    saveHi();
    return { ok: true, result: { board } };
  });

  registerLensAction("home-improvement", "board-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const boards = hiList(s, "boards", hiActor(ctx)).map((b) => ({ ...b, ideaCount: b.ideas.length }));
    return { ok: true, result: { boards, count: boards.length } };
  });

  registerLensAction("home-improvement", "board-idea-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = hiList(s, "boards", hiActor(ctx)).find((b) => b.id === params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const note = hiClean(params.note, 400);
    const imageUrl = hiClean(params.imageUrl, 4000);
    if (!note && !imageUrl) return { ok: false, error: "note or imageUrl required" };
    const idea = {
      id: hiId("idea"),
      note: note || "",
      imageUrl: imageUrl || "",
      sourceUrl: hiClean(params.sourceUrl, 600) || "",
      tags: Array.isArray(params.tags) ? params.tags.map((t) => hiClean(t, 40)).filter(Boolean).slice(0, 8) : [],
      addedAt: new Date().toISOString(),
    };
    board.ideas.push(idea);
    saveHi();
    return { ok: true, result: { idea, boardId: board.id } };
  });

  registerLensAction("home-improvement", "board-idea-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = hiList(s, "boards", hiActor(ctx)).find((b) => b.id === params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const i = board.ideas.findIndex((idea) => idea.id === params.ideaId);
    if (i < 0) return { ok: false, error: "idea not found" };
    board.ideas.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.ideaId } };
  });

  registerLensAction("home-improvement", "board-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiList(s, "boards", hiActor(ctx));
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "board not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Contractor / pro directory with quotes + reviews ──────────────
  registerLensAction("home-improvement", "pro-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hiClean(params.name, 120);
    if (!name) return { ok: false, error: "contractor name required" };
    const pro = {
      id: hiId("pro"), name,
      trade: hiClean(params.trade, 80) || "general",
      phone: hiClean(params.phone, 40) || "",
      email: hiClean(params.email, 120) || "",
      license: hiClean(params.license, 80) || "",
      notes: hiClean(params.notes, 800) || "",
      quotes: [],
      reviews: [],
      createdAt: new Date().toISOString(),
    };
    hiList(s, "pros", hiActor(ctx)).push(pro);
    saveHi();
    return { ok: true, result: { pro } };
  });

  registerLensAction("home-improvement", "pro-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pros = hiList(s, "pros", hiActor(ctx)).map((p) => {
      const ratings = p.reviews.map((r) => r.rating);
      const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;
      return {
        ...p,
        quoteCount: p.quotes.length,
        reviewCount: p.reviews.length,
        avgRating,
        lowestQuote: p.quotes.length ? Math.min(...p.quotes.map((q) => q.amount)) : 0,
      };
    });
    return { ok: true, result: { pros, count: pros.length } };
  });

  registerLensAction("home-improvement", "pro-quote-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pro = hiList(s, "pros", hiActor(ctx)).find((p) => p.id === params.proId);
    if (!pro) return { ok: false, error: "contractor not found" };
    const quote = {
      id: hiId("quote"),
      project: hiClean(params.project, 160) || "quote",
      amount: Math.max(0, hiNum(params.amount)),
      scope: hiClean(params.scope, 800) || "",
      validUntil: hiClean(params.validUntil, 30) || "",
      status: ["pending", "accepted", "declined"].includes(params.status) ? params.status : "pending",
      createdAt: new Date().toISOString(),
    };
    pro.quotes.push(quote);
    saveHi();
    return { ok: true, result: { quote, proId: pro.id } };
  });

  registerLensAction("home-improvement", "pro-review-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pro = hiList(s, "pros", hiActor(ctx)).find((p) => p.id === params.proId);
    if (!pro) return { ok: false, error: "contractor not found" };
    const rating = Math.max(1, Math.min(5, Math.round(hiNum(params.rating)) || 5));
    const review = {
      id: hiId("rev"),
      rating,
      text: hiClean(params.text, 1000) || "",
      project: hiClean(params.project, 160) || "",
      createdAt: new Date().toISOString(),
    };
    pro.reviews.push(review);
    saveHi();
    return { ok: true, result: { review, proId: pro.id } };
  });

  registerLensAction("home-improvement", "pro-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiList(s, "pros", hiActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "contractor not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Materials shopping list with vendor links + price tracking ────
  registerLensAction("home-improvement", "shopping-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hiClean(params.name, 160);
    if (!name) return { ok: false, error: "item name required" };
    const price = Math.max(0, hiNum(params.price));
    const item = {
      id: hiId("shop"), name,
      qty: Math.max(1, Math.round(hiNum(params.qty)) || 1),
      vendor: hiClean(params.vendor, 100) || "",
      vendorUrl: hiClean(params.vendorUrl, 600) || "",
      projectId: hiClean(params.projectId, 60) || "",
      price,
      priceHistory: price > 0 ? [{ price, at: new Date().toISOString() }] : [],
      purchased: false,
      createdAt: new Date().toISOString(),
    };
    hiList(s, "shopping", hiActor(ctx)).push(item);
    saveHi();
    return { ok: true, result: { item } };
  });

  registerLensAction("home-improvement", "shopping-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = hiList(s, "shopping", hiActor(ctx)).map((it) => ({
      ...it,
      lineTotal: Math.round(it.price * it.qty * 100) / 100,
    }));
    const total = items.reduce((n, it) => n + it.lineTotal, 0);
    const remaining = items.filter((it) => !it.purchased).reduce((n, it) => n + it.lineTotal, 0);
    return {
      ok: true,
      result: {
        items, count: items.length,
        totalCost: Math.round(total * 100) / 100,
        remainingCost: Math.round(remaining * 100) / 100,
        purchasedCount: items.filter((it) => it.purchased).length,
      },
    };
  });

  registerLensAction("home-improvement", "shopping-price-update", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = hiList(s, "shopping", hiActor(ctx)).find((it) => it.id === params.id);
    if (!item) return { ok: false, error: "item not found" };
    const newPrice = Math.max(0, hiNum(params.price));
    const prev = item.price;
    item.price = newPrice;
    item.priceHistory.push({ price: newPrice, at: new Date().toISOString() });
    if (item.priceHistory.length > 50) item.priceHistory.shift();
    saveHi();
    return {
      ok: true,
      result: { item, previousPrice: prev, delta: Math.round((newPrice - prev) * 100) / 100, dropped: newPrice < prev },
    };
  });

  registerLensAction("home-improvement", "shopping-toggle", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = hiList(s, "shopping", hiActor(ctx)).find((it) => it.id === params.id);
    if (!item) return { ok: false, error: "item not found" };
    item.purchased = !item.purchased;
    saveHi();
    return { ok: true, result: { item } };
  });

  registerLensAction("home-improvement", "shopping-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiList(s, "shopping", hiActor(ctx));
    const i = arr.findIndex((it) => it.id === params.id);
    if (i < 0) return { ok: false, error: "item not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Home inventory / asset register (warranties, manuals) ─────────
  registerLensAction("home-improvement", "inventory-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hiClean(params.name, 160);
    if (!name) return { ok: false, error: "asset name required" };
    const asset = {
      id: hiId("asset"), name,
      category: hiClean(params.category, 80) || "appliance",
      room: ROOMS.includes(params.room) ? params.room : "other",
      brand: hiClean(params.brand, 100) || "",
      model: hiClean(params.model, 100) || "",
      serial: hiClean(params.serial, 100) || "",
      purchaseDate: hiClean(params.purchaseDate, 30) || "",
      purchasePrice: Math.max(0, hiNum(params.purchasePrice)),
      warrantyExpires: hiClean(params.warrantyExpires, 30) || "",
      manualUrl: hiClean(params.manualUrl, 600) || "",
      notes: hiClean(params.notes, 800) || "",
      createdAt: new Date().toISOString(),
    };
    hiList(s, "inventory", hiActor(ctx)).push(asset);
    saveHi();
    return { ok: true, result: { asset } };
  });

  registerLensAction("home-improvement", "inventory-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const SOON = 90 * 24 * 60 * 60 * 1000;
    const assets = hiList(s, "inventory", hiActor(ctx)).map((a) => {
      let warrantyStatus = "none";
      let daysToExpiry = null;
      if (a.warrantyExpires) {
        const exp = Date.parse(a.warrantyExpires);
        if (Number.isFinite(exp)) {
          daysToExpiry = Math.round((exp - now) / (24 * 60 * 60 * 1000));
          warrantyStatus = exp < now ? "expired" : (exp - now) < SOON ? "expiring" : "active";
        }
      }
      return { ...a, warrantyStatus, daysToExpiry };
    });
    return {
      ok: true,
      result: {
        assets, count: assets.length,
        totalValue: Math.round(assets.reduce((n, a) => n + a.purchasePrice, 0) * 100) / 100,
        warrantiesActive: assets.filter((a) => a.warrantyStatus === "active").length,
        warrantiesExpiring: assets.filter((a) => a.warrantyStatus === "expiring").length,
        warrantiesExpired: assets.filter((a) => a.warrantyStatus === "expired").length,
      },
    };
  });

  registerLensAction("home-improvement", "inventory-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiList(s, "inventory", hiActor(ctx));
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "asset not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Project timeline / Gantt with dependencies ────────────────────
  registerLensAction("home-improvement", "phase-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    if (!Array.isArray(project.phases)) project.phases = [];
    const name = hiClean(params.name, 160);
    if (!name) return { ok: false, error: "phase name required" };
    const phase = {
      id: hiId("phase"), name,
      startDate: hiClean(params.startDate, 30) || "",
      durationDays: Math.max(1, Math.round(hiNum(params.durationDays)) || 1),
      dependsOn: Array.isArray(params.dependsOn)
        ? params.dependsOn.map((d) => hiClean(d, 60)).filter(Boolean).slice(0, 12)
        : [],
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    project.phases.push(phase);
    saveHi();
    return { ok: true, result: { phase, projectId: project.id } };
  });

  registerLensAction("home-improvement", "phase-update", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const phase = (project.phases || []).find((ph) => ph.id === params.phaseId);
    if (!phase) return { ok: false, error: "phase not found" };
    if (params.progress != null) phase.progress = Math.max(0, Math.min(100, Math.round(hiNum(params.progress))));
    if (params.startDate != null) phase.startDate = hiClean(params.startDate, 30);
    if (params.durationDays != null) phase.durationDays = Math.max(1, Math.round(hiNum(params.durationDays)) || 1);
    saveHi();
    return { ok: true, result: { phase } };
  });

  registerLensAction("home-improvement", "phase-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const arr = project.phases || [];
    const i = arr.findIndex((ph) => ph.id === params.phaseId);
    if (i < 0) return { ok: false, error: "phase not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.phaseId } };
  });

  registerLensAction("home-improvement", "gantt", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = hiProjects(s, hiActor(ctx)).find((p) => p.id === params.projectId);
    if (!project) return { ok: false, error: "project not found" };
    const phases = project.phases || [];
    const byId = new Map(phases.map((p) => [p.id, p]));
    // Compute scheduled start (max of explicit start or end of dependencies).
    const computed = new Map();
    function computeStart(ph, seen = new Set()) {
      if (computed.has(ph.id)) return computed.get(ph.id);
      if (seen.has(ph.id)) return Date.parse(ph.startDate) || Date.now(); // cycle guard
      seen.add(ph.id);
      let start = Date.parse(ph.startDate);
      if (!Number.isFinite(start)) start = Date.now();
      for (const depId of ph.dependsOn) {
        const dep = byId.get(depId);
        if (!dep) continue;
        const depStart = computeStart(dep, seen);
        const depEnd = depStart + dep.durationDays * 24 * 60 * 60 * 1000;
        if (depEnd > start) start = depEnd;
      }
      computed.set(ph.id, start);
      return start;
    }
    const bars = phases.map((ph) => {
      const start = computeStart(ph);
      const end = start + ph.durationDays * 24 * 60 * 60 * 1000;
      return {
        id: ph.id, name: ph.name,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        durationDays: ph.durationDays,
        progress: ph.progress || 0,
        dependsOn: ph.dependsOn,
      };
    }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const projStart = bars.length ? Math.min(...bars.map((b) => Date.parse(b.start))) : Date.now();
    const projEnd = bars.length ? Math.max(...bars.map((b) => Date.parse(b.end))) : Date.now();
    const totalDays = Math.max(1, Math.round((projEnd - projStart) / (24 * 60 * 60 * 1000)));
    const avgProgress = bars.length ? Math.round(bars.reduce((n, b) => n + b.progress, 0) / bars.length) : 0;
    return {
      ok: true,
      result: {
        projectName: project.name,
        bars,
        projectStart: new Date(projStart).toISOString(),
        projectEnd: new Date(projEnd).toISOString(),
        totalDays,
        avgProgress,
      },
    };
  });

  // ─── Maintenance reminders (seasonal home upkeep) ──────────────────
  const SEASONAL_TASKS = {
    spring: ["Clean gutters and downspouts", "Inspect roof for winter damage", "Service AC before summer", "Check exterior caulking and seals", "Test sprinkler system"],
    summer: ["Inspect deck and reseal if needed", "Clean and check ceiling fans", "Wash exterior windows", "Check for pest entry points", "Inspect attic ventilation"],
    fall: ["Clean gutters before leaf fall", "Service furnace before winter", "Drain and store garden hoses", "Seal driveway cracks", "Inspect and clean chimney"],
    winter: ["Check for ice dams on roof", "Test smoke and CO detectors", "Reverse ceiling fans", "Inspect plumbing for freeze risk", "Check weatherstripping on doors"],
  };

  registerLensAction("home-improvement", "maintenance-seasonal", (ctx, _a, params = {}) => {
    const month = new Date().getMonth();
    const season = params.season && SEASONAL_TASKS[params.season]
      ? params.season
      : month <= 1 || month === 11 ? "winter"
        : month <= 4 ? "spring"
          : month <= 7 ? "summer" : "fall";
    return {
      ok: true,
      result: { season, suggestedTasks: SEASONAL_TASKS[season], allSeasons: Object.keys(SEASONAL_TASKS) },
    };
  });

  registerLensAction("home-improvement", "maintenance-add", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = hiClean(params.task, 200);
    if (!task) return { ok: false, error: "task description required" };
    const reminder = {
      id: hiId("maint"), task,
      season: ["spring", "summer", "fall", "winter", "any"].includes(params.season) ? params.season : "any",
      intervalDays: Math.max(1, Math.round(hiNum(params.intervalDays)) || 365),
      dueDate: hiClean(params.dueDate, 30) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      lastDone: "",
      done: false,
      createdAt: new Date().toISOString(),
    };
    hiList(s, "maintenance", hiActor(ctx)).push(reminder);
    saveHi();
    return { ok: true, result: { reminder } };
  });

  registerLensAction("home-improvement", "maintenance-list", (ctx, _a, _params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const reminders = hiList(s, "maintenance", hiActor(ctx)).map((r) => {
      const due = Date.parse(r.dueDate);
      const daysUntil = Number.isFinite(due) ? Math.round((due - now) / (24 * 60 * 60 * 1000)) : null;
      return { ...r, daysUntil, overdue: !r.done && daysUntil != null && daysUntil < 0 };
    }).sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));
    return {
      ok: true,
      result: {
        reminders, count: reminders.length,
        overdueCount: reminders.filter((r) => r.overdue).length,
        upcomingCount: reminders.filter((r) => !r.done && !r.overdue && (r.daysUntil ?? 999) <= 30).length,
      },
    };
  });

  registerLensAction("home-improvement", "maintenance-complete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const reminder = hiList(s, "maintenance", hiActor(ctx)).find((r) => r.id === params.id);
    if (!reminder) return { ok: false, error: "reminder not found" };
    const today = new Date();
    reminder.lastDone = today.toISOString().slice(0, 10);
    // Reschedule by interval.
    reminder.dueDate = new Date(today.getTime() + reminder.intervalDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    reminder.done = false;
    saveHi();
    return { ok: true, result: { reminder } };
  });

  registerLensAction("home-improvement", "maintenance-delete", (ctx, _a, params = {}) => {
    const s = getHiState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hiList(s, "maintenance", hiActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "reminder not found" };
    arr.splice(i, 1);
    saveHi();
    return { ok: true, result: { deleted: params.id } };
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
