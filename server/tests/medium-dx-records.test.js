import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDxPlatformActions from "../domains/dx-platform.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`dx-platform.${name} not registered`);
  return fn(ctx, input);
}
before(() => { registerDxPlatformActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });
const ctx = { actor: { userId: "user_a" } };

describe("dx-platform records", () => {
  it("renames and deletes a codebase the caller owns", () => {
    const made = call("indexCodebase", ctx, {
      codebaseId: "cb1", name: "Old",
      files: [{ path: "src/index.js", content: "export const answer = 1;\n" }],
    });
    assert.equal(made.ok, true);
    assert.equal(call("renameCodebase", ctx, { codebaseId: "cb1", name: "New" }).result.name, "New");
    assert.equal(call("deleteCodebase", ctx, { codebaseId: "cb1" }).ok, true);
    assert.equal(call("listCodebases", ctx, {}).result.count, 0);
  });

  it("lists a team after create and lets the owner delete it", () => {
    const team = call("createTeam", ctx, { name: "Platform" });
    assert.equal(team.ok, true);
    const listed = call("listMyTeams", ctx, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.teams[0].name, "Platform");
    const huge = call("createTeam", ctx, { name: "x".repeat(81) });
    assert.equal(huge.ok, false);
    assert.match(huge.message, /2 to 80/);
    const tiny = call("createTeam", ctx, { name: "T" });
    assert.equal(tiny.ok, false);
    assert.match(tiny.message, /2 to 80/);
    assert.equal(call("deleteTeam", ctx, { teamId: team.result.teamId }).ok, true);
    assert.equal(call("listMyTeams", ctx, {}).result.count, 0);
  });

  it("quotes the indexed file when the question names its path", () => {
    call("indexCodebase", ctx, {
      codebaseId: "cb1", name: "App",
      files: [{ path: "src/index.js", content: "export function start() {\n  return 1;\n}\n" }],
    });
    const chat = call("chatWithCodebase", ctx, { codebaseId: "cb1", question: "What does src/index.js do?" });
    assert.equal(chat.result.grounded, true);
    assert.ok(chat.result.citations.some((c) => c.path === "src/index.js" && /start/.test(c.text)));
    assert.match(chat.result.answer, /stored text/);
  });
});
