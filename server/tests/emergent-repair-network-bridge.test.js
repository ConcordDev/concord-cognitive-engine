// server/tests/emergent-repair-network-bridge.test.js
// Q49/A#25 — the repair network used to read/write a
// globalThis._concordRepairMemory Map that nothing ever populated:
// push always exported [], pulled fixes landed in a Map nobody read.
// These tests run the ENABLED path end-to-end in a child process
// (env gates are read at module load) against a loopback registry:
// push must contribute the cortex's real learned patterns,
// anonymized; pull must import foreign signals into the cortex
// fix-less, so they can inform but never be applied.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const LOCAL_PATTERN = "TypeError: cannot read properties of undefined (reading 'bridgeProbe')";
const FOREIGN_RAW = "ReferenceError: foreignBridgeProbe is not defined";
const FOREIGN_FIX = {
  errorPattern: hash(FOREIGN_RAW),
  category: "runtime",
  executor: "exec-foreign",
  successRate: 0.9,
  occurrences: 12,
  firstSeen: "2026-01-01T00:00:00.000Z",
};

let server;
let port;
let contributed = null;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/repair/contribute") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        contributed = { headers: req.headers, body: JSON.parse(body) };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/api/repair/latest")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ fixes: [FOREIGN_FIX] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});
after(() => server?.close());

const CHILD = `
const cortex = await import(process.env.CORTEX_URL);
const net = await import(process.env.NET_URL);
for (let i = 0; i < 3; i++) cortex.addToRepairMemory(process.env.LOCAL_PATTERN, { executor: "exec-test", category: "runtime" });
for (let i = 0; i < 3; i++) cortex.recordRepairSuccess(process.env.LOCAL_PATTERN);
const push = await net.pushFixes();
const pull1 = await net.pullFixes();
const pull2 = await net.pullFixes();
const patterns = cortex.getAllRepairPatterns().patterns;
const imported = patterns.find((e) => e.source === "global_network") || null;
const lookup = cortex.lookupRepairMemory(process.env.FOREIGN_RAW);
console.log(JSON.stringify({ push, pull1, pull2, imported, lookup }));
`;

function runChild() {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", CHILD], {
      timeout: 30000,
      env: {
        ...process.env,
        REPAIR_NETWORK_ENABLED: "true",
        REPAIR_NETWORK_TOKEN: "test-token",
        REPAIR_NETWORK_URL: `http://127.0.0.1:${port}`,
        CORTEX_URL: pathToFileURL(path.join(process.cwd(), "emergent/repair-cortex.js")).href,
        NET_URL: pathToFileURL(path.join(process.cwd(), "emergent/repair-network.js")).href,
        LOCAL_PATTERN,
        FOREIGN_RAW,
      },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`child failed: ${err.message}\n${stderr}`));
      try { resolve(JSON.parse(stdout.trim().split("\n").pop())); }
      catch { reject(new Error(`unparseable child output: ${stdout}\n${stderr}`)); }
    });
  });
}

describe("repair-network cortex bridge (enabled, loopback registry)", () => {
  it("pushes real cortex patterns anonymized, pulls signals in fix-less, dedupes", async () => {
    const r = await runChild();

    // Push: the cortex's learned pattern was contributed.
    assert.equal(r.push.ok, true);
    assert.equal(r.push.pushed, 1);
    assert.ok(contributed, "registry received a contribution");
    assert.equal(contributed.headers["x-instance-token"], "test-token");
    assert.equal(contributed.body.fixes.length, 1);
    assert.equal(contributed.body.fixes[0].errorPattern, hash(LOCAL_PATTERN));
    assert.equal(contributed.body.fixes[0].executor, "exec-test");
    assert.ok(!JSON.stringify(contributed.body).includes(LOCAL_PATTERN),
      "raw pattern text must never leave the instance");

    // Pull: the foreign signal landed in the cortex, fix-less.
    assert.equal(r.pull1.ok, true);
    assert.equal(r.pull1.imported, 1);
    assert.ok(r.imported, "imported entry present in cortex patterns");
    assert.equal(r.imported.fix, null);
    assert.equal(r.imported.pattern, null);
    assert.equal(r.imported.networkSuccessRate, 0.9);
    assert.equal(r.imported.networkOccurrences, 12);
    assert.ok(Math.abs(r.imported.confidence - 0.72) < 1e-9, `confidence ${r.imported.confidence}`);
    // A fix-less signal can never be served as an applicable repair.
    assert.equal(r.lookup, null);
    // Second pull of the same registry state imports nothing new.
    assert.equal(r.pull2.imported, 0);
  });
});
