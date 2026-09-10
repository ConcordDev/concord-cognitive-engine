// server/tests/auth-gate/coverage.test.js
//
// F0.7 — Universal coverage test.
// Proves that EVERY registered MCP tool passes through the AuthGate composition layer.
// If any tool bypasses the gate, this test fails.
//
// Run with: node server/tests/auth-gate/coverage.test.js

import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      failures.push({ name, error: e.message });
      console.log(`  ✗ ${name}: ${e.message.slice(0, 200)}`);
    }
  };
}

// Get the canonical MCP tool list by talking to the MCP server (stdio)
function getToolsList() {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["/Users/dutch/.local/bin/concord-local-mcp.py"]);
    const initMsg = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cov", version: "1.0" } },
    });
    const listMsg = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    proc.stdin.write(initMsg + "\n" + listMsg + "\n");
    proc.stdin.end();
    let buf = "";
    proc.stdout.on("data", chunk => buf += chunk);
    proc.on("close", () => {
      const tools = [];
      for (const line of buf.split("\n")) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            for (const t of msg.result.tools) tools.push(t.name);
          }
        } catch { /* noop */ }
      }
      resolve(tools);
    });
    proc.on("error", reject);
  });
}

// Hit each tool via the REST /mcp/call path and verify auth_gate ran
async function probeToolViaDispatch(toolName) {
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trace-Id": `cov-${toolName}-${Date.now()}` },
    body: JSON.stringify({ tool: toolName, args: {} }),
  });
  return await r.json();
}

console.log("F0.7 — Universal coverage test\n");
console.log("Step 1: Enumerate all MCP tools via tools/list\n");

const tools = await getToolsList();
console.log(`  Discovered ${tools.length} tools from MCP server\n`);

console.log("Step 2: Probe each tool via /mcp/call and verify AuthGate ran\n");

// Tools that are intentionally protected (not callable via REST by design)
const PROTECTED_TOOLS = new Set([
  "reflect_invoke",  // requires authenticated user (not mcp-bypass)
  "reflect_rescan",  // same
]);

let bypassCount = 0;
let denyCount = 0;
let errorCount = 0;
let allowCount = 0;
const bypassTools = [];

for (const tool of tools) {
  try {
    const r = await probeToolViaDispatch(tool);
    if (r.error && (r.error.includes("requires real authentication") || r.error.includes("forbidden"))) {
      // Expected — special auth tools
      continue;
    }
    if (!r.auth_gate_mode) {
      bypassCount++;
      bypassTools.push(tool);
    } else if (r.decision === "DENY") {
      denyCount++;
    } else if (r.decision === "ALLOW") {
      allowCount++;
    } else if (r.error) {
      errorCount++;
    }
  } catch (e) {
    errorCount++;
  }
}

console.log(`  Total tools: ${tools.length}`);
console.log(`  Allow (gates ran): ${allowCount}`);
console.log(`  Deny (gates ran): ${denyCount}`);
console.log(`  Bypass (no gate): ${bypassCount}`);
console.log(`  Errors: ${errorCount}`);

await test("Coverage 1: every tool reports auth_gate_mode (bypass = 0)", async () => {
  assert.equal(bypassCount, 0, `Tools bypassing AuthGate: ${bypassTools.join(", ")}`);
})();

await test("Coverage 2: every tool runs through auth-gate evaluate (10 pre-dispatch checks) OR is denied with reason_code", async () => {
  // 84 total - 2 protected (reflect_invoke, reflect_rescan) = 82 expected through gate
  const expectedThrough = tools.length - PROTECTED_TOOLS.size;
  assert.equal(allowCount + denyCount, expectedThrough,
    `Expected ${expectedThrough} tools through gate, got ${allowCount + denyCount}`);
})();

await test("Coverage 3: protected tools are blocked without bypass", async () => {
  for (const tool of PROTECTED_TOOLS) {
    const r = await probeToolViaDispatch(tool);
    // expect denial via routes/mcp.js authorizeToolCall (which runs BEFORE auth-gate)
    assert.ok(r.error || r.decision === "DENY", `protected tool ${tool} not blocked: ${JSON.stringify(r).slice(0, 200)}`);
  }
})();

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ${f.name}: ${f.error.slice(0, 300)}`);
  process.exit(1);
}
process.exit(0);