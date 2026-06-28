// server/tests/deities-lens-macros.test.js
//
// Phase-2 NON-SCORE-gate behavioral test for the `deities` lens
// (lens-id `deities` → backend domain `deity`, mirroring codex→lore).
//
// This LIGHTWEIGHT hermetic test exercises ONLY the macros the lens surface
// actually drives — the page (`deity.search` / `deity.list` / `deity.compose`
// / `deity.pilgrimage`) plus the child components DeityDetailPanel
// (`deity.detail` / `deity.blessings` / `deity.commune_log` / `deity.commune`
// / `deity.bless` / `deity.revise`) and MyDevotionPanel (`deity.my_devotion`
// / `deity.my_blessings`). It asserts ACTUAL values + round-trips, not just
// `{ ok: true }`.
//
// The deity domain (server/domains/deities.js) is STATE-Map-backed — it needs
// NO DB, NO server boot, NO network, NO LLM (`deity.compose` is pure-compute,
// not LLM-backed; its tone-coloured commune dialogue is deterministic). We
// register the handlers into a local Map and call them directly, the exact
// shape the live /api/lens/run dispatch uses (prefer LENS_ACTIONS). Runs <1s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDeitiesActions from "../domains/deities.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// Mirror /api/lens/run: build the virtual artifact + pass params through.
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`deity.${name}`);
  if (!fn) throw new Error(`deity.${name} not registered (lens drives this macro)`);
  const artifact = { id: null, domain: "deity", type: "domain_action", data: params, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => { registerDeitiesActions(register); });

// Clean substrate per test so devotion/pilgrim state never leaks across cases.
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.deitiesLens;
});

const ctxAuthor = { actor: { userId: "author_one" }, userId: "author_one" };
const ctxPilgrim = { actor: { userId: "pilgrim_two" }, userId: "pilgrim_two" };

function composeVeyra(ctx = ctxAuthor, over = {}) {
  return call("compose", ctx, {
    name: over.name || "Veyra",
    domainTitle: over.domainTitle || "Patron of the tide",
    creed: over.creed,
    toneVector: over.toneVector || { warmth: 0.7, refusal: 0.2, mystery: 0.6 },
    dialogueTemplates: over.dialogueTemplates || [
      { trigger: "greet", text: "Veyra regards you in silence." },
      { trigger: "commune_low_alignment", text: "Veyra turns away." },
      { trigger: "commune_high_alignment", text: "Veyra extends a hand." },
    ],
    alignmentThresholds: over.alignmentThresholds || { commune: 0.5, refuse: -0.3 },
  });
}

// ── WIRING: every macro the lens surface calls must be registered ────────────
describe("deities lens wiring — all driven macros resolve to real handlers", () => {
  it("registers every macro the page + child components drive", () => {
    // page.tsx
    for (const m of ["search", "list", "compose", "pilgrimage"]) {
      assert.ok(ACTIONS.has(`deity.${m}`), `deity.${m} (page) must be registered`);
    }
    // DeityDetailPanel.tsx
    for (const m of ["detail", "blessings", "commune_log", "commune", "bless", "revise"]) {
      assert.ok(ACTIONS.has(`deity.${m}`), `deity.${m} (DeityDetailPanel) must be registered`);
    }
    // MyDevotionPanel.tsx
    for (const m of ["my_devotion", "my_blessings"]) {
      assert.ok(ACTIONS.has(`deity.${m}`), `deity.${m} (MyDevotionPanel) must be registered`);
    }
  });
});

// ── COMPOSE → returns a real deity record (deterministic, no LLM) ────────────
describe("deity.compose (page 'Birth Deity')", () => {
  it("composes a real deity record with the submitted tone + a stable id", () => {
    const r = composeVeyra();
    assert.equal(r.ok, true);
    assert.ok(r.result.deityId, "a deityId is minted");
    assert.equal(r.result.deity.name, "Veyra");
    assert.equal(r.result.deity.domainTitle, "Patron of the tide");
    assert.equal(r.result.deity.pilgrim_count, 0, "a fresh deity has zero pilgrims");
    assert.equal(typeof r.result.deity.created_at, "number");
  });

  it("fail-closed: an empty name is rejected (no phantom deity)", () => {
    const r = call("compose", ctxAuthor, { name: "   " });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /name/i);
    // nothing was created
    const list = call("list", ctxAuthor, {});
    assert.equal(list.result.count, 0);
  });

  it("supplies a default voice when no dialogue templates are passed", () => {
    const id = call("compose", ctxAuthor, { name: "Silent" }).result.deityId;
    const d = call("detail", ctxAuthor, { deityId: id });
    assert.ok(Array.isArray(d.result.deity.dialogueTemplates));
    assert.ok(d.result.deity.dialogueTemplates.length >= 3, "always has a voice");
  });
});

// ── LIST / SEARCH (page filter bar) ──────────────────────────────────────────
describe("deity.list / deity.search (pantheon filter bar)", () => {
  it("list ranks deities by pilgrim count then recency", () => {
    const cold = composeVeyra(ctxAuthor, { name: "Frostheart" }).result.deityId;
    composeVeyra(ctxAuthor, { name: "Sunwarm" });
    call("pilgrimage", ctxPilgrim, { deityId: cold });
    const r = call("list", ctxAuthor, { limit: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.deities[0].name, "Frostheart", "the deity with a pilgrim ranks first");
    assert.equal(r.result.deities[0].pilgrim_count, 1);
  });

  it("search filters by query, tone axis, and minimum pilgrims (real values)", () => {
    const cold = composeVeyra(ctxAuthor, {
      name: "Frostheart", toneVector: { warmth: 0.05, refusal: 0.9, mystery: 0.5 },
    }).result.deityId;
    composeVeyra(ctxAuthor, { name: "Sunwarm", toneVector: { warmth: 0.95, refusal: 0.1, mystery: 0.2 } });
    call("pilgrimage", ctxPilgrim, { deityId: cold });

    const byName = call("search", ctxAuthor, { query: "frost" });
    assert.equal(byName.result.count, 1);
    assert.equal(byName.result.deities[0].name, "Frostheart");

    const byTone = call("search", ctxAuthor, { toneAxis: "refusal", minTone: 0.5 });
    assert.equal(byTone.result.count, 1, "only the high-refusal deity matches");

    const byPilgrims = call("search", ctxAuthor, { minPilgrims: 1 });
    assert.equal(byPilgrims.result.count, 1);
  });
});

// ── PILGRIMAGE → logs + returns real progress (devotion accrual) ─────────────
describe("deity.pilgrimage (page 'Pilgrimage' button)", () => {
  it("records a pilgrim, bumps the count, and accrues real devotion", () => {
    const id = composeVeyra().result.deityId;
    const r = call("pilgrimage", ctxPilgrim, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.newPilgrimCount, 1);
    assert.ok(r.result.devotion.score > 0, "devotion score accrues");
    assert.ok(r.result.devotion.alignment > 0, "alignment nudges upward");

    // round-trip: the bump is observable in detail + my_devotion
    const detail = call("detail", ctxPilgrim, { deityId: id });
    assert.equal(detail.result.deity.pilgrim_count, 1);
    assert.equal(detail.result.rosterCount, 1);

    const mine = call("my_devotion", ctxPilgrim, {});
    assert.equal(mine.result.patronCount, 1);
    assert.equal(mine.result.totalPilgrimages, 1);
  });

  it("fail-closed: pilgrimage to a missing deity is rejected", () => {
    const r = call("pilgrimage", ctxPilgrim, { deityId: "no-such-deity" });
    assert.equal(r.ok, false);
  });

  it("federated originPeer is preserved through the pilgrim log", () => {
    const id = composeVeyra().result.deityId;
    call("pilgrimage", ctxPilgrim, { deityId: id, originPeer: "peer.example.org" });
    const log = call("pilgrim_log", ctxAuthor, { deityId: id });
    assert.equal(log.result.pilgrims[0].origin_peer, "peer.example.org");
  });
});

// ── DETAIL (DeityDetailPanel open) ───────────────────────────────────────────
describe("deity.detail (DeityDetailPanel)", () => {
  it("returns tone vector, templates, roster + the caller's own devotion", () => {
    const id = composeVeyra().result.deityId;
    const r = call("detail", ctxAuthor, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.isAuthor, true, "the author sees authorship");
    assert.ok(r.result.deity.toneVector);
    assert.equal(r.result.deity.toneVector.warmth, 0.7);
    assert.ok(Array.isArray(r.result.deity.dialogueTemplates));
    assert.ok(Array.isArray(r.result.pilgrimRoster));
  });
});

// ── COMMUNE (DeityDetailPanel commune) — alignment-gated, deterministic ──────
describe("deity.commune / deity.commune_log (DeityDetailPanel)", () => {
  it("greets a neutral-alignment player with a real utterance", () => {
    const id = composeVeyra().result.deityId;
    const r = call("commune", ctxPilgrim, { deityId: id, intent: "greet" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reception, "neutral");
    assert.ok(r.result.utterance.length > 0, "deterministic utterance, no LLM");
  });

  it("receives a high-alignment player after enough pilgrimage (gameplay gate)", () => {
    const id = composeVeyra(ctxAuthor, { alignmentThresholds: { commune: 0.3, refuse: -0.3 } }).result.deityId;
    for (let i = 0; i < 6; i++) call("pilgrimage", ctxPilgrim, { deityId: id });
    const r = call("commune", ctxPilgrim, { deityId: id, intent: "offering", offering: "a carved stone" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reception, "received");
  });

  it("commune_log returns the recent utterances the panel renders", () => {
    const id = composeVeyra().result.deityId;
    call("commune", ctxPilgrim, { deityId: id });
    const r = call("commune_log", ctxAuthor, { deityId: id, limit: 30 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(typeof r.result.utterances[0].text === "string");
  });
});

// ── BLESSINGS / BLESS (DeityDetailPanel payoff) ──────────────────────────────
describe("deity.blessings / deity.bless / deity.my_blessings", () => {
  it("lists the four blessing tiers with real claimable state", () => {
    const id = composeVeyra().result.deityId;
    const r = call("blessings", ctxPilgrim, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tiers.length, 4);
    assert.equal(r.result.tiers[0].claimable, false, "no devotion yet → nothing claimable");
  });

  it("INVARIANT: cannot claim a blessing with too little devotion", () => {
    const id = composeVeyra().result.deityId;
    const r = call("bless", ctxPilgrim, { deityId: id, tierId: "avatar" });
    assert.equal(r.ok, false);
  });

  it("grants a real blessing once devotion + alignment suffice, then de-dupes", () => {
    const id = composeVeyra(ctxAuthor, { alignmentThresholds: { commune: 0.3, refuse: -0.3 } }).result.deityId;
    for (let i = 0; i < 3; i++) call("pilgrimage", ctxPilgrim, { deityId: id });
    const granted = call("bless", ctxPilgrim, { deityId: id, tierId: "acolyte" });
    assert.equal(granted.ok, true);
    assert.ok(granted.result.blessing.effect.stat, "a real stat buff is granted");
    // double-claim rejected
    assert.equal(call("bless", ctxPilgrim, { deityId: id, tierId: "acolyte" }).ok, false);
    // surfaced in MyDevotionPanel
    const mine = call("my_blessings", ctxPilgrim, {});
    assert.equal(mine.result.count, 1);
  });
});

// ── REVISE (DeityDetailPanel author edit) — author-only invariant ────────────
describe("deity.revise (DeityDetailPanel, author-only)", () => {
  it("lets the author revise tone + bumps the revision number", () => {
    const id = composeVeyra().result.deityId;
    const r = call("revise", ctxAuthor, { deityId: id, toneVector: { warmth: 0.1, refusal: 0.9, mystery: 0.5 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.revision, 2);
    const d = call("detail", ctxAuthor, { deityId: id });
    assert.equal(d.result.deity.toneVector.refusal, 0.9, "the revision persists");
  });

  it("INVARIANT: a non-author cannot revise (no hijack)", () => {
    const id = composeVeyra(ctxAuthor).result.deityId;
    const r = call("revise", ctxPilgrim, { deityId: id, name: "Hijack" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /author/);
  });
});

// ── MY DEVOTION (MyDevotionPanel) ────────────────────────────────────────────
describe("deity.my_devotion (MyDevotionPanel)", () => {
  it("tracks per-player devotion across the whole pantheon", () => {
    const a = composeVeyra(ctxAuthor, { name: "One" }).result.deityId;
    const b = composeVeyra(ctxAuthor, { name: "Two" }).result.deityId;
    call("pilgrimage", ctxPilgrim, { deityId: a });
    call("pilgrimage", ctxPilgrim, { deityId: a });
    call("pilgrimage", ctxPilgrim, { deityId: b });
    const r = call("my_devotion", ctxPilgrim, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.patronCount, 2);
    assert.equal(r.result.totalPilgrimages, 3);
    assert.ok(r.result.topPatron, "a top patron is resolved");
    assert.equal(r.result.topPatron.deityName, "One");
  });

  it("empty for a player who has never made a pilgrimage", () => {
    composeVeyra(ctxAuthor);
    const r = call("my_devotion", ctxPilgrim, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.patronCount, 0);
    assert.equal(r.result.totalPilgrimages, 0);
  });
});
