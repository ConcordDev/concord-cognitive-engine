// server/tests/brain-endpoint-cloud-pool.test.js
//
// Task #31 of the Private Mode / High Power Mode plan — concurrency item
// (b): pickBrainEndpoint()'s opt-in `includeCloud` cloud pool candidates.
//
// Pins:
//   1. Default behavior (no opts, or includeCloud: false/omitted) is
//      byte-identical to before this feature -- local endpoints only,
//      never a cloud sentinel, regardless of whether a platform provider
//      is configured for the slot. A Private-Mode call site (which never
//      passes includeCloud) can never see a cloud candidate.
//   2. With includeCloud: true AND a configured platform provider for
//      that slot, a `cloud:<providerId>` sentinel joins the pool and
//      participates in the SAME least-inflight + failure-penalty scoring
//      as local endpoints -- proven by literally saturating the local
//      endpoint's inflight counter and watching the pick flip to cloud.
//   3. With includeCloud: true but NO platform provider configured for
//      the slot, behavior is identical to includeCloud: false (no
//      candidate to add).
//   4. noteEndpointStart/noteEndpointFinish work transparently on a
//      cloud sentinel string (it's just a Map key like any URL).
//   5. An operator per-slot provider override changes which provider id
//      the sentinel carries.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };

function clearPlatformEnv() {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CONCORD_PLATFORM_")) delete process.env[k];
  }
}

// Set env BEFORE the module loads — config values are captured at import,
// same convention as brain-multi-endpoint.test.js.
process.env.BRAIN_UTILITY_URLS = "http://cloud-pool-u:11434";
clearPlatformEnv();

const {
  pickBrainEndpoint,
  noteEndpointStart,
  noteEndpointFinish,
  _resetEndpointStats,
} = await import("../lib/brain-config.js");

after(() => { process.env = { ...ORIGINAL_ENV }; });

describe("pickBrainEndpoint — includeCloud opt-in (concurrency item b)", () => {
  beforeEach(() => {
    _resetEndpointStats();
    clearPlatformEnv();
  });

  it("default call (no opts) never returns a cloud candidate, even with a platform provider configured", () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "groq";
    const r = pickBrainEndpoint("utility");
    assert.equal(r, "http://cloud-pool-u:11434");
  });

  it("explicit includeCloud: false is identical to the default", () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "groq";
    const r = pickBrainEndpoint("utility", { includeCloud: false });
    assert.equal(r, "http://cloud-pool-u:11434");
  });

  it("includeCloud: true with NO platform provider configured behaves identically to local-only", () => {
    const r = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(r, "http://cloud-pool-u:11434");
  });

  it("includeCloud: true with a configured provider still prefers the idle local endpoint (lower inflight)", () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "groq";
    // Nothing is inflight anywhere yet — local wins (score 0 for both,
    // but local URLs come first in the candidate list order and the
    // scoring picks the FIRST minimum, matching pre-existing tie-break
    // behavior for a single-candidate-per-score case).
    const r = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(r, "http://cloud-pool-u:11434");
  });

  it("saturating the local endpoint's inflight flips the pick to the cloud sentinel", () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "groq";
    const local = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(local, "http://cloud-pool-u:11434");
    for (let i = 0; i < 25; i++) noteEndpointStart(local);

    const r = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(r, "cloud:groq");
  });

  it("the cloud sentinel carries the actual configured provider id, not a hardcoded default", () => {
    process.env.CONCORD_PLATFORM_MISTRAL_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "mistral";
    const local = pickBrainEndpoint("utility", { includeCloud: true });
    for (let i = 0; i < 25; i++) noteEndpointStart(local);
    const r = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(r, "cloud:mistral");
  });

  it("a failure-penalized local endpoint is starved in favor of cloud, same as it would be vs. another local endpoint", () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "groq";
    const local = pickBrainEndpoint("utility", { includeCloud: true });
    // 3 consecutive failures triggers the existing >=3 heavy penalty.
    noteEndpointFinish(local, { ok: false });
    noteEndpointFinish(local, { ok: false });
    noteEndpointFinish(local, { ok: false });
    const r = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(r, "cloud:groq");
  });

  it("noteEndpointStart/Finish work transparently on a cloud sentinel key", () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "groq";
    const local = pickBrainEndpoint("utility", { includeCloud: true });
    for (let i = 0; i < 25; i++) noteEndpointStart(local);
    const cloudPick = pickBrainEndpoint("utility", { includeCloud: true });
    assert.equal(cloudPick, "cloud:groq");
    // Should not throw, and should behave like any other endpoint key.
    noteEndpointStart(cloudPick);
    noteEndpointFinish(cloudPick, { ok: true });
  });
});
