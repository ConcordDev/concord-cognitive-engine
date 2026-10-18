// ConKay "make a robot" → a concept 3D assembly with a parts list (live
// 2026-10-18: the ask ran engineering.parametricSolid + a failed runFEA and
// nothing showed in the workspace).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRobotAssembly, parseRobotAsk, ROBOT_RE } from "../lib/conkay/robot-assembly.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { conkayTurnPlan } from "../lib/conkay/agent-turn.js";

const ASK = "build me a small two-arm robot (wheeled base, torso, two arms, a head with a camera)";

describe("robot assembly", () => {
  it("parses the named subsystems", () => {
    const s = parseRobotAsk(ASK);
    assert.equal(s.arms, 2); assert.equal(s.base, "wheels"); assert.equal(s.wheels, 4);
    assert.equal(s.head, true); assert.equal(s.camera, true);
    assert.equal(parseRobotAsk("a tracked robot with one arm").arms, 1);
    assert.equal(parseRobotAsk("a tracked robot with one arm").base, "tracks");
  });
  it("builds a valid merged mesh and a parts list", () => {
    const a = buildRobotAssembly(ASK);
    const names = a.parts.map((p) => p.name);
    for (const n of ["base", "torso", "head", "camera", "arm left upper", "arm right upper", "wheel 1"]) assert.ok(names.includes(n), n);
    const nv = a.mesh.positions.length / 3;
    assert.ok(a.mesh.indices.every((i) => i >= 0 && i < nv));
    assert.ok(a.mesh.triangleCount > 100);
    assert.ok(a.bbox_mm.height > 400 && a.bbox_mm.height < 900);
  });
  it("routes the ask to conkay_design, which returns the mesh artifact", async () => {
    assert.ok(ROBOT_RE.test(ASK));
    const plan = conkayTurnPlan(ASK, []);
    assert.equal(plan.route, "design");
    assert.equal(plan.fallbackCall.tool, "conkay_design");
    const r = await executeToolCall({ actor: { userId: "u1" } }, async () => ({}), new Map(), { tool: "conkay_design", params: { text: ASK } });
    assert.equal(r.ok, true);
    assert.equal(r.artifact.kind, "mesh");
    assert.ok(r.artifact.positions.length > 300);
    assert.ok(r.result.parts.length >= 15);
    assert.equal(conkayTurnPlan("what is a robot", []).route, "lookup");
  });
});
