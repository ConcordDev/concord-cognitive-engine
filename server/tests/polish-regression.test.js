/**
 * Regression locks for the T-series polish fixes (Depth & Balance sprint).
 * These shipped as real fixes; this file makes sure they can't silently regress.
 *
 *   T0.1 — code-puzzle operand shape: the VM must accept the editor's {op,a,b}.
 *   T1.5 — hacking memory-test: a guided hint per solution step, never blank.
 *
 * Run: node --test server/tests/polish-regression.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { _normalizeInstr } from "../lib/programming-puzzle.js";
import { hintForStep } from "../lib/hacking.js";

describe("T0.1 — code-puzzle operand normalization", () => {
  it("maps the editor's {op,a,b} to the VM's {dst,src,to} per op", () => {
    assert.deepEqual(_normalizeInstr({ op: "MOV", a: "R0", b: "5" }), { op: "MOV", a: "R0", b: "5", dst: "R0", src: "5" });
    assert.deepEqual(_normalizeInstr({ op: "ADD", a: "R1", b: "R0" }), { op: "ADD", a: "R1", b: "R0", dst: "R1", src: "R0" });
    assert.deepEqual(_normalizeInstr({ op: "JNZ", a: "R0", b: "2" }), { op: "JNZ", a: "R0", b: "2", src: "R0", to: "2" });
    assert.deepEqual(_normalizeInstr({ op: "JMP", a: "3" }), { op: "JMP", a: "3", to: "3" });
    assert.deepEqual(_normalizeInstr({ op: "OUT", a: "R2" }), { op: "OUT", a: "R2", src: "R2" });
  });

  it("leaves an already-canonical instruction untouched (authored reference solutions)", () => {
    const canon = { op: "MOV", dst: "R0", src: "9" };
    assert.equal(_normalizeInstr(canon), canon);
  });

  it("is a no-op on non-instruction input (never throws)", () => {
    assert.equal(_normalizeInstr(null), null);
    assert.deepEqual(_normalizeInstr({ op: "NOP" }), { op: "NOP" });
  });
});

describe("T1.5 — hacking hint trail", () => {
  it("returns a guided, non-blank hint for each command head", () => {
    for (const cmd of ["connect host", "cd /etc", "cat flag", "decrypt blob", "exec run", "ls"]) {
      const h = hintForStep(cmd);
      assert.equal(typeof h, "string");
      assert.ok(h.length > 0, `blank hint for "${cmd}"`);
    }
  });

  it("surfaces the argument so the trail is followable", () => {
    assert.match(hintForStep("cat secret.txt"), /secret\.txt/);
    assert.match(hintForStep("connect 10.0.0.5"), /10\.0\.0\.5/);
  });

  it("signals the objective at the end of the trail", () => {
    assert.match(hintForStep(null), /objective|trail goes cold/i);
  });
});
