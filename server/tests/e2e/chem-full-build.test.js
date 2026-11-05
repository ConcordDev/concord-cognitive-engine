// Chem full-lens build (GB-1021) — end-to-end through the REAL server,
// driven exactly as the frontend drives it:
//
//   1. The Reaction Chamber's contract: balanceReaction over /api/lens/run
//      returns the balanced equation string + productCoeffs the chamber now
//      consumes, and an unparseable equation ("banana -> split") is refused
//      on the envelope's honest 4xx with its reason — never a Success.
//   2. The chamber's write path: the reaction record and the minted product
//      compounds round-trip through the generic artifact routes with their
//      data intact, visible to their owner and no one else.
//   3. The notebook lifecycle: add → update → delete over the wire.
//   4. live_pubchem joins the pipes: caffeine resolves to CID 2519 WITH its
//      SMILES populated (the property-rename fix, proven against the real
//      PubChem API this macro calls).
//
// Hermetic data (temp DATA_DIR, synthetic users); external reach is limited
// to the PubChem leg, which is the macro's own live source. Boot budget:
// current main's cold boot measures ~30-90s on this VM class, so readiness
// waits up to 240s (the October harness's 90s no longer fits it).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "..", "..");
const PORT = 18753;
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function spawnServer(dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["server.js"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: "e2e-test",
        PORT: String(PORT),
        DATA_DIR: dataDir,
        CONCORD_NO_LISTEN: "false",
        CONCORD_LOAD_SHED_ENABLED: "0",
        CONCORD_USER_CACHE_TTL_MS: "0",
        CONCORD_DISABLE_BRAINS: "true",
        AUTH_MODE: "hybrid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; reject(new Error("server_listening not seen within 240s")); } }, 240000);
    const checkLine = (line) => {
      if (!resolved && line.includes("server_listening")) {
        resolved = true; clearTimeout(timer); resolve(child);
      }
    };
    let stdoutBuf = "";
    child.stdout.on("data", (chunk) => { stdoutBuf += chunk.toString(); const lines = stdoutBuf.split("\n"); stdoutBuf = lines.pop(); lines.forEach(checkLine); });
    let stderrBuf = "";
    child.stderr.on("data", (chunk) => { stderrBuf += chunk.toString(); const lines = stderrBuf.split("\n"); stderrBuf = lines.pop(); lines.forEach(checkLine); });
    child.on("exit", (code, signal) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error("Server exited early (code=" + code + " signal=" + signal + ")")); } });
    child.on("error", (err) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(err); } });
  });
}

function stopServer(child) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    child.kill("SIGTERM");
    const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.on("exit", () => { clearTimeout(t); resolve(); });
  });
}

async function apiFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    return await fetch(BASE + pathname, { ...options, signal: controller.signal, headers: { "User-Agent": BROWSER_UA, ...(options.headers || {}) } });
  } finally { clearTimeout(timer); }
}

async function reqJSON(method, pathname, payload, headers) {
  const res = await apiFetch(pathname, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function registerUser(label) {
  const uniq = (label + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 28);
  const reg = await reqJSON("POST", "/api/auth/register", {
    username: uniq, email: uniq + "@example.com",
    password: "<MASKED_SECRET_001>!",
    dateOfBirth: "1990-01-01", _t: Date.now() - 5000,
  });
  if (reg.status !== 201 || !reg.body?.token) throw new Error("Setup failed: could not register " + label + ": " + JSON.stringify(reg));
  return { headers: { Authorization: "Bearer " + reg.body.token }, userId: reg.body.user?.id };
}

const lens = (actor, name, input) => reqJSON("POST", "/api/lens/run", { domain: "chem", name, input }, actor.headers);

describe("chem full build — chamber contract, artifact mint, notebook, PubChem pipe (real server)", { timeout: 480000 }, () => {
  let child, dataDir, owner, member, bystander;

  before(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "chem-e2e-"));
    child = await spawnServer(dataDir);
    owner = await registerUser("chemowner");
    member = await registerUser("chemmember");
    bystander = await registerUser("chembystander");
    assert.ok(owner.userId && member.userId && bystander.userId);
  });

  after(async () => {
    await stopServer(child);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("balances methane into the shape the chamber renders, and mints through the artifact routes", async () => {
    const bal = await lens(member, "balanceReaction", { equation: "CH4 + O2 -> CO2 + H2O" });
    assert.equal(bal.status, 200);
    assert.equal(bal.body?.result?.ok, true);
    assert.equal(bal.body.result.balanced, "CH4 + 2O2 → CO2 + 2H2O");
    assert.deepEqual(bal.body.result.productCoeffs, { CO2: 1, H2O: 2 });

    // The chamber's own write path, verbatim: record the run, mint each
    // product with its real molecular weight.
    const rec = await reqJSON("POST", "/api/lens/chem", {
      type: "reaction", title: bal.body.result.balanced,
      data: { formula: bal.body.result.balanced, ranAt: new Date().toISOString(), success: true },
    }, member.headers);
    assert.equal(rec.status, 200);
    for (const formula of Object.keys(bal.body.result.productCoeffs)) {
      const mw = await lens(member, "molecular-weight", { formula });
      const weight = mw.body?.result?.molecularWeight ?? null;
      assert.ok(typeof weight === "number" && weight > 0, `${formula} has a real MW`);
      const mint = await reqJSON("POST", "/api/lens/chem", {
        type: "compound", title: formula,
        data: { name: formula, formula, type: "product", molecularWeight: weight },
      }, member.headers);
      assert.equal(mint.status, 200);
    }

    const reactions = await reqJSON("GET", "/api/lens/chem?type=reaction", null, member.headers);
    assert.equal(reactions.body.artifacts.length, 1);
    assert.equal(reactions.body.artifacts[0].data.formula, "CH4 + 2O2 → CO2 + 2H2O");
    assert.ok(reactions.body.artifacts[0].data.ranAt, "the row carries a real timestamp");

    const compounds = await reqJSON("GET", "/api/lens/chem?type=compound", null, member.headers);
    const names = compounds.body.artifacts.map((a) => a.data.formula).sort();
    assert.deepEqual(names, ["CO2", "H2O"], "both products stand in the Compound Library");
    const co2 = compounds.body.artifacts.find((a) => a.data.formula === "CO2");
    assert.ok(Math.abs(co2.data.molecularWeight - 44.009) < 0.01, "CO2 carries its real MW");

    const theirs = await reqJSON("GET", "/api/lens/chem?type=compound", null, bystander.headers);
    assert.equal(theirs.body.artifacts.length, 0, "a bystander sees none of them");
  });

  it("refuses banana -> split on the honest envelope, with its reason", async () => {
    const r = await lens(member, "balanceReaction", { equation: "banana -> split" });
    assert.ok(r.status >= 400, `refusal rides a 4xx, got ${r.status}`);
    assert.equal(r.body?.ok, false);
    assert.match(String(r.body?.error || ""), /banana/);
    const reactions = await reqJSON("GET", "/api/lens/chem?type=reaction", null, member.headers);
    assert.equal(reactions.body.artifacts.length, 1, "no junk row was recorded for the refusal");
  });

  it("runs the notebook lifecycle over the wire: add, update, delete", async () => {
    const added = await lens(member, "notebook-add", { title: "E2E notebook entry", observations: "first pass", yieldPercent: 50 });
    assert.equal(added.body?.result?.title, "E2E notebook entry");
    const id = added.body.result.id;
    const updated = await lens(member, "notebook-update", { id, observations: "corrected in place", yieldPercent: 83 });
    assert.equal(updated.body?.result?.observations, "corrected in place");
    assert.equal(updated.body?.result?.yieldPercent, 83);
    const foreign = await lens(bystander, "notebook-update", { id, title: "hijack" });
    assert.equal(foreign.body?.result?.ok ?? foreign.body?.ok, false);
    const list = await lens(member, "notebook-list", {});
    assert.equal(list.body.result.entries.length, 1);
    assert.equal(list.body.result.entries[0].observations, "corrected in place");
    const del = await lens(member, "notebook-delete", { id });
    assert.equal(del.body?.result?.deleted, id);
    const after = await lens(member, "notebook-list", {});
    assert.equal(after.body.result.entries.length, 0);
  });

  it("live_pubchem returns caffeine as CID 2519 with its SMILES populated", async () => {
    const r = await lens(member, "live_pubchem", { query: "caffeine" });
    assert.equal(r.status, 200);
    const payload = r.body?.result;
    assert.equal(payload?.ok, true);
    assert.equal(payload.compounds?.[0]?.cid, 2519);
    assert.ok(typeof payload.compounds[0].smiles === "string" && payload.compounds[0].smiles.length > 0,
      "the SMILES field lands (the property-rename fix)");
  });
});
