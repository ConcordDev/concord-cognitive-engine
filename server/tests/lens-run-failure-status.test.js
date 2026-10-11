/**
 * Handler `{ ok:false }` must not ride out of /api/lens/run as HTTP 200
 * `{ ok:true, result }`. Staking's insufficient_balance carries a `result`
 * payload (live balance); peeling that used to look like a successful lock.
 * Studio artifact create with an illegal status is 422, and a legal create
 * is still on the list after a fresh read.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { httpStatusForLensFailure, shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("shapeLensRunHttp", () => {
  it("lifts insufficient_balance (with a result payload) to 409, not a success envelope", () => {
    const shaped = shapeLensRunHttp({
      ok: false,
      error: "insufficient_balance",
      result: { balance: 0, required: 100 },
    });
    assert.equal(shaped.status, 409);
    assert.equal(shaped.body.ok, false);
    assert.equal(shaped.body.error, "insufficient_balance");
    assert.equal(shaped.body.result.balance, 0);
    assert.equal(shaped.body.result.required, 100);
  });

  it("maps validation, not-found, and authz failures", () => {
    assert.equal(httpStatusForLensFailure("validation_failed"), 422);
    assert.equal(httpStatusForLensFailure("invalid_status"), 422);
    assert.equal(httpStatusForLensFailure("not found"), 404);
    assert.equal(httpStatusForLensFailure("not_found"), 404);
    assert.equal(httpStatusForLensFailure("unauthorized: you can only update your own artifacts"), 403);
    assert.equal(httpStatusForLensFailure("scope_denied"), 403);
    assert.equal(httpStatusForLensFailure("no_actor"), 403);
    assert.equal(shapeLensRunHttp({ ok: false, error: "validation_failed", errors: ["bad"] }).status, 422);
  });

  it("peels one success envelope and lifts a failure nested under one", () => {
    const ok = shapeLensRunHttp({ ok: true, result: { position: { id: "stk_1" } } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, result: { position: { id: "stk_1" } } });

    const nested = shapeLensRunHttp({ ok: true, result: { ok: false, error: "insufficient_balance" } });
    assert.equal(nested.status, 409);
    assert.equal(nested.body.ok, false);
    assert.equal(nested.body.error, "insufficient_balance");
  });
});

const UA = "Mozilla/5.0 (compatible; ConcordLensFailureTest/1.0)";

describe("/api/lens/run and artifact create failure status", { timeout: 180000 }, () => {
  let server;
  let port;
  let db;

  before(async () => {
    process.env.CONCORD_LOAD_SHED_ENABLED = "0";
    process.env.NODE_ENV = process.env.NODE_ENV || "test";
    process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";
    const { load } = await import("./depth/_harness.js");
    const t = await load();
    db = t.db;
    server = http.createServer(t.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function call(method, path, body) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, body: json };
  }

  it("open_stake with 0 CC is 409 insufficient_balance and creates no position", async () => {
    const count = () => db.prepare("SELECT COUNT(*) AS n FROM staking_positions WHERE user_id = ?").get("anon").n;
    const before = count();
    const r = await call("POST", "/api/lens/run", {
      domain: "staking",
      action: "open_stake",
      input: { poolId: "core", principalCc: 100, months: 6 },
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "insufficient_balance");
    assert.notEqual(r.body.ok, true);
    assert.equal(count(), before);
  });

  it("unknown_macro stays HTTP 200 {ok:false} so the client does not retry-storm", async () => {
    const r = await call("POST", "/api/lens/run", {
      domain: "staking",
      action: "not_a_real_macro",
      input: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "unknown_macro");
  });

  it("a successful staking macro stays HTTP 200 {ok:true}", async () => {
    const r = await call("POST", "/api/lens/run", {
      domain: "staking",
      action: "estimate_rewards",
      input: { poolId: "core", principalCc: 100, months: 6 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.result, "object");
    assert.notEqual(r.body.result?.ok, false);
    assert.ok(r.body.result.aprPct != null || r.body.result.principalCc != null);
  });

  it("studio create rejects status active with 422 and lists a draft after reload", async () => {
    const bad = await call("POST", "/api/lens/studio", {
      type: "project",
      title: "Should Fail",
      data: { title: "Should Fail", bpm: 120 },
      meta: { status: "active" },
    });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.ok, false);
    assert.equal(bad.body.error, "validation_failed");
    assert.match(JSON.stringify(bad.body.errors || []), /active/);

    const good = await call("POST", "/api/lens/studio", {
      type: "project",
      title: "Reload Me",
      data: { title: "Reload Me", bpm: 96 },
      meta: { status: "draft" },
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.ok, true);
    const id = good.body.artifact?.id;
    assert.ok(id, "draft create returns an artifact id");

    const list = await call("GET", "/api/lens/studio?type=project&limit=100");
    assert.equal(list.status, 200);
    assert.equal(list.body.ok, true);
    const found = (list.body.artifacts || []).find((a) => a.id === id);
    assert.ok(found, "created project is listed on a fresh read");
    assert.equal(found.title, "Reload Me");
    assert.equal(found.meta?.status, "draft");
  });
});
