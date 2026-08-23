// server/tests/verify-prod-env-gate.test.js
//
// Real acceptance tests for scripts/verify-prod-env.mjs — the production
// preflight deployers run before pushing Concord live.
//
// The script is a pure CLI script with no exported functions: every check
// is a live probe against `process.env` + real filesystem/module-resolution
// state of the actual repo (better-sqlite3 load, DATA_DIR writability,
// security deps resolvable from server/node_modules). It doesn't read any
// fixture files of its own, so — unlike the FS-tree-grepping scripts — the
// faithful way to exercise it is to spawn the REAL script with a
// controlled, minimal `env`, and assert its structured --json output for
// specific pass/fail/warn scenarios. This proves the gate actually gates:
// a genuinely-missing/short/placeholder secret is caught, and a fully
// correct production configuration passes with exit 0.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-prod-env.mjs");

const GOOD_SECRET = "a".repeat(40);
const GOOD_ADMIN_PASSWORD = "b".repeat(20);

function run(envOverrides, args = ["--json"]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-prod-env-test-"));
  // Build a minimal, controlled env from scratch (not inheriting the parent
  // process's full env) so real ambient CI/dev secrets can't leak into the
  // scenario and make a test flaky or falsely pass/fail. PATH + a few
  // Node-internal vars are needed for the child process itself to run.
  //
  // The script itself also side-loads a REAL .env file off disk (SERVER_DIR/.env
  // or ROOT/.env, per its own dotenv-fallback logic) — that's real, intended
  // production behavior, not something this test's env object controls. dotenv's
  // populate() only sets a key when it is NOT already an own-property of
  // process.env (regardless of value), so every key the script checks must be
  // explicitly pre-declared here (blank by default) to block a developer's real
  // local ./.env from leaking a live secret into a scenario that expects that
  // key to read as unset/blank. Individual tests override specific keys below.
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "development",
    DATA_DIR: dataDir,
    ADMIN_PASSWORD: "",
    ALLOWED_ORIGINS: "",
    AUTH_ENABLED: "",
    AUTH_MODE: "",
    BACKEND_URL: "",
    CONCORD_CONNECTOR_TOKEN_KEY: "",
    DB_PATH: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    JWT_SECRET: "",
    MAX_OLD_SPACE_SIZE: "",
    NEXT_PUBLIC_API_URL: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    NEXT_PUBLIC_SOCKET_URL: "",
    PORT: "",
    SENTRY_DSN: "",
    SESSION_SECRET: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
  };
  const env = { ...baseEnv, ...envOverrides };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    code = err.status ?? 1;
    stdout = err.stdout?.toString() ?? "";
    stderr = err.stderr?.toString() ?? "";
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return { code, stdout, stderr, dataDir };
}

function parseJson(res) {
  return JSON.parse(res.stdout);
}

describe("verify-prod-env.mjs — required-secret failures (negative cases)", () => {
  it("JWT_SECRET missing in production: FAIL, exit 1", () => {
    const res = run({
      NODE_ENV: "production",
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    assert.equal(out.ok, false);
    const row = out.results.find((r) => r.name === "JWT_SECRET");
    assert.ok(row);
    assert.equal(row.status, "FAIL");
    assert.equal(row.required, true);
  });

  it("JWT_SECRET too short (<32 chars): FAIL, exit 1", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: "short",
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "JWT_SECRET");
    assert.equal(row.status, "FAIL");
    assert.match(row.reason, /32/);
  });

  it("JWT_SECRET looks like an unedited placeholder: FAIL", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: "change-me-please-this-is-a-placeholder-value",
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "JWT_SECRET");
    assert.equal(row.status, "FAIL");
    assert.match(row.reason, /placeholder/i);
  });

  it("ADMIN_PASSWORD too short (<12 chars): FAIL", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: "short1",
      AUTH_MODE: "jwt",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "ADMIN_PASSWORD");
    assert.equal(row.status, "FAIL");
  });

  it("AUTH_MODE resolves to 'public' in production: FAIL (server.js refuses to boot)", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "public",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "AUTH_MODE");
    assert.equal(row.status, "FAIL");
    assert.match(row.reason, /public/);
  });

  it("AUTH_ENABLED=false with AUTH_MODE unset also resolves to 'public': FAIL", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_ENABLED: "false",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "AUTH_MODE");
    assert.equal(row.status, "FAIL");
  });

  it("STRIPE_SECRET_KEY set to the .env.example placeholder: FAIL", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
      STRIPE_SECRET_KEY: "sk_REPLACE_ME_NOT_A_REAL_KEY",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "Stripe");
    assert.equal(row.status, "FAIL");
  });

  it("SESSION_SECRET set but too short: FAIL (even though it's an 'optional' group)", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
      SESSION_SECRET: "tooshort",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "SESSION_SECRET");
    assert.equal(row.status, "FAIL");
    assert.equal(row.required, true);
  });

  it("PORT set to a non-numeric value: FAIL", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
      PORT: "not-a-port",
    });
    assert.equal(res.code, 1);
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "PORT");
    assert.equal(row.status, "FAIL");
  });
});

describe("verify-prod-env.mjs — warnings that are NOT boot blockers", () => {
  it("NODE_ENV != production: WARN only, does not itself force exit 1", () => {
    const res = run({}); // NODE_ENV defaults to 'development' from baseEnv
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "NODE_ENV");
    assert.equal(row.status, "WARN");
    assert.equal(row.required, false);
  });

  it("ALLOWED_ORIGINS unset: WARN (fail-closed WS CORS), not a required FAIL", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "ALLOWED_ORIGINS");
    assert.equal(row.status, "WARN");
    assert.equal(row.required, false);
  });

  it("ALLOWED_ORIGINS set with a non-https origin: WARN with the bad origin named", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
      ALLOWED_ORIGINS: "http://not-secure.example.com",
    });
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "ALLOWED_ORIGINS");
    assert.equal(row.status, "WARN");
    assert.match(row.reason, /not https/);
  });

  it("ALLOWED_ORIGINS set with a valid https origin: PASS", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
      ALLOWED_ORIGINS: "https://app.example.com",
    });
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "ALLOWED_ORIGINS");
    assert.equal(row.status, "PASS");
  });
});

describe("verify-prod-env.mjs — real probes (not fabricated)", () => {
  it("better-sqlite3 probe actually opens an in-memory DB and round-trips a row", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "better-sqlite3");
    assert.equal(row.status, "PASS");
    assert.match(row.reason, /wrote \+ read a row/i);
  });

  it("DB_PATH directory writable probe actually writes + removes a temp file in the isolated DATA_DIR", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    const out = parseJson(res);
    const row = out.results.find((r) => r.name === "DB_PATH directory writable");
    assert.equal(row.status, "PASS");
    assert.match(row.reason, /writable/);
  });

  it("security deps (helmet, express-rate-limit, bcryptjs, jsonwebtoken) resolve from the real server/node_modules", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
    });
    const out = parseJson(res);
    for (const pkg of ["helmet", "express-rate-limit", "bcryptjs", "jsonwebtoken"]) {
      const row = out.results.find((r) => r.name === `security dep: ${pkg}`);
      assert.ok(row, `expected a result row for ${pkg}`);
      assert.equal(row.status, "PASS", `${pkg} should resolve`);
    }
  });
});

describe("verify-prod-env.mjs — full-pass scenario (positive case)", () => {
  it("a fully correct production configuration passes with exit 0 and ok:true", () => {
    const res = run({
      NODE_ENV: "production",
      JWT_SECRET: GOOD_SECRET,
      ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
      AUTH_MODE: "jwt",
      ALLOWED_ORIGINS: "https://app.example.com",
      SESSION_SECRET: "c".repeat(40),
    });
    assert.equal(res.code, 0, `expected exit 0; stdout:\n${res.stdout}`);
    const out = parseJson(res);
    assert.equal(out.ok, true);
    assert.equal(out.summary.requiredFails, 0);
  });

  it("human-readable mode (no --json) reports RESULT: OK and exits 0 for the same good config", () => {
    const res = run(
      {
        NODE_ENV: "production",
        JWT_SECRET: GOOD_SECRET,
        ADMIN_PASSWORD: GOOD_ADMIN_PASSWORD,
        AUTH_MODE: "jwt",
      },
      []
    );
    assert.equal(res.code, 0);
    assert.match(res.stdout, /RESULT: OK/);
  });

  it("human-readable mode reports RESULT: NOT READY and lists failed checks when misconfigured", () => {
    const res = run(
      {
        NODE_ENV: "production",
        AUTH_MODE: "jwt",
      },
      []
    );
    assert.equal(res.code, 1);
    assert.match(res.stdout, /RESULT: NOT READY/);
    assert.match(res.stdout, /JWT_SECRET/);
  });
});
