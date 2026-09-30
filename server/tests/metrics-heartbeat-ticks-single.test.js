// GET /metrics must carry exactly one concord_heartbeat_ticks_total family,
// and it must be the governor's prom-client counter.
//
// Regression (found 2026-09-30): routes/system.js printed a hand-written
// concord_heartbeat_ticks_total from STATE.__bgTickCounter (kernelTick, a
// different loop) and then appended the prom-client registry, which has the
// real governor counter under the same name. The CI tick-SLO guard reads the
// first matching line, so it saw the kernel count (0) while the governor had
// ticked. kernelTick is now concord_kernel_ticks_total.
import { test } from "node:test";
import assert from "node:assert/strict";
import prom from "prom-client";
import registerSystemRoutes from "../routes/system.js";

function captureRoutes() {
  const routes = new Map();
  const app = new Proxy({}, {
    get: (_t, method) => (routePath, ...handlers) => {
      if (typeof routePath === "string") routes.set(`${String(method).toUpperCase()} ${routePath}`, handlers[handlers.length - 1]);
    },
  });
  return { app, routes };
}

test("/metrics: one heartbeat-ticks family, from the governor counter; kernel ticks under their own name", async (t) => {
  const registry = new prom.Registry();
  const heartbeatTicks = new prom.Counter({ name: "concord_heartbeat_ticks_total", help: "Governor ticks", registers: [registry] });
  heartbeatTicks.inc(7);
  const prevMetrics = globalThis._concordMETRICS;
  const prevProm = globalThis._concordPromMetrics;
  globalThis._concordMETRICS = { registry };
  globalThis._concordPromMetrics = { heartbeatTicks };
  t.after(() => { globalThis._concordMETRICS = prevMetrics; globalThis._concordPromMetrics = prevProm; });

  const { app, routes } = captureRoutes();
  const passthrough = () => (_req, _res, next) => next?.();
  registerSystemRoutes(app, {
    STATE: { __bgTickCounter: 3, dtus: new Map(), sessions: new Map() },
    requireRole: passthrough, rateLimiter: passthrough, helmet: passthrough,
    makeCtx: () => ({}), runMacro: async () => ({}), MACROS: new Map(), db: null,
  });
  const handler = routes.get("GET /metrics");
  assert.ok(handler, "GET /metrics registered");

  // asyncHandler doesn't return its promise, so wait for send() itself.
  const body = await new Promise((resolve, reject) => {
    const res = { set() { return res; }, status() { return res; }, send: resolve, end: () => resolve(""), json: (j) => resolve(JSON.stringify(j)) };
    handler({ headers: {} }, res, (e) => reject(e || new Error("next() called")));
  });
  const samples = body.split("\n").filter((l) => l.startsWith("concord_heartbeat_ticks_total "));
  assert.deepEqual(samples, ["concord_heartbeat_ticks_total 7"]);
  assert.equal((body.match(/^# TYPE concord_heartbeat_ticks_total /gm) || []).length, 1);
  assert.match(body, /^concord_kernel_ticks_total 3$/m);
  assert.match(body, /^concord_heartbeat_tick_total 7$/m);
});
