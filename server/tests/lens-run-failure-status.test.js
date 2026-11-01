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

// server.js freezes NODE_ENV and AUTH_MODE at import. The default auth mode
// is hybrid, which 401s anonymous POST /api/lens/run before the handler.
// Local-first (AUTH_MODE=public, non-production) is the path the staking
// and studio repros actually exercise: an anon actor with a 0 CC wallet.
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "public";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";

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

  it("returns missing_api_key as HTTP 200 and leaves other missing_* reasons on 422", () => {
    const shaped = shapeLensRunHttp({
      ok: false,
      reason: "missing_api_key",
      envVar: "EPA_AIRNOW_API_KEY",
      signupUrl: "https://docs.airnowapi.org/account/request/",
      message: "Set EPA_AIRNOW_API_KEY in .env to enable this panel.",
    });
    assert.equal(shaped.status, 200);
    assert.equal(shaped.body.ok, false);
    assert.equal(shaped.body.reason, "missing_api_key");
    assert.equal(shaped.body.error, "missing_api_key");
    assert.equal(shaped.body.envVar, "EPA_AIRNOW_API_KEY");
    assert.match(shaped.body.signupUrl, /airnow/);
    assert.equal(shaped.body.observations, undefined);
    assert.equal(httpStatusForLensFailure("missing_inputs"), 422);
    assert.equal(httpStatusForLensFailure("missing_world_id"), 422);
    assert.equal(httpStatusForLensFailure("missing_required_fields"), 422);
  });

  it("returns upstream outages as HTTP 200 but keeps Concord's own rate_limited non-200", () => {
    for (const raw of [
      { ok: false, error: "thedogapi 503", reason: "upstream_unavailable" },
      { ok: false, error: "fetch failed", reason: "opentdb_unreachable" },
      { ok: false, error: "upstream_unavailable" },
      { ok: false, error: "x 429", reason: "upstream_rate_limited" },
    ]) {
      const shaped = shapeLensRunHttp(raw);
      assert.equal(shaped.status, 200, JSON.stringify(raw));
      assert.equal(shaped.body.ok, false);
    }
    // Concord's own throttles (runMacro checkMacroRateLimit, quest report
    // cooldown) are client-side "slow down" answers, not upstream outages.
    for (const raw of [
      { ok: false, error: "rate_limited", retryAfterMs: 60000 },
      { ok: false, error: "rate_limited", reason: "rate_limited", questId: "q1" },
      { ok: false, reason: "rate_limited" },
      { ok: false, error: "agent_rate_limited", retryAfterMs: 1000 },
    ]) {
      const shaped = shapeLensRunHttp(raw);
      assert.notEqual(shaped.status, 200, JSON.stringify(raw));
      assert.equal(shaped.body.ok, false);
    }
  });

  it("maps the opt-in geocoder_unavailable code to 503; other domains unchanged", () => {
    const shaped = shapeLensRunHttp({
      ok: false,
      status: "unavailable",
      code: "geocoder_unavailable",
      error: "geocoder_unavailable",
      reason: "upstream_error: nominatim 503",
      lastOkAt: null,
      retryAfterS: 30,
    });
    assert.equal(shaped.status, 503);
    assert.equal(shaped.body.ok, false);
    assert.equal(shaped.body.code, "geocoder_unavailable");
    assert.equal(shaped.body.retryAfterS, 30);
    // The code channel alone is enough, and so is the bare error string.
    assert.equal(httpStatusForLensFailure("lens_failed", { code: "geocoder_unavailable" }), 503);
    assert.equal(httpStatusForLensFailure("geocoder_unavailable"), 503);
    // A similar-looking upstream failure WITHOUT the opt-in code keeps the
    // generic upstream treatment (200 via the reason channel).
    assert.equal(
      shapeLensRunHttp({ ok: false, error: "nominatim unreachable: geocoder unavailable: upstream_error", reason: "upstream_unavailable" }).status,
      200,
    );
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
    assert.equal(r.status, 409, JSON.stringify(r.body));
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
    assert.equal(bad.status, 422, JSON.stringify(bad.body));
    assert.equal(bad.body.ok, false);
    assert.equal(bad.body.error, "validation_failed");
    assert.match(JSON.stringify(bad.body.errors || []), /active/);

    const good = await call("POST", "/api/lens/studio", {
      type: "project",
      title: "Reload Me",
      data: { title: "Reload Me", bpm: 96 },
      meta: { status: "draft" },
    });
    assert.equal(good.status, 200, JSON.stringify(good.body));
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

describe("timeouts and unreachable upstreams are not HTTP 400 (GB-0489 b)", () => {
  it("a handler that fails because its work timed out or the upstream is unreachable stays HTTP 200 with ok:false", () => {
    for (const error of [
      "catchall_timeout",
      "The operation was aborted due to timeout",
      "This operation was aborted",
      "fetch failed",
      "request timed out after 20000ms",
      "connect ETIMEDOUT 1.2.3.4:443",
      "getaddrinfo ENOTFOUND api.example.com",
      "read ECONNRESET",
      "socket hang up",
    ]) {
      const shaped = shapeLensRunHttp({ ok: false, error });
      assert.equal(shaped.status, 200, error);
      assert.equal(shaped.body.ok, false, error);
      assert.equal(shaped.body.error, error);
    }
    // the reason channel counts too
    assert.equal(httpStatusForLensFailure("lookup failed", { reason: "upstream_timeout" }), 200);
  });

  it("keeps every other classification: validation, not-found, authz and a plain refusal are unchanged", () => {
    assert.equal(httpStatusForLensFailure("invalid_timeout"), 422, "an input named *_timeout is still validation");
    assert.equal(httpStatusForLensFailure("invalid_input"), 400);
    assert.equal(httpStatusForLensFailure("something refused"), 400);
    assert.equal(httpStatusForLensFailure("forbidden: not yours"), 403);
    assert.equal(httpStatusForLensFailure("missing_inputs"), 422);
    assert.equal(httpStatusForLensFailure("timeouts_are_configured_wrong_value_rejected_x"), 400, "a longer word is not a timeout token");
  });
});
