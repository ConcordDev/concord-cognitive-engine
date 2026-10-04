// listTeachableRecipes offers exactly the recipes requestMentorship accepts:
// created by that NPC and at revision depth >= 1, deepest first.

import { it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { listTeachableRecipes } from "../lib/mentorship.js";
import registerKnowledgeTradeMacros from "../domains/knowledge-trade.js";

function db() {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, creator_id TEXT, meta_json TEXT)");
  const ins = d.prepare("INSERT INTO dtus VALUES (?, ?, ?, ?)");
  ins.run("r1", "Iron sword", "npc_smith", JSON.stringify({ revision_num: 2 }));
  ins.run("r2", "Steel sword", "npc_smith", JSON.stringify({ revision_num: 6 }));
  ins.run("r3", "First draft", "npc_smith", JSON.stringify({ revision_num: 0 }));
  ins.run("r4", "Bread", "npc_baker", JSON.stringify({ revision_num: 3 }));
  return d;
}

it("lists only the NPC's own recipes with depth >= 1, deepest first", () => {
  assert.deepEqual(listTeachableRecipes(db(), "npc_smith"), [
    { recipeDtuId: "r2", title: "Steel sword", depth: 6 },
    { recipeDtuId: "r1", title: "Iron sword", depth: 2 },
  ]);
  assert.deepEqual(listTeachableRecipes(db(), "npc_nobody"), []);
});

it("knowledge_trade.mentor_recipes exposes it", async () => {
  const map = new Map();
  registerKnowledgeTradeMacros((_d, n, fn) => map.set(n, fn));
  const r = await map.get("mentor_recipes")({ db: db() }, { mentorNpcId: "npc_baker" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.recipes.map((x) => x.recipeDtuId), ["r4"]);
  assert.equal((await map.get("mentor_recipes")({ db: db() }, {})).ok, false);
});
