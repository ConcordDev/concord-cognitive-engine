export default function registerRealEstateActions(registerLensAction) {
  registerLensAction("realestate", "capRate", (ctx, artifact, params) => {
    const noi = artifact.data?.netOperatingIncome || params.noi || 0;
    const purchasePrice = artifact.data?.purchasePrice || params.purchasePrice || 0;
    if (purchasePrice === 0) return { ok: true, result: { capRate: 0, error: "Purchase price cannot be zero" } };
    const capRate = (noi / purchasePrice) * 100;
    return { ok: true, result: { capRate: Math.round(capRate * 100) / 100, noi, purchasePrice, rating: capRate >= 8 ? 'excellent' : capRate >= 6 ? 'good' : capRate >= 4 ? 'fair' : 'low' } };
  });

  registerLensAction("realestate", "cashFlow", (ctx, artifact, params) => {
    const rent = artifact.data?.rentAmount || params.monthlyRent || 0;
    const expenses = artifact.data?.monthlyExpenses || params.expenses || 0;
    const mortgage = artifact.data?.mortgagePayment || params.mortgage || 0;
    const vacancy = artifact.data?.vacancyRate || params.vacancyRate || 5;
    const effectiveRent = rent * (1 - vacancy / 100);
    const monthlyCashFlow = effectiveRent - expenses - mortgage;
    const annualCashFlow = monthlyCashFlow * 12;
    return {
      ok: true,
      result: {
        monthly: { grossRent: rent, effectiveRent: Math.round(effectiveRent), expenses, mortgage, cashFlow: Math.round(monthlyCashFlow) },
        annual: { cashFlow: Math.round(annualCashFlow) },
        positive: monthlyCashFlow > 0,
      },
    };
  });

  registerLensAction("realestate", "closingTimeline", (ctx, artifact, params) => {
    const contractDate = artifact.data?.contractDate || params.contractDate || new Date().toISOString().split('T')[0];
    const base = new Date(contractDate);
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r.toISOString().split('T')[0]; };
    const timeline = [
      { milestone: 'Contract Executed', date: contractDate, status: 'completed' },
      { milestone: 'Earnest Money Due', date: addDays(base, 3), status: 'pending' },
      { milestone: 'Home Inspection', date: addDays(base, 10), status: 'pending' },
      { milestone: 'Inspection Response', date: addDays(base, 14), status: 'pending' },
      { milestone: 'Appraisal Ordered', date: addDays(base, 7), status: 'pending' },
      { milestone: 'Appraisal Received', date: addDays(base, 21), status: 'pending' },
      { milestone: 'Loan Approval', date: addDays(base, 25), status: 'pending' },
      { milestone: 'Clear to Close', date: addDays(base, 28), status: 'pending' },
      { milestone: 'Final Walkthrough', date: addDays(base, 29), status: 'pending' },
      { milestone: 'Closing', date: addDays(base, 30), status: 'pending' },
    ];
    return { ok: true, result: { timeline, totalDays: 30 } };
  });

  registerLensAction("realestate", "vacancyReport", (ctx, artifact, params) => {
    const units = artifact.data?.units || [];
    const avgRent = params.avgMarketRent || artifact.data?.avgMarketRent || 0;
    const now = new Date();
    const unitDetails = units.map(u => {
      const isVacant = u.status === 'vacant' || !u.tenant;
      const vacantSince = u.vacantSince ? new Date(u.vacantSince) : null;
      const daysVacant = isVacant && vacantSince ? Math.floor((now - vacantSince) / 86400000) : isVacant ? null : 0;
      const unitRent = u.rentAmount || avgRent || 0;
      const lostRevenue = isVacant && daysVacant != null ? Math.round((unitRent / 30) * daysVacant * 100) / 100 : 0;
      return {
        unit: u.unit || u.unitId || u.name,
        status: isVacant ? 'vacant' : 'occupied',
        tenant: isVacant ? null : (u.tenant || 'Unknown'),
        rentAmount: unitRent,
        vacantSince: isVacant ? (u.vacantSince || null) : null,
        daysVacant,
        lostRevenue,
      };
    });

    const vacantUnits = unitDetails.filter(u => u.status === 'vacant');
    const totalLostRevenue = Math.round(vacantUnits.reduce((s, u) => s + u.lostRevenue, 0) * 100) / 100;
    const vacancyRate = units.length > 0 ? Math.round((vacantUnits.length / units.length) * 100) : 0;

    const recommendations = [];
    if (vacancyRate > 20) recommendations.push('High vacancy rate — consider rent reduction or incentives');
    if (vacancyRate > 10) recommendations.push('Review marketing strategy and listing platforms');
    const longVacant = vacantUnits.filter(u => u.daysVacant != null && u.daysVacant > 60);
    if (longVacant.length > 0) recommendations.push(`${longVacant.length} unit(s) vacant over 60 days — consider property improvements or staging`);
    if (vacantUnits.length > 0) recommendations.push('Ensure all vacant units are listed on major rental platforms');

    return {
      ok: true,
      result: {
        generatedAt: new Date().toISOString(),
        totalUnits: units.length,
        occupiedCount: units.length - vacantUnits.length,
        vacantCount: vacantUnits.length,
        vacancyRate,
        totalLostRevenue,
        units: unitDetails,
        recommendations,
      },
    };
  });

  registerLensAction("realestate", "vacancyRate", (ctx, artifact, _params) => {
    const units = artifact.data?.units || [];
    if (units.length === 0) return { ok: true, result: { vacancyRate: 0, occupied: 0, vacant: 0, total: 0 } };
    const vacant = units.filter(u => u.status === 'vacant' || !u.tenant).length;
    const occupied = units.length - vacant;
    const rate = Math.round((vacant / units.length) * 100);
    const totalRent = units.filter(u => u.tenant).reduce((sum, u) => sum + (u.rentAmount || 0), 0);
    return { ok: true, result: { vacancyRate: rate, occupied, vacant, total: units.length, monthlyRentCollected: totalRent } };
  });

  // ─── 2026 parity — Zillow/Redfin/Trulia/Realtor.com calculators + saved searches ──

  function getREState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.realestateLens) {
      STATE.realestateLens = {
        searches: new Map(), // userId -> Map<id, savedSearch>
      };
    }
    return STATE.realestateLens;
  }
  function saveREState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function reActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextREId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

  // ── Mortgage PITI calculator ──

  registerLensAction("realestate", "calc-mortgage", (_ctx, _artifact, params = {}) => {
    const price = Number(params.price);
    const downPercent = Number(params.downPercent ?? 20);
    const rate = Number(params.rate ?? 7); // percent
    const termYears = Number(params.termYears ?? 30);
    const taxRate = Number(params.taxRate ?? 1.1); // percent/yr
    const insurance = Number(params.insurance ?? 1200); // annual $
    const hoa = Number(params.hoa ?? 0); // monthly $
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "price must be > 0" };
    if (downPercent < 0 || downPercent > 100) return { ok: false, error: "downPercent 0..100" };
    if (rate < 0 || rate > 30) return { ok: false, error: "rate 0..30" };
    if (termYears <= 0 || termYears > 50) return { ok: false, error: "termYears 1..50" };

    const downPayment = price * downPercent / 100;
    const loanAmount = price - downPayment;
    const n = termYears * 12;
    const r = rate / 100 / 12;
    const principalAndInterest = r === 0
      ? loanAmount / n
      : (loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const monthlyTax = (price * taxRate / 100) / 12;
    const monthlyInsurance = insurance / 12;
    const ltv = (loanAmount / price) * 100;
    const monthlyPMI = ltv > 80 ? (loanAmount * 0.005) / 12 : 0; // 0.5%/yr PMI
    const monthlyTotal = principalAndInterest + monthlyTax + monthlyInsurance + monthlyPMI + hoa;
    return {
      ok: true,
      result: {
        price, downPayment, loanAmount, termYears, rate, ltvPercent: Math.round(ltv * 100) / 100,
        monthly: {
          principalAndInterest: Math.round(principalAndInterest * 100) / 100,
          tax: Math.round(monthlyTax * 100) / 100,
          insurance: Math.round(monthlyInsurance * 100) / 100,
          pmi: Math.round(monthlyPMI * 100) / 100,
          hoa,
          total: Math.round(monthlyTotal * 100) / 100,
        },
        totalCostOverTerm: Math.round(monthlyTotal * n * 100) / 100,
        totalInterest: Math.round((principalAndInterest * n - loanAmount) * 100) / 100,
        formula: "M = P × r(1+r)^n / ((1+r)^n − 1) ; PITI + PMI + HOA",
      },
    };
  });

  // ── Affordability (28/36 DTI rule) ──

  registerLensAction("realestate", "calc-affordability", (_ctx, _artifact, params = {}) => {
    const grossIncome = Number(params.grossIncome);
    const monthlyDebts = Number(params.monthlyDebts ?? 0);
    const downPayment = Number(params.downPayment ?? 0);
    const rate = Number(params.rate ?? 7);
    const termYears = Number(params.termYears ?? 30);
    if (!Number.isFinite(grossIncome) || grossIncome <= 0) return { ok: false, error: "grossIncome must be > 0" };
    const monthlyGross = grossIncome / 12;
    const maxFrontEnd = monthlyGross * 0.28; // 28% housing rule
    const maxBackEnd = monthlyGross * 0.36 - monthlyDebts; // 36% DTI minus debts
    const maxPITI = Math.min(maxFrontEnd, maxBackEnd);
    // Reverse mortgage formula to find max loan amount.
    // Assume 25% of monthly payment goes to taxes/insurance/PMI (rough heuristic).
    const piEquivalent = maxPITI * 0.75;
    const n = termYears * 12;
    const r = rate / 100 / 12;
    const maxLoan = r === 0 ? piEquivalent * n : piEquivalent * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
    const maxHomePrice = maxLoan + downPayment;
    let band;
    if (maxPITI < monthlyGross * 0.20) band = "comfortable";
    else if (maxPITI < monthlyGross * 0.30) band = "stretching";
    else band = "tight";
    return {
      ok: true,
      result: {
        monthlyGrossIncome: Math.round(monthlyGross * 100) / 100,
        maxFrontEnd: Math.round(maxFrontEnd * 100) / 100,
        maxBackEnd: Math.round(maxBackEnd * 100) / 100,
        maxPITI: Math.round(maxPITI * 100) / 100,
        maxLoanAmount: Math.round(maxLoan * 100) / 100,
        maxHomePrice: Math.round(maxHomePrice * 100) / 100,
        band,
        formula: "28% front-end / 36% back-end DTI",
      },
    };
  });

  // ── Rent vs buy break-even ──

  registerLensAction("realestate", "calc-rent-vs-buy", (_ctx, _artifact, params = {}) => {
    const price = Number(params.price);
    const rent = Number(params.rent);
    const downPercent = Number(params.downPercent ?? 20);
    const rate = Number(params.rate ?? 7);
    const horizonYears = Math.min(40, Number(params.horizonYears ?? 10));
    const appreciation = Number(params.appreciation ?? 3); // %/yr
    const rentInflation = Number(params.rentInflation ?? 3);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "price must be > 0" };
    if (!Number.isFinite(rent) || rent <= 0) return { ok: false, error: "rent must be > 0" };

    const downPayment = price * downPercent / 100;
    const loanAmount = price - downPayment;
    const n = 30 * 12;
    const r = rate / 100 / 12;
    const monthlyPI = (loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const monthlyOther = (price * 0.018) / 12; // tax+insurance+maintenance rough
    const monthlyBuy = monthlyPI + monthlyOther;

    let breakEvenYear = null;
    let buyCumulative = downPayment;
    let rentCumulative = 0;
    let currentRent = rent;
    let homeValue = price;
    const points = [];
    for (let year = 1; year <= horizonYears; year++) {
      buyCumulative += monthlyBuy * 12;
      rentCumulative += currentRent * 12;
      homeValue *= 1 + appreciation / 100;
      currentRent *= 1 + rentInflation / 100;
      const buyNet = buyCumulative - (homeValue - loanAmount); // subtract equity
      points.push({ year, buyNet: Math.round(buyNet), rentNet: Math.round(rentCumulative) });
      if (breakEvenYear === null && buyNet < rentCumulative) breakEvenYear = year;
    }
    return {
      ok: true,
      result: {
        breakEvenYear,
        monthlyBuyTotal: Math.round(monthlyBuy),
        monthlyRent: rent,
        chartPoints: points,
        verdict: breakEvenYear
          ? `Buying wins after ${breakEvenYear} years.`
          : `Renting wins over the ${horizonYears}-year horizon.`,
      },
    };
  });

  // ── Saved searches ──

  registerLensAction("realestate", "saved-searches-list", (ctx, _artifact, _params = {}) => {
    const s = getREState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const map = s.searches.get(userId);
    if (!map) return { ok: true, result: { searches: [] } };
    const searches = Array.from(map.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { searches } };
  });

  registerLensAction("realestate", "save-search", (ctx, _artifact, params = {}) => {
    const s = getREState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const filters = params.filters && typeof params.filters === "object" ? params.filters : {};
    const alertCadence = ["never", "daily", "weekly", "instant"].includes(params.alertCadence) ? params.alertCadence : "weekly";
    const search = {
      id: nextREId("search"),
      name: name.slice(0, 80),
      filters,
      alertCadence,
      createdAt: new Date().toISOString(),
    };
    if (!s.searches.has(userId)) s.searches.set(userId, new Map());
    s.searches.get(userId).set(search.id, search);
    saveREState();
    return { ok: true, result: { search } };
  });

  registerLensAction("realestate", "delete-search", (ctx, _artifact, params = {}) => {
    const s = getREState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    const map = s.searches.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveREState();
    return { ok: true, result: { deleted: id } };
  });
};
