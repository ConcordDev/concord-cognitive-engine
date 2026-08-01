// tests/invariant-guardian.test.js
//
// Bidirectional pin for invariant-guardian: the constitutional-invariant
// checks (hardcoded fee/rate constants, and the CODEPATH_INVARIANTS list's
// requireAllOf / forbiddenPatterns / customCheck mechanisms) must flag a
// real violation and must NOT flag the healthy/compliant shape. Each test
// writes only the fixed, hardcoded file paths the detector's own tables
// reference — that IS the detector's design (it audits specific named
// files, not an arbitrary scan).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInvariantGuardian } from "../lib/detectors/invariant-guardian.js";

async function tmpRepo(filesMap = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ivg-"));
  for (const [rel, content] of Object.entries(filesMap)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

describe("invariant-guardian detector — constant audit", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS invariant_file_missing when a required constants source file doesn't exist", async () => {
    dir = await tmpRepo({});
    const r = await runInvariantGuardian({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find(
      (f) => f.id === "invariant_file_missing" && f.location === "server/lib/creative-marketplace-constants.js"
    );
    assert.ok(hit, "a missing required constants file must be flagged");
    assert.equal(hit.severity, "high");
  });

  it("FLAGS invariant_constant_unset when the file exists but the constant isn't declared", async () => {
    dir = await tmpRepo({ "server/lib/creative-marketplace-constants.js": "// no constants declared here\n" });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.id === "invariant_constant_unset" && f.evidence?.name === "PLATFORM_FEE_RATE");
    assert.ok(hit, "an undeclared required constant must be flagged");
    assert.equal(hit.severity, "high");
    assert.equal(hit.evidence.expected, "0.0146");
  });

  it("FLAGS invariant_constant_drift (critical) when the constant's value doesn't match CLAUDE.md", async () => {
    dir = await tmpRepo({ "server/lib/creative-marketplace-constants.js": "const PLATFORM_FEE_RATE = 0.05;\n" });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.id === "invariant_constant_drift" && f.evidence?.name === "PLATFORM_FEE_RATE");
    assert.ok(hit, "a drifted constant value must be flagged");
    assert.equal(hit.severity, "critical");
    assert.equal(hit.evidence.actual, "0.05");
    assert.equal(hit.evidence.expected, "0.0146");
  });

  it("does NOT flag a constant whose value matches the required invariant exactly", async () => {
    dir = await tmpRepo({ "server/lib/creative-marketplace-constants.js": "const PLATFORM_FEE_RATE = 0.0146;\n" });
    const r = await runInvariantGuardian({ root: dir });
    const driftHit = r.findings.find((f) => f.id === "invariant_constant_drift" && f.evidence?.name === "PLATFORM_FEE_RATE");
    const unsetHit = r.findings.find((f) => f.id === "invariant_constant_unset" && f.evidence?.name === "PLATFORM_FEE_RATE");
    assert.equal(driftHit, undefined, "the correct value must not be flagged as drifted");
    assert.equal(unsetHit, undefined, "a declared constant must not be flagged as unset");
  });
});

describe("invariant-guardian detector — codepath invariants (requireAllOf)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS no_client_damage_trust when worlds.js is missing the required validation calls", async () => {
    dir = await tmpRepo({ "server/routes/worlds.js": "// nothing here\n" });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "no_client_damage_trust");
    assert.ok(hit, "missing _validateDamageCap/_validateCombatReach must be flagged");
    assert.equal(hit.severity, "critical");
  });

  it("does NOT flag no_client_damage_trust when both required guard calls are present", async () => {
    dir = await tmpRepo({
      "server/routes/worlds.js": "_validateDamageCap(x);\n_validateCombatReach(y);\n",
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "no_client_damage_trust");
    assert.equal(hit, undefined, "both required guard calls being present must not be flagged");
  });
});

describe("invariant-guardian detector — codepath invariants (customCheck: ordering)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS env_boost_after_cap when elementalEnvBoost runs BEFORE _validateDamageCap", async () => {
    dir = await tmpRepo({
      "server/routes/worlds.js": "elementalEnvBoost(x);\n_validateDamageCap(y);\n",
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "env_boost_after_cap");
    assert.ok(hit, "boost-before-cap ordering must be flagged");
    assert.equal(hit.severity, "critical");
    assert.equal(hit.evidence.reason, "env_boost_runs_before_cap");
  });

  it("does NOT flag env_boost_after_cap when _validateDamageCap runs BEFORE elementalEnvBoost", async () => {
    dir = await tmpRepo({
      "server/routes/worlds.js": "_validateDamageCap(y);\nelementalEnvBoost(x);\n",
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "env_boost_after_cap" && f.evidence?.reason === "env_boost_runs_before_cap");
    assert.equal(hit, undefined, "cap-then-boost is the correct order and must not be flagged");
  });
});

describe("invariant-guardian detector — codepath invariants (customCheck: regex scan)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS player_inventory_user_global when a SELECT from player_inventory filters by world_id", async () => {
    dir = await tmpRepo({
      "server/routes/player-inventory.js":
        `const row = db.prepare("SELECT * FROM player_inventory WHERE user_id = ? AND world_id = ?").get(u, w);\n`,
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "player_inventory_user_global");
    assert.ok(hit, "a world_id-gated inventory read must be flagged");
    assert.equal(hit.severity, "high");
    assert.equal(hit.evidence.reason, "world_gated_inventory_read");
  });

  it("does NOT flag player_inventory_user_global for a read scoped by user_id + item_id only", async () => {
    dir = await tmpRepo({
      "server/routes/player-inventory.js":
        `const row = db.prepare("SELECT * FROM player_inventory WHERE user_id = ? AND item_id = ?").get(u, i);\n`,
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "player_inventory_user_global" && f.evidence?.reason === "world_gated_inventory_read");
    assert.equal(hit, undefined, "a user_id/item_id-scoped read is the correct, user-global shape");
  });
});

describe("invariant-guardian detector — codepath invariants (customCheck: walk + try/catch scan)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS heartbeat_try_catch when an exported run*() heartbeat handler has no try/catch", async () => {
    dir = await tmpRepo({
      "server/emergent/foo-cycle.js": "export async function runFooCycle() { doStuff(); }\n",
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "heartbeat_try_catch");
    assert.ok(hit, "a heartbeat handler with no try/catch must be flagged");
    assert.equal(hit.severity, "high");
    assert.equal(hit.evidence.file, "server/emergent/foo-cycle.js");
  });

  it("does NOT flag heartbeat_try_catch when the handler wraps its body in try/catch", async () => {
    dir = await tmpRepo({
      "server/emergent/bar-cycle.js":
        "export async function runBarCycle() { try { doStuff(); } catch (e) { logger.error(e); } }\n",
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "heartbeat_try_catch");
    assert.equal(hit, undefined, "a handler with try/catch must not be flagged");
  });
});

describe("invariant-guardian detector — codepath invariants (customCheck: migration ledger max)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS migrations_append_only (info) when the highest migration number has regressed below 119", async () => {
    dir = await tmpRepo({ "server/migrations/042_something.js": "// migration\n" });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "migrations_append_only");
    assert.ok(hit, "max migration 42 (< 119) must be flagged as regressed");
    assert.equal(hit.severity, "info");
    assert.equal(hit.evidence.reason, "migrations_regressed");
    assert.equal(hit.evidence.max, 42);
  });

  it("does NOT flag migrations_append_only when the highest migration number is >= 119", async () => {
    dir = await tmpRepo({
      "server/migrations/094_bar.js": "// migration\n",
      "server/migrations/119_foo.js": "// migration\n",
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "migrations_append_only");
    assert.equal(hit, undefined, "max migration 119 clears the floor");
  });
});

describe("invariant-guardian detector — codepath invariants (forbiddenPatterns + exclude)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS no_force_npc_pain when a non-test file directly INSERTs npc_id into pain_signals", async () => {
    dir = await tmpRepo({
      "server/lib/embodied/pain.js": "export function recordPain(){}\n",
      "server/lib/npc-cheat.js":
        `db.prepare("INSERT INTO pain_signals (npc_id, intensity) VALUES (?, ?)").run(id, i);\n`,
    });
    const r = await runInvariantGuardian({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.invariant === "no_force_npc_pain");
    assert.ok(hit, "a direct npc_id INSERT into pain_signals outside tests must be flagged");
    assert.equal(hit.severity, "critical");
    assert.ok(hit.location.startsWith("server/lib/npc-cheat.js:"));
  });

  it("does NOT flag no_force_npc_pain for the identical pattern when it lives under a /tests/ path (exclude regex)", async () => {
    // Detector-specific edge case: forbiddenPatterns[0].exclude is checked
    // against the file's relative path BEFORE the pattern is even searched
    // for, so a fixture/test file containing the exact same forbidden SQL
    // shape is intentionally exempted.
    dir = await tmpRepo({
      "server/lib/embodied/pain.js": "export function recordPain(){}\n",
      "server/tests/npc-pain-fixture.js":
        `db.prepare("INSERT INTO pain_signals (npc_id, intensity) VALUES (?, ?)").run(id, i);\n`,
    });
    const r = await runInvariantGuardian({ root: dir });
    const hits = r.findings.filter((f) => f.evidence?.invariant === "no_force_npc_pain");
    assert.equal(hits.length, 0, "the same forbidden pattern under server/tests/ must be excluded, not flagged");
  });
});
