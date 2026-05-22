// Contract tests for server/domains/personas.js — from-scratch AI persona
// authoring, in-lens chat preview, marketplace browse, ratings, versioning,
// and deterministic portrait generation. Every macro is exercised; every
// handler must return { ok: boolean, ... } and never throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPersonasActions from "../domains/personas.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`personas.${name}`);
  if (!fn) throw new Error(`personas.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPersonasActions(register); });

beforeEach(() => {
  // Reset the per-process store so each describe block is isolated.
  if (globalThis._concordSTATE) delete globalThis._concordSTATE._personas;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function makePersona(ctx = ctxA, overrides = {}) {
  const r = call("create", ctx, {
    name: "Aria the Strategist",
    tagline: "A sharp tactical mind",
    personality: "Calculating, decisive, never wastes a word.",
    voice: "wise",
    greeting: "State your objective.",
    category: "mentor",
    tags: ["strategy, tactics, mentor"],
    exampleDialogue: [{ prompt: "help me plan", response: "First, define the win condition." }],
    ...overrides,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.persona;
}

describe("personas.create / mine / get", () => {
  it("creates a persona from scratch with a deterministic portrait", () => {
    const p = makePersona();
    assert.ok(p.id.startsWith("persona_"));
    assert.equal(p.name, "Aria the Strategist");
    assert.equal(p.version, 1);
    assert.equal(p.published, false);
    assert.ok(p.portrait.startsWith("data:image/svg+xml"));
    assert.deepEqual(p.tags, ["strategy", "tactics", "mentor"]);
  });

  it("rejects a create with no name", () => {
    const r = call("create", ctxA, { name: "" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });

  it("rejects a create with no actor", () => {
    const r = call("create", { actor: {} }, { name: "X" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_actor");
  });

  it("lists only the caller's own personas", () => {
    makePersona(ctxA);
    makePersona(ctxB);
    const r = call("mine", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.personas.length, 1);
    assert.equal(r.result.personas[0].name, "Aria the Strategist");
  });

  it("get returns full authored fields for the author", () => {
    const p = makePersona();
    const r = call("get", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.persona.isAuthor, true);
    assert.equal(r.result.persona.exampleDialogue.length, 1);
    assert.ok(r.result.persona.contentHash.length === 64);
  });

  it("get hides an unpublished persona from non-authors", () => {
    const p = makePersona(ctxA);
    const r = call("get", ctxB, { personaId: p.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_visible");
  });
});

describe("personas.update / delete", () => {
  it("update mutates author fields", () => {
    const p = makePersona();
    const r = call("update", ctxA, { personaId: p.id, tagline: "Updated tagline" });
    assert.equal(r.ok, true);
    assert.equal(r.result.persona.tagline, "Updated tagline");
  });

  it("update rejects a non-author", () => {
    const p = makePersona(ctxA);
    const r = call("update", ctxB, { personaId: p.id, tagline: "hack" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_author");
  });

  it("delete removes a persona for its author", () => {
    const p = makePersona();
    const r = call("delete", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(call("mine", ctxA, {}).result.personas.length, 0);
  });
});

describe("personas.publish / browse / facets", () => {
  it("publishes a persona to the marketplace", () => {
    const p = makePersona();
    const r = call("publish", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.published, true);
  });

  it("browse surfaces only published personas", () => {
    const a = makePersona(ctxA);
    makePersona(ctxB); // unpublished
    call("publish", ctxA, { personaId: a.id });
    const r = call("browse", ctxB, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.personas[0].id, a.id);
  });

  it("browse filters by tag and category", () => {
    const a = makePersona(ctxA);
    call("publish", ctxA, { personaId: a.id });
    assert.equal(call("browse", ctxA, { tag: "strategy" }).result.total, 1);
    assert.equal(call("browse", ctxA, { tag: "nonexistent" }).result.total, 0);
    assert.equal(call("browse", ctxA, { category: "mentor" }).result.total, 1);
  });

  it("facets aggregates published tags and categories", () => {
    const a = makePersona(ctxA);
    call("publish", ctxA, { personaId: a.id });
    const r = call("facets", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.tags.some((t) => t.name === "strategy"));
    assert.ok(r.result.categories.some((c) => c.name === "mentor"));
  });
});

describe("personas.chat_open / chat_send / chat_history", () => {
  it("opens a chat that starts with the greeting", () => {
    const p = makePersona();
    const r = call("chat_open", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.chatId.startsWith("chat_"));
    assert.equal(r.result.turns[0].role, "persona");
    assert.equal(r.result.turns[0].text, "State your objective.");
  });

  it("chat_send returns a reply composed from persona data", () => {
    const p = makePersona();
    const open = call("chat_open", ctxA, { personaId: p.id });
    const r = call("chat_send", ctxA, { chatId: open.result.chatId, message: "what is your edge" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reply.role, "persona");
    assert.ok(r.result.reply.text.length > 0);
    assert.ok(["composed_from_persona", "example_dialogue"].includes(r.result.reply.basis));
  });

  it("chat_send surfaces an exact authored example response on echo", () => {
    const p = makePersona();
    const open = call("chat_open", ctxA, { personaId: p.id });
    const r = call("chat_send", ctxA, { chatId: open.result.chatId, message: "help me plan a raid" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reply.basis, "example_dialogue");
    assert.equal(r.result.reply.text, "First, define the win condition.");
  });

  it("chat_send rejects an empty message", () => {
    const p = makePersona();
    const open = call("chat_open", ctxA, { personaId: p.id });
    const r = call("chat_send", ctxA, { chatId: open.result.chatId, message: "  " });
    assert.equal(r.ok, false);
    assert.equal(r.error, "empty_message");
  });

  it("chat_history returns the full transcript", () => {
    const p = makePersona();
    const open = call("chat_open", ctxA, { personaId: p.id });
    call("chat_send", ctxA, { chatId: open.result.chatId, message: "hello" });
    const r = call("chat_history", ctxA, { chatId: open.result.chatId });
    assert.equal(r.ok, true);
    assert.equal(r.result.turns.length, 3);
  });

  it("chat_send rejects a non-owner", () => {
    const p = makePersona(ctxA);
    call("publish", ctxA, { personaId: p.id });
    const open = call("chat_open", ctxA, { personaId: p.id });
    const r = call("chat_send", ctxB, { chatId: open.result.chatId, message: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_chat_owner");
  });
});

describe("personas.rate / stats / install", () => {
  it("a non-author can rate a published persona", () => {
    const p = makePersona(ctxA);
    call("publish", ctxA, { personaId: p.id });
    const r = call("rate", ctxB, { personaId: p.id, stars: 4, review: "solid" });
    assert.equal(r.ok, true);
    assert.equal(r.result.rating, 4);
    assert.equal(r.result.ratingCount, 1);
  });

  it("rejects an author rating their own persona", () => {
    const p = makePersona(ctxA);
    call("publish", ctxA, { personaId: p.id });
    const r = call("rate", ctxA, { personaId: p.id, stars: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_rate_own");
  });

  it("install increments the install count", () => {
    const p = makePersona(ctxA);
    call("publish", ctxA, { personaId: p.id });
    const r = call("install", ctxB, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.installCount, 1);
  });

  it("stats reports installs, chats, rating distribution", () => {
    const p = makePersona(ctxA);
    call("publish", ctxA, { personaId: p.id });
    call("install", ctxB, { personaId: p.id });
    call("rate", ctxB, { personaId: p.id, stars: 5 });
    const r = call("stats", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.installCount, 1);
    assert.equal(r.result.ratingCount, 1);
    assert.equal(r.result.distribution.length, 5);
    assert.equal(r.result.distribution[4].count, 1);
  });
});

describe("personas.revise / versions", () => {
  it("revise snapshots the prior version and bumps the version number", () => {
    const p = makePersona(ctxA);
    call("publish", ctxA, { personaId: p.id });
    call("install", ctxB, { personaId: p.id });
    const r = call("revise", ctxA, {
      personaId: p.id, greeting: "New greeting.", changelog: "Reworked greeting",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.version, 2);
    assert.equal(r.result.installersNotified, 1);
    assert.equal(r.result.changelog, "Reworked greeting");
  });

  it("versions lists history plus the current version", () => {
    const p = makePersona(ctxA);
    call("revise", ctxA, { personaId: p.id, changelog: "v2" });
    const r = call("versions", ctxA, { personaId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.current, 2);
    assert.equal(r.result.versions.length, 2);
    assert.equal(r.result.versions[r.result.versions.length - 1].changelog, "current");
  });
});

describe("personas.regenerate_portrait", () => {
  it("regenerates a deterministic portrait", () => {
    const p = makePersona(ctxA);
    const r = call("regenerate_portrait", ctxA, { personaId: p.id, seedToken: "abc" });
    assert.equal(r.ok, true);
    assert.ok(r.result.portrait.startsWith("data:image/svg+xml"));
  });

  it("accepts an uploaded data-URI portrait", () => {
    const p = makePersona(ctxA);
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    const r = call("regenerate_portrait", ctxA, { personaId: p.id, dataUri });
    assert.equal(r.ok, true);
    assert.equal(r.result.portrait, dataUri);
  });

  it("rejects a non-author", () => {
    const p = makePersona(ctxA);
    const r = call("regenerate_portrait", ctxB, { personaId: p.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_author");
  });
});

describe("personas — never throws on missing entities", () => {
  it("every macro returns ok:false (not a throw) for a bad personaId", () => {
    const names = ["update", "get", "delete", "publish", "chat_open", "rate",
      "stats", "install", "revise", "versions", "regenerate_portrait"];
    for (const n of names) {
      const r = call(n, ctxA, { personaId: "persona_missing" });
      assert.equal(r.ok, false, `${n} should fail gracefully`);
      assert.ok(typeof r.error === "string");
    }
  });
});
