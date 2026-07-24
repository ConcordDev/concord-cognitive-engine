/**
 * Round-trip contract tests for server/lib/world-template-pack.js —
 * export an authored sub-world into a versioned envelope, import it
 * under a new world id, and prove:
 *   - every file present (including nested directories like quests/) is
 *     packed and every literal occurrence of the source world id is
 *     replaced with the placeholder token
 *   - import substitutes the placeholder back to the new world id
 *     throughout every file, and every record that has a real
 *     content-seeder.js validator passes it
 *   - a tampered envelope (one byte flipped) fails integrity
 *     verification and the import refuses to write anything
 *   - an envelope containing a record that fails validation is rejected
 *     wholesale — no partial write
 *
 * Every test operates against isolated mkdtemp roots via the
 * `contentRoot` parameter. The real repo's content/world/ tree is never
 * touched. Run: node --test server/tests/world-template-pack.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  exportWorldPack,
  importWorldPack,
  validateWorldPackEnvelope,
} from "../lib/world-template-pack.js";

const FIXTURE_WORLD_ID = "fixture-world";

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * Seeds a throwaway fixture world (4 core files + one enrichment file +
 * one nested quests/ file) into `<root>/content/world/<worldId>/`.
 * Mirrors the real shape of content/world/<id>/ (see sere/tunya on disk):
 * meta/npcs/factions/lore at top level, arbitrary enrichment files
 * alongside, and a quests/ subdirectory of individually-validated quest
 * records.
 */
function seedFixtureWorld(root, worldId) {
  const dir = path.join(root, "content", "world", worldId);

  writeJson(path.join(dir, "meta.json"), {
    world_id: worldId,
    world_name: "Fixture World",
    universe_type: worldId, // real worlds (sere, tunya) use world_id === universe_type
    is_hub: false,
    description: `Fixture world for round-trip testing (${worldId}).`,
    skill_affinity: { default: 0.7 },
    rule_modulators: {},
  });

  writeJson(path.join(dir, "npcs.json"), [
    {
      id: `${worldId}_first_resident`,
      name: "Test Resident",
      faction_id: `${worldId}_founding_circle`,
      world_id: worldId,
      archetype: "villager",
      personality: `A fixture resident of ${worldId}.`,
      background: `No real background — this is a ${worldId} test fixture.`,
      narrative_context: {},
    },
  ]);

  writeJson(path.join(dir, "factions.json"), [
    {
      id: `${worldId}_founding_circle`,
      name: "The Fixture Circle",
      world_id: worldId,
      goal: `A fixture faction for ${worldId}.`,
      visual: {
        primary_color: "#4a4a4a",
        secondary_color: "#1a1a1a",
        accent_color: "#8a8a8a",
      },
    },
  ]);

  writeJson(path.join(dir, "lore.json"), {
    world_id: worldId,
    world_name: "Fixture World",
    world_description: `The lore of ${worldId}.`,
    history: [
      {
        id: `lore_${worldId}_founding`,
        title: `The Founding of ${worldId}`,
        type: "founding_event",
        era: "unspecified",
        description: `Fixture founding event for ${worldId}.`,
        significance: "minor",
      },
    ],
  });

  // Enrichment file (world-kit-templates.js style) — no dedicated
  // content-seeder.js validator, but should still be packed + substituted.
  writeJson(path.join(dir, "calendar.json"), {
    world_id: worldId,
    days_per_year: 42,
    notes: `Calendar for ${worldId}.`,
  });

  // Nested subdirectory — mirrors tunya/sere's quests/ dirs.
  writeJson(path.join(dir, "quests", "intro.json"), {
    id: `${worldId}_intro_quest`,
    title: `Intro quest to ${worldId}`,
    objectives: [{ id: "obj1", type: "visit" }],
  });

  return dir;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("exportWorldPack packs every file and de-identifies the world id", () => {
  const root = makeTempRoot("world-pack-export-");
  try {
    seedFixtureWorld(root, FIXTURE_WORLD_ID);

    const result = exportWorldPack(FIXTURE_WORLD_ID, root);
    assert.equal(result.ok, true);
    const { envelope } = result;

    assert.equal(envelope.spec, "concord-world-template-pack/v1");
    assert.equal(envelope.source_world_id, FIXTURE_WORLD_ID);
    assert.equal(envelope.placeholder_token, "__WORLD_ID__");
    // 4 core files + calendar.json + quests/intro.json = 6
    assert.equal(envelope.files.length, 6);
    assert.equal(envelope.counts.files, 6);

    const paths = envelope.files.map(f => f.path).sort();
    assert.deepEqual(paths, [
      "calendar.json",
      "factions.json",
      "lore.json",
      "meta.json",
      "npcs.json",
      "quests/intro.json",
    ]);

    // No literal occurrence of the source world id survives anywhere in
    // the packed content — every file's raw text is scrubbed.
    for (const f of envelope.files) {
      assert.ok(
        !f.content.includes(FIXTURE_WORLD_ID),
        `${f.path} still contains a literal "${FIXTURE_WORLD_ID}" after export substitution`,
      );
      assert.ok(f.content.includes("__WORLD_ID__"), `${f.path} should reference the placeholder token`);
    }

    // Integrity hash verifies on the freshly-produced envelope.
    const v = validateWorldPackEnvelope(envelope);
    assert.equal(v.ok, true);
    assert.equal(v.fileCount, 6);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importWorldPack round-trips into a new world id, substituting throughout and validating every record", async () => {
  const sourceRoot = makeTempRoot("world-pack-src-");
  const destRoot = makeTempRoot("world-pack-dest-");
  const newWorldId = "fixture-world-v2";
  try {
    seedFixtureWorld(sourceRoot, FIXTURE_WORLD_ID);
    const { envelope } = exportWorldPack(FIXTURE_WORLD_ID, sourceRoot);

    const result = await importWorldPack(envelope, newWorldId, destRoot);
    assert.equal(result.ok, true, JSON.stringify(result.problems || result.reason));
    assert.equal(result.worldId, newWorldId);
    assert.equal(result.imported.files, 6);
    assert.equal(result.imported.npcs, 1);
    assert.equal(result.imported.factions, 1);
    assert.equal(result.imported.loreEvents, 1);
    assert.equal(result.imported.quests, 1);
    assert.equal(result.imported.other, 1); // calendar.json

    const worldDir = path.join(destRoot, "content", "world", newWorldId);
    assert.ok(fs.existsSync(worldDir));

    const meta = readJson(path.join(worldDir, "meta.json"));
    assert.equal(meta.world_id, newWorldId);
    assert.equal(meta.universe_type, newWorldId);
    // No leftover placeholder token anywhere in the written meta.json —
    // note newWorldId ("fixture-world-v2") literally CONTAINS the source
    // id ("fixture-world") as a prefix, so checking for the placeholder
    // token (rather than the substring-ambiguous source id) is the
    // correct "no stale reference" assertion here.
    assert.ok(!JSON.stringify(meta).includes("__WORLD_ID__"));

    const npcs = readJson(path.join(worldDir, "npcs.json"));
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].world_id, newWorldId);
    assert.equal(npcs[0].id, `${newWorldId}_first_resident`);
    assert.equal(npcs[0].faction_id, `${newWorldId}_founding_circle`);
    assert.ok(npcs[0].personality.includes(newWorldId));

    const factions = readJson(path.join(worldDir, "factions.json"));
    assert.equal(factions[0].world_id, newWorldId);
    assert.equal(factions[0].id, `${newWorldId}_founding_circle`);

    const lore = readJson(path.join(worldDir, "lore.json"));
    assert.equal(lore.world_id, newWorldId);
    assert.equal(lore.history[0].id, `lore_${newWorldId}_founding`);
    assert.ok(lore.history[0].title.includes(newWorldId));

    const calendar = readJson(path.join(worldDir, "calendar.json"));
    assert.equal(calendar.world_id, newWorldId);

    const quest = readJson(path.join(worldDir, "quests", "intro.json"));
    assert.equal(quest.id, `${newWorldId}_intro_quest`);
    assert.ok(quest.title.includes(newWorldId));

    // The source world's real content/world/ tree (and the sourceRoot
    // copy) is untouched by the import.
    assert.ok(fs.existsSync(path.join(sourceRoot, "content", "world", FIXTURE_WORLD_ID, "meta.json")));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test("a tampered envelope fails integrity verification and refuses to import", async () => {
  const sourceRoot = makeTempRoot("world-pack-tamper-src-");
  const destRoot = makeTempRoot("world-pack-tamper-dest-");
  const newWorldId = "fixture-world-tampered";
  try {
    seedFixtureWorld(sourceRoot, FIXTURE_WORLD_ID);
    const { envelope } = exportWorldPack(FIXTURE_WORLD_ID, sourceRoot);

    // Flip one byte deep inside a packed file's content, leaving the
    // recorded hash untouched — the classic single-bit-flip tamper.
    const tampered = JSON.parse(JSON.stringify(envelope));
    const metaFile = tampered.files.find(f => f.path === "meta.json");
    assert.ok(metaFile);
    metaFile.content = metaFile.content.replace('"is_hub": false', '"is_hub": true');

    const integrity = validateWorldPackEnvelope(tampered);
    assert.equal(integrity.ok, false);
    assert.equal(integrity.reason, "files_hash_mismatch");

    const result = await importWorldPack(tampered, newWorldId, destRoot);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "files_hash_mismatch");

    const worldDir = path.join(destRoot, "content", "world", newWorldId);
    assert.equal(fs.existsSync(worldDir), false, "tampered import must not write anything to disk");
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test("an envelope with an invalid record is rejected wholesale — no partial write", async () => {
  const sourceRoot = makeTempRoot("world-pack-invalid-src-");
  const destRoot = makeTempRoot("world-pack-invalid-dest-");
  const newWorldId = "fixture-world-invalid";
  try {
    seedFixtureWorld(sourceRoot, FIXTURE_WORLD_ID);
    const { envelope } = exportWorldPack(FIXTURE_WORLD_ID, sourceRoot);

    // Corrupt the packed npcs.json content so the record fails
    // validateNpc() (missing required `name`) AFTER placeholder
    // substitution, then recompute the hash so integrity itself still
    // verifies — this isolates the "content-seeder validator rejects a
    // bad record" path from the "tampered hash" path tested above.
    const corrupted = JSON.parse(JSON.stringify(envelope));
    const npcsFile = corrupted.files.find(f => f.path === "npcs.json");
    const npcs = JSON.parse(npcsFile.content.split("__WORLD_ID__").join(FIXTURE_WORLD_ID));
    delete npcs[0].name;
    npcsFile.content = JSON.stringify(npcs).split(FIXTURE_WORLD_ID).join("__WORLD_ID__");

    const { canonicalStringify } = await import("../lib/dtu-portability.js");
    const crypto = await import("node:crypto");
    corrupted.hashes.files_sha256 = crypto
      .createHash("sha256")
      .update(canonicalStringify(corrupted.files))
      .digest("hex");

    const result = await importWorldPack(corrupted, newWorldId, destRoot);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "validation_failed");
    assert.ok(Array.isArray(result.problems) && result.problems.length > 0);
    assert.ok(result.problems.some(p => p.includes("validateNpc")));

    const worldDir = path.join(destRoot, "content", "world", newWorldId);
    assert.equal(fs.existsSync(worldDir), false, "an invalid record must block the entire import — no partial write");
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test("importWorldPack refuses to overwrite an existing world dir without --force", async () => {
  const sourceRoot = makeTempRoot("world-pack-exists-src-");
  const destRoot = makeTempRoot("world-pack-exists-dest-");
  const newWorldId = "fixture-world-exists";
  try {
    seedFixtureWorld(sourceRoot, FIXTURE_WORLD_ID);
    const { envelope } = exportWorldPack(FIXTURE_WORLD_ID, sourceRoot);

    const first = await importWorldPack(envelope, newWorldId, destRoot);
    assert.equal(first.ok, true);

    const second = await importWorldPack(envelope, newWorldId, destRoot);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "world_dir_exists");

    const third = await importWorldPack(envelope, newWorldId, destRoot, { force: true });
    assert.equal(third.ok, true);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});
