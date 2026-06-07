// tests/depth/music-ingest-behavior.test.js — REAL behavioral tests for the
// music free-API ingestion macros (registerLensAction family, via lensRun).
//
// The SUCCESS path of ingest-jamendo / ingest-audius needs outbound HTTPS
// (Jamendo / Audius gateways) which CI/sandbox blocks (no-egress preload), so
// it is exercised on the live box, not here. What IS pinned headless — and is
// the load-bearing contract — is that these macros VALIDATE inputs and
// DEGRADE GRACEFULLY when egress is unavailable: they return {ok:false,error}
// from the try/catch, never throw and crash the lens dispatcher. (cachedFetchJson
// fails closed; the macros catch it.) iTunes ingestion is already covered by the
// live wiring; here we lock the two newly-wired providers' contract.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("music — Jamendo ingestion contract", () => {
  let ctx;
  let savedKey;
  before(async () => {
    ctx = await depthCtx("music-jamendo");
    savedKey = process.env.JAMENDO_CLIENT_ID;
  });
  after(() => {
    if (savedKey === undefined) delete process.env.JAMENDO_CLIENT_ID;
    else process.env.JAMENDO_CLIENT_ID = savedKey;
  });

  it("ingest-jamendo without JAMENDO_CLIENT_ID is rejected before any network call", async () => {
    delete process.env.JAMENDO_CLIENT_ID;
    const r = await lensRun("music", "ingest-jamendo", { params: { term: "piano" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /JAMENDO_CLIENT_ID not configured/);
  });

  it("ingest-jamendo with a key but no search term is rejected", async () => {
    process.env.JAMENDO_CLIENT_ID = "test_client_id";
    const r = await lensRun("music", "ingest-jamendo", { params: { term: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /search term required/);
  });

  it("ingest-jamendo degrades gracefully when egress is blocked (no throw, ok:false)", async () => {
    process.env.JAMENDO_CLIENT_ID = "test_client_id";
    const r = await lensRun("music", "ingest-jamendo", { params: { term: "ambient" } }, ctx);
    // egress is blocked in CI → the macro's try/catch returns a refusal, not a crash
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /jamendo search unreachable/);
  });
});

describe("music — Audius ingestion contract", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("music-audius"); });

  it("ingest-audius with no search term is rejected", async () => {
    const r = await lensRun("music", "ingest-audius", { params: { term: "  " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /search term required/);
  });

  it("ingest-audius degrades gracefully when the gateway is unreachable (no throw, ok:false)", async () => {
    const r = await lensRun("music", "ingest-audius", { params: { term: "lofi" } }, ctx);
    // no-egress → either gateway-resolve or search fetch fails; macro catches it
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /audius (search unreachable|gateway)/);
  });
});
