// server/domains/consulting.js
export default function registerConsultingActions(registerLensAction) {
  // Fail-CLOSED numeric coercion for the pure-compute money macros below.
  // `parseFloat("1e999")`/`parseFloat("Infinity")` both yield Infinity, and
  // `Infinity || fallback` is Infinity — so the old `parseFloat(x) || d` pattern
  // let a poisoned rate/hours flow straight into a fee/utilization total and emit
  // a money field rendering Infinity/NaN. `finPos` collapses any non-finite (or
  // negative) value to the supplied finite default, guaranteeing FINITE output.
  // SANE_MAX caps a single finite-but-absurd input (e.g. 1e308 from the assassin)
  // so the PRODUCT of rate × hours can never overflow to Infinity. 1e12 is far
  // above any real consulting rate/hour, so realistic values pass untouched.
  const SANE_MAX = 1e12;
  const finPos = (v, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, SANE_MAX);
  };
  // Finite signed coercion (NPS spans -100..+100), clamped to a sane band.
  const finSigned = (v, lo, hi, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  registerLensAction("consulting", "engagementScope", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const deliverables = Array.isArray(data.deliverables) ? data.deliverables : [];
    const rate = finPos(data.hourlyRate, 200) || 200;
    const hours = deliverables.reduce((s, d) => s + (finPos(d && d.hours, 8) || 8), 0);
    const totalFee = Math.round(hours * rate * 100) / 100;
    const contingency = Math.round(totalFee * 0.15 * 100) / 100;
    // Coerce each deliverable name to a string-or-null label. A poisoned
    // deliverables entry that is itself a bare number (e.g. NaN) makes
    // `d && d.name` short-circuit to that NaN — leaking a non-finite number into
    // the output. Normalise so `name` is never a raw number.
    const safeName = (d) => { const v = d && typeof d === "object" ? d.name : undefined; return (v == null || typeof v === "number") ? (typeof v === "string" ? v : null) : String(v); };
    return { ok: true, result: { client: data.client || artifact.title, deliverables: deliverables.map(d => { const h = finPos(d && d.hours, 8) || 8; return { name: safeName(d), hours: h, fee: Math.round(h * rate * 100) / 100 }; }), totalHours: hours, hourlyRate: rate, subtotal: totalFee, contingency, grandTotal: Math.round((totalFee + contingency) * 100) / 100, timeline: `${Math.ceil(hours / 40)} weeks at full-time` } };
  });
  registerLensAction("consulting", "utilizationRate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const billableHours = finPos(data.billableHours, 0);
    const totalHours = finPos(data.totalHours, 40) || 40; // guard divide-by-zero
    const rate = billableHours / totalHours;
    const ratePct = Math.round(rate * 100);
    return { ok: true, result: { billableHours, totalHours, utilizationRate: ratePct, target: 75, variance: ratePct - 75, status: rate >= 0.8 ? "excellent" : rate >= 0.65 ? "on-target" : rate >= 0.5 ? "below-target" : "critical" } };
  });
  registerLensAction("consulting", "proposalScore", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const sections = ["executive-summary", "methodology", "timeline", "pricing", "team", "references"];
    const present = sections.filter(s => data[s] || data[s.replace("-", "")]);
    const score = Math.round((present.length / sections.length) * 100);
    return { ok: true, result: { score, sectionsPresent: present, sectionsMissing: sections.filter(s => !present.includes(s)), completeness: score >= 80 ? "ready-to-submit" : score >= 50 ? "needs-work" : "incomplete" } };
  });
  registerLensAction("consulting", "clientHealth", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const nps = finSigned(data.nps, -100, 100, 0);
    const invoicesPaid = finPos(data.invoicesPaid, 0);
    const invoicesTotal = finPos(data.invoicesTotal, 1) || 1; // guard divide-by-zero
    const responseTime = finPos(data.avgResponseDays, 3);
    const paymentRate = Math.round((invoicesPaid / invoicesTotal) * 100);
    const health = Math.round((Math.min(nps + 100, 200) / 200 * 30 + paymentRate / 100 * 40 + Math.max(0, 1 - responseTime / 14) * 30));
    return { ok: true, result: { client: data.client || artifact.title, nps, paymentRate, avgResponseDays: responseTime, healthScore: health, risk: health >= 70 ? "low" : health >= 40 ? "medium" : "high" } };
  });

  // ─── Engagement / client substrate (per-user, STATE-backed) ─────────
  function getConsultingState() {
    const STATE = globalThis._concordSTATE; if (!STATE) return null;
    if (!STATE.consultingLens) STATE.consultingLens = {};
    if (!(STATE.consultingLens.engagements instanceof Map)) STATE.consultingLens.engagements = new Map();
    return STATE.consultingLens;
  }
  function saveConsulting() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } } }
  const csId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const csActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const csClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const csNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const csEng = (s, u) => { if (!s.engagements.has(u)) s.engagements.set(u, []); return s.engagements.get(u); };

  registerLensAction("consulting", "engagement-create", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = csClean(params.name, 160);
    if (!name) return { ok: false, error: "engagement name required" };
    const eng = { id: csId("eng"), name, client: csClean(params.client, 160) || "Unspecified",
      rate: Math.max(0, csNum(params.rate)), budgetHours: Math.max(0, csNum(params.budgetHours)),
      status: "active", timeEntries: [], createdAt: new Date().toISOString() };
    csEng(s, csActor(ctx)).push(eng); saveConsulting();
    return { ok: true, result: { engagement: eng } };
  });
  registerLensAction("consulting", "engagement-list", (ctx, _a, _p = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const engs = csEng(s, csActor(ctx)).map((e) => {
      const hours = e.timeEntries.reduce((n, t) => n + t.hours, 0);
      return { ...e, loggedHours: hours, billed: Math.round(hours * e.rate),
        utilizationPct: e.budgetHours > 0 ? Math.round((hours / e.budgetHours) * 100) : 0 };
    });
    return { ok: true, result: { engagements: engs, count: engs.length } };
  });
  registerLensAction("consulting", "engagement-update", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = csEng(s, csActor(ctx)).find((x) => x.id === params.id);
    if (!e) return { ok: false, error: "engagement not found" };
    if (params.status && ["active", "complete", "on_hold"].includes(params.status)) e.status = params.status;
    if (params.rate != null) e.rate = Math.max(0, csNum(params.rate));
    if (params.budgetHours != null) e.budgetHours = Math.max(0, csNum(params.budgetHours));
    saveConsulting();
    return { ok: true, result: { engagement: e } };
  });
  registerLensAction("consulting", "engagement-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csEng(s, csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "engagement not found" };
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("consulting", "time-log", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = csEng(s, csActor(ctx)).find((x) => x.id === params.engagementId);
    if (!e) return { ok: false, error: "engagement not found" };
    const hours = csNum(params.hours);
    if (hours <= 0) return { ok: false, error: "hours must be positive" };
    const entry = { id: csId("te"), hours, note: csClean(params.note, 300) || "",
      date: csClean(params.date, 30) || new Date().toISOString().slice(0, 10) };
    e.timeEntries.push(entry); saveConsulting();
    return { ok: true, result: { entry, billed: Math.round(hours * e.rate) } };
  });
  registerLensAction("consulting", "consulting-dashboard", (ctx, _a, _p = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const engs = csEng(s, csActor(ctx));
    let hours = 0, billed = 0;
    for (const e of engs) { const h = e.timeEntries.reduce((n, t) => n + t.hours, 0); hours += h; billed += h * e.rate; }
    return { ok: true, result: { engagements: engs.length, active: engs.filter((e) => e.status === "active").length,
      loggedHours: Math.round(hours * 10) / 10, billed: Math.round(billed) } };
  });

  // ─── Per-user collection helpers for the extended workflow ──────────
  function csColl(s, key, u) {
    if (!(s[key] instanceof Map)) s[key] = new Map();
    if (!s[key].has(u)) s[key].set(u, []);
    return s[key].get(u);
  }
  const csRound2 = (n) => Math.round(n * 100) / 100;

  // ═══════════════════════════════════════════════════════════════════
  // [M] Invoice generation from logged time — paid/overdue states
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "invoice-create", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const eng = csEng(s, u).find((x) => x.id === params.engagementId);
    if (!eng) return { ok: false, error: "engagement not found" };
    // Roll up unbilled time entries (no invoiceId yet).
    const unbilled = eng.timeEntries.filter((t) => !t.invoiceId);
    if (unbilled.length === 0) return { ok: false, error: "no unbilled time entries" };
    const lineItems = unbilled.map((t) => ({
      timeEntryId: t.id, hours: t.hours, date: t.date,
      note: t.note || "Consulting services", rate: eng.rate, amount: csRound2(t.hours * eng.rate),
    }));
    const subtotal = csRound2(lineItems.reduce((n, l) => n + l.amount, 0));
    const taxRate = Math.max(0, Math.min(1, csNum(params.taxRate)));
    const tax = csRound2(subtotal * taxRate);
    const dueInDays = csNum(params.dueInDays) > 0 ? csNum(params.dueInDays) : 30;
    const issued = new Date();
    const due = new Date(issued.getTime() + dueInDays * 86400000);
    const invoices = csColl(s, "invoices", u);
    const number = `INV-${String(invoices.length + 1).padStart(4, "0")}`;
    const invoice = {
      id: csId("inv"), number, engagementId: eng.id, engagementName: eng.name,
      client: eng.client, lineItems, subtotal, taxRate, tax, total: csRound2(subtotal + tax),
      status: "sent", issuedAt: issued.toISOString().slice(0, 10),
      dueDate: due.toISOString().slice(0, 10), paidAt: null, createdAt: issued.toISOString(),
    };
    for (const t of unbilled) t.invoiceId = invoice.id;
    invoices.push(invoice); saveConsulting();
    return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "invoice-list", (ctx, _a, _p = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const today = new Date().toISOString().slice(0, 10);
    const invoices = csColl(s, "invoices", csActor(ctx)).map((inv) => ({
      ...inv,
      status: inv.status === "sent" && inv.dueDate < today ? "overdue" : inv.status,
    }));
    const outstanding = csRound2(invoices.filter((i) => i.status !== "paid").reduce((n, i) => n + i.total, 0));
    const overdue = csRound2(invoices.filter((i) => i.status === "overdue").reduce((n, i) => n + i.total, 0));
    const collected = csRound2(invoices.filter((i) => i.status === "paid").reduce((n, i) => n + i.total, 0));
    return { ok: true, result: { invoices, count: invoices.length, outstanding, overdue, collected } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "invoice-mark-paid", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = csColl(s, "invoices", csActor(ctx)).find((x) => x.id === params.id);
    if (!inv) return { ok: false, error: "invoice not found" };
    inv.status = "paid";
    inv.paidAt = csClean(params.paidAt, 30) || new Date().toISOString().slice(0, 10);
    saveConsulting();
    return { ok: true, result: { invoice: inv } };
  });
  registerLensAction("consulting", "invoice-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csColl(s, "invoices", csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "invoice not found" };
    const removed = arr[i];
    // Release time entries back to unbilled.
    const eng = csEng(s, csActor(ctx)).find((x) => x.id === removed.engagementId);
    if (eng) for (const t of eng.timeEntries) if (t.invoiceId === removed.id) delete t.invoiceId;
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });
  // Plain-text invoice document for PDF/print export (client renders to PDF).
  registerLensAction("consulting", "invoice-export", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = csColl(s, "invoices", csActor(ctx)).find((x) => x.id === params.id);
    if (!inv) return { ok: false, error: "invoice not found" };
    const lines = [
      `INVOICE ${inv.number}`,
      `Client: ${inv.client}`,
      `Engagement: ${inv.engagementName}`,
      `Issued: ${inv.issuedAt}    Due: ${inv.dueDate}`,
      "",
      ...inv.lineItems.map((l) => `${l.date}  ${l.hours}h  ${l.note}  $${l.amount.toFixed(2)}`),
      "",
      `Subtotal: $${inv.subtotal.toFixed(2)}`,
      `Tax (${(inv.taxRate * 100).toFixed(1)}%): $${inv.tax.toFixed(2)}`,
      `TOTAL: $${inv.total.toFixed(2)}`,
    ];
    return { ok: true, result: { document: lines.join("\n"), invoice: inv } };
  });

  // ═══════════════════════════════════════════════════════════════════
  // [L] Proposal builder — reusable section templates + e-signature
  // ═══════════════════════════════════════════════════════════════════
  const PROPOSAL_TEMPLATES = {
    "executive-summary": "Engagement overview, business context, and the value this work delivers.",
    "scope-of-work": "Detailed list of deliverables, in-scope and out-of-scope boundaries.",
    "methodology": "Phased approach, frameworks applied, and how progress is measured.",
    "timeline": "Milestone schedule with start/end dates and dependency notes.",
    "team": "Named consultants, roles, and relevant qualifications.",
    "pricing": "Fee structure, payment schedule, and assumptions.",
    "terms": "Contractual terms, confidentiality, and change-order process.",
    "references": "Comparable past engagements and outcomes.",
  };
  registerLensAction("consulting", "proposal-templates", (_ctx, _a, _p = {}) => {
    return { ok: true, result: {
      sections: Object.entries(PROPOSAL_TEMPLATES).map(([key, prompt]) => ({ key, prompt })),
    } };
  });
  registerLensAction("consulting", "proposal-create", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = csClean(params.title, 160);
    if (!title) return { ok: false, error: "proposal title required" };
    const sectionKeys = Array.isArray(params.sections) ? params.sections : Object.keys(PROPOSAL_TEMPLATES);
    const sections = sectionKeys
      .filter((k) => PROPOSAL_TEMPLATES[k])
      .map((k) => ({ key: k, prompt: PROPOSAL_TEMPLATES[k], content: "" }));
    const proposal = {
      id: csId("prop"), title, client: csClean(params.client, 160) || "Unspecified",
      value: Math.max(0, csNum(params.value)), sections, status: "draft",
      signature: null, createdAt: new Date().toISOString(),
    };
    csColl(s, "proposals", csActor(ctx)).push(proposal); saveConsulting();
    return { ok: true, result: { proposal } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "proposal-list", (ctx, _a, _p = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const proposals = csColl(s, "proposals", csActor(ctx)).map((p) => {
      const filled = p.sections.filter((sec) => sec.content && sec.content.trim()).length;
      return { ...p, completeness: p.sections.length ? Math.round((filled / p.sections.length) * 100) : 0 };
    });
    return { ok: true, result: { proposals, count: proposals.length } };
  });
  registerLensAction("consulting", "proposal-update-section", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = csColl(s, "proposals", csActor(ctx)).find((x) => x.id === params.id);
    if (!p) return { ok: false, error: "proposal not found" };
    const sec = p.sections.find((x) => x.key === params.sectionKey);
    if (!sec) return { ok: false, error: "section not found" };
    sec.content = csClean(params.content, 4000);
    saveConsulting();
    return { ok: true, result: { proposal: p } };
  });
  registerLensAction("consulting", "proposal-sign", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = csColl(s, "proposals", csActor(ctx)).find((x) => x.id === params.id);
    if (!p) return { ok: false, error: "proposal not found" };
    const signer = csClean(params.signerName, 120);
    if (!signer) return { ok: false, error: "signer name required" };
    p.signature = { signerName: signer, signedAt: new Date().toISOString(),
      ip: csClean(params.ip, 60) || "client-portal" };
    p.status = "accepted";
    saveConsulting();
    return { ok: true, result: { proposal: p } };
  });
  registerLensAction("consulting", "proposal-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csColl(s, "proposals", csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "proposal not found" };
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });

  // ═══════════════════════════════════════════════════════════════════
  // [M] Resource / staffing planner — allocate consultants over time
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "consultant-create", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = csClean(params.name, 120);
    if (!name) return { ok: false, error: "consultant name required" };
    const consultant = {
      id: csId("con"), name, role: csClean(params.role, 80) || "Consultant",
      weeklyCapacity: csNum(params.weeklyCapacity) > 0 ? csNum(params.weeklyCapacity) : 40,
      costRate: Math.max(0, csNum(params.costRate)), createdAt: new Date().toISOString(),
    };
    csColl(s, "consultants", csActor(ctx)).push(consultant); saveConsulting();
    return { ok: true, result: { consultant } };
  });
  registerLensAction("consulting", "consultant-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const arr = csColl(s, "consultants", u);
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "consultant not found" };
    arr.splice(i, 1);
    const allocs = csColl(s, "allocations", u);
    for (let j = allocs.length - 1; j >= 0; j--) if (allocs[j].consultantId === params.id) allocs.splice(j, 1);
    saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("consulting", "allocation-create", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const consultant = csColl(s, "consultants", u).find((x) => x.id === params.consultantId);
    if (!consultant) return { ok: false, error: "consultant not found" };
    const eng = csEng(s, u).find((x) => x.id === params.engagementId);
    if (!eng) return { ok: false, error: "engagement not found" };
    const week = csClean(params.week, 20);
    if (!week) return { ok: false, error: "week required (e.g. 2026-W21)" };
    const hours = csNum(params.hours);
    if (hours <= 0) return { ok: false, error: "hours must be positive" };
    const alloc = { id: csId("alloc"), consultantId: consultant.id, engagementId: eng.id,
      week, hours, createdAt: new Date().toISOString() };
    csColl(s, "allocations", u).push(alloc); saveConsulting();
    return { ok: true, result: { allocation: alloc } };
  });
  registerLensAction("consulting", "allocation-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csColl(s, "allocations", csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "allocation not found" };
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("consulting", "staffing-plan", (ctx, _a, _p = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const consultants = csColl(s, "consultants", u);
    const allocs = csColl(s, "allocations", u);
    const engs = csEng(s, u);
    const rows = consultants.map((c) => {
      const own = allocs.filter((a) => a.consultantId === c.id);
      const weeks = {};
      for (const a of own) weeks[a.week] = (weeks[a.week] || 0) + a.hours;
      const byWeek = Object.entries(weeks).map(([week, hours]) => ({
        week, hours, capacity: c.weeklyCapacity,
        utilizationPct: c.weeklyCapacity > 0 ? Math.round((hours / c.weeklyCapacity) * 100) : 0,
        overbooked: hours > c.weeklyCapacity,
      })).sort((x, y) => x.week.localeCompare(y.week));
      return { consultantId: c.id, name: c.name, role: c.role, weeklyCapacity: c.weeklyCapacity, byWeek };
    });
    const allocations = allocs.map((a) => ({
      ...a,
      consultantName: (consultants.find((c) => c.id === a.consultantId) || {}).name || "—",
      engagementName: (engs.find((e) => e.id === a.engagementId) || {}).name || "—",
    }));
    return { ok: true, result: { rows, allocations, consultants: consultants.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════════
  // [M] Expense tracking + reimbursables attached to engagements
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "expense-create", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const eng = csEng(s, u).find((x) => x.id === params.engagementId);
    if (!eng) return { ok: false, error: "engagement not found" };
    const amount = csNum(params.amount);
    if (amount <= 0) return { ok: false, error: "amount must be positive" };
    const desc = csClean(params.description, 200);
    if (!desc) return { ok: false, error: "description required" };
    const expense = {
      id: csId("exp"), engagementId: eng.id, engagementName: eng.name,
      description: desc, category: csClean(params.category, 60) || "General",
      amount: csRound2(amount), reimbursable: params.reimbursable !== false,
      status: "pending", date: csClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    csColl(s, "expenses", u).push(expense); saveConsulting();
    return { ok: true, result: { expense } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "expense-list", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let expenses = csColl(s, "expenses", csActor(ctx));
    if (params.engagementId) expenses = expenses.filter((e) => e.engagementId === params.engagementId);
    const total = csRound2(expenses.reduce((n, e) => n + e.amount, 0));
    const reimbursable = csRound2(expenses.filter((e) => e.reimbursable).reduce((n, e) => n + e.amount, 0));
    const approved = csRound2(expenses.filter((e) => e.status === "approved").reduce((n, e) => n + e.amount, 0));
    return { ok: true, result: { expenses, count: expenses.length, total, reimbursable, approved } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "expense-update", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = csColl(s, "expenses", csActor(ctx)).find((x) => x.id === params.id);
    if (!e) return { ok: false, error: "expense not found" };
    if (params.status && ["pending", "approved", "rejected", "reimbursed"].includes(params.status)) e.status = params.status;
    if (params.amount != null && csNum(params.amount) > 0) e.amount = csRound2(csNum(params.amount));
    if (params.reimbursable != null) e.reimbursable = !!params.reimbursable;
    saveConsulting();
    return { ok: true, result: { expense: e } };
  });
  registerLensAction("consulting", "expense-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csColl(s, "expenses", csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "expense not found" };
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });

  // ═══════════════════════════════════════════════════════════════════
  // [S] Live start/stop timer
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "timer-start", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const eng = csEng(s, u).find((x) => x.id === params.engagementId);
    if (!eng) return { ok: false, error: "engagement not found" };
    if (!(s.timers instanceof Map)) s.timers = new Map();
    if (s.timers.get(u)) return { ok: false, error: "timer already running" };
    const timer = { engagementId: eng.id, engagementName: eng.name,
      note: csClean(params.note, 300) || "", startedAt: Date.now() };
    s.timers.set(u, timer); saveConsulting();
    return { ok: true, result: { timer } };
  });
  registerLensAction("consulting", "timer-status", (ctx, _a, _p = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.timers instanceof Map)) s.timers = new Map();
    const timer = s.timers.get(csActor(ctx));
    if (!timer) return { ok: true, result: { running: false } };
    return { ok: true, result: { running: true, timer,
      elapsedHours: csRound2((Date.now() - timer.startedAt) / 3600000) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "timer-stop", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    if (!(s.timers instanceof Map)) s.timers = new Map();
    const timer = s.timers.get(u);
    if (!timer) return { ok: false, error: "no timer running" };
    const eng = csEng(s, u).find((x) => x.id === timer.engagementId);
    if (!eng) { s.timers.delete(u); return { ok: false, error: "engagement no longer exists" }; }
    const hours = Math.max(0.01, csRound2((Date.now() - timer.startedAt) / 3600000));
    const entry = { id: csId("te"), hours, note: csClean(params.note, 300) || timer.note,
      date: new Date().toISOString().slice(0, 10) };
    eng.timeEntries.push(entry); s.timers.delete(u); saveConsulting();
    return { ok: true, result: { entry, billed: Math.round(hours * eng.rate) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "timer-cancel", (ctx, _a, _p = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.timers instanceof Map)) s.timers = new Map();
    s.timers.delete(csActor(ctx)); saveConsulting();
    return { ok: true, result: { cancelled: true } };
  });

  // ═══════════════════════════════════════════════════════════════════
  // [M] Retainer / recurring-billing support
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "retainer-create", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const client = csClean(params.client, 160);
    if (!client) return { ok: false, error: "client required" };
    const amount = csNum(params.monthlyAmount);
    if (amount <= 0) return { ok: false, error: "monthlyAmount must be positive" };
    const cadence = ["weekly", "monthly", "quarterly"].includes(params.cadence) ? params.cadence : "monthly";
    const retainer = {
      id: csId("ret"), client, label: csClean(params.label, 120) || `${client} retainer`,
      monthlyAmount: csRound2(amount), cadence,
      includedHours: Math.max(0, csNum(params.includedHours)),
      status: "active", periods: [], nextBillDate: csClean(params.startDate, 30) || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    csColl(s, "retainers", csActor(ctx)).push(retainer); saveConsulting();
    return { ok: true, result: { retainer } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "retainer-list", (ctx, _a, _p = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const retainers = csColl(s, "retainers", csActor(ctx));
    const mrr = csRound2(retainers.filter((r) => r.status === "active").reduce((n, r) => {
      const mult = r.cadence === "weekly" ? 4.33 : r.cadence === "quarterly" ? 1 / 3 : 1;
      return n + r.monthlyAmount * mult;
    }, 0));
    return { ok: true, result: { retainers, count: retainers.length, mrr } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "retainer-bill", (ctx, _a, params = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = csColl(s, "retainers", csActor(ctx)).find((x) => x.id === params.id);
    if (!r) return { ok: false, error: "retainer not found" };
    const period = {
      id: csId("rp"), amount: r.monthlyAmount, hoursUsed: Math.max(0, csNum(params.hoursUsed)),
      includedHours: r.includedHours,
      billedAt: csClean(params.billedAt, 30) || new Date().toISOString().slice(0, 10),
      status: "billed",
    };
    period.overageHours = Math.max(0, period.hoursUsed - r.includedHours);
    r.periods.push(period);
    // advance nextBillDate
    const days = r.cadence === "weekly" ? 7 : r.cadence === "quarterly" ? 91 : 30;
    r.nextBillDate = new Date(new Date(r.nextBillDate + "T00:00:00Z").getTime() + days * 86400000)
      .toISOString().slice(0, 10);
    saveConsulting();
    return { ok: true, result: { retainer: r, period } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("consulting", "retainer-update", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = csColl(s, "retainers", csActor(ctx)).find((x) => x.id === params.id);
    if (!r) return { ok: false, error: "retainer not found" };
    if (params.status && ["active", "paused", "ended"].includes(params.status)) r.status = params.status;
    if (params.monthlyAmount != null && csNum(params.monthlyAmount) > 0) r.monthlyAmount = csRound2(csNum(params.monthlyAmount));
    saveConsulting();
    return { ok: true, result: { retainer: r } };
  });
  registerLensAction("consulting", "retainer-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csColl(s, "retainers", csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "retainer not found" };
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });

  // ═══════════════════════════════════════════════════════════════════
  // [S] Project profitability report — cost vs billed margin
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "profitability-report", (ctx, _a, _p = {}) => {
  try {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const engs = csEng(s, u);
    const expenses = csColl(s, "expenses", u);
    const consultants = csColl(s, "consultants", u);
    const allocs = csColl(s, "allocations", u);
    // Blended internal cost rate: average of consultant costRates, fallback 60% of bill rate.
    const avgCostRate = consultants.length
      ? consultants.reduce((n, c) => n + c.costRate, 0) / consultants.length : 0;
    const rows = engs.map((e) => {
      const hours = e.timeEntries.reduce((n, t) => n + t.hours, 0);
      const billed = csRound2(hours * e.rate);
      const engExpenses = csRound2(expenses.filter((x) => x.engagementId === e.id).reduce((n, x) => n + x.amount, 0));
      const allocHours = allocs.filter((a) => a.engagementId === e.id).reduce((n, a) => n + a.hours, 0);
      const costRate = avgCostRate > 0 ? avgCostRate : csRound2(e.rate * 0.6);
      const laborCost = csRound2((hours || allocHours) * costRate);
      const totalCost = csRound2(laborCost + engExpenses);
      const margin = csRound2(billed - totalCost);
      const marginPct = billed > 0 ? Math.round((margin / billed) * 100) : 0;
      return { engagementId: e.id, name: e.name, client: e.client, hours, billed,
        laborCost, expenses: engExpenses, totalCost, margin, marginPct,
        health: marginPct >= 40 ? "healthy" : marginPct >= 15 ? "thin" : "loss-making" };
    });
    const totalBilled = csRound2(rows.reduce((n, r) => n + r.billed, 0));
    const totalCost = csRound2(rows.reduce((n, r) => n + r.totalCost, 0));
    const totalMargin = csRound2(totalBilled - totalCost);
    return { ok: true, result: { rows, totalBilled, totalCost, totalMargin,
      overallMarginPct: totalBilled > 0 ? Math.round((totalMargin / totalBilled) * 100) : 0 } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════════
  // [M] Client portal — shared deliverables + external approvals
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("consulting", "portal-share", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = csActor(ctx);
    const title = csClean(params.title, 160);
    if (!title) return { ok: false, error: "deliverable title required" };
    let engagementName = "";
    if (params.engagementId) {
      const eng = csEng(s, u).find((x) => x.id === params.engagementId);
      if (!eng) return { ok: false, error: "engagement not found" };
      engagementName = eng.name;
    }
    const item = {
      id: csId("share"), title, engagementId: params.engagementId || null, engagementName,
      client: csClean(params.client, 160) || "Unspecified",
      summary: csClean(params.summary, 1000),
      link: csClean(params.link, 500),
      shareToken: csId("tok"), approvalStatus: "awaiting",
      approvalNote: "", approvedBy: "", approvedAt: null,
      sharedAt: new Date().toISOString(),
    };
    csColl(s, "shares", u).push(item); saveConsulting();
    return { ok: true, result: { share: item } };
  });
  registerLensAction("consulting", "portal-list", (ctx, _a, _p = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const shares = csColl(s, "shares", csActor(ctx));
    return { ok: true, result: { shares, count: shares.length,
      awaiting: shares.filter((x) => x.approvalStatus === "awaiting").length,
      approved: shares.filter((x) => x.approvalStatus === "approved").length } };
  });
  registerLensAction("consulting", "portal-respond", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = csColl(s, "shares", csActor(ctx)).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "shared item not found" };
    const decision = ["approved", "rejected", "changes-requested"].includes(params.decision)
      ? params.decision : null;
    if (!decision) return { ok: false, error: "decision must be approved|rejected|changes-requested" };
    item.approvalStatus = decision;
    item.approvalNote = csClean(params.note, 1000);
    item.approvedBy = csClean(params.respondedBy, 120) || "Client";
    item.approvedAt = new Date().toISOString();
    saveConsulting();
    return { ok: true, result: { share: item } };
  });
  registerLensAction("consulting", "portal-delete", (ctx, _a, params = {}) => {
    const s = getConsultingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = csColl(s, "shares", csActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "shared item not found" };
    arr.splice(i, 1); saveConsulting();
    return { ok: true, result: { deleted: params.id } };
  });
}
