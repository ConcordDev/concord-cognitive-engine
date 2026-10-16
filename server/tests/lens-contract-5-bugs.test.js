// server/tests/lens-contract-5-bugs.test.js
//
// Focused gate for the fix/lens-contract-5-bugs sweep. Five verified server
// bugs where a bad input crashed (500), hung (~30s), or surfaced a
// fabricated "lens_failed". Each must now come back as a clean
// { ok:false, error } (400 / 409 / 503) — never a throw.
//
//   1. POST /api/courtship/interact — route validation extracted into
//      lib/lens-contract-guards.js#validateCourtshipInteraction (unit-tested
//      here against the REAL romance-engine + migration 206 CHECK, which is
//      what used to throw).
//   2. POST /api/dreams/start — bounded via guards#withTimeout (10s) + a
//      409 when a cycle is already running; the timeout rejection shape
//      (timedOut flag) is unit-tested here.
//   3. masonry proposal-create — lineItems validated (non-empty array of
//      objects) before priceProposal; priceProposal itself is now
//      Array.isArray-defensive.
//   4. POST /api/substrate/import — body handling extracted into
//      guards#parseSubstrateImportBody (Buffer gzip / {data: base64} /
//      {dtus:[...]}); everything else is a 400.
//   5. inference kb-add — unparseable lines collect into result.errors and
//      a top-level error ("could not parse rule: ..."), so the lens runner
//      no longer fabricates "lens_failed" (pinned via shapeLensRunHttp).
//
// Hermetic: fake registerLensAction harness (mirrors the /api/lens/run
// dispatch), in-memory better-sqlite3, node builtins only.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import registerMasonryActions from "../domains/masonry.js";
import registerInferenceActions from "../domains/inference.js";
import { courtInteraction } from "../lib/romance-engine.js";
import { up as upRomance } from "../migrations/206_romance.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import {
  validateCourtshipInteraction,
  withTimeout,
  parseSubstrateImportBody,
} from "../lib/lens-contract-guards.js";

// ── Harness ─────────────────────────────────────────────────────────────────

const MASON = new Map();
const INFERENCE = new Map();
function registerMason(domain, name, fn) {
  assert.equal(domain, "masonry", `unexpected domain: ${domain}`);
  MASON.set(name, fn);
}
function registerInference(domain, name, fn) {
  assert.equal(domain, "inference", `unexpected domain: ${domain}`);
  INFERENCE.set(name, fn);
}

before(() => {
  registerMasonryActions(registerMason);
  registerInferenceActions(registerInference);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

function callMason(name, ctx, params = {}) {
  const fn = MASON.get(name);
  if (!fn) throw new Error(`masonry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function callInference(name, ctx, params = {}) {
  const fn = INFERENCE.get(name);
  if (!fn) throw new Error(`inference.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

// ── Bug 1: courtship/interact ────────────────────────────────────────────────

describe("bug 1 — courtship/interact input guard", () => {
  const goodBody = { partnerKind: "npc", partnerId: "npc_lyra", sentiment: 1 };

  it("passes a valid body through with trimmed ids and clamped-range sentiment", () => {
    const g = validateCourtshipInteraction(goodBody);
    assert.equal(g.ok, true);
    assert.equal(g.partnerKind, "npc");
    assert.equal(g.partnerId, "npc_lyra");
    assert.equal(g.sentiment, 1);
  });

  it("defaults an absent sentiment to 1 but preserves sentiment 0", () => {
    assert.equal(validateCourtshipInteraction({ partnerKind: "player", partnerId: "u2" }).sentiment, 1);
    const zero = validateCourtshipInteraction({ partnerKind: "player", partnerId: "u2", sentiment: 0 });
    assert.equal(zero.ok, true);
    assert.equal(zero.sentiment, 0);
  });

  it("rejects missing / invalid partnerKind", () => {
    for (const bad of [undefined, null, "", "dragon", 123, { kind: "npc" }]) {
      const g = validateCourtshipInteraction({ ...goodBody, partnerKind: bad });
      assert.equal(g.ok, false, `partnerKind ${JSON.stringify(bad)} must be rejected`);
      assert.match(g.error, /partnerKind must be 'player' or 'npc'/);
    }
  });

  it("rejects missing / non-string, non-numeric partnerId", () => {
    for (const bad of [undefined, null, "", "   ", NaN, { id: "x" }]) {
      const g = validateCourtshipInteraction({ ...goodBody, partnerId: bad });
      assert.equal(g.ok, false, `partnerId ${JSON.stringify(bad)} must be rejected`);
      assert.match(g.error, /partnerId must be a non-empty string/);
    }
  });

  it("rejects a non-numeric / non-finite sentiment", () => {
    for (const bad of ["high", "0.5", NaN, Infinity, { a: 1 }, [1]]) {
      const g = validateCourtshipInteraction({ ...goodBody, sentiment: bad });
      assert.equal(g.ok, false, `sentiment ${JSON.stringify(bad)} must be rejected`);
      assert.match(g.error, /sentiment must be a finite number/);
    }
  });

  it("every guard rejection is an input the real engine would throw on", () => {
    // Proof the guard is load-bearing: these exact shapes reach sqlite and
    // throw (CHECK constraint / better-sqlite3 bind) — the 500s being fixed.
    const db = new Database(":memory:");
    upRomance(db);
    assert.throws(() => courtInteraction(db, "u1", "dragon", "npc_lyra", 1), /CHECK/i);
    assert.throws(() => courtInteraction(db, "u1", undefined, "npc_lyra", 1));
    for (const badBody of [
      { partnerKind: "dragon", partnerId: "npc_lyra", sentiment: 1 },
      { partnerId: "npc_lyra", sentiment: 1 },
      { partnerKind: "npc", sentiment: 1 },
    ]) {
      assert.equal(validateCourtshipInteraction(badBody).ok, false);
    }
  });

  it("a guard-passing body is accepted by the real engine", () => {
    const db = new Database(":memory:");
    upRomance(db);
    const g = validateCourtshipInteraction({ partnerKind: "npc", partnerId: "npc_lyra" });
    assert.equal(g.ok, true);
    const r = courtInteraction(db, "u1", g.partnerKind, g.partnerId, g.sentiment);
    assert.equal(r.ok, true);
    assert.equal(r.status, "acquainted");
    assert.equal(r.new, true);
  });
});

// ── Bug 2: dreams/start bounded wait ──────────────────────────────────────────

describe("bug 2 — dreams/start timeout helper", () => {
  it("passes a fast resolution straight through", async () => {
    assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "dream cycle timed out"), "ok");
  });

  it("rejects a hanging promise with {timedOut:true} and the configured message", async () => {
    await assert.rejects(
      withTimeout(new Promise(() => {}), 25, "dream cycle timed out"),
      (e) => e instanceof Error && e.timedOut === true && e.message === "dream cycle timed out"
    );
  });

  it("propagates a real failure (LLM unavailable) untouched — not a timeout", async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error("llm unavailable")), 1000, "dream cycle timed out"),
      (e) => e.message === "llm unavailable" && !e.timedOut
    );
  });
});

// ── Bug 3: masonry proposal-create lineItems ─────────────────────────────────

describe("bug 3 — masonry proposal-create lineItems validation", () => {
  const ctx = { actor: { userId: "mason_a" } };

  it("returns {ok:false, 'lineItems must be a non-empty array'} instead of crashing on a non-array", () => {
    for (const bad of [undefined, null, "brick", 42, { 0: "x", length: 1 }]) {
      const r = callMason("proposal-create", ctx, { client: "Jane", lineItems: bad });
      assert.equal(r.ok, false, `lineItems ${JSON.stringify(bad)} must be rejected`);
      assert.equal(r.error, "lineItems must be a non-empty array");
    }
  });

  it("rejects an empty array and non-object items", () => {
    for (const bad of [[], [null], ["Brick"], [5]]) {
      const r = callMason("proposal-create", ctx, { client: "Jane", lineItems: bad });
      assert.equal(r.ok, false, `lineItems ${JSON.stringify(bad)} must be rejected`);
      assert.equal(r.error, "lineItems must be a non-empty array");
    }
  });

  it("rejects items without a string description and numeric quantity/unitCost", () => {
    for (const bad of [
      [{ description: 5, quantity: 1, unitCost: 1 }],
      [{ quantity: 1, unitCost: 1 }],
      [{ description: "Brick" }],
      [{ description: "Brick", unitCost: 1 }],
      [{ description: "Brick", quantity: 1 }],
      [{ description: "Brick", quantity: null, unitCost: 1 }],
      [{ description: "Brick", quantity: "abc", unitCost: 1 }],
      [{ description: "Brick", quantity: 1, unitCost: NaN }],
    ]) {
      const r = callMason("proposal-create", ctx, { client: "Jane", lineItems: bad });
      assert.equal(r.ok, false, `lineItems ${JSON.stringify(bad)} must be rejected`);
      assert.ok(r.error, "rejection carries an error message");
    }
  });

  it("accepts numeric strings and the name fallback, and prices a real proposal", () => {
    const r = callMason("proposal-create", ctx, {
      client: "Jane Doe", projectTitle: "Patio", marginPct: 20, taxPct: 8,
      lineItems: [{ description: "Brick", unit: "each", quantity: 500, unitCost: 0.75 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 375);
    assert.ok(r.result.total > r.result.subtotal);

    const lenient = callMason("proposal-create", ctx, {
      client: "C",
      lineItems: [{ name: "Block", quantity: "2", unitCost: "1.5" }],
    });
    assert.equal(lenient.ok, true);
    assert.equal(lenient.result.lines[0].lineTotal, 3);
  });
});

// ── Bug 4: substrate/import body parsing ─────────────────────────────────────

describe("bug 4 — substrate/import body guard", () => {
  const substrate = { version: "1.0", userId: "src_user", dtus: [{ id: "d1", title: "T" }] };
  const gz = gzipSync(Buffer.from(JSON.stringify(substrate)));

  it("accepts a raw gzipped Buffer", () => {
    const r = parseSubstrateImportBody(Buffer.from(gz));
    assert.equal(r.ok, true);
    assert.equal(r.dtus.length, 1);
    assert.equal(r.dtus[0].id, "d1");
    assert.equal(r.sourceUserId, "src_user");
  });

  it("accepts a {data:'<base64 gzip>'} field", () => {
    const r = parseSubstrateImportBody({ data: gz.toString("base64") });
    assert.equal(r.ok, true);
    assert.equal(r.dtus.length, 1);
    assert.equal(r.sourceUserId, "src_user");
  });

  it("accepts a plain JSON object with a dtus array directly", () => {
    const r = parseSubstrateImportBody({ dtus: [{ id: "a" }, { id: "b" }] });
    assert.equal(r.ok, true);
    assert.equal(r.dtus.length, 2);
    assert.equal(r.sourceUserId, null);
  });

  it("rejects bad gzip with a clear error, not a crash", () => {
    for (const bad of [Buffer.from("this is not gzip"), { data: "!!!not-gzip!!!" }]) {
      const r = parseSubstrateImportBody(bad);
      assert.equal(r.ok, false);
      assert.match(r.error, /invalid gzip substrate/);
    }
  });

  it("rejects gzip whose payload is not JSON", () => {
    const r = parseSubstrateImportBody(gzipSync(Buffer.from("not json at all")));
    assert.equal(r.ok, false);
    assert.match(r.error, /substrate is not valid JSON/);
  });

  it("rejects everything else with the expected-error contract", () => {
    for (const bad of [
      undefined, null, "a bare string", 42, [],
      {},                       // parsed JSON object without dtus/data
      { foo: 1 },
      { data: "" },
      { dtus: "abc" },          // dtus present but not an array
    ]) {
      const r = parseSubstrateImportBody(bad);
      assert.equal(r.ok, false, `body ${JSON.stringify(bad ?? null)} must be rejected`);
      assert.equal(r.error, "expected gzipped substrate or {dtus:[...]}");
    }
  });

  it("rejects a dtus array containing non-objects", () => {
    for (const bad of [["x"], [null], [{ id: "ok", extra: "fine" }, 42]]) {
      const r = parseSubstrateImportBody({ dtus: bad });
      assert.equal(r.ok, false, `dtus ${JSON.stringify(bad)} must be rejected`);
      assert.match(r.error, /substrate\.dtus must be an array of objects/);
    }
  });
});

// ── Bug 5: inference kb-add parse errors ─────────────────────────────────────

describe("bug 5 — inference kb-add surfaces parse errors", () => {
  const ctx = { actor: { userId: "user_kb" }, userId: "user_kb" };

  it("the repro text returns {ok:false, error:'could not parse rule: ...'} — not lens_failed", () => {
    const out = callInference("kb-add", ctx, { text: "lc-abc body text", title: "x" });
    assert.equal(out.ok, false);
    assert.match(out.error, /^could not parse rule: cannot parse atom "lc-abc body text"$/);
    assert.equal(out.result.addedCount, 0);
    assert.equal(out.result.errorCount, 1);
    assert.equal(out.result.errors[0].line, "lc-abc body text");

    // Pin the original symptom end-to-end: the HTTP envelope must carry the
    // real reason, not the fabricated "lens_failed".
    const shaped = shapeLensRunHttp(out);
    assert.equal(shaped.status, 400);
    assert.match(shaped.body.error, /could not parse rule/);
    assert.notEqual(shaped.body.error, "lens_failed");
  });

  it("collects every unparseable line and stays ok:false when nothing was added", () => {
    const out = callInference("kb-add", ctx, { text: "garbage one\ngarbage two line" });
    assert.equal(out.ok, false);
    assert.equal(out.result.errorCount, 2);
    assert.match(out.error, /could not parse rule: .*; /);
  });

  it("mixed input: something added stays ok:true with the bad lines in result.errors", () => {
    const out = callInference("kb-add", ctx, { text: "likes(alice,bob)\nlc-abc body text" });
    assert.equal(out.ok, true);
    assert.equal(out.result.addedCount, 1);
    assert.equal(out.result.errorCount, 1);
    assert.equal(out.error, undefined);
    assert.equal(shapeLensRunHttp(out).status, 200);
  });

  it("valid facts and rules still add cleanly", () => {
    const out = callInference("kb-add", ctx, {
      text: "likes(alice,bob)\ngrandparent(?X,?Z) :- parent(?X,?Y), parent(?Y,?Z)",
    });
    assert.equal(out.ok, true);
    assert.equal(out.result.addedCount, 2);
    assert.equal(out.result.errorCount, 0);
  });

  it("facts with variables and duplicates land in errors, not a crash", () => {
    callInference("kb-add", ctx, { text: "likes(alice,bob)" });
    const out = callInference("kb-add", ctx, { text: "likes(?X,bob)\nlikes(alice,bob)" });
    assert.equal(out.ok, false);
    assert.equal(out.result.errorCount, 2);
    assert.match(out.error, /facts cannot contain variables/);
    assert.match(out.error, /duplicate fact/);
  });

  it("empty / non-string text is a clear refusal, never a throw", () => {
    const empty = callInference("kb-add", ctx, { text: "" });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "no input lines");

    const numeric = callInference("kb-add", ctx, { text: 42 });
    assert.equal(numeric.ok, false);
    assert.match(numeric.error, /could not parse rule/);
  });
});
// Supervisor addition: numeric NPC ids (NPCActionMenu sends menu.npcId) stay valid.
import { validateCourtshipInteraction as _vci } from "../lib/lens-contract-guards.js";
import _test from "node:test";
import _assert from "node:assert/strict";
_test("courtship guard accepts a numeric npc partnerId as a string", () => {
  const g = _vci({ partnerKind: "npc", partnerId: 42 });
  _assert.equal(g.ok, true);
  _assert.equal(g.partnerId, "42");
});
