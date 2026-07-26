// server/migrations/388_user_style_tool_usage.js
//
// Grounding-audit gap (2026-07-24): the V1.2 roadmap names "personal
// operating-style learning... adapt tone/approach/tool-preference" as a
// shipped signal, but tone/length/formality/emoji-rate (migration 029's
// user_style_profile + initiative-engine.js#learnStyle) is the ONLY part
// that's real — a direct grep for "tool preference" / "preferred_tool" /
// "tool_usage_pattern" across the whole codebase returned ZERO hits before
// this migration. Nothing computed a tool-preference signal at all.
//
// This migration adds the one column initiative-engine.js#recordToolUsage
// needs to track it: a JSON tally of real ConKay tool-call dispatches
// (chat-agent.js#executeToolCall's call.tool names — web_search,
// run_lens_action, create_dtu, run_authored_tool, etc.), keyed by tool name,
// EMA-free (a plain running count — the dominance check in
// prompt-registry.js#composeSystemPrompt reads share-of-total, so a simple
// counter is the correct shape here, not a smoothed average like the other
// style signals).
//
//   tool_usage_json TEXT NOT NULL DEFAULT '{}' — {"web_search": 4,
//                                 "run_lens_action": 1, ...}. Every existing
//                                 row reads back byte-identically to before
//                                 this migration (default '{}' means "no
//                                 tool-usage observed yet", same honest-empty
//                                 shape as vocabulary_json/shared_context_json
//                                 for a pre-existing profile that predates
//                                 this column).
//
// Idempotent + guarded: no-op if user_style_profile doesn't exist yet
// (minimal build without migration 029 applied) or the column is already
// present.

export function up(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user_style_profile'",
  ).get();
  if (!table) return; // minimal build without the Living Chat substrate — nothing to widen

  const cols = db.prepare(`PRAGMA table_info(user_style_profile)`).all().map((c) => c.name);
  if (cols.includes("tool_usage_json")) return; // already applied

  db.exec(`ALTER TABLE user_style_profile ADD COLUMN tool_usage_json TEXT NOT NULL DEFAULT '{}'`);
}

export function down(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user_style_profile'",
  ).get();
  if (!table) return;

  const cols = db.prepare(`PRAGMA table_info(user_style_profile)`).all().map((c) => c.name);
  if (!cols.includes("tool_usage_json")) return;

  try {
    db.exec(`ALTER TABLE user_style_profile DROP COLUMN tool_usage_json`);
  } catch {
    // Older SQLite builds without DROP COLUMN support — leave the column in
    // place. It's inert (defaults to '{}', never read unless recordToolUsage
    // / the composeSystemPrompt dominance check is also present) and
    // harmless to strand on a down-migration.
  }
}
