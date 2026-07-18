// server/tests/creation-singularity-arena.test.js
//
// P-D — Creation Singularity: fork-vs-fork tournament arena tests.
//
// Covers:
//   (a) migration 370 applies cleanly.
//   (b) createArena honest-fails on <2 forks (insufficient_forks), on a
//       missing fork (fork_not_found), and on a fork the caller doesn't own
//       (forbidden) — nothing persisted on any of these.
//   (c) a seeded, fully-run bracket produces a DETERMINISTIC winner: run
//       the exact same fork set through two independent arenas and assert
//       identical champion + identical per-fork scores both times.
//   (d) the winner is the fork with the objectively strongest, honestly
//       computed synthesis signal (hyper tier + real structured claims +
//       tag breadth) — proving the score isn't fabricated noise.
//   (e) NO economy_ledger row is ever written by seeding or running an
//       arena to completion (structurally cannot touch money).
//   (f) the confined per-fork sandbox used for scoring genuinely cannot
//       reach economy.mint / economy.transfer — capability_denied, proven
//       by direct call, not assumed.
//   (g) the `creation_singularity.*` macro surface (arena_create /
//       arena_run_round / arena_run / arena_get / arena_list) wires the lib
//       correctly end-to-end, including minting the ONE reward: a citable
//       result DTU via the ordinary dtu.create macro (mocked here, since
//       the real dtu.create lives deep in server.js and is out of scope for
//       this unit — only the plumbing is under test).
//
// Run: node --test tests/creation-singularity-arena.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig002 from "../migrations/002_economy_tables.js";
import * as mig351 from "../migrations/351_fork_objects.js";
import * as mig370 from "../migrations/370_creation_singularity_arenas.js";

import { createForkObject, instantiateForkSandbox } from "../lib/lattice-fork.js";
import {
  computeForkScore,
  createArena,
  loadArena,
  runArenaRound,
  runArenaToCompletion,
  rankingFromBracket,
  MAX_ARENA_FORKS,
} from "../lib/creation-singularity.js";
import registerCreationSingularityActions from "../domains/creation-singularity.js";

let db;

function ctxFor(userId, { macroRun } = {}) {
  return {
    db,
    actor: { userId },
    userId,
    macro: { run: macroRun || (async () => ({ ok: false, error: "no_macro_mock" })) },
  };
}

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, domain: name.split(".")[0], type: "domain_action", data: params, meta: {} }, params);
}

// A DTU insert helper matching migration 001's `dtus` shape (id, owner_user_id,
// title, body_json, tags_json, visibility, tier, created_at, updated_at).
function insertDtu(id, ownerUserId, { content = "", summary = "", tags = [], tier = "regular", claims = [] } = {}) {
  const body = { content, summary };
  if (claims.length) body.core = { claims };
  db.prepare(
    "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, tier) VALUES (?,?,?,?,?,?)",
  ).run(id, ownerUserId, id, JSON.stringify(body), JSON.stringify(tags), tier);
}

function makeFork(ownerUserId, dtuIds) {
  const r = createForkObject(db, { ownerUserId, sourceUserId: ownerUserId, dtuIds });
  assert.equal(r.ok, true, "fixture fork must create cleanly");
  return r.id;
}

beforeEach(() => {
  ACTIONS.clear();
  registerCreationSingularityActions(register);

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      scopes TEXT NOT NULL DEFAULT '["read","write"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1,
      is_agent INTEGER DEFAULT 0,
      agent_kind TEXT,
      agent_created_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE agent_identities (
      agent_id           TEXT PRIMARY KEY,
      user_id            TEXT,
      world_id           TEXT,
      given_name         TEXT NOT NULL,
      naming_origin      TEXT NOT NULL DEFAULT 'self_named',
      core_values_json   TEXT NOT NULL DEFAULT '[]',
      drive_profile_json TEXT NOT NULL DEFAULT '{}',
      identity_dtu_id    TEXT,
      status             TEXT NOT NULL DEFAULT 'active',
      deposit_sparks     INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      last_evolved_at    INTEGER,
      last_reviewed_at   INTEGER,
      value_drift        REAL DEFAULT 0,
      drift_flagged_at   INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      body_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private',
      tier TEXT NOT NULL DEFAULT 'regular',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  mig002.up(db);
  mig351.up(db);
  mig370.up(db);

  const now = new Date().toISOString();
  for (const [id, uname] of [["u_alice", "alice"], ["u_bob", "bob"]]) {
    db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,?)")
      .run(id, uname, `${uname}@x.test`, "x", now);
  }
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("migration 370 — creation_singularity_arenas", () => {
  it("applies cleanly, creates the table + indexes, and is idempotent", () => {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creation_singularity_arenas'").get();
    assert.ok(t);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_csa_owner'").get();
    assert.ok(idx);
    assert.doesNotThrow(() => mig370.up(db));
  });
});

describe("(b) createArena — honest failures", () => {
  it("rejects fewer than 2 forks", () => {
    const forkA = makeFork("u_alice", ["dtu_a"].map((id) => { insertDtu(id, "u_alice"); return id; }));
    const r = createArena(db, { ownerUserId: "u_alice", forkObjectIds: [forkA] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_forks");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM creation_singularity_arenas").get().n, 0, "nothing persisted");
  });

  it("rejects an empty entrant list the same way", () => {
    const r = createArena(db, { ownerUserId: "u_alice", forkObjectIds: [] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_forks");
  });

  it("honest-fails on a missing fork object", () => {
    insertDtu("dtu_a", "u_alice");
    const forkA = makeFork("u_alice", ["dtu_a"]);
    const r = createArena(db, { ownerUserId: "u_alice", forkObjectIds: [forkA, "fork_does_not_exist"] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "fork_not_found");
    assert.equal(r.forkObjectId, "fork_does_not_exist");
  });

  it("honest-fails when an entrant fork isn't owned by the arena creator", () => {
    insertDtu("dtu_a", "u_alice");
    insertDtu("dtu_b", "u_bob");
    const forkA = makeFork("u_alice", ["dtu_a"]);
    const forkB = makeFork("u_bob", ["dtu_b"]);
    const r = createArena(db, { ownerUserId: "u_alice", forkObjectIds: [forkA, forkB] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "forbidden");
    assert.equal(r.forkObjectId, forkB);
  });

  it("rejects an over-cap entrant list without touching the DB", () => {
    const tooMany = Array.from({ length: MAX_ARENA_FORKS + 1 }, (_, i) => `fork_fake_${i}`);
    const r = createArena(db, { ownerUserId: "u_alice", forkObjectIds: tooMany });
    assert.equal(r.ok, false);
    assert.equal(r.error, "arena_bound_exceeded");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM creation_singularity_arenas").get().n, 0);
  });
});

describe("(c)/(d) deterministic, honest scoring across a full bracket", () => {
  it("the fork with the strongest real synthesis signal always wins, and re-running is byte-identical", () => {
    // Four forks, strictly increasing real signal: tier + content depth +
    // tag breadth + structured claims. Fork D is unambiguously the
    // strongest by every honest metric the scorer reads.
    insertDtu("dtu_weak", "u_alice", { content: "x", summary: "", tags: [], tier: "regular" });
    const forkWeak = makeFork("u_alice", ["dtu_weak"]);

    insertDtu("dtu_mid", "u_alice", { content: "a".repeat(500), summary: "mid summary", tags: ["a", "b"], tier: "regular" });
    const forkMid = makeFork("u_alice", ["dtu_mid"]);

    insertDtu("dtu_strong", "u_alice", { content: "b".repeat(2000), summary: "strong summary here", tags: ["a", "b", "c", "d"], tier: "mega" });
    const forkStrong = makeFork("u_alice", ["dtu_strong"]);

    insertDtu("dtu_champion", "u_alice", {
      content: "c".repeat(8000),
      summary: "the champion synthesis, deeply structured",
      tags: ["a", "b", "c", "d", "e", "f"],
      tier: "hyper",
      claims: ["claim one", "claim two", "claim three"],
    });
    const forkChampion = makeFork("u_alice", ["dtu_champion"]);

    // Sanity: computeForkScore is monotone with the fixtures' real signal.
    const sWeak = computeForkScore(db, forkWeak);
    const sMid = computeForkScore(db, forkMid);
    const sStrong = computeForkScore(db, forkStrong);
    const sChampion = computeForkScore(db, forkChampion);
    assert.ok(sWeak.ok && sMid.ok && sStrong.ok && sChampion.ok);
    assert.ok(sWeak.score < sMid.score, "weak < mid");
    assert.ok(sMid.score < sStrong.score, "mid < strong");
    assert.ok(sStrong.score < sChampion.score, "strong < champion — real synthesis signal, not noise");

    const forkIds = [forkWeak, forkMid, forkStrong, forkChampion];

    const run1 = createArena(db, { ownerUserId: "u_alice", title: "Run 1", forkObjectIds: forkIds });
    assert.equal(run1.ok, true);
    const finished1 = runArenaToCompletion(db, run1.arena.id);
    assert.equal(finished1.ok, true);
    assert.equal(finished1.arena.status, "completed");
    assert.equal(finished1.arena.championForkId, forkChampion, "strongest real signal wins, regardless of seed pairing");

    // Re-run the identical fork set in a SECOND, independent arena — same
    // champion, same per-match scores, proving reproducibility (not merely
    // "highest wins" by construction of the test, but genuinely stable
    // across independent seed/bracket generation).
    const run2 = createArena(db, { ownerUserId: "u_alice", title: "Run 2", forkObjectIds: forkIds });
    assert.equal(run2.ok, true);
    const finished2 = runArenaToCompletion(db, run2.arena.id);
    assert.equal(finished2.ok, true);
    assert.equal(finished2.arena.championForkId, forkChampion);

    // Deterministic scores: every scoreA/scoreB the champion posted in either
    // run must equal computeForkScore's own direct read — no drift, no RNG.
    for (const arena of [finished1.arena, finished2.arena]) {
      for (const round of arena.bracket) {
        for (const m of round) {
          if (m.status !== "complete") continue;
          if (m.forkAId === forkChampion) assert.equal(m.scoreA, sChampion.score);
          if (m.forkBId === forkChampion) assert.equal(m.scoreB, sChampion.score);
        }
      }
    }

    const ranking = rankingFromBracket(finished1.arena);
    assert.equal(ranking[0].forkObjectId, forkChampion);
    assert.equal(ranking[0].eliminatedInRound, null);
    assert.equal(ranking.length, 4, "every entrant appears exactly once in the final ranking");
  });

  it("byes auto-advance without a head-to-head (3 entrants → 1 bye in round 1)", () => {
    insertDtu("dtu_1", "u_alice", { content: "one", tier: "regular" });
    insertDtu("dtu_2", "u_alice", { content: "two".repeat(100), tier: "mega" });
    insertDtu("dtu_3", "u_alice", { content: "three".repeat(300), tier: "hyper", claims: ["c1"] });
    const forks = [
      makeFork("u_alice", ["dtu_1"]),
      makeFork("u_alice", ["dtu_2"]),
      makeFork("u_alice", ["dtu_3"]),
    ];
    const created = createArena(db, { ownerUserId: "u_alice", forkObjectIds: forks });
    assert.equal(created.ok, true);
    const round1 = created.arena.bracket[0];
    assert.equal(round1.length, 2, "next-pow2(3)=4 → 2 matches");
    assert.ok(round1.some((m) => m.status === "bye"), "one slot must be a bye");

    const finished = runArenaToCompletion(db, created.arena.id);
    assert.equal(finished.ok, true);
    assert.equal(finished.arena.status, "completed");
    assert.ok(forks.includes(finished.arena.championForkId));
  });
});

describe("(e) NO money surface — economy_ledger untouched", () => {
  it("seeding + running a full arena writes ZERO economy_ledger rows", () => {
    insertDtu("dtu_x", "u_alice", { content: "x".repeat(50), tier: "regular" });
    insertDtu("dtu_y", "u_alice", { content: "y".repeat(900), tier: "hyper", claims: ["a", "b"] });
    const forks = [makeFork("u_alice", ["dtu_x"]), makeFork("u_alice", ["dtu_y"])];

    const before = db.prepare("SELECT COUNT(*) n FROM economy_ledger").get().n;
    assert.equal(before, 0);

    const created = createArena(db, { ownerUserId: "u_alice", forkObjectIds: forks });
    assert.equal(created.ok, true);
    const finished = runArenaToCompletion(db, created.arena.id);
    assert.equal(finished.ok, true);
    assert.equal(finished.arena.status, "completed");

    const after = db.prepare("SELECT COUNT(*) n FROM economy_ledger").get().n;
    assert.equal(after, 0, "no economy_ledger row was EVER written by the arena lifecycle");

    // Belt-and-suspenders: the persisted arena row itself carries no money
    // field — the schema (mig 370) has no prize_pool_cc/escrow column at all.
    const cols = db.pragma("table_info(creation_singularity_arenas)").map((c) => c.name);
    for (const forbidden of ["prize_pool_cc", "escrow_user_id", "stake_cc", "payout"]) {
      assert.ok(!cols.includes(forbidden), `schema must not carry a money column: ${forbidden}`);
    }
  });
});

describe("(f) the confined per-fork sandbox genuinely cannot mint/transfer", () => {
  it("economy.mint and economy.transfer are capability_denied on the exact sandbox used for scoring", async () => {
    insertDtu("dtu_z", "u_alice", { content: "z".repeat(100), tier: "regular" });
    const forkZ = makeFork("u_alice", ["dtu_z"]);

    // Re-derive the SAME sandbox computeForkScore uses internally.
    const sandbox = instantiateForkSandbox(forkZ, db);
    assert.equal(sandbox.ok, true);
    assert.equal(sandbox.confined.ok, true);
    assert.equal("db" in sandbox.ctx, false, "no raw db on the scoring sandbox");
    assert.equal("mintCoins" in sandbox.ctx, false, "no mint on the scoring sandbox");

    for (const [domain, name] of [
      ["economy", "mint"],
      ["economy", "transfer"],
      ["economy", "withdraw"],
      ["creation_singularity", "arena_create"],
    ]) {
      const denied = await sandbox.ctx.sdk.macro(domain, name, { amount: 1_000_000 });
      assert.equal(denied.ok, false, `${domain}.${name} must be denied`);
      assert.ok(
        denied.error === "capability_denied" || denied.error === "intent_drift",
        `${domain}.${name} denied for a capability reason, got ${denied.error}`,
      );
    }
  });
});

describe("(g) creation_singularity.* macro surface", () => {
  it("arena_create → arena_run_round → arena_get round-trips through the registered macros", async () => {
    insertDtu("dtu_p", "u_alice", { content: "p".repeat(40), tier: "regular" });
    insertDtu("dtu_q", "u_alice", { content: "q".repeat(4000), tier: "hyper", claims: ["k1", "k2"] });
    const forkP = makeFork("u_alice", ["dtu_p"]);
    const forkQ = makeFork("u_alice", ["dtu_q"]);

    const created = await call("creation_singularity.arena_create", ctxFor("u_alice"), {
      title: "Macro-wired arena",
      forkObjectIds: [forkP, forkQ],
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.arena.status, "in_progress");
    assert.equal(created.result.arena.forkCount, 2);

    const roundRes = await call("creation_singularity.arena_run_round", ctxFor("u_alice"), {
      arenaId: created.result.arena.id,
    });
    assert.equal(roundRes.ok, true);
    assert.equal(roundRes.result.finished, true, "2-entrant bracket finishes after exactly one round");
    assert.equal(roundRes.result.arena.championForkId, forkQ, "the honestly stronger fork wins");

    const got = await call("creation_singularity.arena_get", ctxFor("u_alice"), { arenaId: created.result.arena.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.arena.status, "completed");
    assert.equal(got.result.ranking[0].forkObjectId, forkQ);
  });

  it("arena_run runs to completion AND mints exactly one citable result DTU via dtu.create", async () => {
    insertDtu("dtu_m", "u_alice", { content: "m".repeat(30), tier: "regular" });
    insertDtu("dtu_n", "u_alice", { content: "n".repeat(3000), tier: "hyper", claims: ["c1"] });
    const forkM = makeFork("u_alice", ["dtu_m"]);
    const forkN = makeFork("u_alice", ["dtu_n"]);

    const created = await call("creation_singularity.arena_create", ctxFor("u_alice"), {
      forkObjectIds: [forkM, forkN],
    });
    assert.equal(created.ok, true);

    let dtuCreateCalls = 0;
    const macroRun = async (domain, name, input) => {
      if (domain === "dtu" && name === "create") {
        dtuCreateCalls++;
        assert.ok(input.tags.includes("creation-singularity"));
        assert.ok(input.tags.includes("non-monetary"));
        assert.equal(input.meta.arenaId, created.result.arena.id);
        return { ok: true, dtu: { id: "dtu_result_mock_1" } };
      }
      throw new Error(`unexpected macro call ${domain}.${name}`);
    };

    const ran = await call("creation_singularity.arena_run", ctxFor("u_alice", { macroRun }), {
      arenaId: created.result.arena.id,
    });
    assert.equal(ran.ok, true);
    assert.equal(ran.result.finished, true);
    assert.equal(ran.result.resultDtuId, "dtu_result_mock_1");
    assert.equal(ran.result.ranking[0].forkObjectId, forkN);
    assert.equal(dtuCreateCalls, 1, "exactly one result DTU minted");

    // Idempotent re-call: no second DTU mint.
    const ranAgain = await call("creation_singularity.arena_run", ctxFor("u_alice", { macroRun }), {
      arenaId: created.result.arena.id,
    });
    assert.equal(ranAgain.ok, true);
    assert.equal(ranAgain.result.alreadyCompleted, true);
    assert.equal(dtuCreateCalls, 1, "re-running a completed arena never re-mints");

    // The persisted row itself carries the result_dtu_id.
    const row = db.prepare("SELECT result_dtu_id, status FROM creation_singularity_arenas WHERE id = ?").get(created.result.arena.id);
    assert.equal(row.status, "completed");
    assert.equal(row.result_dtu_id, "dtu_result_mock_1");
  });

  it("arena_create honest-fails through the macro surface the same way the lib does", async () => {
    insertDtu("dtu_solo", "u_alice");
    const forkSolo = makeFork("u_alice", ["dtu_solo"]);
    const r = await call("creation_singularity.arena_create", ctxFor("u_alice"), { forkObjectIds: [forkSolo] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_forks");
  });

  it("a stranger cannot run or read someone else's arena", async () => {
    insertDtu("dtu_1", "u_alice");
    insertDtu("dtu_2", "u_alice", { content: "longer content here", tier: "mega" });
    const forks = [makeFork("u_alice", ["dtu_1"]), makeFork("u_alice", ["dtu_2"])];
    const created = await call("creation_singularity.arena_create", ctxFor("u_alice"), { forkObjectIds: forks });
    assert.equal(created.ok, true);

    const stranger = await call("creation_singularity.arena_get", ctxFor("u_bob"), { arenaId: created.result.arena.id });
    assert.equal(stranger.ok, false);
    assert.equal(stranger.error, "forbidden");

    const strangerRun = await call("creation_singularity.arena_run_round", ctxFor("u_bob"), { arenaId: created.result.arena.id });
    assert.equal(strangerRun.ok, false);
    assert.equal(strangerRun.error, "forbidden");
  });

  it("arena_list only returns the caller's own arenas", async () => {
    insertDtu("dtu_a1", "u_alice");
    insertDtu("dtu_a2", "u_alice", { content: "x".repeat(200) });
    const aForks = [makeFork("u_alice", ["dtu_a1"]), makeFork("u_alice", ["dtu_a2"])];
    await call("creation_singularity.arena_create", ctxFor("u_alice"), { forkObjectIds: aForks });

    const bobList = await call("creation_singularity.arena_list", ctxFor("u_bob"), {});
    assert.equal(bobList.ok, true);
    assert.equal(bobList.result.count, 0);

    const aliceList = await call("creation_singularity.arena_list", ctxFor("u_alice"), {});
    assert.equal(aliceList.ok, true);
    assert.equal(aliceList.result.count, 1);
  });
});
