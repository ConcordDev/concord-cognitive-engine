/**
 * Forestry must present as Live in both places that determine its data
 * tier: the server integration registry (source of truth) and the
 * frontend lens manifest consumed by the depth badge. The lens runs a
 * live per-user registry (stands, cruises, pests, replanting, carbon
 * credits, polygons on STATE) plus two real external feeds (InciWeb,
 * NIFC WFIGS) — the previous REAL_FREE declaration, sourced to a
 * "usda.forest" feed the domain has never called, understated all of it.
 * The sources-vs-code assertion extends the creator-tier-live pattern:
 * every declared source must be backed by the domain code itself.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getIntegration, getTier, TIER } from "../lib/integration-registry.js";

describe("Forestry data tier", () => {
  it("is REAL_LIVE from substrate in the integration registry", () => {
    assert.equal(getTier("forestry"), TIER.REAL_LIVE);
    assert.equal(getIntegration("forestry")?.liveFromSubstrate, true);
  });

  it("declares only external sources the domain code actually calls", async () => {
    const domain = await readFile(new URL("../domains/forestry.js", import.meta.url), "utf8");
    const sources = getIntegration("forestry")?.sources || [];
    assert.ok(sources.length > 0, "forestry must declare its external sources");
    for (const source of sources) {
      const token = source.split(/[-.]/)[0];
      assert.ok(
        domain.toLowerCase().includes(token),
        `declared source ${source} is not backed by server/domains/forestry.js`,
      );
    }
    assert.ok(!sources.includes("usda.forest"), "usda.forest was declared for years but is never called by the domain");
  });

  it("is REAL_LIVE in the frontend lens manifest used by the depth badge", async () => {
    const manifest = await readFile(new URL("../../concord-frontend/lib/lenses/manifest.ts", import.meta.url), "utf8");
    const start = manifest.indexOf("domain: 'forestry',");
    assert.notEqual(start, -1, "forestry manifest entry not found");
    const block = manifest.slice(start, start + 1600);
    assert.match(block, /dataTier:\s*'REAL_LIVE'/);
    assert.ok(!block.includes("REAL_FREE data"), "manifest caption must not claim REAL_FREE data");
  });
});
