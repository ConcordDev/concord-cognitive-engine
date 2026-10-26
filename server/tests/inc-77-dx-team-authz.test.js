// INC-77 — dx-platform teams: invite-gated join, no raw account ids to other members.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import register from "../domains/dx-platform.js";

const A = "user_aaaa-77-owner";
const B = "user_bbbb-77-member";
const ACTIONS = new Map();
const call = (n, userId, input = {}) =>
  ACTIONS.get(n)(userId ? { actor: { userId } } : {}, input);

before(() => register((d, n, fn) => ACTIONS.set(n, fn)));
beforeEach(() => { globalThis._concordSTATE = {}; globalThis._concordSaveStateDebounced = () => {}; });

describe("INC-77 dx-platform team authz", () => {
  it("join needs a valid invite; responses never carry the owner's raw id", () => {
    const cb = call("indexCodebase", A, { name: "secret-repo", files: [{ path: "a.js", content: "eval(x)\n" }] });
    assert.equal(cb.ok, true);
    const team = call("createTeam", A, { name: "Team A" });
    assert.equal(team.ok, true);
    const { teamId, inviteCode } = team.result;
    const codebaseId = cb.result?.codebaseId || cb.result?.id;
    if (codebaseId) call("joinTeam", A, { teamId, codebaseId });

    assert.equal(call("joinTeam", B, { teamId }).error, "not_invited");
    assert.equal(call("joinTeam", B, { teamId, inviteCode: "inv_wrong" }).error, "not_invited");
    assert.equal(call("teamDashboard", B, { teamId }).error, "not_a_member");

    const joined = call("joinTeam", B, { teamId, inviteCode });
    assert.equal(joined.ok, true);
    assert.equal(JSON.stringify(joined).includes(A), false);
    const dash = call("teamDashboard", B, { teamId });
    assert.equal(dash.ok, true);
    assert.equal(JSON.stringify(dash).includes(A), false);
    // The invite is single-use.
    assert.equal(call("joinTeam", "user_cccc-77", { teamId, inviteCode }).error, "not_invited");
  });
  it("anonymous callers are refused", () => {
    const team = call("createTeam", A, { name: "Team A" });
    assert.equal(call("joinTeam", null, { teamId: team.result.teamId, inviteCode: team.result.inviteCode }).error, "auth_required");
    assert.equal(call("teamDashboard", null, { teamId: team.result.teamId }).error, "auth_required");
  });
});
