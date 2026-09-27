// server/lib/runtime/polymarket-observe.js
//
// Concord Runtime — read-only observation of ~/.polymarket (the Polymarket
// live-favorites bot). Same shape as zuko-observe.js: Concord observes the
// bot's own state files; it never places or cancels orders.
//
// credentials.json holds the bot's wallet/API auth. It is never opened here —
// only the named state files below are read, and only the counts/timestamps
// in the public* projections leave this module (an allowlist, not a strip).

import path from "node:path";
import { homePresence, readJsonIfPresent, resolveSisterHomes } from "./sister-homes.js";
import { publish } from "./event-bus.js";

const STATE_FILES = {
  favorites: "live_favorites_state.json",
  ledger: "entry_ledger.json",
  blocked: "blocked_markets.json",
  pendingSells: "exit_pending_sells.json",
  noFill: "exit_nofill_streaks.json",
};

const count = (v) => (v && typeof v === "object" ? Object.keys(v).length : 0);
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * @param {object} [opts]
 * @param {ReturnType<typeof resolveSisterHomes>} [opts.homes]
 * @param {boolean} [opts.publishEvents]
 */
export function observePolymarket(opts = {}) {
  const homes = opts.homes || resolveSisterHomes();
  const presence = homePresence(homes.polymarket);
  if (!presence.present) {
    return { ok: true, present: false, reason: presence.reason, owner: "polymarket" };
  }

  const read = {};
  for (const [k, file] of Object.entries(STATE_FILES)) read[k] = readJsonIfPresent(path.join(homes.polymarket, file));

  const fav = read.favorites.ok ? read.favorites.value : null;
  const mtimes = Object.values(read).filter((r) => r.ok).map((r) => r.mtimeMs);
  const lastActivityMs = mtimes.length ? Math.max(...mtimes) : null;

  const snapshot = {
    ok: true,
    present: true,
    owner: "polymarket",
    path: presence.path,
    bot: fav ? {
      cycleCount: Number.isFinite(fav.cycle_count) ? fav.cycle_count : null,
      ordersPlacedTotal: Number.isFinite(fav.orders_placed_total) ? fav.orders_placed_total : null,
      marketsSeen: count(fav.seen_markets),
    } : { reason: read.favorites.reason },
    positions: {
      entries: read.ledger.ok ? count(read.ledger.value) : null,
      pendingSells: read.pendingSells.ok ? count(read.pendingSells.value) : null,
      noFillStreaks: read.noFill.ok ? count(read.noFill.value) : null,
      blockedMarkets: read.blocked.ok ? count(read.blocked.value) : null,
    },
    lastActivity: iso(lastActivityMs),
    execute: { locked: true, reason: "runtime_must_not_place_polymarket_orders" },
    note: "Read-only. Counts and timestamps only; credentials are never read.",
  };

  if (opts.publishEvents) {
    publish("market.observed", {
      venue: "polymarket",
      present: true,
      entries: snapshot.positions.entries,
      lastActivity: snapshot.lastActivity,
    });
  }
  return snapshot;
}

export function polymarketExecuteLocked(input = {}) {
  return {
    ok: false,
    reason: "locked",
    capability: "polymarket.execute",
    requested: input && typeof input === "object" ? Object.keys(input).slice(0, 8) : [],
    note: "The Polymarket bot stays independently bounded. Concord observes; it does not trade.",
  };
}
