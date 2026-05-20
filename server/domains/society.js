// server/domains/society.js
//
// Real societal indicators via the World Bank Open Data API (no key
// required, no rate limit for normal use). The World Bank exposes
// ~1,400 indicators per country at api.worldbank.org/v2 — population,
// GDP, life expectancy, literacy, poverty, inequality, mortality,
// employment, education, energy, environment, etc.

const WB_BASE = "https://api.worldbank.org/v2";

const COMMON_INDICATORS = {
  population: "SP.POP.TOTL",
  gdp: "NY.GDP.MKTP.CD",
  gdpPerCapita: "NY.GDP.PCAP.CD",
  lifeExpectancy: "SP.DYN.LE00.IN",
  literacyRate: "SE.ADT.LITR.ZS",
  gini: "SI.POV.GINI",
  infantMortality: "SP.DYN.IMRT.IN",
  unemployment: "SL.UEM.TOTL.ZS",
  internetUsers: "IT.NET.USER.ZS",
  urbanPopulationPct: "SP.URB.TOTL.IN.ZS",
  co2EmissionsPerCapita: "EN.ATM.CO2E.PC",
  povertyHeadcount: "SI.POV.DDAY",
};

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSocietyActions(registerLensAction) {
  /**
   * wb-indicator — Fetch a single World Bank indicator for a country.
   * params: { country: ISO-3 (e.g. "USA", "GBR"), indicator: WB code OR alias }
   */
  registerLensAction("society", "wb-indicator", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return { ok: false, error: "country must be 3-letter ISO code (e.g. 'USA', 'GBR', 'JPN')" };
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required (WB code like 'SP.POP.TOTL' or alias like 'population')" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    try {
      const url = `${WB_BASE}/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=60`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`worldbank ${r.status}`);
      const json = await r.json();
      if (!Array.isArray(json) || json.length < 2) {
        return { ok: false, error: `world-bank: ${json?.[0]?.message?.[0]?.value || "no data"}` };
      }
      const meta = json[0];
      const series = (json[1] || [])
        .filter((row) => row.value !== null && row.value !== undefined)
        .map((row) => ({
          year: Number(row.date),
          value: row.value,
          countryName: row.country?.value,
        }))
        .sort((a, b) => b.year - a.year);
      const latest = series[0] || null;
      return {
        ok: true,
        result: {
          country, indicator, alias: COMMON_INDICATORS[raw] ? raw : null,
          countryName: latest?.countryName,
          series, latest, count: series.length,
          totalAvailable: meta?.total,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * wb-country — Full country profile + region/income classification.
   * params: { country: ISO-3 }
   */
  registerLensAction("society", "wb-country", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return { ok: false, error: "country must be 3-letter ISO code" };
    try {
      const r = await fetch(`${WB_BASE}/country/${country}?format=json`);
      if (!r.ok) throw new Error(`worldbank ${r.status}`);
      const json = await r.json();
      if (!Array.isArray(json) || json.length < 2 || !json[1]?.[0]) {
        return { ok: false, error: `world-bank: ${json?.[0]?.message?.[0]?.value || "country not found"}` };
      }
      const c = json[1][0];
      return {
        ok: true,
        result: {
          iso2: c.iso2Code, iso3: c.id,
          name: c.name,
          capital: c.capitalCity,
          region: c.region?.value,
          incomeLevel: c.incomeLevel?.value,
          lendingType: c.lendingType?.value,
          longitude: parseFloat(c.longitude) || null,
          latitude: parseFloat(c.latitude) || null,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * wb-compare — Compare a single indicator across multiple countries.
   * params: { countries: [ISO-3, ...] (2-10), indicator }
   */
  registerLensAction("society", "wb-compare", async (_ctx, _artifact, params = {}) => {
    const countries = Array.isArray(params.countries) ? params.countries.map((c) => String(c).toUpperCase()) : [];
    if (countries.length < 2 || countries.length > 10) return { ok: false, error: "countries must be array of 2-10 ISO-3 codes" };
    if (!countries.every((c) => /^[A-Z]{3}$/.test(c))) return { ok: false, error: "all countries must be 3-letter ISO codes" };
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    try {
      const url = `${WB_BASE}/country/${countries.join(";")}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=2000&mrnev=1`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`worldbank ${r.status}`);
      const json = await r.json();
      const rows = (Array.isArray(json) && json[1]) || [];
      const points = rows
        .filter((row) => row.value !== null)
        .map((row) => ({
          country: row.countryiso3code || row.country?.id,
          countryName: row.country?.value,
          year: Number(row.date),
          value: row.value,
        }))
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      return {
        ok: true,
        result: {
          indicator, countries, points, count: points.length,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * wb-common-indicators — Lookup table of human-readable indicator aliases.
   */
  registerLensAction("society", "wb-common-indicators", (_ctx, _artifact, _params) => {
    return {
      ok: true,
      result: {
        indicators: COMMON_INDICATORS,
        count: Object.keys(COMMON_INDICATORS).length,
        note: "Pass any value from this map (or any raw WB code like 'EN.ATM.PM25.MC.M3') as the 'indicator' param.",
        catalog: "Full ~1,400 WB indicator catalog: https://data.worldbank.org/indicator",
        source: "world-bank-open-data",
      },
    };
  });

  // Persistent records substrate (audit THIN-tier depth pass).
  registerLensSubstrate(registerLensAction, "society", {
    noun: "initiative", idPrefix: "ini",
    kinds: ["policy","program","movement","ritual"],
    statuses: ["proposed","active","concluded"],
  });
}
