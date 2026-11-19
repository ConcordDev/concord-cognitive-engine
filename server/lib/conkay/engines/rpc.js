/**
 * Engine RPC transport — SXE-51 (ConKay solver catalogue,
 * Wave 2), built in the CI-only scope of the founder F1
 * ruling (2026-11-18).
 *
 * SXE-00 runs engine kernels as local child processes.
 * This module is the authenticated transport that lets
 * the same manifest entries execute on a separate
 * compute host (H2) when one exists: a client
 * (runRemoteEngine) and the host agent (createEngineHost)
 * speaking the SXE-00 kernel contract over one JSON POST,
 * so a result served over RPC is the host's
 * runProcessKernel result verbatim — same status, same
 * provenance, same refusal names — with `via:
 * "engine-rpc"` stamped for audit.
 *
 * Honesty discipline, inherited from SXE-00:
 *   - No endpoint configured for an engine (the prod
 *     posture until H2 exists) is NOT_COMPUTED
 *     `engine_unavailable:<id>` — honest absence, never
 *     a fallback number.
 *   - Authentication is mandatory on both ends. The
 *     host refuses to start without a token; the client
 *     refuses to call without one; a rejected call is
 *     NOT_COMPUTED `engine_rpc_auth_failed:<id>` — a
 *     configuration error named distinctly, never
 *     mistaken for absence.
 *   - Heavy runs serialize on the host through a FIFO
 *     queue (one at a time, per the ticket's behavioural
 *     contract). A call that cannot START within its
 *     declared queue budget is NOT_COMPUTED
 *     `engine_rpc_queue_timeout:<id>` naming the wait —
 *     never a silent hang.
 *   - An engine the host does not carry answers
 *     `engine_unavailable:<id>` — removal is a refusal,
 *     never a crash (the ticket's adversarial leg).
 *
 * Configuration (env only; the manifest shape is
 * untouched): CONKAY_ENGINE_<ID>_RPC_URL per engine,
 * CONKAY_ENGINE_RPC_TOKEN shared. The host leg — an
 * actual H2 provisioning — is the ticket's deferred-open
 * remainder under F1; this module is proven in CI
 * against a loopback host.
 */

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getEngine } from "./manifest.js";
import { runProcessKernel } from "./run-engine.js";

const DEFAULT_TIMEOUT_MS = 180_000; // covers queue wait + run
const DEFAULT_QUEUE_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const envKeyFor = (engineId) => `CONKAY_ENGINE_${engineId.toUpperCase().replace(/-/g, "_")}_RPC_URL`;

export function resolveRpcEndpoint(engineId, env = process.env) {
  const url = env[envKeyFor(engineId)];
  return typeof url === "string" && url.length > 0 ? url : null;
}

function refusal(engineId, entry, reason, failures, started) {
  return {
    status: "NOT_COMPUTED",
    reason,
    failures,
    provenance: { engine: engineId, version: entry?.version ?? null, kernelHash: null },
    runtimeMs: Date.now() - started,
    via: "engine-rpc",
  };
}

/**
 * Run an engine op on its configured RPC host. Returns
 * the SXE-00 result shape on every path.
 */
export async function runRemoteEngine(engineId, op, request, opts = {}) {
  const started = Date.now();
  const env = opts.env ?? process.env;
  const entry = getEngine(engineId);
  if (!entry) {
    return refusal(engineId, null, `engine_unavailable:${engineId}`,
      [`engine ${engineId} has no manifest entry`], started);
  }
  const endpoint = resolveRpcEndpoint(engineId, env);
  if (!endpoint) {
    return refusal(engineId, entry, `engine_unavailable:${engineId}`,
      [`engine ${engineId} has no RPC endpoint configured (${envKeyFor(engineId)} unset) — no compute host is provisioned. ${entry.installHint ?? ""}`.trim()], started);
  }
  const token = env.CONKAY_ENGINE_RPC_TOKEN;
  if (!token) {
    return refusal(engineId, entry, `engine_rpc_auth_failed:${engineId}`,
      ["CONKAY_ENGINE_RPC_TOKEN is not configured on the client — unauthenticated engine calls are never sent"], started);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const queueTimeoutMs = opts.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ engineId, op, request, queueTimeoutMs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return refusal(engineId, entry, `engine_unavailable:${engineId}`,
      [`engine host unreachable at ${endpoint}: ${err?.cause?.code ?? err?.name ?? "network error"} — treated as absence, never a fallback`], started);
  }
  if (res.status === 401) {
    return refusal(engineId, entry, `engine_rpc_auth_failed:${engineId}`,
      ["the engine host rejected the client's token"], started);
  }
  if (res.status === 404) {
    return refusal(engineId, entry, `engine_unavailable:${engineId}`,
      [`the engine host does not carry engine ${engineId}`], started);
  }
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    if (body.error === "queue_timeout") {
      return refusal(engineId, entry, `engine_rpc_queue_timeout:${engineId}`,
        [`the run did not start within its queue budget (${queueTimeoutMs} ms; waited ${body.waitedMs ?? "?"} ms) — the host queue is saturated`], started);
    }
    return refusal(engineId, entry, `engine_unavailable:${engineId}`,
      [`the engine host refused the run: ${body.error ?? "queue_full"}`], started);
  }
  if (res.status !== 200) {
    return refusal(engineId, entry, `engine_unavailable:${engineId}`,
      [`the engine host answered HTTP ${res.status}`], started);
  }
  const result = await res.json();
  return { ...result, via: "engine-rpc" };
}

/**
 * The host agent. Serves the engines registered in THIS
 * process's manifest registry, one run at a time, behind
 * a mandatory bearer token. Returns an http.Server that
 * is not yet listening — the caller binds it (CI binds
 * loopback; H2 will bind its provisioned interface).
 */
export function createEngineHost({ token, maxQueue = 16 } = {}) {
  if (!token || typeof token !== "string") {
    throw new Error("createEngineHost requires a token — an unauthenticated engine host never serves");
  }
  const tokenBuf = Buffer.from(token);
  const authed = (req) => {
    const h = req.headers.authorization ?? "";
    const presented = h.startsWith("Bearer ") ? Buffer.from(h.slice(7)) : Buffer.alloc(0);
    return presented.length === tokenBuf.length && timingSafeEqual(presented, tokenBuf);
  };

  // FIFO serialization: one run at a time, in arrival order.
  let tail = Promise.resolve();
  let waiting = 0;

  const server = createServer((req, res) => {
    const send = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { "content-type": "application/json" });
      res.end(body);
    };
    if (req.method !== "POST" || req.url !== "/run") { send(404, { error: "not_found" }); return; }
    if (!authed(req)) { send(401, { error: "unauthorized" }); return; }
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); }
      chunks.push(c);
    });
    req.on("end", async () => {
      let call;
      try {
        call = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        send(400, { error: "bad_json" });
        return;
      }
      const { engineId, op, request } = call ?? {};
      const entry = typeof engineId === "string" ? getEngine(engineId) : null;
      if (!entry) { send(404, { error: `engine_unavailable:${engineId}` }); return; }
      if (waiting >= maxQueue) { send(503, { error: "queue_full" }); return; }
      const queueTimeoutMs = Number.isFinite(call.queueTimeoutMs) ? call.queueTimeoutMs : DEFAULT_QUEUE_TIMEOUT_MS;
      const state = { enqueuedAt: Date.now(), started: false, settled: false };
      waiting += 1;
      const settle = () => {
        if (!state.settled) { state.settled = true; waiting -= 1; }
      };
      const job = tail.then(async () => {
        state.started = true;
        settle();
        if (state.timedOut) return; // answered 503 already; never execute
        const result = await runProcessKernel(entry, op, request ?? {});
        send(200, result);
      });
      // keep the chain alive even if a job throws
      tail = job.catch(() => {});
      // queue-wait deadline: a job that has not STARTED in
      // budget is answered 503 and marked so its eventual
      // start no-ops — the run never executes late
      const timer = setTimeout(() => {
        if (!state.started) {
          state.timedOut = true;
          settle();
          send(503, { error: "queue_timeout", waitedMs: Date.now() - state.enqueuedAt });
        }
      }, queueTimeoutMs);
      job.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
    });
  });
  return server;
}
