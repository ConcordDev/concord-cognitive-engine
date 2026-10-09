// Dutch decision 2026-10-09: public NRC/IAEA documents and ConKay screening
// analyses are ordinary public (Tier 1) data, not the Tier 3 sovereign vault.
// Both sides are tested: the narrow exemption applies only with structured,
// allow-listed provenance; every other sovereign case still goes to Tier 3.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySignal, TIERS } from "../lib/foundation-intelligence.js";

// Text that on its own scores well above the sovereign threshold
// (nuclear, reactor, uranium, radiation, isotope, fission = 6 × 0.15).
const NUCLEAR_TEXT = "NuScale US460 final safety evaluation: nuclear reactor, uranium fuel, fission products, isotope inventory, radiation shielding";
const nrcDoc = (over = {}) => ({
  title: NUCLEAR_TEXT,
  publicSource: { kind: "nrc-adams", locator: "ML25086A073", url: "https://www.nrc.gov/docs/ML2508/ML25086A073.html", ...over },
});
const RECEIPT = "7bcb2fb0".padEnd(64, "0");

describe("public regulatory documents are Tier 1 (Dutch 2026-10-09)", () => {
  it("baseline: the same nuclear text with no provenance is sovereign", () => {
    const r = classifySignal({ title: NUCLEAR_TEXT });
    assert.equal(r.tier, TIERS.SOVEREIGN);
    assert.equal(r.category, "nuclear_facility");
    assert.equal(r.publicRegulatoryExemption, undefined);
  });

  it("an NRC ADAMS document with an nrc.gov URL is public", () => {
    const r = classifySignal(nrcDoc());
    assert.equal(r.tier, TIERS.PUBLIC);
    assert.equal(r.sovereignMatch, false);
    assert.deepEqual([r.publicRegulatoryExemption.kind, r.publicRegulatoryExemption.locator], ["nrc-adams", "ML25086A073"]);
  });

  it("NUREG, CFR and IAEA safety-standard sources are public", () => {
    const cases = [
      { kind: "nureg", locator: "NUREG-0800 Section 8.3.2", url: "https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr0800/ch8/index" },
      { kind: "nureg", locator: "NUREG/CR-6928", url: "https://www.nrc.gov/docs/ML0706/ML070650650.pdf" },
      { kind: "cfr", locator: "10 CFR 50 Appendix A, Criterion 17", url: "https://www.ecfr.gov/current/title-10/part-50/appendix-Appendix%20A%20to%20Part%2050" },
      { kind: "iaea-safety-standard", locator: "SSR-2/1 (Rev. 1) Requirement 24", url: "https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1715web-46541668.pdf" },
    ];
    for (const publicSource of cases) assert.equal(classifySignal({ title: NUCLEAR_TEXT, publicSource }).tier, TIERS.PUBLIC, publicSource.locator);
  });

  it("a ConKay screening analysis identified by its receipt hash is public", () => {
    const r = classifySignal({ title: NUCLEAR_TEXT, publicSource: { kind: "conkay-screening-analysis", locator: RECEIPT } });
    assert.equal(r.tier, TIERS.PUBLIC);
  });
});

describe("everything else stays Tier 3 (not broadened)", () => {
  const sovereign = (signal, why) => assert.equal(classifySignal(signal).tier, TIERS.SOVEREIGN, why);

  it("free text claiming to be an NRC document is not provenance", () => {
    sovereign(`NRC ADAMS ML25086A073 public document https://www.nrc.gov — ${NUCLEAR_TEXT}`, "string input");
  });
  it("wrong host, bad locator, unknown kind, or bad receipt hash", () => {
    sovereign(nrcDoc({ url: "https://example.com/ML25086A073.pdf" }), "host not allow-listed");
    sovereign(nrcDoc({ url: "https://nrc.gov.evil.example/x" }), "host suffix trick");
    sovereign(nrcDoc({ locator: "ML-something" }), "bad accession");
    sovereign(nrcDoc({ kind: "leaked-memo" }), "unknown kind");
    sovereign(nrcDoc({ url: undefined }), "document kinds need a URL");
    sovereign({ title: NUCLEAR_TEXT, publicSource: { kind: "conkay-screening-analysis", locator: "not-a-hash" } }, "bad receipt");
  });
  it("sensed nuclear signal indicators or an energy level keep it sovereign", () => {
    sovereign({ ...nrcDoc(), note: "enrichment signature detected" }, "indicator");
    sovereign({ ...nrcDoc(), note: "cooling system harmonic" }, "indicator");
    sovereign({ ...nrcDoc(), energyLevel: 60 }, "energy level");
  });
  it("other sovereign categories are untouched even with public provenance", () => {
    sovereign({ ...nrcDoc(), note: "military base radar weapons" }, "military");
    sovereign({ ...nrcDoc(), note: "submarine naval destroyer" }, "naval");
    sovereign({ ...nrcDoc(), note: "scada unprotected control system exposed" }, "infrastructure vulnerability");
    sovereign({ title: "military installation radar weapons garrison" }, "military without provenance");
  });
});
