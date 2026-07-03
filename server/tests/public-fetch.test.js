// S5 / P-A — public-fetch ↔ SSRF-guard round-trip test.
//
// Proves that `fetchPublicUrl` (the keyless, SSRF-guarded transport used by
// government.js#fetchJsonGov) actually routes through the EXISTING ssrf-guard
// (`validateSafeFetchUrl`) and does NOT silently allow a URL the guard rejects.
//
// NO real network egress: every "allowed" case uses a per-call `pinnedFetchImpl`
// (guard still runs, transport is mocked) or the `fetchImpl`/module-scope test
// seam (guard skipped, transport mocked). Every "rejected" case uses a LITERAL
// IP or a bad scheme so `validateSafeFetchUrl` decides without a DNS lookup —
// so the guard never touches the network either.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPublicUrl,
  __setPublicFetchTestTransport,
} from "../lib/public-fetch.js";

// A fake fetch-style Response the mocked transports return.
function fakeResponse(body = { ok: true }) {
  return { ok: true, status: 200, json: async () => body };
}

test("fetchPublicUrl REJECTS a private/reserved IP (guard runs, transport never called)", async () => {
  let pinnedCalled = false;
  const pinnedFetchImpl = async () => {
    pinnedCalled = true;
    return fakeResponse();
  };
  // 10.0.0.1 is RFC1918 private — the guard must reject it BEFORE any transport.
  await assert.rejects(
    () => fetchPublicUrl("http://10.0.0.1/data.json", {}, { pinnedFetchImpl }),
    (err) => {
      assert.strictEqual(err.code, "SSRF_BLOCKED", "must throw the guard's SSRF_BLOCKED code");
      return true;
    },
  );
  assert.strictEqual(pinnedCalled, false, "the pinned transport must NOT be reached for a blocked URL");
});

test("fetchPublicUrl REJECTS the cloud-metadata endpoint", async () => {
  let pinnedCalled = false;
  await assert.rejects(
    () => fetchPublicUrl("http://169.254.169.254/latest/meta-data/", {}, {
      pinnedFetchImpl: async () => { pinnedCalled = true; return fakeResponse(); },
    }),
    (err) => err.code === "SSRF_BLOCKED",
  );
  assert.strictEqual(pinnedCalled, false, "cloud-metadata endpoint must never reach the transport");
});

test("fetchPublicUrl REJECTS a disallowed scheme (file://)", async () => {
  let pinnedCalled = false;
  await assert.rejects(
    () => fetchPublicUrl("file:///etc/passwd", {}, {
      pinnedFetchImpl: async () => { pinnedCalled = true; return fakeResponse(); },
    }),
    (err) => err.code === "SSRF_BLOCKED",
  );
  assert.strictEqual(pinnedCalled, false, "file:// must never reach the transport");
});

test("fetchPublicUrl ALLOWS a public IP and reaches the injected pinned transport (guard still runs)", async () => {
  // 8.8.8.8 is a public IP literal → validateSafeFetchUrl takes the net.isIP
  // branch (no DNS lookup, no egress), passes, and hands a validated `check`
  // to the pinned transport.
  let received = null;
  const pinnedFetchImpl = async (check, init) => {
    received = { check, init };
    return fakeResponse({ hello: "world" });
  };
  const res = await fetchPublicUrl("https://8.8.8.8/api/data", { headers: { "x-test": "1" } }, { pinnedFetchImpl });
  assert.ok(res.ok, "response must be ok");
  assert.deepStrictEqual(await res.json(), { hello: "world" });

  // Prove the guard actually validated + forwarded the pinned check object.
  assert.ok(received, "pinned transport must have been called");
  assert.strictEqual(received.check.ok, true, "transport must receive the validated check");
  assert.strictEqual(received.check.resolvedIp, "8.8.8.8", "check must carry the validated IP");
  assert.strictEqual(received.check.family, 4);
  assert.deepStrictEqual(received.init.headers, { "x-test": "1" }, "init must be forwarded to the transport");
});

test("opts.fetchImpl fully overrides transport and SKIPS the guard (caller owns egress)", async () => {
  // A URL the guard WOULD reject (private IP) still reaches fetchImpl, because
  // fetchImpl means the caller owns the transport — exactly connectorFetch's
  // contract. This is test-only; production never passes fetchImpl.
  let got = null;
  const res = await fetchPublicUrl("http://10.0.0.1/blocked-but-injected", { m: 1 }, {
    fetchImpl: async (url, init) => { got = { url, init }; return fakeResponse({ injected: true }); },
  });
  assert.deepStrictEqual(await res.json(), { injected: true });
  assert.strictEqual(got.url, "http://10.0.0.1/blocked-but-injected");
  assert.deepStrictEqual(got.init, { m: 1 });
});

test("__setPublicFetchTestTransport module seam overrides transport and skips guard; null restores guarded path", async () => {
  let seamCalled = false;
  __setPublicFetchTestTransport(async (url) => {
    seamCalled = true;
    return fakeResponse({ url });
  });
  try {
    // Even a private IP is allowed through because the module seam owns egress.
    const res = await fetchPublicUrl("http://10.0.0.1/via-seam");
    assert.strictEqual(seamCalled, true, "module seam transport must be used");
    assert.deepStrictEqual(await res.json(), { url: "http://10.0.0.1/via-seam" });
  } finally {
    __setPublicFetchTestTransport(null); // restore guarded path — MUST reject private IP again
  }

  // After restore, the guard is back in force.
  await assert.rejects(
    () => fetchPublicUrl("http://10.0.0.1/after-restore"),
    (err) => err.code === "SSRF_BLOCKED",
  );
});
