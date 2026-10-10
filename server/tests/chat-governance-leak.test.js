// server/tests/chat-governance-leak.test.js
//
// INC-20261010-10. A conversational completion appended the GRC object
// (toneLock / anchor / invariants / reality) after the sentence. The
// whole-reply JSON guard does not see that shape, so the scaffold was
// stored and returned. These tests drive the same helpers chat.respond
// and the socket token path call, then a live chat.respond turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stripGovernanceScaffold,
  createGovernanceStreamFilter,
} from "../lib/chat-reply-policy.js";
import { jsonOnlyReply } from "../lib/chat-v6-contract.js";
import { macroRuntime } from "./depth/_harness.js";

const PROSE = "Paris is the capital of France. OK.";

const SCAFFOLD = `{
  "toneLock": "Confirmed.",
  "anchor": {
    "dtus": [],
    "macros": [],
    "stateRefs": [],
    "mode": "governed-response"
  },
  "invariants": ["NoNegativeValence", "RealityGateBeforeEffects", "DirectAnswerFirst"],
  "reality": {
    "facts": ["Paris is the capital of France."],
    "assumptions": [],
    "unknowns": []
  },
  "payload": "Paris is the capital of France. OK.",
  "nextLoop": { "name": "done", "why": "answered" },
  "question": "Anything else?"
}`;

const TRUNCATED = `${PROSE}

{
  "toneLock": "Confirmed.",
  "anchor": {
    "dtus": [],
    "macros": [],
    "stateRefs": [],
    "mode": "governed-response"
  },
  "invariants": ["NoNegativeValence", "RealityGateBeforeEffects", "DirectAnswerFirst"],
  "reality": {`;

const FENCED = `${PROSE}

\`\`\`json
{
  "capital": "Paris",
  "country": "France"
}
\`\`\``;

const serverSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");
const routeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes", "chat.js"), "utf8");

function streamCompletion(raw, size) {
  const filter = createGovernanceStreamFilter();
  const chunks = [];
  const step = size || 11;
  for (let i = 0; i < raw.length; i += step) {
    const delta = filter.push(raw.slice(i, i + step));
    if (delta) chunks.push(delta);
  }
  const done = filter.finish();
  if (done.delta) chunks.push(done.delta);
  return { chunks, text: done.text };
}

function httpChunks(reply, step = 220) {
  const chunks = [];
  const content = String(reply || "");
  for (let i = 0; i < content.length; i += step) chunks.push(content.slice(i, i + step));
  return chunks;
}

function leaked(text) {
  return /toneLock|governed-response|NoNegativeValence|RealityGateBeforeEffects|DirectAnswerFirst/.test(text);
}

test("a prose reply plus a trailing scaffold is not caught by the whole-reply JSON guard", () => {
  const raw = `${PROSE}\n\n${SCAFFOLD}`;
  assert.equal(jsonOnlyReply(raw), null);
  assert.equal(jsonOnlyReply(TRUNCATED), null);
  assert.equal(leaked(raw), true);
});

test("non-stream chat reply keeps the sentence and drops a complete or truncated scaffold", () => {
  assert.equal(stripGovernanceScaffold(`${PROSE}\n\n${SCAFFOLD}`), PROSE);
  assert.equal(stripGovernanceScaffold(TRUNCATED), PROSE);
  assert.equal(stripGovernanceScaffold(`${PROSE}\n\n${SCAFFOLD}\n\nWant a longer note?`), `${PROSE}\n\nWant a longer note?`);
  assert.equal(stripGovernanceScaffold(SCAFFOLD), PROSE);
  assert.equal(leaked(stripGovernanceScaffold(`${PROSE}\n\n${SCAFFOLD}`)), false);
  assert.equal(leaked(stripGovernanceScaffold(TRUNCATED)), false);
});

test("streamed chunks of the same completion never include the scaffold", () => {
  for (const raw of [`${PROSE}\n\n${SCAFFOLD}`, TRUNCATED]) {
    for (const size of [1, 7, 40, raw.length]) {
      const streamed = streamCompletion(raw, size);
      assert.equal(streamed.text, PROSE, `finish text at size ${size}`);
      assert.equal(streamed.chunks.join("").trim(), PROSE);
      for (const chunk of streamed.chunks) assert.equal(leaked(chunk), false, chunk);
    }
    const reply = stripGovernanceScaffold(raw);
    const chunks = httpChunks(reply);
    assert.equal(chunks.join(""), reply);
    for (const chunk of chunks) assert.equal(leaked(chunk), false);
  }
});

test("a user-requested JSON code block is preserved, including beside a scaffold", () => {
  assert.equal(stripGovernanceScaffold(FENCED), FENCED);
  const fencedStream = streamCompletion(FENCED, 9);
  assert.equal(fencedStream.text, FENCED);
  assert.equal(fencedStream.chunks.join(""), FENCED);

  const mixed = `${FENCED}\n\n${SCAFFOLD}`;
  const cleaned = stripGovernanceScaffold(mixed);
  assert.match(cleaned, /"capital": "Paris"/);
  assert.match(cleaned, /```json/);
  assert.equal(leaked(cleaned), false);
  const mixedStream = streamCompletion(mixed, 13);
  assert.equal(mixedStream.text, cleaned);
  for (const chunk of mixedStream.chunks) assert.equal(leaked(chunk), false);

  const bare = `{"capital":"Paris","country":"France"}`;
  assert.equal(stripGovernanceScaffold(bare), bare);
  assert.equal(streamCompletion(bare, 3).text, bare);
  assert.equal(stripGovernanceScaffold("The set is {about} five."), "The set is {about} five.");
  const toneWord = '{"note":"toneLock is an internal field","capital":"Paris"}';
  assert.equal(stripGovernanceScaffold(toneWord), toneWord);
});

test("chat.respond and the socket stream both strip before the user sees the text", () => {
  const pushAt = serverSrc.indexOf("qualityPipeline: _qpMeta, dtuCount: _pipelineDtuCount");
  const stripAt = serverSrc.lastIndexOf("stripGovernanceScaffold(finalReply)", pushAt);
  assert.ok(stripAt > 0 && stripAt < pushAt);
  assert.match(serverSrc, /createGovernanceStreamFilter\(\)/);
  assert.match(serverSrc, /_emitGovToken\(token\)/);
  assert.match(serverSrc, /streamResult\.content = _cleanStream \|\| _govDone\.text/);
  assert.match(serverSrc, /stripGovernanceScaffold\(String\(reply\)\)/);
  assert.match(routeSrc, /out\?\.reply \|\| out\?\.content/);
  assert.match(serverSrc, /GRC_MODULE && !_conversationalChat/);
});

test("a live chat.respond turn stores and returns only the prose", async () => {
  const { runMacro, STATE, ctx } = await macroRuntime("chat-grc-leak");
  let seenSystem = "";
  ctx.llm = {
    enabled: true,
    chat: async (opts) => {
      seenSystem = String(opts?.system || "");
      return { ok: true, content: `${PROSE}\n\n${SCAFFOLD}`, doneReason: "stop" };
    },
  };
  const sessionId = "watchdog-WD37797";
  const turned = await runMacro("chat", "respond", {
    sessionId,
    message: "WD37797: In one sentence, what is the capital of France? End with OK.",
    mode: "chat",
    llm: true,
  }, ctx);
  assert.equal(turned.ok, true);
  assert.equal(seenSystem.includes('"toneLock"'), false);
  assert.equal(turned.reply, PROSE);
  assert.equal(leaked(turned.reply), false);
  const sess = STATE.sessions.get(sessionId);
  const stored = [...(sess?.messages || [])].reverse().find((m) => m.role === "assistant");
  assert.equal(stored?.content, PROSE);

  const fencedSession = "watchdog-WD37797-json";
  ctx.llm.chat = async () => ({ ok: true, content: FENCED, doneReason: "stop" });
  const kept = await runMacro("chat", "respond", {
    sessionId: fencedSession,
    message: "Give me that as a JSON code block.",
    mode: "chat",
    llm: true,
  }, ctx);
  assert.equal(kept.reply, FENCED);
  const fencedStored = [...(STATE.sessions.get(fencedSession)?.messages || [])].reverse().find((m) => m.role === "assistant");
  assert.equal(fencedStored?.content, FENCED);

  const streamed = streamCompletion(turned.reply + "\n\n" + SCAFFOLD, 5);
  assert.equal(streamed.text, PROSE);
  for (const chunk of httpChunks(turned.reply)) assert.equal(leaked(chunk), false);
});
