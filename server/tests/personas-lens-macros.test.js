// Lens-driven behavioral macro tests for server/domains/personas.js.
//
// SCOPE: the /lenses/personas page + its child components
// (PersonaEditor, PersonaMarketplace, PersonaDetailPanel) drive a specific
// subset of personas.* macros. This file pins ACTUAL values + round-trips for
// exactly that subset — the contract the FRONTEND depends on — so a backend
// change that breaks a lens call site fails here, not in production.
//
// Lens call sites (grep concord-frontend/app/lenses/personas + components):
//   page.tsx          -> mine, delete
//   PersonaEditor     -> create, update, revise
//   PersonaMarketplace-> browse, facets
//   PersonaDetailPanel-> get, stats, versions, publish, install, rate,
//                        regenerate_portrait
//
// LIGHTWEIGHT + hermetic: no server boot, no network, no LLM. We register the
// real domain handlers into a local Map (the registerLensAction convention is
// (ctx, artifact, params)) and reset the per-process store between tests.
// Shapes asserted match the lensRun envelope unwrap the frontend reads
// (`r.data.result.<field>`): the domain returns { ok, result: {...} }.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPersonasActions from "../domains/personas.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "personas", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`personas.${name} not registered`);
  // registerLensAction convention: (ctx, artifact, params)
  return fn(ctx, { id: null, domain: "personas", data: {}, meta: {} }, params);
}

before(() => { registerPersonasActions(register); });
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE._personas;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// The 14 macros the lens + its components actually drive. If a backend change
// drops one, the lens silently 500s on that call — this is the wiring floor.
const LENS_DRIVEN = [
  "mine", "delete", "create", "update", "revise",
  "browse", "facets", "get", "stats", "versions",
  "publish", "install", "rate", "regenerate_portrait",
];

function newPersona(ctx = ctxA, overrides = {}) {
  const r = call("create", ctx, {
    name: "Cinder Vale",
    tagline: "A weathered cartographer",
    personality: "Patient, observant, speaks in measured detail.",
    voice: "wise",
    greeting: "What lands shall we chart today?",
    category: "guide",
    tags: ["maps, exploration, guide"],
    exampleDialogue: [{ prompt: "where am i", response: "You stand at the old harbor." }],
    ...overrides,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.persona;
}

describe("personas — every lens-driven macro is registered", () => {
  it("registers all 14 macros the lens + components call", () => {
    for (const name of LENS_DRIVEN) {
      assert.equal(typeof ACTIONS.get(name), "function", `missing personas.${name}`);
    }
  });
});

describe("personas.mine — page.tsx primary load", () => {
  it("returns { result: { personas: [...] } } scoped to the caller", () => {
    newPersona(ctxA);
    newPersona(ctxB);
    const r = call("mine", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.personas), "lens reads r.data.result.personas");
    assert.equal(r.result.personas.length, 1);
    assert.equal(r.result.personas[0].name, "Cinder Vale");
    // The card UI reads version / published / installCount.
    assert.equal(r.result.personas[0].version, 1);
    assert.equal(r.result.personas[0].published, false);
    assert.equal(r.result.personas[0].installCount, 0);
    assert.ok(r.result.personas[0].portrait.startsWith("data:image/svg+xml"));
  });

  it("returns empty list (not error) for an author with no personas", () => {
    const r = call("mine", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.personas, []);
  });
});

describe("personas.create / update / revise — PersonaEditor", () => {
  it("create -> mine round-trip persists the authored fields", () => {
    const p = newPersona();
    const mine = call("mine", ctxA, {});
    assert.equal(mine.result.personas[0].id, p.id);
    assert.equal(mine.result.personas[0].tagline, "A weathered cartographer");
    assert.deepEqual(mine.result.personas[0].tags, ["maps", "exploration", "guide"]);
  });

  it("update mutates fields and keeps the same id", () => {
    const p = newPersona();
    const r = call("update", ctxA, { personaId: p.id, tagline: "Master navigator" });
    assert.equal(r.ok, true);
    assert.equal(r.result.persona.id, p.id);
    const got = call("get", ctxA, { personaId: p.id });
    assert.equal(got.result.persona.tagline, "Master navigator");
  });

  it("revise bumps version and snapshots the prior version into history", () => {
    const p = newPersona();
    assert.equal(p.version, 1);
    const r = call("revise", ctxA, {
      personaId: p.id, changelog: "tuned the voice", voice: "mysterious",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.version, 2);
    assert.equal(r.result.changelog, "tuned the voice");
    const v = call("versions", ctxA, { personaId: p.id });
    assert.equal(v.result.current, 2);
    assert.ok(v.result.versions.length >= 2, "prior version snapshotted");
  });

  it("update rejects a non-author", () => {
    const p = newPersona(ctxA);
    const r = call("update", ctxB, { personaId: p.id, name: "Hijack" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_author");
  });
});

describe("personas.browse / facets — PersonaMarketplace", () => {
  it("browse only returns published personas, with total", () => {
    const draft = newPersona(ctxA, { name: "Draft One" });
    const pub = newPersona(ctxB, { name: "Public One", tags: ["maps"] });
    call("publish", ctxB, { personaId: pub.id, published: true });
    const r = call("browse", ctxA, { sort: "popular" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1, "only the published persona is visible");
    assert.equal(r.result.personas[0].name, "Public One");
    assert.ok(!r.result.personas.some((x) => x.id === draft.id));
  });

  it("browse filters by query / tag / category", () => {
    const p = newPersona(ctxB, { name: "Mapmaker", tags: ["cartography"], category: "guide" });
    call("publish", ctxB, { personaId: p.id, published: true });
    assert.equal(call("browse", ctxA, { query: "mapmaker" }).result.total, 1);
    assert.equal(call("browse", ctxA, { query: "nonexistent" }).result.total, 0);
    assert.equal(call("browse", ctxA, { tag: "cartography" }).result.total, 1);
    assert.equal(call("browse", ctxA, { category: "guide" }).result.total, 1);
    assert.equal(call("browse", ctxA, { category: "villain" }).result.total, 0);
  });

  it("facets aggregate tags + categories over published personas only", () => {
    const p = newPersona(ctxB, { tags: ["maps", "lore"], category: "guide" });
    call("publish", ctxB, { personaId: p.id, published: true });
    const f = call("facets", ctxA, {});
    assert.equal(f.ok, true);
    assert.ok(f.result.tags.some((t) => t.name === "maps" && t.count === 1));
    assert.ok(f.result.categories.some((c) => c.name === "guide" && c.count === 1));
  });
});

describe("personas.get / stats / install / rate — PersonaDetailPanel", () => {
  it("get returns full authored fields + isAuthor for the owner", () => {
    const p = newPersona(ctxA);
    const r = call("get", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.persona.isAuthor, true);
    assert.equal(r.result.persona.personality, "Patient, observant, speaks in measured detail.");
    assert.ok(Array.isArray(r.result.persona.exampleDialogue));
  });

  it("get hides an unpublished persona from a non-author", () => {
    const p = newPersona(ctxA);
    const r = call("get", ctxB, { personaId: p.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_visible");
  });

  it("install increments installCount only on published personas", () => {
    const p = newPersona(ctxA);
    const blocked = call("install", ctxB, { personaId: p.id });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "not_published");
    call("publish", ctxA, { personaId: p.id, published: true });
    const r = call("install", ctxB, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.installCount, 1);
    assert.equal(call("stats", ctxA, { personaId: p.id }).result.installCount, 1);
  });

  it("rate computes a real average + rejects rating your own persona", () => {
    const p = newPersona(ctxA);
    call("publish", ctxA, { personaId: p.id, published: true });
    const own = call("rate", ctxA, { personaId: p.id, stars: 5 });
    assert.equal(own.ok, false);
    assert.equal(own.error, "cannot_rate_own");
    const r = call("rate", ctxB, { personaId: p.id, stars: 4, review: "solid guide" });
    assert.equal(r.ok, true);
    assert.equal(r.result.rating, 4);
    assert.equal(r.result.ratingCount, 1);
    const s = call("stats", ctxA, { personaId: p.id });
    assert.equal(s.result.rating, 4);
    assert.equal(s.result.distribution.find((d) => d.stars === 4).count, 1);
  });
});

describe("personas.publish — toggle visibility", () => {
  it("publish then unpublish round-trips and is author-gated", () => {
    const p = newPersona(ctxA);
    const up = call("publish", ctxA, { personaId: p.id, published: true });
    assert.equal(up.result.published, true);
    const down = call("publish", ctxA, { personaId: p.id, published: false });
    assert.equal(down.result.published, false);
    const hijack = call("publish", ctxB, { personaId: p.id, published: true });
    assert.equal(hijack.ok, false);
    assert.equal(hijack.error, "not_author");
  });
});

describe("personas.regenerate_portrait — PersonaDetailPanel avatar", () => {
  it("regenerates a deterministic SVG portrait for the author", () => {
    const p = newPersona(ctxA);
    const r = call("regenerate_portrait", ctxA, { personaId: p.id, seedToken: "abc" });
    assert.equal(r.ok, true);
    assert.ok(r.result.portrait.startsWith("data:image/svg+xml"));
  });

  it("accepts an uploaded data-URI", () => {
    const p = newPersona(ctxA);
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    const r = call("regenerate_portrait", ctxA, { personaId: p.id, dataUri });
    assert.equal(r.ok, true);
    assert.equal(r.result.portrait, dataUri);
  });

  it("rejects regeneration by a non-author", () => {
    const p = newPersona(ctxA);
    const r = call("regenerate_portrait", ctxB, { personaId: p.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_author");
  });
});

describe("personas.delete — page.tsx card action", () => {
  it("delete removes the persona and is author-gated; never throws on a phantom id", () => {
    const p = newPersona(ctxA);
    const hijack = call("delete", ctxB, { personaId: p.id });
    assert.equal(hijack.ok, false);
    assert.equal(hijack.error, "not_author");
    const r = call("delete", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, p.id);
    assert.equal(call("mine", ctxA, {}).result.personas.length, 0);
    // phantom id -> clean { ok:false }, never a throw
    const phantom = call("delete", ctxA, { personaId: "persona_does_not_exist" });
    assert.equal(phantom.ok, false);
  });
});

describe("personas — never throws on missing / malformed input", () => {
  it("every lens-driven macro returns { ok:false } (not a throw) on a bad personaId", () => {
    // create/facets/mine/browse are not entity-keyed (no personaId), so a
    // bogus id is simply ignored by them — they legitimately return ok:true.
    const ENTITY_KEYED = LENS_DRIVEN.filter(
      (n) => !["create", "facets", "mine", "browse"].includes(n),
    );
    for (const name of ENTITY_KEYED) {
      const r = call(name, ctxA, { personaId: "nope" });
      assert.equal(typeof r, "object");
      assert.equal(r.ok, false, `personas.${name} should fail-soft on a missing id`);
    }
  });
});
