/**
 * Creator must present as Live in both places that determine its data tier:
 * the server integration registry (source of truth) and the frontend lens
 * manifest consumed by the depth badge. Keeping the two declarations in one
 * regression test prevents the badge from drifting back to Simulated while
 * the backend serves real creator-economy substrate data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getIntegration, getTier, TIER } from "../lib/integration-registry.js";

describe("Creator data tier", () => {
  it("is REAL_LIVE from substrate in the integration registry", () => {
    assert.equal(getTier("creator"), TIER.REAL_LIVE);
    assert.equal(getIntegration("creator")?.liveFromSubstrate, true);
  });

  it("is REAL_LIVE in the frontend lens manifest used by the depth badge", async () => {
    const manifestUrl = new URL(
      "../../concord-frontend/lib/lenses/manifest.ts",
      import.meta.url,
    );
    const manifest = await readFile(manifestUrl, "utf8");
    const creatorStart = manifest.indexOf("domain: 'creator',");
    assert.notEqual(creatorStart, -1, "creator manifest entry not found");

    const creatorBlock = manifest.slice(creatorStart, creatorStart + 1600);
    assert.match(creatorBlock, /dataTier:\s*'REAL_LIVE'/);
  });
});
