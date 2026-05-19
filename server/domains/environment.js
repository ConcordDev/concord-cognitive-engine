// server/domains/environment.js
//
// Pure-compute environmental helpers (population trend, compliance,
// trail condition, diversion rate) plus real EPA Envirofacts and
// USGS Water Services APIs (free, no key required).

const EPA_ENVIROFACTS = "https://data.epa.gov/efservice";
const USGS_WATER = "https://waterservices.usgs.gov/nwis";
const AIRNOW_BASE = "https://www.airnowapi.org/aq/observation";

export default function registerEnvironmentActions(registerLensAction) {
  registerLensAction("environment", "populationTrend", (_ctx, artifact, _params) => {
    const surveys = artifact.data?.surveyData || [];
    if (surveys.length < 2) return { ok: true, result: { trend: 'insufficient_data', surveys: surveys.length } };
    const sorted = [...surveys].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const first = sorted[0].count || 0;
    const last = sorted[sorted.length - 1].count || 0;
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    const trend = change > 5 ? 'increasing' : change < -5 ? 'declining' : 'stable';
    return { ok: true, result: { species: artifact.title, trend, changePercent: Math.round(change * 10) / 10, firstCount: first, lastCount: last, dataPoints: surveys.length } };
  });

  registerLensAction("environment", "complianceCheck", (_ctx, artifact, params) => {
    const parameters = artifact.data?.parameters || [];
    const thresholds = params.thresholds || artifact.data?.thresholds || {};
    const results = parameters.map(p => {
      const threshold = thresholds[p.name] || p.threshold;
      const compliant = threshold ? p.value <= threshold.max && p.value >= (threshold.min || 0) : true;
      return { parameter: p.name, value: p.value, unit: p.unit, threshold, compliant };
    });
    const allCompliant = results.every(r => r.compliant);
    return { ok: true, result: { siteId: artifact.id, results, overallCompliant: allCompliant, violations: results.filter(r => !r.compliant).length, checkedAt: new Date().toISOString() } };
  });

  registerLensAction("environment", "trailCondition", (_ctx, artifact, _params) => {
    const trails = artifact.data?.trails || [artifact.data];
    const prioritized = trails.map(t => {
      const condition = t.condition || 3;
      const usage = t.usage || 'medium';
      const usageScore = usage === 'high' ? 3 : usage === 'medium' ? 2 : 1;
      const priority = (5 - condition) * usageScore;
      return { name: t.name || artifact.title, condition, usage, priorityScore: priority, maintenanceNeeded: t.maintenanceNeeded || '' };
    }).sort((a, b) => b.priorityScore - a.priorityScore);
    return { ok: true, result: { prioritized, total: prioritized.length } };
  });

  registerLensAction("environment", "diversionRate", (_ctx, artifact, params) => {
    const totalWaste = artifact.data?.totalVolume || params.totalWaste || 0;
    const diverted = artifact.data?.divertedVolume || params.diverted || 0;
    const rate = totalWaste > 0 ? Math.round((diverted / totalWaste) * 100) : 0;
    const byStream = artifact.data?.streams || [];
    return { ok: true, result: { diversionRate: rate, totalWaste, diverted, landfilled: totalWaste - diverted, streams: byStream, target: params.target || 50, meetsTarget: rate >= (params.target || 50) } };
  });

  /**
   * epa-superfund-search — Real EPA Superfund site lookup via
   * Envirofacts. Free, no API key. Searches by state + optional city.
   * params: { state: "CA"|"TX"|..., city?: string, limit?: 1-100 }
   */
  registerLensAction("environment", "epa-superfund-search", async (_ctx, _artifact, params = {}) => {
    const state = String(params.state || "").toUpperCase().trim();
    if (!state) return { ok: false, error: "state required (2-letter code)" };
    if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "state must be 2-letter code" };
    const city = params.city ? String(params.city).trim() : null;
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    // Envirofacts SEMS path: SEMS_NPL_VW (Superfund National Priorities List)
    const cityFilter = city ? `/CITY_NAME/=/${encodeURIComponent(city.toUpperCase())}` : "";
    const url = `${EPA_ENVIROFACTS}/SEMS.SEMS_NPL_VW/STATE_CODE/${state}${cityFilter}/ROWS/0:${limit - 1}/JSON`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`epa envirofacts ${r.status}`);
      const data = await r.json();
      const arr = Array.isArray(data) ? data : [];
      const sites = arr.map((s) => ({
        siteId: s.SITE_ID,
        siteName: s.SITE_NAME,
        city: s.CITY_NAME,
        state: s.STATE_CODE,
        zipCode: s.ZIP_CODE,
        county: s.COUNTY_NAME,
        npListStatus: s.NPL_STATUS_NAME,
        latitude: s.PRIMARY_LATITUDE ? Number(s.PRIMARY_LATITUDE) : null,
        longitude: s.PRIMARY_LONGITUDE ? Number(s.PRIMARY_LONGITUDE) : null,
        federalFacility: s.FEDERAL_FACILITY_IND === "Y",
        epaRegion: s.EPA_REGION_CODE,
      }));
      return {
        ok: true,
        result: {
          state, city, count: sites.length, sites,
          source: "epa-envirofacts-sems",
        },
      };
    } catch (e) {
      return { ok: false, error: `epa envirofacts unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * usgs-water-realtime — Real-time USGS streamflow / gauge height /
   * water temperature for a given site. Free, no API key.
   *
   * params: { siteCode: USGS gauge ID (e.g. "11407150" = Russian River CA),
   *           parameters?: comma-separated USGS pcodes (default streamflow + gauge height) }
   *
   * Common pcodes:
   *   00060 = Discharge (cfs)
   *   00065 = Gage height (ft)
   *   00010 = Water temperature (°C)
   *   00045 = Precipitation (in)
   */
  registerLensAction("environment", "usgs-water-realtime", async (_ctx, _artifact, params = {}) => {
    const siteCode = String(params.siteCode || "").trim();
    if (!siteCode) return { ok: false, error: "siteCode required (USGS gauge ID, e.g. 11407150)" };
    if (!/^\d{8,15}$/.test(siteCode)) return { ok: false, error: "siteCode must be 8-15 digits" };
    const parameterCd = String(params.parameters || "00060,00065").trim();
    const url = `${USGS_WATER}/iv/?format=json&sites=${siteCode}&parameterCd=${parameterCd}&siteStatus=all`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`usgs water ${r.status}`);
      const data = await r.json();
      const series = data?.value?.timeSeries || [];
      const readings = series.map((s) => {
        const v = s.values?.[0]?.value?.[0];
        return {
          siteName: s.sourceInfo?.siteName,
          siteCode: s.sourceInfo?.siteCode?.[0]?.value,
          latitude: s.sourceInfo?.geoLocation?.geogLocation?.latitude,
          longitude: s.sourceInfo?.geoLocation?.geogLocation?.longitude,
          variableName: s.variable?.variableName,
          variableDescription: s.variable?.variableDescription,
          unit: s.variable?.unit?.unitCode,
          pcode: s.variable?.variableCode?.[0]?.value,
          latestValue: v?.value != null ? parseFloat(v.value) : null,
          latestDateTime: v?.dateTime,
          qualifiers: v?.qualifiers,
        };
      });
      return {
        ok: true,
        result: {
          siteCode, readings, count: readings.length,
          queryDateTime: data?.value?.queryInfo?.note?.[3]?.value,
          source: "usgs-water-services",
        },
      };
    } catch (e) {
      return { ok: false, error: `usgs water unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * airnow-current — Real AQI observations via AirNow API.
   * Requires AIRNOW_API_KEY env (free at docs.airnowapi.org/account/request).
   * params: { zipCode?: 5-digit, latitude?, longitude?, distance?: miles (default 25) }
   */
  registerLensAction("environment", "airnow-current", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.AIRNOW_API_KEY;
    if (!apiKey) return { ok: false, error: "AIRNOW_API_KEY required (free at docs.airnowapi.org/account/request)" };
    const distance = Math.max(1, Math.min(100, Number(params.distance) || 25));
    let url;
    if (params.zipCode && /^\d{5}$/.test(String(params.zipCode))) {
      url = `${AIRNOW_BASE}/zipCode/current/?format=application/json&zipCode=${params.zipCode}&distance=${distance}&API_KEY=${encodeURIComponent(apiKey)}`;
    } else if (params.latitude != null && params.longitude != null) {
      url = `${AIRNOW_BASE}/latLong/current/?format=application/json&latitude=${Number(params.latitude)}&longitude=${Number(params.longitude)}&distance=${distance}&API_KEY=${encodeURIComponent(apiKey)}`;
    } else {
      return { ok: false, error: "zipCode (5 digits) OR latitude+longitude required" };
    }
    try {
      const r = await fetch(url);
      if (r.status === 401) return { ok: false, error: "AIRNOW_API_KEY invalid" };
      if (!r.ok) throw new Error(`airnow ${r.status}`);
      const data = await r.json();
      const observations = (data || []).map((o) => ({
        dateObserved: o.DateObserved,
        hourObserved: o.HourObserved,
        localTimeZone: o.LocalTimeZone,
        reportingArea: o.ReportingArea,
        stateCode: o.StateCode,
        latitude: o.Latitude,
        longitude: o.Longitude,
        parameterName: o.ParameterName,
        aqi: o.AQI,
        category: o.Category?.Name,
        categoryNumber: o.Category?.Number,
      }));
      return {
        ok: true,
        result: { observations, count: observations.length, source: "epa-airnow" },
      };
    } catch (e) {
      return { ok: false, error: `airnow unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Full-app parity: Watershed + Persefoni carbon accounting ──────

  function uidEnv(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function envActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function ensureEnvState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.environmentLens) STATE.environmentLens = {};
    return STATE.environmentLens;
  }
  function saveEnvState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function ensureEnvBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }

  /**
   * EPA emission factors — published in the annual EPA GHG Emission
   * Factors Hub (https://www.epa.gov/climateleadership/ghg-emission-
   * factors-hub). These are physical/regulatory constants (kg CO2e
   * per unit) with documented EPA citations, not seed data.
   *
   * Updated to the 2024 release. Per the GHG Protocol, Scope 2
   * factors here use the US national grid average (eGRID 2022); for
   * production use the user's actual eGRID subregion factor.
   */
  const EMISSION_FACTORS = {
    // ── Scope 1 (direct combustion) — kg CO2e per unit ────────
    natural_gas_therm: { co2e: 5.302, unit: "therm", scope: 1, source: "EPA GHG EFH 2024 Table 1" },
    natural_gas_mmbtu: { co2e: 53.06, unit: "mmBtu", scope: 1, source: "EPA GHG EFH 2024 Table 1" },
    diesel_gallon: { co2e: 10.21, unit: "gallon", scope: 1, source: "EPA GHG EFH 2024 Table 2" },
    gasoline_gallon: { co2e: 8.78, unit: "gallon", scope: 1, source: "EPA GHG EFH 2024 Table 2" },
    propane_gallon: { co2e: 5.72, unit: "gallon", scope: 1, source: "EPA GHG EFH 2024 Table 2" },
    fuel_oil_2_gallon: { co2e: 10.21, unit: "gallon", scope: 1, source: "EPA GHG EFH 2024 Table 2" },
    coal_short_ton: { co2e: 2086.0, unit: "short ton", scope: 1, source: "EPA GHG EFH 2024 Table 1" },
    // Refrigerants — high-GWP, multiplied by GWP100 per IPCC AR5
    refrigerant_r410a_kg: { co2e: 2088, unit: "kg", scope: 1, source: "EPA GHG EFH 2024 Table 5; AR5 GWP" },
    refrigerant_r134a_kg: { co2e: 1430, unit: "kg", scope: 1, source: "EPA GHG EFH 2024 Table 5; AR5 GWP" },
    // ── Scope 2 (purchased electricity) — eGRID 2022 US average ──
    electricity_kwh_us_avg: { co2e: 0.371, unit: "kWh", scope: 2, source: "EPA eGRID 2022 US national avg" },
    electricity_kwh_california: { co2e: 0.222, unit: "kWh", scope: 2, source: "EPA eGRID 2022 CAMX subregion" },
    electricity_kwh_texas: { co2e: 0.434, unit: "kWh", scope: 2, source: "EPA eGRID 2022 ERCT subregion" },
    electricity_kwh_new_york: { co2e: 0.181, unit: "kWh", scope: 2, source: "EPA eGRID 2022 NYUP subregion" },
    steam_lb: { co2e: 0.0851, unit: "lb steam", scope: 2, source: "EPA GHG EFH 2024 Table 7" },
    // ── Scope 3 — business travel / commuting / purchased goods ──
    air_travel_short_haul_passenger_mile: { co2e: 0.207, unit: "passenger-mile", scope: 3, source: "EPA GHG EFH 2024 Table 8" },
    air_travel_medium_haul_passenger_mile: { co2e: 0.129, unit: "passenger-mile", scope: 3, source: "EPA GHG EFH 2024 Table 8" },
    air_travel_long_haul_passenger_mile: { co2e: 0.163, unit: "passenger-mile", scope: 3, source: "EPA GHG EFH 2024 Table 8" },
    rail_passenger_mile: { co2e: 0.0855, unit: "passenger-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
    bus_passenger_mile: { co2e: 0.0717, unit: "passenger-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
    taxi_passenger_mile: { co2e: 0.366, unit: "passenger-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
    hotel_room_night: { co2e: 31.1, unit: "room-night", scope: 3, source: "EPA GHG EFH 2024 Table 10" },
    // Freight (Scope 3 cat 4 + 9 upstream + downstream transportation)
    freight_truck_ton_mile: { co2e: 0.161, unit: "ton-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
    freight_rail_ton_mile: { co2e: 0.0263, unit: "ton-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
    freight_air_ton_mile: { co2e: 1.336, unit: "ton-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
    freight_sea_ton_mile: { co2e: 0.0152, unit: "ton-mile", scope: 3, source: "EPA GHG EFH 2024 Table 9" },
  };

  registerLensAction("environment", "emission-factors-list", (_ctx, _a, _p = {}) => {
    const factors = Object.entries(EMISSION_FACTORS).map(([key, f]) => ({ key, ...f }));
    return {
      ok: true,
      result: {
        factors,
        source: "EPA Greenhouse Gas Emission Factors Hub 2024 + eGRID 2022 + IPCC AR5 GWP",
        scopes: { scope1: factors.filter(f => f.scope === 1).length, scope2: factors.filter(f => f.scope === 2).length, scope3: factors.filter(f => f.scope === 3).length },
      },
    };
  });

  registerLensAction("environment", "emission-factors-lookup", (_ctx, _a, params = {}) => {
    const key = String(params.key || "");
    const factor = EMISSION_FACTORS[key];
    if (!factor) return { ok: false, error: `unknown factor key '${key}'. Use environment.emission-factors-list to see all ${Object.keys(EMISSION_FACTORS).length} available.` };
    return { ok: true, result: { key, ...factor } };
  });

  // ── Emissions activities (Scope 1/2/3 line items) ───────────

  registerLensAction("environment", "activities-list", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const scope = params.scope ? Number(params.scope) : null;
    const year = params.year ? String(params.year) : null;
    const all = ensureEnvBucket(s, "activities", userId);
    let activities = all;
    if (scope) activities = activities.filter(a => a.scope === scope);
    if (year) activities = activities.filter(a => a.date.slice(0, 4) === year);
    return { ok: true, result: { activities: activities.slice().reverse(), total: all.length } };
  });

  registerLensAction("environment", "activities-log", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const factorKey = String(params.factorKey || "");
    const amount = Number(params.amount);
    const date = String(params.date || new Date().toISOString().slice(0, 10));
    if (!EMISSION_FACTORS[factorKey]) return { ok: false, error: `unknown factor key '${factorKey}'` };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const factor = EMISSION_FACTORS[factorKey];
    const co2eKg = amount * factor.co2e;
    const activity = {
      id: uidEnv("act"), factorKey, amount, unit: factor.unit, scope: factor.scope,
      co2eKg: Math.round(co2eKg * 100) / 100,
      co2eTonnes: Math.round((co2eKg / 1000) * 100) / 100,
      date,
      facility: String(params.facility || ""),
      supplierId: params.supplierId ? String(params.supplierId) : null,
      category: String(params.category || ""),
      notes: String(params.notes || ""),
      source: factor.source,
      loggedAt: new Date().toISOString(),
    };
    ensureEnvBucket(s, "activities", userId).push(activity);
    saveEnvState();
    return { ok: true, result: { activity } };
  });

  registerLensAction("environment", "activities-delete", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const list = ensureEnvBucket(s, "activities", userId);
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) return { ok: false, error: "activity not found" };
    list.splice(idx, 1);
    saveEnvState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Suppliers + Scope 3 invitations (Persefoni-style portal) ───

  registerLensAction("environment", "suppliers-list", (ctx, _a, _p = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const suppliers = ensureEnvBucket(s, "suppliers", userId);
    return { ok: true, result: { suppliers } };
  });

  registerLensAction("environment", "suppliers-add", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const name = String(params.name || "").trim();
    const email = String(params.email || "").trim();
    if (!name || !email) return { ok: false, error: "name and email required" };
    const supplier = {
      id: uidEnv("sup"), name, email,
      contactName: String(params.contactName || ""),
      spendUsd: Math.max(0, Number(params.spendUsd) || 0),
      categoryCode: String(params.categoryCode || ""),
      invitationStatus: "not_invited",
      reportedCo2eTonnes: null,
      lastReportedAt: null,
      createdAt: new Date().toISOString(),
    };
    ensureEnvBucket(s, "suppliers", userId).push(supplier);
    saveEnvState();
    return { ok: true, result: { supplier } };
  });

  registerLensAction("environment", "suppliers-invite", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const sup = ensureEnvBucket(s, "suppliers", userId).find(x => x.id === id);
    if (!sup) return { ok: false, error: "supplier not found" };
    sup.invitationStatus = "invited";
    sup.invitedAt = new Date().toISOString();
    sup.portalToken = uidEnv("tok");
    saveEnvState();
    return { ok: true, result: { supplier: sup, portalLink: `/supplier-portal/${sup.portalToken}` } };
  });

  registerLensAction("environment", "suppliers-record-disclosure", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const tonnes = Number(params.co2eTonnes);
    const year = String(params.year || new Date().getFullYear());
    if (!Number.isFinite(tonnes) || tonnes < 0) return { ok: false, error: "co2eTonnes must be >= 0" };
    const sup = ensureEnvBucket(s, "suppliers", userId).find(x => x.id === id);
    if (!sup) return { ok: false, error: "supplier not found" };
    sup.invitationStatus = "responded";
    sup.reportedCo2eTonnes = Math.round(tonnes * 100) / 100;
    sup.reportingYear = year;
    sup.lastReportedAt = new Date().toISOString();
    saveEnvState();
    return { ok: true, result: { supplier: sup } };
  });

  // ── Decarbonization targets (SBTi-style) ────────────────────

  registerLensAction("environment", "targets-list", (ctx, _a, _p = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const targets = ensureEnvBucket(s, "targets", userId);
    return { ok: true, result: { targets } };
  });

  registerLensAction("environment", "targets-create", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const name = String(params.name || "").trim();
    const baseYear = Math.max(2000, Math.min(2099, Number(params.baseYear) || 2020));
    const targetYear = Math.max(baseYear + 1, Math.min(2100, Number(params.targetYear) || 2030));
    const baseCo2eTonnes = Math.max(0, Number(params.baseCo2eTonnes) || 0);
    const reductionPct = Math.max(0, Math.min(100, Number(params.reductionPct) || 50));
    const scopes = Array.isArray(params.scopes) ? params.scopes.map(Number).filter(n => [1, 2, 3].includes(n)) : [1, 2];
    if (!name) return { ok: false, error: "name required" };
    const target = {
      id: uidEnv("tgt"), name,
      baseYear, targetYear, baseCo2eTonnes, reductionPct, scopes,
      targetCo2eTonnes: Math.round(baseCo2eTonnes * (1 - reductionPct / 100) * 100) / 100,
      framework: ["sbti_1.5c", "sbti_well_below_2c", "net_zero_2050", "custom"].includes(params.framework) ? params.framework : "custom",
      status: "active",
      createdAt: new Date().toISOString(),
    };
    ensureEnvBucket(s, "targets", userId).push(target);
    saveEnvState();
    return { ok: true, result: { target } };
  });

  registerLensAction("environment", "targets-progress", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const target = ensureEnvBucket(s, "targets", userId).find(t => t.id === id);
    if (!target) return { ok: false, error: "target not found" };
    const activities = ensureEnvBucket(s, "activities", userId);
    const currentYear = new Date().getFullYear();
    const currentEmissions = activities
      .filter(a => target.scopes.includes(a.scope) && a.date.startsWith(String(currentYear)))
      .reduce((s, a) => s + a.co2eTonnes, 0);
    const reductionAchieved = target.baseCo2eTonnes > 0 ? ((target.baseCo2eTonnes - currentEmissions) / target.baseCo2eTonnes) * 100 : 0;
    const yearsElapsed = currentYear - target.baseYear;
    const yearsTotal = target.targetYear - target.baseYear;
    const expectedReduction = (target.reductionPct * yearsElapsed) / yearsTotal;
    const onTrack = reductionAchieved >= expectedReduction;
    return {
      ok: true,
      result: {
        target,
        currentEmissions: Math.round(currentEmissions * 100) / 100,
        reductionAchievedPct: Math.round(reductionAchieved * 10) / 10,
        expectedReductionPct: Math.round(expectedReduction * 10) / 10,
        onTrack,
        gapToTarget: Math.round((currentEmissions - target.targetCo2eTonnes) * 100) / 100,
      },
    };
  });

  // ── Reduction projects ──────────────────────────────────────

  registerLensAction("environment", "projects-list", (ctx, _a, _p = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const projects = ensureEnvBucket(s, "projects", userId);
    return { ok: true, result: { projects } };
  });

  registerLensAction("environment", "projects-create", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const project = {
      id: uidEnv("prj"), name,
      description: String(params.description || ""),
      expectedReductionTonnesPerYear: Math.max(0, Number(params.expectedReductionTonnesPerYear) || 0),
      costUsd: Math.max(0, Number(params.costUsd) || 0),
      paybackYears: Number(params.paybackYears) || null,
      status: "proposed",
      startDate: params.startDate || null,
      actualReductionTonnes: 0,
      createdAt: new Date().toISOString(),
    };
    ensureEnvBucket(s, "projects", userId).push(project);
    saveEnvState();
    return { ok: true, result: { project } };
  });

  registerLensAction("environment", "projects-update-status", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const status = String(params.status || "");
    if (!["proposed", "approved", "in_progress", "completed", "cancelled"].includes(status)) {
      return { ok: false, error: "invalid status" };
    }
    const project = ensureEnvBucket(s, "projects", userId).find(p => p.id === id);
    if (!project) return { ok: false, error: "project not found" };
    project.status = status;
    if (status === "completed") project.completedAt = new Date().toISOString();
    if (params.actualReductionTonnes != null) project.actualReductionTonnes = Number(params.actualReductionTonnes);
    saveEnvState();
    return { ok: true, result: { project } };
  });

  // ── Renewable Energy Certificates (RECs) ────────────────────

  registerLensAction("environment", "recs-list", (ctx, _a, _p = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const recs = ensureEnvBucket(s, "recs", userId);
    return { ok: true, result: { recs } };
  });

  registerLensAction("environment", "recs-purchase", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const mwh = Math.max(0, Number(params.mwh) || 0);
    if (mwh <= 0) return { ok: false, error: "mwh must be > 0" };
    const rec = {
      id: uidEnv("rec"), mwh,
      tech: ["solar", "wind", "hydro", "biomass", "geothermal"].includes(params.tech) ? params.tech : "solar",
      vintage: String(params.vintage || new Date().getFullYear()),
      registry: ["WREGIS", "M-RETS", "PJM-GATS", "NEPOOL-GIS", "ERCOT", "NAR"].includes(params.registry) ? params.registry : "WREGIS",
      certificateNumber: `REC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      pricePerMwhUsd: Math.max(0, Number(params.pricePerMwhUsd) || 0),
      status: "purchased",
      retiredAt: null,
      purchasedAt: new Date().toISOString(),
    };
    ensureEnvBucket(s, "recs", userId).push(rec);
    saveEnvState();
    return { ok: true, result: { rec } };
  });

  registerLensAction("environment", "recs-retire", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const rec = ensureEnvBucket(s, "recs", userId).find(r => r.id === id);
    if (!rec) return { ok: false, error: "REC not found" };
    if (rec.status === "retired") return { ok: false, error: "REC already retired" };
    rec.status = "retired";
    rec.retiredAt = new Date().toISOString();
    rec.retirementReason = String(params.reason || "voluntary");
    saveEnvState();
    return { ok: true, result: { rec } };
  });

  // ── Carbon offsets ──────────────────────────────────────────

  registerLensAction("environment", "offsets-list", (ctx, _a, _p = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const offsets = ensureEnvBucket(s, "offsets", userId);
    return { ok: true, result: { offsets } };
  });

  registerLensAction("environment", "offsets-purchase", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const tonnes = Math.max(0, Number(params.tonnes) || 0);
    if (tonnes <= 0) return { ok: false, error: "tonnes must be > 0" };
    const offset = {
      id: uidEnv("off"), tonnes,
      project: String(params.project || "").trim(),
      kind: ["forestry_redd", "afforestation", "direct_air_capture", "biochar", "soil_carbon", "renewable_energy", "methane_capture", "cookstoves"].includes(params.kind) ? params.kind : "forestry_redd",
      registry: ["Verra_VCS", "Gold_Standard", "Climate_Action_Reserve", "American_Carbon_Registry", "Puro_earth"].includes(params.registry) ? params.registry : "Verra_VCS",
      vintage: String(params.vintage || new Date().getFullYear()),
      pricePerTonneUsd: Math.max(0, Number(params.pricePerTonneUsd) || 0),
      serialNumber: `OFF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      status: "purchased",
      retiredAt: null,
      purchasedAt: new Date().toISOString(),
    };
    ensureEnvBucket(s, "offsets", userId).push(offset);
    saveEnvState();
    return { ok: true, result: { offset } };
  });

  registerLensAction("environment", "offsets-retire", (ctx, _a, params = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const id = String(params.id || "");
    const off = ensureEnvBucket(s, "offsets", userId).find(o => o.id === id);
    if (!off) return { ok: false, error: "offset not found" };
    if (off.status === "retired") return { ok: false, error: "offset already retired" };
    off.status = "retired";
    off.retiredAt = new Date().toISOString();
    off.retirementReason = String(params.reason || "voluntary");
    saveEnvState();
    return { ok: true, result: { offset: off } };
  });

  // ── Real EPA EJScreen API (environmental justice scoring) ───

  registerLensAction("environment", "epa-ejscreen", async (_ctx, _a, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    const radiusMiles = Math.max(0.5, Math.min(10, Number(params.radiusMiles) || 1));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required" };
    try {
      const url = `https://ejscreen.epa.gov/mapper/ejscreenRESTbroker.aspx?namestr=&geometry={"spatialReference":{"wkid":4326},"x":${lng},"y":${lat}}&distance=${radiusMiles}&unit=9035&areatype=&areaid=&f=pjson`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `EJScreen ${r.status}` };
      const data = await r.json();
      return {
        ok: true,
        result: {
          lat, lng, radiusMiles,
          ...data,
          source: "EPA EJScreen REST API (ejscreen.epa.gov)",
        },
      };
    } catch (e) {
      return { ok: false, error: `EJScreen unreachable: ${e?.message || "network"}` };
    }
  });

  // ── NOAA Climate Data API (real Climate Data Online) ────────

  registerLensAction("environment", "noaa-climate-stations", async (_ctx, _a, params = {}) => {
    const apiToken = process.env.NOAA_CDO_TOKEN;
    if (!apiToken) {
      return { ok: false, error: "NOAA_CDO_TOKEN not configured. Register at https://www.ncdc.noaa.gov/cdo-web/token (free)." };
    }
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat and lng required" };
    const radius = Math.max(0.1, Math.min(5, Number(params.radiusDeg) || 1));
    try {
      const extent = `${lat - radius},${lng - radius},${lat + radius},${lng + radius}`;
      const url = `https://www.ncdc.noaa.gov/cdo-web/api/v2/stations?extent=${extent}&limit=25`;
      const r = await globalThis.fetch(url, { headers: { token: apiToken } });
      if (!r.ok) return { ok: false, error: `NOAA CDO ${r.status}` };
      const data = await r.json();
      return {
        ok: true,
        result: {
          stations: (data.results || []).map(s => ({
            id: s.id, name: s.name,
            latitude: s.latitude, longitude: s.longitude,
            elevation: s.elevation,
            mindate: s.mindate, maxdate: s.maxdate,
          })),
          source: "NOAA Climate Data Online v2 (ncdc.noaa.gov)",
        },
      };
    } catch (e) {
      return { ok: false, error: `NOAA CDO unreachable: ${e?.message || "network"}` };
    }
  });

  // ── Dashboard summary (ClimateShell data source) ────────────

  registerLensAction("environment", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = ensureEnvState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = envActor(ctx);
    const activities = ensureEnvBucket(s, "activities", userId);
    const suppliers = ensureEnvBucket(s, "suppliers", userId);
    const targets = ensureEnvBucket(s, "targets", userId);
    const projects = ensureEnvBucket(s, "projects", userId);
    const recs = ensureEnvBucket(s, "recs", userId);
    const offsets = ensureEnvBucket(s, "offsets", userId);
    const currentYear = String(new Date().getFullYear());
    const lastYear = String(new Date().getFullYear() - 1);
    const yearTotal = (year, scope) => activities
      .filter(a => a.date.slice(0, 4) === year && (scope == null || a.scope === scope))
      .reduce((sum, a) => sum + a.co2eTonnes, 0);
    const ytdTotal = yearTotal(currentYear);
    const ytdScope1 = yearTotal(currentYear, 1);
    const ytdScope2 = yearTotal(currentYear, 2);
    const ytdScope3 = yearTotal(currentYear, 3);
    const lastYearTotal = yearTotal(lastYear);
    const yoyPct = lastYearTotal > 0 ? Math.round(((ytdTotal - lastYearTotal) / lastYearTotal) * 100 * 10) / 10 : 0;
    const totalSupplierEmissions = suppliers.reduce((s, sup) => s + (Number(sup.reportedCo2eTonnes) || 0), 0);
    const supplierResponseRate = suppliers.length > 0 ? Math.round((suppliers.filter(s => s.invitationStatus === "responded").length / suppliers.length) * 100) : 0;
    const recsRetiredMwh = recs.filter(r => r.status === "retired").reduce((s, r) => s + r.mwh, 0);
    const offsetsRetiredTonnes = offsets.filter(o => o.status === "retired").reduce((s, o) => s + o.tonnes, 0);
    return {
      ok: true,
      result: {
        currentYear,
        ytdTotalCo2eTonnes: Math.round(ytdTotal * 100) / 100,
        ytdScope1: Math.round(ytdScope1 * 100) / 100,
        ytdScope2: Math.round(ytdScope2 * 100) / 100,
        ytdScope3: Math.round(ytdScope3 * 100) / 100,
        lastYearTotal: Math.round(lastYearTotal * 100) / 100,
        yoyPct,
        activityCount: activities.length,
        supplierCount: suppliers.length,
        supplierResponseRate,
        supplierReportedTonnes: Math.round(totalSupplierEmissions * 100) / 100,
        activeTargets: targets.filter(t => t.status === "active").length,
        activeProjects: projects.filter(p => p.status === "in_progress" || p.status === "approved").length,
        recsRetiredMwh: Math.round(recsRetiredMwh * 100) / 100,
        offsetsRetiredTonnes: Math.round(offsetsRetiredTonnes * 100) / 100,
        netEmissionsTonnes: Math.round((ytdTotal - offsetsRetiredTonnes) * 100) / 100,
      },
    };
  });
};
