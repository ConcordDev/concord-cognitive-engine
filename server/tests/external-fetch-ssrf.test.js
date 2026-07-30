// server/tests/external-fetch-ssrf.test.js
//
// Pins the SSRF chokepoint added to server/lib/external-fetch.js
// (2026-07-27 Aikido triage — the systemic version of the SEC-2 finding).
//
// THE GAP: external-fetch.js is imported by 38 files and its own docstring
// says it is for "free public APIs", but it used a bare `fetch(url)`. Any
// caller passing a user-derived URL therefore reached whatever that URL named
// — cloud metadata (169.254.169.254), the loopback Ollama brains, RFC1918.
//
// Two callers were live AND REFLECTED, which makes them exfiltration rather
// than a blind probe:
//   • import.fetchFromConnector `rest_api` / `csv_url` — fetches cfg.url,
//     which is params.url straight off the macro input, and returns the
//     parsed body to the caller as `rows`.
//   • custom.bindingTest — fetches a user-authored binding's target.url and
//     returns a response sample plus its field names.
//
// THE FIX: fetchJsonWithTimeout (and therefore cachedFetchJson, which wraps
// it) now goes through lib/public-fetch.js#fetchPublicUrl — the same guard
// SEC-2 used. Guarding the shared helper closes the class for all 38
// importers, including ones added later.
//
// Run: node --test server/tests/external-fetch-ssrf.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchJsonWithTimeout,
  cachedFetchJson,
  clearExternalFetchCache,
} from "../lib/external-fetch.js";

const BLOCKED = [
  ["cloud metadata (link-local)", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
  ["loopback — the local Ollama brains", "http://127.0.0.1:11434/api/tags"],
  ["loopback by name", "http://localhost:5050/api/admin/stats"],
  ["RFC1918 10/8", "http://10.0.0.1/"],
  ["RFC1918 192.168/16", "http://192.168.1.1/admin"],
  ["RFC1918 172.16/12", "http://172.16.0.1/"],
];

beforeEach(() => clearExternalFetchCache());

describe("fetchJsonWithTimeout — private targets are blocked", () => {
  for (const [label, url] of BLOCKED) {
    it(`blocks ${label}`, async () => {
      await assert.rejects(
        () => fetchJsonWithTimeout(url),
        (e) => {
          assert.equal(e.code, "SSRF_BLOCKED", `expected SSRF_BLOCKED, got ${e.code}: ${e.message}`);
          return true;
        },
        `${url} must not be fetchable`
      );
    });
  }

  it("rejects a non-http(s) scheme", async () => {
    await assert.rejects(() => fetchJsonWithTimeout("file:///etc/passwd"));
  });
});

describe("cachedFetchJson — the cache cannot be used to bypass the guard", () => {
  for (const [label, url] of BLOCKED.slice(0, 3)) {
    it(`blocks ${label} on every call, not just the first`, async () => {
      // A cache that stored a rejection-free entry, or that was consulted
      // before validation, would let a second call through. Both calls must
      // fail identically.
      for (const attempt of [1, 2]) {
        await assert.rejects(
          () => cachedFetchJson(url),
          (e) => e.code === "SSRF_BLOCKED",
          `attempt ${attempt} for ${url} must be blocked`
        );
      }
    });
  }
});

describe("the fetchImpl test seam still works (callers own the transport)", () => {
  it("fetchJsonWithTimeout routes fetchImpl to the transport-override channel", async () => {
    // Regression guard on the destructuring: fetchImpl must be pulled out of
    // opts and handed to fetchPublicUrl's third argument. If it were passed
    // through as a fetch init field it would be silently ignored, the guard
    // would run, and this blocked URL would throw instead of returning data.
    let seen = null;
    const data = await fetchJsonWithTimeout("http://127.0.0.1:9999/x", {
      fetchImpl: (url) => {
        seen = url;
        return { ok: true, json: async () => ({ injected: true }) };
      },
    });
    assert.deepEqual(data, { injected: true });
    assert.equal(seen, "http://127.0.0.1:9999/x");
  });

  it("a non-2xx response from the injected transport still throws", async () => {
    await assert.rejects(
      () => fetchJsonWithTimeout("https://example.invalid/x", {
        fetchImpl: () => ({ ok: false, status: 503, json: async () => ({}) }),
      }),
      /HTTP 503/
    );
  });
});

describe("the guard is applied at the shared helper, not per-call-site", () => {
  it("external-fetch.js contains no unguarded bare fetch(", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/external-fetch.js"),
      "utf8"
    );
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    // `fetchPublicUrl(` is fine; a bare `fetch(` / `await fetch(` is not.
    assert.doesNotMatch(
      code, /(^|[^.\w])fetch\(/m,
      "external-fetch.js must reach the network only through fetchPublicUrl"
    );
  });
});
