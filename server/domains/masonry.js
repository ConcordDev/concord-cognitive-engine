// server/domains/masonry.js
export default function registerMasonryActions(registerLensAction) {
  registerLensAction("masonry", "materialEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Fail-CLOSED: a present-but-poisoned squareFootage rejects rather than
    // silently flooring to 0 (so a poisoned input can't masquerade as empty).
    if (data.squareFootage !== undefined && data.squareFootage !== null && data.squareFootage !== "" && !Number.isFinite(Number(data.squareFootage))) return { ok: false, error: "invalid_squareFootage" };
    // Fail-closed: a non-finite (NaN/Infinity/"abc") squareFootage floors to 0
    // so no NaN/Infinity leaks into any rendered number.
    const sqftRaw = parseFloat(data.squareFootage);
    const sqft = Number.isFinite(sqftRaw) && sqftRaw > 0 ? sqftRaw : 0;
    const material = (data.material || "brick").toLowerCase();
    const rates = { brick: { unitsPerSqFt: 7, mortar: 0.02, costPerUnit: 0.75 }, block: { unitsPerSqFt: 1.125, mortar: 0.03, costPerUnit: 2.5 }, stone: { unitsPerSqFt: 5, mortar: 0.025, costPerUnit: 8 } };
    const r = rates[material] || rates.brick;
    const units = Math.ceil(sqft * r.unitsPerSqFt * 1.05);
    const mortarBags = Math.ceil(sqft * r.mortar);
    const materialCost = Math.round(units * r.costPerUnit);
    const mortarCost = Math.round(mortarBags * 12);
    const laborEstimate = Math.round(sqft * 15);
    const totalMaterialCost = materialCost + mortarCost;
    const grandTotal = totalMaterialCost + laborEstimate;
    // Real, computed recommendation surfaced by the result card — derived from
    // the actual estimate, never a placeholder.
    const recommendation = sqft <= 0
      ? "Enter a positive wall area to size materials."
      : `Order ~${Math.ceil(units * 1.0)} ${material} units and ${mortarBags} 80 lb mortar bag${mortarBags === 1 ? "" : "s"}; budget $${grandTotal.toLocaleString()} all-in (materials $${totalMaterialCost.toLocaleString()} + labor $${laborEstimate.toLocaleString()}). The unit count already carries 5% waste.`;
    return { ok: true, result: { material, squareFootage: sqft, unitsNeeded: units, mortarBags80lb: mortarBags, materialCost, mortarCost, totalMaterialCost, laborEstimate, grandTotal, recommendation } };
  });
  registerLensAction("masonry", "mortarMix", (ctx, artifact, _params) => {
    const application = (artifact.data?.application || "general").toLowerCase();
    const mixes = { general: { type: "Type N", ratio: "1:1:6 (cement:lime:sand)", strength: "750 psi", use: "Above-grade, general purpose" }, structural: { type: "Type S", ratio: "1:0.5:4.5", strength: "1800 psi", use: "Below-grade, retaining walls, high wind" }, "high-strength": { type: "Type M", ratio: "1:0.25:3.75", strength: "2500 psi", use: "Foundation, heavy load bearing" }, veneer: { type: "Type N", ratio: "1:1:6", strength: "750 psi", use: "Non-structural veneer, interior" }, repoint: { type: "Type O", ratio: "1:2:9", strength: "350 psi", use: "Repointing historic masonry" } };
    const mix = mixes[application] || mixes.general;
    return { ok: true, result: { application, ...mix, waterRatio: "Add water gradually until workable — should hold shape on trowel", cureTime: "24-48 hours initial, 28 days full strength", temperature: "Install between 40°F and 90°F, protect from freezing for 48 hours" } };
  });
  registerLensAction("masonry", "wallStrength", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Fail-CLOSED: a present-but-poisoned height/thickness rejects rather than
    // silently defaulting (a fabricated slenderness verdict is a safety lie).
    if (data.heightFeet !== undefined && data.heightFeet !== null && data.heightFeet !== "" && !Number.isFinite(Number(data.heightFeet))) return { ok: false, error: "invalid_heightFeet" };
    if (data.thicknessInches !== undefined && data.thicknessInches !== null && data.thicknessInches !== "" && !Number.isFinite(Number(data.thicknessInches))) return { ok: false, error: "invalid_thicknessInches" };
    // Fail-closed: non-finite height/thickness fall back to defaults so the
    // slenderness ratio can never become NaN/Infinity.
    const hRaw = parseFloat(data.heightFeet);
    const tRaw = parseFloat(data.thicknessInches);
    const height = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 8;
    const thickness = Number.isFinite(tRaw) && tRaw > 0 ? tRaw : 8;
    const reinforced = data.reinforced !== false;
    const loadBearing = data.loadBearing !== false;
    const slenderness = (height * 12) / thickness;
    const maxSlenderness = reinforced ? 25 : 20;
    return { ok: true, result: { heightFeet: height, thicknessInches: thickness, slendernessRatio: Math.round(slenderness * 10) / 10, maxAllowedRatio: maxSlenderness, passesSlenderness: slenderness <= maxSlenderness, reinforced, loadBearing, recommendation: slenderness > maxSlenderness ? "Wall too slender — increase thickness or add pilasters" : slenderness > maxSlenderness * 0.8 ? "Near limit — consider additional reinforcement" : "Wall dimensions are adequate" } };
  });
  registerLensAction("masonry", "jobCosting", (ctx, artifact, _params) => {
    const items = Array.isArray(artifact.data?.items) ? artifact.data.items : [];
    if (items.length === 0) return { ok: true, result: { message: "Add job items with hours and costs." } };
    // Fail-closed numeric coercion: non-finite values floor to 0 (or the 55
    // default rate) so no NaN/Infinity reaches a cost field.
    const fin = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
    const costed = items.filter(i => i && typeof i === "object").map(i => { const hours = fin(i.hours != null ? i.hours : i.laborHours, 0); const rate = fin(i.rate != null ? i.rate : i.laborRate, 55); const materials = fin(i.materialCost, 0); return { item: i.name || i.description, laborHours: hours, laborRate: rate, laborCost: Math.round(hours * rate), materialCost: materials, totalCost: Math.round(hours * rate + materials) }; });
    const totalLabor = costed.reduce((s, c) => s + c.laborCost, 0);
    const totalMaterials = costed.reduce((s, c) => s + c.materialCost, 0);
    const overhead = Math.round((totalLabor + totalMaterials) * 0.15);
    const profit = Math.round((totalLabor + totalMaterials + overhead) * 0.1);
    return { ok: true, result: { items: costed, subtotalLabor: totalLabor, subtotalMaterials: totalMaterials, overhead, profit, grandTotal: totalLabor + totalMaterials + overhead + profit } };
  });

  // ── Persistent-state helpers ──────────────────────────────────────────
  function getMasonState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.masonryLens) STATE.masonryLens = {};
    const s = STATE.masonryLens;
    for (const k of [
      "takeoffs", "proposals", "schedule", "photos",
      "changeOrders", "priceBook", "invoices", "codeRefs",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveMasonState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mnow = () => new Date().toISOString();
  const maid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mlist = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const mnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const mclean = (v, max = 240) => String(v == null ? "" : v).trim().slice(0, max);

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 1 — Visual wall/project takeoff
  // Draw wall segments; auto-derive area + material counts.
  // ─────────────────────────────────────────────────────────────────────
  const MATERIAL_RATES = {
    brick: { unitsPerSqFt: 7, mortar: 0.02, costPerUnit: 0.75, label: "Brick" },
    block: { unitsPerSqFt: 1.125, mortar: 0.03, costPerUnit: 2.5, label: "Concrete Block" },
    stone: { unitsPerSqFt: 5, mortar: 0.025, costPerUnit: 8, label: "Stone Veneer" },
  };

  function computeTakeoff(segments, material, waste, openings) {
    const rate = MATERIAL_RATES[material] || MATERIAL_RATES.brick;
    let grossArea = 0;
    let linearFeet = 0;
    const segOut = (segments || []).map((sg) => {
      const len = mnum(sg.lengthFeet);
      const ht = mnum(sg.heightFeet);
      const area = Math.round(len * ht * 100) / 100;
      grossArea += area;
      linearFeet += len;
      return { id: sg.id || mid("seg"), label: mclean(sg.label || "Wall", 60), lengthFeet: len, heightFeet: ht, areaSqFt: area };
    });
    let openArea = 0;
    const openOut = (openings || []).map((op) => {
      const w = mnum(op.widthFeet);
      const h = mnum(op.heightFeet);
      const a = Math.round(w * h * 100) / 100;
      openArea += a;
      return { id: op.id || mid("op"), label: mclean(op.label || "Opening", 60), widthFeet: w, heightFeet: h, areaSqFt: a };
    });
    const netArea = Math.max(0, Math.round((grossArea - openArea) * 100) / 100);
    const wasteFactor = 1 + (mnum(waste, 5) / 100);
    const units = Math.ceil(netArea * rate.unitsPerSqFt * wasteFactor);
    const mortarBags = Math.ceil(netArea * rate.mortar);
    const materialCost = Math.round(units * rate.costPerUnit);
    const mortarCost = Math.round(mortarBags * 12);
    return {
      material, materialLabel: rate.label, segments: segOut, openings: openOut,
      grossAreaSqFt: Math.round(grossArea * 100) / 100, openingAreaSqFt: Math.round(openArea * 100) / 100,
      netAreaSqFt: netArea, linearFeet: Math.round(linearFeet * 100) / 100, wastePct: mnum(waste, 5),
      unitsNeeded: units, mortarBags80lb: mortarBags, materialCost, mortarCost,
      totalMaterialCost: materialCost + mortarCost,
    };
  }

  registerLensAction("masonry", "takeoff-save", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const name = mclean(params.name, 120) || "Untitled takeoff";
      const material = MATERIAL_RATES[params.material] ? params.material : "brick";
      const calc = computeTakeoff(params.segments, material, params.wastePct, params.openings);
      const list = mlist(s.takeoffs, userId);
      const existing = params.id ? list.find((t) => t.id === params.id) : null;
      if (existing) {
        Object.assign(existing, { name, ...calc, updatedAt: mnow() });
        saveMasonState();
        return { ok: true, result: existing };
      }
      const rec = { id: mid("tk"), name, ...calc, createdAt: mnow(), updatedAt: mnow() };
      list.unshift(rec);
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "takeoff-list", (ctx, _a, _params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      return { ok: true, result: { takeoffs: mlist(s.takeoffs, maid(ctx)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "takeoff-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const list = mlist(s.takeoffs, userId);
      const idx = list.findIndex((t) => t.id === params.id);
      if (idx < 0) return { ok: false, error: "Takeoff not found" };
      list.splice(idx, 1);
      saveMasonState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 6 — Material price book (defined early; estimate/proposal use it)
  // ─────────────────────────────────────────────────────────────────────
  const DEFAULT_PRICE_BOOK = [
    { sku: "BRK-STD", name: "Standard modular brick", unit: "each", unitCost: 0.75, category: "brick" },
    { sku: "BLK-8", name: '8" CMU block', unit: "each", unitCost: 2.5, category: "block" },
    { sku: "STN-VNR", name: "Stone veneer", unit: "sqft", unitCost: 8, category: "stone" },
    { sku: "MOR-N", name: "Type N mortar (80lb)", unit: "bag", unitCost: 12, category: "mortar" },
    { sku: "RBR-4", name: "#4 rebar (20ft)", unit: "each", unitCost: 9, category: "reinforcement" },
    { sku: "LAB-MAS", name: "Mason labor", unit: "hour", unitCost: 55, category: "labor" },
    { sku: "LAB-TEND", name: "Tender / laborer", unit: "hour", unitCost: 32, category: "labor" },
  ];

  registerLensAction("masonry", "pricebook-list", (ctx, _a, _params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      if (!s.priceBook.has(userId)) {
        s.priceBook.set(userId, DEFAULT_PRICE_BOOK.map((p) => ({ id: mid("pb"), ...p, updatedAt: mnow() })));
      }
      return { ok: true, result: { items: s.priceBook.get(userId) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "pricebook-save", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      if (!s.priceBook.has(userId)) {
        s.priceBook.set(userId, DEFAULT_PRICE_BOOK.map((p) => ({ id: mid("pb"), ...p, updatedAt: mnow() })));
      }
      const list = s.priceBook.get(userId);
      const fields = {
        sku: mclean(params.sku, 40), name: mclean(params.name, 120),
        unit: mclean(params.unit, 20) || "each", unitCost: Math.round(mnum(params.unitCost) * 100) / 100,
        category: mclean(params.category, 40) || "general",
      };
      if (!fields.name) return { ok: false, error: "Name required" };
      const existing = params.id ? list.find((p) => p.id === params.id) : null;
      if (existing) {
        Object.assign(existing, fields, { updatedAt: mnow() });
        saveMasonState();
        return { ok: true, result: existing };
      }
      const rec = { id: mid("pb"), ...fields, updatedAt: mnow() };
      list.unshift(rec);
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "pricebook-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const list = s.priceBook.get(userId);
      if (!list) return { ok: false, error: "Price book empty" };
      const idx = list.findIndex((p) => p.id === params.id);
      if (idx < 0) return { ok: false, error: "Item not found" };
      list.splice(idx, 1);
      saveMasonState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 2 — Estimate → professional proposal
  // Builds a structured proposal (line items, totals, terms) for the client.
  // ─────────────────────────────────────────────────────────────────────
  function priceProposal(lineItems, taxPct, marginPct) {
    const lines = (lineItems || []).map((li) => {
      const qty = mnum(li.quantity, 1);
      const unitCost = Math.round(mnum(li.unitCost) * 100) / 100;
      const lineTotal = Math.round(qty * unitCost * 100) / 100;
      return {
        id: li.id || mid("li"), description: mclean(li.description || li.name || "Item", 160),
        unit: mclean(li.unit, 20) || "each", quantity: qty, unitCost, lineTotal,
      };
    });
    const subtotal = Math.round(lines.reduce((sm, l) => sm + l.lineTotal, 0) * 100) / 100;
    const margin = Math.round(subtotal * (mnum(marginPct, 15) / 100) * 100) / 100;
    const taxable = subtotal + margin;
    const tax = Math.round(taxable * (mnum(taxPct, 0) / 100) * 100) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;
    return { lines, subtotal, marginPct: mnum(marginPct, 15), margin, taxPct: mnum(taxPct, 0), tax, total };
  }

  registerLensAction("masonry", "proposal-create", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const client = mclean(params.client, 120);
      if (!client) return { ok: false, error: "Client name required" };
      const priced = priceProposal(params.lineItems, params.taxPct, params.marginPct);
      const list = mlist(s.proposals, userId);
      const num = `PROP-${String(list.length + 1001).padStart(4, "0")}`;
      const rec = {
        id: mid("prop"), number: num, client,
        projectTitle: mclean(params.projectTitle, 160) || "Masonry project",
        scopeOfWork: mclean(params.scopeOfWork, 2000),
        terms: mclean(params.terms, 1000) || "50% deposit due on acceptance, balance on completion. Estimate valid 30 days.",
        validDays: mnum(params.validDays, 30), status: "draft",
        ...priced, createdAt: mnow(), updatedAt: mnow(), acceptedAt: null,
      };
      list.unshift(rec);
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "proposal-list", (ctx, _a, _params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      return { ok: true, result: { proposals: mlist(s.proposals, maid(ctx)) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "proposal-update-status", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.proposals, maid(ctx));
      const p = list.find((x) => x.id === params.id);
      if (!p) return { ok: false, error: "Proposal not found" };
      const status = ["draft", "sent", "accepted", "declined"].includes(params.status) ? params.status : "draft";
      p.status = status;
      p.updatedAt = mnow();
      if (status === "accepted") p.acceptedAt = mnow();
      saveMasonState();
      return { ok: true, result: p };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "proposal-render", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const p = mlist(s.proposals, maid(ctx)).find((x) => x.id === params.id);
      if (!p) return { ok: false, error: "Proposal not found" };
      const rows = p.lines.map((l) =>
        `${l.description} — ${l.quantity} ${l.unit} @ $${l.unitCost.toFixed(2)} = $${l.lineTotal.toFixed(2)}`
      );
      const doc = [
        `PROPOSAL ${p.number}`,
        `Project: ${p.projectTitle}`,
        `Client: ${p.client}`,
        `Date: ${(p.createdAt || "").slice(0, 10)}`,
        "",
        "SCOPE OF WORK",
        p.scopeOfWork || "(see line items)",
        "",
        "LINE ITEMS",
        ...rows,
        "",
        `Subtotal: $${p.subtotal.toFixed(2)}`,
        `Overhead & profit (${p.marginPct}%): $${p.margin.toFixed(2)}`,
        `Tax (${p.taxPct}%): $${p.tax.toFixed(2)}`,
        `TOTAL: $${p.total.toFixed(2)}`,
        "",
        "TERMS",
        p.terms,
      ].join("\n");
      return { ok: true, result: { number: p.number, document: doc, total: p.total } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 3 — Job scheduling calendar (crew, multi-day, weather awareness)
  // ─────────────────────────────────────────────────────────────────────
  function weatherAdvisory(job) {
    const lowF = mnum(job.forecastLowF, 55);
    const precip = mnum(job.precipChancePct, 0);
    const flags = [];
    if (lowF < 40) flags.push("Cold-weather masonry: protect work, do not lay below 40°F without heat");
    if (lowF < 32) flags.push("Freeze risk — mortar will not cure; reschedule or heat & enclose");
    if (precip >= 60) flags.push("High precipitation chance — cover fresh work, may delay");
    let risk = "clear";
    if (flags.length === 1) risk = "caution";
    if (flags.length >= 2) risk = "high";
    return { risk, advisories: flags };
  }

  registerLensAction("masonry", "schedule-add", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const title = mclean(params.title, 160);
      const startDate = mclean(params.startDate, 10);
      if (!title || !startDate) return { ok: false, error: "Title and start date required" };
      const days = Math.max(1, Math.min(60, mnum(params.durationDays, 1)));
      const crew = Array.isArray(params.crew) ? params.crew.map((c) => mclean(c, 80)).filter(Boolean) : [];
      const weather = weatherAdvisory(params);
      const list = mlist(s.schedule, userId);
      const existing = params.id ? list.find((j) => j.id === params.id) : null;
      const fields = {
        title, jobId: mclean(params.jobId, 60), startDate, durationDays: days,
        crew, status: ["scheduled", "in_progress", "done"].includes(params.status) ? params.status : "scheduled",
        forecastLowF: mnum(params.forecastLowF, 55), precipChancePct: mnum(params.precipChancePct, 0),
        weather, notes: mclean(params.notes, 500),
      };
      if (existing) {
        Object.assign(existing, fields, { updatedAt: mnow() });
        saveMasonState();
        return { ok: true, result: existing };
      }
      const rec = { id: mid("sch"), ...fields, createdAt: mnow(), updatedAt: mnow() };
      list.push(rec);
      list.sort((a, b) => a.startDate.localeCompare(b.startDate));
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "schedule-list", (ctx, _a, _params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.schedule, maid(ctx));
      const crewLoad = {};
      for (const j of list) for (const c of j.crew || []) crewLoad[c] = (crewLoad[c] || 0) + j.durationDays;
      return { ok: true, result: { jobs: list, crewLoad } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "schedule-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.schedule, maid(ctx));
      const idx = list.findIndex((j) => j.id === params.id);
      if (idx < 0) return { ok: false, error: "Job not found" };
      list.splice(idx, 1);
      saveMasonState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 4 — Photo documentation (before/during/after timeline)
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("masonry", "photo-add", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const url = mclean(params.url, 1000);
      if (!url) return { ok: false, error: "Photo URL required" };
      const phase = ["before", "during", "after"].includes(params.phase) ? params.phase : "during";
      const rec = {
        id: mid("ph"), jobId: mclean(params.jobId, 60) || "general",
        url, phase, caption: mclean(params.caption, 300),
        takenAt: mclean(params.takenAt, 30) || mnow(), createdAt: mnow(),
      };
      const list = mlist(s.photos, userId);
      list.unshift(rec);
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "photo-list", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let list = mlist(s.photos, maid(ctx));
      if (params.jobId) list = list.filter((p) => p.jobId === params.jobId);
      const timeline = [...list].sort((a, b) => (a.takenAt || "").localeCompare(b.takenAt || ""));
      const byPhase = { before: [], during: [], after: [] };
      for (const p of list) (byPhase[p.phase] || byPhase.during).push(p);
      return { ok: true, result: { photos: list, timeline, byPhase } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "photo-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.photos, maid(ctx));
      const idx = list.findIndex((p) => p.id === params.id);
      if (idx < 0) return { ok: false, error: "Photo not found" };
      list.splice(idx, 1);
      saveMasonState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 5 — Change orders (scope additions, re-pricing, sign-off)
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("masonry", "change-order-create", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const desc = mclean(params.description, 1000);
      if (!desc) return { ok: false, error: "Description required" };
      const laborCost = Math.round(mnum(params.laborHours) * mnum(params.laborRate, 55) * 100) / 100;
      const materialCost = Math.round(mnum(params.materialCost) * 100) / 100;
      const amount = Math.round((laborCost + materialCost) * 100) / 100;
      const list = mlist(s.changeOrders, userId);
      const num = `CO-${String(list.length + 1).padStart(3, "0")}`;
      const rec = {
        id: mid("co"), number: num, jobId: mclean(params.jobId, 60) || "general",
        description: desc, laborHours: mnum(params.laborHours), laborRate: mnum(params.laborRate, 55),
        laborCost, materialCost, amount, status: "pending",
        scheduleImpactDays: mnum(params.scheduleImpactDays, 0),
        createdAt: mnow(), updatedAt: mnow(), signedOffAt: null, signedBy: null,
      };
      list.unshift(rec);
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "change-order-list", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let list = mlist(s.changeOrders, maid(ctx));
      if (params.jobId) list = list.filter((c) => c.jobId === params.jobId);
      const approvedTotal = list.filter((c) => c.status === "approved").reduce((sm, c) => sm + c.amount, 0);
      const pendingTotal = list.filter((c) => c.status === "pending").reduce((sm, c) => sm + c.amount, 0);
      return { ok: true, result: { changeOrders: list, approvedTotal: Math.round(approvedTotal * 100) / 100, pendingTotal: Math.round(pendingTotal * 100) / 100 } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "change-order-sign", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.changeOrders, maid(ctx));
      const co = list.find((c) => c.id === params.id);
      if (!co) return { ok: false, error: "Change order not found" };
      const status = ["pending", "approved", "rejected"].includes(params.status) ? params.status : "approved";
      co.status = status;
      co.updatedAt = mnow();
      if (status === "approved") {
        co.signedOffAt = mnow();
        co.signedBy = mclean(params.signedBy, 120) || "Client";
      }
      saveMasonState();
      return { ok: true, result: co };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 7 — Invoicing with payment tracking + progress billing
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("masonry", "invoice-create", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = maid(ctx);
      const client = mclean(params.client, 120);
      const contractTotal = Math.round(mnum(params.contractTotal) * 100) / 100;
      if (!client || contractTotal <= 0) return { ok: false, error: "Client and positive contract total required" };
      const pct = Math.max(0, Math.min(100, mnum(params.progressPct, 100)));
      const amount = Math.round(contractTotal * (pct / 100) * 100) / 100;
      const list = mlist(s.invoices, userId);
      const num = `INV-${String(list.length + 2001).padStart(4, "0")}`;
      const rec = {
        id: mid("inv"), number: num, client, jobId: mclean(params.jobId, 60) || "general",
        contractTotal, progressPct: pct, amount,
        dueDate: mclean(params.dueDate, 10), status: "unpaid",
        payments: [], amountPaid: 0, balance: amount,
        createdAt: mnow(), updatedAt: mnow(),
      };
      list.unshift(rec);
      saveMasonState();
      return { ok: true, result: rec };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "invoice-list", (ctx, _a, _params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.invoices, maid(ctx));
      const billed = list.reduce((sm, i) => sm + i.amount, 0);
      const collected = list.reduce((sm, i) => sm + i.amountPaid, 0);
      const outstanding = Math.round((billed - collected) * 100) / 100;
      return { ok: true, result: { invoices: list, totalBilled: Math.round(billed * 100) / 100, totalCollected: Math.round(collected * 100) / 100, outstanding } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "invoice-record-payment", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.invoices, maid(ctx));
      const inv = list.find((i) => i.id === params.id);
      if (!inv) return { ok: false, error: "Invoice not found" };
      const amt = Math.round(mnum(params.amount) * 100) / 100;
      if (amt <= 0) return { ok: false, error: "Payment amount must be positive" };
      inv.payments.push({
        id: mid("pay"), amount: amt,
        method: mclean(params.method, 40) || "check",
        date: mclean(params.date, 10) || mnow().slice(0, 10), recordedAt: mnow(),
      });
      inv.amountPaid = Math.round(inv.payments.reduce((sm, p) => sm + p.amount, 0) * 100) / 100;
      inv.balance = Math.round((inv.amount - inv.amountPaid) * 100) / 100;
      inv.status = inv.balance <= 0 ? "paid" : inv.amountPaid > 0 ? "partial" : "unpaid";
      inv.updatedAt = mnow();
      saveMasonState();
      return { ok: true, result: inv };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "invoice-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMasonState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = mlist(s.invoices, maid(ctx));
      const idx = list.findIndex((i) => i.id === params.id);
      if (idx < 0) return { ok: false, error: "Invoice not found" };
      list.splice(idx, 1);
      saveMasonState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // FEATURE 8 — Code-reference library (IBC/ACI/TMS) tied to wall-strength
  // ─────────────────────────────────────────────────────────────────────
  const MASONRY_CODES = [
    { code: "TMS 402", section: "5.1.1.3", topic: "Wall slenderness — empirical h/t limits", standard: "TMS", summary: "Empirical design slenderness ratio (h/t) for masonry bearing walls limited to 20; non-bearing to 18. Reinforced walls use engineered design.", tags: ["slenderness", "wall-strength"] },
    { code: "TMS 402", section: "9.3.4.2", topic: "Reinforced masonry — minimum reinforcement", standard: "TMS", summary: "Minimum vertical and horizontal reinforcement for reinforced masonry shear walls; spacing limits and bar size minimums.", tags: ["reinforcement", "wall-strength"] },
    { code: "ACI 530", section: "1.16", topic: "Mortar joint thickness", standard: "ACI", summary: "Bed joints 3/8 in. nominal; head joints fully filled. Tolerances per construction class.", tags: ["mortar"] },
    { code: "IBC 2021", section: "2104", topic: "Cold-weather masonry construction", standard: "IBC", summary: "When ambient temp is below 40°F, heat materials and protect completed work for 24-48 hours. Do not lay on frozen surfaces.", tags: ["weather", "mortar"] },
    { code: "IBC 2021", section: "2105", topic: "Quality assurance for masonry", standard: "IBC", summary: "Required inspection and testing levels (A/B/C) keyed to risk category and f'm verification method.", tags: ["inspection"] },
    { code: "ASTM C270", section: "—", topic: "Mortar for unit masonry — Types M/S/N/O", standard: "ASTM", summary: "Property and proportion specifications for mortar types. Type S min 1800 psi, Type N min 750 psi.", tags: ["mortar"] },
    { code: "TMS 402", section: "8.2.6", topic: "Lateral support / wall ties spacing", standard: "TMS", summary: "Wall ties for veneer: max 32 in. horizontal, 24 in. vertical, one tie per 2.67 sq ft.", tags: ["veneer", "ties"] },
  ];

  registerLensAction("masonry", "code-search", (ctx, _a, params = {}) => {
    try {
      const q = mclean(params.query, 120).toLowerCase();
      const std = mclean(params.standard, 20).toUpperCase();
      let results = MASONRY_CODES;
      if (std) results = results.filter((c) => c.standard === std);
      if (q) {
        results = results.filter((c) =>
          c.code.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q) ||
          c.summary.toLowerCase().includes(q) || (c.tags || []).some((t) => t.includes(q))
        );
      }
      const standards = [...new Set(MASONRY_CODES.map((c) => c.standard))];
      return { ok: true, result: { results, count: results.length, standards } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("masonry", "code-for-check", (ctx, _a, params = {}) => {
    try {
      const tag = (mclean(params.checkType, 40).toLowerCase()) || "wall-strength";
      const refs = MASONRY_CODES.filter((c) => (c.tags || []).includes(tag));
      return { ok: true, result: { checkType: tag, references: refs.length ? refs : MASONRY_CODES.filter((c) => (c.tags || []).includes("wall-strength")) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
