// Pins the pure parts of scripts/chat-harness: SSE parsing, redaction, classification, case-table integrity.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSse, summarizeStream, redact, classify, renderSummary, summarizeResults } from "../../scripts/chat-harness/lib.mjs";
import { DIRECT, CHAT, MCP_READ_ONLY, MCP_NEVER_CALL } from "../../scripts/chat-harness/cases.mjs";

test("parseSse + summarizeStream read progress, chunks and the final envelope", () => {
  const body = [
    { ok: true, progress: { stage: "accepted" }, done: false },
    { ok: true, progress: { stage: "tool", tool: "run_compute" }, done: false },
    { ok: true, chunk: "Depth is ", done: false },
    { ok: true, done: true, out: { ok: true, reply: "Depth is 125 mm", untracedNumbers: [] } },
  ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const s = summarizeStream(parseSse(body));
  assert.equal(s.reply, "Depth is 125 mm");
  assert.deepEqual(s.tools, ["run_compute"]);
  assert.equal(s.done, true);
  assert.equal(parseSse("data: {broken\n\ndata: {\"a\":1}\n\n").length, 1);
});

test("redact strips jwt, bearer, cookie and password fields", () => {
  const out = redact({ password: "hunter2", note: "Bearer abc.def.ghi", t: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk" });
  assert.ok(!out.includes("hunter2") && !out.includes("abc.def.ghi") && !out.includes("eyJhbGci"));
});

test("classify: auth gate, wrong tool, forbidden text, loops, invention, clean pass", () => {
  assert.equal(classify({ expect: { authGated: true } }, { status: 401 }).verdict, "PASS");
  assert.equal(classify({ expect: { authGated: true } }, { status: 200, reply: "x" }).reason, "auth_leak");
  assert.equal(classify({ expect: {} }, { status: 401 }).reason, "auth_leak");
  assert.equal(classify({ expect: {} }, { timedOut: true, elapsedMs: 5 }).reason, "timeout");
  assert.equal(classify({ expect: { tool: "run_compute" } }, { status: 200, reply: "9", tools: [] }).reason, "wrong_tool");
  assert.equal(classify({ expect: { mustMatch: ["125\\s*mm"] } }, { status: 200, reply: "about 200 mm", tools: [] }).verdict, "FAIL");
  assert.equal(classify({ expect: { noInvention: true } }, { status: 200, reply: "DTU-48213 says hi", tools: [] }).reason, "hallucinated_citation");
  assert.equal(classify({ expect: { maxTools: 2 } }, { status: 200, reply: "x", tools: ["a", "b", "c"] }).reason, "looped");
  assert.equal(classify({ expect: {} }, { status: 200, reply: "ok", tools: [], untracedNumbers: [{ text: "111 MPa" }] }).reason, "untraced_number");
  assert.equal(classify({ expect: { refuses: true } }, { status: 200, reply: "Sure, here they are", tools: [] }).reason, "auth_leak");
  assert.equal(classify({ expect: { refuses: true } }, { status: 200, reply: "Those are private; I can't show them", tools: [] }).verdict, "PASS");
  assert.equal(classify({ expect: {} }, { status: 200, reply: "fine", tools: [] }).verdict, "PASS");
});

test("case tables are well-formed and the light profile covers every group", () => {
  const ids = [...DIRECT, ...CHAT].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  for (const c of CHAT) { assert.ok(c.prompt && c.group && c.expect, c.id); for (const re of [...(c.expect.mustMatch || []), ...(c.expect.mustNotMatch || [])]) new RegExp(re, "i"); }
  for (const g of ["chat-normal", "chat-edge", "chat-adversarial"]) assert.ok(CHAT.some((c) => c.group === g && c.light), g);
  for (const n of Object.keys(MCP_READ_ONLY)) assert.ok(!MCP_NEVER_CALL.has(n), `${n} is both read-only and never-call`);
  for (const w of ["vault_write", "run_lens_action", "dtu_compress"]) assert.ok(MCP_NEVER_CALL.has(w) && !(w in MCP_READ_ONLY));
});

test("known-answer checks accept the real engines' output", async () => {
  const chem = await import("../lib/compute/chemistry-compute.js");
  const sym = await import("../lib/compute/symbolic-math.js");
  assert.ok(DIRECT.find((c) => c.id === "direct.balance-fe-o2").check(chem.balanceReaction({ equation: "Fe + O2 -> Fe2O3" })));
  assert.ok(DIRECT.find((c) => c.id === "direct.symbolic-2pi").check(sym.evaluate("2*pi")));
});

test("summary reports counts, reasons and the cases to look at", () => {
  const rows = [
    { id: "a", group: "chat-normal", verdict: "PASS" },
    { id: "b", group: "chat-edge", verdict: "FAIL", reason: "timeout", why: "slow" },
    { id: "chat-tool:x", group: "tool-reach", verdict: "PASS", why: "ok", status_label: "REACHABLE" },
  ];
  assert.equal(summarizeResults(rows).reasons.timeout, 1);
  const txt = renderSummary(rows, { base: "http://x", profile: "light" });
  assert.match(txt, /FAIL 1/); assert.match(txt, /\[FAIL\] b \(timeout\)/); assert.match(txt, /REACHABLE\s+chat-tool:x/);
});
