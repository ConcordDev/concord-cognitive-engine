// Dead-wire fix (2026-06-26): authored dialogue trees load at boot keyed
// `npcId:questId:phase` (3-part, e.g. `coalition_enforcer:idle:default`), but
// getAuthoredDialogue's idle fallback queried the 2-part `npcId:idle`, which
// never matched — so a bare getAuthoredDialogue(npcId) returned null and the
// hand-authored voice never reached the dialogue route. This pins the fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedContent, getAuthoredDialogue } from "../lib/content-seeder.js";

test("getAuthoredDialogue(npcId) resolves the idle:default tree (3-part key)", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  await seedContent({ db });

  // coalition_enforcer has an authored `coalition_enforcer:idle:default` tree
  // (content/dialogues/coalition.json).
  const bare = getAuthoredDialogue("coalition_enforcer");
  assert.ok(bare, "bare npcId lookup must resolve the idle:default tree (was the bug)");
  assert.equal(typeof bare.greeting, "string");
  assert.ok(bare.greeting.length > 0, "authored tree carries a real greeting");

  // Explicit 3-part lookup must agree with the bare fallback.
  const explicit = getAuthoredDialogue("coalition_enforcer", "idle", "default");
  assert.equal(explicit?.greeting, bare.greeting);

  // Unknown NPC stays null (no false positives).
  assert.equal(getAuthoredDialogue("no_such_npc_xyz"), null);

  db.close();
});
