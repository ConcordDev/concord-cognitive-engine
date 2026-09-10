// dtu-sidecar-client — thin Node client for engines/concord-dtu-sidecar (Rust).
//
// Concurrency Refactor Phase 3. READ-ONLY DTU reads over a Unix socket so the
// `dtu.list` visibility filter (which iterates the whole in-memory DTU set on
// every locker page load) runs off the Node event loop.
//
// Enabled by CONCORD_DTU_SIDECAR=1 (default off). FAIL SOFT: every call rejects
// on transport failure and the macros fall back to the in-memory path.
//
// Correctness is gated by engines/concord-dtu-sidecar/proof/run-proof.mjs — a
// differential test that diffs this against the live macro across a
// privacy-filter scenario matrix. Keep it green.

import http from "node:http";
import os from "node:os";
import path from "node:path";

const SOCK =
  process.env.CONCORD_DTU_SIDECAR_SOCK ||
  path.join(process.env.CONCORD_RUN_DIR || path.join(os.homedir(), "concord", "run"), "concord-dtu-sidecar.sock");

export const ENABLED = process.env.CONCORD_DTU_SIDECAR === "1";

function get(pathname, { timeoutMs = 5_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCK, path: pathname, method: "GET", timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          } catch {
            reject(new Error(`dtu-sidecar: bad JSON (${res.statusCode})`));
          }
        });
      },
    );
    req.on("error", (e) => reject(new Error(`dtu-sidecar unreachable: ${e.code || e.message}`)));
    req.on("timeout", () => req.destroy(new Error("dtu-sidecar: request timeout")));
    req.end();
  });
}

let _availAt = 0;
let _availVal = null;
export async function isAvailable() {
  if (!ENABLED) return false;
  const now = Date.now();
  if (now - _availAt < 3_000 && _availVal !== null) return _availVal;
  try {
    const r = await get("/v1/health", { timeoutMs: 1_500 });
    _availVal = r.status === 200 && r.body?.ok === true;
  } catch {
    _availVal = false;
  }
  _availAt = now;
  return _availVal;
}

export async function health() {
  return (await get("/v1/health", { timeoutMs: 1_500 })).body;
}

/**
 * Get one DTU by id. Returns { ok, dtu } | { ok:false, error }.
 */
export async function getDTU(id) {
  const r = await get(`/v1/dtu?id=${encodeURIComponent(id)}`);
  return r.body || { ok: false, error: "empty_response" };
}

/**
 * Visibility-filtered list — mirrors the dtu.list macro.
 * @param {{ viewer?, scope?, tier?, q?, mine?, limit?, offset?, viewerRegional?, viewerNational? }} o
 * @returns {Promise<{ ok, dtus, total, limit, offset }>}
 */
export async function list(o = {}) {
  const q = new URLSearchParams();
  if (o.viewer) q.set("viewer", o.viewer);
  if (o.scope) q.set("scope", o.scope);
  if (o.tier) q.set("tier", o.tier);
  if (o.q) q.set("q", o.q);
  if (o.mine) q.set("mine", "true");
  if (o.limit != null) q.set("limit", String(o.limit));
  if (o.offset != null) q.set("offset", String(o.offset));
  if (o.viewerRegional) q.set("viewerRegional", o.viewerRegional);
  if (o.viewerNational) q.set("viewerNational", o.viewerNational);
  const r = await get(`/v1/dtus/list?${q}`, { timeoutMs: 10_000 });
  return r.body || { ok: false, error: "empty_response" };
}

export async function recent({ limit = 50, scope, tier, source } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (scope) q.set("scope", scope);
  if (tier) q.set("tier", tier);
  if (source) q.set("source", source);
  return (await get(`/v1/dtus/recent?${q}`)).body;
}

export const socketPath = SOCK;

// ── Phase 3b: generalized hot reads (same UDS, fail-soft) ──
// CONCORD_WALLET_SIDECAR / CONCORD_SESSION_SIDECAR default ON when
// CONCORD_DTU_SIDECAR=1 (explicit =0 disables). Same socket as DTU.

// When DTU sidecar is already opted in, wallet/session reads default ON
// (same socket, fail-soft). Explicit CONCORD_*=0 disables.
function _sidecarFlag(name, { defaultOnWhenDtu = false } = {}) {
  const raw = process.env[name];
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return defaultOnWhenDtu && ENABLED;
}
export const WALLET_ENABLED = _sidecarFlag("CONCORD_WALLET_SIDECAR", { defaultOnWhenDtu: true });
export const SESSION_ENABLED = _sidecarFlag("CONCORD_SESSION_SIDECAR", { defaultOnWhenDtu: true });

/**
 * Wallet balance — mirrors economy/balances.js#getBalance.
 * @param {string} userId
 * @returns {Promise<{ ok, userId?, balance?, totalCredits?, totalDebits?, error? }>}
 */
export async function walletBalance(userId) {
  if (!userId) return { ok: false, error: "user_required" };
  const r = await get(`/v1/wallet/balance?user=${encodeURIComponent(userId)}`, { timeoutMs: 3_000 });
  return r.body || { ok: false, error: "empty_response" };
}

/**
 * Auth session by token_hash / JTI.
 * @param {string} tokenHash
 * @returns {Promise<{ ok, session?, error? }>}
 */
export async function sessionByTokenHash(tokenHash) {
  if (!tokenHash) return { ok: false, error: "tokenHash_required" };
  const r = await get(`/v1/session?tokenHash=${encodeURIComponent(tokenHash)}`, { timeoutMs: 2_000 });
  return r.body || { ok: false, error: "empty_response" };
}
