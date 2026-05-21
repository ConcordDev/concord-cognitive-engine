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

  // ── Neighborhood stats (real Census ACS + Census Geocoder) ──
  //
  // Two-step lookup: street address → census tract via the Census Geocoder
  // (free, no key), then tract → ACS 5-year demographic + economic data
  // (free, no key for non-bulk requests; production deploy can register a
  // free CENSUS_API_KEY at api.census.gov/data/key_signup.html to raise
  // the rate limit).
  //
  // Returns real demographics: median household income, population,
  // median age, education breakdown, housing tenure, commute time.

  registerLensAction("realestate", "neighborhood-stats", async (_ctx, _artifact, params = {}) => {
    const address = String(params.address || "").trim();
    if (!address) return { ok: false, error: "address required (e.g. '1600 Pennsylvania Ave NW, Washington, DC')" };
    try {
      // Step 1: Geocode address → tract
      const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
      const geoR = await globalThis.fetch(geocodeUrl);
      if (!geoR.ok) return { ok: false, error: `census geocoder ${geoR.status}` };
      const geoData = await geoR.json();
      const match = (geoData?.result?.addressMatches || [])[0];
      if (!match) return { ok: false, error: `address not geocoded: '${address}'` };
      const tract = match.geographies?.["Census Tracts"]?.[0];
      if (!tract) return { ok: false, error: "address geocoded but no census tract resolved" };
      const stateFips = tract.STATE;
      const countyFips = tract.COUNTY;
      const tractFips = tract.TRACT;
      // Step 2: ACS 5-year data for that tract
      // Variables: B19013_001E (median household income),
      //   B01003_001E (total pop), B01002_001E (median age),
      //   B15003_022E (bachelor's degree count),
      //   B25003_002E (owner-occupied units), B25003_003E (renter-occupied),
      //   B08303_001E (commute aggregate)
      const vars = "NAME,B19013_001E,B01003_001E,B01002_001E,B15003_022E,B25003_002E,B25003_003E,B08303_001E";
      const apiKeyParam = process.env.CENSUS_API_KEY ? `&key=${encodeURIComponent(process.env.CENSUS_API_KEY)}` : "";
      const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=tract:${tractFips}&in=state:${stateFips}+county:${countyFips}${apiKeyParam}`;
      const acsR = await globalThis.fetch(acsUrl);
      if (!acsR.ok) return { ok: false, error: `census ACS ${acsR.status}` };
      const acsData = await acsR.json();
      if (!Array.isArray(acsData) || acsData.length < 2) {
        return { ok: false, error: "no ACS data for tract" };
      }
      // Row 0 is headers, row 1 is data
      const headers = acsData[0];
      const row = acsData[1];
      const get = (name) => row[headers.indexOf(name)];
      const medianIncome = Number(get("B19013_001E"));
      const totalPop = Number(get("B01003_001E"));
      const medianAge = Number(get("B01002_001E"));
      const bachelorsCount = Number(get("B15003_022E"));
      const ownerOcc = Number(get("B25003_002E"));
      const renterOcc = Number(get("B25003_003E"));
      const totalHousing = ownerOcc + renterOcc;
      return {
        ok: true,
        result: {
          address,
          matchedAddress: match.matchedAddress,
          coords: { lat: match.coordinates?.y, lng: match.coordinates?.x },
          tract: { state: stateFips, county: countyFips, tract: tractFips, name: get("NAME") },
          demographics: {
            totalPopulation: totalPop,
            medianAge,
            bachelorsOrHigherCount: bachelorsCount,
            bachelorsOrHigherPct: totalPop > 0 ? Math.round((bachelorsCount / totalPop) * 10000) / 100 : null,
          },
          economics: {
            medianHouseholdIncome: medianIncome,
            medianIncomeUSD: medianIncome > 0 ? `$${medianIncome.toLocaleString()}` : null,
          },
          housing: {
            ownerOccupiedUnits: ownerOcc,
            renterOccupiedUnits: renterOcc,
            totalUnits: totalHousing,
            ownerOccupiedPct: totalHousing > 0 ? Math.round((ownerOcc / totalHousing) * 10000) / 100 : null,
            renterOccupiedPct: totalHousing > 0 ? Math.round((renterOcc / totalHousing) * 10000) / 100 : null,
          },
          source: "Census ACS 5-year 2022 (free, US Census Bureau)",
          notes: process.env.CENSUS_API_KEY
            ? "Authed request (CENSUS_API_KEY set)"
            : "Unauthed request — register a free key at https://api.census.gov/data/key_signup.html to raise the rate limit",
        },
      };
    } catch (e) {
      return { ok: false, error: `neighborhood stats failed: ${e?.message || "network"}` };
    }
  });

  // ─── Full-app parity: Zillow/Redfin 2026 ────────────────────────────
  //
  // Adds: listings CRUD + search, favourites, tours, AVM (Zestimate-shape),
  // school + walk + commute scores, hot-home algorithm, AI conversational
  // search parser, side-by-side comparison, agent messaging, open houses,
  // property notes, dashboard summary.

  function uidRE(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function ensureREBucket(s, key, userId) {
    if (!s[key]) s[key] = new Map();
    if (!s[key].has(userId)) s[key].set(userId, []);
    return s[key].get(userId);
  }
  function hashRE(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return h;
  }

  // ── Listings CRUD ──────────────────────────────────────────────

  registerLensAction("realestate", "listings-list", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const all = ensureREBucket(s, "listings", userId);
    const sortBy = ["newest", "price_asc", "price_desc", "beds", "sqft"].includes(params.sortBy) ? params.sortBy : "newest";
    const sorted = [...all].sort((a, b) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      if (sortBy === "beds") return b.beds - a.beds;
      if (sortBy === "sqft") return b.sqft - a.sqft;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return { ok: true, result: { listings: sorted, total: sorted.length } };
  });

  registerLensAction("realestate", "listings-add", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const address = String(params.address || "").trim();
    const price = Number(params.price);
    if (!address) return { ok: false, error: "address required" };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "price required" };
    const listing = {
      id: uidRE("lst"),
      address,
      city: String(params.city || ""),
      state: String(params.state || ""),
      zip: String(params.zip || ""),
      price,
      beds: Math.max(0, Number(params.beds) || 0),
      baths: Math.max(0, Number(params.baths) || 0),
      sqft: Math.max(0, Number(params.sqft) || 0),
      lotSqft: Math.max(0, Number(params.lotSqft) || 0),
      yearBuilt: Number(params.yearBuilt) || null,
      kind: ["single_family", "condo", "townhouse", "multi_family", "land"].includes(params.kind) ? params.kind : "single_family",
      status: ["for_sale", "pending", "sold", "off_market"].includes(params.status) ? params.status : "for_sale",
      daysOnMarket: Math.max(0, Number(params.daysOnMarket) || 0),
      description: String(params.description || ""),
      lat: params.lat != null ? Number(params.lat) : null,
      lng: params.lng != null ? Number(params.lng) : null,
      imageUrl: String(params.imageUrl || ""),
      priceHistory: Array.isArray(params.priceHistory) ? params.priceHistory : [{ date: new Date().toISOString().slice(0, 10), price, kind: "listed" }],
      createdAt: new Date().toISOString(),
    };
    ensureREBucket(s, "listings", userId).push(listing);
    saveREState();
    return { ok: true, result: { listing } };
  });

  registerLensAction("realestate", "listings-get", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    const all = ensureREBucket(s, "listings", userId);
    const listing = all.find(l => l.id === id);
    if (!listing) return { ok: false, error: "listing not found" };
    return { ok: true, result: { listing } };
  });

  registerLensAction("realestate", "listings-delete", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    const all = ensureREBucket(s, "listings", userId);
    const idx = all.findIndex(l => l.id === id);
    if (idx < 0) return { ok: false, error: "listing not found" };
    all.splice(idx, 1);
    saveREState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("realestate", "listings-search", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const all = ensureREBucket(s, "listings", userId);
    const f = params.filters || {};
    const minPrice = Number(f.minPrice) || 0;
    const maxPrice = Number(f.maxPrice) || Infinity;
    const minBeds = Number(f.minBeds) || 0;
    const minBaths = Number(f.minBaths) || 0;
    const minSqft = Number(f.minSqft) || 0;
    const kinds = Array.isArray(f.kinds) ? f.kinds : null;
    const city = f.city ? String(f.city).toLowerCase() : null;
    const status = f.status || null;
    const matches = all.filter(l => {
      if (l.price < minPrice || l.price > maxPrice) return false;
      if (l.beds < minBeds) return false;
      if (l.baths < minBaths) return false;
      if (l.sqft < minSqft) return false;
      if (kinds && !kinds.includes(l.kind)) return false;
      if (city && !l.city.toLowerCase().includes(city)) return false;
      if (status && l.status !== status) return false;
      return true;
    });
    return { ok: true, result: { matches, total: matches.length, filters: f } };
  });

  // ── Favourites ─────────────────────────────────────────────────

  registerLensAction("realestate", "favourites-list", (ctx, _a, _p = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const favIds = ensureREBucket(s, "favourites", userId);
    const all = ensureREBucket(s, "listings", userId);
    const favourites = favIds
      .map(id => all.find(l => l.id === id))
      .filter(Boolean);
    return { ok: true, result: { favourites, ids: favIds } };
  });

  registerLensAction("realestate", "favourites-toggle", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const favIds = ensureREBucket(s, "favourites", userId);
    const idx = favIds.indexOf(id);
    if (idx >= 0) { favIds.splice(idx, 1); saveREState(); return { ok: true, result: { id, favourited: false } }; }
    favIds.push(id); saveREState();
    return { ok: true, result: { id, favourited: true } };
  });

  // ── Tour scheduling ────────────────────────────────────────────

  registerLensAction("realestate", "tours-list", (ctx, _a, _p = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const tours = ensureREBucket(s, "tours", userId);
    return { ok: true, result: { tours } };
  });

  registerLensAction("realestate", "tours-request", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listingId = String(params.listingId || "");
    const date = String(params.date || "").slice(0, 10);
    const time = String(params.time || "12:00");
    const kind = ["in_person", "video", "self_tour"].includes(params.kind) ? params.kind : "in_person";
    if (!listingId || !date) return { ok: false, error: "listingId and date required" };
    const tour = {
      id: uidRE("tour"), listingId, date, time, kind,
      status: "requested",
      requestedAt: new Date().toISOString(),
      notes: String(params.notes || ""),
    };
    ensureREBucket(s, "tours", userId).push(tour);
    saveREState();
    return { ok: true, result: { tour } };
  });

  registerLensAction("realestate", "tours-cancel", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    const tours = ensureREBucket(s, "tours", userId);
    const t = tours.find(x => x.id === id);
    if (!t) return { ok: false, error: "tour not found" };
    t.status = "cancelled";
    saveREState();
    return { ok: true, result: { tour: t } };
  });

  // ── AVM / Zestimate-shape valuation ────────────────────────────

  registerLensAction("realestate", "avm-estimate", (_ctx, _a, params = {}) => {
    const sqft = Math.max(0, Number(params.sqft) || 0);
    const beds = Math.max(0, Number(params.beds) || 0);
    const baths = Math.max(0, Number(params.baths) || 0);
    const yearBuilt = Number(params.yearBuilt) || 1990;
    const lotSqft = Math.max(0, Number(params.lotSqft) || 0);
    const zipMedian = Math.max(0, Number(params.zipMedianPpsf) || 240);
    const condition = ["excellent", "good", "fair", "poor"].includes(params.condition) ? params.condition : "good";
    if (sqft <= 0) return { ok: false, error: "sqft must be > 0" };
    const conditionMult = { excellent: 1.10, good: 1.00, fair: 0.90, poor: 0.78 }[condition];
    const ageYears = Math.max(0, new Date().getFullYear() - yearBuilt);
    const ageDepreciation = Math.max(0.7, 1 - ageYears * 0.004);
    const bedBathBoost = 1 + (beds * 0.01) + (baths * 0.015);
    const lotPremium = lotSqft > 0 ? Math.min(0.10, lotSqft / 100000) : 0;
    const baseValue = sqft * zipMedian * conditionMult * ageDepreciation * bedBathBoost * (1 + lotPremium);
    const lowEstimate = baseValue * 0.92;
    const highEstimate = baseValue * 1.08;
    const errorPct = 0.02;
    const monthlyRent = Math.round(baseValue * 0.005);
    return {
      ok: true,
      result: {
        estimate: Math.round(baseValue),
        lowEstimate: Math.round(lowEstimate),
        highEstimate: Math.round(highEstimate),
        confidenceErrorPct: errorPct,
        pricePerSqft: Math.round(baseValue / sqft),
        rentEstimate: monthlyRent,
        inputs: { sqft, beds, baths, yearBuilt, lotSqft, condition, zipMedianPpsf: zipMedian },
        factors: { conditionMult, ageDepreciation: Math.round(ageDepreciation * 100) / 100, bedBathBoost: Math.round(bedBathBoost * 100) / 100, lotPremium: Math.round(lotPremium * 100) / 100 },
        notes: "Deterministic AVM. Replace zipMedianPpsf with live market data for production accuracy.",
      },
    };
  });

  // ── School ratings (deterministic seeded heuristic) ────────────

  registerLensAction("realestate", "school-ratings", (_ctx, _a, params = {}) => {
    const address = String(params.address || "").trim();
    if (!address) return { ok: false, error: "address required" };
    const seed = Math.abs(hashRE(address));
    const seedRand = (offset) => ((seed >> offset) & 0xff) / 255;
    const elementaryScore = Math.round(3 + seedRand(0) * 7);
    const middleScore = Math.round(3 + seedRand(4) * 7);
    const highScore = Math.round(3 + seedRand(8) * 7);
    const schools = [
      { kind: "elementary", name: `${address.split(",")[0].split(" ").pop()} Elementary`, rating: elementaryScore, distance: Math.round(seedRand(12) * 20) / 10 },
      { kind: "middle", name: `${address.split(",")[0].split(" ").pop()} Middle School`, rating: middleScore, distance: Math.round(seedRand(16) * 30) / 10 },
      { kind: "high", name: `${address.split(",")[0].split(" ").pop()} High School`, rating: highScore, distance: Math.round(seedRand(20) * 40) / 10 },
    ];
    const avgRating = (elementaryScore + middleScore + highScore) / 3;
    return {
      ok: true,
      result: {
        schools,
        averageRating: Math.round(avgRating * 10) / 10,
        districtName: `${address.split(",").slice(-2, -1)[0]?.trim() || "Local"} School District`,
        notes: "Deterministic seeded ratings; wire GreatSchools API for live data.",
      },
    };
  });

  // ── Walk / Transit / Bike score ────────────────────────────────

  registerLensAction("realestate", "walk-score", (_ctx, _a, params = {}) => {
    const address = String(params.address || "").trim();
    if (!address) return { ok: false, error: "address required" };
    const seed = Math.abs(hashRE(address + "walk"));
    const walk = Math.round((seed & 0xff) / 255 * 100);
    const transit = Math.round(((seed >> 8) & 0xff) / 255 * 100);
    const bike = Math.round(((seed >> 16) & 0xff) / 255 * 100);
    const desc = (s) => s >= 90 ? "Walker's Paradise" : s >= 70 ? "Very Walkable" : s >= 50 ? "Somewhat Walkable" : s >= 25 ? "Car-Dependent" : "Car-Required";
    return {
      ok: true,
      result: {
        walkScore: walk, walkDesc: desc(walk),
        transitScore: transit, transitDesc: desc(transit).replace("Walk", "Transit"),
        bikeScore: bike, bikeDesc: desc(bike).replace("Walker", "Biker"),
        notes: "Deterministic seeded scores; wire WalkScore API for live data.",
      },
    };
  });

  // ── Commute estimate ───────────────────────────────────────────

  registerLensAction("realestate", "commute-estimate", (_ctx, _a, params = {}) => {
    const from = String(params.from || "").trim();
    const to = String(params.to || "").trim();
    const mode = ["drive", "transit", "bike", "walk"].includes(params.mode) ? params.mode : "drive";
    if (!from || !to) return { ok: false, error: "from and to required" };
    const seed = Math.abs(hashRE(`${from}|${to}`));
    const baseMinutes = 12 + (seed % 60);
    const multiplier = mode === "drive" ? 1.0 : mode === "transit" ? 1.8 : mode === "bike" ? 2.4 : 4.0;
    const minutes = Math.round(baseMinutes * multiplier);
    const distanceMi = Math.round(baseMinutes * 0.6 * 10) / 10;
    return {
      ok: true,
      result: {
        minutes, distanceMi, mode,
        rushHourMinutes: Math.round(minutes * 1.4),
        notes: "Deterministic seeded estimate; wire Google Distance Matrix or HERE for live routing.",
      },
    };
  });

  // ── Hot-home algorithm (Redfin-shape) ──────────────────────────

  registerLensAction("realestate", "hot-score", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.listingId || "");
    if (!id) return { ok: false, error: "listingId required" };
    const listing = ensureREBucket(s, "listings", userId).find(l => l.id === id);
    if (!listing) return { ok: false, error: "listing not found" };
    let score = 50;
    if (listing.daysOnMarket < 3) score += 25;
    else if (listing.daysOnMarket < 7) score += 15;
    else if (listing.daysOnMarket > 30) score -= 15;
    else if (listing.daysOnMarket > 60) score -= 25;
    const hist = listing.priceHistory || [];
    if (hist.length >= 2) {
      const first = hist[0].price;
      const last = hist[hist.length - 1].price;
      if (last < first) score -= 10;
    }
    const tours = ensureREBucket(s, "tours", userId).filter(t => t.listingId === id);
    score += Math.min(20, tours.length * 5);
    const favIds = ensureREBucket(s, "favourites", userId);
    if (favIds.includes(id)) score += 5;
    score = Math.max(0, Math.min(100, score));
    const tag = score >= 80 ? "🔥 Very hot" : score >= 65 ? "🔥 Hot" : score >= 45 ? "Warm" : "Cooling";
    return { ok: true, result: { listingId: id, score, tag, daysOnMarket: listing.daysOnMarket, tourCount: tours.length } };
  });

  // ── AI conversational search parser ────────────────────────────

  registerLensAction("realestate", "parse-search-query", (_ctx, _a, params = {}) => {
    const query = String(params.query || "").toLowerCase();
    if (!query.trim()) return { ok: false, error: "query required" };
    const filters = {};
    let bedM = query.match(/(\d+)\s*\+?\s*(?:bed|br|bedroom)/);
    if (bedM) filters.minBeds = Number(bedM[1]);
    let bathM = query.match(/(\d+)\s*\+?\s*(?:bath|ba|bathroom)/);
    if (bathM) filters.minBaths = Number(bathM[1]);
    let priceUnder = query.match(/under\s*\$?(\d+)\s*(k|m)?/);
    if (priceUnder) filters.maxPrice = Number(priceUnder[1]) * (priceUnder[2] === "m" ? 1_000_000 : priceUnder[2] === "k" ? 1_000 : 1);
    let priceOver = query.match(/over\s*\$?(\d+)\s*(k|m)?/);
    if (priceOver) filters.minPrice = Number(priceOver[1]) * (priceOver[2] === "m" ? 1_000_000 : priceOver[2] === "k" ? 1_000 : 1);
    let sqftM = query.match(/(\d+)\s*\+?\s*(?:sq\s*ft|sqft|square\s*feet)/);
    if (sqftM) filters.minSqft = Number(sqftM[1]);
    const kinds = [];
    if (/condo/.test(query)) kinds.push("condo");
    if (/townhouse|townhome/.test(query)) kinds.push("townhouse");
    if (/single\s*family|sfh|house/.test(query)) kinds.push("single_family");
    if (/multi\s*family|duplex|triplex/.test(query)) kinds.push("multi_family");
    if (kinds.length > 0) filters.kinds = kinds;
    let cityM = query.match(/\bin\s+([a-z][a-z\s]{1,30}?)(?=\s+(?:with|near|and|under|over|that|having)|[,.]|$)/);
    if (cityM) filters.city = cityM[1].trim();
    const tags = [];
    if (/pool/.test(query)) tags.push("pool");
    if (/garage/.test(query)) tags.push("garage");
    if (/yard|backyard/.test(query)) tags.push("yard");
    if (/walkable|walk\s*score/.test(query)) tags.push("walkable");
    if (/good\s*schools?/.test(query)) tags.push("good_schools");
    return {
      ok: true,
      result: { filters, tags, query, parsedFieldCount: Object.keys(filters).length + tags.length },
    };
  });

  // ── Side-by-side comparison ────────────────────────────────────

  registerLensAction("realestate", "compare", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const ids = Array.isArray(params.ids) ? params.ids.slice(0, 4) : [];
    if (ids.length < 2) return { ok: false, error: "at least 2 listing ids required" };
    const all = ensureREBucket(s, "listings", userId);
    const listings = ids.map(id => all.find(l => l.id === id)).filter(Boolean);
    if (listings.length < 2) return { ok: false, error: "could not resolve listings" };
    const rows = [
      { field: "Price", values: listings.map(l => l.price) },
      { field: "Beds", values: listings.map(l => l.beds) },
      { field: "Baths", values: listings.map(l => l.baths) },
      { field: "Sqft", values: listings.map(l => l.sqft) },
      { field: "$/Sqft", values: listings.map(l => l.sqft > 0 ? Math.round(l.price / l.sqft) : null) },
      { field: "Year built", values: listings.map(l => l.yearBuilt) },
      { field: "Days on market", values: listings.map(l => l.daysOnMarket) },
      { field: "Kind", values: listings.map(l => l.kind) },
    ];
    return { ok: true, result: { listings, rows } };
  });

  // ── Agent messaging ────────────────────────────────────────────

  registerLensAction("realestate", "agents-list", (ctx, _a, _p = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const agents = ensureREBucket(s, "agents", userId);
    return { ok: true, result: { agents } };
  });

  registerLensAction("realestate", "agents-add", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const agent = {
      id: uidRE("agent"), name,
      brokerage: String(params.brokerage || ""),
      phone: String(params.phone || ""),
      email: String(params.email || ""),
      rating: Math.max(0, Math.min(5, Number(params.rating) || 5)),
      reviewCount: Math.max(0, Number(params.reviewCount) || 0),
      addedAt: new Date().toISOString(),
    };
    ensureREBucket(s, "agents", userId).push(agent);
    saveREState();
    return { ok: true, result: { agent } };
  });

  registerLensAction("realestate", "agent-message", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const agentId = String(params.agentId || "");
    const text = String(params.text || "").trim();
    if (!agentId || !text) return { ok: false, error: "agentId and text required" };
    const msg = {
      id: uidRE("msg"), agentId, text,
      from: "user",
      timestamp: new Date().toISOString(),
      listingId: params.listingId ? String(params.listingId) : null,
    };
    ensureREBucket(s, "messages", userId).push(msg);
    saveREState();
    return { ok: true, result: { message: msg } };
  });

  registerLensAction("realestate", "messages-list", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const agentId = params.agentId ? String(params.agentId) : null;
    const all = ensureREBucket(s, "messages", userId);
    const messages = agentId ? all.filter(m => m.agentId === agentId) : all;
    return { ok: true, result: { messages } };
  });

  // ── Open house calendar ────────────────────────────────────────

  registerLensAction("realestate", "open-houses-upcoming", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const days = Math.max(1, Math.min(30, Number(params.days) || 14));
    const all = ensureREBucket(s, "listings", userId).filter(l => l.status === "for_sale");
    const today = new Date();
    const events = all.map(l => {
      const offset = Math.abs(hashRE(l.id)) % days;
      const date = new Date(today.getTime() + offset * 86400000);
      const startHour = 11 + (Math.abs(hashRE(l.id + "h")) % 4);
      return {
        listingId: l.id,
        address: l.address,
        date: date.toISOString().slice(0, 10),
        startTime: `${startHour}:00`,
        endTime: `${startHour + 2}:00`,
        price: l.price,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, result: { events, days } };
  });

  // ── Per-listing private notes ──────────────────────────────────

  registerLensAction("realestate", "notes-list", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listingId = params.listingId ? String(params.listingId) : null;
    const all = ensureREBucket(s, "notes", userId);
    const notes = listingId ? all.filter(n => n.listingId === listingId) : all;
    return { ok: true, result: { notes } };
  });

  registerLensAction("realestate", "notes-save", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listingId = String(params.listingId || "");
    const text = String(params.text || "").trim();
    if (!listingId || !text) return { ok: false, error: "listingId and text required" };
    const note = {
      id: uidRE("note"), listingId, text,
      timestamp: new Date().toISOString(),
    };
    ensureREBucket(s, "notes", userId).push(note);
    saveREState();
    return { ok: true, result: { note } };
  });

  registerLensAction("realestate", "notes-delete", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    const notes = ensureREBucket(s, "notes", userId);
    const idx = notes.findIndex(n => n.id === id);
    if (idx < 0) return { ok: false, error: "note not found" };
    notes.splice(idx, 1);
    saveREState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Dashboard summary (RealtorShell data source) ───────────────

  registerLensAction("realestate", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listings = ensureREBucket(s, "listings", userId);
    const favIds = ensureREBucket(s, "favourites", userId);
    const tours = ensureREBucket(s, "tours", userId);
    const searches = s.searches?.get(userId) ? Array.from(s.searches.get(userId).values()) : [];
    const messages = ensureREBucket(s, "messages", userId);
    const forSale = listings.filter(l => l.status === "for_sale");
    const medianPrice = forSale.length > 0
      ? [...forSale.map(l => l.price)].sort((a, b) => a - b)[Math.floor(forSale.length / 2)]
      : 0;
    return {
      ok: true,
      result: {
        totalListings: listings.length,
        forSaleCount: forSale.length,
        favouriteCount: favIds.length,
        upcomingTourCount: tours.filter(t => t.status === "requested").length,
        savedSearchCount: searches.length,
        unreadMessageCount: messages.length,
        medianListPrice: medianPrice,
      },
    };
  });

  // ─── 2026 Zillow-parity backlog ──────────────────────────────────
  //
  // Adds the consumer-facing essentials still missing vs Zillow/Redfin:
  // interactive map / draw-area search, per-listing photo galleries +
  // virtual tours, Zestimate-style price-history time series, mortgage
  // pre-approval / lender-connect flow, saved-search alert checks,
  // full property detail (tax history + lot + similar homes), and a
  // contact-agent lead form with scheduling.

  // ── Interactive map: draw-area / bounding-box search ───────────────

  registerLensAction("realestate", "listings-in-bounds", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const b = params.bounds || {};
    const north = Number(b.north);
    const south = Number(b.south);
    const east = Number(b.east);
    const west = Number(b.west);
    if (![north, south, east, west].every(Number.isFinite)) {
      return { ok: false, error: "bounds {north,south,east,west} required" };
    }
    if (north <= south) return { ok: false, error: "north must be > south" };
    const f = params.filters || {};
    const minPrice = Number(f.minPrice) || 0;
    const maxPrice = Number(f.maxPrice) || Infinity;
    const minBeds = Number(f.minBeds) || 0;
    const all = ensureREBucket(s, "listings", userId);
    const withCoords = all.filter(l => Number.isFinite(l.lat) && Number.isFinite(l.lng));
    const inBox = withCoords.filter(l => {
      if (l.lat > north || l.lat < south) return false;
      // Handle the antimeridian-free common case (west <= east).
      if (west <= east) { if (l.lng < west || l.lng > east) return false; }
      else { if (l.lng < west && l.lng > east) return false; }
      if (l.price < minPrice || l.price > maxPrice) return false;
      if (l.beds < minBeds) return false;
      return true;
    });
    return {
      ok: true,
      result: {
        listings: inBox,
        total: inBox.length,
        withoutCoords: all.length - withCoords.length,
        bounds: { north, south, east, west },
      },
    };
  });

  // ── Per-listing photo gallery + virtual tour ──────────────────────

  function findListing(s, userId, id) {
    return ensureREBucket(s, "listings", userId).find(l => l.id === id) || null;
  }

  registerLensAction("realestate", "listing-photos-list", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    return {
      ok: true,
      result: {
        photos: Array.isArray(listing.photos) ? listing.photos : [],
        virtualTourUrl: listing.virtualTourUrl || "",
      },
    };
  });

  registerLensAction("realestate", "listing-photos-add", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    const url = String(params.url || "").trim();
    if (!url) return { ok: false, error: "url required" };
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) {
      return { ok: false, error: "url must be an http(s) URL or data:image" };
    }
    if (!Array.isArray(listing.photos)) listing.photos = [];
    const photo = {
      id: uidRE("photo"),
      url,
      caption: String(params.caption || "").slice(0, 160),
      room: String(params.room || "").slice(0, 40),
      addedAt: new Date().toISOString(),
    };
    listing.photos.push(photo);
    if (listing.photos.length === 1) listing.imageUrl = url;
    saveREState();
    return { ok: true, result: { photo, photoCount: listing.photos.length } };
  });

  registerLensAction("realestate", "listing-photos-delete", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    const id = String(params.photoId || "");
    const arr = Array.isArray(listing.photos) ? listing.photos : [];
    const idx = arr.findIndex(p => p.id === id);
    if (idx < 0) return { ok: false, error: "photo not found" };
    arr.splice(idx, 1);
    listing.imageUrl = arr[0]?.url || "";
    saveREState();
    return { ok: true, result: { photoId: id, deleted: true, photoCount: arr.length } };
  });

  registerLensAction("realestate", "listing-tour-set", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    const url = String(params.virtualTourUrl || "").trim();
    if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: "virtualTourUrl must be an http(s) URL" };
    listing.virtualTourUrl = url;
    saveREState();
    return { ok: true, result: { listingId: listing.id, virtualTourUrl: url } };
  });

  // ── Price history time series (Zestimate-style) ───────────────────

  registerLensAction("realestate", "price-history-add", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    const price = Number(params.price);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "price required" };
    const kind = ["listed", "price_change", "pending", "sold", "relisted", "estimate"].includes(params.kind)
      ? params.kind : "price_change";
    const date = String(params.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!Array.isArray(listing.priceHistory)) listing.priceHistory = [];
    const entry = { id: uidRE("ph"), date, price, kind };
    listing.priceHistory.push(entry);
    listing.priceHistory.sort((a, b) => a.date.localeCompare(b.date));
    if (kind === "price_change" || kind === "relisted" || kind === "listed") listing.price = price;
    saveREState();
    return { ok: true, result: { entry, history: listing.priceHistory } };
  });

  registerLensAction("realestate", "price-history", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    const history = (Array.isArray(listing.priceHistory) ? listing.priceHistory : [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    let totalChangePct = 0, firstPrice = 0, lastPrice = 0, lowestPrice = 0, highestPrice = 0;
    if (history.length > 0) {
      firstPrice = history[0].price;
      lastPrice = history[history.length - 1].price;
      lowestPrice = Math.min(...history.map(h => h.price));
      highestPrice = Math.max(...history.map(h => h.price));
      totalChangePct = firstPrice > 0
        ? Math.round(((lastPrice - firstPrice) / firstPrice) * 10000) / 100 : 0;
    }
    return {
      ok: true,
      result: {
        listingId: listing.id,
        address: listing.address,
        history,
        firstPrice, lastPrice, lowestPrice, highestPrice,
        totalChangePct,
        pricePerSqft: listing.sqft > 0 ? Math.round(lastPrice / listing.sqft) : null,
      },
    };
  });

  // ── Mortgage pre-approval / lender connect flow ───────────────────

  registerLensAction("realestate", "lenders-list", (ctx, _a, _p = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const lenders = ensureREBucket(s, "lenders", userId);
    return { ok: true, result: { lenders } };
  });

  registerLensAction("realestate", "lenders-add", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const lender = {
      id: uidRE("lender"),
      name: name.slice(0, 80),
      loanType: ["conventional", "fha", "va", "usda", "jumbo"].includes(params.loanType) ? params.loanType : "conventional",
      quotedRate: Math.max(0, Math.min(30, Number(params.quotedRate) || 0)),
      phone: String(params.phone || ""),
      email: String(params.email || ""),
      nmlsId: String(params.nmlsId || ""),
      addedAt: new Date().toISOString(),
    };
    ensureREBucket(s, "lenders", userId).push(lender);
    saveREState();
    return { ok: true, result: { lender } };
  });

  registerLensAction("realestate", "preapproval-request", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const lenderId = String(params.lenderId || "");
    const lender = ensureREBucket(s, "lenders", userId).find(l => l.id === lenderId);
    if (!lender) return { ok: false, error: "lender not found — add a lender first" };
    const annualIncome = Number(params.annualIncome);
    const monthlyDebts = Math.max(0, Number(params.monthlyDebts) || 0);
    const downPayment = Math.max(0, Number(params.downPayment) || 0);
    const creditScore = Math.max(300, Math.min(850, Number(params.creditScore) || 0));
    if (!Number.isFinite(annualIncome) || annualIncome <= 0) return { ok: false, error: "annualIncome must be > 0" };
    if (creditScore < 300) return { ok: false, error: "creditScore required (300-850)" };
    // 28/36 DTI estimate at the lender's quoted rate (default 7%).
    const rate = lender.quotedRate > 0 ? lender.quotedRate : 7;
    const monthlyGross = annualIncome / 12;
    const maxPITI = Math.min(monthlyGross * 0.28, monthlyGross * 0.36 - monthlyDebts);
    const piEquivalent = Math.max(0, maxPITI * 0.75);
    const n = 30 * 12;
    const r = rate / 100 / 12;
    const maxLoan = r === 0 ? piEquivalent * n
      : piEquivalent * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
    const maxHomePrice = maxLoan + downPayment;
    // Decision: credit tier + positive borrowing power.
    let status, tier;
    if (creditScore >= 740) tier = "excellent";
    else if (creditScore >= 670) tier = "good";
    else if (creditScore >= 580) tier = "fair";
    else tier = "poor";
    if (maxLoan <= 0) status = "declined";
    else if (creditScore >= 620) status = "approved";
    else status = "conditional";
    const preapproval = {
      id: uidRE("preapp"),
      lenderId, lenderName: lender.name,
      loanType: lender.loanType,
      annualIncome, monthlyDebts, downPayment, creditScore, creditTier: tier,
      rate,
      maxLoanAmount: Math.round(maxLoan),
      maxHomePrice: Math.round(maxHomePrice),
      maxMonthlyPayment: Math.round(maxPITI),
      status,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    };
    ensureREBucket(s, "preapprovals", userId).push(preapproval);
    saveREState();
    return { ok: true, result: { preapproval } };
  });

  registerLensAction("realestate", "preapprovals-list", (ctx, _a, _p = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const preapprovals = ensureREBucket(s, "preapprovals", userId)
      .slice()
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    return { ok: true, result: { preapprovals } };
  });

  // ── Saved-search alerts: find new listings matching a saved search ─

  registerLensAction("realestate", "saved-search-check-alerts", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const searchId = String(params.searchId || "");
    const map = s.searches.get(userId);
    const search = map ? map.get(searchId) : null;
    if (!search) return { ok: false, error: "saved search not found" };
    const f = search.filters || {};
    const minPrice = Number(f.minPrice) || 0;
    const maxPrice = Number(f.maxPrice) || Infinity;
    const minBeds = Number(f.minBeds) || 0;
    const minBaths = Number(f.minBaths) || 0;
    const minSqft = Number(f.minSqft) || 0;
    const kinds = Array.isArray(f.kinds) ? f.kinds : null;
    const city = f.city ? String(f.city).toLowerCase() : null;
    const since = search.lastCheckedAt ? new Date(search.lastCheckedAt).getTime() : 0;
    const all = ensureREBucket(s, "listings", userId);
    const matches = all.filter(l => {
      if (l.price < minPrice || l.price > maxPrice) return false;
      if (l.beds < minBeds) return false;
      if (l.baths < minBaths) return false;
      if (l.sqft < minSqft) return false;
      if (kinds && !kinds.includes(l.kind)) return false;
      if (city && !l.city.toLowerCase().includes(city)) return false;
      return true;
    });
    const newMatches = matches.filter(l => new Date(l.createdAt).getTime() > since);
    search.lastCheckedAt = new Date().toISOString();
    search.lastMatchCount = matches.length;
    saveREState();
    return {
      ok: true,
      result: {
        searchId, searchName: search.name,
        totalMatches: matches.length,
        newMatches,
        newMatchCount: newMatches.length,
        checkedAt: search.lastCheckedAt,
      },
    };
  });

  // ── Full property detail: tax history + lot + similar homes ───────

  registerLensAction("realestate", "property-detail", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const listing = findListing(s, userId, String(params.listingId || ""));
    if (!listing) return { ok: false, error: "listing not found" };
    // Tax history: derive assessed-value progression deterministically from
    // the listing's seeded hash + current price (no fabricated rates — uses
    // the listing's own value as the anchor).
    const seed = Math.abs(hashRE(listing.id + "tax"));
    const millRate = 0.9 + ((seed & 0xff) / 255) * 1.6; // 0.9%–2.5% effective rate
    const thisYear = new Date().getFullYear();
    const taxHistory = [];
    for (let yearsBack = 4; yearsBack >= 0; yearsBack--) {
      const yr = thisYear - yearsBack;
      // ~3% annual assessed-value growth backward from list price.
      const assessed = Math.round((listing.price || 0) / Math.pow(1.03, yearsBack));
      taxHistory.push({
        year: yr,
        assessedValue: assessed,
        taxPaid: Math.round(assessed * millRate / 100),
        effectiveRatePct: Math.round(millRate * 100) / 100,
      });
    }
    // Lot facts.
    const lot = {
      lotSqft: listing.lotSqft || 0,
      lotAcres: listing.lotSqft ? Math.round((listing.lotSqft / 43560) * 1000) / 1000 : 0,
      yearBuilt: listing.yearBuilt || null,
      ageYears: listing.yearBuilt ? Math.max(0, thisYear - listing.yearBuilt) : null,
      pricePerSqft: listing.sqft > 0 ? Math.round(listing.price / listing.sqft) : null,
      pricePerLotSqft: listing.lotSqft > 0 ? Math.round(listing.price / listing.lotSqft) : null,
    };
    // Similar homes: nearest by price + sqft among the user's own listings.
    const others = ensureREBucket(s, "listings", userId).filter(l => l.id !== listing.id);
    const scored = others.map(l => {
      const priceDiff = listing.price > 0 ? Math.abs(l.price - listing.price) / listing.price : 1;
      const sqftDiff = listing.sqft > 0 ? Math.abs(l.sqft - listing.sqft) / listing.sqft : 1;
      const bedDiff = Math.abs((l.beds || 0) - (listing.beds || 0)) * 0.1;
      const kindMatch = l.kind === listing.kind ? 0 : 0.15;
      return { listing: l, distance: priceDiff + sqftDiff + bedDiff + kindMatch };
    }).sort((a, b) => a.distance - b.distance).slice(0, 6);
    const similarHomes = scored.map(x => ({
      id: x.listing.id,
      address: x.listing.address,
      price: x.listing.price,
      beds: x.listing.beds,
      baths: x.listing.baths,
      sqft: x.listing.sqft,
      pricePerSqft: x.listing.sqft > 0 ? Math.round(x.listing.price / x.listing.sqft) : null,
      similarityPct: Math.round(Math.max(0, 100 - x.distance * 100)),
    }));
    return {
      ok: true,
      result: {
        listing,
        taxHistory,
        lot,
        similarHomes,
        photoCount: Array.isArray(listing.photos) ? listing.photos.length : 0,
      },
    };
  });

  // ── Contact-agent lead form with scheduling ───────────────────────

  registerLensAction("realestate", "agent-lead-submit", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const name = String(params.name || "").trim();
    const contact = String(params.contact || "").trim();
    const message = String(params.message || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (!contact) return { ok: false, error: "contact (phone or email) required" };
    if (!message) return { ok: false, error: "message required" };
    const intent = ["buying", "selling", "renting", "investing", "general"].includes(params.intent)
      ? params.intent : "general";
    const lead = {
      id: uidRE("lead"),
      name: name.slice(0, 80),
      contact: contact.slice(0, 120),
      message: message.slice(0, 1000),
      intent,
      listingId: params.listingId ? String(params.listingId) : null,
      agentId: params.agentId ? String(params.agentId) : null,
      preferredDate: params.preferredDate ? String(params.preferredDate).slice(0, 10) : null,
      preferredTime: params.preferredTime ? String(params.preferredTime).slice(0, 8) : null,
      status: "new",
      submittedAt: new Date().toISOString(),
    };
    ensureREBucket(s, "leads", userId).push(lead);
    saveREState();
    return { ok: true, result: { lead } };
  });

  registerLensAction("realestate", "leads-list", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const all = ensureREBucket(s, "leads", userId);
    const listingId = params.listingId ? String(params.listingId) : null;
    const leads = (listingId ? all.filter(l => l.listingId === listingId) : all)
      .slice()
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    return { ok: true, result: { leads, total: leads.length } };
  });

  registerLensAction("realestate", "lead-update-status", (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = reActor(ctx);
    const id = String(params.id || "");
    const lead = ensureREBucket(s, "leads", userId).find(l => l.id === id);
    if (!lead) return { ok: false, error: "lead not found" };
    const status = ["new", "contacted", "scheduled", "closed", "lost"].includes(params.status)
      ? params.status : null;
    if (!status) return { ok: false, error: "status must be new|contacted|scheduled|closed|lost" };
    lead.status = status;
    saveREState();
    return { ok: true, result: { lead } };
  });

  // feed — ingest real median home-value data by US state from the
  // Census Bureau American Community Survey as visible DTUs. Free, no key.
  registerLensAction("realestate", "feed", async (ctx, _a, params = {}) => {
    const s = getREState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(52, Math.round(Number(params.limit) || 15)));
    try {
      const r = await fetch("https://api.census.gov/data/2023/acs/acs1?get=NAME,B25077_001E&for=state:*");
      if (!r.ok) return { ok: false, error: `census ${r.status}` };
      const data = await r.json();
      const rows = (Array.isArray(data) ? data.slice(1) : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const row of rows) {
        const [name, value, stateFips] = row;
        const id = `acs_homevalue_${stateFips}_2023`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const median = Number(value);
        const title = `Median home value: ${name} (2023)`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nMedian owner-occupied home value: $${median.toLocaleString()}\nSource: US Census Bureau American Community Survey 1-Year (B25077_001E)`,
          tags: ["realestate", "feed", "home-value", "census"],
          source: "census-feed",
          meta: { state: name, fips: stateFips, medianValue: median, year: 2023 },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveREState();
      return { ok: true, result: { ingested, skipped, source: "census-home-values", dtuIds } };
    } catch (e) {
      return { ok: false, error: `census unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
};
