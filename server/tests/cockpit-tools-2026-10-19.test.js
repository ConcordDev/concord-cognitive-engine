// Cockpit audit 2026-10-19 (Concord chat / ConKay / agent mode):
// recoverable tool failures, affirmation/status/remember routes, 3D/CAD
// routing, compute keys, run_python offering, generate_3d.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Document, NodeIO } from "@gltf-transform/core";

import { shouldSkipToolFollowup, isRecoverableToolFailure, recoveryHint } from "../lib/chat/tool-turn-reply.js";
import { executeToolCall, runAgentLoop, toolSchemaBlockFor, pythonToolAvailable, TOOL_SCHEMA_BLOCK, wants3dModel } from "../lib/chat-agent.js";
import { chatAgentRoute, deterministicRouteReply, continueAgentMessage, webAgentMessage, stripAffirmation, isBareAffirmation } from "../lib/chat/agent-route.js";
import { explicitImagePrompt } from "../lib/chat/image-router.js";
import { parseRememberAsk, recallRemembered, isRecallAsk } from "../lib/chat/session-memory.js";
import { conkayTurnPlan } from "../lib/conkay/agent-turn.js";
import { buildConceptAssembly, conceptKind } from "../lib/conkay/concept-assembly.js";
import { generate3dFromPrompt, glbToTriangles, decimateMesh } from "../lib/chat/generate-3d.js";

// ── 1. keep going after recoverable failures ────────────────────────────────
test("ordinary failures are recoverable; policy/auth failures are not", () => {
  for (const error of [
    "unknown compute function physics.length.convert",
    "unsupported part — recognised parts: beam, bracket",
    "DTU not found",
    "HTTP 404",
    "browse_url failed: timeout",
    "code_exec_forbidden",
    "python_exec_failed",
  ]) {
    assert.equal(isRecoverableToolFailure({ ok: false, tool: "x", error }), true, error);
    assert.equal(shouldSkipToolFollowup([{ ok: false, tool: "x", error }], { allowRetry: true }), false, error);
    assert.equal(shouldSkipToolFollowup([{ ok: false, tool: "x", error }], { allowRetry: false }), true, error);
  }
  assert.equal(isRecoverableToolFailure({ ok: false, error: "forbidden_by_governance" }), false);
  assert.equal(isRecoverableToolFailure({ ok: false, error: "operator_only" }), false);
  assert.equal(shouldSkipToolFollowup([{ ok: false, error: "something exploded" }], { allowRetry: true }), true);
});

test("recoveryHint names a concrete next step", () => {
  assert.match(recoveryHint({ tool: "run_lens_action", domain: "dtu", error: "DTU not found" }), /different hit/);
  assert.match(recoveryHint({ tool: "run_python", error: "code_exec_forbidden" }), /run_compute/);
  assert.match(recoveryHint({ tool: "browse_url", error: "HTTP 403" }), /another result URL/);
  assert.match(recoveryHint({ tool: "conkay_design", error: "unsupported part" }), /parametricSolid|partMesh/);
});

test("agent loop retries with another tool after an invented compute key, then answers", async () => {
  let n = 0;
  const seen = [];
  const brain = async ({ messages }) => {
    n++;
    seen.push(messages[messages.length - 1].content);
    if (n === 1) return { ok: true, text: '[TOOL_CALL: {"tool":"run_compute","params":{"key":"finance.compoundInterest","input":{"principal":5000}}}]', provider: "t", model: "t" };
    if (n === 2) return { ok: true, text: '[TOOL_CALL: {"tool":"run_compute","params":{"key":"symbolic.evaluate","input":{"expression":"5000*(1+0.06)^10"}}}]', provider: "t", model: "t" };
    return { ok: true, text: "About $8954.24.", provider: "t", model: "t" };
  };
  const r = await runAgentLoop({ db: null, userId: "u1", message: "5000 at 6% for 10 years", runMacro: null, lensActions: new Map(), history: [],
    opts: { maxTurns: 6, brainChat: brain, shadowContext: false, actionMemory: false, deepen: false } });
  assert.equal(r.ok, true);
  assert.equal(n, 3);
  assert.match(seen[1], /Valid compute keys: .*symbolic\.evaluate/);
  assert.equal(r.toolCalls[0].ok, false);
  assert.equal(r.toolCalls[1].ok, true);
  assert.match(r.answer, /8954/);
});

test("recoveries are capped: an always-failing tool ends after the cap", async () => {
  let n = 0;
  const brain = async () => { n++; return { ok: true, text: `[TOOL_CALL: {"tool":"run_compute","params":{"key":"made.up${n}","input":{"a":1}}}]`, provider: "t", model: "t" }; };
  const r = await runAgentLoop({ db: null, userId: "u1", message: "x", runMacro: null, lensActions: new Map(), history: [],
    opts: { maxTurns: 8, brainChat: brain, shadowContext: false, actionMemory: false, deepen: false } });
  assert.equal(n, 3, "1 attempt + 2 recovery turns");
  assert.match(r.answer, /couldn't complete run_compute/);
});

// ── 2. affirmation / websearch / what happened ──────────────────────────────
test("'Yes run it' after an offer or a tool turn re-runs the planned action", () => {
  assert.equal(chatAgentRoute("Yes run it", { prevReply: "Brief ready. Want me to run conkay_design.from-brief on it?" }), "continue");
  assert.equal(chatAgentRoute("Yes run it", { prevRoute: "design", prevReply: "Here's the design." }), "continue");
  assert.equal(chatAgentRoute("go ahead", { prevReply: "I can generate a 3D model of it." }), "continue");
  assert.equal(chatAgentRoute("try again", { prevRoute: "design", prevReply: "I couldn't complete conkay_design." }), "continue");
  // Acknowledgements are not go-aheads.
  assert.equal(chatAgentRoute("ok", { prevRoute: "web", prevReply: "Here are the results." }), null);
  assert.equal(chatAgentRoute("yes", {}), null);
  // "Yes <ask>": the ask is routed.
  assert.equal(stripAffirmation("Yes generate a 3d model"), "generate a 3d model");
  assert.equal(isBareAffirmation("Yes generate a 3d model"), false);
  assert.equal(chatAgentRoute("Yes generate a 3d model", {}), "design");
  const msg = continueAgentMessage("Yes run it", [{ role: "user", content: "design a 2 m steel cantilever, 5 kN tip" }, { role: "assistant", content: "Want me to run it?" }]);
  assert.match(msg, /design a 2 m steel cantilever/);
  assert.match(msg, /do not ask again/);
});

test("'websearch' one word and 'do research' go to web search with the earlier topic", () => {
  assert.equal(chatAgentRoute("use websearch if you needa learn", {}), "web");
  assert.equal(chatAgentRoute("do research", {}), "web");
  assert.match(webAgentMessage("do research", [{ role: "user", content: "best budget 3d printers" }]), /search the web for: best budget 3d printers/);
});

test("'What happened?' after a failure is a status report, not a web search", () => {
  const prev = "I couldn't complete run_lens_action: not_formal_intent.";
  assert.equal(chatAgentRoute("What happened?", { prevReply: prev }), "status");
  assert.notEqual(chatAgentRoute("What happened?", { prevReply: "Here are today's headlines." }), "status");
  const reply = deterministicRouteReply("status", "What happened?", [{ role: "assistant", content: prev }]);
  assert.match(reply, /not_formal_intent/);
  assert.match(reply, /try again/);
});

// ── 3. 3D / CAD routing ─────────────────────────────────────────────────────
test("3D / CAD / STL asks never reach the 2D image router", () => {
  for (const t of ["Yes generate a 3d model", "make a 3d model of a dragon", "make a CAD model of a phone stand", "generate an STL of a hook"]) {
    assert.equal(explicitImagePrompt(t), null, t);
  }
  assert.ok(explicitImagePrompt("generate an image of a red bike"));
  assert.equal(chatAgentRoute("make a CAD model of a phone stand", {}), "design");
  assert.equal(chatAgentRoute("design a gearbox", {}), "design");
  assert.equal(wants3dModel("make a 3d printable phone stand"), true);
  assert.equal(wants3dModel("make a picture of a cat"), false);
});

test("generate_image refuses a 3D ask and points at conkay_design / generate_3d", async () => {
  const r = await executeToolCall({ userPrompt: "generate a 3d model of a phone stand" }, null, new Map(), { tool: "generate_image", params: { prompt: "phone stand" } });
  assert.equal(r.ok, false);
  assert.match(r.retryHint, /conkay_design/);
  assert.match(r.retryHint, /generate_3d/);
});

test("conkay_design returns a concept 3D assembly for phone stand / truss / gearbox", async () => {
  for (const [text, kind] of [["make a CAD model of a phone stand", "phone-stand"], ["design a truss 4 m span", "truss"], ["3d model of a 4:1 gearbox", "gearbox"]]) {
    assert.equal(conceptKind(text), kind);
    const r = await executeToolCall({ userPrompt: text }, null, new Map(), { tool: "conkay_design", params: { text } });
    assert.equal(r.ok, true, text);
    assert.equal(r.artifact.kind, "mesh");
    assert.ok(r.artifact.positions.length >= 9 && r.artifact.indices.length >= 3);
    assert.ok(r.result.parts.length >= 3);
    assert.match(r.result.instruction, /concept/);
  }
  assert.equal(buildConceptAssembly("a dragon"), null);
});

test("ConKay plan: CAD → conkay_design, free-form 3D → generate_3d, yes → last brief", () => {
  assert.equal(conkayTurnPlan("make a CAD model of a phone stand", []).fallbackCall.tool, "conkay_design");
  assert.equal(conkayTurnPlan("generate a 3d model of a dragon", []).fallbackCall.tool, "generate_3d");
  const H = [{ role: "user", content: "design a steel cantilever bracket 300 mm long holding 2 kN" }, { role: "assistant", content: "Want me to run it through conkay_design.from-brief?" }];
  const p = conkayTurnPlan("Yes run it", H);
  assert.equal(p.route, "continue");
  assert.deepEqual(p.fallbackCall, { tool: "conkay_design", params: { text: H[0].content } });
  assert.match(p.message, /Carry out the action/);
});

async function tinyGlb() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])).setBuffer(buf);
  const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3])).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh).setTranslation([0, 2, 0]);
  doc.createScene().addChild(node);
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

test("generate_3d: pod concept + mesh → decimated mesh artifact data", async () => {
  const glb = await tinyGlb();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    const body = String(url).endsWith("/concept") ? { ok: true, png_b64: "iVBORw0KGgo=" } : { ok: true, glb_b64: glb.toString("base64"), provider: "local-gpu:TRELLIS", faces: 4 };
    return { json: async () => body };
  };
  const r = await generate3dFromPrompt("a small owl", { fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((u) => u.replace(/^.*\//, "/")), ["/concept", "/mesh"]);
  assert.equal(r.mesh.triangleCount, 4);
  assert.equal(Math.max(...r.mesh.positions.filter((_, i) => i % 3 === 1)), 3, "node translation applied");
  const tri = await glbToTriangles(glb);
  const d = await decimateMesh(tri, 2);
  assert.ok(d.triangleCount <= 4);
});

test("generate_3d: a broken pod mesh engine is an honest failure, never a placeholder", async () => {
  const fetchImpl = async (url) => ({ json: async () => (String(url).endsWith("/concept") ? { ok: true, png_b64: "iVBORw0KGgo=" } : { ok: false, reason: "generation_error", error: "ModuleNotFoundError: No module named 'trellis'" }) });
  const r = await generate3dFromPrompt("a small owl", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "mesh");
  assert.match(r.error, /unavailable/);
});

// ── 4. compute keys ─────────────────────────────────────────────────────────
test("run_compute: unknown key with an expression runs symbolic.evaluate", async () => {
  const r = await executeToolCall({}, null, new Map(), { tool: "run_compute", params: { key: "finance.compound_interest", input: { expression: "5000*(1+0.06)^10" } } });
  assert.equal(r.ok, true);
  assert.equal(r.key, "symbolic.evaluate");
  assert.match(JSON.stringify(r.result), /8954/);
});

test("run_compute: unknown key without an expression lists valid keys", async () => {
  const r = await executeToolCall({}, null, new Map(), { tool: "run_compute", params: { key: "physics.length.convert", input: { value: 3 } } });
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown compute function/);
  assert.ok(r.validKeys.includes("symbolic.evaluate"));
  assert.ok(r.validKeys.some((k) => k.startsWith("physics.")));
  assert.match(r.retryHint, /symbolic\.evaluate/);
});

// ── 5. run_python offering ──────────────────────────────────────────────────
test("run_python is offered only to callers who can run it", () => {
  const env = { CONCORD_POD_JOBS: "1", CONCORD_PYTHON_EXEC_ENABLED: "0" };
  assert.equal(pythonToolAvailable("member", env), false);
  assert.equal(pythonToolAvailable("founder", env), true);
  assert.equal(pythonToolAvailable("founder", { CONCORD_POD_JOBS: "0" }), false);
  const member = toolSchemaBlockFor({ role: "member", env });
  assert.doesNotMatch(member, /^- run_python:/m);
  assert.match(member, /run_python is NOT available/);
  assert.equal(toolSchemaBlockFor({ role: "founder", env }), TOOL_SCHEMA_BLOCK);
});

test("run_python called anyway by a member is a soft, retryable refusal", async () => {
  const r = await executeToolCall({ actor: { userId: "m", role: "member" } }, null, new Map(), { tool: "run_python", params: { code: "print(1)" } });
  assert.equal(r.ok, false);
  assert.equal(isRecoverableToolFailure(r), true);
});

// ── 7. PLUM-77 memory ───────────────────────────────────────────────────────
test("'Remember codeword X' stores; 'What codeword…' recalls, not web search", () => {
  assert.equal(chatAgentRoute("Remember codeword PLUM-77", {}), "remember");
  assert.deepEqual(parseRememberAsk("Remember codeword PLUM-77"), { fact: "codeword PLUM-77", label: "codeword", value: "PLUM-77" });
  assert.match(deterministicRouteReply("remember", "Remember codeword PLUM-77", []), /PLUM-77/);
  assert.equal(isRecallAsk("What codeword did I give you?"), true);
  assert.equal(chatAgentRoute("What codeword did I give you?", {}), "recall");
  const h = [{ role: "user", content: "Remember codeword PLUM-77" }, { role: "assistant", content: "Got it." }, { role: "user", content: "what's the weather" }];
  assert.equal(deterministicRouteReply("recall", "What codeword did I give you?", h), "The codeword you gave me is PLUM-77.");
  // From the chat memory note when the turn fell out of the replayed window.
  const mem = "What the user told you (their words):\n- turn 3: Remember codeword PLUM-77";
  assert.equal(recallRemembered("what was the codeword", [], mem).value, "PLUM-77");
  assert.equal(parseRememberAsk("remember this as a note: buy milk"), null);
  assert.equal(parseRememberAsk("do you remember my name?"), null);
});
