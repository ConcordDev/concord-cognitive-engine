/**
 * Content-lib integrity — the committed minigame libs (crops + hacking + code
 * puzzles) are valid, unique, and (for puzzles) provably solvable WITHOUT booting
 * the engine. Code puzzles are replayed through the VM with a reference solution;
 * hacking solution paths are walked against their terminal trees.
 * Run: node --test server/tests/content-libs.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { readJSON, asArray, CONTENT } from "../../scripts/author/lib.mjs";
import { validateCrop, validateHackingPuzzle, validateCodePuzzle } from "../../scripts/author/validate-gate.mjs";
import { checkNavigable, SCENES } from "../../scripts/author/hacking-puzzle-specs.mjs";
import { REFERENCE_PROGRAMS } from "../../scripts/author/code-puzzle-specs.mjs";
import { runVm } from "../../scripts/author/code-vm.mjs";

const crops = asArray(readJSON(join(CONTENT, "crops.json"), []), null);
const hacks = asArray(readJSON(join(CONTENT, "hacking-puzzles.json"), []), null);
const codes = asArray(readJSON(join(CONTENT, "code-puzzles.json"), []), null);

function assertUnique(items, key) {
  const seen = new Set();
  for (const it of items) {
    assert.ok(it[key] != null, `missing ${key}`);
    assert.ok(!seen.has(it[key]), `duplicate ${key}: ${it[key]}`);
    seen.add(it[key]);
  }
}

describe("content/crops.json", () => {
  it("meets the census target and every crop validates", () => {
    assert.ok(crops.length >= 18, `crops ${crops.length} < 18`);
    for (const c of crops) assert.equal(validateCrop(c).ok, true, `invalid crop: ${JSON.stringify(c)}`);
  });
  it("ids are unique", () => assertUnique(crops, "id"));
});

describe("content/hacking-puzzles.json", () => {
  it("meets the census target and every puzzle validates", () => {
    assert.ok(hacks.length >= 30, `hacking ${hacks.length} < 30`);
    for (const p of hacks) assert.equal(validateHackingPuzzle(p).ok, true, `invalid: ${p.id}`);
  });
  it("ids and names are unique (name is the seeder dedupe key)", () => {
    assertUnique(hacks, "id");
    assertUnique(hacks, "name");
  });
  it("every pipeline-authored puzzle's solution path navigates its terminal tree", () => {
    // The builder-produced scenes (the new density-fill batch) are guaranteed
    // navigable: a player exploring with ls/cd/cat can discover every step. The 10
    // pre-pipeline originals predate this checker and aren't asserted here (the
    // engine itself matches the path as a sequence and never walks the tree).
    const authoredIds = new Set(SCENES.map((s) => s.id));
    const authored = hacks.filter((p) => authoredIds.has(p.id));
    assert.equal(authored.length, SCENES.length, "all authored scenes present in the lib");
    for (const p of authored) {
      const r = checkNavigable(p);
      assert.equal(r.ok, true, `${p.id}: ${r.reason}`);
    }
  });
});

describe("content/code-puzzles.json", () => {
  it("meets the census target and every puzzle validates", () => {
    assert.ok(codes.length >= 20, `code ${codes.length} < 20`);
    for (const p of codes) assert.equal(validateCodePuzzle(p).ok, true, `invalid: ${p.id}`);
  });
  it("ids and names are unique (name is the seeder dedupe key)", () => {
    assertUnique(codes, "id");
    assertUnique(codes, "name");
  });
  it("every puzzle is solvable — a reference program reproduces all test cases", () => {
    for (const p of codes) {
      const program = REFERENCE_PROGRAMS[p.id];
      assert.ok(program, `no reference program for ${p.id}`);
      for (const tc of p.testCases) {
        const { tape } = runVm(program, tc.input);
        assert.deepEqual(tape, tc.expected, `${p.id} input ${JSON.stringify(tc.input)}`);
      }
    }
  });
});
