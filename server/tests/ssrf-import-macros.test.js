// server/tests/ssrf-import-macros.test.js
//
// Pins the SSRF fix for the two URL-importing macros found in the 2026-07-27
// Aikido triage:
//   - cooking.import-from-url      (server/domains/cooking.js)
//   - productivity.calendar-import-ics (server/domains/productivity.js)
//
// Both previously called a bare `fetch()` on a caller-supplied URL behind
// nothing but a scheme regex (`/^https?:\/\//`), so cloud metadata
// (169.254.169.254), the loopback Ollama brains (127.0.0.1:11434), and RFC1918
// ranges were all reachable. The productivity one is the worse of the two: it
// parses the response and returns the parsed events, making it a *reflected*
// SSRF rather than a blind one.
//
// Both now go through lib/public-fetch.js#fetchPublicUrl, which validates the
// scheme, blocks private/link-local IPs, and pins the connection to the
// validated IP (defeating DNS rebinding). Rejection throws with
// `.code === "SSRF_BLOCKED"`, which each macro maps to a generic
// "url not allowed" so the guard's internal reason isn't leaked to the caller.
//
// No network required: the guard rejects these targets before any egress.
//
// Run: node --test server/tests/ssrf-import-macros.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./depth/_harness.js";

// Targets that must never be fetchable from a user-supplied URL.
const BLOCKED = [
  ["cloud metadata (link-local)", "http://169.254.169.254/latest/meta-data/"],
  ["loopback — the local Ollama brains", "http://127.0.0.1:11434/api/tags"],
  ["loopback by name", "http://localhost:5050/api/admin/stats"],
  ["RFC1918 private range", "http://10.0.0.1/"],
  ["RFC1918 private range (192.168)", "http://192.168.1.1/"],
];

describe("cooking.import-from-url — SSRF guard", () => {
  for (const [label, url] of BLOCKED) {
    it(`blocks ${label}`, async () => {
      const r = await lensRun("cooking", "import-from-url", { params: { url } });
      assert.equal(r.result?.ok, false, `${url} must not be fetched`);
      assert.equal(
        r.result?.error, "url not allowed",
        "must surface the generic guard rejection, not a transport error and not the guard's internal reason"
      );
    });
  }

  it("still rejects a non-http(s) scheme before the guard runs", async () => {
    const r = await lensRun("cooking", "import-from-url", { params: { url: "file:///etc/passwd" } });
    assert.equal(r.result?.ok, false);
    assert.equal(r.result?.error, "valid http(s) url required");
  });
});

describe("productivity.calendar-import-ics — SSRF guard", () => {
  for (const [label, url] of BLOCKED) {
    it(`blocks ${label}`, async () => {
      const r = await lensRun("productivity", "calendar-import-ics", { params: { url } });
      assert.equal(r.result?.ok, false, `${url} must not be fetched`);
      assert.equal(r.result?.error, "url not allowed");
    });
  }

  it("still rejects a non-http(s) scheme before the guard runs", async () => {
    const r = await lensRun("productivity", "calendar-import-ics", { params: { url: "file:///etc/passwd" } });
    assert.equal(r.result?.ok, false);
    assert.equal(r.result?.error, "url must be http(s)");
  });

  it("the inline `ics` path is unaffected by the guard (no URL, no fetch)", async () => {
    // Regression guard: the fix must not break the non-URL code path.
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Test Event",
      "DTSTART:20260101T120000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const r = await lensRun("productivity", "calendar-import-ics", { params: { ics } });
    // On success the envelope unwraps to the inner result object (no `.ok`),
    // unlike the error path which surfaces { ok:false, error }.
    assert.equal(r.result?.error, undefined, "inline ICS import must not error");
    assert.equal(r.result?.parsedEvents, 1, "the one VEVENT must parse");
  });
});
