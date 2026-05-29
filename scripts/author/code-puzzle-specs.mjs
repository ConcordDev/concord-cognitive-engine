// scripts/author/code-puzzle-specs.mjs
//
// Hand-authored programming-puzzle designs. Each puzzle is a player-facing skill
// challenge, so the prose + difficulty are authored, but the test cases are DERIVED
// from a reference solution program run through the shared VM — guaranteeing every
// committed puzzle is solvable and its test cases are self-consistent.
//
// REFERENCE_PROGRAMS holds a verified solution for EVERY code puzzle (the 8 originals
// + the 12 new), keyed by id. content-libs.test.js replays these against the committed
// content/code-puzzles.json to prove solvability. Solutions are NOT shipped to players
// (the seeded puzzle stores only test cases + optimal hints).

import { runVm } from "./code-vm.mjs";

const i = (op, dst, src, to) => {
  const o = { op };
  if (dst !== undefined) o.dst = dst;
  if (src !== undefined) o.src = src;
  if (to !== undefined) o.to = to;
  return o;
};

// Reference solutions for the 8 originally-authored puzzles (reproduce their
// committed test cases) + the 12 new ones.
export const REFERENCE_PROGRAMS = {
  // originals
  "echo-r0": [i("MOV", "R0", "INP"), i("OUT", undefined, "R0")],
  "add-two": [i("MOV", "R0", "INP"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0")],
  "double-it": [i("MOV", "R0", "INP"), i("ADD", "R0", "R0"), i("OUT", undefined, "R0")],
  "sum-three": [i("MOV", "R0", "INP"), i("ADD", "R0", "INP"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0")],
  "is-zero": [i("MOV", "R0", "INP"), i("JEZ", undefined, "R0", 4), i("OUT", undefined, 0), i("JMP", undefined, undefined, 5), i("OUT", undefined, 1)],
  "echo-twice": [i("MOV", "R0", "INP"), i("OUT", undefined, "R0"), i("OUT", undefined, "R0")],
  "loop-n-zeros": [i("MOV", "R0", "INP"), i("JEZ", undefined, "R0", 5), i("OUT", undefined, 0), i("ADD", "R0", -1), i("JMP", undefined, undefined, 1)],
  "running-sum": [i("MOV", "R0", "INP"), i("OUT", undefined, "R0"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0")],
  // new
  "add-five": [i("MOV", "R0", "INP"), i("ADD", "R0", 5), i("OUT", undefined, "R0")],
  "triple-it": [i("MOV", "R0", "INP"), i("MOV", "R1", "R0"), i("ADD", "R0", "R1"), i("ADD", "R0", "R1"), i("OUT", undefined, "R0")],
  "sum-four": [i("MOV", "R0", "INP"), i("ADD", "R0", "INP"), i("ADD", "R0", "INP"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0")],
  "echo-three": [i("MOV", "R0", "INP"), i("OUT", undefined, "R0"), i("OUT", undefined, "R0"), i("OUT", undefined, "R0")],
  "swap-pair": [i("MOV", "R0", "INP"), i("MOV", "R1", "INP"), i("OUT", undefined, "R1"), i("OUT", undefined, "R0")],
  "minus-five": [i("MOV", "R0", "INP"), i("ADD", "R0", -5), i("OUT", undefined, "R0")],
  "countdown": [i("MOV", "R0", "INP"), i("JEZ", undefined, "R0", 5), i("OUT", undefined, "R0"), i("ADD", "R0", -1), i("JMP", undefined, undefined, 1)],
  "repeat-value": [i("MOV", "R0", "INP"), i("MOV", "R1", "INP"), i("JEZ", undefined, "R1", 6), i("OUT", undefined, "R0"), i("ADD", "R1", -1), i("JMP", undefined, undefined, 2)],
  "sum-to-n": [i("MOV", "R1", "INP"), i("MOV", "R0", 0), i("JEZ", undefined, "R1", 6), i("ADD", "R0", "R1"), i("ADD", "R1", -1), i("JMP", undefined, undefined, 2), i("OUT", undefined, "R0")],
  "double-pair": [i("MOV", "R0", "INP"), i("ADD", "R0", "R0"), i("OUT", undefined, "R0"), i("MOV", "R1", "INP"), i("ADD", "R1", "R1"), i("OUT", undefined, "R1")],
  "pair-sums": [i("MOV", "R0", "INP"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0"), i("MOV", "R1", "INP"), i("ADD", "R1", "INP"), i("OUT", undefined, "R1")],
  "running-sum-four": [i("MOV", "R0", "INP"), i("OUT", undefined, "R0"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0"), i("ADD", "R0", "INP"), i("OUT", undefined, "R0")],
};

// The 12 new puzzles: authored prose + the sample inputs that become test cases.
// Test cases (expected outputs) are derived from REFERENCE_PROGRAMS via the VM.
export const NEW_PUZZLE_META = [
  { id: "add-five", name: "Add Five", description: "Output input[0] + 5.", inputs: [[0], [3], [10]] },
  { id: "triple-it", name: "Triple It", description: "Output input[0] tripled (no MUL — add it up).", inputs: [[2], [0], [5]] },
  { id: "sum-four", name: "Sum Four", description: "Add input[0] + input[1] + input[2] + input[3].", inputs: [[1, 2, 3, 4], [0, 0, 0, 0], [5, 5, 5, 5]] },
  { id: "echo-three", name: "Echo Thrice", description: "Output input[0] three times in sequence.", inputs: [[4], [9]] },
  { id: "swap-pair", name: "Swap Pair", description: "Output input[1] then input[0].", inputs: [[1, 2], [7, 3]] },
  { id: "minus-five", name: "Minus Five", description: "Output input[0] - 5 (ADD a negative immediate).", inputs: [[10], [5], [8]] },
  { id: "countdown", name: "Countdown", description: "Output N, N-1, ..., 1 where N = input[0]. Use JEZ + JMP.", inputs: [[3], [0], [5]] },
  { id: "repeat-value", name: "Repeat Value", description: "Output input[0] repeated input[1] times.", inputs: [[7, 3], [9, 0], [4, 2]] },
  { id: "sum-to-n", name: "Sum To N", description: "Output 1 + 2 + ... + N where N = input[0].", inputs: [[3], [0], [5]] },
  { id: "double-pair", name: "Double Pair", description: "Output 2*input[0] then 2*input[1].", inputs: [[3, 4], [0, 5]] },
  { id: "pair-sums", name: "Pair Sums", description: "Output (input[0]+input[1]) then (input[2]+input[3]).", inputs: [[1, 2, 3, 4], [10, 5, 0, 5]] },
  { id: "running-sum-four", name: "Running Sum Four", description: "Output the running total after each of 4 inputs.", inputs: [[1, 2, 3, 4], [2, 2, 2, 2]] },
];

/** Build the 12 new code-puzzle records, deriving test cases from the VM. */
export function buildNewCodePuzzles() {
  return NEW_PUZZLE_META.map((m) => {
    const program = REFERENCE_PROGRAMS[m.id];
    if (!program) throw new Error(`no reference program for ${m.id}`);
    let maxCycles = 0;
    const testCases = m.inputs.map((input) => {
      const { tape, cycles } = runVm(program, input);
      if (cycles > maxCycles) maxCycles = cycles;
      return { input, expected: tape };
    });
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      optimalCycles: maxCycles,
      optimalSize: program.length,
      testCases,
    };
  });
}
