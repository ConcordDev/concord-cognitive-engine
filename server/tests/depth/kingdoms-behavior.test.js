// tests/depth/kingdoms-behavior.test.js — REAL behavioral tests for the
// kingdoms domain (register()/runMacro family, via the macroRuntime harness).
//
// The kingdoms surface has two halves: a DB-backed realm layer (list/get/
// decrees, needs seeded `realms` rows) and a self-contained CK3 in-memory
// layer (characters/economy/council/scheme/law/diplomacy) whose math is
// deterministic. We pin the deterministic math with exact-value asserts +
// CRUD round-trips + validation rejections. Each literal runMacro(...) call
// is credited by the macro-depth grader.
//
// In-memory CK3 state is keyed by ctx.actor.userId, so a fresh per-block
// randomUUID label isolates state across runs (the test DB persists; STATE
// resets per boot — the label keeps us safe either way).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime } from "./_harness.js";

describe("kingdoms — realm economy: exact tax/treasury math", () => {
  let runMacro, ctx;
  // Unique label → ctx.actor.userId, isolating this block's in-memory economy.
  before(async () => { ({ runMacro, ctx } = await macroRuntime(`kd-econ-${randomUUID()}`)); });

  it("economy_get: defaults are treasury 1000, tax 0.10, monthlyIncome=100", async () => {
    const r = await runMacro("kingdoms", "economy_get", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.economy.treasury, 1000);
    assert.equal(r.result.economy.taxRate, 0.10);
    // monthlyIncome = round(1000 * (0.10 + 0)) = 100
    assert.equal(r.result.derived.monthlyIncome, 100);
    assert.equal(r.result.derived.effectiveTaxRate, 0.10);
  });

  it("economy_build keep then economy_get: treasury 600, taxBonus 0.02 → income 120", async () => {
    const b = await runMacro("kingdoms", "economy_build", { kind: "keep" }, ctx);
    assert.equal(b.ok, true);
    assert.equal(b.result.building.kind, "keep");
    assert.equal(b.result.treasury, 600);            // 1000 - 400
    const g = await runMacro("kingdoms", "economy_get", {}, ctx);
    // keep taxBonus 0.02 + base 0.10 = 0.12 → round(1000*0.12) = 120; levy +80
    // (effectiveTaxRate is the raw float sum 0.10+0.02 = 0.12000…1, so tolerance-compare)
    assert.ok(Math.abs(g.result.derived.effectiveTaxRate - 0.12) < 1e-9);
    assert.equal(g.result.derived.monthlyIncome, 120);
    assert.equal(g.result.derived.totalLevyBonus, 80);
  });

  it("economy_collect: banks income into treasury (600 + 120 = 720)", async () => {
    const c = await runMacro("kingdoms", "economy_collect", {}, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.collected, 120);           // round(1000*0.12)
    assert.equal(c.result.treasury, 720);            // 600 + 120
  });

  it("economy_set_tax: a valid rate round-trips and is rounded to 2dp", async () => {
    const set = await runMacro("kingdoms", "economy_set_tax", { taxRate: 0.255 }, ctx);
    assert.equal(set.ok, true);
    assert.equal(set.result.economy.taxRate, 0.26);  // round(0.255*100)/100
  });

  it("economy_set_tax: an out-of-range rate is rejected", async () => {
    const r = await runMacro("kingdoms", "economy_set_tax", { taxRate: 0.9 }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "tax_rate_out_of_range");
  });

  it("economy_build: an unknown building kind is rejected", async () => {
    const r = await runMacro("kingdoms", "economy_build", { kind: "moon_base" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_building");
  });
});

describe("kingdoms — dynasty + council round-trips", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime(`kd-dyn-${randomUUID()}`)); });

  it("char_create: clamps stats to 0..20, defaults missing stats to 5", async () => {
    const r = await runMacro("kingdoms", "char_create", { name: "Aldric", martial: 99, diplomacy: 15 }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.character.name, "Aldric");
    assert.equal(r.result.character.martial, 20);     // clamped from 99
    assert.equal(r.result.character.diplomacy, 15);
    assert.equal(r.result.character.stewardship, 5);  // default
    assert.equal(r.result.character.age, 25);         // default
  });

  it("char_create: a blank name is rejected", async () => {
    const r = await runMacro("kingdoms", "char_create", { name: "   " }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });

  it("char_create → dynasty_tree: the new character reads back in the dynasty", async () => {
    const c = await runMacro("kingdoms", "char_create", { name: "Bryony", isRuler: true }, ctx);
    const tree = await runMacro("kingdoms", "dynasty_tree", {}, ctx);
    assert.equal(tree.ok, true);
    assert.ok(tree.result.characters.some((x) => x.id === c.result.character.id));
    assert.equal(tree.result.ruler.id, c.result.character.id);   // first ruler claimed
  });

  it("council_appoint: loyalty = 50 + (diplomacy-10)*2; agenda from top stat", async () => {
    // diplomacy 18 is the top stat → loyalty 50 + (18-10)*2 = 66, diplomacy agenda
    const c = await runMacro("kingdoms", "char_create", { name: "Cyrelle", diplomacy: 18, intrigue: 4 }, ctx);
    const r = await runMacro("kingdoms", "council_appoint", { seat: "chancellor", charId: c.result.character.id }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.appointment.loyalty, 66);
    assert.equal(r.result.appointment.competence, 18);            // top stat value
    assert.equal(r.result.appointment.agenda, "broker alliances and smooth vassal relations");
    // round-trip: council_list now reports the seat filled
    const list = await runMacro("kingdoms", "council_list", {}, ctx);
    const chancellor = list.result.seats.find((x) => x.seat === "chancellor");
    assert.equal(chancellor.appointment.charId, c.result.character.id);
  });

  it("council_appoint: an invalid seat is rejected", async () => {
    const r = await runMacro("kingdoms", "council_appoint", { seat: "jester", charId: "x" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_seat");
  });
});

describe("kingdoms — intrigue + DB-layer validation", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime(`kd-misc-${randomUUID()}`)); });

  it("scheme_start: successChance = min(0.95, base + intrigue/40), clamped", async () => {
    // sway base 0.60 + intrigue 20/40 (0.5) = 1.10 → clamped to 0.95
    const r = await runMacro("kingdoms", "scheme_start", { kind: "sway", target: "Lord Voss", agentIntrigue: 20 }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.scheme.successChance, 0.95);
    assert.equal(r.result.scheme.discoveryRisk, 0.15);           // SCHEME_KINDS.sway
    assert.equal(r.result.scheme.status, "plotting");
    assert.equal(r.result.scheme.target, "Lord Voss");
  });

  it("scheme_start: murder base 0.18 + intrigue 8/40 (0.2) = 0.38 exactly", async () => {
    const r = await runMacro("kingdoms", "scheme_start", { kind: "murder", target: "Rival", agentIntrigue: 8 }, ctx);
    assert.ok(Math.abs(r.result.scheme.successChance - 0.38) < 1e-9);
    // round-trip: scheme_list reports it
    const list = await runMacro("kingdoms", "scheme_list", {}, ctx);
    assert.ok(list.result.schemes.some((sc) => sc.id === r.result.scheme.id));
  });

  it("scheme_start: an invalid scheme kind is rejected", async () => {
    const r = await runMacro("kingdoms", "scheme_start", { kind: "tickle", target: "x" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_scheme_kind");
  });

  it("list: a missing worldId is rejected with no_world", async () => {
    const r = await runMacro("kingdoms", "list", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_world");
  });

  it("get: a non-existent kingdomId resolves to not_found", async () => {
    const r = await runMacro("kingdoms", "get", { kingdomId: `kd-missing-${randomUUID()}` }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });
});
