import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForestry from "../domains/forestry.js";
import registerProjects from "../domains/projects.js";
import registerVote from "../domains/vote.js";
import registerAstronomy from "../domains/astronomy.js";
import registerHvac from "../domains/hvac.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function callAs(userId, domain, name, params) {
  const ctx = { actor: { userId }, userId };
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}
const call = (domain, name, params) => callAs("ada", domain, name, params);

before(() => {
  registerForestry(register);
  registerProjects(register);
  registerVote(register);
  registerAstronomy(register);
  registerHvac(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("owner-scoped deletes", () => {
  it("deletes only the caller's pest report and replant project", () => {
    const pest = call("forestry", "pest-report", { agent: "Bark beetle" });
    assert.equal(pest.ok, true);
    const other = callAs("bea", "forestry", "pest-delete", { id: pest.result.report.id });
    assert.equal(other.ok, false);
    const gone = call("forestry", "pest-delete", { id: pest.result.report.id });
    assert.equal(gone.ok, true);
    assert.equal(call("forestry", "pest-list", {}).result.count, 0);

    const project = call("forestry", "replant-project-create", { name: "North", acres: 4 });
    assert.equal(project.ok, true);
    const removed = call("forestry", "replant-delete", { id: project.result.project.id });
    assert.equal(removed.ok, true);
    assert.equal(call("forestry", "replant-list", {}).result.count, 0);
  });

  it("deletes the owner's sprint and leaves another user's sprint", () => {
    const project = call("projects", "project-create", { name: "Bridge", startDate: "2026-11-01", targetDate: "2026-12-01" });
    assert.equal(project.ok, true);
    const projectId = project.result.project.id;
    const sprint = call("projects", "sprint-create", { projectId, name: "Week 1", startDate: "2026-11-01", endDate: "2026-11-14" });
    assert.equal(sprint.ok, true);
    const stranger = callAs("bea", "projects", "sprint-delete", { id: sprint.result.sprint.id });
    assert.equal(stranger.ok, false);
    const gone = call("projects", "sprint-delete", { id: sprint.result.sprint.id });
    assert.equal(gone.ok, true);
    assert.equal(call("projects", "sprint-list", { projectId }).result.count, 0);
  });

  it("lets only the poll owner delete it", () => {
    const created = call("vote", "poll-create", { title: "Bridge levy", options: ["yes", "no"] });
    assert.equal(created.ok, true);
    const id = created.result.poll.id;
    const stranger = callAs("bea", "vote", "poll-delete", { pollId: id });
    assert.equal(stranger.ok, false);
    const gone = call("vote", "poll-delete", { pollId: id });
    assert.equal(gone.ok, true);
    assert.equal(call("vote", "poll-list", {}).result.polls.some((p) => p.id === id), false);
  });

  it("deletes only the caller's observing session", () => {
    const created = call("astronomy", "session-create", { location: "Ridge" });
    assert.equal(created.ok, true);
    const id = created.result.session.id;
    assert.equal(callAs("bea", "astronomy", "session-delete", { id }).ok, false);
    assert.equal(call("astronomy", "session-delete", { id }).ok, true);
    assert.equal(call("astronomy", "session-list", {}).result.count, 0);
  });

  it("deletes only the caller's saved load estimate", () => {
    const saved = call("hvac", "loadCalculation", { squareFootage: 1800, stories: 2, insulation: "average", climate: "temperate", save: true });
    assert.equal(saved.ok, true);
    const id = saved.result.loadId;
    assert.ok(id);
    assert.equal(callAs("bea", "hvac", "load-delete", { id }).ok, false);
    assert.equal(call("hvac", "load-delete", { id }).ok, true);
    assert.equal(call("hvac", "load-list", {}).result.loads.length, 0);
  });
});
