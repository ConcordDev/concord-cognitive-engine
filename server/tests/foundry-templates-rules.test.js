/**
 * Tier-2 contract tests for Foundry Phase 6 — templates + NL rules.
 *
 * Pins:
 *   - templates.js: all authored templates load + each produces a
 *     VALID worldspec (dependency graph satisfied)
 *   - rules.js: deterministic NL->rule classification + target
 *     extraction, validateRule coercion, parseRuleFromLLM
 *   - foundry.templates macro; foundry.create with a templateId;
 *     foundry.compose_rule (deterministic fallback when no LLM in
 *     ctx — the macro must still return a usable rule), persist-to-
 *     world path, creator-scoping
 *   - compiler folds worldspec.rules into rule_modulators.foundry.rules
 *
 * Run: node --test server/tests/foundry-templates-rules.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { listTemplates, getTemplate } from "../lib/foundry/templates.js";
import {
  composeRuleDeterministic, validateRule, parseRuleFromLLM, buildRulePrompt,
  RULE_TRIGGERS, RULE_EFFECTS,
} from "../lib/foundry/rules.js";
import { validateWorldspec, normalizeWorldspec } from "../lib/foundry/worldspec.js";
import { compileWorldspec } from "../lib/foundry/compiler.js";
import { up as migrate191 } from "../migrations/191_foundry_worlds.js";
import registerFoundryMacros from "../domains/foundry.js";

// ── templates.js ────────────────────────────────────────────────────────────

describe("foundry templates", () => {
  it("loads the authored template catalog", () => {
    const t = listTemplates();
    assert.ok(t.length >= 3, `expected >=3 templates, got ${t.length}`);
    for (const tpl of t) {
      assert.equal(typeof tpl.id, "string");
      assert.equal(typeof tpl.name, "string");
      assert.ok(tpl.systemCount > 0, `${tpl.id} has no systems`);
    }
  });

  it("every template produces a VALID worldspec (deps satisfied)", () => {
    for (const summary of listTemplates()) {
      const full = getTemplate(summary.id);
      assert.ok(full, `getTemplate(${summary.id}) returned null`);
      const v = validateWorldspec(full.worldspec);
      assert.equal(v.ok, true, `template ${summary.id} is invalid: ${v.errors.join("; ")}`);
    }
  });

  it("getTemplate returns null for an unknown id", () => {
    assert.equal(getTemplate("does-not-exist"), null);
    assert.equal(getTemplate(""), null);
  });
});

// ── rules.js ────────────────────────────────────────────────────────────────

describe("rule composition", () => {
  it("classifies a clear NL rule deterministically", () => {
    const r = composeRuleDeterministic("when a player enters the boss arena, lock the doors");
    assert.equal(r.trigger.kind, "player_enters");
    assert.equal(r.effect.kind, "lock");
    assert.equal(r.trigger.target, "boss arena");
    assert.equal(r.composedBy, "deterministic");
    assert.ok(r.confidence > 0 && r.confidence <= 1);
  });

  it("classifies time/spawn, death/announce, gather/unlock", () => {
    assert.equal(composeRuleDeterministic("every 5 minutes spawn a merchant").trigger.kind, "on_time");
    assert.equal(composeRuleDeterministic("every 5 minutes spawn a merchant").effect.kind, "spawn");
    assert.equal(composeRuleDeterministic("when the dragon dies, announce victory").trigger.kind, "on_death");
    assert.equal(composeRuleDeterministic("when the dragon dies, announce victory").effect.kind, "announce");
    assert.equal(composeRuleDeterministic("unlock the vault when a player gathers the key").effect.kind, "unlock");
  });

  it("unclassifiable input still yields a stored rule with low confidence", () => {
    const r = composeRuleDeterministic("the weather feels nice today");
    assert.equal(r.trigger.kind, "unknown");
    assert.equal(r.effect.kind, "unknown");
    assert.ok(r.confidence < 0.4);
    assert.ok(r.source.length > 0);
  });

  it("validateRule coerces unknown kinds to 'unknown' rather than rejecting", () => {
    const v = validateRule({ source: "x", trigger: { kind: "banana" }, effect: { kind: "wat" } });
    assert.equal(v.ok, true);
    assert.equal(v.rule.trigger.kind, "unknown");
    assert.equal(v.rule.effect.kind, "unknown");
    assert.ok(v.warnings.length >= 2);
  });

  it("validateRule rejects a rule with no source text", () => {
    assert.equal(validateRule({ trigger: {}, effect: {} }).ok, false);
    assert.equal(validateRule(null).ok, false);
  });

  it("parseRuleFromLLM parses well-formed JSON, returns null on garbage", () => {
    const good = parseRuleFromLLM("x", '{"trigger":{"kind":"on_death","target":"the king"},"effect":{"kind":"announce","target":null,"value":"dead"}}');
    assert.ok(good);
    assert.equal(good.trigger.kind, "on_death");
    assert.equal(good.composedBy, "llm");
    assert.equal(parseRuleFromLLM("x", "I think the rule should..."), null);
    assert.equal(parseRuleFromLLM("x", ""), null);
  });

  it("buildRulePrompt names every trigger + effect kind", () => {
    const p = buildRulePrompt("test");
    for (const t of RULE_TRIGGERS) assert.ok(p.includes(t), `prompt missing trigger ${t}`);
    for (const e of RULE_EFFECTS) assert.ok(p.includes(e), `prompt missing effect ${e}`);
  });
});

// ── compiler folds rules ────────────────────────────────────────────────────

describe("compiler — rules", () => {
  it("folds worldspec.rules into rule_modulators.foundry.rules", () => {
    const spec = normalizeWorldspec({
      systems: [{ id: "combat-motor" }],
      rules: [composeRuleDeterministic("when the boss dies, unlock the gate")],
    });
    const c = compileWorldspec(spec);
    assert.equal(c.rule_modulators.foundry.rules.length, 1);
    assert.equal(c.rule_modulators.foundry.rules[0].effect.kind, "unlock");
  });
});

// ── macros ──────────────────────────────────────────────────────────────────

function makeHarness() {
  const db = new Database(":memory:");
  migrate191(db);
  const macros = new Map();
  registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  // ctx has no `llm` — compose_rule must fall back to deterministic.
  const call = (name, input, actor = { userId: "user-1" }) =>
    macros.get(name)({ db, actor }, input || {});
  return { db, call };
}

describe("foundry.templates + create-from-template + compose_rule", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("foundry.templates lists the catalog", () => {
    const r = h.call("foundry.templates", {});
    assert.equal(r.ok, true);
    assert.ok(r.count >= 3);
  });

  it("foundry.create starts from a templateId", () => {
    const tplId = listTemplates()[0].id;
    const r = h.call("foundry.create", { name: "From Template", templateId: tplId });
    assert.equal(r.ok, true);
    assert.equal(r.world.worldspec.template, tplId);
    assert.ok(r.world.worldspec.systems.length > 0);
  });

  it("foundry.create rejects an unknown templateId", () => {
    const r = h.call("foundry.create", { name: "X", templateId: "no-such-template" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_template");
  });

  it("compose_rule returns a usable rule with no LLM in ctx (deterministic fallback)", async () => {
    const r = await h.call("foundry.compose_rule", {
      naturalLanguage: "when a player enters the throne room, lock the exits",
    });
    assert.equal(r.ok, true);
    assert.equal(r.composedBy, "deterministic");
    assert.equal(r.rule.trigger.kind, "player_enters");
    assert.equal(r.rule.effect.kind, "lock");
    assert.equal(r.saved, false); // no id given
  });

  it("compose_rule persists the rule onto a foundry world when id is given", async () => {
    const id = h.call("foundry.create", { name: "Ruled", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    const r = await h.call("foundry.compose_rule", {
      id, naturalLanguage: "when the boss dies, announce the victory",
    });
    assert.equal(r.ok, true);
    assert.equal(r.saved, true);
    const stored = h.call("foundry.get", { id }).world;
    assert.equal(stored.worldspec.rules.length, 1);
    assert.equal(stored.worldspec.rules[0].trigger.kind, "on_death");
  });

  it("compose_rule is creator-scoped when persisting", async () => {
    const id = h.call("foundry.create", { name: "Mine", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    const r = await h.call("foundry.compose_rule",
      { id, naturalLanguage: "spawn a boss every hour" }, { userId: "intruder" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("compose_rule rejects empty / over-long input", async () => {
    assert.equal((await h.call("foundry.compose_rule", { naturalLanguage: "" })).reason, "missing_natural_language");
    assert.equal((await h.call("foundry.compose_rule", { naturalLanguage: "x".repeat(501) })).reason, "rule_too_long");
  });
});
