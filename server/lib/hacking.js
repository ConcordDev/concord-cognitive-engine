// server/lib/hacking.js
//
// Phase CC2 — hacking puzzle.
//
// Players issue commands (ls / cd / cat / connect / exec) against a
// fake terminal tree. The puzzle's solution_path is an ordered list
// of commands; matching all in order completes the puzzle and grants
// reward_cc.

import crypto from "node:crypto";
import logger from "../logger.js";

const VALID_COMMANDS = new Set(["ls", "cd", "cat", "connect", "exec", "decrypt", "ssh"]);

export function authorPuzzle(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { name, difficulty = 1, targetDtuId, terminalTree, solutionPath, rewardCc = 50 } = opts;
  if (!name || !terminalTree || !solutionPath) return { ok: false, error: "missing_inputs" };
  if (!Array.isArray(solutionPath) || solutionPath.length === 0) {
    return { ok: false, error: "empty_solution_path" };
  }
  try {
    const id = `hkp_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO hacking_puzzles
        (id, name, difficulty, target_dtu_id, terminal_tree_json, solution_path_json, reward_cc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, Math.max(1, Math.min(5, Math.floor(difficulty))),
      targetDtuId || null, JSON.stringify(terminalTree), JSON.stringify(solutionPath), Math.max(0, rewardCc));
    return { ok: true, puzzleId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function attemptCommand(db, puzzleId, userId, command) {
  if (!db || !puzzleId || !userId || !command) return { ok: false, error: "missing_inputs" };
  const cmd = String(command).trim();
  const head = cmd.split(/\s+/)[0];
  if (!VALID_COMMANDS.has(head)) return { ok: false, error: "invalid_command" };

  try {
    const puzzle = db.prepare(`SELECT solution_path_json, reward_cc FROM hacking_puzzles WHERE id = ?`).get(puzzleId);
    if (!puzzle) return { ok: false, error: "no_puzzle" };

    const solution = JSON.parse(puzzle.solution_path_json);
    // Ensure attempt row.
    db.prepare(`
      INSERT INTO hacking_attempts (user_id, puzzle_id, attempt_count)
      VALUES (?, ?, 0)
      ON CONFLICT DO NOTHING
    `).run(userId, puzzleId);

    const attempt = db.prepare(`
      SELECT commands_log, completed_at FROM hacking_attempts
      WHERE user_id = ? AND puzzle_id = ?
    `).get(userId, puzzleId);
    if (attempt.completed_at) return { ok: true, alreadyComplete: true };

    const log = JSON.parse(attempt.commands_log);
    log.push(cmd);
    const nextStepIdx = log.length;
    const expected = solution[nextStepIdx - 1];
    const matches = expected === cmd;

    db.prepare(`
      UPDATE hacking_attempts
      SET commands_log = ?, attempt_count = attempt_count + 1
      WHERE user_id = ? AND puzzle_id = ?
    `).run(JSON.stringify(log), userId, puzzleId);

    if (!matches) {
      // Wrong step — reset progress (Zachtronics-flavor: fail = retry).
      db.prepare(`
        UPDATE hacking_attempts SET commands_log = '[]'
        WHERE user_id = ? AND puzzle_id = ?
      `).run(userId, puzzleId);
      return { ok: true, matched: false, progressReset: true };
    }

    if (nextStepIdx >= solution.length) {
      db.prepare(`
        UPDATE hacking_attempts SET completed_at = unixepoch()
        WHERE user_id = ? AND puzzle_id = ?
      `).run(userId, puzzleId);
      return { ok: true, matched: true, completed: true, rewardCc: puzzle.reward_cc };
    }

    return { ok: true, matched: true, step: nextStepIdx, totalSteps: solution.length };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listPuzzles(db, opts = {}) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, name, difficulty, reward_cc, created_at FROM hacking_puzzles
      ORDER BY difficulty ASC, created_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(200, opts.limit || 50)));
  } catch { return []; }
}

export function getPuzzle(db, puzzleId) {
  if (!db || !puzzleId) return null;
  try {
    // Explicit column list — never leak solution_path_json to the player.
    const p = db.prepare(`
      SELECT id, name, difficulty, target_dtu_id, terminal_tree_json,
             reward_cc, created_at
      FROM hacking_puzzles WHERE id = ?
    `).get(puzzleId);
    if (!p) return null;
    return {
      ...p,
      terminal_tree: JSON.parse(p.terminal_tree_json),
    };
  } catch { return null; }
}

export function getAttemptStatus(db, userId, puzzleId) {
  if (!db || !userId || !puzzleId) return null;
  try {
    return db.prepare(`
      SELECT started_at, completed_at, attempt_count, commands_log
      FROM hacking_attempts WHERE user_id = ? AND puzzle_id = ?
    `).get(userId, puzzleId) || null;
  } catch { return null; }
}

export { VALID_COMMANDS };
