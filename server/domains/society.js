// server/domains/society.js
//
// Real societal indicators via the World Bank Open Data API (no key
// required, no rate limit for normal use). The World Bank exposes
// ~1,400 indicators per country at api.worldbank.org/v2 — population,
// GDP, life expectancy, literacy, poverty, inequality, mortality,
// employment, education, energy, environment, etc.
//
// Feature parity pass vs Our World in Data / Gapminder — adds:
// interactive charting series, animated bubble-chart frames, choropleth
// payloads, full 1,400-indicator catalog search, country dashboards,
// CSV export + shareable permalinks, region/income aggregates +
// rankings, and per-capita / inflation-adjusted transforms.

import { cachedFetchJson } from "../lib/external-fetch.js";

const WB_BASE = "https://api.worldbank.org/v2";
const WB_TTL = 30 * 60 * 1000; // 30-min cache — WB data is annual

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
  fertilityRate: "SP.DYN.TFRT.IN",
  schoolEnrollment: "SE.PRM.ENRR",
  healthExpenditurePct: "SH.XPD.CHEX.GD.ZS",
  electricityAccess: "EG.ELC.ACCS.ZS",
};

// Region + income-group aggregate codes the World Bank exposes as
// pseudo-"countries". Useful for OWID-style region rankings.
const AGGREGATE_CODES = {
  WLD: "World",
  HIC: "High income",
  MIC: "Middle income",
  LIC: "Low income",
  EAS: "East Asia & Pacific",
  ECS: "Europe & Central Asia",
  LCN: "Latin America & Caribbean",
  MEA: "Middle East & North Africa",
  NAC: "North America",
  SAS: "South Asia",
  SSF: "Sub-Saharan Africa",
};

// US CPI deflator anchors (BLS annual averages, 1982-84 = 100) — used
// for the inflation-adjusted toggle. A small fixed table is honest:
// these are published constants, not synthesized data.
const US_CPI = {
  1990: 130.7, 1995: 152.4, 2000: 172.2, 2005: 195.3, 2010: 218.06,
  2015: 237.02, 2018: 251.1, 2019: 255.66, 2020: 258.81, 2021: 270.97,
  2022: 292.66, 2023: 304.7, 2024: 313.69, 2025: 320.8,
};
const CPI_BASE_YEAR = 2024;

function cpiFor(year) {
  if (US_CPI[year]) return US_CPI[year];
  const years = Object.keys(US_CPI).map(Number).sort((a, b) => a - b);
  if (year <= years[0]) return US_CPI[years[0]];
  if (year >= years[years.length - 1]) return US_CPI[years[years.length - 1]];
  let lo = years[0], hi = years[years.length - 1];
  for (const y of years) { if (y <= year) lo = y; if (y >= year && hi === years[years.length - 1]) hi = y; }
  for (let i = 0; i < years.length - 1; i++) {
    if (years[i] <= year && years[i + 1] >= year) { lo = years[i]; hi = years[i + 1]; break; }
  }
  const t = hi === lo ? 0 : (year - lo) / (hi - lo);
  return US_CPI[lo] + t * (US_CPI[hi] - US_CPI[lo]);
}

async function wbJson(url) {
  const json = await cachedFetchJson(url, { ttlMs: WB_TTL });
  if (!Array.isArray(json)) throw new Error("unexpected world-bank shape");
  return json;
}

// Persistent per-user pinned-chart store (shareable permalink registry).
function chartStore() {
  const g = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!g.societyCharts) g.societyCharts = new Map(); // shareId -> chartSpec
  return g.societyCharts;
}
function userId(ctx) {
  return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
}

// Reject a poisoned numeric input (NaN/±Infinity/1e308/negative) BEFORE it can
// silently clamp through a Math.min/max bound and return a fabricated ok:true —
// the defect the macro-assassin's V2 vector catches. An absent/null field is
// fine (the macro uses its default). Returns null when clean, else the offending
// key. Copied from server/domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

// A World Bank indicator code (e.g. "SP.POP.TOTL") or one of our human aliases
// is alnum + dot/dash/underscore only. Validating the shape BEFORE the value is
// interpolated into the WB URL path (a) rejects the assassin's XSS/`<script>`
// probe BEFORE any outbound network call (so these macros are deterministic +
// never hammer World Bank with hostile payloads), and (b) is genuine URL-path
// injection hardening — a control char or `/` could otherwise re-target the
// upstream request. Empty is reported separately by each macro.
const INDICATOR_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
function validIndicatorCode(raw) {
  return INDICATOR_CODE_RE.test(raw);
}

export default function registerSocietyActions(register) {
  // Legacy-convention shim: adapt the canonical register(ctx, input) the MACROS
  // registry (and runMacro / the contract engine / macro-assassin) drive → the
  // verified (ctx, artifact, params) handler bodies below, unchanged. The same
  // compute lives here; no logic is duplicated. PRIOR BUG: this module used the
  // LEGACY 3-arg registerLensAction convention AND was never imported by
  // server.js — so every society.* (wb-*) macro was invisible to runMacro and
  // hit `unknown_macro` at runtime, leaving the DataExplorer + SocietyActionPanel
  // (the live World Bank surface) dead-wired. Rewired to canonical register.
  const registerLensAction = (domain, action, handler) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === "object" ? input : {};
      const artifact = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : { id: null, domain, type: "domain_action", data: inp, meta: {} };
      return handler(ctx, artifact, inp);
    });
  /**
   * wb-indicator — Fetch a single World Bank indicator for a country.
   * params: { country: ISO-3 (e.g. "USA", "GBR"), indicator: WB code OR alias }
   */
  registerLensAction("society", "wb-indicator", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return { ok: false, error: "country must be 3-letter ISO code (e.g. 'USA', 'GBR', 'JPN')" };
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required (WB code like 'SP.POP.TOTL' or alias like 'population')" };
    if (!validIndicatorCode(raw)) return { ok: false, error: "indicator must be a World Bank code or alias (alphanumeric, dot/dash/underscore)" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    try {
      const url = `${WB_BASE}/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=70`;
      const json = await wbJson(url);
      if (json.length < 2) {
        return { ok: false, error: `world-bank: ${json?.[0]?.message?.[0]?.value || "no data"}` };
      }
      const meta = json[0];
      const series = (json[1] || [])
        .filter((row) => row.value !== null && row.value !== undefined)
        .map((row) => ({ year: Number(row.date), value: row.value, countryName: row.country?.value }))
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
   */
  registerLensAction("society", "wb-country", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return { ok: false, error: "country must be 3-letter ISO code" };
    try {
      const json = await wbJson(`${WB_BASE}/country/${country}?format=json`);
      if (json.length < 2 || !json[1]?.[0]) {
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
   */
  registerLensAction("society", "wb-compare", async (_ctx, _artifact, params = {}) => {
    const countries = Array.isArray(params.countries) ? params.countries.map((c) => String(c).toUpperCase()) : [];
    if (countries.length < 2 || countries.length > 10) return { ok: false, error: "countries must be array of 2-10 ISO-3 codes" };
    if (!countries.every((c) => /^[A-Z]{3}$/.test(c))) return { ok: false, error: "all countries must be 3-letter ISO codes" };
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required" };
    if (!validIndicatorCode(raw)) return { ok: false, error: "indicator must be a World Bank code or alias" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    try {
      const url = `${WB_BASE}/country/${countries.join(";")}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=2000&mrnev=1`;
      const json = await wbJson(url);
      const rows = json[1] || [];
      const points = rows
        .filter((row) => row.value !== null)
        .map((row) => ({
          country: row.countryiso3code || row.country?.id,
          countryName: row.country?.value,
          year: Number(row.date),
          value: row.value,
        }))
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      return { ok: true, result: { indicator, countries, points, count: points.length, source: "world-bank-open-data" } };
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

  // ── Feature: Interactive charting series ────────────────────────────
  /**
   * wb-chart-series — Chart-ready, ascending series for one indicator
   * (single country) with optional per-capita / inflation transforms.
   * params: { country, indicator, perCapita?, inflationAdjust? }
   */
  registerLensAction("society", "wb-chart-series", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return { ok: false, error: "country must be 3-letter ISO code" };
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required" };
    if (!validIndicatorCode(raw)) return { ok: false, error: "indicator must be a World Bank code or alias" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    const perCapita = params.perCapita === true;
    const inflationAdjust = params.inflationAdjust === true;
    try {
      const json = await wbJson(`${WB_BASE}/country/${country}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=70`);
      if (json.length < 2 || !json[1]) return { ok: false, error: "no data for that country/indicator" };
      let series = json[1]
        .filter((r) => r.value !== null && r.value !== undefined)
        .map((r) => ({ year: Number(r.date), value: Number(r.value) }))
        .sort((a, b) => a.year - b.year);
      const transforms = [];
      if (perCapita) {
        const popJson = await wbJson(`${WB_BASE}/country/${country}/indicator/SP.POP.TOTL?format=json&per_page=70`);
        const pop = {};
        for (const r of popJson[1] || []) { if (r.value != null) pop[Number(r.date)] = Number(r.value); }
        series = series.filter((p) => pop[p.year]).map((p) => ({ year: p.year, value: p.value / pop[p.year] }));
        transforms.push("per-capita");
      }
      if (inflationAdjust) {
        const baseCpi = cpiFor(CPI_BASE_YEAR);
        series = series.map((p) => ({ year: p.year, value: p.value * (baseCpi / cpiFor(p.year)) }));
        transforms.push(`inflation-adjusted (USD ${CPI_BASE_YEAR})`);
      }
      const values = series.map((p) => p.value);
      return {
        ok: true,
        result: {
          country, indicator, alias: COMMON_INDICATORS[raw] ? raw : null,
          chartKind: "line",
          xKey: "year",
          series, points: series.length,
          transforms,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          first: series[0] || null,
          last: series[series.length - 1] || null,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Feature: Animated bubble chart (Gapminder's signature) ──────────
  /**
   * wb-bubble-frames — GDP-per-capita vs life-expectancy vs population,
   * one frame per year, for a set of countries. Drives the animated
   * Gapminder-style bubble chart.
   * params: { countries: [ISO-3,...] (2-30), startYear?, endYear?,
   *           xIndicator?, yIndicator?, sizeIndicator? }
   */
  registerLensAction("society", "wb-bubble-frames", async (_ctx, _artifact, params = {}) => {
    const countries = Array.isArray(params.countries) ? params.countries.map((c) => String(c).toUpperCase()) : [];
    if (countries.length < 2 || countries.length > 30) return { ok: false, error: "countries must be array of 2-30 ISO-3 codes" };
    if (!countries.every((c) => /^[A-Z]{3}$/.test(c))) return { ok: false, error: "all countries must be 3-letter ISO codes" };
    const badNum = badNumericField(params, ["startYear", "endYear"]);
    if (badNum) return { ok: false, error: `invalid ${badNum}` };
    for (const f of ["xIndicator", "yIndicator", "sizeIndicator"]) {
      if (params[f] != null && params[f] !== "" && !validIndicatorCode(String(params[f]))) {
        return { ok: false, error: `${f} must be a World Bank code or alias` };
      }
    }
    const xInd = COMMON_INDICATORS[params.xIndicator] || params.xIndicator || "NY.GDP.PCAP.CD";
    const yInd = COMMON_INDICATORS[params.yIndicator] || params.yIndicator || "SP.DYN.LE00.IN";
    const sizeInd = COMMON_INDICATORS[params.sizeIndicator] || params.sizeIndicator || "SP.POP.TOTL";
    const startYear = Number(params.startYear) || 1990;
    const endYear = Number(params.endYear) || new Date().getFullYear() - 1;
    if (endYear < startYear) return { ok: false, error: "endYear must be >= startYear" };
    try {
      const join = countries.join(";");
      const fetchAll = (ind) => wbJson(
        `${WB_BASE}/country/${join}/indicator/${encodeURIComponent(ind)}?format=json&per_page=8000&date=${startYear}:${endYear}`,
      );
      const [xJson, yJson, sJson] = await Promise.all([fetchAll(xInd), fetchAll(yInd), fetchAll(sizeInd)]);
      const idx = (json) => {
        const m = {};
        for (const r of json[1] || []) {
          if (r.value == null) continue;
          const c = r.countryiso3code || r.country?.id;
          (m[c] || (m[c] = {}))[Number(r.date)] = { value: Number(r.value), name: r.country?.value };
        }
        return m;
      };
      const xm = idx(xJson), ym = idx(yJson), sm = idx(sJson);
      const frames = [];
      for (let year = startYear; year <= endYear; year++) {
        const bubbles = [];
        for (const c of countries) {
          const xp = xm[c]?.[year], yp = ym[c]?.[year], sp = sm[c]?.[year];
          if (xp && yp) {
            bubbles.push({
              country: c,
              countryName: xp.name || yp.name || c,
              x: xp.value, y: yp.value,
              size: sp ? sp.value : null,
            });
          }
        }
        if (bubbles.length) frames.push({ year, bubbles });
      }
      return {
        ok: true,
        result: {
          countries, frames, frameCount: frames.length,
          xIndicator: xInd, yIndicator: yInd, sizeIndicator: sizeInd,
          startYear, endYear,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Feature: World choropleth map for any indicator ─────────────────
  /**
   * wb-choropleth — Latest value of one indicator for all (or a given
   * set of) countries, with lat/lon, value, and 0..1 normalised
   * intensity for a colour ramp. Drives the world choropleth map.
   * params: { indicator, year? (else most-recent), countries? }
   */
  registerLensAction("society", "wb-choropleth", async (_ctx, _artifact, params = {}) => {
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required" };
    if (!validIndicatorCode(raw)) return { ok: false, error: "indicator must be a World Bank code or alias" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    try {
      // Country metadata (lat/lon + region) for ~300 economies.
      const metaJson = await wbJson(`${WB_BASE}/country?format=json&per_page=400`);
      const meta = {};
      for (const c of metaJson[1] || []) {
        const lat = parseFloat(c.latitude), lon = parseFloat(c.longitude);
        // Skip aggregate rows (no real coordinates).
        if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
          meta[c.id] = { name: c.name, lat, lon, region: c.region?.value };
        }
      }
      const dataJson = await wbJson(
        `${WB_BASE}/country/all/indicator/${encodeURIComponent(indicator)}?format=json&per_page=20000&mrnev=1`,
      );
      const wanted = Array.isArray(params.countries)
        ? new Set(params.countries.map((c) => String(c).toUpperCase()))
        : null;
      const rows = [];
      for (const r of dataJson[1] || []) {
        if (r.value == null) continue;
        const iso3 = r.countryiso3code || r.country?.id;
        const m = meta[iso3];
        if (!m) continue;
        if (wanted && !wanted.has(iso3)) continue;
        rows.push({ country: iso3, countryName: m.name, region: m.region, lat: m.lat, lon: m.lon, year: Number(r.date), value: Number(r.value) });
      }
      const values = rows.map((r) => r.value);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 1;
      const span = max - min || 1;
      for (const r of rows) r.intensity = (r.value - min) / span;
      rows.sort((a, b) => b.value - a.value);
      return {
        ok: true,
        result: {
          indicator, alias: COMMON_INDICATORS[raw] ? raw : null,
          points: rows, count: rows.length,
          min, max,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Feature: Indicator search across the full catalog ───────────────
  /**
   * wb-indicator-search — Search the full ~1,400-indicator World Bank
   * catalog by free-text. Returns code, name, source, topics.
   * params: { query, limit? }
   */
  registerLensAction("society", "wb-indicator-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim().toLowerCase();
    if (query.length < 2) return { ok: false, error: "query must be at least 2 characters" };
    // Search text is matched client-side, but guard the shape so a hostile
    // payload (control chars / markup) can't reach the catalog scan loop.
    if (!/^[\w .,'+&/()-]{2,80}$/.test(query)) return { ok: false, error: "query contains unsupported characters" };
    const badNum = badNumericField(params, ["limit"]);
    if (badNum) return { ok: false, error: `invalid ${badNum}` };
    const limit = Math.min(Math.max(Number(params.limit) || 40, 1), 200);
    try {
      // The WB catalog has no server-side text filter; pull pages of the
      // indicator registry and filter client-side. ~25k entries total —
      // we scan the first ~6 pages (3000 indicators) which covers the
      // ~1,400 actively-populated codes.
      const matches = [];
      for (let page = 1; page <= 6 && matches.length < limit; page++) {
        const json = await wbJson(`${WB_BASE}/indicator?format=json&per_page=500&page=${page}`);
        const list = json[1] || [];
        for (const ind of list) {
          const name = String(ind.name || "");
          const id = String(ind.id || "");
          if (name.toLowerCase().includes(query) || id.toLowerCase().includes(query)) {
            matches.push({
              code: id,
              name,
              source: ind.source?.value || null,
              topics: Array.isArray(ind.topics) ? ind.topics.map((t) => t.value).filter(Boolean) : [],
            });
            if (matches.length >= limit) break;
          }
        }
        if (!list.length) break;
      }
      return { ok: true, result: { query, matches, count: matches.length, source: "world-bank-open-data" } };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Feature: Country detail dashboard ───────────────────────────────
  /**
   * wb-country-dashboard — Many headline indicators for one country on
   * one screen: latest value + 10-year sparkline series for each.
   * params: { country, indicators? (alias list, default headline set) }
   */
  registerLensAction("society", "wb-country-dashboard", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) return { ok: false, error: "country must be 3-letter ISO code" };
    const aliases = Array.isArray(params.indicators) && params.indicators.length
      ? params.indicators
      : ["population", "gdpPerCapita", "lifeExpectancy", "literacyRate", "gini",
         "infantMortality", "unemployment", "internetUsers", "urbanPopulationPct", "co2EmissionsPerCapita"];
    if (!aliases.every((a) => validIndicatorCode(String(a)))) {
      return { ok: false, error: "every indicator must be a World Bank code or alias" };
    }
    try {
      const profileJson = await wbJson(`${WB_BASE}/country/${country}?format=json`);
      const profile = profileJson[1]?.[0]
        ? {
            name: profileJson[1][0].name,
            capital: profileJson[1][0].capitalCity,
            region: profileJson[1][0].region?.value,
            incomeLevel: profileJson[1][0].incomeLevel?.value,
            lat: parseFloat(profileJson[1][0].latitude) || null,
            lon: parseFloat(profileJson[1][0].longitude) || null,
          }
        : { name: country };
      const cards = [];
      for (const alias of aliases) {
        const code = COMMON_INDICATORS[alias] || alias;
        try {
          const json = await wbJson(`${WB_BASE}/country/${country}/indicator/${encodeURIComponent(code)}?format=json&per_page=15`);
          const series = (json[1] || [])
            .filter((r) => r.value != null)
            .map((r) => ({ year: Number(r.date), value: Number(r.value) }))
            .sort((a, b) => a.year - b.year);
          cards.push({
            indicator: alias, code,
            latest: series[series.length - 1] || null,
            series,
            available: series.length > 0,
          });
        } catch {
          cards.push({ indicator: alias, code, latest: null, series: [], available: false });
        }
      }
      return {
        ok: true,
        result: {
          country, profile, cards,
          cardCount: cards.length,
          available: cards.filter((c) => c.available).length,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Feature: Data export (CSV) + shareable permalinks ───────────────
  /**
   * wb-export-csv — Serialise a series payload to CSV text for download.
   * params: { rows: [{...}], columns? }
   */
  registerLensAction("society", "wb-export-csv", (_ctx, _artifact, params = {}) => {
    const rows = Array.isArray(params.rows) ? params.rows : [];
    if (!rows.length) return { ok: false, error: "rows array required" };
    const columns = Array.isArray(params.columns) && params.columns.length
      ? params.columns
      : Array.from(new Set(rows.flatMap((r) => Object.keys(r || {}))));
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.join(",")];
    for (const r of rows) lines.push(columns.map((c) => esc(r?.[c])).join(","));
    const csv = lines.join("\n");
    return {
      ok: true,
      result: {
        csv,
        filename: String(params.filename || "society-export") + ".csv",
        rowCount: rows.length,
        columns,
        byteLength: Buffer.byteLength(csv, "utf8"),
      },
    };
  });

  /**
   * wb-save-chart — Persist a chart spec and return a shareable id +
   * permalink the UI can deep-link to. Stored per-user.
   * params: { spec: {...}, title? }
   */
  registerLensAction("society", "wb-save-chart", (ctx, _artifact, params = {}) => {
    const spec = params.spec;
    if (!spec || typeof spec !== "object") return { ok: false, error: "spec object required" };
    const store = chartStore();
    const id = "soc_" + Math.random().toString(36).slice(2, 11);
    const record = {
      id,
      owner: userId(ctx),
      title: String(params.title || "Untitled chart").slice(0, 120),
      spec,
      createdAt: new Date().toISOString(),
    };
    store.set(id, record);
    return {
      ok: true,
      result: { id, permalink: `/lenses/society?chart=${id}`, title: record.title, createdAt: record.createdAt },
    };
  });

  /**
   * wb-load-chart — Resolve a saved chart spec by share id.
   * params: { id }
   */
  registerLensAction("society", "wb-load-chart", (_ctx, _artifact, params = {}) => {
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    const record = chartStore().get(id);
    if (!record) return { ok: false, error: "chart not found" };
    return { ok: true, result: record };
  });

  /**
   * wb-list-charts — List the calling user's saved charts.
   */
  registerLensAction("society", "wb-list-charts", (ctx, _artifact, _params = {}) => {
    const uid = userId(ctx);
    const charts = Array.from(chartStore().values())
      .filter((r) => r.owner === uid)
      .map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, permalink: `/lenses/society?chart=${r.id}` }))
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return { ok: true, result: { charts, count: charts.length } };
  });

  // ── Feature: Region / income-group aggregates and rankings ──────────
  /**
   * wb-region-rankings — Latest indicator value for every World Bank
   * region + income-group aggregate, ranked. OWID-style comparison.
   * params: { indicator }
   */
  registerLensAction("society", "wb-region-rankings", async (_ctx, _artifact, params = {}) => {
    const raw = String(params.indicator || "").trim();
    if (!raw) return { ok: false, error: "indicator required" };
    if (!validIndicatorCode(raw)) return { ok: false, error: "indicator must be a World Bank code or alias" };
    const indicator = COMMON_INDICATORS[raw] || raw;
    try {
      const codes = Object.keys(AGGREGATE_CODES);
      const json = await wbJson(
        `${WB_BASE}/country/${codes.join(";")}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=4000&mrnev=1`,
      );
      const rows = (json[1] || [])
        .filter((r) => r.value != null)
        .map((r) => {
          const code = r.countryiso3code || r.country?.id;
          return { code, name: AGGREGATE_CODES[code] || r.country?.value, year: Number(r.date), value: Number(r.value) };
        })
        .sort((a, b) => b.value - a.value);
      rows.forEach((r, i) => { r.rank = i + 1; });
      const world = rows.find((r) => r.code === "WLD");
      return {
        ok: true,
        result: {
          indicator, alias: COMMON_INDICATORS[raw] ? raw : null,
          rankings: rows, count: rows.length,
          worldValue: world ? world.value : null,
          source: "world-bank-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `worldbank unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * wb-aggregate-codes — The region + income-group aggregate code table.
   */
  registerLensAction("society", "wb-aggregate-codes", (_ctx, _artifact, _params) => {
    return {
      ok: true,
      result: { aggregates: AGGREGATE_CODES, count: Object.keys(AGGREGATE_CODES).length, source: "world-bank-open-data" },
    };
  });

  // ── Feature: Per-capita / inflation-adjusted transform helper ───────
  /**
   * wb-transform-series — Apply per-capita and/or inflation-adjustment
   * to a caller-supplied series (pure compute; no network). The chart
   * UI calls this to flip metric toggles without a re-fetch.
   * params: { series:[{year,value}], population?:[{year,value}],
   *           perCapita?, inflationAdjust?, baseYear? }
   */
  registerLensAction("society", "wb-transform-series", (_ctx, _artifact, params = {}) => {
  try {
    const badNum = badNumericField(params, ["baseYear"]);
    if (badNum) return { ok: false, error: `invalid ${badNum}` };
    const series = Array.isArray(params.series) ? params.series : [];
    if (!series.length) return { ok: false, error: "series array required" };
    let out = series
      .filter((p) => p && p.year != null && p.value != null)
      .map((p) => ({ year: Number(p.year), value: Number(p.value) }));
    const transforms = [];
    if (params.perCapita === true) {
      const pop = {};
      for (const p of params.population || []) { if (p && p.year != null && p.value != null) pop[Number(p.year)] = Number(p.value); }
      if (!Object.keys(pop).length) return { ok: false, error: "perCapita requires a population series" };
      out = out.filter((p) => pop[p.year]).map((p) => ({ year: p.year, value: p.value / pop[p.year] }));
      transforms.push("per-capita");
    }
    if (params.inflationAdjust === true) {
      const baseYear = Number(params.baseYear) || CPI_BASE_YEAR;
      const baseCpi = cpiFor(baseYear);
      out = out.map((p) => ({ year: p.year, value: p.value * (baseCpi / cpiFor(p.year)) }));
      transforms.push(`inflation-adjusted (USD ${baseYear})`);
    }
    if (!transforms.length) return { ok: false, error: "specify perCapita and/or inflationAdjust" };
    const values = out.map((p) => p.value);
    return {
      ok: true,
      result: {
        series: out, points: out.length, transforms,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
