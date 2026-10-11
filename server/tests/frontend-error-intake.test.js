// Frontend route-error intake: scrub secrets, rate-limit, and feed observe()
// via ERROR_CONTEXT.capture (capture calls observe).
//
// Run: node --test server/tests/frontend-error-intake.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import {
  ingestFrontendError,
  scrubFrontendErrorText,
  _resetFrontendErrorIntakeForTest,
  getFrontendErrorSignals,
  FRONTEND_ERROR_GLOBAL_MAX,
  FRONTEND_SIGNAL_CAP,
} from "../lib/frontend-error-intake.js";
import { ERROR_CONTEXT, REPAIR_QUEUE, RUNTIME_PATCHES, getErrorAccumulator, processRepairQueue } from "../emergent/repair-cortex.js";
import { checkRateLimit, LIMITS } from "../rateLimit.js";
import { bodyLimitForUrl } from "../middleware/index.js";

const TOKEN = "sk_live_abcd1234EFGH5678";
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const EMAIL = "ramaj@example.com";
const SECRET = "hunter2hunter2";

describe("frontend-error intake", { concurrency: false }, () => {
  beforeEach(() => {
    _resetFrontendErrorIntakeForTest();
  });

  it("scrubs secrets and feeds observe() once, with the route and digest", () => {
    const before = REPAIR_QUEUE.length;
    const result = ingestFrontendError({
      error: {
        message: `Boom for ${EMAIL} Bearer ${JWT} password=${SECRET} key ${TOKEN}`,
        stack: `Error: boom\n    at render (/Users/ramaj/app/page.js:1:1)\n    token=${TOKEN}`,
        name: "TypeError",
        digest: "abc123",
      },
      componentStack: `in Lens for ${EMAIL}`,
      lens: "world",
      url: `https://user:${SECRET}@app.example/lenses/world?access_token=${SECRET}`,
    });
    assert.equal(result.ok, true);
    assert.ok(result.errorId);

    const hit = getErrorAccumulator().entries.find((e) => e.context === "frontend:world" && String(e.message).includes("digest=abc123"));
    assert.ok(hit, "observe() accumulator must record the frontend error");
    assert.equal(hit.count, 1);
    assert.match(hit.message, /\/lenses\/world/);
    assert.match(hit.message, /Boom for/);
    const observed = JSON.stringify(hit);
    assert.equal(observed.includes(TOKEN), false);
    assert.equal(observed.includes(JWT), false);
    assert.equal(observed.includes(EMAIL), false);
    assert.equal(observed.includes(SECRET), false);
    assert.equal(observed.includes("/Users/ramaj"), false);

    const entry = ERROR_CONTEXT.getRecent(20).find((e) => e.id === result.errorId);
    assert.ok(entry);
    const stored = JSON.stringify(entry);
    assert.equal(stored.includes(TOKEN), false);
    assert.equal(stored.includes(JWT), false);
    assert.equal(stored.includes(EMAIL), false);
    assert.equal(stored.includes(SECRET), false);
    assert.equal(entry.context.function, "/lenses/world");
    assert.equal(entry.context.inputParams.digest, "abc123");
    assert.match(entry.context.inputParams.componentStack, /\[redacted\]/);
    assert.equal(REPAIR_QUEUE.length, before, "frontend intake must not enqueue repair work");
    const signal = getFrontendErrorSignals().find((row) => row.lens === "world");
    assert.ok(signal);
    assert.equal(signal.errorId, result.errorId);
    assert.equal(signal.count, 1);
  });

  it("leaves an ordinary error message intact", () => {
    const seen = [];
    const result = ingestFrontendError(
      {
        error: { message: "Cannot read properties of undefined (reading 'map')", name: "TypeError" },
        lens: "music",
        route: "/lenses/music",
      },
      {
        capture: (err, ctx) => { seen.push({ err, ctx }); return { id: "e_plain" }; },
      },
    );
    assert.equal(result.ok, true);
    assert.match(seen[0].err.message, /Cannot read properties of undefined/);
    assert.equal(seen[0].ctx.module, "frontend:music");
    assert.equal(seen[0].ctx.function, "/lenses/music");
    assert.equal(scrubFrontendErrorText("just a stack frame at Foo.bar", 200), "just a stack frame at Foo.bar");
  });

  it("stops calling capture once the global window cap is hit", () => {
    let captures = 0;
    const deps = {
      now: () => 5_000_000,
      capture: () => { captures += 1; return { id: "x" }; },
    };
    for (let i = 0; i < FRONTEND_ERROR_GLOBAL_MAX; i++) {
      const r = ingestFrontendError({ error: { message: `n${i}` } }, deps);
      assert.equal(r.ok, true);
      assert.equal(r.limited, undefined);
    }
    assert.equal(captures, FRONTEND_ERROR_GLOBAL_MAX);
    const blocked = ingestFrontendError({ error: { message: "overflow" } }, {
      ...deps,
      capture: () => { throw new Error("capture must not run when limited"); },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.limited, true);
    assert.equal(blocked.errorId, null);
  });

  it("the per-IP write.frontend-error bucket denies after its max", () => {
    const bucket = LIMITS["write.frontend-error"];
    assert.equal(bucket.windowMs, 60_000);
    assert.ok(bucket.max > 0 && bucket.max <= 60);
    const id = `fe-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < bucket.max; i++) {
      assert.equal(checkRateLimit(id, "write.frontend-error").allowed, true);
    }
    const denied = checkRateLimit(id, "write.frontend-error");
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfter > 0);
  });

  it("the route is rate-limited and calls ingestFrontendError", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");
    const at = src.indexOf('app.post("/api/repair/frontend-error"');
    assert.ok(at > 0);
    const slice = src.slice(at, at + 700);
    assert.match(slice, /perEndpointRateLimit\("write\.frontend-error"\)/);
    assert.match(slice, /ingestFrontendError\(req\.body\)/);
    assert.equal(slice.includes("error?.message"), false, "the route must not read the raw message itself");
  });

  it("dedupes one signature inside the window and caps distinct signals", () => {
    let captures = 0;
    const deps = {
      now: () => 8_000_000,
      capture: () => { captures += 1; return { id: `c${captures}` }; },
    };
    const body = {
      error: { message: "Cannot read properties of undefined", name: "TypeError", digest: "same" },
      lens: "chat",
      route: "/lenses/chat",
    };
    const first = ingestFrontendError(body, deps);
    const second = ingestFrontendError(body, deps);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.deduped, true);
    assert.equal(second.errorId, first.errorId);
    assert.equal(captures, 1);
    assert.equal(getFrontendErrorSignals().length, 1);
    assert.equal(getFrontendErrorSignals()[0].count, 2);

    for (let i = 0; i < FRONTEND_SIGNAL_CAP + 10; i++) {
      const r = ingestFrontendError({
        error: { message: `distinct failure ${i}`, digest: `d${i}` },
        lens: "music",
        route: `/lenses/music/${i}`,
      }, deps);
      assert.equal(r.ok, true);
    }
    const rows = getFrontendErrorSignals();
    assert.equal(rows.length, FRONTEND_SIGNAL_CAP);
    assert.equal(rows.some((row) => row.route === "/lenses/chat"), false);
    assert.equal(rows.some((row) => row.route === `/lenses/music/${FRONTEND_SIGNAL_CAP + 9}`), true);
  });

  it("does not persist DTUs, alerts, patches, or repair-brain calls", async () => {
    const savedQueue = REPAIR_QUEUE.splice(0, REPAIR_QUEUE.length);
    const prevState = globalThis.STATE;
    const prevConcord = globalThis._concordSTATE;
    const prevBrain = globalThis._concordBRAIN;
    const prevFetch = globalThis.fetch;
    const prevPaused = globalThis.__memoryPaused;
    const patchKeys = new Set(RUNTIME_PATCHES.keys());
    const state = { dtus: new Map(), sovereignAlerts: [] };
    const fetchCalls = [];
    globalThis.STATE = state;
    globalThis._concordSTATE = state;
    globalThis.__memoryPaused = () => false;
    try {
      REPAIR_QUEUE.push({
        id: "control-unresolved",
        severity: "high",
        error: { message: "widget exploded in a way no strategy matches" },
        context: { module: "billing-control", function: "settle", trigger: "test" },
      });
      await processRepairQueue();
      assert.equal(state.dtus.size, 1, "an unresolved non-frontend entry still escalates");
      assert.equal(state.sovereignAlerts.length, 1);
      state.dtus.clear();
      state.sovereignAlerts.length = 0;

      const n = 30;
      for (let i = 0; i < n; i++) {
        const message = i % 3 === 0
          ? `Cannot read properties of undefined (reading 'f${i}')`
          : i % 3 === 1
            ? `timeout ETIMEDOUT while rendering ${i}`
            : `widget exploded on the client ${i}`;
        const result = ingestFrontendError({
          error: { message, name: "TypeError", digest: `dig${i}` },
          lens: `lens${i}`,
          route: `/lenses/route${i}`,
        });
        assert.equal(result.ok, true);
      }
      assert.equal(REPAIR_QUEUE.length, 0, "ingest must not push frontend entries");

      globalThis._concordBRAIN = {
        repair: { url: "http://127.0.0.1:9", model: "repair-test" },
        utility: { url: "http://127.0.0.1:9", model: "utility-test", enabled: true },
      };
      globalThis.fetch = async (url) => {
        fetchCalls.push(String(url));
        throw new Error("repair brain must not be called for frontend reports");
      };

      for (let i = 0; i < 12; i++) {
        REPAIR_QUEUE.push({
          id: `planted-${i}`,
          severity: "high",
          error: {
            message: i % 3 === 0
              ? `Cannot read properties of undefined (reading 'p${i}')`
              : i % 3 === 1
                ? `timeout ETIMEDOUT planted ${i}`
                : `TypeError: planted is not a function ${i}`,
          },
          context: {
            module: `frontend:lens${i}`,
            function: `/lenses/route${i}`,
            trigger: i === 11 ? "other" : "frontend_render",
          },
        });
      }
      let guard = 0;
      while (REPAIR_QUEUE.length && guard < 5) {
        await processRepairQueue();
        guard += 1;
      }
      assert.equal(REPAIR_QUEUE.length, 0);
      assert.equal(state.dtus.size, 0);
      assert.equal(state.sovereignAlerts.length, 0);
      assert.equal(state._repairCaches, undefined);
      assert.equal(fetchCalls.length, 0);
      for (const key of RUNTIME_PATCHES.keys()) {
        assert.equal(String(key).startsWith("null_guard:frontend:"), false);
        assert.equal(String(key).startsWith("type_guard:frontend:"), false);
        assert.equal(patchKeys.has(key) || !String(key).includes("frontend:"), true);
      }
    } finally {
      REPAIR_QUEUE.splice(0, REPAIR_QUEUE.length, ...savedQueue);
      for (const key of [...RUNTIME_PATCHES.keys()]) {
        if (!patchKeys.has(key)) RUNTIME_PATCHES.delete(key);
      }
      globalThis.STATE = prevState;
      globalThis._concordSTATE = prevConcord;
      globalThis._concordBRAIN = prevBrain;
      globalThis.fetch = prevFetch;
      globalThis.__memoryPaused = prevPaused;
    }
  });

  it("scrubs a long dotted stack before the email regex can backtrack", () => {
    const stack = "a.".repeat(4000);
    scrubFrontendErrorText("a.".repeat(50), 1000);
    const samples = [];
    let out = "";
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      out = scrubFrontendErrorText(stack, 1000);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[2];
    assert.equal(out, "a.".repeat(500));
    assert.ok(median < 15, `median scrub ${median.toFixed(1)}ms (${samples.map((n) => n.toFixed(1)).join(", ")})`);
  });

  it("rejects a frontend-error body over 16kb with 413", async () => {
    assert.equal(bodyLimitForUrl("/api/repair/frontend-error"), "16kb");
    assert.equal(bodyLimitForUrl("/api/repair/frontend-error?stack=1"), "16kb");
    const mw = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../middleware/index.js"), "utf8");
    assert.match(mw, /'\/api\/repair\/frontend-error': '16kb'/);
    assert.match(mw, /bodyLimitForUrl\(req\.url\)/);
    assert.match(mw, /err\.type === 'entity\.too\.large'/);
    assert.match(mw, /status\(413\)/);

    const app = express();
    app.use((req, res, next) => {
      express.json({ limit: bodyLimitForUrl(req.url) })(req, res, next);
    });
    app.use((err, req, res, next) => {
      if (err && err.type === "entity.too.large") {
        return res.status(413).json({ ok: false, error: "payload_too_large", limit: err.limit });
      }
      return next(err);
    });
    app.post("/api/repair/frontend-error", (_req, res) => res.json({ ok: true }));
    app.post("/api/not-limited", (_req, res) => res.json({ ok: true }));

    const server = app.listen(0, "127.0.0.1");
    const port = server.address().port;
    const post = (urlPath, body) => new Promise((resolve, reject) => {
      const data = Buffer.from(body);
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": data.length },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(data);
    });
    try {
      const small = await post("/api/repair/frontend-error", '{"error":{"message":"hi"}}');
      assert.equal(small.status, 200);
      const oversized = await post("/api/repair/frontend-error", `{"error":{"message":"${"x".repeat(20_000)}"}}`);
      assert.equal(oversized.status, 413);
      assert.match(oversized.body, /payload_too_large/);
      const other = await post("/api/not-limited", `{"error":{"message":"${"x".repeat(20_000)}"}}`);
      assert.equal(other.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
