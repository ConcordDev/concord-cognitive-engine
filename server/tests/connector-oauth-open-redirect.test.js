// server/tests/connector-oauth-open-redirect.test.js
//
// Pins the open-redirect fix in server/routes/connector-oauth.js
// (2026-07-27 Aikido triage, SEC-4).
//
// THE BUG: `GET /api/oauth/:provider/authorize` took `?redirect=` verbatim,
// stashed it in OAUTH_STATES, and the callback handed it to `frontendDone`,
// which resolves with `new URL(base, FRONTEND_URL)`. An ABSOLUTE `base`
// overrides the relative base entirely — so `?redirect=https://evil.example`
// made the OAuth callback 302 the user to an attacker host mid-flow, with the
// outcome params appended. Six call sites in the callback fed it.
//
// THE FIX: `safeRelativeRedirect` accepts only same-origin relative paths,
// applied at INTAKE so a hostile value never reaches OAUTH_STATES (covering
// all six call sites with one check), plus a defence-in-depth re-check inside
// `frontendDone`.
//
// Severity note, recorded so it is not re-inflated on the next read: the
// finding pairs this with a "tokenKey leak" because the success path appends
// `key: entry.tokenKey`. `resolveTokenKey` returns a STORAGE KEY NAME
// ("gmail", "google", a connector id) — never a credential value. The leak
// component is informational; the open redirect is the real issue.
//
// Run: node --test server/tests/connector-oauth-open-redirect.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeRelativeRedirect } from "../routes/connector-oauth.js";

describe("safeRelativeRedirect — hostile values are rejected", () => {
  const HOSTILE = [
    ["absolute https", "https://evil.example/x"],
    ["absolute http", "http://evil.example/x"],
    ["protocol-relative", "//evil.example/x"],
    // WHATWG URL normalizes a backslash to a slash, so this resolves to the
    // absolute //evil.example. A naive "starts with / but not //" check —
    // which is what the frontend guard does — lets this straight through.
    ["backslash protocol-relative", "/\\evil.example/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["bare host", "evil.example"],
    ["scheme-relative with creds", "//user:pass@evil.example"],
    ["tab-smuggled", "/\t/evil.example"],
    ["newline-smuggled", "/\n//evil.example"],
    ["leading space then absolute", " https://evil.example"],
    ["NUL-smuggled", "/\u0000//evil.example"],
    ["DEL-smuggled", "/\u007f/evil.example"],
  ];

  for (const [label, value] of HOSTILE) {
    it(`rejects ${label}`, () => {
      assert.equal(
        safeRelativeRedirect(value), null,
        `${JSON.stringify(value)} must not survive validation`
      );
    });
  }

  it("rejects non-string and empty input", () => {
    for (const v of [null, undefined, "", 0, 42, {}, [], true]) {
      assert.equal(safeRelativeRedirect(v), null, `${JSON.stringify(v)} must be rejected`);
    }
  });
});

describe("safeRelativeRedirect — legitimate values still round-trip", () => {
  const OK = [
    "/",
    "/lenses/ingest",
    "/lenses/ingest?connector=gmail",
    "/lenses/ingest#section",
    // A hyphen must survive: an over-broad control-char class would eat it.
    "/lenses/home-improvement",
    "/lenses/byo-keys?tab=slots&x=1",
    "/a/deeply/nested/path/with-dashes_and_underscores",
  ];

  for (const value of OK) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      assert.equal(safeRelativeRedirect(value), value, "must pass through unchanged");
    });
  }
});

describe("safeRelativeRedirect — the guard actually constrains URL resolution", () => {
  // The vulnerability was specifically about what `new URL(base, FRONTEND_URL)`
  // does with the value, so assert against that resolution rather than only
  // against the string form. This is what makes the test prove the fix rather
  // than restate it.
  const FRONTEND_URL = "https://concord-os.org";

  it("an unvalidated hostile value WOULD escape the frontend origin", () => {
    // Documents the original defect: proves the resolution step is what made
    // the missing validation exploitable, so a future refactor that drops the
    // guard has a visible record of what it re-enables.
    const escaped = new URL("https://evil.example/x", FRONTEND_URL);
    assert.equal(escaped.origin, "https://evil.example");
    const backslash = new URL("/\\evil.example/x", FRONTEND_URL);
    assert.equal(backslash.origin, "https://evil.example", "backslash normalizes to //");
  });

  it("every value the guard accepts resolves back to the frontend origin", () => {
    for (const value of ["/", "/lenses/ingest", "/lenses/ingest?x=1", "/a-b/c_d"]) {
      const safe = safeRelativeRedirect(value);
      assert.ok(safe, `${value} should have been accepted`);
      assert.equal(
        new URL(safe, FRONTEND_URL).origin, FRONTEND_URL,
        `${value} must stay on the frontend origin`
      );
    }
  });

  it("no hostile value survives to reach the URL resolution step", () => {
    for (const [, value] of [
      ["", "https://evil.example"],
      ["", "//evil.example"],
      ["", "/\\evil.example"],
    ]) {
      assert.equal(safeRelativeRedirect(value), null);
    }
  });
});
