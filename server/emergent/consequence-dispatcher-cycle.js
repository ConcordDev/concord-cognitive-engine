// server/emergent/consequence-dispatcher-cycle.js
//
// Wave A / A1 — heartbeat that drains `scheduled_consequences` and
// routes each due row to a per-kind handler. Handlers live in their
// owning wave's module (Wave B for scheme reveals, Wave C for kill-
// cascades, Wave D for bard legends, Wave E for echo quests). Each is
// lazy-imported the first time its kind appears, so adding new kinds
// never grows this file.
//
// Heartbeat invariant: never throws. Returns plain { ok, ... }.
//
// Kill switch: CONCORD_CONSEQUENCE_DISPATCHER=0.

import logger from "../logger.js";
import { due, markFired } from "../lib/scheduled-consequences.js";

const MAX_PER_PASS = 32;

// Lazy handler registry. Each entry is the module path; the module's
// default export is `async function handle(db, consequence) -> result`.
// Adding a new kind = one entry here, no other change.
const HANDLER_MODULES = {
  // Wave B / item 4
  "scheme:reveal":            "../lib/consequence-handlers/scheme-reveal.js",

  // Wave C / item 9
  "royal_kill_radicalize":    "../lib/consequence-handlers/royal-kill.js",
  "royal_kill_form_cult":     "../lib/consequence-handlers/royal-kill.js",
  "royal_kill_attack":        "../lib/consequence-handlers/royal-kill.js",
  "betrayal_gossip":          "../lib/consequence-handlers/betrayal.js",
  "betrayal_distrust":        "../lib/consequence-handlers/betrayal.js",
  "betrayal_blacklist":       "../lib/consequence-handlers/betrayal.js",
  "bounty_posted":            "../lib/consequence-handlers/bounty.js",

  // Wave D / item 2
  "mass_atrocity_legend":     "../lib/consequence-handlers/atrocity-legend.js",
  "mass_atrocity_news":       "../lib/consequence-handlers/atrocity-legend.js",

  // Wave E / item 5
  "echo_quest_spawn":         "../lib/consequence-handlers/echo-quest.js",
};

const _handlerCache = new Map();

async function _loadHandler(kind) {
  if (_handlerCache.has(kind)) return _handlerCache.get(kind);
  const path = HANDLER_MODULES[kind];
  if (!path) {
    _handlerCache.set(kind, null);
    return null;
  }
  try {
    const mod = await import(path);
    const fn = mod.default || mod.handle || null;
    _handlerCache.set(kind, fn);
    return fn;
  } catch (err) {
    // Handler not yet shipped (waves land incrementally). Cache the
    // null so we don't keep retrying the dynamic import — but the
    // dispatcher marks the row fired with `unhandled` so the table
    // doesn't accumulate forever.
    logger?.debug?.("consequence-dispatcher", "handler_not_found", { kind, error: err?.message });
    _handlerCache.set(kind, null);
    return null;
  }
}

export async function runConsequenceDispatcherCycle({ db } = {}) {
  if (process.env.CONCORD_CONSEQUENCE_DISPATCHER === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };

  let rows = [];
  try {
    rows = due(db, undefined, MAX_PER_PASS);
  } catch {
    return { ok: true, reason: "no_table", drained: 0 };
  }
  if (rows.length === 0) return { ok: true, drained: 0 };

  const stats = { ok: true, evaluated: rows.length, fired: 0, unhandled: 0, errored: 0 };
  for (const c of rows) {
    let result = null;
    try {
      const handler = await _loadHandler(c.kind);
      if (!handler) {
        markFired(db, c.id, { unhandled: true, kind: c.kind });
        stats.unhandled++;
        continue;
      }
      result = await handler(db, c);
      markFired(db, c.id, result || { ok: true });
      stats.fired++;
    } catch (err) {
      logger?.warn?.("consequence-dispatcher", "handler_failed", { id: c.id, kind: c.kind, error: err?.message });
      markFired(db, c.id, { ok: false, error: err?.message || "handler_threw" });
      stats.errored++;
    }
  }
  return stats;
}
