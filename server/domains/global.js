// server/domains/global.js
// Domain actions for global/cross-domain aggregation: cross-domain search,
// aggregate dashboards, and correlation matrix computation, plus live
// World Bank data-exploration macros (choropleth, time series, comparison,
// scatter explorer, indicator catalog search, country profiles, and
// shareable saved views).

import { cachedFetchJson } from "../lib/external-fetch.js";

// ---- World Bank API helpers -------------------------------------------------

const WB_BASE = "https://api.worldbank.org/v2";
const WB_TTL_MS = 30 * 60 * 1000; // 30 min — development data moves slowly

const INDICATOR_CODE_RE = /^[A-Z0-9.]{1,40}$/i;
const COUNTRY_CODE_RE = /^[A-Za-z]{2,3}$/;

// Country centroids (ISO3) for the choropleth / map layer. Only countries
// the World Bank reports plus a few aggregates would be huge — this covers
// the most-queried set; missing centroids simply skip the map marker.
const COUNTRY_CENTROIDS = {
  USA: [39.8, -98.6], CHN: [35.9, 104.2], IND: [22.4, 78.7], BRA: [-14.2, -51.9],
  RUS: [61.5, 105.3], JPN: [36.2, 138.3], DEU: [51.2, 10.4], GBR: [54.0, -2.0],
  FRA: [46.6, 2.2], CAN: [56.1, -106.3], AUS: [-25.3, 133.8], ITA: [41.9, 12.6],
  ESP: [40.5, -3.7], MEX: [23.6, -102.6], KOR: [35.9, 127.8], IDN: [-0.8, 113.9],
  NGA: [9.1, 8.7], ZAF: [-30.6, 22.9], EGY: [26.8, 30.8], TUR: [38.9, 35.2],
  ARG: [-38.4, -63.6], SAU: [23.9, 45.1], POL: [51.9, 19.1], SWE: [60.1, 18.6],
  NOR: [60.5, 8.5], CHE: [46.8, 8.2], NLD: [52.1, 5.3], BEL: [50.5, 4.5],
  KEN: [-0.0, 37.9], ETH: [9.1, 40.5], PAK: [30.4, 69.3], BGD: [23.7, 90.4],
  VNM: [14.1, 108.3], THA: [15.9, 100.9], PHL: [12.9, 121.8], COL: [4.6, -74.3],
  CHL: [-35.7, -71.5], PER: [-9.2, -75.0], NZL: [-40.9, 174.9], ISR: [31.0, 34.9],
  ARE: [23.4, 53.8], SGP: [1.4, 103.8], MYS: [4.2, 101.9], IRN: [32.4, 53.7],
  UKR: [48.4, 31.2], AUT: [47.5, 14.6], DNK: [56.3, 9.5], FIN: [61.9, 25.7],
  IRL: [53.4, -8.2], PRT: [39.4, -8.2], GRC: [39.1, 21.8], CZE: [49.8, 15.5],
  HUN: [47.2, 19.5], ROU: [45.9, 24.9], MAR: [31.8, -7.1], DZA: [28.0, 1.7],
  GHA: [7.9, -1.0], TZA: [-6.4, 34.9], UGA: [1.4, 32.3], COD: [-4.0, 21.8],
  AGO: [-11.2, 17.9], LKA: [7.9, 80.8], MMR: [21.9, 95.9], NPL: [28.4, 84.1],
  KAZ: [48.0, 66.9], UZB: [41.4, 64.6], IRQ: [33.2, 43.7], QAT: [25.4, 51.2],
  KWT: [29.3, 47.5], OMN: [21.5, 55.9], JOR: [30.6, 36.2], LBN: [33.9, 35.9],
};

function wbRound(v) { return Math.round(v * 1000) / 1000; }

// Parse the World Bank [meta, series] response into a flat point list.
function parseWbSeries(data, fallbackCountry, fallbackIndicator) {
  const series = Array.isArray(data) && data.length >= 2 ? data[1] || [] : [];
  return series
    .map((p) => ({
      year: parseInt(p.date, 10),
      value: typeof p.value === "number" ? p.value : null,
      countryCode: p.countryiso3code || p.country?.id || fallbackCountry,
      country: p.country?.value || fallbackCountry,
      indicator: p.indicator?.value || fallbackIndicator,
    }))
    .filter((p) => Number.isFinite(p.year))
    .sort((a, b) => a.year - b.year);
}

// Persistent per-user saved views (shareable chart links).
function savedViewStore() {
  const state = (globalThis._concordSTATE = globalThis._concordSTATE || {});
  if (!(state.globalSavedViews instanceof Map)) state.globalSavedViews = new Map();
  return state.globalSavedViews;
}

export default function registerGlobalActions(registerLensAction) {
  /**
   * crossDomainSearch
   * Search across multiple domains — merge results with relevance scoring,
   * deduplication, and source attribution.
   * artifact.data.sources = [{ domain, items: [{ id, title?, text?, tags?: string[], score?, metadata?: {} }] }]
   * params.query (search query string)
   * params.maxResults (default: 20)
   * params.weights (domain weight overrides, e.g. { "finance": 1.5 })
   */
  registerLensAction("global", "crossDomainSearch", (ctx, artifact, params) => {
    const sources = artifact.data?.sources || [];
    const query = (params.query || "").toLowerCase().trim();
    const maxResults = params.maxResults || 20;
    const domainWeights = params.weights || {};

    if (sources.length === 0) return { ok: false, error: "No sources provided." };
    if (!query) return { ok: false, error: "Search query is required." };

    const r = (v) => Math.round(v * 1000) / 1000;

    // Tokenize query
    const queryTokens = query.split(/\s+/).filter(t => t.length > 1);

    // Score each item across all sources
    const allResults = [];
    const fingerprints = new Map(); // for deduplication

    for (const source of sources) {
      const domain = source.domain || "unknown";
      const domainWeight = domainWeights[domain] || 1.0;

      for (const item of (source.items || [])) {
        const title = (item.title || "").toLowerCase();
        const text = (item.text || "").toLowerCase();
        const tags = (item.tags || []).map(t => t.toLowerCase());
        const combined = `${title} ${text} ${tags.join(" ")}`;

        // TF-based relevance scoring
        let titleScore = 0;
        let textScore = 0;
        let tagScore = 0;
        let exactMatchBonus = 0;

        for (const token of queryTokens) {
          // Title matches are weighted heavily
          if (title.includes(token)) {
            titleScore += 3;
            // Exact word match bonus
            if (title.split(/\s+/).includes(token)) titleScore += 2;
          }

          // Text matches
          const textMatches = (text.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
          textScore += Math.min(textMatches, 5); // cap at 5 to avoid keyword stuffing

          // Tag matches
          if (tags.includes(token)) tagScore += 4;
          else if (tags.some(t => t.includes(token))) tagScore += 2;
        }

        // Exact phrase match bonus
        if (combined.includes(query)) exactMatchBonus = 5;

        // Combine scores
        const rawScore = titleScore * 0.4 + textScore * 0.3 + tagScore * 0.2 + exactMatchBonus * 0.1;
        const baseScore = item.score || 0;
        const relevanceScore = (rawScore + baseScore * 0.5) * domainWeight;

        if (relevanceScore <= 0) continue;

        // Deduplication fingerprint: first 100 chars of normalized text
        const fingerprint = (title + text.slice(0, 100)).replace(/\s+/g, " ").trim();
        const fpKey = fingerprint.slice(0, 80);

        if (fingerprints.has(fpKey)) {
          // Merge: keep higher score, note multiple sources
          const existing = fingerprints.get(fpKey);
          if (relevanceScore > existing.relevanceScore) {
            existing.relevanceScore = relevanceScore;
          }
          if (!existing.sources.includes(domain)) {
            existing.sources.push(domain);
          }
          existing.duplicateCount++;
          continue;
        }

        const result = {
          id: item.id,
          title: item.title,
          text: item.text ? (item.text.length > 200 ? item.text.slice(0, 200) + "..." : item.text) : null,
          tags: item.tags,
          domain,
          sources: [domain],
          relevanceScore: r(relevanceScore),
          duplicateCount: 0,
          metadata: item.metadata,
        };
        allResults.push(result);
        fingerprints.set(fpKey, result);
      }
    }

    // Sort by relevance and take top results
    allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topResults = allResults.slice(0, maxResults);

    // Source distribution in results
    const sourceDistribution = {};
    for (const result of topResults) {
      for (const src of result.sources) {
        sourceDistribution[src] = (sourceDistribution[src] || 0) + 1;
      }
    }

    // Compute diversity score: how evenly distributed across domains
    const domainCounts = Object.values(sourceDistribution);
    const totalInResults = domainCounts.reduce((s, v) => s + v, 0);
    let diversityEntropy = 0;
    for (const count of domainCounts) {
      const p = count / totalInResults;
      if (p > 0) diversityEntropy -= p * Math.log2(p);
    }
    const maxDiversityEntropy = Math.log2(sources.length || 1);
    const diversityScore = maxDiversityEntropy > 0 ? diversityEntropy / maxDiversityEntropy : 0;

    // Deduplication stats
    const totalDuplicates = allResults.reduce((s, r) => s + r.duplicateCount, 0);

    return {
      ok: true,
      result: {
        query,
        totalCandidates: sources.reduce((s, src) => s + (src.items || []).length, 0),
        matchCount: allResults.length,
        results: topResults.map(({ duplicateCount, ...rest }) => rest),
        sourceDistribution,
        diversityScore: r(diversityScore),
        diversityLabel: diversityScore > 0.8 ? "excellent" : diversityScore > 0.5 ? "good" : diversityScore > 0.3 ? "moderate" : "dominated by single source",
        deduplication: { duplicatesFound: totalDuplicates, uniqueResults: allResults.length },
        sourcesSearched: sources.length,
      },
    };
  });

  /**
   * aggregateDashboard
   * Build aggregate dashboard from multiple domain metrics — normalize scales,
   * compute composite indices.
   * artifact.data.metrics = [{ domain, name, value, unit?, min?, max?, higherIsBetter? }]
   * params.weights (optional: { "metricName": weight })
   * params.normalization: "min-max" | "z-score" | "percentile" (default: "min-max")
   */
  registerLensAction("global", "aggregateDashboard", (ctx, artifact, params) => {
    const metrics = artifact.data?.metrics || [];
    if (metrics.length === 0) return { ok: false, error: "No metrics provided." };

    const weights = params.weights || {};
    const normMethod = params.normalization || "min-max";
    const r = (v) => Math.round(v * 1000) / 1000;

    // Group metrics by name for normalization
    const metricGroups = {};
    for (const m of metrics) {
      const key = m.name;
      if (!metricGroups[key]) metricGroups[key] = [];
      metricGroups[key].push(m);
    }

    // Normalize each metric group
    const normalized = [];
    const groupStats = {};

    for (const [name, group] of Object.entries(metricGroups)) {
      const values = group.map(m => Number(m.value)).filter(v => !isNaN(v));
      if (values.length === 0) continue;

      const min = group[0].min !== undefined ? group[0].min : Math.min(...values);
      const max = group[0].max !== undefined ? group[0].max : Math.max(...values);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;
      const sorted = [...values].sort((a, b) => a - b);
      const higherIsBetter = group[0].higherIsBetter !== false;

      groupStats[name] = { min: r(min), max: r(max), mean: r(mean), std: r(std), count: values.length };

      for (const m of group) {
        const val = Number(m.value);
        if (isNaN(val)) continue;

        let normValue;
        switch (normMethod) {
          case "z-score":
            normValue = (val - mean) / std;
            break;
          case "percentile": {
            const rank = sorted.filter(v => v <= val).length;
            normValue = rank / sorted.length;
            break;
          }
          case "min-max":
          default:
            normValue = max > min ? (val - min) / (max - min) : 0.5;
            break;
        }

        // Invert if lower is better
        if (!higherIsBetter && normMethod !== "z-score") {
          normValue = 1 - normValue;
        } else if (!higherIsBetter && normMethod === "z-score") {
          normValue = -normValue;
        }

        normalized.push({
          domain: m.domain,
          name: m.name,
          rawValue: m.value,
          unit: m.unit,
          normalizedValue: r(normValue),
          weight: weights[m.name] || 1,
        });
      }
    }

    // Compute composite index per domain
    const domainGroups = {};
    for (const m of normalized) {
      if (!domainGroups[m.domain]) domainGroups[m.domain] = [];
      domainGroups[m.domain].push(m);
    }

    const domainScores = {};
    for (const [domain, domMetrics] of Object.entries(domainGroups)) {
      const totalWeight = domMetrics.reduce((s, m) => s + m.weight, 0);
      const weightedSum = domMetrics.reduce((s, m) => s + m.normalizedValue * m.weight, 0);
      const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

      // Individual metric scores for the domain
      const breakdown = domMetrics.map(m => ({
        name: m.name,
        raw: m.rawValue,
        unit: m.unit,
        normalized: m.normalizedValue,
        weight: m.weight,
        contribution: r(totalWeight > 0 ? (m.normalizedValue * m.weight) / totalWeight : 0),
      }));

      domainScores[domain] = {
        compositeScore: r(compositeScore),
        metricCount: domMetrics.length,
        breakdown,
        grade: compositeScore > 0.9 ? "A+" : compositeScore > 0.8 ? "A" : compositeScore > 0.7 ? "B" : compositeScore > 0.6 ? "C" : compositeScore > 0.5 ? "D" : "F",
      };
    }

    // Overall composite
    const allComposites = Object.values(domainScores).map(d => d.compositeScore);
    const overallComposite = allComposites.length > 0
      ? allComposites.reduce((s, v) => s + v, 0) / allComposites.length
      : 0;

    // Rankings
    const rankings = Object.entries(domainScores)
      .map(([domain, data]) => ({ domain, compositeScore: data.compositeScore, grade: data.grade }))
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .map((entry, i) => ({ ...entry, rank: i + 1 }));

    // Identify strengths and weaknesses across all normalized metrics
    const sortedByNorm = [...normalized].sort((a, b) => b.normalizedValue - a.normalizedValue);
    const strengths = sortedByNorm.slice(0, 5).map(m => ({ domain: m.domain, metric: m.name, score: m.normalizedValue }));
    const weaknesses = sortedByNorm.slice(-5).reverse().map(m => ({ domain: m.domain, metric: m.name, score: m.normalizedValue }));

    return {
      ok: true,
      result: {
        totalMetrics: metrics.length,
        domains: Object.keys(domainScores).length,
        normalization: normMethod,
        domainScores,
        rankings,
        overallComposite: r(overallComposite),
        overallGrade: overallComposite > 0.9 ? "A+" : overallComposite > 0.8 ? "A" : overallComposite > 0.7 ? "B" : overallComposite > 0.6 ? "C" : "D",
        strengths,
        weaknesses,
        metricStatistics: groupStats,
      },
    };
  });

  /**
   * correlationMatrix
   * Compute cross-domain correlation matrix — Pearson and Spearman correlations,
   * identify unexpected relationships.
   * artifact.data.variables = [{ name, domain?, values: number[] }]
   * params.method: "pearson" | "spearman" | "both" (default: "both")
   * params.significanceThreshold (p-value threshold, default: 0.05)
   */
  registerLensAction("global", "correlationMatrix", (ctx, artifact, params) => {
    const variables = artifact.data?.variables || [];
    if (variables.length < 2) return { ok: false, error: "Need at least 2 variables." };

    const method = params.method || "both";
    const sigThreshold = params.significanceThreshold || 0.05;
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // Ensure all variables have the same length (truncate to shortest)
    const minLen = Math.min(...variables.map(v => (v.values || []).length));
    if (minLen < 3) return { ok: false, error: "Need at least 3 observations per variable." };

    const vars = variables.map(v => ({
      name: v.name,
      domain: v.domain || "unknown",
      values: (v.values || []).slice(0, minLen).map(Number),
    }));
    const n = minLen;
    const numVars = vars.length;

    // Pearson correlation
    function pearson(x, y) {
      const mx = x.reduce((s, v) => s + v, 0) / n;
      const my = y.reduce((s, v) => s + v, 0) / n;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) {
        num += (x[i] - mx) * (y[i] - my);
        dx += (x[i] - mx) ** 2;
        dy += (y[i] - my) ** 2;
      }
      return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
    }

    // Spearman correlation (rank-based)
    function spearman(x, y) {
      function rank(arr) {
        const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const ranks = new Array(arr.length);
        let i = 0;
        while (i < sorted.length) {
          let j = i;
          while (j < sorted.length && sorted[j].v === sorted[i].v) j++;
          const avgRank = (i + j - 1) / 2 + 1;
          for (let k = i; k < j; k++) ranks[sorted[k].i] = avgRank;
          i = j;
        }
        return ranks;
      }
      return pearson(rank(x), rank(y));
    }

    // Approximate p-value for correlation using t-distribution approximation
    function corrPValue(corr, n) {
      if (Math.abs(corr) >= 1) return 0;
      const t = corr * Math.sqrt((n - 2) / (1 - corr * corr));
      // Approximate p-value using normal distribution for large n
      const z = Math.abs(t);
      // Simple approximation of 2-tailed p-value
      const p = 2 * (1 - normalCDF(z));
      return p;
    }

    // Normal CDF approximation
    function normalCDF(z) {
      const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
      const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
      const sign = z < 0 ? -1 : 1;
      z = Math.abs(z) / Math.SQRT2;
      const t = 1 / (1 + p * z);
      const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
      return 0.5 * (1 + sign * y);
    }

    // Build correlation matrices
    const pearsonMatrix = {};
    const spearmanMatrix = {};
    const pValueMatrix = {};
    const significantPairs = [];
    const unexpectedRelationships = [];

    for (let i = 0; i < numVars; i++) {
      const ni = vars[i].name;
      if (!pearsonMatrix[ni]) pearsonMatrix[ni] = {};
      if (!spearmanMatrix[ni]) spearmanMatrix[ni] = {};
      if (!pValueMatrix[ni]) pValueMatrix[ni] = {};

      for (let j = 0; j < numVars; j++) {
        const nj = vars[j].name;

        if (i === j) {
          pearsonMatrix[ni][nj] = 1;
          spearmanMatrix[ni][nj] = 1;
          pValueMatrix[ni][nj] = 0;
          continue;
        }

        if (j < i) {
          // Matrix is symmetric, reuse
          pearsonMatrix[ni][nj] = pearsonMatrix[nj][ni];
          spearmanMatrix[ni][nj] = spearmanMatrix[nj][ni];
          pValueMatrix[ni][nj] = pValueMatrix[nj][ni];
          continue;
        }

        const pc = method !== "spearman" ? pearson(vars[i].values, vars[j].values) : 0;
        const sc = method !== "pearson" ? spearman(vars[i].values, vars[j].values) : 0;
        const pVal = corrPValue(method === "spearman" ? sc : pc, n);

        pearsonMatrix[ni][nj] = r(pc);
        spearmanMatrix[ni][nj] = r(sc);
        pValueMatrix[ni][nj] = r(pVal);

        const corr = method === "spearman" ? sc : pc;
        const absCorr = Math.abs(corr);

        if (pVal < sigThreshold && absCorr > 0.3) {
          const pair = {
            var1: ni,
            var2: nj,
            domain1: vars[i].domain,
            domain2: vars[j].domain,
            pearson: r(pc),
            spearman: r(sc),
            pValue: r(pVal),
            strength: absCorr > 0.8 ? "very strong" : absCorr > 0.6 ? "strong" : absCorr > 0.4 ? "moderate" : "weak",
            direction: corr > 0 ? "positive" : "negative",
          };
          significantPairs.push(pair);

          // Cross-domain correlations are "unexpected"
          if (vars[i].domain !== vars[j].domain) {
            unexpectedRelationships.push(pair);
          }
        }
      }
    }

    // Sort by absolute correlation strength
    significantPairs.sort((a, b) => Math.abs(method === "spearman" ? b.spearman : b.pearson) - Math.abs(method === "spearman" ? a.spearman : a.pearson));
    unexpectedRelationships.sort((a, b) => Math.abs(method === "spearman" ? b.spearman : b.pearson) - Math.abs(method === "spearman" ? a.spearman : a.pearson));

    // Variable statistics
    const varStats = vars.map(v => {
      const mean = v.values.reduce((s, val) => s + val, 0) / n;
      const std = Math.sqrt(v.values.reduce((s, val) => s + (val - mean) ** 2, 0) / n);
      return { name: v.name, domain: v.domain, mean: r(mean), std: r(std), min: r(Math.min(...v.values)), max: r(Math.max(...v.values)) };
    });

    // Multicollinearity detection: groups of highly correlated variables
    const collinearGroups = [];
    const collinearThreshold = 0.85;
    const visited = new Set();
    for (let i = 0; i < numVars; i++) {
      if (visited.has(i)) continue;
      const group = [vars[i].name];
      visited.add(i);
      for (let j = i + 1; j < numVars; j++) {
        if (visited.has(j)) continue;
        const corr = Math.abs(pearsonMatrix[vars[i].name]?.[vars[j].name] || 0);
        if (corr >= collinearThreshold) {
          group.push(vars[j].name);
          visited.add(j);
        }
      }
      if (group.length > 1) collinearGroups.push(group);
    }

    return {
      ok: true,
      result: {
        variables: numVars,
        observations: n,
        method,
        pearsonMatrix: method !== "spearman" ? pearsonMatrix : undefined,
        spearmanMatrix: method !== "pearson" ? spearmanMatrix : undefined,
        pValueMatrix,
        significantCorrelations: significantPairs.slice(0, 20),
        significantCount: significantPairs.length,
        unexpectedRelationships: unexpectedRelationships.slice(0, 10),
        collinearGroups,
        variableStatistics: varStats,
        significanceThreshold: sigThreshold,
      },
    };
  });

  // ===========================================================================
  // LIVE WORLD BANK DATA-EXPLORATION MACROS
  // ===========================================================================

  /**
   * indicatorTimeseries
   * Time-series for one indicator + one country (year-slider chart).
   * params.country (ISO2/ISO3), params.indicator (WB code), params.yearsBack.
   */
  registerLensAction("global", "indicatorTimeseries", async (_ctx, _artifact, params) => {
    try {
      const country = String(params.country || "").trim().toUpperCase();
      const indicator = String(params.indicator || "").trim();
      if (!COUNTRY_CODE_RE.test(country)) return { ok: false, error: "Valid ISO country code required." };
      if (!INDICATOR_CODE_RE.test(indicator)) return { ok: false, error: "Valid World Bank indicator code required." };
      const yearsBack = Math.min(Math.max(Number(params.yearsBack) || 25, 2), 60);
      const now = new Date().getUTCFullYear();
      const url = `${WB_BASE}/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&date=${now - yearsBack}:${now}&per_page=${yearsBack + 2}`;
      const data = await cachedFetchJson(url, { ttlMs: WB_TTL_MS });
      const points = parseWbSeries(data, country, indicator);
      const valued = points.filter((p) => p.value != null);
      if (valued.length === 0) return { ok: false, error: "No data for that country + indicator." };
      const first = valued[0];
      const last = valued[valued.length - 1];
      const pctChange = first.value !== 0 ? wbRound(((last.value - first.value) / Math.abs(first.value)) * 100) : null;
      return {
        ok: true,
        result: {
          country,
          countryName: valued[0].country,
          indicator,
          indicatorName: valued[0].indicator,
          points,
          minYear: points[0]?.year ?? null,
          maxYear: points[points.length - 1]?.year ?? null,
          latest: { year: last.year, value: last.value },
          earliest: { year: first.year, value: first.value },
          pctChange,
          source: "World Bank Open Data",
        },
      };
    } catch (e) {
      return { ok: false, error: `World Bank unreachable: ${String(e?.message || e)}` };
    }
  });

  /**
   * choropleth
   * One indicator across many countries for the latest available year —
   * returns per-country values + map markers + a 0..1 normalized intensity.
   * params.indicator (WB code), params.year (optional, defaults latest),
   * params.countries (optional ISO3 array override).
   */
  registerLensAction("global", "choropleth", async (_ctx, _artifact, params) => {
    try {
      const indicator = String(params.indicator || "").trim();
      if (!INDICATOR_CODE_RE.test(indicator)) return { ok: false, error: "Valid World Bank indicator code required." };
      const requested = Array.isArray(params.countries) && params.countries.length > 0
        ? params.countries.map((c) => String(c).trim().toUpperCase()).filter((c) => COUNTRY_CODE_RE.test(c))
        : Object.keys(COUNTRY_CENTROIDS);
      const codes = requested.slice(0, 80).join(";");
      const now = new Date().getUTCFullYear();
      const targetYear = Number(params.year) || null;
      const dateRange = targetYear ? `${targetYear}:${targetYear}` : `${now - 6}:${now}`;
      const url = `${WB_BASE}/country/${encodeURIComponent(codes)}/indicator/${encodeURIComponent(indicator)}?format=json&date=${dateRange}&per_page=2000`;
      const data = await cachedFetchJson(url, { ttlMs: WB_TTL_MS });
      const points = parseWbSeries(data, "", indicator);
      // Pick the most recent valued point per country.
      const byCountry = new Map();
      for (const p of points) {
        if (p.value == null) continue;
        const code = (p.countryCode || "").toUpperCase();
        const existing = byCountry.get(code);
        if (!existing || p.year > existing.year) byCountry.set(code, p);
      }
      const rows = [...byCountry.values()];
      if (rows.length === 0) return { ok: false, error: "No data for that indicator." };
      const values = rows.map((r) => r.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const countries = rows
        .map((r) => {
          const intensity = (r.value - min) / span;
          const centroid = COUNTRY_CENTROIDS[r.countryCode];
          return {
            code: r.countryCode,
            name: r.country,
            year: r.year,
            value: r.value,
            intensity: wbRound(intensity),
            lat: centroid ? centroid[0] : null,
            lon: centroid ? centroid[1] : null,
          };
        })
        .sort((a, b) => b.value - a.value);
      return {
        ok: true,
        result: {
          indicator,
          indicatorName: rows[0].indicator,
          countryCount: countries.length,
          min: wbRound(min),
          max: wbRound(max),
          countries,
          source: "World Bank Open Data",
        },
      };
    } catch (e) {
      return { ok: false, error: `World Bank unreachable: ${String(e?.message || e)}` };
    }
  });

  /**
   * compareCountries
   * Side-by-side time-series of one indicator for up to 6 countries.
   * params.countries (ISO array), params.indicator, params.yearsBack.
   */
  registerLensAction("global", "compareCountries", async (_ctx, _artifact, params) => {
    try {
      const indicator = String(params.indicator || "").trim();
      if (!INDICATOR_CODE_RE.test(indicator)) return { ok: false, error: "Valid World Bank indicator code required." };
      const countries = (Array.isArray(params.countries) ? params.countries : [])
        .map((c) => String(c).trim().toUpperCase())
        .filter((c) => COUNTRY_CODE_RE.test(c))
        .slice(0, 6);
      if (countries.length < 2) return { ok: false, error: "Provide at least 2 country codes." };
      const yearsBack = Math.min(Math.max(Number(params.yearsBack) || 20, 2), 60);
      const now = new Date().getUTCFullYear();
      const codes = countries.join(";");
      const url = `${WB_BASE}/country/${encodeURIComponent(codes)}/indicator/${encodeURIComponent(indicator)}?format=json&date=${now - yearsBack}:${now}&per_page=2000`;
      const data = await cachedFetchJson(url, { ttlMs: WB_TTL_MS });
      const points = parseWbSeries(data, "", indicator);
      if (points.length === 0) return { ok: false, error: "No data for those countries + indicator." };
      // Build a wide table: one row per year, one column per country code.
      const yearMap = new Map();
      const seriesMeta = new Map();
      for (const p of points) {
        const code = (p.countryCode || "").toUpperCase();
        if (!countries.includes(code)) continue;
        if (!seriesMeta.has(code)) seriesMeta.set(code, p.country);
        if (!yearMap.has(p.year)) yearMap.set(p.year, { year: p.year });
        yearMap.get(p.year)[code] = p.value;
      }
      const table = [...yearMap.values()].sort((a, b) => a.year - b.year);
      const series = countries
        .filter((c) => seriesMeta.has(c))
        .map((c) => {
          const vals = table.map((r) => r[c]).filter((v) => v != null);
          return {
            code: c,
            name: seriesMeta.get(c),
            latest: vals.length ? vals[vals.length - 1] : null,
            earliest: vals.length ? vals[0] : null,
          };
        });
      return {
        ok: true,
        result: {
          indicator,
          indicatorName: points[0].indicator,
          countries: series,
          table,
          minYear: table[0]?.year ?? null,
          maxYear: table[table.length - 1]?.year ?? null,
          source: "World Bank Open Data",
        },
      };
    } catch (e) {
      return { ok: false, error: `World Bank unreachable: ${String(e?.message || e)}` };
    }
  });

  /**
   * scatterExplorer
   * Two indicators across many countries — bubble/scatter (X vs Y),
   * optionally with a size indicator, animated by year.
   * params.indicatorX, params.indicatorY, params.indicatorSize (optional),
   * params.countries (optional ISO3 override), params.yearsBack.
   */
  registerLensAction("global", "scatterExplorer", async (_ctx, _artifact, params) => {
    try {
      const indicatorX = String(params.indicatorX || "").trim();
      const indicatorY = String(params.indicatorY || "").trim();
      if (!INDICATOR_CODE_RE.test(indicatorX) || !INDICATOR_CODE_RE.test(indicatorY)) {
        return { ok: false, error: "Two valid World Bank indicator codes required." };
      }
      const indicatorSize = params.indicatorSize ? String(params.indicatorSize).trim() : null;
      if (indicatorSize && !INDICATOR_CODE_RE.test(indicatorSize)) {
        return { ok: false, error: "Invalid size indicator code." };
      }
      const requested = Array.isArray(params.countries) && params.countries.length > 0
        ? params.countries.map((c) => String(c).trim().toUpperCase()).filter((c) => COUNTRY_CODE_RE.test(c))
        : Object.keys(COUNTRY_CENTROIDS);
      const codes = requested.slice(0, 60).join(";");
      const yearsBack = Math.min(Math.max(Number(params.yearsBack) || 15, 2), 40);
      const now = new Date().getUTCFullYear();
      const wanted = [indicatorX, indicatorY, ...(indicatorSize ? [indicatorSize] : [])];
      const fetched = await Promise.all(
        wanted.map((ind) =>
          cachedFetchJson(
            `${WB_BASE}/country/${encodeURIComponent(codes)}/indicator/${encodeURIComponent(ind)}?format=json&date=${now - yearsBack}:${now}&per_page=4000`,
            { ttlMs: WB_TTL_MS },
          ).then((d) => parseWbSeries(d, "", ind)),
        ),
      );
      const [ptsX, ptsY, ptsSize] = [fetched[0], fetched[1], indicatorSize ? fetched[2] : []];
      const idx = (pts) => {
        const m = new Map();
        for (const p of pts) {
          if (p.value == null) continue;
          m.set(`${(p.countryCode || "").toUpperCase()}|${p.year}`, p);
        }
        return m;
      };
      const xi = idx(ptsX);
      const yi = idx(ptsY);
      const si = idx(ptsSize);
      const frames = new Map();
      const namesByCode = new Map();
      for (const [key, px] of xi) {
        const py = yi.get(key);
        if (!py) continue;
        const [code, yearStr] = key.split("|");
        const year = Number(yearStr);
        namesByCode.set(code, px.country);
        if (!frames.has(year)) frames.set(year, []);
        const ps = si.get(key);
        frames.get(year).push({
          code,
          name: px.country,
          x: px.value,
          y: py.value,
          size: ps ? ps.value : null,
        });
      }
      const years = [...frames.keys()].sort((a, b) => a - b);
      if (years.length === 0) return { ok: false, error: "No overlapping data for those indicators." };
      return {
        ok: true,
        result: {
          indicatorX,
          indicatorY,
          indicatorSize,
          indicatorXName: ptsX[0]?.indicator || indicatorX,
          indicatorYName: ptsY[0]?.indicator || indicatorY,
          indicatorSizeName: indicatorSize ? ptsSize[0]?.indicator || indicatorSize : null,
          years,
          frames: years.map((y) => ({ year: y, points: frames.get(y) })),
          source: "World Bank Open Data",
        },
      };
    } catch (e) {
      return { ok: false, error: `World Bank unreachable: ${String(e?.message || e)}` };
    }
  });

  /**
   * searchIndicators
   * Search the full World Bank indicator catalog by keyword.
   * params.query (substring), params.limit.
   */
  registerLensAction("global", "searchIndicators", async (_ctx, _artifact, params) => {
    try {
      const query = String(params.query || "").trim().toLowerCase();
      if (query.length < 2) return { ok: false, error: "Search query must be at least 2 characters." };
      const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 60);
      // World Bank has no server-side text search; pull a page of the catalog
      // and filter client-side. The catalog is large so pull a generous slab.
      const url = `${WB_BASE}/indicator?format=json&per_page=20000`;
      const data = await cachedFetchJson(url, { ttlMs: 6 * 60 * 60 * 1000 });
      const all = Array.isArray(data) && data.length >= 2 ? data[1] || [] : [];
      const matches = [];
      for (const ind of all) {
        const id = (ind.id || "").toLowerCase();
        const name = (ind.name || "").toLowerCase();
        if (id.includes(query) || name.includes(query)) {
          matches.push({
            code: ind.id,
            name: ind.name,
            sourceNote: ind.sourceNote ? String(ind.sourceNote).slice(0, 280) : "",
            sourceOrg: ind.sourceOrganization || "",
            topics: (ind.topics || []).map((t) => t.value).filter(Boolean),
          });
          if (matches.length >= limit * 3) break;
        }
      }
      // Rank: name-startswith > name-includes > id-includes.
      matches.sort((a, b) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        const rank = (n, code) => (n.startsWith(query) ? 0 : n.includes(query) ? 1 : code.toLowerCase().includes(query) ? 2 : 3);
        return rank(an, a.code) - rank(bn, b.code);
      });
      return {
        ok: true,
        result: {
          query,
          totalMatches: matches.length,
          indicators: matches.slice(0, limit),
          source: "World Bank Open Data",
        },
      };
    } catch (e) {
      return { ok: false, error: `World Bank unreachable: ${String(e?.message || e)}` };
    }
  });

  /**
   * countryProfile
   * Aggregate a bundle of headline indicators for a single country —
   * the latest value + recent trend for each.
   * params.country (ISO2/ISO3), params.indicators (optional WB code array).
   */
  registerLensAction("global", "countryProfile", async (_ctx, _artifact, params) => {
    try {
      const country = String(params.country || "").trim().toUpperCase();
      if (!COUNTRY_CODE_RE.test(country)) return { ok: false, error: "Valid ISO country code required." };
      const DEFAULT_PROFILE = [
        "NY.GDP.MKTP.CD", "NY.GDP.PCAP.CD", "SP.POP.TOTL", "SP.DYN.LE00.IN",
        "SE.ADT.LITR.ZS", "IT.NET.USER.ZS", "SL.UEM.TOTL.ZS", "FP.CPI.TOTL.ZG",
        "SP.URB.TOTL.IN.ZS", "EN.ATM.CO2E.PC",
      ];
      const codes = (Array.isArray(params.indicators) && params.indicators.length > 0
        ? params.indicators.map((c) => String(c).trim())
        : DEFAULT_PROFILE
      ).filter((c) => INDICATOR_CODE_RE.test(c)).slice(0, 16);
      if (codes.length === 0) return { ok: false, error: "No valid indicators." };
      const now = new Date().getUTCFullYear();
      const fetched = await Promise.all(
        codes.map((ind) =>
          cachedFetchJson(
            `${WB_BASE}/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(ind)}?format=json&date=${now - 12}:${now}&per_page=15`,
            { ttlMs: WB_TTL_MS },
          )
            .then((d) => ({ code: ind, points: parseWbSeries(d, country, ind) }))
            .catch(() => ({ code: ind, points: [] })),
        ),
      );
      let countryName = country;
      const indicators = fetched.map(({ code, points }) => {
        const valued = points.filter((p) => p.value != null);
        if (valued.length && valued[0].country) countryName = valued[0].country;
        const last = valued[valued.length - 1] || null;
        const prev = valued.length >= 2 ? valued[valued.length - 2] : null;
        const trend = last && prev && prev.value !== 0
          ? wbRound(((last.value - prev.value) / Math.abs(prev.value)) * 100)
          : null;
        return {
          code,
          name: valued[0]?.indicator || code,
          latestValue: last ? last.value : null,
          latestYear: last ? last.year : null,
          trendPct: trend,
          spark: valued.map((p) => ({ year: p.year, value: p.value })),
        };
      });
      const withData = indicators.filter((i) => i.latestValue != null);
      if (withData.length === 0) return { ok: false, error: "No data for that country." };
      return {
        ok: true,
        result: {
          country,
          countryName,
          indicatorCount: withData.length,
          indicators,
          source: "World Bank Open Data",
        },
      };
    } catch (e) {
      return { ok: false, error: `World Bank unreachable: ${String(e?.message || e)}` };
    }
  });

  /**
   * saveView
   * Persist a shareable chart view (mode + params) keyed by userId.
   * params.view = { mode, label, config }.
   */
  registerLensAction("global", "saveView", (ctx, _artifact, params) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "Authentication required." };
      const view = params.view || {};
      const mode = String(view.mode || "").trim();
      if (!mode) return { ok: false, error: "View mode is required." };
      const store = savedViewStore();
      const list = store.get(userId) || [];
      const id = `gv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const record = {
        id,
        mode,
        label: String(view.label || mode).slice(0, 120),
        config: view.config && typeof view.config === "object" ? view.config : {},
        createdAt: new Date().toISOString(),
      };
      list.unshift(record);
      store.set(userId, list.slice(0, 100));
      return { ok: true, result: { saved: record, shareLink: `/lenses/global?view=${id}`, total: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * listViews
   * Return the caller's saved views; optionally resolve one by id.
   * params.id (optional).
   */
  registerLensAction("global", "listViews", (ctx, _artifact, params) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "Authentication required." };
      const list = savedViewStore().get(userId) || [];
      if (params.id) {
        const found = list.find((v) => v.id === params.id);
        if (!found) return { ok: false, error: "Saved view not found." };
        return { ok: true, result: { view: found } };
      }
      return { ok: true, result: { views: list, total: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * deleteView
   * Remove a saved view by id.
   * params.id (required).
   */
  registerLensAction("global", "deleteView", (ctx, _artifact, params) => {
    try {
      const userId = ctx?.actor?.userId || ctx?.userId;
      if (!userId) return { ok: false, error: "Authentication required." };
      const id = String(params.id || "").trim();
      if (!id) return { ok: false, error: "View id is required." };
      const store = savedViewStore();
      const list = store.get(userId) || [];
      const next = list.filter((v) => v.id !== id);
      if (next.length === list.length) return { ok: false, error: "Saved view not found." };
      store.set(userId, next);
      return { ok: true, result: { deleted: id, total: next.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
