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
};
