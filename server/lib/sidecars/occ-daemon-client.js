// occ-daemon-client — thin Node client for server/scripts/conkay_occ_daemon.py.
//
// Concurrency Refactor Phase 2: the OCC bridge used execFile(python, [cli, cmd])
// per request — a cold `import OCP` (~0.7s) every call, and bursts of
// feature-rebuilds stacked processes because nothing serialised them. This
// client hands the command to a long-lived warm daemon over a Unix socket.
//
// FAIL SOFT: every call rejects on transport failure; occ-bridge.js catches and
// falls back to the existing execFile path. `isAvailable()` is a cached ~3s
// probe so the hot path skips the round-trip when the daemon isn't running.

import http from "node:http";
import os from "node:os";
import path from "node:path";

const SOCK =
  process.env.CONCORD_OCC_DAEMON_SOCK ||
  path.join(process.env.CONCORD_RUN_DIR || path.join(os.homedir(), "concord", "run"), "concord-occ-daemon.sock");

const HARD_CEILING_MS = 320_000;

function request(pathname, body, { timeoutMs = 65_000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: SOCK,
        path: pathname,
        method: body == null ? "GET" : "POST",
        headers: body == null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        timeout: Math.min(timeoutMs + 5_000, HARD_CEILING_MS),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          } catch {
            reject(new Error(`occ-daemon: bad JSON (${res.statusCode}): ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", (e) => reject(new Error(`occ-daemon unreachable: ${e.code || e.message}`)));
    req.on("timeout", () => req.destroy(new Error("occ-daemon: request timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

let _availAt = 0;
let _availVal = null;
export async function isAvailable() {
  const now = Date.now();
  if (now - _availAt < 3_000 && _availVal !== null) return _availVal;
  try {
    const r = await request("/v1/health", null, { timeoutMs: 1_500 });
    _availVal = r.status === 200 && r.body?.ok === true;
  } catch {
    _availVal = false;
  }
  _availAt = now;
  return _availVal;
}

export async function health() {
  const r = await request("/v1/health", null, { timeoutMs: 1_500 });
  return r.body;
}

/**
 * Run an OCC command through the warm daemon.
 * @param {string} cmd  one of conkay_occ_cli.COMMANDS
 * @param {object} payload
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<object>} the command's own result dict (same shape as the CLI)
 */
export async function runCommand(cmd, payload = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs || 65_000;
  const r = await request("/v1/occ", { cmd, payload, timeoutMs }, { timeoutMs });
  return r.body || { ok: false, reason: "occ_daemon_empty_response" };
}

export const socketPath = SOCK;
