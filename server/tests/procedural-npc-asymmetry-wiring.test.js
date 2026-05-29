/**
 * D4 (depth plan) — procedural NPCs participate in the scheme/asymmetry engine.
 *
 * Locks the wiring: the procedural NPC spawner must seed the asymmetry
 * substrate (seedNPCAsymmetry → deriveSchemeSubstrateFromNarrative, T1.3) for
 * each freshly-created procedural NPC, so the deep scheme engine fires for the
 * bulk of the population instead of no-op'ing on everyone but the authored cast.
 *
 * Seeding *behaviour* is pinned by the npc-asymmetry / scheme-cold-start tests;
 * this guards that the spawner actually invokes it on the create branch.
 *
 * Run: node --test tests/procedural-npc-asymmetry-wiring.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("D4 — procedural-npc-spawner seeds asymmetry on create", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "emergent/procedural-npc-spawner.js"), "utf8",
  );

  it("imports seedNPCAsymmetry", () => {
    assert.match(src, /import\s*\{\s*seedNPCAsymmetry\s*\}\s*from\s*["']\.\.\/lib\/npc-asymmetry\.js["']/);
  });

  it("calls seedNPCAsymmetry inside the created branch", () => {
    const idx = src.indexOf('action === "created"');
    assert.ok(idx > 0, "create branch present");
    const seg = src.slice(idx, idx + 1400);
    assert.match(seg, /seedNPCAsymmetry\(db,\s*npc\)/);
    // and it's guarded so a seed failure never kills the spawn loop
    assert.match(seg, /try\s*\{\s*await seedNPCAsymmetry/);
  });
});
