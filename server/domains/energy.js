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
}
