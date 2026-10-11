// Explicit "save a DTU titled …" is formal intent, and a failed chat tool
// is answered from the tool result — not from the pre-tool assistant draft.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExplicitDtuSave,
  isExplicitDtuSaveIntent,
  isPdfCreateRequest,
  PDF_CAPABILITY_MESSAGE,
  explicitDtuCreateInput,
} from "../lib/chat/dtu-save-intent.js";
import {
  composeToolTurnReply,
  shouldSkipToolFollowup,
  toolFollowUpUserMessage,
  followUpFailureReply,
} from "../lib/chat/tool-turn-reply.js";
import { classifyIntent } from "../lib/chat/intent-router.js";
import { ConcordSoSRuntime } from "../lib/csl-core.js";
import { createCslToolGate } from "../lib/csl-router.js";

const REPRO = 'save a DTU titled Sweep Note with content Body of the note, then tell me its id';

test("parseExplicitDtuSave keeps the title and drops the 'then tell me' tail", () => {
  const parsed = parseExplicitDtuSave(REPRO);
  assert.deepEqual(parsed, { title: "Sweep Note", content: "Body of the note" });
  assert.equal(isExplicitDtuSaveIntent(REPRO), true);
  assert.equal(isExplicitDtuSaveIntent("don't create a DTU titled X with content Y"), false);
  assert.equal(parseExplicitDtuSave("don't save a DTU titled X with content Y"), null);
});

test("a PDF request is a capability statement, and a DTU save is not one", () => {
  assert.equal(isPdfCreateRequest("Make a PDF"), true);
  assert.equal(isPdfCreateRequest("create a pdf of this note"), true);
  assert.equal(isPdfCreateRequest(REPRO), false);
  assert.equal(PDF_CAPABILITY_MESSAGE, "I can't create PDFs yet; use Export/Print.");
});

test("explicit DTU input is private, chat-owned, and carries the body as a claim", () => {
  const input = explicitDtuCreateInput({ title: "Sweep Note", content: "Body of the note" }, "sess");
  assert.equal(input.visibility, "private");
  assert.equal(input.source, "chat_tool");
  assert.equal(input.domain, "chat");
  assert.equal(input.lens, "chat");
  assert.deepEqual(input.core.claims, ["Body of the note"]);
  assert.equal(input.human.summary, "Body of the note");
  assert.equal(input.consent.allowCitations, false);
});

test("a failed tool reply says couldn't and does not carry the pre-tool draft", () => {
  const results = [{ tool: "create_dtu", ok: false, error: "not_formal_intent" }];
  assert.equal(shouldSkipToolFollowup(results), true);
  const reply = composeToolTurnReply(results);
  assert.match(reply, /couldn't/);
  assert.doesNotMatch(reply, /Open MPI|CUDA/);
  const follow = toolFollowUpUserMessage("please remember this aside", "[TOOL_RESULT: create_dtu] Error: not_formal_intent");
  assert.doesNotMatch(follow, /Open MPI/);
  assert.match(follow, /couldn't/);
  assert.match(followUpFailureReply(results, "err"), /couldn't/);
});

test("classifyIntent treats save-a-DTU as tool-action", () => {
  const r = classifyIntent(REPRO);
  assert.equal(r.intent, "tool-action");
  assert.equal(r.domainHint, "dtu");
});

test("executeTurn accepts an explicit DTU save even when turnText is tool-params JSON", async () => {
  let macroCalls = 0;
  const runtime = new ConcordSoSRuntime({
    db: null,
    lensActions: [],
    runMacro: async () => { macroCalls += 1; return { ok: true, id: "should-not-mint" }; },
  });
  try {
    const r = await runtime.executeTurn({
      sessionId: "s-dtu-save",
      turnText: JSON.stringify({ title: "Aside", summary: "nope" }),
      userPrompt: REPRO,
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "formal_dtu_save");
    assert.equal(macroCalls, 0);
    assert.equal(r.proofArtifact.obligations.intentRoutingCorrectness.sat, true);
  } finally {
    runtime.stopLockSweep();
  }
});

test("a language turn is still not_formal_intent", async () => {
  const runtime = new ConcordSoSRuntime({
    db: null,
    lensActions: [],
    runMacro: async () => { throw new Error("macro must not run"); },
  });
  try {
    const r = await runtime.executeTurn({ sessionId: "s-sky", turnText: "why is the sky blue?" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_formal_intent");
  } finally {
    runtime.stopLockSweep();
  }
});

test("the CSL tool gate forwards the user sentence and surfaces not_formal_intent", async () => {
  let seen = null;
  const gate = createCslToolGate({
    userText: REPRO,
    runCsl: async (turnText, ctx) => {
      seen = { turnText, userPrompt: ctx.userPrompt };
      return { ok: false, reason: "not_formal_intent" };
    },
  });
  const rejected = await gate({ tool: "create_dtu", params: { title: "Aside" } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "not_formal_intent");
  assert.equal(seen.userPrompt, REPRO);
  assert.match(seen.turnText, /Aside/);
});
