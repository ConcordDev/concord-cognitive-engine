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
}
