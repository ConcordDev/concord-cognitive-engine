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

// T1.5 — turn a solution step into trail GUIDANCE (the intent, not the literal
// command) so exploring the system points you toward the next move instead of
// requiring you to memorize an exact command list. The fiction (penetrate a
// system by following leads) now matches the mechanic.
export function hintForStep(stepCommand) {
  if (!stepCommand) return "The trail goes cold here — you've reached the objective.";
  const parts = String(stepCommand).trim().split(/\s+/);
  const head = parts[0];
  const arg = parts.slice(1).join(" ");
  switch (head) {
    case "connect":
    case "ssh":   return arg ? `A reference points to a host: "${arg}". Try reaching it.` : "There's another host to reach.";
    case "cd":    return arg ? `A path looks worth exploring: "${arg}".` : "There's a directory worth opening.";
    case "cat":   return arg ? `A file here looks relevant: "${arg}". Read it.` : "A file here looks relevant — read it.";
    case "decrypt": return arg ? `Something is encrypted: "${arg}". It can be cracked.` : "Something here is encrypted.";
    case "exec":  return arg ? `An executable stands out: "${arg}". Run it.` : "An executable stands out.";
    case "ls":    return "Look around first — list what's here.";
    default:      return "Keep probing the system.";
  }
}

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
      // Wrong step — reset progress (Zachtronics-flavor: fail = retry). T1.5:
      // re-point the player at the first lead so they can follow the trail.
      db.prepare(`
        UPDATE hacking_attempts SET commands_log = '[]'
        WHERE user_id = ? AND puzzle_id = ?
      `).run(userId, puzzleId);
      return { ok: true, matched: false, progressReset: true, nextHint: hintForStep(solution[0]) };
    }

    if (nextStepIdx >= solution.length) {
      db.prepare(`
        UPDATE hacking_attempts SET completed_at = unixepoch()
        WHERE user_id = ? AND puzzle_id = ?
      `).run(userId, puzzleId);
      return { ok: true, matched: true, completed: true, rewardCc: puzzle.reward_cc };
    }

    // T1.5 — guide the player toward the next lead instead of making them
    // memorize the command list.
    return { ok: true, matched: true, step: nextStepIdx, totalSteps: solution.length, nextHint: hintForStep(solution[nextStepIdx]) };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * T1.5 — the current trail hint for a player's in-progress attempt (the initial
 * nudge shown when the terminal opens, and after a reset). Never leaks the
 * literal command — only the lead. Solution path stays server-private.
 */
export function getHint(db, puzzleId, userId) {
  if (!db || !puzzleId) return { ok: false, error: "missing_inputs" };
  try {
    const puzzle = db.prepare(`SELECT solution_path_json FROM hacking_puzzles WHERE id = ?`).get(puzzleId);
    if (!puzzle) return { ok: false, error: "no_puzzle" };
    const solution = JSON.parse(puzzle.solution_path_json);
    let idx = 0;
    if (userId) {
      const attempt = db.prepare(`SELECT commands_log, completed_at FROM hacking_attempts WHERE user_id = ? AND puzzle_id = ?`).get(userId, puzzleId);
      if (attempt?.completed_at) return { ok: true, completed: true, hint: null };
      if (attempt?.commands_log) { try { idx = JSON.parse(attempt.commands_log).length; } catch { idx = 0; } }
    }
    return { ok: true, step: idx, totalSteps: solution.length, hint: hintForStep(solution[idx]) };
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
