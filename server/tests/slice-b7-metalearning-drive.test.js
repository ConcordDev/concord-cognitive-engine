import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMetalearningActions from "../domains/metalearning.js";

const actions = new Map();
registerMetalearningActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`metalearning:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "metalearning", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-metalearning-003: every own record type updates in place", () => {
  const card = call("srsAddCard", { front: "Q?", back: "A", topic: "bio" }).result.card;
  const cu = call("srsUpdateCard", { id: card.id, front: "Q2?", back: "A2" });
  assert.equal(cu.result.card.front, "Q2?");
  assert.equal(cu.result.card.topic, "bio"); // untouched keeps
  assert.equal(cu.result.card.ease, 2.5); // SRS state untouched by an edit

  const plan = call("planCreate", { title: "Plan A", topics: ["x"] }).result.plan;
  const pu = call("planUpdate", { id: plan.id, title: "Plan A+", goal: "Ship it" });
  assert.equal(pu.result.plan.title, "Plan A+");
  assert.equal(pu.result.plan.topics.length, 1);

  const goal = call("goalCreate", { title: "Read 10", targetValue: 10 }).result.goal;
  const gu = call("goalUpdate", { id: goal.id, targetValue: 12, deadline: "2027-01-01" });
  assert.equal(gu.result.goal.targetValue, 12);
  assert.equal(gu.result.goal.deadline, "2027-01-01");

  const exp = call("experimentCreate", { title: "A/B", strategyA: "skim", strategyB: "deep" }).result.experiment;
  const eu = call("experimentUpdate", { id: exp.id, hypothesis: "Deep wins on retention" });
  assert.equal(eu.result.experiment.hypothesis, "Deep wins on retention");
  assert.equal(eu.result.experiment.strategyA.name, "skim");

  const entry = call("journalAdd", { reflection: "Hard session", topic: "bio" }).result.entry;
  const ju = call("journalUpdate", { id: entry.id, reflection: "Hard but useful", minutesStudied: 45 });
  assert.equal(ju.result.entry.reflection, "Hard but useful");
  assert.equal(ju.result.entry.minutesStudied, 45);

  assert.equal(call("srsUpdateCard", { id: "nope", front: "x" }).ok, false);
  assert.equal(call("journalUpdate", { id: entry.id, reflection: " " }).ok, false);
});
