// server/lib/programming-puzzle.js
//
// Phase CC3 — programming puzzle.
//
// Tiny VM: 5 ops (MOV, ADD, JMP, JEZ, OUT), 4 registers (R0..R3),
// input tape + output tape. The user submits a program (array of
// instructions); we run it against each test_case (input → expected
// output) and score by cycles + program length.

const VALID_OPS = new Set(["MOV", "ADD", "JMP", "JEZ", "OUT"]);
const MAX_CYCLES = 10_000;

import crypto from "node:crypto";
import logger from "../logger.js";

export function authorPuzzle(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { name, description, testCases, optimalCycles, optimalSize } = opts;
  if (!name || !testCases || !Array.isArray(testCases) || testCases.length === 0) {
    return { ok: false, error: "missing_inputs" };
  }
  try {
    const id = `pgp_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO programming_puzzles
        (id, name, description, test_cases_json, optimal_cycles, optimal_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, description || null, JSON.stringify(testCases),
      optimalCycles || null, optimalSize || null);
    return { ok: true, puzzleId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Run `program` against the puzzle's test cases. Returns the per-case
 * actual outputs + a `passed` boolean.
 */
export function runSolution(db, puzzleId, program) {
  if (!db || !puzzleId) return { ok: false, error: "missing_inputs" };
  if (!Array.isArray(program)) return { ok: false, error: "invalid_program" };

  try {
    const puzzle = db.prepare(`SELECT test_cases_json FROM programming_puzzles WHERE id = ?`).get(puzzleId);
    if (!puzzle) return { ok: false, error: "no_puzzle" };
    const cases = JSON.parse(puzzle.test_cases_json);

    // Validate program ops.
    for (const instr of program) {
      if (!instr || !VALID_OPS.has(instr.op)) {
        return { ok: false, error: "invalid_op" };
      }
    }

    let totalCycles = 0;
    const caseResults = [];
    for (const tc of cases) {
      const out = _runVm(program, tc.input || []);
      const expected = tc.expected || [];
      const pass = JSON.stringify(out.tape) === JSON.stringify(expected);
      caseResults.push({ input: tc.input, expected, actual: out.tape, cycles: out.cycles, pass });
      totalCycles += out.cycles;
    }
    const allPass = caseResults.every(r => r.pass);
    return {
      ok: true,
      passed: allPass,
      cases: caseResults,
      cycles: totalCycles,
      size: program.length,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _runVm(program, input) {
  const reg = [0, 0, 0, 0];
  const tape = [];
  let ip = 0;
  let cycles = 0;
  const inputCursor = { i: 0 };

  while (ip < program.length && cycles < MAX_CYCLES) {
    const instr = program[ip];
    cycles++;
    switch (instr.op) {
      case "MOV": {
        // MOV dst src — src can be reg "R0" or "INP" or numeric immediate.
        const v = _resolve(instr.src, reg, input, inputCursor);
        const dstIdx = _regIdx(instr.dst);
        if (dstIdx == null) return { tape, cycles };
        reg[dstIdx] = v;
        ip++;
        break;
      }
      case "ADD": {
        const dstIdx = _regIdx(instr.dst);
        if (dstIdx == null) return { tape, cycles };
        reg[dstIdx] = reg[dstIdx] + _resolve(instr.src, reg, input, inputCursor);
        ip++;
        break;
      }
      case "JMP": {
        ip = Math.max(0, Number(instr.to) || 0);
        break;
      }
      case "JEZ": {
        const v = _resolve(instr.src, reg, input, inputCursor);
        if (v === 0) ip = Math.max(0, Number(instr.to) || 0);
        else ip++;
        break;
      }
      case "OUT": {
        tape.push(_resolve(instr.src, reg, input, inputCursor));
        ip++;
        break;
      }
      default:
        return { tape, cycles };
    }
  }
  return { tape, cycles };
}

function _resolve(token, reg, input, cursor) {
  if (typeof token === "number") return token;
  if (typeof token !== "string") return 0;
  if (token === "INP") {
    const v = input[cursor.i] ?? 0;
    cursor.i++;
    return v;
  }
  const idx = _regIdx(token);
  if (idx != null) return reg[idx];
  return Number(token) || 0;
}

function _regIdx(token) {
  const m = /^R([0-3])$/.exec(String(token));
  return m ? Number(m[1]) : null;
}

export function submitSolution(db, userId, puzzleId, program) {
  if (!db || !userId || !puzzleId) return { ok: false, error: "missing_inputs" };
  const r = runSolution(db, puzzleId, program);
  if (!r.ok) return r;
  if (!r.passed) return { ok: false, error: "tests_failed", cases: r.cases };
  try {
    // Best (lowest cycles) wins — upsert if better.
    const existing = db.prepare(`
      SELECT cycles FROM programming_solutions WHERE user_id = ? AND puzzle_id = ?
    `).get(userId, puzzleId);
    const better = !existing || r.cycles < existing.cycles;
    if (better) {
      db.prepare(`
        INSERT INTO programming_solutions (user_id, puzzle_id, program_json, cycles, size)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, puzzle_id) DO UPDATE SET
          program_json = excluded.program_json,
          cycles = excluded.cycles,
          size = excluded.size,
          submitted_at = unixepoch()
      `).run(userId, puzzleId, JSON.stringify(program), r.cycles, r.size);
    }
    return { ok: true, accepted: true, cycles: r.cycles, size: r.size, improved: better };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function leaderboardForPuzzle(db, puzzleId, limit = 10) {
  if (!db || !puzzleId) return [];
  try {
    return db.prepare(`
      SELECT user_id, cycles, size, submitted_at FROM programming_solutions
      WHERE puzzle_id = ?
      ORDER BY cycles ASC, size ASC LIMIT ?
    `).all(puzzleId, Math.max(1, Math.min(50, limit)));
  } catch { return []; }
}

export function listPuzzles(db, opts = {}) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, name, description, optimal_cycles, optimal_size, created_at
      FROM programming_puzzles
      ORDER BY created_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(200, opts.limit || 50)));
  } catch { return []; }
}

export function getPuzzle(db, puzzleId) {
  if (!db || !puzzleId) return null;
  try {
    const p = db.prepare(`
      SELECT id, name, description, test_cases_json, optimal_cycles, optimal_size, created_at
      FROM programming_puzzles WHERE id = ?
    `).get(puzzleId);
    if (!p) return null;
    return { ...p, test_cases: JSON.parse(p.test_cases_json) };
  } catch { return null; }
}

export { VALID_OPS, MAX_CYCLES };
