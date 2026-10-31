// S6 — templates instantiate (Review 5 F6), real domain import.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s6-test" } };
const templates = (p) => actions.get("goals.templates")(ctx, null, p);
const tree = (p) => actions.get("goals.alignmentTree")(ctx, null, p);

beforeEach(() => { globalThis._concordSTATE = {}; });

test("applying Quarterly OKR creates the objective and its 3 KRs", async () => {
  const r = await templates({ op: "apply", templateId: "tpl_okr_quarter" });
  assert.equal(r.ok, true);
  assert.equal(r.result.objective.keyResults.length, 3);
  assert.ok(r.result.recurring);
  const t = await tree({ op: "list" });
  assert.equal(t.result.stats.keyResultsLinked, 3);
  const bad = await templates({ op: "apply", templateId: "tpl_nope" });
  assert.equal(bad.ok, false);
});

test("generated occurrences persist as findable objects", async () => {
  await templates({ op: "recurring-create", title: "Weekly review", cadence: "weekly", startAt: "2026-10-01T00:00:00.000Z" });
  const r = await templates({ op: "recurring-run-due" });
  assert.ok(r.result.created.length >= 3);
  const listed = await templates({ op: "occurrences-list" });
  assert.equal(listed.result.occurrences.length, r.result.created.length);
});
