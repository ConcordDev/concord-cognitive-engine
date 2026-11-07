// A4 (saved-work-as-DTU) PR 2 — the graph registration surface:
// lib/graph-nodes.js + the graph.registered-nodes action + Commonsense's
// provider (S-CS-4's connections leg).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  registerGraphNodeProvider,
  collectGraphNodes,
  _clearGraphNodeProvidersForTests,
} from "../lib/graph-nodes.js";
import registerGraphActions from "../domains/graph.js";
import registerCommonsenseActions from "../domains/commonsense.js";

function capture() {
  const actions = new Map();
  return {
    actions,
    register: (domain, action, fn) => actions.set(`${domain}.${action}`, fn),
  };
}

describe("graph-nodes registry", () => {
  beforeEach(() => _clearGraphNodeProvidersForTests());

  it("composes a domain's registered nodes, normalized + deduped", async () => {
    registerGraphNodeProvider("commonsense", () => [
      { id: "ck_1", title: "Do heavy things fall faster?", summary: "No." },
      { id: "ck_1", title: "duplicate id" },
      { id: "ck_2", title: "" },
      { title: "no id" },
    ]);
    const { nodes, errors } = await collectGraphNodes({ domain: "commonsense", ctx: {} });
    assert.deepEqual(nodes.map((n) => n.id), ["ck_1"]);
    assert.equal(nodes[0].registered, true);
    assert.deepEqual(errors, {});
  });

  it("a failing provider is reported, never thrown, and isolates", async () => {
    registerGraphNodeProvider("broken", () => { throw new Error("store gone"); });
    registerGraphNodeProvider("fine", () => [{ id: "n1", title: "Fine node" }]);
    const { nodes, errors } = await collectGraphNodes({ domain: "broken", ctx: {} });
    assert.deepEqual(nodes, []);
    assert.match(errors.broken, /store gone/);
    const all = await collectGraphNodes({ ctx: {}, all: true });
    assert.deepEqual(all.nodes.map((n) => n.id), ["n1"]);
  });

  it("the graph action serves the composed nodes", async () => {
    registerGraphNodeProvider("commonsense", () => [{ id: "ck_9", title: "Q?" }]);
    const cap = capture();
    registerGraphActions(cap.register);
    const fn = cap.actions.get("graph.registered-nodes");
    const out = await fn({}, {}, { domain: "commonsense" });
    assert.equal(out.ok, true);
    assert.deepEqual(out.result.nodes.map((n) => n.id), ["ck_9"]);
    const missing = await fn({}, {}, {});
    assert.equal(missing.ok, false);
  });
});

describe("commonsense provider (S-CS-4 acceptance instance)", () => {
  it("the caller's checks register as fabric nodes; anonymous registers nothing", async () => {
    _clearGraphNodeProvidersForTests();
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE commonsense_checks (id TEXT, user_id TEXT, question TEXT, finding TEXT, exception TEXT, created_at TEXT, updated_at TEXT)`);
    db.prepare(`INSERT INTO commonsense_checks VALUES ('ck_a','u1','Is the sky blue?','Yes — Rayleigh scattering.',NULL,'2026-11-01','2026-11-01')`).run();
    db.prepare(`INSERT INTO commonsense_checks VALUES ('ck_b','u2','Their question','Their finding',NULL,'2026-11-01','2026-11-01')`).run();
    globalThis._concordSTATE = { commonsenseLens: {}, db };
    const cap = capture();
    registerCommonsenseActions(cap.register);
    const ctx = { actor: { userId: "u1" }, db };
    const { nodes } = await collectGraphNodes({ domain: "commonsense", ctx });
    assert.deepEqual(nodes.map((n) => n.id), ["ck_a"]);
    assert.equal(nodes[0].title, "Is the sky blue?");
    assert.match(nodes[0].summary, /Rayleigh/);
    const anon = await collectGraphNodes({ domain: "commonsense", ctx: { db } });
    assert.deepEqual(anon.nodes, []);
    delete globalThis._concordSTATE;
  });
});
