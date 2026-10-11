// Frontend route-error intake: scrub secrets, rate-limit, and feed observe()
// via ERROR_CONTEXT.capture (capture calls observe).
//
// Run: node --test server/tests/frontend-error-intake.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ingestFrontendError,
  scrubFrontendErrorText,
  _resetFrontendErrorIntakeForTest,
  FRONTEND_ERROR_GLOBAL_MAX,
} from "../lib/frontend-error-intake.js";
import { ERROR_CONTEXT, REPAIR_QUEUE, getErrorAccumulator } from "../emergent/repair-cortex.js";
import { checkRateLimit, LIMITS } from "../rateLimit.js";

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
    assert.equal(REPAIR_QUEUE.length, before + 1);
    assert.equal(REPAIR_QUEUE[REPAIR_QUEUE.length - 1].id, result.errorId);
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
        push: () => {},
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
      push: () => {},
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
});
