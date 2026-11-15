// SB-06 — ConKay knowledge fetches go through the SB-01 SSRF guard,
// with a per-connector host allowlist.
//
// Pristine behaviour: liveGetter's default transport was the raw
// globalThis.fetch, and nothing bound a connector to its own host —
// a getter would fetch loopback, the cloud metadata address, or any
// other host it was handed.
//
// Pins (failure paths first):
//   (1) with allowHosts set, http://127.0.0.1, http://169.254.169.254
//       and an off-allowlist host are refused with the transport spy
//       NEVER called (refused before any fetch and before DNS);
//       an on-list host fetches normally.
//   (2) the connectors' bound getters (pubchemGetter / nistGetter)
//       refuse off-host URLs the same way.
//   (3) the DEFAULT transport is the guard: a private literal is
//       refused as SSRF (error "refused: …"), exactly once — an SSRF
//       refusal is permanent, not retried as a network error.
//   (4) the DNS path: a name that resolves to a private address
//       (localhost) is refused by the guard's validation.
//   (5) pinning: fetchPublicUrl hands the transport the validated
//       address (check.resolvedIp) — the connect cannot be rebound
//       after validation; and it throws SSRF_BLOCKED for a private
//       literal without touching the transport at all.
// The mixed-answer rebind form (a resolver returning a public and a
// private address together) is the guard module's own any-private
// rule, covered by the ssrf suites; these pins cover this layer's
// routing, allowlist and pinning.
// Run: node --test server/tests/conkay-knowledge-ssrf.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { liveGetter, withHostAllowlist } from "../lib/conkay/knowledge/connectors/fetcher.js";
import { pubchemGetter, PUBCHEM_HOSTS } from "../lib/conkay/knowledge/connectors/pubchem.js";
import { nistGetter, NIST_HOSTS } from "../lib/conkay/knowledge/connectors/nist-webbook.js";
import { fetchPublicUrl } from "../lib/public-fetch.js";

const okResponse = (body = "{}") => ({
  ok: true, status: 200,
  text: async () => body,
  headers: { get: () => "application/json" },
});
const spyFetch = (calls) => async (url) => { calls.push(String(url)); return okResponse(); };
const noSleep = async () => {};

describe("SB-06 allowlist (liveGetter)", () => {
  it("(1) private + off-list hosts are refused before any fetch; the on-list host fetches", async () => {
    const calls = [];
    const get = liveGetter({ fetch: spyFetch(calls), allowHosts: PUBCHEM_HOSTS, sleep: noSleep, minIntervalMs: 0 });
    for (const url of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "https://example.com/x"]) {
      const d = await get(url);
      assert.equal(d.ok, false, url);
      assert.match(d.error, /allowlist/, url);
      assert.equal(d.attempts, 0, url);
    }
    assert.deepEqual(calls, [], "the transport is never called for a refused host");
    const good = await get("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/ethanol/cids/JSON");
    assert.equal(good.ok, true);
    assert.equal(calls.length, 1);
  });

  it("(2) the connectors' bound getters refuse off-host URLs", async () => {
    const calls = [];
    const spyGet = async (url) => { calls.push(String(url)); return { ok: true, url, status: 200, body: "{}" }; };
    assert.deepEqual([...PUBCHEM_HOSTS], ["pubchem.ncbi.nlm.nih.gov"]);
    assert.deepEqual([...NIST_HOSTS], ["webbook.nist.gov"]);
    const p = pubchemGetter(spyGet);
    assert.equal((await p("http://127.0.0.1/x")).ok, false);
    assert.equal((await p("https://webbook.nist.gov/x")).ok, false, "another connector's host is off-list here");
    assert.equal((await p("https://pubchem.ncbi.nlm.nih.gov/x")).ok, true);
    const n = nistGetter(spyGet);
    assert.equal((await n("http://169.254.169.254/")).ok, false);
    assert.equal((await n("https://webbook.nist.gov/cgi/fluid.cgi?x")).ok, true);
    assert.equal(calls.length, 2, "only the two on-list calls reached the getter");
    const direct = withHostAllowlist(spyGet, ["example.org"]);
    assert.equal((await direct("not a url")).ok, false, "an unparseable URL is refused, never fetched");
  });
});

describe("SB-06 guarded default transport", () => {
  it("(3) a private literal is refused once, as SSRF — not retried as a network error", async () => {
    const get = liveGetter({ sleep: noSleep, minIntervalMs: 0, maxAttempts: 4 });
    const d = await get("http://127.0.0.1:9/secret");
    assert.equal(d.ok, false);
    assert.match(d.error, /^refused: /);
    assert.equal(d.attempts, 1);
  });

  it("(4) a hostname resolving to a private address is refused (localhost)", async () => {
    const get = liveGetter({ sleep: noSleep, minIntervalMs: 0, maxAttempts: 2 });
    const d = await get("http://localhost:9/secret");
    assert.equal(d.ok, false);
    assert.match(d.error, /^refused: /);
  });

  it("(5) the pinned transport receives the validated address; a private literal never reaches it", async () => {
    let captured = null;
    const res = await fetchPublicUrl("http://93.184.216.34/data", {}, {
      pinnedFetchImpl: async (check) => { captured = check; return okResponse(); },
    });
    assert.equal(res.ok, true);
    assert.equal(captured.resolvedIp, "93.184.216.34");
    let transportCalled = false;
    await assert.rejects(
      fetchPublicUrl("http://127.0.0.1/data", {}, { pinnedFetchImpl: async () => { transportCalled = true; return okResponse(); } }),
      (e) => e.code === "SSRF_BLOCKED",
    );
    assert.equal(transportCalled, false);
  });
});
