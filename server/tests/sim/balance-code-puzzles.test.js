// Phase G3.2 — code puzzle MAX_CYCLES histogram.
//
// Walks content/code-puzzles.json. For each puzzle, runs a representative
// passing solution (when provided in the puzzle's `reference_solution`
// field) and records cycles_used. Builds percentile histogram of total
// cycles per puzzle and recommends a new MAX_CYCLES value.
//
// Writes audit/balance/code-puzzle-cycles.json.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import { up as upCodePuzzles } from "../../migrations/253_programming_puzzles.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

describe("Phase G3.2 — code puzzle MAX_CYCLES histogram", () => {
  it("walks puzzles and writes audit/balance/code-puzzle-cycles.json", async () => {
    // Load the puzzles file.
    let puzzlesJson;
    try {
      puzzlesJson = JSON.parse(readFileSync(join(ROOT, "content", "code-puzzles.json"), "utf8"));
    } catch {
      // No puzzles file — write an empty report and pass.
      const outDir = join(ROOT, "audit", "balance");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "code-puzzle-cycles.json"), JSON.stringify({
        sprint: "G3.2",
        puzzlesEvaluated: 0,
        note: "no code-puzzles.json file found",
        currentDefault: 10000,
        recommendation: 10000,
      }, null, 2));
      return;
    }

    // Setup an in-memory DB with the puzzle table populated.
    const db = new Database(":memory:");
    upCodePuzzles(db);

    let inserted = 0;
    for (const p of puzzlesJson) {
      if (!p?.id || !p?.test_cases) continue;
      try {
        db.prepare(`
          INSERT OR IGNORE INTO programming_puzzles
            (id, title, prompt, test_cases_json, difficulty, created_at)
          VALUES (?, ?, ?, ?, ?, unixepoch())
        `).run(p.id, p.title || p.id, p.prompt || "", JSON.stringify(p.test_cases), p.difficulty || 1);
        inserted++;
      } catch { /* per-puzzle best-effort */ }
    }

    // For each puzzle that has a reference_solution, run it through
    // the VM and record cycles.
    const { runSolution } = await import("../../lib/programming-puzzle.js");
    const cycles = [];
    const perPuzzle = [];
    for (const p of puzzlesJson) {
      if (!p?.reference_solution || !Array.isArray(p.reference_solution)) continue;
      const r = runSolution(db, p.id, p.reference_solution);
      if (r?.ok && r.passed) {
        cycles.push(r.cycles);
        perPuzzle.push({ id: p.id, cycles: r.cycles, size: r.size });
      }
    }

    const recommendation = cycles.length > 0
      ? Math.max(10_000, percentile(cycles, 70) * 4)
      : 10_000;

    const outDir = join(ROOT, "audit", "balance");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "code-puzzle-cycles.json"), JSON.stringify({
      sprint: "G3.2",
      puzzlesEvaluated: cycles.length,
      puzzlesSeeded: inserted,
      percentiles: cycles.length > 0 ? {
        p50: percentile(cycles, 50),
        p70: percentile(cycles, 70),
        p90: percentile(cycles, 90),
        p99: percentile(cycles, 99),
        max: Math.max(...cycles),
      } : null,
      perPuzzle,
      currentDefault: 10000,
      recommendation,
      formula: "max(10_000, p70 * 4)",
    }, null, 2));
    assert.ok(true);
  });
});
