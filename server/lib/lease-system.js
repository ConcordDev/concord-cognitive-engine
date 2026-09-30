// server/lib/lease-system.js
//
// Leader lease: acquire / renew / release.
// Default backend: JSON file under server/data/leases/
// Optional better-sqlite3 backend when dbPath provided and module available.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createRequire as _createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, "../data/leases");

function nowMs() {
  return Date.now();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function leasePath(dir, name) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dir, `${safe}.json`);
}

function readLease(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeLeaseAtomic(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function isExpired(lease, t = nowMs()) {
  if (!lease) return true;
  return !lease.expires_at_ms || lease.expires_at_ms <= t;
}

/**
 * File-backed lease store.
 */
export class FileLeaseStore {
  constructor(dir = DEFAULT_DIR) {
    this.dir = dir;
    ensureDir(dir);
  }

  acquire(name, { holder, ttlMs = 30_000, meta = {} } = {}) {
    if (!name) throw new Error("lease.acquire: name required");
    if (!holder) throw new Error("lease.acquire: holder required");
    const file = leasePath(this.dir, name);
    const existing = readLease(file);
    const t = nowMs();
    if (existing && !isExpired(existing, t) && existing.holder !== holder) {
      return { ok: false, error: "held_by_other", lease: existing };
    }
    const token = existing && existing.holder === holder && !isExpired(existing, t)
      ? existing.token
      : randomUUID();
    const lease = {
      name,
      holder,
      token,
      acquired_at_ms: existing && existing.holder === holder ? existing.acquired_at_ms : t,
      renewed_at_ms: t,
      expires_at_ms: t + Math.max(1000, ttlMs),
      ttl_ms: ttlMs,
      meta,
      backend: "file",
    };
    writeLeaseAtomic(file, lease);
    return { ok: true, lease };
  }

  renew(name, { holder, token, ttlMs } = {}) {
    const file = leasePath(this.dir, name);
    const existing = readLease(file);
    const t = nowMs();
    if (!existing || isExpired(existing, t)) {
      return { ok: false, error: "not_held", lease: existing };
    }
    if (existing.holder !== holder || existing.token !== token) {
      return { ok: false, error: "token_mismatch", lease: existing };
    }
    const ttl = ttlMs ?? existing.ttl_ms ?? 30_000;
    const lease = {
      ...existing,
      renewed_at_ms: t,
      expires_at_ms: t + Math.max(1000, ttl),
      ttl_ms: ttl,
    };
    writeLeaseAtomic(file, lease);
    return { ok: true, lease };
  }

  release(name, { holder, token } = {}) {
    const file = leasePath(this.dir, name);
    const existing = readLease(file);
    if (!existing) return { ok: true, released: false, reason: "absent" };
    if (holder && existing.holder !== holder) {
      return { ok: false, error: "holder_mismatch", lease: existing };
    }
    if (token && existing.token !== token) {
      return { ok: false, error: "token_mismatch", lease: existing };
    }
    try { fs.unlinkSync(file); } catch { /* race ok */ }
    return { ok: true, released: true, lease: existing };
  }

  status(name) {
    const file = leasePath(this.dir, name);
    const lease = readLease(file);
    if (!lease) return { held: false, lease: null };
    const expired = isExpired(lease);
    return { held: !expired, expired, lease };
  }

  list() {
    ensureDir(this.dir);
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readLease(path.join(this.dir, f)))
      .filter(Boolean);
  }
}

function rowToLease(row) {
  let meta = {};
  try { meta = row.meta_json ? JSON.parse(row.meta_json) : {}; } catch { meta = {}; }
  return {
    name: row.name,
    holder: row.holder,
    token: row.token,
    acquired_at_ms: row.acquired_at_ms,
    renewed_at_ms: row.renewed_at_ms,
    expires_at_ms: row.expires_at_ms,
    ttl_ms: row.ttl_ms,
    meta,
    backend: "sqlite",
  };
}

/**
 * Optional sqlite backend (better-sqlite3).
 */
export class SqliteLeaseStore {
  constructor(dbPath) {
    let Database;
    try {
      const require = _createRequire(import.meta.url);
      Database = require("better-sqlite3");
    } catch (e) {
      throw new Error(`SqliteLeaseStore unavailable: ${e?.message || e}`);
    }
    ensureDir(path.dirname(dbPath));
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leases (
        name TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        token TEXT NOT NULL,
        acquired_at_ms INTEGER NOT NULL,
        renewed_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL,
        meta_json TEXT
      );
    `);
  }

  acquire(name, { holder, ttlMs = 30_000, meta = {} } = {}) {
    if (!name || !holder) throw new Error("lease.acquire: name and holder required");
    const t = nowMs();
    const row = this.db.prepare("SELECT * FROM leases WHERE name = ?").get(name);
    if (row && row.expires_at_ms > t && row.holder !== holder) {
      return { ok: false, error: "held_by_other", lease: rowToLease(row) };
    }
    const token = row && row.holder === holder && row.expires_at_ms > t ? row.token : randomUUID();
    const lease = {
      name,
      holder,
      token,
      acquired_at_ms: row && row.holder === holder ? row.acquired_at_ms : t,
      renewed_at_ms: t,
      expires_at_ms: t + Math.max(1000, ttlMs),
      ttl_ms: ttlMs,
      meta,
      backend: "sqlite",
    };
    this.db.prepare(`
      INSERT INTO leases (name, holder, token, acquired_at_ms, renewed_at_ms, expires_at_ms, ttl_ms, meta_json)
      VALUES (@name, @holder, @token, @acquired_at_ms, @renewed_at_ms, @expires_at_ms, @ttl_ms, @meta_json)
      ON CONFLICT(name) DO UPDATE SET
        holder=excluded.holder, token=excluded.token,
        acquired_at_ms=excluded.acquired_at_ms, renewed_at_ms=excluded.renewed_at_ms,
        expires_at_ms=excluded.expires_at_ms, ttl_ms=excluded.ttl_ms, meta_json=excluded.meta_json
    `).run({ ...lease, meta_json: JSON.stringify(meta || {}) });
    return { ok: true, lease };
  }

  renew(name, { holder, token, ttlMs } = {}) {
    const t = nowMs();
    const row = this.db.prepare("SELECT * FROM leases WHERE name = ?").get(name);
    if (!row || row.expires_at_ms <= t) return { ok: false, error: "not_held", lease: row ? rowToLease(row) : null };
    if (row.holder !== holder || row.token !== token) return { ok: false, error: "token_mismatch", lease: rowToLease(row) };
    const ttl = ttlMs ?? row.ttl_ms ?? 30_000;
    const lease = { ...rowToLease(row), renewed_at_ms: t, expires_at_ms: t + Math.max(1000, ttl), ttl_ms: ttl };
    this.db.prepare(`UPDATE leases SET renewed_at_ms=?, expires_at_ms=?, ttl_ms=? WHERE name=?`)
      .run(lease.renewed_at_ms, lease.expires_at_ms, lease.ttl_ms, name);
    return { ok: true, lease };
  }

  release(name, { holder, token } = {}) {
    const row = this.db.prepare("SELECT * FROM leases WHERE name = ?").get(name);
    if (!row) return { ok: true, released: false, reason: "absent" };
    if (holder && row.holder !== holder) return { ok: false, error: "holder_mismatch", lease: rowToLease(row) };
    if (token && row.token !== token) return { ok: false, error: "token_mismatch", lease: rowToLease(row) };
    this.db.prepare("DELETE FROM leases WHERE name = ?").run(name);
    return { ok: true, released: true, lease: rowToLease(row) };
  }

  status(name) {
    const row = this.db.prepare("SELECT * FROM leases WHERE name = ?").get(name);
    if (!row) return { held: false, lease: null };
    const lease = rowToLease(row);
    const expired = isExpired(lease);
    return { held: !expired, expired, lease };
  }

  list() {
    return this.db.prepare("SELECT * FROM leases").all().map(rowToLease);
  }
}

/** Default singleton (file backend). */
const defaultStore = new FileLeaseStore();

export function acquire(name, opts) { return defaultStore.acquire(name, opts); }
export function renew(name, opts) { return defaultStore.renew(name, opts); }
export function release(name, opts) { return defaultStore.release(name, opts); }
export function status(name) { return defaultStore.status(name); }
export function listLeases() { return defaultStore.list(); }
export function getDefaultStore() { return defaultStore; }

export function createLeaseStore({ backend = "file", dir, dbPath } = {}) {
  if (backend === "sqlite") {
    return new SqliteLeaseStore(dbPath || path.join(DEFAULT_DIR, "leases.sqlite"));
  }
  return new FileLeaseStore(dir || DEFAULT_DIR);
}

export default {
  acquire, renew, release, status, list: listLeases, getDefaultStore, createLeaseStore,
  FileLeaseStore, SqliteLeaseStore,
};

export function acquireLease(name, opts) { return getDefaultStore().acquire(name, opts); }
export function renewLease(name, opts) { return getDefaultStore().renew(name, opts); }
export function releaseLease(name, opts) { return getDefaultStore().release(name, opts); }
