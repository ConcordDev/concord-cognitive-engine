// server/lib/real-estate-engine.js
//
// Phase II Wave 26 — property markets.
//
//   * purchaseBuilding — wallet debit + ownership flip + listing close
//   * listForSale — open a new listing at price
//   * delist — close active listing
//   * createRentalAgreement / dissolveRental / tickRentals — recurring
//     income transfer at next_due_at
//
// Wallet semantics: caller plugs a `debit(userId, amountCents, label)`
// and `credit(userId, amountCents, label)` pair. Default no-op
// implementations are useful for tests and dev where economy_ledger
// isn't wired.

import crypto from "node:crypto";

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function defaultDebit() { return { ok: true, simulated: true }; }
function defaultCredit() { return { ok: true, simulated: true }; }

/* ───────── Ownership + listings ────────────────────────────────────── */

export function listForSale(db, opts) {
  const buildingId = String(opts?.buildingId || "");
  const sellerUserId = String(opts?.sellerUserId || "");
  const priceCents = Math.max(0, Math.floor(Number(opts?.priceCents) || 0));
  if (!buildingId || !sellerUserId || !priceCents) return { ok: false, reason: "missing_inputs" };
  const b = db.prepare("SELECT owner_kind, owner_id FROM world_buildings WHERE id = ?").get(buildingId);
  if (!b) return { ok: false, reason: "building_not_found" };
  if (b.owner_kind !== "player" || b.owner_id !== sellerUserId) return { ok: false, reason: "not_owner" };
  // Close any prior active listing for this building
  db.prepare(`
    UPDATE property_listings SET delisted_at = unixepoch()
    WHERE building_id = ? AND delisted_at IS NULL AND sold_at IS NULL
  `).run(buildingId);
  const id = uid("listing");
  db.prepare(`
    INSERT INTO property_listings (id, building_id, seller_user_id, price_cents)
    VALUES (?, ?, ?, ?)
  `).run(id, buildingId, sellerUserId, priceCents);
  db.prepare(`
    UPDATE world_buildings SET for_sale_price_cents = ?, listed_at = unixepoch() WHERE id = ?
  `).run(priceCents, buildingId);
  return { ok: true, listingId: id, priceCents };
}

export function delist(db, listingId, sellerUserId) {
  const l = db.prepare("SELECT * FROM property_listings WHERE id = ?").get(listingId);
  if (!l) return { ok: false, reason: "listing_not_found" };
  if (l.seller_user_id !== sellerUserId) return { ok: false, reason: "not_seller" };
  if (l.delisted_at || l.sold_at) return { ok: false, reason: "already_closed" };
  db.prepare("UPDATE property_listings SET delisted_at = unixepoch() WHERE id = ?").run(listingId);
  db.prepare(`
    UPDATE world_buildings SET for_sale_price_cents = 0, listed_at = NULL WHERE id = ?
  `).run(l.building_id);
  return { ok: true };
}

export function listActiveListings(db, opts = {}) {
  const sql = opts.worldId
    ? `SELECT pl.*, b.world_id, b.archetype, b.pos_x, b.pos_z
       FROM property_listings pl
       JOIN world_buildings b ON b.id = pl.building_id
       WHERE pl.delisted_at IS NULL AND pl.sold_at IS NULL AND b.world_id = ?
       ORDER BY pl.listed_at DESC LIMIT 200`
    : `SELECT pl.*, b.world_id, b.archetype, b.pos_x, b.pos_z
       FROM property_listings pl
       JOIN world_buildings b ON b.id = pl.building_id
       WHERE pl.delisted_at IS NULL AND pl.sold_at IS NULL
       ORDER BY pl.listed_at DESC LIMIT 200`;
  return opts.worldId
    ? db.prepare(sql).all(opts.worldId)
    : db.prepare(sql).all();
}

export function purchaseBuilding(db, opts, wallet = {}) {
  const buyerUserId = String(opts?.buyerUserId || "");
  const listingId = String(opts?.listingId || "");
  if (!buyerUserId || !listingId) return { ok: false, reason: "missing_inputs" };
  const debit  = wallet.debit  || defaultDebit;
  const credit = wallet.credit || defaultCredit;
  const listing = db.prepare("SELECT * FROM property_listings WHERE id = ?").get(listingId);
  if (!listing) return { ok: false, reason: "listing_not_found" };
  if (listing.delisted_at || listing.sold_at) return { ok: false, reason: "listing_closed" };
  if (listing.seller_user_id === buyerUserId) return { ok: false, reason: "cannot_buy_own_listing" };

  const buyerDebit = debit(buyerUserId, listing.price_cents, `real_estate_purchase:${listingId}`);
  if (!buyerDebit?.ok) return { ok: false, reason: "wallet_debit_failed", reasonDetail: buyerDebit?.reason };
  const sellerCredit = credit(listing.seller_user_id, listing.price_cents, `real_estate_sale:${listingId}`);
  if (!sellerCredit?.ok) {
    // Best-effort rollback
    credit(buyerUserId, listing.price_cents, `real_estate_rollback:${listingId}`);
    return { ok: false, reason: "wallet_credit_failed" };
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE property_listings
         SET sold_at = unixepoch(), sold_to_user_id = ?, sold_price_cents = ?
       WHERE id = ?
    `).run(buyerUserId, listing.price_cents, listingId);
    db.prepare(`
      UPDATE world_buildings
         SET owner_kind = 'player', owner_id = ?, for_sale_price_cents = 0, listed_at = NULL
       WHERE id = ?
    `).run(buyerUserId, listing.building_id);
  });
  tx();
  return { ok: true, buildingId: listing.building_id, pricePaid: listing.price_cents };
}

export function listOwnedBuildings(db, userId) {
  return db.prepare(`
    SELECT id, world_id, archetype, pos_x, pos_z, deed_dtu_id,
           monthly_rent_cents, for_sale_price_cents, listed_at
    FROM world_buildings WHERE owner_kind = 'player' AND owner_id = ?
    ORDER BY id DESC LIMIT 200
  `).all(userId);
}

/* ───────── Rentals ─────────────────────────────────────────────────── */

export function createRentalAgreement(db, opts) {
  const buildingId = String(opts?.buildingId || "");
  const landlordUserId = String(opts?.landlordUserId || "");
  const tenantKind = String(opts?.tenantKind || "npc");
  const tenantId = String(opts?.tenantId || "");
  const rentCents = Math.max(0, Math.floor(Number(opts?.rentCents) || 0));
  const periodDays = Math.max(1, Math.min(365, Math.floor(Number(opts?.periodDays) || 30)));
  if (!buildingId || !landlordUserId || !tenantId || !rentCents) return { ok: false, reason: "missing_inputs" };
  const b = db.prepare("SELECT owner_kind, owner_id FROM world_buildings WHERE id = ?").get(buildingId);
  if (!b) return { ok: false, reason: "building_not_found" };
  if (b.owner_kind !== "player" || b.owner_id !== landlordUserId) return { ok: false, reason: "not_landlord" };
  const id = uid("rent");
  const now = Math.floor(Date.now() / 1000);
  const nextDue = now + periodDays * 86400;
  db.prepare(`
    INSERT INTO rental_agreements (id, building_id, landlord_user_id, tenant_kind, tenant_id, rent_cents, period_days, next_due_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, buildingId, landlordUserId, tenantKind, tenantId, rentCents, periodDays, nextDue);
  db.prepare(`UPDATE world_buildings SET monthly_rent_cents = ? WHERE id = ?`).run(rentCents, buildingId);
  return { ok: true, agreementId: id, nextDueAt: nextDue };
}

export function dissolveRental(db, agreementId, byUserId) {
  const a = db.prepare("SELECT * FROM rental_agreements WHERE id = ?").get(agreementId);
  if (!a) return { ok: false, reason: "agreement_not_found" };
  if (a.dissolved_at) return { ok: false, reason: "already_dissolved" };
  if (a.landlord_user_id !== byUserId && (a.tenant_kind !== "player" || a.tenant_id !== byUserId)) {
    return { ok: false, reason: "not_party_to_agreement" };
  }
  db.prepare("UPDATE rental_agreements SET dissolved_at = unixepoch() WHERE id = ?").run(agreementId);
  return { ok: true };
}

export function listMyRentals(db, userId, role = "landlord") {
  if (role === "landlord") {
    return db.prepare(`
      SELECT * FROM rental_agreements WHERE landlord_user_id = ? AND dissolved_at IS NULL ORDER BY next_due_at ASC
    `).all(userId);
  }
  return db.prepare(`
    SELECT * FROM rental_agreements WHERE tenant_kind = 'player' AND tenant_id = ? AND dissolved_at IS NULL ORDER BY next_due_at ASC
  `).all(userId);
}

/**
 * Tick due rentals. For each agreement past its next_due_at, charge
 * the tenant (debit wallet) and credit the landlord. Advance
 * next_due_at by period_days. If tenant wallet debit fails, the
 * landlord is not credited and the agreement is flagged for follow-up
 * (real implementation would record arrears; v1 just skips).
 */
export function tickRentals(db, wallet = {}) {
  const debit  = wallet.debit  || defaultDebit;
  const credit = wallet.credit || defaultCredit;
  const now = Math.floor(Date.now() / 1000);
  const due = db.prepare(`
    SELECT * FROM rental_agreements
    WHERE dissolved_at IS NULL AND next_due_at <= ?
    LIMIT 100
  `).all(now);
  const collected = [];
  const failed = [];
  for (const a of due) {
    // NPC tenants always pay (their wallet is virtual); player tenants
    // go through wallet.debit
    let debitOk = true;
    if (a.tenant_kind === "player") {
      const r = debit(a.tenant_id, a.rent_cents, `rent:${a.id}`);
      debitOk = !!r?.ok;
    }
    if (!debitOk) {
      failed.push({ agreementId: a.id, reason: "tenant_debit_failed" });
      continue;
    }
    credit(a.landlord_user_id, a.rent_cents, `rent_collected:${a.id}`);
    const nextDue = a.next_due_at + a.period_days * 86400;
    db.prepare(`
      UPDATE rental_agreements SET next_due_at = ?, last_paid_at = unixepoch() WHERE id = ?
    `).run(nextDue, a.id);
    collected.push({ agreementId: a.id, rentCents: a.rent_cents, landlord: a.landlord_user_id });
  }
  return { ok: true, collected: collected.length, failed: failed.length, details: { collected, failed } };
}

export const REAL_ESTATE_CONSTANTS = Object.freeze({
  DEFAULT_RENTAL_PERIOD_DAYS: 30,
});
