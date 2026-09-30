// server/tests/lattice-seed-domain-parity.test.js
//
// Contract tests for server/domains/lattice-seed.js — every recovered
// Auto-DTU / ingest-scheduler macro is registered and round-trips
// through the registerLensAction (ctx, artifact, params) shape.
//
// Run: node --test server/tests/lattice-seed-domain-parity.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upLatticeSeed } from "../migrations/444_lattice_seed.js";
import registerLatticeSeedActions from "../domains/lattice-seed.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`lattice-seed.${name}`);
  if (!fn) throw new Error(`lattice-seed.${name} not registered`);
  return fn(ctx, { id: null, data: input, meta: {} }, input);
}

before(() => { registerLatticeSeedActions(register); });

let db;
let ctx;
beforeEach(() => {
  db = new Database(":memory:");
  upLatticeSeed(db);
  ctx = { db, actor: { userId: "parity_user", role: "member" } };
});
afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

const EXPECTED = [
  "status", "createSource", "listSources", "queuePage", "listPages",
  "executeNext", "proposeHypotheses", "listHypotheses",
  "createResearchJob", "listResearchJobs",
  "mintFromHypothesis", "mintFromResearchJob", "setTrust",
  "listAutoDtus", "listMemory",
];

describe("lattice-seed registration", () => {
  it("registers the recovered Auto-DTU / ingest-scheduler macros", () => {
    for (const name of EXPECTED) {
      assert.ok(ACTIONS.has(`lattice-seed.${name}`), `missing lattice-seed.${name}`);
    }
  });
});

describe("lattice-seed macros — round trip", () => {
  it("status on a fresh user is zeros, quota 10 for member", () => {
    const r = call("status", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.autoDtuCount, 0);
    assert.equal(r.result.quotaLimit, 10);
    assert.equal(r.result.quotaUsed, 0);
  });

  it("createSource / queuePage / executeNext / propose / mint / setTrust", async () => {
    const src = call("createSource", ctx, { label: "Notes", rootUrl: "https://example.com" });
    assert.equal(src.ok, true);
    const queued = call("queuePage", ctx, { sourceId: src.result.id, url: "https://example.com/ice" });
    assert.equal(queued.ok, true);

    const executed = await call("executeNext", ctx, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "<p>Callisto may have a subsurface ocean.</p>",
      }),
    });
    assert.equal(executed.ok, true, JSON.stringify(executed));
    assert.equal(executed.result.excerpt, "Callisto may have a subsurface ocean.");
    assert.equal(executed.result.quotaUsed, 1);

    const minted = await call("mintFromHypothesis", ctx, { hypothesisId: executed.result.hypothesisId });
    assert.equal(minted.ok, true, JSON.stringify(minted));
    assert.equal(minted.result.dtu.trustLevel, "experimental");

    const trusted = call("setTrust", ctx, { key: minted.result.dtu.key, trustLevel: "trusted" });
    assert.equal(trusted.ok, true);
    const listed = call("listAutoDtus", ctx, { includeExperimental: false });
    assert.equal(listed.result.dtus.length, 1);
  });

  it("createResearchJob processes inline and mintFromResearchJob needs done", async () => {
    const job = await call("createResearchJob", ctx, { topic: "Callisto ocean" });
    assert.equal(job.ok, true);
    assert.equal(job.result.status, "done");
    const minted = await call("mintFromResearchJob", ctx, { jobId: job.result.id });
    assert.equal(minted.ok, true);
    assert.equal(minted.result.dtu.kind, "auto-research");
  });

  it("executeNext quota is role-derived — a member ctx cannot self-declare admin", async () => {
    const src = call("createSource", ctx, { label: "Burst" });
    for (let i = 0; i < 11; i++) {
      call("queuePage", ctx, { sourceId: src.result.id, url: `https://example.com/${i}` });
    }
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => "<p>x</p>" });
    for (let i = 0; i < 10; i++) {
      const r = await call("executeNext", { ...ctx, actor: { userId: "parity_user", role: "member" } }, { fetchImpl, mode: "admin" });
      assert.equal(r.ok, true, `member page ${i}`);
    }
    const blocked = await call("executeNext", { ...ctx, actor: { userId: "parity_user", role: "member" } }, { fetchImpl, mode: "admin" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "quota_reached");
  });

  it("no_db is honest", () => {
    const r = call("listSources", { actor: { userId: "x" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
});
