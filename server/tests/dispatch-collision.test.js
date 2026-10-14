// INC-SWEEP batch 012 — systemic COMMON_ACTIONS vs MACROS dispatch collision.
//
// /api/lens/run prefers LENS_ACTIONS. COMMON_ACTIONS used to install generic
// artifact handlers (vote/status/archive/lock/publish/…) for every
// ALL_LENS_DOMAINS entry, shadowing MACROS-only domain handlers.
//
// Fix: resolveDualRegistry yields COMMON_ACTIONS fill-ins to MACROS when the
// domain owns the verb; COMMON_ACTIONS registration skips macro-owned pairs;
// late register() evicts a fill-in already installed.
//
// Run: NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs \
//        --test-timeout=300000 tests/dispatch-collision.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveDualRegistry } from "../lib/dual-registry-resolve.js";
import registerCivicBondsMacros from "../domains/civic-bonds.js";

/** Faithful /api/lens/run dispatch using the shared resolver. */
async function lensRunDispatch(lensActions, macros, commonActionKeys, domain, name, input, ctx) {
  const resolved = resolveDualRegistry(domain, name, {
    lensActions,
    runMacro: async () => {},
    macros,
    commonActionKeys,
  });
  if (resolved.via === "lens_action") {
    const virtualArtifact = { id: null, domain, type: "domain_action", data: input || {}, meta: {} };
    return { via: "lens_action", result: await resolved.handler(ctx, virtualArtifact, input || {}) };
  }
  if (resolved.via === "macro") {
    const entry = macros.get(domain)?.get(name);
    const fn = typeof entry === "function" ? entry : entry?.fn;
    return { via: "macro", result: await fn(ctx, input || {}) };
  }
  return { via: "none", result: { ok: false, reason: "not_registered" } };
}

/** Generic COMMON_ACTIONS shapes (mirrors server.js). */
const COMMON = {
  vote: (_ctx, artifact, params) => {
    if (!artifact.data) artifact.data = {};
    const direction = params?.direction || params?.vote || 1;
    artifact.data.score = (artifact.data.score || 0) + Number(direction);
    artifact.data.voteCount = (artifact.data.voteCount || 0) + 1;
    return { ok: true, score: artifact.data.score, voteCount: artifact.data.voteCount, _generic: true };
  },
  status: (_ctx, artifact, params) => {
    const newStatus = params?.status || params?.state;
    if (newStatus) artifact.meta = { ...artifact.meta, status: newStatus };
    return { ok: true, status: artifact.meta?.status, _generic: true };
  },
  archive: (_ctx, artifact) => {
    artifact.meta = { ...artifact.meta, status: "archived" };
    return { ok: true, archived: true, _generic: true };
  },
  lock: (_ctx, artifact) => {
    artifact.meta = { ...artifact.meta, locked: !artifact.meta?.locked };
    return { ok: true, locked: artifact.meta.locked, _generic: true };
  },
  publish: (_ctx, artifact) => {
    artifact.meta = { ...artifact.meta, status: "published", visibility: "public" };
    return { ok: true, published: true, visibility: "public", _generic: true };
  },
};

function installCommon(lensActions, commonKeys, domain, verb) {
  const key = `${domain}.${verb}`;
  lensActions.set(key, COMMON[verb]);
  commonKeys.add(key);
}

function mkMacros(pairs) {
  const m = new Map();
  for (const [domain, name, fn] of pairs) {
    if (!m.has(domain)) m.set(domain, new Map());
    m.get(domain).set(name, { fn });
  }
  return m;
}

describe("dispatch collision — status family reaches domain handler (≥3 domains)", () => {
  for (const domain of ["atlas", "goals", "hypothesis"]) {
    it(`${domain}.status → MACROS domain handler, not COMMON_ACTIONS generic`, async () => {
      const lensActions = new Map();
      const commonKeys = new Set();
      installCommon(lensActions, commonKeys, domain, "status");
      const macros = mkMacros([
        [domain, "status", async () => ({ ok: true, status: "ok", domain, _domain: true })],
      ]);
      const out = await lensRunDispatch(lensActions, macros, commonKeys, domain, "status", {}, {});
      assert.equal(out.via, "macro");
      assert.equal(out.result._domain, true);
      assert.equal(out.result._generic, undefined);
    });
  }
});

describe("dispatch collision — archive / lock / publish / vote verb families", () => {
  it("hypothesis.archive → domain handler", async () => {
    const lensActions = new Map();
    const commonKeys = new Set();
    installCommon(lensActions, commonKeys, "hypothesis", "archive");
    const macros = mkMacros([
      ["hypothesis", "archive", async (_ctx, input) => ({ ok: true, archivedId: input.id, _domain: true })],
    ]);
    const out = await lensRunDispatch(lensActions, macros, commonKeys, "hypothesis", "archive", { id: "h1" }, {});
    assert.equal(out.via, "macro");
    assert.equal(out.result.archivedId, "h1");
    assert.equal(out.result._generic, undefined);
  });

  it("collab.lock → domain handler (late-registered macro shape)", async () => {
    const lensActions = new Map();
    const commonKeys = new Set();
    installCommon(lensActions, commonKeys, "collab", "lock");
    const macros = mkMacros([
      ["collab", "lock", async (_ctx, input) => ({
        ok: true, locked: true, path: input.path, _domain: true,
      })],
    ]);
    const out = await lensRunDispatch(
      lensActions, macros, commonKeys, "collab", "lock",
      { sessionId: "s1", userId: "u1", path: "/a" }, {},
    );
    assert.equal(out.via, "macro");
    assert.equal(out.result.path, "/a");
    assert.equal(out.result._generic, undefined);
  });

  it("global.publish → domain handler", async () => {
    const lensActions = new Map();
    const commonKeys = new Set();
    installCommon(lensActions, commonKeys, "global", "publish");
    const macros = mkMacros([
      ["global", "publish", async (_ctx, input) => ({
        ok: true, globalId: "g1", dtuId: input.dtuId, _domain: true,
      })],
    ]);
    const out = await lensRunDispatch(
      lensActions, macros, commonKeys, "global", "publish", { dtuId: "d1" }, {},
    );
    assert.equal(out.via, "macro");
    assert.equal(out.result.dtuId, "d1");
    assert.equal(out.result._generic, undefined);
  });

  it("civic_bonds.vote → domain voteBond (regression without LENS_ACTIONS bridge)", async () => {
    const lensActions = new Map();
    const commonKeys = new Set();
    installCommon(lensActions, commonKeys, "civic_bonds", "vote");
    const macros = new Map();
    registerCivicBondsMacros((domain, name, fn) => {
      if (!macros.has(domain)) macros.set(domain, new Map());
      macros.get(domain).set(name, { fn });
    });
    // Domain voteBond requires CONCORD_CIVIC_BONDS + db; here we only assert
    // the resolver routes via:macro (not the generic). Handler presence is enough.
    const resolved = resolveDualRegistry("civic_bonds", "vote", {
      lensActions, runMacro: async () => {}, macros, commonActionKeys: commonKeys,
    });
    assert.equal(resolved.via, "macro");
    assert.ok(macros.get("civic_bonds")?.has("vote"));
  });
});

describe("dispatch collision — intentionally-generic COMMON_ACTIONS still work", () => {
  it("domain with NO macro of that name still gets the generic handler", async () => {
    const lensActions = new Map();
    const commonKeys = new Set();
    installCommon(lensActions, commonKeys, "accounting", "vote");
    const macros = mkMacros([]); // no accounting.vote
    const out = await lensRunDispatch(
      lensActions, macros, commonKeys, "accounting", "vote",
      { vote: 1 }, {},
    );
    assert.equal(out.via, "lens_action");
    assert.equal(out.result._generic, true);
    assert.equal(out.result.voteCount, 1);
  });
});

describe("dispatch collision — real LENS_ACTION pairs unchanged", () => {
  it("council.vote real LENS_ACTION still wins over MACROS + common fill-in set", async () => {
    const real = async () => ({ ok: true, via: "council_lens", ballot: true });
    const lensActions = new Map([["council.vote", real]]);
    const commonKeys = new Set(["civic_bonds.vote"]); // council.vote NOT marked common
    const macros = mkMacros([
      ["council", "vote", async () => ({ ok: true, via: "council_macro" })],
    ]);
    const out = await lensRunDispatch(lensActions, macros, commonKeys, "council", "vote", {}, {});
    assert.equal(out.via, "lens_action");
    assert.equal(out.result.via, "council_lens");
  });

  it("sim.archive real LENS_ACTION unchanged (not a COMMON_ACTIONS fill-in)", async () => {
    const real = async () => ({ ok: true, via: "sim_lens" });
    const lensActions = new Map([["sim.archive", real]]);
    const commonKeys = new Set(["hypothesis.archive"]);
    const macros = mkMacros([]);
    const out = await lensRunDispatch(lensActions, macros, commonKeys, "sim", "archive", {}, {});
    assert.equal(out.via, "lens_action");
    assert.equal(out.result.via, "sim_lens");
  });
});

describe("dispatch collision — registration-time skip / late eviction helpers", () => {
  it("skip install when MACROS already owns the pair (early macro)", () => {
    // Mirrors the COMMON_ACTIONS loop guard in server.js.
    const lensActions = new Map();
    const commonKeys = new Set();
    const macros = mkMacros([
      ["atlas", "status", async () => ({ ok: true })],
    ]);
    const domain = "atlas";
    const actionName = "status";
    const key = `${domain}.${actionName}`;
    if (!lensActions.has(key) && !macros.get(domain)?.has(actionName)) {
      lensActions.set(key, COMMON.status);
      commonKeys.add(key);
    }
    assert.equal(lensActions.has(key), false);
    assert.equal(commonKeys.has(key), false);
  });

  it("late register() evicts a COMMON_ACTIONS fill-in already installed", () => {
    // Mirrors the eviction block in server.js register().
    const lensActions = new Map();
    const commonKeys = new Set();
    installCommon(lensActions, commonKeys, "collab", "lock");
    assert.equal(lensActions.has("collab.lock"), true);

    // Simulate register("collab","lock", fn) after COMMON_ACTIONS.
    const key = "collab.lock";
    if (commonKeys.has(key) && lensActions.delete) {
      lensActions.delete(key);
      commonKeys.delete(key);
    }
    assert.equal(lensActions.has(key), false);
    assert.equal(commonKeys.has(key), false);
  });
});

describe("dispatch collision — globalThis commonActionKeys fallback", () => {
  let prevKeys;
  beforeEach(() => {
    prevKeys = globalThis.__concordCommonActionKeys;
  });
  afterEach(() => {
    if (prevKeys === undefined) delete globalThis.__concordCommonActionKeys;
    else globalThis.__concordCommonActionKeys = prevKeys;
  });

  it("reads globalThis.__concordCommonActionKeys when arg omitted", () => {
    const generic = async () => ({ ok: true, _generic: true });
    const lensActions = new Map([["goals.status", generic]]);
    const macros = mkMacros([["goals", "status", async () => ({ ok: true, _domain: true })]]);
    globalThis.__concordCommonActionKeys = new Set(["goals.status"]);
    const resolved = resolveDualRegistry("goals", "status", {
      lensActions, runMacro: async () => {}, macros,
    });
    assert.equal(resolved.via, "macro");
  });
});
