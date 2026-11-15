// GB-1539 bounds enforcement at the SHARED ARTIFACT LAYER —
// FIX-agents-004 (agent name) and FIX-ux-suite-008 (QuickCapture text).
// lens.create / lens.update in server.js bound every artifact title
// to the TITLE class (200) and capture-artifact content to the NOTE
// class (5,000). These legs live in the monolith, so the pin is an
// HTTP probe against a real boot (temp DATA_DIR, cookie auth):
// a 600-char agent title refuses with invalid_input, a 5001-char
// capture refuses, and in-policy creates succeed.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 18766;
const BASE = `http://localhost:${PORT}`;
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ConcordBoundsPin/1.0" };

let proc = null;
let dataDir = null;
let cookie = null;

async function waitHealthy(deadlineMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const r = await fetch(`${BASE}/api/health`, { headers: UA });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: r.status, json, headers: r.headers };
}

describe("artifact-layer bounds over HTTP (FIX-agents-004 / FIX-ux-suite-008)", { timeout: 300000 }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bounds-http-"));
    proc = spawn("node", ["server.js"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        DATA_DIR: dataDir,
        JWT_SECRET: "bounds-pin-jwt-secret-at-least-32-chars!!",
        SESSION_SECRET: "bounds-pin-session-secret-at-least-32!!",
        ADMIN_PASSWORD: "bounds-pin-admin-pass",
        FRONTEND_URL: BASE,
        ALLOWED_ORIGINS: BASE,
      },
      stdio: "ignore",
    });
    assert.equal(await waitHealthy(), true, "server booted");
    const reg = await post("/api/auth/register", {
      username: "bounds_pin",
      email: "bounds-pin@probe.invalid",
      password: "bounds-pin-pass-1",
      dateOfBirth: "1990-01-01",
    });
    assert.equal(reg.json?.ok, true, `register ok (got ${JSON.stringify(reg.json)})`);
    const setCookies = typeof reg.headers.getSetCookie === "function"
      ? reg.headers.getSetCookie()
      : [reg.headers.get("set-cookie") || ""];
    assert.ok(setCookies.some((c) => c.startsWith("concord_auth=")), "auth cookie issued");
    cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  });

  after(() => {
    if (proc) proc.kill("SIGTERM");
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("an agent artifact with a 600-character title refuses, naming the 200 limit", async () => {
    const r = await post("/api/lens/agents", { type: "agent", title: "x".repeat(600), data: {} });
    assert.equal(r.json?.ok, false);
    // Two layers refuse this, either is the policy answer: the
    // field-name input-limits middleware (400, INPUT_TOO_LONG,
    // violations naming "max 200") or lens.create's bounds check
    // (invalid_input). Both name the limit; neither stores the title.
    const text = JSON.stringify(r.json);
    assert.ok(
      r.json?.error === "invalid_input" || r.json?.code === "INPUT_TOO_LONG",
      `refused in a bounds shape: ${text}`,
    );
    assert.match(text, /200/);
  });

  it("an agent artifact with an ordinary name creates", async () => {
    const r = await post("/api/lens/agents", { type: "agent", title: "Research helper", data: {} });
    assert.equal(r.json?.ok, true);
  });

  it("a capture with 5001 characters of content refuses with invalid_input", async () => {
    const r = await post("/api/lens/ux-suite", { type: "capture", title: "note", data: { content: "y".repeat(5001) } });
    assert.equal(r.json?.ok, false);
    assert.equal(r.json?.error, "invalid_input");
    assert.match(r.json?.message || "", /5000 characters/);
  });

  it("an ordinary capture creates", async () => {
    const r = await post("/api/lens/ux-suite", { type: "capture", title: "note", data: { content: "a quick thought" } });
    assert.equal(r.json?.ok, true);
  });
});
