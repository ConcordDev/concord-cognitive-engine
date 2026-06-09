/**
 * Phase 7 contract tests — the Concord DSL.
 *
 * Pins: the lexer/parser produce the expected AST; the interpreter transpiles to
 * runMacro calls and a program produces the SAME result + call-trace as the
 * equivalent hand-written sequence (round-trip); let/member/if control flow work;
 * and — the load-bearing one — a DSL program run through the Phase-2 CONFINED
 * runMacro is rejected at the sandbox boundary when it reaches a domain its
 * capability manifest doesn't grant. Honest envelopes, never throws.
 *
 * Run: node --test server/tests/dsl.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse, runDsl } from "../lib/dsl.js";
import { makeConfinedCtx } from "../lib/confined-ctx.js";

// A fake runMacro that returns canned results per (domain, name) and records calls.
function fakeRunMacro(table = {}) {
  const calls = [];
  const fn = async (domain, name, input) => {
    calls.push({ domain, name, input });
    const r = table[`${domain}.${name}`];
    return typeof r === "function" ? r(input) : (r ?? { ok: true, result: {} });
  };
  fn.calls = calls;
  return fn;
}

describe("DSL parser", () => {
  it("parses let / macro-call / member / if into the expected AST", () => {
    const ast = parse(`
      # make a dtu, search, then maybe play
      let a = dtu.create({ title: "Hi", n: 2 })
      let s = discovery.search({ query: a.title, limit: 3 })
      if s.count { music.play({ id: a.id }) }
    `);
    assert.equal(ast.type, "Program");
    assert.equal(ast.body.length, 3);
    assert.equal(ast.body[0].type, "Let");
    assert.equal(ast.body[0].value.type, "MacroCall");
    assert.equal(ast.body[0].value.domain, "dtu");
    assert.equal(ast.body[0].value.name, "create");
    // member access inside the second call's input (a.title)
    assert.equal(ast.body[1].value.input.props.query.type, "Member");
    assert.equal(ast.body[2].type, "If");
    assert.equal(ast.body[2].cons[0].expr.type, "MacroCall");
  });

  it("reports a parse error as a clean envelope (never throws)", async () => {
    const r = await runDsl(`let = music.play({})`, { runMacro: fakeRunMacro() });
    assert.equal(r.ok, false);
    assert.equal(r.phase, "parse");
    assert.match(r.error, /name/i);
  });
});

describe("DSL interpreter — transpiles to runMacro", () => {
  const TABLE = {
    "dtu.create": () => ({ ok: true, result: { id: "d1", title: "Hi" } }),
    "discovery.search": (input) => ({ ok: true, result: { count: 2, echoedQuery: input.query, limit: input.limit } }),
    "music.play": () => ({ ok: true, result: { playing: true } }),
  };

  it("binds variables, resolves dot-paths, and fires the if-branch — same result as hand-written runMacro", async () => {
    const program = `
      let a = dtu.create({ title: "Hi" })
      let s = discovery.search({ query: a.title, limit: 3 })
      if s.count { music.play({ id: a.id }) }
    `;
    const dslRun = fakeRunMacro(TABLE);
    const dsl = await runDsl(program, { runMacro: dslRun });
    assert.equal(dsl.ok, true);
    // the if-branch fired (count=2 truthy) → 3 macro calls in order
    assert.deepEqual(dsl.trace.map((t) => `${t.domain}.${t.name}`), ["dtu.create", "discovery.search", "music.play"]);
    // dot-path resolution: discovery.search received a.title
    assert.equal(dslRun.calls[1].input.query, "Hi");

    // hand-written equivalent
    const handRun = fakeRunMacro(TABLE);
    const a = (await handRun("dtu", "create", { title: "Hi" })).result;
    const s = (await handRun("discovery", "search", { query: a.title, limit: 3 })).result;
    if (s.count) await handRun("music", "play", { id: a.id });
    assert.deepEqual(handRun.calls, dslRun.calls, "DSL produces the identical runMacro sequence");
  });

  it("skips the if-branch when the condition is falsy", async () => {
    const run = fakeRunMacro({ ...TABLE, "discovery.search": () => ({ ok: true, result: { count: 0 } }) });
    const r = await runDsl(`let s = discovery.search({ query: "x" })\nif s.count { music.play({ id: "z" }) }`, { runMacro: run });
    assert.equal(r.ok, true);
    assert.deepEqual(r.trace.map((t) => `${t.domain}.${t.name}`), ["discovery.search"], "music.play NOT called");
  });

  it("an undefined variable is an honest runtime error", async () => {
    const r = await runDsl(`music.play({ id: missing.id })`, { runMacro: fakeRunMacro(TABLE) });
    assert.equal(r.ok, false);
    assert.equal(r.phase, "runtime");
    assert.match(r.error, /undefined variable 'missing'/);
  });
});

describe("DSL × Phase-2 sandbox — confined by the capability manifest", () => {
  it("rejects a program that reaches a domain the manifest doesn't grant (sandbox boundary)", async () => {
    const inner = fakeRunMacro({ "dtu.create": () => ({ ok: true, result: { id: "d1" } }) });
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: inner, manifest: { macros: ["dtu.*", "discovery.*"] } });

    // granted domain works
    const okRun = await runDsl(`dtu.create({ title: "ok" })`, { runMacro: ctx.runMacro });
    assert.equal(okRun.ok, true);

    // ungranted (and forbidden) domain is halted at the boundary
    const denied = await runDsl(`code.exec({ code: "process.exit()" })`, { runMacro: ctx.runMacro });
    assert.equal(denied.ok, false);
    assert.equal(denied.phase, "runtime");
    assert.match(denied.error, /rejected|denied/i);
    assert.equal(inner.calls.length, 1, "the forbidden call never reached the real runMacro");
  });

  it("rejects a non-manifest macro even in an allowed-ish domain", async () => {
    const inner = fakeRunMacro();
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: inner, manifest: { macros: ["dtu.create"] } });
    const denied = await runDsl(`dtu.delete({ id: "d1" })`, { runMacro: ctx.runMacro });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /rejected|denied|manifest/i);
  });
});
