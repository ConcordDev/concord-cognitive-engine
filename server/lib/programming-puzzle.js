// server/lib/programming-puzzle.js
//
// Phase CC3 — programming puzzle.
//
// Tiny VM: 5 ops (MOV, ADD, JMP, JEZ, OUT), 4 registers (R0..R3),
// input tape + output tape. The user submits a program (array of
// instructions); we run it against each test_case (input → expected
// output) and score by cycles + program length.

const VALID_OPS = new Set(["MOV", "ADD", "JMP", "JEZ", "OUT"]);
// Phase E1 — env-overridable. See docs/BALANCE_DIALS.md.
const MAX_CYCLES = Number(process.env.CONCORD_CODE_PUZZLE_MAX_CYCLES) || 10_000;

import crypto from "node:crypto";
import logger from "../logger.js";
import { puzzleHardness } from "./complexity/hardness.js";

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

// The editor UI ships each instruction as { op, a, b } (two positional operand
// fields), but the VM speaks { dst, src, to }. Without this adapter every
// operand resolves to undefined and EVERY program is a silent no-op — no code
// puzzle is solvable through the UI (POLISH_AUDIT T0.1). Map a/b → canonical
// per-op; keep any explicit dst/src/to (authored reference solutions use those),
// so this is fully backward-compatible.
export function _normalizeInstr(instr) {
  if (!instr || typeof instr !== "object") return instr;
  if (instr.dst != null || instr.src != null || instr.to != null) return instr; // already canonical
  if (instr.a == null && instr.b == null) return instr;
  const { op, a, b } = instr;
  switch (op) {
    case "MOV":
    case "ADD":
    case "SUB":
      return { ...instr, dst: a, src: b };
    case "JEZ":
    case "JNZ":
      return { ...instr, src: a, to: b };
    case "JMP":
      return { ...instr, to: a };
    case "OUT":
      return { ...instr, src: a };
    default:
      return instr;
  }
}

function _runVm(program, input) {
  const reg = [0, 0, 0, 0];
  const tape = [];
  let ip = 0;
  let cycles = 0;
  const inputCursor = { i: 0 };

  while (ip < program.length && cycles < MAX_CYCLES) {
    const instr = _normalizeInstr(program[ip]);
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
    // D7 — return the percentile feedback so the editor can show where this
    // solution lands (cycles + size) the moment it's accepted.
    let stats = null;
    try { stats = solutionHistogram(db, puzzleId, { userId }); } catch { /* stats best-effort */ }
    return { ok: true, accepted: true, cycles: r.cycles, size: r.size, improved: better, stats };
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
    const test_cases = JSON.parse(p.test_cases_json);
    // Wave 5 #31 — derive a principled difficulty from the puzzle's structure
    // (code puzzles carry no authored difficulty label). Additive field.
    const difficulty = puzzleHardness({
      optimalCycles: p.optimal_cycles,
      optimalSize: p.optimal_size,
      testCases: Array.isArray(test_cases) ? test_cases.length : 0,
    });
    return { ...p, test_cases, difficulty };
  } catch { return null; }
}

// ── D7 (depth plan) — Zachtronics percentile feedback ──────────────────────
// Finding a solution that *works* is the easy part; the Zachtronics depth is
// optimisation against the population on orthogonal axes (cycles vs size, which
// usually trade off). Surfacing where a solution lands on the distribution —
// "you're better than 78% of solvers on cycles" — turns "it works" into an
// endgame and makes every solution feel placed, not just pass/fail. Histograms,
// not leaderboards: a #1-or-nothing ranking demotivates; a percentile rewards
// improvement at every skill level.

/** % of entries strictly worse (greater) than `value` — lower cycles/size is
 *  better, so this reads as "the fraction of solvers you beat". Pure. */
export function percentileBeating(sortedAsc, value) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0 || !Number.isFinite(value)) return null;
  let worse = 0;
  for (const v of sortedAsc) if (v > value) worse++;
  return Math.round((worse / sortedAsc.length) * 100);
}

/** Bucket `values` into `bins` equal-width bins. Pure. */
export function histogramBins(values, bins = 8) {
  const vals = (values || []).filter(Number.isFinite);
  if (vals.length === 0) return [];
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) return [{ lo: min, hi: max, count: vals.length }];
  const n = Math.max(1, Math.floor(bins));
  const width = (max - min) / n;
  const out = Array.from({ length: n }, (_, i) => ({
    lo: Math.round((min + i * width) * 100) / 100,
    hi: Math.round((min + (i + 1) * width) * 100) / 100,
    count: 0,
  }));
  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    out[idx].count++;
  }
  return out;
}

/**
 * Distribution of all submitted solutions for a puzzle on both axes + the
 * player's percentile on each, plus the authored optimum for reference.
 */
export function solutionHistogram(db, puzzleId, { userId = null, bins = 8 } = {}) {
  if (!db || !puzzleId) return null;
  try {
    const rows = db.prepare(
      `SELECT user_id, cycles, size FROM programming_solutions WHERE puzzle_id = ?`
    ).all(puzzleId);
    const cycles = rows.map((r) => r.cycles).filter(Number.isFinite);
    const sizes = rows.map((r) => r.size).filter(Number.isFinite);
    const puzzle = db.prepare(
      `SELECT optimal_cycles, optimal_size FROM programming_puzzles WHERE id = ?`
    ).get(puzzleId) || {};
    const mine = userId ? rows.find((r) => r.user_id === userId) : null;
    const cyclesSorted = [...cycles].sort((a, b) => a - b);
    const sizesSorted = [...sizes].sort((a, b) => a - b);
    return {
      solutionCount: rows.length,
      optimal: { cycles: puzzle.optimal_cycles ?? null, size: puzzle.optimal_size ?? null },
      cycles: {
        histogram: histogramBins(cycles, bins),
        best: cyclesSorted[0] ?? null,
        mine: mine?.cycles ?? null,
        percentile: mine ? percentileBeating(cyclesSorted, mine.cycles) : null,
      },
      size: {
        histogram: histogramBins(sizes, bins),
        best: sizesSorted[0] ?? null,
        mine: mine?.size ?? null,
        percentile: mine ? percentileBeating(sizesSorted, mine.size) : null,
      },
    };
  } catch { return null; }
}

export { VALID_OPS, MAX_CYCLES };
