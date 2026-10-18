// server/lib/background-governor.js
//
// Background governor: the single admission point for NON-user-facing work
// (emergent idle behaviour, minor-agent tasks, dreams, registry LLM jobs,
// embedding backfill). It limits two things:
//
//   1. CREATION  - admitCreation() is asked before a background task row is
//                  inserted (backpressure at the source: global/per-kind
//                  pending caps, per-recipient backlog, per-creator rate,
//                  dedupe). A full queue refuses new work instead of piling
//                  it up.
//   2. EXECUTION - admitExecution() is asked before a background LLM call
//                  (inflight caps, per-kind caps, per-agent rate, breaker).
//
// A circuit breaker opens when the host or the chat path is under strain
// (event-loop pressure, API/chat p95, active chats, Mac memory pressure,
// background-brain error rate, background brain/tunnel unreachable) and
// half-opens after a cooldown.
//
// Modes (CONCORD_BG_GOVERNOR):
//   shadow  (default) - every decision is computed and counted but work is
//                       still allowed (wouldAllow carries the verdict).
//   enforce           - denials are real.
//   0 / off / kill    - KILL SWITCH: all background creation + execution is
//                       refused. The kill file (CONCORD_BG_KILL_FILE, default
//                       ~/concord/bg-governor.KILL) does the same without a
//                       restart: `touch` it to stop background work, `rm` to
//                       resume.
//
// The governor never touches user-facing (conscious/chat) calls.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

let _pressure = null; // lazily-imported event-loop-pressure module
async function _loadPressure() {
  if (_pressure) return _pressure;
  try { _pressure = await import("./event-loop-pressure.js"); } catch { _pressure = {}; }
  return _pressure;
}

function _num(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return dflt;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

export function governorConfig() {
  return {
    maxPending: _num("CONCORD_BG_MAX_PENDING", 200),
    kindPendingCaps: {
      communication: _num("CONCORD_BG_MAX_PENDING_COMMUNICATION", 50),
      dream: _num("CONCORD_BG_MAX_PENDING_DREAM", 20),
      observe: _num("CONCORD_BG_MAX_PENDING_OBSERVE", 50),
      "registry-llm": _num("CONCORD_BG_MAX_PENDING_REGISTRY_LLM", 50),
    },
    recipientPendingCap: _num("CONCORD_BG_RECIPIENT_PENDING_CAP", 3),
    creatorPerHour: _num("CONCORD_BG_CREATOR_PER_HOUR", 6),
    dedupeWindowMs: _num("CONCORD_BG_DEDUPE_WINDOW_MS", 24 * 3600_000),
    maxInflight: _num("CONCORD_BG_MAX_INFLIGHT", 4),
    kindInflightCaps: {
      communication: _num("CONCORD_BG_INFLIGHT_COMMUNICATION", 2),
      dream: _num("CONCORD_BG_INFLIGHT_DREAM", 1),
      observe: _num("CONCORD_BG_INFLIGHT_OBSERVE", 2),
      embed: _num("CONCORD_BG_INFLIGHT_EMBED", 1),
    },
    agentMinIntervalMs: _num("CONCORD_BG_AGENT_MIN_INTERVAL_MS", 5 * 60_000),
    taskTtlMs: _num("CONCORD_BG_TASK_TTL_H", 6) * 3600_000,
    lagMs: _num("CONCORD_BG_LAG_MS", 200),
    apiP95Ms: _num("CONCORD_BG_API_P95_MS", 1500),
    chatP95Ms: _num("CONCORD_BG_CHAT_P95_MS", 15000),
    chatActiveMax: _num("CONCORD_BG_CHAT_ACTIVE_MAX", 3),
    memLevelMin: _num("CONCORD_BG_MEM_LEVEL_MIN", 20),
    swapFreeMinMb: _num("CONCORD_BG_SWAP_FREE_MIN_MB", 256),
    errorRateMax: _num("CONCORD_BG_ERROR_RATE_MAX", 0.2),
    cooldownMs: _num("CONCORD_BG_BREAKER_COOLDOWN_MS", 60_000),
    closeAfterProbes: _num("CONCORD_BG_BREAKER_CLOSE_PROBES", 3),
    killFile: process.env.CONCORD_BG_KILL_FILE || path.join(os.homedir(), "concord", "bg-governor.KILL"),
    statusFile: process.env.CONCORD_BG_STATUS_FILE ?? path.join(os.homedir(), "concord", "logs", "bg-governor.json"),
    bgUrl: (process.env.BRAIN_BACKGROUND_URL || "").replace(/\/+$/, ""),
  };
}

// ── state ────────────────────────────────────────────────────────────────
const S = {
  db: null,
  log: (level, event, data) => { try { console.log(JSON.stringify({ level, event, ...data, ts: new Date().toISOString() })); } catch { /* ignore */ } },
  modeOverride: null,
  timer: null,
  breaker: { state: "closed", reason: null, since: Date.now(), probesOk: 0, probeInflight: 0, trips: {} },
  signals: {},
  inflight: 0,
  inflightByKind: {},
  agentLastExec: new Map(),
  creatorTimes: new Map(),
  dedupe: new Map(),
  pending: { total: null, byKind: {}, at: 0 },
  outcomes: [],
  http: { api: [], chat: [] },
  chatActive: 0,
  bgProbe: { ok: null, fails: 0, at: 0, latencyMs: null },
  counters: newCounters(),
  recent: [],
  startedAt: Date.now(),
};

function newCounters() {
  return {
    exec: { allowed: 0, denied: {}, shadowDenied: {} },
    create: { allowed: 0, denied: {}, shadowDenied: {} },
    outcomes: { ok: 0, error: 0, errors: {} },
    expired: 0,
  };
}

function _bump(obj, key, n = 1) { obj[key] = (obj[key] || 0) + n; }

export function governorMode() {
  if (S.modeOverride) return S.modeOverride;
  const v = String(process.env.CONCORD_BG_GOVERNOR ?? "shadow").toLowerCase().trim();
  if (["0", "off", "false", "kill", "killed", "stop"].includes(v)) return "killed";
  if (["enforce", "on", "1", "true"].includes(v)) return "enforce";
  return "shadow";
}

export function isKilled() {
  if (governorMode() === "killed") return true;
  try { return fs.existsSync(governorConfig().killFile); } catch { return false; }
}

/** Runtime mode override (admin endpoint). null clears it. */
export function setGovernorMode(mode) {
  if (mode === null || mode === undefined || mode === "") { S.modeOverride = null; return governorMode(); }
  if (!["shadow", "enforce", "killed"].includes(mode)) throw new Error(`invalid mode ${mode}`);
  S.modeOverride = mode;
  S.log("warn", "bg_governor_mode", { mode });
  return mode;
}

// ── HTTP latency feed (wired from the server request logger) ──────────────
const HTTP_WINDOW_MS = { api: 120_000, chat: 600_000 };
function _isChatPath(p) { return typeof p === "string" && (p.startsWith("/api/chat") || p.startsWith("/api/conscious")); }
function _skipPath(p) {
  return typeof p !== "string" || p.startsWith("/health") || p.startsWith("/ready")
    || p.startsWith("/api/events") || p.includes("/stream") || p.startsWith("/mcp") || p.startsWith("/socket.io");
}
export function recordHttp(durationMs, reqPath) {
  if (_skipPath(reqPath) && !_isChatPath(reqPath)) return;
  const bucket = _isChatPath(reqPath) ? S.http.chat : S.http.api;
  bucket.push([Date.now(), Number(durationMs) || 0]);
  if (bucket.length > 2000) bucket.splice(0, bucket.length - 2000);
}
export function chatStarted() {
  S.chatActive++;
  let done = false;
  return () => { if (!done) { done = true; S.chatActive = Math.max(0, S.chatActive - 1); } };
}
function _p95(bucket, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (bucket.length && bucket[0][0] < cutoff) bucket.shift();
  if (!bucket.length) return { p95: 0, n: 0 };
  const s = bucket.map((x) => x[1]).sort((a, b) => a - b);
  return { p95: s[Math.max(0, Math.ceil(0.95 * s.length) - 1)], n: s.length };
}

// ── host memory signals ───────────────────────────────────────────────────
function _execOut(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}
async function _readMemory() {
  if (process.platform === "darwin") {
    const out = await _execOut("/usr/sbin/sysctl", ["-n", "kern.memorystatus_level", "vm.swapusage"]);
    if (!out) return {};
    const lines = out.trim().split("\n");
    const level = Number(lines[0]);
    const m = /free = ([\d.]+)M/.exec(lines[1] || "");
    const t = /total = ([\d.]+)M/.exec(lines[1] || "");
    return { memLevel: Number.isFinite(level) ? level : null, swapFreeMb: m ? Number(m[1]) : null, swapTotalMb: t ? Number(t[1]) : null };
  }
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const g = (k) => { const r = new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(txt); return r ? Number(r[1]) / 1024 : null; };
    const total = g("MemTotal"), avail = g("MemAvailable");
    return { memLevel: total && avail != null ? Math.round((avail / total) * 100) : null, swapFreeMb: g("SwapFree"), swapTotalMb: g("SwapTotal") };
  } catch { return {}; }
}

async function _probeBg(cfg) {
  if (!cfg.bgUrl) { S.bgProbe = { ok: null, fails: 0, at: Date.now(), latencyMs: null, configured: false }; return; }
  const t0 = Date.now();
  let ok = false;
  try {
    const r = await fetch(`${cfg.bgUrl}/api/version`, { signal: AbortSignal.timeout(2500) });
    ok = r.ok;
  } catch { ok = false; }
  S.bgProbe = { ok, fails: ok ? 0 : (S.bgProbe.fails || 0) + 1, at: Date.now(), latencyMs: Date.now() - t0, configured: true };
}

// ── breaker ───────────────────────────────────────────────────────────────
function _errorRate() {
  const cutoff = Date.now() - 15 * 60_000;
  S.outcomes = S.outcomes.filter((o) => o[0] >= cutoff).slice(-100);
  const n = S.outcomes.length;
  const errs = S.outcomes.filter((o) => !o[1]).length;
  return { n, rate: n ? errs / n : 0 };
}

/** Compute current trip reasons from the latest signals (pure w.r.t. S). */
export function currentTrips(cfg = governorConfig()) {
  const sig = S.signals;
  const trips = [];
  if (sig.eventLoopPressure) trips.push("event_loop_pressure");
  if (sig.api && sig.api.n >= 20 && sig.api.p95 > cfg.apiP95Ms) trips.push("api_p95");
  if (sig.chat && sig.chat.n >= 3 && sig.chat.p95 > cfg.chatP95Ms) trips.push("chat_p95");
  if (S.chatActive >= cfg.chatActiveMax) trips.push("chat_active");
  if (sig.memLevel != null && sig.memLevel < cfg.memLevelMin) trips.push("host_memory_pressure");
  if (sig.swapFreeMb != null && sig.swapTotalMb > 0 && sig.swapFreeMb < cfg.swapFreeMinMb) trips.push("swap_exhausted");
  if (sig.errors && sig.errors.n >= 10 && sig.errors.rate > cfg.errorRateMax) trips.push("bg_error_rate");
  if (S.bgProbe.configured && S.bgProbe.fails >= 2) trips.push("bg_brain_unreachable");
  return trips;
}

function _setBreaker(state, reason) {
  const b = S.breaker;
  if (b.state === state && b.reason === reason) return;
  const prev = b.state;
  b.state = state; b.reason = reason; b.since = Date.now(); b.probesOk = 0;
  if (state === "open" && reason) _bump(b.trips, reason);
  S.log(state === "open" ? "warn" : "info", "bg_governor_breaker", { from: prev, to: state, reason });
}

/** One evaluation pass: refresh signals and drive the breaker state machine. */
export async function evaluate() {
  const cfg = governorConfig();
  const p = await _loadPressure();
  let lag = null;
  try { lag = p.getLagSnapshot ? p.getLagSnapshot() : null; } catch { lag = null; }
  const mem = await _readMemory();
  await _probeBg(cfg);
  S.signals = {
    // Sustained (not max-sample) lag: a single spike must not stall the
    // whole background plane, a lagging loop must.
    eventLoopPressure: lag?.sustainedMs != null ? lag.sustainedMs > cfg.lagMs : false,
    lagMs: lag?.sustainedMs ?? null,
    lagMaxMs: lag?.maxMs ?? null,
    api: _p95(S.http.api, HTTP_WINDOW_MS.api),
    chat: _p95(S.http.chat, HTTP_WINDOW_MS.chat),
    chatActive: S.chatActive,
    ...mem,
    errors: _errorRate(),
    bgBrain: S.bgProbe,
    at: Date.now(),
  };
  _refreshPending();
  _maybeExpire().catch(() => { S.expiryRunning = false; });
  const trips = currentTrips(cfg);
  const b = S.breaker;
  if (trips.length) {
    if (b.state !== "open" || b.reason !== trips[0]) _setBreaker("open", trips[0]);
    else b.since = Date.now(); // keep cooling down while the trip persists
  } else if (b.state === "open" && Date.now() - b.since >= cfg.cooldownMs) {
    _setBreaker("half_open", b.reason);
  }
  _writeStatus(cfg);
  return { trips, breaker: { ...b } };
}

// ── pending-queue view (emergent_tasks) ───────────────────────────────────
function _db() { return S.db || (S.useGlobalDb ? globalThis._concordDB : null) || null; }
function _refreshPending(force = false) {
  const db = _db();
  if (!db) return;
  if (!force && Date.now() - S.pending.at < 30_000) return;
  try {
    const rows = db.prepare("SELECT task_type AS k, COUNT(*) AS n FROM emergent_tasks WHERE status = 'pending' GROUP BY task_type").all();
    const byKind = {}; let total = 0;
    for (const r of rows) { byKind[r.k] = r.n; total += r.n; }
    S.pending = { total, byKind, at: Date.now() };
  } catch { /* table missing in some test DBs */ }
}

// ── decisions ─────────────────────────────────────────────────────────────
function _record(kind, d) {
  S.recent.push({ t: Date.now(), kind, ...d });
  if (S.recent.length > 100) S.recent.splice(0, S.recent.length - 100);
}

function _finish(scope, verdict, meta, forceEnforce = false) {
  // forceEnforce: work that is new under the governor (e.g. the governed
  // embedding backfill) is enforced even while legacy paths shadow.
  const mode = forceEnforce && governorMode() === "shadow" ? "enforce" : governorMode();
  const killed = isKilled();
  const c = S.counters[scope];
  let allow;
  if (killed) { allow = false; verdict = verdict || "killed"; _bump(c.denied, "killed"); }
  else if (!verdict) { allow = true; c.allowed++; }
  else if (mode === "enforce") { allow = false; _bump(c.denied, verdict); }
  else { allow = true; c.allowed++; _bump(c.shadowDenied, verdict); }
  const out = { allow, wouldAllow: !verdict && !killed, reason: killed ? "killed" : verdict, mode: killed ? "killed" : mode };
  if (!out.wouldAllow) _record(scope, { reason: out.reason, mode: out.mode, ...meta });
  return out;
}

/**
 * Admit the CREATION of a background task.
 * @param {{kind?:string, fromId?:string|null, toId?:string|null, dedupeKey?:string|null}} req
 */
function _creationVerdict(req) {
  const cfg = governorConfig();
  const kind = req.kind || "other";
  const now = Date.now();
  let verdict = null;
  if (S.breaker.state === "open") verdict = `breaker_open:${S.breaker.reason}`;
  if (!verdict) {
    _refreshPending();
    const total = S.pending.total;
    if (total != null && total >= cfg.maxPending) verdict = "queue_full";
    const kc = cfg.kindPendingCaps[kind];
    if (!verdict && kc != null && (S.pending.byKind[kind] || 0) >= kc) verdict = `kind_queue_full:${kind}`;
  }
  if (!verdict && req.toId && _db()) {
    try {
      const n = _db().prepare("SELECT COUNT(*) AS n FROM emergent_tasks WHERE emergent_id = ? AND status = 'pending'").get(req.toId)?.n || 0;
      if (n >= cfg.recipientPendingCap) verdict = "recipient_backlog";
    } catch { /* ignore */ }
  }
  if (!verdict && req.fromId) {
    const times = (S.creatorTimes.get(req.fromId) || []).filter((t) => now - t < 3600_000);
    S.creatorTimes.set(req.fromId, times);
    if (times.length >= cfg.creatorPerHour) verdict = "creator_rate";
  }
  let key = null;
  if (req.dedupeKey) {
    key = crypto.createHash("sha1").update(String(req.dedupeKey)).digest("hex");
    const seen = S.dedupe.get(key);
    if (!verdict && seen && now - seen < cfg.dedupeWindowMs) verdict = "duplicate";
  }
  return { verdict, key, kind };
}

/**
 * Side-effect-free pre-check: would a creation be admitted right now?
 * Lets callers skip the LLM call that would produce a task the queue
 * would refuse anyway. Respects shadow mode (allow=true while shadowing).
 */
export function wouldAdmitCreation(req = {}) {
  const { verdict } = _creationVerdict(req);
  const killed = isKilled();
  const mode = killed ? "killed" : governorMode();
  const wouldAllow = !verdict && !killed;
  return { allow: killed ? false : (mode === "enforce" ? wouldAllow : true), wouldAllow, reason: killed ? "killed" : verdict, mode };
}

/**
 * Admit the CREATION of a background task.
 * @param {{kind?:string, fromId?:string|null, toId?:string|null, dedupeKey?:string|null}} req
 */
export function admitCreation(req = {}) {
  const { verdict, key, kind } = _creationVerdict(req);
  const out = _finish("create", verdict, { type: kind, from: req.fromId || null, to: req.toId || null });
  out._key = key;
  return out;
}

/** Tell the governor a task was actually inserted (after an allowed admitCreation). */
export function noteCreated(req = {}, decision = null) {
  const now = Date.now();
  if (req.fromId) {
    const times = S.creatorTimes.get(req.fromId) || [];
    times.push(now);
    S.creatorTimes.set(req.fromId, times);
    if (S.creatorTimes.size > 20000) S.creatorTimes.delete(S.creatorTimes.keys().next().value);
  }
  const key = decision?._key || (req.dedupeKey ? crypto.createHash("sha1").update(String(req.dedupeKey)).digest("hex") : null);
  if (key) {
    S.dedupe.set(key, now);
    if (S.dedupe.size > 50000) S.dedupe.delete(S.dedupe.keys().next().value);
  }
  if (S.pending.total != null) {
    S.pending.total++;
    const k = req.kind || "other";
    S.pending.byKind[k] = (S.pending.byKind[k] || 0) + 1;
  }
}

/** Parse "emergent:<id>:<kind>" caller ids. */
export function parseCallerId(callerId) {
  const parts = String(callerId || "").split(":");
  if (parts[0] !== "emergent" || parts.length < 2) return null;
  return { agentId: parts[1] || null, kind: parts.slice(2).join(":") || "other" };
}

export function isBackgroundCaller(callerId) { return parseCallerId(callerId) !== null; }

/**
 * Admit the EXECUTION of a background LLM call. Always returns a release()
 * the caller MUST invoke with the outcome ({ok, error}).
 */
export function admitExecution(req = {}) {
  const cfg = governorConfig();
  const kind = req.kind || "other";
  const agentId = req.agentId || null;
  const now = Date.now();
  const b = S.breaker;
  let verdict = null;
  let isProbe = false;
  if (b.state === "open") verdict = `breaker_open:${b.reason}`;
  else if (b.state === "half_open") {
    if (b.probeInflight > 0) verdict = "breaker_half_open";
    else isProbe = true;
  }
  if (!verdict && S.inflight >= cfg.maxInflight) verdict = "inflight_cap";
  const kc = cfg.kindInflightCaps[kind];
  if (!verdict && kc != null && (S.inflightByKind[kind] || 0) >= kc) verdict = `kind_inflight_cap:${kind}`;
  if (!verdict && agentId && !req.skipAgentRate) {
    const last = S.agentLastExec.get(agentId);
    if (last && now - last < cfg.agentMinIntervalMs) verdict = "agent_rate";
  }
  const out = _finish("exec", verdict, { type: kind, agent: agentId }, !!req.enforce);
  if (!out.allow) { out.release = () => {}; return out; }
  S.inflight++;
  _bump(S.inflightByKind, kind);
  if (agentId) {
    S.agentLastExec.set(agentId, now);
    if (S.agentLastExec.size > 20000) S.agentLastExec.delete(S.agentLastExec.keys().next().value);
  }
  if (isProbe && out.wouldAllow) b.probeInflight++;
  let released = false;
  out.release = (outcome = {}) => {
    if (released) return; released = true;
    S.inflight = Math.max(0, S.inflight - 1);
    S.inflightByKind[kind] = Math.max(0, (S.inflightByKind[kind] || 1) - 1);
    const ok = outcome.ok !== false;
    S.outcomes.push([Date.now(), ok]);
    if (ok) S.counters.outcomes.ok++;
    else { S.counters.outcomes.error++; _bump(S.counters.outcomes.errors, String(outcome.error || "error").slice(0, 60)); }
    if (isProbe && out.wouldAllow) {
      b.probeInflight = Math.max(0, b.probeInflight - 1);
      if (b.state === "half_open") {
        if (!ok) _setBreaker("open", "probe_failed");
        else if (++b.probesOk >= cfg.closeAfterProbes) _setBreaker("closed", null);
      }
    }
  };
  return out;
}

/** Note an expiry sweep result. */
export function noteExpired(n) { S.counters.expired += Number(n) || 0; if (n) _refreshPending(true); }

// ── TTL expiry (reversible) ───────────────────────────────────────────────
// Background tasks older than the TTL (default 6h) that are still pending —
// or 'active' (claimed but never finished) — are marked status='expired'.
// Nothing is deleted. result keeps everything needed to undo it:
//   {"expired_by":"bg-governor","prev_status":..,"prev_result":..,"expired_at":..}
// Undo (while the backend is stopped, on a copy first):
//   UPDATE emergent_tasks SET status = json_extract(result,'$.prev_status'),
//     result = json_extract(result,'$.prev_result'), completed_at = NULL
//   WHERE status = 'expired' AND json_extract(result,'$.expired_by') = 'bg-governor';
export function expiryEnabled() {
  const v = String(process.env.CONCORD_BG_EXPIRY ?? "").toLowerCase();
  if (["0", "off", "false"].includes(v)) return false;
  if (["1", "on", "true"].includes(v)) return true;
  return governorMode() === "enforce"; // default: on with enforcement
}

export function expireStaleTasks({ db = _db(), now = Date.now(), batch = _num("CONCORD_BG_EXPIRY_BATCH", 4000) } = {}) {
  if (!db) return { expired: 0, reason: "no_db" };
  const cutoff = now - governorConfig().taskTtlMs;
  let expired = 0;
  const byStatus = {};
  try {
    const kinds = db.prepare("SELECT DISTINCT task_type AS k FROM emergent_tasks WHERE status IN ('pending','active')").all().map((r) => r.k);
    const upd = db.prepare(`
      UPDATE emergent_tasks
         SET status = 'expired', completed_at = ?,
             result = json_object('expired_by', 'bg-governor', 'prev_status', status,
                                  'prev_result', result, 'expired_at', ?)
       WHERE rowid IN (SELECT rowid FROM emergent_tasks
                        WHERE status = ? AND task_type = ? AND created_at < ?
                        LIMIT ?)`);
    for (const st of ["pending", "active"]) {
      for (const k of kinds) {
        if (expired >= batch) break;
        const n = upd.run(now, now, st, k, cutoff, batch - expired).changes;
        if (n) { expired += n; byStatus[st] = (byStatus[st] || 0) + n; }
      }
    }
  } catch (e) {
    return { expired, error: String(e?.message || e) };
  }
  if (expired) {
    noteExpired(expired);
    S.expiryLast = { at: now, expired, byStatus };
  }
  return { expired, byStatus, cutoff };
}

async function _maybeExpire() {
  if (!expiryEnabled() || isKilled() || S.expiryRunning) return;
  if (S.signals.eventLoopPressure) return; // a big UPDATE is the last thing a lagging loop needs
  const every = _num("CONCORD_BG_EXPIRY_INTERVAL_MS", 10_000);
  if (Date.now() - (S.expiryAt || 0) < every) return;
  S.expiryAt = Date.now();
  S.expiryRunning = true;
  // Small chunks with a yield between them; stop the sweep early if a chunk
  // was slow (cold pages / checkpoint) so the event loop never stalls long.
  const total = _num("CONCORD_BG_EXPIRY_BATCH", 1000);
  const chunk = _num("CONCORD_BG_EXPIRY_CHUNK", 250);
  const slowMs = _num("CONCORD_BG_EXPIRY_SLOW_MS", 150);
  const t0 = Date.now();
  let expired = 0, maxChunkMs = 0, stoppedSlow = false, error = null;
  try {
    while (expired < total) {
      const c0 = Date.now();
      const r = expireStaleTasks({ batch: Math.min(chunk, total - expired) });
      const ms = Date.now() - c0;
      maxChunkMs = Math.max(maxChunkMs, ms);
      if (r.error) { error = r.error; break; }
      expired += r.expired;
      if (!r.expired) break;
      if (ms > slowMs) { stoppedSlow = true; break; }
      await new Promise((res) => setImmediate(res));
    }
  } finally { S.expiryRunning = false; }
  S.expiryLastRun = { expired, ms: Date.now() - t0, maxChunkMs, stoppedSlow, error, at: new Date().toISOString() };
  if (error) S.log("warn", "bg_governor_expiry_error", { error });
}

// ── status ────────────────────────────────────────────────────────────────
export function getGovernorStatus() {
  const cfg = governorConfig();
  return {
    mode: isKilled() ? "killed" : governorMode(),
    killFile: { path: cfg.killFile, present: (() => { try { return fs.existsSync(cfg.killFile); } catch { return false; } })() },
    breaker: { ...S.breaker, trips: { ...S.breaker.trips }, currentTrips: currentTrips(cfg) },
    signals: S.signals,
    inflight: { total: S.inflight, byKind: { ...S.inflightByKind } },
    pending: S.pending,
    counters: JSON.parse(JSON.stringify(S.counters)),
    expiry: { enabled: expiryEnabled(), ttlHours: governorConfig().taskTtlMs / 3600_000, lastRun: S.expiryLastRun || null },
    recentDenials: S.recent.slice(-25),
    config: { ...cfg, killFile: undefined, statusFile: undefined },
    startedAt: new Date(S.startedAt).toISOString(),
    generatedAt: new Date().toISOString(),
  };
}

let _lastSummary = 0;
function _writeStatus(cfg) {
  const st = getGovernorStatus();
  if (cfg.statusFile) {
    try {
      fs.mkdirSync(path.dirname(cfg.statusFile), { recursive: true });
      fs.writeFileSync(cfg.statusFile + ".tmp", JSON.stringify(st, null, 1));
      fs.renameSync(cfg.statusFile + ".tmp", cfg.statusFile);
    } catch { /* status file is best-effort */ }
  }
  if (Date.now() - _lastSummary > 5 * 60_000) {
    _lastSummary = Date.now();
    S.log("info", "bg_governor_summary", {
      mode: st.mode, breaker: st.breaker.state, reason: st.breaker.reason,
      pending: st.pending.total, inflight: st.inflight.total,
      exec: st.counters.exec, create: st.counters.create, outcomes: st.counters.outcomes, expired: st.counters.expired,
    });
  }
}

/**
 * Wire the governor to the live DB + logger and start its 10s evaluator.
 * Safe to call more than once.
 */
export function startBackgroundGovernor({ db = null, log = null, intervalMs = 10_000 } = {}) {
  if (db) S.db = db;
  S.useGlobalDb = true;
  if (typeof log === "function") S.log = log;
  if (S.timer) return;
  const tick = () => { evaluate().catch(() => {}); };
  setTimeout(tick, 2000).unref?.();
  S.timer = setInterval(tick, intervalMs);
  S.timer.unref?.();
  S.log("info", "bg_governor_started", { mode: governorMode(), bgUrl: governorConfig().bgUrl || null });
}

export function stopBackgroundGovernor() { if (S.timer) clearInterval(S.timer); S.timer = null; }

/** Test-only reset. */
export function _resetGovernorForTest({ db = null, signals = {} } = {}) {
  stopBackgroundGovernor();
  S.db = db; S.useGlobalDb = false; S.modeOverride = null;
  S.breaker = { state: "closed", reason: null, since: Date.now(), probesOk: 0, probeInflight: 0, trips: {} };
  S.signals = signals; S.inflight = 0; S.inflightByKind = {};
  S.agentLastExec.clear(); S.creatorTimes.clear(); S.dedupe.clear();
  S.pending = { total: null, byKind: {}, at: 0 }; S.outcomes = []; S.http = { api: [], chat: [] };
  S.chatActive = 0; S.bgProbe = { ok: null, fails: 0, at: 0, latencyMs: null }; S.counters = newCounters(); S.recent = [];
  S.log = () => {};
}
export function _setSignalsForTest(sig) { S.signals = { ...S.signals, ...sig }; }
export function _setBreakerForTest(state, reason = null, since = Date.now()) { S.breaker.state = state; S.breaker.reason = reason; S.breaker.since = since; S.breaker.probesOk = 0; }
export function _setBgProbeForTest(p) { S.bgProbe = { ...S.bgProbe, ...p }; }
