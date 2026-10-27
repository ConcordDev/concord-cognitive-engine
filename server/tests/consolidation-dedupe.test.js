import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripTierPrefix, consolidatedTitle, isPromotionArtifact, distinctContentCount,
  screenClusterMembers, memberSetKey, createRejectionCache,
} from "../lib/consolidation-dedupe.js";

describe("consolidation dedupe helpers", () => {
  it("strips nested tier prefixes and builds one-prefix titles", () => {
    assert.equal(stripTierPrefix("MEGA — MEGA — Harbor"), "Harbor");
    assert.equal(stripTierPrefix("HYPER - mega – Harbor"), "Harbor");
    assert.equal(stripTierPrefix("Megastructure notes"), "Megastructure notes");
    assert.equal(consolidatedTitle("hyper", "MEGA — Harbor"), "HYPER — Harbor");
    assert.equal(consolidatedTitle("mega", ""), "MEGA — Cluster");
  });

  it("flags downgraded megas as artifacts only for regular clustering", () => {
    assert.equal(isPromotionArtifact({ title: "MEGA — x" }, "regular"), true);
    assert.equal(isPromotionArtifact({ title: "x", meta: { clusterKey: "k" } }, "regular"), true);
    assert.equal(isPromotionArtifact({ title: "x" }, "regular"), false);
    assert.equal(isPromotionArtifact({ title: "MEGA — x", meta: { clusterKey: "k" } }, "mega"), false);
  });

  it("screens claimed members, artifacts and near-copies", () => {
    const m = (id, title, extra = {}) => ({ id, title, cretiHuman: `body ${title}`, meta: {}, ...extra });
    const live = new Set(["mega-1"]);
    const isLive = (id) => live.has(id);
    const fresh = [m("a", "A"), m("b", "B"), m("c", "C")];
    assert.equal(screenClusterMembers(fresh, { minCluster: 3, isLiveConsolidated: isLive }).ok, true);

    const claimed = fresh.map(d => ({ ...d, meta: { megaParent: "mega-1" } }));
    assert.equal(screenClusterMembers(claimed, { minCluster: 3, isLiveConsolidated: isLive }).reason, "members_already_consolidated");
    const stale = fresh.map(d => ({ ...d, meta: { megaParent: "deleted-mega" } }));
    assert.equal(screenClusterMembers(stale, { minCluster: 3, isLiveConsolidated: isLive }).ok, true);

    const copies = [m("a", "MEGA — Same"), m("b", "Same"), m("c", "Same")].map(d => ({ ...d, cretiHuman: "same body" }));
    assert.equal(screenClusterMembers(copies, { minCluster: 1, isLiveConsolidated: isLive, childTier: "mega" }).reason, "single_distinct_member");
    assert.equal(distinctContentCount(copies), 1);
  });

  it("member-set key is order independent and the rejection cache expires", () => {
    assert.equal(memberSetKey(["b", "a", "a"]), memberSetKey(["a", "b"]));
    let t = 0;
    const c = createRejectionCache({ ttlMs: 10, max: 2, now: () => t });
    c.add("k1"); c.add("k2"); c.add("k3");
    assert.equal(c.has("k1"), false);
    assert.equal(c.has("k3"), true);
    t = 11;
    assert.equal(c.has("k3"), false);
  });
});
