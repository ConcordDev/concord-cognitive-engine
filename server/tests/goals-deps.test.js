// S9 — dependency state on the object (Review 5 F10), real domain import.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s9-test" } };
const tree = (p) => actions.get("goals.alignmentTree")(ctx, null, p);
const deps = (p) => actions.get("goals.dependencies")(ctx, null, p);
const byId = (r) => Object.fromEntries(r.result.flat.map((o) => [o.id, o]));

beforeEach(() => { globalThis._concordSTATE = {}; });

test("blockedBy rides the objective; unlink clears it", async () => {
  await tree({ op: "upsert", title: "Blocker" });
  await tree({ op: "upsert", title: "Waiting" });
  await deps({ op: "link", from: "obj_1", to: "obj_2", kind: "blocks" });
  let flat = byId(await tree({ op: "list" }));
  assert.deepEqual(flat.obj_2.blockedBy, ["obj_1"]);
  await deps({ op: "unlink", from: "obj_1", to: "obj_2" });
  flat = byId(await tree({ op: "list" }));
  assert.deepEqual(flat.obj_2.blockedBy, []);
});
