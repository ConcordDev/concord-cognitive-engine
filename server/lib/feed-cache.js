// server/lib/feed-cache.js
//
// The single chokepoint for outside data that Concord shows to many users.
// One cache entry per (source, key); users never cause upstream fetches for
// warmed keys, and a cold key costs at most ONE coalesced fetch per TTL.
//
//   registerSource(id, { ttlMs, staleMaxMs, budget, timeoutMs, license, fetcher, warm, ... })
//   get(id, key, { allowStale, force })  -> { status, data, fetchedAt, stale, source, reason?, lastOkAt? }
//   pool(id, key, { cursor, limit, dedupeKey }) -> rotating deduped window over recent pulls
//   warmTick(tickNumber, { shouldRun }) -> staggered refresh of warm keys
//   stats()
//
// Honesty rules (Concord invariant): failures are NEVER cached as data, and
// when nothing truthful can be served the answer is
// { status:"unavailable", reason, lastOkAt } — no placeholder data, ever.
//
// Back-off note: lib/circuit-breaker.js uses a fixed cooldown and Date.now();
// feed sources need an exponential 60s..10min window and an injectable clock
// for tests, so the (tiny) back-off state lives here per source.
//
// cachedFetchJson (lib/external-fetch.js) delegates here through getOrThrow()
// so its ~37 callers keep their throw-on-failure contract.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDedupKeyAndHash } from "./dedup-keys.js";

const LICENSES = new Set(["public", "keyed-display-ok", "internal-only"]);
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_KEYS = 500;
const DEFAULT_POOL_SIZE = 6;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const PERSIST_MAX_BYTES = 5 * 1024 * 1024;
const PERSIST_FILE = "feed-cache.json";

const _sources = new Map();
let _cfg = defaultConfig();
let _persistSnapshot = null; // parsed file, applied to persist sources as they register
let _persistLoaded = false;
let _persistTimer = null;
let _persistWriting = Promise.resolve();

function defaultConfig() {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    dir: undefined, // undefined => resolve from env/home; null => disabled
    persistDebounceMs: 2000,
    log: (...a) => { try { console.warn("[feed-cache]", ...a); } catch { /* ignore */ } },
    logUpstream: (line) => { console.info(line); },
  };
}

/** Test/ops hook: { now, sleep, dir, persistDebounceMs, log }. */
export function configureFeedCache(o = {}) {
  _cfg = { ..._cfg, ...o };
  if ("dir" in o) { _persistLoaded = false; _persistSnapshot = null; }
}

export function _resetFeedCacheForTests() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = null;
  _sources.clear();
  _cfg = defaultConfig();
  _persistSnapshot = null;
  _persistLoaded = false;
  _persistWriting = Promise.resolve();
}

function isReadReplica() {
  const v = String(process.env.CONCORD_READ_REPLICA || "").toLowerCase();
  return v === "1" || v === "true";
}

/** Directory for WRITING the persist file (null on read replicas, which may still read it). */
function persistWriteDir() {
  return isReadReplica() ? null : persistDir();
}

function persistDir() {
  if (_cfg.dir === null) return null;
  if (typeof _cfg.dir === "string") return _cfg.dir;
  if (process.env.NODE_ENV === "test") return null;
  return process.env.CONCORD_FEED_CACHE_DIR || path.join(os.homedir(), "concord", "run", "feed-cache");
}

// ── source registry ─────────────────────────────────────────────────────────

export function registerSource(id, config = {}) {
  if (!id || typeof id !== "string") throw new Error("feed-cache: source id required");
  if (typeof config.fetcher !== "function") throw new Error(`feed-cache: source ${id} needs a fetcher`);
  const license = config.license || "public";
  if (!LICENSES.has(license)) throw new Error(`feed-cache: bad license ${license}`);
  const ttlMs = config.ttlMs > 0 ? config.ttlMs : DEFAULT_TTL_MS;
  const cfg = {
    ttlMs,
    staleMaxMs: config.staleMaxMs > 0 ? Math.max(config.staleMaxMs, ttlMs) : ttlMs * 6,
    budget: { ...(config.budget || {}) },
    timeoutMs: config.timeoutMs > 0 ? config.timeoutMs : 0,
    license,
    persist: !!config.persist,
    // Optional (key) => bool: only matching keys are written to the persist file (keeps user-claim queries off disk).
    persistFilter: typeof config.persistFilter === "function" ? config.persistFilter : null,
    serialize: !!config.serialize || config.budget?.minSpacingMs > 0,
    maxKeys: config.maxKeys > 0 ? config.maxKeys : DEFAULT_MAX_KEYS,
    poolSize: config.poolSize > 0 ? config.poolSize : DEFAULT_POOL_SIZE,
    fetcher: config.fetcher,
    warm: config.warm || null,
    breaker: config.breaker === false ? false : {
      baseMs: config.breaker?.baseMs > 0 ? config.breaker.baseMs : BACKOFF_BASE_MS,
      maxMs: config.breaker?.maxMs > 0 ? config.breaker.maxMs : BACKOFF_MAX_MS,
    },
  };
  const prev = _sources.get(id);
  const src = prev || {
    id, entries: new Map(), inflight: new Map(), poolHist: new Map(),
    lastStart: -Infinity, tail: Promise.resolve(),
    backoff: { fails: 0, until: 0, ms: 0 },
    st: { hits: 0, misses: 0, staleServed: 0, unavailable: 0 },
    lastError: null, lastOkAt: null, warmAt: new Map(),
  };
  src.cfg = cfg;
  src.minute = { tokens: cfg.budget.perMin > 0 ? cfg.budget.perMin : Infinity, at: _cfg.now() };
  src.day = { tokens: cfg.budget.perDay > 0 ? cfg.budget.perDay : Infinity, at: _cfg.now() };
  // Slow-refill bucket: `burst` tokens max (default 1), one new token every `everyMs`.
  // For hosts that allow far less than 1 request/min (the shared GDELT budget).
  src.slow = { tokens: cfg.budget.everyMs > 0 ? slowCapacity(cfg.budget) : Infinity, at: _cfg.now() };
  _sources.set(id, src);
  if (cfg.persist) { _ensureLoaded(); _applySnapshot(src); }
  return src;
}

export function hasSource(id) { return _sources.has(id); }

// ── budget (token bucket) ───────────────────────────────────────────────────

function slowCapacity(b) { return b.burst > 0 ? b.burst : 1; }

function refill(bucket, capacity, perMs) {
  if (!Number.isFinite(capacity)) return;
  const t = _cfg.now();
  const dt = Math.max(0, t - bucket.at);
  bucket.tokens = Math.min(capacity, bucket.tokens + dt * perMs);
  bucket.at = t;
}

/** Take one token from every configured bucket, or none. */
function takeBudget(src) {
  const { perMin, perDay, everyMs } = src.cfg.budget;
  if (perMin > 0) refill(src.minute, perMin, perMin / 60_000);
  if (perDay > 0) refill(src.day, perDay, perDay / 86_400_000);
  const needSlow = everyMs > 0;
  if (needSlow) refill(src.slow, slowCapacity(src.cfg.budget), 1 / everyMs);
  const needMin = perMin > 0, needDay = perDay > 0;
  if ((needMin && src.minute.tokens < 1) || (needDay && src.day.tokens < 1) || (needSlow && src.slow.tokens < 1)) return false;
  if (needMin) src.minute.tokens -= 1;
  if (needDay) src.day.tokens -= 1;
  if (needSlow) src.slow.tokens -= 1;
  return true;
}

function refundBudget(src) {
  const { perMin, perDay, everyMs } = src.cfg.budget;
  if (perMin > 0) src.minute.tokens = Math.min(perMin, src.minute.tokens + 1);
  if (perDay > 0) src.day.tokens = Math.min(perDay, src.day.tokens + 1);
  if (everyMs > 0) src.slow.tokens = Math.min(slowCapacity(src.cfg.budget), src.slow.tokens + 1);
}

function budgetLeft(src) {
  const { perMin, perDay, everyMs } = src.cfg.budget;
  if (perMin > 0) refill(src.minute, perMin, perMin / 60_000);
  if (perDay > 0) refill(src.day, perDay, perDay / 86_400_000);
  if (everyMs > 0) refill(src.slow, slowCapacity(src.cfg.budget), 1 / everyMs);
  return {
    perMin: perMin > 0 ? Math.floor(src.minute.tokens) : null,
    perDay: perDay > 0 ? Math.floor(src.day.tokens) : null,
    slow: everyMs > 0 ? Math.floor(src.slow.tokens) : null,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function unavailable(src, key, reason) {
  src.st.unavailable++;
  const e = src.entries.get(key);
  return {
    status: "unavailable", data: null, fetchedAt: null, stale: false,
    source: src.id, reason, lastOkAt: e?.fetchedAt ?? src.lastOkAt ?? null,
  };
}

function served(src, e, stale, extra = {}) {
  return { status: stale ? "stale" : "fresh", data: e.data, fetchedAt: e.fetchedAt, stale, source: src.id, ...extra };
}

function backoffActive(src) {
  return src.cfg.breaker && _cfg.now() < src.backoff.until;
}

function recordFailure(src, err) {
  src.lastError = { message: String(err?.message || err), at: _cfg.now() };
  if (!src.cfg.breaker) return;
  const b = src.backoff;
  b.fails++;
  b.ms = Math.min(src.cfg.breaker.maxMs, src.cfg.breaker.baseMs * 2 ** (b.fails - 1));
  b.until = _cfg.now() + b.ms;
}

function recordSuccess(src, key, data) {
  const t = _cfg.now();
  src.backoff.fails = 0; src.backoff.ms = 0; src.backoff.until = 0;
  src.lastOkAt = t;
  src.entries.delete(key); // re-insert so FIFO eviction order tracks recency
  src.entries.set(key, { data, fetchedAt: t });
  while (src.entries.size > src.cfg.maxKeys) {
    const oldest = src.entries.keys().next().value;
    src.entries.delete(oldest);
    src.poolHist.delete(oldest);
  }
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (items) {
    const h = src.poolHist.get(key) || [];
    h.unshift({ at: t, items });
    h.length = Math.min(h.length, src.cfg.poolSize);
    src.poolHist.set(key, h);
  }
  if (src.cfg.persist) schedulePersist();
}

/** Optionally serialized, min-spaced, timeout-bounded upstream call. Resolves {ok,data}|{ok:false,error}. */
function runUpstream(src, key, fetcher) {
  // Only sources that ask for it (minSpacingMs > 0 or serialize:true) queue
  // behind each other; the rest run concurrently (still coalesced per key).
  const gate = src.cfg.serialize ? src.tail : Promise.resolve();
  const run = gate.then(async () => {
    // A request queued before an earlier one failed must not hit the upstream
    // inside the back-off window it just opened: skip it (and give the budget token back).
    if (backoffActive(src)) {
      refundBudget(src);
      return { ok: false, error: new Error(src.lastError?.message || "upstream_backoff"), skipped: true };
    }
    const spacing = src.cfg.budget.minSpacingMs || 0;
    if (spacing > 0) {
      const wait = src.lastStart + spacing - _cfg.now();
      if (wait > 0) await _cfg.sleep(wait);
    }
    src.lastStart = _cfg.now();
    const ctrl = new AbortController();
    let timer = null;
    try {
      const call = Promise.resolve().then(() => fetcher(key, { signal: ctrl.signal }));
      const data = src.cfg.timeoutMs
        ? await Promise.race([
            call,
            new Promise((_, rej) => {
              timer = setTimeout(() => { ctrl.abort(); rej(new Error(`timeout after ${src.cfg.timeoutMs}ms`)); }, src.cfg.timeoutMs);
            }),
          ])
        : await call;
      if (data === undefined) throw new Error("fetcher returned undefined");
      recordSuccess(src, key, data);
      return { ok: true, data };
    } catch (error) {
      recordFailure(src, error);
      return { ok: false, error };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
  if (src.cfg.serialize) src.tail = run.then(() => {}, () => {});
  return run;
}

/**
 * Core resolution. Returns the public result plus `_error` (the original
 * upstream error, if this call's own fetch failed) for getOrThrow.
 */
async function resolve(src, key, { allowStale = true, force = false, ttlMs, fetcher, reason: why } = {}) {
  const ttl = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : src.cfg.ttlMs; // 0 = always refetch (legacy cachedFetchJson)
  const entry = src.entries.get(key);
  const age = entry ? _cfg.now() - entry.fetchedAt : Infinity;
  if (entry && age < ttl && !force) { src.st.hits++; return served(src, entry, false); }

  const staleOk = !!entry && age <= src.cfg.staleMaxMs && allowStale;
  const useStale = () => { src.st.staleServed++; return served(src, entry, true); };

  // Someone is already refreshing this key: share it (or serve stale meanwhile).
  const existing = src.inflight.get(key);
  if (existing) {
    if (staleOk && !force) return useStale();
    return existing;
  }

  if (backoffActive(src)) return staleOk ? useStale() : unavailable(src, key, "upstream_backoff");
  if (!takeBudget(src)) return staleOk ? useStale() : unavailable(src, key, "budget_exhausted");

  src.st.misses++;
  logUpstream(src, key, why || (staleOk && !force ? "swr" : "miss"));
  const p = runUpstream(src, key, fetcher || src.cfg.fetcher).then((r) => {
    src.inflight.delete(key);
    if (r.ok) return served(src, src.entries.get(key), false);
    const e = src.entries.get(key);
    if (e && _cfg.now() - e.fetchedAt <= src.cfg.staleMaxMs && allowStale) {
      src.st.staleServed++;
      return { ...served(src, e, true), _error: r.error };
    }
    const u = unavailable(src, key, `upstream_error: ${String(r.error?.message || r.error)}`);
    u._error = r.error;
    return u;
  });
  src.inflight.set(key, p);
  if (staleOk && !force) {
    p.catch(() => {}); // background refresh; result lands in the entry
    return useStale();
  }
  return p;
}

/** One info line per REAL upstream fetch, so backend.log proves user clicks don't cause upstream calls. */
function logUpstream(src, key, reason) {
  if (!_cfg.logUpstream) return;
  try { _cfg.logUpstream(`[feed-cache] upstream source=${src.id} key=${String(key).slice(0, 60).replace(/\s+/g, "_")} reason=${reason}`); } catch { /* ignore */ }
}

function stripInternal(r) {
  if (r && "_error" in r) { const { _error, ...rest } = r; return rest; }
  return r;
}

// ── public API ──────────────────────────────────────────────────────────────

export async function get(sourceId, key, o = {}) {
  const src = _sources.get(sourceId);
  if (!src) {
    return { status: "unavailable", data: null, fetchedAt: null, stale: false, source: sourceId, reason: "unknown_source", lastOkAt: null };
  }
  return stripInternal(await resolve(src, key, o));
}

/**
 * Throwing flavour for legacy callers (cachedFetchJson): returns the data on
 * fresh/stale, throws the ORIGINAL upstream error (or a reason Error) otherwise.
 */
export async function getOrThrow(sourceId, key, o = {}) {
  const src = _sources.get(sourceId);
  if (!src) throw new Error(`feed-cache: unknown source ${sourceId}`);
  const r = await resolve(src, key, o);
  if (r.status === "unavailable") throw r._error || new Error(r.reason);
  return r.data;
}

export async function pool(sourceId, key, { cursor = 0, limit = 20, dedupeKey, allowStale = true } = {}) {
  const src = _sources.get(sourceId);
  const r = await get(sourceId, key, { allowStale });
  const hist = src?.poolHist.get(key) || [];
  if (!hist.length) {
    return { items: [], nextCursor: 0, fetchedAt: null, stale: false, status: "unavailable", reason: r.reason || "no_data", lastOkAt: r.lastOkAt ?? null };
  }
  const keyOf = dedupeKey || defaultDedupe;
  const seen = new Set();
  const merged = [];
  for (const pull of hist) {
    for (const item of pull.items) {
      const k = keyOf(item);
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      merged.push(item);
    }
  }
  const start = Math.max(0, Math.floor(Number(cursor)) || 0) % Math.max(1, merged.length);
  const n = Math.max(1, Math.floor(Number(limit)) || 20);
  const items = merged.slice(start, start + n);
  const next = start + n < merged.length ? start + n : 0;
  const fresh = r.status === "fresh";
  return {
    items, nextCursor: next, total: merged.length,
    fetchedAt: hist[0].at, stale: !fresh, status: fresh ? "fresh" : "stale",
  };
}

function defaultDedupe(item) {
  if (item && typeof item === "object") {
    try {
      const { key, hash } = getDedupKeyAndHash(item);
      if (key) return hash;
    } catch { /* fall through */ }
    return item.url || item.link || item.title || safeJson(item);
  }
  return String(item);
}
function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }

async function defaultShouldRun() {
  try {
    const m = await import("./presence-idle.js");
    return typeof m.shouldRunHeavyMaintenance === "function" ? !!m.shouldRunHeavyMaintenance() : true;
  } catch { return true; }
}

/** Refresh due warm keys; at most one warm fetch per source per call. */
export async function warmTick(tickNumber = 0, { shouldRun } = {}) {
  if (isReadReplica()) return { ran: false, reason: "read_replica", refreshed: [] };
  const gate = shouldRun || defaultShouldRun;
  let ok = true;
  try { ok = !!(await gate()); } catch { ok = true; }
  if (!ok) return { ran: false, reason: "gated", refreshed: [] };
  const refreshed = [];
  for (const src of _sources.values()) {
    const w = src.cfg.warm;
    if (!w?.keys?.length) continue;
    const every = w.everyTicks > 0 ? w.everyTicks : 1;
    if (tickNumber % every !== 0) continue;
    // Stalest due key first (never-fetched counts as oldest): each tick moves the least-fresh key.
    let due; let dueAt = Infinity;
    for (const k of w.keys) {
      const e = src.entries.get(k);
      if (e && _cfg.now() - e.fetchedAt < src.cfg.ttlMs) continue;
      const at = e ? e.fetchedAt : -Infinity;
      if (at < dueAt) { due = k; dueAt = at; }
    }
    if (due === undefined) continue;
    if (backoffActive(src)) continue; // don't queue warm fetches into an open breaker
    const r = await get(src.id, due, { force: true, allowStale: true, reason: "warm" });
    refreshed.push({ source: src.id, key: due, status: r.status, reason: r.reason });
  }
  return { ran: true, refreshed };
}

export function stats() {
  const out = {};
  for (const src of _sources.values()) {
    const b = src.backoff;
    out[src.id] = {
      ...src.st,
      inflight: src.inflight.size,
      budget: budgetLeft(src),
      breaker: !src.cfg.breaker ? "disabled" : _cfg.now() < b.until ? "open" : b.fails > 0 ? "half_open" : "closed",
      backoffMs: b.ms, backoffUntil: b.until || null,
      lastError: src.lastError, lastOkAt: src.lastOkAt,
      keys: src.entries.size, license: src.cfg.license,
    };
  }
  return out;
}

export function clearSource(sourceId) {
  const src = _sources.get(sourceId);
  if (!src) return;
  src.entries.clear(); src.poolHist.clear(); src.inflight.clear();
}

// ── persistence (opt-in per source; never headers or keys, only data) ───────

function _ensureLoaded() {
  if (_persistLoaded) return;
  _persistLoaded = true;
  const dir = persistDir();
  if (!dir) return;
  try {
    const raw = fs.readFileSync(path.join(dir, PERSIST_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.sources && typeof parsed.sources === "object") {
      _persistSnapshot = parsed.sources;
    }
  } catch (e) {
    if (e?.code !== "ENOENT") _cfg.log("ignoring unreadable persisted cache:", e?.message);
  }
}

function _applySnapshot(src) {
  const snap = _persistSnapshot?.[src.id];
  if (!snap || typeof snap !== "object") return;
  const t = _cfg.now();
  for (const [key, e] of Object.entries(snap.entries || {})) {
    if (!e || typeof e.fetchedAt !== "number" || e.data === undefined) continue;
    if (t - e.fetchedAt > src.cfg.staleMaxMs || src.entries.has(key)) continue;
    src.entries.set(key, { data: e.data, fetchedAt: e.fetchedAt });
    if (!src.lastOkAt || e.fetchedAt > src.lastOkAt) src.lastOkAt = e.fetchedAt;
  }
  for (const [key, hist] of Object.entries(snap.pool || {})) {
    if (!Array.isArray(hist) || src.poolHist.has(key)) continue;
    const ok = hist.filter((h) => h && typeof h.at === "number" && Array.isArray(h.items)).slice(0, src.cfg.poolSize);
    if (ok.length) src.poolHist.set(key, ok);
  }
}

/** Re-read the persisted file and apply it to registered persist sources. */
export function loadPersisted() {
  _persistLoaded = false;
  _persistSnapshot = null;
  _ensureLoaded();
  for (const src of _sources.values()) if (src.cfg.persist) _applySnapshot(src);
  return !!_persistSnapshot;
}

function buildSnapshot() {
  const sources = {};
  for (const src of _sources.values()) {
    if (!src.cfg.persist) continue;
    const entries = {};
    const keep = src.cfg.persistFilter || (() => true);
    for (const [k, e] of src.entries) if (keep(k)) entries[k] = { data: e.data, fetchedAt: e.fetchedAt };
    const poolOut = {};
    for (const [k, h] of src.poolHist) if (keep(k)) poolOut[k] = h;
    sources[src.id] = { entries, pool: poolOut };
  }
  let body = JSON.stringify({ v: 1, savedAt: _cfg.now(), sources });
  if (body.length > PERSIST_MAX_BYTES) { // shed pool history first, then oldest entries
    for (const s of Object.values(sources)) s.pool = {};
    body = JSON.stringify({ v: 1, savedAt: _cfg.now(), sources });
    for (const s of Object.values(sources)) {
      const ks = Object.keys(s.entries).sort((a, b) => s.entries[a].fetchedAt - s.entries[b].fetchedAt);
      while (body.length > PERSIST_MAX_BYTES && ks.length) {
        delete s.entries[ks.shift()];
        body = JSON.stringify({ v: 1, savedAt: _cfg.now(), sources });
      }
    }
  }
  return body;
}

function schedulePersist() {
  if (!persistWriteDir() || _persistTimer) return;
  _persistTimer = setTimeout(() => { _persistTimer = null; flushPersist().catch(() => {}); }, _cfg.persistDebounceMs);
  if (typeof _persistTimer.unref === "function") _persistTimer.unref();
}

/** Write the snapshot now (atomic tmp+rename). Resolves true when written. */
export function flushPersist() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  const dir = persistWriteDir();
  if (!dir) return Promise.resolve(false);
  if (![..._sources.values()].some((s) => s.cfg.persist)) return Promise.resolve(false); // nothing opted in: write nothing
  _persistWriting = _persistWriting.then(async () => {
    try {
      const body = buildSnapshot();
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, PERSIST_FILE);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, body, { mode: 0o600 });
      await fs.promises.rename(tmp, file);
      return true;
    } catch (e) {
      _cfg.log("persist failed:", e?.message);
      return false;
    }
  });
  return _persistWriting;
}
