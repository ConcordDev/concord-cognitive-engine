// server/domains/consulting.js
export default function registerConsultingActions(registerLensAction) {
  registerLensAction("consulting", "engagementScope", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const deliverables = data.deliverables || [];
    const rate = parseFloat(data.hourlyRate) || 200;
    const hours = deliverables.reduce((s, d) => s + (parseFloat(d.hours) || 8), 0);
    const totalFee = Math.round(hours * rate * 100) / 100;
    const contingency = Math.round(totalFee * 0.15 * 100) / 100;
    return { ok: true, result: { client: data.client || artifact.title, deliverables: deliverables.map(d => ({ name: d.name, hours: parseFloat(d.hours) || 8, fee: Math.round((parseFloat(d.hours) || 8) * rate * 100) / 100 })), totalHours: hours, hourlyRate: rate, subtotal: totalFee, contingency, grandTotal: Math.round((totalFee + contingency) * 100) / 100, timeline: `${Math.ceil(hours / 40)} weeks at full-time` } };
  });
  registerLensAction("consulting", "utilizationRate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const billableHours = parseFloat(data.billableHours) || 0;
    const totalHours = parseFloat(data.totalHours) || 40;
    const rate = billableHours / totalHours;
    return { ok: true, result: { billableHours, totalHours, utilizationRate: Math.round(rate * 100), target: 75, variance: Math.round(rate * 100) - 75, status: rate >= 0.8 ? "excellent" : rate >= 0.65 ? "on-target" : rate >= 0.5 ? "below-target" : "critical" } };
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
    const nps = parseInt(data.nps) || 0;
    const invoicesPaid = parseInt(data.invoicesPaid) || 0;
    const invoicesTotal = parseInt(data.invoicesTotal) || 1;
    const responseTime = parseFloat(data.avgResponseDays) || 3;
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
}
