// FIX-reasoning-004 — premise extraction must find the premises of a
// plain syllogism (no connective words), where the old indicator-only
// rule extracted zero and the Workbench reported "No clear claims found".
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerReasoningActions from "../domains/reasoning.js";

const MACROS = new Map();
function register(domain, name, fn) { MACROS.set(`${domain}.${name}`, fn); }
async function run(name, params = {}) {
  const fn = MACROS.get(`reasoning.${name}`);
  if (!fn) throw new Error(`reasoning.${name} not registered`);
  return await fn({}, {}, params);
}

before(() => { registerReasoningActions(register); });

describe("reasoning premiseExtract — syllogism", () => {
  it("extracts both premises and the conclusion", async () => {
    const r = await run("premiseExtract", {
      text: "All mammals are warm-blooded. Whales are mammals. Therefore whales are warm-blooded.",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.premises, 2, `premises: ${JSON.stringify(r.result.classified)}`);
    assert.equal(r.result.conclusions, 1);
    const roles = r.result.classified.map((c) => c.role);
    assert.deepEqual(roles, ["premise", "premise", "conclusion"]);
  });

  it("indicator phrasing still classifies as before", async () => {
    const r = await run("premiseExtract", {
      text: "The bridge is unsafe because the cables are corroded. Therefore it should be closed.",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.premises >= 1);
    assert.equal(r.result.conclusions, 1);
  });

  it("prose with no conclusion keeps statement roles", async () => {
    const r = await run("premiseExtract", { text: "The sky is blue today. The grass is green." });
    assert.equal(r.ok, true);
    assert.equal(r.result.premises, 0);
    assert.equal(r.result.conclusions, 0);
  });
});
