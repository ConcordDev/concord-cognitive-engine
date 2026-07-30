/**
 * server/tests/ssrf-guard-pinned-ip.test.js
 *
 * Security audit 2026-07-30, found while investigating why a FRONTEND
 * vitest test (concord-frontend/tests/law-tracked-changes.test.ts, which
 * reaches across into server/domains/law.js) failed to even collect: Vite's
 * import-analysis choked on `fetchWithPinnedIp`'s `await import("undici")`,
 * because `undici` was never actually installed anywhere — not declared in
 * server/package.json, not in concord-frontend/package.json, not resolvable
 * at real Node runtime either (confirmed directly: `node -e "import('undici')"`
 * throws `Cannot find package 'undici'`).
 *
 * That is a materially worse finding than a test-collection quirk:
 * `fetchWithPinnedIp` is this codebase's DNS-rebinding-resistant SSRF
 * defense (the "happy path" per its own header comment) — the try block
 * that constructs an undici Agent with a pinned lookup() ALWAYS threw
 * `Cannot find package 'undici'` and silently fell into the weaker
 * catch-fallback path (re-validate + a plain, unpinned fetch — honestly
 * documented in the source as "not perfect", vulnerable to a DNS-rebinding
 * TOCTOU gap between validation and the actual connection) on every single
 * call, in every environment, because the dependency was simply never
 * installed. The lazy-import + try/catch pattern was correctly written to
 * degrade gracefully for an OPTIONAL absence — but the absence here wasn't
 * optional-by-choice, it was a missing package.json entry.
 *
 * Fixed: added `undici` as a real (non-optional) dependency
 * (server/package.json, pinned `6.28.0` — the latest release still
 * supporting this codebase's stated `engines.node >=18.0.0` floor; undici
 * 7.x requires Node >=20.18.1, undici 6.14+ requires >=18.17).
 *
 * This test proves the FIX, not just the absence of a crash: it builds a
 * `check` object (the validateSafeFetchUrl() return shape) naming a
 * hostname that does NOT resolve via real DNS at all
 * (`this-host-does-not-exist.invalid`, RFC 2606 reserved — guaranteed
 * NXDOMAIN), with `resolvedIp` pointing at a real local test server. If
 * fetchWithPinnedIp() is genuinely using the pinned-IP path, the request
 * succeeds regardless of the unresolvable hostname (the Agent's custom
 * lookup() intercepts DNS entirely). If it silently fell back to the
 * catch-branch bug this test guards against, the request would fail trying
 * to resolve the bogus hostname for real.
 *
 * Run: node --test server/tests/ssrf-guard-pinned-ip.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchWithPinnedIp } from "../lib/ssrf-guard.js";

describe("fetchWithPinnedIp — the pinned-IP path actually engages", () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned-ip-reached");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("undici is actually resolvable (the dependency this whole fix is about)", async () => {
    const undici = await import("undici").catch(() => null);
    assert.ok(undici, "undici must be installed — see server/package.json");
    assert.equal(typeof undici.Agent, "function");
  });

  it("reaches the local server via the PINNED ip, even though the URL's hostname cannot resolve at all", async () => {
    // A real DNS lookup for this hostname is guaranteed to fail (RFC 2606
    // reserved .invalid TLD). If fetchWithPinnedIp silently fell back to
    // the unpinned catch-branch, it would try to actually resolve this
    // hostname and fail — proving the bug. If it succeeds, the pinned-IP
    // path did the connecting, not a real DNS lookup of the hostname.
    const check = {
      ok: true,
      url: `http://this-host-does-not-exist.invalid:${port}/`,
      hostname: "this-host-does-not-exist.invalid",
      resolvedIp: "127.0.0.1",
      family: 4,
    };

    const res = await fetchWithPinnedIp(check);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, "pinned-ip-reached");
  });

  it("rejects when given a bad check object (defensive contract, unchanged)", async () => {
    await assert.rejects(
      () => fetchWithPinnedIp({ ok: false, error: "blocked" }),
      /validateSafeFetchUrl failed/
    );
  });
});
