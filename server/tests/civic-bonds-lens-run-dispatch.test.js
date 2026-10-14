// INC-SWEEP civic-bonds F1 — /api/lens/run prefers LENS_ACTIONS; COMMON_ACTIONS
// used to register a generic artifact vote for civic_bonds that returned
// { score:null, voteCount } and never wrote civic_bond_votes.
//
// Hermetic: builds the two registries the way server.js does, simulates the
// COMMON_ACTIONS.vote collision, then installs registerCivicBondsLensActions
// (the fix) and proves every lens verb reaches the domain handler.
//
// Run: node --test tests/civic-bonds-lens-run-dispatch.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { resolveDualRegistry } from "../lib/dual-registry-resolve.js";
import registerCivicBondsMacros, { registerCivicBondsLensActions } from "../domains/civic-bonds.js";

const VERBS = [
  "create", "open", "pledge", "unpledge", "fund", "ledger", "list", "get",
  "scopes", "spillover", "vote",
];

/** Faithful /api/lens/run dispatch: prefer LENS_ACTIONS, then MACROS. */
async function lensRunDispatch(lensActions, macros, domain, name, input, ctx) {
  const resolved = resolveDualRegistry(domain, name, {
    lensActions,
    runMacro: async () => {},
    macros,
  });
  if (resolved.via === "lens_action") {
    const virtualArtifact = { id: null, domain, type: "domain_action", data: input || {}, meta: {} };
    return await resolved.handler(ctx, virtualArtifact, input || {});
  }
  if (resolved.via === "macro") {
    const entry = macros.get(domain)?.get(name);
    const fn = typeof entry === "function" ? entry : entry?.fn;
    return await fn(ctx, input || {});
  }
  return { ok: false, reason: "not_registered" };
}

/** The generic COMMON_ACTIONS.vote shape that caused F1. */
function genericArtifactVote(_ctx, artifact, params) {
  if (!artifact.data) artifact.data = {};
  const direction = params?.direction || params?.vote || 1;
  artifact.data.score = (artifact.data.score || 0) + Number(direction);
  artifact.data.voteCount = (artifact.data.voteCount || 0) + 1;
  return { ok: true, score: artifact.data.score, voteCount: artifact.data.voteCount };
}

function mkUser(db, id) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
}

describe("civic_bonds lens/run dispatch (INC-SWEEP F1)", () => {
  let db, MACROS, LENS_ACTIONS;
  beforeEach(async () => {
    process.env.CONCORD_CIVIC_BONDS = "1";
    db = new Database(":memory:");
    await runMigrations(db);
    mkUser(db, "ruler");
    mkUser(db, "v1");

    MACROS = new Map();
    registerCivicBondsMacros((domain, name, fn) => {
      if (!MACROS.has(domain)) MACROS.set(domain, new Map());
      MACROS.get(domain).set(name, { fn });
    });

    LENS_ACTIONS = new Map();
    // Reproduce the pre-fix collision: COMMON_ACTIONS.vote lands in LENS_ACTIONS
    // while the real voteBond only lives in MACROS.
    LENS_ACTIONS.set("civic_bonds.vote", genericArtifactVote);
  });
  afterEach(() => {
    delete process.env.CONCORD_CIVIC_BONDS;
    try { db.close(); } catch { /* noop */ }
  });

  it("documents the bug: COMMON_ACTIONS.vote wins and never moves the tally", async () => {
    const ctx = { db, actor: { userId: "ruler" } };
    const created = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "create", {
      worldId: "w1", title: "Bridge", targetAmount: 100, denomination: 1, quorum: 1,
    }, ctx);
    assert.equal(created.ok, true);
    const bondId = created.bondId;
    assert.equal((await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "open", { bondId }, ctx)).ok, true);

    const voteRes = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "vote", {
      bondId, vote: "for",
    }, { db, actor: { userId: "v1" } });
    // Generic shape: NaN score serializes oddly; voteCount increments on the artifact.
    assert.equal(voteRes.ok, true);
    assert.equal(voteRes.voteCount, 1);
    assert.ok("score" in voteRes);

    const get = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "get", { bondId }, ctx);
    assert.equal(get.bond.votes_for, 0);
    assert.equal(get.bond.votes_against, 0);
  });

  it("fix: lens-action bridge routes vote to voteBond — tally moves; repeat is idempotent", async () => {
    // Install the fix (as domains/index.js does before COMMON_ACTIONS).
    registerCivicBondsLensActions((domain, name, fn) => {
      LENS_ACTIONS.set(`${domain}.${name}`, fn);
    });

    const ctx = { db, actor: { userId: "ruler" } };
    const created = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "create", {
      worldId: "w1", title: "Bridge", targetAmount: 100, denomination: 1, quorum: 1,
    }, ctx);
    const bondId = created.bondId;
    assert.equal((await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "open", { bondId }, ctx)).ok, true);

    const vctx = { db, actor: { userId: "v1" } };
    const first = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "vote", {
      bondId, vote: "for",
    }, vctx);
    assert.equal(first.ok, true);
    assert.equal(first.voteCount, undefined, "must not be the generic artifact vote");
    assert.equal(first.score, undefined);

    let get = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "get", { bondId }, ctx);
    assert.equal(get.bond.votes_for, 1);
    assert.equal(get.bond.votes_against, 0);

    // Domain semantics (voteBond): one vote per account; PK collision → idempotent,
    // no change of vote in v1 (against after for does not flip the tally).
    const second = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "vote", {
      bondId, vote: "against",
    }, vctx);
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);

    get = await lensRunDispatch(LENS_ACTIONS, MACROS, "civic_bonds", "get", { bondId }, ctx);
    assert.equal(get.bond.votes_for, 1);
    assert.equal(get.bond.votes_against, 0);
  });

  it("every audited verb resolves to the domain handler (lens_action after bridge), not a missing/generic miss", () => {
    registerCivicBondsLensActions((domain, name, fn) => {
      LENS_ACTIONS.set(`${domain}.${name}`, fn);
    });
    for (const name of VERBS) {
      const r = resolveDualRegistry("civic_bonds", name, {
        lensActions: LENS_ACTIONS,
        runMacro: async () => {},
        macros: MACROS,
      });
      assert.equal(r.via, "lens_action", `${name} must prefer the domain lens-action bridge`);
      // Generic artifact vote is the only COMMON_ACTIONS collision for this domain;
      // after the bridge, the handler must be the domain wrapper (not generic).
      if (name === "vote") {
        assert.notEqual(r.handler, genericArtifactVote);
      }
    }
  });
});
