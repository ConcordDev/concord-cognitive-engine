// Verification-audit fix — structural regression test for a duplicate
// GET /api/health registration in server/routes/system.js
// (duplicate-handler-race finding).
//
// Two handlers existed: the live one (first-registered) is a documented
// "Alias /api/health → /health" 307 redirect to the well-designed liveness
// probe at GET /health (always-200, diagnostic-only checks — see that
// handler's own comment on the liveness-vs-readiness split). The second,
// dead-by-registration-order duplicate returned a different, less-careful
// shape (it could 503 purely on `STATE` being falsy) and was never
// reachable. Removed rather than merged — the live redirect is the
// intentional design. This is a pure dead-code deletion with zero change
// to live request/response behavior, hence a structural pin rather than a
// functional one (nothing observable changed to assert against).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_JS = path.resolve(__dirname, "..", "routes", "system.js");
const src = readFileSync(SYSTEM_JS, "utf8");

describe("routes/system.js — GET /api/health registered exactly once", () => {
  it("has exactly one app.get(\"/api/health\", ...) registration", () => {
    const matches = src.match(/app\.get\(\s*["']\/api\/health["']/g) || [];
    assert.equal(matches.length, 1, "expected exactly one GET /api/health registration");
  });

  it("the surviving registration is the documented redirect alias to /health", () => {
    const idx = src.indexOf('app.get("/api/health"');
    assert.ok(idx >= 0);
    const block = src.slice(Math.max(0, idx - 200), idx + 200);
    assert.match(block, /Alias \/api\/health.*\/health/);
    assert.match(src.slice(idx, idx + 80), /res\.redirect\(307, "\/health"\)/);
  });

  it("GET /health (the liveness probe /api/health redirects to) is untouched — still always-200 by design", () => {
    assert.match(src, /app\.get\("\/health", \(req, res\) => \{/);
    assert.match(src, /Always 200 — liveness is "the process responded"/);
  });
});
