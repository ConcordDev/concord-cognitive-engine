// server/tests/wallet-rebuild-sprint-c.test.js
//
// Wallet lens Sprint C — concord moats: transaction-as-DTU receipt,
// creator tipping (Patreon-killer 0% fee), multi-rail routing, open-
// banking export.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerWalletRebuildMacros from "../domains/wallet-rebuild.js";
import registerWalletMoatsMacros, { rankRails } from "../domains/wallet-moats.js";
import { linkAccount, ingestTransaction, upsertBalance } from "../lib/wallet/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["243_wallet_rebuild", "244_wallet_ai", "245_wallet_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, creator_id TEXT, meta_json TEXT, created_at INTEGER DEFAULT (unixepoch()))`);
  registerWalletRebuildMacros(register);
  registerWalletMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── transaction_mint ────────────────────────────────────

describe("transaction_mint (portable receipt DTU)", () => {
  it("mints transaction as wallet_transaction DTU with denormed tax_year", async () => {
    const a = linkAccount(db, "u_mint", { nickname: "X", kind: "bank_checking" });
    const tx = ingestTransaction(db, "u_mint", {
      accountId: a.id, sourceProviderId: "p1", direction: "debit",
      amountCents: 4500, counterparty: "Coffee", category: "food.restaurants",
      occurredAt: Math.floor(new Date("2026-03-15T10:00:00Z").getTime() / 1000),
    });
    const r = await MACROS.get("transaction_mint")(ctx("u_mint"), { transactionId: tx.id });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("wallet_tx:"));
    assert.equal(r.taxYear, 2026);
    // Verify back-ref written
    const txRow = db.prepare(`SELECT receipt_dtu_id FROM wallet_transactions WHERE id = ?`).get(tx.id);
    assert.equal(txRow.receipt_dtu_id, r.dtuId);
  });

  it("re-mint returns alreadyMinted=true", async () => {
    const a = linkAccount(db, "u_remint", { nickname: "X", kind: "bank_checking" });
    const tx = ingestTransaction(db, "u_remint", { accountId: a.id, sourceProviderId: "x", direction: "debit", amountCents: 100, occurredAt: Math.floor(Date.now() / 1000) });
    const r1 = await MACROS.get("transaction_mint")(ctx("u_remint"), { transactionId: tx.id });
    const r2 = await MACROS.get("transaction_mint")(ctx("u_remint"), { transactionId: tx.id });
    assert.equal(r2.alreadyMinted, true);
    assert.equal(r2.dtuId, r1.dtuId);
  });

  it("cross-user mint refused", async () => {
    const a = linkAccount(db, "u_owner_m", { nickname: "X", kind: "bank_checking" });
    const tx = ingestTransaction(db, "u_owner_m", { accountId: a.id, sourceProviderId: "y", direction: "debit", amountCents: 100, occurredAt: Math.floor(Date.now() / 1000) });
    const r = await MACROS.get("transaction_mint")(ctx("u_thief_m"), { transactionId: tx.id });
    assert.equal(r.reason, "not_found");
  });

  it("transaction_mints_list filterable by tax_year", async () => {
    const a = linkAccount(db, "u_lst", { nickname: "X", kind: "bank_checking" });
    const tx2025 = ingestTransaction(db, "u_lst", { accountId: a.id, sourceProviderId: "y25", direction: "debit", amountCents: 100, occurredAt: Math.floor(new Date("2025-06-01").getTime() / 1000) });
    const tx2026 = ingestTransaction(db, "u_lst", { accountId: a.id, sourceProviderId: "y26", direction: "debit", amountCents: 100, occurredAt: Math.floor(new Date("2026-06-01").getTime() / 1000) });
    await MACROS.get("transaction_mint")(ctx("u_lst"), { transactionId: tx2025.id });
    await MACROS.get("transaction_mint")(ctx("u_lst"), { transactionId: tx2026.id });
    const r = await MACROS.get("transaction_mints_list")(ctx("u_lst"), { taxYear: 2026 });
    assert.equal(r.mints.length, 1);
    assert.equal(r.mints[0].tax_year, 2026);
  });
});

// ─── creator_tip (Patreon-killer pricing) ────────────────

describe("creator_tip (0% Concord moat)", () => {
  it("Concord Coin internal tip: 0% platform AND 0% processing, instant settlement", async () => {
    const r = await MACROS.get("creator_tip")(ctx("u_tipper"), {
      recipientUserId: "u_creator", amountCents: 500, rail: "concord_coin",
      message: "for the new track",
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "paid");  // instant
    assert.equal(r.platformFeeCents, 0);  // moat
    assert.equal(r.processingFeeCents, 0);  // internal ledger
    assert.equal(r.netToRecipientCents, 500);  // 100% to creator
    assert.ok(r.moatNote.includes("Patreon"));
    // Verify both sides got wallet_transactions
    const debit = db.prepare(`SELECT * FROM wallet_transactions WHERE source_provider_id = ?`).get(`tip:${r.id}:out`);
    const credit = db.prepare(`SELECT * FROM wallet_transactions WHERE source_provider_id = ?`).get(`tip:${r.id}:in`);
    assert.ok(debit);
    assert.ok(credit);
    assert.equal(debit.direction, "debit");
    assert.equal(debit.owner_user_id, "u_tipper");
    assert.equal(credit.direction, "credit");
    assert.equal(credit.owner_user_id, "u_creator");
    assert.equal(credit.category, "income.creator");
  });

  it("external rail (stripe_card) charges processing but ZERO Concord platform fee", async () => {
    const r = await MACROS.get("creator_tip")(ctx("u_t2"), {
      recipientUserId: "u_c2", amountCents: 10000, rail: "stripe_card",
    });
    assert.equal(r.ok, true);
    assert.equal(r.platformFeeCents, 0);  // STILL 0% Concord platform
    // Stripe: 2.9% + $0.30 = 290 + 30 = 320c
    assert.equal(r.processingFeeCents, 320);
    assert.equal(r.netToRecipientCents, 10000 - 320);
    assert.equal(r.status, "pending");  // external rail
  });

  it("self-tip rejected", async () => {
    const r = await MACROS.get("creator_tip")(ctx("u_self"), { recipientUserId: "u_self", amountCents: 100 });
    assert.equal(r.reason, "cannot_tip_self");
  });

  it("invalid rail rejected", async () => {
    const r = await MACROS.get("creator_tip")(ctx("u_t_bad"), { recipientUserId: "u_c", amountCents: 100, rail: "bitcoin_lightning" });
    assert.equal(r.reason, "invalid_rail");
  });

  it("cite content fires royalty cascade (graceful when engine absent)", async () => {
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:song:abc', 'music_track', 'Song', 'u_creator_cite', '{}')`).run();
    const r = await MACROS.get("creator_tip")(ctx("u_cite_t"), {
      recipientUserId: "u_creator_cite", amountCents: 200,
      citedContentDtuId: "dtu:song:abc", citedContentKind: "music_track",
    });
    assert.equal(r.ok, true);
    assert.ok(r.cascade !== undefined);
  });

  it("tips_received + tips_sent listings", async () => {
    await MACROS.get("creator_tip")(ctx("u_sender_x"), { recipientUserId: "u_recip_x", amountCents: 300 });
    const sent = await MACROS.get("creator_tips_sent")(ctx("u_sender_x"));
    assert.ok(sent.tips.find((t) => t.recipient_user_id === "u_recip_x"));
    const received = await MACROS.get("creator_tips_received")(ctx("u_recip_x"));
    assert.ok(received.tips.find((t) => t.tipper_user_id === "u_sender_x"));
  });
});

// ─── Multi-rail routing ──────────────────────────────────

describe("rankRails", () => {
  it("Concord Coin wins on score when preferring speed (0 fee + 0 ETA)", () => {
    const r = rankRails(100000, { preferSpeedOverCost: true });
    assert.equal(r[0].rail, "concord_coin");
    assert.equal(r[0].fee_cents, 0);
    assert.equal(r[0].eta_seconds, 0);
  });

  it("filters by allowedRails", () => {
    const r = rankRails(100000, { allowedRails: ["usd_ach", "stripe_card"] });
    assert.equal(r.length, 2);
    assert.ok(r.every((c) => ["usd_ach", "stripe_card"].includes(c.rail)));
  });

  it("filters by maxFeeCents budget", () => {
    const r = rankRails(100000, { maxFeeCents: 100 });
    // stripe_card = 2900 + 30 = 2930c — should be filtered out
    assert.ok(!r.find((c) => c.rail === "stripe_card"));
  });

  it("Stripe card fee math = 2.9% + $0.30", () => {
    const r = rankRails(10000, { allowedRails: ["stripe_card"] });
    assert.equal(r[0].fee_cents, 320);  // 290 (2.9% of 10000) + 30
  });

  it("FedNow fee math = 5c flat", () => {
    const r = rankRails(50000, { allowedRails: ["usd_fednow"] });
    assert.equal(r[0].fee_cents, 5);
  });
});

describe("rails_route_simulate macro", () => {
  it("Concord-user destination picks concord_coin", async () => {
    const r = await MACROS.get("rails_route_simulate")(ctx("u_rr"), {
      amountCents: 5000, destinationKind: "concord_user",
    });
    assert.equal(r.ok, true);
    assert.equal(r.selected.rail, "concord_coin");
    assert.ok(r.reasoning.includes("Concord"));
  });

  it("crypto_address destination is USDC-only", async () => {
    const r = await MACROS.get("rails_route_simulate")(ctx("u_crypto"), {
      amountCents: 10000, destinationKind: "crypto_address",
    });
    assert.equal(r.selected.rail, "usdc");
  });

  it("external bank prefers FedNow (instant + cheap) when speed mode", async () => {
    const r = await MACROS.get("rails_route_simulate")(ctx("u_bank"), {
      amountCents: 5000, destinationKind: "external_bank",
    });
    assert.equal(r.ok, true);
    // Speed-prefer = FedNow wins (5c + 30s) over ACH (0c + 2 days)
    assert.equal(r.selected.rail, "usd_fednow");
  });

  it("rails_routes_recent returns persisted decisions", async () => {
    await MACROS.get("rails_route_simulate")(ctx("u_rrlist"), { amountCents: 1000, destinationKind: "concord_user" });
    const r = await MACROS.get("rails_routes_recent")(ctx("u_rrlist"));
    assert.ok(r.routes.length >= 1);
    assert.ok(Array.isArray(r.routes[0].candidates));
  });
});

// ─── Export bundles ──────────────────────────────────────

describe("export_bundle (open-banking)", () => {
  it("CSV format produces header + per-tx lines", async () => {
    const a = linkAccount(db, "u_csv", { nickname: "X", kind: "bank_checking" });
    ingestTransaction(db, "u_csv", { accountId: a.id, sourceProviderId: "c1", direction: "debit", amountCents: 1500, counterparty: "Test Shop", category: "shopping", occurredAt: Math.floor(Date.now() / 1000) });
    const r = await MACROS.get("export_bundle")(ctx("u_csv"), { format: "csv", scopeKind: "all" });
    assert.equal(r.ok, true);
    assert.equal(r.format, "csv");
    assert.ok(r.payload.includes("id,date,direction,amount_cents"));
    assert.ok(r.payload.includes("Test Shop"));
  });

  it("OFX format produces valid wrapper with STMTTRN entries", async () => {
    const a = linkAccount(db, "u_ofx", { nickname: "X", kind: "bank_checking" });
    ingestTransaction(db, "u_ofx", { accountId: a.id, sourceProviderId: "o1", direction: "debit", amountCents: 9999, counterparty: "OFX Test", occurredAt: Math.floor(Date.now() / 1000) });
    const r = await MACROS.get("export_bundle")(ctx("u_ofx"), { format: "ofx", scopeKind: "all" });
    assert.ok(r.payload.includes("<OFX>"));
    assert.ok(r.payload.includes("STMTTRN"));
    assert.ok(r.payload.includes("OFX Test"));
    assert.ok(r.payload.includes("DEBIT"));
  });

  it("QIF format produces ^-terminated entries", async () => {
    const a = linkAccount(db, "u_qif", { nickname: "X", kind: "bank_checking" });
    ingestTransaction(db, "u_qif", { accountId: a.id, sourceProviderId: "q1", direction: "credit", amountCents: 5000, counterparty: "QIF Test", occurredAt: Math.floor(Date.now() / 1000) });
    const r = await MACROS.get("export_bundle")(ctx("u_qif"), { format: "qif", scopeKind: "all" });
    assert.ok(r.payload.startsWith("!Type:Bank"));
    assert.ok(r.payload.includes("^"));
  });

  it("concord_dtu_pack includes accounts + transactions + recurring", async () => {
    const a = linkAccount(db, "u_pack", { nickname: "X", kind: "bank_checking" });
    ingestTransaction(db, "u_pack", { accountId: a.id, sourceProviderId: "pk1", direction: "debit", amountCents: 100, occurredAt: Math.floor(Date.now() / 1000) });
    const r = await MACROS.get("export_bundle")(ctx("u_pack"), { format: "concord_dtu_pack", scopeKind: "all" });
    const parsed = JSON.parse(r.payload);
    assert.equal(parsed.spec, "concord-wallet-pack/v1");
    assert.ok(Array.isArray(parsed.accounts));
    assert.ok(Array.isArray(parsed.transactions));
  });

  it("tax_year scope filters to one year", async () => {
    const a = linkAccount(db, "u_ty", { nickname: "X", kind: "bank_checking" });
    const t2025 = Math.floor(new Date("2025-06-01").getTime() / 1000);
    const t2026 = Math.floor(new Date("2026-06-01").getTime() / 1000);
    ingestTransaction(db, "u_ty", { accountId: a.id, sourceProviderId: "ty25", direction: "debit", amountCents: 100, occurredAt: t2025 });
    ingestTransaction(db, "u_ty", { accountId: a.id, sourceProviderId: "ty26", direction: "debit", amountCents: 200, occurredAt: t2026 });
    const r = await MACROS.get("export_bundle")(ctx("u_ty"), { format: "json", scopeKind: "tax_year", taxYear: 2026 });
    assert.equal(r.recordCount, 1);
  });

  it("export_bundles_list omits payload + bundle_get returns it", async () => {
    const a = linkAccount(db, "u_get", { nickname: "X", kind: "bank_checking" });
    ingestTransaction(db, "u_get", { accountId: a.id, sourceProviderId: "g1", direction: "debit", amountCents: 100, occurredAt: Math.floor(Date.now() / 1000) });
    const exp = await MACROS.get("export_bundle")(ctx("u_get"), { format: "csv" });
    const list = await MACROS.get("export_bundles_list")(ctx("u_get"));
    const inList = list.bundles.find((b) => b.id === exp.id);
    assert.ok(inList);
    assert.equal(inList.payload, undefined);  // omitted from list
    const fetched = await MACROS.get("export_bundle_get")(ctx("u_get"), { id: exp.id });
    assert.ok(fetched.bundle.payload.includes("id,date,direction"));
  });
});
