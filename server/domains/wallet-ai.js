// server/domains/wallet-ai.js
//
// Wallet lens Sprint B — AI surface. Research-grounded per
// docs/LENS_RESEARCH_NOTES.md wallet section:
//
//   tx_categorize_suggest       rule → deterministic patterns → LLM cascade
//                                (Copilot Money ~93% accuracy target)
//   anomaly_scan                spending spike + duplicate charge + Benford
//                                + sudden subscription + overdraft risk
//   subscription_discover       pattern-match recurring counterparties
//                                (Monarch parity)
//   cashflow_forecast           30/60/90-day projection from history +
//                                known recurring (2025-2026 differentiator)
//   tax_summary_compose         annual tax-prep narrative with sources

import { randomUUID } from "node:crypto";
import { listTransactions, ingestTransaction, registerRecurring } from "../lib/wallet/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const TIMEOUT_MS = 12_000;
function _withTimeout(p, ms = TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}
function _stripFences(s) { const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/); return m ? m[1] : s; }
function _extractJsonObject(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

function _recordAiRun(db, { userId, kind, promptText, modelName, outputText, source = "deterministic", tokens = 0, latencyMs = null }) {
  if (!db || !userId) return null;
  try {
    const r = db.prepare(`
      INSERT INTO wallet_ai_runs (owner_user_id, kind, prompt_text, model_name, output_text, source, tokens, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, kind,
      promptText ? String(promptText).slice(0, 6000) : null,
      modelName, outputText ? String(outputText).slice(0, 12000) : null,
      source, tokens || 0, latencyMs, _now());
    return r.lastInsertRowid;
  } catch { return null; }
}

// ─── Deterministic categorization ─────────────────────────
//
// Plaid-style merchant→category mapping. Pattern-match counterparty
// against well-known merchant signatures.

const CATEGORY_PATTERNS = {
  "food.restaurants": [
    /\b(starbucks|dunkin|peet|tim hortons|costa)\b/i,
    /\b(mcdonald|burger king|wendy|chick-fil-a|taco bell|chipotle|panera|subway|domino|pizza hut)\b/i,
    /\b(doordash|grubhub|uber eats|seamless|postmates|caviar)\b/i,
    /\b(restaurant|cafe|coffee|bistro|grill)\b/i,
  ],
  "food.groceries": [
    /\b(whole foods|trader joe|safeway|kroger|albertsons|publix|wegmans|sprouts|aldi|walmart grocery)\b/i,
    /\b(instacart|amazon fresh|shipt)\b/i,
    /\b(grocery|market|supermarket)\b/i,
  ],
  "transport.fuel": [
    /\b(shell|chevron|exxon|mobil|bp|76|arco|valero|sunoco|marathon)\b/i,
    /\b(gas station|fuel|petrol)\b/i,
  ],
  "transport.transit": [
    /\b(uber|lyft|via|curb)\b/i,
    /\b(amtrak|metro|bart|cta|mta|wmata|septa)\b/i,
    /\b(transit|subway|bus|train)\b/i,
  ],
  "housing.rent": [/\brent payment\b|\bproperty management\b|\bapartment\b/i],
  "housing.utilities": [/\b(electric|gas company|water|sewer|garbage|trash)\b.*\b(bill|payment|company)\b/i,
                       /\b(pge|coned|peco|duke energy|nationalgrid|spectrum|comcast|xfinity|att|verizon fios)\b/i],
  "subscriptions": [
    /\b(netflix|hulu|disney|hbo max|max|paramount|peacock|prime video|apple tv)\b/i,
    /\b(spotify|apple music|tidal|youtube music|pandora)\b/i,
    /\b(github|figma|notion|slack|zoom|dropbox|google one|icloud|adobe)\b/i,
    /\b(patreon|substack|onlyfans|ko-fi|buy me a coffee)\b/i,
    /\b(subscription|monthly plan|annual plan)\b/i,
  ],
  "shopping": [
    /\b(amazon|ebay|etsy|wayfair|target|walmart|costco|best buy|home depot|lowes)\b/i,
    /\b(apple store|microsoft store)\b/i,
  ],
  "entertainment": [
    /\b(steam|epic games|playstation|xbox|nintendo)\b/i,
    /\b(amc|regal|cinemark|movie tavern)\b/i,
    /\b(ticketmaster|stubhub|seatgeek|vivid seats|axs)\b/i,
  ],
  "travel": [
    /\b(delta|united|american airlines|southwest|jetblue|alaska|frontier|spirit)\b/i,
    /\b(marriott|hilton|hyatt|ihg|airbnb|vrbo|booking\.com|expedia|kayak)\b/i,
    /\b(uber rides|lyft rides|hertz|enterprise|avis|budget rental)\b/i,
  ],
  "health": [
    /\b(cvs|walgreens|rite aid|pharmacy)\b/i,
    /\b(kaiser|blue cross|aetna|cigna|united healthcare|anthem)\b/i,
    /\b(doctor|clinic|hospital|medical|copay)\b/i,
  ],
  "income.salary": [
    /\b(payroll|salary|direct deposit|wages|bi-weekly pay)\b/i,
    /\b(adp|gusto|paychex|paylocity|trinet)\b/i,
  ],
  "tax": [/\b(irs|state tax|federal tax|estimated tax|tax payment)\b/i],
  "transfer": [/\btransfer\b|\bach in\b|\bach out\b|\bzelle\b|\bvenmo\b|\bcash app\b/i],
};

export function categorizeDeterministic(text, kind = null) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  // Income text usually has different patterns — check those first if kind hints
  if (kind === "credit") {
    for (const [code, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      if (!code.startsWith("income.") && code !== "transfer") continue;
      for (const re of patterns) if (re.test(t)) return { category: code, confidence: 0.7, matched: re.toString() };
    }
  }
  for (const [code, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (code.startsWith("income.")) continue;  // skip in non-credit
    for (const re of patterns) if (re.test(t)) return { category: code, confidence: 0.65, matched: re.toString() };
  }
  return null;
}

// ─── Subscription discovery ───────────────────────────────
//
// Group transactions by counterparty + similar amount, look for
// recurring intervals. >= 3 hits at consistent cadence = subscription.

const CADENCE_DAY_WINDOWS = {
  weekly:    { mean: 7,   tol: 2 },
  biweekly:  { mean: 14,  tol: 3 },
  monthly:   { mean: 30,  tol: 5 },
  quarterly: { mean: 91,  tol: 10 },
  annually:  { mean: 365, tol: 20 },
};

function _inferCadence(intervalsDays) {
  if (!intervalsDays || intervalsDays.length === 0) return null;
  const avg = intervalsDays.reduce((s, x) => s + x, 0) / intervalsDays.length;
  for (const [cadence, { mean, tol }] of Object.entries(CADENCE_DAY_WINDOWS)) {
    if (Math.abs(avg - mean) <= tol) return cadence;
  }
  return null;
}

export function findSubscriptionCandidates(transactions) {
  if (!Array.isArray(transactions) || transactions.length < 3) return [];
  // Group by counterparty (normalized) + amount bucket (round to 100c)
  const groups = new Map();
  for (const tx of transactions) {
    if (tx.direction !== "debit" || !tx.counterparty) continue;
    const counterparty = String(tx.counterparty).toLowerCase().trim();
    const amountBucket = Math.round(tx.amount_cents / 100) * 100;
    const key = `${counterparty}|${amountBucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  const candidates = [];
  for (const [key, txs] of groups.entries()) {
    if (txs.length < 3) continue;
    const sorted = [...txs].sort((a, b) => a.occurred_at - b.occurred_at);
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push((sorted[i].occurred_at - sorted[i - 1].occurred_at) / 86400);
    }
    const cadence = _inferCadence(intervals);
    if (!cadence) continue;
    const [counterparty] = key.split("|");
    candidates.push({
      counterparty: sorted[0].counterparty,
      counterparty_key: counterparty,
      typical_amount_cents: Math.round(sorted.reduce((s, t) => s + t.amount_cents, 0) / sorted.length),
      cadence,
      sample_count: sorted.length,
      first_seen_at: sorted[0].occurred_at,
      last_seen_at: sorted[sorted.length - 1].occurred_at,
      confidence: Math.min(1, sorted.length / 5 + 0.4),  // 3 samples → 1.0, capped
    });
  }
  return candidates;
}

// ─── Spending anomaly heuristics ──────────────────────────

export function spendingSpikeCheck(db, userId, { sinceDays = 7, baselineDays = 90 } = {}) {
  if (!db || !userId) return null;
  const now = _now();
  const recentSince = now - sinceDays * 86400;
  const baselineSince = now - baselineDays * 86400;
  // Total spend in recent window
  const recent = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM wallet_transactions
    WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted' AND occurred_at >= ?
  `).get(userId, recentSince);
  // Baseline daily average over baselineDays (excluding recent window)
  const baseline = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM wallet_transactions
    WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted'
      AND occurred_at >= ? AND occurred_at < ?
  `).get(userId, baselineSince, recentSince);
  const baselineDailyAvg = (baseline.total || 0) / Math.max(1, baselineDays - sinceDays);
  const expectedRecent = baselineDailyAvg * sinceDays;
  const ratio = expectedRecent > 0 ? recent.total / expectedRecent : 0;
  return {
    sinceDays, baselineDays,
    recentTotalCents: recent.total,
    baselineDailyAvgCents: Math.round(baselineDailyAvg),
    expectedRecentCents: Math.round(expectedRecent),
    ratio: Math.round(ratio * 100) / 100,
    isSpike: ratio >= 1.5 && recent.total >= 5000,  // 50% over expected + at least $50
  };
}

export function duplicateChargeCheck(db, userId, { windowSeconds = 600 } = {}) {
  if (!db || !userId) return [];
  // Same counterparty + same amount within 10-minute window
  // Duplicate = same merchant + same amount + within window. Use
  // (occurred_at, id) tuple for stable ordering — UUIDs are NOT
  // chronological so id-only comparison would miss dupes that happen
  // to have alphabetically-earlier UUIDs.
  const rows = db.prepare(`
    SELECT t1.id AS id_a, t2.id AS id_b, t1.counterparty, t1.amount_cents, t1.occurred_at AS a_at, t2.occurred_at AS b_at
    FROM wallet_transactions t1
    INNER JOIN wallet_transactions t2
      ON t2.owner_user_id = t1.owner_user_id
      AND t2.counterparty = t1.counterparty
      AND t2.amount_cents = t1.amount_cents
      AND t2.id != t1.id
      AND t2.direction = 'debit'
      AND (t2.occurred_at > t1.occurred_at OR (t2.occurred_at = t1.occurred_at AND t2.id > t1.id))
      AND t2.occurred_at - t1.occurred_at <= ?
    WHERE t1.owner_user_id = ? AND t1.direction = 'debit' AND t1.counterparty IS NOT NULL
  `).all(windowSeconds, userId);
  return rows.map((r) => ({
    transactionA: r.id_a, transactionB: r.id_b,
    counterparty: r.counterparty, amountCents: r.amount_cents,
    secondsApart: r.b_at - r.a_at,
  }));
}

export default function registerWalletAiMacros(register) {

  // ─── Rules ────────────────────────────────────────────────

  register("wallet", "categorize_learn_rule", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const { pattern, targetCategory, patternKind = "substring", priority = 100, source = "manual", targetSubcategory = null } = input;
    if (!pattern || !targetCategory) return { ok: false, reason: "pattern_and_targetCategory_required" };
    const id = `wcr:${randomUUID()}`;
    db.prepare(`
      INSERT INTO wallet_categorization_rules (id, owner_user_id, pattern, pattern_kind, target_category, target_subcategory, priority, source, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, userId, String(pattern).slice(0, 500),
      ["substring","regex","counterparty","amount_range"].includes(patternKind) ? patternKind : "substring",
      targetCategory, targetSubcategory,
      Math.max(0, Math.min(1000, Number(priority) || 100)),
      ["manual","llm_suggested","learned","imported"].includes(source) ? source : "manual",
      _now());
    return { ok: true, id };
  }, { destructive: true, note: "Create a categorization rule (pattern → category). Tested before deterministic fallback + LLM in tx_categorize_suggest." });

  register("wallet", "categorize_rules_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, rules: db.prepare(`SELECT * FROM wallet_categorization_rules WHERE owner_user_id = ? ORDER BY priority DESC, hit_count DESC`).all(userId) };
  }, { note: "List my categorization rules" });

  // ─── tx_categorize_suggest ────────────────────────────────

  register("wallet", "tx_categorize_suggest", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const text = String(input.text || input.counterparty || input.memo || "").trim();
    if (!text) return { ok: false, reason: "text_required" };
    const direction = input.direction || (input.amountCents > 0 ? "debit" : null);
    const t0 = Date.now();

    // 1) Rules
    const rules = db.prepare(`SELECT * FROM wallet_categorization_rules WHERE owner_user_id = ? AND enabled = 1 ORDER BY priority DESC, hit_count DESC`).all(userId);
    for (const rule of rules) {
      let match = false;
      if (rule.pattern_kind === "substring") match = text.toLowerCase().includes(rule.pattern.toLowerCase());
      else if (rule.pattern_kind === "regex") {
        try { match = new RegExp(rule.pattern, "i").test(text); } catch { match = false; }
      } else if (rule.pattern_kind === "counterparty" && input.counterparty) {
        match = input.counterparty.toLowerCase().includes(rule.pattern.toLowerCase());
      }
      if (match) {
        db.prepare(`UPDATE wallet_categorization_rules SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?`).run(_now(), rule.id);
        _recordAiRun(db, { userId, kind: "categorize", promptText: text, outputText: rule.target_category, source: "rule", latencyMs: Date.now() - t0 });
        return { ok: true, category: rule.target_category, subcategory: rule.target_subcategory, confidence: 0.95, source: "rule", ruleId: rule.id };
      }
    }

    // 2) Deterministic patterns
    const det = categorizeDeterministic(text, direction);
    if (det) {
      _recordAiRun(db, { userId, kind: "categorize", promptText: text, outputText: det.category, source: "deterministic", latencyMs: Date.now() - t0 });
      if (!ctx?.llm?.chat) {
        return { ok: true, category: det.category, confidence: det.confidence, source: "deterministic", matched: det.matched };
      }
    }

    // 3) LLM augmentation
    const llm = ctx?.llm;
    if (!llm?.chat) {
      return { ok: true, category: null, source: "fallback", reason: "no_match", confidence: 0 };
    }

    const sys = `You categorize a bank transaction. Pick the best matching category from this list:
food, food.groceries, food.restaurants, transport, transport.fuel, transport.transit, housing, housing.rent, housing.mortgage, housing.utilities, health, insurance, subscriptions, shopping, entertainment, travel, education, tax, tip, income.salary, income.freelance, income.creator, income.dividend, income.interest, transfer, investment, concord_coin.

Output ONLY this JSON: {"category": "<code>", "confidence": 0-1, "reasoning": "one short sentence"}`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: `Counterparty/memo: ${text}${input.amountCents ? `\nAmount cents: ${input.amountCents}` : ""}${direction ? `\nDirection: ${direction}` : ""}` }],
        temperature: 0.2, maxTokens: 200, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJsonObject(raw);
      if (parsed?.category) {
        _recordAiRun(db, { userId, kind: "categorize", promptText: text, modelName: r?.model || "utility-brain", outputText: parsed.category, source: "llm", latencyMs: Date.now() - t0 });
        return { ok: true, category: parsed.category, confidence: Number(parsed.confidence) || 0.6, reasoning: parsed.reasoning, source: "llm" };
      }
      return { ok: true, category: det?.category || null, confidence: det?.confidence || 0, source: det ? "deterministic" : "fallback", reason: "llm_parse_failed" };
    } catch (err) {
      return { ok: true, category: det?.category || null, confidence: det?.confidence || 0, source: det ? "deterministic" : "fallback", reason: "llm_error", error: err?.message };
    }
  }, { note: "Categorize a transaction via rule → deterministic pattern → LLM cascade. Returns category + confidence + source provenance. Logged to wallet_ai_runs." });

  // ─── Anomaly scan ─────────────────────────────────────────

  register("wallet", "anomaly_scan", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const t0 = Date.now();
    const found = [];

    // 1) Spending spike
    const spike = spendingSpikeCheck(db, userId, { sinceDays: input.sinceDays, baselineDays: input.baselineDays });
    if (spike?.isSpike) {
      found.push({
        kind: "spending_spike",
        severity: spike.ratio >= 3 ? "high" : "medium",
        subject_kind: "period",
        detail: { ratio: spike.ratio, recent_cents: spike.recentTotalCents, expected_cents: spike.expectedRecentCents, since_days: spike.sinceDays },
      });
    }

    // 2) Duplicate charges
    const dupes = duplicateChargeCheck(db, userId, { windowSeconds: input.duplicateWindowSeconds });
    for (const d of dupes) {
      found.push({
        kind: "duplicate_charge",
        severity: d.amountCents >= 5000 ? "high" : "medium",
        subject_kind: "transaction",
        subject_id: d.transactionB,
        detail: { counterparty: d.counterparty, amount_cents: d.amountCents, seconds_apart: d.secondsApart, original_tx: d.transactionA },
      });
    }

    // 3) Large unusual charge — any single debit > 5x 90-day median
    const medRow = db.prepare(`
      SELECT amount_cents FROM wallet_transactions
      WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted' AND occurred_at >= ?
      ORDER BY amount_cents ASC LIMIT 1 OFFSET (
        SELECT COUNT(*) / 2 FROM wallet_transactions
        WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted' AND occurred_at >= ?
      )
    `).get(userId, _now() - 90 * 86400, userId, _now() - 90 * 86400);
    const median = medRow?.amount_cents || 0;
    if (median > 0) {
      const outliers = db.prepare(`
        SELECT id, counterparty, amount_cents FROM wallet_transactions
        WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted'
          AND occurred_at >= ? AND amount_cents > ?
        LIMIT 10
      `).all(userId, _now() - 14 * 86400, median * 5);
      for (const o of outliers) {
        found.push({
          kind: "large_unusual_charge",
          severity: o.amount_cents >= median * 10 ? "high" : "medium",
          subject_kind: "transaction",
          subject_id: o.id,
          detail: { counterparty: o.counterparty, amount_cents: o.amount_cents, median_cents: median },
        });
      }
    }

    // Persist
    const ins = db.prepare(`
      INSERT INTO wallet_anomalies (id, owner_user_id, kind, severity, subject_kind, subject_id, detail_json, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const a of found) {
        ins.run(`wanom:${randomUUID()}`, userId, a.kind, a.severity, a.subject_kind, a.subject_id || null, JSON.stringify(a.detail), _now());
      }
    });
    tx();
    _recordAiRun(db, { userId, kind: "anomaly_scan", outputText: `${found.length} anomalies`, source: "deterministic", latencyMs: Date.now() - t0 });
    return { ok: true, anomalies: found, count: found.length };
  }, { destructive: true, note: "Scan for spending anomalies: spike (ratio≥1.5x baseline + ≥$50), duplicate charge (same merchant+amount within 10min), large outlier (>5x 90-day median). Persists to wallet_anomalies." });

  register("wallet", "anomaly_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const unackOnly = input.unackOnly !== false;
    const sql = unackOnly
      ? `SELECT * FROM wallet_anomalies WHERE owner_user_id = ? AND acknowledged_at IS NULL ORDER BY detected_at DESC`
      : `SELECT * FROM wallet_anomalies WHERE owner_user_id = ? ORDER BY detected_at DESC LIMIT 200`;
    const rows = db.prepare(sql).all(userId);
    return { ok: true, anomalies: rows.map((r) => ({ ...r, detail: _safeJson(r.detail_json, {}) })) };
  }, { note: "List anomalies (unacknowledged by default)" });

  register("wallet", "anomaly_acknowledge", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const r = db.prepare(`UPDATE wallet_anomalies SET acknowledged_at = ?, acknowledged_by = ?, resolution_note = ? WHERE id = ? AND owner_user_id = ?`)
      .run(_now(), userId, input.note ? String(input.note).slice(0, 500) : null, id, userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Acknowledge an anomaly with optional resolution note" });

  // ─── Subscription discovery ──────────────────────────────

  register("wallet", "subscription_discover", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const t0 = Date.now();
    // Get transactions for analysis (default 180 days)
    const sinceTs = _now() - (Number(input.sinceDays) || 180) * 86400;
    const txs = listTransactions(db, userId, { sinceTs, limit: 1000 });
    const candidates = findSubscriptionCandidates(txs);
    // Persist (upsert on counterparty + cadence to avoid dup-noise)
    const ins = db.prepare(`
      INSERT INTO wallet_subscription_predictions (id, owner_user_id, counterparty, typical_amount_cents, cadence, confidence, sample_count, first_seen_at, last_seen_at, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let persisted = 0;
    const tx = db.transaction(() => {
      for (const c of candidates) {
        // Skip if already registered or dismissed
        const existing = db.prepare(`SELECT id FROM wallet_subscription_predictions WHERE owner_user_id = ? AND counterparty = ? AND cadence = ?`).get(userId, c.counterparty, c.cadence);
        if (existing) {
          db.prepare(`UPDATE wallet_subscription_predictions SET confidence = ?, sample_count = ?, last_seen_at = ?, detected_at = ? WHERE id = ?`)
            .run(c.confidence, c.sample_count, c.last_seen_at, _now(), existing.id);
          continue;
        }
        ins.run(`wsp:${randomUUID()}`, userId, c.counterparty,
          c.typical_amount_cents, c.cadence, c.confidence,
          c.sample_count, c.first_seen_at, c.last_seen_at, _now());
        persisted++;
      }
    });
    tx();
    _recordAiRun(db, { userId, kind: "subscription_discover", outputText: `${persisted} new candidates, ${candidates.length} total`, source: "deterministic", latencyMs: Date.now() - t0 });
    return { ok: true, candidates, persisted };
  }, { destructive: true, note: "Discover recurring subscription candidates from transaction history. Pattern-matches counterparty + amount + cadence (weekly/biweekly/monthly/quarterly/annually). Requires 3+ matching transactions for detection." });

  register("wallet", "subscription_predictions_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, predictions: db.prepare(`SELECT * FROM wallet_subscription_predictions WHERE owner_user_id = ? AND dismissed = 0 ORDER BY confidence DESC, detected_at DESC`).all(userId) };
  }, { note: "List undismissed subscription predictions" });

  register("wallet", "subscription_promote", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const predictionId = String(input.id || input.predictionId || "");
    const pred = db.prepare(`SELECT * FROM wallet_subscription_predictions WHERE id = ? AND owner_user_id = ?`).get(predictionId, userId);
    if (!pred) return { ok: false, reason: "not_found" };
    const rec = registerRecurring(db, userId, {
      counterparty: pred.counterparty,
      typicalAmountCents: pred.typical_amount_cents,
      cadence: pred.cadence,
      category: "subscriptions",
      source: "detected",
    });
    if (rec.ok) {
      db.prepare(`UPDATE wallet_subscription_predictions SET registered_recurring_id = ? WHERE id = ?`).run(rec.id, predictionId);
    }
    return { ok: rec.ok, recurringId: rec.id };
  }, { destructive: true, note: "Promote a prediction to a confirmed recurring charge" });

  register("wallet", "subscription_dismiss", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`UPDATE wallet_subscription_predictions SET dismissed = 1 WHERE id = ? AND owner_user_id = ?`).run(String(input.id || ""), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Dismiss a false-positive subscription prediction" });

  // ─── Cashflow forecast ───────────────────────────────────

  register("wallet", "cashflow_forecast", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const horizonDays = [30, 60, 90].includes(Number(input.horizonDays)) ? Number(input.horizonDays) : 30;
    const t0 = Date.now();
    // Project from 90-day history average + known recurring
    const sinceTs = _now() - 90 * 86400;
    const incomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total FROM wallet_transactions
      WHERE owner_user_id = ? AND direction = 'credit' AND status = 'posted' AND occurred_at >= ?
    `).get(userId, sinceTs);
    const spendRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total FROM wallet_transactions
      WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted' AND occurred_at >= ?
    `).get(userId, sinceTs);
    const dailyIncome = (incomeRow.total || 0) / 90;
    const dailySpend = (spendRow.total || 0) / 90;
    const projectedIncome = Math.round(dailyIncome * horizonDays);
    const projectedSpend = Math.round(dailySpend * horizonDays);
    const projectedNet = projectedIncome - projectedSpend;
    // Add upcoming known recurring
    const recurringRows = db.prepare(`SELECT typical_amount_cents, cadence FROM wallet_recurring WHERE owner_user_id = ? AND active = 1`).all(userId);
    const recurringSpend = recurringRows.reduce((s, r) => {
      const perDay = (r.typical_amount_cents || 0) / ({ weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, annually: 365, custom: 30 }[r.cadence] || 30);
      return s + perDay * horizonDays;
    }, 0);
    // Current balance (only Concord Coin + a snapshot of linked accounts; computed via wallet_balances_snapshot)
    const balRows = db.prepare(`
      SELECT b.balance_cents, b.currency
      FROM wallet_balances_snapshot b
      INNER JOIN wallet_accounts a ON a.id = b.account_id
      WHERE a.owner_user_id = ? AND a.removed_at IS NULL
    `).all(userId);
    const currentBalanceCents = balRows.filter((b) => b.currency === "USD").reduce((s, b) => s + (b.balance_cents || 0), 0);
    const endingBalance = currentBalanceCents + projectedIncome - projectedSpend - Math.round(recurringSpend);

    const breakdown = {
      daily_avg_income_cents: Math.round(dailyIncome),
      daily_avg_spend_cents: Math.round(dailySpend),
      recurring_spend_in_horizon_cents: Math.round(recurringSpend),
      current_usd_balance_cents: currentBalanceCents,
      methodology_note: "Linear extrapolation from 90-day history + known recurring sum, projected over horizon.",
    };
    const id = `wcf:${randomUUID()}`;
    db.prepare(`
      INSERT INTO wallet_cashflow_forecasts (id, owner_user_id, horizon_days, projected_income_cents, projected_spend_cents, projected_net_cents, ending_balance_cents, breakdown_json, methodology, composed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deterministic', ?)
    `).run(id, userId, horizonDays,
      projectedIncome, projectedSpend, projectedNet,
      endingBalance, JSON.stringify(breakdown), _now());
    _recordAiRun(db, { userId, kind: "cashflow_forecast", outputText: `horizon=${horizonDays}d income=${projectedIncome} spend=${projectedSpend} net=${projectedNet}`, source: "deterministic", latencyMs: Date.now() - t0 });
    return {
      ok: true, id, horizonDays,
      projectedIncomeCents: projectedIncome,
      projectedSpendCents: projectedSpend,
      projectedNetCents: projectedNet,
      endingBalanceCents: endingBalance,
      breakdown,
    };
  }, { destructive: true, note: "30/60/90-day cashflow projection from 90-day daily averages + known recurring. Returns ending balance + per-component breakdown. Logged to wallet_cashflow_forecasts." });

  register("wallet", "cashflow_recent", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, forecasts: db.prepare(`SELECT * FROM wallet_cashflow_forecasts WHERE owner_user_id = ? ORDER BY composed_at DESC LIMIT 20`).all(userId) };
  }, { note: "Recent cashflow forecasts" });

  // ─── Tax summary composer ────────────────────────────────

  register("wallet", "tax_summary_compose", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const year = Number(input.year) || new Date().getFullYear();
    const yearStart = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
    const yearEnd = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000);
    const t0 = Date.now();
    // Income breakdown
    const incomeRows = db.prepare(`
      SELECT category, SUM(amount_cents) AS total, COUNT(*) AS n
      FROM wallet_transactions
      WHERE owner_user_id = ? AND direction = 'credit' AND status = 'posted'
        AND occurred_at >= ? AND occurred_at < ?
        AND category LIKE 'income.%'
      GROUP BY category ORDER BY total DESC
    `).all(userId, yearStart, yearEnd);
    // Tax-deductible expense candidates
    const taxRows = db.prepare(`
      SELECT category, SUM(amount_cents) AS total, COUNT(*) AS n
      FROM wallet_transactions
      WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted'
        AND occurred_at >= ? AND occurred_at < ?
        AND category IN ('tax','tip','education','health','insurance')
      GROUP BY category ORDER BY total DESC
    `).all(userId, yearStart, yearEnd);
    const totalIncome = incomeRows.reduce((s, r) => s + r.total, 0);
    const totalTaxRelated = taxRows.reduce((s, r) => s + r.total, 0);

    const summary = `Tax year ${year}: total reported income $${(totalIncome / 100).toFixed(2)} across ${incomeRows.length} source(s). Tax-related expense candidates total $${(totalTaxRelated / 100).toFixed(2)}.

Income breakdown:
${incomeRows.map((r) => `  - ${r.category}: $${(r.total / 100).toFixed(2)} (${r.n} transactions)`).join("\n") || "  - (no income recorded)"}

Tax-related expenses:
${taxRows.map((r) => `  - ${r.category}: $${(r.total / 100).toFixed(2)} (${r.n} transactions)`).join("\n") || "  - (no tax-related expenses recorded)"}

⚠️ This is a summary of YOUR recorded transactions in Concord. It is not tax advice. Consult a CPA or tax professional.`;

    _recordAiRun(db, { userId, kind: "tax_summary", outputText: summary.slice(0, 500), source: "deterministic", latencyMs: Date.now() - t0 });
    return {
      ok: true, year,
      totalIncomeCents: totalIncome,
      totalTaxRelatedCents: totalTaxRelated,
      incomeBreakdown: incomeRows,
      taxRelatedExpenses: taxRows,
      summary,
      disclaimer: "This is a summary of YOUR recorded transactions in Concord. It is not tax advice. Consult a CPA or tax professional.",
    };
  }, { note: "Compose tax-prep summary for a year: income breakdown + tax-related expense candidates (health/insurance/education/tax/tip). Includes mandatory 'not tax advice' disclaimer." });

  register("wallet", "ai_runs_recent", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, runs: db.prepare(`SELECT * FROM wallet_ai_runs WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 100`).all(userId) };
  }, { note: "Recent wallet AI invocations (provenance trail)" });
}
