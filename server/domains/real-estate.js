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
}
