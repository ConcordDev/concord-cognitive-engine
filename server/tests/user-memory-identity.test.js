// Memory acts only for a VERIFIED identity. chat.respond receives the raw client body, so a userId inside the
// input must never select whose memory is read or written; the socket leg passes only the authenticated socket user.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifiedMemoryUserId } from "../lib/user-memory-context.js";
import * as M from "../lib/user-memory.js";
import { macroRuntime } from "./depth/_harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, "../server.js"), "utf8");

describe("verifiedMemoryUserId", () => {
  it("prefers the server-set memoryUserId, then the verified actor; never anything else", () => {
    assert.equal(verifiedMemoryUserId({ memoryUserId: "sock", actor: { userId: "act" } }), "sock");
    assert.equal(verifiedMemoryUserId({ actor: { userId: "act" } }), "act");
    assert.equal(verifiedMemoryUserId({ input: { userId: "evil" }, userId: "evil" }), null);
    assert.equal(verifiedMemoryUserId({}), null);
    assert.equal(verifiedMemoryUserId(null), null);
    assert.equal(verifiedMemoryUserId({ actor: { userId: { $ne: 1 } } }), null);
  });
});

describe("server.js wiring pins", () => {
  it("chat.respond's memory step takes its identity from the verified ctx, not the client body", () => {
    const start = src.indexOf("Per-user memory (opt-in, default off). Runs for EVERY turn");
    assert.ok(start > 0);
    const block = src.slice(start, src.indexOf("memory must never block chat", start));
    assert.ok(block.length > 200);
    assert.match(block, /_verifiedMemoryUserId\(ctx\)/);
    assert.ok(!/input\??\.userId/.test(block), "memory step must not read input.userId");
  });
  it("the private memory block is never merged into _chatMemory (whose text is persisted into a chat-memory DTU)", () => {
    assert.ok(!/_chatMemory(\.text)?\s*=[^=][^\n]*_userMemory/.test(src));
    assert.ok(!/_userMemoryMsg[^\n]*_memText|_memText[^\n]*_userMemoryMsg/.test(src));
  });
  it("the socket fallback ctx carries only the authenticated socket user for memory", () => {
    const m = src.match(/memoryUserId: ([^,\n]+),/);
    assert.ok(m);
    assert.equal(m[1].trim(), "socket.data?.userId || null");
    assert.ok(!/memoryUserId:[^\n]*handshake/.test(src));
  });
});

describe("chat.respond over the real macro (booted server)", () => {
  let runMacro, ctx, db;
  before(async () => {
    process.env.CONCORD_USER_MEMORY = "1";
    ({ runMacro, ctx } = await macroRuntime("user-memory-identity"));
    db = globalThis._concordSTATE?.db;
    assert.ok(db, "harness db");
    for (const u of ["victim", "alice"]) M.setEnabled(db, u, true);
  });

  // A stub brain so chat.respond reaches the prompt-assembly step where the memory hook lives (llm:false skips it).
  const seen = [];
  const llm = { enabled: true, chat: async (o) => { seen.push(o); return { ok: true, content: "ok" }; } };
  const respond = (input, c) => runMacro("chat", "respond", { sessionId: `s-${Math.random()}`, llm: true, ...input }, { ...c, llm });
  const rows = (u) => db.prepare("SELECT value FROM user_memory_facts WHERE user_id = ?").all(u).map((r) => r.value);

  it("a client-supplied userId cannot write into another user's memory", async () => {
    await respond({ prompt: "Remember that my codename is mallory", userId: "victim" }, { ...ctx, actor: { userId: "attacker" } });
    assert.deepEqual(rows("victim"), []);
    assert.deepEqual(rows("attacker"), []);   // attacker never opted in, so nothing is stored for them either
  });

  it("a client-supplied userId cannot ride an anonymous ctx either", async () => {
    await respond({ prompt: "Remember that my codename is mallory", userId: "victim" }, { ...ctx, actor: null });
    assert.deepEqual(rows("victim"), []);
  });

  it("the verified actor's own explicit statement IS remembered (capture really runs through chat.respond)", async () => {
    await respond({ prompt: "Remember that my codename is bluefinch" }, { ...ctx, actor: { userId: "alice" } });
    assert.ok(rows("alice").some((v) => /bluefinch/.test(v)));
  });

  it("the socket leg's ctx.memoryUserId drives the same path with no actor", async () => {
    M.setEnabled(db, "sockuser", true);
    await respond({ prompt: "Remember that I prefer short answers" }, { ...ctx, actor: null, memoryUserId: "sockuser" });
    assert.ok(rows("sockuser").some((v) => /short answers/.test(v)));
  });


  const brainSaw = () => JSON.stringify(seen.map((o) => [o.system, o.messages]));

  it("memory ON: the brain is actually shown the labelled block for the verified user (and only theirs)", async () => {
    M.remember(db, "alice", { kind: "preference", subject: "response_length", predicate: "preference", value: "I prefer zebra-striped answers", explicit: true });
    seen.length = 0;
    await respond({ prompt: "Please explain what a hash table is, briefly" }, { ...ctx, actor: { userId: "alice" } });
    assert.match(brainSaw(), /What I remember about you/);
    assert.match(brainSaw(), /zebra-striped/);
    seen.length = 0;
    await respond({ prompt: "Please explain what a hash table is, briefly" }, { ...ctx, actor: { userId: "victim" } });
    assert.ok(!/zebra-striped/.test(brainSaw()));
  });

  it("memory flag OFF: the brain input contains no memory block at all", async () => {
    delete process.env.CONCORD_USER_MEMORY;
    try {
      seen.length = 0;
      await respond({ prompt: "Please explain what a hash table is, briefly" }, { ...ctx, actor: { userId: "alice" } });
      assert.ok(seen.length > 0, "brain was called");
      assert.ok(!/What I remember about you|zebra-striped/.test(brainSaw()));
    } finally { process.env.CONCORD_USER_MEMORY = "1"; }
  });

  it("memory flag off: nothing is written for anyone", async () => {
    delete process.env.CONCORD_USER_MEMORY;
    try {
      await respond({ prompt: "Remember that my pet is a heron" }, { ...ctx, actor: { userId: "alice" } });
      assert.ok(!rows("alice").some((v) => /heron/.test(v)));
    } finally { process.env.CONCORD_USER_MEMORY = "1"; }
  });
});
