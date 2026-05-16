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
};
