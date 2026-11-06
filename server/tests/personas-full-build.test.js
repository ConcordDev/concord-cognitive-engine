// Personas full build (B6) — the object's state-keeping legs:
//   S2 / F2 — the stored voice is READABLE: publicView carries voice, so
//   the editor no longer defaults 'warm' and overwrites it on save.
//   S3 / F3 — the ordinary update path mints versions like revise does.
//   S4 / F4 — the "chats" counter counts a chat's first SENT message,
//   once per chat; opening a chat counts nothing.
// Echo replies (authored example dialogue) exercise chat_send without a
// model, exactly as the surface's labelled EXAMPLE DIALOGUE path does.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let actions;
const AUTHOR = { actor: { userId: "author-1" } };
const GUEST = { actor: { userId: "guest-1" } };

async function call(name, ctx, params) {
  const fn = actions.get(`personas:${name}`);
  assert.ok(fn, `action personas.${name} registered`);
  return fn(ctx, {}, params);
}

before(async () => {
  globalThis._concordSTATE = {};
  const mod = await import("../domains/personas.js");
  actions = new Map();
  mod.default((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
});

async function makePersona(ctx = AUTHOR) {
  const r = await call("create", ctx, {
    name: "Sage of Tests",
    voice: "wise",
    personality: "Measured and exact.",
    greeting: "Greetings, tester.",
    exampleDialogue: [{ prompt: "hello sage", response: "Well met, tester." }],
  });
  assert.equal(r.ok, true);
  return r.result.persona;
}

describe("personas full build", () => {
  it("S2: the stored voice rides every read view (create returns it, mine lists it)", async () => {
    const p = await makePersona();
    assert.equal(p.voice, "wise");
    const mine = await call("mine", AUTHOR, {});
    const row = mine.result.personas.find((x) => x.id === p.id);
    assert.equal(row.voice, "wise");
    const detail = await call("get", AUTHOR, { personaId: p.id });
    assert.equal(detail.result.persona.voice, "wise");
  });

  it("S3: an ordinary update mints a version — v2 with a two-entry history", async () => {
    const p = await makePersona();
    const upd = await call("update", AUTHOR, { personaId: p.id, tagline: "Second thoughts" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.persona.version, 2);
    const versions = await call("versions", AUTHOR, { personaId: p.id });
    assert.equal(versions.result.current, 2);
    assert.equal(versions.result.versions.length, 2);
    assert.equal(versions.result.versions[0].version, 1);
    assert.equal(versions.result.versions[0].changelog, "edit");
    assert.equal(versions.result.versions[1].changelog, "current");
  });

  it("S4: opens count nothing; a chat counts once, at its first sent message", async () => {
    const p = await makePersona();
    await call("publish", AUTHOR, { personaId: p.id, published: true });

    const opened = await call("chat_open", GUEST, { personaId: p.id });
    assert.equal(opened.ok, true);
    let stats = await call("stats", GUEST, { personaId: p.id });
    assert.equal(stats.result.chatCount, 0);

    const sent = await call("chat_send", GUEST, { chatId: opened.result.chatId, message: "hello sage" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.reply.text, "Well met, tester.");
    stats = await call("stats", GUEST, { personaId: p.id });
    assert.equal(stats.result.chatCount, 1);

    const sent2 = await call("chat_send", GUEST, { chatId: opened.result.chatId, message: "hello sage" });
    assert.equal(sent2.ok, true);
    stats = await call("stats", GUEST, { personaId: p.id });
    assert.equal(stats.result.chatCount, 1);

    // A second chat that is only opened still counts nothing.
    await call("chat_open", GUEST, { personaId: p.id });
    stats = await call("stats", GUEST, { personaId: p.id });
    assert.equal(stats.result.chatCount, 1);
  });
});
