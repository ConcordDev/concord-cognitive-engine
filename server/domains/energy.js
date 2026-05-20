// server/domains/energy.js
//
// Pure-compute energy helpers (consumption, solar estimate, carbon
// footprint, grid status) plus real US Energy Information
// Administration (EIA) data. EIA API requires free API key (register
// at https://www.eia.gov/opendata/register.php); set EIA_API_KEY env.

const EIA_BASE = "https://api.eia.gov/v2";

export default function registerEnergyActions(registerLensAction) {
  registerLensAction("energy", "consumptionAnalysis", (ctx, artifact, _params) => {
    const readings = artifact.data?.readings || [];
    if (readings.length === 0) return { ok: true, result: { message: "Add energy readings (kWh) to analyze consumption." } };
    const values = readings.map(r => parseFloat(r.kWh || r.value) || 0);
    const total = values.reduce((s, v) => s + v, 0);
    const avg = total / values.length;
    const peak = Math.max(...values);
    const costPerKWh = parseFloat(artifact.data?.costPerKWh) || 0.12;
    return { ok: true, result: { totalKWh: Math.round(total * 10) / 10, avgKWh: Math.round(avg * 10) / 10, peakKWh: Math.round(peak * 10) / 10, readingCount: values.length, estimatedCost: Math.round(total * costPerKWh * 100) / 100, costPerKWh, peakToAvgRatio: Math.round((peak / avg) * 100) / 100, savingsOpportunity: peak > avg * 2 ? "Significant peak reduction possible" : "Consumption is relatively stable" } };
  });
  registerLensAction("energy", "solarEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const roofSqFt = parseFloat(data.roofAreaSqFt) || 1000;
    const sunHours = parseFloat(data.peakSunHours) || 5;
    const usageKWh = parseFloat(data.monthlyUsageKWh) || 900;
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
    const electricityKWh = parseFloat(data.electricityKWh) || 0;
    const naturalGasTherms = parseFloat(data.naturalGasTherms) || 0;
    const gasolineGallons = parseFloat(data.gasolineGallons) || 0;
    const flightMiles = parseFloat(data.flightMiles) || 0;
    // EPA emission factors
    const co2Electricity = electricityKWh * 0.000417; // metric tons per kWh
    const co2Gas = naturalGasTherms * 0.0053;
    const co2Gasoline = gasolineGallons * 0.00887;
    const co2Flights = flightMiles * 0.000255;
    const total = co2Electricity + co2Gas + co2Gasoline + co2Flights;
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
    const demandMW = parseFloat(data.currentDemandMW) || 0;
    const capacityMW = parseFloat(data.totalCapacityMW) || 0;
    const renewablePercent = parseFloat(data.renewablePercent) || 0;
    const frequency = parseFloat(data.gridFrequencyHz) || 60;
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
    const reading = {
      id: enId("rd"), deviceId, deviceName,
      kwh: Math.round(kwh * 1000) / 1000,
      date: enDay(params.date) || enDay(enNow()),
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
