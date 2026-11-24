// Cohesive R-1 — equivalence of dual surfaces: DTU create.
//
// The same logical action (create a DTU) is reachable through two
// independently-shaped surfaces:
//   A. POST /api/dtus                              (REST route → dtu.create)
//   B. POST /api/lens/run {domain:"dtu", action:"create", input}
//                                                   (dispatcher → dtu.create)
// Each route adds its own shaping around the shared macro (recipe
// validation + scope defaulting on A; wrapper-peeling + ACL + envelope
// shaping on B). This suite asserts the surfaces AGREE: canonical JSON
// of the resulting DTU — read back through one fixed neutral read so
// neither surface's response shaper judges its own work — deep-compared
// via lib/canonical-result.js. A divergence fails with the canonical
// diff (paths), not a verdict word.
//
// Scope boundary, declared: fixture inputs are plain non-recipe DTU
// creates. The REST route's recipe-only branches (meta.type validation,
// personal-scope defaulting for recipe types) are route-specific
// contract, not drift, and are out of this instance's claim.
//
// Harness: the established server/tests boot pattern (spawn server.js,
// temp DATA_DIR, isolation env, real register/login, awaited teardown).
// Clean-room: the mechanism (canonical-form comparison across surfaces)
// is reimplemented from the Research brief's description; no Cohesive
// code was read or copied (that repo carries no LICENSE).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { canonicalEqual, canonicalDiff } from "../lib/canonical-result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let API_BASE = process.env.API_BASE || "";
let serverProcess = null;
let dataDir = null;

before(async () => {
  if (process.env.API_BASE) {
    API_BASE = process.env.API_BASE;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) return;
      } catch { /* not ready */ }
      await new Promise(r => { setTimeout(r, 500); });
    }
    throw new Error("External server not reachable within 180 seconds");
  }

  const serverDir = join(__dirname, "..");
  const port = String(20000 + Math.floor(Math.random() * 20000));
  API_BASE = `http://localhost:${port}`;
  dataDir = mkdtempSync(join(tmpdir(), "concord-r1-equiv-"));

  serverProcess = spawn("node", ["server.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: "test",
      AUTH_MODE: "",
      CONCORD_FORCE_LISTEN: "true",
      DATA_DIR: dataDir,
      // Isolation only — the assertions still have to pass the real auth
      // and dispatch gates (see the sibling adversarial suite's notes).
      CONCORD_LOAD_SHED_ENABLED: "0",
      CONCORD_RATE_LIMIT_BYPASS: "1",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  serverProcess.on("error", (err) => { process.stderr.write(`Server error: ${err.message}\n`); });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) { serverProcess.unref(); return; }
    } catch { /* not ready */ }
    await new Promise(r => { setTimeout(r, 500); });
  }
  throw new Error("Server failed to start within 60 seconds");
});

after(() => {
  if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp */ } }
  if (!serverProcess || serverProcess.killed) return Promise.resolve();
  return new Promise((resolve) => {
    serverProcess.kill("SIGTERM");
    const t = setTimeout(() => { serverProcess.kill("SIGKILL"); resolve(); }, 3000);
    serverProcess.on("exit", () => { clearTimeout(t); resolve(); });
  });
});

async function api(method, path, body = null, { token, noAuth } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token && !noAuth) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...opts, signal: AbortSignal.timeout(30_000) });
      const json = await res.json().catch(() => ({}));
      return { ...json, _status: res.status };
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function registerAndLogin() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const creds = { username: `r1equiv_${suffix}`, password: `R1Equiv!${suffix}` };
  const reg = await api("POST", "/api/auth/register", creds, { noAuth: true });
  assert.ok(reg.ok || reg.user || reg.token, `register failed: ${JSON.stringify(reg).slice(0, 200)}`);
  const login = await api("POST", "/api/auth/login", { username: creds.username, password: creds.password }, { noAuth: true });
  assert.ok(login.token, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
  return { token: login.token, userId: login.user?.id ?? login.userId };
}

/** The created DTU object out of either surface's envelope, however nested. */
function extractDtu(res) {
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== "object" || depth > 5 || seen.has(v)) return null;
    seen.add(v);
    if (typeof v.id === "string" && v.id.startsWith("dtu") && typeof v.title === "string") return v;
    for (const key of ["dtu", "result", "data"]) {
      const found = walk(v[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(res, 0);
}

const FIXTURE = {
  title: "R-1 equivalence fixture",
  content: "One logical action, two surfaces, one canonical result.",
  tags: ["equivalence", "r1"],
  source: "cohesive-r1-suite",
  human: { summary: "A DTU created to prove two surfaces agree." },
  core: {
    definitions: ["An equivalence fixture DTU."],
    claims: ["Both create surfaces produce this same canonical object."],
  },
  machine: { kind: "equivalence_fixture", value: 7 },
  meta: { visibility: "private" },
};

describe("DTU create — REST route vs /api/lens/run", () => {
  it("both surfaces produce the same canonical DTU (read back neutrally)", async () => {
    const actor = await registerAndLogin();

    const viaRest = await api("POST", "/api/dtus", FIXTURE, { token: actor.token });
    const restDtu = extractDtu(viaRest);
    assert.ok(restDtu, `REST create returned no DTU: ${JSON.stringify(viaRest).slice(0, 300)}`);

    const viaRun = await api("POST", "/api/lens/run", { domain: "dtu", action: "create", input: FIXTURE }, { token: actor.token });
    const runDtu = extractDtu(viaRun);
    assert.ok(runDtu, `lens/run create returned no DTU: ${JSON.stringify(viaRun).slice(0, 300)}`);

    // The primary assertion: the resulting STATE, read back through one
    // fixed neutral read (GET /api/dtus/:id), canonical-compared.
    const readRest = await api("GET", `/api/dtus/${restDtu.id}`, null, { token: actor.token });
    const readRun = await api("GET", `/api/dtus/${runDtu.id}`, null, { token: actor.token });
    const stateRest = extractDtu(readRest);
    const stateRun = extractDtu(readRun);
    assert.ok(stateRest && stateRun, "read-back of a created DTU failed");
    assert.ok(
      canonicalEqual(stateRest, stateRun),
      `surfaces diverge on created state — canonical diff: ${JSON.stringify(canonicalDiff(stateRest, stateRun))}`,
    );

    // The secondary assertion: the create responses' own DTU payloads
    // also agree canonically (what each surface's clients consume).
    assert.ok(
      canonicalEqual(restDtu, runDtu),
      `surfaces diverge on create response payloads — canonical diff: ${JSON.stringify(canonicalDiff(restDtu, runDtu))}`,
    );
  });
});
