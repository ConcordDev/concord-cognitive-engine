// Behavior tests for FIX-transfer-008: the Transfer page's Find
// analogies sent { source, target } while the transfer.find_analogies
// macro read { query, domain } — every UI search ran with an empty
// query and returned []. The macro lives in the server.js monolith, so
// following the collab-council-gate precedent this suite extracts the
// REAL registration and the REAL findAnalogousPatterns/tokenizeText
// from server.js and runs them against a stub pattern store.
// Pins:
//   1. the UI's payload { source: "heat flowing through a metal rod" }
//      finds the seeded cross-domain pattern (was: []).
//   2. the legacy { query, domain } payload still works.
//   3. an empty pattern store returns [] WITH a note explaining that
//      patterns must be extracted first (the honest empty state).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SERVER_JS = readFileSync(new URL("../server.js", import.meta.url), "utf8");

function extractFn(name) {
  const start = SERVER_JS.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in server.js`);
  let depth = 0;
  let i = SERVER_JS.indexOf("{", start);
  const bodyStart = i;
  for (; i < SERVER_JS.length; i++) {
    if (SERVER_JS[i] === "{") depth++;
    else if (SERVER_JS[i] === "}") { depth--; if (depth === 0) return SERVER_JS.slice(start, i + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

function extractRegistration() {
  const start = SERVER_JS.indexOf('register("transfer", "find_analogies"');
  assert.ok(start >= 0, "find_analogies registration not found");
  const endMarker = '}, { public: true });';
  const end = SERVER_JS.indexOf(endMarker, start);
  assert.ok(end > start, "registration end not found");
  return SERVER_JS.slice(start, end + endMarker.length);
}

function extractConst(name) {
  const start = SERVER_JS.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `${name} not found in server.js`);
  const end = SERVER_JS.indexOf(";", start);
  assert.ok(end > start, `${name} end not found`);
  return SERVER_JS.slice(start, end + 1);
}

function buildHandler(patterns) {
  const STATE = { transfer: { patterns } };
  let handler = null;
  const register = (domain, name, fn) => { if (domain === "transfer" && name === "find_analogies") handler = fn; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const sandbox = new Function(
    "register", "STATE", "clamp", "ensureTransferEngine", "enforceEthosInvariant",
    `${extractConst("STOP_WORDS")}
     ${extractFn("tokenizeText")}
     ${extractFn("findAnalogousPatterns")}
     ${extractRegistration()}
     return register;`,
  );
  sandbox(register, STATE, clamp, () => {}, () => {});
  assert.ok(handler, "handler captured");
  return handler;
}

function seedPatterns() {
  return new Map([
    ["pat_flow", {
      name: "Flow through a medium",
      sourceDomain: "physics",
      confidence: 0.5,
      structure: { topTerms: ["heat", "flowing", "metal", "rod", "temperature"], dtuCount: 3 },
      template: { steps: ["source", "medium", "sink"] },
    }],
    ["pat_cells", {
      name: "Cell division cascade",
      sourceDomain: "biology",
      confidence: 0.95,
      structure: { topTerms: ["cell", "division", "mitosis"], dtuCount: 5 },
      template: { steps: ["signal", "divide"] },
    }],
  ]);
}

test("the UI payload { source, target } ranks by the source text and honours the target", () => {
  const handler = buildHandler(seedPatterns());
  // The walker's exact input: with the macro reading { source }, the
  // term-matching flow pattern outranks the higher-confidence biology
  // pattern. (Pristine: the query is dropped, confidence alone ranks,
  // and the biology pattern wins — the search ignores what was typed.)
  const out = handler({}, { source: "heat flowing through a metal rod" });
  assert.equal(out.ok, true);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].patternName, "Flow through a medium");
  // The UI's target names the destination domain: same-domain patterns
  // are not analogies. (Pristine reads input.domain, never target, so
  // the physics pattern leaks into a physics-targeted search.)
  const targeted = handler({}, { source: "heat flowing through a metal rod", target: "physics" });
  assert.deepEqual(targeted.results.map((r) => r.patternName), ["Cell division cascade"]);
});

test("the legacy { query, domain } payload still works", () => {
  const handler = buildHandler(seedPatterns());
  const out = handler({}, { query: "heat flowing", domain: "general" });
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].patternName, "Flow through a medium");
});

test("an empty pattern store explains itself instead of returning a bare []", () => {
  const handler = buildHandler(new Map());
  const out = handler({}, { source: "heat flowing through a metal rod" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.results, []);
  assert.match(out.note, /extract a pattern/i);
});
