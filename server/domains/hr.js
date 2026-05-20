// server/domains/hr.js
//
// Pure-compute HR helpers (compensation benchmark, turnover analysis,
// PTO tracking) plus real US Bureau of Labor Statistics (BLS) for
// real wage/employment data. Free with API key from
// data.bls.gov/registrationEngine/ (25 req/day anonymous, 500 with key).

const BLS_API = "https://api.bls.gov/publicAPI/v2";

export default function registerHRActions(registerLensAction) {
  registerLensAction("hr", "compensationBenchmark", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const salary = parseFloat(data.salary) || 0;
    const role = data.role || data.title || "";
    const experience = parseInt(data.yearsExperience) || 0;
    const location = data.location || "national";
    const baseMultiplier = experience < 2 ? 0.85 : experience < 5 ? 1.0 : experience < 10 ? 1.15 : 1.3;
    const locationMultiplier = (location.toLowerCase().includes("sf") || location.toLowerCase().includes("nyc")) ? 1.3 : location.toLowerCase().includes("remote") ? 0.9 : 1.0;
    const benchmarkSalary = Math.round(salary * baseMultiplier * locationMultiplier);
    const percentile = salary >= benchmarkSalary * 1.1 ? 75 : salary >= benchmarkSalary * 0.9 ? 50 : 25;
    return { ok: true, result: { role, salary, yearsExperience: experience, location, benchmarkSalary, percentile, competitive: percentile >= 50 ? "competitive" : "below-market", recommendation: percentile < 50 ? `Consider adjusting to $${benchmarkSalary} to remain competitive` : "Compensation is market-rate" } };
  });
  registerLensAction("hr", "turnoverAnalysis", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const employees = parseInt(data.totalEmployees) || 100;
    const departures = parseInt(data.departuresThisYear) || 0;
    const avgTenure = parseFloat(data.avgTenureYears) || 3;
    const rate = employees > 0 ? Math.round((departures / employees) * 100) : 0;
    const costPerTurnover = parseFloat(data.avgSalary || 70000) * 0.5;
    return { ok: true, result: { totalEmployees: employees, departures, turnoverRate: rate, avgTenure, industryAvg: 15, aboveIndustry: rate > 15, annualCost: Math.round(departures * costPerTurnover), costPerDeparture: Math.round(costPerTurnover), riskLevel: rate > 25 ? "critical" : rate > 15 ? "elevated" : "healthy", recommendations: rate > 15 ? ["Exit interview analysis", "Compensation review", "Manager training", "Career development programs"] : ["Continue current retention strategies"] } };
  });
  registerLensAction("hr", "interviewScorecard", (ctx, artifact, _params) => {
    const candidates = artifact.data?.candidates || [];
    if (candidates.length === 0) return { ok: true, result: { message: "Add candidates with interview scores." } };
    const scored = candidates.map(c => { const technical = parseFloat(c.technical) || 0; const cultural = parseFloat(c.cultural) || 0; const communication = parseFloat(c.communication) || 0; const experience = parseFloat(c.experience) || 0; const overall = Math.round((technical * 0.35 + cultural * 0.25 + communication * 0.2 + experience * 0.2) * 10) / 10; return { name: c.name, technical, cultural, communication, experience, overall, recommendation: overall >= 4 ? "strong-hire" : overall >= 3 ? "hire" : overall >= 2.5 ? "maybe" : "no-hire" }; }).sort((a, b) => b.overall - a.overall);
    return { ok: true, result: { candidates: scored, topCandidate: scored[0]?.name, strongHires: scored.filter(c => c.recommendation === "strong-hire").length, avgScore: Math.round(scored.reduce((s, c) => s + c.overall, 0) / scored.length * 10) / 10 } };
  });
  registerLensAction("hr", "ptoBalance", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const totalDays = parseInt(data.totalPTO) || 20;
    const used = parseInt(data.usedPTO) || 0;
    const pending = parseInt(data.pendingRequests) || 0;
    const remaining = totalDays - used - pending;
    const monthsLeft = 12 - new Date().getMonth();
    return { ok: true, result: { totalPTO: totalDays, used, pending, remaining, monthsRemaining: monthsLeft, burnRate: used > 0 ? Math.round(used / (12 - monthsLeft) * 10) / 10 : 0, projectedYearEnd: Math.round(remaining - (used / Math.max(12 - monthsLeft, 1)) * monthsLeft), recommendation: remaining > totalDays * 0.6 && monthsLeft < 4 ? "Use PTO — significant balance remaining before year-end" : "PTO usage is on track" } };
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
