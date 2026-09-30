// go-sidecar-client — thin Node client for engines/concord-go-sidecar.
//
// Concurrency Refactor Phase 1 (audit finding C03): Whisper / Piper / sandbox
// used `spawnSync` on the request path, blocking the event loop for up to the
// child's timeout. This client hands that work to a long-lived Go process over
// a Unix domain socket so `await` actually yields.
//
// FAIL SOFT: every method rejects on transport failure; callers catch and fall
// back to their existing inline path. `isAvailable()` is a cheap cached probe
// so hot paths can skip the round-trip when the sidecar isn't running.

import http from "node:http";
import os from "node:os";
import path from "node:path";

const SOCK =
  process.env.CONCORD_GO_SIDECAR_SOCK ||
  path.join(process.env.CONCORD_RUN_DIR || path.join(os.homedir(), "concord", "run"), "concord-go-sidecar.sock");

const DEFAULT_REQ_TIMEOUT_MS = 5 * 60_000; // hard ceiling; per-call timeoutMs is passed through to the sidecar too

function request(pathname, body, { timeoutMs = DEFAULT_REQ_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: SOCK,
        path: pathname,
        method: body == null ? "GET" : "POST",
        headers: body == null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        timeout: Math.min(timeoutMs + 5_000, DEFAULT_REQ_TIMEOUT_MS + 5_000),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          } catch (e) {
            reject(new Error(`go-sidecar: bad JSON (${res.statusCode}): ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", (e) => reject(new Error(`go-sidecar unreachable: ${e.code || e.message}`)));
    req.on("timeout", () => {
      req.destroy(new Error("go-sidecar: request timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── availability probe (cached ~3s) ────────────────────────────────────────
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
 * @param {{ audioPath?: string, audioBase64?: string, model?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, transcript?: string, error?: string }>}
 */
export async function whisper(opts) {
  const r = await request("/v1/whisper", opts, { timeoutMs: opts.timeoutMs || 60_000 });
  return r.body || { ok: false, error: "empty_response" };
}

/**
 * @param {{ text: string, modelArg?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, wav?: Buffer, error?: string }>}
 */
export async function piper(opts) {
  const r = await request("/v1/piper", opts, { timeoutMs: opts.timeoutMs || 30_000 });
  const b = r.body || {};
  if (b.ok && b.wavBase64) return { ok: true, wav: Buffer.from(b.wavBase64, "base64"), source: b.source };
  return { ok: false, error: b.error || "empty_response" };
}

/**
 * @param {{ command: string, workDir?: string, timeoutMs?: number, maxOutputBytes?: number, env?: Record<string,string> }} opts
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
export async function sandbox(opts) {
  const r = await request("/v1/sandbox", opts, { timeoutMs: opts.timeoutMs || 15_000 });
  return r.body || { exitCode: 1, stdout: "", stderr: "go-sidecar: empty response", timedOut: false };
}

export const socketPath = SOCK;
