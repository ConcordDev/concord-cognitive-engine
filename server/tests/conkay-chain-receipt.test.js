// server/tests/conkay-chain-receipt.test.js
//
// SX-CHAIN-RECEIPT — the chain-level receipt (founder design rule
// CB-0835): ONE signed artifact per chain run. The discriminating
// assertions are the signing rule's edges: a seam mismatch fails
// the receipt EVEN WHEN EVERY LINK PASSES; a stopped link leaves
// it INCOMPLETE naming the step; skipped steps are recorded with
// reasons, never hidden; and verification recomputes — an altered
// link or an altered artifact fails with the mismatch named.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linkReceipt, buildChainReceipt, verifyChainReceipt } from "../lib/conkay/chain/receipt.js";
import "../lib/conkay/index.js"; // registry populated for solver versions

const LINK_A = () => linkReceipt({ step: "intent", solver: "orc.intent-parse", inputs: { text: "a robot" }, outputs: { quantities: 2 } });
const LINK_B = () => linkReceipt({ step: "mass", solver: "orc.mass-bom", inputs: { parts: 3 }, outputs: { totalMassKg: 6 } });
const SEAM_OK = { id: "mass-agreement", from: "mass", to: "bom", quantity: "totalMassKg", unit: "kg", status: "HOLDS", detail: "both roll-ups 6 kg" };

describe("SX-CHAIN-RECEIPT — one artifact, signed only whole", () => {
  it("signs when every link computed and every seam holds; the hash covers links + seams", () => {
    const r = buildChainReceipt({ chainId: "test-chain", links: [LINK_A(), LINK_B()], seams: [SEAM_OK] });
    assert.equal(r.status, "SIGNED");
    assert.match(r.hash, /^[0-9a-f]{64}$/);
    assert.equal(r.links[0].solverVersion, "1.0.0");
    const flipped = buildChainReceipt({ chainId: "test-chain", links: [LINK_A(), LINK_B()], seams: [{ ...SEAM_OK, status: "VIOLATED" }] });
    assert.notEqual(flipped.hash, r.hash, "flipping a seam changes the artifact hash");
  });

  it("FOUNDER RULE: a seam mismatch fails the receipt even when every link passes", () => {
    const r = buildChainReceipt({
      chainId: "test-chain",
      links: [LINK_A(), LINK_B()],
      seams: [{ ...SEAM_OK, status: "VIOLATED", detail: "mass-bom totals 6 kg, bom-structure totals 9 kg" }],
    });
    assert.equal(r.status, "SEAM_VIOLATION");
    assert.equal(verifyChainReceipt(r, [LINK_A(), LINK_B()]).valid, false);
  });

  it("a stopped link leaves the receipt INCOMPLETE, naming the step and reason", () => {
    const r = buildChainReceipt({
      chainId: "test-chain",
      links: [LINK_A()],
      seams: [],
      stopped: { step: "mass", solver: "orc.mass-bom", reason: "missing_input:parts" },
    });
    assert.equal(r.status, "INCOMPLETE");
    assert.equal(r.stopped.step, "mass");
    assert.match(r.stopped.reason, /missing_input:parts/);
  });

  it("skipped steps are recorded with their reasons — the receipt shows its holes", () => {
    const r = buildChainReceipt({
      chainId: "test-chain",
      links: [LINK_A(), LINK_B()],
      seams: [SEAM_OK],
      skipped: [{ step: "fallback", solver: "orc.realistic-fallback", reason: "BLOCKED on question F10 (SX-ORC-09)" }],
    });
    assert.equal(r.status, "SIGNED", "a named, blocked optional step does not unsigned the chain — it is disclosed, not hidden");
    assert.equal(r.skipped[0].step, "fallback");
    assert.match(r.skipped[0].reason, /F10/);
  });

  it("verification recomputes: an altered link output fails, naming the link", () => {
    const r = buildChainReceipt({ chainId: "test-chain", links: [LINK_A(), LINK_B()], seams: [SEAM_OK] });
    const tampered = linkReceipt({ step: "mass", solver: "orc.mass-bom", inputs: { parts: 3 }, outputs: { totalMassKg: 7 } });
    const v = verifyChainReceipt(r, [LINK_A(), tampered]);
    assert.equal(v.valid, false);
    assert.ok(v.reasons.some((x) => /link mass .* different hash/.test(x)), v.reasons.join("; "));
    assert.equal(verifyChainReceipt(r, [LINK_A(), LINK_B()]).valid, true, "the untampered recomputation verifies");
  });

  it("an INCOMPLETE seam (a value one side could not produce) blocks signing without reading as a violation", () => {
    const r = buildChainReceipt({
      chainId: "test-chain",
      links: [LINK_A(), LINK_B()],
      seams: [{ ...SEAM_OK, status: "INCOMPLETE", detail: "bom total is null — unmassed lines" }],
    });
    assert.equal(r.status, "INCOMPLETE");
  });
});
