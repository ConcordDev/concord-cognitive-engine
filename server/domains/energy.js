// server/domains/energy.js
//
// Pure-compute energy helpers (consumption, solar estimate, carbon
// footprint, grid status) plus real US Energy Information
// Administration (EIA) data. EIA API requires free API key (register
// at https://www.eia.gov/opendata/register.php); set EIA_API_KEY env.

const EIA_BASE = "https://api.eia.gov/v2";

// Fail-CLOSED numeric parse: returns a FINITE number or the fallback. Unlike
// `parseFloat(x) || d`, this never lets Infinity / -Infinity / NaN through
// (parseFloat("1e999") === Infinity, parseFloat("Infinity") === Infinity, and
// `Infinity || d` keeps Infinity because it is truthy), which would otherwise
// cascade into the output and serialize to JSON `null` — a blank calculator in
// production. Optional [min,max] clamp keeps physically-meaningful bounds.
function finiteNum(v, fallback = 0, min, max) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  let out = n;
  if (typeof min === "number" && out < min) out = min;
  if (typeof max === "number" && out > max) out = max;
  return out;
}

export default function registerEnergyActions(registerLensAction) {
  registerLensAction("energy", "consumptionAnalysis", (ctx, artifact, _params) => {
    const readings = Array.isArray(artifact.data?.readings) ? artifact.data.readings : [];
    if (readings.length === 0) return { ok: true, result: { message: "Add energy readings (kWh) to analyze consumption." } };
    // Clamp each reading to a finite, non-negative kWh. Poisoned entries
    // (Infinity / NaN / "1e999") collapse to 0 rather than corrupting the sum.
    const values = readings.map((r) => finiteNum(r?.kWh ?? r?.value, 0, 0));
    const total = values.reduce((s, v) => s + v, 0);
    const avg = values.length > 0 ? total / values.length : 0;
    const peak = values.length > 0 ? Math.max(...values) : 0;
    const costPerKWh = finiteNum(artifact.data?.costPerKWh, 0.12, 0);
    const peakToAvgRatio = avg > 0 ? Math.round((peak / avg) * 100) / 100 : 0;
    return { ok: true, result: { totalKWh: Math.round(total * 10) / 10, avgKWh: Math.round(avg * 10) / 10, peakKWh: Math.round(peak * 10) / 10, readingCount: values.length, estimatedCost: Math.round(total * costPerKWh * 100) / 100, costPerKWh, peakToAvgRatio, savingsOpportunity: peak > avg * 2 ? "Significant peak reduction possible" : "Consumption is relatively stable" } };
  });
  registerLensAction("energy", "solarEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Clamp to physically-sane bounds so a poisoned ("1e999"/"Infinity") or
    // absurd input never cascades into Infinity panels/cost/payback.
    const roofSqFt = finiteNum(data.roofAreaSqFt, 1000, 100, 1_000_000);
    const sunHours = finiteNum(data.peakSunHours, 5, 0.1, 24);
    const usageKWh = finiteNum(data.monthlyUsageKWh, 900, 1, 10_000_000);
    const panelWatts = 400;
    const panelSqFt = 18;
    const maxPanels = Math.floor(roofSqFt * 0.7 / panelSqFt);
    const systemKW = maxPanels * panelWatts / 1000;
    const monthlyProduction = systemKW * sunHours * 30 * 0.8;
    const coveragePercent = Math.round((monthlyProduction / usageKWh) * 100);
    const costEstimate = Math.round(systemKW * 2800);
    const annualSavings = Math.round(Math.min(monthlyProduction, usageKWh) * 12 * 0.12);
    const paybackYears = annualSavings > 0 ? Math.round((costEstimate * 0.7) / annualSavings * 10) / 10 : 0; // 30% tax credit
    return { ok: true, result: { roofArea: roofSqFt, maxPanels, systemSizeKW: Math.round(systemKW * 10) / 10, monthlyProductionKWh: Math.round(monthlyProduction), coveragePercent, estimatedCost: costEstimate, afterTaxCredit: Math.round(costEstimate * 0.7), annualSavings, paybackYears, recommendation: coveragePercent >= 100 ? "Solar can cover 100% of usage" : `Solar can cover ${coveragePercent}% of usage` } };
  });
  registerLensAction("energy", "carbonFootprint", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Fail-closed, non-negative finite inputs CLAMPED to a sane upper bound so a
    // poisoned magnitude (e.g. 1e308) can never overflow an emission-factor
    // multiply into Infinity (which would render as null in the UI). 1e12 is far
    // above any real annual consumption yet leaves headroom before float overflow.
    const MAX_CONSUMPTION = 1e12;
    const electricityKWh = finiteNum(data.electricityKWh, 0, 0, MAX_CONSUMPTION);
    const naturalGasTherms = finiteNum(data.naturalGasTherms, 0, 0, MAX_CONSUMPTION);
    const gasolineGallons = finiteNum(data.gasolineGallons, 0, 0, MAX_CONSUMPTION);
    const flightMiles = finiteNum(data.flightMiles, 0, 0, MAX_CONSUMPTION);
    // EPA emission factors. Re-coerce each derived figure to finite as a
    // belt-and-suspenders guard against any residual non-finite arithmetic.
    const co2Electricity = finiteNum(electricityKWh * 0.000417, 0); // metric tons per kWh
    const co2Gas = finiteNum(naturalGasTherms * 0.0053, 0);
    const co2Gasoline = finiteNum(gasolineGallons * 0.00887, 0);
    const co2Flights = finiteNum(flightMiles * 0.000255, 0);
    const total = finiteNum(co2Electricity + co2Gas + co2Gasoline + co2Flights, 0);
    const usAvg = 16; // tons per capita
    return { ok: true, result: { breakdown: { electricity: Math.round(co2Electricity * 1000) / 1000, naturalGas: Math.round(co2Gas * 1000) / 1000, transportation: Math.round(co2Gasoline * 1000) / 1000, flights: Math.round(co2Flights * 1000) / 1000 }, totalMetricTons: Math.round(total * 1000) / 1000, annualEstimate: Math.round(total * 12 * 100) / 100, vsUSAverage: `${Math.round((total * 12 / usAvg) * 100)}% of US average`, topSource: [["electricity", co2Electricity], ["naturalGas", co2Gas], ["transportation", co2Gasoline], ["flights", co2Flights]].sort((a, b) => b[1] - a[1])[0][0], reductionTips: co2Electricity > co2Gas ? ["Switch to renewable energy provider", "Improve insulation", "LED lighting"] : ["Improve heating efficiency", "Seal air leaks", "Smart thermostat"] } };
  });
  /**
   * eia-electricity-rates — Real average retail electricity price by
   * state (cents/kWh). Pulled from EIA's seriesId
   * ELEC.PRICE.{STATE}-RES.M (residential, monthly).
   * Requires EIA_API_KEY env (free at eia.gov/opendata/register.php).
   * params: { state: "CA"|"TX"|..., sector?: "RES"|"COM"|"IND" }
   */
  registerLensAction("energy", "eia-electricity-rates", async (_ctx, _artifact, params = {}) => {
    const state = String(params.state || "").toUpperCase().trim();
    const sector = String(params.sector || "RES").toUpperCase();
    if (!state) return { ok: false, error: "state required (2-letter code)" };
    if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "state must be 2-letter code (e.g. CA, TX)" };
    if (!["RES", "COM", "IND", "TRA", "ALL"].includes(sector)) {
      return { ok: false, error: "sector must be one of: RES (residential), COM (commercial), IND (industrial), TRA (transport), ALL" };
    }
    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "EIA_API_KEY env required (free at https://www.eia.gov/opendata/register.php)" };
    }
    try {
      const url = `${EIA_BASE}/electricity/retail-sales/data/?api_key=${encodeURIComponent(apiKey)}&frequency=monthly&data[0]=price&facets[stateid][]=${state}&facets[sectorid][]=${sector}&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=12`;
      const r = await fetch(url);
      if (!r.ok) {
        if (r.status === 403) return { ok: false, error: "EIA API key invalid or quota exceeded" };
        throw new Error(`eia ${r.status}`);
      }
      const data = await r.json();
      const rows = data?.response?.data || [];
      const series = rows.map((row) => ({
        period: row.period,
        state: row.stateDescription,
        sector: row.sectorName,
        priceCentsPerKwh: parseFloat(row.price),
      }));
      const latest = series[0];
      const yearAgo = series[11];
      return {
        ok: true,
        result: {
          state, sector,
          latest: latest ? { period: latest.period, priceCentsPerKwh: latest.priceCentsPerKwh } : null,
          yearOverYearChangePct: latest && yearAgo && yearAgo.priceCentsPerKwh > 0
            ? Math.round(((latest.priceCentsPerKwh - yearAgo.priceCentsPerKwh) / yearAgo.priceCentsPerKwh) * 1000) / 10
            : null,
          monthlySeries: series,
          source: "eia-electricity-retail-sales",
        },
      };
    } catch (e) {
      return { ok: false, error: `eia unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * eia-generation-mix — Real generation source mix by region (coal,
   * natural gas, nuclear, hydro, solar, wind, etc.). Latest monthly
   * data from EIA seriesId ELEC.GEN.*.M.
   * params: { region?: "US"|"CAL"|"TEX"|"NY"|... (regionId from EIA) }
   */
  registerLensAction("energy", "eia-generation-mix", async (_ctx, _artifact, params = {}) => {
    const region = String(params.region || "US").toUpperCase().trim();
    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "EIA_API_KEY env required (free at https://www.eia.gov/opendata/register.php)" };
    }
    try {
      const url = `${EIA_BASE}/electricity/electric-power-operational-data/data/?api_key=${encodeURIComponent(apiKey)}&frequency=monthly&data[0]=generation&facets[location][]=${region}&facets[sectorid][]=99&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=50`;
      const r = await fetch(url);
      if (!r.ok) {
        if (r.status === 403) return { ok: false, error: "EIA API key invalid or quota exceeded" };
        throw new Error(`eia ${r.status}`);
      }
      const data = await r.json();
      const rows = data?.response?.data || [];
      if (rows.length === 0) {
        return { ok: true, result: { region, mix: [], totalMWh: 0, source: "eia-electric-power-operational" } };
      }
      // Group by fuel type from the latest period.
      const latestPeriod = rows[0]?.period;
      const latestRows = rows.filter((r) => r.period === latestPeriod);
      const byFuel = {};
      let totalMWh = 0;
      for (const row of latestRows) {
        const fuel = row.fueltypeDescription || row.fueltype || "Other";
        const gen = parseFloat(row.generation) || 0;
        byFuel[fuel] = (byFuel[fuel] || 0) + gen;
        totalMWh += gen;
      }
      const mix = Object.entries(byFuel)
        .map(([fuel, mwh]) => ({
          fuel,
          mwh: Math.round(mwh),
          sharePct: totalMWh > 0 ? Math.round((mwh / totalMWh) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.mwh - a.mwh);
      const renewables = ["Solar", "Wind", "Hydro", "Geothermal", "Other Biomass", "Wood and Wood-Derived Fuels"];
      const renewableShare = mix
        .filter((m) => renewables.some((r) => m.fuel.toLowerCase().includes(r.toLowerCase())))
        .reduce((s, m) => s + m.sharePct, 0);
      return {
        ok: true,
        result: {
          region, latestPeriod,
          mix, totalMWh,
          renewableSharePct: Math.round(renewableShare * 10) / 10,
          source: "eia-electric-power-operational",
        },
      };
    } catch (e) {
      return { ok: false, error: `eia unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("energy", "gridStatus", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Fail-closed finite parse with sane bounds; these values are also echoed
    // into output strings, so an unguarded Infinity would render "Infinity MW".
    const demandMW = finiteNum(data.currentDemandMW, 0, 0, 100_000_000);
    const capacityMW = finiteNum(data.totalCapacityMW, 0, 0, 100_000_000);
    const renewablePercent = finiteNum(data.renewablePercent, 0, 0, 100);
    const frequency = finiteNum(data.gridFrequencyHz, 60, 0, 1000);
    const utilization = capacityMW > 0 ? Math.round((demandMW / capacityMW) * 100) : 0;
    const frequencyDeviation = Math.abs(frequency - 60);
    return { ok: true, result: { currentDemand: `${demandMW} MW`, totalCapacity: `${capacityMW} MW`, utilization, renewableShare: `${renewablePercent}%`, gridFrequency: `${frequency} Hz`, frequencyStable: frequencyDeviation < 0.05, status: utilization > 90 ? "critical-load" : utilization > 75 ? "high-load" : utilization > 50 ? "normal" : "low-load", reserves: `${Math.round(capacityMW - demandMW)} MW available` } };
  });

  // ─── Sense 2026 parity — home energy monitor ────────────────────────
  // Tracked devices, energy readings, monitored solar, utility rates,
  // bill estimation, savings goals and usage analytics.

  function getEnergyState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.energyLens) STATE.energyLens = {};
    const s = STATE.energyLens;
    for (const k of ["devices", "readings", "solar", "rates", "goals", "alerts"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveEnergyState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const enId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const enNow = () => new Date().toISOString();
  const enAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const enListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const enNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const enClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const enDay = (v) => enClean(v, 10).slice(0, 10);
  const findDevice = (s, userId, id) => (s.devices.get(userId) || []).find((d) => d.id === id) || null;
  const EN_DAY = 86400000;
  const DEFAULT_RATE = 0.17; // $/kWh fallback when no utility rate is set

  const DEVICE_CATEGORIES = ["hvac", "appliance", "lighting", "electronics", "ev_charger", "water_heater", "kitchen", "laundry", "other"];

  function userRate(s, userId) {
    const r = s.rates.get(userId);
    return r && r.ratePerKwh > 0 ? r.ratePerKwh : DEFAULT_RATE;
  }

  // ── Devices ─────────────────────────────────────────────────────────
  registerLensAction("energy", "device-add", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = enClean(params.name, 80);
    if (!name) return { ok: false, error: "device name required" };
    const device = {
      id: enId("dev"), name,
      category: DEVICE_CATEGORIES.includes(String(params.category).toLowerCase())
        ? String(params.category).toLowerCase() : "appliance",
      wattage: Math.max(0, Math.round(enNum(params.wattage))),
      alwaysOn: params.alwaysOn === true,
      createdAt: enNow(),
    };
    enListB(s.devices, enAid(ctx)).push(device);
    saveEnergyState();
    return { ok: true, result: { device } };
  });

  registerLensAction("energy", "device-list", (ctx, _a, _params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const readings = s.readings.get(userId) || [];
    const devices = (s.devices.get(userId) || []).map((d) => {
      const dr = readings.filter((r) => r.deviceId === d.id);
      return {
        ...d,
        totalKwh: Math.round(dr.reduce((a, r) => a + r.kwh, 0) * 100) / 100,
        readingCount: dr.length,
      };
    });
    return { ok: true, result: { devices, count: devices.length } };
  });

  registerLensAction("energy", "device-update", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const device = findDevice(s, enAid(ctx), params.id);
    if (!device) return { ok: false, error: "device not found" };
    if (params.name != null) { const n = enClean(params.name, 80); if (n) device.name = n; }
    if (params.wattage != null) device.wattage = Math.max(0, Math.round(enNum(params.wattage)));
    if (params.alwaysOn != null) device.alwaysOn = params.alwaysOn === true;
    if (params.category != null && DEVICE_CATEGORIES.includes(String(params.category).toLowerCase())) {
      device.category = String(params.category).toLowerCase();
    }
    saveEnergyState();
    return { ok: true, result: { device } };
  });

  registerLensAction("energy", "device-delete", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const arr = s.devices.get(userId) || [];
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "device not found" };
    arr.splice(i, 1);
    s.readings.set(userId, (s.readings.get(userId) || []).filter((r) => r.deviceId !== params.id));
    saveEnergyState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Energy readings ─────────────────────────────────────────────────
  registerLensAction("energy", "reading-log", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const kwh = enNum(params.kwh);
    if (kwh <= 0) return { ok: false, error: "kwh must be > 0" };
    let deviceId = null, deviceName = "Whole home";
    if (params.deviceId) {
      const d = findDevice(s, userId, params.deviceId);
      if (!d) return { ok: false, error: "device not found" };
      deviceId = d.id; deviceName = d.name;
    }
    let hour = null;
    if (params.hour != null) {
      const h = Math.round(enNum(params.hour));
      if (h >= 0 && h <= 23) hour = h;
    }
    const reading = {
      id: enId("rd"), deviceId, deviceName,
      kwh: Math.round(kwh * 1000) / 1000,
      date: enDay(params.date) || enDay(enNow()),
      hour,
      cost: Math.round(kwh * userRate(s, userId) * 100) / 100,
      createdAt: enNow(),
    };
    enListB(s.readings, userId).push(reading);
    saveEnergyState();
    return { ok: true, result: { reading } };
  });

  registerLensAction("energy", "reading-history", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    let readings = (s.readings.get(userId) || [])
      .filter((r) => new Date(r.date).getTime() >= cutoff);
    if (params.deviceId) readings = readings.filter((r) => r.deviceId === params.deviceId);
    const byDay = {};
    for (const r of readings) {
      if (!byDay[r.date]) byDay[r.date] = { date: r.date, kwh: 0, cost: 0 };
      byDay[r.date].kwh = Math.round((byDay[r.date].kwh + r.kwh) * 1000) / 1000;
      byDay[r.date].cost = Math.round((byDay[r.date].cost + r.cost) * 100) / 100;
    }
    const series = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
    return {
      ok: true,
      result: {
        series,
        totalKwh: Math.round(readings.reduce((a, r) => a + r.kwh, 0) * 1000) / 1000,
        totalCost: Math.round(readings.reduce((a, r) => a + r.cost, 0) * 100) / 100,
        days,
      },
    };
  });

  // ── Solar production ────────────────────────────────────────────────
  registerLensAction("energy", "solar-log", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const kwh = enNum(params.kwh);
    if (kwh < 0) return { ok: false, error: "kwh must be >= 0" };
    const entry = {
      id: enId("sol"), kwh: Math.round(kwh * 1000) / 1000,
      date: enDay(params.date) || enDay(enNow()),
      value: Math.round(kwh * userRate(s, userId) * 100) / 100,
      createdAt: enNow(),
    };
    enListB(s.solar, userId).push(entry);
    saveEnergyState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("energy", "solar-summary", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    const entries = (s.solar.get(userId) || []).filter((e) => new Date(e.date).getTime() >= cutoff);
    const produced = entries.reduce((a, e) => a + e.kwh, 0);
    const consumed = (s.readings.get(userId) || [])
      .filter((r) => new Date(r.date).getTime() >= cutoff)
      .reduce((a, r) => a + r.kwh, 0);
    return {
      ok: true,
      result: {
        days,
        producedKwh: Math.round(produced * 1000) / 1000,
        consumedKwh: Math.round(consumed * 1000) / 1000,
        offsetPct: consumed > 0 ? Math.round((produced / consumed) * 100) : 0,
        savings: Math.round(entries.reduce((a, e) => a + e.value, 0) * 100) / 100,
        series: entries.slice().sort((a, b) => a.date.localeCompare(b.date)),
      },
    };
  });

  // ── Utility rate ────────────────────────────────────────────────────
  registerLensAction("energy", "rate-set", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ratePerKwh = enNum(params.ratePerKwh);
    if (ratePerKwh <= 0) return { ok: false, error: "ratePerKwh must be > 0" };
    const rate = {
      ratePerKwh: Math.round(ratePerKwh * 10000) / 10000,
      utility: enClean(params.utility, 80) || null,
      plan: enClean(params.plan, 80) || null,
      updatedAt: enNow(),
    };
    s.rates.set(enAid(ctx), rate);
    saveEnergyState();
    return { ok: true, result: { rate } };
  });

  registerLensAction("energy", "rate-get", (ctx, _a, _params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rate = s.rates.get(enAid(ctx));
    return {
      ok: true,
      result: {
        rate: rate || { ratePerKwh: DEFAULT_RATE, utility: null, plan: null },
        isDefault: !rate,
      },
    };
  });

  // ── Bill estimate ───────────────────────────────────────────────────
  registerLensAction("energy", "bill-estimate", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const month = enClean(params.month, 7) || enDay(enNow()).slice(0, 7);
    const readings = (s.readings.get(userId) || []).filter((r) => String(r.date).startsWith(month));
    const solar = (s.solar.get(userId) || []).filter((e) => String(e.date).startsWith(month));
    const consumedKwh = readings.reduce((a, r) => a + r.kwh, 0);
    const solarKwh = solar.reduce((a, e) => a + e.kwh, 0);
    const netKwh = Math.max(0, consumedKwh - solarKwh);
    const rate = userRate(s, userId);
    return {
      ok: true,
      result: {
        month,
        consumedKwh: Math.round(consumedKwh * 100) / 100,
        solarKwh: Math.round(solarKwh * 100) / 100,
        netKwh: Math.round(netKwh * 100) / 100,
        ratePerKwh: rate,
        estimatedBill: Math.round(netKwh * rate * 100) / 100,
        grossBill: Math.round(consumedKwh * rate * 100) / 100,
        solarSavings: Math.round(Math.min(consumedKwh, solarKwh) * rate * 100) / 100,
      },
    };
  });

  // ── Savings goals ───────────────────────────────────────────────────
  registerLensAction("energy", "goal-set", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const targetKwh = enNum(params.targetKwh);
    if (targetKwh <= 0) return { ok: false, error: "targetKwh must be > 0" };
    const goal = {
      id: enId("goal"),
      label: enClean(params.label, 80) || "Monthly usage goal",
      targetKwh: Math.round(targetKwh * 100) / 100,
      period: ["week", "month"].includes(params.period) ? params.period : "month",
      createdAt: enNow(),
    };
    enListB(s.goals, enAid(ctx)).push(goal);
    saveEnergyState();
    return { ok: true, result: { goal } };
  });

  registerLensAction("energy", "goal-list", (ctx, _a, _params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const readings = s.readings.get(userId) || [];
    const now = new Date();
    const goals = (s.goals.get(userId) || []).map((g) => {
      let start;
      if (g.period === "week") {
        const d = new Date(now); const dow = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); start = d.getTime();
      } else {
        const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); start = d.getTime();
      }
      const used = readings
        .filter((r) => new Date(r.date).getTime() >= start)
        .reduce((a, r) => a + r.kwh, 0);
      return {
        ...g,
        usedKwh: Math.round(used * 100) / 100,
        pct: Math.round((used / g.targetKwh) * 100),
        overBudget: used > g.targetKwh,
      };
    });
    return { ok: true, result: { goals, count: goals.length } };
  });

  registerLensAction("energy", "goal-delete", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.goals.get(enAid(ctx)) || [];
    const i = arr.findIndex((g) => g.id === params.id);
    if (i < 0) return { ok: false, error: "goal not found" };
    arr.splice(i, 1);
    saveEnergyState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Usage analytics ─────────────────────────────────────────────────
  registerLensAction("energy", "usage-breakdown", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    const readings = (s.readings.get(userId) || []).filter((r) => new Date(r.date).getTime() >= cutoff);
    const devices = new Map((s.devices.get(userId) || []).map((d) => [d.id, d]));
    const byCategory = {};
    let total = 0, untracked = 0;
    for (const r of readings) {
      total += r.kwh;
      if (r.deviceId && devices.has(r.deviceId)) {
        const cat = devices.get(r.deviceId).category;
        byCategory[cat] = Math.round(((byCategory[cat] || 0) + r.kwh) * 1000) / 1000;
      } else {
        untracked = Math.round((untracked + r.kwh) * 1000) / 1000;
      }
    }
    const breakdown = Object.entries(byCategory)
      .map(([category, kwh]) => ({ category, kwh, pct: total > 0 ? Math.round((kwh / total) * 100) : 0 }))
      .sort((a, b) => b.kwh - a.kwh);
    return {
      ok: true,
      result: { breakdown, totalKwh: Math.round(total * 1000) / 1000, untrackedKwh: untracked, days },
    };
  });

  registerLensAction("energy", "top-consumers", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    const readings = (s.readings.get(userId) || []).filter((r) => new Date(r.date).getTime() >= cutoff);
    const byDevice = new Map();
    for (const r of readings) {
      if (!r.deviceId) continue;
      const cur = byDevice.get(r.deviceId) || { deviceId: r.deviceId, name: r.deviceName, kwh: 0, cost: 0 };
      cur.kwh = Math.round((cur.kwh + r.kwh) * 1000) / 1000;
      cur.cost = Math.round((cur.cost + r.cost) * 100) / 100;
      byDevice.set(r.deviceId, cur);
    }
    const ranked = [...byDevice.values()].sort((a, b) => b.kwh - a.kwh).slice(0, 10);
    return { ok: true, result: { devices: ranked, days } };
  });

  registerLensAction("energy", "energy-dashboard", (ctx, _a, _params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const month = enDay(enNow()).slice(0, 7);
    const monthReadings = (s.readings.get(userId) || []).filter((r) => String(r.date).startsWith(month));
    const monthSolar = (s.solar.get(userId) || []).filter((e) => String(e.date).startsWith(month));
    const consumedKwh = monthReadings.reduce((a, r) => a + r.kwh, 0);
    const solarKwh = monthSolar.reduce((a, e) => a + e.kwh, 0);
    const rate = userRate(s, userId);
    return {
      ok: true,
      result: {
        devices: (s.devices.get(userId) || []).length,
        monthKwh: Math.round(consumedKwh * 100) / 100,
        monthCost: Math.round(Math.max(0, consumedKwh - solarKwh) * rate * 100) / 100,
        solarKwh: Math.round(solarKwh * 100) / 100,
        solarOffsetPct: consumedKwh > 0 ? Math.round((solarKwh / consumedKwh) * 100) : 0,
        ratePerKwh: rate,
        goals: (s.goals.get(userId) || []).length,
      },
    };
  });

  // ─── Sense/Span 2026 parity backlog ─────────────────────────────────
  // Real-time wattage stream, per-device disaggregation, cost projection,
  // time-of-use modeling, solar self-consumption/export, usage alerts,
  // and month-over-month historical comparison. Every value is computed
  // from user-entered devices/readings/solar/rate — no synthetic curves.

  function ensureLiveState(s) {
    for (const k of ["livePower", "touPlans"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
  }

  // ── Real-time consumption stream ────────────────────────────────────
  // A "live sample" is a user-submitted instantaneous wattage reading
  // (from a smart meter / clamp / plug). The macro keeps a rolling
  // window per user so the UI can render a Sense-style live graph.
  registerLensAction("energy", "live-sample", (ctx, _a, params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureLiveState(s);
    const watts = enNum(params.watts);
    if (!(watts >= 0)) return { ok: false, error: "watts must be >= 0" };
    const userId = enAid(ctx);
    let deviceId = null, deviceName = "Whole home";
    if (params.deviceId) {
      const d = findDevice(s, userId, params.deviceId);
      if (!d) return { ok: false, error: "device not found" };
      deviceId = d.id; deviceName = d.name;
    }
    const sample = {
      id: enId("lp"),
      watts: Math.round(watts),
      deviceId, deviceName,
      at: enNow(),
      ts: Date.now(),
    };
    const arr = enListB(s.livePower, userId);
    arr.push(sample);
    // Keep a rolling window: last 240 samples, max 6h old.
    const minTs = Date.now() - 6 * 3600 * 1000;
    let trimmed = arr.filter((x) => x.ts >= minTs);
    if (trimmed.length > 240) trimmed = trimmed.slice(trimmed.length - 240);
    s.livePower.set(userId, trimmed);
    saveEnergyState();
    return { ok: true, result: { sample } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("energy", "live-stream", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureLiveState(s);
    const userId = enAid(ctx);
    const minutes = Math.max(1, Math.min(360, Math.round(enNum(params.minutes, 60))));
    const cutoff = Date.now() - minutes * 60000;
    const samples = (s.livePower.get(userId) || [])
      .filter((x) => x.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts);
    const wattValues = samples.map((x) => x.watts);
    const current = wattValues.length ? wattValues[wattValues.length - 1] : 0;
    const peak = wattValues.length ? Math.max(...wattValues) : 0;
    const avg = wattValues.length ? Math.round(wattValues.reduce((a, v) => a + v, 0) / wattValues.length) : 0;
    return {
      ok: true,
      result: {
        samples: samples.map((x) => ({ id: x.id, watts: x.watts, at: x.at, deviceName: x.deviceName })),
        current, peak, avgWatts: avg,
        count: samples.length,
        minutes,
      },
    };
  });

  // ── Per-device disaggregation ───────────────────────────────────────
  // Attributes a window's whole-home consumption across tracked devices.
  // Uses real per-device readings; the remainder of whole-home readings
  // is split by each device's nameplate wattage weight (real input),
  // mirroring Sense's "always-on / unknown" attribution.
  registerLensAction("energy", "disaggregate", (ctx, _a, params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    const readings = (s.readings.get(userId) || []).filter((r) => new Date(r.date).getTime() >= cutoff);
    const devices = s.devices.get(userId) || [];
    if (devices.length === 0) {
      return { ok: true, result: { devices: [], totalKwh: 0, attributedKwh: 0, unattributedKwh: 0, wholeHomeKwh: 0, days } };
    }
    const directByDevice = new Map();
    let wholeHomeKwh = 0, total = 0;
    for (const r of readings) {
      total += r.kwh;
      if (r.deviceId) {
        directByDevice.set(r.deviceId, Math.round(((directByDevice.get(r.deviceId) || 0) + r.kwh) * 1000) / 1000);
      } else {
        wholeHomeKwh += r.kwh;
      }
    }
    // Split whole-home consumption by nameplate-wattage weight.
    const totalWattage = devices.reduce((a, d) => a + (d.wattage || 0), 0);
    const rows = devices.map((d) => {
      const direct = directByDevice.get(d.id) || 0;
      const weight = totalWattage > 0 ? (d.wattage || 0) / totalWattage : (1 / devices.length);
      const estimated = Math.round(wholeHomeKwh * weight * 1000) / 1000;
      const attributed = Math.round((direct + estimated) * 1000) / 1000;
      return {
        deviceId: d.id, name: d.name, category: d.category,
        directKwh: direct,
        estimatedKwh: estimated,
        attributedKwh: attributed,
        pct: total > 0 ? Math.round((attributed / total) * 1000) / 10 : 0,
        method: direct > 0 ? (estimated > 0 ? "metered+estimated" : "metered") : "estimated",
      };
    }).sort((a, b) => b.attributedKwh - a.attributedKwh);
    const attributed = Math.round(rows.reduce((a, r) => a + r.attributedKwh, 0) * 1000) / 1000;
    return {
      ok: true,
      result: {
        devices: rows,
        totalKwh: Math.round(total * 1000) / 1000,
        attributedKwh: attributed,
        unattributedKwh: Math.round(Math.max(0, total - attributed) * 1000) / 1000,
        wholeHomeKwh: Math.round(wholeHomeKwh * 1000) / 1000,
        days,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Cost projection ─────────────────────────────────────────────────
  // Projects the full-month bill from readings logged so far this month,
  // extrapolating the run-rate across the remaining days.
  registerLensAction("energy", "cost-projection", (ctx, _a, params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const now = new Date();
    const month = enClean(params.month, 7) || enDay(enNow()).slice(0, 7);
    const isCurrentMonth = month === enDay(enNow()).slice(0, 7);
    const readings = (s.readings.get(userId) || []).filter((r) => String(r.date).startsWith(month));
    const solar = (s.solar.get(userId) || []).filter((e) => String(e.date).startsWith(month));
    if (readings.length === 0) {
      return { ok: true, result: { month, hasData: false, message: "Log readings this month to project the bill." } };
    }
    const consumed = readings.reduce((a, r) => a + r.kwh, 0);
    const solarKwh = solar.reduce((a, e) => a + e.kwh, 0);
    const rate = userRate(s, userId);
    // Days the readings span (distinct dates with data).
    const distinctDays = new Set(readings.map((r) => r.date)).size;
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;
    const dailyRate = distinctDays > 0 ? consumed / distinctDays : 0;
    const dailySolar = distinctDays > 0 ? solarKwh / distinctDays : 0;
    const projectedConsumed = Math.round(dailyRate * daysInMonth * 100) / 100;
    const projectedSolar = Math.round(dailySolar * daysInMonth * 100) / 100;
    const projectedNet = Math.max(0, projectedConsumed - projectedSolar);
    return {
      ok: true,
      result: {
        month, hasData: true, isCurrentMonth,
        loggedKwh: Math.round(consumed * 100) / 100,
        loggedSolarKwh: Math.round(solarKwh * 100) / 100,
        distinctDays, daysInMonth, daysElapsed,
        dailyAvgKwh: Math.round(dailyRate * 100) / 100,
        projectedKwh: projectedConsumed,
        projectedSolarKwh: projectedSolar,
        projectedNetKwh: Math.round(projectedNet * 100) / 100,
        ratePerKwh: rate,
        billSoFar: Math.round(Math.max(0, consumed - solarKwh) * rate * 100) / 100,
        projectedBill: Math.round(projectedNet * rate * 100) / 100,
        confidence: distinctDays >= 7 ? "high" : distinctDays >= 3 ? "medium" : "low",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Time-of-use rate modeling ───────────────────────────────────────
  // Stores a user-defined TOU plan (peak / off-peak / shoulder rates +
  // peak hour windows) and computes a peak/off-peak cost breakdown from
  // readings that carry an `hour` field.
  registerLensAction("energy", "tou-set", (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureLiveState(s);
    const peakRate = enNum(params.peakRate);
    const offPeakRate = enNum(params.offPeakRate);
    if (!(peakRate > 0) || !(offPeakRate > 0)) {
      return { ok: false, error: "peakRate and offPeakRate must be > 0" };
    }
    const shoulderRate = enNum(params.shoulderRate, 0);
    let peakStart = Math.round(enNum(params.peakStartHour, 16));
    let peakEnd = Math.round(enNum(params.peakEndHour, 21));
    peakStart = Math.max(0, Math.min(23, peakStart));
    peakEnd = Math.max(0, Math.min(24, peakEnd));
    if (peakEnd <= peakStart) return { ok: false, error: "peakEndHour must be after peakStartHour" };
    const plan = {
      peakRate: Math.round(peakRate * 10000) / 10000,
      offPeakRate: Math.round(offPeakRate * 10000) / 10000,
      shoulderRate: shoulderRate > 0 ? Math.round(shoulderRate * 10000) / 10000 : null,
      peakStartHour: peakStart,
      peakEndHour: peakEnd,
      shoulderStartHour: params.shoulderStartHour != null
        ? Math.max(0, Math.min(23, Math.round(enNum(params.shoulderStartHour)))) : null,
      shoulderEndHour: params.shoulderEndHour != null
        ? Math.max(0, Math.min(24, Math.round(enNum(params.shoulderEndHour)))) : null,
      utility: enClean(params.utility, 80) || null,
      updatedAt: enNow(),
    };
    s.touPlans.set(enAid(ctx), plan);
    saveEnergyState();
    return { ok: true, result: { plan } };
  });

  registerLensAction("energy", "tou-get", (ctx, _a, _params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureLiveState(s);
    const plan = s.touPlans.get(enAid(ctx)) || null;
    return { ok: true, result: { plan, configured: !!plan } };
  });

  registerLensAction("energy", "tou-breakdown", (ctx, _a, params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureLiveState(s);
    const userId = enAid(ctx);
    const plan = s.touPlans.get(userId);
    if (!plan) return { ok: false, error: "no time-of-use plan set — call tou-set first" };
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    const readings = (s.readings.get(userId) || []).filter((r) => new Date(r.date).getTime() >= cutoff);
    const inShoulder = (h) =>
      plan.shoulderRate != null && plan.shoulderStartHour != null && plan.shoulderEndHour != null &&
      h >= plan.shoulderStartHour && h < plan.shoulderEndHour;
    const inPeak = (h) => h >= plan.peakStartHour && h < plan.peakEndHour;
    let peakKwh = 0, offPeakKwh = 0, shoulderKwh = 0, untimedKwh = 0;
    for (const r of readings) {
      const h = r.hour;
      if (h == null || !Number.isFinite(h)) { untimedKwh += r.kwh; continue; }
      if (inPeak(h)) peakKwh += r.kwh;
      else if (inShoulder(h)) shoulderKwh += r.kwh;
      else offPeakKwh += r.kwh;
    }
    const round = (v) => Math.round(v * 1000) / 1000;
    const cost = (kwh, rate) => Math.round(kwh * rate * 100) / 100;
    const peakCost = cost(peakKwh, plan.peakRate);
    const offPeakCost = cost(offPeakKwh, plan.offPeakRate);
    const shoulderCost = plan.shoulderRate != null ? cost(shoulderKwh, plan.shoulderRate) : 0;
    const untimedCost = cost(untimedKwh, plan.offPeakRate);
    const flatRate = userRate(s, userId);
    const totalKwh = peakKwh + offPeakKwh + shoulderKwh + untimedKwh;
    const flatCost = Math.round(totalKwh * flatRate * 100) / 100;
    const touCost = peakCost + offPeakCost + shoulderCost + untimedCost;
    return {
      ok: true,
      result: {
        days,
        peak: { kwh: round(peakKwh), cost: peakCost, rate: plan.peakRate },
        offPeak: { kwh: round(offPeakKwh), cost: offPeakCost, rate: plan.offPeakRate },
        shoulder: plan.shoulderRate != null
          ? { kwh: round(shoulderKwh), cost: shoulderCost, rate: plan.shoulderRate } : null,
        untimedKwh: round(untimedKwh),
        totalKwh: round(totalKwh),
        touCost: Math.round(touCost * 100) / 100,
        flatRateCost: flatCost,
        savingsVsFlat: Math.round((flatCost - touCost) * 100) / 100,
        peakSharePct: totalKwh > 0 ? Math.round((peakKwh / totalKwh) * 1000) / 10 : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Solar self-consumption vs export ────────────────────────────────
  // Splits solar production into the share consumed on-site versus
  // exported to the grid, and values the resulting savings vs export
  // credit. Per-day matched against that day's consumption.
  registerLensAction("energy", "solar-self-consumption", (ctx, _a, params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const days = Math.max(1, Math.min(365, Math.round(enNum(params.days, 30))));
    const cutoff = Date.now() - days * EN_DAY;
    const solar = (s.solar.get(userId) || []).filter((e) => new Date(e.date).getTime() >= cutoff);
    const readings = (s.readings.get(userId) || []).filter((r) => new Date(r.date).getTime() >= cutoff);
    if (solar.length === 0) {
      return { ok: true, result: { hasData: false, days, message: "Log solar production to track self-consumption." } };
    }
    const rate = userRate(s, userId);
    // Export credit defaults to the retail rate unless caller overrides
    // with a real net-metering / export tariff value.
    const exportRate = params.exportRate != null && enNum(params.exportRate) >= 0
      ? Math.round(enNum(params.exportRate) * 10000) / 10000 : rate;
    const consumedByDay = {};
    for (const r of readings) consumedByDay[r.date] = (consumedByDay[r.date] || 0) + r.kwh;
    const series = [];
    let totalProduced = 0, totalSelf = 0, totalExport = 0;
    for (const e of solar) {
      const dayConsumption = consumedByDay[e.date] || 0;
      const self = Math.min(e.kwh, dayConsumption);
      const exported = Math.max(0, e.kwh - self);
      totalProduced += e.kwh; totalSelf += self; totalExport += exported;
      series.push({
        date: e.date,
        producedKwh: Math.round(e.kwh * 1000) / 1000,
        selfConsumedKwh: Math.round(self * 1000) / 1000,
        exportedKwh: Math.round(exported * 1000) / 1000,
      });
    }
    series.sort((a, b) => a.date.localeCompare(b.date));
    const selfSavings = Math.round(totalSelf * rate * 100) / 100;
    const exportCredit = Math.round(totalExport * exportRate * 100) / 100;
    return {
      ok: true,
      result: {
        hasData: true, days,
        producedKwh: Math.round(totalProduced * 1000) / 1000,
        selfConsumedKwh: Math.round(totalSelf * 1000) / 1000,
        exportedKwh: Math.round(totalExport * 1000) / 1000,
        selfConsumptionPct: totalProduced > 0 ? Math.round((totalSelf / totalProduced) * 1000) / 10 : 0,
        ratePerKwh: rate,
        exportRate,
        selfConsumptionSavings: selfSavings,
        exportCredit,
        totalSolarValue: Math.round((selfSavings + exportCredit) * 100) / 100,
        series,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Usage alerts ────────────────────────────────────────────────────
  // Detects anomalies entirely from real logged data: a usage spike vs
  // the recent baseline, an always-on device with no recent reading,
  // and goals over budget. No synthetic triggers.
  registerLensAction("energy", "usage-alerts", (ctx, _a, _params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const alerts = [];
    const readings = (s.readings.get(userId) || []).slice();
    const byDay = {};
    for (const r of readings) byDay[r.date] = (byDay[r.date] || 0) + r.kwh;
    const dayKeys = Object.keys(byDay).sort();
    // Spike detection: latest day vs the trailing 7-day average.
    if (dayKeys.length >= 4) {
      const latestDay = dayKeys[dayKeys.length - 1];
      const latest = byDay[latestDay];
      const prior = dayKeys.slice(Math.max(0, dayKeys.length - 8), dayKeys.length - 1).map((d) => byDay[d]);
      const baseline = prior.reduce((a, v) => a + v, 0) / prior.length;
      if (baseline > 0 && latest > baseline * 1.5) {
        alerts.push({
          kind: "usage_spike", severity: latest > baseline * 2 ? "high" : "medium",
          message: `${latestDay} used ${Math.round(latest * 10) / 10} kWh — ${Math.round((latest / baseline - 1) * 100)}% above your recent ${Math.round(baseline * 10) / 10} kWh/day average.`,
          date: latestDay,
        });
      }
    }
    // Always-on devices with no reading in the last 7 days.
    const cutoff7 = Date.now() - 7 * EN_DAY;
    const recentDeviceIds = new Set(
      readings.filter((r) => r.deviceId && new Date(r.date).getTime() >= cutoff7).map((r) => r.deviceId),
    );
    for (const d of s.devices.get(userId) || []) {
      if (d.alwaysOn && !recentDeviceIds.has(d.id)) {
        alerts.push({
          kind: "device_idle", severity: "low",
          message: `${d.name} is marked always-on but has no reading in the last 7 days. Verify it isn't left running or log a reading.`,
          deviceId: d.id,
        });
      }
    }
    // Goals over budget.
    const now = new Date();
    for (const g of s.goals.get(userId) || []) {
      let start;
      if (g.period === "week") {
        const dd = new Date(now); const dow = (dd.getDay() + 6) % 7;
        dd.setDate(dd.getDate() - dow); dd.setHours(0, 0, 0, 0); start = dd.getTime();
      } else {
        const dd = new Date(now); dd.setDate(1); dd.setHours(0, 0, 0, 0); start = dd.getTime();
      }
      const used = readings.filter((r) => new Date(r.date).getTime() >= start).reduce((a, r) => a + r.kwh, 0);
      if (used > g.targetKwh) {
        alerts.push({
          kind: "goal_exceeded", severity: "high",
          message: `Goal "${g.label}" is over budget: ${Math.round(used * 10) / 10} of ${g.targetKwh} kWh this ${g.period}.`,
          goalId: g.id,
        });
      }
    }
    const severityRank = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
    return {
      ok: true,
      result: {
        alerts,
        count: alerts.length,
        highCount: alerts.filter((a) => a.severity === "high").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Historical comparison (this month vs last) ──────────────────────
  registerLensAction("energy", "month-comparison", (ctx, _a, params = {}) => {
  try {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = enAid(ctx);
    const baseMonth = enClean(params.month, 7) || enDay(enNow()).slice(0, 7);
    const [by, bm] = baseMonth.split("-").map(Number);
    if (!by || !bm) return { ok: false, error: "month must be YYYY-MM" };
    const prevDate = new Date(by, bm - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const rate = userRate(s, userId);
    const monthStats = (month) => {
      const readings = (s.readings.get(userId) || []).filter((r) => String(r.date).startsWith(month));
      const solar = (s.solar.get(userId) || []).filter((e) => String(e.date).startsWith(month));
      const consumed = readings.reduce((a, r) => a + r.kwh, 0);
      const solarKwh = solar.reduce((a, e) => a + e.kwh, 0);
      const byDay = {};
      for (const r of readings) byDay[r.date] = (byDay[r.date] || 0) + r.kwh;
      const days = Object.keys(byDay).length;
      return {
        month,
        consumedKwh: Math.round(consumed * 100) / 100,
        solarKwh: Math.round(solarKwh * 100) / 100,
        netKwh: Math.round(Math.max(0, consumed - solarKwh) * 100) / 100,
        cost: Math.round(Math.max(0, consumed - solarKwh) * rate * 100) / 100,
        readingDays: days,
        dailyAvgKwh: days > 0 ? Math.round((consumed / days) * 100) / 100 : 0,
        dailySeries: Object.entries(byDay).map(([date, kwh]) => ({ date, kwh: Math.round(kwh * 1000) / 1000 }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    };
    const current = monthStats(baseMonth);
    const previous = monthStats(prevMonth);
    const delta = (cur, prev) => {
      const abs = Math.round((cur - prev) * 100) / 100;
      const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
      return { abs, pct, direction: abs > 0 ? "up" : abs < 0 ? "down" : "flat" };
    };
    return {
      ok: true,
      result: {
        current, previous,
        change: {
          consumed: delta(current.consumedKwh, previous.consumedKwh),
          cost: delta(current.cost, previous.cost),
          solar: delta(current.solarKwh, previous.solarKwh),
        },
        hasData: current.readingDays > 0 || previous.readingDays > 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest real GB electricity carbon-intensity + generation mix
  // from the National Grid ESO Carbon Intensity API. Free, no key.
  registerLensAction("energy", "feed", async (ctx, _a, params = {}) => {
    const s = getEnergyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 8)));
    try {
      const r = await fetch("https://api.carbonintensity.org.uk/intensity/date");
      if (!r.ok) return { ok: false, error: `carbonintensity ${r.status}` };
      const data = await r.json();
      const periods = (Array.isArray(data?.data) ? data.data : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const p of periods) {
        const id = `ci_${p.from}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const actual = p.intensity?.actual ?? p.intensity?.forecast;
        const title = `Grid carbon intensity: ${p.from} (${p.intensity?.index || "?"})`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nCarbon intensity: ${actual} gCO2/kWh\nIndex: ${p.intensity?.index}\nForecast: ${p.intensity?.forecast} gCO2/kWh\nSource: National Grid ESO Carbon Intensity API`,
          tags: ["energy", "feed", "carbon-intensity", "grid"],
          source: "carbonintensity-feed",
          meta: { from: p.from, to: p.to, intensity: actual, index: p.intensity?.index },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveEnergyState();
      return { ok: true, result: { ingested, skipped, source: "uk-carbon-intensity", dtuIds } };
    } catch (e) {
      return { ok: false, error: `carbonintensity unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
