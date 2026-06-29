export default function registerServicesActions(registerLensAction) {
  registerLensAction("services", "scheduleOptimize", (ctx, artifact, _params) => {
    const appointments = artifact.data?.appointments || [artifact.data];
    const sorted = [...appointments].sort((a, b) => {
      const ta = a.time || a.date || '';
      const tb = b.time || b.date || '';
      return ta.localeCompare(tb);
    });
    let totalGap = 0;
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(sorted[i - 1].endTime || sorted[i - 1].time || 0);
      const nextStart = new Date(sorted[i].time || sorted[i].date || 0);
      const gapMinutes = (nextStart - prevEnd) / (1000 * 60);
      if (gapMinutes > 0) { totalGap += gapMinutes; gaps.push({ after: sorted[i - 1].client || i - 1, before: sorted[i].client || i, gapMinutes }); }
    }
    return { ok: true, result: { optimizedOrder: sorted.map(a => ({ client: a.client, time: a.time, service: a.serviceType })), totalGapMinutes: totalGap, gaps } };
  });

  registerLensAction("services", "reminderGenerate", (ctx, artifact, params) => {
    const appointments = artifact.data?.appointments || [artifact.data];
    const now = new Date();
    const hoursAhead = params.hoursAhead || 24;
    const cutoff = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    const upcoming = appointments.filter(a => {
      const apptDate = new Date(a.date || a.time || 0);
      return apptDate >= now && apptDate <= cutoff;
    });
    const reminders = upcoming.map(a => ({
      client: a.client || 'Unknown',
      service: a.serviceType || a.service || 'Appointment',
      date: a.date || a.time,
      provider: a.provider || '',
      message: `Reminder: Your ${a.serviceType || 'appointment'} is scheduled for ${a.date || a.time}`,
    }));
    return { ok: true, result: { reminders, count: reminders.length } };
  });

  registerLensAction("services", "revenueByProvider", (ctx, artifact, params) => {
    const appointments = artifact.data?.appointments || [];
    const period = params.period || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    const recent = appointments.filter(a => {
      const d = new Date(a.date || a.completedAt || 0);
      return d >= cutoff && (a.status === 'completed' || a.status === 'paid');
    });
    const byProvider = {};
    recent.forEach(a => {
      const provider = a.provider || 'Unknown';
      if (!byProvider[provider]) byProvider[provider] = { appointments: 0, revenue: 0 };
      byProvider[provider].appointments++;
      // Fail-CLOSED on poisoned numerics: a non-finite price (Infinity/NaN)
      // must never poison a money total — coerce it to 0 instead.
      const price = Number(a.price);
      byProvider[provider].revenue += Number.isFinite(price) ? price : 0;
    });
    const summary = Object.entries(byProvider).map(([name, data]) => ({ provider: name, ...data })).sort((a, b) => b.revenue - a.revenue);
    return { ok: true, result: { period, summary, totalRevenue: summary.reduce((s, p) => s + p.revenue, 0) } };
  });

  registerLensAction("services", "clientRetentionReport", (ctx, artifact, _params) => {
  try {
    const clients = artifact.data?.clients || [];
    const now = new Date();
    let totalVisits = 0;
    let repeatCount = 0;
    let totalRevenue = 0;
    const atRisk = [];

    const analyzed = clients.map(c => {
      const visits = c.visits || c.appointmentCount || 0;
      // Fail-CLOSED on poisoned numerics: a non-finite lifetime value
      // (Infinity/NaN) must never reach totalRevenue / averageLifetimeValue.
      const revenueRaw = parseFloat(c.totalRevenue ?? c.lifetimeValue);
      const revenue = Number.isFinite(revenueRaw) ? revenueRaw : 0;
      const lastVisit = c.lastVisit ? new Date(c.lastVisit) : null;
      const daysSinceVisit = lastVisit ? Math.floor((now - lastVisit) / 86400000) : null;
      const isRepeat = visits > 1;
      const churnRisk = daysSinceVisit != null
        ? (daysSinceVisit > 180 ? 'high' : daysSinceVisit > 90 ? 'medium' : 'low')
        : 'unknown';

      totalVisits += visits;
      totalRevenue += revenue;
      if (isRepeat) repeatCount++;
      if (churnRisk === 'high' || churnRisk === 'medium') {
        atRisk.push({ name: c.name || c.clientId, daysSinceVisit, churnRisk, lifetimeValue: revenue });
      }

      return { name: c.name || c.clientId, visits, lifetimeValue: revenue, daysSinceVisit, churnRisk };
    });

    const repeatRate = clients.length > 0 ? Math.round((repeatCount / clients.length) * 10000) / 100 : 0;
    const avgLifetimeValue = clients.length > 0 ? Math.round((totalRevenue / clients.length) * 100) / 100 : 0;

    atRisk.sort((a, b) => b.lifetimeValue - a.lifetimeValue);

    return {
      ok: true,
      result: {
        generatedAt: new Date().toISOString(),
        totalClients: clients.length,
        repeatClients: repeatCount,
        repeatRate,
        averageLifetimeValue: avgLifetimeValue,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        atRiskCount: atRisk.length,
        atRiskClients: atRisk,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("services", "commissionCalc", (ctx, artifact, params) => {
  try {
    const sales = artifact.data?.sales || [];
    const tiers = params.tiers || [
      { min: 0, max: 5000, rate: 0.05 },
      { min: 5000, max: 15000, rate: 0.08 },
      { min: 15000, max: Infinity, rate: 0.12 },
    ];

    let totalSales = 0;
    let totalCommission = 0;
    const details = sales.map((sale, idx) => {
      // Fail-CLOSED on poisoned numerics: a non-finite amount (Infinity/NaN)
      // must never reach a commission/total — coerce it to 0.
      const amountRaw = parseFloat(sale.amount ?? sale.revenue);
      const amount = Number.isFinite(amountRaw) ? amountRaw : 0;
      totalSales += amount;

      // Tiered commission calculation
      let commission = 0;
      let remaining = amount;
      for (const tier of tiers) {
        const tierMin = tier.min || 0;
        const tierMax = tier.max || Infinity;
        const tierRange = tierMax - tierMin;
        const applicable = Math.min(Math.max(remaining, 0), tierRange);
        commission += applicable * (tier.rate || 0);
        remaining -= applicable;
        if (remaining <= 0) break;
      }
      commission = Math.round(commission * 100) / 100;
      totalCommission += commission;

      return {
        line: idx + 1,
        salesperson: sale.salesperson || sale.provider || '',
        description: sale.description || sale.service || '',
        amount,
        commission,
        effectiveRate: amount > 0 ? Math.round((commission / amount) * 10000) / 100 : 0,
      };
    });

    // Per-salesperson summary
    const bySalesperson = {};
    for (const d of details) {
      if (!d.salesperson) continue;
      if (!bySalesperson[d.salesperson]) bySalesperson[d.salesperson] = { sales: 0, commission: 0 };
      bySalesperson[d.salesperson].sales += d.amount;
      bySalesperson[d.salesperson].commission += d.commission;
    }
    const salespersonSummary = Object.entries(bySalesperson).map(([name, data]) => ({
      salesperson: name,
      totalSales: Math.round(data.sales * 100) / 100,
      totalCommission: Math.round(data.commission * 100) / 100,
    })).sort((a, b) => b.totalCommission - a.totalCommission);

    return {
      ok: true,
      result: {
        generatedAt: new Date().toISOString(),
        totalSales: Math.round(totalSales * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        effectiveRate: totalSales > 0 ? Math.round((totalCommission / totalSales) * 10000) / 100 : 0,
        lineItems: details,
        bySalesperson: salespersonSummary,
        tiers,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("services", "dailyCloseReport", (ctx, artifact, params) => {
  try {
    const appointments = artifact.data?.appointments || [];
    const dateStr = params.date || new Date().toISOString().split('T')[0];

    const dayAppts = appointments.filter(a => {
      const d = (a.date || a.completedAt || '').substring(0, 10);
      return d === dateStr;
    });

    const completed = dayAppts.filter(a => a.status === 'completed' || a.status === 'paid');
    const noShows = dayAppts.filter(a => a.status === 'no_show' || a.status === 'no-show');
    const cancelled = dayAppts.filter(a => a.status === 'cancelled' || a.status === 'canceled');
    // Fail-CLOSED on poisoned numerics: a non-finite price (Infinity/NaN) must
    // never reach a money total — coerce it to 0.
    const finiteNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const totalRevenue = Math.round(completed.reduce((s, a) => s + finiteNum(a.price ?? a.revenue), 0) * 100) / 100;

    const productsSold = artifact.data?.productsSold || [];
    const productRevenue = Math.round(productsSold.reduce((s, p) => s + finiteNum(p.price ?? p.amount) * (parseInt(p.quantity, 10) || 1), 0) * 100) / 100;

    const byProvider = {};
    for (const a of completed) {
      const prov = a.provider || 'Unknown';
      if (!byProvider[prov]) byProvider[prov] = { appointments: 0, revenue: 0 };
      byProvider[prov].appointments++;
      byProvider[prov].revenue += finiteNum(a.price ?? a.revenue);
    }
    const providerSummary = Object.entries(byProvider).map(([name, data]) => ({
      provider: name,
      appointments: data.appointments,
      revenue: Math.round(data.revenue * 100) / 100,
    }));

    return {
      ok: true,
      result: {
        date: dateStr,
        totalAppointments: dayAppts.length,
        completedCount: completed.length,
        noShowCount: noShows.length,
        cancelledCount: cancelled.length,
        serviceRevenue: totalRevenue,
        productsSold: productsSold.length,
        productRevenue,
        totalRevenue: Math.round((totalRevenue + productRevenue) * 100) / 100,
        byProvider: providerSummary,
        generatedAt: new Date().toISOString(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("services", "supplyCheck", (ctx, artifact, _params) => {
    const supplies = artifact.data?.materials || artifact.data?.supplies || [];
    const lowStock = supplies.filter(s => {
      const current = s.currentStock || s.quantity || 0;
      const reorder = s.reorderPoint || s.minStock || 5;
      return current <= reorder;
    }).map(s => ({
      name: s.name,
      currentStock: s.currentStock || s.quantity || 0,
      reorderPoint: s.reorderPoint || s.minStock || 5,
      supplier: s.supplier || '',
    }));
    return { ok: true, result: { lowStock, count: lowStock.length, totalItems: supplies.length, needsOrder: lowStock.length > 0 } };
  });

  /* ================================================================== */
  /*  Per-user persistent substrate (booking grid, self-booking,         */
  /*  payments, reminders, staff shifts, client profiles, waitlist).     */
  /* ================================================================== */

  function svcStore() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    if (!STATE.servicesLens) STATE.servicesLens = {};
    const s = STATE.servicesLens;
    if (!(s.bookings instanceof Map)) s.bookings = new Map();        // userId -> Array<Booking>
    if (!(s.shifts instanceof Map)) s.shifts = new Map();            // userId -> Array<Shift>
    if (!(s.payments instanceof Map)) s.payments = new Map();        // userId -> Array<Payment>
    if (!(s.reminders instanceof Map)) s.reminders = new Map();      // userId -> Array<Reminder>
    if (!(s.profiles instanceof Map)) s.profiles = new Map();        // userId -> Map<clientKey, Profile>
    if (!(s.waitlist instanceof Map)) s.waitlist = new Map();        // userId -> Array<WaitEntry>
    return s;
  }
  const svcActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const svcList = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };
  const svcId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function minsFromHHMM(t) {
    if (typeof t !== "string" || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  function hhmmFromMins(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /* ---- 1. Calendar booking grid ----------------------------------- */

  registerLensAction("services", "bookingGridCreate", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const date = String(p.date || new Date().toISOString().slice(0, 10));
      const start = minsFromHHMM(p.time);
      const duration = Math.max(5, Number(p.duration) || 30);
      if (start == null) return { ok: false, error: "valid time (HH:MM) required" };
      const staff = String(p.staff || p.provider || "Unassigned");
      const list = svcList(s.bookings, userId);
      // Conflict check against existing bookings for the same staff/date.
      const conflict = list.find(b =>
        b.staff === staff && b.date === date && b.status !== "cancelled" &&
        start < b.startMin + b.duration && start + duration > b.startMin);
      if (conflict) {
        return { ok: false, error: `conflict with ${conflict.client || "booking"} at ${conflict.time}` };
      }
      const booking = {
        id: svcId("bk"),
        client: String(p.client || "Walk-in"),
        clientUserId: p.clientUserId ? String(p.clientUserId) : null,
        service: String(p.service || "Service"),
        staff, date, time: hhmmFromMins(start), startMin: start, duration,
        price: Math.max(0, Number(p.price) || 0),
        status: "booked",
        source: String(p.source || "grid"),
        notes: String(p.notes || ""),
        createdAt: new Date().toISOString(),
      };
      list.push(booking);
      return { ok: true, result: { booking } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "bookingGridMove", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const list = svcList(s.bookings, userId);
      const booking = list.find(b => b.id === p.id);
      if (!booking) return { ok: false, error: "booking not found" };
      const newStart = p.time != null ? minsFromHHMM(p.time) : booking.startMin;
      if (newStart == null) return { ok: false, error: "valid time (HH:MM) required" };
      const newStaff = p.staff != null ? String(p.staff) : booking.staff;
      const newDate = p.date != null ? String(p.date) : booking.date;
      const newDuration = p.duration != null ? Math.max(5, Number(p.duration)) : booking.duration;
      const conflict = list.find(b =>
        b.id !== booking.id && b.staff === newStaff && b.date === newDate && b.status !== "cancelled" &&
        newStart < b.startMin + b.duration && newStart + newDuration > b.startMin);
      if (conflict) return { ok: false, error: `conflict with ${conflict.client || "booking"} at ${conflict.time}` };
      booking.staff = newStaff;
      booking.date = newDate;
      booking.startMin = newStart;
      booking.time = hhmmFromMins(newStart);
      booking.duration = newDuration;
      booking.movedAt = new Date().toISOString();
      return { ok: true, result: { booking } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "bookingGridList", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      let list = svcList(s.bookings, userId).slice();
      if (p.date) list = list.filter(b => b.date === String(p.date));
      if (p.staff) list = list.filter(b => b.staff === String(p.staff));
      list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const staffLanes = [...new Set(list.map(b => b.staff))].sort();
      const utilization = {};
      for (const b of list) {
        if (b.status === "cancelled") continue;
        utilization[b.staff] = (utilization[b.staff] || 0) + b.duration;
      }
      return { ok: true, result: { bookings: list, count: list.length, staffLanes, utilization } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "bookingGridCancel", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const list = svcList(s.bookings, userId);
      const booking = list.find(b => b.id === (params || {}).id);
      if (!booking) return { ok: false, error: "booking not found" };
      booking.status = "cancelled";
      booking.cancelledAt = new Date().toISOString();
      // Promote first matching waitlist entry into the freed slot.
      const wl = svcList(s.waitlist, userId);
      const next = wl.find(w => w.status === "waiting" &&
        (!w.service || w.service === booking.service));
      let promoted = null;
      if (next) {
        next.status = "offered";
        next.offeredSlot = { date: booking.date, time: booking.time, staff: booking.staff };
        next.offeredAt = new Date().toISOString();
        promoted = next;
      }
      return { ok: true, result: { booking, promotedFromWaitlist: promoted } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ---- 2. Online self-booking ------------------------------------- */

  registerLensAction("services", "selfBookSlots", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const date = String(p.date || new Date().toISOString().slice(0, 10));
      const duration = Math.max(5, Number(p.duration) || 30);
      const openMin = minsFromHHMM(p.open || "09:00") ?? 540;
      const closeMin = minsFromHHMM(p.close || "17:00") ?? 1020;
      const staffList = Array.isArray(p.staff) && p.staff.length
        ? p.staff.map(String)
        : ["Any"];
      const booked = svcList(s.bookings, userId).filter(b => b.date === date && b.status !== "cancelled");
      const slots = [];
      for (const staff of staffList) {
        for (let t = openMin; t + duration <= closeMin; t += 30) {
          const clash = booked.find(b =>
            (staff === "Any" || b.staff === staff) &&
            t < b.startMin + b.duration && t + duration > b.startMin);
          if (!clash) slots.push({ staff, date, time: hhmmFromMins(t), duration });
        }
      }
      return { ok: true, result: { date, duration, slots, count: slots.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "selfBookConfirm", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const start = minsFromHHMM(p.time);
      if (start == null) return { ok: false, error: "valid time (HH:MM) required" };
      if (!p.client) return { ok: false, error: "client name required" };
      const date = String(p.date || new Date().toISOString().slice(0, 10));
      const duration = Math.max(5, Number(p.duration) || 30);
      const staff = String(p.staff || "Unassigned");
      const list = svcList(s.bookings, userId);
      const conflict = list.find(b =>
        b.staff === staff && b.date === date && b.status !== "cancelled" &&
        start < b.startMin + b.duration && start + duration > b.startMin);
      if (conflict) return { ok: false, error: "slot no longer available" };
      const booking = {
        id: svcId("bk"),
        client: String(p.client),
        clientUserId: p.clientUserId ? String(p.clientUserId) : null,
        service: String(p.service || "Service"),
        staff, date, time: hhmmFromMins(start), startMin: start, duration,
        price: Math.max(0, Number(p.price) || 0),
        status: "booked",
        source: "self-booking",
        contact: { phone: String(p.phone || ""), email: String(p.email || "") },
        notes: String(p.notes || ""),
        createdAt: new Date().toISOString(),
      };
      list.push(booking);
      // Auto-queue a reminder 24h ahead.
      svcList(s.reminders, userId).push({
        id: svcId("rm"), bookingId: booking.id, client: booking.client,
        channel: p.email ? "email" : "sms",
        target: p.email || p.phone || "",
        sendAt: `${date}T${booking.time}:00`,
        body: `Reminder: ${booking.service} on ${date} at ${booking.time}`,
        status: "scheduled", createdAt: new Date().toISOString(),
      });
      return { ok: true, result: { booking, confirmation: booking.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ---- 3. Payment capture at POS ---------------------------------- */

  registerLensAction("services", "paymentCapture", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const subtotal = Math.max(0, Number(p.subtotal ?? p.amount) || 0);
      if (subtotal <= 0) return { ok: false, error: "subtotal must be positive" };
      const tipPct = Math.max(0, Number(p.tipPercent) || 0);
      const tip = Number(p.tip) > 0 ? Number(p.tip) : Math.round(subtotal * tipPct) / 100;
      const taxRate = Math.max(0, Number(p.taxRate) || 0);
      const tax = Math.round(subtotal * taxRate) / 100;
      const discount = Math.max(0, Number(p.discount) || 0);
      const total = Math.round((subtotal + tax + tip - discount) * 100) / 100;
      if (total < 0) return { ok: false, error: "discount exceeds total" };
      const method = String(p.method || "card");
      // Simulated card-auth: deterministic from card last4 — declines on "0000".
      const last4 = String(p.cardLast4 || "").slice(-4);
      let authStatus = "captured";
      if (method === "card" && last4 === "0000") authStatus = "declined";
      const payment = {
        id: svcId("pmt"),
        receiptNumber: `RCP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        client: String(p.client || "Walk-in"),
        bookingId: p.bookingId ? String(p.bookingId) : null,
        staff: String(p.staff || ""),
        lineItems: Array.isArray(p.lineItems) ? p.lineItems : [],
        subtotal, tax, tip, discount, total,
        method, cardLast4: last4 || null,
        status: authStatus,
        capturedAt: new Date().toISOString(),
      };
      svcList(s.payments, userId).push(payment);
      if (authStatus === "declined") {
        return { ok: false, error: "card declined", result: { payment } };
      }
      // Mark linked booking completed.
      if (payment.bookingId) {
        const bk = svcList(s.bookings, userId).find(b => b.id === payment.bookingId);
        if (bk) { bk.status = "completed"; bk.paymentId = payment.id; }
      }
      return { ok: true, result: { payment } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "paymentRefund", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const list = svcList(s.payments, userId);
      const payment = list.find(p => p.id === (params || {}).id);
      if (!payment) return { ok: false, error: "payment not found" };
      if (payment.status === "refunded") return { ok: false, error: "already refunded" };
      if (payment.status !== "captured") return { ok: false, error: "only captured payments are refundable" };
      const amount = Math.min(payment.total, Math.max(0, Number((params || {}).amount) || payment.total));
      payment.status = amount >= payment.total ? "refunded" : "partial_refund";
      payment.refundedAmount = amount;
      payment.refundedAt = new Date().toISOString();
      return { ok: true, result: { payment, refunded: amount } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "paymentList", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      let list = svcList(s.payments, userId).slice();
      if (p.date) list = list.filter(x => (x.capturedAt || "").startsWith(String(p.date)));
      list.sort((a, b) => (b.capturedAt || "").localeCompare(a.capturedAt || ""));
      const captured = list.filter(x => x.status === "captured");
      const gross = Math.round(captured.reduce((sum, x) => sum + x.total, 0) * 100) / 100;
      const tips = Math.round(captured.reduce((sum, x) => sum + x.tip, 0) * 100) / 100;
      const byMethod = {};
      for (const x of captured) byMethod[x.method] = Math.round(((byMethod[x.method] || 0) + x.total) * 100) / 100;
      return { ok: true, result: { payments: list, count: list.length, gross, tips, byMethod } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ---- 4. Automated reminder delivery ----------------------------- */

  registerLensAction("services", "reminderSchedule", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      if (!p.bookingId && !p.client) return { ok: false, error: "bookingId or client required" };
      const reminder = {
        id: svcId("rm"),
        bookingId: p.bookingId ? String(p.bookingId) : null,
        client: String(p.client || ""),
        channel: ["sms", "email"].includes(p.channel) ? p.channel : "sms",
        target: String(p.target || ""),
        sendAt: String(p.sendAt || new Date().toISOString()),
        body: String(p.body || "Appointment reminder"),
        status: "scheduled",
        createdAt: new Date().toISOString(),
      };
      svcList(s.reminders, userId).push(reminder);
      return { ok: true, result: { reminder } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "reminderDispatch", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const now = p.now ? new Date(p.now) : new Date();
      const list = svcList(s.reminders, userId);
      const due = list.filter(r => r.status === "scheduled" && new Date(r.sendAt) <= now);
      const delivered = [];
      const failed = [];
      for (const r of due) {
        if (!r.target) {
          r.status = "failed";
          r.failureReason = "no contact target";
          failed.push(r);
          continue;
        }
        r.status = "delivered";
        r.deliveredAt = new Date().toISOString();
        delivered.push(r);
      }
      return {
        ok: true,
        result: { dispatched: delivered.length, failed: failed.length, delivered, failures: failed },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "reminderList", (ctx, artifact, _params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const list = svcList(s.reminders, userId).slice()
        .sort((a, b) => (a.sendAt || "").localeCompare(b.sendAt || ""));
      const counts = { scheduled: 0, delivered: 0, failed: 0 };
      for (const r of list) counts[r.status] = (counts[r.status] || 0) + 1;
      return { ok: true, result: { reminders: list, count: list.length, counts } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ---- 5. Staff availability + shift management ------------------- */

  registerLensAction("services", "shiftCreate", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      if (!p.staff) return { ok: false, error: "staff name required" };
      const startMin = minsFromHHMM(p.start);
      const endMin = minsFromHHMM(p.end);
      if (startMin == null || endMin == null) return { ok: false, error: "valid start/end (HH:MM) required" };
      if (endMin <= startMin) return { ok: false, error: "end must be after start" };
      const date = String(p.date || new Date().toISOString().slice(0, 10));
      const list = svcList(s.shifts, userId);
      const overlap = list.find(sh =>
        sh.staff === String(p.staff) && sh.date === date && sh.status !== "cancelled" &&
        startMin < sh.endMin && endMin > sh.startMin);
      if (overlap) return { ok: false, error: `overlaps existing shift ${overlap.start}-${overlap.end}` };
      const shift = {
        id: svcId("sh"),
        staff: String(p.staff),
        date, start: hhmmFromMins(startMin), end: hhmmFromMins(endMin),
        startMin, endMin,
        role: String(p.role || ""),
        status: ["scheduled", "off", "vacation"].includes(p.status) ? p.status : "scheduled",
        hours: Math.round((endMin - startMin) / 6) / 10,
        createdAt: new Date().toISOString(),
      };
      list.push(shift);
      return { ok: true, result: { shift } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "shiftList", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      let list = svcList(s.shifts, userId).slice();
      if (p.date) list = list.filter(sh => sh.date === String(p.date));
      if (p.staff) list = list.filter(sh => sh.staff === String(p.staff));
      list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      const hoursByStaff = {};
      for (const sh of list) {
        if (sh.status === "scheduled") {
          hoursByStaff[sh.staff] = Math.round(((hoursByStaff[sh.staff] || 0) + sh.hours) * 10) / 10;
        }
      }
      return { ok: true, result: { shifts: list, count: list.length, hoursByStaff } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "shiftUpdate", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const shift = svcList(s.shifts, userId).find(sh => sh.id === p.id);
      if (!shift) return { ok: false, error: "shift not found" };
      if (p.status && ["scheduled", "off", "vacation", "cancelled"].includes(p.status)) shift.status = p.status;
      if (p.start) { const m = minsFromHHMM(p.start); if (m != null) { shift.startMin = m; shift.start = hhmmFromMins(m); } }
      if (p.end) { const m = minsFromHHMM(p.end); if (m != null) { shift.endMin = m; shift.end = hhmmFromMins(m); } }
      shift.hours = Math.round((shift.endMin - shift.startMin) / 6) / 10;
      shift.updatedAt = new Date().toISOString();
      return { ok: true, result: { shift } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "staffAvailability", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const date = String(p.date || new Date().toISOString().slice(0, 10));
      const staff = String(p.staff || "");
      if (!staff) return { ok: false, error: "staff name required" };
      const shift = svcList(s.shifts, userId).find(sh =>
        sh.staff === staff && sh.date === date && sh.status === "scheduled");
      if (!shift) return { ok: true, result: { staff, date, available: false, freeSlots: [], reason: "off / no shift" } };
      const duration = Math.max(5, Number(p.duration) || 30);
      const booked = svcList(s.bookings, userId).filter(b =>
        b.staff === staff && b.date === date && b.status !== "cancelled");
      const freeSlots = [];
      for (let t = shift.startMin; t + duration <= shift.endMin; t += 30) {
        const clash = booked.find(b => t < b.startMin + b.duration && t + duration > b.startMin);
        if (!clash) freeSlots.push(hhmmFromMins(t));
      }
      return { ok: true, result: { staff, date, available: freeSlots.length > 0, shift: { start: shift.start, end: shift.end }, freeSlots } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ---- 6. Client history + preferences profile ------------------- */

  registerLensAction("services", "clientProfileUpsert", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const key = String(p.client || p.clientKey || "").trim().toLowerCase();
      if (!key) return { ok: false, error: "client name required" };
      if (!s.profiles.has(userId)) s.profiles.set(userId, new Map());
      const profiles = s.profiles.get(userId);
      const existing = profiles.get(key) || {
        clientKey: key, name: String(p.client || key),
        createdAt: new Date().toISOString(), history: [], notes: "", preferences: "",
      };
      existing.name = String(p.client || existing.name);
      if (p.phone !== undefined) existing.phone = String(p.phone);
      if (p.email !== undefined) existing.email = String(p.email);
      if (p.notes !== undefined) existing.notes = String(p.notes);
      if (p.preferences !== undefined) existing.preferences = String(p.preferences);
      if (p.allergies !== undefined) existing.allergies = String(p.allergies);
      if (p.preferredProvider !== undefined) existing.preferredProvider = String(p.preferredProvider);
      existing.updatedAt = new Date().toISOString();
      profiles.set(key, existing);
      return { ok: true, result: { profile: existing } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "clientHistory", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const key = String(p.client || p.clientKey || "").trim().toLowerCase();
      if (!key) return { ok: false, error: "client name required" };
      const profiles = s.profiles.get(userId);
      const profile = profiles?.get(key) || { clientKey: key, name: key, history: [], preferences: "", notes: "" };
      // Derive history from bookings + payments.
      const bookings = svcList(s.bookings, userId)
        .filter(b => (b.client || "").trim().toLowerCase() === key)
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
      const payments = svcList(s.payments, userId)
        .filter(x => (x.client || "").trim().toLowerCase() === key && x.status === "captured");
      const visits = bookings.filter(b => b.status === "completed").length;
      const totalSpend = Math.round(payments.reduce((sum, x) => sum + x.total, 0) * 100) / 100;
      const lastVisit = bookings.find(b => b.status === "completed")?.date || null;
      const serviceFreq = {};
      for (const b of bookings) serviceFreq[b.service] = (serviceFreq[b.service] || 0) + 1;
      const favoriteService = Object.entries(serviceFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const noShows = bookings.filter(b => b.status === "no_show").length;
      return {
        ok: true,
        result: {
          profile, visits, totalSpend, lastVisit, favoriteService, noShows,
          bookings: bookings.slice(0, 25),
          rebookSuggestion: favoriteService
            ? `Rebook ${favoriteService}${profile.preferredProvider ? ` with ${profile.preferredProvider}` : ""}`
            : null,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "clientProfileList", (ctx, artifact, _params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const profiles = s.profiles.get(userId);
      const list = profiles ? [...profiles.values()] : [];
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return { ok: true, result: { profiles: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ---- 7. Recurring appointments + waitlist ----------------------- */

  registerLensAction("services", "recurringSeries", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const start = minsFromHHMM(p.time);
      if (start == null) return { ok: false, error: "valid time (HH:MM) required" };
      if (!p.client) return { ok: false, error: "client name required" };
      const freq = ["weekly", "biweekly", "monthly"].includes(p.frequency) ? p.frequency : "weekly";
      const stepDays = freq === "monthly" ? 30 : freq === "biweekly" ? 14 : 7;
      const occurrences = Math.min(26, Math.max(1, Number(p.occurrences) || 4));
      const duration = Math.max(5, Number(p.duration) || 30);
      const staff = String(p.staff || "Unassigned");
      const seriesId = svcId("ser");
      const list = svcList(s.bookings, userId);
      const created = [];
      const skipped = [];
      const base = new Date(`${p.date || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      for (let i = 0; i < occurrences; i++) {
        const d = new Date(base.getTime() + i * stepDays * 86400000);
        const date = d.toISOString().slice(0, 10);
        const conflict = list.find(b =>
          b.staff === staff && b.date === date && b.status !== "cancelled" &&
          start < b.startMin + b.duration && start + duration > b.startMin);
        if (conflict) { skipped.push({ date, reason: "conflict" }); continue; }
        const booking = {
          id: svcId("bk"), seriesId, occurrence: i + 1,
          client: String(p.client),
          clientUserId: p.clientUserId ? String(p.clientUserId) : null,
          service: String(p.service || "Service"),
          staff, date, time: hhmmFromMins(start), startMin: start, duration,
          price: Math.max(0, Number(p.price) || 0),
          status: "booked", source: "recurring", frequency: freq,
          createdAt: new Date().toISOString(),
        };
        list.push(booking);
        created.push(booking);
      }
      return {
        ok: true,
        result: { seriesId, frequency: freq, created, createdCount: created.length, skipped },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "waitlistAdd", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      if (!p.client) return { ok: false, error: "client name required" };
      const entry = {
        id: svcId("wl"),
        client: String(p.client),
        clientUserId: p.clientUserId ? String(p.clientUserId) : null,
        service: p.service ? String(p.service) : null,
        staff: p.staff ? String(p.staff) : null,
        preferredDate: p.preferredDate ? String(p.preferredDate) : null,
        contact: { phone: String(p.phone || ""), email: String(p.email || "") },
        priority: ["high", "normal", "low"].includes(p.priority) ? p.priority : "normal",
        status: "waiting",
        createdAt: new Date().toISOString(),
      };
      svcList(s.waitlist, userId).push(entry);
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "waitlistList", (ctx, artifact, _params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const order = { high: 0, normal: 1, low: 2 };
      const list = svcList(s.waitlist, userId).slice()
        .sort((a, b) => (order[a.priority] - order[b.priority]) ||
          (a.createdAt || "").localeCompare(b.createdAt || ""));
      const counts = { waiting: 0, offered: 0, booked: 0, removed: 0 };
      for (const w of list) counts[w.status] = (counts[w.status] || 0) + 1;
      return { ok: true, result: { waitlist: list, count: list.length, counts } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "waitlistPromote", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const p = params || {};
      const wl = svcList(s.waitlist, userId);
      const entry = wl.find(w => w.id === p.id);
      if (!entry) return { ok: false, error: "waitlist entry not found" };
      if (entry.status === "booked") return { ok: false, error: "already booked" };
      const start = minsFromHHMM(p.time);
      if (start == null) return { ok: false, error: "valid time (HH:MM) required" };
      const date = String(p.date || entry.preferredDate || new Date().toISOString().slice(0, 10));
      const duration = Math.max(5, Number(p.duration) || 30);
      const staff = String(p.staff || entry.staff || "Unassigned");
      const list = svcList(s.bookings, userId);
      const conflict = list.find(b =>
        b.staff === staff && b.date === date && b.status !== "cancelled" &&
        start < b.startMin + b.duration && start + duration > b.startMin);
      if (conflict) return { ok: false, error: "target slot has a conflict" };
      const booking = {
        id: svcId("bk"),
        client: entry.client, clientUserId: entry.clientUserId,
        service: entry.service || String(p.service || "Service"),
        staff, date, time: hhmmFromMins(start), startMin: start, duration,
        price: Math.max(0, Number(p.price) || 0),
        status: "booked", source: "waitlist", waitlistId: entry.id,
        createdAt: new Date().toISOString(),
      };
      list.push(booking);
      entry.status = "booked";
      entry.bookingId = booking.id;
      entry.promotedAt = new Date().toISOString();
      return { ok: true, result: { booking, entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("services", "waitlistRemove", (ctx, artifact, params) => {
    try {
      const s = svcStore();
      const userId = svcActor(ctx);
      const entry = svcList(s.waitlist, userId).find(w => w.id === (params || {}).id);
      if (!entry) return { ok: false, error: "waitlist entry not found" };
      entry.status = "removed";
      entry.removedAt = new Date().toISOString();
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
};
