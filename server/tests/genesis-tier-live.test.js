/**
 * Genesis must present as Live in both places that determine its data
 * tier: the server integration registry (source of truth) and the
 * frontend lens manifest consumed by the depth badge. The lens's serving
 * reads the platform's real emergent-identity tables (written by the live
 * emergent subsystem); the SIM_GRADE_A declaration lagged the substrate
 * and gate-stopped the lens at Step 0 (R3, 2026-10-30). Keeping the two
 * declarations in one regression test prevents the badge from drifting
 * back to Simulated while the backend serves the live substrate.
 * (Form: creator-tier-live.test.js.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getIntegration, getTier, TIER } from "../lib/integration-registry.js";

describe("Genesis data tier", () => {
  it("is REAL_LIVE from substrate in the integration registry", () => {
    assert.equal(getTier("genesis"), TIER.REAL_LIVE);
    assert.equal(getIntegration("genesis")?.liveFromSubstrate, true);
  });

  it("no longer grounds against the world/genesis simulation schema", () => {
    assert.equal(getIntegration("genesis")?.groundedSchema, undefined);
  });

  it("is REAL_LIVE in the frontend lens manifest used by the depth badge", async () => {
    const manifestUrl = new URL(
      "../../concord-frontend/lib/lenses/manifest.ts",
      import.meta.url,
    );
    const manifest = await readFile(manifestUrl, "utf8");
    const genesisStart = manifest.indexOf("domain: 'genesis',");
    assert.notEqual(genesisStart, -1, "genesis manifest entry not found");

    const genesisBlock = manifest.slice(genesisStart, genesisStart + 1600);
    assert.match(genesisBlock, /dataTier:\s*'REAL_LIVE'/);
    assert.doesNotMatch(genesisBlock, /dataTier:\s*'SIM_GRADE_A'/);
  });

  it("Fork's declaration is untouched — determinations are per-lens", () => {
    assert.equal(getTier("fork"), TIER.SIM_GRADE_A);
  });
});
