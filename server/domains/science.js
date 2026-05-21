import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

export default function registerScienceActions(registerLensAction) {
  registerLensAction("science", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("science");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  registerLensAction("science", "chainOfCustody", (ctx, artifact, _params) => {
    const custodyLog = artifact.data?.chainOfCustody || [];
    let intact = true;
    const gaps = [];
    for (let i = 1; i < custodyLog.length; i++) {
      const prev = custodyLog[i - 1];
      const curr = custodyLog[i];
      if (prev.transferredTo !== curr.receivedBy) {
        intact = false;
        gaps.push({ position: i, expected: prev.transferredTo, actual: curr.receivedBy, date: curr.date });
      }
    }
    return { ok: true, result: { sampleId: artifact.id, sample: artifact.title, intact, transfers: custodyLog.length, gaps, verifiedAt: new Date().toISOString() } };
  });

  registerLensAction("science", "calibrationCheck", (ctx, artifact, _params) => {
    const _calibrationDate = artifact.data?.calibrationDate ? new Date(artifact.data.calibrationDate) : null;
    const nextCalibration = artifact.data?.nextCalibration ? new Date(artifact.data.nextCalibration) : null;
    const now = new Date();
    let status = 'unknown';
    let daysUntilDue = null;
    if (nextCalibration) {
      daysUntilDue = Math.ceil((nextCalibration - now) / (1000 * 60 * 60 * 24));
      status = daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 14 ? 'due_soon' : 'current';
    }
    return { ok: true, result: { equipment: artifact.title, serial: artifact.data?.serial, lastCalibration: artifact.data?.calibrationDate, nextCalibration: artifact.data?.nextCalibration, status, daysUntilDue } };
  });

  registerLensAction("science", "dataQualityReport", (ctx, artifact, _params) => {
    const dataset = artifact.data?.dataset || artifact.data?.observations || artifact.data?.records || [];
    if (dataset.length === 0) return { ok: true, result: { error: 'No dataset found', totalRecords: 0 } };

    const fields = Object.keys(dataset[0] || {});
    const fieldStats = {};

    for (const field of fields) {
      const values = dataset.map(r => r[field]);
      const nonNull = values.filter(v => v != null && v !== '' && v !== undefined);
      const missing = values.length - nonNull.length;
      const completeness = Math.round((nonNull.length / values.length) * 10000) / 100;

      const stat = { field, total: values.length, present: nonNull.length, missing, completeness };

      // Numeric stats
      const nums = nonNull.map(Number).filter(n => !isNaN(n));
      if (nums.length > 0) {
        nums.sort((a, b) => a - b);
        const sum = nums.reduce((s, n) => s + n, 0);
        const mean = sum / nums.length;
        const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
        const stdDev = Math.sqrt(variance);
        const q1 = nums[Math.floor(nums.length * 0.25)];
        const median = nums[Math.floor(nums.length * 0.5)];
        const q3 = nums[Math.floor(nums.length * 0.75)];
        const iqr = q3 - q1;
        const outliers = nums.filter(n => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr);
        stat.numeric = {
          min: nums[0],
          max: nums[nums.length - 1],
          mean: Math.round(mean * 1000) / 1000,
          median,
          stdDev: Math.round(stdDev * 1000) / 1000,
          q1, q3,
          outlierCount: outliers.length,
        };
      }

      fieldStats[field] = stat;
    }

    const overallCompleteness = fields.length > 0
      ? Math.round(Object.values(fieldStats).reduce((s, f) => s + f.completeness, 0) / fields.length * 100) / 100
      : 100;

    return {
      ok: true,
      result: {
        analyzedAt: new Date().toISOString(),
        totalRecords: dataset.length,
        totalFields: fields.length,
        overallCompleteness,
        fieldStats,
        qualityRating: overallCompleteness >= 95 ? 'excellent' : overallCompleteness >= 80 ? 'good' : overallCompleteness >= 60 ? 'fair' : 'poor',
      },
    };
  });

  registerLensAction("science", "sampleAudit", (ctx, artifact, _params) => {
    const samples = artifact.data?.samples || [artifact.data];
    const now = new Date();
    const results = [];

    for (const sample of samples) {
      const issues = [];

      // Chain of custody
      const custody = sample.chainOfCustody || [];
      let custodyIntact = true;
      for (let i = 1; i < custody.length; i++) {
        if (custody[i - 1].transferredTo !== custody[i].receivedBy) {
          custodyIntact = false;
          issues.push({ type: 'custody_gap', position: i, expected: custody[i - 1].transferredTo, actual: custody[i].receivedBy });
        }
      }

      // Storage conditions
      const storage = sample.storage || sample.storageConditions || {};
      const requiredTemp = storage.requiredTemp || storage.requiredTemperature || null;
      const actualTemp = storage.actualTemp || storage.currentTemperature || null;
      if (requiredTemp != null && actualTemp != null) {
        const tolerance = storage.tolerance || 2;
        if (Math.abs(actualTemp - requiredTemp) > tolerance) {
          issues.push({ type: 'temperature_deviation', required: requiredTemp, actual: actualTemp, tolerance });
        }
      }

      // Expiry
      const expiryDate = sample.expiryDate ? new Date(sample.expiryDate) : null;
      if (expiryDate && expiryDate < now) {
        issues.push({ type: 'expired', expiryDate: sample.expiryDate, daysExpired: Math.floor((now - expiryDate) / 86400000) });
      }

      // Handling compliance
      const handling = sample.handling || {};
      if (handling.requiresGloves && !handling.glovesUsed) issues.push({ type: 'handling', detail: 'Gloves required but not documented' });
      if (handling.requiresSterile && !handling.sterileConfirmed) issues.push({ type: 'handling', detail: 'Sterile handling required but not confirmed' });

      results.push({
        sampleId: sample.sampleId || sample.id,
        name: sample.name || sample.label || '',
        custodyIntact,
        custodyTransfers: custody.length,
        storageCompliant: !issues.some(i => i.type === 'temperature_deviation'),
        expired: !!issues.find(i => i.type === 'expired'),
        issueCount: issues.length,
        issues,
        status: issues.length === 0 ? 'compliant' : 'non-compliant',
      });
    }

    return {
      ok: true,
      result: {
        auditedAt: new Date().toISOString(),
        totalSamples: results.length,
        compliant: results.filter(r => r.status === 'compliant').length,
        nonCompliant: results.filter(r => r.status !== 'compliant').length,
        samples: results,
      },
    };
  });

  registerLensAction("science", "validateProtocol", (ctx, artifact, _params) => {
    const protocol = artifact.data?.protocol || artifact.data || {};
    const steps = protocol.steps || [];
    const issues = [];

    // Required steps check
    const requiredSteps = ['preparation', 'execution', 'data_collection', 'cleanup'];
    const stepNames = steps.map(s => (s.name || s.step || '').toLowerCase().replace(/\s+/g, '_'));
    for (const req of requiredSteps) {
      if (!stepNames.some(n => n.includes(req))) {
        issues.push({ type: 'missing_step', step: req, severity: 'high' });
      }
    }

    // Safety checks
    const safetyChecks = protocol.safetyChecks || protocol.safety || [];
    if (safetyChecks.length === 0 && steps.length > 0) {
      issues.push({ type: 'safety', detail: 'No safety checks defined', severity: 'high' });
    }
    const incompleteSafety = safetyChecks.filter(sc => !sc.verified && !sc.completed);
    if (incompleteSafety.length > 0) {
      issues.push({ type: 'safety', detail: `${incompleteSafety.length} safety check(s) not verified`, severity: 'medium' });
    }

    // Equipment calibration
    const equipment = protocol.equipment || [];
    const now = new Date();
    const calibrationIssues = [];
    for (const eq of equipment) {
      const nextCal = eq.nextCalibration ? new Date(eq.nextCalibration) : null;
      if (nextCal && nextCal < now) {
        calibrationIssues.push({ equipment: eq.name || eq.id, nextCalibration: eq.nextCalibration, status: 'overdue' });
        issues.push({ type: 'calibration', detail: `${eq.name || eq.id} calibration overdue`, severity: 'high' });
      } else if (nextCal) {
        const daysUntil = Math.ceil((nextCal - now) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 7) {
          calibrationIssues.push({ equipment: eq.name || eq.id, nextCalibration: eq.nextCalibration, status: 'due_soon', daysUntil });
        }
      }
    }

    const valid = issues.filter(i => i.severity === 'high').length === 0;

    return {
      ok: true,
      result: {
        validatedAt: new Date().toISOString(),
        protocolName: protocol.name || artifact.title || '',
        totalSteps: steps.length,
        valid,
        status: valid ? 'approved' : 'needs_revision',
        issueCount: issues.length,
        highSeverityCount: issues.filter(i => i.severity === 'high').length,
        issues,
        safetyChecksTotal: safetyChecks.length,
        safetyChecksVerified: safetyChecks.length - incompleteSafety.length,
        equipmentCount: equipment.length,
        calibrationIssues,
      },
    };
  });

  registerLensAction("science", "dataExport", (ctx, artifact, params) => {
    const observations = artifact.data?.observations || [];
    const format = params.format || 'csv';
    let exportData;
    if (format === 'geojson') {
      exportData = {
        type: 'FeatureCollection',
        features: observations.filter(o => o.gps).map(o => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [o.gps.lon || o.gps.lng, o.gps.lat] },
          properties: { date: o.date, observer: o.observer, type: o.type, notes: o.notes },
        })),
      };
    } else {
      exportData = observations;
    }
    return { ok: true, result: { format, records: observations.length, data: exportData, exportedAt: new Date().toISOString() } };
  });

  registerLensAction("science", "spatialCluster", (ctx, artifact, params) => {
    const observations = artifact.data?.observations || [];
    const radius = params.radiusKm || 1;
    const geoObs = observations.filter(o => o.gps);
    const clusters = [];
    const assigned = new Set();
    for (let i = 0; i < geoObs.length; i++) {
      if (assigned.has(i)) continue;
      const cluster = [i];
      assigned.add(i);
      for (let j = i + 1; j < geoObs.length; j++) {
        if (assigned.has(j)) continue;
        const dLat = (geoObs[j].gps.lat - geoObs[i].gps.lat) * 111;
        const dLon = (geoObs[j].gps.lon - geoObs[i].gps.lon) * 111 * Math.cos(geoObs[i].gps.lat * Math.PI / 180);
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        if (dist <= radius) { cluster.push(j); assigned.add(j); }
      }
      clusters.push({ id: clusters.length + 1, observations: cluster.length, center: geoObs[i].gps });
    }
    return { ok: true, result: { clusters, totalObservations: geoObs.length, radiusKm: radius } };
  });

  // ─── 2026 parity — OriginPro/Igor/MATLAB/Jupyter/Prism analytics ──
  //
  // Pure JS stats: descriptive stats, t-test, correlation, linear regression,
  // and a typed data-table store. No external deps.

  function getScienceState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.scienceLens) {
      STATE.scienceLens = {
        datasets: new Map(), // userId -> Map<id, dataset>
      };
    }
    return STATE.scienceLens;
  }
  function saveScienceState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function sciActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextSciId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

  // ── Stat helpers ──

  function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function variance(arr, sample = true) {
    const m = mean(arr);
    return arr.reduce((s, x) => s + (x - m) ** 2, 0) / (sample ? (arr.length - 1) : arr.length);
  }
  function stddev(arr, sample = true) { return Math.sqrt(variance(arr, sample)); }
  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)];
  }
  function percentile(arr, p) {
    const s = [...arr].sort((a, b) => a - b);
    const k = (s.length - 1) * (p / 100);
    const f = Math.floor(k);
    const c = Math.ceil(k);
    return f === c ? s[f] : s[f] + (s[c] - s[f]) * (k - f);
  }

  // Student's t CDF approximation (sufficient for p-value reporting at common alphas).
  function tCDF(t, df) {
    // Use Abramowitz & Stegun approximation via the inverse normal for high df.
    if (df > 100) {
      // Approximates Z
      const z = t;
      return 0.5 + 0.5 * erf(z / Math.SQRT2);
    }
    // Iterative beta function approximation
    const x = df / (df + t * t);
    return 1 - 0.5 * incompleteBeta(x, df / 2, 0.5);
  }
  function erf(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }
  function incompleteBeta(x, a, b) {
    // Simple series approximation
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) {
      return bt * betacf(x, a, b) / a;
    }
    return 1 - bt * betacf(1 - x, b, a) / b;
  }
  function lnGamma(z) {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betacf(x, a, b) {
    const MAX_IT = 100;
    const EPS = 3e-7;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAX_IT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  // ── Descriptive statistics ──

  registerLensAction("science", "stats-descriptive", (_ctx, _artifact, params = {}) => {
    const data = Array.isArray(params.data) ? params.data.map(Number).filter((x) => Number.isFinite(x)) : [];
    if (data.length === 0) return { ok: false, error: "data array required (numeric)" };
    if (data.length === 1) return { ok: false, error: "need >= 2 values for variance/sd" };
    return {
      ok: true,
      result: {
        n: data.length,
        mean: Math.round(mean(data) * 10000) / 10000,
        median: Math.round(median(data) * 10000) / 10000,
        sd: Math.round(stddev(data) * 10000) / 10000,
        variance: Math.round(variance(data) * 10000) / 10000,
        min: Math.min(...data),
        max: Math.max(...data),
        q1: Math.round(percentile(data, 25) * 10000) / 10000,
        q3: Math.round(percentile(data, 75) * 10000) / 10000,
        iqr: Math.round((percentile(data, 75) - percentile(data, 25)) * 10000) / 10000,
        sum: data.reduce((a, b) => a + b, 0),
      },
    };
  });

  // ── t-test (one-sample, two-sample independent) ──

  registerLensAction("science", "stats-ttest", (_ctx, _artifact, params = {}) => {
    const kind = String(params.kind || "two-sample");
    if (!["one-sample", "two-sample"].includes(kind)) return { ok: false, error: "kind must be one-sample | two-sample" };
    const a = Array.isArray(params.a) ? params.a.map(Number).filter(Number.isFinite) : [];
    if (a.length < 2) return { ok: false, error: "sample a needs >= 2 values" };
    if (kind === "one-sample") {
      const mu = Number(params.mu);
      if (!Number.isFinite(mu)) return { ok: false, error: "mu required for one-sample" };
      const m = mean(a);
      const sd = stddev(a);
      const se = sd / Math.sqrt(a.length);
      const t = (m - mu) / se;
      const df = a.length - 1;
      const p = 2 * (1 - tCDF(Math.abs(t), df));
      return { ok: true, result: { kind, t: Math.round(t * 10000) / 10000, df, pValue: Math.round(p * 100000) / 100000, sampleMean: m, mu } };
    }
    // Two-sample (Welch's t-test, doesn't assume equal variance)
    const b = Array.isArray(params.b) ? params.b.map(Number).filter(Number.isFinite) : [];
    if (b.length < 2) return { ok: false, error: "sample b needs >= 2 values" };
    const m1 = mean(a), m2 = mean(b);
    const v1 = variance(a), v2 = variance(b);
    const n1 = a.length, n2 = b.length;
    const se = Math.sqrt(v1 / n1 + v2 / n2);
    const t = (m1 - m2) / se;
    const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
    const p = 2 * (1 - tCDF(Math.abs(t), df));
    return {
      ok: true,
      result: {
        kind: "two-sample-welch", t: Math.round(t * 10000) / 10000, df: Math.round(df * 100) / 100,
        pValue: Math.round(p * 100000) / 100000,
        meanA: Math.round(m1 * 10000) / 10000, meanB: Math.round(m2 * 10000) / 10000,
        nA: n1, nB: n2,
        significantAt05: p < 0.05,
      },
    };
  });

  // ── Pearson correlation + linear regression ──

  registerLensAction("science", "stats-correlation", (_ctx, _artifact, params = {}) => {
    const x = Array.isArray(params.x) ? params.x.map(Number).filter(Number.isFinite) : [];
    const y = Array.isArray(params.y) ? params.y.map(Number).filter(Number.isFinite) : [];
    if (x.length !== y.length) return { ok: false, error: "x and y must be same length" };
    if (x.length < 3) return { ok: false, error: "need >= 3 paired values" };
    const mx = mean(x), my = mean(y);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < x.length; i++) {
      num += (x[i] - mx) * (y[i] - my);
      dx += (x[i] - mx) ** 2;
      dy += (y[i] - my) ** 2;
    }
    const r = num / Math.sqrt(dx * dy);
    // t-test on r: t = r * sqrt((n-2)/(1-r²)), df = n-2
    const t = r * Math.sqrt((x.length - 2) / (1 - r * r));
    const df = x.length - 2;
    const p = 2 * (1 - tCDF(Math.abs(t), df));
    // Linear regression y = a + bx
    const slope = num / dx;
    const intercept = my - slope * mx;
    return {
      ok: true,
      result: {
        n: x.length,
        pearsonR: Math.round(r * 10000) / 10000,
        rSquared: Math.round(r * r * 10000) / 10000,
        pValue: Math.round(p * 100000) / 100000,
        slope: Math.round(slope * 10000) / 10000,
        intercept: Math.round(intercept * 10000) / 10000,
        equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
        significantAt05: p < 0.05,
      },
    };
  });

  // ── Dataset storage (per-user) ──

  registerLensAction("science", "dataset-save", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long" };
    const columns = Array.isArray(params.columns) ? params.columns : [];
    if (columns.length === 0) return { ok: false, error: "columns array required" };
    const rows = Array.isArray(params.rows) ? params.rows : [];
    if (rows.length > 10_000) return { ok: false, error: "rows max 10000" };
    const dataset = {
      id: nextSciId("ds"),
      name, columns, rows,
      createdAt: new Date().toISOString(),
    };
    if (!s.datasets.has(userId)) s.datasets.set(userId, new Map());
    s.datasets.get(userId).set(dataset.id, dataset);
    saveScienceState();
    return { ok: true, result: { dataset } };
  });

  registerLensAction("science", "dataset-list", (ctx, _artifact, _params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const map = s.datasets.get(userId);
    if (!map) return { ok: true, result: { datasets: [] } };
    const datasets = Array.from(map.values()).map(({ rows, ...meta }) => ({ ...meta, rowCount: rows.length }));
    return { ok: true, result: { datasets } };
  });

  registerLensAction("science", "dataset-delete", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const id = String(params.id || "");
    const map = s.datasets.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveScienceState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Spreadsheet-style data-entry grid — full dataset replace ──
  // The grid in the UI edits columns + rows in place, then saves the
  // whole table back. rows is an array of arrays aligned to columns.

  registerLensAction("science", "dataset-update", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const id = String(params.id || "");
    const map = s.datasets.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const ds = map.get(id);
    if (params.name !== undefined) {
      const name = String(params.name).trim();
      if (!name) return { ok: false, error: "name cannot be empty" };
      if (name.length > 80) return { ok: false, error: "name too long" };
      ds.name = name;
    }
    if (params.columns !== undefined) {
      if (!Array.isArray(params.columns) || params.columns.length === 0) {
        return { ok: false, error: "columns must be a non-empty array" };
      }
      ds.columns = params.columns.map(String);
    }
    if (params.rows !== undefined) {
      if (!Array.isArray(params.rows)) return { ok: false, error: "rows must be an array" };
      if (params.rows.length > 10_000) return { ok: false, error: "rows max 10000" };
      ds.rows = params.rows;
    }
    ds.updatedAt = new Date().toISOString();
    saveScienceState();
    return { ok: true, result: { dataset: ds } };
  });

  // Read a single full dataset (rows included) — the grid needs the rows.
  registerLensAction("science", "dataset-get", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const id = String(params.id || "");
    const map = s.datasets.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    return { ok: true, result: { dataset: map.get(id) } };
  });

  // ── Interactive chart rendering ──
  // Turns a stored dataset (or inline rows) into plottable series data.
  // The frontend mounts ChartKit / a histogram bar set with this output.

  function columnValues(columns, rows, colName) {
    const idx = columns.indexOf(colName);
    if (idx < 0) return [];
    return rows.map((r) => (Array.isArray(r) ? r[idx] : r?.[colName]));
  }

  registerLensAction("science", "chart-render", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    let columns = Array.isArray(params.columns) ? params.columns.map(String) : null;
    let rows = Array.isArray(params.rows) ? params.rows : null;
    if (params.datasetId) {
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = s.datasets.get(sciActor(ctx));
      const ds = map && map.get(String(params.datasetId));
      if (!ds) return { ok: false, error: "dataset not found" };
      columns = ds.columns;
      rows = ds.rows;
    }
    if (!columns || !rows) return { ok: false, error: "datasetId or columns+rows required" };
    if (rows.length === 0) return { ok: false, error: "dataset has no rows" };
    const kind = String(params.kind || "bar");
    const valid = ["bar", "line", "scatter", "heatmap", "histogram", "box", "pie"];
    if (!valid.includes(kind)) return { ok: false, error: `kind must be one of ${valid.join(", ")}` };

    if (kind === "histogram") {
      const col = String(params.valueColumn || params.yColumn || columns[0]);
      const nums = columnValues(columns, rows, col).map(Number).filter(Number.isFinite);
      if (nums.length === 0) return { ok: false, error: `column "${col}" has no numeric data` };
      const bins = Math.max(2, Math.min(50, Number(params.bins) || Math.ceil(Math.sqrt(nums.length))));
      const min = Math.min(...nums), max = Math.max(...nums);
      const width = (max - min) / bins || 1;
      const buckets = Array.from({ length: bins }, (_, i) => ({
        bin: Math.round((min + i * width) * 1000) / 1000,
        binEnd: Math.round((min + (i + 1) * width) * 1000) / 1000,
        count: 0,
      }));
      for (const n of nums) {
        let bi = Math.floor((n - min) / width);
        if (bi >= bins) bi = bins - 1;
        if (bi < 0) bi = 0;
        buckets[bi].count++;
      }
      return { ok: true, result: { kind, valueColumn: col, n: nums.length, bins, points: buckets, xKey: "bin", series: [{ key: "count", label: col }] } };
    }

    if (kind === "box") {
      const col = String(params.valueColumn || params.yColumn || columns[0]);
      const nums = columnValues(columns, rows, col).map(Number).filter(Number.isFinite);
      if (nums.length < 2) return { ok: false, error: `column "${col}" needs >= 2 numeric values` };
      const q1 = percentile(nums, 25), q2 = median(nums), q3 = percentile(nums, 75);
      const iqr = q3 - q1;
      const lf = q1 - 1.5 * iqr, uf = q3 + 1.5 * iqr;
      const inb = nums.filter((n) => n >= lf && n <= uf);
      return {
        ok: true,
        result: {
          kind, valueColumn: col, n: nums.length,
          min: Math.min(...nums), max: Math.max(...nums),
          q1: Math.round(q1 * 1000) / 1000, median: Math.round(q2 * 1000) / 1000, q3: Math.round(q3 * 1000) / 1000,
          whiskerLow: Math.min(...inb), whiskerHigh: Math.max(...inb),
          outliers: nums.filter((n) => n < lf || n > uf),
        },
      };
    }

    if (kind === "pie") {
      const col = String(params.categoryColumn || params.xColumn || columns[0]);
      const vals = columnValues(columns, rows, col).map((v) => (v == null ? "" : String(v)));
      const counts = {};
      for (const v of vals) counts[v] = (counts[v] || 0) + 1;
      const slices = Object.entries(counts).map(([name, count]) => ({ name, count }));
      slices.sort((a, b) => b.count - a.count);
      return { ok: true, result: { kind, categoryColumn: col, total: vals.length, slices } };
    }

    // bar / line / scatter / heatmap → x/y series
    const xCol = String(params.xColumn || columns[0]);
    const yCols = Array.isArray(params.yColumns) && params.yColumns.length > 0
      ? params.yColumns.map(String)
      : [String(params.yColumn || columns[1] || columns[0])];
    const xVals = columnValues(columns, rows, xCol);
    const points = rows.map((r, i) => {
      const pt = { [xCol]: typeof xVals[i] === "number" || isNaN(Number(xVals[i])) ? xVals[i] : Number(xVals[i]) };
      for (const yc of yCols) {
        const v = Array.isArray(r) ? r[columns.indexOf(yc)] : r?.[yc];
        pt[yc] = Number.isFinite(Number(v)) ? Number(v) : v;
      }
      return pt;
    });
    return {
      ok: true,
      result: {
        kind, xKey: xCol, n: points.length, points,
        series: yCols.map((k) => ({ key: k, label: k })),
      },
    };
  });

  // ── Richer statistics — ANOVA, regression, non-parametric, CI ──

  function fCDF(f, d1, d2) {
    if (f <= 0) return 0;
    const x = d1 * f / (d1 * f + d2);
    return incompleteBeta(x, d1 / 2, d2 / 2);
  }

  // One-way ANOVA across >= 2 groups.
  registerLensAction("science", "stats-anova", (_ctx, _artifact, params = {}) => {
    const groups = Array.isArray(params.groups)
      ? params.groups.map((g) => (Array.isArray(g) ? g.map(Number).filter(Number.isFinite) : []))
      : [];
    if (groups.length < 2) return { ok: false, error: "need >= 2 groups" };
    if (groups.some((g) => g.length < 2)) return { ok: false, error: "each group needs >= 2 values" };
    const allValues = groups.flat();
    const grandMean = mean(allValues);
    const N = allValues.length;
    const k = groups.length;
    let ssBetween = 0, ssWithin = 0;
    const groupStats = groups.map((g) => {
      const gm = mean(g);
      ssBetween += g.length * (gm - grandMean) ** 2;
      for (const v of g) ssWithin += (v - gm) ** 2;
      return { n: g.length, mean: Math.round(gm * 10000) / 10000 };
    });
    const dfBetween = k - 1;
    const dfWithin = N - k;
    const msBetween = ssBetween / dfBetween;
    const msWithin = ssWithin / dfWithin;
    const F = msWithin === 0 ? Infinity : msBetween / msWithin;
    const p = Number.isFinite(F) ? 1 - fCDF(F, dfBetween, dfWithin) : 0;
    const etaSquared = ssBetween / (ssBetween + ssWithin);
    return {
      ok: true,
      result: {
        groups: groupStats,
        ssBetween: Math.round(ssBetween * 10000) / 10000,
        ssWithin: Math.round(ssWithin * 10000) / 10000,
        dfBetween, dfWithin,
        msBetween: Math.round(msBetween * 10000) / 10000,
        msWithin: Math.round(msWithin * 10000) / 10000,
        fStatistic: Number.isFinite(F) ? Math.round(F * 10000) / 10000 : null,
        pValue: Math.round(p * 100000) / 100000,
        etaSquared: Math.round(etaSquared * 10000) / 10000,
        significantAt05: p < 0.05,
      },
    };
  });

  // Linear regression with confidence intervals on slope + intercept.
  registerLensAction("science", "stats-regression", (_ctx, _artifact, params = {}) => {
    const x = Array.isArray(params.x) ? params.x.map(Number).filter(Number.isFinite) : [];
    const y = Array.isArray(params.y) ? params.y.map(Number).filter(Number.isFinite) : [];
    if (x.length !== y.length) return { ok: false, error: "x and y must be same length" };
    if (x.length < 3) return { ok: false, error: "need >= 3 paired values" };
    const n = x.length;
    const mx = mean(x), my = mean(y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (x[i] - mx) ** 2;
      sxy += (x[i] - mx) * (y[i] - my);
      syy += (y[i] - my) ** 2;
    }
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const pred = intercept + slope * x[i];
      ssRes += (y[i] - pred) ** 2;
    }
    const ssTot = syy;
    const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    const df = n - 2;
    const mse = ssRes / df;
    const seSlope = Math.sqrt(mse / sxx);
    const seIntercept = Math.sqrt(mse * (1 / n + mx * mx / sxx));
    const tCrit = tCritical(0.95, df);
    const tSlope = slope / seSlope;
    const pSlope = 2 * (1 - tCDF(Math.abs(tSlope), df));
    return {
      ok: true,
      result: {
        n, slope: Math.round(slope * 100000) / 100000,
        intercept: Math.round(intercept * 100000) / 100000,
        rSquared: Math.round(rSquared * 10000) / 10000,
        equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
        residualStdError: Math.round(Math.sqrt(mse) * 10000) / 10000,
        slopeStdError: Math.round(seSlope * 10000) / 10000,
        slopeCI95: [
          Math.round((slope - tCrit * seSlope) * 100000) / 100000,
          Math.round((slope + tCrit * seSlope) * 100000) / 100000,
        ],
        interceptCI95: [
          Math.round((intercept - tCrit * seIntercept) * 100000) / 100000,
          Math.round((intercept + tCrit * seIntercept) * 100000) / 100000,
        ],
        slopePValue: Math.round(pSlope * 100000) / 100000,
        slopeSignificantAt05: pSlope < 0.05,
      },
    };
  });

  // Approximate the two-sided t critical value via bisection on tCDF.
  function tCritical(conf, df) {
    const target = 1 - (1 - conf) / 2;
    let lo = 0, hi = 100;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tCDF(mid, df) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Mann-Whitney U — non-parametric two-sample test.
  registerLensAction("science", "stats-nonparametric", (_ctx, _artifact, params = {}) => {
    const test = String(params.test || "mann-whitney");
    const a = Array.isArray(params.a) ? params.a.map(Number).filter(Number.isFinite) : [];
    const b = Array.isArray(params.b) ? params.b.map(Number).filter(Number.isFinite) : [];
    if (a.length < 2 || b.length < 2) return { ok: false, error: "both samples need >= 2 values" };
    if (test === "mann-whitney") {
      const combined = [
        ...a.map((v) => ({ v, grp: "a" })),
        ...b.map((v) => ({ v, grp: "b" })),
      ].sort((p, q) => p.v - q.v);
      // assign ranks with tie averaging
      let i = 0;
      while (i < combined.length) {
        let j = i;
        while (j < combined.length - 1 && combined[j + 1].v === combined[i].v) j++;
        const avgRank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) combined[k].rank = avgRank;
        i = j + 1;
      }
      const rankSumA = combined.filter((c) => c.grp === "a").reduce((s, c) => s + c.rank, 0);
      const n1 = a.length, n2 = b.length;
      const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
      const u2 = n1 * n2 - u1;
      const U = Math.min(u1, u2);
      // normal approximation
      const muU = (n1 * n2) / 2;
      const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
      const z = sigmaU === 0 ? 0 : (U - muU) / sigmaU;
      const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
      return {
        ok: true,
        result: {
          test: "mann-whitney-u", U, u1, u2, rankSumA: Math.round(rankSumA * 100) / 100,
          z: Math.round(z * 10000) / 10000,
          pValue: Math.round(p * 100000) / 100000,
          medianA: median(a), medianB: median(b),
          significantAt05: p < 0.05,
        },
      };
    }
    return { ok: false, error: "test must be mann-whitney" };
  });

  // Confidence interval for a single sample's mean.
  registerLensAction("science", "stats-ci", (_ctx, _artifact, params = {}) => {
    const data = Array.isArray(params.data) ? params.data.map(Number).filter(Number.isFinite) : [];
    if (data.length < 2) return { ok: false, error: "need >= 2 values" };
    const conf = Number(params.confidence) || 0.95;
    if (conf <= 0 || conf >= 1) return { ok: false, error: "confidence must be between 0 and 1" };
    const m = mean(data);
    const sd = stddev(data);
    const n = data.length;
    const se = sd / Math.sqrt(n);
    const df = n - 1;
    const tCrit = tCritical(conf, df);
    const margin = tCrit * se;
    return {
      ok: true,
      result: {
        n, mean: Math.round(m * 10000) / 10000,
        sd: Math.round(sd * 10000) / 10000,
        standardError: Math.round(se * 10000) / 10000,
        confidence: conf,
        tCritical: Math.round(tCrit * 10000) / 10000,
        marginOfError: Math.round(margin * 10000) / 10000,
        lower: Math.round((m - margin) * 10000) / 10000,
        upper: Math.round((m + margin) * 10000) / 10000,
      },
    };
  });

  // ── Experiment notebook entries (rich text + embedded refs) ──

  function getNotebooks(s, userId) {
    if (!s.notebooks) s.notebooks = new Map();
    if (!s.notebooks.has(userId)) s.notebooks.set(userId, new Map());
    return s.notebooks.get(userId);
  }

  registerLensAction("science", "notebook-add", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (title.length > 200) return { ok: false, error: "title too long" };
    const body = String(params.body || "");
    if (body.length > 50_000) return { ok: false, error: "body too long (max 50000)" };
    const attachments = Array.isArray(params.attachments)
      ? params.attachments.slice(0, 20).map((a) => ({
          kind: String(a.kind || "link"),
          ref: String(a.ref || ""),
          label: String(a.label || ""),
        }))
      : [];
    const entry = {
      id: nextSciId("nb"),
      experimentId: params.experimentId ? String(params.experimentId) : null,
      title, body, attachments,
      tags: Array.isArray(params.tags) ? params.tags.map(String).slice(0, 20) : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    getNotebooks(s, userId).set(entry.id, entry);
    saveScienceState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("science", "notebook-update", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const nb = getNotebooks(s, sciActor(ctx));
    const id = String(params.id || "");
    if (!nb.has(id)) return { ok: false, error: "not found" };
    const entry = nb.get(id);
    if (params.title !== undefined) {
      const t = String(params.title).trim();
      if (!t) return { ok: false, error: "title cannot be empty" };
      entry.title = t;
    }
    if (params.body !== undefined) {
      const b = String(params.body);
      if (b.length > 50_000) return { ok: false, error: "body too long" };
      entry.body = b;
    }
    if (params.tags !== undefined) entry.tags = (params.tags || []).map(String).slice(0, 20);
    if (params.attachments !== undefined) {
      entry.attachments = (params.attachments || []).slice(0, 20).map((a) => ({
        kind: String(a.kind || "link"), ref: String(a.ref || ""), label: String(a.label || ""),
      }));
    }
    entry.updatedAt = new Date().toISOString();
    saveScienceState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("science", "notebook-list", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const nb = getNotebooks(s, sciActor(ctx));
    let entries = Array.from(nb.values());
    if (params.experimentId) {
      const eid = String(params.experimentId);
      entries = entries.filter((e) => e.experimentId === eid);
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("science", "notebook-delete", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const nb = getNotebooks(s, sciActor(ctx));
    const id = String(params.id || "");
    if (!nb.has(id)) return { ok: false, error: "not found" };
    nb.delete(id);
    saveScienceState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Protocol run log — execute an experiment against a protocol ──

  function getProtoRuns(s, userId) {
    if (!s.protoRuns) s.protoRuns = new Map();
    if (!s.protoRuns.has(userId)) s.protoRuns.set(userId, new Map());
    return s.protoRuns.get(userId);
  }

  registerLensAction("science", "protorun-start", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const protocolName = String(params.protocolName || "").trim();
    if (!protocolName) return { ok: false, error: "protocolName required" };
    const steps = Array.isArray(params.steps) ? params.steps.map(String).filter(Boolean) : [];
    if (steps.length === 0) return { ok: false, error: "steps array required" };
    const run = {
      id: nextSciId("run"),
      protocolName,
      protocolId: params.protocolId ? String(params.protocolId) : null,
      operator: String(params.operator || userId),
      status: "in_progress",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentStep: 0,
      steps: steps.map((label, i) => ({
        index: i, label, status: "pending",
        startedAt: null, completedAt: null, note: "", deviation: false,
      })),
    };
    getProtoRuns(s, userId).set(run.id, run);
    saveScienceState();
    return { ok: true, result: { run } };
  });

  registerLensAction("science", "protorun-step", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = getProtoRuns(s, sciActor(ctx));
    const run = runs.get(String(params.id || ""));
    if (!run) return { ok: false, error: "run not found" };
    if (run.status === "completed") return { ok: false, error: "run already completed" };
    const idx = Number(params.stepIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= run.steps.length) {
      return { ok: false, error: "valid stepIndex required" };
    }
    const step = run.steps[idx];
    const newStatus = String(params.status || "completed");
    if (!["pending", "in_progress", "completed", "skipped"].includes(newStatus)) {
      return { ok: false, error: "invalid step status" };
    }
    const now = new Date().toISOString();
    if (newStatus === "in_progress" && !step.startedAt) step.startedAt = now;
    if (newStatus === "completed" || newStatus === "skipped") {
      if (!step.startedAt) step.startedAt = now;
      step.completedAt = now;
    }
    step.status = newStatus;
    if (params.note !== undefined) step.note = String(params.note).slice(0, 2000);
    if (params.deviation !== undefined) step.deviation = !!params.deviation;
    run.currentStep = run.steps.filter((st) => st.status === "completed" || st.status === "skipped").length;
    saveScienceState();
    return { ok: true, result: { run } };
  });

  registerLensAction("science", "protorun-complete", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = getProtoRuns(s, sciActor(ctx));
    const run = runs.get(String(params.id || ""));
    if (!run) return { ok: false, error: "run not found" };
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.outcome = String(params.outcome || "").slice(0, 4000);
    run.deviationCount = run.steps.filter((st) => st.deviation).length;
    saveScienceState();
    return { ok: true, result: { run } };
  });

  registerLensAction("science", "protorun-list", (ctx, _artifact, _params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = Array.from(getProtoRuns(s, sciActor(ctx)).values());
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { ok: true, result: { runs, count: runs.length } };
  });

  registerLensAction("science", "protorun-delete", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = getProtoRuns(s, sciActor(ctx));
    const id = String(params.id || "");
    if (!runs.has(id)) return { ok: false, error: "not found" };
    runs.delete(id);
    saveScienceState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Reagent / inventory management ──

  function getReagents(s, userId) {
    if (!s.reagents) s.reagents = new Map();
    if (!s.reagents.has(userId)) s.reagents.set(userId, new Map());
    return s.reagents.get(userId);
  }

  registerLensAction("science", "reagent-save", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = sciActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 120) return { ok: false, error: "name too long" };
    const quantity = Number(params.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: "quantity must be >= 0" };
    const reagents = getReagents(s, userId);
    let reagent;
    if (params.id && reagents.has(String(params.id))) {
      reagent = reagents.get(String(params.id));
    } else {
      reagent = { id: nextSciId("rg"), createdAt: new Date().toISOString() };
      reagents.set(reagent.id, reagent);
    }
    reagent.name = name;
    reagent.catalogNumber = String(params.catalogNumber || "");
    reagent.lotNumber = String(params.lotNumber || "");
    reagent.vendor = String(params.vendor || "");
    reagent.quantity = quantity;
    reagent.unit = String(params.unit || "units");
    reagent.reorderThreshold = Number.isFinite(Number(params.reorderThreshold))
      ? Number(params.reorderThreshold) : 0;
    reagent.location = String(params.location || "");
    reagent.hazardClass = String(params.hazardClass || "none");
    reagent.expiryDate = params.expiryDate ? String(params.expiryDate) : null;
    reagent.updatedAt = new Date().toISOString();
    reagent.lowStock = reagent.quantity <= reagent.reorderThreshold;
    reagent.expired = !!(reagent.expiryDate && new Date(reagent.expiryDate) < new Date());
    saveScienceState();
    return { ok: true, result: { reagent } };
  });

  registerLensAction("science", "reagent-consume", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const reagents = getReagents(s, sciActor(ctx));
    const reagent = reagents.get(String(params.id || ""));
    if (!reagent) return { ok: false, error: "reagent not found" };
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    if (amount > reagent.quantity) return { ok: false, error: "insufficient quantity in stock" };
    reagent.quantity = Math.round((reagent.quantity - amount) * 1e6) / 1e6;
    reagent.lowStock = reagent.quantity <= reagent.reorderThreshold;
    reagent.updatedAt = new Date().toISOString();
    if (!reagent.usageLog) reagent.usageLog = [];
    reagent.usageLog.push({
      amount, at: new Date().toISOString(),
      reason: String(params.reason || ""), remaining: reagent.quantity,
    });
    if (reagent.usageLog.length > 200) reagent.usageLog = reagent.usageLog.slice(-200);
    saveScienceState();
    return { ok: true, result: { reagent } };
  });

  registerLensAction("science", "reagent-list", (ctx, _artifact, _params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const now = new Date();
    const reagents = Array.from(getReagents(s, sciActor(ctx)).values()).map((r) => ({
      ...r,
      lowStock: r.quantity <= r.reorderThreshold,
      expired: !!(r.expiryDate && new Date(r.expiryDate) < now),
    }));
    reagents.sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      result: {
        reagents, count: reagents.length,
        lowStockCount: reagents.filter((r) => r.lowStock).length,
        expiredCount: reagents.filter((r) => r.expired).length,
      },
    };
  });

  registerLensAction("science", "reagent-delete", (ctx, _artifact, params = {}) => {
    const s = getScienceState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const reagents = getReagents(s, sciActor(ctx));
    const id = String(params.id || "");
    if (!reagents.has(id)) return { ok: false, error: "not found" };
    reagents.delete(id);
    saveScienceState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Publication export — figures + methods bundle ──

  registerLensAction("science", "publication-export", (ctx, _artifact, params = {}) => {
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const authors = Array.isArray(params.authors) ? params.authors.map(String).filter(Boolean) : [];
    const sections = {
      title,
      authors,
      abstract: String(params.abstract || ""),
      methods: String(params.methods || ""),
      results: String(params.results || ""),
      keywords: Array.isArray(params.keywords) ? params.keywords.map(String) : [],
    };
    const figures = Array.isArray(params.figures)
      ? params.figures.slice(0, 50).map((f, i) => ({
          number: i + 1,
          caption: String(f.caption || ""),
          chartKind: String(f.chartKind || ""),
          ref: String(f.ref || ""),
        }))
      : [];
    const protocolRuns = Array.isArray(params.protocolRuns)
      ? params.protocolRuns.map((r) => ({ name: String(r.name || ""), outcome: String(r.outcome || "") }))
      : [];
    const format = String(params.format || "markdown");
    if (!["markdown", "json"].includes(format)) return { ok: false, error: "format must be markdown | json" };

    let bundle;
    if (format === "markdown") {
      const lines = [`# ${sections.title}`, ""];
      if (authors.length) lines.push(`**Authors:** ${authors.join(", ")}`, "");
      if (sections.keywords.length) lines.push(`**Keywords:** ${sections.keywords.join(", ")}`, "");
      if (sections.abstract) lines.push("## Abstract", sections.abstract, "");
      if (sections.methods) lines.push("## Methods", sections.methods, "");
      if (protocolRuns.length) {
        lines.push("### Protocol Runs");
        for (const r of protocolRuns) lines.push(`- ${r.name}${r.outcome ? `: ${r.outcome}` : ""}`);
        lines.push("");
      }
      if (sections.results) lines.push("## Results", sections.results, "");
      if (figures.length) {
        lines.push("## Figures");
        for (const f of figures) lines.push(`**Figure ${f.number}.** ${f.caption} ${f.chartKind ? `(${f.chartKind})` : ""}`.trim());
        lines.push("");
      }
      bundle = lines.join("\n");
    } else {
      bundle = { ...sections, figures, protocolRuns };
    }
    return {
      ok: true,
      result: {
        format,
        bundle,
        figureCount: figures.length,
        wordCount: (sections.abstract + " " + sections.methods + " " + sections.results)
          .split(/\s+/).filter(Boolean).length,
        exportedAt: new Date().toISOString(),
        filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.${format === "markdown" ? "md" : "json"}`,
      },
    };
  });
};
