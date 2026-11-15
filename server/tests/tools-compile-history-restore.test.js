// FIX-tools-006 — compile history entries must be restorable.
//
// The ticket: "Compile build history: clicking entry doesn't restore
// source; history lost on reload." The restore half was structural —
// tools.compile recorded only sizes and timings, never the source, so
// no click could ever bring the editor back. This suite pins the fix:
// a history entry carries the source it compiled (bounded, with an
// honest truncation flag) plus the settings it ran with, and both
// survive the lens-state serialize/hydrate round-trip a restart makes.
//
// Hermetic: no server boot, no network. compile runs on its
// deterministic strip-types fallback (esbuild is not a server dep).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerToolsMacros from "../domains/tools.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "tools", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`tools.${name} not registered`);
  return await fn(ctx, input);
}

before(() => { registerToolsMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("tools compile history — restore (FIX-tools-006)", () => {
  it("records the source and settings on each history entry", async () => {
    const src = "interface B { x: string }\nconst b: B = { x: \"y\" };\nexport default b;";
    const r = await call("compile", ctxA, { source: src, loader: "ts", target: "es2020", format: "cjs", sourcemap: true });
    assert.equal(r.ok, true);
    const h = await call("compile-history", ctxA, {});
    assert.equal(h.result.total, 1);
    const entry = h.result.history[0];
    assert.equal(entry.source, src);
    assert.equal(entry.sourceTruncated, false);
    assert.equal(entry.target, "es2020");
    assert.equal(entry.loader, "ts");
    assert.equal(entry.format, "cjs");
    assert.equal(entry.sourcemap, true);
  });

  it("bounds a long source and flags the truncation instead of hiding it", async () => {
    const src = Array.from({ length: 2500 }, (_, i) => `const v${i}: number = ${i};`).join("\n"); // >50K chars, valid TS
    const r = await call("compile", ctxA, { source: src, loader: "ts", target: "es2022", format: "esm" });
    assert.equal(r.ok, true);
    const h = await call("compile-history", ctxA, {});
    const entry = h.result.history[0];
    assert.equal(entry.sourceTruncated, true);
    assert.equal(entry.source.length, 32_768);
    assert.equal(entry.source, src.slice(0, 32_768));
  });

  it("keeps the source on entries across a state restart", async () => {
    const src = "const a: number = 1; export default a;";
    await call("compile", ctxA, { source: src, loader: "ts", target: "es2022", format: "esm" });
    const snap = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
    globalThis._concordSTATE = {};
    hydrateLensState(globalThis._concordSTATE, snap);
    const h = await call("compile-history", ctxA, {});
    assert.equal(h.result.total, 1);
    assert.equal(h.result.history[0].source, src);
  });

  it("does not leak one user's history into another's", async () => {
    await call("compile", ctxA, { source: "const a: number = 1;", loader: "ts" });
    const hB = await call("compile-history", ctxB, {});
    assert.equal(hB.result.total, 0);
  });
});
