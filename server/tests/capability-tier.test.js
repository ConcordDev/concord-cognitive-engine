/**
 * server/lib/capability-tier.js — server-side port of
 * concord-frontend/components/common/CapabilityBadge.tsx's `capabilityTierFor`.
 *
 * These cases are a deliberate mirror of
 * concord-frontend/tests/components/CapabilityBadge.test.tsx's own
 * "capabilityTierFor — pure classification" describe block, so the two
 * implementations are pinned to agree case-for-case rather than drifting.
 *
 * Run: node --test tests/capability-tier.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { capabilityTierFor } from "../lib/capability-tier.js";

describe("capabilityTierFor — pure classification (mirrors CapabilityBadge.test.tsx)", () => {
  it("maps grounded/proven to the proven tier", () => {
    assert.equal(capabilityTierFor({ ok: true, verdict: "grounded" }), "proven");
    assert.equal(capabilityTierFor({ ok: true, verdict: "proven" }), "proven");
  });

  it("maps refuted/fabricated_citation to the flagged tier", () => {
    assert.equal(capabilityTierFor({ ok: true, verdict: "refuted" }), "flagged");
    assert.equal(capabilityTierFor({ ok: true, verdict: "fabricated_citation" }), "flagged");
  });

  it("maps citations_resolve/unsupported/unverified(string) to the reasoned tier", () => {
    assert.equal(capabilityTierFor({ ok: true, verdict: "citations_resolve" }), "reasoned");
    assert.equal(capabilityTierFor({ ok: true, verdict: "unsupported" }), "reasoned");
    assert.equal(capabilityTierFor({ ok: true, verdict: "unverified" }), "reasoned");
  });

  it("maps a missing/null/not-ok verdict to the unverified tier", () => {
    assert.equal(capabilityTierFor(null), "unverified");
    assert.equal(capabilityTierFor(undefined), "unverified");
    assert.equal(capabilityTierFor({ ok: false, verdict: "grounded" }), "unverified");
    assert.equal(capabilityTierFor({ ok: true }), "unverified");
  });

  it("never throws on a malformed/unexpected shape", () => {
    assert.doesNotThrow(() => capabilityTierFor(42));
    assert.doesNotThrow(() => capabilityTierFor("nonsense"));
    assert.doesNotThrow(() => capabilityTierFor({ ok: true, verdict: 123 }));
  });
});
