/**
 * Contract tests for scripts/check-route-auth.js.
 *
 * The scanner fails the build if a new mutation route lands without an
 * auth middleware (or an explicit `// AUTH: <reason>` marker). This test
 * exercises both branches against synthetic fixtures so the gate keeps
 * working as the codebase grows.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT = path.resolve(__dirname, "..", "scripts", "check-route-auth.js");

/**
 * Run the scanner against a synthetic ROUTES directory + BASELINE.
 * The scanner reads from the real repo paths; we copy fixtures into a
 * temp clone of the server tree to drive it.
 */
function runScanner(routesDir, baselineFile, env = {}) {
  // The scanner resolves paths via __dirname (server/scripts) → ../../
  // = REPO_ROOT, then server/routes and audit/route-auth.baseline.json.
  // To unit-test without polluting the real tree, we copy the script
  // into a temp tree with synthetic routes + baseline.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "route-auth-test-"));
  fs.mkdirSync(path.join(tmp, "server", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "server", "routes"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "audit"), { recursive: true });

  fs.copyFileSync(SCRIPT, path.join(tmp, "server", "scripts", "check-route-auth.js"));

  // Copy synthetic routes
  for (const [name, content] of Object.entries(routesDir)) {
    fs.writeFileSync(path.join(tmp, "server", "routes", name), content, "utf8");
  }
  if (baselineFile !== undefined) {
    fs.writeFileSync(path.join(tmp, "audit", "route-auth.baseline.json"), baselineFile, "utf8");
  }

  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(tmp, "server", "scripts", "check-route-auth.js"), "--json"],
      { env: { ...process.env, ...env }, encoding: "utf8" },
    );
    return { exitCode: 0, stdout };
  } catch (e) {
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : "",
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("check-route-auth scanner — happy paths", () => {
  it("PASS: a route with requireAuth middleware passes", () => {
    const result = runScanner({
      "good.js": `
        export default function (router, db) {
          router.post("/protected", requireAuth, (req, res) => res.json({ ok: true }));
        }
      `.trim(),
    }, "[]");
    assert.equal(result.exitCode, 0, `expected 0 exit, got ${result.exitCode}: ${result.stdout}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.allFindings.length, 0);
  });

  it("PASS: a route with `auth` middleware passes", () => {
    const result = runScanner({
      "good.js": `
        router.put("/x/:id", auth, handler);
      `.trim(),
    }, "[]");
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).allFindings.length, 0);
  });

  it("PASS: a route with an `// AUTH: webhook-signature` marker passes", () => {
    const result = runScanner({
      "webhook.js": `
        // AUTH: webhook-signature
        router.post("/stripe-webhook", express.raw(), (req, res) => res.json({}));
      `.trim(),
    }, "[]");
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).allFindings.length, 0);
  });

  it("PASS: a route with `// AUTH: public` marker passes", () => {
    const result = runScanner({
      "public.js": `
        // AUTH: public
        router.post("/captcha-verify", (req, res) => res.json({ ok: true }));
      `.trim(),
    }, "[]");
    assert.equal(result.exitCode, 0);
  });
});

describe("check-route-auth scanner — failure paths", () => {
  it("FAIL: an unguarded route fails when not in baseline", () => {
    const result = runScanner({
      "leaky.js": `
        router.delete("/users/:id", (req, res) => { /* no auth! */ });
      `.trim(),
    }, "[]");
    assert.equal(result.exitCode, 1, "expected non-zero exit for new gap");
    const data = JSON.parse(result.stdout);
    assert.equal(data.newFindings.length, 1);
    assert.equal(data.newFindings[0].method, "DELETE");
    assert.match(data.newFindings[0].file, /leaky\.js$/);
  });

  it("PASS: an unguarded route grandfathered in baseline passes", () => {
    const baseline = JSON.stringify([
      { file: "server/routes/legacy.js", line: 1, method: "POST", signature: "router.post(\"/old\", (req, res) =>" },
    ]);
    const result = runScanner({
      "legacy.js": `router.post("/old", (req, res) => res.json({}));`,
    }, baseline);
    assert.equal(result.exitCode, 0, `baseline grandfathering should pass: ${result.stdout}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.allFindings.length, 1, "the gap is still listed in allFindings");
    assert.equal(data.newFindings.length, 0, "but it's not a NEW finding");
  });

  it("FAIL: a new gap added to a file with grandfathered gaps still fails", () => {
    const baseline = JSON.stringify([
      { file: "server/routes/mixed.js", line: 1, method: "POST", signature: "router.post(\"/old\", (req, res) =>" },
    ]);
    const result = runScanner({
      "mixed.js": `
router.post("/old", (req, res) => res.json({}));
router.post("/new-leak", (req, res) => res.json({}));
      `.trim(),
    }, baseline);
    assert.equal(result.exitCode, 1, "new gap on line 2 must fail");
    const data = JSON.parse(result.stdout);
    assert.equal(data.newFindings.length, 1);
    assert.match(data.newFindings[0].signature, /new-leak/);
  });
});
