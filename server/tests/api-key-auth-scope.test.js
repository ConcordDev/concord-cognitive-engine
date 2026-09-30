// Pins the resolveDomain() fix in middleware/api-key-auth.js.
//
// Bug (found 2026-08-30 wiring Concord Predict to a real external caller):
// /api/lens/run is the generic macro dispatcher — the real target domain
// lives in the JSON body ({domain, name, input}), not the URL. The old
// resolveDomain(urlPath) matched /^\/api\/lens\/([^/]+)/ against the URL
// alone, so it always captured the literal path token "run" as the
// "domain" for /api/lens/run specifically. Any csk_ key scoped to a real
// domain (e.g. ["predict"]) could therefore NEVER pass checkScope() against
// that endpoint — the one endpoint the whole macro system funnels through —
// regardless of what scope it held. Caught by an end-to-end curl round trip
// against the live server, not by static reading.
//
// Bidirectional per CLAUDE.md's anti-cheat rule: prove the real case now
// works AND a genuinely out-of-scope case still fails.

import { test } from "node:test";
import assert from "node:assert/strict";

test("resolveDomain: /api/lens/run reads the domain from the body, not the URL", async () => {
  const { resolveDomain } = await import("../middleware/api-key-auth.js");

  // The bug: body domain ignored, URL literal "run" returned instead.
  assert.equal(resolveDomain("/api/lens/run", "predict"), "predict");
  assert.equal(resolveDomain("/api/lens/run", "economy"), "economy");

  // No body domain supplied (e.g. a malformed request) — falls back to the
  // literal URL segment rather than throwing. Never silently grants access.
  assert.equal(resolveDomain("/api/lens/run", undefined), "run");
  assert.equal(resolveDomain("/api/lens/run", ""), "run");
  assert.equal(resolveDomain("/api/lens/run", 123), "run"); // non-string body.domain ignored
});

test("resolveDomain: real /api/lens/:domain/... REST routes are unaffected", async () => {
  const { resolveDomain } = await import("../middleware/api-key-auth.js");

  // These are literal :domain path segments, not the generic dispatcher —
  // the fix must not touch this existing, correct behavior.
  assert.equal(resolveDomain("/api/lens/predict", "run"), "predict");
  assert.equal(resolveDomain("/api/lens/predict/abc123", undefined), "predict");
  assert.equal(resolveDomain("/api/lens/economy/schema", undefined), "economy");
});

test("checkScope end-to-end: a predict-scoped key passes predict, rejects economy, via /api/lens/run", async () => {
  const { resolveDomain } = await import("../middleware/api-key-auth.js");
  const { checkScope } = await import("../lib/api-keys.js");

  const key = { scopes: ["predict"] };

  const allowedDomain = resolveDomain("/api/lens/run", "predict");
  assert.equal(checkScope(key, allowedDomain), true);

  const deniedDomain = resolveDomain("/api/lens/run", "economy");
  assert.equal(checkScope(key, deniedDomain), false);
});
