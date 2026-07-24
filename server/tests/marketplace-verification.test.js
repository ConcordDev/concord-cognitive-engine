/**
 * V1.2 Wave C — Creation → Economy Loop.
 *
 * Real coverage for server/lib/marketplace-verification.js#getListingVerification
 * — the pure classifier that decides whether a marketplace listing was
 * ACTUALLY checked, as opposed to just "has real royalty math."
 *
 * Per CLAUDE.md's compute-don't-guess doctrine, the FEA fixtures below come
 * from REAL calls to generateSwordMesh + structuralCheck (the same engine
 * server/lib/asset-gen/asset-marketplace.js#mintGeneratedAssetAsDtu uses),
 * not hand-typed "looks about right" numbers — and the end-to-end test
 * exercises the real `dtu.create` / `marketplace.list` / `marketplace.myListings`
 * macros via the shared depth-test harness, proving the classifier reads the
 * ACTUAL shape those macros produce, not an invented one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateSwordMesh } from "../lib/asset-gen/parametric-mesh.js";
import { structuralCheck } from "../lib/asset-gen/fea-gate.js";
import { mintGeneratedAssetAsDtu, listGeneratedAssetOnMarketplace } from "../lib/asset-gen/asset-marketplace.js";
import { macroRuntime } from "./depth/_harness.js";
import {
  getListingVerification,
  LISTING_VERIFICATION_STATES,
} from "../lib/marketplace-verification.js";

describe("getListingVerification — pure classifier, three honest states only", () => {
  it("no_data: a listing/DTU with no meta at all", () => {
    const v = getListingVerification({ id: "dtu_1", title: "A track" });
    assert.equal(v.state, LISTING_VERIFICATION_STATES.NO_DATA);
    assert.equal(v.verified, false);
    assert.equal(v.label, "Not verified");
    assert.equal(v.feaSummary, null);
  });

  it("no_data: null/undefined input never throws and never claims verified", () => {
    for (const bad of [null, undefined, "", 0, 42, "string"]) {
      const v = getListingVerification(bad);
      assert.equal(v.state, LISTING_VERIFICATION_STATES.NO_DATA);
      assert.equal(v.verified, false);
    }
  });

  it("no_data: meta present but with no feaSummary (e.g. a music/art/plugin listing)", () => {
    const v = getListingVerification({ meta: { kind: "music_track", genre: "lofi" } });
    assert.equal(v.state, LISTING_VERIFICATION_STATES.NO_DATA);
    assert.equal(v.verified, false);
  });

  it("no_data never fires just because the DTU has royalty math or purchase history — those are not verification proxies", () => {
    const v = getListingVerification({
      meta: { qualityScore: 0.95 },
      marketplace: { purchases: 500, listed: true },
    });
    assert.equal(v.state, LISTING_VERIFICATION_STATES.NO_DATA);
    assert.equal(v.verified, false);
  });

  it("fea_verified: a REAL passing FEA summary (generateSwordMesh + structuralCheck)", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.012 });
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, true, "fixture must genuinely pass for this test to mean anything");

    const dtu = { meta: { kind: "generated_asset", feaVerified: true, feaSummary: check } };
    const v = getListingVerification(dtu);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.FEA_VERIFIED);
    assert.equal(v.verified, true);
    assert.equal(v.label, "FEA Verified");
    // Real numbers, verbatim — not recomputed or rounded to look better.
    assert.equal(v.feaSummary.maxUtilization, check.maxUtilization);
    assert.equal(v.feaSummary.safetyFactor, check.safetyFactor);
    assert.ok(v.detail.includes(String(Math.round(check.maxUtilization * 1000) / 1000)) || /max utilization/i.test(v.detail));
  });

  it("fea_failed: a REAL failing FEA summary (deliberately brittle blade) reads as unverified-failed, never verified", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 }); // deliberately brittle
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, false, "fixture must be a genuine FEA failure");

    const dtu = { meta: { kind: "generated_asset", feaVerified: false, feaSummary: check } };
    const v = getListingVerification(dtu);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.FEA_FAILED);
    assert.equal(v.verified, false);
    assert.equal(v.label, "Unverified (FEA failed)");
    assert.equal(v.feaSummary.maxUtilization, check.maxUtilization);
    assert.ok(v.feaSummary.maxUtilization > 1, "sanity: a failing check has utilization over 1");
  });

  it("trusts feaSummary.ok over a mismatched feaVerified mirror flag (defense in depth — never shows verified on an underlying fail)", () => {
    const dtu = {
      meta: {
        kind: "generated_asset",
        feaVerified: true, // inconsistent/corrupt mirror flag
        feaSummary: { ok: false, maxUtilization: 1.4, safetyFactor: 0.7 },
      },
    };
    const v = getListingVerification(dtu);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.FEA_FAILED);
    assert.equal(v.verified, false);
  });

  it("reads a flattened listing-row projection (marketplace.myListings shape) identically to a full DTU", () => {
    const listingRow = {
      id: "dtu_2",
      sourceDtuId: "dtu_2",
      title: "Generated sword",
      feaVerified: true,
      feaSummary: { ok: true, maxUtilization: 0.62, safetyFactor: 1.6, allowable: 2e8, worstStress: 1.2e8, tipLoadN: 40, material: "steel" },
    };
    const v = getListingVerification(listingRow);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.FEA_VERIFIED);
    assert.equal(v.verified, true);
    assert.equal(v.feaSummary.material, "steel");
  });

  it("never fabricates a confidence/percentage number beyond the real FEA fields it was given", () => {
    const v = getListingVerification({ meta: { feaSummary: { ok: true, maxUtilization: 0.5 } } });
    // No field on the result should be a number that wasn't literally present
    // on the input feaSummary (safetyFactor/allowable/etc. were never given).
    assert.equal(v.feaSummary.safetyFactor, undefined);
  });
});

describe("getListingVerification — real end-to-end against the actual mint/list/myListings pipeline", () => {
  it("a genuinely FEA-passed, minted-and-listed asset classifies as fea_verified through marketplace.myListings", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { generateValidatedAsset } = await import("../lib/asset-gen/generate-asset.js");

    const { ctx, runMacro } = await macroRuntime("listing-verification-e2e-pass");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-listing-verif-pass-"));
    const generated = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      outDir,
    });
    assert.equal(generated.ok, true, `fixture generation must succeed: ${JSON.stringify(generated)}`);
    assert.equal(generated.feaResult.ok, true);

    const minted = await mintGeneratedAssetAsDtu(ctx, generated, {});
    assert.equal(minted.ok, true, `mint must succeed: ${JSON.stringify(minted)}`);

    const listed = await listGeneratedAssetOnMarketplace(ctx, minted.dtuId, 25, { currency: "USD" });
    assert.equal(listed.ok, true, `listing must succeed: ${JSON.stringify(listed)}`);

    const mine = await runMacro("marketplace", "myListings", {}, ctx);
    assert.equal(mine.ok, true);
    const row = mine.listings.find((l) => l.sourceDtuId === minted.dtuId);
    assert.ok(row, "the newly-listed asset must appear in marketplace.myListings");

    const v = getListingVerification(row);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.FEA_VERIFIED);
    assert.equal(v.verified, true);
    assert.equal(v.feaSummary.maxUtilization, generated.feaResult.maxUtilization);

    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("an honestly-labeled UNVERIFIED (FEA-failed) mint classifies as fea_failed through marketplace.myListings", async () => {
    const { ctx, runMacro } = await macroRuntime("listing-verification-e2e-fail");
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 });
    const feaResult = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(feaResult.ok, false, "fixture must be a genuine FEA failure");

    const assetRecord = {
      archetype: "sword",
      material: feaResult.material,
      glbPath: "/tmp/listing-verification-unverified-fixture.glb",
      feaResult,
    };
    const minted = await mintGeneratedAssetAsDtu(ctx, assetRecord, { allowUnverified: true });
    assert.equal(minted.ok, true, `explicit allowUnverified mint must succeed: ${JSON.stringify(minted)}`);
    assert.equal(minted.verified, false);

    const listed = await listGeneratedAssetOnMarketplace(ctx, minted.dtuId, 2, {});
    assert.equal(listed.ok, true);

    const mine = await runMacro("marketplace", "myListings", {}, ctx);
    const row = mine.listings.find((l) => l.sourceDtuId === minted.dtuId);
    assert.ok(row, "the unverified asset must still appear in the seller's real listings view");

    const v = getListingVerification(row);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.FEA_FAILED);
    assert.equal(v.verified, false, "must never report verified:true for a failed FEA check");
    assert.equal(v.feaSummary.maxUtilization, feaResult.maxUtilization);
  });

  it("an ordinary, non-engineering listing (no FEA data at all) classifies as no_data through marketplace.myListings", async () => {
    const { ctx, runMacro } = await macroRuntime("listing-verification-e2e-nodata");
    const created = await runMacro("dtu", "create", {
      title: "A hand-authored music track",
      domain: "music",
      source: "user",
      // Two structured fields (definitions + claims) to clear the real
      // council-gate score threshold (server.js#pipeCouncil calls
      // councilGate without the userInitiated flag, so the default
      // minScore=2 applies regardless of `source`) — not a workaround for
      // this classifier, just what it takes to mint a real, committed DTU.
      core: { definitions: ["a lofi track"], claims: ["produced independently"] },
      human: { summary: "A track." },
    }, ctx);
    assert.equal(created.ok, true, `dtu.create must succeed: ${JSON.stringify(created)}`);
    // Mirror the same personal-scope step asset-marketplace.js documents
    // (dtu.create defaults to "local"; marketplace.list requires "personal").
    created.dtu.scope = "personal";

    const listed = await runMacro("marketplace", "list", { dtuId: created.dtu.id, price: 5 }, ctx);
    assert.equal(listed.ok, true, `listing must succeed: ${JSON.stringify(listed)}`);

    const mine = await runMacro("marketplace", "myListings", {}, ctx);
    const row = mine.listings.find((l) => l.sourceDtuId === created.dtu.id);
    assert.ok(row, "the plain listing must appear in marketplace.myListings");

    const v = getListingVerification(row);
    assert.equal(v.state, LISTING_VERIFICATION_STATES.NO_DATA);
    assert.equal(v.verified, false, "a listing with no FEA/verification data must never read as verified");
  });
});
