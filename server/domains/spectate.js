// server/domains/spectate.js
//
// Spectate lens — read-only window onto live world spectacles + the
// spectator-betting surface. This domain is a THIN delegator: it owns no
// substrate of its own. It composes three already-real backends:
//
//   • lib/spectator-mode.js   — in-memory socket spectator counts per world
//                               (the "N watching" number the world picker reads)
//   • lib/betting-markets.js  — parimutuel prediction markets in SPARKS
//                               (open/list/place/resolve, migration 162)
//   • lib/goddess-broadcaster — recent goddess dispatches per world (flavor feed)
//
// Macros:
//   spectate.list  (public read)  — every world that has a live spectacle:
//                                    spectator count and/or open markets, merged.
//   spectate.get   (public read)  — one world's full spectacle: watching count,
//                                    open markets, recent goddess dispatches.
//   spectate.bet   (actor-gated)  — place a wager on an open market. Delegates
//                                    straight to betting-markets.placeBet, with a
//                                    fail-CLOSED numeric guard up front.
//
// Registered from server.js:
//   import registerSpectateMacros from "./domains/spectate.js";
//   registerSpectateMacros(register);

import { listSpectatorCounts, getSpectatorCount } from "../lib/spectator-mode.js";
import { listOpenMarkets, placeBet, userPositions } from "../lib/betting-markets.js";
import { startSession } from "../lib/spectator.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE any
// escrow/DB write so it can't slip through betting-markets' Math.floor/max
// clamp. Absent fields are fine (the macro/lib uses its own default). Returns
// null when clean, or the offending key. Copied from domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

// The authored sub-worlds the spectate index renders. Used to give `list` a
// stable, named spine even when no socket spectators are currently attached
// (the markets layer still surfaces live wagering spectacles per world).
const AUTHORED_WORLDS = [
  "concordia-hub", "tunya", "sovereign-ruins", "crime", "cyber",
  "superhero", "fantasy", "lattice-crucible", "concord-link-frontier",
];

function marketShape(m) {
  const poolYes = Number(m.pool_yes_sparks) || 0;
  const poolNo = Number(m.pool_no_sparks) || 0;
  const total = poolYes + poolNo;
  return {
    id: String(m.id),
    worldId: m.world_id || null,
    question: String(m.question || ""),
    resolutionKind: m.resolution_kind || null,
    poolYesSparks: poolYes,
    poolNoSparks: poolNo,
    totalPoolSparks: total,
    // Implied probability of "yes" from the parimutuel pool split (0..1).
    impliedYes: total > 0 ? poolYes / total : 0.5,
    openedAt: m.opened_at || null,
    closesAt: m.closes_at || null,
  };
}

export default function registerSpectateMacros(register) {
  // ── spectate.list ──────────────────────────────────────────────────────────
  // Every world that is currently a live spectacle: it has watchers and/or open
  // betting markets. Merges the in-memory spectator counts with the open-market
  // table so the index can show "12 watching · 3 markets" per world. Honest-empty
  // when nothing is live.
  register("spectate", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const bad = badNumericField(input, ["limit"]);
    if (bad) return { ok: false, reason: `invalid_${bad}` };
    try {
      const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 1000);
      const counts = listSpectatorCounts() || {};
      const openMarkets = listOpenMarkets(db, null, limit) || [];

      // Group open markets by world.
      const marketsByWorld = new Map();
      for (const m of openMarkets) {
        const wid = m.world_id || "concordia-hub";
        if (!marketsByWorld.has(wid)) marketsByWorld.set(wid, []);
        marketsByWorld.get(wid).push(marketShape(m));
      }

      // Union of: authored worlds, worlds with watchers, worlds with markets.
      const worldIds = new Set([
        ...AUTHORED_WORLDS,
        ...Object.keys(counts),
        ...marketsByWorld.keys(),
      ]);

      const spectacles = [];
      for (const worldId of worldIds) {
        const watching = Number(counts[worldId]) || 0;
        const markets = marketsByWorld.get(worldId) || [];
        // A spectacle is "live" if someone is watching OR there's an open market.
        const live = watching > 0 || markets.length > 0;
        spectacles.push({
          worldId,
          watching,
          openMarketCount: markets.length,
          totalPoolSparks: markets.reduce((s, m) => s + m.totalPoolSparks, 0),
          live,
          authored: AUTHORED_WORLDS.includes(worldId),
        });
      }

      // Live spectacles first, then by watcher count, then by name — stable.
      spectacles.sort((a, b) =>
        Number(b.live) - Number(a.live) ||
        b.watching - a.watching ||
        b.openMarketCount - a.openMarketCount ||
        a.worldId.localeCompare(b.worldId));

      const liveCount = spectacles.filter((s) => s.live).length;
      return { ok: true, spectacles, count: spectacles.length, liveCount, currency: "SPARKS" };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Live world spectacles — watcher counts + open betting markets, merged per world." });

  // ── spectate.get ───────────────────────────────────────────────────────────
  // One world's full spectacle: live watcher count, open markets (with implied
  // odds), and the recent goddess dispatch feed. Public read.
  register("spectate", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const bad = badNumericField(input, ["limit"]);
    if (bad) return { ok: false, reason: `invalid_${bad}` };
    const worldId = String(input.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    try {
      const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
      const watching = getSpectatorCount(worldId);
      const markets = (listOpenMarkets(db, worldId, limit) || []).map(marketShape);

      // Recent goddess dispatches are flavor, never load-bearing — never let an
      // absent table/lib break the spectacle read.
      let dispatches = [];
      try {
        const lib = await import("../lib/goddess-broadcaster.js");
        if (typeof lib.recentDispatches === "function") {
          dispatches = lib.recentDispatches(db, worldId, Math.min(limit, 25)) || [];
        }
      } catch { /* flavor only — tolerate absence */ }

      return {
        ok: true,
        worldId,
        spectacle: {
          worldId,
          watching,
          openMarkets: markets,
          openMarketCount: markets.length,
          totalPoolSparks: markets.reduce((s, m) => s + m.totalPoolSparks, 0),
          dispatches,
          live: watching > 0 || markets.length > 0,
        },
        currency: "SPARKS",
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "One world's spectacle — watcher count, open markets, recent goddess dispatches." });

  // ── spectate.bet ───────────────────────────────────────────────────────────
  // Place a wager on an open prediction market. Delegates to the REAL
  // betting-markets.placeBet (SPARKS escrow + position row + pool update). The
  // numeric guard fires BEFORE any escrow/DB write. Actor-gated: SPARKS debit a
  // real per-user balance.
  register("spectate", "bet", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    // Fail CLOSED on poisoned numeric stake — before placeBet's Math.max clamp.
    const bad = badNumericField(input, ["stakeSparks", "stake", "amount"]);
    if (bad) return { ok: false, reason: `invalid_${bad}` };

    const marketId = input.marketId;
    const side = input.side;
    // Accept stakeSparks (canonical), or `stake`/`amount` as aliases.
    const stakeSparks = input.stakeSparks ?? input.stake ?? input.amount;
    if (!marketId || !side || stakeSparks === undefined || stakeSparks === null) {
      return { ok: false, reason: "missing_inputs" };
    }
    // placeBet enforces side ∈ {yes,no} and a minimum stake of 1.
    try {
      const res = placeBet(db, { marketId, userId, side, stakeSparks });
      return res;
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Place a SPARKS wager on an open market (parimutuel). Delegates to betting-markets.placeBet." });

  // ── spectate.watch ─────────────────────────────────────────────────────────
  // Open a read-only spectator session on a world. Delegates to the real
  // spectator.startSession (persists a spectator_sessions row + returns a WS
  // hint the [worldId] view connects to). This is the "create" verb of the lens
  // — a watch session is the artifact a spectator produces. Anonymous watching
  // is allowed (viewer_user_id stays null), so this is not actor-gated, but a
  // worldId is required.
  register("spectate", "watch", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    const userId = ctx?.actor?.userId || null;
    try {
      return startSession(db, worldId, userId);
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Open a read-only spectator session on a world (persists a session + returns a WS hint)." });

  // ── spectate.my_positions ──────────────────────────────────────────────────
  // The caller's open + resolved positions (their bet history). Actor-gated.
  register("spectate", "my_positions", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    try {
      return { ok: true, positions: userPositions(db, userId) };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Caller's spectate bet positions (open + resolved)." });
}
