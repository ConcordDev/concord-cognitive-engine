// server/domains/wallet-moats.js
//
// Wallet lens Sprint C — concord-native moats. Each macro maps to a
// specific industry precedent (see docs/LENS_RESEARCH_NOTES.md):
//
//   transaction_mint            per-transaction DTU receipt — portable
//                                tax record. (cite cascade ready)
//   creator_tip                 0% platform fee + 0% processing on
//                                Concord Coin internal tips. Patreon
//                                takes 10% + 2.9% processing; Ko-fi
//                                0%/5%; BMC 5% flat. Concord moat.
//   rails_route_simulate        Plaid-style intelligent multi-rail
//                                routing (ACH/FedNow/RTP/concord-coin/
//                                USDC). Picks fastest at config'd budget.
//   export_bundle               Open-banking-style portable export
//                                (concord_dtu_pack / OFX / CSV / QIF /
//                                JSON). User owns their data.

import { randomUUID } from "node:crypto";
import { getRailsConfig, listAccounts, listTransactions, listRecurring, ingestTransaction } from "../lib/wallet/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _ensureDtuRow(db, { id, kind, title, creatorId, meta }) {
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, kind, String(title).slice(0, 200), creatorId, JSON.stringify(meta || {}));
  } catch { /* dtus may not exist in some test envs */ }
}

// ─── Rail catalog (research-grounded) ──────────────────────
// Per-rail typical fee + ETA. Concord Coin is internal so 0 fee + instant.
// USD ACH = free but 1-3 days. FedNow = ~$0.045 + instant. RTP = ~$0.50 +
// instant. Stripe card = 2.9% + $0.30 + instant. USDC on-chain = gas
// (~$0.01-0.50 on L2) + ~30s confirm. Same Day ACH = $0-1 + same business day.

const RAIL_CATALOG = {
  concord_coin: { fee_basis: "fixed_cents", fee_fixed_cents: 0, fee_pct: 0, eta_seconds: 0, name: "Concord Coin internal" },
  usd_ach: { fee_basis: "fixed_cents", fee_fixed_cents: 0, fee_pct: 0, eta_seconds: 2 * 86400, name: "Standard ACH" },
  same_day_ach: { fee_basis: "fixed_cents", fee_fixed_cents: 100, fee_pct: 0, eta_seconds: 8 * 3600, name: "Same Day ACH" },
  usd_fednow: { fee_basis: "fixed_cents", fee_fixed_cents: 5, fee_pct: 0, eta_seconds: 30, name: "FedNow Instant" },
  usd_rtp: { fee_basis: "fixed_cents", fee_fixed_cents: 50, fee_pct: 0, eta_seconds: 30, name: "RTP Instant" },
  stripe_card: { fee_basis: "pct_plus_fixed", fee_fixed_cents: 30, fee_pct: 0.029, eta_seconds: 60, name: "Stripe Card" },
  usdc: { fee_basis: "pct_plus_fixed", fee_fixed_cents: 5, fee_pct: 0, eta_seconds: 60, name: "USDC stablecoin" },
};

export function rankRails(amountCents, { allowedRails = null, preferSpeedOverCost = true, maxFeeCents = null } = {}) {
  const out = [];
  for (const [rail, spec] of Object.entries(RAIL_CATALOG)) {
    if (allowedRails && !allowedRails.includes(rail)) continue;
    const fee = spec.fee_basis === "pct_plus_fixed"
      ? Math.floor(amountCents * spec.fee_pct + spec.fee_fixed_cents)
      : spec.fee_fixed_cents;
    if (maxFeeCents != null && fee > maxFeeCents) continue;
    // Score: lower is better. Weight ETA by ~1 cent per second when speed-prefer; 0.1 c/s when cost-prefer.
    const etaWeight = preferSpeedOverCost ? 1 : 0.1;
    const score = fee + spec.eta_seconds * etaWeight;
    out.push({ rail, fee_cents: fee, eta_seconds: spec.eta_seconds, name: spec.name, score: Math.round(score * 100) / 100 });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

export default function registerWalletMoatsMacros(register) {

  // ─── Transaction-as-DTU receipt mint ─────────────────────

  register("wallet", "transaction_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const txId = String(input.transactionId || input.id || "");
    const tx = db.prepare(`SELECT * FROM wallet_transactions WHERE id = ? AND owner_user_id = ?`).get(txId, userId);
    if (!tx) return { ok: false, reason: "not_found" };
    const existing = db.prepare(`SELECT dtu_id FROM wallet_transaction_mints WHERE transaction_id = ?`).get(txId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };
    const visibility = ["private","workspace","public"].includes(input.visibility) ? input.visibility : "private";
    const taxYear = input.taxYear ? Number(input.taxYear) : new Date(tx.occurred_at * 1000).getUTCFullYear();
    const dtuId = `wallet_tx:${randomUUID()}`;
    const title = `${tx.direction === "credit" ? "+" : "-"}$${(tx.amount_cents / 100).toFixed(2)} ${tx.counterparty || "transaction"}`;
    try {
      const txDb = db.transaction(() => {
        _ensureDtuRow(db, {
          id: dtuId, kind: "wallet_transaction", title,
          creatorId: userId,
          meta: {
            type: "wallet_transaction",
            transaction_id: tx.id, account_id: tx.account_id,
            direction: tx.direction, amount_cents: tx.amount_cents, currency: tx.currency,
            counterparty: tx.counterparty, category: tx.category,
            occurred_at: tx.occurred_at, tax_year: taxYear,
            visibility,
          },
        });
        db.prepare(`
          INSERT INTO wallet_transaction_mints (transaction_id, dtu_id, creator_id, visibility, tax_year, minted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(txId, dtuId, userId, visibility, taxYear, _now());
        db.prepare(`UPDATE wallet_transactions SET receipt_dtu_id = ? WHERE id = ?`).run(dtuId, txId);
      });
      txDb();
      return { ok: true, dtuId, taxYear };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a transaction as portable receipt DTU. Owner-only. tax_year denormed for tax-prep queries." });

  register("wallet", "transaction_mints_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taxYear = input.taxYear ? Number(input.taxYear) : null;
    const sql = taxYear
      ? `SELECT * FROM wallet_transaction_mints WHERE creator_id = ? AND tax_year = ? ORDER BY minted_at DESC`
      : `SELECT * FROM wallet_transaction_mints WHERE creator_id = ? ORDER BY minted_at DESC LIMIT 200`;
    const rows = taxYear ? db.prepare(sql).all(userId, taxYear) : db.prepare(sql).all(userId);
    return { ok: true, mints: rows };
  }, { note: "List minted transaction receipts (filter by tax_year for prep)" });

  // ─── Creator tip (Patreon-killer pricing) ────────────────

  register("wallet", "creator_tip", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const recipientUserId = String(input.recipientUserId || "");
    const amountCents = Math.floor(Number(input.amountCents));
    const rail = input.rail || "concord_coin";
    if (!recipientUserId || !amountCents || amountCents <= 0) return { ok: false, reason: "recipientUserId_and_positive_amountCents_required" };
    if (recipientUserId === userId) return { ok: false, reason: "cannot_tip_self" };
    if (!Object.keys(RAIL_CATALOG).includes(rail)) return { ok: false, reason: "invalid_rail" };

    // CONCORD MOAT pricing:
    //   concord_coin (internal): 0% platform + 0% processing
    //   external rails: 0% Concord platform fee; provider processing applies
    const platformFeeCents = 0;  // Concord never takes a cut. Ever.
    const railSpec = RAIL_CATALOG[rail];
    const processingFeeCents = railSpec.fee_basis === "pct_plus_fixed"
      ? Math.floor(amountCents * railSpec.fee_pct + railSpec.fee_fixed_cents)
      : railSpec.fee_fixed_cents;

    const id = `wct:${randomUUID()}`;
    const status = rail === "concord_coin" ? "paid" : "pending";  // Concord Coin settles instantly
    const now = _now();
    let transactionId = null;

    try {
      const txDb = db.transaction(() => {
        db.prepare(`
          INSERT INTO wallet_creator_tips (id, tipper_user_id, recipient_user_id, amount_cents, currency, rail, platform_fee_cents, processing_fee_cents, cited_content_dtu_id, cited_content_kind, message, anonymous, status, created_at, paid_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, userId, recipientUserId, amountCents,
          rail === "concord_coin" ? "concord_coin" : "USD",
          rail, platformFeeCents, processingFeeCents,
          input.citedContentDtuId || null, input.citedContentKind || null,
          input.message ? String(input.message).slice(0, 500) : null,
          input.anonymous ? 1 : 0,
          status, now,
          status === "paid" ? now : null);

        // For Concord Coin internal tips, write the matching wallet_transactions entry
        // immediately on both sides (debit tipper, credit recipient).
        if (rail === "concord_coin") {
          // Find / lazy-create both sides' concord_coin accounts
          let tipperAcc = db.prepare(`SELECT id FROM wallet_accounts WHERE owner_user_id = ? AND kind = 'concord_coin' AND removed_at IS NULL`).get(userId);
          if (!tipperAcc) {
            const newId = `wacc:${randomUUID()}`;
            db.prepare(`INSERT INTO wallet_accounts (id, owner_user_id, nickname, kind, currency, status, readonly, created_at, updated_at) VALUES (?, ?, ?, 'concord_coin', 'concord_coin', 'active', 1, ?, ?)`).run(newId, userId, "Concord Coin", now, now);
            tipperAcc = { id: newId };
          }
          let recipAcc = db.prepare(`SELECT id FROM wallet_accounts WHERE owner_user_id = ? AND kind = 'concord_coin' AND removed_at IS NULL`).get(recipientUserId);
          if (!recipAcc) {
            const newId = `wacc:${randomUUID()}`;
            db.prepare(`INSERT INTO wallet_accounts (id, owner_user_id, nickname, kind, currency, status, readonly, created_at, updated_at) VALUES (?, ?, ?, 'concord_coin', 'concord_coin', 'active', 1, ?, ?)`).run(newId, recipientUserId, "Concord Coin", now, now);
            recipAcc = { id: newId };
          }
          // Debit tipper
          const debitTxId = `wtx:${randomUUID()}`;
          db.prepare(`INSERT INTO wallet_transactions (id, owner_user_id, account_id, source_provider_id, direction, amount_cents, currency, counterparty, counterparty_kind, category, memo, occurred_at, posted_at, status, created_at) VALUES (?, ?, ?, ?, 'debit', ?, 'concord_coin', ?, 'creator', 'tip', ?, ?, ?, 'posted', ?)`)
            .run(debitTxId, userId, tipperAcc.id, `tip:${id}:out`, amountCents, "Tip to creator", `Tip via ${id}`, now, now, now);
          // Credit recipient
          const creditTxId = `wtx:${randomUUID()}`;
          db.prepare(`INSERT INTO wallet_transactions (id, owner_user_id, account_id, source_provider_id, direction, amount_cents, currency, counterparty, counterparty_kind, category, memo, occurred_at, posted_at, status, created_at) VALUES (?, ?, ?, ?, 'credit', ?, 'concord_coin', ?, 'person', 'income.creator', 'tip', ?, ?, 'posted', ?)`)
            .run(creditTxId, recipientUserId, recipAcc.id, `tip:${id}:in`, amountCents, input.anonymous ? "Anonymous tipper" : userId, now, now, now);
          transactionId = debitTxId;
          db.prepare(`UPDATE wallet_creator_tips SET transaction_id = ? WHERE id = ?`).run(debitTxId, id);
        }
      });
      txDb();

      // Fire royalty cascade if the tip cites a content DTU
      let cascade = null;
      if (input.citedContentDtuId) {
        try {
          const { registerCitation } = await import("../economy/royalty-cascade.js");
          const parent = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(input.citedContentDtuId);
          if (parent) {
            cascade = registerCitation(db, {
              childId: id, parentId: parent.id,
              creatorId: userId, parentCreatorId: parent.creator_id,
              parentDtu: { id: parent.id, creator_id: parent.creator_id, visibility: "public" },
              generation: 1,
            });
          }
        } catch (err) { cascade = { ok: false, reason: "engine_unavailable", error: err?.message }; }
      }
      return {
        ok: true, id, status,
        amountCents,
        platformFeeCents, processingFeeCents,
        netToRecipientCents: amountCents - processingFeeCents,
        rail, railName: railSpec.name,
        transactionId, cascade,
        moatNote: rail === "concord_coin"
          ? "0% platform fee + 0% processing — Concord moat. Patreon = 10% + 2.9% processing."
          : "0% Concord platform fee. Provider processing fee applies (external rail).",
      };
    } catch (err) {
      return { ok: false, reason: "tip_failed", error: err?.message };
    }
  }, { destructive: true, note: "Tip a creator. Concord platform fee is ALWAYS 0% (the moat — Patreon 10%, Ko-fi 5% memberships, BMC 5%). Internal Concord Coin tips also have 0% processing (instant settlement). External rails (USD/USDC/card) have processing fee per RAIL_CATALOG. Cite cascade fires if citedContentDtuId provided." });

  register("wallet", "creator_tips_received", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 500);
    const rows = db.prepare(`SELECT * FROM wallet_creator_tips WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
    return { ok: true, tips: rows };
  }, { note: "Tips I've received as a creator" });

  register("wallet", "creator_tips_sent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 500);
    const rows = db.prepare(`SELECT * FROM wallet_creator_tips WHERE tipper_user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
    return { ok: true, tips: rows };
  }, { note: "Tips I've sent to creators" });

  // ─── Multi-rail routing simulation ───────────────────────

  register("wallet", "rails_route_simulate", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const amountCents = Math.floor(Number(input.amountCents));
    if (!amountCents || amountCents <= 0) return { ok: false, reason: "positive_amountCents_required" };
    const destKind = input.destinationKind || "concord_user";
    if (!["concord_user","external_bank","crypto_address","merchant","provider"].includes(destKind)) return { ok: false, reason: "invalid_destinationKind" };
    // Allowed rails depend on destination
    const allowedByDestination = {
      concord_user: ["concord_coin","usd_ach","usd_fednow","usd_rtp","stripe_card"],
      external_bank: ["usd_ach","same_day_ach","usd_fednow","usd_rtp"],
      crypto_address: ["usdc"],
      merchant: ["stripe_card","usd_ach","usdc"],
      provider: ["usd_ach","same_day_ach","stripe_card"],
    };
    const cfg = getRailsConfig(db, userId);
    const candidates = rankRails(amountCents, {
      allowedRails: allowedByDestination[destKind],
      preferSpeedOverCost: !!cfg.prefer_speed_over_cost,
      maxFeeCents: null,
    });
    if (candidates.length === 0) return { ok: true, candidates: [], selected: null, reason: "no_rails_available" };
    const selected = candidates[0];
    const id = `wrr:${randomUUID()}`;
    const reasoning = `Selected ${selected.rail} (${selected.name}): fee ${selected.fee_cents}c, ETA ${selected.eta_seconds}s. Preference: ${cfg.prefer_speed_over_cost ? "speed" : "cost"}.`;
    db.prepare(`
      INSERT INTO wallet_rail_routes (id, owner_user_id, destination_kind, destination_ref, amount_cents, currency, candidates_json, selected_rail, selected_fee_cents, selected_eta_seconds, reasoning, executed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, userId, destKind, input.destinationRef || null,
      amountCents, input.currency || "USD",
      JSON.stringify(candidates), selected.rail,
      selected.fee_cents, selected.eta_seconds, reasoning, _now());
    return { ok: true, id, selected, candidates, reasoning };
  }, { note: "Plaid-style intelligent routing: rank available rails by user's speed-vs-cost preference. Returns selected rail + ranked candidates + reasoning. Persists to wallet_rail_routes (executed=0 until commit)." });

  register("wallet", "rails_routes_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = db.prepare(`SELECT * FROM wallet_rail_routes WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 50`).all(userId);
    return { ok: true, routes: rows.map((r) => ({ ...r, candidates: _safeJson(r.candidates_json, []) })) };
  }, { note: "Recent multi-rail routing decisions" });

  // ─── Open-banking export ─────────────────────────────────

  register("wallet", "export_bundle", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const format = ["concord_dtu_pack","ofx","csv","qif","json"].includes(input.format) ? input.format : "json";
    const scopeKind = ["all","date_range","single_account","tax_year","category"].includes(input.scopeKind) ? input.scopeKind : "all";
    // Determine query parameters
    let txs;
    let scope = {};
    if (scopeKind === "date_range") {
      const start = Number(input.startTs);
      const end = Number(input.endTs);
      scope = { startTs: start, endTs: end };
      txs = listTransactions(db, userId, { sinceTs: start, untilTs: end, limit: 5000 });
    } else if (scopeKind === "single_account") {
      const accountId = String(input.accountId || "");
      scope = { accountId };
      txs = listTransactions(db, userId, { accountId, limit: 5000 });
    } else if (scopeKind === "tax_year") {
      const taxYear = Number(input.taxYear) || new Date().getFullYear();
      const start = Math.floor(new Date(`${taxYear}-01-01T00:00:00Z`).getTime() / 1000);
      const end = Math.floor(new Date(`${taxYear + 1}-01-01T00:00:00Z`).getTime() / 1000);
      scope = { taxYear };
      txs = listTransactions(db, userId, { sinceTs: start, untilTs: end, limit: 5000 });
    } else if (scopeKind === "category") {
      const category = String(input.category || "");
      scope = { category };
      txs = listTransactions(db, userId, { category, limit: 5000 });
    } else {
      txs = listTransactions(db, userId, { limit: 5000 });
    }

    let payload;
    if (format === "csv") {
      const header = "id,date,direction,amount_cents,currency,counterparty,category,memo";
      const lines = txs.map((t) => [
        t.id,
        new Date(t.occurred_at * 1000).toISOString(),
        t.direction,
        t.amount_cents,
        t.currency,
        JSON.stringify(t.counterparty || ""),
        t.category || "",
        JSON.stringify(t.memo || ""),
      ].join(","));
      payload = [header, ...lines].join("\n");
    } else if (format === "qif") {
      // Quicken Interchange Format (simplified)
      const lines = [];
      lines.push("!Type:Bank");
      for (const t of txs) {
        lines.push(`D${new Date(t.occurred_at * 1000).toISOString().slice(0, 10)}`);
        lines.push(`T${t.direction === "debit" ? "-" : ""}${(t.amount_cents / 100).toFixed(2)}`);
        if (t.counterparty) lines.push(`P${t.counterparty}`);
        if (t.category) lines.push(`L${t.category}`);
        if (t.memo) lines.push(`M${t.memo}`);
        lines.push("^");
      }
      payload = lines.join("\n");
    } else if (format === "ofx") {
      // Minimal OFX (Open Financial Exchange) wrapper
      const dtnow = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
      const stmtlines = txs.map((t) => `
    <STMTTRN>
      <TRNTYPE>${t.direction === "debit" ? "DEBIT" : "CREDIT"}</TRNTYPE>
      <DTPOSTED>${new Date(t.occurred_at * 1000).toISOString().replace(/[-:T.]/g, "").slice(0, 14)}</DTPOSTED>
      <TRNAMT>${t.direction === "debit" ? "-" : ""}${(t.amount_cents / 100).toFixed(2)}</TRNAMT>
      <FITID>${t.id}</FITID>
      <NAME>${(t.counterparty || "").slice(0, 32)}</NAME>
      <MEMO>${(t.memo || "").slice(0, 255)}</MEMO>
    </STMTTRN>`).join("");
      payload = `<?xml version="1.0"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>${dtnow}</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <STMTRS>
        <CURDEF>USD</CURDEF>
        <BANKTRANLIST>${stmtlines}
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;
    } else if (format === "concord_dtu_pack") {
      // Concord-native portable bundle
      payload = JSON.stringify({
        spec: "concord-wallet-pack/v1",
        owner_user_id: userId,
        exported_at: _now(),
        scope: { kind: scopeKind, ...scope },
        accounts: listAccounts(db, userId),
        transactions: txs,
        recurring: listRecurring(db, userId, { activeOnly: false }),
      });
    } else {
      payload = JSON.stringify(txs);
    }

    const id = `web:${randomUUID()}`;
    const expiresAt = _now() + 7 * 86400;  // 7-day TTL
    db.prepare(`
      INSERT INTO wallet_export_bundles (id, owner_user_id, format, scope_kind, scope_json, record_count, payload, target_app, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
    `).run(id, userId, format, scopeKind, JSON.stringify(scope),
      txs.length, payload, input.targetApp || null,
      expiresAt, _now());
    return { ok: true, id, format, recordCount: txs.length, payload, expiresAt };
  }, { destructive: true, note: "Open-banking-style export. 5 formats: concord_dtu_pack (portable bundle) / OFX (Quicken-compatible) / CSV / QIF / JSON. 5 scope kinds: all / date_range / single_account / tax_year / category. 7-day TTL." });

  register("wallet", "export_bundles_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Don't return payload here — could be huge
    const rows = db.prepare(`SELECT id, format, scope_kind, scope_json, record_count, target_app, status, expires_at, created_at FROM wallet_export_bundles WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 50`).all(userId);
    return { ok: true, bundles: rows.map((r) => ({ ...r, scope: _safeJson(r.scope_json, {}) })) };
  }, { note: "List my recent exports (payload omitted; fetch by id for download)" });

  register("wallet", "export_bundle_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`SELECT * FROM wallet_export_bundles WHERE id = ? AND owner_user_id = ?`).get(String(input.id || ""), userId);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.expires_at && r.expires_at <= _now()) {
      db.prepare(`UPDATE wallet_export_bundles SET status = 'expired' WHERE id = ?`).run(r.id);
      return { ok: false, reason: "expired" };
    }
    return { ok: true, bundle: { ...r, scope: _safeJson(r.scope_json, {}) } };
  }, { note: "Fetch the payload of an export bundle (for download)" });
}
