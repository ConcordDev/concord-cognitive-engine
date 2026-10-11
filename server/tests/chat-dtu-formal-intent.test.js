// chat.respond: an explicit DTU save is stored and named; a failed tool
// does not get replaced by retrieved notes; a PDF request is an honest no.

import { test } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";
import { PDF_CAPABILITY_MESSAGE } from "../lib/chat/dtu-save-intent.js";

test("explicit DTU save, tool failure, and PDF capability", { timeout: 180000 }, async () => {
  const { runMacro, STATE, ctx } = await macroRuntime("chat-dtu-intent");
  const stamp = Date.now();
  const title = `Sweep Note ${stamp}`;
  const body = `Body ${stamp}`;
  const sessionId = `sess-dtu-${stamp}`;

  const saved = await runMacro("chat", "respond", {
    sessionId,
    prompt: `save a DTU titled ${title} with content ${body}, then tell me its id`,
    llm: false,
  }, ctx);
  assert.equal(saved.ok, true, saved?.error || saved?.reply);
  const idMatch = String(saved.reply || "").match(/\(id:\s*([^)]+)\)/);
  assert.ok(idMatch, `reply must contain the id: ${saved.reply}`);
  const id = idMatch[1].trim();
  const titled = [...STATE.dtus.values()].filter((d) => d?.title === title);
  assert.equal(titled.length, 1, `expected one DTU titled ${title}`);
  const stored = titled[0];
  assert.equal(stored.id, id);
  assert.equal(stored.ownerId, ctx.actor.userId);
  assert.equal(stored.visibility, "private");
  assert.match(String(stored.human?.summary || ""), new RegExp(body));
  const read = await runMacro("dtu", "get", { id }, ctx);
  assert.equal(read?.ok, true, read?.error || "dtu.get failed");
  assert.equal(read.dtu?.id, id);
  assert.equal(read.dtu?.title, title);

  const prevChat = ctx.llm?.chat;
  const prevEnabled = ctx.llm?.enabled;
  ctx.llm.enabled = true;
  ctx.llm.chat = async () => ({
    ok: true,
    content: 'Open MPI 5.0 CUDA flags need --with-cuda.\n[TOOL_CALL: {"tool":"create_dtu","params":{"title":"Aside","summary":"nope"}}]',
    doneReason: "stop",
  });
  try {
    const failed = await runMacro("chat", "respond", {
      sessionId: `${sessionId}-fail`,
      prompt: "please remember this aside",
      llm: true,
    }, ctx);
    assert.equal(failed.ok, true);
    const reply = String(failed.reply || "");
    assert.match(reply, /couldn't/);
    assert.doesNotMatch(reply, /Open MPI/);
    assert.doesNotMatch(reply, /CUDA/);
    const aside = [...STATE.dtus.values()].filter((d) => d?.title === "Aside");
    assert.equal(aside.length, 0);
  } finally {
    ctx.llm.chat = prevChat;
    ctx.llm.enabled = prevEnabled;
  }

  const pdf = await runMacro("chat", "respond", {
    sessionId: `${sessionId}-pdf`,
    prompt: "Make a PDF",
    llm: false,
  }, ctx);
  assert.equal(pdf.ok, true);
  assert.equal(String(pdf.reply || "").trim(), PDF_CAPABILITY_MESSAGE);
  assert.doesNotMatch(String(pdf.reply || ""), /Based on what I know|Open MPI/);
});
