// server/tests/creator-dashboard-marketplace-merge.test.js
//
// computeCreatorDashboard / computeReputationLeaderboard used to read
// listings + downloads + earnings EXCLUSIVELY from STATE.marketplaceListings
// — a store the Creator lens's Listings tab no longer writes to after being
// redirected to the real dtu.marketplace store (docs/lens-specs/
// creator-capability-map.md finding #3). Without this merge, the Overview
// tab's "Listings"/"Downloads"/"Earnings (CC)" stat tiles would show 0
// forever on the exact same page where the Listings tab shows real active
// listings and real sales — a fresh, visible self-contradiction. These
// tests pin the merge: both stores are read, and a listing existing in only
// one of them still contributes.
//
// Pure functions over an in-memory STATE object — no server boot, no DB.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCreatorDashboard, computeReputationLeaderboard } from "../lib/creator-dashboard.js";

function makeState() {
  return { dtus: new Map(), marketplaceListings: new Map() };
}

describe("computeCreatorDashboard — merges dtu.marketplace with legacy STATE.marketplaceListings", () => {
  it("counts a dtu.marketplace listing (real store) into listingCount/downloads/earnings", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", {
      id: "d1", ownerId: "alice", title: "Track One", createdAt: new Date().toISOString(),
      lineage: {}, marketplace: { listed: true, price: 10, purchases: 4, listedAt: new Date().toISOString(), title: "Track One" },
    });
    const r = computeCreatorDashboard("alice", STATE);
    assert.equal(r.ok, true);
    assert.equal(r.summary.listingCount, 1);
    assert.equal(r.summary.totalDownloads, 4);
    assert.equal(r.summary.totalEarnings, 40); // 4 * 10
    assert.equal(r.recentListings[0].id, "d1");
    assert.equal(r.recentListings[0].sourceDtuId, "d1");
  });

  it("still counts legacy STATE.marketplaceListings entries (back-compat with any pre-existing data)", () => {
    const STATE = makeState();
    STATE.marketplaceListings.set("listing_legacy", {
      id: "listing_legacy", sellerId: "alice", title: "Old Listing",
      price: 5, downloads: 2, listedAt: new Date().toISOString(), status: "active",
    });
    const r = computeCreatorDashboard("alice", STATE);
    assert.equal(r.summary.listingCount, 1);
    assert.equal(r.summary.totalDownloads, 2);
    assert.equal(r.summary.totalEarnings, 10); // 2 * 5
  });

  it("merges both stores without double-counting when a creator has listings in each", () => {
    const STATE = makeState();
    STATE.marketplaceListings.set("listing_legacy", {
      id: "listing_legacy", sellerId: "alice", title: "Old Listing",
      price: 5, downloads: 2, listedAt: new Date().toISOString(), status: "active",
    });
    STATE.dtus.set("d1", {
      id: "d1", ownerId: "alice", title: "Track One", createdAt: new Date().toISOString(),
      lineage: {}, marketplace: { listed: true, price: 10, purchases: 4, listedAt: new Date().toISOString(), title: "Track One" },
    });
    const r = computeCreatorDashboard("alice", STATE);
    assert.equal(r.summary.listingCount, 2);
    assert.equal(r.summary.totalDownloads, 6);   // 2 + 4
    assert.equal(r.summary.totalEarnings, 50);   // 10 + 40
  });

  it("withdrawn dtu.marketplace listings (listed:false) still count toward historical downloads/earnings", () => {
    const STATE = makeState();
    STATE.dtus.set("d2", {
      id: "d2", ownerId: "bob", title: "Withdrawn Track", createdAt: new Date().toISOString(),
      lineage: {}, marketplace: { listed: false, price: 20, purchases: 1, listedAt: new Date().toISOString(), withdrawnAt: new Date().toISOString(), title: "Withdrawn Track" },
    });
    const r = computeCreatorDashboard("bob", STATE);
    assert.equal(r.summary.listingCount, 1);
    assert.equal(r.summary.totalDownloads, 1);
    assert.equal(r.summary.totalEarnings, 20);
  });

  it("a dtu.marketplace listing owned by someone else does not leak into my dashboard", () => {
    const STATE = makeState();
    STATE.dtus.set("d3", {
      id: "d3", ownerId: "carol", title: "Not Mine", createdAt: new Date().toISOString(),
      lineage: {}, marketplace: { listed: true, price: 100, purchases: 9, listedAt: new Date().toISOString() },
    });
    const r = computeCreatorDashboard("alice", STATE);
    assert.equal(r.summary.listingCount, 0);
    assert.equal(r.summary.totalDownloads, 0);
    assert.equal(r.summary.totalEarnings, 0);
  });

  it("a DTU with no .marketplace field is not treated as a listing", () => {
    const STATE = makeState();
    STATE.dtus.set("d4", { id: "d4", ownerId: "alice", title: "Never listed", createdAt: new Date().toISOString(), lineage: {} });
    const r = computeCreatorDashboard("alice", STATE);
    assert.equal(r.summary.listingCount, 0);
  });
});

describe("computeReputationLeaderboard — merges dtu.marketplace purchases into leaderboard downloads", () => {
  it("credits a seller's leaderboard downloads from a dtu.marketplace sale", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", { id: "d1", ownerId: "alice", lineage: {}, marketplace: { purchases: 7 } });
    const r = computeReputationLeaderboard(STATE, { limit: 10 });
    assert.equal(r.ok, true);
    const alice = r.creators.find((c) => c.userId === "alice");
    assert.ok(alice, "alice appears on the leaderboard (she owns a DTU)");
    assert.equal(alice.downloads, 7);
  });

  it("merges legacy + real-store downloads for the same seller", () => {
    const STATE = makeState();
    STATE.dtus.set("d1", { id: "d1", ownerId: "alice", lineage: {}, marketplace: { purchases: 3 } });
    STATE.marketplaceListings.set("listing_legacy", { sellerId: "alice", downloads: 2 });
    const r = computeReputationLeaderboard(STATE, { limit: 10 });
    const alice = r.creators.find((c) => c.userId === "alice");
    assert.equal(alice.downloads, 5); // 3 + 2
  });
});
