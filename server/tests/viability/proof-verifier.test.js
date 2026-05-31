// Wave 5 #30 — proof/verifier truth boundary. Pins the three composed gates:
// structural (envelope well-formed), integrity (content hash matches), epistemic
// (canon-only as a verified premise). Composes dtu-protocol + corpus-tier.
//
// Run: node --test tests/viability/proof-verifier.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import DTUProtocol from "../../lib/dtu-protocol.js";
import { verifyClaim, admissibleAsPremise } from "../../lib/viability/proof-verifier.js";

const proto = new DTUProtocol();
const VERIFIER = { kind: "verifier", inputs: ["context"], outputs: ["ok"], steps: ["check"] };

describe("verifyClaim — epistemic gate", () => {
  it("a canon rule (has a verifier) is admissible as a premise", () => {
    const rule = { machine: { kind: "rule", verifier: VERIFIER } };
    const r = verifyClaim(rule);
    assert.equal(r.tier, "canon");
    assert.equal(r.admissible, true);
    assert.ok(admissibleAsPremise(rule));
  });

  it("a conjecture (no verifier) is NOT admissible as a premise, but is as data", () => {
    const claim = { machine: { kind: "first_order" } };
    assert.equal(verifyClaim(claim).admissible, false);
    assert.ok(verifyClaim(claim).reasons.includes("not_canon"));
    assert.equal(verifyClaim(claim, { requireCanon: false }).admissible, true); // data, not premise
  });
});

describe("verifyClaim — integrity gate", () => {
  it("a freshly-built envelope passes integrity; tampering its content fails it", () => {
    const dtu = proto.createComponent({ name: "Beam", creator: { id: "u1" } });
    // valid + untampered
    const ok = verifyClaim(dtu, { requireCanon: false });
    assert.equal(ok.structural, true);
    assert.equal(ok.integrity, true);
    assert.equal(ok.admissible, true);

    // tamper the content → stored contentHash no longer matches
    const tampered = { ...dtu, content: { ...dtu.content, name: "Beam (forged)" } };
    const bad = verifyClaim(tampered, { requireCanon: false });
    assert.equal(bad.integrity, false);
    assert.equal(bad.admissible, false);
    assert.ok(bad.reasons.includes("hash_mismatch"));
  });

  it("a malformed envelope fails the structural gate", () => {
    const broken = { content: { x: 1 }, metadata: {} }; // missing required envelope fields
    const r = verifyClaim(broken, { requireCanon: false });
    assert.equal(r.structural, false);
    assert.ok(r.reasons.includes("malformed_envelope"));
  });
});
