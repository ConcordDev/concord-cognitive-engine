/**
 * DTU Protection — making "permanent record" a truthful claim.
 *
 * Covers the four defects this unit fixed:
 *
 *   1. `evolution.dedupe` (server.js) hard-deleted near-duplicates through the
 *      write-through store with NO protection check of any kind. Tested here
 *      IN BOTH DIRECTIONS against the real macro: a protected record survives,
 *      an unprotected near-duplicate still merges. (A guard that protects
 *      everything is as broken as one that protects nothing.)
 *   2. Two incompatible protection vocabularies (`_pinned` vs
 *      `protected`/`immutable`/`seedOrigin`) — now unioned by
 *      `lib/dtu-protection.js#isDtuProtected`, honored by the
 *      forgetting-engine's PROTECTION_RULES.
 *   3. The pin never persisted (`protectDTU` never called `STATE.dtus.set()`,
 *      the only SQLite write path) — tested with a REAL better-sqlite3 store
 *      round-trip: protect → rehydrate from SQLite → still protected.
 *   4. The runtime DTU hash is a 16-hex truncation over `title + cretiHuman`
 *      only, so it cannot detect a `core`/`machine`/`tags` edit. Tested: a
 *      tampered payload the weak hash misses is caught by the strong one.
 *
 * Run: node --test tests/dtu-protection.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";

import {
  isDtuProtected,
  stampDtuProtection,
  computeDtuContentHash,
  verifyDtuIntegrity,
  protectDtuInStore,
  unprotectDtuInStore,
  HASHED_FIELDS,
} from "../lib/dtu-protection.js";
import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";
import { runForgettingCycle, protectDTU, unprotectDTU } from "../emergent/forgetting-engine.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function archiveDtu(id, over = {}) {
  return {
    id,
    title: `Archive record ${id}`,
    tier: "regular",
    scope: "global",
    source: "system",
    tags: ["archive"],
    human: { summary: `Human-readable summary for ${id}` },
    core: { claims: ["the ledger balanced on 2026-07-26"], definitions: [], invariants: [] },
    machine: { verifier: "none", parents: [] },
    cretiHuman: `CRETI projection for ${id}`,
    lineage: { parents: [], children: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

/** The EXACT weak hash server.js computes at dtu.create (server.js ~:22961). */
function weakRuntimeHash(dtu) {
  return crypto
    .createHash("sha256")
    .update((dtu.title || "") + "\n" + (dtu.cretiHuman || ""))
    .digest("hex")
    .slice(0, 16);
}

// A DTU whose retentionScore is unambiguously BELOW the 0.15 forgetting
// threshold (mirrors tests/forgetting-engine-grace-window.test.js#weakDtu):
// ancient, never accessed, lowest tier weight, zero authority, no bonus tags.
// Deliberately source "system" so no OTHER PROTECTION_RULE (source user/
// sovereign, tier core/mega, constitutional tags) can make it survive for the
// wrong reason.
function weakDtu(id) {
  return {
    id,
    tier: "shadow",
    source: "system",
    createdAt: new Date("2000-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2000-01-01T00:00:00Z").toISOString(),
    tags: [],
    authority: { score: 0 },
    lineage: { parents: [], children: [] },
  };
}

// ── 1. The unified protection concept ───────────────────────────────────────

describe("dtu-protection — one predicate, both legacy vocabularies", () => {
  it("stamping sets BOTH flags, so both pre-existing mechanisms honor it", () => {
    const dtu = archiveDtu("d-both-flags");
    assert.equal(isDtuProtected(dtu), false, "starts unprotected");

    stampDtuProtection(dtu, { reason: "vault_admission", source: "vault" });

    // forgetting-engine.js#PROTECTION_RULES reads `_pinned`.
    assert.equal(dtu._pinned, true);
    // server.js#demoteToArchive reads `protected`.
    assert.equal(dtu.protected, true);
    assert.equal(isDtuProtected(dtu), true);
    assert.equal(dtu.protection.reason, "vault_admission");
    assert.equal(dtu.protection.source, "vault");
  });

  it("honors each legacy flag independently (the two mechanisms are unioned)", () => {
    assert.equal(isDtuProtected({ _pinned: true }), true, "forgetting-engine's flag");
    assert.equal(isDtuProtected({ protected: true }), true, "demoteToArchive's flag");
    assert.equal(isDtuProtected({ immutable: true }), true);
    assert.equal(isDtuProtected({ seedOrigin: "seed-pack" }), true);
    assert.equal(isDtuProtected({ tags: ["vault"] }), true);
    // Negative control — the predicate must not just return true.
    assert.equal(isDtuProtected({ tags: ["archive"], tier: "regular" }), false);
    assert.equal(isDtuProtected(null), false);
    assert.equal(isDtuProtected({}), false);
  });

  it("releasing a pin clears it, but never overrides immutable/seedOrigin", () => {
    const store = new Map();
    const plain = archiveDtu("d-release-plain");
    const seed = archiveDtu("d-release-seed", { seedOrigin: "seed-pack" });
    store.set(plain.id, plain);
    store.set(seed.id, seed);

    protectDtuInStore(store, plain.id);
    protectDtuInStore(store, seed.id);

    assert.equal(unprotectDtuInStore(store, plain.id).protected, false);
    assert.equal(isDtuProtected(plain), false);

    assert.equal(unprotectDtuInStore(store, seed.id).protected, true, "seed DTU stays protected");
    assert.equal(isDtuProtected(seed), true);
    // The integrity record is retained for audit rather than deleted.
    assert.equal(typeof plain.protection.contentSha256, "string");
    assert.equal(plain.protection.protected, false);
    assert.equal(typeof plain.protection.releasedAt, "string");
  });
});

// ── 2. Persistence: the pin must survive a restart ──────────────────────────

describe("dtu-protection — protection persists across a store round-trip", () => {
  let db;
  let store;
  let memoryMap;

  beforeEach(() => {
    db = new Database(":memory:");
    initDTUStore(db);
    memoryMap = new Map();
    store = createDTUStore(db, memoryMap, {});
  });

  afterEach(() => {
    try { db.close(); } catch { /* best-effort */ }
  });

  it("set → reload from SQLite → still protected (the restart case)", () => {
    const dtu = archiveDtu("d-persist");
    store.set(dtu.id, dtu);

    const r = protectDtuInStore(store, dtu.id, { reason: "vault_admission", source: "vault" });
    assert.equal(r.ok, true);
    assert.equal(r.protected, true);
    assert.match(r.contentSha256, /^[a-f0-9]{64}$/);

    // Simulate a restart: a brand-new in-memory cache rehydrated from SQLite.
    const freshMap = new Map();
    const reloaded = createDTUStore(db, freshMap, {});
    const loadStats = reloaded.rehydrateFromSQLite();
    assert.equal(loadStats.loaded, 1);

    const after = reloaded.get(dtu.id);
    assert.ok(after, "the DTU came back from SQLite");
    assert.equal(after._pinned, true, "_pinned survived the round-trip");
    assert.equal(after.protected, true, "protected survived the round-trip");
    assert.equal(isDtuProtected(after), true);
    assert.equal(after.protection.contentSha256, r.contentSha256, "the integrity anchor survived too");
    assert.equal(verifyDtuIntegrity(after).verified, true, "and still verifies after the round-trip");
  });

  it("NEGATIVE CONTROL: an in-memory-only mutation does NOT reach SQLite", () => {
    // This is precisely the old protectDTU() bug — mutate the object, never
    // call set(). Pinned here so a regression is visible as a behaviour change,
    // not as a silent loss on the next restart.
    const dtu = archiveDtu("d-memory-only");
    store.set(dtu.id, dtu);
    dtu._pinned = true; // mutate WITHOUT store.set()

    const freshMap = new Map();
    const reloaded = createDTUStore(db, freshMap, {});
    reloaded.rehydrateFromSQLite();

    const after = reloaded.get(dtu.id);
    assert.ok(after);
    assert.notEqual(after._pinned, true, "the un-persisted pin is gone — this is what protectDtuInStore fixes");
    assert.equal(isDtuProtected(after), false);
  });

  it("forgetting-engine#protectDTU now persists through STATE.dtus.set()", () => {
    const dtu = archiveDtu("d-engine-persist");
    store.set(dtu.id, dtu);
    // The engine reads STATE off globalThis.
    globalThis._concordSTATE = { dtus: store };
    try {
      const r = protectDTU(dtu.id);
      assert.equal(r.ok, true);
      assert.equal(r.persisted, true);

      const freshMap = new Map();
      const reloaded = createDTUStore(db, freshMap, {});
      reloaded.rehydrateFromSQLite();
      assert.equal(isDtuProtected(reloaded.get(dtu.id)), true, "pin survives a restart");

      const u = unprotectDTU(dtu.id);
      assert.equal(u.ok, true);
      assert.equal(u.stillProtected, false);

      const freshMap2 = new Map();
      const reloaded2 = createDTUStore(db, freshMap2, {});
      reloaded2.rehydrateFromSQLite();
      assert.equal(isDtuProtected(reloaded2.get(dtu.id)), false, "release persists too");
    } finally {
      delete globalThis._concordSTATE;
    }
  });
});

// ── 3. Integrity: strong hash vs the weak runtime hash ──────────────────────

describe("dtu-protection — full-payload hash catches tampering the weak hash misses", () => {
  it("a core/machine/tags edit is INVISIBLE to the weak runtime hash", () => {
    const dtu = archiveDtu("d-weak-blind");
    const weakBefore = weakRuntimeHash(dtu);
    const strongBefore = computeDtuContentHash(dtu);

    // Tamper with the actual claim content. Title + cretiHuman are untouched,
    // which is the entire input to the runtime hash.
    dtu.core.claims[0] = "the ledger did NOT balance on 2026-07-26";
    dtu.tags.push("verified");
    dtu.machine.verifier = "forged";

    assert.equal(weakRuntimeHash(dtu), weakBefore, "weak hash is blind to the tamper");
    assert.notEqual(computeDtuContentHash(dtu), strongBefore, "strong hash detects it");
    assert.match(strongBefore, /^[a-f0-9]{64}$/, "full SHA-256, not a 16-hex truncation");
    assert.equal(weakBefore.length, 16, "the weak runtime hash really is 64-bit-truncated");
  });

  it("verifyDtuIntegrity fails on a tampered protected record and passes on an intact one", () => {
    const intact = archiveDtu("d-intact");
    stampDtuProtection(intact);
    const v1 = verifyDtuIntegrity(intact);
    assert.equal(v1.ok, true);
    assert.equal(v1.verified, true);
    assert.equal(v1.provenance.match, true, "the stamped provenance assertion verifies too");

    const tampered = archiveDtu("d-tampered");
    stampDtuProtection(tampered);
    tampered.core.claims[0] = "rewritten after the fact";
    const v2 = verifyDtuIntegrity(tampered);
    assert.equal(v2.verified, false, "tamper detected");
    assert.equal(v2.provenance.match, false);
    assert.notEqual(v2.actual, v2.expected);

    // An unprotected DTU has no anchor to verify against — honest failure,
    // not a fabricated pass.
    const bare = archiveDtu("d-bare");
    assert.deepEqual(verifyDtuIntegrity(bare), { ok: false, verified: false, reason: "not_protected" });
  });

  it("STATED LIMIT: placement/bookkeeping fields are outside the hash", () => {
    // tier/scope/lineage/updatedAt are rewritten by non-tampering system paths
    // (applyAbstractionPlacement, enforceTierBudgets, forgetDTU's reparenting),
    // so covering them would produce false alarms. Documented, not accidental.
    const dtu = archiveDtu("d-limits");
    stampDtuProtection(dtu);
    dtu.tier = "regular";
    dtu.scope = "local";
    dtu.updatedAt = new Date(Date.now() + 60_000).toISOString();
    dtu.lineage.children.push("some-consolidation-id");
    assert.equal(verifyDtuIntegrity(dtu).verified, true, "placement churn is not a tamper");

    for (const f of ["tier", "scope", "lineage", "updatedAt", "hash", "meta"]) {
      assert.equal(HASHED_FIELDS.includes(f), false, `${f} is intentionally uncovered`);
    }
    for (const f of ["title", "core", "machine", "tags", "human"]) {
      assert.equal(HASHED_FIELDS.includes(f), true, `${f} must be covered`);
    }
  });
});

// ── 4. The forgetting cycle honors the unified protection ───────────────────

describe("forgetting-engine — protected DTUs survive the cycle, unprotected ones don't", () => {
  let STATE;

  beforeEach(() => {
    STATE = { dtus: new Map() };
    globalThis._concordSTATE = STATE;
  });

  afterEach(() => {
    delete globalThis._concordSTATE;
  });

  it("BOTH DIRECTIONS: the protected one is never tombstoned, the identical unprotected one is", async () => {
    const keep = weakDtu("d-forget-protected");
    const drop = weakDtu("d-forget-unprotected");
    STATE.dtus.set(keep.id, keep);
    STATE.dtus.set(drop.id, drop);

    protectDtuInStore(STATE.dtus, keep.id, { reason: "vault_admission", source: "vault" });

    // Enough real cycles to clear the GRACE_CYCLES (3) second-chance window.
    for (let i = 0; i < 6; i++) await runForgettingCycle(false);

    assert.ok(STATE.dtus.has(keep.id), "the protected DTU survived");
    assert.ok(!STATE.dtus.has(`tomb_${keep.id}`), "and was never tombstoned");
    assert.ok(!STATE.dtus.has(drop.id), "the identical UNPROTECTED DTU was forgotten");
    assert.ok(STATE.dtus.has(`tomb_${drop.id}`), "and left a tombstone");
  });
});

// ── 5. evolution.dedupe — the real macro, both directions ───────────────────
//
// Boots server.js once, in-memory (CONCORD_NO_LISTEN, throwaway DB + STATE
// path — no port is bound), so this exercises the ACTUAL registered macro
// rather than a re-implementation of its loop.

describe("evolution.dedupe — the hard-delete path now checks protection", () => {
  let runMacro;
  let STATE;
  let ctx;
  let originalDtus;

  before(async () => {
    ({ runMacro, STATE, ctx } = await (await import("./depth/_harness.js")).macroRuntime("dtu-protection"));
  });

  // The macro sweeps EVERY DTU in STATE (~2,000 after a normal boot), so each
  // test swaps in an isolated store for the duration: deterministic pairs, no
  // O(n²) sweep over unrelated boot content, and the boot corpus is left
  // untouched. The macro itself is entirely unmodified by this — it reads
  // STATE.dtus exactly as it does in production.
  beforeEach(() => {
    originalDtus = STATE.dtus;
    STATE.dtus = new Map();
  });

  afterEach(() => {
    STATE.dtus = originalDtus;
  });

  // Two DTUs whose title tokens overlap 9/10 = 0.90 jaccard — above the 0.86
  // default threshold.
  //
  // `lineage: []` (an ARRAY) is deliberate and load-bearing: the macro does
  // `[...(a.lineage || [])]`, so a keeper carrying the OTHER common lineage
  // shape — the `{parents, children}` object — makes it throw
  // ("(a.lineage || []) is not iterable") BEFORE reaching its delete. That is a
  // real pre-existing bug, reported separately and deliberately NOT fixed here
  // (fixing it would make a hard-delete path MORE live, which is not this
  // unit's job). The array shape is the one that genuinely reaches the delete
  // in production — e.g. `synth.combine` assigns `dtu.lineage = ids.map(...)`,
  // and an absent lineage also lands in this branch — so it is the shape the
  // protection guard has to hold for.
  function nearDupPair(nonce) {
    const base = `${nonce} alpha beta gamma delta epsilon zeta eta theta`;
    const a = archiveDtu(`${nonce}-a`, { title: base, tags: [], lineage: [] });
    const b = archiveDtu(`${nonce}-b`, { title: `${base} iota`, tags: [], lineage: [] });
    return [a, b];
  }

  it("DIRECTION 1 (negative control): unprotected near-duplicates still merge", async () => {
    const [a, b] = nearDupPair("zqx1");
    STATE.dtus.set(a.id, a);
    STATE.dtus.set(b.id, b);

    const r = await runMacro("evolution", "dedupe", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.merged, 1, "the sweep really did merge — the guard is not a blanket block");
    assert.equal(r.skippedProtected, 0);

    assert.ok(STATE.dtus.has(a.id), "the keeper survives");
    assert.equal(STATE.dtus.has(b.id), false, "the unprotected near-duplicate was merged away");
    assert.ok(a.lineage.includes(b.id), "lineage of the merged DTU was preserved on the keeper");
  });

  it("DIRECTION 2: a protected near-duplicate is NOT deleted", async () => {
    const [a, b] = nearDupPair("zqx2");
    STATE.dtus.set(a.id, a);
    STATE.dtus.set(b.id, b);
    protectDtuInStore(STATE.dtus, b.id, { reason: "vault_admission", source: "vault" });

    const r = await runMacro("evolution", "dedupe", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.merged, 0, "nothing was deleted");
    assert.ok(r.skippedProtected >= 1, `expected a skipped pair, got ${r.skippedProtected}`);

    assert.ok(STATE.dtus.has(b.id), "the protected DTU survived the dedupe sweep");
    assert.ok(STATE.dtus.has(a.id), "and so did its near-duplicate");
    assert.equal(verifyDtuIntegrity(STATE.dtus.get(b.id)).verified, true, "and was not mutated");
  });

  it("DIRECTION 3: a protected KEEPER is not mutated either", async () => {
    const [a, b] = nearDupPair("zqx3");
    STATE.dtus.set(a.id, a);
    STATE.dtus.set(b.id, b);
    protectDtuInStore(STATE.dtus, a.id, { reason: "vault_admission", source: "vault" });

    const r = await runMacro("evolution", "dedupe", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.merged, 0, "nothing was deleted");
    assert.ok(r.skippedProtected >= 1, `expected a skipped pair, got ${r.skippedProtected}`);

    assert.ok(STATE.dtus.has(a.id), "protected keeper survives");
    assert.ok(STATE.dtus.has(b.id), "its pair is left alone rather than folded into an immutable record");
    assert.equal(a.tags.includes("deduped"), false, "the protected keeper's tags were not rewritten");
    assert.equal(verifyDtuIntegrity(a).verified, true, "the protected keeper still verifies");
  });
});
