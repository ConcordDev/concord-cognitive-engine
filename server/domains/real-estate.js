// server/domains/real-estate.js
//
// Phase II Wave 26 — building ownership / property markets / rentals.

import {
  listForSale,
  delist,
  listActiveListings,
  purchaseBuilding,
  listOwnedBuildings,
  createRentalAgreement,
  dissolveRental,
  listMyRentals,
  tickRentals,
  REAL_ESTATE_CONSTANTS,
} from "../lib/real-estate-engine.js";
import { registerHeartbeat } from "../emergent/heartbeat-registry.js";

// Wallet adapter — when the economy_ledger module is available we use
// mintCoins / debitCoins; otherwise fall back to default no-op so the
// substrate still tests cleanly without the full economy stack.
async function loadWallet() {
  try {
    // economy_ledger is the existing module; we use the same refId
    // convention as world-events.endEvent for ledger idempotency.
    const mod = await import("../economy/wallet.js").catch(() => null);
    if (mod?.mintCoins && mod?.debitCoins) {
      return {
        debit: (userId, amountCents, label) => mod.debitCoins({ userId, amount: amountCents, refId: label }),
        credit: (userId, amountCents, label) => mod.mintCoins({ userId, amount: amountCents, refId: label }),
      };
    }
  } catch {
    /* fall through */
  }
  return {};
}

// ── Automatic rent collection sweep (Wave 4 gap-closure) ──────────────
// Honest scope: before this, `real_estate.tick_rentals` (the macro that
// wraps `tickRentals` above) was only ever invoked by the frontend's
// manual "Collect due rent" button (WorldPropertiesPanel.tsx) — see
// docs/WAVE4_INVENTORY.md's realestate row and
// docs/lens-specs/realestate-capability-map.md's "Left alone, with
// reason" section ("no `registerHeartbeat` wires it to run on a
// schedule, so rent is never collected automatically"). This closes that
// ENGINEERING gap the same way `productivity.js`'s
// "productivity-reminder-sweep" heartbeat closed its own no-schedule
// gap: a self-registering heartbeat that lives in the domain file
// itself, calling the exact same `tickRentals` used by the manual
// button — never a simulated/fabricated collection pass.
//
// Cadence: frequency 240 on the 15s governor tick (server.js) = ~1h.
// `createRentalAgreement` clamps `periodDays` to [1, 365]
// (real-estate-engine.js#createRentalAgreement), so the shortest
// possible lease period is one day (86400s) — an hourly sweep bounds
// rent-collection staleness to well under 5% of even the tightest
// lease's period, while `tickRentals`'s own query
// (`next_due_at <= now LIMIT 100`) is a cheap indexed-range SELECT that
// is a true no-op (0 rows) on the overwhelmingly common tick where
// nothing is due — so there's no meaningful cost to running it far more
// often than rent periods actually change. This matches the existing
// day-granularity heartbeat precedent in this codebase (e.g.
// `hook-decay-sweep` / `land-claims-cycle` at the same ~1h cadence for
// similarly slow-moving, wallet-touching maintenance sweeps) rather than
// the sub-minute cadence used for realtime UI-facing sweeps like
// `productivity-reminder-sweep`.
//
// scope: 'global' — `tickRentals` writes through `wallet.debit`/
// `wallet.credit` into `economy_ledger` (a USER-GLOBAL table per
// CLAUDE.md's "DB write-ownership rules"), and its own query has no
// per-world filter (a landlord/tenant pair can legitimately span
// buildings from any world), so this must run on the parent process
// rather than inside a per-world shard.
//
// db acquisition: the handler receives `{ db }` from `tickAllRegistered`'s
// `moduleCtx` (`server/emergent/heartbeat-registry.js:133` — `{ state:
// ctx.state, db: ctx.db, tickCount, reason }`, itself sourced from
// server.js's top-level `db` handle at the governorTick call site,
// `server.js:35688-35710`) — the same live sqlite handle every other
// heartbeat module receives (see `server/emergent/world-boss-cycle.js#
// runWorldBossCycle({ db })` for the precedent of a heartbeat consuming
// `ctx.db` directly rather than importing its own connection). Wallet:
// reuses this file's existing `loadWallet()` helper (used by the
// `purchase` and `tick_rentals` macros above) so the sweep debits/
// credits through the exact same `economy/wallet.js`
// mintCoins/debitCoins path a manual collection uses — never a parallel
// or simulated ledger write.
//
// Kill-switch: CONCORD_REALESTATE_RENT_SWEEP=0.
//
// Per CLAUDE.md's "heartbeat modules must never throw" invariant, the
// whole handler body is try/caught HERE (a named, exported function, so
// tests can invoke it directly and prove the try/catch is real) IN
// ADDITION to the registry's own per-module try/catch
// (server/emergent/heartbeat-registry.js#_runOne) — belt-and-suspenders
// so a thrown error from `tickRentals`, `loadWallet`, or a malformed `db`
// never escapes this handler.
export async function runRealEstateRentCollectionSweep({ db } = {}) {
  try {
    if (process.env.CONCORD_REALESTATE_RENT_SWEEP === "0") {
      return { ok: true, skipped: "disabled" };
    }
    if (!db) return { ok: true, skipped: "no_db" };
    const wallet = await loadWallet();
    const result = tickRentals(db, wallet);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, reason: "rent_sweep_failed", error: String(err?.message || err) };
  }
}

export default function registerRealEstateMacros(register) {
  register("real_estate", "list_for_sale", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return listForSale(db, {
      buildingId: input?.buildingId,
      sellerUserId: userId,
      priceCents: input?.priceCents,
    });
  });

  register("real_estate", "delist", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return delist(db, String(input?.listingId || ""), userId);
  });

  register("real_estate", "active_listings", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, listings: listActiveListings(db, { worldId: input?.worldId }) };
  });

  register("real_estate", "purchase", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const wallet = await loadWallet();
    return purchaseBuilding(db, { buyerUserId: userId, listingId: input?.listingId }, wallet);
  });

  register("real_estate", "owned", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, buildings: listOwnedBuildings(db, userId) };
  });

  register("real_estate", "lease", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return createRentalAgreement(db, {
      buildingId: input?.buildingId,
      landlordUserId: userId,
      tenantKind: input?.tenantKind,
      tenantId: input?.tenantId,
      rentCents: input?.rentCents,
      periodDays: input?.periodDays,
    });
  });

  register("real_estate", "dissolve_lease", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return dissolveRental(db, String(input?.agreementId || ""), userId);
  });

  register("real_estate", "my_rentals", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, rentals: listMyRentals(db, userId, input?.role || "landlord") };
  });

  register("real_estate", "tick_rentals", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const wallet = await loadWallet();
    return tickRentals(db, wallet);
  });

  register("real_estate", "constants", async () => {
    return { ok: true, constants: REAL_ESTATE_CONSTANTS };
  });

  // Self-registering, module-level side effect of this domain's macro
  // registration running (same pattern as productivity.js's
  // "productivity-reminder-sweep") — see `runRealEstateRentCollectionSweep`
  // above for the full reasoning (cadence, scope, db/wallet acquisition,
  // kill-switch).
  registerHeartbeat("real-estate-rent-collection", {
    frequency: 240,
    scope: "global",
    handler: runRealEstateRentCollectionSweep,
  });
}
