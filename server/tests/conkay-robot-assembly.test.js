// ConKay "make a robot" → a concept 3D assembly with a parts list (live
// 2026-10-18: the ask ran engineering.parametricSolid + a failed runFEA and
// nothing showed in the workspace).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRobotAssembly, parseRobotAsk, ROBOT_RE, robotPartScope } from "../lib/conkay/robot-assembly.js";
import { executeToolCall, formatToolResults } from "../lib/chat-agent.js";
import { conkayTurnPlan } from "../lib/conkay/agent-turn.js";
import { alignReplyToBbox, userFacingMeshReply } from "../lib/chat/tool-turn-reply.js";

const ASK = "build me a small two-arm robot (wheeled base, torso, two arms, a head with a camera)";

describe("robot assembly", () => {
  it("a humanoid or iron man brief stands on legs, not a wheeled base", () => {
    for (const text of ["an iron man like robot", "a humanoid robot", "a biped android"]) {
      const s = parseRobotAsk(text);
      assert.equal(s.base, "legs", text);
      assert.equal(s.wheels, 0, text);
      assert.equal(s.arms, 2, text);
      const names = buildRobotAssembly(text).parts.map((p) => p.name);
      assert.equal(names.filter((n) => n.startsWith("wheel")).length, 0, text);
      assert.ok(names.some((n) => n.startsWith("leg")), text);
    }
    assert.equal(parseRobotAsk("a wheeled iron man robot").base, "wheels");
    assert.equal(parseRobotAsk(ASK).base, "wheels");
  });
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

describe("robot part counts come from the user's words", () => {
  it("defaults to 4 wheels (2 per side) and ignores the model's rewritten count", async () => {
    assert.equal(parseRobotAsk(ASK).wheels, 4);
    assert.equal(parseRobotAsk("a robot with 3 wheels per side").wheels, 6);
    const ctx = { actor: { userId: "u1" }, userPrompt: ASK };
    const r = await executeToolCall(ctx, async () => ({}), new Map(), { tool: "conkay_design", params: { text: "two-arm robot on an 8 wheel base, torso, head with camera" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.spec.wheels, 4);
    assert.equal(r.result.parts.filter((p) => p.name.startsWith("wheel")).length, 4);
    assert.ok(r.artifact.partList.every((p) => p.name && p.size_mm.length === 3));
    assert.ok(r.artifact.bbox_mm.height > 0);
  });
  it("still uses the tool text when the user's message isn't a robot ask", async () => {
    const r = await executeToolCall({ actor: { userId: "u1" }, userPrompt: "yes go ahead" }, async () => ({}), new Map(), { tool: "conkay_design", params: { text: "robot with 6 wheels and one arm" } });
    assert.equal(r.result.spec.wheels, 6);
    assert.equal(r.result.spec.arms, 1);
  });
});

const TORSO = "Make a 3D CAD model of a simple Mark-9 Iron Man style robot torso";

describe("a named sub-assembly is the whole model", () => {
  it("a torso ask carries scope and builds only the torso", async () => {
    assert.equal(robotPartScope(TORSO), "torso");
    assert.equal(robotPartScope(ASK), null);
    assert.equal(parseRobotAsk("an iron man like robot").scope, "full");
    const plan = conkayTurnPlan(TORSO, []);
    assert.equal(plan.route, "design");
    assert.equal(plan.fallbackCall.tool, "conkay_design");
    assert.equal(plan.fallbackCall.params.scope, "torso");
    const r = await executeToolCall(
      { actor: { userId: "u1" }, userPrompt: TORSO },
      async () => ({}),
      new Map(),
      { tool: "conkay_design", params: plan.fallbackCall.params },
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.spec.scope, "torso");
    const names = r.result.parts.map((p) => p.name);
    assert.deepEqual(names, ["torso waist", "torso chest", "chest plate"]);
    for (const n of names) assert.doesNotMatch(n, /\b(?:leg|arm|head|wheel|base|neck)\b/i, n);
    const full = buildRobotAssembly("an iron man like robot");
    assert.equal(full.spec.scope, "full");
    assert.equal(full.bbox_mm.height, 880);
    assert.ok(r.result.bbox_mm.height < full.bbox_mm.height);
    assert.equal(r.artifact.bbox_mm.height, r.result.bbox_mm.height);
    const reply = userFacingMeshReply(r);
    assert.match(reply, new RegExp(`${r.artifact.bbox_mm.height} mm tall`));
    assert.match(reply, new RegExp(`${r.artifact.bbox_mm.length} mm long`));
    assert.match(reply, new RegExp(`${r.artifact.bbox_mm.width} mm wide`));
    assert.match(formatToolResults([r]), new RegExp(`height ${r.artifact.bbox_mm.height} mm`));
    const aligned = alignReplyToBbox("It stands 2.7 m tall.", r.artifact.bbox_mm);
    assert.match(aligned, new RegExp(`${r.artifact.bbox_mm.height} mm tall`));
    assert.doesNotMatch(aligned, /2\.7/);
    const kept = alignReplyToBbox(`The chest plate is ${r.result.parts[2].size_mm[1]} mm.`, r.artifact.bbox_mm);
    assert.match(kept, new RegExp(`${r.result.parts[2].size_mm[1]} mm`));
    // The model's rewrite still loses to the user's torso ask.
    const rewritten = await executeToolCall(
      { actor: { userId: "u1" }, userPrompt: TORSO },
      async () => ({}),
      new Map(),
      { tool: "conkay_design", params: { text: "full iron man robot with base, legs, arms and a head" } },
    );
    assert.equal(rewritten.result.spec.scope, "torso");
    assert.equal(rewritten.result.parts.some((p) => /leg|arm|head|base/.test(p.name)), false);
  });

  it("arm, head, leg, and hand asks stay on that part", () => {
    const cases = [
      ["a robot arm", "arm", /shoulder|upper|forearm|gripper/],
      ["two robot arms", "arm", /left|right/],
      ["just the head", "head", /head/],
      ["a robot leg", "leg", /^leg$/],
      ["two legs of a robot", "leg", /left|right/],
      ["just the hand", "hand", /palm|finger/],
    ];
    for (const [text, scope, nameRe] of cases) {
      const a = buildRobotAssembly(text);
      assert.equal(a.spec.scope, scope, text);
      assert.equal(robotPartScope(text), scope, text);
      assert.ok(a.parts.some((p) => nameRe.test(p.name)), `${text} ${a.parts.map((p) => p.name).join(",")}`);
      const foreign = scope === "arm" ? /torso|leg|head|wheel|base/ : scope === "head" ? /torso|leg|arm|wheel|base/ : scope === "leg" ? /torso|arm|head|wheel|base/ : /torso|leg|arm|head|wheel|base/;
      for (const p of a.parts) assert.doesNotMatch(p.name, foreign, `${text}: ${p.name}`);
    }
    assert.equal(buildRobotAssembly("a robot arm").parts.filter((p) => /upper/.test(p.name)).length, 1);
    assert.equal(buildRobotAssembly("two robot arms").parts.filter((p) => /upper/.test(p.name)).length, 2);
  });
});
