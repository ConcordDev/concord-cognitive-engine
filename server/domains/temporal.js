// server/domains/temporal.js
// Domain actions for time-series and temporal reasoning: decomposition,
// anomaly detection, and forecasting with exponential smoothing.

export default function registerTemporalActions(registerLensAction) {
  // ─── Persistent per-user dataset store ──────────────────────────────
  // Time series the user imported (CSV) or pasted, keyed by userId so the
  // analysis macros below can run against a stored dataset by id.
  function getTemporalState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.temporalLens) STATE.temporalLens = {};
    const s = STATE.temporalLens;
    if (!(s.datasets instanceof Map)) s.datasets = new Map();
    return s;
  }
  function saveTemporalState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const tpId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tpNow = () => new Date().toISOString();
  const tpAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const tpRound = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6;
  const tpUserList = (s, userId) => {
    if (!s.datasets.has(userId)) s.datasets.set(userId, []);
    return s.datasets.get(userId);
  };

  // Resolve a numeric series + optional timestamps from either a stored
  // dataset (params.datasetId), an inline artifact, or inline params.
  function resolveSeries(ctx, artifact, params) {
    if (params && params.datasetId) {
      const s = getTemporalState();
      if (!s) return { error: "State unavailable." };
      const ds = tpUserList(s, tpAid(ctx)).find((d) => d.id === params.datasetId);
      if (!ds) return { error: "Dataset not found." };
      return { values: ds.values.slice(), timestamps: ds.timestamps ? ds.timestamps.slice() : null, dataset: ds };
    }
    const rawV = params?.values || artifact?.data?.values
      || (params?.series || artifact?.data?.series || []).map((x) => x.value);
    const rawT = (params?.series || artifact?.data?.series || []).map((x) => x.timestamp);
    const values = (rawV || []).map(Number).filter((v) => !isNaN(v));
    const timestamps = rawT.length && rawT.some((t) => t != null) ? rawT : null;
    return { values, timestamps, dataset: null };
  }

  /**
   * dataset-import
   * Parse a CSV or pasted text into a stored, named time series.
   * params.name, params.csv (raw text). First numeric column => value;
   * an ISO-date-ish first column => timestamp. Returns the stored dataset.
   */
  registerLensAction("temporal", "dataset-import", (ctx, artifact, params) => {
    try {
      const s = getTemporalState();
      if (!s) return { ok: false, error: "State unavailable." };
      const text = String(params?.csv || params?.text || "").trim();
      if (!text) return { ok: false, error: "No CSV / text provided." };
      const name = String(params?.name || "Imported series").trim().slice(0, 120);
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 4) return { ok: false, error: "Need at least 4 rows of data." };

      // Detect a header row (first line has no parseable number).
      const cellsOf = (l) => l.split(/[,;\t]/).map((c) => c.trim());
      const hasNumber = (cells) => cells.some((c) => c !== "" && !isNaN(Number(c)));
      let start = 0;
      let headers = null;
      if (!hasNumber(cellsOf(lines[0]))) { headers = cellsOf(lines[0]); start = 1; }

      const values = [];
      const timestamps = [];
      let anyTs = false;
      for (let i = start; i < lines.length; i++) {
        const cells = cellsOf(lines[i]);
        if (cells.length === 0) continue;
        let val = null;
        let ts = null;
        if (cells.length === 1) {
          val = Number(cells[0]);
        } else {
          // Last numeric cell = value, a date-shaped cell = timestamp.
          for (let c = cells.length - 1; c >= 0; c--) {
            if (cells[c] !== "" && !isNaN(Number(cells[c]))) { val = Number(cells[c]); break; }
          }
          for (const c of cells) {
            if (/\d{4}-\d{1,2}-\d{1,2}/.test(c) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) { ts = c; break; }
          }
        }
        if (val == null || isNaN(val)) continue;
        values.push(val);
        timestamps.push(ts);
        if (ts) anyTs = true;
      }
      if (values.length < 4) return { ok: false, error: "Found fewer than 4 numeric data points." };

      const ds = {
        id: tpId("ds"),
        name,
        values,
        timestamps: anyTs ? timestamps : null,
        headers,
        count: values.length,
        importedAt: tpNow(),
      };
      tpUserList(s, tpAid(ctx)).push(ds);
      saveTemporalState();
      return { ok: true, result: { dataset: ds, imported: values.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * dataset-list — list the caller's stored datasets (without full values).
   */
  registerLensAction("temporal", "dataset-list", (ctx) => {
    try {
      const s = getTemporalState();
      if (!s) return { ok: false, error: "State unavailable." };
      const list = tpUserList(s, tpAid(ctx)).map((d) => ({
        id: d.id, name: d.name, count: d.count,
        hasTimestamps: !!d.timestamps, importedAt: d.importedAt,
        preview: d.values.slice(0, 8),
      }));
      return { ok: true, result: { datasets: list, total: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * dataset-get — return one full stored dataset (values + timestamps).
   */
  registerLensAction("temporal", "dataset-get", (ctx, artifact, params) => {
    try {
      const s = getTemporalState();
      if (!s) return { ok: false, error: "State unavailable." };
      const ds = tpUserList(s, tpAid(ctx)).find((d) => d.id === params?.datasetId);
      if (!ds) return { ok: false, error: "Dataset not found." };
      return { ok: true, result: { dataset: ds } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * dataset-delete — remove a stored dataset.
   */
  registerLensAction("temporal", "dataset-delete", (ctx, artifact, params) => {
    try {
      const s = getTemporalState();
      if (!s) return { ok: false, error: "State unavailable." };
      const list = tpUserList(s, tpAid(ctx));
      const idx = list.findIndex((d) => d.id === params?.datasetId);
      if (idx === -1) return { ok: false, error: "Dataset not found." };
      const [removed] = list.splice(idx, 1);
      saveTemporalState();
      return { ok: true, result: { deleted: removed.id, remaining: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * changepoints
   * Detect structural breaks (mean / slope shifts) in a series — Prophet's
   * core "changepoint" concept. Binary segmentation: recursively split where
   * a fitted-mean split reduces residual sum-of-squares the most, until the
   * gain drops below a penalty threshold (BIC-style).
   * params.datasetId OR params.values; params.maxChangepoints (default 8),
   * params.minSegment (default max(4, n/20)).
   */
  registerLensAction("temporal", "changepoints", (ctx, artifact, params) => {
    try {
      const { values, timestamps, error } = resolveSeries(ctx, artifact, params);
      if (error) return { ok: false, error };
      const n = values.length;
      if (n < 8) return { ok: false, error: "Need at least 8 data points." };
      const maxCp = Math.min(params?.maxChangepoints || 8, Math.floor(n / 4));
      const minSeg = Math.max(params?.minSegment || Math.max(4, Math.floor(n / 20)), 3);

      const cumsum = [0];
      const cumsq = [0];
      for (let i = 0; i < n; i++) {
        cumsum.push(cumsum[i] + values[i]);
        cumsq.push(cumsq[i] + values[i] * values[i]);
      }
      // SSE of segment [a,b) around its own mean.
      const segSSE = (a, b) => {
        const len = b - a;
        if (len <= 0) return 0;
        const sum = cumsum[b] - cumsum[a];
        const sq = cumsq[b] - cumsq[a];
        return sq - (sum * sum) / len;
      };

      // Recursive binary segmentation over a working set of boundaries.
      const bounds = [0, n];
      const totalSSE = segSSE(0, n);
      const penalty = (totalSSE / n) * Math.log(n); // BIC-like per-changepoint cost
      const found = [];
      while (found.length < maxCp) {
        let best = null;
        for (let s2 = 0; s2 < bounds.length - 1; s2++) {
          const a = bounds[s2];
          const b = bounds[s2 + 1];
          if (b - a < 2 * minSeg) continue;
          const baseSSE = segSSE(a, b);
          for (let k = a + minSeg; k <= b - minSeg; k++) {
            const gain = baseSSE - segSSE(a, k) - segSSE(k, b);
            if (gain > 0 && (!best || gain > best.gain)) best = { k, gain, a, b };
          }
        }
        if (!best || best.gain < penalty) break;
        bounds.push(best.k);
        bounds.sort((x, y) => x - y);
        found.push(best.k);
      }
      found.sort((a, b) => a - b);

      // Characterise each changepoint: mean before/after + magnitude.
      const segs = [...new Set([0, ...found, n])].sort((a, b) => a - b);
      const segMeans = [];
      for (let i = 0; i < segs.length - 1; i++) {
        const a = segs[i];
        const b = segs[i + 1];
        segMeans.push(tpRound((cumsum[b] - cumsum[a]) / (b - a)));
      }
      const changepoints = found.map((idx, i) => {
        const before = segMeans[i];
        const after = segMeans[i + 1];
        return {
          index: idx,
          timestamp: timestamps ? timestamps[idx] : undefined,
          meanBefore: before,
          meanAfter: after,
          shift: tpRound(after - before),
          direction: after > before ? "upward" : after < before ? "downward" : "flat",
          relativeShift: before !== 0 ? tpRound((after - before) / Math.abs(before)) : null,
        };
      });

      return {
        ok: true,
        result: {
          n,
          changepointCount: changepoints.length,
          changepoints,
          segmentMeans: segMeans,
          penalty: tpRound(penalty),
          totalVarianceExplained: totalSSE > 0
            ? tpRound(1 - segs.slice(0, -1).reduce((acc, a, i) => acc + segSSE(a, segs[i + 1]), 0) / totalSSE)
            : 0,
          stability: changepoints.length === 0 ? "stable"
            : changepoints.length <= 2 ? "moderate" : "volatile",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * multiSeasonality
   * Detect and quantify multiple seasonal periods (e.g. daily=7, weekly,
   * yearly) in one pass via autocorrelation peak-picking, then decompose
   * the series additively against every detected period.
   * params.datasetId OR params.values; params.candidatePeriods (number[]).
   */
  registerLensAction("temporal", "multiSeasonality", (ctx, artifact, params) => {
    try {
      const { values, error } = resolveSeries(ctx, artifact, params);
      if (error) return { ok: false, error };
      const n = values.length;
      if (n < 12) return { ok: false, error: "Need at least 12 data points." };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const denom = values.reduce((a, v) => a + (v - mean) ** 2, 0) || 1;

      const acf = (lag) => {
        let num = 0;
        for (let i = 0; i < n - lag; i++) num += (values[i] - mean) * (values[i + lag] - mean);
        return num / denom;
      };

      const maxLag = Math.min(Math.floor(n / 2), 400);
      let candidates = Array.isArray(params?.candidatePeriods) && params.candidatePeriods.length
        ? params.candidatePeriods.map(Number).filter((p) => p >= 2 && p <= maxLag)
        : null;
      const acfCurve = [];
      for (let lag = 2; lag <= maxLag; lag++) acfCurve.push({ lag, acf: tpRound(acf(lag)) });

      if (!candidates) {
        // Local-maximum peaks above a significance band.
        const sig = 2 / Math.sqrt(n);
        const peaks = [];
        for (let i = 1; i < acfCurve.length - 1; i++) {
          const c = acfCurve[i];
          if (c.acf > sig && c.acf > acfCurve[i - 1].acf && c.acf >= acfCurve[i + 1].acf) {
            peaks.push(c);
          }
        }
        peaks.sort((a, b) => b.acf - a.acf);
        candidates = peaks.slice(0, 4).map((p) => p.lag).sort((a, b) => a - b);
      }
      if (candidates.length === 0) {
        return {
          ok: true,
          result: { n, seasonalities: [], dominant: null, note: "No significant seasonality detected." },
        };
      }

      // Iterative additive decomposition: subtract each seasonal mean profile.
      let residual = values.slice();
      const seasonalities = [];
      for (const period of candidates) {
        const profile = new Array(period).fill(0);
        const counts = new Array(period).fill(0);
        for (let i = 0; i < n; i++) { profile[i % period] += residual[i]; counts[i % period]++; }
        for (let i = 0; i < period; i++) profile[i] = counts[i] ? profile[i] / counts[i] : 0;
        const pMean = profile.reduce((a, b) => a + b, 0) / period;
        for (let i = 0; i < period; i++) profile[i] -= pMean;
        const component = values.map((_, i) => profile[i % period]);
        const compVar = component.reduce((a, v) => a + v * v, 0) / n;
        const strength = denom > 0 ? Math.min(1, (compVar * n) / denom) : 0;
        residual = residual.map((v, i) => v - component[i]);
        seasonalities.push({
          period,
          acf: tpRound(acf(period)),
          profile: profile.map(tpRound),
          varianceShare: tpRound(strength),
          strengthLabel: strength > 0.5 ? "strong" : strength > 0.2 ? "moderate" : "weak",
          amplitude: tpRound(Math.max(...profile) - Math.min(...profile)),
        });
      }
      seasonalities.sort((a, b) => b.varianceShare - a.varianceShare);
      const residVar = residual.reduce((a, v) => a + v * v, 0) / n;

      return {
        ok: true,
        result: {
          n,
          seasonalities,
          dominant: seasonalities[0] || null,
          residualVariance: tpRound(residVar),
          totalSeasonalShare: tpRound(seasonalities.reduce((a, s) => a + s.varianceShare, 0)),
          acfCurve: acfCurve.slice(0, 120),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * holidayForecast
   * Forecast with explicit calendar holiday / event effects layered onto a
   * Holt seasonal model — the second pillar of Prophet.
   * params.values + params.timestamps (or datasetId), params.horizon,
   * params.holidays = [{ name, index | date, window? }] additive overrides.
   */
  registerLensAction("temporal", "holidayForecast", (ctx, artifact, params) => {
    try {
      const { values, timestamps, error } = resolveSeries(ctx, artifact, params);
      if (error) return { ok: false, error };
      const n = values.length;
      if (n < 6) return { ok: false, error: "Need at least 6 data points." };
      const horizon = Math.max(1, Math.min(params?.horizon || Math.floor(n * 0.25), 365));
      const period = Math.max(0, Math.min(params?.period || 0, Math.floor(n / 2)));
      const useSeasonal = period >= 2 && n >= period * 2;

      // --- Map holidays to series indices ---
      const tsIndex = new Map();
      if (timestamps) timestamps.forEach((t, i) => { if (t) tsIndex.set(String(t).slice(0, 10), i); });
      const holidays = (Array.isArray(params?.holidays) ? params.holidays : []).map((h) => {
        let idx = Number.isFinite(h.index) ? h.index
          : (h.date && tsIndex.has(String(h.date).slice(0, 10)) ? tsIndex.get(String(h.date).slice(0, 10)) : null);
        return { name: String(h.name || "holiday"), index: idx, window: Math.max(0, Number(h.window) || 0), date: h.date || null };
      });

      // --- Estimate each holiday effect = observed minus local baseline ---
      const baseline = (i) => {
        const a = Math.max(0, i - 3);
        const b = Math.min(n, i + 4);
        let sum = 0;
        let c = 0;
        for (let j = a; j < b; j++) { if (j !== i) { sum += values[j]; c++; } }
        return c ? sum / c : values[i];
      };
      const holidayEffects = [];
      for (const h of holidays) {
        if (h.index == null || h.index < 0 || h.index >= n) {
          holidayEffects.push({ name: h.name, date: h.date, effect: 0, observed: false });
          continue;
        }
        let effSum = 0;
        let effCount = 0;
        for (let d = -h.window; d <= h.window; d++) {
          const j = h.index + d;
          if (j >= 0 && j < n) { effSum += values[j] - baseline(j); effCount++; }
        }
        holidayEffects.push({
          name: h.name, date: h.date, index: h.index, window: h.window,
          effect: tpRound(effCount ? effSum / effCount : 0), observed: true,
        });
      }

      // --- Deseasonalise observed holiday points, then fit Holt on the clean series ---
      const clean = values.slice();
      for (const h of holidayEffects) {
        if (!h.observed) continue;
        for (let d = -(h.window || 0); d <= (h.window || 0); d++) {
          const j = h.index + d;
          if (j >= 0 && j < n) clean[j] -= h.effect;
        }
      }

      const alpha = 0.4;
      const beta = 0.15;
      const gamma = 0.2;
      const level = [clean[0]];
      const trend = [clean.length > 1 ? clean[1] - clean[0] : 0];
      const season = new Array(n + horizon).fill(0);
      if (useSeasonal) {
        const fpMean = clean.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = 0; i < period; i++) season[i] = clean[i] - fpMean;
        level[0] = fpMean;
      }
      for (let i = 1; i < n; i++) {
        const sIdx = useSeasonal ? clean[i] - season[i % period] : clean[i];
        level[i] = alpha * sIdx + (1 - alpha) * (level[i - 1] + trend[i - 1]);
        trend[i] = beta * (level[i] - level[i - 1]) + (1 - beta) * trend[i - 1];
        if (useSeasonal) season[i + period] = gamma * (clean[i] - level[i]) + (1 - gamma) * season[i % period];
      }

      // In-sample residual std for intervals.
      let sse = 0;
      for (let i = 1; i < n; i++) {
        const fit = level[i - 1] + trend[i - 1] + (useSeasonal ? season[i % period] : 0);
        sse += (clean[i] - fit) ** 2;
      }
      const resStd = Math.sqrt(sse / Math.max(1, n - 1));

      // Future holidays (index >= n) re-applied additively to forecasts.
      const futureHoliday = new Array(horizon).fill(0);
      for (const h of holidays) {
        if (h.index != null && h.index >= n && h.index < n + horizon) {
          for (let d = -h.window; d <= h.window; d++) {
            const off = h.index + d - n;
            if (off >= 0 && off < horizon) {
              const matched = holidayEffects.find((e) => e.name === h.name && e.observed);
              futureHoliday[off] += matched ? matched.effect : 0;
            }
          }
        }
      }

      const predictions = [];
      for (let hh = 1; hh <= horizon; hh++) {
        const seasComp = useSeasonal ? season[(n - 1 + hh)] : 0;
        const base = level[n - 1] + hh * trend[n - 1] + seasComp;
        const fc = base + futureHoliday[hh - 1];
        const width = resStd * Math.sqrt(hh) * 1.96;
        predictions.push({
          step: hh,
          forecast: tpRound(fc),
          baseline: tpRound(base),
          holidayEffect: tpRound(futureHoliday[hh - 1]),
          lower95: tpRound(fc - width),
          upper95: tpRound(fc + width),
        });
      }

      return {
        ok: true,
        result: {
          n,
          horizon,
          method: useSeasonal ? "holt-seasonal+holidays" : "holt+holidays",
          holidayEffects,
          predictions,
          residualStd: tpRound(resStd),
          trendPerPeriod: tpRound(trend[n - 1]),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * backtest
   * Hold-out accuracy comparison across forecasting models — Tableau-style
   * model evaluation. Trains on the first (1-testFraction) of the series,
   * forecasts the held-out tail, reports MAE / RMSE / MAPE per model.
   * params.datasetId OR params.values; params.testFraction (default 0.2).
   */
  registerLensAction("temporal", "backtest", (ctx, artifact, params) => {
    try {
      const { values, error } = resolveSeries(ctx, artifact, params);
      if (error) return { ok: false, error };
      const n = values.length;
      if (n < 12) return { ok: false, error: "Need at least 12 data points to backtest." };
      const testFrac = Math.min(Math.max(params?.testFraction || 0.2, 0.1), 0.5);
      const testLen = Math.max(2, Math.round(n * testFrac));
      const trainLen = n - testLen;
      const train = values.slice(0, trainLen);
      const test = values.slice(trainLen);
      const period = Math.max(0, Math.min(params?.period || 0, Math.floor(trainLen / 2)));

      // --- candidate models, each returns horizon-length forecasts from train ---
      const models = {};
      // Naive (last value carried forward).
      models.naive = () => new Array(testLen).fill(train[trainLen - 1]);
      // Drift (linear extrapolation of overall slope).
      models.drift = () => {
        const slope = (train[trainLen - 1] - train[0]) / Math.max(1, trainLen - 1);
        return Array.from({ length: testLen }, (_, h) => train[trainLen - 1] + (h + 1) * slope);
      };
      // Moving average.
      models.movingAverage = () => {
        const w = Math.max(2, Math.min(period || Math.floor(trainLen / 4), trainLen));
        const avg = train.slice(trainLen - w).reduce((a, b) => a + b, 0) / w;
        return new Array(testLen).fill(avg);
      };
      // Holt double-exponential smoothing.
      models.holt = () => {
        const alpha = 0.4;
        const beta = 0.15;
        let lvl = train[0];
        let trd = trainLen > 1 ? train[1] - train[0] : 0;
        for (let i = 1; i < trainLen; i++) {
          const pl = lvl;
          lvl = alpha * train[i] + (1 - alpha) * (lvl + trd);
          trd = beta * (lvl - pl) + (1 - beta) * trd;
        }
        return Array.from({ length: testLen }, (_, h) => lvl + (h + 1) * trd);
      };
      // Seasonal naive (only if a period is known and fits).
      if (period >= 2 && trainLen >= period) {
        models.seasonalNaive = () => Array.from({ length: testLen }, (_, h) => train[trainLen - period + (h % period)]);
      }

      const metricsFor = (forecast) => {
        let ae = 0;
        let se = 0;
        let ape = 0;
        let apeC = 0;
        for (let i = 0; i < testLen; i++) {
          const err = test[i] - forecast[i];
          ae += Math.abs(err);
          se += err * err;
          if (test[i] !== 0) { ape += Math.abs(err / test[i]); apeC++; }
        }
        return {
          mae: tpRound(ae / testLen),
          rmse: tpRound(Math.sqrt(se / testLen)),
          mape: tpRound(apeC ? (ape / apeC) * 100 : 0),
        };
      };

      const results = Object.entries(models).map(([name, fn]) => {
        const forecast = fn().map(tpRound);
        return { model: name, forecast, ...metricsFor(forecast) };
      });
      results.sort((a, b) => a.rmse - b.rmse);
      const best = results[0];

      return {
        ok: true,
        result: {
          n,
          trainLength: trainLen,
          testLength: testLen,
          testFraction: tpRound(testFrac),
          actual: test.map(tpRound),
          models: results,
          bestModel: best ? best.model : null,
          bestRmse: best ? best.rmse : null,
          ranking: results.map((r) => r.model),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * crossCorrelation
   * Cross-series correlation and lead/lag analysis between two series —
   * "does A lead B, and by how much?".
   * params.seriesA + params.seriesB (number[]), OR datasetIdA + datasetIdB.
   * params.maxLag (default min(20, n/3)).
   */
  registerLensAction("temporal", "crossCorrelation", (ctx, artifact, params) => {
    try {
      const s = getTemporalState();
      const pick = (inline, dsId) => {
        if (Array.isArray(inline) && inline.length) return inline.map(Number).filter((v) => !isNaN(v));
        if (dsId && s) {
          const ds = tpUserList(s, tpAid(ctx)).find((d) => d.id === dsId);
          if (ds) return ds.values.slice();
        }
        return null;
      };
      const a = pick(params?.seriesA, params?.datasetIdA);
      const b = pick(params?.seriesB, params?.datasetIdB);
      if (!a || !b) return { ok: false, error: "Two series required (seriesA/seriesB or datasetIdA/datasetIdB)." };
      const n = Math.min(a.length, b.length);
      if (n < 6) return { ok: false, error: "Need at least 6 overlapping points." };
      const A = a.slice(0, n);
      const B = b.slice(0, n);
      const maxLag = Math.min(params?.maxLag || Math.floor(n / 3), Math.floor(n / 2), 60);

      const meanA = A.reduce((x, y) => x + y, 0) / n;
      const meanB = B.reduce((x, y) => x + y, 0) / n;
      const sdA = Math.sqrt(A.reduce((x, v) => x + (v - meanA) ** 2, 0) / n) || 1e-9;
      const sdB = Math.sqrt(B.reduce((x, v) => x + (v - meanB) ** 2, 0) / n) || 1e-9;

      // ccf(lag): correlation of A[i] with B[i+lag]. lag>0 => A leads B.
      const ccf = [];
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < n; i++) {
          const j = i + lag;
          if (j >= 0 && j < n) { sum += (A[i] - meanA) * (B[j] - meanB); count++; }
        }
        const corr = count > 0 ? (sum / count) / (sdA * sdB) : 0;
        ccf.push({ lag, correlation: tpRound(corr) });
      }
      const contemporaneous = ccf.find((c) => c.lag === 0)?.correlation ?? 0;
      let peak = ccf[0];
      for (const c of ccf) if (Math.abs(c.correlation) > Math.abs(peak.correlation)) peak = c;

      return {
        ok: true,
        result: {
          n,
          maxLag,
          ccf,
          contemporaneousCorrelation: tpRound(contemporaneous),
          peakCorrelation: tpRound(peak.correlation),
          optimalLag: peak.lag,
          relationship: peak.lag > 0 ? "A leads B"
            : peak.lag < 0 ? "B leads A" : "synchronous",
          leadPeriods: Math.abs(peak.lag),
          strengthLabel: Math.abs(peak.correlation) > 0.7 ? "strong"
            : Math.abs(peak.correlation) > 0.4 ? "moderate"
              : Math.abs(peak.correlation) > 0.2 ? "weak" : "negligible",
          direction: peak.correlation >= 0 ? "positive" : "negative",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * timeSeriesDecompose
   * Decompose time series into trend, seasonality, and residual components.
   * artifact.data.series = [{ timestamp?, value }] or artifact.data.values = number[]
   * params.period (seasonal period, auto-detected if omitted)
   */
  registerLensAction("temporal", "timeSeriesDecompose", (ctx, artifact, params) => {
    const resolved = resolveSeries(ctx, artifact, params);
    if (resolved.error) return { ok: false, error: resolved.error };
    const values = resolved.values;
    if (values.length < 4) return { ok: false, error: "Need at least 4 data points." };

    const n = values.length;
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // --- Trend extraction via centered moving average ---
    // Auto-detect period via autocorrelation if not specified
    let period = params.period || null;
    if (!period) {
      const mean = values.reduce((s, v) => s + v, 0) / n;
      const maxLag = Math.min(Math.floor(n / 2), 100);
      let bestLag = 1;
      let bestAcf = -Infinity;
      const denom = values.reduce((s, v) => s + (v - mean) ** 2, 0);

      for (let lag = 2; lag <= maxLag; lag++) {
        let num = 0;
        for (let i = 0; i < n - lag; i++) {
          num += (values[i] - mean) * (values[i + lag] - mean);
        }
        const acf = denom > 0 ? num / denom : 0;
        // Find first significant peak after lag=1
        if (lag > 1 && acf > bestAcf && acf > 0.2) {
          // Check it's a local peak
          let numPrev = 0;
          for (let i = 0; i < n - (lag - 1); i++) {
            numPrev += (values[i] - mean) * (values[i + lag - 1] - mean);
          }
          const prevAcf = denom > 0 ? numPrev / denom : 0;
          if (acf > prevAcf) {
            bestAcf = acf;
            bestLag = lag;
          }
        }
      }
      period = bestLag;
    }
    period = Math.max(2, Math.min(period, Math.floor(n / 2)));

    // Centered moving average for trend
    const trend = new Array(n).fill(null);
    const halfWin = Math.floor(period / 2);
    for (let i = halfWin; i < n - halfWin; i++) {
      let sum = 0;
      let count = 0;
      for (let j = i - halfWin; j <= i + halfWin; j++) {
        if (j >= 0 && j < n) { sum += values[j]; count++; }
      }
      trend[i] = sum / count;
    }
    // Extend trend to edges using linear extrapolation
    const firstTrend = trend.findIndex(v => v !== null);
    const lastTrend = trend.length - 1 - [...trend].reverse().findIndex(v => v !== null);
    if (firstTrend > 0 && firstTrend < lastTrend) {
      const slope = (trend[firstTrend + 1] - trend[firstTrend]);
      for (let i = firstTrend - 1; i >= 0; i--) trend[i] = trend[i + 1] - slope;
    }
    if (lastTrend < n - 1 && lastTrend > firstTrend) {
      const slope = (trend[lastTrend] - trend[lastTrend - 1]);
      for (let i = lastTrend + 1; i < n; i++) trend[i] = trend[i - 1] + slope;
    }

    // --- Seasonality: average of detrended values at each position in the period ---
    const detrended = values.map((v, i) => v - (trend[i] ?? v));
    const seasonalPattern = new Array(period).fill(0);
    const seasonalCounts = new Array(period).fill(0);
    for (let i = 0; i < n; i++) {
      const pos = i % period;
      seasonalPattern[pos] += detrended[i];
      seasonalCounts[pos]++;
    }
    for (let i = 0; i < period; i++) {
      seasonalPattern[i] = seasonalCounts[i] > 0 ? seasonalPattern[i] / seasonalCounts[i] : 0;
    }
    // Center seasonal pattern (subtract mean)
    const seasonalMean = seasonalPattern.reduce((s, v) => s + v, 0) / period;
    for (let i = 0; i < period; i++) seasonalPattern[i] -= seasonalMean;

    // Full seasonal component
    const seasonal = values.map((_, i) => seasonalPattern[i % period]);

    // --- Residual ---
    const residual = values.map((v, i) => v - (trend[i] ?? v) - seasonal[i]);

    // Strength of components
    const varTotal = (() => {
      const m = values.reduce((s, v) => s + v, 0) / n;
      return values.reduce((s, v) => s + (v - m) ** 2, 0) / n;
    })();
    const varTrend = (() => {
      const validTrend = trend.filter(v => v !== null);
      if (validTrend.length === 0) return 0;
      const m = validTrend.reduce((s, v) => s + v, 0) / validTrend.length;
      return validTrend.reduce((s, v) => s + (v - m) ** 2, 0) / validTrend.length;
    })();
    const varSeasonal = seasonal.reduce((s, v) => s + v * v, 0) / n;
    const varResidual = residual.reduce((s, v) => s + v * v, 0) / n;

    const trendStrength = varTotal > 0 ? Math.max(0, 1 - varResidual / (varTotal - varSeasonal || 1)) : 0;
    const seasonalStrength = varTotal > 0 ? Math.max(0, 1 - varResidual / (varTotal - varTrend || 1)) : 0;

    return {
      ok: true,
      result: {
        n,
        detectedPeriod: period,
        trend: trend.map(v => r(v ?? 0)),
        seasonalPattern: seasonalPattern.map(r),
        seasonal: seasonal.map(r),
        residual: residual.map(r),
        strength: {
          trend: r(Math.min(1, Math.max(0, trendStrength))),
          seasonal: r(Math.min(1, Math.max(0, seasonalStrength))),
          trendLabel: trendStrength > 0.7 ? "strong" : trendStrength > 0.3 ? "moderate" : "weak",
          seasonalLabel: seasonalStrength > 0.7 ? "strong" : seasonalStrength > 0.3 ? "moderate" : "weak",
        },
        variance: { total: r(varTotal), trend: r(varTrend), seasonal: r(varSeasonal), residual: r(varResidual) },
      },
    };
  });

  /**
   * anomalyDetection
   * Detect temporal anomalies using Z-score with sliding window and IQR method.
   * artifact.data.values = number[] or artifact.data.series = [{ timestamp?, value }]
   * params.windowSize (default: auto), params.threshold (z-score threshold, default: 2.5)
   */
  registerLensAction("temporal", "anomalyDetection", (ctx, artifact, params) => {
    const resolved = resolveSeries(ctx, artifact, params);
    if (resolved.error) return { ok: false, error: resolved.error };
    const values = resolved.values;
    const timestamps = resolved.timestamps;
    if (values.length < 5) return { ok: false, error: "Need at least 5 data points." };

    const n = values.length;
    const threshold = params.threshold || 2.5;
    const windowSize = params.windowSize || Math.max(5, Math.floor(n / 10));
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // --- Method 1: Z-score with sliding window ---
    const zScoreAnomalies = [];
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(n, i + Math.ceil(windowSize / 2));
      const window = values.slice(start, end);
      const wMean = window.reduce((s, v) => s + v, 0) / window.length;
      const wStd = Math.sqrt(window.reduce((s, v) => s + (v - wMean) ** 2, 0) / window.length);
      const zScore = wStd > 0 ? Math.abs(values[i] - wMean) / wStd : 0;
      if (zScore > threshold) {
        zScoreAnomalies.push({
          index: i,
          value: values[i],
          zScore: r(zScore),
          windowMean: r(wMean),
          windowStd: r(wStd),
          direction: values[i] > wMean ? "above" : "below",
          timestamp: timestamps ? timestamps[i] : undefined,
        });
      }
    }

    // --- Method 2: IQR method (global) ---
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const extremeLower = q1 - 3 * iqr;
    const extremeUpper = q3 + 3 * iqr;

    const iqrAnomalies = [];
    for (let i = 0; i < n; i++) {
      if (values[i] < lowerFence || values[i] > upperFence) {
        iqrAnomalies.push({
          index: i,
          value: values[i],
          severity: values[i] < extremeLower || values[i] > extremeUpper ? "extreme" : "mild",
          direction: values[i] > upperFence ? "above" : "below",
          timestamp: timestamps ? timestamps[i] : undefined,
        });
      }
    }

    // --- Consecutive anomaly clustering ---
    // Group anomalies that occur in consecutive runs
    const allAnomalyIndices = new Set([
      ...zScoreAnomalies.map(a => a.index),
      ...iqrAnomalies.map(a => a.index),
    ]);
    const sortedIndices = [...allAnomalyIndices].sort((a, b) => a - b);
    const clusters = [];
    if (sortedIndices.length > 0) {
      let clusterStart = sortedIndices[0];
      let clusterEnd = sortedIndices[0];
      for (let i = 1; i < sortedIndices.length; i++) {
        if (sortedIndices[i] - sortedIndices[i - 1] <= 2) {
          clusterEnd = sortedIndices[i];
        } else {
          clusters.push({ startIndex: clusterStart, endIndex: clusterEnd, length: clusterEnd - clusterStart + 1 });
          clusterStart = sortedIndices[i];
          clusterEnd = sortedIndices[i];
        }
      }
      clusters.push({ startIndex: clusterStart, endIndex: clusterEnd, length: clusterEnd - clusterStart + 1 });
    }

    // Compute consensus anomalies (detected by both methods)
    const iqrSet = new Set(iqrAnomalies.map(a => a.index));
    const consensus = zScoreAnomalies.filter(a => iqrSet.has(a.index)).map(a => ({
      index: a.index,
      value: a.value,
      zScore: a.zScore,
      timestamp: a.timestamp,
    }));

    // Overall anomaly rate
    const anomalyRate = allAnomalyIndices.size / n;

    return {
      ok: true,
      result: {
        n,
        windowSize,
        zScoreThreshold: threshold,
        zScoreAnomalies: zScoreAnomalies.slice(0, 50),
        zScoreCount: zScoreAnomalies.length,
        iqrAnomalies: iqrAnomalies.slice(0, 50),
        iqrCount: iqrAnomalies.length,
        iqrBounds: { q1: r(q1), q3: r(q3), iqr: r(iqr), lowerFence: r(lowerFence), upperFence: r(upperFence) },
        consensusAnomalies: consensus,
        consensusCount: consensus.length,
        anomalyClusters: clusters,
        longestCluster: clusters.length > 0 ? Math.max(...clusters.map(c => c.length)) : 0,
        anomalyRate: r(anomalyRate),
        anomalyRateLabel: anomalyRate > 0.1 ? "high" : anomalyRate > 0.03 ? "moderate" : "low",
      },
    };
  });

  /**
   * forecast
   * Simple forecasting using exponential smoothing (Holt-Winters additive method).
   * artifact.data.values = number[] or artifact.data.series = [{ value }]
   * params.horizon (number of periods to forecast, default: 10)
   * params.period (seasonal period, default: auto or no seasonality)
   * params.alpha, params.beta, params.gamma (smoothing parameters, default: auto-tuned)
   */
  registerLensAction("temporal", "forecast", (ctx, artifact, params) => {
    const resolved = resolveSeries(ctx, artifact, params);
    if (resolved.error) return { ok: false, error: resolved.error };
    const values = resolved.values;
    if (values.length < 4) return { ok: false, error: "Need at least 4 data points." };

    const n = values.length;
    const horizon = params.horizon || Math.max(1, Math.floor(n * 0.2));
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // Determine if we should use seasonal model
    const period = params.period || 0;
    const useSeasonal = period >= 2 && n >= period * 2;

    // --- Auto-tune parameters using grid search to minimize MSE ---
    function holtwinters(alpha, beta, gamma) {
      const level = new Array(n).fill(0);
      const trend = new Array(n).fill(0);
      const season = new Array(n + horizon).fill(0);

      if (useSeasonal) {
        // Initialize seasonal indices from first period
        const firstPeriodMean = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
        for (let i = 0; i < period; i++) {
          season[i] = values[i] - firstPeriodMean;
        }
        level[0] = firstPeriodMean;
        trend[0] = (values[period] !== undefined)
          ? (values.slice(period, period * 2).reduce((s, v) => s + v, 0) / period - firstPeriodMean) / period
          : 0;

        for (let i = 1; i < n; i++) {
          level[i] = alpha * (values[i] - season[i % period]) + (1 - alpha) * (level[i - 1] + trend[i - 1]);
          trend[i] = beta * (level[i] - level[i - 1]) + (1 - beta) * trend[i - 1];
          season[i + period] = gamma * (values[i] - level[i]) + (1 - gamma) * season[i % period];
        }
      } else {
        // Holt's double exponential (no seasonality)
        level[0] = values[0];
        trend[0] = values.length > 1 ? values[1] - values[0] : 0;

        for (let i = 1; i < n; i++) {
          level[i] = alpha * values[i] + (1 - alpha) * (level[i - 1] + trend[i - 1]);
          trend[i] = beta * (level[i] - level[i - 1]) + (1 - beta) * trend[i - 1];
        }
      }

      // Compute in-sample MSE
      let mse = 0;
      for (let i = 1; i < n; i++) {
        const fitted = useSeasonal
          ? level[i - 1] + trend[i - 1] + season[i % period]
          : level[i - 1] + trend[i - 1];
        mse += (values[i] - fitted) ** 2;
      }
      mse /= (n - 1);

      // Generate forecasts
      const forecasts = [];
      for (let h = 1; h <= horizon; h++) {
        const fc = useSeasonal
          ? level[n - 1] + h * trend[n - 1] + season[(n - 1 + h) % period + (n - 1 + h >= period ? period : 0)]
          : level[n - 1] + h * trend[n - 1];
        forecasts.push(fc);
      }

      return { mse, forecasts, lastLevel: level[n - 1], lastTrend: trend[n - 1] };
    }

    // Grid search for best parameters
    let bestAlpha = params.alpha || 0.3;
    let bestBeta = params.beta || 0.1;
    let bestGamma = params.gamma || 0.1;
    let bestMSE = Infinity;

    if (!params.alpha || !params.beta) {
      const grid = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
      const gammaGrid = useSeasonal ? [0.05, 0.1, 0.3, 0.5] : [0];
      for (const a of grid) {
        for (const b of grid) {
          for (const g of gammaGrid) {
            const result = holtwinters(a, b, g);
            if (result.mse < bestMSE) {
              bestMSE = result.mse;
              bestAlpha = a;
              bestBeta = b;
              bestGamma = g;
            }
          }
        }
      }
    }

    const best = holtwinters(bestAlpha, bestBeta, bestGamma);

    // Compute prediction intervals (based on residual standard deviation)
    const residualStd = Math.sqrt(best.mse);
    const predictions = best.forecasts.map((fc, i) => {
      const h = i + 1;
      // Prediction interval widens with horizon
      const intervalWidth = residualStd * Math.sqrt(h) * 1.96;
      return {
        step: h,
        forecast: r(fc),
        lower95: r(fc - intervalWidth),
        upper95: r(fc + intervalWidth),
        lower80: r(fc - residualStd * Math.sqrt(h) * 1.28),
        upper80: r(fc + residualStd * Math.sqrt(h) * 1.28),
      };
    });

    // Trend extrapolation summary
    const trendDirection = best.lastTrend > 0.001 ? "increasing" : best.lastTrend < -0.001 ? "decreasing" : "flat";
    const trendPerPeriod = best.lastTrend;

    // Fitted values and MAPE
    const fitted = [];
    let mapeSum = 0;
    let mapeCount = 0;
    const lvl = [values[0]];
    const trn = [values.length > 1 ? values[1] - values[0] : 0];
    for (let i = 1; i < n; i++) {
      lvl[i] = bestAlpha * values[i] + (1 - bestAlpha) * (lvl[i - 1] + trn[i - 1]);
      trn[i] = bestBeta * (lvl[i] - lvl[i - 1]) + (1 - bestBeta) * trn[i - 1];
      const fv = lvl[i - 1] + trn[i - 1];
      fitted.push(r(fv));
      if (values[i] !== 0) {
        mapeSum += Math.abs((values[i] - fv) / values[i]);
        mapeCount++;
      }
    }
    const mape = mapeCount > 0 ? (mapeSum / mapeCount) * 100 : 0;

    return {
      ok: true,
      result: {
        n,
        horizon,
        method: useSeasonal ? "holt-winters-additive" : "holt-double-exponential",
        parameters: { alpha: bestAlpha, beta: bestBeta, gamma: useSeasonal ? bestGamma : null },
        period: useSeasonal ? period : null,
        predictions,
        trend: { direction: trendDirection, perPeriod: r(trendPerPeriod), lastLevel: r(best.lastLevel) },
        accuracy: { mse: r(best.mse), rmse: r(residualStd), mape: r(mape) + "%" },
        accuracyLabel: mape < 5 ? "excellent" : mape < 15 ? "good" : mape < 30 ? "moderate" : "poor",
      },
    };
  });
}
