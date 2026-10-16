// server/tests/conkay-chat-what-if.test.js
//
// Follow-ups on a design (conversational-loop item 4), on the screening car (no CAD kernel: the body is the
// screening shell, so its occupant-fit checks fail as they always have there; these tests are about the edit
// path, not that car's verdict):
//   - a parameter edit reruns exactly the dependency closure of what it changed (computed independently here from
//     the reads the engine recorded before the edit), and nothing outside it (the aero build-up does not read a
//     material);
//   - the reply's diff: changed values with their source (the user's words), the checks that flipped;
//   - undo returns the original receipt hash;
//   - a requirement changes only on the user's words, rebuilds, and the orchestrator resumes (150 mph: the
//     lighter drive unit reaches 148.8 mph on the screening body, so the next one is taken);
//   - the package limit is said, not built around (seats 2 / seats 6); ambiguity is a question; a missing tail
//     an error.
// The tail edit on the real CAD body (the pack's mass not rerun, the traction battery rerun because its power at
// speed reads the Cd) is in conkay-chat-orchestrator-car.test.js (gated: OCC kernel).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { orchestrate, carEvaluator } from "../lib/conkay/chat/orchestrator.js";
import { REPAIR_RULES } from "../lib/conkay/chat/repair-rules.js";
import { DesignConversation, dependencyClosure, readWhatIf, designReceipt, PACKAGE_SEATS } from "../lib/conkay/chat/what-if.js";
import { carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";
import { sha256 } from "../lib/conkay/iterate/receipt.js";

const evaluate = carEvaluator({ carAcceptanceAsync, cadBody: false });
const REQ = { topSpeedMs: 140 * 0.44704, seats: 4, massMaxKg: null };

async function newConversation() {
  const run = await orchestrate({ evaluate, rules: REPAIR_RULES, initialState: { brief: "Design a car that can go 140 mph, seats 4 people.", fuelType: "electric", tailExtensionM: 0.22 } });
  return new DesignConversation({ evaluate, rules: REPAIR_RULES, requirements: REQ, state: run.state, final: run.final });
}

describe("reading follow-ups", () => {
  let graph;
  before(async () => { graph = (await newConversation()).current.final.session.engine.graph; });
  it("a requirement only from the user's own number; the package limit is said, not built around", () => {
    const s = readWhatIf("what about 150 mph", { graph, requirements: REQ });
    assert.equal(s.kind, "requirement");
    assert.equal(s.field, "topSpeed");
    assert.equal(s.words, '"150 mph"');
    assert.equal(readWhatIf("what if it seats 2?", { graph, requirements: REQ }).kind, "limit");
    assert.match(readWhatIf("what if it seats 6?", { graph, requirements: REQ }).note, new RegExp(`seats ${PACKAGE_SEATS} at most`));
    assert.equal(readWhatIf("seats 4", { graph, requirements: REQ }).kind, "unchanged");
  });
  it("a material on a named part; with no part named, a question; an unknown unit, an error", () => {
    const m = readWhatIf("use aluminium 6061 for the body", { graph, requirements: REQ });
    assert.deepEqual(m.ops, [{ node: "BODY_SHELL", path: "material", value: "aluminum-6061-t6" }]);
    assert.equal(readWhatIf("use titanium", { graph, requirements: REQ }).kind, "question");
    assert.equal(readWhatIf("what about 150 zorks", { graph, requirements: REQ }).kind, "error");
    assert.match(readWhatIf("make the tail shorter", { graph, requirements: REQ }).error, /screening shell/);
  });
});

describe("a parameter edit", () => {
  let conv, r0, reply;
  before(async () => {
    conv = await newConversation();
    r0 = conv.current.receipt;
    reply = await conv.ask("use aluminium 6061 for the body");
  });
  it("reruns exactly the dependency closure of what changed, nothing else", () => {
    const rev = conv.current;
    const closure = dependencyClosure(rev.readsBefore, rev.changedKeys);
    assert.deepEqual(reply.diff.rerun, closure);
    assert.ok(closure.includes("mass.part@BODY_SHELL"));
    assert.equal(reply.diff.rerun.some((id) => /^aero\./.test(id)), false, "the drag build-up does not read a material");
    assert.ok(reply.diff.reused > 0);
  });
  it("the diff: the changed value with the user's words, and every check that flipped", () => {
    assert.deepEqual(reply.diff.changed.map((c) => [c.field, c.before, c.after]), [["body material", "cfrp-quasi-iso", "aluminum-6061-t6"]]);
    assert.match(reply.diff.changed[0].source, /aluminium/);
    for (const f of reply.diff.flipped) assert.notEqual(f.from, f.to);
  });
  it("undo returns the original receipt hash", async () => {
    const u = await conv.undo();
    assert.equal(u.ok, true);
    assert.equal(u.receipt, r0);
    assert.equal(u.matches, true);
  });
});

describe("a requirement change", () => {
  it("only on the user's words; rebuilds; the orchestrator resumes; undo returns the original receipt", async () => {
    const conv = await newConversation();
    const r0 = conv.current.receipt;
    const reqHash0 = sha256(conv.current.final.session.engine.graph.requirements);
    assert.equal(conv.current.final.report.selection.engine_or_motor.chosen, "motor.cascadia.im-225-dz");
    const reply = await conv.ask("what about 150 mph");
    assert.equal(reply.kind, "requirement");
    assert.match(reply.diff.changed[0].source, /the user's words "150 mph"/);
    // 150 mph: the iM-225 holds 148.8 mph on the screening body, so the orchestrator takes the iM-375
    assert.equal(conv.current.state.motorId, "motor.cascadia.im-375-dz");
    assert.notEqual(sha256(conv.current.final.session.engine.graph.requirements), reqHash0, "the requirement changed because it was asked");
    const u = await conv.undo();
    assert.equal(u.receipt, r0);
  });
  it("a parameter edit never changes a requirement", async () => {
    const conv = await newConversation();
    const req0 = sha256(conv.current.final.session.engine.graph.requirements);
    await conv.ask("use titanium for the tub");
    assert.equal(sha256(conv.current.final.session.engine.graph.requirements), req0);
    assert.equal(designReceipt(conv.current.final.envelopes), conv.current.receipt);
  });
});

describe("the graph accepts a CAD body's declared optional parameters, and still refuses the rest", () => {
  it("tail and Kamm ratio edit; a negative length, an unknown name and a zero required thickness are refused", async () => {
    const { buildCarFromLibrary } = await import("../lib/conkay/compiler/car-from-library.js");
    const { openDesign } = await import("../lib/conkay/index.js");
    const b = buildCarFromLibrary("Design a car that can go 180 mph, seats 4 people.", { config: { fuelType: "electric" }, bodyParams: { tailExtensionM: 0.22 } });
    const g = openDesign(b.ir).session.engine.graph;
    assert.equal(g.set("BODY_SHELL", "geometry.tailExtension", 0.32).ok, true);
    assert.equal(g.set("BODY_SHELL", "geometry.kammAreaRatio", 0.5).ok, true);
    assert.match(g.set("BODY_SHELL", "geometry.tailExtension", -1).error, /0 or more/);
    assert.match(g.set("BODY_SHELL", "geometry.nope", 1).error, /no geometry parameter "nope"/);
    assert.match(g.set("BODY_SHELL", "geometry.thickness", 0).error, /positive/);
  });
});
