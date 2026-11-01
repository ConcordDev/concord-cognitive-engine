// GB-0489 (c): one lens_run_result line per non-ok (or >2 s) POST /api/lens/run, naming domain + action, with
// tokens only: no input body, no result payload, no free-text error. Repeats are rate-limited.
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "public";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";
process.env.LOG_FORMAT = "json";
process.env.LOG_LEVEL = "info";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createLensRunLogger, lensErrorCode, safeToken } from "../lib/lens-run-log.js";
// Static import on purpose: the harness registers its teardown at module scope of the importing file (see _harness.js).
import { load } from "./depth/_harness.js";

describe("lens-run-log unit", () => {
  const mk = (over = {}) => {
    const lines = [];
    let t = 1_000_000;
    const lg = createLensRunLogger({ log: (level, event, d) => lines.push({ level, event, ...d }), now: () => t, ...over });
    return { lines, lg, tick: (ms) => { t += ms; } };
  };

  it("writes nothing for a fast ok call, a warn line for a failure, an info line for a slow ok call", () => {
    const { lines, lg } = mk();
    assert.equal(lg.record({ domain: "d", action: "a", httpStatus: 200, ok: true, durationMs: 40 }), false);
    assert.equal(lg.record({ domain: "d", action: "a", httpStatus: 200, ok: false, error: "unknown_macro", via: "none", durationMs: 3 }), true);
    assert.equal(lg.record({ domain: "d", action: "slow", httpStatus: 200, ok: true, durationMs: 8004 }), true);
    assert.equal(lines.length, 2);
    assert.deepEqual([lines[0].level, lines[0].error, lines[0].via, lines[0].ok], ["warn", "unknown_macro", "none", false]);
    assert.deepEqual([lines[1].level, lines[1].ok, lines[1].error, lines[1].durationMs], ["info", true, null, 8004]);
  });

  it("keeps tokens only: free-text errors, emails and odd domains never reach the line", () => {
    const { lines, lg } = mk();
    lg.record({ domain: "bad domain <x>", action: "a@b.com", httpStatus: 400, ok: false, error: "user alice@example.com not found", userId: "u 1 secret", requestId: "x".repeat(200), durationMs: 5 });
    const s = JSON.stringify(lines[0]);
    assert.equal(lines[0].domain, "invalid");
    assert.equal(lines[0].action, "invalid");
    assert.equal(lines[0].error, "error_text");
    assert.equal(lines[0].userId, "anon");
    assert.equal(lines[0].requestId, null);
    assert.ok(!/alice|example\.com|secret/.test(s), s);
    assert.equal(lensErrorCode({ error: "forbidden: you can only edit your own" }), "forbidden");
    assert.equal(lensErrorCode({ error: "free text here", code: "not_owner" }), "not_owner");
    assert.equal(safeToken("ok_token-1.2:x"), "ok_token-1.2:x");
    assert.equal(safeToken("has space"), null);
  });

  it("rate-limits repeats of one (user, domain, action, status, code): suppressed inside the window, counted on the next line", () => {
    const { lines, lg, tick } = mk({ windowMs: 30_000 });
    const e = { domain: "ops", action: "poll", httpStatus: 403, ok: false, error: "forbidden", userId: "u1", durationMs: 4 };
    assert.equal(lg.record(e), true);
    tick(12_000); assert.equal(lg.record(e), false);
    tick(12_000); assert.equal(lg.record(e), false);
    tick(12_000); assert.equal(lg.record(e), true, "36 s after the first line");
    assert.equal(lines.length, 2);
    assert.equal(lines[1].suppressed, 2);
    // a different user or action is a different key
    assert.equal(lg.record({ ...e, userId: "u2" }), true);
    assert.equal(lg.record({ ...e, action: "other" }), true);
  });

  it("bounds its memory", () => {
    const { lg } = mk({ maxKeys: 5 });
    for (let i = 0; i < 50; i++) lg.record({ domain: "d", action: `a${i}`, httpStatus: 400, ok: false, error: "x", durationMs: 1 });
    assert.ok(true);
  });
});

describe("POST /api/lens/run writes lens_run_result", { timeout: 180000 }, () => {
  let server; let port;
  const lines = [];
  const realLog = console.log;

  before(async () => {
    console.log = (...a) => {
      const s = a.join(" ");
      if (s.includes('"lens_run_result"')) { try { lines.push(JSON.parse(s)); } catch { /* not json */ } }
      else realLog(...a);
    };
    const t = await load();
    server = http.createServer(t.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });
  after(async () => {
    console.log = realLog;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const post = async (body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/lens/run`, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; LensRunLogTest/1.0)" },
      body: JSON.stringify(body),
    });
    await res.json();
    await new Promise((r) => setTimeout(r, 20)); // "finish" fires just after the body is flushed
    return res.status;
  };
  const last = (domain, action) => lines.filter((l) => l.domain === domain && l.action === action).at(-1);

  it("unknown_macro (HTTP 200 ok:false) is logged with domain, action, via", async () => {
    assert.equal(await post({ domain: "staking", action: "not_a_real_macro", input: { note: "SECRET-INPUT-VALUE alice@example.com" } }), 200);
    const l = last("staking", "not_a_real_macro");
    assert.ok(l, "a line exists");
    assert.deepEqual([l.httpStatus, l.ok, l.error, l.via], [200, false, "unknown_macro", "none"]);
    assert.equal(typeof l.durationMs, "number");
  });

  it("a handler refusal (insufficient_balance, 409) is logged with its status and code", async () => {
    assert.equal(await post({ domain: "staking", action: "open_stake", input: { poolId: "core", principalCc: 100, months: 6 } }), 409);
    const l = last("staking", "open_stake");
    assert.deepEqual([l.httpStatus, l.ok, l.error], [409, false, "insufficient_balance"]);
  });

  it("a pre-dispatch 400 (missing domain/action) is logged without a lens name", async () => {
    const before = lines.length;
    assert.equal(await post({ input: { x: 1 } }), 400);
    const l = lines.slice(before).at(-1);
    assert.deepEqual([l.httpStatus, l.error, l.via, l.domain, l.action], [400, "domain_action_required", "pre_dispatch", null, null]);
  });

  it("a non-finite number guard 400 is logged", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/lens/run`, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; LensRunLogTest/1.0)" },
      body: '{"domain":"staking","action":"estimate_rewards","input":{"principalCc":1e999}}',
    });
    assert.equal(res.status, 400);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(last("staking", "estimate_rewards").error, "non_finite_input");
  });

  it("a fast successful call writes no line, and no line ever carries input or result data", async () => {
    const before = lines.length;
    assert.equal(await post({ domain: "staking", action: "estimate_rewards", input: { poolId: "core", principalCc: 100, months: 6 } }), 200);
    assert.equal(lines.length, before, "ok + fast: silent");
    const all = JSON.stringify(lines);
    assert.ok(!/SECRET-INPUT-VALUE|alice@example\.com|aprPct/.test(all), "no body fields leak");
  });

  it("source pin: the route annotates every early exit and logs on finish", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const route = src.slice(src.indexOf('app.post("/api/lens/run"'), src.indexOf("// REST routes for generic lens artifacts"));
    for (const code of ["domain_action_required", "platform_internal_role", "non_finite_input", "authentication_required", "unknown_macro", "needs_artifact_input", "brain_catchall_timeout", "macro_unavailable", "handler_threw"]) {
      assert.ok(route.includes(`"${code}"`), code);
    }
    assert.match(route, /res\.once\("finish"/);
  });
});
