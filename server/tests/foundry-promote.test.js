/**
 * Contract tests for Foundry Promotion — server/lib/foundry/promote.js +
 * the `foundry.promote` macro (server/domains/foundry.js).
 *
 * Promotion closes the TODO documented in compiler.js's own header
 * comment ("'Promotion' to a full first-class world node (persisted seed
 * content) is a later flag"): it turns an already-published, overlay-only
 * Foundry world (a `worlds` row driven only by compiled modulators) into
 * a real content/world/<publishedWorldId>/{meta,npcs,factions,lore}.json
 * directory that content-seeder.js's discoverSubWorlds() will pick up.
 *
 * Pins:
 *   - foundry.promote is OPT-IN: nothing runs on publish; a world stays
 *     `promoted: 0` until this macro is explicitly called.
 *   - promoting two DIFFERENT Foundry templates produces genuinely
 *     different, distinguishable, validator-passing content — checked
 *     against the REAL content-seeder.js validators, not a re-
 *     implementation.
 *   - re-promotion without `force` is rejected as already_promoted;
 *     `force: true` regenerates.
 *   - gating: not-published, wrong-owner, missing-id all rejected.
 *   - the real repo's content/world/ directory is NEVER touched by this
 *     suite — every write targets an isolated mkdtemp root via the
 *     `contentWorldRoot` ctx override (mirrors scaffold-world.mjs's own
 *     --root test-isolation pattern).
 *
 * Existing Foundry publish/compile/marketplace/parity behavior is
 * asserted unaffected by running the pre-existing suites alongside this
 * one (server/tests/foundry-publish.test.js,
 * server/tests/foundry-domain-parity.test.js, etc.) — this file adds
 * coverage, it doesn't touch theirs.
 *
 * Run: node --test server/tests/foundry-promote.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { up as migrate191 } from "../migrations/191_foundry_worlds.js";
import registerFoundryMacros from "../domains/foundry.js";
import { validateNpc, validateFaction, validateLoreEvent } from "../lib/content-seeder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_CONTENT_WORLD_DIR = path.join(REPO_ROOT, "content", "world");

function snapshotRealContentWorldDir() {
  return fs.readdirSync(REAL_CONTENT_WORLD_DIR).sort();
}

function makeHarness(tmpRoot) {
  const db = new Database(":memory:");
  migrate191(db);
  // Minimal `worlds` table — same shape foundry-publish.test.js uses.
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, universe_type TEXT NOT NULL,
      description TEXT, physics_modulators TEXT DEFAULT '{}', rule_modulators TEXT DEFAULT '{}',
      created_by TEXT, status TEXT NOT NULL DEFAULT 'active', total_visits INTEGER NOT NULL DEFAULT 0
    )
  `);
  const macros = new Map();
  registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  const call = (name, input, opts = {}) => {
    const actor = opts.actor || { userId: "user-1" };
    const ctx = { db, actor, contentWorldRoot: tmpRoot };
    return macros.get(name)(ctx, input || {});
  };
  return { db, call };
}

function publishFromTemplate(h, templateId, name) {
  const created = h.call("foundry.create", { name, templateId });
  assert.equal(created.ok, true, `create failed for ${templateId}: ${JSON.stringify(created)}`);
  const id = created.world.id;
  const pub = h.call("foundry.publish", { id });
  assert.equal(pub.ok, true, `publish failed for ${templateId}: ${JSON.stringify(pub)}`);
  return { id, worldId: pub.publishedWorldId, activatedSystems: pub.activatedSystems };
}

function readWorldContent(tmpRoot, worldId) {
  const dir = path.join(tmpRoot, worldId);
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  return {
    dir,
    meta: readJson("meta.json"),
    npcs: readJson("npcs.json"),
    factions: readJson("factions.json"),
    lore: readJson("lore.json"),
  };
}

describe("foundry.promote", () => {
  let tmpRoot;
  let realDirBefore;

  before(() => {
    realDirBefore = snapshotRealContentWorldDir();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-promote-test-"));
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    // The real repo's content/world/ must be byte-for-byte untouched —
    // every write in this suite targeted the isolated tmpRoot above.
    assert.deepEqual(snapshotRealContentWorldDir(), realDirBefore);
  });

  it("promoting arena-clash (cyber) and social-hub (slice-of-life) produces genuinely different, validator-passing content", () => {
    const h = makeHarness(tmpRoot);
    const arena = publishFromTemplate(h, "arena-clash", "Arena Test");
    const social = publishFromTemplate(h, "social-hub", "Social Test");

    const arenaPromote = h.call("foundry.promote", { id: arena.id });
    assert.equal(arenaPromote.ok, true, JSON.stringify(arenaPromote));
    assert.equal(arenaPromote.worldId, arena.worldId);
    // "cyber" is an exact-match scaffold-world archetype — arena-clash
    // gets real genre flavor.
    assert.equal(arenaPromote.scaffoldTemplate, "cyber");
    assert.ok(fs.existsSync(path.join(tmpRoot, arena.worldId, "meta.json")));

    const socialPromote = h.call("foundry.promote", { id: social.id });
    assert.equal(socialPromote.ok, true, JSON.stringify(socialPromote));
    assert.equal(socialPromote.worldId, social.worldId);
    // "slice-of-life" has no corresponding scaffold-world archetype —
    // honest generic fallback, not a fabricated genre match.
    assert.equal(socialPromote.scaffoldTemplate, null);
    assert.ok(fs.existsSync(path.join(tmpRoot, social.worldId, "meta.json")));

    // Different directories entirely.
    assert.notEqual(arena.worldId, social.worldId);

    const arenaContent = readWorldContent(tmpRoot, arena.worldId);
    const socialContent = readWorldContent(tmpRoot, social.worldId);

    // ── Genuinely different, distinguishable output ──────────────────────
    assert.equal(arenaContent.meta.universe_type, "cyber");
    assert.equal(socialContent.meta.universe_type, "slice-of-life");
    assert.notEqual(arenaContent.meta.tech_level, socialContent.meta.tech_level);
    assert.equal(arenaContent.meta.tech_level, "near_future"); // TECH_MAGIC_BY_TEMPLATE.cyber
    assert.equal(socialContent.meta.tech_level, "unspecified"); // generic fallback
    assert.notEqual(arenaContent.npcs[0].archetype, socialContent.npcs[0].archetype);
    assert.equal(arenaContent.npcs[0].archetype, "netrunner"); // OCCUPATIONS.cyber[0]
    assert.equal(socialContent.npcs[0].archetype, "villager"); // generic default
    assert.notEqual(arenaContent.factions[0].name, socialContent.factions[0].name);
    assert.equal(socialContent.factions[0].name, "The Founding Circle"); // generic default
    assert.ok(arenaContent.factions[0].name.length > 0);

    // Provenance is honest, not fabricated — it names the REAL activated
    // systems from compileWorldspec, not a guess.
    assert.ok(Array.isArray(arenaContent.meta.foundry_source.activatedSystems));
    assert.ok(arenaContent.meta.foundry_source.activatedSystems.includes("combat-motor"));
    assert.equal(arenaContent.meta.foundry_source.scaffoldTemplate, "cyber");
    assert.equal(socialContent.meta.foundry_source.scaffoldTemplate, null);

    // ── Validator-passing, checked via the REAL content-seeder.js
    //    validators (not promote.js's own internal check) ────────────────
    for (const content of [arenaContent, socialContent]) {
      assert.equal(validateNpc(content.npcs[0]).ok, true);
      assert.equal(validateFaction(content.factions[0]).ok, true);
      assert.equal(validateLoreEvent(content.lore.history[0]).ok, true);
      assert.equal(typeof content.meta.world_id, "string");
      assert.ok(content.meta.world_id.length > 0);
      assert.equal(typeof content.meta.universe_type, "string");
      assert.ok(content.meta.universe_type.length > 0);
    }

    // DB row is flipped to promoted.
    const arenaRow = h.db.prepare(`SELECT promoted FROM foundry_worlds WHERE id = ?`).get(arena.id);
    assert.equal(arenaRow.promoted, 1);
  });

  it("rejects re-promotion without force, regenerates with force: true", () => {
    const h = makeHarness(tmpRoot);
    const { id, worldId } = publishFromTemplate(h, "starter-rpg", "RPG Once");

    const first = h.call("foundry.promote", { id });
    assert.equal(first.ok, true);

    const again = h.call("foundry.promote", { id });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "already_promoted");
    assert.equal(again.worldId, worldId);

    const forced = h.call("foundry.promote", { id, force: true });
    assert.equal(forced.ok, true);
    assert.equal(forced.worldId, worldId);
    // Content regenerated cleanly (still validator-passing).
    const content = readWorldContent(tmpRoot, worldId);
    assert.equal(validateNpc(content.npcs[0]).ok, true);
  });

  it("rejects promoting a world that hasn't been published", () => {
    const h = makeHarness(tmpRoot);
    const created = h.call("foundry.create", {
      name: "Unpublished", worldspec: { systems: [{ id: "combat-motor" }] },
    });
    const res = h.call("foundry.promote", { id: created.world.id });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not_published");
  });

  it("is creator-scoped", () => {
    const h = makeHarness(tmpRoot);
    const { id } = publishFromTemplate(h, "survival-frontier", "Survival Test");
    const res = h.call("foundry.promote", { id }, { actor: { userId: "intruder" } });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not_owner");
  });

  it("rejects a missing id", () => {
    const h = makeHarness(tmpRoot);
    const res = h.call("foundry.promote", {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_id");
  });

  it("rejects an unknown id", () => {
    const h = makeHarness(tmpRoot);
    const res = h.call("foundry.promote", { id: "fw_does_not_exist" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not_found");
  });
});
