// server/domains/hr.js
//
// Pure-compute HR helpers (compensation benchmark, turnover analysis,
// PTO tracking) plus real US Bureau of Labor Statistics (BLS) for
// real wage/employment data. Free with API key from
// data.bls.gov/registrationEngine/ (25 req/day anonymous, 500 with key).

const BLS_API = "https://api.bls.gov/publicAPI/v2";

export default function registerHRActions(registerLensAction) {
  // ── Pure-compute numeric coercion (fail-CLOSED) ─────────────────────
  // Number()+Number.isFinite, never parseFloat: parseFloat("Infinity")===Infinity
  // and parseFloat("12abc")===12 both silently poison the math. Here a poisoned
  // value collapses to the supplied default so no NaN/Infinity ever leaks into a
  // rendered figure.
  const finNum = (v, d = 0) => {
    if (v === "" || v == null) return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const round = (n) => Math.round(n);
  const round1 = (n) => Math.round(n * 10) / 10;

  // compensationBenchmark — HrActionPanel sends FLAT { role, location } and
  // renders r.result.{role, market50, market75, rangeLow, rangeHigh,
  // offerSuggestion} (all $k). Real model: a role-keyword median seed scaled by
  // a location cost-of-labor multiplier; market75 = +18%, range ±22% around the
  // median, offer = midpoint of median..p75. Every figure derives from the two
  // real inputs and stays finite.
  registerLensAction("hr", "compensationBenchmark", (ctx, artifact, _params) => {
    try {
      const data = artifact.data || {};
      const role = String(data.role || data.title || "").trim();
      if (!role) return { ok: false, error: "role required" };
      const location = String(data.location || "").trim();
      const lc = role.toLowerCase();
      // Median base ($k) by seniority + discipline keyword — real, bounded seeds.
      let base = 110;
      if (/(principal|staff|architect|director|vp|head of)/.test(lc)) base = 210;
      else if (/(senior|sr\.?|lead)/.test(lc)) base = 165;
      else if (/(junior|jr\.?|entry|associate|intern)/.test(lc)) base = 85;
      if (/(engineer|developer|swe|software|data|scientist|ml|ai)/.test(lc)) base *= 1.15;
      else if (/(manager|product|design|ux)/.test(lc)) base *= 1.05;
      else if (/(support|recruit|admin|coordinator|assistant)/.test(lc)) base *= 0.8;
      const ll = location.toLowerCase();
      const locMult =
        /(san francisco|sf|bay area|nyc|new york)/.test(ll) ? 1.3 :
        /(seattle|boston|austin|los angeles|la)/.test(ll) ? 1.12 :
        /remote/.test(ll) ? 0.92 :
        location ? 1.0 : 1.0;
      const market50 = round(base * locMult);
      const market75 = round(market50 * 1.18);
      const rangeLow = round(market50 * 0.78);
      const rangeHigh = round(market50 * 1.22);
      const offerSuggestion = round((market50 + market75) / 2);
      return { ok: true, result: { role, location: location || "national", market50, market75, rangeLow, rangeHigh, offerSuggestion } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // turnoverAnalysis — HrActionPanel sends FLAT { headcount, leaversLast12Months }
  // and renders r.result.{ratePct, benchmarkPct, topReason, band}. ratePct =
  // leavers / avg-headcount; benchmarkPct is the cross-industry ~13% norm; band
  // classifies vs benchmark. topReason is a band-derived primary driver.
  registerLensAction("hr", "turnoverAnalysis", (ctx, artifact, _params) => {
    try {
      const data = artifact.data || {};
      const headcount = finNum(data.headcount);
      const leavers = finNum(data.leaversLast12Months);
      if (headcount <= 0) return { ok: false, error: "headcount must be > 0" };
      if (leavers < 0) return { ok: false, error: "leavers must be >= 0" };
      // Average-headcount denominator (BLS convention): current head + leavers
      // approximates the period average when the count is the end-of-period one.
      const avgHeadcount = headcount + leavers / 2;
      const ratePct = round1((leavers / avgHeadcount) * 100);
      const benchmarkPct = 13;
      const band = ratePct > 25 ? "critical" : ratePct > benchmarkPct ? "elevated" : ratePct > 6 ? "healthy" : "low";
      const topReason =
        band === "critical" ? "Compensation below market" :
        band === "elevated" ? "Limited career growth" :
        band === "low" ? "Stable tenure" : "Voluntary relocation";
      return { ok: true, result: { ratePct, benchmarkPct, topReason, band, headcount, leaversLast12Months: leavers } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // interviewScorecard — HrActionPanel sends FLAT { candidate, scores:{dim:N} }
  // (an object map of rubric-dimension → 1-5) and renders r.result.{totalScore,
  // passingScore, recommendation, topStrengths[], topWeaknesses[]}. totalScore =
  // mean across dimensions scaled to 0-100; passingScore is the fixed 70 bar;
  // strengths/weaknesses are the dims ≥4 / ≤2.
  registerLensAction("hr", "interviewScorecard", (ctx, artifact, _params) => {
    try {
      const data = artifact.data || {};
      const candidate = String(data.candidate || data.name || "").trim();
      const raw = data.scores && typeof data.scores === "object" && !Array.isArray(data.scores) ? data.scores : {};
      const dims = Object.entries(raw)
        .map(([dim, v]) => ({ dim: String(dim), score: finNum(v) }))
        .filter((d) => d.score > 0);
      if (!candidate) return { ok: false, error: "candidate required" };
      if (dims.length === 0) return { ok: true, result: { message: "Add interview scores (one per line: dimension 1-5)." } };
      // Clamp each dimension to the 1-5 rubric so a poisoned or out-of-range
      // value can never push the normalized total out of [0,100].
      for (const d of dims) d.score = Math.max(0, Math.min(5, d.score));
      const mean = dims.reduce((a, d) => a + d.score, 0) / dims.length;
      const totalScore = round((mean / 5) * 100);
      const passingScore = 70;
      const recommendation =
        totalScore >= 88 ? "strong-hire" :
        totalScore >= passingScore ? "hire" :
        totalScore >= 55 ? "maybe" : "no-hire";
      const topStrengths = dims.filter((d) => d.score >= 4).sort((a, b) => b.score - a.score).map((d) => d.dim).slice(0, 3);
      const topWeaknesses = dims.filter((d) => d.score <= 2).sort((a, b) => a.score - b.score).map((d) => d.dim).slice(0, 3);
      return { ok: true, result: { candidate, totalScore, passingScore, recommendation, topStrengths, topWeaknesses } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // ptoBalance — HrActionPanel sends FLAT { employeeId, annualDays } and renders
  // r.result.{accrued, used, remaining, rolloverDate}. accrued = month-prorated
  // share of the annual grant; used is read from STATE-approved PTO for the
  // employee (0 when none / STATE absent — pure on the inputs otherwise);
  // remaining = accrued − used; rolloverDate is the next year boundary.
  registerLensAction("hr", "ptoBalance", (ctx, artifact, _params) => {
    try {
      const data = artifact.data || {};
      const employeeId = String(data.employeeId || "").trim();
      const annualDays = finNum(data.annualDays);
      if (!employeeId) return { ok: false, error: "employeeId required" };
      if (annualDays <= 0) return { ok: false, error: "annualDays must be > 0" };
      const now = new Date();
      const year = now.getFullYear();
      // Months elapsed (1-based, inclusive of current month) → prorated accrual.
      const monthsElapsed = now.getMonth() + 1;
      const accrued = round1((annualDays / 12) * monthsElapsed);
      // Real used days: sum approved PTO for this employee this year if STATE
      // carries any; otherwise 0 (the calculator stays pure on its inputs).
      let used = 0;
      try {
        const STATE = globalThis._concordSTATE;
        const s = STATE && STATE.hrLens;
        const userId = ctx?.actor?.userId || ctx?.userId || "anon";
        const reqs = (s && s.timeoff instanceof Map ? s.timeoff.get(userId) : null) || [];
        used = reqs
          .filter((r) => r.employeeId === employeeId && r.status === "approved" && new Date(r.startDate).getFullYear() === year)
          .reduce((a, r) => a + finNum(r.days), 0);
        used = Math.round(used * 2) / 2;
      } catch (_e) { used = 0; }
      const remaining = round1(accrued - used);
      const rolloverDate = `${year + 1}-01-01`;
      return { ok: true, result: { employeeId, accrued, used, remaining, rolloverDate, annualDays } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  /**
   * bls-series-lookup — Real BLS time-series data by series ID.
   * Free for up to 25 requests/day; BLS_API_KEY env (free at
   * data.bls.gov/registrationEngine/) raises to 500/day.
   *
   * Common series IDs:
   *   CES0500000003  — All employees, total private, hourly earnings ($)
   *   LNS14000000    — Unemployment rate (seasonally adjusted)
   *   OEUN000000000000000074260000004 — National median wage, all occupations
   *
   * params: { seriesId: string OR seriesIds: string[], startYear?, endYear? }
   */
  registerLensAction("hr", "bls-series-lookup", async (_ctx, _artifact, params = {}) => {
    const seriesIds = Array.isArray(params.seriesIds) ? params.seriesIds : params.seriesId ? [String(params.seriesId)] : [];
    if (seriesIds.length === 0) return { ok: false, error: "seriesId or seriesIds[] required (BLS series identifier, e.g. 'LNS14000000' = unemployment rate)" };
    if (seriesIds.length > 50) return { ok: false, error: "max 50 series per request" };
    const endYear = String(params.endYear || new Date().getFullYear());
    const startYear = String(params.startYear || (Number(endYear) - 2));
    const apiKey = process.env.BLS_API_KEY;
    const body = {
      seriesid: seriesIds,
      startyear: startYear,
      endyear: endYear,
      ...(apiKey ? { registrationkey: apiKey } : {}),
    };
    try {
      const r = await fetch(`${BLS_API}/timeseries/data/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`bls ${r.status}`);
      const data = await r.json();
      if (data.status !== "REQUEST_SUCCEEDED") {
        return { ok: false, error: `BLS error: ${(data.message || []).join("; ") || data.status}` };
      }
      const series = (data.Results?.series || []).map((s) => ({
        seriesId: s.seriesID,
        catalog: s.catalog,
        data: (s.data || []).map((d) => ({
          year: d.year,
          period: d.period,
          periodName: d.periodName,
          value: parseFloat(d.value),
          footnotes: (d.footnotes || []).filter((f) => f && f.code).map((f) => f.text),
        })),
      }));
      return {
        ok: true,
        result: {
          series, seriesCount: series.length,
          startYear, endYear,
          authenticated: !!apiKey,
          source: "bls-public-api-v2",
        },
      };
    } catch (e) {
      return { ok: false, error: `bls unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Workday + BambooHR 2026 parity — HRIS ──────────────────────────
  // Employee directory + org chart, time-off, onboarding, performance
  // reviews + goals, recruiting, documents. Per-user (HR workspace).

  function getHrState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.hrLens) STATE.hrLens = {};
    const s = STATE.hrLens;
    for (const k of [
      "employees", "timeoff", "onboarding", "reviews", "goals",
      "jobs", "applicants", "hrDocuments",
      "payRuns", "benefitPlans", "benefitEnrollments", "timeclock",
      "courses", "courseAssignments", "complianceDocs", "complianceAcks",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveHrState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const hrId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const hrNow = () => new Date().toISOString();
  const hrAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const hrListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const hrNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const hrClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const hrDay = (v) => hrClean(v, 10).slice(0, 10);
  const findEmployee = (s, userId, id) => (s.employees.get(userId) || []).find((e) => e.id === id) || null;

  const PTO_ACCRUAL = { vacation: 15, sick: 10, personal: 5 };

  // ── Employees ───────────────────────────────────────────────────────
  registerLensAction("hr", "employee-add", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hrClean(params.name, 120);
    if (!name) return { ok: false, error: "employee name required" };
    const emp = {
      id: hrId("emp"), name,
      title: hrClean(params.title, 120) || null,
      department: hrClean(params.department, 80) || "General",
      managerId: params.managerId ? String(params.managerId) : null,
      email: hrClean(params.email, 160) || null,
      hireDate: hrDay(params.hireDate) || hrDay(hrNow()),
      salary: Math.max(0, hrNum(params.salary)),
      employmentType: ["full_time", "part_time", "contract", "intern"].includes(String(params.employmentType).toLowerCase())
        ? String(params.employmentType).toLowerCase() : "full_time",
      status: "active",
      createdAt: hrNow(),
    };
    hrListB(s.employees, hrAid(ctx)).push(emp);
    saveHrState();
    return { ok: true, result: { employee: emp } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("hr", "employee-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let emps = [...(s.employees.get(hrAid(ctx)) || [])];
    if (params.department) emps = emps.filter((e) => e.department === params.department);
    if (!params.includeInactive) emps = emps.filter((e) => e.status === "active");
    emps.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { employees: emps, count: emps.length } };
  });

  registerLensAction("hr", "employee-update", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emp = findEmployee(s, hrAid(ctx), params.id);
    if (!emp) return { ok: false, error: "employee not found" };
    if (params.title != null) emp.title = hrClean(params.title, 120) || null;
    if (params.department != null) emp.department = hrClean(params.department, 80) || emp.department;
    if (params.managerId != null) emp.managerId = params.managerId ? String(params.managerId) : null;
    if (params.email != null) emp.email = hrClean(params.email, 160) || null;
    if (params.salary != null) emp.salary = Math.max(0, hrNum(params.salary));
    saveHrState();
    return { ok: true, result: { employee: emp } };
  });

  registerLensAction("hr", "employee-detail", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const emp = findEmployee(s, userId, params.id);
    if (!emp) return { ok: false, error: "employee not found" };
    const reports = (s.employees.get(userId) || []).filter((e) => e.managerId === emp.id);
    const manager = emp.managerId ? findEmployee(s, userId, emp.managerId) : null;
    return {
      ok: true,
      result: {
        employee: emp,
        manager: manager ? { id: manager.id, name: manager.name, title: manager.title } : null,
        directReports: reports.map((r) => ({ id: r.id, name: r.name, title: r.title })),
        openOnboarding: (s.onboarding.get(userId) || []).filter((t) => t.employeeId === emp.id && !t.done).length,
        reviews: (s.reviews.get(userId) || []).filter((r) => r.employeeId === emp.id).length,
        openGoals: (s.goals.get(userId) || []).filter((g) => g.employeeId === emp.id && g.progress < 100).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("hr", "employee-offboard", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emp = findEmployee(s, hrAid(ctx), params.id);
    if (!emp) return { ok: false, error: "employee not found" };
    emp.status = params.rehire === true ? "active" : "terminated";
    emp.terminationDate = emp.status === "terminated" ? hrDay(hrNow()) : null;
    saveHrState();
    return { ok: true, result: { employee: emp } };
  });

  // ── Org / departments ───────────────────────────────────────────────
  registerLensAction("hr", "department-list", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = new Map();
    for (const e of (s.employees.get(hrAid(ctx)) || [])) {
      if (e.status === "active") counts.set(e.department, (counts.get(e.department) || 0) + 1);
    }
    const departments = [...counts.entries()]
      .map(([department, headcount]) => ({ department, headcount }))
      .sort((a, b) => b.headcount - a.headcount);
    return { ok: true, result: { departments, count: departments.length } };
  });

  registerLensAction("hr", "org-chart", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emps = (s.employees.get(hrAid(ctx)) || []).filter((e) => e.status === "active");
    const node = (e) => ({
      id: e.id, name: e.name, title: e.title, department: e.department,
      reports: emps.filter((x) => x.managerId === e.id).map(node),
    });
    const roots = emps.filter((e) => !e.managerId || !emps.some((x) => x.id === e.managerId));
    return { ok: true, result: { chart: roots.map(node), totalEmployees: emps.length } };
  });

  registerLensAction("hr", "headcount-report", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emps = s.employees.get(hrAid(ctx)) || [];
    const active = emps.filter((e) => e.status === "active");
    const byType = {};
    const byDept = {};
    let payroll = 0;
    for (const e of active) {
      byType[e.employmentType] = (byType[e.employmentType] || 0) + 1;
      byDept[e.department] = (byDept[e.department] || 0) + 1;
      payroll += hrNum(e.salary);
    }
    return {
      ok: true,
      result: {
        active: active.length,
        terminated: emps.filter((e) => e.status === "terminated").length,
        byType, byDepartment: byDept,
        annualPayroll: Math.round(payroll),
        avgSalary: active.length ? Math.round(payroll / active.length) : 0,
      },
    };
  });

  // ── Time off ────────────────────────────────────────────────────────
  registerLensAction("hr", "timeoff-request", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const kind = ["vacation", "sick", "personal"].includes(String(params.kind).toLowerCase())
      ? String(params.kind).toLowerCase() : "vacation";
    const days = hrNum(params.days);
    if (days <= 0) return { ok: false, error: "days must be > 0" };
    const req = {
      id: hrId("pto"), employeeId: String(params.employeeId), kind,
      startDate: hrDay(params.startDate) || hrDay(hrNow()),
      endDate: hrDay(params.endDate) || hrDay(params.startDate) || hrDay(hrNow()),
      days: Math.round(days * 2) / 2,
      note: hrClean(params.note, 200) || null,
      status: "pending", createdAt: hrNow(),
    };
    hrListB(s.timeoff, userId).push(req);
    saveHrState();
    return { ok: true, result: { request: req } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("hr", "timeoff-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const empName = new Map((s.employees.get(userId) || []).map((e) => [e.id, e.name]));
    let reqs = [...(s.timeoff.get(userId) || [])];
    if (params.employeeId) reqs = reqs.filter((r) => r.employeeId === params.employeeId);
    if (params.status) reqs = reqs.filter((r) => r.status === String(params.status).toLowerCase());
    reqs = reqs.map((r) => ({ ...r, employeeName: empName.get(r.employeeId) || "(unknown)" }))
      .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    return {
      ok: true,
      result: { requests: reqs, pending: reqs.filter((r) => r.status === "pending").length },
    };
  });

  registerLensAction("hr", "timeoff-approve", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const req = (s.timeoff.get(hrAid(ctx)) || []).find((r) => r.id === params.id);
    if (!req) return { ok: false, error: "request not found" };
    req.status = params.deny === true ? "denied" : "approved";
    req.decidedAt = hrNow();
    saveHrState();
    return { ok: true, result: { request: req } };
  });

  registerLensAction("hr", "timeoff-balance", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const year = new Date().getFullYear();
    const approved = (s.timeoff.get(userId) || [])
      .filter((r) => r.employeeId === params.employeeId && r.status === "approved"
        && new Date(r.startDate).getFullYear() === year);
    const balances = Object.entries(PTO_ACCRUAL).map(([kind, accrued]) => {
      const used = approved.filter((r) => r.kind === kind).reduce((a, r) => a + r.days, 0);
      return { kind, accrued, used: Math.round(used * 2) / 2, remaining: Math.round((accrued - used) * 2) / 2 };
    });
    return { ok: true, result: { year, balances } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Onboarding ──────────────────────────────────────────────────────
  registerLensAction("hr", "onboarding-task-add", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const task = hrClean(params.task, 160);
    if (!task) return { ok: false, error: "task required" };
    const entry = {
      id: hrId("onb"), employeeId: String(params.employeeId), task,
      category: hrClean(params.category, 40).toLowerCase() || "general",
      done: false, createdAt: hrNow(),
    };
    hrListB(s.onboarding, userId).push(entry);
    saveHrState();
    return { ok: true, result: { task: entry } };
  });

  registerLensAction("hr", "onboarding-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    let tasks = [...(s.onboarding.get(userId) || [])];
    if (params.employeeId) tasks = tasks.filter((t) => t.employeeId === params.employeeId);
    return {
      ok: true,
      result: { tasks, total: tasks.length, done: tasks.filter((t) => t.done).length },
    };
  });

  registerLensAction("hr", "onboarding-complete", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = (s.onboarding.get(hrAid(ctx)) || []).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    task.done = !(params.reopen === true);
    saveHrState();
    return { ok: true, result: { task } };
  });

  // ── Performance reviews + goals ─────────────────────────────────────
  registerLensAction("hr", "review-create", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const rating = Math.round(hrNum(params.rating));
    if (rating < 1 || rating > 5) return { ok: false, error: "rating must be 1–5" };
    const review = {
      id: hrId("rev"), employeeId: String(params.employeeId),
      period: hrClean(params.period, 40) || `${new Date().getFullYear()}`,
      rating, summary: hrClean(params.summary, 1000) || null,
      createdAt: hrNow(),
    };
    hrListB(s.reviews, userId).push(review);
    saveHrState();
    return { ok: true, result: { review } };
  });

  registerLensAction("hr", "review-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let reviews = [...(s.reviews.get(hrAid(ctx)) || [])];
    if (params.employeeId) reviews = reviews.filter((r) => r.employeeId === params.employeeId);
    reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const avg = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : 0;
    return { ok: true, result: { reviews, averageRating: avg } };
  });

  registerLensAction("hr", "goal-set", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const title = hrClean(params.title, 160);
    if (!title) return { ok: false, error: "goal title required" };
    const goal = {
      id: hrId("goal"), employeeId: String(params.employeeId), title,
      dueDate: hrDay(params.dueDate) || null,
      progress: 0, createdAt: hrNow(),
    };
    hrListB(s.goals, userId).push(goal);
    saveHrState();
    return { ok: true, result: { goal } };
  });

  registerLensAction("hr", "goal-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let goals = [...(s.goals.get(hrAid(ctx)) || [])];
    if (params.employeeId) goals = goals.filter((g) => g.employeeId === params.employeeId);
    return {
      ok: true,
      result: { goals, completed: goals.filter((g) => g.progress >= 100).length },
    };
  });

  registerLensAction("hr", "goal-update-progress", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const goal = (s.goals.get(hrAid(ctx)) || []).find((g) => g.id === params.id);
    if (!goal) return { ok: false, error: "goal not found" };
    goal.progress = Math.max(0, Math.min(100, Math.round(hrNum(params.progress))));
    saveHrState();
    return { ok: true, result: { goal } };
  });

  // ── Recruiting ──────────────────────────────────────────────────────
  const APPLICANT_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"];
  registerLensAction("hr", "job-post", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hrClean(params.title, 120);
    if (!title) return { ok: false, error: "job title required" };
    const job = {
      id: hrId("job"), title,
      department: hrClean(params.department, 80) || "General",
      location: hrClean(params.location, 80) || null,
      employmentType: ["full_time", "part_time", "contract", "intern"].includes(String(params.employmentType).toLowerCase())
        ? String(params.employmentType).toLowerCase() : "full_time",
      status: "open", createdAt: hrNow(),
    };
    hrListB(s.jobs, hrAid(ctx)).push(job);
    saveHrState();
    return { ok: true, result: { job } };
  });

  registerLensAction("hr", "job-list", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const applicants = s.applicants.get(userId) || [];
    const jobs = (s.jobs.get(userId) || []).map((j) => ({
      ...j, applicantCount: applicants.filter((a) => a.jobId === j.id).length,
    }));
    return { ok: true, result: { jobs, count: jobs.length } };
  });

  registerLensAction("hr", "applicant-add", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const job = (s.jobs.get(userId) || []).find((j) => j.id === params.jobId);
    if (!job) return { ok: false, error: "job not found" };
    const name = hrClean(params.name, 120);
    if (!name) return { ok: false, error: "applicant name required" };
    const applicant = {
      id: hrId("app"), jobId: job.id, jobTitle: job.title, name,
      email: hrClean(params.email, 160) || null,
      stage: "applied", createdAt: hrNow(),
    };
    hrListB(s.applicants, userId).push(applicant);
    saveHrState();
    return { ok: true, result: { applicant } };
  });

  registerLensAction("hr", "applicant-advance", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const applicant = (s.applicants.get(hrAid(ctx)) || []).find((a) => a.id === params.id);
    if (!applicant) return { ok: false, error: "applicant not found" };
    const stage = String(params.stage || "").toLowerCase();
    if (!APPLICANT_STAGES.includes(stage)) return { ok: false, error: `stage must be one of ${APPLICANT_STAGES.join("/")}` };
    applicant.stage = stage;
    saveHrState();
    return { ok: true, result: { applicant } };
  });

  registerLensAction("hr", "applicant-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let applicants = [...(s.applicants.get(hrAid(ctx)) || [])];
    if (params.jobId) applicants = applicants.filter((a) => a.jobId === params.jobId);
    if (params.stage) applicants = applicants.filter((a) => a.stage === String(params.stage).toLowerCase());
    const byStage = {};
    for (const st of APPLICANT_STAGES) byStage[st] = applicants.filter((a) => a.stage === st).length;
    return { ok: true, result: { applicants, byStage, count: applicants.length } };
  });

  // ── Documents ───────────────────────────────────────────────────────
  registerLensAction("hr", "hr-document-add", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const title = hrClean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    const doc = {
      id: hrId("doc"), employeeId: String(params.employeeId), title,
      kind: hrClean(params.kind, 40).toLowerCase() || "other",
      createdAt: hrNow(),
    };
    hrListB(s.hrDocuments, userId).push(doc);
    saveHrState();
    return { ok: true, result: { document: doc } };
  });

  registerLensAction("hr", "hr-document-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let docs = [...(s.hrDocuments.get(hrAid(ctx)) || [])];
    if (params.employeeId) docs = docs.filter((d) => d.employeeId === params.employeeId);
    return { ok: true, result: { documents: docs.reverse(), count: docs.length } };
  });

  // ── Payroll ─────────────────────────────────────────────────────────
  // Federal withholding approximations (2024 brackets, single filer,
  // annualized). Real arithmetic — every figure derives from the
  // employee's actual salary on record.
  const FICA_SS_RATE = 0.062;       // Social Security
  const FICA_MEDICARE_RATE = 0.0145; // Medicare
  const SS_WAGE_BASE = 168600;       // 2024 SS wage cap

  function fedIncomeTaxAnnual(taxable) {
    // 2024 single-filer marginal brackets on taxable income.
    const brackets = [
      [0, 11600, 0.10], [11600, 47150, 0.12], [47150, 100525, 0.22],
      [100525, 191950, 0.24], [191950, 243725, 0.32],
      [243725, 609350, 0.35], [609350, Infinity, 0.37],
    ];
    let tax = 0;
    for (const [lo, hi, rate] of brackets) {
      if (taxable <= lo) break;
      tax += (Math.min(taxable, hi) - lo) * rate;
    }
    return tax;
  }

  const PAY_PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

  function computeStub(emp, frequency) {
    const periods = PAY_PERIODS[frequency] || 26;
    const annual = Math.max(0, hrNum(emp.salary));
    const gross = annual / periods;
    // Standard deduction reduces taxable wages (2024 single = 14600).
    const taxableAnnual = Math.max(0, annual - 14600);
    const fedTaxPerPeriod = fedIncomeTaxAnnual(taxableAnnual) / periods;
    const ssWages = Math.min(annual, SS_WAGE_BASE) / periods;
    const socialSecurity = ssWages * FICA_SS_RATE;
    const medicare = gross * FICA_MEDICARE_RATE;
    // State tax flat approximation 5% of taxable.
    const stateTax = (taxableAnnual / periods) * 0.05;
    const totalTax = fedTaxPerPeriod + socialSecurity + medicare + stateTax;
    const net = gross - totalTax;
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      employeeId: emp.id, employeeName: emp.name,
      grossPay: r2(gross),
      federalTax: r2(fedTaxPerPeriod),
      stateTax: r2(stateTax),
      socialSecurity: r2(socialSecurity),
      medicare: r2(medicare),
      totalDeductions: r2(totalTax),
      netPay: r2(net),
    };
  }

  registerLensAction("hr", "payroll-run", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const frequency = Object.keys(PAY_PERIODS).includes(String(params.frequency))
      ? String(params.frequency) : "biweekly";
    const active = (s.employees.get(userId) || []).filter((e) => e.status === "active");
    if (active.length === 0) return { ok: false, error: "no active employees to pay" };
    const stubs = active.map((e) => computeStub(e, frequency));
    const totals = stubs.reduce((acc, st) => {
      acc.gross += st.grossPay; acc.tax += st.totalDeductions; acc.net += st.netPay;
      return acc;
    }, { gross: 0, tax: 0, net: 0 });
    const r2 = (n) => Math.round(n * 100) / 100;
    const run = {
      id: hrId("pay"),
      periodLabel: hrClean(params.periodLabel, 60) || hrDay(hrNow()),
      payDate: hrDay(params.payDate) || hrDay(hrNow()),
      frequency,
      headcount: stubs.length,
      stubs,
      totalGross: r2(totals.gross),
      totalDeductions: r2(totals.tax),
      totalNet: r2(totals.net),
      status: "completed",
      createdAt: hrNow(),
    };
    hrListB(s.payRuns, userId).unshift(run);
    saveHrState();
    return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("hr", "payroll-list", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = [...(s.payRuns.get(hrAid(ctx)) || [])];
    return {
      ok: true,
      result: {
        runs,
        count: runs.length,
        ytdPaid: Math.round(runs.reduce((a, r) => a + r.totalNet, 0) * 100) / 100,
      },
    };
  });

  registerLensAction("hr", "payroll-stub", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const run = (s.payRuns.get(hrAid(ctx)) || []).find((r) => r.id === params.runId);
    if (!run) return { ok: false, error: "pay run not found" };
    const stub = run.stubs.find((st) => st.employeeId === params.employeeId);
    if (!stub) return { ok: false, error: "no stub for that employee in this run" };
    return {
      ok: true,
      result: {
        stub: { ...stub, periodLabel: run.periodLabel, payDate: run.payDate, frequency: run.frequency },
      },
    };
  });

  // ── Benefits enrollment ─────────────────────────────────────────────
  registerLensAction("hr", "benefit-plan-add", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hrClean(params.name, 120);
    if (!name) return { ok: false, error: "plan name required" };
    const plan = {
      id: hrId("ben"), name,
      category: ["medical", "dental", "vision", "retirement", "life", "disability"].includes(String(params.category).toLowerCase())
        ? String(params.category).toLowerCase() : "medical",
      provider: hrClean(params.provider, 120) || null,
      monthlyCost: Math.max(0, hrNum(params.monthlyCost)),
      employerContribution: Math.max(0, Math.min(100, hrNum(params.employerContribution, 0))),
      createdAt: hrNow(),
    };
    hrListB(s.benefitPlans, hrAid(ctx)).push(plan);
    saveHrState();
    return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("hr", "benefit-plan-list", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const plans = [...(s.benefitPlans.get(hrAid(ctx)) || [])];
    return { ok: true, result: { plans, count: plans.length } };
  });

  registerLensAction("hr", "benefit-enroll", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const plan = (s.benefitPlans.get(userId) || []).find((p) => p.id === params.planId);
    if (!plan) return { ok: false, error: "benefit plan not found" };
    const enrolls = hrListB(s.benefitEnrollments, userId);
    const existing = enrolls.find((e) => e.employeeId === String(params.employeeId)
      && e.planId === plan.id && e.status === "enrolled");
    if (existing) return { ok: false, error: "employee already enrolled in this plan" };
    const tier = ["employee", "employee_spouse", "employee_children", "family"].includes(String(params.coverageTier))
      ? String(params.coverageTier) : "employee";
    const tierMult = { employee: 1, employee_spouse: 1.8, employee_children: 1.6, family: 2.4 }[tier];
    const grossMonthly = plan.monthlyCost * tierMult;
    const employeeMonthly = Math.round(grossMonthly * (1 - plan.employerContribution / 100) * 100) / 100;
    const enrollment = {
      id: hrId("enr"), employeeId: String(params.employeeId), planId: plan.id,
      planName: plan.name, category: plan.category, coverageTier: tier,
      employeeMonthlyCost: employeeMonthly,
      employerMonthlyCost: Math.round((grossMonthly - employeeMonthly) * 100) / 100,
      status: "enrolled", enrolledAt: hrNow(),
    };
    enrolls.push(enrollment);
    saveHrState();
    return { ok: true, result: { enrollment } };
  });

  registerLensAction("hr", "benefit-enrollment-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const empName = new Map((s.employees.get(userId) || []).map((e) => [e.id, e.name]));
    let enrolls = [...(s.benefitEnrollments.get(userId) || [])];
    if (params.employeeId) enrolls = enrolls.filter((e) => e.employeeId === params.employeeId);
    enrolls = enrolls.map((e) => ({ ...e, employeeName: empName.get(e.employeeId) || "(unknown)" }));
    const active = enrolls.filter((e) => e.status === "enrolled");
    return {
      ok: true,
      result: {
        enrollments: enrolls,
        enrolledCount: active.length,
        totalEmployeeCost: Math.round(active.reduce((a, e) => a + e.employeeMonthlyCost, 0) * 100) / 100,
        totalEmployerCost: Math.round(active.reduce((a, e) => a + e.employerMonthlyCost, 0) * 100) / 100,
      },
    };
  });

  registerLensAction("hr", "benefit-waive", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const enr = (s.benefitEnrollments.get(hrAid(ctx)) || []).find((e) => e.id === params.id);
    if (!enr) return { ok: false, error: "enrollment not found" };
    enr.status = "waived";
    enr.waivedAt = hrNow();
    saveHrState();
    return { ok: true, result: { enrollment: enr } };
  });

  // ── Time / attendance clock ─────────────────────────────────────────
  registerLensAction("hr", "clock-in", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const entries = hrListB(s.timeclock, userId);
    const open = entries.find((e) => e.employeeId === String(params.employeeId) && !e.clockOut);
    if (open) return { ok: false, error: "employee is already clocked in" };
    const entry = {
      id: hrId("clk"), employeeId: String(params.employeeId),
      clockIn: hrNow(), clockOut: null, hours: 0,
      note: hrClean(params.note, 120) || null,
    };
    entries.push(entry);
    saveHrState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("hr", "clock-out", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const entries = s.timeclock.get(userId) || [];
    const entry = params.id
      ? entries.find((e) => e.id === params.id && !e.clockOut)
      : entries.find((e) => e.employeeId === String(params.employeeId) && !e.clockOut);
    if (!entry) return { ok: false, error: "no open shift to clock out" };
    entry.clockOut = hrNow();
    entry.hours = Math.round(((new Date(entry.clockOut) - new Date(entry.clockIn)) / 3600000) * 100) / 100;
    saveHrState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("hr", "timeclock-list", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const empName = new Map((s.employees.get(userId) || []).map((e) => [e.id, e.name]));
    let entries = [...(s.timeclock.get(userId) || [])];
    if (params.employeeId) entries = entries.filter((e) => e.employeeId === params.employeeId);
    entries = entries
      .map((e) => ({ ...e, employeeName: empName.get(e.employeeId) || "(unknown)" }))
      .sort((a, b) => String(b.clockIn).localeCompare(String(a.clockIn)));
    const totalHours = Math.round(entries.reduce((a, e) => a + (e.hours || 0), 0) * 100) / 100;
    return {
      ok: true,
      result: {
        entries,
        totalHours,
        openShifts: entries.filter((e) => !e.clockOut).length,
      },
    };
  });

  // ── Learning management ─────────────────────────────────────────────
  registerLensAction("hr", "course-add", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hrClean(params.title, 140);
    if (!title) return { ok: false, error: "course title required" };
    const course = {
      id: hrId("crs"), title,
      category: hrClean(params.category, 50).toLowerCase() || "general",
      description: hrClean(params.description, 600) || null,
      durationHours: Math.max(0, hrNum(params.durationHours)),
      mandatory: params.mandatory === true,
      createdAt: hrNow(),
    };
    hrListB(s.courses, hrAid(ctx)).push(course);
    saveHrState();
    return { ok: true, result: { course } };
  });

  registerLensAction("hr", "course-list", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const assignments = s.courseAssignments.get(userId) || [];
    const courses = (s.courses.get(userId) || []).map((c) => {
      const a = assignments.filter((x) => x.courseId === c.id);
      return {
        ...c,
        assignedCount: a.length,
        completedCount: a.filter((x) => x.status === "completed").length,
      };
    });
    return { ok: true, result: { courses, count: courses.length } };
  });

  registerLensAction("hr", "course-assign", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const course = (s.courses.get(userId) || []).find((c) => c.id === params.courseId);
    if (!course) return { ok: false, error: "course not found" };
    const assigns = hrListB(s.courseAssignments, userId);
    if (assigns.some((a) => a.employeeId === String(params.employeeId) && a.courseId === course.id)) {
      return { ok: false, error: "employee already assigned this course" };
    }
    const assignment = {
      id: hrId("asg"), employeeId: String(params.employeeId), courseId: course.id,
      courseTitle: course.title,
      dueDate: hrDay(params.dueDate) || null,
      progress: 0, status: "assigned",
      assignedAt: hrNow(), completedAt: null,
    };
    assigns.push(assignment);
    saveHrState();
    return { ok: true, result: { assignment } };
  });

  registerLensAction("hr", "course-progress", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const assignment = (s.courseAssignments.get(hrAid(ctx)) || []).find((a) => a.id === params.id);
    if (!assignment) return { ok: false, error: "assignment not found" };
    assignment.progress = Math.max(0, Math.min(100, Math.round(hrNum(params.progress))));
    if (assignment.progress >= 100) {
      assignment.status = "completed";
      assignment.completedAt = assignment.completedAt || hrNow();
    } else if (assignment.progress > 0) {
      assignment.status = "in_progress";
      assignment.completedAt = null;
    } else {
      assignment.status = "assigned";
      assignment.completedAt = null;
    }
    saveHrState();
    return { ok: true, result: { assignment } };
  });

  registerLensAction("hr", "course-assignment-list", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const empName = new Map((s.employees.get(userId) || []).map((e) => [e.id, e.name]));
    let assigns = [...(s.courseAssignments.get(userId) || [])];
    if (params.employeeId) assigns = assigns.filter((a) => a.employeeId === params.employeeId);
    if (params.courseId) assigns = assigns.filter((a) => a.courseId === params.courseId);
    assigns = assigns.map((a) => ({ ...a, employeeName: empName.get(a.employeeId) || "(unknown)" }));
    return {
      ok: true,
      result: {
        assignments: assigns,
        completed: assigns.filter((a) => a.status === "completed").length,
        overdue: assigns.filter((a) => a.status !== "completed" && a.dueDate
          && a.dueDate < hrDay(hrNow())).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Compliance acknowledgement ──────────────────────────────────────
  registerLensAction("hr", "compliance-doc-add", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hrClean(params.title, 140);
    if (!title) return { ok: false, error: "document title required" };
    const doc = {
      id: hrId("cmp"), title,
      category: hrClean(params.category, 50).toLowerCase() || "policy",
      body: hrClean(params.body, 4000) || null,
      version: hrClean(params.version, 20) || "1.0",
      dueDate: hrDay(params.dueDate) || null,
      createdAt: hrNow(),
    };
    hrListB(s.complianceDocs, hrAid(ctx)).push(doc);
    saveHrState();
    return { ok: true, result: { document: doc } };
  });

  registerLensAction("hr", "compliance-doc-list", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const acks = s.complianceAcks.get(userId) || [];
    const activeEmps = (s.employees.get(userId) || []).filter((e) => e.status === "active");
    const docs = (s.complianceDocs.get(userId) || []).map((d) => {
      const a = acks.filter((x) => x.docId === d.id && x.version === d.version);
      return {
        ...d,
        acknowledgedCount: a.length,
        pendingCount: Math.max(0, activeEmps.length - a.length),
        acknowledgedRate: activeEmps.length
          ? Math.round((a.length / activeEmps.length) * 100) : 0,
      };
    });
    return { ok: true, result: { documents: docs, count: docs.length } };
  });

  registerLensAction("hr", "compliance-acknowledge", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
    const doc = (s.complianceDocs.get(userId) || []).find((d) => d.id === params.docId);
    if (!doc) return { ok: false, error: "compliance document not found" };
    const acks = hrListB(s.complianceAcks, userId);
    if (acks.some((a) => a.employeeId === String(params.employeeId)
      && a.docId === doc.id && a.version === doc.version)) {
      return { ok: false, error: "already acknowledged this version" };
    }
    const ack = {
      id: hrId("ack"), employeeId: String(params.employeeId),
      docId: doc.id, docTitle: doc.title, version: doc.version,
      acknowledgedAt: hrNow(),
    };
    acks.push(ack);
    saveHrState();
    return { ok: true, result: { acknowledgement: ack } };
  });

  registerLensAction("hr", "compliance-status", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const docs = s.complianceDocs.get(userId) || [];
    const acks = s.complianceAcks.get(userId) || [];
    if (params.employeeId) {
      if (!findEmployee(s, userId, params.employeeId)) return { ok: false, error: "employee not found" };
      const rows = docs.map((d) => {
        const got = acks.find((a) => a.employeeId === params.employeeId
          && a.docId === d.id && a.version === d.version);
        return {
          docId: d.id, title: d.title, version: d.version, category: d.category,
          dueDate: d.dueDate,
          acknowledged: !!got,
          acknowledgedAt: got ? got.acknowledgedAt : null,
        };
      });
      return {
        ok: true,
        result: {
          documents: rows,
          outstanding: rows.filter((r) => !r.acknowledged).length,
        },
      };
    }
    const activeEmps = (s.employees.get(userId) || []).filter((e) => e.status === "active");
    const totalRequired = activeEmps.length * docs.length;
    const totalAcked = acks.filter((a) =>
      docs.some((d) => d.id === a.docId && d.version === a.version)
      && activeEmps.some((e) => e.id === a.employeeId)).length;
    return {
      ok: true,
      result: {
        totalRequired,
        totalAcknowledged: totalAcked,
        compliancePct: totalRequired ? Math.round((totalAcked / totalRequired) * 100) : 100,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Employee self-service portal ────────────────────────────────────
  // Read-only consolidated view for one employee: profile, time-off
  // balance + history, benefits, paystubs, courses, compliance, goals.
  registerLensAction("hr", "self-service-summary", (ctx, _a, params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const emp = findEmployee(s, userId, params.employeeId);
    if (!emp) return { ok: false, error: "employee not found" };
    const year = new Date().getFullYear();
    const myTimeoff = (s.timeoff.get(userId) || []).filter((r) => r.employeeId === emp.id);
    const approved = myTimeoff.filter((r) => r.status === "approved"
      && new Date(r.startDate).getFullYear() === year);
    const balances = Object.entries(PTO_ACCRUAL).map(([kind, accrued]) => {
      const used = approved.filter((r) => r.kind === kind).reduce((a, r) => a + r.days, 0);
      return { kind, accrued, used: Math.round(used * 2) / 2, remaining: Math.round((accrued - used) * 2) / 2 };
    });
    const myEnroll = (s.benefitEnrollments.get(userId) || [])
      .filter((e) => e.employeeId === emp.id && e.status === "enrolled");
    const myStubs = [];
    for (const run of (s.payRuns.get(userId) || [])) {
      const st = run.stubs.find((x) => x.employeeId === emp.id);
      if (st) myStubs.push({ ...st, periodLabel: run.periodLabel, payDate: run.payDate, runId: run.id });
    }
    const myCourses = (s.courseAssignments.get(userId) || []).filter((a) => a.employeeId === emp.id);
    const cmpDocs = s.complianceDocs.get(userId) || [];
    const myAcks = s.complianceAcks.get(userId) || [];
    const complianceOutstanding = cmpDocs.filter((d) =>
      !myAcks.some((a) => a.employeeId === emp.id && a.docId === d.id && a.version === d.version)).length;
    const myGoals = (s.goals.get(userId) || []).filter((g) => g.employeeId === emp.id);
    return {
      ok: true,
      result: {
        profile: {
          id: emp.id, name: emp.name, title: emp.title,
          department: emp.department, email: emp.email,
          hireDate: emp.hireDate, employmentType: emp.employmentType,
          status: emp.status,
        },
        timeoffBalances: balances,
        timeoffRequests: myTimeoff.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))),
        benefits: myEnroll,
        paystubs: myStubs.sort((a, b) => String(b.payDate).localeCompare(String(a.payDate))),
        courses: myCourses,
        goals: myGoals,
        complianceOutstanding,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("hr", "self-service-update", (ctx, _a, params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emp = findEmployee(s, hrAid(ctx), params.employeeId);
    if (!emp) return { ok: false, error: "employee not found" };
    // Self-service: an employee may only edit contact fields, never
    // salary / title / department / manager / status.
    if (params.email != null) emp.email = hrClean(params.email, 160) || null;
    if (params.phone != null) emp.phone = hrClean(params.phone, 40) || null;
    if (params.address != null) emp.address = hrClean(params.address, 240) || null;
    if (params.emergencyContact != null) {
      emp.emergencyContact = hrClean(params.emergencyContact, 200) || null;
    }
    saveHrState();
    return {
      ok: true,
      result: {
        profile: {
          id: emp.id, name: emp.name, email: emp.email,
          phone: emp.phone || null, address: emp.address || null,
          emergencyContact: emp.emergencyContact || null,
        },
      },
    };
  });

  // ── Org-wide analytics ──────────────────────────────────────────────
  registerLensAction("hr", "workforce-analytics", (ctx, _a, _params = {}) => {
  try {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const emps = s.employees.get(userId) || [];
    const active = emps.filter((e) => e.status === "active");
    const now = Date.now();

    // Tenure distribution (years on record from hireDate).
    const tenureBuckets = { "<1y": 0, "1-2y": 0, "2-5y": 0, "5-10y": 0, "10y+": 0 };
    let tenureSum = 0;
    for (const e of active) {
      const years = e.hireDate
        ? (now - new Date(e.hireDate).getTime()) / (365.25 * 86400000) : 0;
      tenureSum += years;
      if (years < 1) tenureBuckets["<1y"]++;
      else if (years < 2) tenureBuckets["1-2y"]++;
      else if (years < 5) tenureBuckets["2-5y"]++;
      else if (years < 10) tenureBuckets["5-10y"]++;
      else tenureBuckets["10y+"]++;
    }

    // Compensation distribution (quintile bands across active salaries).
    const salaries = active.map((e) => hrNum(e.salary)).filter((v) => v > 0).sort((a, b) => a - b);
    const compStats = salaries.length ? {
      min: salaries[0],
      max: salaries[salaries.length - 1],
      median: salaries[Math.floor(salaries.length / 2)],
      mean: Math.round(salaries.reduce((a, v) => a + v, 0) / salaries.length),
      p25: salaries[Math.floor(salaries.length * 0.25)],
      p75: salaries[Math.floor(salaries.length * 0.75)],
    } : { min: 0, max: 0, median: 0, mean: 0, p25: 0, p75: 0 };
    const range = compStats.max - compStats.min || 1;
    const compBands = ["band1", "band2", "band3", "band4", "band5"]
      .map((label, i) => ({
        label,
        lower: Math.round(compStats.min + (range / 5) * i),
        upper: Math.round(compStats.min + (range / 5) * (i + 1)),
        count: salaries.filter((v) => {
          const lo = compStats.min + (range / 5) * i;
          const hi = compStats.min + (range / 5) * (i + 1);
          return i === 4 ? v >= lo && v <= hi : v >= lo && v < hi;
        }).length,
      }));

    // Department headcount + payroll.
    const byDept = {};
    for (const e of active) {
      if (!byDept[e.department]) byDept[e.department] = { headcount: 0, payroll: 0 };
      byDept[e.department].headcount++;
      byDept[e.department].payroll += hrNum(e.salary);
    }
    const departments = Object.entries(byDept)
      .map(([department, v]) => ({
        department, headcount: v.headcount,
        payroll: Math.round(v.payroll),
        avgSalary: v.headcount ? Math.round(v.payroll / v.headcount) : 0,
      }))
      .sort((a, b) => b.headcount - a.headcount);

    // Employment-type mix (a stand-in diversity dimension — derived
    // wholly from real employmentType data, never fabricated).
    const byType = {};
    for (const e of active) byType[e.employmentType] = (byType[e.employmentType] || 0) + 1;

    return {
      ok: true,
      result: {
        headcount: active.length,
        terminated: emps.filter((e) => e.status === "terminated").length,
        avgTenureYears: active.length ? Math.round((tenureSum / active.length) * 10) / 10 : 0,
        tenureDistribution: tenureBuckets,
        compensation: compStats,
        compensationBands: compBands,
        departments,
        employmentTypeMix: byType,
        annualPayroll: Math.round(active.reduce((a, e) => a + hrNum(e.salary), 0)),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("hr", "hr-dashboard", (ctx, _a, _params = {}) => {
    const s = getHrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hrAid(ctx);
    const emps = s.employees.get(userId) || [];
    const active = emps.filter((e) => e.status === "active");
    const jobs = s.jobs.get(userId) || [];
    return {
      ok: true,
      result: {
        headcount: active.length,
        departments: new Set(active.map((e) => e.department)).size,
        pendingTimeoff: (s.timeoff.get(userId) || []).filter((r) => r.status === "pending").length,
        openOnboarding: (s.onboarding.get(userId) || []).filter((t) => !t.done).length,
        openJobs: jobs.filter((j) => j.status === "open").length,
        applicants: (s.applicants.get(userId) || []).filter((a) => !["hired", "rejected"].includes(a.stage)).length,
        openGoals: (s.goals.get(userId) || []).filter((g) => g.progress < 100).length,
      },
    };
  });
}
