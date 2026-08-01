// tests/secret-leak-detector.test.js
//
// Bidirectional pin for secret-leak-detector: a real-shaped hardcoded
// credential (OpenAI/GitHub/AWS key, PEM block, literal password) must be
// flagged; the same shape must NOT be flagged when it carries a known
// false-positive marker (e.g. "example"), when the "password" value is
// itself a process.env reference, or when the file lives under one of the
// detector's excluded paths/extensions.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSecretLeakDetector } from "../lib/detectors/secret-leak-detector.js";

async function tmpRepo(filesMap = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sld-"));
  for (const [rel, content] of Object.entries(filesMap)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

describe("secret-leak detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS secret_openai_key (critical) for a realistic sk- prefixed literal", async () => {
    dir = await tmpRepo({ "server/lib/oops.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n` });
    const r = await runSecretLeakDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.ok(hit, "a real-shaped OpenAI key must be flagged");
    assert.equal(hit.severity, "critical");
    assert.equal(hit.fixHint, "rotate_secret_and_move_to_env");
    assert.ok(hit.location.startsWith("server/lib/oops.js:"));
  });

  it("does NOT flag a match that carries a false-positive marker (e.g. \"example\")", async () => {
    dir = await tmpRepo({ "server/lib/doc-sample.js": `const KEY = "sk-exampleAB3xQ7mZ9pL2vN5t";\n` });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.equal(hit, undefined, "a matched string containing the marker \"example\" must be suppressed");
  });

  it("FLAGS secret_github_token (critical) for a realistic ghp_ prefixed literal", async () => {
    dir = await tmpRepo({
      "server/lib/token.js": `const TOKEN = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_github_token");
    assert.ok(hit, "a real-shaped GitHub token must be flagged");
    assert.equal(hit.severity, "critical");
  });

  it("FLAGS secret_aws_access_key (critical) for a realistic AKIA-prefixed literal", async () => {
    dir = await tmpRepo({ "server/lib/aws-config.js": `const AWS_KEY = "AKIA1234567890ABCDEF";\n` });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_aws_access_key");
    assert.ok(hit, "a real-shaped AWS access key must be flagged");
    assert.equal(hit.severity, "critical");
  });

  it("FLAGS secret_generic_password (high) for a hardcoded literal password", async () => {
    dir = await tmpRepo({
      "server/lib/db-config.js": `const config = { password: "Sup3rSecr3tValue" };\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_generic_password");
    assert.ok(hit, "a hardcoded password literal must be flagged");
    assert.equal(hit.severity, "high");
  });

  it("does NOT flag secret_generic_password when the quoted value is itself a process.env reference (skipMatch)", async () => {
    dir = await tmpRepo({
      "server/lib/db-config2.js": `const config = { password: "process.env.DB_PASSWORD" };\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_generic_password");
    assert.equal(hit, undefined, "a password value that is textually a process.env reference must be suppressed");
  });

  it("FLAGS secret_private_key_pem (critical) for an embedded PEM header", async () => {
    dir = await tmpRepo({
      "server/lib/embedded-key.js":
        `const KEY = \`-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\`;\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_private_key_pem");
    assert.ok(hit, "an embedded PEM private key block must be flagged");
    assert.equal(hit.severity, "critical");
  });

  it("does NOT scan files under a TOP-LEVEL excluded directory (e.g. docs/) even with a real-shaped secret inside", async () => {
    // Regression pin for a real bug found writing this test: SKIP_FILES's
    // directory entries (e.g. /\/docs\//) require a LEADING slash, which
    // relPath() never produces for a top-level path — so docs/x.js (no
    // parent directory) used to slip past the exclusion while a nested
    // path like server/docs/x.js correctly matched. Fixed in the detector
    // by testing against a virtual-leading-slash path.
    dir = await tmpRepo({
      "docs/example-snippet.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.equal(hit, undefined, "a TOP-LEVEL docs/ file must be excluded from the scan, not just a nested one");
  });

  it("does NOT scan files under a NESTED excluded directory (e.g. server/docs/) — the pre-existing, already-working case", async () => {
    dir = await tmpRepo({
      "server/docs/example-snippet.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.equal(hit, undefined, "a nested docs/ file must still be excluded (no regression from the leading-slash fix)");
  });

  it("still FLAGS a real secret in an ordinary, non-excluded top-level path (no over-broad suppression from the fix)", async () => {
    dir = await tmpRepo({
      "server/lib/oops2.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key" && f.location.startsWith("server/lib/oops2.js"));
    assert.ok(hit, "an ordinary source path must still be scanned normally after the fix");
  });

  it("does NOT scan .test.js files even with a real-shaped secret inside", async () => {
    dir = await tmpRepo({
      "server/tests/some-fixture.test.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.equal(hit, undefined, "*.test.js files are excluded from the scan entirely");
  });

  it("does NOT scan files under a /test-fixtures/ directory even with a real-shaped secret inside", async () => {
    dir = await tmpRepo({
      "server/test-fixtures/creds.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.equal(hit, undefined, "files under a /test-fixtures/ directory are excluded from the scan entirely");
  });

  it("does NOT scan files under a TOP-LEVEL test-fixtures/ directory either (same leading-slash fix, different SKIP_FILES entry)", async () => {
    dir = await tmpRepo({
      "test-fixtures/creds2.js": `const KEY = "sk-aB3xQ7mZ9pL2vN5tR8kD1jH4";\n`,
    });
    const r = await runSecretLeakDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "secret_openai_key");
    assert.equal(hit, undefined, "a TOP-LEVEL test-fixtures/ file must also be excluded, not just a nested one");
  });
});
