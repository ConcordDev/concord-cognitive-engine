// Contract tests for server/domains/inference.js — Prolog/Drools-style
// rule-engine macros: persistent KB, rule editor, proof trees,
// negation-as-failure, conflict resolution, explanation, built-ins,
// step-through trace.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInferenceActions from "../domains/inference.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`inference.${name}`);
  if (!fn) throw new Error(`inference.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerInferenceActions(register); });

const ctxA = { actor: { userId: "inf_user_a" }, userId: "inf_user_a" };

beforeEach(() => {
  // Fresh in-memory STATE per test; isolate the per-user KB.
  globalThis._concordSTATE = {};
  call("kb-clear", ctxA);
});

describe("inference KB editor — kb-add / kb-list / kb-check", () => {
  it("syntax-checks rule text without committing", () => {
    const r = call("kb-check", ctxA, { text: "parent(a,b)\nbad(((\nanc(?X) :- parent(?X,?Y)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.validCount, 2);
    assert.equal(r.result.invalidCount, 1);
  });

  it("adds facts and rules to the persistent KB", () => {
    const r = call("kb-add", ctxA, { text: "parent(tom,bob)\nanc(?X,?Y) :- parent(?X,?Y)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.factCount, 1);
    assert.equal(r.result.ruleCount, 1);
    const list = call("kb-list", ctxA);
    assert.equal(list.result.facts.length, 1);
    assert.equal(list.result.rules.length, 1);
  });

  it("rejects facts containing variables", () => {
    const r = call("kb-add", ctxA, { text: "parent(?X,bob)" });
    assert.equal(r.result.errorCount, 1);
  });

  it("removes a fact by id", () => {
    call("kb-add", ctxA, { text: "p(x)" });
    const id = call("kb-list", ctxA).result.facts[0].id;
    const r = call("kb-remove", ctxA, { id });
    assert.equal(r.ok, true);
    assert.equal(r.result.factCount, 0);
  });

  it("stores rule priority for conflict resolution", () => {
    call("kb-add", ctxA, { text: "win(?X) :- player(?X)", priority: 7 });
    const rule = call("kb-list", ctxA).result.rules[0];
    assert.equal(rule.priority, 7);
  });

  it("kb-clear wipes facts and rules", () => {
    call("kb-seed-sample", ctxA);
    const cleared = call("kb-clear", ctxA);
    assert.equal(cleared.ok, true);
    assert.ok(cleared.result.cleared > 0);
    assert.equal(call("kb-list", ctxA).result.factCount, 0);
  });
});

describe("inference KB query + proof tree — kb-query", () => {
  it("derives a transitive fact and returns a proof tree", () => {
    call("kb-seed-sample", ctxA);
    const r = call("kb-query", ctxA, { goal: "ancestor(tom,jim)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.proved, true);
    assert.ok(r.result.proofTrees.length > 0);
    assert.ok(r.result.proofTrees[0].children !== undefined);
  });

  it("binds variables across solutions", () => {
    call("kb-seed-sample", ctxA);
    const r = call("kb-query", ctxA, { goal: "father(?X,?Y)" });
    assert.equal(r.result.proved, true);
    assert.ok(r.result.answerCount >= 1);
  });

  it("returns proved=false for an underivable goal", () => {
    call("kb-add", ctxA, { text: "p(a)" });
    const r = call("kb-query", ctxA, { goal: "q(a)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.proved, false);
  });

  it("enumerates every variable binding for a recursive query", () => {
    call("kb-seed-sample", ctxA);
    const r = call("kb-query", ctxA, { goal: "ancestor(tom,?Who)" });
    assert.equal(r.result.proved, true);
    const who = r.result.answers.map((a) => a["?Who"]).sort();
    assert.deepEqual(who, ["ann", "bob", "jim", "pat"]);
  });
});

describe("inference negation-as-failure", () => {
  it("succeeds for not(goal) when goal is underivable", () => {
    call("kb-add", ctxA, {
      text: "bird(tweety)\npenguin(pingu)\nflies(?X) :- bird(?X), not penguin(?X)",
    });
    const yes = call("kb-query", ctxA, { goal: "flies(tweety)" });
    assert.equal(yes.result.proved, true);
    const no = call("kb-add", ctxA, { text: "penguin(tweety)" });
    assert.equal(no.ok, true);
    const after = call("kb-query", ctxA, { goal: "flies(tweety)" });
    assert.equal(after.result.proved, false);
  });
});

describe("inference built-in predicates", () => {
  it("evaluates arithmetic and comparison builtins", () => {
    call("kb-add", ctxA, {
      text: "age(sam,20)\nadult(?P) :- age(?P,?A), gte(?A,18)",
    });
    const r = call("kb-query", ctxA, { goal: "adult(sam)" });
    assert.equal(r.result.proved, true);
  });

  it("fails the rule when a comparison builtin is false", () => {
    call("kb-add", ctxA, {
      text: "age(kid,9)\nadult(?P) :- age(?P,?A), gte(?A,18)",
    });
    const r = call("kb-query", ctxA, { goal: "adult(kid)" });
    assert.equal(r.result.proved, false);
  });
});

describe("inference explanation — kb-explain (why/how)", () => {
  it("explains a derived fact with a how-step list", () => {
    call("kb-seed-sample", ctxA);
    const r = call("kb-explain", ctxA, { fact: "grandparent(tom,ann)" });
    assert.equal(r.ok, true);
    assert.equal(r.result.derivable, true);
    assert.ok(r.result.how.length > 0);
    assert.match(r.result.why, /rule|fact/);
  });

  it("reports non-derivable facts honestly", () => {
    call("kb-add", ctxA, { text: "p(a)" });
    const r = call("kb-explain", ctxA, { fact: "p(z)" });
    assert.equal(r.result.derivable, false);
  });
});

describe("inference step-through console — kb-trace", () => {
  it("produces an ordered step log", () => {
    call("kb-seed-sample", ctxA);
    const r = call("kb-trace", ctxA, { goal: "ancestor(tom,bob)" });
    assert.equal(r.ok, true);
    assert.ok(r.result.steps.length > 0);
    assert.equal(r.result.steps[0].step, 1);
    assert.ok(Array.isArray(r.result.builtins));
  });
});

describe("inference forward chaining + conflict resolution — kb-forward", () => {
  it("forward-chains the persistent KB to a fixed point", () => {
    call("kb-seed-sample", ctxA);
    const r = call("kb-forward", ctxA, { strategy: "priority" });
    assert.equal(r.ok, true);
    assert.ok(r.result.derivedFactCount > 0);
    assert.equal(r.result.fixedPointReached, true);
  });

  it("honors the chosen conflict-resolution strategy", () => {
    call("kb-seed-sample", ctxA);
    const spec = call("kb-forward", ctxA, { strategy: "specificity" });
    assert.equal(spec.result.strategy, "specificity");
    const rec = call("kb-forward", ctxA, { strategy: "recency" });
    assert.equal(rec.result.strategy, "recency");
  });

  it("rejects forward chaining on an empty KB", () => {
    const r = call("kb-forward", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("inference legacy artifact macros still register", () => {
  it("forwardChain over an artifact-supplied KB", () => {
    const art = {
      data: {
        facts: [{ predicate: "parent", args: ["a", "b"] }, { predicate: "parent", args: ["b", "c"] }],
        rules: [{
          name: "gp",
          if: [{ predicate: "parent", args: ["?X", "?Y"] }, { predicate: "parent", args: ["?Y", "?Z"] }],
          then: { predicate: "grandparent", args: ["?X", "?Z"] },
        }],
      },
    };
    const r = call("forwardChain", ctxA, art, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.derivedFactCount, 1);
  });

  it("unify computes an MGU", () => {
    const art = { data: { term1: "?X", term2: "alice" } };
    const r = call("unify", ctxA, art, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.unifiable, true);
  });
});
