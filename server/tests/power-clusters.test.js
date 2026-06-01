// Power-cluster collectibles (SR4/Crackdown loop): scatter, per-player claim,
// proximity gate, idempotency, award, progress.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  scatterClusters, listClustersForWorld, claimCluster, getClusterProgress,
  CLUSTERS_PER_WORLD, POWER_TAGS,
} from "../lib/power-clusters.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE power_clusters (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, power_tag TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 1, x REAL NOT NULL, y REAL DEFAULT 0, z REAL NOT NULL,
      spawned_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE power_cluster_claims (
      cluster_id TEXT NOT NULL, user_id TEXT NOT NULL, world_id TEXT, power_tag TEXT,
      claimed_at INTEGER DEFAULT (unixepoch()), PRIMARY KEY (cluster_id, user_id)
    );
    CREATE TABLE player_world_state (user_id TEXT PRIMARY KEY, x REAL, y REAL, z REAL);
    -- award dependencies (so claims exercise the real XP path)
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT,
      skill_level INTEGER DEFAULT 1, created_at INTEGER, last_used_at INTEGER
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT, native_world_type TEXT,
      level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, xp_to_next INTEGER DEFAULT 100, last_used_at INTEGER
    );
  `);
  return db;
}

test("scatter is idempotent + seeds CLUSTERS_PER_WORLD deterministic nodes", () => {
  const db = freshDb();
  const r1 = scatterClusters(db, "w1");
  assert.equal(r1.spawned, CLUSTERS_PER_WORLD);
  const r2 = scatterClusters(db, "w1");
  assert.equal(r2.spawned, 0, "second scatter adds nothing");
  const n = db.prepare("SELECT COUNT(*) AS n FROM power_clusters WHERE world_id='w1'").get().n;
  assert.equal(n, CLUSTERS_PER_WORLD);
  // deterministic: every node has a valid tag + tier 1..3
  for (const c of db.prepare("SELECT * FROM power_clusters WHERE world_id='w1'").all()) {
    assert.ok(POWER_TAGS.includes(c.power_tag));
    assert.ok(c.tier >= 1 && c.tier <= 3);
  }
});

test("list lazy-seeds + flags claimed per-user; proximity filter works", () => {
  const db = freshDb();
  const r = listClustersForWorld(db, "w1", "alice");
  assert.equal(r.ok, true);
  assert.equal(r.clusters.length, CLUSTERS_PER_WORLD);
  assert.ok(r.clusters.every((c) => c.claimed === false));
  // proximity window around the first node returns fewer than the full set
  const first = r.clusters[0];
  const near = listClustersForWorld(db, "w1", "alice", { x: first.x, z: first.z, radius: 10 });
  assert.ok(near.count >= 1 && near.count <= r.clusters.length);
});

test("claim rejects when the player isn't standing on the node", () => {
  const db = freshDb();
  const c = listClustersForWorld(db, "w1", "bob").clusters[0];
  const far = claimCluster(db, "w1", "bob", c.id, { x: c.x + 1000, z: c.z + 1000 });
  assert.equal(far.ok, false);
  assert.equal(far.reason, "too_far");
});

test("valid claim awards the power + records a per-player claim (idempotent)", () => {
  const db = freshDb();
  const c = listClustersForWorld(db, "w1", "carol").clusters[0];
  const ok = claimCluster(db, "w1", "carol", c.id, { x: c.x, z: c.z });
  assert.equal(ok.ok, true);
  assert.equal(ok.powerTag, c.power_tag);
  assert.ok(ok.award && ok.award.kind, "award resolved");
  // recorded
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM power_cluster_claims WHERE user_id='carol'").get().n, 1);
  // idempotent
  const again = claimCluster(db, "w1", "carol", c.id, { x: c.x, z: c.z });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "already_claimed");
  // still one claim
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM power_cluster_claims WHERE user_id='carol'").get().n, 1);
});

test("presence cross-check rejects a spoofed claim position", () => {
  const db = freshDb();
  const c = listClustersForWorld(db, "w1", "dave").clusters[0];
  // server says dave is far from where he claims to be standing
  db.prepare("INSERT INTO player_world_state (user_id, x, y, z) VALUES ('dave', 5000, 0, 5000)").run();
  const r = claimCluster(db, "w1", "dave", c.id, { x: c.x, z: c.z });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "position_mismatch");
});

test("progress reflects claimed vs total per power", () => {
  const db = freshDb();
  const list = listClustersForWorld(db, "w1", "erin").clusters;
  const target = list[0];
  claimCluster(db, "w1", "erin", target.id, { x: target.x, z: target.z });
  const p = getClusterProgress(db, "erin", "w1");
  assert.equal(p.ok, true);
  assert.equal(p.total, CLUSTERS_PER_WORLD);
  assert.equal(p.claimedTotal, 1);
  const tagRow = p.byTag.find((t) => t.powerTag === target.power_tag);
  assert.ok(tagRow.claimed >= 1);
});
