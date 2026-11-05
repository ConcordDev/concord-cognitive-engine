// server/tests/e2e/cooking-full-build.test.js
//
// GB-1088 cooking build — member-driven legs through the real server:
// the AI meal plan's review step over the wire (preview persists
// nothing; apply persists exactly the preview), and the cook log the
// cook-mode Finish writes (recipe-log-cooked → recipe-history).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../..");
const PORT = 18756;
const BASE = `http://127.0.0.1:${PORT}`;
const UA = { "User-Agent": "Mozilla/5.0 (e2e)", "Content-Type": "application/json" };

let proc = null;
let dataDir = null;

async function waitReady(deadlineMs = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function register(username) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: UA,
    body: JSON.stringify({ username, password: "e2e-pass-123", email: `${username}@example.com`, dateOfBirth: "1995-01-01", _t: Date.now() - 5000 }),
  });
  const j = await r.json();
  return j.token || j.accessToken || j?.session?.token;
}

async function run(tok, name, input) {
  const r = await fetch(`${BASE}/api/lens/run`, {
    method: "POST", headers: { ...UA, Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ domain: "cooking", name, input }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-ck-e2e-"));
  proc = spawn(process.execPath, ["server.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "e2e-test", CONCORD_NO_LISTEN: "false", CONCORD_LOAD_SHED_ENABLED: "0",
      CONCORD_USER_CACHE_TTL_MS: "0", CONCORD_DISABLE_BRAINS: "true", AUTH_MODE: "hybrid",
      PORT: String(PORT), DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  assert.equal(await waitReady(), true, "server became ready");
});

after(() => {
  if (proc) proc.kill("SIGKILL");
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("cooking full build — member legs over the wire", () => {
  it("AI meal plan: preview persists nothing, apply persists the preview", async () => {
    await register("ck_e2e_owner");
    const member = await register("ck_e2e_member");
    const c1 = await run(member, "recipes-create", { title: "Wire Pancakes", servings: 4, ingredients: [{ name: "flour", qty: 2, unit: "cups" }], steps: ["Mix", "Fry"] });
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    await run(member, "recipes-create", { title: "Wire Soup", servings: 2, ingredients: [{ name: "potato", qty: 3, unit: "" }], steps: ["Boil"] });

    const preview = await run(member, "ai-meal-plan", { days: 7, slots: ["dinner"] });
    assert.equal(preview.body?.result?.preview, true, JSON.stringify(preview.body));
    const planAfterPreview = await run(member, "meal-plan-get", {});
    assert.equal(planAfterPreview.body?.result?.entries?.length, 0, "preview wrote nothing");

    const applied = await run(member, "ai-meal-plan", { assignments: preview.body.result.assigned });
    assert.equal(applied.body?.result?.applied, true, JSON.stringify(applied.body));
    const planAfterApply = await run(member, "meal-plan-get", {});
    assert.equal(planAfterApply.body?.result?.entries?.length, 7, "the reviewed week persisted");
  });

  it("cook log: recipe-log-cooked lands in recipe-history (the Finish leg)", async () => {
    const member2 = await register("ck_e2e_cook");
    const c = await run(member2, "recipes-create", { title: "Wire Toast", servings: 1, ingredients: [{ name: "bread", qty: 2, unit: "slices" }], steps: ["Toast it"] });
    const id = c.body?.result?.recipe?.id;
    const log = await run(member2, "recipe-log-cooked", { id, note: "Cook mode" });
    assert.equal(log.body?.result?.timesCooked, 1, JSON.stringify(log.body));
    const hist = await run(member2, "recipe-history", { id });
    assert.equal(hist.body?.result?.timesCooked, 1);
    assert.equal(hist.body?.result?.madeLog?.[0]?.note, "Cook mode");
  });

  it("member isolation: a second member's box is empty", async () => {
    const other = await register("ck_e2e_other");
    const list = await run(other, "recipes-list", {});
    assert.equal(list.body?.result?.recipes?.length, 0);
  });
});
