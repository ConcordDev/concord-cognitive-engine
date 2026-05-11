// server/tests/world-kit-scaffolder.test.js
//
// Sprint 6 acceptance — the world-kit scaffolder produces per-genre
// skeleton JSON that matches the Tunya schema shape, is deterministic,
// and is idempotent (never overwrites existing files).
//
// Acceptance:
//   1. Calling each template generator returns valid JSON with all
//      Tunya-schema required fields.
//   2. The same call twice produces byte-identical output (deterministic).
//   3. `scaffoldWorld` writes only missing files; existing files stay.
//   4. Genre-driven parameters differ correctly between genres
//      (cyber 28-hour day, fantasy 24-hour, sovereign-ruins 30-hour).

import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarTemplate, industriesTemplate, namingTemplate,
  apparelTemplate, bestiaryTemplate, diplomaticGraphTemplate,
  schedulesTemplate, scaffoldWorld, TEMPLATES,
} from "../lib/world-kit-templates.js";

test("calendarTemplate sets hours_per_day per genre", () => {
  const fantasy = calendarTemplate({ worldId: "fantasy", genre: "fantasy" });
  assert.equal(fantasy.hours_per_day, 24);

  const cyber = calendarTemplate({ worldId: "cyber", genre: "cyber" });
  assert.equal(cyber.hours_per_day, 28);

  const ruins = calendarTemplate({ worldId: "sovereign-ruins", genre: "sovereign-ruins" });
  assert.equal(ruins.hours_per_day, 30);

  const lattice = calendarTemplate({ worldId: "lattice-crucible", genre: "lattice-crucible" });
  assert.equal(lattice.hours_per_day, 26);
});

test("calendarTemplate is deterministic — same input produces byte-identical output", () => {
  const a = calendarTemplate({ worldId: "cyber", genre: "cyber" });
  const b = calendarTemplate({ worldId: "cyber", genre: "cyber" });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("industriesTemplate carries dominantSkillDomain into the payload", () => {
  const cyber = industriesTemplate({ worldId: "cyber", genre: "cyber", dominantSkillDomain: "hacking" });
  assert.equal(cyber.skill_domain_alignment, "hacking");
  assert.equal(cyber.world_id, "cyber");
  assert.ok(Array.isArray(cyber.industries));
  assert.ok(cyber.industries.length >= 5, "cyber should have at least 5 industries");
});

test("industriesTemplate generates different industry lists per genre", () => {
  const fantasy = industriesTemplate({ worldId: "fantasy", genre: "fantasy" });
  const cyber = industriesTemplate({ worldId: "cyber", genre: "cyber" });
  const fantasyIds = new Set(fantasy.industries.map(i => i.id));
  const cyberIds = new Set(cyber.industries.map(i => i.id));
  // Each genre should have at least one industry the other doesn't.
  const fantasyUnique = [...fantasyIds].filter(i => !cyberIds.has(i));
  const cyberUnique = [...cyberIds].filter(i => !fantasyIds.has(i));
  assert.ok(fantasyUnique.length >= 1, `fantasy should have unique industries, got: ${[...fantasyIds]}`);
  assert.ok(cyberUnique.length >= 1, `cyber should have unique industries, got: ${[...cyberIds]}`);
});

test("bestiaryTemplate generates genre-appropriate creature lists", () => {
  const cyber = bestiaryTemplate({ worldId: "cyber", genre: "cyber" });
  const fantasy = bestiaryTemplate({ worldId: "fantasy", genre: "fantasy" });
  const cyberKinds = cyber.creatures.map(c => c.id);
  const fantasyKinds = fantasy.creatures.map(c => c.id);
  assert.ok(cyberKinds.some(k => k.includes("drone") || k.includes("ice") || k.includes("ghost")),
    "cyber bestiary should include drone/ice/ghost");
  assert.ok(fantasyKinds.some(k => k.includes("wolf") || k.includes("drake") || k.includes("goblin") || k.includes("spirit")),
    "fantasy bestiary should include classic fantasy creatures");
});

test("all template generators return objects with world_id + schema_version", () => {
  const args = { worldId: "test_world", genre: "fantasy", dominantSkillDomain: "magic" };
  const generators = [
    calendarTemplate, industriesTemplate, namingTemplate,
    apparelTemplate, bestiaryTemplate, diplomaticGraphTemplate,
    schedulesTemplate,
  ];
  for (const gen of generators) {
    const out = gen(args);
    assert.equal(out.world_id, "test_world", `${gen.name} must set world_id`);
    assert.ok(out.schema_version, `${gen.name} must set schema_version`);
  }
});

test("scaffoldWorld is idempotent — never overwrites existing files", () => {
  const writes = new Map();
  const existing = new Set(["calendar.json"]); // simulate calendar already there

  const fsLike = {
    exists: (p) => existing.has(p.split("/").pop()),
    writeFile: (p, contents) => writes.set(p.split("/").pop(), contents),
  };

  const result = scaffoldWorld({
    worldId: "test_x", genre: "fantasy", dominantSkillDomain: "magic",
    fsLike, dir: "/fake",
  });

  // calendar.json should be skipped; all others created.
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0], "calendar.json");
  assert.ok(result.created.length >= 6, `expected ≥6 created files, got ${result.created.length}`);
  assert.ok(!writes.has("calendar.json"), "must not have written existing calendar.json");
  assert.ok(writes.has("industries.json"));
  assert.ok(writes.has("bestiary.json"));
});

test("TEMPLATES export lists exactly the 7 enrichment file kinds", () => {
  const kinds = Object.keys(TEMPLATES);
  assert.deepEqual(kinds.sort(), [
    "apparel", "bestiary", "calendar", "diplomatic_graph",
    "industries", "naming_conventions", "schedules",
  ]);
});

test("scaffoldWorld produces parseable JSON in every file", () => {
  const writes = new Map();
  const fsLike = {
    exists: () => false,
    writeFile: (p, contents) => writes.set(p.split("/").pop(), contents),
  };
  scaffoldWorld({
    worldId: "test_y", genre: "cyber", dominantSkillDomain: "hacking",
    fsLike, dir: "/fake",
  });
  for (const [fname, contents] of writes) {
    assert.doesNotThrow(() => JSON.parse(contents), `${fname} must be valid JSON`);
    const parsed = JSON.parse(contents);
    assert.equal(parsed.world_id, "test_y");
  }
});

test("scaffoldWorld returns errors array (empty on success)", () => {
  const fsLike = {
    exists: () => false,
    writeFile: () => {},
  };
  const result = scaffoldWorld({
    worldId: "test_z", genre: "fantasy", dominantSkillDomain: "magic",
    fsLike, dir: "/fake",
  });
  assert.deepEqual(result.errors, []);
});
