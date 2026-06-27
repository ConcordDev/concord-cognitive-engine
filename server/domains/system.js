// server/domains/system.js
//
// System Lens backend — live observability for the Concord cognitive OS
// itself (the "Datadog / Grafana" of the platform). Surfaces the realtime
// telemetry the cartographer static report cannot: process time-series
// metrics, fired-alert evaluation, server log search, per-heartbeat health,
// request traces, customizable dashboards, and historical coverage/drift
// trend snapshots.
//
// All data here is REAL: process.memoryUsage()/cpuUsage()/uptime, the
// in-process logger buffer, the live heartbeat registry, and per-user
// persisted state in globalThis._concordSTATE. No mock/seed/demo values.
//
// Every handler is wrapped so it returns { ok, result?, error? } and
// never throws — heartbeat/test-safety invariant.

import logger from "../logger.js";
import { listHeartbeatModules } from "../emergent/heartbeat-registry.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

// REGISTRATION (saved-class fix, 2026-06): this file used to register through
// the legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `system.*`
// telemetry macro (sample / metrics / alerts / logs / heartbeat-health /
// traces / dashboard-* / history-* / live-status / alert-ack / trace-record)
// was invisible to runMacro and to POST /api/lens/run → every call hit
// `unknown_macro`, leaving the System Lens telemetry panels (MetricsPanel,
// AlertsPanel, LogViewer, HeartbeatHealthPanel, TracesPanel, CustomDashboard,
// TrendPanel, useLiveStatus) dead-wired. It is now wired through the canonical
// `register` (MACROS) registry via `registerSystemActions(register)` in
// server.js — reachable BOTH via POST /api/lens/run AND via runMacro (which the
// contract engine + macro-assassin + behavior-smoke harness drive).
//
// NAME-COLLISION NOTE: server.js ALSO registers a distinct set of inline
// `system.*` macros (analogize, autogen, cartograph, continuity, dream,
// evolution, status, synthesize — the cognitive-OS introspection set). This
// module's macros (the live-observability/telemetry set above) use DISJOINT
// names — no overlap, no duplicate registration. Verified by grep at fix time.
//
// To keep the verified handler bodies below byte-for-byte identical, the
// default export adapts the canonical 2-arg `(ctx, input)` signature back to
// the legacy `(ctx, artifact, params)` shape via the `registerLensAction` shim
// — `params` (and `artifact.data`) carry the input, identical to what
// `/api/lens/run` would have built.
//
// Fail-CLOSED numeric guard: macros that read a numeric `limit` reject a
// poisoned numeric input (NaN/Infinity/1e308/negative) instead of silently
// clamping it to an accepted value (the macro-assassin's V2 vector probes
// exactly this). Copied from server/domains/literary.js.

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative). An absent/null
// field is fine (the handler uses its default). Returns null when clean, else
// the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

// ── State helpers ─────────────────────────────────────────────────────────
function getSystemState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.systemLens) STATE.systemLens = {};
  const s = STATE.systemLens;
  // Ring buffer of process samples (shared, not per-user — it is the box).
  if (!Array.isArray(s.metricSamples)) s.metricSamples = [];
  // Ring buffer of request traces (shared).
  if (!Array.isArray(s.traces)) s.traces = [];
  // Per-user acknowledged alert keys: userId -> Map(alertKey -> { at, note })
  if (!(s.ackedAlerts instanceof Map)) s.ackedAlerts = new Map();
  // Per-user dashboard layouts: userId -> Array<panel>
  if (!(s.dashboards instanceof Map)) s.dashboards = new Map();
  // Historical coverage/drift snapshots (shared timeline).
  if (!Array.isArray(s.history)) s.history = [];
  // Monotonic process-start baseline for CPU delta computation.
  if (!s.lastCpu) s.lastCpu = { usage: safeCpuUsage(), at: Date.now() };
  return s;
}

function saveSystem() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
  }
}

const sysActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
const sysId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const SAMPLE_CAP = 720;   // ~3h at 15s cadence
const TRACE_CAP = 500;
const HISTORY_CAP = 365;

function safeCpuUsage() {
  try { return process.cpuUsage(); } catch { return { user: 0, system: 0 }; }
}

// ── Sampling ──────────────────────────────────────────────────────────────
// Captures one process telemetry point. The frontend calls system.sample on
// its poll interval; the macro both records and returns the fresh sample so
// the time-series builds up purely from real observations.
function captureSample(s) {
  const now = Date.now();
  let mem = { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 };
  try { mem = process.memoryUsage(); } catch { /* keep zeros */ }

  // CPU percent over the interval since the last sample.
  const cpu = safeCpuUsage();
  const prev = s.lastCpu || { usage: cpu, at: now };
  const elapsedUs = Math.max(1, (now - prev.at) * 1000);
  const cpuUs = (cpu.user - prev.usage.user) + (cpu.system - prev.usage.system);
  const cpuPct = clamp(Math.round((cpuUs / elapsedUs) * 100 * 10) / 10, 0, 100);
  s.lastCpu = { usage: cpu, at: now };

  let uptime = 0, loadAvg = [0, 0, 0];
  try { uptime = Math.round(process.uptime()); } catch { /* 0 */ }
  try {
    // os.loadavg via dynamic require avoids a top-level import on a rarely-hit path.
    loadAvg = process.platform === "win32" ? [0, 0, 0] : (globalThis.__concordLoadAvg?.() ?? [0, 0, 0]);
  } catch { /* keep zeros */ }

  const reqTotal = globalThis.__concordHttpRequestsTotal ?? 0;
  const prevReq = s.lastReqTotal ?? reqTotal;
  const reqDelta = Math.max(0, reqTotal - prevReq);
  const reqRate = (now - (s.lastReqAt ?? now)) > 0
    ? Math.round((reqDelta / ((now - (s.lastReqAt ?? now)) / 1000)) * 100) / 100
    : 0;
  s.lastReqTotal = reqTotal;
  s.lastReqAt = now;

  const sample = {
    at: new Date(now).toISOString(),
    ts: now,
    rssMB: Math.round(mem.rss / 1048576 * 10) / 10,
    heapUsedMB: Math.round(mem.heapUsed / 1048576 * 10) / 10,
    heapTotalMB: Math.round(mem.heapTotal / 1048576 * 10) / 10,
    externalMB: Math.round((mem.external || 0) / 1048576 * 10) / 10,
    heapPct: mem.heapTotal ? Math.round((mem.heapUsed / mem.heapTotal) * 1000) / 10 : 0,
    cpuPct,
    uptimeSec: uptime,
    loadAvg1: Math.round((loadAvg[0] || 0) * 100) / 100,
    requestsTotal: reqTotal,
    requestRate: reqRate,
  };
  s.metricSamples.push(sample);
  if (s.metricSamples.length > SAMPLE_CAP) s.metricSamples.splice(0, s.metricSamples.length - SAMPLE_CAP);
  return sample;
}

// ── Heartbeat health ──────────────────────────────────────────────────────
// Joins the static registry with whatever runtime telemetry the governor
// has recorded on STATE.heartbeatRuntime (last-run / error / skip counters).
function heartbeatHealth(STATE) {
  const modules = listHeartbeatModules();
  const runtime = STATE?.heartbeatRuntime instanceof Map
    ? STATE.heartbeatRuntime
    : (STATE?.heartbeatRuntime && typeof STATE.heartbeatRuntime === "object"
        ? new Map(Object.entries(STATE.heartbeatRuntime))
        : new Map());
  return modules.map((m) => {
    const rt = runtime.get(m.id) || {};
    const lastRunAt = rt.lastRunAt || null;
    const ageSec = lastRunAt ? Math.round((Date.now() - new Date(lastRunAt).getTime()) / 1000) : null;
    const errorCount = Number(rt.errorCount) || 0;
    const skipCount = Number(rt.skipCount) || 0;
    const runCount = Number(rt.runCount) || 0;
    // Health: error if any errors, stale if not run within 4x its interval.
    const intervalSec = m.frequency * 15;
    let health = "ok";
    if (errorCount > 0) health = "error";
    else if (ageSec != null && ageSec > intervalSec * 4) health = "stale";
    else if (lastRunAt == null) health = "pending";
    return {
      id: m.id,
      frequency: m.frequency,
      intervalSec,
      neverDisable: m.neverDisable,
      lastRunAt,
      lastRunAgeSec: ageSec,
      runCount,
      errorCount,
      skipCount,
      lastError: rt.lastError || null,
      health,
    };
  });
}

// ── Prometheus alert-rule loading + evaluation ────────────────────────────
// Reads monitoring/prometheus/alerts.yml and extracts the rule list. The
// YAML is hand-shaped and shallow; a tiny line scanner pulls out the fields
// we surface (alert name, severity, for, summary, description). We do not
// re-implement PromQL — instead, a small set of well-known expressions are
// evaluated against the live sample so the UI can show "firing" status for
// the ones we can actually check locally.
function parseAlertRules(yamlText) {
  const rules = [];
  const lines = yamlText.split(/\r?\n/);
  let cur = null;
  let inAnnotations = false;
  let inLabels = false;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    const alertM = trimmed.match(/^-?\s*alert:\s*(.+)$/);
    if (alertM) {
      if (cur) rules.push(cur);
      cur = { name: alertM[1].trim(), expr: "", for: "", severity: "", summary: "", description: "" };
      inAnnotations = false; inLabels = false;
      continue;
    }
    if (!cur) continue;
    if (/^expr:/.test(trimmed)) { cur.expr = trimmed.replace(/^expr:\s*/, "").trim(); continue; }
    if (/^for:/.test(trimmed)) { cur.for = trimmed.replace(/^for:\s*/, "").trim(); continue; }
    if (/^labels:/.test(trimmed)) { inLabels = true; inAnnotations = false; continue; }
    if (/^annotations:/.test(trimmed)) { inAnnotations = true; inLabels = false; continue; }
    if (inLabels) {
      const sev = trimmed.match(/^severity:\s*(.+)$/);
      if (sev) cur.severity = sev[1].trim().replace(/^["']|["']$/g, "");
    }
    if (inAnnotations) {
      const sum = trimmed.match(/^summary:\s*(.+)$/);
      const desc = trimmed.match(/^description:\s*(.+)$/);
      if (sum) cur.summary = sum[1].trim().replace(/^["']|["']$/g, "");
      if (desc) cur.description = desc[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  if (cur) rules.push(cur);
  return rules;
}

// Locally-evaluable alerts: map a known rule name to a predicate over the
// latest sample + heartbeat health. Rules not in this map are surfaced as
// "external" (Prometheus owns evaluation) but still listed.
function evaluateAlert(rule, sample, hbHealth) {
  const name = rule.name;
  if (name === "ConcordHighMemory" && sample) {
    return { evaluable: true, firing: sample.heapPct > 85, observed: `${sample.heapPct}% heap` };
  }
  if (name === "ConcordMemoryCritical" && sample) {
    return { evaluable: true, firing: sample.heapUsedMB * 1048576 > 1.7e9, observed: `${sample.heapUsedMB}MB heap` };
  }
  if (name === "ConcordHeartbeatStopped") {
    const anyOk = hbHealth.some((h) => h.health === "ok");
    return { evaluable: true, firing: hbHealth.length > 0 && !anyOk, observed: `${hbHealth.filter((h) => h.health === "ok").length}/${hbHealth.length} heartbeats healthy` };
  }
  if (name === "ConcordHeartbeatOverrun") {
    const skipped = hbHealth.reduce((n, h) => n + h.skipCount, 0);
    return { evaluable: true, firing: skipped > 0, observed: `${skipped} skipped ticks` };
  }
  return { evaluable: false, firing: false, observed: "evaluated by Prometheus" };
}

async function loadAlertRules() {
  // monitoring/prometheus/alerts.yml lives at <repo>/monitoring/...
  const candidates = [
    path.resolve(import.meta.dirname || ".", "..", "..", "monitoring", "prometheus", "alerts.yml"),
    path.resolve(import.meta.dirname || ".", "..", "monitoring", "prometheus", "alerts.yml"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf-8");
      return { rules: parseAlertRules(raw), path: p };
    } catch { /* try next */ }
  }
  return { rules: [], path: null };
}

// ── Coverage/drift trend snapshots ────────────────────────────────────────
async function loadCartographStats() {
  const candidates = [
    path.resolve(import.meta.dirname || ".", "..", "..", "audit", "cartograph", "SYSTEMS.json"),
    path.resolve(import.meta.dirname || ".", "..", "audit", "cartograph", "SYSTEMS.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf-8");
      const j = JSON.parse(raw);
      return { stats: j.stats || {}, drift: Array.isArray(j.drift) ? j.drift : [], generatedAt: j.generatedAt };
    } catch { /* try next */ }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
export default function registerSystemActions(register) {
  // Legacy-convention shim: adapt the canonical `register(domain, name,
  // (ctx, input) => ...)` registry call onto the verified `(ctx, artifact,
  // params)` handler bodies below, unchanged. `params` (and `artifact.data`)
  // carry the input — identical to what `/api/lens/run` would have built.
  const registerLensAction = (domain, action, handler) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === "object" ? input : {};
      return handler(ctx, { data: inp }, inp);
    });

  // 1. Live time-series — record one real process sample and return it.
  registerLensAction("system", "sample", (_ctx, _artifact, _params) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const sample = captureSample(s);
      saveSystem();
      return { ok: true, result: sample };
    } catch (e) {
      return { ok: false, error: `sample failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 1b. Time-series read — full ring buffer, optionally windowed.
  registerLensAction("system", "metrics", (_ctx, _artifact, params = {}) => {
    try {
      const badNum = badNumericField(params, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      // Always capture a fresh point so the chart is never empty on first load.
      if (s.metricSamples.length === 0) captureSample(s);
      const limit = clamp(parseInt(params.limit, 10) || 240, 1, SAMPLE_CAP);
      const samples = s.metricSamples.slice(-limit);
      const latest = samples[samples.length - 1] || null;
      const peakHeap = samples.reduce((m, x) => Math.max(m, x.heapUsedMB), 0);
      const avgCpu = samples.length
        ? Math.round((samples.reduce((a, x) => a + x.cpuPct, 0) / samples.length) * 10) / 10
        : 0;
      return {
        ok: true,
        result: {
          samples,
          count: samples.length,
          latest,
          peakHeapMB: peakHeap,
          avgCpuPct: avgCpu,
          capacity: SAMPLE_CAP,
        },
      };
    } catch (e) {
      return { ok: false, error: `metrics failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 2. Alerting — load Prometheus rules, evaluate the locally-checkable ones,
  //    merge per-user acknowledgements.
  registerLensAction("system", "alerts", async (ctx, _artifact, _params) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = sysActor(ctx);
      const { rules, path: alertPath } = await loadAlertRules();
      const sample = s.metricSamples[s.metricSamples.length - 1] || (s.metricSamples.length === 0 ? captureSample(s) : null);
      const hbHealth = heartbeatHealth(globalThis._concordSTATE);
      const acked = s.ackedAlerts.get(userId) || new Map();
      const evaluated = rules.map((r) => {
        const ev = evaluateAlert(r, sample, hbHealth);
        const ackEntry = acked.get(r.name) || null;
        return {
          name: r.name,
          severity: r.severity || "info",
          expr: r.expr,
          for: r.for,
          summary: r.summary,
          description: r.description,
          evaluable: ev.evaluable,
          firing: ev.firing,
          observed: ev.observed,
          acknowledged: !!ackEntry,
          ackedAt: ackEntry?.at || null,
          ackNote: ackEntry?.note || null,
        };
      });
      const firing = evaluated.filter((a) => a.firing);
      return {
        ok: true,
        result: {
          rules: evaluated,
          ruleCount: evaluated.length,
          firingCount: firing.length,
          firing,
          unacknowledgedFiring: firing.filter((a) => !a.acknowledged).length,
          rulesFile: alertPath,
        },
      };
    } catch (e) {
      return { ok: false, error: `alerts failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 2b. Acknowledge / un-acknowledge a fired alert (per-user).
  registerLensAction("system", "alert-ack", (ctx, _artifact, params = {}) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = sysActor(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "alert name required" };
      let acked = s.ackedAlerts.get(userId);
      if (!acked) { acked = new Map(); s.ackedAlerts.set(userId, acked); }
      if (params.unack === true) {
        acked.delete(name);
        saveSystem();
        return { ok: true, result: { name, acknowledged: false } };
      }
      const entry = { at: new Date().toISOString(), note: String(params.note || "").slice(0, 280) };
      acked.set(name, entry);
      saveSystem();
      return { ok: true, result: { name, acknowledged: true, ackedAt: entry.at, ackNote: entry.note } };
    } catch (e) {
      return { ok: false, error: `alert-ack failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 3. Log viewer / search over the in-process logger buffer.
  registerLensAction("system", "logs", (_ctx, _artifact, params = {}) => {
    try {
      const badNum = badNumericField(params, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const filters = {};
      if (params.level && ["error", "warn", "info", "debug"].includes(params.level)) filters.level = params.level;
      if (params.source) filters.source = String(params.source).slice(0, 80);
      if (params.lens) filters.lens = String(params.lens).slice(0, 80);
      if (params.since) filters.since = String(params.since);
      if (params.search) filters.search = String(params.search).slice(0, 200);
      filters.limit = clamp(parseInt(params.limit, 10) || 200, 1, 1000);
      const entries = logger.query(filters);
      // Reverse-chron for the viewer; tally levels for the summary strip.
      const tally = { error: 0, warn: 0, info: 0, debug: 0 };
      for (const e of entries) { if (tally[e.level] != null) tally[e.level]++; }
      const sources = [...new Set(entries.map((e) => e.source).filter(Boolean))].sort();
      return {
        ok: true,
        result: {
          entries: entries.slice().reverse(),
          count: entries.length,
          tally,
          sources,
          bufferSize: logger.getBuffer().length,
        },
      };
    } catch (e) {
      return { ok: false, error: `logs failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 5. Per-heartbeat health — last-run, error/skip counts per module.
  registerLensAction("system", "heartbeat-health", (_ctx, _artifact, _params) => {
    try {
      const STATE = globalThis._concordSTATE;
      const modules = heartbeatHealth(STATE);
      const summary = {
        total: modules.length,
        ok: modules.filter((m) => m.health === "ok").length,
        stale: modules.filter((m) => m.health === "stale").length,
        error: modules.filter((m) => m.health === "error").length,
        pending: modules.filter((m) => m.health === "pending").length,
        booted: !!(STATE && STATE.heartbeatRuntime),
      };
      return { ok: true, result: { modules, summary } };
    } catch (e) {
      return { ok: false, error: `heartbeat-health failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 6. Distributed-trace / request-latency. Records a trace point and
  //    returns the recent window with latency percentiles. The HTTP layer
  //    pushes spans via globalThis.__concordRecordTrace; this macro also
  //    accepts a manual span (e.g. a lens self-timing its own call).
  registerLensAction("system", "trace-record", (ctx, _artifact, params = {}) => {
    try {
      const badNum = badNumericField(params, ["durationMs", "status"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const span = {
        id: sysId("trc"),
        at: new Date().toISOString(),
        route: String(params.route || "unknown").slice(0, 200),
        method: String(params.method || "GET").slice(0, 10).toUpperCase(),
        durationMs: clamp(Number(params.durationMs) || 0, 0, 600000),
        status: clamp(parseInt(params.status, 10) || 200, 100, 599),
        actor: sysActor(ctx),
      };
      s.traces.push(span);
      if (s.traces.length > TRACE_CAP) s.traces.splice(0, s.traces.length - TRACE_CAP);
      saveSystem();
      return { ok: true, result: span };
    } catch (e) {
      return { ok: false, error: `trace-record failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("system", "traces", (_ctx, _artifact, params = {}) => {
    try {
      const badNum = badNumericField(params, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      // Pull from the global HTTP ring buffer if the server layer populated one.
      const external = Array.isArray(globalThis.__concordTraceBuffer) ? globalThis.__concordTraceBuffer : [];
      const merged = [...s.traces, ...external].slice(-TRACE_CAP);
      const limit = clamp(parseInt(params.limit, 10) || 100, 1, TRACE_CAP);
      const spans = merged.slice(-limit);
      const durations = spans.map((x) => x.durationMs).sort((a, b) => a - b);
      const pct = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.floor(p / 100 * durations.length))] : 0;
      const errors = spans.filter((x) => x.status >= 400).length;
      // Per-route rollup.
      const byRoute = new Map();
      for (const sp of spans) {
        const r = byRoute.get(sp.route) || { route: sp.route, count: 0, totalMs: 0, errors: 0, maxMs: 0 };
        r.count++; r.totalMs += sp.durationMs; r.maxMs = Math.max(r.maxMs, sp.durationMs);
        if (sp.status >= 400) r.errors++;
        byRoute.set(sp.route, r);
      }
      const routes = [...byRoute.values()]
        .map((r) => ({ ...r, avgMs: Math.round(r.totalMs / r.count) }))
        .sort((a, b) => b.avgMs - a.avgMs);
      return {
        ok: true,
        result: {
          spans: spans.slice().reverse(),
          count: spans.length,
          p50: pct(50), p95: pct(95), p99: pct(99),
          maxMs: durations.length ? durations[durations.length - 1] : 0,
          errorRate: spans.length ? Math.round(errors / spans.length * 1000) / 10 : 0,
          routes: routes.slice(0, 30),
        },
      };
    } catch (e) {
      return { ok: false, error: `traces failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 7. Customizable dashboard panels — per-user layout persistence.
  registerLensAction("system", "dashboard-load", (ctx, _artifact, _params) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = sysActor(ctx);
      const panels = s.dashboards.get(userId) || null;
      // Default layout when the user has never customised — the canonical
      // observability panel set.
      const defaultPanels = [
        { id: "p_heap", kind: "metric", metric: "heapUsedMB", title: "Heap Used (MB)", w: 2 },
        { id: "p_cpu", kind: "metric", metric: "cpuPct", title: "CPU %", w: 1 },
        { id: "p_req", kind: "metric", metric: "requestRate", title: "Request Rate", w: 1 },
        { id: "p_alerts", kind: "alerts", title: "Fired Alerts", w: 2 },
        { id: "p_hb", kind: "heartbeats", title: "Heartbeat Health", w: 2 },
        { id: "p_traces", kind: "traces", title: "Request Latency", w: 2 },
      ];
      return {
        ok: true,
        result: {
          panels: panels || defaultPanels,
          isDefault: !panels,
          panelCount: (panels || defaultPanels).length,
        },
      };
    } catch (e) {
      return { ok: false, error: `dashboard-load failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("system", "dashboard-save", (ctx, _artifact, params = {}) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = sysActor(ctx);
      const raw = Array.isArray(params.panels) ? params.panels : null;
      if (!raw) return { ok: false, error: "panels array required" };
      const ALLOWED_KINDS = new Set(["metric", "alerts", "heartbeats", "traces", "logs", "coverage", "drift"]);
      const ALLOWED_METRICS = new Set(["heapUsedMB", "heapTotalMB", "rssMB", "cpuPct", "requestRate", "heapPct", "loadAvg1"]);
      const panels = raw.slice(0, 24).map((p, i) => {
        const kind = ALLOWED_KINDS.has(p?.kind) ? p.kind : "metric";
        const panel = {
          id: String(p?.id || sysId("pnl")).slice(0, 40),
          kind,
          title: String(p?.title || `Panel ${i + 1}`).slice(0, 60),
          w: clamp(parseInt(p?.w, 10) || 1, 1, 3),
        };
        if (kind === "metric") {
          panel.metric = ALLOWED_METRICS.has(p?.metric) ? p.metric : "heapUsedMB";
        }
        return panel;
      });
      s.dashboards.set(userId, panels);
      saveSystem();
      return { ok: true, result: { panels, panelCount: panels.length } };
    } catch (e) {
      return { ok: false, error: `dashboard-save failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("system", "dashboard-reset", (ctx, _artifact, _params) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      s.dashboards.delete(sysActor(ctx));
      saveSystem();
      return { ok: true, result: { reset: true } };
    } catch (e) {
      return { ok: false, error: `dashboard-reset failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 8. Historical coverage/drift trend — record a snapshot from the current
  //    cartograph report, and read back the accumulated timeline.
  registerLensAction("system", "history-snapshot", async (_ctx, _artifact, _params) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const carto = await loadCartographStats();
      if (!carto) {
        return { ok: false, error: "cartograph_not_run", reason: "cartograph_not_run" };
      }
      const st = carto.stats;
      const coveragePct = st.coverageInScope
        ? Math.round((st.coveragePresent / st.coverageInScope) * 1000) / 10
        : 0;
      const snapshot = {
        at: new Date().toISOString(),
        coveragePct,
        coveragePresent: st.coveragePresent || 0,
        coverageInScope: st.coverageInScope || 0,
        driftCount: carto.drift.length,
        deadTableCount: st.deadTableCount || 0,
        dormantModuleCount: st.dormantModuleCount || 0,
        heartbeatCount: st.heartbeatCount || 0,
        macroCount: st.macroCount || 0,
        cartographGeneratedAt: carto.generatedAt || null,
      };
      // De-dupe: skip if the previous snapshot is identical bar the timestamp.
      const prev = s.history[s.history.length - 1];
      const sameAsPrev = prev
        && prev.coveragePct === snapshot.coveragePct
        && prev.driftCount === snapshot.driftCount
        && prev.cartographGeneratedAt === snapshot.cartographGeneratedAt;
      if (!sameAsPrev) {
        s.history.push(snapshot);
        if (s.history.length > HISTORY_CAP) s.history.splice(0, s.history.length - HISTORY_CAP);
        saveSystem();
      }
      return { ok: true, result: { snapshot, recorded: !sameAsPrev, historyLength: s.history.length } };
    } catch (e) {
      return { ok: false, error: `history-snapshot failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("system", "history", (_ctx, _artifact, params = {}) => {
    try {
      const badNum = badNumericField(params, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const limit = clamp(parseInt(params.limit, 10) || HISTORY_CAP, 1, HISTORY_CAP);
      const snapshots = s.history.slice(-limit);
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const trend = (first && last) ? {
        coverageDelta: Math.round((last.coveragePct - first.coveragePct) * 10) / 10,
        driftDelta: last.driftCount - first.driftCount,
        dormantDelta: last.dormantModuleCount - first.dormantModuleCount,
      } : null;
      return {
        ok: true,
        result: { snapshots, count: snapshots.length, trend, capacity: HISTORY_CAP },
      };
    } catch (e) {
      return { ok: false, error: `history failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // 4. Live-poll status — a lightweight single call the auto-refresh loop
  //    hits to fetch every realtime panel at once (sample + alert/hb counts).
  registerLensAction("system", "live-status", async (ctx, _artifact, _params) => {
    try {
      const s = getSystemState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const sample = captureSample(s);
      saveSystem();
      const hbHealth = heartbeatHealth(globalThis._concordSTATE);
      const { rules } = await loadAlertRules();
      const userId = sysActor(ctx);
      const acked = s.ackedAlerts.get(userId) || new Map();
      let firing = 0, unackedFiring = 0;
      for (const r of rules) {
        const ev = evaluateAlert(r, sample, hbHealth);
        if (ev.firing) { firing++; if (!acked.has(r.name)) unackedFiring++; }
      }
      const external = Array.isArray(globalThis.__concordTraceBuffer) ? globalThis.__concordTraceBuffer : [];
      const traceCount = s.traces.length + external.length;
      return {
        ok: true,
        result: {
          sample,
          heartbeats: {
            total: hbHealth.length,
            ok: hbHealth.filter((h) => h.health === "ok").length,
            unhealthy: hbHealth.filter((h) => h.health === "error" || h.health === "stale").length,
          },
          alerts: { firing, unacknowledgedFiring: unackedFiring },
          traceCount,
          pollAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { ok: false, error: `live-status failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
