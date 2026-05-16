// Contract tests for server/domains/pharmacy.js — pure-compute helpers
// (dosage, inventory, formulary) plus real OpenFDA Drug API integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPharmacyActions from "../domains/pharmacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`pharmacy.${name}`);
  if (!fn) throw new Error(`pharmacy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerPharmacyActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.OPENFDA_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("pharmacy.dosageCalculator (pure compute)", () => {
  it("computes single + daily dose from weight × dosePerKg × freq", () => {
    const r = call("dosageCalculator", ctxA, { data: { weightKg: 70, dosePerKg: 10, frequencyPerDay: 3, maxDailyDose: 4000 } }, {});
    assert.equal(r.result.singleDose, "700 mg");
    assert.equal(r.result.dailyDose, "2100 mg");
    assert.equal(r.result.capped, false);
  });
});

describe("pharmacy.drugInteractionCheck (real OpenFDA SPL)", () => {
  it("rejects fewer than 2 medications", async () => {
    const r = await call("drugInteractionCheck", ctxA, { data: { medications: ["aspirin"] } }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2/);
  });

  it("fetches each drug's SPL label + detects cross-mentions (warfarin ↔ aspirin)", async () => {
    let urlCount = 0;
    globalThis.fetch = async (url) => {
      urlCount++;
      const isAspirin = url.includes("aspirin");
      return {
        ok: true,
        json: async () => ({
          results: [{
            set_id: isAspirin ? "asp-set-id" : "warf-set-id",
            openfda: {
              generic_name: [isAspirin ? "aspirin" : "warfarin sodium"],
              brand_name: [isAspirin ? "Bayer Aspirin" : "Coumadin"],
              manufacturer_name: [isAspirin ? "Bayer" : "Bristol-Myers Squibb"],
            },
            drug_interactions: [isAspirin
              ? "Anticoagulants such as warfarin sodium (Coumadin) increase bleeding risk when co-administered with aspirin."
              : "NSAIDs including aspirin (Bayer Aspirin) may increase the anticoagulant effect of warfarin sodium."],
            warnings: ["Standard hemorrhage warnings apply."],
          }],
        }),
      };
    };
    const r = await call("drugInteractionCheck", ctxA, {
      data: { medications: ["warfarin", "aspirin"] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(urlCount, 2);  // one fetch per drug
    assert.equal(r.result.interactionsFound, 1);
    assert.equal(r.result.coMentions[0].drug1, "warfarin");
    assert.equal(r.result.coMentions[0].drug2, "aspirin");
    assert.equal(r.result.coMentions[0].aMentionsB, true);
    assert.equal(r.result.coMentions[0].bMentionsA, true);
    assert.match(r.result.disclaimer, /Lexicomp/);
    assert.equal(r.result.source, "openfda-drug-label");
  });

  it("handles drugs not found in OpenFDA (404 per drug)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("drugInteractionCheck", ctxA, {
      data: { medications: ["xyzbogus1", "xyzbogus2"] },
    }, {});
    assert.equal(r.ok, true);
    // No labels found → no interactions surfaced (correct behavior)
    assert.equal(r.result.interactionsFound, 0);
    assert.equal(r.result.labels[0].found, false);
  });

  it("surfaces 429 rate-limit with helpful key-setup pointer", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("drugInteractionCheck", ctxA, {
      data: { medications: ["aspirin", "warfarin"] },
    }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit exceeded.*OPENFDA_API_KEY/);
  });

  it("uses OPENFDA_API_KEY env when set", async () => {
    process.env.OPENFDA_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    await call("drugInteractionCheck", ctxA, { data: { medications: ["a", "b"] } }, {});
    assert.match(capturedUrl, /api_key=test-key/);
  });
});

describe("pharmacy.drug-label (real OpenFDA)", () => {
  it("rejects missing drug", async () => {
    const r = await call("drug-label", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("hits OpenFDA + shapes the label response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          results: [{
            set_id: "abc-set-id",
            openfda: {
              generic_name: ["atorvastatin calcium"],
              brand_name: ["Lipitor"],
              manufacturer_name: ["Pfizer"],
              product_type: ["HUMAN PRESCRIPTION DRUG"],
              route: ["ORAL"],
              rxotc: ["RX"],
            },
            indications_and_usage: ["INDICATIONS AND USAGE\nLipitor is indicated to reduce the risk of MI, stroke..."],
            warnings: ["WARNINGS AND PRECAUTIONS\nMyopathy/Rhabdomyolysis..."],
            mechanism_of_action: ["MECHANISM OF ACTION\nLipitor is a selective, competitive inhibitor of HMG-CoA reductase..."],
            pregnancy: ["Pregnancy Category X"],
          }],
        }),
      };
    };
    const r = await call("drug-label", ctxA, { drug: "Lipitor" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.fda\.gov\/drug\/label\.json/);
    assert.equal(r.result.brandName, "Lipitor");
    assert.equal(r.result.genericName, "atorvastatin calcium");
    assert.equal(r.result.rxOtc, "RX");
    assert.match(r.result.indications, /reduce the risk/);
    assert.match(r.result.mechanismOfAction, /HMG-CoA reductase/);
    assert.equal(r.result.source, "openfda-drug-label");
  });

  it("returns clear 404 when drug doesn't exist in OpenFDA", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("drug-label", ctxA, { drug: "xyzbogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no FDA label found/);
  });
});

describe("pharmacy.adverse-events (real OpenFDA FAERS)", () => {
  it("rejects missing drug", async () => {
    assert.equal((await call("adverse-events", ctxA, {})).ok, false);
  });

  it("hits FAERS + aggregates top reactions", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          results: [
            { term: "HEADACHE", count: 1450 },
            { term: "NAUSEA", count: 980 },
            { term: "DIZZINESS", count: 620 },
          ],
        }),
      };
    };
    const r = await call("adverse-events", ctxA, { drug: "Lipitor" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.fda\.gov\/drug\/event\.json/);
    assert.match(capturedUrl, /patient\.drug\.medicinalproduct/);
    assert.equal(r.result.reportCount, 3050);
    assert.equal(r.result.topReactions[0].term, "HEADACHE");
    assert.match(r.result.disclaimer, /voluntary submissions.*causality/);
  });

  it("handles 404 (no reports) gracefully as ok:true with 0 reports", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("adverse-events", ctxA, { drug: "xyzbogus" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reportCount, 0);
    assert.deepEqual(r.result.topReactions, []);
  });
});
