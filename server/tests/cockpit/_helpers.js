// Shared test helpers for the cockpit suites (CKPT-08).
import Database from "better-sqlite3";
import { up as up501 } from "../../migrations/501_cockpit_runs.js";
import * as store from "../../lib/cockpit/run-store.js";

export function memDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, scopes TEXT)`);
  db.exec(`CREATE TABLE agent_action_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, action TEXT NOT NULL, input_json TEXT, output_summary TEXT, tool TEXT, outcome TEXT, embedding BLOB, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  db.exec(`CREATE TABLE agent_marathon_tool_log (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, tick_seq INTEGER, call_seq INTEGER NOT NULL, tool_name TEXT NOT NULL, params_json TEXT, status TEXT NOT NULL DEFAULT 'dispatched', result_summary TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER)`);
  up501(db);
  db.prepare(`INSERT INTO users (id, role, scopes) VALUES ('u1','member','["read","write"]')`).run();
  return db;
}

/**
 * A tool executor fake. `table` maps a tool id (or the agent tool name) to a
 * function, or to an array of results consumed in order (the last repeats).
 * Exposes `.calls`.
 */
export function fakeExec(table) {
  const queues = new Map(Object.entries(table).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const fn = async (call) => {
    fn.calls.push(call);
    const key = call.tool === "run_lens_action" && call.params ? `lens:${call.params.domain}.${call.params.action}` : call.tool;
    const entry = queues.has(key) ? queues.get(key) : queues.get(call.tool);
    if (entry === undefined) return { tool: call.tool, ok: false, unknownTool: true, error: `unknown tool: ${call.tool}` };
    if (typeof entry === "function") return entry(call);
    const out = entry.length > 1 ? entry.shift() : entry[0];
    return typeof out === "function" ? out(call) : out;
  };
  fn.calls = [];
  return fn;
}

/** Pre-approve a tool for a run (needs CKPT-13's approval store); tests that exercise writes use this. */
export function preapprove(db, runId, tool) {
  return store.addApproval?.(db, runId, { stepId: null, tool, argsHash: null, scope: "run_tool", userId: "u1", at: Date.now() });
}
