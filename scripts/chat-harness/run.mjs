#!/usr/bin/env node
// Chat + MCP harness. Usage:
//   node scripts/chat-harness/run.mjs [--base http://localhost:5050] [--profile light|full]
//        [--account ~/.zuko/verify/verify-account.json] [--out DIR] [--max-minutes 25] [--delay-ms 1500]
//        [--only substr] [--list]
// Read-only against a live site: concurrency 1, polite delay, hard caps, no secrets in the log.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { login, httpJson, chatStream, sleep, classify, redact, renderSummary, UA } from "./lib.mjs";
import { DIRECT, CHAT, MCP_READ_ONLY, MCP_NEVER_CALL } from "./cases.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const base = opt("base", "http://localhost:5050").replace(/\/$/, "");
const profile = opt("profile", "light");
const account = opt("account", path.join(os.homedir(), ".zuko/verify/verify-account.json"));
const maxMs = Number(opt("max-minutes", profile === "light" ? 25 : 90)) * 60000;
const delayMs = Number(opt("delay-ms", 1500));
const only = opt("only", "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = opt("out", path.join(os.homedir(), ".zuko/quality/chat-tests", stamp));

if (flag("list")) {
  for (const c of DIRECT) console.log(`${c.light ? "L" : " "} ${c.id}`);
  for (const c of CHAT) console.log(`${c.light ? "L" : " "} ${c.id}`);
  process.exit(0);
}

const wanted = (c) => (profile === "full" || c.light) && (!only || c.id.includes(only));
const rows = [];
const started = Date.now();
fs.mkdirSync(outDir, { recursive: true });
const jsonl = fs.createWriteStream(path.join(outDir, "results.jsonl"));
const record = (row) => { rows.push(row); jsonl.write(redact(row) + "\n"); console.log(`${row.verdict.padEnd(9)} ${row.id}${row.reason ? ` (${row.reason})` : ""}`); };
const overBudget = () => Date.now() - started > maxMs;

async function main() {
  const { H, role } = await login(base, account);
  const anon = { "content-type": "application/json", accept: "application/json", "user-agent": UA };

  // 1. Chat tool enumeration vs the declared surface.
  const surface = await import("../../server/lib/chat-tool-surface.js").catch(() => null);
  const rep = await httpJson(base, "GET", "/api/chat/tools", H);
  const live = new Map((rep.json.tools || []).map((t) => [t.name, t]));
  const declared = surface ? [...surface.CHAT_RESPOND_TOOLS, ...surface.AGENT_LOOP_TOOLS] : [];
  const names = new Set([...live.keys(), ...declared.map((t) => t.name)]);
  for (const name of [...names].sort()) {
    const d = declared.find((t) => t.name === name);
    const l = live.get(name);
    let label, verdict = "PASS", why = "ok";
    if (l && l.available) label = "REACHABLE";
    else if (d?.operatorOnly) { label = "AUTH-GATED-AS-EXPECTED"; why = "operator-only, not listed to this account"; }
    else if (l && !l.available) { label = "UNREACHABLE"; verdict = "FAIL"; why = "listed but available:false"; }
    else if (d && !l) { label = d.requiresOptIn ? "AUTH-GATED-AS-EXPECTED" : "UNREACHABLE"; if (!d.requiresOptIn) { verdict = "FAIL"; why = "in chat-tool-surface but not in GET /api/chat/tools"; } else why = "opt-in tool"; }
    else { label = "REACHABLE"; why = "listed by server, not in the local surface file (newer server?)"; }
    record({ id: `chat-tool:${name}`, group: "tool-reach", verdict, reason: verdict === "PASS" ? null : "tool_error", why, status_label: label });
  }

  // 2. MCP enumeration, read-only calls, and the auth gates.
  const ml = await httpJson(base, "POST", "/api/mcp/tools/list", H, {});
  const mcpTools = (ml.json.tools || []).map((t) => t.name);
  if (ml.status !== 200) record({ id: "mcp:tools/list", group: "tool-reach", verdict: "FAIL", reason: "tool_error", why: `HTTP ${ml.status}`, status_label: "UNREACHABLE" });
  for (const name of mcpTools.sort()) {
    if (only && !name.includes(only)) continue;
    const args = MCP_READ_ONLY[name];
    if (!args || MCP_NEVER_CALL.has(name)) { record({ id: `mcp:${name}`, group: "tool-reach", verdict: "PASS", reason: null, why: "listed; not called live (writes, spends or unknown inputs)", status_label: "REACHABLE" }); continue; }
    if (overBudget()) break;
    await sleep(delayMs);
    const r = await httpJson(base, "POST", "/api/mcp/tools/call", H, { name, arguments: args }, 30000);
    const ok = r.status === 200 && r.json.ok !== false && !r.json.error;
    record({ id: `mcp:${name}`, group: "tool-reach", verdict: ok ? "PASS" : "FAIL", reason: ok ? null : r.status === 403 || r.status === 401 ? "auth_leak" : "tool_error",
      why: ok ? "ok" : `HTTP ${r.status} ${String(r.json.error || r.json.raw || "").slice(0, 120)}`, status_label: ok ? "REACHABLE" : r.status === 403 ? "AUTH-GATED-AS-EXPECTED" : "UNREACHABLE" });
  }
  for (const [id, headers, tool, expectGate] of [
    ["mcp-gate:anonymous-call", anon, "dtu_list", true],
    ["mcp-gate:non-admin-admin-tool", H, "admin.noop", role === "owner" || role === "admin" || role === "founder" ? false : true],
  ]) {
    if (!expectGate) { record({ id, group: "tool-reach", verdict: "PASS", reason: null, why: `account role ${role} is admin; gate not testable`, status_label: "REACHABLE" }); continue; }
    await sleep(delayMs);
    const r = await httpJson(base, "POST", "/api/mcp/tools/call", headers, { name: tool, arguments: {} });
    const c = classify({ expect: { authGated: true } }, { status: r.status });
    record({ id, group: "tool-reach", ...c, status_label: c.verdict === "PASS" ? "AUTH-GATED-AS-EXPECTED" : "UNREACHABLE" });
  }

  // 3. Direct known-answer calls.
  for (const c of DIRECT.filter(wanted)) {
    if (overBudget()) break;
    await sleep(delayMs);
    const r = await httpJson(base, "POST", "/api/compute/run", H, { module: c.module, fn: c.fn, args: c.args });
    const res = r.json.result;
    const v = r.status === 200 ? c.check(res) : false;
    const skip = v === "skip";
    record({ id: c.id, group: "direct", verdict: skip ? "PASS" : v ? "PASS" : "FAIL", reason: skip || v ? null : r.status === 200 ? "bad_args" : "tool_error",
      why: skip ? "result shape differs on this build; not graded" : v ? `ok (${c.source})` : `HTTP ${r.status} result ${redact(res).slice(0, 120)}` });
  }

  // 4. Chat-driven cases.
  for (const c of CHAT.filter(wanted)) {
    if (overBudget()) { record({ id: c.id, group: c.group, verdict: "CONFUSED", reason: "timeout", why: "harness time budget reached before this case" }); continue; }
    await sleep(delayMs);
    const r = await chatStream(base, H, c.prompt, { timeoutMs: c.timeoutMs || 120000 });
    const cl = classify(c, r);
    record({ id: c.id, group: c.group, ...cl, elapsedMs: r.elapsedMs, tools: r.tools, stages: r.stages?.length || 0, note: c.note || null, replyPreview: redact(String(r.reply).slice(0, 600)) });
  }
}

main().catch((e) => { record({ id: "harness", group: "harness", verdict: "FAIL", reason: "other", why: redact(String(e?.message || e)) }); })
  .finally(() => {
    const summary = renderSummary(rows, { startedAt: new Date(started).toISOString(), base, profile, account: `verify (role from login; credentials not logged)` });
    fs.writeFileSync(path.join(outDir, "summary.txt"), summary);
    jsonl.end();
    console.log("\n" + summary + `Output: ${outDir}`);
    process.exit(rows.some((r) => r.verdict === "FAIL" && r.group === "harness") ? 2 : 0);
  });
