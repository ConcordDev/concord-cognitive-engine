// Reasoning full-build pins (B6, S-RS-2/4/5) — Review 3's priced legs
// that live in the domain cores:
//   S-RS-4 — premise classification is structural: the textbook syllogism
//     classifies 2 premises + 1 conclusion (the keyword-only rule
//     extracted 0 premises); text with no conclusion keeps unmarked
//     sentences as statements.
//   S-RS-2 — an empty conclusion is a validation ask, not a verdict;
//     the local verdict is invariant to any question input (the core
//     takes premises + conclusion only — the F3 pin).
//   S-RS-5 — a content-free map root scores "no-evidence" with the
//     figure withheld and the formula attached; a map with a branch
//     scores numerically with the formula attached.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis._concordSaveStateDebounced = () => {};

const mod = await import("../domains/reasoning.js");
const actions = {};
mod.default((domain, name, fn) => { actions[`${domain}.${name}`] = fn; });
const ctx = { userId: "pin-user", actor: { userId: "pin-user" } };
const call = (name, params) => actions[`reasoning.${name}`](ctx, { data: {} }, params);

const SYLLOGISM = "All mammals are warm-blooded. Whales are mammals. Therefore whales are warm-blooded.";

describe("S-RS-4 structural premise classification", () => {
  it("the textbook syllogism classifies 2 premises + 1 conclusion", () => {
    const r = call("premiseExtract", { text: SYLLOGISM }).result;
    assert.equal(r.premises, 2);
    assert.equal(r.conclusions, 1);
    assert.deepEqual(r.classified.map((c) => c.role), ["premise", "premise", "conclusion"]);
  });

  it("a because-free variant still classifies its premises", () => {
    const r = call("premiseExtract", { text: "Socrates is a man. All men are mortal. Hence Socrates is mortal." }).result;
    assert.equal(r.premises, 2);
    assert.equal(r.conclusions, 1);
  });

  it("text with no conclusion keeps unmarked sentences as statements", () => {
    const r = call("premiseExtract", { text: "The sky is blue. Water is wet." }).result;
    assert.equal(r.premises, 0);
    assert.equal(r.statements, 2);
  });
});

describe("S-RS-2 constraint integrity", () => {
  it("an empty conclusion returns a validation ask, not a verdict", () => {
    const r = call("logicValidate", { premises: ["All mammals are warm-blooded"], conclusion: "" }).result;
    assert.match(r.message, /Provide a conclusion/);
    assert.equal(r.termSupport, undefined);
  });

  it("the sound syllogism still validates", () => {
    const r = call("logicValidate", {
      premises: ["All mammals are warm-blooded", "Whales are mammals"],
      conclusion: "whales are warm-blooded",
    }).result;
    assert.equal(r.termSupport, 100);
    assert.equal(r.validity, "likely-valid");
  });

  it("the verdict is invariant: identical inputs give byte-identical outputs across runs", () => {
    const input = { premises: ["All mammals are warm-blooded", "Whales are mammals"], conclusion: "whales are warm-blooded" };
    assert.deepEqual(call("logicValidate", input).result, call("logicValidate", input).result);
  });
});

describe("S-RS-5 confidence receipts", () => {
  it("a content-free root reads no-evidence, figure withheld, formula attached", () => {
    const created = call("map-create", { title: "Pin map", rootClaim: "Whales are warm-blooded" });
    const mapId = created.result.map.id;
    const r = call("map-score", { mapId }).result;
    assert.equal(r.confidence, null);
    assert.equal(r.verdict, "no-evidence");
    assert.match(r.message, /No evidence yet/);
    assert.match(r.formula, /confidence =/);
  });

  it("a map with a pro branch scores numerically, formula attached", () => {
    const created = call("map-create", { title: "Pin map 2", rootClaim: "Whales are warm-blooded" });
    const mapId = created.result.map.id;
    const got = call("map-get", { mapId }).result;
    const rootId = got.map.nodes[0].id;
    call("node-add", { mapId, parentId: rootId, text: "Whales are mammals", stance: "pro" });
    const r = call("map-score", { mapId }).result;
    assert.equal(typeof r.confidence, "number");
    assert.match(r.formula, /confidence =/);
  });
});
