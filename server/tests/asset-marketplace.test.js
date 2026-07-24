/**
 * V1.2 Wave C — Creation → Economy Loop.
 *
 * Real end-to-end coverage for server/lib/asset-gen/asset-marketplace.js:
 * Program C's CAS→FEA→GLB generative pipeline (generateValidatedAsset)
 * minted as a real DTU (via the actual `dtu.create` macro, not a raw SQL
 * insert) and listed on the actual `marketplace.list` macro — the same
 * marketplace surface the Creator lens's Listings tab uses.
 *
 * Per CLAUDE.md's compute-don't-guess doctrine: the FEA numbers exercised
 * here come from REAL calls to generateValidatedAsset/structuralCheck
 * (server/lib/asset-gen/generate-asset.js, fea-gate.js) — never hand-typed
 * "looks about right" values. The whole point of this file is to prove the
 * FEA summary written into the DTU matches what the real engine actually
 * computed, and that a genuinely-failing FEA result is never presented as
 * a pass.
 *
 * Uses the shared depth-test harness (boots the real server.js once,
 * in-memory) — see tests/depth/_harness.js.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { macroRuntime, lensRun } from "./depth/_harness.js";
import { generateValidatedAsset } from "../lib/asset-gen/generate-asset.js";
import { generateSwordMesh } from "../lib/asset-gen/parametric-mesh.js";
import { structuralCheck } from "../lib/asset-gen/fea-gate.js";
import {
  summarizeFeaResult,
  mintGeneratedAssetAsDtu,
  listGeneratedAssetOnMarketplace,
  mintAndListGeneratedAsset,
} from "../lib/asset-gen/asset-marketplace.js";

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-asset-marketplace-test-"));
});
after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe("summarizeFeaResult — pure copy, never fabricates", () => {
  it("returns null for a missing/absent FEA result", () => {
    assert.equal(summarizeFeaResult(null), null);
    assert.equal(summarizeFeaResult(undefined), null);
  });

  it("copies every field verbatim from a real PASSING structuralCheck result", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.012 });
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, true, "fixture must genuinely pass for this test to mean anything");
    const summary = summarizeFeaResult(check);
    assert.equal(summary.ok, true);
    assert.equal(summary.maxUtilization, check.maxUtilization);
    assert.equal(summary.worstStress, check.worstStress);
    assert.equal(summary.allowable, check.allowable);
    assert.equal(summary.safetyFactor, check.safetyFactor);
    assert.equal(summary.tipLoadN, check.tipLoadN);
    assert.equal(summary.material, check.material);
  });

  it("copies every field verbatim from a real FAILING structuralCheck result (never hides or zeroes the failure)", () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 }); // deliberately brittle, per fea-gate.test.js
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, false, "fixture must genuinely fail for this test to mean anything");
    assert.ok(check.maxUtilization > 1);
    const summary = summarizeFeaResult(check);
    assert.equal(summary.ok, false);
    assert.equal(summary.maxUtilization, check.maxUtilization);
    assert.ok(summary.maxUtilization > 1, "the real over-utilization number must survive into the summary honestly");
  });
});

describe("mintGeneratedAssetAsDtu + listGeneratedAssetOnMarketplace — real end-to-end, FEA-passed asset", () => {
  it("mints a genuinely FEA-passed generated sword as a real DTU and lists it on the real marketplace", async () => {
    const { runMacro, ctx } = await macroRuntime("asset-mkt-pass");

    const outDir = fs.mkdtempSync(path.join(tmpDir, "pass-"));
    const generated = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 }, // known-robust, per generate-asset.test.js
      outDir,
    });
    assert.equal(generated.ok, true, `fixture generation must succeed: ${JSON.stringify(generated)}`);
    assert.equal(generated.feaResult.ok, true, "fixture must be a genuine FEA pass");
    assert.ok(fs.existsSync(generated.glbPath), "fixture must be a real .glb on disk");

    const minted = await mintGeneratedAssetAsDtu(ctx, generated, {});
    assert.equal(minted.ok, true, `mint must succeed: ${JSON.stringify(minted)}`);
    assert.equal(minted.verified, true);
    assert.equal(typeof minted.dtuId, "string");

    // The FEA summary attached to the mint result is the REAL engine output,
    // not a re-derivation — compare field-by-field against generated.feaResult.
    assert.equal(minted.feaSummary.maxUtilization, generated.feaResult.maxUtilization);
    assert.equal(minted.feaSummary.worstStress, generated.feaResult.worstStress);
    assert.equal(minted.feaSummary.allowable, generated.feaResult.allowable);
    assert.equal(minted.feaSummary.safetyFactor, generated.feaResult.safetyFactor);
    assert.equal(minted.feaSummary.material, generated.feaResult.material);

    // The DTU actually exists in the real DTU substrate (dtu.get), not just
    // in the mint function's return value.
    const fetched = await runMacro("dtu", "get", { id: minted.dtuId }, ctx);
    assert.equal(fetched.ok, true);
    assert.equal(fetched.dtu.scope, "personal", "must be promoted to personal scope so it's listable");
    assert.equal(fetched.dtu.meta.kind, "generated_asset");
    assert.equal(fetched.dtu.meta.archetype, "sword");
    assert.equal(fetched.dtu.meta.feaVerified, true);
    assert.equal(fetched.dtu.meta.feaSummary.maxUtilization, generated.feaResult.maxUtilization);
    assert.equal(fetched.dtu.meta.massKg, generated.massProps.mass_kg);
    assert.ok(fetched.dtu.tags.includes("fea-verified"));
    assert.ok(!fetched.dtu.tags.includes("fea-unverified"));
    assert.ok(!/unverified/i.test(fetched.dtu.title), "a genuinely-passed asset's title must not say unverified");

    // Now list it on the REAL marketplace (marketplace.list — the same
    // macro server/domains/… / the Creator lens Listings tab uses).
    const listed = await listGeneratedAssetOnMarketplace(ctx, minted.dtuId, 42, { currency: "USD" });
    assert.equal(listed.ok, true, `listing must succeed: ${JSON.stringify(listed)}`);
    assert.equal(listed.listing.listed, true);
    assert.equal(listed.listing.price, 42);
    assert.equal(listed.listing.contentType, "generated_asset");

    // It shows up in the seller's own real listings view.
    const mine = await runMacro("marketplace", "myListings", {}, ctx);
    assert.equal(mine.ok, true);
    const row = mine.listings.find((l) => l.sourceDtuId === minted.dtuId);
    assert.ok(row, "the newly-listed generated asset must appear in marketplace.myListings");
    assert.equal(row.price, 42);
    assert.equal(row.status, "active");
  });

  it("mintAndListGeneratedAsset does both steps in one call with the same honest FEA summary", async () => {
    const { ctx, runMacro } = await macroRuntime("asset-mkt-combo");
    const outDir = fs.mkdtempSync(path.join(tmpDir, "combo-"));
    const generated = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      outDir,
    });
    assert.equal(generated.ok, true);

    const result = await mintAndListGeneratedAsset(ctx, generated, 17, { currency: "USD", title: "Combo Test Blade" });
    assert.equal(result.ok, true, `combined mint+list must succeed: ${JSON.stringify(result)}`);
    assert.equal(result.verified, true);
    assert.equal(result.listing.price, 17);
    assert.equal(result.feaSummary.maxUtilization, generated.feaResult.maxUtilization);

    const fetched = await runMacro("dtu", "get", { id: result.dtuId }, ctx);
    assert.equal(fetched.ok, true);
    assert.equal(fetched.dtu.title, "Combo Test Blade");
  });
});

describe("mintGeneratedAssetAsDtu — honesty gate (never fabricates a pass)", () => {
  it("refuses to mint a genuinely-failing asset by default — no DTU is created", async () => {
    const { ctx } = await macroRuntime("asset-mkt-refuse");
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 }); // deliberately brittle
    const feaResult = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(feaResult.ok, false, "fixture must be a genuine FEA failure");
    assert.ok(feaResult.maxUtilization > 1);

    const assetRecord = {
      archetype: "sword",
      material: feaResult.material,
      glbPath: "/tmp/does-not-need-to-exist-for-a-refusal.glb",
      feaResult,
    };

    const minted = await mintGeneratedAssetAsDtu(ctx, assetRecord, {});
    assert.equal(minted.ok, false);
    assert.equal(minted.reason, "fea_not_passed");
    assert.equal(minted.dtuId, undefined, "a refused mint must not produce a dtuId");
    // The refusal still carries the real (failing) numbers for the caller
    // to inspect/log — it doesn't hide why it refused.
    assert.equal(minted.feaSummary.ok, false);
    assert.equal(minted.feaSummary.maxUtilization, feaResult.maxUtilization);
  });

  it("mints an honestly-labeled UNVERIFIED asset when the caller explicitly opts in — never claims verified", async () => {
    const { ctx, runMacro } = await macroRuntime("asset-mkt-unverified");
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 });
    const feaResult = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(feaResult.ok, false);

    const assetRecord = {
      archetype: "sword",
      material: feaResult.material,
      glbPath: "/tmp/unverified-fixture.glb",
      feaResult,
    };

    const minted = await mintGeneratedAssetAsDtu(ctx, assetRecord, { allowUnverified: true });
    assert.equal(minted.ok, true, `explicit allowUnverified mint must succeed: ${JSON.stringify(minted)}`);
    assert.equal(minted.verified, false, "an unverified mint must report verified:false, never true");
    assert.ok(typeof minted.dtuId === "string");
    // The real (failing) FEA numbers are still attached honestly.
    assert.equal(minted.feaSummary.ok, false);
    assert.equal(minted.feaSummary.maxUtilization, feaResult.maxUtilization);

    const fetched = await runMacro("dtu", "get", { id: minted.dtuId }, ctx);
    assert.equal(fetched.ok, true);
    assert.equal(fetched.dtu.meta.feaVerified, false);
    assert.ok(/unverified/i.test(fetched.dtu.title), "title must plainly say unverified");
    assert.ok(fetched.dtu.core.claims.some((c) => /UNVERIFIED/.test(c)));
    assert.ok(fetched.dtu.tags.includes("fea-unverified"));
    assert.ok(!fetched.dtu.tags.includes("fea-verified"), "an unverified mint must never carry the verified tag");
    // The DTU is still real and listable — being unverified doesn't break
    // the mechanics, only the honesty label.
    assert.equal(fetched.dtu.scope, "personal");

    const listed = await listGeneratedAssetOnMarketplace(ctx, minted.dtuId, 3, {});
    assert.equal(listed.ok, true);
  });

  it("rejects missing inputs (no archetype / no glbPath) honestly", async () => {
    const { ctx } = await macroRuntime("asset-mkt-missing");
    const r1 = await mintGeneratedAssetAsDtu(ctx, { glbPath: "/tmp/x.glb", feaResult: { ok: true } }, {});
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, "missing_inputs");

    const r2 = await mintGeneratedAssetAsDtu(ctx, { archetype: "sword", feaResult: { ok: true } }, {});
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "missing_inputs");
  });

  it("returns no_macro_runtime honestly when ctx has no macro runner", async () => {
    const r = await mintGeneratedAssetAsDtu({}, { archetype: "sword", glbPath: "/tmp/x.glb", feaResult: { ok: true } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_macro_runtime");
  });
});

describe("listGeneratedAssetOnMarketplace — input validation", () => {
  it("rejects a missing dtuId", async () => {
    const { ctx } = await macroRuntime("asset-mkt-list-validate");
    const r = await listGeneratedAssetOnMarketplace(ctx, "", 10, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_dtu_id");
  });

  it("rejects a negative price", async () => {
    const { ctx } = await macroRuntime("asset-mkt-list-validate2");
    const r = await listGeneratedAssetOnMarketplace(ctx, "dtu_whatever", -5, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_price");
  });

  it("rejects a non-numeric price", async () => {
    const { ctx } = await macroRuntime("asset-mkt-list-validate3");
    const r = await listGeneratedAssetOnMarketplace(ctx, "dtu_whatever", "not-a-number", {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_price");
  });
});

describe("engineering.mint-and-list — the registered macro wrapper", () => {
  it("mints and lists a genuinely FEA-passed asset via the lens-action macro", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "lensaction-"));
    const generated = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      outDir,
    });
    assert.equal(generated.ok, true);

    const r = await lensRun("engineering", "mint-and-list", {
      params: { assetGenResult: generated, price: 9, currency: "USD" },
    });
    assert.equal(r.ok, true, `lens action must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.result.ok, true);
    assert.equal(r.result.verified, true);
    assert.equal(r.result.listing.price, 9);
  });

  it("honestly errors when assetGenResult is missing", async () => {
    const r = await lensRun("engineering", "mint-and-list", { params: { price: 9 } });
    assert.equal(r.ok, true); // lens.run itself succeeds; the handler reports the error inside
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /assetGenResult/);
  });

  it("propagates the fea_not_passed refusal for a genuinely-failing asset", async () => {
    const mesh = generateSwordMesh({ bladeBaseThickness: 0.003 });
    const feaResult = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(feaResult.ok, false);
    const r = await lensRun("engineering", "mint-and-list", {
      params: {
        assetGenResult: { archetype: "sword", material: feaResult.material, glbPath: "/tmp/x.glb", feaResult },
        price: 5,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "fea_not_passed");
  });
});
