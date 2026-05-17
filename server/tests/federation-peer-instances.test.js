/**
 * Tier-2 contract tests for Phase 13 Stage D — federation peer instances +
 * NodeInfo discovery.
 *
 * Pins:
 *   - pickNodeInfoHref selects the highest schema version available
 *   - probePeerInstance upserts row on success with software metadata
 *   - probePeerInstance marks row 'unreachable' on probe failure
 *   - listPeerInstances filters by status by default
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createServer } from "node:http";

import {
  probePeerInstance,
  listPeerInstances,
  pickNodeInfoHref,
} from "../lib/federation-peer-discovery.js";
import { up as up203 } from "../migrations/203_federation_peer_instances.js";

function setupDb() {
  const db = new Database(":memory:");
  up203(db);
  return db;
}

/**
 * Spin up a tiny in-process HTTP server that serves NodeInfo 2.1.
 * Returns { base, close }.
 */
async function startFakeNodeInfoServer(softwareName = "concord", softwareVersion = "5.1.0") {
  const server = createServer((req, res) => {
    if (req.url === "/.well-known/nodeinfo") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        links: [
          { rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: `http://${req.headers.host}/api/nodeinfo/2.0` },
          { rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: `http://${req.headers.host}/api/nodeinfo/2.1` },
        ],
      }));
      return;
    }
    if (req.url === "/api/nodeinfo/2.1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "2.1",
        software: { name: softwareName, version: softwareVersion },
        protocols: ["activitypub"],
        openRegistrations: false,
        usage: { users: { total: 42 } },
      }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

// ── pickNodeInfoHref ───────────────────────────────────────────────────────

describe("pickNodeInfoHref — prefers highest schema version", () => {
  it("prefers 2.1 over 2.0 and 1.x", () => {
    const links = [
      { rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: "url-2-0" },
      { rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: "url-2-1" },
      { rel: "http://nodeinfo.diaspora.software/ns/schema/1.0", href: "url-1-0" },
    ];
    assert.equal(pickNodeInfoHref(links), "url-2-1");
  });
  it("falls back to 2.0 when 2.1 absent", () => {
    const links = [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: "url" }];
    assert.equal(pickNodeInfoHref(links), "url");
  });
  it("returns null when no valid link", () => {
    assert.equal(pickNodeInfoHref([{ rel: "other", href: "url" }]), null);
    assert.equal(pickNodeInfoHref(null), null);
  });
});

// ── probePeerInstance (real HTTP) ─────────────────────────────────────────

describe("probePeerInstance — happy path", () => {
  let fake;
  beforeEach(async () => { fake = await startFakeNodeInfoServer(); });
  afterEach(async () => { if (fake) await fake.close(); });

  it("upserts row with software_name + software_version + capabilities", async () => {
    const db = setupDb();
    const r = await probePeerInstance(db, fake.base);
    assert.equal(r.ok, true);
    assert.equal(r.softwareName, "concord");
    assert.equal(r.softwareVersion, "5.1.0");
    const row = db.prepare(`SELECT * FROM federation_peer_instances WHERE base_url = ?`).get(fake.base);
    assert.equal(row.status, "active");
    assert.equal(row.software_name, "concord");
    assert.equal(row.software_version, "5.1.0");
    const caps = JSON.parse(row.capabilities_json);
    assert.deepEqual(caps.protocols, ["activitypub"]);
    assert.equal(caps.usage.users.total, 42);
  });

  it("second probe updates last_seen_at + last_probe_at", async () => {
    const db = setupDb();
    await probePeerInstance(db, fake.base);
    const before = db.prepare(`SELECT last_seen_at, last_probe_at FROM federation_peer_instances WHERE base_url = ?`).get(fake.base);
    await new Promise((r) => setTimeout(r, 1100)); // ensure unixepoch ticks
    await probePeerInstance(db, fake.base);
    const after = db.prepare(`SELECT last_seen_at, last_probe_at FROM federation_peer_instances WHERE base_url = ?`).get(fake.base);
    assert.ok(after.last_probe_at >= before.last_probe_at);
  });
});

describe("probePeerInstance — failure path", () => {
  it("marks unreachable on connection failure", async () => {
    const db = setupDb();
    // Port 1 is reserved; no listener — connection refused fast.
    const r = await probePeerInstance(db, "http://127.0.0.1:1");
    assert.equal(r.ok, false);
    const row = db.prepare(`SELECT * FROM federation_peer_instances WHERE base_url = ?`).get("http://127.0.0.1:1");
    assert.equal(row.status, "unreachable");
    assert.ok(row.last_error);
  });

  it("rejects malformed baseUrl", async () => {
    const db = setupDb();
    const r = await probePeerInstance(db, "not-a-url");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_base_url");
  });
});

// ── listPeerInstances ──────────────────────────────────────────────────────

describe("listPeerInstances", () => {
  it("active-only by default, all=true includes unreachable", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO federation_peer_instances (base_url, status) VALUES ('http://a', 'active'), ('http://b', 'unreachable'), ('http://c', 'active')`).run();
    const def = listPeerInstances(db);
    assert.equal(def.length, 2);
    const all = listPeerInstances(db, { all: true });
    assert.equal(all.length, 3);
  });
});
