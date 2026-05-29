/**
 * POLISH_AUDIT T0.1 regression — the CodePuzzleEditor UI ships each instruction
 * as { op, a, b }, but the VM speaks { dst, src, to }. Before the _normalizeInstr
 * adapter, every UI-authored program was a silent no-op and NO code puzzle was
 * solvable through the UI. This pins the adapter: the a/b shape now runs, and
 * the canonical dst/src/to shape is unchanged (backward compatible).
 *
 * Run: node --test tests/code-puzzle-ab-shape.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { authorPuzzle, runSolution, _normalizeInstr } from "../lib/programming-puzzle.js";
import { up as upProg } from "../migrations/253_programming_puzzles.js";

function freshDb() { const db = new Database(":memory:"); upProg(db); return db; }

describe("T0.1 — _normalizeInstr maps a/b → canonical per op", () => {
  it("MOV/ADD: a→dst, b→src", () => {
    assert.deepEqual(_normalizeInstr({ op: "MOV", a: "R0", b: "INP" }), { op: "MOV", a: "R0", b: "INP", dst: "R0", src: "INP" });
    assert.deepEqual(_normalizeInstr({ op: "ADD", a: "R0", b: "R1" }), { op: "ADD", a: "R0", b: "R1", dst: "R0", src: "R1" });
  });
  it("JEZ: a→src, b→to; JMP: a→to; OUT: a→src", () => {
    assert.equal(_normalizeInstr({ op: "JEZ", a: "R0", b: "4" }).to, "4");
    assert.equal(_normalizeInstr({ op: "JEZ", a: "R0", b: "4" }).src, "R0");
    assert.equal(_normalizeInstr({ op: "JMP", a: "2" }).to, "2");
    assert.equal(_normalizeInstr({ op: "OUT", a: "R0" }).src, "R0");
  });
  it("leaves an already-canonical instruction untouched", () => {
    const canon = { op: "MOV", dst: "R0", src: "INP" };
    assert.deepEqual(_normalizeInstr(canon), canon);
  });
});

describe("T0.1 — UI {op,a,b} programs are now solvable end-to-end", () => {
  it("echo: OUT INP twice via a-field", () => {
    const db = freshDb();
    const p = authorPuzzle(db, { name: "echo", testCases: [{ input: [1, 2], expected: [1, 2] }] });
    const r = runSolution(db, p.puzzleId, [
      { op: "OUT", a: "INP" },
      { op: "OUT", a: "INP" },
    ]);
    assert.equal(r.passed, true);
  });

  it("add two inputs via a/b fields (the shape the editor actually sends)", () => {
    const db = freshDb();
    const p = authorPuzzle(db, { name: "add", testCases: [{ input: [3, 4], expected: [7] }] });
    const r = runSolution(db, p.puzzleId, [
      { op: "MOV", a: "R0", b: "INP" },
      { op: "ADD", a: "R0", b: "INP" },
      { op: "OUT", a: "R0" },
    ]);
    assert.equal(r.passed, true);
  });

  it("a JMP/JEZ branch program runs (jump targets resolve from a/b)", () => {
    const db = freshDb();
    // echo until a 0 sentinel: read INP into R0; if 0, jump to end; else OUT R0; loop.
    const p = authorPuzzle(db, { name: "echo-until-zero", testCases: [{ input: [5, 9, 0], expected: [5, 9] }] });
    const r = runSolution(db, p.puzzleId, [
      { op: "MOV", a: "R0", b: "INP" }, // 0
      { op: "JEZ", a: "R0", b: "4" },   // 1: if R0==0 jump to 4 (end)
      { op: "OUT", a: "R0" },           // 2
      { op: "JMP", a: "0" },            // 3: loop
      { op: "OUT", a: "R0" },           // 4: (no-op terminator; R0==0 but we stop)
    ]);
    // The first two emits are 5 and 9; the final OUT emits the sentinel 0 — so
    // tighten the program: drop the trailing OUT. Re-run with a clean halt.
    const r2 = runSolution(db, p.puzzleId, [
      { op: "MOV", a: "R0", b: "INP" }, // 0
      { op: "JEZ", a: "R0", b: "9" },   // 1: if 0 jump past end (ip>=len halts)
      { op: "OUT", a: "R0" },           // 2
      { op: "JMP", a: "0" },            // 3
    ]);
    assert.equal(r2.passed, true);
    assert.ok(r.ok);
  });
});
