// Contract tests for server/domains/kingdoms.js — the Crusader Kings III
// parity macro surface (dynasty / council / diplomacy / war / economy /
// intrigue / law). These macros are state-backed (globalThis._concordSTATE)
// and pure-compute — no DB required.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerKingdomsMacros from "../domains/kingdoms.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`kingdoms.${name}`);
  if (!fn) throw new Error(`kingdoms.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerKingdomsMacros(register); });

beforeEach(() => {
  // Fresh per-test simulation state so cross-test bleed cannot mask bugs.
  globalThis._concordSTATE = {};
});

const ctx = { actor: { userId: "ck3_user" }, userId: "ck3_user" };

describe("kingdoms — character / dynasty", () => {
  it("char_create returns the new character with clamped stats", async () => {
    const r = await call("char_create", ctx, { name: "Aldric", isRuler: true, martial: 99 });
    assert.equal(r.ok, true);
    assert.equal(r.result.character.name, "Aldric");
    assert.equal(r.result.character.isRuler, true);
    assert.equal(r.result.character.martial, 20); // clamped 0..20
  });

  it("char_create rejects an empty name", async () => {
    const r = await call("char_create", ctx, { name: "  " });
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });

  it("dynasty_tree resolves the eldest child as heir under primogeniture", async () => {
    const ruler = await call("char_create", ctx, { name: "King", isRuler: true });
    const elder = await call("char_create", ctx, { name: "Elder", age: 30, parentIds: [ruler.result.character.id] });
    await call("char_create", ctx, { name: "Younger", age: 10, parentIds: [ruler.result.character.id] });
    const tree = await call("dynasty_tree", ctx, {});
    assert.equal(tree.ok, true);
    assert.equal(tree.result.count, 3);
    assert.equal(tree.result.successionLaw, "primogeniture");
    assert.equal(tree.result.heir.id, elder.result.character.id); // primogeniture = eldest child
    assert.ok(tree.result.ruler);
  });

  it("char_marry weds two unmarried characters", async () => {
    const a = await call("char_create", ctx, { name: "Lord" });
    const b = await call("char_create", ctx, { name: "Lady", gender: "female" });
    const r = await call("char_marry", ctx, { aId: a.result.character.id, bId: b.result.character.id, alliance: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.marriage.aId, a.result.character.id);
  });

  it("char_marry rejects an already-married character", async () => {
    const a = await call("char_create", ctx, { name: "A" });
    const b = await call("char_create", ctx, { name: "B" });
    const c = await call("char_create", ctx, { name: "C" });
    await call("char_marry", ctx, { aId: a.result.character.id, bId: b.result.character.id });
    const r = await call("char_marry", ctx, { aId: a.result.character.id, bId: c.result.character.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "already_married");
  });

  it("char_death triggers succession when the ruler dies", async () => {
    const ruler = await call("char_create", ctx, { name: "Old King", isRuler: true });
    await call("char_create", ctx, { name: "Heir", age: 25, parentIds: [ruler.result.character.id] });
    const r = await call("char_death", ctx, { charId: ruler.result.character.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.successionTriggered, true);
    assert.ok(r.result.newRuler);
  });
});

describe("kingdoms — law / succession editor", () => {
  it("law_get returns defaults and the option list", async () => {
    const r = await call("law_get", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.successionOptions));
    assert.ok(r.result.successionOptions.includes("elective"));
  });

  it("law_set persists a valid succession law", async () => {
    const r = await call("law_set", ctx, { succession: "elective", crownAuthority: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.law.succession, "elective");
    assert.equal(r.result.law.crownAuthority, 3);
  });

  it("law_set falls back to primogeniture for an invalid law", async () => {
    const r = await call("law_set", ctx, { succession: "not_a_law" });
    assert.equal(r.ok, true);
    assert.equal(r.result.law.succession, "primogeniture");
  });
});

describe("kingdoms — council / vassal management", () => {
  it("council_list returns the five seats", async () => {
    const r = await call("council_list", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.seats.length, 5);
    assert.equal(r.result.openSeats, 5);
  });

  it("council_appoint seats a courtier with a derived agenda", async () => {
    const c = await call("char_create", ctx, { name: "Steward", stewardship: 18 });
    const r = await call("council_appoint", ctx, { seat: "steward", charId: c.result.character.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.appointment.seat, "steward");
    assert.ok(r.result.appointment.agenda.length > 0);
  });

  it("council_appoint rejects an invalid seat", async () => {
    const c = await call("char_create", ctx, { name: "X" });
    const r = await call("council_appoint", ctx, { seat: "jester", charId: c.result.character.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_seat");
  });

  it("council_dismiss frees a filled seat", async () => {
    const c = await call("char_create", ctx, { name: "Marshal" });
    await call("council_appoint", ctx, { seat: "marshal", charId: c.result.character.id });
    const r = await call("council_dismiss", ctx, { seat: "marshal" });
    assert.equal(r.ok, true);
    assert.equal(r.result.dismissed, "marshal");
  });
});

describe("kingdoms — diplomacy", () => {
  it("treaty_propose creates a proposed treaty", async () => {
    const r = await call("treaty_propose", ctx, { kind: "alliance", counterparty: "Realm of Vale" });
    assert.equal(r.ok, true);
    assert.equal(r.result.treaty.status, "proposed");
  });

  it("treaty_propose rejects an invalid kind", async () => {
    const r = await call("treaty_propose", ctx, { kind: "marriage", counterparty: "X" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_treaty_kind");
  });

  it("treaty_resolve transitions a treaty's status", async () => {
    const p = await call("treaty_propose", ctx, { kind: "trade_pact", counterparty: "X" });
    const r = await call("treaty_resolve", ctx, { treatyId: p.result.treaty.id, status: "accepted" });
    assert.equal(r.ok, true);
    assert.equal(r.result.treaty.status, "accepted");
  });

  it("claim_fabricate creates a fabricating claim", async () => {
    const r = await call("claim_fabricate", ctx, { target: "Duchy of Thorn", strength: 40 });
    assert.equal(r.ok, true);
    assert.equal(r.result.claim.status, "fabricating");
    assert.equal(r.result.claim.strength, 40);
  });

  it("diplomacy_list returns treaties and claims", async () => {
    await call("treaty_propose", ctx, { kind: "alliance", counterparty: "A" });
    await call("claim_fabricate", ctx, { target: "B" });
    const r = await call("diplomacy_list", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.treaties.length, 1);
    assert.equal(r.result.claims.length, 1);
  });
});

describe("kingdoms — war / casus belli", () => {
  it("war_declare opens an active war", async () => {
    const r = await call("war_declare", ctx, { target: "Enemy Realm", casusBelli: "conquest", levies: 800 });
    assert.equal(r.ok, true);
    assert.equal(r.result.war.status, "active");
    assert.equal(r.result.war.attackerLevies, 800);
  });

  it("war_declare rejects an invalid casus belli", async () => {
    const r = await call("war_declare", ctx, { target: "X", casusBelli: "boredom" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_casus_belli");
  });

  it("war_battle resolves a battle and updates the war score", async () => {
    const w = await call("war_declare", ctx, { target: "Foe", casusBelli: "raid", levies: 1000, defenderLevies: 500 });
    const r = await call("war_battle", ctx, { warId: w.result.war.id, commanderMartial: 15 });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.battle.attackerWon === "boolean");
    assert.ok(Math.abs(r.result.war.warScore) <= 100);
  });

  it("war_list returns the casus-belli catalog", async () => {
    const r = await call("war_list", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.casusBelli.includes("holy_war"));
  });

  it("war_end concludes a war", async () => {
    const w = await call("war_declare", ctx, { target: "Foe", casusBelli: "conquest", levies: 300 });
    const r = await call("war_end", ctx, { warId: w.result.war.id, outcome: "white_peace" });
    assert.equal(r.ok, true);
    assert.equal(r.result.war.status, "white_peace");
  });
});

describe("kingdoms — realm economy", () => {
  it("economy_get returns a treasury, catalog and derived numbers", async () => {
    const r = await call("economy_get", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.economy.treasury, "number");
    assert.ok(r.result.catalog.keep);
    assert.equal(typeof r.result.derived.monthlyIncome, "number");
  });

  it("economy_set_tax rejects an out-of-range rate", async () => {
    const r = await call("economy_set_tax", ctx, { taxRate: 0.9 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "tax_rate_out_of_range");
  });

  it("economy_set_tax accepts a valid rate", async () => {
    const r = await call("economy_set_tax", ctx, { taxRate: 0.2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.economy.taxRate, 0.2);
  });

  it("economy_build constructs a building and debits the treasury", async () => {
    const before = (await call("economy_get", ctx, {})).result.economy.treasury;
    const r = await call("economy_build", ctx, { kind: "market" });
    assert.equal(r.ok, true);
    assert.ok(r.result.treasury < before, "treasury should drop after construction");
  });

  it("economy_build rejects an invalid building", async () => {
    const r = await call("economy_build", ctx, { kind: "spaceport" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_building");
  });

  it("economy_collect adds income to the treasury", async () => {
    const before = (await call("economy_get", ctx, {})).result.economy.treasury;
    const r = await call("economy_collect", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.treasury > before, "treasury should rise after collection");
  });
});

describe("kingdoms — intrigue / schemes", () => {
  it("scheme_list returns the scheme-kind catalog", async () => {
    const r = await call("scheme_list", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.kinds.murder);
  });

  it("scheme_start opens a plotting scheme", async () => {
    const r = await call("scheme_start", ctx, { kind: "sway", target: "Rival Lord", agentIntrigue: 16 });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheme.status, "plotting");
    assert.ok(r.result.scheme.successChance > 0);
  });

  it("scheme_start rejects an invalid scheme kind", async () => {
    const r = await call("scheme_start", ctx, { kind: "duel", target: "X" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_scheme_kind");
  });

  it("scheme_advance progresses a plotting scheme", async () => {
    const s = await call("scheme_start", ctx, { kind: "fabricate_hook", target: "Y", agentIntrigue: 10 });
    const r = await call("scheme_advance", ctx, { schemeId: s.result.scheme.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.scheme.progress > 0);
  });

  it("scheme_advance rejects an unknown scheme id", async () => {
    const r = await call("scheme_advance", ctx, { schemeId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "scheme_not_found");
  });
});
