// server/domains/ml.js
import { cachedFetchJson } from "../lib/external-fetch.js";

export default function registerMlActions(registerLensAction) {
  registerLensAction("ml", "modelEvaluate", (ctx, artifact, _params) => {
    const predictions = artifact.data?.predictions || [];
    const actuals = artifact.data?.actuals || artifact.data?.labels || [];
    if (predictions.length === 0 || actuals.length === 0) return { ok: true, result: { message: "Provide predictions and actuals arrays to evaluate." } };
    const n = Math.min(predictions.length, actuals.length);
    const classes = [...new Set(actuals.slice(0, n))];
    const isClassification = classes.length <= 20 && classes.every(c => typeof c === "string" || Number.isInteger(c));
    if (isClassification) {
      let correct = 0;
      const matrix = {};
      classes.forEach(c => { matrix[c] = {}; classes.forEach(c2 => { matrix[c][c2] = 0; }); });
      for (let i = 0; i < n; i++) {
        if (predictions[i] === actuals[i]) correct++;
        if (matrix[actuals[i]] && matrix[actuals[i]][predictions[i]] !== undefined) matrix[actuals[i]][predictions[i]]++;
      }
      const accuracy = Math.round((correct / n) * 1000) / 10;
      const perClass = classes.map(cls => {
        const tp = matrix[cls]?.[cls] || 0;
        const fp = classes.reduce((s, c) => s + (c !== cls ? (matrix[c]?.[cls] || 0) : 0), 0);
        const fn = classes.reduce((s, c) => s + (c !== cls ? (matrix[cls]?.[c] || 0) : 0), 0);
        const precision = tp + fp > 0 ? Math.round((tp / (tp + fp)) * 1000) / 10 : 0;
        const recall = tp + fn > 0 ? Math.round((tp / (tp + fn)) * 1000) / 10 : 0;
        const f1 = precision + recall > 0 ? Math.round((2 * precision * recall / (precision + recall)) * 10) / 10 : 0;
        return { class: cls, precision, recall, f1, support: tp + fn };
      });
      const avgF1 = Math.round((perClass.reduce((s, c) => s + c.f1, 0) / perClass.length) * 10) / 10;
      return { ok: true, result: { type: "classification", samples: n, accuracy, avgF1, perClass, confusionMatrix: matrix } };
    }
    const preds = predictions.slice(0, n).map(Number);
    const acts = actuals.slice(0, n).map(Number);
    // Fail-CLOSED: a single non-finite prediction/actual (NaN/Infinity/"abc")
    // would otherwise leak NaN through the round() and serialize as `null`,
    // rendering "MSE null" in the result card. Reject before any math runs.
    const finitePairs = preds.every(Number.isFinite) && acts.every(Number.isFinite);
    if (!finitePairs) {
      return { ok: false, error: "predictions and actuals must all be finite numbers for regression evaluation" };
    }
    const mse = preds.reduce((s, p, i) => s + Math.pow(p - acts[i], 2), 0) / n;
    const mae = preds.reduce((s, p, i) => s + Math.abs(p - acts[i]), 0) / n;
    const actMean = acts.reduce((s, a) => s + a, 0) / n;
    const ssTot = acts.reduce((s, a) => s + Math.pow(a - actMean, 2), 0);
    const ssRes = preds.reduce((s, p, i) => s + Math.pow(acts[i] - p, 2), 0);
    const r2 = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 1000) / 1000 : 0;
    return { ok: true, result: { type: "regression", samples: n, mse: Math.round(mse * 1000) / 1000, rmse: Math.round(Math.sqrt(mse) * 1000) / 1000, mae: Math.round(mae * 1000) / 1000, r2 } };
  });

  registerLensAction("ml", "featureImportance", (ctx, artifact, _params) => {
    const data = artifact.data?.features || artifact.data?.dataset || [];
    const target = artifact.data?.target || artifact.data?.targetField || null;
    if (data.length < 3) return { ok: true, result: { message: "Provide 3+ data rows with features to analyze." } };
    const fields = Object.keys(data[0]).filter(k => k !== target);
    // A field is numeric only if every cell parses to a FINITE number — an
    // "Infinity"/"NaN" cell would otherwise pass !isNaN(parseFloat()) (parseFloat
    // returns the JS number) and poison variance/stdDev/importance with NaN that
    // serializes as `null` in the rendered bar width. Excluded → no leak.
    const finiteCell = (x) => { const v = parseFloat(x); return Number.isFinite(v); };
    const numericFields = fields.filter(f => data.every(r => finiteCell(r[f])));
    const ranked = numericFields.map(field => {
      const values = data.map(r => { const v = parseFloat(r[field]); return Number.isFinite(v) ? v : 0; });
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      let correlation = 0;
      if (target && data[0][target] !== undefined) {
        const targets = data.map(r => { const v = parseFloat(r[target]); return Number.isFinite(v) ? v : 0; });
        const tMean = targets.reduce((s, v) => s + v, 0) / targets.length;
        const cov = values.reduce((s, v, i) => s + (v - mean) * (targets[i] - tMean), 0) / values.length;
        const tStd = Math.sqrt(targets.reduce((s, v) => s + Math.pow(v - tMean, 2), 0) / values.length);
        correlation = stdDev > 0 && tStd > 0 ? Math.round((cov / (stdDev * tStd)) * 1000) / 1000 : 0;
      }
      return { feature: field, variance: Math.round(variance * 1000) / 1000, stdDev: Math.round(stdDev * 1000) / 1000, correlation, absCorrelation: Math.abs(correlation), importance: Math.round((Math.abs(correlation) * 0.7 + Math.min(1, variance) * 0.3) * 100) };
    }).sort((a, b) => b.importance - a.importance);
    return { ok: true, result: { totalFeatures: fields.length, numericFeatures: numericFields.length, targetField: target, rankings: ranked, topFeatures: ranked.slice(0, 5).map(r => r.feature) } };
  });

  registerLensAction("ml", "datasetProfile", (ctx, artifact, _params) => {
    const data = artifact.data?.dataset || artifact.data?.rows || [];
    if (data.length === 0) return { ok: true, result: { message: "Provide dataset rows to profile." } };
    const fields = Object.keys(data[0]);
    const profile = fields.map(field => {
      const values = data.map(r => r[field]);
      const nullCount = values.filter(v => v === null || v === undefined || v === "").length;
      const unique = new Set(values.filter(v => v !== null && v !== undefined && v !== ""));
      const numeric = values.filter(v => !isNaN(parseFloat(v)) && v !== null && v !== "");
      const isNumeric = numeric.length > values.length * 0.8;
      const result = { field, type: isNumeric ? "numeric" : unique.size <= 10 ? "categorical" : "text", nullCount, nullRate: Math.round((nullCount / values.length) * 100), cardinality: unique.size };
      if (isNumeric) {
        const nums = numeric.map(Number).sort((a, b) => a - b);
        const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
        const q1 = nums[Math.floor(nums.length * 0.25)];
        const median = nums[Math.floor(nums.length * 0.5)];
        const q3 = nums[Math.floor(nums.length * 0.75)];
        const iqr = q3 - q1;
        const outliers = nums.filter(n => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length;
        result.stats = { min: nums[0], max: nums[nums.length - 1], mean: Math.round(mean * 100) / 100, median, q1, q3, outliers };
      }
      return result;
    });
    return { ok: true, result: { rows: data.length, columns: fields.length, profile, qualityScore: Math.round((1 - profile.reduce((s, p) => s + p.nullRate, 0) / (profile.length * 100)) * 100) } };
  });

  registerLensAction("ml", "hyperparameterSuggest", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    for (const f of ["datasetSize", "features"]) {
      if (data[f] !== undefined && data[f] !== null && !Number.isFinite(Number(data[f]))) {
        return { ok: false, error: `invalid_${f}` };
      }
    }
    const modelType = (data.model || data.modelType || "neural-network").toLowerCase();
    const datasetSize = parseInt(data.datasetSize || data.rows) || 1000;
    const featureCount = parseInt(data.features || data.featureCount) || 10;
    const taskType = (data.task || "classification").toLowerCase();
    const suggestions = {};
    if (modelType.includes("neural") || modelType.includes("nn") || modelType.includes("deep")) {
      const layers = datasetSize > 10000 ? 4 : datasetSize > 1000 ? 3 : 2;
      suggestions.architecture = { hiddenLayers: layers, unitsPerLayer: Math.min(512, Math.max(32, Math.round(featureCount * 4))), activation: "relu", outputActivation: taskType === "regression" ? "linear" : "softmax" };
      suggestions.learningRate = datasetSize > 50000 ? 0.001 : datasetSize > 5000 ? 0.01 : 0.1;
      suggestions.batchSize = Math.min(256, Math.max(16, Math.pow(2, Math.round(Math.log2(datasetSize / 50)))));
      suggestions.epochs = datasetSize > 50000 ? 50 : datasetSize > 5000 ? 100 : 200;
      suggestions.dropout = featureCount > 50 ? 0.5 : 0.3;
      suggestions.optimizer = "adam";
      suggestions.regularization = { l2: featureCount > 100 ? 0.01 : 0.001 };
    } else if (modelType.includes("tree") || modelType.includes("forest") || modelType.includes("xgb") || modelType.includes("gradient")) {
      suggestions.nEstimators = datasetSize > 10000 ? 500 : 200;
      suggestions.maxDepth = Math.min(20, Math.max(3, Math.round(Math.log2(datasetSize))));
      suggestions.minSamplesSplit = Math.max(2, Math.round(datasetSize * 0.01));
      suggestions.learningRate = modelType.includes("xgb") || modelType.includes("gradient") ? 0.1 : null;
      suggestions.subsample = 0.8;
      suggestions.maxFeatures = modelType.includes("forest") ? Math.round(Math.sqrt(featureCount)) : featureCount;
    } else {
      suggestions.regularization = featureCount > datasetSize / 10 ? "l1" : "l2";
      suggestions.alpha = 0.01;
      suggestions.maxIterations = 1000;
    }
    suggestions.crossValidation = datasetSize < 1000 ? 10 : 5;
    suggestions.testSplit = 0.2;
    return { ok: true, result: { modelType, taskType, datasetSize, featureCount, suggestions, notes: [`Dataset ratio: ${Math.round(datasetSize / featureCount)}:1 samples per feature`, datasetSize / featureCount < 10 ? "Warning: Low sample-to-feature ratio — consider dimensionality reduction" : "Adequate sample-to-feature ratio"] } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // ML-lens substrate: per-user state, model hub, playground, experiment
  // tracking, dataset hub, comparison, AutoML templates, deployments,
  // Spaces-style demos. Backlog parity vs Hugging Face.
  // ─────────────────────────────────────────────────────────────────────

  function getMlState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.mlLens) STATE.mlLens = {};
    const m = STATE.mlLens;
    if (!(m.experiments instanceof Map)) m.experiments = new Map(); // userId -> Array
    if (!(m.datasets instanceof Map)) m.datasets = new Map();       // userId -> Array
    if (!(m.deployments instanceof Map)) m.deployments = new Map(); // userId -> Array
    if (!(m.spaces instanceof Map)) m.spaces = new Map();           // userId -> Array
    return m;
  }
  function saveMl() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mlId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mlActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mlClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const mlNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const mlList = (map, userId) => { if (!map.has(userId)) map.set(userId, []); return map.get(userId); };

  // ─── Model hub — browsable Hugging Face model catalog ─────────────────
  registerLensAction("ml", "model-hub", async (_ctx, _a, params = {}) => {
    try {
      const q = mlClean(params.query || params.search || "", 120);
      const task = mlClean(params.task || params.pipeline || "", 60);
      const sort = mlClean(params.sort || "downloads", 20);
      const limit = Math.min(50, Math.max(1, mlNum(params.limit, 24)));
      const parts = [`limit=${limit}`, `sort=${encodeURIComponent(sort)}`, "full=true", "config=false"];
      if (q) parts.push(`search=${encodeURIComponent(q)}`);
      if (task) parts.push(`pipeline_tag=${encodeURIComponent(task)}`);
      const url = `https://huggingface.co/api/models?${parts.join("&")}`;
      const raw = await cachedFetchJson(url, { ttlMs: 600000 });
      const models = (Array.isArray(raw) ? raw : []).map(m => ({
        id: m.id || m.modelId,
        name: (m.id || m.modelId || "").split("/").pop(),
        author: (m.id || m.modelId || "").split("/")[0] || "unknown",
        task: m.pipeline_tag || "other",
        library: m.library_name || (Array.isArray(m.tags) ? m.tags.find(t => ["pytorch", "tensorflow", "transformers", "diffusers"].includes(t)) : null) || "other",
        downloads: m.downloads || 0,
        likes: m.likes || 0,
        tags: Array.isArray(m.tags) ? m.tags.slice(0, 8) : [],
        updatedAt: m.lastModified || m.createdAt || null,
        gated: !!m.gated,
        url: `https://huggingface.co/${m.id || m.modelId}`,
      }));
      return { ok: true, result: { count: models.length, query: q, task, sort, models, source: "huggingface-hub" } };
    } catch (e) {
      return { ok: false, error: `huggingface hub unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Model card — detail view for a single HF model ───────────────────
  registerLensAction("ml", "model-card", async (_ctx, _a, params = {}) => {
    const modelId = mlClean(params.modelId || params.id || "", 200);
    if (!modelId) return { ok: false, error: "modelId required" };
    try {
      const m = await cachedFetchJson(`https://huggingface.co/api/models/${encodeURIComponent(modelId)}`, { ttlMs: 600000 });
      const card = {
        id: m.id || m.modelId,
        name: (m.id || m.modelId || "").split("/").pop(),
        author: (m.id || m.modelId || "").split("/")[0] || "unknown",
        task: m.pipeline_tag || "other",
        library: m.library_name || "other",
        downloads: m.downloads || 0,
        likes: m.likes || 0,
        tags: Array.isArray(m.tags) ? m.tags : [],
        license: (Array.isArray(m.tags) ? m.tags.find(t => t.startsWith("license:")) : null)?.replace("license:", "") || "unknown",
        updatedAt: m.lastModified || null,
        gated: !!m.gated,
        siblings: Array.isArray(m.siblings) ? m.siblings.map(s => s.rfilename).slice(0, 40) : [],
        url: `https://huggingface.co/${m.id || m.modelId}`,
      };
      return { ok: true, result: { card, source: "huggingface-hub" } };
    } catch (e) {
      return { ok: false, error: `model not found or hub unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Inference playground — run a hosted HF model on user input ───────
  registerLensAction("ml", "playground-infer", async (_ctx, _a, params = {}) => {
    const modelId = mlClean(params.modelId || params.model || "", 200);
    const input = mlClean(params.input || params.text || "", 4000);
    if (!modelId) return { ok: false, error: "modelId required" };
    if (!input) return { ok: false, error: "input required" };
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      let body;
      try {
        const r = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: input, options: { wait_for_model: true } }),
          signal: ctrl.signal,
        });
        body = await r.json().catch(() => null);
        if (!r.ok) {
          const msg = body?.error || `HTTP ${r.status}`;
          return { ok: false, error: `inference failed: ${msg}` };
        }
      } finally { clearTimeout(t); }
      return { ok: true, result: { modelId, input, output: body, latencyMs: Date.now() - started, source: "huggingface-inference-api" } };
    } catch (e) {
      return { ok: false, error: `inference api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Training run tracking ────────────────────────────────────────────
  registerLensAction("ml", "experiment-start", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const name = mlClean(params.name, 160);
    if (!name) return { ok: false, error: "experiment name required" };
    const exp = {
      id: mlId("exp"),
      name,
      modelId: mlClean(params.modelId, 200),
      datasetId: mlClean(params.datasetId, 200),
      status: "running",
      hyperparams: {
        learningRate: mlNum(params.learningRate, 0.001),
        batchSize: mlNum(params.batchSize, 32),
        epochs: mlNum(params.epochs, 50),
        optimizer: mlClean(params.optimizer || "adam", 30),
      },
      metrics: [],
      tags: Array.isArray(params.tags) ? params.tags.map(t => mlClean(t, 40)).slice(0, 8) : [],
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    mlList(m.experiments, userId).unshift(exp);
    saveMl();
    return { ok: true, result: { experiment: exp } };
  });

  registerLensAction("ml", "experiment-log", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const expId = mlClean(params.experimentId || params.id, 80);
    const list = mlList(m.experiments, userId);
    const exp = list.find(e => e.id === expId);
    if (!exp) return { ok: false, error: "experiment not found" };
    const point = {
      epoch: mlNum(params.epoch, exp.metrics.length + 1),
      trainLoss: mlNum(params.trainLoss, 0),
      valLoss: mlNum(params.valLoss, 0),
      accuracy: mlNum(params.accuracy, 0),
      learningRate: mlNum(params.learningRate, exp.hyperparams.learningRate),
    };
    exp.metrics.push(point);
    saveMl();
    return { ok: true, result: { experiment: exp, logged: point } };
  });

  registerLensAction("ml", "experiment-finish", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const expId = mlClean(params.experimentId || params.id, 80);
    const exp = mlList(m.experiments, userId).find(e => e.id === expId);
    if (!exp) return { ok: false, error: "experiment not found" };
    exp.status = params.failed ? "failed" : "completed";
    exp.completedAt = new Date().toISOString();
    saveMl();
    return { ok: true, result: { experiment: exp } };
  });

  registerLensAction("ml", "experiment-list", (ctx, _a, _params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const list = mlList(m.experiments, mlActor(ctx));
    return { ok: true, result: { count: list.length, experiments: list } };
  });

  registerLensAction("ml", "experiment-delete", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const expId = mlClean(params.experimentId || params.id, 80);
    const list = mlList(m.experiments, userId);
    const idx = list.findIndex(e => e.id === expId);
    if (idx < 0) return { ok: false, error: "experiment not found" };
    list.splice(idx, 1);
    saveMl();
    return { ok: true, result: { deleted: expId, remaining: list.length } };
  });

  // ─── Dataset hub — browse HF datasets + per-user versioned datasets ───
  registerLensAction("ml", "dataset-hub", async (_ctx, _a, params = {}) => {
    try {
      const q = mlClean(params.query || params.search || "", 120);
      const sort = mlClean(params.sort || "downloads", 20);
      const limit = Math.min(50, Math.max(1, mlNum(params.limit, 24)));
      const parts = [`limit=${limit}`, `sort=${encodeURIComponent(sort)}`, "full=true"];
      if (q) parts.push(`search=${encodeURIComponent(q)}`);
      const raw = await cachedFetchJson(`https://huggingface.co/api/datasets?${parts.join("&")}`, { ttlMs: 600000 });
      const datasets = (Array.isArray(raw) ? raw : []).map(d => ({
        id: d.id,
        name: (d.id || "").split("/").pop(),
        author: (d.id || "").split("/")[0] || "unknown",
        downloads: d.downloads || 0,
        likes: d.likes || 0,
        tags: Array.isArray(d.tags) ? d.tags.slice(0, 8) : [],
        updatedAt: d.lastModified || null,
        url: `https://huggingface.co/datasets/${d.id}`,
      }));
      return { ok: true, result: { count: datasets.length, query: q, datasets, source: "huggingface-hub" } };
    } catch (e) {
      return { ok: false, error: `huggingface datasets unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("ml", "dataset-register", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const name = mlClean(params.name, 160);
    if (!name) return { ok: false, error: "dataset name required" };
    const list = mlList(m.datasets, userId);
    const existing = list.find(d => d.name === name);
    const train = mlNum(params.train, 0.7), val = mlNum(params.val, 0.15), test = mlNum(params.test, 0.15);
    const version = existing ? (existing.versions.length + 1) : 1;
    const versionRow = {
      version, samples: mlNum(params.samples, 0), features: mlNum(params.features, 0),
      sizeMb: mlNum(params.sizeMb, 0), note: mlClean(params.note, 200), createdAt: new Date().toISOString(),
    };
    if (existing) {
      existing.versions.unshift(versionRow);
      existing.latestVersion = version;
      saveMl();
      return { ok: true, result: { dataset: existing, newVersion: version } };
    }
    const ds = {
      id: mlId("ds"), name, type: mlClean(params.type || "tabular", 30),
      splits: { train, val, test }, latestVersion: 1, versions: [versionRow], createdAt: new Date().toISOString(),
    };
    list.unshift(ds);
    saveMl();
    return { ok: true, result: { dataset: ds, newVersion: 1 } };
  });

  registerLensAction("ml", "dataset-list", (ctx, _a, _params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const list = mlList(m.datasets, mlActor(ctx));
    return { ok: true, result: { count: list.length, datasets: list } };
  });

  // ─── Model comparison — leaderboard / side-by-side eval ──────────────
  registerLensAction("ml", "model-compare", (ctx, _a, params = {}) => {
    const entries = Array.isArray(params.models) ? params.models : [];
    if (entries.length < 2) {
      // fall back to comparing completed experiments
      const m = getMlState();
      const exps = m ? mlList(m.experiments, mlActor(ctx)).filter(e => e.metrics.length > 0) : [];
      if (exps.length < 2) return { ok: false, error: "provide 2+ models, or run 2+ experiments to compare" };
      const rows = exps.map(e => {
        const last = e.metrics[e.metrics.length - 1];
        return { name: e.name, accuracy: last.accuracy, valLoss: last.valLoss, epochs: e.metrics.length, source: "experiment" };
      });
      const ranked = [...rows].sort((a, b) => (b.accuracy - a.accuracy) || (a.valLoss - b.valLoss));
      return { ok: true, result: { count: rows.length, leaderboard: ranked.map((r, i) => ({ rank: i + 1, ...r })), winner: ranked[0]?.name } };
    }
    const metricKeys = ["accuracy", "f1", "precision", "recall", "auc"];
    const rows = entries.map(e => {
      const name = mlClean(e.name || e.modelId || "model", 160);
      const r = { name };
      metricKeys.forEach(k => { if (e[k] != null) r[k] = mlNum(e[k]); });
      r.score = metricKeys.reduce((s, k) => s + (r[k] || 0), 0) / metricKeys.filter(k => r[k] != null).length || 0;
      r.latencyMs = e.latencyMs != null ? mlNum(e.latencyMs) : null;
      r.paramsM = e.paramsM != null ? mlNum(e.paramsM) : null;
      return r;
    });
    const ranked = [...rows].sort((a, b) => b.score - a.score);
    return {
      ok: true,
      result: {
        count: rows.length,
        leaderboard: ranked.map((r, i) => ({ rank: i + 1, ...r, score: Math.round(r.score * 1000) / 1000 })),
        winner: ranked[0]?.name,
        metrics: metricKeys,
      },
    };
  });

  // ─── AutoML / pipeline templates — guided model-building flows ────────
  registerLensAction("ml", "automl-templates", (_ctx, _a, params = {}) => {
    const task = mlClean(params.task || "", 60).toLowerCase();
    const TEMPLATES = [
      {
        id: "tabular-classification", task: "classification", title: "Tabular Classification",
        description: "Predict a categorical label from structured/tabular features.",
        steps: ["Profile dataset & handle nulls", "Encode categoricals + scale numerics", "Train/val/test split (70/15/15)", "Baseline: gradient-boosted trees", "Tune hyperparameters via CV", "Evaluate accuracy / F1 / confusion matrix"],
        recommendedModels: ["xgboost", "lightgbm", "random-forest"], estimatedTime: "10-30 min",
      },
      {
        id: "tabular-regression", task: "regression", title: "Tabular Regression",
        description: "Predict a continuous numeric value from structured features.",
        steps: ["Profile dataset", "Feature engineering & scaling", "Train/val/test split", "Baseline: gradient boosting", "Tune via cross-validation", "Evaluate RMSE / MAE / R²"],
        recommendedModels: ["xgboost", "linear-regression", "random-forest"], estimatedTime: "10-30 min",
      },
      {
        id: "text-classification", task: "classification", title: "Text Classification",
        description: "Fine-tune a transformer to classify text (sentiment, topic, intent).",
        steps: ["Tokenize corpus", "Split & balance classes", "Load pretrained encoder (DistilBERT)", "Fine-tune with low LR", "Evaluate F1 per class", "Export for inference"],
        recommendedModels: ["distilbert-base-uncased", "bert-base-uncased", "roberta-base"], estimatedTime: "30-90 min",
      },
      {
        id: "image-classification", task: "classification", title: "Image Classification",
        description: "Fine-tune a vision backbone to classify images.",
        steps: ["Build labeled image splits", "Apply augmentation", "Load pretrained backbone (ViT/ResNet)", "Fine-tune head then full model", "Evaluate top-1 / top-5", "Deploy as endpoint"],
        recommendedModels: ["google/vit-base-patch16-224", "microsoft/resnet-50"], estimatedTime: "1-3 hrs",
      },
      {
        id: "clustering", task: "clustering", title: "Unsupervised Clustering",
        description: "Discover groups in unlabeled data.",
        steps: ["Profile & scale features", "Reduce dimensionality (PCA/UMAP)", "Choose k via elbow/silhouette", "Run KMeans or HDBSCAN", "Profile cluster characteristics"],
        recommendedModels: ["kmeans", "hdbscan", "gaussian-mixture"], estimatedTime: "5-15 min",
      },
    ];
    const filtered = task ? TEMPLATES.filter(t => t.task === task || t.id.includes(task)) : TEMPLATES;
    return { ok: true, result: { count: filtered.length, task: task || "all", templates: filtered } };
  });

  // ─── Deployment — publish a model as a callable endpoint ─────────────
  registerLensAction("ml", "deploy-create", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const modelId = mlClean(params.modelId || params.model, 200);
    const name = mlClean(params.name || modelId, 160);
    if (!modelId) return { ok: false, error: "modelId required" };
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "model";
    const dep = {
      id: mlId("dep"), modelId, modelName: name,
      version: mlClean(params.version || "1.0.0", 20),
      status: "active",
      endpoint: `/api/ml/serve/${slug}-${Math.random().toString(36).slice(2, 6)}`,
      replicas: Math.max(1, mlNum(params.replicas, 1)),
      requestsPerSec: 0, avgLatency: 0, errorRate: 0,
      createdAt: new Date().toISOString(),
    };
    mlList(m.deployments, userId).unshift(dep);
    saveMl();
    return { ok: true, result: { deployment: dep } };
  });

  registerLensAction("ml", "deploy-list", (ctx, _a, _params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const list = mlList(m.deployments, mlActor(ctx));
    return { ok: true, result: { count: list.length, deployments: list } };
  });

  registerLensAction("ml", "deploy-scale", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const dep = mlList(m.deployments, mlActor(ctx)).find(d => d.id === mlClean(params.deploymentId || params.id, 80));
    if (!dep) return { ok: false, error: "deployment not found" };
    dep.replicas = Math.min(16, Math.max(1, mlNum(params.replicas, dep.replicas + 1)));
    dep.status = "scaling";
    saveMl();
    return { ok: true, result: { deployment: dep } };
  });

  registerLensAction("ml", "deploy-stop", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const list = mlList(m.deployments, mlActor(ctx));
    const dep = list.find(d => d.id === mlClean(params.deploymentId || params.id, 80));
    if (!dep) return { ok: false, error: "deployment not found" };
    dep.status = "inactive";
    saveMl();
    return { ok: true, result: { deployment: dep } };
  });

  // ─── Spaces-style shareable demo apps ────────────────────────────────
  registerLensAction("ml", "space-create", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const userId = mlActor(ctx);
    const title = mlClean(params.title || params.name, 160);
    const modelId = mlClean(params.modelId || params.model, 200);
    if (!title) return { ok: false, error: "space title required" };
    if (!modelId) return { ok: false, error: "modelId required" };
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "space";
    const space = {
      id: mlId("space"), title, modelId,
      description: mlClean(params.description, 500),
      sdk: mlClean(params.sdk || "gradio", 20),
      task: mlClean(params.task || "text-generation", 60),
      visibility: params.private ? "private" : "public",
      url: `/lenses/ml/space/${slug}`,
      likes: 0, views: 0,
      createdAt: new Date().toISOString(),
    };
    mlList(m.spaces, userId).unshift(space);
    saveMl();
    return { ok: true, result: { space } };
  });

  registerLensAction("ml", "space-list", (ctx, _a, _params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const list = mlList(m.spaces, mlActor(ctx));
    return { ok: true, result: { count: list.length, spaces: list } };
  });

  registerLensAction("ml", "space-delete", (ctx, _a, params = {}) => {
    const m = getMlState(); if (!m) return { ok: false, error: "STATE unavailable" };
    const list = mlList(m.spaces, mlActor(ctx));
    const idx = list.findIndex(s => s.id === mlClean(params.spaceId || params.id, 80));
    if (idx < 0) return { ok: false, error: "space not found" };
    list.splice(idx, 1);
    saveMl();
    return { ok: true, result: { deleted: true, remaining: list.length } };
  });
}
