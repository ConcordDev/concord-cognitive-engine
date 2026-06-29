// server/domains/hvac.js
export default function registerHVACActions(registerLensAction) {
  // Fail-CLOSED numeric coercion: Number(v) rejects "12abc"/"Infinity"/"NaN"
  // (unlike parseFloat, which would accept the prefix or yield Infinity). A
  // non-finite or non-positive value falls to the default so no NaN/Infinity
  // ever leaks into a rendered number.
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const intNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
  // Fail-CLOSED guard: a field PRESENT but non-finite (Infinity/NaN/1e999) must
  // reject rather than silently coerce to a default — otherwise a poisoned input
  // is laundered into a confident, wrong sizing/audit result.
  const hvBad = (v) => v !== undefined && v !== null && v !== "" && !Number.isFinite(Number(v));

  registerLensAction("hvac", "loadCalculation", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    if (hvBad(data.squareFootage)) return { ok: false, error: "invalid_squareFootage" };
    if (hvBad(data.stories)) return { ok: false, error: "invalid_stories" };
    const sqft = num(data.squareFootage, 1000);
    const stories = intNum(data.stories, 1);
    const insulation = String(data.insulation || "average").toLowerCase();
    const climate = String(data.climate || "temperate").toLowerCase();
    const baseBTU = sqft * 25;
    const insMultiplier = insulation === "excellent" ? 0.8 : insulation === "good" ? 0.9 : insulation === "average" ? 1.0 : 1.2;
    // Accept both the bare keywords AND the component's region enum values
    // (hot-humid / hot-dry / temperate / cold / very-cold).
    const isHot = climate.includes("hot");
    const isCold = climate.includes("cold");
    const isHumid = climate.includes("humid");
    const climateMultiplier = climate.includes("very-cold") ? 1.35 : isHumid ? 1.25 : isHot ? 1.3 : isCold ? 1.2 : 1.0;
    const storyMultiplier = stories > 1 ? 1 + (stories - 1) * 0.1 : 1;
    const totalBTU = Math.round(baseBTU * insMultiplier * climateMultiplier * storyMultiplier);
    // Cooling load is the design driver here; heating runs ~15% lighter for a
    // comparably-insulated envelope in the same climate band.
    const coolingBTU = totalBTU;
    const heatingBTU = Math.round(totalBTU * (isCold ? 1.1 : 0.85));
    const tons = Math.round(coolingBTU / 12000 * 10) / 10;
    const equipmentSize = `${Math.ceil(tons * 2) / 2} ton system`;
    return { ok: true, result: {
      squareFootage: sqft,
      heatingBTU,
      coolingBTU,
      requiredBTU: totalBTU,
      tonnage: tons,
      tonnageRecommended: `${tons} ton`,
      unitSize: equipmentSize,
      equipmentSize,
      insulation,
      climate,
      estimatedCost: Math.round(tons * 3500),
      energyEstimate: `${Math.round(totalBTU / 3412 * 8)} kWh/day at peak`,
      seerRecommendation: isHot ? "SEER 16+" : "SEER 14+",
      recommendation: isHot
        ? "Hot climate — prioritise SEER 16+ and verify duct sealing to hold the cooling load."
        : isCold
          ? "Cold climate — size for the heating load and consider a cold-climate heat pump or dual-fuel."
          : "Temperate climate — a properly-sealed SEER 14+ system meets this load.",
    } };
  });
  registerLensAction("hvac", "energyAudit", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    if (hvBad(data.monthlyBill)) return { ok: false, error: "invalid_monthlyBill" };
    if (hvBad(data.squareFootage)) return { ok: false, error: "invalid_squareFootage" };
    if (hvBad(data.systemAge)) return { ok: false, error: "invalid_systemAge" };
    const monthlyBill = num(data.monthlyBill, 0);
    const sqft = num(data.squareFootage, 1000);
    const systemAge = intNum(data.systemAge, 0);
    const costPerSqFt = sqft > 0 ? Math.round((monthlyBill * 12 / sqft) * 100) / 100 : 0;
    const efficiencyLoss = Math.min(50, systemAge * 2);
    const potentialSavings = Math.round(monthlyBill * efficiencyLoss / 100);
    const issues = [];
    if (systemAge > 15) issues.push("System past expected lifespan — consider replacement");
    if (costPerSqFt > 3) issues.push("Energy cost per sqft is above average");
    if (systemAge > 10) issues.push("Refrigerant may need checking");
    if (issues.length === 0) issues.push("No major efficiency red flags detected");
    const grade = costPerSqFt < 1.5 ? "A" : costPerSqFt < 2.5 ? "B" : costPerSqFt < 3.5 ? "C" : "D";
    const annualCost = Math.round(monthlyBill * 12 * 100) / 100;
    const estimatedAnnualSavings = potentialSavings * 12;
    // ROI score: higher when there's more recoverable spend (efficiency loss)
    // against the current bill — 0–100, simple bounded heuristic.
    const roiScore = Math.min(100, Math.round(efficiencyLoss * 2));
    return { ok: true, result: {
      monthlyBill,
      annualCost,
      costPerSqFt,
      systemAge,
      efficiencyLoss: `${efficiencyLoss}%`,
      systemEfficiency: `${Math.max(0, 100 - efficiencyLoss)}% of rated`,
      expectedLifespan: systemAge >= 15 ? "Past typical 15–20 yr lifespan" : `~${Math.max(0, 18 - systemAge)} yr remaining`,
      potentialMonthlySavings: potentialSavings,
      potentialAnnualSavings: estimatedAnnualSavings,
      estimatedAnnualSavings,
      savingsOpportunities: issues,
      roiScore,
      issues,
      grade,
      recommendation: grade === "A" || grade === "B"
        ? "System is operating efficiently — keep up routine maintenance."
        : "Above-average cost per sqft — schedule a tune-up and check insulation/ductwork for recoverable savings.",
    } };
  });
  registerLensAction("hvac", "maintenanceSchedule", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const systemType = (data.systemType || "central-ac").toLowerCase();
    const lastService = data.lastServiceDate ? new Date(data.lastServiceDate) : null;
    const tasks = [
      { task: "Replace air filter", frequency: "Every 1-3 months", priority: "high", diy: true },
      { task: "Clean outdoor condenser coils", frequency: "Annually (spring)", priority: "medium", diy: true },
      { task: "Check refrigerant levels", frequency: "Annually", priority: "high", diy: false },
      { task: "Inspect ductwork for leaks", frequency: "Every 2 years", priority: "medium", diy: false },
      { task: "Lubricate motor bearings", frequency: "Annually", priority: "medium", diy: false },
      { task: "Test thermostat calibration", frequency: "Annually", priority: "low", diy: true },
      { task: "Flush drain line", frequency: "Every 6 months", priority: "medium", diy: true },
      { task: "Check electrical connections", frequency: "Annually", priority: "high", diy: false },
    ];
    const validDate = lastService && !Number.isNaN(lastService.getTime()) ? lastService : null;
    const daysSinceService = validDate ? Math.round((Date.now() - validDate.getTime()) / 86400000) : 999;
    const lastServiceDate = validDate ? validDate.toISOString().split("T")[0] : null;
    // An overdue task is one whose cadence has lapsed since the last service.
    // With no known service date we treat every annual-or-more-frequent task as
    // due. Filter cadence → days then compare against daysSinceService.
    const cadenceDays = (f) => /1-3 month/i.test(f) ? 90 : /6 month/i.test(f) ? 182 : /2 year/i.test(f) ? 730 : 365;
    const enrichedTasks = tasks.map((t) => {
      const due = cadenceDays(t.frequency);
      const overdue = daysSinceService >= due;
      const nextDate = validDate ? new Date(validDate.getTime() + due * 86400000) : null;
      return { ...t, overdue, nextDue: nextDate ? nextDate.toISOString().split("T")[0] : "due now" };
    });
    const overdueCount = enrichedTasks.filter((t) => t.overdue).length;
    return { ok: true, result: {
      systemType,
      lastService: lastServiceDate || "unknown",
      lastServiceDate,
      daysSinceService,
      overdue: daysSinceService > 365,
      overdueCount,
      tasks: enrichedTasks,
      diyTasks: enrichedTasks.filter(t => t.diy).length,
      proTasks: enrichedTasks.filter(t => !t.diy).length,
      nextServiceDue: daysSinceService > 180 ? "Schedule service soon" : "On track",
      recommendation: overdueCount > 0
        ? `${overdueCount} task${overdueCount === 1 ? "" : "s"} overdue — schedule a ${systemType} service visit.`
        : "On schedule — keep replacing the air filter every 1–3 months.",
    } };
  });
  registerLensAction("hvac", "zoneBalance", (ctx, artifact, _params) => {
    const zones = Array.isArray(artifact.data?.zones) ? artifact.data.zones : [];
    if (zones.length === 0) return { ok: true, result: { zones: [], maxDeviation: 0, avgDeviation: 0, balanced: true, verdict: "no zones", balanceScore: 100, recommendation: "Add zones with current + target temperatures to check balance.", message: "Add zones with temperatures to check balance." } };
    const temps = zones.map(z => {
      const cur = num(z.currentTemp, 72);
      const tgt = num(z.targetTemp, 72);
      return { zone: String(z.name || z.room || "zone"), current: cur, target: tgt, deviation: Math.round(Math.abs(cur - tgt) * 10) / 10 };
    });
    const maxDeviation = Math.max(...temps.map(t => t.deviation));
    const avgDeviation = Math.round(temps.reduce((s, t) => s + t.deviation, 0) / temps.length * 10) / 10;
    const balanced = maxDeviation < 3;
    const verdict = maxDeviation < 3 ? "balanced" : maxDeviation <= 5 ? "minor imbalance" : "imbalanced";
    // 100 = perfect; each °F of worst-case deviation costs 10 points, floored at 0.
    const balanceScore = Math.max(0, Math.round(100 - maxDeviation * 10));
    const recommendations = maxDeviation > 5 ? ["Check damper settings", "Inspect ductwork for blockages", "Consider zone control system"] : maxDeviation > 2 ? ["Adjust dampers", "Check vents are open"] : ["System is well-balanced"];
    return { ok: true, result: {
      zones: temps,
      maxDeviation,
      avgDeviation,
      balanced,
      verdict,
      balanceScore,
      worstZone: temps.slice().sort((a, b) => b.deviation - a.deviation)[0]?.zone,
      recommendations,
      recommendation: recommendations[0],
    } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // ServiceTitan / Housecall Pro parity — field-service management.
  // Per-user persistent state under globalThis._concordSTATE.hvacLens:
  // technicians, appointments, bookings, assets, payments, agreements,
  // fieldVisits.
  // ─────────────────────────────────────────────────────────────────────
  function getHvacState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.hvacLens) STATE.hvacLens = {};
    const s = STATE.hvacLens;
    for (const k of ["technicians", "appointments", "bookings", "assets", "payments", "agreements", "fieldVisits"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveHvacState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const hvId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const hvNow = () => new Date().toISOString();
  const hvAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const hvList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const hvNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const hvClean = (v, max = 240) => String(v == null ? "" : v).trim().slice(0, max);
  const hvFind = (map, userId, id) => (map.get(userId) || []).find((x) => x.id === id) || null;

  // ── Dispatch board — technicians ────────────────────────────────────
  registerLensAction("hvac", "tech-add", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hvClean(params.name, 80);
    if (!name) return { ok: false, error: "technician name required" };
    const tech = {
      id: hvId("tech"), name,
      skills: Array.isArray(params.skills) ? params.skills.map((x) => hvClean(x, 40)).filter(Boolean) : [],
      phone: hvClean(params.phone, 40),
      color: hvClean(params.color, 20) || "#38bdf8",
      active: params.active !== false,
      createdAt: hvNow(),
    };
    hvList(s.technicians, hvAid(ctx)).push(tech);
    saveHvacState();
    return { ok: true, result: { technician: tech } };
  });
  registerLensAction("hvac", "tech-list", (ctx, _a, _params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const appts = s.appointments.get(userId) || [];
    const techs = (s.technicians.get(userId) || []).map((t) => ({
      ...t,
      assignedCount: appts.filter((ap) => ap.technicianId === t.id && ap.status !== "completed" && ap.status !== "cancelled").length,
    }));
    return { ok: true, result: { technicians: techs, count: techs.length } };
  });
  registerLensAction("hvac", "tech-delete", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const list = s.technicians.get(userId) || [];
    const idx = list.findIndex((t) => t.id === params.id);
    if (idx < 0) return { ok: false, error: "technician not found" };
    list.splice(idx, 1);
    saveHvacState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Dispatch board — appointments (drag-assign scheduling) ──────────
  registerLensAction("hvac", "appointment-create", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hvClean(params.title, 120);
    if (!title) return { ok: false, error: "appointment title required" };
    const appt = {
      id: hvId("appt"), title,
      client: hvClean(params.client, 120),
      address: hvClean(params.address, 200),
      jobType: hvClean(params.jobType, 60) || "service",
      technicianId: params.technicianId ? hvClean(params.technicianId, 60) : null,
      date: hvClean(params.date, 10),
      slot: hvClean(params.slot, 20) || "morning",
      durationHrs: Math.max(0.5, hvNum(params.durationHrs, 2)),
      status: "scheduled",
      priority: ["low", "normal", "high", "emergency"].includes(params.priority) ? params.priority : "normal",
      notes: hvClean(params.notes, 600),
      createdAt: hvNow(),
    };
    hvList(s.appointments, hvAid(ctx)).push(appt);
    saveHvacState();
    return { ok: true, result: { appointment: appt } };
  });
  registerLensAction("hvac", "appointment-assign", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const appt = hvFind(s.appointments, userId, params.id);
    if (!appt) return { ok: false, error: "appointment not found" };
    if (params.technicianId != null) {
      const techId = hvClean(params.technicianId, 60) || null;
      if (techId && !hvFind(s.technicians, userId, techId)) return { ok: false, error: "technician not found" };
      appt.technicianId = techId;
    }
    if (params.slot != null) appt.slot = hvClean(params.slot, 20);
    if (params.date != null) appt.date = hvClean(params.date, 10);
    appt.updatedAt = hvNow();
    saveHvacState();
    return { ok: true, result: { appointment: appt } };
  });
  registerLensAction("hvac", "appointment-status", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const appt = hvFind(s.appointments, hvAid(ctx), params.id);
    if (!appt) return { ok: false, error: "appointment not found" };
    const valid = ["scheduled", "dispatched", "in_progress", "completed", "cancelled"];
    if (!valid.includes(params.status)) return { ok: false, error: "invalid status" };
    appt.status = params.status;
    appt.updatedAt = hvNow();
    saveHvacState();
    return { ok: true, result: { appointment: appt } };
  });
  registerLensAction("hvac", "appointment-delete", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.appointments.get(hvAid(ctx)) || [];
    const idx = list.findIndex((a) => a.id === params.id);
    if (idx < 0) return { ok: false, error: "appointment not found" };
    list.splice(idx, 1);
    saveHvacState();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("hvac", "dispatch-board", (ctx, _a, params = {}) => {
  try {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const date = hvClean(params.date, 10);
    const techs = s.technicians.get(userId) || [];
    let appts = s.appointments.get(userId) || [];
    if (date) appts = appts.filter((a) => a.date === date);
    // The unassigned queue is the dispatcher's triage list of work that still
    // needs a technician — terminal statuses (cancelled/completed) are done and
    // must not linger here. (Previously only "cancelled" was excluded, so a
    // completed-but-never-assigned appointment stuck in the queue forever.)
    const unassigned = appts.filter((a) => !a.technicianId && a.status !== "cancelled" && a.status !== "completed");
    const lanes = techs.map((t) => ({
      technician: { id: t.id, name: t.name, color: t.color },
      appointments: appts.filter((a) => a.technicianId === t.id && a.status !== "cancelled"),
    }));
    const totalHrs = appts.filter((a) => a.status !== "cancelled").reduce((sum, a) => sum + a.durationHrs, 0);
    return { ok: true, result: {
      date: date || "all",
      lanes, unassigned,
      stats: {
        appointments: appts.length,
        assigned: appts.filter((a) => a.technicianId).length,
        unassigned: unassigned.length,
        technicians: techs.length,
        scheduledHours: Math.round(totalHrs * 10) / 10,
      },
    } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Customer-facing booking + confirmation ──────────────────────────
  registerLensAction("hvac", "booking-request", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const customer = hvClean(params.customer, 120);
    const phone = hvClean(params.phone, 40);
    if (!customer) return { ok: false, error: "customer name required" };
    if (!phone && !hvClean(params.email, 120)) return { ok: false, error: "phone or email required" };
    const confirmation = "HVAC-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const booking = {
      id: hvId("book"), customer, phone,
      email: hvClean(params.email, 120),
      address: hvClean(params.address, 200),
      serviceType: hvClean(params.serviceType, 80) || "diagnostic",
      preferredDate: hvClean(params.preferredDate, 10),
      preferredSlot: hvClean(params.preferredSlot, 20) || "morning",
      issue: hvClean(params.issue, 600),
      status: "requested",
      confirmation,
      appointmentId: null,
      createdAt: hvNow(),
    };
    hvList(s.bookings, hvAid(ctx)).push(booking);
    saveHvacState();
    return { ok: true, result: { booking, message: `Booking received. Confirmation code ${confirmation}.` } };
  });
  registerLensAction("hvac", "booking-list", (ctx, _a, _params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = (s.bookings.get(hvAid(ctx)) || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { bookings: list, count: list.length, pending: list.filter((b) => b.status === "requested").length } };
  });
  registerLensAction("hvac", "booking-confirm", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const booking = hvFind(s.bookings, userId, params.id);
    if (!booking) return { ok: false, error: "booking not found" };
    if (params.decline === true) {
      booking.status = "declined";
      booking.updatedAt = hvNow();
      saveHvacState();
      return { ok: true, result: { booking } };
    }
    // Promote the booking into a real dispatch appointment.
    const appt = {
      id: hvId("appt"),
      title: `${booking.serviceType} — ${booking.customer}`,
      client: booking.customer,
      address: booking.address,
      jobType: booking.serviceType,
      technicianId: params.technicianId ? hvClean(params.technicianId, 60) : null,
      date: hvClean(params.date, 10) || booking.preferredDate,
      slot: hvClean(params.slot, 20) || booking.preferredSlot,
      durationHrs: Math.max(0.5, hvNum(params.durationHrs, 2)),
      status: "scheduled",
      priority: "normal",
      notes: booking.issue,
      bookingId: booking.id,
      createdAt: hvNow(),
    };
    hvList(s.appointments, userId).push(appt);
    booking.status = "confirmed";
    booking.appointmentId = appt.id;
    booking.updatedAt = hvNow();
    saveHvacState();
    return { ok: true, result: { booking, appointment: appt, message: `Confirmed — appointment ${appt.date || "TBD"} (${appt.slot}).` } };
  });

  // ── Equipment / service-history (asset records per address) ─────────
  registerLensAction("hvac", "asset-add", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const address = hvClean(params.address, 200);
    if (!address) return { ok: false, error: "service address required" };
    const installYear = parseInt(params.installYear, 10);
    const asset = {
      id: hvId("asset"),
      client: hvClean(params.client, 120),
      address,
      equipmentType: hvClean(params.equipmentType, 60) || "central-ac",
      brand: hvClean(params.brand, 60),
      model: hvClean(params.model, 80),
      serial: hvClean(params.serial, 80),
      installYear: Number.isFinite(installYear) ? installYear : null,
      tonnage: params.tonnage != null ? hvNum(params.tonnage) : null,
      seer: params.seer != null ? hvNum(params.seer) : null,
      refrigerant: hvClean(params.refrigerant, 40),
      warrantyExpires: hvClean(params.warrantyExpires, 10),
      history: [],
      createdAt: hvNow(),
    };
    hvList(s.assets, hvAid(ctx)).push(asset);
    saveHvacState();
    return { ok: true, result: { asset } };
  });
  registerLensAction("hvac", "asset-list", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let list = s.assets.get(hvAid(ctx)) || [];
    const addr = hvClean(params.address, 200).toLowerCase();
    if (addr) list = list.filter((x) => x.address.toLowerCase().includes(addr));
    const nowYear = new Date().getFullYear();
    const enriched = list.map((x) => ({
      ...x,
      serviceCount: x.history.length,
      ageYears: x.installYear ? nowYear - x.installYear : null,
      warrantyActive: x.warrantyExpires ? x.warrantyExpires >= hvNow().slice(0, 10) : null,
    }));
    return { ok: true, result: { assets: enriched, count: enriched.length } };
  });
  registerLensAction("hvac", "asset-log-service", (ctx, _a, params = {}) => {
  try {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const asset = hvFind(s.assets, hvAid(ctx), params.assetId);
    if (!asset) return { ok: false, error: "asset not found" };
    const entry = {
      id: hvId("svc"),
      date: hvClean(params.date, 10) || hvNow().slice(0, 10),
      serviceType: hvClean(params.serviceType, 80) || "maintenance",
      technician: hvClean(params.technician, 80),
      summary: hvClean(params.summary, 600),
      partsReplaced: Array.isArray(params.partsReplaced) ? params.partsReplaced.map((p) => hvClean(p, 80)).filter(Boolean) : [],
      cost: hvNum(params.cost),
      createdAt: hvNow(),
    };
    asset.history.unshift(entry);
    saveHvacState();
    return { ok: true, result: { asset, entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("hvac", "asset-delete", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.assets.get(hvAid(ctx)) || [];
    const idx = list.findIndex((x) => x.id === params.id);
    if (idx < 0) return { ok: false, error: "asset not found" };
    list.splice(idx, 1);
    saveHvacState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Quote → approval e-sign workflow ────────────────────────────────
  registerLensAction("hvac", "estimate-request-signature", (ctx, _a, params = {}) => {
  try {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const estimateId = hvClean(params.estimateId, 80);
    if (!estimateId) return { ok: false, error: "estimateId required" };
    const amount = hvNum(params.amount);
    if (amount <= 0) return { ok: false, error: "estimate amount required" };
    const list = hvList(s.payments, hvAid(ctx));
    // signature requests are tracked alongside payments under a 'kind'
    const token = "SIGN-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    const rec = {
      id: hvId("sign"), kind: "signature",
      estimateId,
      client: hvClean(params.client, 120),
      amount: Math.round(amount * 100) / 100,
      token,
      status: "sent",
      signedName: null, signedAt: null,
      createdAt: hvNow(),
    };
    list.push(rec);
    saveHvacState();
    return { ok: true, result: { signatureRequest: rec, message: `Approval request sent. Sign token ${token}.` } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("hvac", "estimate-sign", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.payments.get(hvAid(ctx)) || [];
    const rec = list.find((r) => r.kind === "signature" && r.id === params.id);
    if (!rec) return { ok: false, error: "signature request not found" };
    if (rec.status === "signed") return { ok: false, error: "already signed" };
    const signedName = hvClean(params.signedName, 120);
    if (!signedName) return { ok: false, error: "signer name required" };
    if (params.declined === true) {
      rec.status = "declined";
      rec.updatedAt = hvNow();
      saveHvacState();
      return { ok: true, result: { signatureRequest: rec } };
    }
    rec.status = "signed";
    rec.signedName = signedName;
    rec.signedAt = hvNow();
    saveHvacState();
    return { ok: true, result: { signatureRequest: rec, message: "Estimate approved & signed." } };
  });

  // ── Online payment / invoice payment processing ─────────────────────
  registerLensAction("hvac", "payment-charge", (ctx, _a, params = {}) => {
  try {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const invoiceId = hvClean(params.invoiceId, 80);
    if (!invoiceId) return { ok: false, error: "invoiceId required" };
    const amount = hvNum(params.amount);
    if (amount <= 0) return { ok: false, error: "payment amount must be positive" };
    const methods = ["card", "ach", "cash", "check"];
    const method = methods.includes(params.method) ? params.method : "card";
    const fee = method === "card" ? Math.round(amount * 0.029 * 100) / 100 + 0.30
      : method === "ach" ? Math.round(amount * 0.008 * 100) / 100 : 0;
    const rec = {
      id: hvId("pay"), kind: "payment",
      invoiceId,
      client: hvClean(params.client, 120),
      amount: Math.round(amount * 100) / 100,
      method,
      processingFee: Math.round(fee * 100) / 100,
      net: Math.round((amount - fee) * 100) / 100,
      status: "paid",
      reference: "TXN-" + Math.random().toString(36).slice(2, 12).toUpperCase(),
      paidAt: hvNow(),
      createdAt: hvNow(),
    };
    hvList(s.payments, hvAid(ctx)).push(rec);
    saveHvacState();
    return { ok: true, result: { payment: rec, message: `Payment of $${rec.amount} processed (${method}).` } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("hvac", "payment-list", (ctx, _a, _params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = s.payments.get(hvAid(ctx)) || [];
    const payments = all.filter((r) => r.kind === "payment").slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const signatures = all.filter((r) => r.kind === "signature").slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const collected = payments.reduce((sum, p) => sum + p.amount, 0);
    const fees = payments.reduce((sum, p) => sum + p.processingFee, 0);
    return { ok: true, result: {
      payments, signatures,
      summary: {
        count: payments.length,
        collected: Math.round(collected * 100) / 100,
        fees: Math.round(fees * 100) / 100,
        net: Math.round((collected - fees) * 100) / 100,
        pendingSignatures: signatures.filter((sg) => sg.status === "sent").length,
      },
    } };
  });
  registerLensAction("hvac", "payment-refund", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.payments.get(hvAid(ctx)) || [];
    const rec = list.find((r) => r.kind === "payment" && r.id === params.id);
    if (!rec) return { ok: false, error: "payment not found" };
    if (rec.status === "refunded") return { ok: false, error: "already refunded" };
    rec.status = "refunded";
    rec.refundedAt = hvNow();
    saveHvacState();
    return { ok: true, result: { payment: rec } };
  });

  // ── Maintenance-agreement / recurring-service contracts ─────────────
  registerLensAction("hvac", "agreement-create", (ctx, _a, params = {}) => {
  try {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const client = hvClean(params.client, 120);
    if (!client) return { ok: false, error: "client required" };
    const plans = {
      basic: { visitsPerYear: 1, annualPrice: 149, perks: ["Annual tune-up", "10% repair discount"] },
      standard: { visitsPerYear: 2, annualPrice: 279, perks: ["Spring + fall tune-up", "15% repair discount", "Priority scheduling"] },
      premium: { visitsPerYear: 4, annualPrice: 499, perks: ["Quarterly tune-up", "20% repair discount", "Priority scheduling", "No overtime fees", "Free filters"] },
    };
    const tier = plans[params.tier] ? params.tier : "standard";
    const plan = plans[tier];
    const start = hvClean(params.startDate, 10) || hvNow().slice(0, 10);
    const startDt = new Date(start);
    const renew = new Date(startDt.getTime());
    renew.setFullYear(renew.getFullYear() + 1);
    // schedule recurring visit dates evenly across the year
    const visits = [];
    for (let i = 0; i < plan.visitsPerYear; i++) {
      const d = new Date(startDt.getTime() + Math.round((365 / plan.visitsPerYear) * i) * 86400000);
      visits.push({ seq: i + 1, dueDate: d.toISOString().slice(0, 10), status: "scheduled" });
    }
    const agreement = {
      id: hvId("agr"), client,
      address: hvClean(params.address, 200),
      tier,
      visitsPerYear: plan.visitsPerYear,
      annualPrice: plan.annualPrice,
      perks: plan.perks,
      startDate: start,
      renewalDate: renew.toISOString().slice(0, 10),
      autoRenew: params.autoRenew !== false,
      status: "active",
      visits,
      createdAt: hvNow(),
    };
    hvList(s.agreements, hvAid(ctx)).push(agreement);
    saveHvacState();
    return { ok: true, result: { agreement } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("hvac", "agreement-list", (ctx, _a, _params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.agreements.get(hvAid(ctx)) || [];
    const today = hvNow().slice(0, 10);
    const enriched = list.map((a) => ({
      ...a,
      visitsDue: a.visits.filter((v) => v.status === "scheduled" && v.dueDate <= today).length,
      nextVisit: a.visits.filter((v) => v.status === "scheduled").sort((x, y) => x.dueDate.localeCompare(y.dueDate))[0] || null,
    }));
    const mrr = enriched.filter((a) => a.status === "active").reduce((sum, a) => sum + a.annualPrice / 12, 0);
    return { ok: true, result: {
      agreements: enriched,
      count: enriched.length,
      activeCount: enriched.filter((a) => a.status === "active").length,
      monthlyRecurringRevenue: Math.round(mrr * 100) / 100,
      annualRecurringRevenue: Math.round(mrr * 12 * 100) / 100,
    } };
  });
  registerLensAction("hvac", "agreement-complete-visit", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const agr = hvFind(s.agreements, hvAid(ctx), params.id);
    if (!agr) return { ok: false, error: "agreement not found" };
    const visit = agr.visits.find((v) => v.seq === hvNum(params.seq));
    if (!visit) return { ok: false, error: "visit not found" };
    visit.status = "completed";
    visit.completedDate = hvClean(params.date, 10) || hvNow().slice(0, 10);
    saveHvacState();
    return { ok: true, result: { agreement: agr, visit } };
  });
  registerLensAction("hvac", "agreement-cancel", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const agr = hvFind(s.agreements, hvAid(ctx), params.id);
    if (!agr) return { ok: false, error: "agreement not found" };
    agr.status = "cancelled";
    agr.autoRenew = false;
    agr.cancelledAt = hvNow();
    saveHvacState();
    return { ok: true, result: { agreement: agr } };
  });

  // ── Technician mobile workflow (on-site checklist / parts / photos) ─
  registerLensAction("hvac", "field-visit-start", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const appointmentId = hvClean(params.appointmentId, 80);
    if (!appointmentId) return { ok: false, error: "appointmentId required" };
    const appt = hvFind(s.appointments, userId, appointmentId);
    if (!appt) return { ok: false, error: "appointment not found" };
    const STANDARD_CHECKLIST = [
      "Inspect air filter", "Check refrigerant pressures", "Test thermostat operation",
      "Clear condensate drain", "Inspect electrical connections", "Measure temperature split",
      "Check blower motor & belt", "Verify safety controls",
    ];
    const checklist = (Array.isArray(params.checklist) && params.checklist.length
      ? params.checklist.map((c) => hvClean(c, 120))
      : STANDARD_CHECKLIST).map((label) => ({ label, done: false }));
    const visit = {
      id: hvId("visit"),
      appointmentId,
      client: appt.client,
      address: appt.address,
      technician: hvClean(params.technician, 80),
      status: "on_site",
      checklist,
      partsUsed: [],
      photos: [],
      notes: "",
      startedAt: hvNow(),
    };
    hvList(s.fieldVisits, userId).push(visit);
    appt.status = "in_progress";
    saveHvacState();
    return { ok: true, result: { visit } };
  });
  registerLensAction("hvac", "field-visit-update", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const visit = hvFind(s.fieldVisits, hvAid(ctx), params.id);
    if (!visit) return { ok: false, error: "field visit not found" };
    if (typeof params.checkIndex === "number" && visit.checklist[params.checkIndex]) {
      visit.checklist[params.checkIndex].done = params.done !== false;
    }
    if (params.part && hvClean(params.part.name, 80)) {
      visit.partsUsed.push({
        id: hvId("part"),
        name: hvClean(params.part.name, 80),
        quantity: Math.max(1, hvNum(params.part.quantity, 1)),
        unitPrice: hvNum(params.part.unitPrice),
      });
    }
    if (typeof params.removePartId === "string") {
      visit.partsUsed = visit.partsUsed.filter((p) => p.id !== params.removePartId);
    }
    if (params.photo && hvClean(params.photo.caption !== undefined ? params.photo.caption : "x", 200) !== undefined) {
      visit.photos.push({
        id: hvId("photo"),
        caption: hvClean(params.photo.caption, 200),
        dataUrl: hvClean(params.photo.dataUrl, 500000),
        addedAt: hvNow(),
      });
    }
    if (typeof params.removePhotoId === "string") {
      visit.photos = visit.photos.filter((p) => p.id !== params.removePhotoId);
    }
    if (params.notes != null) visit.notes = hvClean(params.notes, 2000);
    visit.updatedAt = hvNow();
    saveHvacState();
    return { ok: true, result: { visit } };
  });
  registerLensAction("hvac", "field-visit-complete", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hvAid(ctx);
    const visit = hvFind(s.fieldVisits, userId, params.id);
    if (!visit) return { ok: false, error: "field visit not found" };
    visit.status = "completed";
    visit.completedAt = hvNow();
    visit.partsTotal = Math.round(visit.partsUsed.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0) * 100) / 100;
    const appt = hvFind(s.appointments, userId, visit.appointmentId);
    if (appt) appt.status = "completed";
    saveHvacState();
    return { ok: true, result: { visit, partsTotal: visit.partsTotal } };
  });
  registerLensAction("hvac", "field-visit-list", (ctx, _a, params = {}) => {
    const s = getHvacState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let list = (s.fieldVisits.get(hvAid(ctx)) || []).slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (params.appointmentId) list = list.filter((v) => v.appointmentId === params.appointmentId);
    const enriched = list.map((v) => ({
      ...v,
      checklistProgress: v.checklist.length ? Math.round((v.checklist.filter((c) => c.done).length / v.checklist.length) * 100) : 0,
      partsCount: v.partsUsed.length,
      photoCount: v.photos.length,
    }));
    return { ok: true, result: { visits: enriched, count: enriched.length } };
  });
}
