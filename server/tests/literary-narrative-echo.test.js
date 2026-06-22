// server/tests/literary-narrative-echo.test.js
//
// Tier-1 LRL-as-hub (#30) — narrative-bridge.buildLiteraryEcho grounds NPC
// dialogue in a resonant public-domain passage. Best-effort + secret-safe.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { ingestWork } from "../lib/literary-ingest.js";
import { buildLiteraryEcho } from "../lib/narrative-bridge.js";

const SAMPLE = `
CHAPTER I. Power
To be, or not to be — the question of power and conscience.
${"Crowns and thrones rise and fall on the will of those who dare to grasp them. ".repeat(30)}
`;

describe("LRL hub — narrative literary echo (#30)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    await ingestWork(db, { gutenbergId: "1232", title: "The Prince", author: "Machiavelli", pdVerified: 1 }, SAMPLE, { doEmbed: false });
  });

  it("echoes a resonant passage for an NPC whose goal matches a theme", () => {
    const echo = buildLiteraryEcho({ narrative_context: { current_goal: "seize power and silence conscience" } }, db);
    assert.ok(echo, "found a resonant passage");
    assert.match(echo.quote.toLowerCase(), /power|conscience|crown/);
    assert.equal(echo.source, "The Prince");
    assert.equal(echo.author, "Machiavelli");
  });

  it("returns null gracefully when there is no theme", () => {
    assert.equal(buildLiteraryEcho({ narrative_context: {} }, db), null);
    assert.equal(buildLiteraryEcho(null, db), null);
  });

  it("returns null gracefully when no literary corpus exists", async () => {
    const bare = new Database(":memory:");
    await runMigrations(bare);
    // corpus tables exist but empty → no match → null
    assert.equal(buildLiteraryEcho({ narrative_context: { current_goal: "power" } }, bare), null);
  });
});
