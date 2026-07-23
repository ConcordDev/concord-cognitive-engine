/**
 * Chat Intent Router — Contract Tests (RQ3)
 *
 * Pins the classification contract for `server/lib/chat/intent-router.js`:
 *   - known deterministic-math prompts -> deterministic-engine / math
 *   - known FEA-shaped prompts -> deterministic-engine / fea
 *   - known tool-action prompts -> tool-action
 *   - known open-ended / ambiguous language prompts -> language
 *   - a "biased conservative" case: something that superficially brushes
 *     against an engine signal but is missing the unambiguous shape that
 *     signal requires must default to language, never a wrong engine guess.
 *
 * Run: node --test tests/chat-intent-router.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyIntent } from "../lib/chat/intent-router.js";

describe("classifyIntent — deterministic-engine / math", () => {
  it("routes bare arithmetic to math", () => {
    const r = classifyIntent("what is 47 * 892");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "math");
    assert.ok(r.confidence >= 0.8, "confidence should be high for an unambiguous expression");
  });

  it("routes an arithmetic expression with no lead-in", () => {
    const r = classifyIntent("47 * 892");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "math");
  });

  it("routes an explicit solve-equation prompt to math", () => {
    const r = classifyIntent("solve 3x + 5 = 20");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "math");
  });

  it("routes a CAS-verb + expression prompt to math (derivative)", () => {
    const r = classifyIntent("derivative of x^2 + 3x");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "math");
  });

  it("routes a CAS-verb + expression prompt to math (simplify)", () => {
    const r = classifyIntent("simplify 2x + 4x");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "math");
  });

  it("routes calculate/compute lead-ins with a trailing question mark", () => {
    const r = classifyIntent("calculate 12 / 4 + 3?");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "math");
  });
});

describe("classifyIntent — deterministic-engine / fea", () => {
  it("routes a structural-member + analysis conjunction to fea", () => {
    const r = classifyIntent("what's the deflection of a steel beam under a 500kg load");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "fea");
    assert.ok(r.confidence >= 0.6);
  });

  it("routes a truss stress-analysis prompt to fea", () => {
    const r = classifyIntent("analyze the stress on this truss frame");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "fea");
  });

  it("routes a cantilever bending-moment prompt to fea", () => {
    const r = classifyIntent("what is the bending moment at the fixed end of this cantilever");
    assert.equal(r.intent, "deterministic-engine");
    assert.equal(r.engineHint, "fea");
  });
});

describe("classifyIntent — tool-action", () => {
  it("routes 'create a DTU about X' to tool-action", () => {
    const r = classifyIntent("create a DTU about the history of Rome");
    assert.equal(r.intent, "tool-action");
    assert.equal(r.domainHint, "dtu");
  });

  it("routes 'search my archive for Y' to tool-action", () => {
    const r = classifyIntent("search my archive for cooking notes");
    assert.equal(r.intent, "tool-action");
    assert.equal(r.domainHint, "archive");
  });

  it("routes 'list my marketplace listings' to tool-action", () => {
    const r = classifyIntent("list my marketplace listings");
    assert.equal(r.intent, "tool-action");
    assert.equal(r.domainHint, "marketplace");
  });

  it("routes a known-lens noun + build verb to tool-action", () => {
    const r = classifyIntent("build an accounting report for this month");
    assert.equal(r.intent, "tool-action");
    assert.equal(r.domainHint, "accounting");
  });
});

describe("classifyIntent — language (open-ended / ambiguous)", () => {
  it("routes an opinion question to language", () => {
    const r = classifyIntent("what do you think about remote work becoming the norm");
    assert.equal(r.intent, "language");
  });

  it("routes a storytelling request to language", () => {
    const r = classifyIntent("tell me a story about a lighthouse keeper");
    assert.equal(r.intent, "language");
  });

  it("routes a broad open-ended question to language", () => {
    const r = classifyIntent("how does the economy in this game work?");
    assert.equal(r.intent, "language");
  });

  it("routes an empty message to language", () => {
    const r = classifyIntent("");
    assert.equal(r.intent, "language");
  });

  it("routes a non-string input to language without throwing", () => {
    const r = classifyIntent(undefined);
    assert.equal(r.intent, "language");
  });
});

describe("classifyIntent — biased conservative (ambiguous cases must NOT misroute to an engine)", () => {
  it("does not route 'load' alone (no structural noun) to fea", () => {
    // Contains one of the two FEA signals ("load") but not the other
    // (no beam/truss/frame/cantilever/column/girder) — must NOT guess fea.
    const r = classifyIntent("tell me about the load times in this game");
    assert.notEqual(r.intent, "deterministic-engine");
    assert.equal(r.intent, "language");
  });

  it("does not route 'beam' alone (no analysis term) to fea", () => {
    // Contains the structural noun but no stress/deflection/load/moment/
    // stiffness/shear/bending/analyze signal — must NOT guess fea.
    const r = classifyIntent("the beam of light from the lighthouse was beautiful");
    assert.notEqual(r.intent, "deterministic-engine");
    assert.equal(r.intent, "language");
  });

  it("does not route a numeric word-problem with prose to math", () => {
    // Has digits, but is not an expression shape (contains prose words) —
    // the conservative bare-arithmetic check must reject it rather than
    // guess at extracting "3 - 2" out of context.
    const r = classifyIntent("I have 3 apples and give away 2, how many do I have left?");
    assert.notEqual(r.intent, "deterministic-engine");
    assert.equal(r.intent, "language");
  });

  it("does not route a topic-word-only market question to tool-action", () => {
    // Has a known domain noun ("market") but no recognized action verb —
    // this is a QUERY/opinion-shaped ask, not a command, so it must not
    // be misclassified as a tool-action.
    const r = classifyIntent("what's happening in the housing market lately");
    assert.notEqual(r.intent, "tool-action");
    assert.equal(r.intent, "language");
  });
});
