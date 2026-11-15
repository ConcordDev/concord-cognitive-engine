// FIX-mail-003 — the connector not-linked family is a STATE, not a 400.
//
// A gmail/slack handler answering { ok:false, error:'no_token' } used to
// leave /api/lens/run as HTTP 400, so every page load with an
// unconnected account logged a storm of console resource errors (the
// mail lens alone fired five on load). The family now takes the same
// HTTP 200 + { ok:false, reason } treatment as missing_api_key: the
// client renders its connect wall from the body, and the browser logs
// nothing. Neighbouring mappings are pinned unchanged alongside.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { httpStatusForLensFailure, shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("connector not-linked family rides HTTP 200 (FIX-mail-003)", () => {
  it("maps every not-linked token on the error channel to 200", () => {
    for (const e of ["no_token", "connector_not_configured", "gmail_disabled", "no_user"]) {
      assert.equal(httpStatusForLensFailure(e), 200, e);
      const shaped = shapeLensRunHttp({ ok: false, error: e });
      assert.equal(shaped.status, 200, e);
      assert.equal(shaped.body.ok, false);
      assert.equal(shaped.body.error, e);
    }
  });

  it("maps the family on the reason channel too (connector handlers put the token there)", () => {
    const shaped = shapeLensRunHttp({ ok: false, error: "request_failed", reason: "no_token" });
    assert.equal(shaped.status, 200);
    assert.equal(shaped.body.ok, false);
  });

  it("leaves the neighbouring mappings exactly as they were", () => {
    assert.equal(httpStatusForLensFailure("missing_api_key"), 200);
    assert.equal(httpStatusForLensFailure("missing_world_id"), 422);
    assert.equal(httpStatusForLensFailure("validation_failed"), 422);
    assert.equal(httpStatusForLensFailure("insufficient_balance"), 409);
    assert.equal(httpStatusForLensFailure("not_found"), 404);
    assert.equal(httpStatusForLensFailure("some_unmapped_refusal"), 400);
    // A token that merely CONTAINS a family word is not the family.
    assert.equal(httpStatusForLensFailure("no_token_budget"), 400);
  });
});
