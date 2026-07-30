// server/tests/ingest-engine-ssrf.test.js
//
// Pins the SSRF fix in server/emergent/ingest-engine.js
// (2026-07-27 Aikido triage).
//
// THE GAP: validateDomain() is a NAME check — it compares hostnames against
// an allowlist/blocklist and never resolves them, so it cannot see where a
// name actually points. Three things stacked into a real SSRF:
//
//   1. DOMAIN_BLOCKLIST contains two example.com placeholders, so the
//      blocklist blocks nothing real.
//   2. Only the FREE tier is allowlist-gated. paid/researcher are
//      blocklist-only; sovereign skips both checks entirely.
//   3. routes/operations.js:227 reads the tier straight off the request body
//      (`req.body?.tier || "free"`), so a caller can declare itself sovereign
//      and skip every name check there is.
//
// So `POST /api/ingest/submit {url:"http://169.254.169.254/...", tier:"sovereign"}`
// reached a bare fetch() on an internal address.
//
// THE FIX is at the transport rather than the name check: fetchContent now
// goes through lib/public-fetch.js#fetchPublicUrl, which validates the scheme,
// rejects private/link-local/loopback addresses, and pins the connection to
// the validated IP. That holds for EVERY tier, including a spoofed one — which
// is what these tests assert, by deliberately using the most privileged tier.
//
// Note on the tier-from-body issue itself: guarding the transport removed its
// security impact on this path (the worst a spoofed tier ever bought was
// fetching a public URL, which is what the feature does anyway) — but reading
// a privilege level off the request body was wrong on its own terms, so it
// was fixed separately: routes/operations.js now derives tier from
// req.user?.role (sovereign-family roles only), never from the request body.
// This test file still exercises submitUrl() directly at every tier,
// including a spoofed sovereign, so it keeps covering the transport guard
// regardless of how the tier was decided.
//
// Run: node --test server/tests/ingest-engine-ssrf.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { submitUrl, TIERS } from "../emergent/ingest-engine.js";

const PRIVATE_TARGETS = [
  ["cloud metadata", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
  ["loopback — local Ollama brains", "http://127.0.0.1:11434/api/tags"],
  ["loopback by name", "http://localhost:5050/api/admin/stats"],
  ["RFC1918 10/8", "http://10.0.0.1/"],
  ["RFC1918 192.168/16", "http://192.168.1.1/"],
];

describe("ingest-engine — private targets are unreachable at ANY tier", () => {
  for (const [label, url] of PRIVATE_TARGETS) {
    it(`blocks ${label} even at the sovereign tier`, async () => {
      // Sovereign deliberately: it is the tier that skips both the allowlist
      // and the blocklist, and it is self-declarable via the request body.
      // If the guard were still tier-dependent, this is the case that leaks.
      const r = await submitUrl(`ssrf-test-${Date.now()}-${Math.random()}`, url, TIERS.SOVEREIGN);

      // Two acceptable shapes: rejected outright, or accepted-then-failed with
      // an honest fetch failure. What must NEVER happen is a successful fetch.
      if (r.ok) {
        assert.notEqual(
          r.status, "completed",
          `${url} must not complete an ingest — the content was fetched`
        );
      }
      assert.ok(
        !r.content && !r.text,
        `${url} must not return fetched content`
      );
    });
  }
});

describe("ingest-engine — the name check alone was never sufficient", () => {
  it("the blocklist is placeholder-only, so it cannot be the control", async () => {
    const { DOMAIN_BLOCKLIST } = await import("../emergent/ingest-engine.js");
    // Documents WHY the transport guard is the real control. If someone later
    // fills the blocklist with real entries, this test failing is a prompt to
    // re-read the reasoning above, not a reason to delete the guard.
    for (const entry of DOMAIN_BLOCKLIST) {
      assert.match(entry, /example\.com$/, `unexpected real blocklist entry: ${entry}`);
    }
  });

  it("a private IP is not in the blocklist, so only the transport guard stops it", async () => {
    const { DOMAIN_BLOCKLIST } = await import("../emergent/ingest-engine.js");
    assert.ok(!DOMAIN_BLOCKLIST.has("169.254.169.254"));
    assert.ok(!DOMAIN_BLOCKLIST.has("127.0.0.1"));
  });
});

describe("ingest-engine — the guard's reason is not used as an oracle", () => {
  it("an SSRF rejection surfaces a generic message, not the guard's internal reason", async () => {
    const { __test } = await import("../emergent/ingest-engine.js").then((m) => ({ __test: m }));
    // fetchContent is module-private; exercise it through submitUrl and assert
    // no internal guard wording leaks into whatever comes back.
    const r = await submitUrl(
      `ssrf-oracle-${Date.now()}`,
      "http://169.254.169.254/latest/meta-data/",
      TIERS.SOVEREIGN
    );
    const blob = JSON.stringify(r).toLowerCase();
    assert.ok(!blob.includes("private/reserved"), "guard reason leaked");
    assert.ok(!blob.includes("metadata endpoint blocked"), "guard reason leaked");
    assert.ok(__test, "module import sanity");
  });
});
