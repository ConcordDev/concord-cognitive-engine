// A car ask in chat is a car (live 2026-11-04: "make me a car" came back as a
// 3D I-beam). conkay_design builds ConKay's vehicle concept assembly instead of
// the single-part solver's "unsupported part" → re-described-as-a-beam retry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../lib/chat-agent.js";
import { buildCarChatAssembly } from "../lib/conkay/car-chat-assembly.js";
import { layoutWouldSubstitute } from "../lib/chat/route-3d-ask.js";

const run = (text, userPrompt) => executeToolCall({ userPrompt }, null, new Map(), { tool: "conkay_design", params: { text } });

describe("buildCarChatAssembly", () => {
  it("makes a Y-up body-and-tyres mesh sized like a car", () => {
    const car = buildCarChatAssembly("make me a car");
    assert.equal(car.kind, "car-assembly");
    assert.deepEqual(car.parts.map((p) => p.name), ["body", "tire fl", "tire fr", "tire rl", "tire rr"]);
    const { length, height, width } = car.bbox_mm;
    assert.ok(length > 3000 && length < 6500, `length ${length}`);
    assert.ok(height > 900 && height < 2200, `height ${height}`);
    assert.ok(width > 1400 && width < 2600, `width ${width}`);
    assert.ok(length > width && width > height * 0.9, "x is length, y is up");
    const m = car.mesh;
    assert.equal(m.positions.length, m.vertexCount * 3);
    assert.equal(m.indices.length, m.triangleCount * 3);
    assert.ok(m.triangleCount > 1000 && m.triangleCount < 200000);
    assert.ok(m.indices.every((i) => i >= 0 && i < m.vertexCount));
    // tyres sit on the ground plane
    let minY = Infinity;
    for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
    assert.ok(Math.abs(minY) < 0.02, `ground at ${minY}`);
    assert.equal(m.parts.length, 5);
  });
});

describe("chat conkay_design for a car", () => {
  it("returns the car concept mesh, not an unsupported-part error", async () => {
    const r = await run("make me a car", "make me a car");
    assert.equal(r.ok, true, r.error);
    assert.equal(r.key, "conkay_design.car-assembly");
    assert.equal(r.artifact.kind, "mesh");
    assert.equal(r.artifact.meshKind, "car-assembly");
    assert.ok(r.artifact.positions.length > 0);
    assert.match(r.result.instruction, /car concept/);
  });

  it("the user's car stays a car when the model rewrote it as an I-beam", async () => {
    const r = await run("steel I-beam 4 m span, 5 kN", "make me a 3d model of a car");
    assert.equal(r.ok, true, r.error);
    assert.equal(r.key, "conkay_design.car-assembly");
    assert.notEqual(r.artifact.meshKind, "i-beam");
  });

  it("a beam ask is still a beam", async () => {
    const r = await run("steel cantilever beam 2 m long, 10 kN at the tip, safety factor of 2", "size a steel cantilever beam 2 m, 10 kN tip load, SF 2");
    assert.notEqual(r.key, "conkay_design.car-assembly");
  });

  it("the car layout is not treated as a substitute for the user's car", () => {
    assert.equal(layoutWouldSubstitute("make me a 3d model of a car", "car-assembly"), false);
  });
});
