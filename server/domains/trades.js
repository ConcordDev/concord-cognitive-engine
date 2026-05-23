// server/domains/trades.js
// Domain actions for trades/contracting: estimates, inspections, materials costs.

export default function registerTradesActions(registerLensAction) {
  /**
   * calculateEstimate
   * Sum line items with markup and tax to produce a customer-facing estimate.
   * artifact.data.lineItems: [{ description, quantity, unitCost, category }]
   * params.markupPct (default 20), params.taxRate (default 0.08)
   */
  registerLensAction("trades", "calculateEstimate", (ctx, artifact, params) => {
  try {
    const lineItems = artifact.data.lineItems || [];
    const markupPct = params.markupPct != null ? params.markupPct : 20;
    const taxRate = params.taxRate != null ? params.taxRate : 0.08;
    const discountPct = params.discountPct || 0;

    if (lineItems.length === 0) {
      return { ok: true, result: { error: "No line items provided." } };
    }

    let subtotal = 0;
    const detailed = lineItems.map((item, idx) => {
      const qty = parseFloat(item.quantity) || 0;
      const unit = parseFloat(item.unitCost) || 0;
      const lineTotal = Math.round(qty * unit * 100) / 100;
      subtotal += lineTotal;
      return {
        line: idx + 1,
        description: item.description || "",
        category: item.category || "general",
        quantity: qty,
        unitCost: unit,
        lineTotal,
      };
    });

    const markupAmount = Math.round(subtotal * (markupPct / 100) * 100) / 100;
    const afterMarkup = Math.round((subtotal + markupAmount) * 100) / 100;
    const discountAmount = Math.round(afterMarkup * (discountPct / 100) * 100) / 100;
    const afterDiscount = Math.round((afterMarkup - discountAmount) * 100) / 100;
    const taxAmount = Math.round(afterDiscount * taxRate * 100) / 100;
    const grandTotal = Math.round((afterDiscount + taxAmount) * 100) / 100;

    // Category breakdown
    const byCategory = {};
    for (const item of detailed) {
      if (!byCategory[item.category]) byCategory[item.category] = 0;
      byCategory[item.category] = Math.round((byCategory[item.category] + item.lineTotal) * 100) / 100;
    }

    const estimate = {
      generatedAt: new Date().toISOString(),
      lineItems: detailed,
      subtotal,
      markupPct,
      markupAmount,
      discountPct,
      discountAmount,
      taxRate,
      taxAmount,
      grandTotal,
      byCategory,
    };

    artifact.data.currentEstimate = estimate;

    return { ok: true, result: estimate };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * calculatePL
   * Calculate profit/loss: revenue vs costs, material costs, labor, overhead, margin.
   * artifact.data.revenue, artifact.data.costs: { materials, labor, overhead, ... }
   */
  registerLensAction("trades", "calculatePL", (ctx, artifact, params) => {
    const revenue = parseFloat(artifact.data?.revenue || params.revenue) || 0;
    const costs = artifact.data?.costs || {};
    const materialCost = parseFloat(costs.materials || costs.materialCost) || 0;
    const laborCost = parseFloat(costs.labor || costs.laborCost) || 0;
    const overhead = parseFloat(costs.overhead || costs.overheadCost) || 0;
    const otherCosts = parseFloat(costs.other || costs.miscellaneous) || 0;
    const totalCosts = Math.round((materialCost + laborCost + overhead + otherCosts) * 100) / 100;
    const grossProfit = Math.round((revenue - totalCosts) * 100) / 100;
    const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;

    return {
      ok: true,
      result: {
        generatedAt: new Date().toISOString(),
        revenue,
        costs: { materials: materialCost, labor: laborCost, overhead, other: otherCosts },
        totalCosts,
        grossProfit,
        margin,
        status: grossProfit > 0 ? 'profitable' : grossProfit === 0 ? 'break-even' : 'loss',
        costBreakdown: {
          materialsPercent: totalCosts > 0 ? Math.round((materialCost / totalCosts) * 10000) / 100 : 0,
          laborPercent: totalCosts > 0 ? Math.round((laborCost / totalCosts) * 10000) / 100 : 0,
          overheadPercent: totalCosts > 0 ? Math.round((overhead / totalCosts) * 10000) / 100 : 0,
          otherPercent: totalCosts > 0 ? Math.round((otherCosts / totalCosts) * 10000) / 100 : 0,
        },
      },
    };
  });

  /**
   * checkPermits
   * Check required permits for job: type needed, status, expiry, jurisdiction.
   * artifact.data.permits: [{ permitId, type, status, expiryDate, jurisdiction }]
   * artifact.data.jobType or params.jobType
   */
  registerLensAction("trades", "checkPermits", (ctx, artifact, params) => {
  try {
    const permits = artifact.data?.permits || [];
    const jobType = (artifact.data?.jobType || params.jobType || '').toLowerCase();
    const now = new Date();

    const permitRequirements = {
      electrical: ['electrical_permit', 'building_permit'],
      plumbing: ['plumbing_permit', 'building_permit'],
      structural: ['building_permit', 'engineering_approval'],
      hvac: ['mechanical_permit', 'building_permit'],
      roofing: ['building_permit'],
      demolition: ['demolition_permit', 'building_permit', 'environmental_clearance'],
      general: ['building_permit'],
    };
    const required = permitRequirements[jobType] || permitRequirements.general;

    const permitStatus = permits.map(p => {
      const expiry = p.expiryDate ? new Date(p.expiryDate) : null;
      const isExpired = expiry && expiry < now;
      const daysUntilExpiry = expiry ? Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)) : null;
      return {
        permitId: p.permitId || p.id,
        type: p.type,
        status: isExpired ? 'expired' : (p.status || 'unknown'),
        jurisdiction: p.jurisdiction || '',
        expiryDate: p.expiryDate || null,
        daysUntilExpiry,
        isExpired: !!isExpired,
      };
    });

    const existingTypes = permits.map(p => (p.type || '').toLowerCase().replace(/\s+/g, '_'));
    const missing = required.filter(r => !existingTypes.some(t => t.includes(r.replace('_', '')) || r.includes(t.replace('_', ''))));
    const expired = permitStatus.filter(p => p.isExpired);
    const expiringSoon = permitStatus.filter(p => p.daysUntilExpiry != null && p.daysUntilExpiry > 0 && p.daysUntilExpiry <= 30);

    const allClear = missing.length === 0 && expired.length === 0;

    return {
      ok: true,
      result: {
        checkedAt: new Date().toISOString(),
        jobType: jobType || 'general',
        requiredPermits: required,
        existingPermits: permitStatus,
        missingPermits: missing,
        expiredPermits: expired,
        expiringSoon,
        allClear,
        status: allClear ? 'approved' : 'action_required',
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * generateInvoice
   * Generate trade invoice from work orders: labor hours, materials, markup, tax.
   * artifact.data.workOrders: [{ description, laborHours, laborRate, materials: [{ item, quantity, unitCost }] }]
   * params.markupPct (default 15), params.taxRate (default 0.08)
   */
  registerLensAction("trades", "generateInvoice", (ctx, artifact, params) => {
  try {
    const workOrders = artifact.data?.workOrders || [];
    const markupPct = params.markupPct != null ? params.markupPct : 15;
    const taxRate = params.taxRate != null ? params.taxRate : 0.08;

    let totalLabor = 0;
    let totalMaterials = 0;
    let totalHours = 0;

    const lineItems = workOrders.map((wo, idx) => {
      const hours = parseFloat(wo.laborHours) || 0;
      const rate = parseFloat(wo.laborRate) || 0;
      const laborCost = Math.round(hours * rate * 100) / 100;
      totalHours += hours;
      totalLabor += laborCost;

      const materials = (wo.materials || []).map(m => {
        const qty = parseFloat(m.quantity) || 0;
        const uc = parseFloat(m.unitCost) || 0;
        const cost = Math.round(qty * uc * 100) / 100;
        totalMaterials += cost;
        return { item: m.item || m.name, quantity: qty, unitCost: uc, cost };
      });

      return {
        line: idx + 1,
        description: wo.description || '',
        laborHours: hours,
        laborRate: rate,
        laborCost,
        materials,
        materialsCost: Math.round(materials.reduce((s, m) => s + m.cost, 0) * 100) / 100,
      };
    });

    totalLabor = Math.round(totalLabor * 100) / 100;
    totalMaterials = Math.round(totalMaterials * 100) / 100;
    const subtotal = Math.round((totalLabor + totalMaterials) * 100) / 100;
    const markupAmount = Math.round(subtotal * (markupPct / 100) * 100) / 100;
    const afterMarkup = Math.round((subtotal + markupAmount) * 100) / 100;
    const taxAmount = Math.round(afterMarkup * taxRate * 100) / 100;
    const total = Math.round((afterMarkup + taxAmount) * 100) / 100;

    return {
      ok: true,
      result: {
        invoiceDate: new Date().toISOString().split('T')[0],
        lineItems,
        totalHours: Math.round(totalHours * 100) / 100,
        totalLabor,
        totalMaterials,
        subtotal,
        markupPct,
        markupAmount,
        taxRate,
        taxAmount,
        total,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * generatePO
   * Generate purchase order from material requirements: vendor, items, quantities, pricing.
   * artifact.data.materials: [{ item, vendor, quantity, unitCost, category }]
   * params.poNumber (optional)
   */
  registerLensAction("trades", "generatePO", (ctx, artifact, params) => {
  try {
    const materials = artifact.data?.materials || [];
    const poNumber = params.poNumber || `PO-${Date.now().toString(36).toUpperCase()}`;

    let grandTotal = 0;
    const byVendor = {};

    const lineItems = materials.map((m, idx) => {
      const qty = parseFloat(m.quantity) || 0;
      const uc = parseFloat(m.unitCost) || 0;
      const lineTotal = Math.round(qty * uc * 100) / 100;
      grandTotal += lineTotal;

      const vendor = m.vendor || m.supplier || 'Unassigned';
      if (!byVendor[vendor]) byVendor[vendor] = { items: 0, total: 0 };
      byVendor[vendor].items++;
      byVendor[vendor].total += lineTotal;

      return {
        line: idx + 1,
        item: m.item || m.name,
        category: m.category || 'general',
        vendor,
        quantity: qty,
        unitCost: uc,
        lineTotal,
      };
    });

    grandTotal = Math.round(grandTotal * 100) / 100;

    const vendorSummary = Object.entries(byVendor).map(([name, data]) => ({
      vendor: name,
      itemCount: data.items,
      total: Math.round(data.total * 100) / 100,
    })).sort((a, b) => b.total - a.total);

    return {
      ok: true,
      result: {
        poNumber,
        generatedAt: new Date().toISOString(),
        lineItems,
        totalItems: lineItems.length,
        grandTotal,
        vendorSummary,
        vendorCount: vendorSummary.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * scheduleInspection
   * Create an inspection checkpoint linked to a permit.
   * artifact.data.permits: [{ permitId, type, stages: [{ name, inspectionRequired }] }]
   * params.permitId — which permit to schedule for
   * params.stageName — the stage to schedule
   * params.requestedDate — preferred date (ISO)
   */
  registerLensAction("trades", "scheduleInspection", (ctx, artifact, params) => {
  try {
    const permits = artifact.data.permits || [];
    const permitId = params.permitId;
    const stageName = params.stageName;
    const requestedDate = params.requestedDate || null;

    const permit = permits.find((p) => p.permitId === permitId);
    if (!permit) {
      return { ok: true, result: { error: `Permit ${permitId} not found.` } };
    }

    const stage = (permit.stages || []).find(
      (s) => s.name.toLowerCase() === (stageName || "").toLowerCase()
    );
    if (!stage) {
      return { ok: true, result: { error: `Stage '${stageName}' not found on permit ${permitId}.` } };
    }

    if (!stage.inspectionRequired) {
      return { ok: true, result: { error: `Stage '${stageName}' does not require inspection.` } };
    }

    // Determine inspection date: requested date or 3 business days from now
    let inspectionDate;
    if (requestedDate) {
      inspectionDate = new Date(requestedDate);
    } else {
      inspectionDate = new Date();
      let businessDays = 0;
      while (businessDays < 3) {
        inspectionDate.setDate(inspectionDate.getDate() + 1);
        const dow = inspectionDate.getDay();
        if (dow !== 0 && dow !== 6) businessDays++;
      }
    }

    const inspection = {
      inspectionId: `INS-${permitId}-${Date.now().toString(36).toUpperCase()}`,
      permitId,
      permitType: permit.type,
      stageName: stage.name,
      requestedDate: inspectionDate.toISOString().split("T")[0],
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };

    if (!artifact.data.inspections) artifact.data.inspections = [];
    artifact.data.inspections.push(inspection);

    // Mark the stage as having a scheduled inspection
    stage.inspectionStatus = "scheduled";
    stage.inspectionId = inspection.inspectionId;

    return { ok: true, result: inspection };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * materialsCost
   * Aggregate materials costs across active jobs.
   * artifact.data.jobs: [{ jobId, name, status, materials: [{ item, quantity, unitCost }] }]
   * params.statusFilter (default "active") — which job statuses to include
   */
  registerLensAction("trades", "materialsCost", (ctx, artifact, params) => {
  try {
    const jobs = artifact.data.jobs || [];
    const statusFilter = params.statusFilter || "active";

    const activeJobs = jobs.filter(
      (j) => j.status && j.status.toLowerCase() === statusFilter.toLowerCase()
    );

    let grandTotal = 0;
    const perJob = [];
    const materialTotals = {};

    for (const job of activeJobs) {
      let jobTotal = 0;
      const materials = job.materials || [];

      for (const mat of materials) {
        const qty = parseFloat(mat.quantity) || 0;
        const cost = parseFloat(mat.unitCost) || 0;
        const lineCost = Math.round(qty * cost * 100) / 100;
        jobTotal += lineCost;

        const key = (mat.item || "unknown").toLowerCase();
        if (!materialTotals[key]) {
          materialTotals[key] = { item: mat.item, totalQuantity: 0, totalCost: 0 };
        }
        materialTotals[key].totalQuantity += qty;
        materialTotals[key].totalCost = Math.round((materialTotals[key].totalCost + lineCost) * 100) / 100;
      }

      jobTotal = Math.round(jobTotal * 100) / 100;
      grandTotal += jobTotal;

      perJob.push({
        jobId: job.jobId,
        name: job.name,
        materialLineCount: materials.length,
        jobMaterialCost: jobTotal,
      });
    }

    grandTotal = Math.round(grandTotal * 100) / 100;

    // Sort materials by total cost descending
    const sortedMaterials = Object.values(materialTotals).sort(
      (a, b) => b.totalCost - a.totalCost
    );

    const report = {
      generatedAt: new Date().toISOString(),
      statusFilter,
      jobsIncluded: activeJobs.length,
      grandTotal,
      perJob,
      materialBreakdown: sortedMaterials,
      topMaterial: sortedMaterials[0] || null,
    };

    artifact.data.materialsCostReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── 2026 parity — ServiceTitan/Jobber/Houzz Pro/BuilderTrend ──

  function getTradesState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.tradesLens) {
      STATE.tradesLens = {
        jobs:      new Map(), // userId -> Map<id, job>
        customers: new Map(), // userId -> Map<id, customer>
        contracts: new Map(), // userId -> Map<id, contract>
        seq:       new Map(), // userId -> { job: 1, invoice: 1 }
      };
    }
    return STATE.tradesLens;
  }
  function saveTradesState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function tradesActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextTradesId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoTrades() { return new Date().toISOString(); }

  // ── Customers ──

  registerLensAction("trades", "customer-upsert", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (!s.customers.has(userId)) s.customers.set(userId, new Map());
    const id = params.id ? String(params.id) : nextTradesId("cust");
    const existing = s.customers.get(userId).get(id);
    const customer = {
      id, name,
      phone: String(params.phone || existing?.phone || "").slice(0, 30),
      email: String(params.email || existing?.email || "").slice(0, 80),
      address: String(params.address || existing?.address || "").slice(0, 200),
      notes: String(params.notes || existing?.notes || "").slice(0, 500),
      createdAt: existing?.createdAt || nowIsoTrades(),
      updatedAt: nowIsoTrades(),
    };
    s.customers.get(userId).set(id, customer);
    saveTradesState();
    return { ok: true, result: { customer } };
  });

  registerLensAction("trades", "customer-list", (ctx, _artifact, _params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const map = s.customers.get(userId);
    if (!map) return { ok: true, result: { customers: [] } };
    const customers = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { customers } };
  });

  // ── Jobs (work orders / dispatch board) ──

  registerLensAction("trades", "job-create", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerId = String(params.customerId || "");
    if (!customerId) return { ok: false, error: "customerId required" };
    const customer = s.customers.get(userId)?.get(customerId);
    if (!customer) return { ok: false, error: "customer not found" };
    const description = String(params.description || "").trim();
    if (!description) return { ok: false, error: "description required" };
    if (description.length > 500) return { ok: false, error: "description too long" };
    const priority = ["low", "normal", "high", "emergency"].includes(params.priority) ? params.priority : "normal";
    if (!s.seq.has(userId)) s.seq.set(userId, { job: 1, invoice: 1 });
    const seq = s.seq.get(userId);
    const job = {
      id: nextTradesId("job"),
      number: `JOB-${String(seq.job).padStart(5, "0")}`,
      customerId,
      customerName: customer.name,
      description,
      priority,
      status: "unassigned",
      scheduledFor: params.scheduledFor ? String(params.scheduledFor) : null,
      assignedTech: params.assignedTech ? String(params.assignedTech) : null,
      estimatedHours: Number(params.estimatedHours) || 0,
      notes: "",
      createdAt: nowIsoTrades(),
      updatedAt: nowIsoTrades(),
    };
    seq.job++;
    if (!s.jobs.has(userId)) s.jobs.set(userId, new Map());
    s.jobs.get(userId).set(job.id, job);
    saveTradesState();
    return { ok: true, result: { job } };
  });

  registerLensAction("trades", "job-list", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const status = params.status ? String(params.status) : null;
    const map = s.jobs.get(userId);
    if (!map) return { ok: true, result: { jobs: [] } };
    let jobs = Array.from(map.values());
    if (status) jobs = jobs.filter((j) => j.status === status);
    jobs.sort((a, b) => {
      const priO = { emergency: 0, high: 1, normal: 2, low: 3 };
      const pa = priO[a.priority] ?? 4, pb = priO[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return { ok: true, result: { jobs } };
  });

  registerLensAction("trades", "job-update-status", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const job = s.jobs.get(userId)?.get(id);
    if (!job) return { ok: false, error: "job not found" };
    const status = String(params.status || "");
    if (!["unassigned", "dispatched", "en-route", "on-site", "completed", "invoiced", "cancelled"].includes(status)) {
      return { ok: false, error: "invalid status" };
    }
    job.status = status;
    if (status === "completed") job.completedAt = nowIsoTrades();
    job.updatedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { job } };
  });

  registerLensAction("trades", "job-assign", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const job = s.jobs.get(userId)?.get(id);
    if (!job) return { ok: false, error: "job not found" };
    const tech = String(params.tech || "").trim();
    if (!tech) return { ok: false, error: "tech required" };
    job.assignedTech = tech;
    if (job.status === "unassigned") job.status = "dispatched";
    job.updatedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { job } };
  });

  // ── Maintenance contracts (recurring service agreements) ──

  registerLensAction("trades", "contract-create", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerId = String(params.customerId || "");
    if (!customerId || !s.customers.get(userId)?.has(customerId)) return { ok: false, error: "customerId required + must exist" };
    const cadence = ["monthly", "quarterly", "semiannual", "annual"].includes(params.cadence) ? params.cadence : "annual";
    const monthlyRate = Number(params.monthlyRate);
    if (!Number.isFinite(monthlyRate) || monthlyRate < 0) return { ok: false, error: "monthlyRate must be >= 0" };
    const contract = {
      id: nextTradesId("contract"),
      customerId,
      customerName: s.customers.get(userId).get(customerId).name,
      cadence,
      monthlyRate,
      description: String(params.description || "").slice(0, 200),
      active: true,
      nextVisitAt: params.nextVisitAt ? String(params.nextVisitAt) : null,
      createdAt: nowIsoTrades(),
    };
    if (!s.contracts.has(userId)) s.contracts.set(userId, new Map());
    s.contracts.get(userId).set(contract.id, contract);
    saveTradesState();
    return { ok: true, result: { contract } };
  });

  registerLensAction("trades", "contract-list", (ctx, _artifact, _params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const map = s.contracts.get(userId);
    if (!map) return { ok: true, result: { contracts: [] } };
    return { ok: true, result: { contracts: Array.from(map.values()) } };
  });

  registerLensAction("trades", "contract-cancel", (ctx, _artifact, params = {}) => {
    const s = getTradesState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const c = s.contracts.get(userId)?.get(id);
    if (!c) return { ok: false, error: "not found" };
    c.active = false;
    c.cancelledAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { contract: c } };
  });

  // ─── Full-app parity: ServiceTitan + Jobber 2026 ────────────────────

  function uidTr(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function ensureTrBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }

  // ── Technicians + dispatch board ──────────────────────────────

  registerLensAction("trades", "technicians-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const techs = ensureTrBucket(s, "technicians", userId);
    return { ok: true, result: { technicians: techs } };
  });

  registerLensAction("trades", "technicians-add", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const tech = {
      id: uidTr("tech"), name,
      skills: Array.isArray(params.skills) ? params.skills : [],
      phone: String(params.phone || ""),
      email: String(params.email || ""),
      status: "available",
      lat: params.lat != null ? Number(params.lat) : null,
      lng: params.lng != null ? Number(params.lng) : null,
      activeJobId: null,
      hireDate: params.hireDate || new Date().toISOString().slice(0, 10),
      addedAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "technicians", userId).push(tech);
    saveTradesState();
    return { ok: true, result: { technician: tech } };
  });

  registerLensAction("trades", "technicians-delete", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const list = ensureTrBucket(s, "technicians", userId);
    const idx = list.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, error: "technician not found" };
    list.splice(idx, 1);
    saveTradesState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("trades", "technicians-set-status", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const status = ["available", "on_route", "on_site", "break", "off"].includes(params.status) ? params.status : null;
    if (!status) return { ok: false, error: "valid status required (available/on_route/on_site/break/off)" };
    const tech = ensureTrBucket(s, "technicians", userId).find(t => t.id === id);
    if (!tech) return { ok: false, error: "technician not found" };
    tech.status = status;
    tech.statusUpdatedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { technician: tech } };
  });

  registerLensAction("trades", "dispatch-board", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const date = String(params.date || new Date().toISOString().slice(0, 10));
    const technicians = ensureTrBucket(s, "technicians", userId);
    const jobsMap = s.jobs?.get(userId);
    const allJobs = jobsMap ? Array.from(jobsMap.values()) : [];
    const todaysJobs = allJobs.filter(j => {
      const sched = j.scheduledFor || j.scheduledDate || j.scheduledAt || "";
      return String(sched).slice(0, 10) === date;
    });
    const byTech = new Map();
    for (const t of technicians) byTech.set(t.id, { tech: t, jobs: [] });
    const unassigned = [];
    for (const j of todaysJobs) {
      const techRef = j.assignedTech || j.technicianId;
      if (techRef && byTech.has(techRef)) byTech.get(techRef).jobs.push(j);
      else unassigned.push(j);
    }
    const rows = Array.from(byTech.values()).map(r => ({
      ...r,
      jobs: r.jobs.sort((a, b) => {
        const ah = new Date(a.scheduledFor || a.scheduledDate || 0).getHours();
        const bh = new Date(b.scheduledFor || b.scheduledDate || 0).getHours();
        return ah - bh;
      }),
    }));
    return { ok: true, result: { date, rows, unassigned, totalJobs: todaysJobs.length, totalTechs: technicians.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Route optimization (nearest-neighbour heuristic) ──────────

  registerLensAction("trades", "route-optimize", (_ctx, _a, params = {}) => {
    const start = params.start && Number.isFinite(params.start.lat) ? params.start : { lat: 0, lng: 0 };
    const stops = Array.isArray(params.stops) ? params.stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng)) : [];
    if (stops.length === 0) return { ok: false, error: "stops required (each with lat,lng,id)" };
    const dist = (a, b) => Math.sqrt(Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2));
    const remaining = stops.slice();
    const ordered = [];
    let cursor = start;
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestD = dist(cursor, remaining[0]);
      for (let i = 1; i < remaining.length; i++) {
        const d = dist(cursor, remaining[i]);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push({ ...next, distanceFromPrev: Math.round(bestD * 100) / 100 });
      cursor = next;
    }
    const totalDistance = ordered.reduce((sum, s) => sum + (s.distanceFromPrev || 0), 0);
    return {
      ok: true,
      result: {
        ordered,
        totalDistanceUnits: Math.round(totalDistance * 100) / 100,
        estimatedDriveMin: Math.round(totalDistance * 3),
        algorithm: "nearest_neighbour",
      },
    };
  });

  // ── Quotes / estimates ────────────────────────────────────────

  registerLensAction("trades", "quotes-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const quotes = ensureTrBucket(s, "quotes", userId);
    return { ok: true, result: { quotes } };
  });

  registerLensAction("trades", "quotes-create", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerId = String(params.customerId || "");
    const title = String(params.title || "").trim();
    const lineItems = Array.isArray(params.lineItems) ? params.lineItems : [];
    if (!customerId || !title) return { ok: false, error: "customerId and title required" };
    if (lineItems.length === 0) return { ok: false, error: "at least one line item required" };
    const subtotal = lineItems.reduce((sum, l) => sum + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0);
    const taxRate = Math.max(0, Math.min(50, Number(params.taxRate) || 0));
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    const quote = {
      id: uidTr("quote"), customerId, title,
      description: String(params.description || ""),
      lineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      taxRate, tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
      status: "draft",
      validUntil: params.validUntil || null,
      createdAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "quotes", userId).push(quote);
    saveTradesState();
    return { ok: true, result: { quote } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("trades", "quotes-send", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const quote = ensureTrBucket(s, "quotes", userId).find(q => q.id === id);
    if (!quote) return { ok: false, error: "quote not found" };
    if (quote.status !== "draft") return { ok: false, error: `cannot send quote in status '${quote.status}'` };
    quote.status = "sent";
    quote.sentAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { quote } };
  });

  registerLensAction("trades", "quotes-accept", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const quote = ensureTrBucket(s, "quotes", userId).find(q => q.id === id);
    if (!quote) return { ok: false, error: "quote not found" };
    if (quote.status === "accepted" || quote.status === "rejected") return { ok: false, error: `quote already ${quote.status}` };
    quote.status = "accepted";
    quote.acceptedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { quote } };
  });

  registerLensAction("trades", "quotes-reject", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const quote = ensureTrBucket(s, "quotes", userId).find(q => q.id === id);
    if (!quote) return { ok: false, error: "quote not found" };
    quote.status = "rejected";
    quote.rejectedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { quote } };
  });

  // ── Online bookings (customer-facing intake) ──────────────────

  registerLensAction("trades", "bookings-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const bookings = ensureTrBucket(s, "bookings", userId);
    return { ok: true, result: { bookings: bookings.slice().reverse() } };
  });

  registerLensAction("trades", "bookings-create", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerName = String(params.customerName || "").trim();
    const customerEmail = String(params.customerEmail || "").trim();
    const serviceType = String(params.serviceType || "").trim();
    if (!customerName || !customerEmail || !serviceType) return { ok: false, error: "customerName, customerEmail, serviceType required" };
    const booking = {
      id: uidTr("book"), customerName, customerEmail, serviceType,
      customerPhone: String(params.customerPhone || ""),
      address: String(params.address || ""),
      preferredDate: params.preferredDate || null,
      preferredTime: String(params.preferredTime || "morning"),
      notes: String(params.notes || ""),
      status: "pending",
      createdAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "bookings", userId).push(booking);
    saveTradesState();
    return { ok: true, result: { booking } };
  });

  registerLensAction("trades", "bookings-confirm", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const booking = ensureTrBucket(s, "bookings", userId).find(b => b.id === id);
    if (!booking) return { ok: false, error: "booking not found" };
    booking.status = "confirmed";
    booking.confirmedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { booking } };
  });

  // ── Job photos ────────────────────────────────────────────────

  registerLensAction("trades", "job-photos-list", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const jobId = params.jobId ? String(params.jobId) : null;
    const all = ensureTrBucket(s, "jobPhotos", userId);
    const photos = jobId ? all.filter(p => p.jobId === jobId) : all;
    return { ok: true, result: { photos } };
  });

  registerLensAction("trades", "job-photos-add", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const jobId = String(params.jobId || "");
    const url = String(params.url || "").trim();
    if (!jobId || !url) return { ok: false, error: "jobId and url required" };
    const photo = {
      id: uidTr("photo"), jobId, url,
      caption: String(params.caption || ""),
      kind: ["before", "after", "issue", "general"].includes(params.kind) ? params.kind : "general",
      uploadedAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "jobPhotos", userId).push(photo);
    saveTradesState();
    return { ok: true, result: { photo } };
  });

  // ── Timesheets ────────────────────────────────────────────────

  registerLensAction("trades", "timesheets-list", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const techId = params.technicianId ? String(params.technicianId) : null;
    const all = ensureTrBucket(s, "timesheets", userId);
    const filtered = techId ? all.filter(t => t.technicianId === techId) : all;
    return { ok: true, result: { entries: filtered.slice().reverse() } };
  });

  registerLensAction("trades", "timesheets-clock-in", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const technicianId = String(params.technicianId || "");
    const jobId = params.jobId ? String(params.jobId) : null;
    if (!technicianId) return { ok: false, error: "technicianId required" };
    const entries = ensureTrBucket(s, "timesheets", userId);
    const open = entries.find(e => e.technicianId === technicianId && !e.clockOut);
    if (open) return { ok: false, error: "technician already clocked in" };
    const entry = {
      id: uidTr("ts"), technicianId, jobId,
      clockIn: nowIsoTrades(),
      clockOut: null,
      durationMin: null,
    };
    entries.push(entry);
    saveTradesState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("trades", "timesheets-clock-out", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const technicianId = String(params.technicianId || "");
    if (!technicianId) return { ok: false, error: "technicianId required" };
    const entries = ensureTrBucket(s, "timesheets", userId);
    const open = entries.find(e => e.technicianId === technicianId && !e.clockOut);
    if (!open) return { ok: false, error: "technician not clocked in" };
    open.clockOut = nowIsoTrades();
    open.durationMin = Math.round((new Date(open.clockOut).getTime() - new Date(open.clockIn).getTime()) / 60000);
    saveTradesState();
    return { ok: true, result: { entry: open } };
  });

  // ── Payments (Stripe-shape contract, no real Stripe call) ─────

  registerLensAction("trades", "payments-create-link", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const invoiceRef = String(params.invoiceRef || "").trim();
    const amount = Number(params.amount) || 0;
    if (!invoiceRef || amount <= 0) return { ok: false, error: "invoiceRef and amount required" };
    const payment = {
      id: uidTr("pay"), invoiceRef, amount,
      currency: "usd",
      status: "pending",
      hostedUrl: `/pay/${uidTr("pi")}`,
      createdAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "payments", userId).push(payment);
    saveTradesState();
    return { ok: true, result: { payment } };
  });

  registerLensAction("trades", "payments-mark-paid", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const pay = ensureTrBucket(s, "payments", userId).find(p => p.id === id);
    if (!pay) return { ok: false, error: "payment not found" };
    pay.status = "paid";
    pay.paidAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { payment: pay } };
  });

  registerLensAction("trades", "payments-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const payments = ensureTrBucket(s, "payments", userId);
    return { ok: true, result: { payments: payments.slice().reverse() } };
  });

  // ── Recurring service plans ───────────────────────────────────

  registerLensAction("trades", "recurring-plans-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const plans = ensureTrBucket(s, "recurringPlans", userId);
    return { ok: true, result: { plans } };
  });

  registerLensAction("trades", "recurring-plans-create", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerId = String(params.customerId || "");
    const serviceType = String(params.serviceType || "").trim();
    const cadence = ["weekly", "monthly", "quarterly", "annual"].includes(params.cadence) ? params.cadence : "monthly";
    const priceEach = Number(params.priceEach) || 0;
    if (!customerId || !serviceType || priceEach <= 0) return { ok: false, error: "customerId, serviceType, priceEach required" };
    const plan = {
      id: uidTr("rec"), customerId, serviceType, cadence, priceEach,
      status: "active",
      nextServiceDate: params.nextServiceDate || null,
      jobsCompleted: 0,
      totalRevenue: 0,
      createdAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "recurringPlans", userId).push(plan);
    saveTradesState();
    return { ok: true, result: { plan } };
  });

  registerLensAction("trades", "recurring-plans-cancel", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const plan = ensureTrBucket(s, "recurringPlans", userId).find(p => p.id === id);
    if (!plan) return { ok: false, error: "plan not found" };
    plan.status = "cancelled";
    plan.cancelledAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { plan } };
  });

  // ── Reviews / NPS ─────────────────────────────────────────────

  registerLensAction("trades", "reviews-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const reviews = ensureTrBucket(s, "reviews", userId);
    const ratings = reviews.map(r => r.rating).filter(n => typeof n === "number");
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : 0;
    // NPS: promoters (9-10) - detractors (0-6)
    const promoters = reviews.filter(r => r.nps >= 9).length;
    const detractors = reviews.filter(r => r.nps != null && r.nps <= 6).length;
    const totalNps = reviews.filter(r => r.nps != null).length;
    const nps = totalNps > 0 ? Math.round(((promoters - detractors) / totalNps) * 100) : 0;
    return { ok: true, result: { reviews: reviews.slice().reverse(), avgRating, nps, totalReviews: reviews.length } };
  });

  registerLensAction("trades", "reviews-submit", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const jobId = String(params.jobId || "");
    const rating = Math.max(0, Math.min(5, Number(params.rating) || 0));
    const nps = params.nps != null ? Math.max(0, Math.min(10, Number(params.nps))) : null;
    const text = String(params.text || "").trim();
    if (!jobId || rating === 0) return { ok: false, error: "jobId and rating (1-5) required" };
    const review = {
      id: uidTr("rev"), jobId, rating, nps, text,
      customerName: String(params.customerName || "anonymous"),
      submittedAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "reviews", userId).push(review);
    saveTradesState();
    return { ok: true, result: { review } };
  });

  // ── Dashboard summary (DispatchShell data source) ─────────────

  registerLensAction("trades", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const technicians = ensureTrBucket(s, "technicians", userId);
    const jobsMap = s.jobs?.get(userId);
    const allJobs = jobsMap ? Array.from(jobsMap.values()) : [];
    const customers = s.customers?.get(userId);
    const customerCount = customers ? customers.size : 0;
    const today = new Date().toISOString().slice(0, 10);
    const todayJobs = allJobs.filter(j => String(j.scheduledFor || j.scheduledDate || j.scheduledAt || "").slice(0, 10) === today);
    const completedJobs = allJobs.filter(j => j.status === "completed");
    const quotes = ensureTrBucket(s, "quotes", userId);
    const acceptedQuotes = quotes.filter(q => q.status === "accepted");
    const payments = ensureTrBucket(s, "payments", userId);
    const revenue = payments.filter(p => p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
    const reviews = ensureTrBucket(s, "reviews", userId);
    const ratings = reviews.map(r => r.rating).filter(n => typeof n === "number");
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : 0;
    const techsAvailable = technicians.filter(t => t.status === "available").length;
    const techsOnJob = technicians.filter(t => t.status === "on_site" || t.status === "on_route").length;
    return {
      ok: true,
      result: {
        jobsToday: todayJobs.length,
        jobsCompleted: completedJobs.length,
        totalJobs: allJobs.length,
        techsTotal: technicians.length,
        techsAvailable,
        techsOnJob,
        customerCount,
        quotesPending: quotes.filter(q => q.status === "sent").length,
        quotesAccepted: acceptedQuotes.length,
        totalRevenue: Math.round(revenue * 100) / 100,
        avgRating,
        reviewCount: reviews.length,
        bookingsPending: ensureTrBucket(s, "bookings", userId).filter(b => b.status === "pending").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Backlog: scheduling calendar / payments / portal / recurring /
  //     GPS tracking / reminders / pricebook / reporting ──────────────

  // ── [M] Scheduling calendar — assign jobs to date+slot, reschedule ──

  registerLensAction("trades", "schedule-set", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const jobId = String(params.jobId || "");
    const job = s.jobs.get(userId)?.get(jobId);
    if (!job) return { ok: false, error: "job not found" };
    const date = String(params.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "date must be YYYY-MM-DD" };
    const slot = Number(params.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 23) return { ok: false, error: "slot must be hour 0-23" };
    job.scheduledFor = `${date}T${String(slot).padStart(2, "0")}:00`;
    job.scheduledSlot = slot;
    if (params.tech != null) job.assignedTech = String(params.tech) || null;
    job.updatedAt = nowIsoTrades();
    saveTradesState();
    return { ok: true, result: { job } };
  });

  registerLensAction("trades", "schedule-week", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const startStr = String(params.weekStart || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return { ok: false, error: "weekStart must be YYYY-MM-DD" };
    const jobsMap = s.jobs?.get(userId);
    const allJobs = jobsMap ? Array.from(jobsMap.values()) : [];
    const start = new Date(`${startStr}T00:00:00`);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const dayJobs = allJobs
        .filter(j => String(j.scheduledFor || "").slice(0, 10) === key)
        .map(j => ({
          id: j.id, number: j.number, customerName: j.customerName,
          description: j.description, priority: j.priority, status: j.status,
          slot: j.scheduledSlot != null ? j.scheduledSlot : (j.scheduledFor ? new Date(j.scheduledFor).getHours() : null),
          assignedTech: j.assignedTech || null,
        }))
        .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      days.push({ date: key, weekday: d.toLocaleDateString("en-US", { weekday: "short" }), jobs: dayJobs });
    }
    const unscheduled = allJobs
      .filter(j => !j.scheduledFor && j.status !== "completed" && j.status !== "cancelled" && j.status !== "invoiced")
      .map(j => ({ id: j.id, number: j.number, customerName: j.customerName, description: j.description, priority: j.priority }));
    return { ok: true, result: { weekStart: startStr, days, unscheduled, totalScheduled: days.reduce((n, d) => n + d.jobs.length, 0) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Payment processing — invoices with payment status tracking ──

  registerLensAction("trades", "invoices-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const invoices = ensureTrBucket(s, "invoices", userId);
    const now = Date.now();
    const enriched = invoices.map(inv => {
      const overdue = inv.status !== "paid" && inv.dueDate && new Date(inv.dueDate).getTime() < now;
      return { ...inv, overdue: !!overdue };
    });
    const outstanding = enriched.filter(i => i.status !== "paid").reduce((n, i) => n + i.total, 0);
    const collected = enriched.filter(i => i.status === "paid").reduce((n, i) => n + i.total, 0);
    return {
      ok: true,
      result: {
        invoices: enriched.slice().reverse(),
        outstanding: Math.round(outstanding * 100) / 100,
        collected: Math.round(collected * 100) / 100,
        overdueCount: enriched.filter(i => i.overdue).length,
      },
    };
  });

  registerLensAction("trades", "invoices-create", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerName = String(params.customerName || "").trim();
    const lineItems = Array.isArray(params.lineItems) ? params.lineItems : [];
    if (!customerName) return { ok: false, error: "customerName required" };
    if (lineItems.length === 0) return { ok: false, error: "at least one line item required" };
    const subtotal = lineItems.reduce((n, l) => n + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0);
    const taxRate = Math.max(0, Math.min(50, Number(params.taxRate) || 0));
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    if (!s.seq.has(userId)) s.seq.set(userId, { job: 1, invoice: 1 });
    const seq = s.seq.get(userId);
    const invoice = {
      id: uidTr("inv"),
      number: `INV-${String(seq.invoice).padStart(5, "0")}`,
      customerName, jobId: params.jobId ? String(params.jobId) : null,
      lineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      taxRate, tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
      amountPaid: 0,
      status: "unpaid",
      dueDate: params.dueDate || null,
      method: null,
      createdAt: nowIsoTrades(),
    };
    seq.invoice++;
    ensureTrBucket(s, "invoices", userId).push(invoice);
    saveTradesState();
    return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("trades", "invoices-record-payment", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const inv = ensureTrBucket(s, "invoices", userId).find(i => i.id === id);
    if (!inv) return { ok: false, error: "invoice not found" };
    if (inv.status === "paid") return { ok: false, error: "invoice already paid" };
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const method = ["card", "ach", "cash", "check"].includes(params.method) ? params.method : "card";
    inv.amountPaid = Math.round((inv.amountPaid + amount) * 100) / 100;
    inv.method = method;
    inv.status = inv.amountPaid >= inv.total ? "paid" : "partial";
    if (inv.status === "paid") inv.paidAt = nowIsoTrades();
    inv.payments = inv.payments || [];
    inv.payments.push({ amount: Math.round(amount * 100) / 100, method, at: nowIsoTrades() });
    saveTradesState();
    return { ok: true, result: { invoice: inv } };
  });

  // ── [M] Customer portal — read-only customer-facing bundle ──────────

  registerLensAction("trades", "portal-view", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const customerId = String(params.customerId || "");
    if (!customerId) return { ok: false, error: "customerId required" };
    const customer = s.customers.get(userId)?.get(customerId);
    if (!customer) return { ok: false, error: "customer not found" };
    const jobsMap = s.jobs?.get(userId);
    const jobs = (jobsMap ? Array.from(jobsMap.values()) : [])
      .filter(j => j.customerId === customerId)
      .map(j => ({ number: j.number, description: j.description, status: j.status, scheduledFor: j.scheduledFor, assignedTech: j.assignedTech }));
    const quotes = ensureTrBucket(s, "quotes", userId)
      .filter(q => q.customerId === customerId)
      .map(q => ({ id: q.id, title: q.title, total: q.total, status: q.status, validUntil: q.validUntil }));
    const invoices = ensureTrBucket(s, "invoices", userId)
      .filter(i => !customer.name || i.customerName === customer.name)
      .map(i => ({ id: i.id, number: i.number, total: i.total, amountPaid: i.amountPaid, status: i.status, dueDate: i.dueDate }));
    const balanceDue = invoices.filter(i => i.status !== "paid").reduce((n, i) => n + (i.total - i.amountPaid), 0);
    return {
      ok: true,
      result: {
        customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, address: customer.address },
        jobs, quotes, invoices,
        balanceDue: Math.round(balanceDue * 100) / 100,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("trades", "portal-quote-respond", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const decision = params.decision === "accept" ? "accept" : params.decision === "reject" ? "reject" : null;
    if (!decision) return { ok: false, error: "decision must be accept or reject" };
    const quote = ensureTrBucket(s, "quotes", userId).find(q => q.id === id);
    if (!quote) return { ok: false, error: "quote not found" };
    if (quote.status === "accepted" || quote.status === "rejected") return { ok: false, error: `quote already ${quote.status}` };
    quote.status = decision === "accept" ? "accepted" : "rejected";
    quote[decision === "accept" ? "acceptedAt" : "rejectedAt"] = nowIsoTrades();
    quote.respondedVia = "portal";
    saveTradesState();
    return { ok: true, result: { quote } };
  });

  // ── [S] Recurring jobs — auto-generate the next due visit ───────────

  registerLensAction("trades", "recurring-generate-visit", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const plan = ensureTrBucket(s, "recurringPlans", userId).find(p => p.id === id);
    if (!plan) return { ok: false, error: "plan not found" };
    if (plan.status !== "active") return { ok: false, error: "plan is not active" };
    const customer = s.customers.get(userId)?.get(plan.customerId);
    const base = plan.nextServiceDate ? new Date(`${String(plan.nextServiceDate).slice(0, 10)}T09:00:00`) : new Date();
    const visitDate = base.toISOString().slice(0, 10);
    if (!s.seq.has(userId)) s.seq.set(userId, { job: 1, invoice: 1 });
    const seq = s.seq.get(userId);
    const job = {
      id: nextTradesId("job"),
      number: `JOB-${String(seq.job).padStart(5, "0")}`,
      customerId: plan.customerId,
      customerName: customer ? customer.name : "Recurring customer",
      description: `${plan.serviceType} — recurring ${plan.cadence} visit`,
      priority: "normal",
      status: "unassigned",
      scheduledFor: `${visitDate}T09:00`,
      scheduledSlot: 9,
      assignedTech: null,
      estimatedHours: 0,
      recurringPlanId: plan.id,
      notes: "",
      createdAt: nowIsoTrades(),
      updatedAt: nowIsoTrades(),
    };
    seq.job++;
    if (!s.jobs.has(userId)) s.jobs.set(userId, new Map());
    s.jobs.get(userId).set(job.id, job);
    // advance the plan's next service date by its cadence
    const stepDays = { weekly: 7, monthly: 30, quarterly: 91, annual: 365 }[plan.cadence] || 30;
    const next = new Date(base.getTime() + stepDays * 86400000);
    plan.nextServiceDate = next.toISOString().slice(0, 10);
    plan.jobsCompleted = (plan.jobsCompleted || 0) + 1;
    plan.totalRevenue = Math.round(((plan.totalRevenue || 0) + plan.priceEach) * 100) / 100;
    saveTradesState();
    return { ok: true, result: { job, plan } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] GPS technician tracking + live job-status from the field ────

  registerLensAction("trades", "technician-update-location", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const tech = ensureTrBucket(s, "technicians", userId).find(t => t.id === id);
    if (!tech) return { ok: false, error: "technician not found" };
    const lat = Number(params.lat), lng = Number(params.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: "lat must be -90..90" };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: "lng must be -180..180" };
    tech.lat = lat;
    tech.lng = lng;
    tech.locationUpdatedAt = nowIsoTrades();
    if (params.activeJobId !== undefined) tech.activeJobId = params.activeJobId ? String(params.activeJobId) : null;
    saveTradesState();
    return { ok: true, result: { technician: tech } };
  });

  registerLensAction("trades", "field-status-update", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const jobId = String(params.jobId || "");
    const job = s.jobs.get(userId)?.get(jobId);
    if (!job) return { ok: false, error: "job not found" };
    const status = String(params.status || "");
    if (!["en-route", "on-site", "completed"].includes(status)) {
      return { ok: false, error: "field status must be en-route, on-site or completed" };
    }
    job.status = status;
    if (status === "completed") job.completedAt = nowIsoTrades();
    job.updatedAt = nowIsoTrades();
    const note = String(params.note || "").trim().slice(0, 300);
    job.fieldLog = job.fieldLog || [];
    job.fieldLog.push({ status, note, at: nowIsoTrades(), lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null, lng: Number.isFinite(Number(params.lng)) ? Number(params.lng) : null });
    saveTradesState();
    return { ok: true, result: { job } };
  });

  registerLensAction("trades", "technicians-live-map", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const techs = ensureTrBucket(s, "technicians", userId)
      .filter(t => Number.isFinite(t.lat) && Number.isFinite(t.lng))
      .map(t => ({ id: t.id, name: t.name, lat: t.lat, lng: t.lng, status: t.status, activeJobId: t.activeJobId || null, locationUpdatedAt: t.locationUpdatedAt || null }));
    return { ok: true, result: { technicians: techs, count: techs.length } };
  });

  // ── [S] SMS / email reminders + on-the-way notifications ────────────

  registerLensAction("trades", "notifications-list", (ctx, _a, _p = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const notifications = ensureTrBucket(s, "notifications", userId);
    return { ok: true, result: { notifications: notifications.slice().reverse(), count: notifications.length } };
  });

  registerLensAction("trades", "notifications-send", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const channel = ["sms", "email"].includes(params.channel) ? params.channel : null;
    if (!channel) return { ok: false, error: "channel must be sms or email" };
    const kind = ["reminder", "on_the_way", "follow_up", "confirmation"].includes(params.kind) ? params.kind : "reminder";
    const recipient = String(params.recipient || "").trim();
    if (!recipient) return { ok: false, error: "recipient required" };
    const message = String(params.message || "").trim();
    if (!message) return { ok: false, error: "message required" };
    const notification = {
      id: uidTr("notif"), channel, kind, recipient,
      message: message.slice(0, 500),
      jobId: params.jobId ? String(params.jobId) : null,
      status: "queued",
      createdAt: nowIsoTrades(),
    };
    ensureTrBucket(s, "notifications", userId).push(notification);
    saveTradesState();
    return { ok: true, result: { notification } };
  });

  // ── [M] Pricebook — reusable priced services/materials catalog ──────

  registerLensAction("trades", "pricebook-list", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const kind = ["service", "material"].includes(params.kind) ? params.kind : null;
    let items = ensureTrBucket(s, "pricebook", userId);
    if (kind) items = items.filter(i => i.kind === kind);
    const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { items: sorted, count: sorted.length } };
  });

  registerLensAction("trades", "pricebook-upsert", (ctx, _a, params = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const kind = ["service", "material"].includes(params.kind) ? params.kind : "service";
    const price = Number(params.price);
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: "price must be >= 0" };
    const list = ensureTrBucket(s, "pricebook", userId);
    const id = params.id ? String(params.id) : uidTr("pb");
    const existing = list.find(i => i.id === id);
    const entry = {
      id, name, kind, price: Math.round(price * 100) / 100,
      unit: String(params.unit || existing?.unit || "ea").slice(0, 16),
      category: String(params.category || existing?.category || "general").slice(0, 40),
      cost: Number.isFinite(Number(params.cost)) ? Math.round(Number(params.cost) * 100) / 100 : (existing?.cost ?? 0),
      updatedAt: nowIsoTrades(),
    };
    entry.marginPct = entry.price > 0 ? Math.round(((entry.price - entry.cost) / entry.price) * 1000) / 10 : 0;
    if (existing) Object.assign(existing, entry);
    else { entry.createdAt = nowIsoTrades(); list.push(entry); }
    saveTradesState();
    return { ok: true, result: { item: existing || entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("trades", "pricebook-delete", (ctx, _a, params = {}) => {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const id = String(params.id || "");
    const list = ensureTrBucket(s, "pricebook", userId);
    const idx = list.findIndex(i => i.id === id);
    if (idx < 0) return { ok: false, error: "pricebook item not found" };
    list.splice(idx, 1);
    saveTradesState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── [S] Reporting dashboard — revenue / close rate / utilization ────

  registerLensAction("trades", "report-overview", (ctx, _a, _p = {}) => {
  try {
    const s = getTradesState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tradesActor(ctx);
    const jobsMap = s.jobs?.get(userId);
    const jobs = jobsMap ? Array.from(jobsMap.values()) : [];
    const quotes = ensureTrBucket(s, "quotes", userId);
    const invoices = ensureTrBucket(s, "invoices", userId);
    const payments = ensureTrBucket(s, "payments", userId);
    const technicians = ensureTrBucket(s, "technicians", userId);
    const timesheets = ensureTrBucket(s, "timesheets", userId);
    const reviews = ensureTrBucket(s, "reviews", userId);

    // Revenue — paid invoices + paid payment links
    const invoiceRevenue = invoices.filter(i => i.status === "paid").reduce((n, i) => n + i.total, 0)
      + invoices.filter(i => i.status === "partial").reduce((n, i) => n + i.amountPaid, 0);
    const linkRevenue = payments.filter(p => p.status === "paid").reduce((n, p) => n + p.amount, 0);
    const totalRevenue = Math.round((invoiceRevenue + linkRevenue) * 100) / 100;
    const outstanding = Math.round(invoices.filter(i => i.status !== "paid").reduce((n, i) => n + (i.total - i.amountPaid), 0) * 100) / 100;

    // Close rate — accepted quotes / quotes that received a decision
    const decided = quotes.filter(q => q.status === "accepted" || q.status === "rejected").length;
    const accepted = quotes.filter(q => q.status === "accepted").length;
    const closeRate = decided > 0 ? Math.round((accepted / decided) * 1000) / 10 : 0;

    // Tech utilization — clocked hours vs an 8h/day baseline per active tech
    const totalClockedMin = timesheets.filter(t => t.durationMin != null).reduce((n, t) => n + t.durationMin, 0);
    const totalClockedHours = Math.round((totalClockedMin / 60) * 10) / 10;
    const baselineHours = Math.max(1, technicians.length) * 8;
    const utilization = Math.min(100, Math.round((totalClockedHours / baselineHours) * 1000) / 10);

    // Job pipeline
    const byStatus = {};
    for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    const completed = jobs.filter(j => j.status === "completed" || j.status === "invoiced").length;
    const jobCompletionRate = jobs.length > 0 ? Math.round((completed / jobs.length) * 1000) / 10 : 0;

    // Average ticket — revenue per completed job
    const avgTicket = completed > 0 ? Math.round((totalRevenue / completed) * 100) / 100 : 0;

    const ratings = reviews.map(r => r.rating).filter(n => typeof n === "number");
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;

    return {
      ok: true,
      result: {
        generatedAt: nowIsoTrades(),
        revenue: { total: totalRevenue, outstanding, avgTicket, fromInvoices: Math.round(invoiceRevenue * 100) / 100, fromLinks: Math.round(linkRevenue * 100) / 100 },
        sales: { quotesTotal: quotes.length, quotesAccepted: accepted, quotesDecided: decided, closeRate },
        jobs: { total: jobs.length, completed, completionRate: jobCompletionRate, byStatus },
        labor: { technicians: technicians.length, clockedHours: totalClockedHours, baselineHours, utilization },
        satisfaction: { reviewCount: reviews.length, avgRating },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};
