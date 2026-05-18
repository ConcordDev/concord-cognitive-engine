// server/domains/accounting-ai.js
//
// Accounting lens rebuild Sprint B — AI surface. Each macro has a
// deterministic fallback so the lens functions offline; LLM
// enhancement is opt-in via the per-call llm context.

import { randomUUID } from "node:crypto";
import { listCoa, getAccount } from "../lib/accounting/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

function _resolveEntity(db, userId, input = {}) {
  if (!db || !userId) return null;
  if (input.entityId) {
    const e = db.prepare(`SELECT id, owner_user_id FROM accounting_entities WHERE id = ?`).get(input.entityId);
    if (!e || e.owner_user_id !== userId) return null;
    return e.id;
  }
  const e = db.prepare(`SELECT id FROM accounting_entities WHERE owner_user_id = ? AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1`).get(userId);
  return e?.id || null;
}

function _recordAiRun(db, { entityId, userId, kind, inputSummary, outputSummary, source = "llm", tokens = 0, latencyMs = null }) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO accounting_ai_runs (entity_id, user_id, kind, input_summary, output_summary, source, tokens, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entityId || null, userId || null, kind,
      inputSummary ? String(inputSummary).slice(0, 4000) : null,
      outputSummary ? String(outputSummary).slice(0, 8000) : null,
      source, tokens || 0, latencyMs, _now());
  } catch { /* best effort */ }
}

const TIMEOUT_MS = 12_000;
function _withTimeout(p, ms = TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}
function _stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}
function _extractJsonObject(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

// ─── Deterministic categorization heuristic ─────────────────────
//
// Pattern-match memo/vendor against well-known accounting categories.
// LLM (utility brain) augments / refines if available.

const CATEGORY_PATTERNS = {
  "6010": [/\brent\b/i, /\blease.*office\b/i, /\bcommercial space\b/i],                     // Rent
  "6020": [/\butility\b|\butilities\b/i, /\belectric/i, /\bwater bill\b/i, /\bgas bill\b/i, /\binternet bill\b/i], // Utilities
  "6030": [/\bsalary\b|\bsalaries\b|\bwages\b|\bpayroll\b/i],                              // Salaries & Wages
  "6040": [/\bsupplies\b/i, /\bstaples\b/i, /\boffice depot\b/i, /\bprinter\b/i],          // Office Supplies
  "6050": [/\bsubscription\b/i, /\bsaas\b/i, /\bcloud\b/i, /\bgithub\b/i, /\bfigma\b/i, /\bnotion\b/i, /\bslack\b/i], // Software Subscriptions
  "5010": [/\binventory\b|\bcogs\b|\bcost of goods\b|\bmaterials\b/i],                     // COGS
  "4010": [/\bsales revenue\b|\bproduct revenue\b/i],                                       // Sales Revenue
  "4020": [/\bconsulting\b|\bservice revenue\b|\bservices rendered\b/i],                   // Service Revenue
};

export function suggestCategoryDeterministic(memo, codes) {
  if (!memo) return null;
  const text = String(memo);
  for (const [code, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (!codes.has(code)) continue;
    for (const re of patterns) {
      if (re.test(text)) return { code, confidence: 0.6, matched: re.toString() };
    }
  }
  // Fallback to "Other Expenses" if it exists
  if (codes.has("6900")) return { code: "6900", confidence: 0.2, matched: "fallback" };
  return null;
}

// ─── Benford's Law anomaly detection ────────────────────────────
//
// First-digit distribution of legitimate accounting figures should
// follow Benford's law: P(d) = log10(1 + 1/d). Significant deviation
// (chi-squared > threshold) suggests fabricated / cherry-picked data.

const BENFORD_EXPECTED = [null, 0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];

export function benfordTest(amounts) {
  if (!Array.isArray(amounts) || amounts.length < 30) return { ok: false, reason: "min_30_samples", n: amounts?.length || 0 };
  const observed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const amt of amounts) {
    const n = Math.abs(Number(amt) || 0);
    if (n === 0) continue;
    const firstDigit = parseInt(String(n).replace(/[^1-9]/, "").charAt(0), 10);
    if (firstDigit >= 1 && firstDigit <= 9) observed[firstDigit]++;
  }
  const total = observed.slice(1).reduce((s, n) => s + n, 0);
  if (total < 30) return { ok: false, reason: "min_30_nonzero", n: total };
  let chiSquared = 0;
  const distribution = [];
  for (let d = 1; d <= 9; d++) {
    const exp = BENFORD_EXPECTED[d] * total;
    const obs = observed[d];
    chiSquared += ((obs - exp) ** 2) / exp;
    distribution.push({ digit: d, observed: obs, expected: Math.round(exp * 100) / 100, expectedPct: BENFORD_EXPECTED[d] });
  }
  // Chi-squared critical value for 8 degrees of freedom @ p=0.05 = 15.51
  const violates = chiSquared > 15.51;
  return {
    ok: true,
    n: total,
    chiSquared: Math.round(chiSquared * 100) / 100,
    violates,
    pCritical: 15.51,
    distribution,
  };
}

// ─── Round-number cluster detector ──────────────────────────────
// 30%+ of amounts ending in .00 is a fabrication smell.

export function roundNumberCluster(amounts) {
  if (!Array.isArray(amounts) || amounts.length < 10) return { ok: false, reason: "min_10_samples" };
  let round = 0;
  for (const amt of amounts) {
    const n = Math.abs(Number(amt) || 0);
    if (n === 0) continue;
    const fractional = Math.round((n - Math.floor(n)) * 100);
    if (fractional === 0) round++;
  }
  const pct = round / amounts.length;
  return { ok: true, count: round, total: amounts.length, pctRound: Math.round(pct * 10000) / 100, suspicious: pct >= 0.3 };
}

export default function registerAccountingAiMacros(register) {

  // ─── Categorization rules ────────────────────────────────────

  register("accounting", "categorize_suggest", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const memo = String(input.memo || input.description || "").trim();
    if (!memo) return { ok: false, reason: "memo_required" };
    const accounts = listCoa(db, entityId);
    const codes = new Map(accounts.map((a) => [a.code, a]));

    // 1) Check existing rules first
    const rules = db.prepare(`SELECT * FROM accounting_categorization_rules WHERE entity_id = ? AND enabled = 1 ORDER BY priority DESC, hit_count DESC`).all(entityId);
    for (const rule of rules) {
      let match = false;
      if (rule.pattern_kind === "substring") match = memo.toLowerCase().includes(rule.pattern.toLowerCase());
      else if (rule.pattern_kind === "regex") {
        try { match = new RegExp(rule.pattern, "i").test(memo); } catch { match = false; }
      } else if (rule.pattern_kind === "vendor" && input.vendor) {
        match = input.vendor.toLowerCase().includes(rule.pattern.toLowerCase());
      }
      if (match) {
        db.prepare(`UPDATE accounting_categorization_rules SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?`).run(_now(), rule.id);
        return { ok: true, accountId: rule.target_account_id, source: "rule", ruleId: rule.id, confidence: 0.95 };
      }
    }

    // 2) Deterministic pattern fallback
    const codeSet = new Set(accounts.map((a) => a.code));
    const det = suggestCategoryDeterministic(memo, codeSet);
    if (det) {
      const acc = codes.get(det.code);
      _recordAiRun(db, { entityId, userId, kind: "categorize", inputSummary: memo, outputSummary: `${det.code} (${det.confidence})`, source: "deterministic" });
      if (!ctx?.llm?.chat) {
        return { ok: true, accountId: acc?.id, accountCode: det.code, confidence: det.confidence, source: "deterministic" };
      }
    }

    // 3) LLM enhancement
    const llm = ctx?.llm;
    if (!llm?.chat) {
      return { ok: true, accountId: null, source: "fallback", reason: "no_match", confidence: 0 };
    }
    const t0 = Date.now();
    const accountList = accounts.filter((a) => a.is_active).map((a) => `  ${a.code} ${a.name} (${a.type})`).join("\n");
    const sys = `You are a bookkeeper categorizing a transaction. Pick the SINGLE best matching account from the chart of accounts below.

CHART OF ACCOUNTS:
${accountList}

Output ONLY this JSON object:
{ "code": "<account code from above>", "confidence": 0.0-1.0, "reasoning": "one short sentence" }`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: `Transaction memo: ${memo}${input.vendor ? `\nVendor: ${input.vendor}` : ""}${input.amount ? `\nAmount: ${input.amount}` : ""}` }],
        temperature: 0.2, maxTokens: 250, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJsonObject(raw);
      if (parsed?.code && codes.has(parsed.code)) {
        const acc = codes.get(parsed.code);
        _recordAiRun(db, { entityId, userId, kind: "categorize", inputSummary: memo, outputSummary: `${parsed.code} (${parsed.confidence})`, source: "llm", latencyMs: Date.now() - t0 });
        return { ok: true, accountId: acc.id, accountCode: parsed.code, confidence: Number(parsed.confidence) || 0.7, reasoning: String(parsed.reasoning || "").slice(0, 200), source: "llm" };
      }
      return { ok: true, accountId: det ? codes.get(det.code)?.id : null, source: det ? "deterministic" : "fallback", reason: "llm_parse_failed", confidence: det?.confidence || 0 };
    } catch (err) {
      return { ok: true, accountId: det ? codes.get(det.code)?.id : null, source: det ? "deterministic" : "fallback", reason: "llm_error", error: err?.message, confidence: det?.confidence || 0 };
    }
  }, { note: "Suggest the best CoA account for a transaction memo/vendor. Rule → deterministic → LLM cascade." });

  register("accounting", "categorize_learn_rule", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const { pattern, targetAccountId, patternKind = "substring", priority = 100, source = "manual" } = input;
    if (!pattern || !targetAccountId) return { ok: false, reason: "pattern_and_targetAccountId_required" };
    const id = `rule:${randomUUID()}`;
    db.prepare(`
      INSERT INTO accounting_categorization_rules (id, entity_id, pattern, pattern_kind, target_account_id, priority, created_by, source, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, entityId, String(pattern).slice(0, 500),
      ["substring","regex","vendor","amount_range","llm"].includes(patternKind) ? patternKind : "substring",
      targetAccountId, Number(priority) || 100, userId,
      ["manual","llm_suggested","imported","learned"].includes(source) ? source : "manual",
      _now());
    return { ok: true, id };
  }, { destructive: true, note: "Create a new auto-categorization rule (pattern → account)" });

  register("accounting", "categorize_rules_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return { ok: true, rules: db.prepare(`SELECT * FROM accounting_categorization_rules WHERE entity_id = ? ORDER BY priority DESC, hit_count DESC`).all(entityId) };
  }, { note: "List my categorization rules" });

  // ─── Anomaly detection ──────────────────────────────────────

  register("accounting", "anomaly_scan", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const start = input.startDate || `${new Date().getFullYear()}-01-01`;
    const end = input.endDate || new Date().toISOString().slice(0, 10);
    const foundAnomalies = [];

    // 1) Unbalanced periods (any JE that fails sum-debits=sum-credits)
    const unbalancedJes = db.prepare(`
      SELECT je.id, je.number, je.date,
             COALESCE(SUM(jl.debit), 0) AS sd,
             COALESCE(SUM(jl.credit), 0) AS sc
      FROM accounting_journal_entries je
      LEFT JOIN accounting_journal_lines jl ON jl.journal_entry_id = je.id
      WHERE je.entity_id = ? AND je.status = 'posted' AND je.date >= ? AND je.date <= ?
      GROUP BY je.id, je.number, je.date
      HAVING ABS(sd - sc) > 0.01
    `).all(entityId, start, end);
    for (const je of unbalancedJes) {
      foundAnomalies.push({
        kind: "unbalanced_period",
        severity: "critical",
        subject_kind: "journal_entry",
        subject_id: je.id,
        detail: { number: je.number, date: je.date, debits: je.sd, credits: je.sc, diff: Math.round((je.sd - je.sc) * 100) / 100 },
      });
    }

    // 2) Benford's law on expense + revenue amounts
    const amounts = db.prepare(`
      SELECT jl.debit + jl.credit AS amt
      FROM accounting_journal_lines jl
      INNER JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
      INNER JOIN accounting_coa c ON c.id = jl.account_id
      WHERE je.entity_id = ? AND je.status = 'posted' AND je.date >= ? AND je.date <= ?
        AND c.type IN ('revenue','expense')
    `).all(entityId, start, end).map((r) => r.amt);
    if (amounts.length >= 30) {
      const benford = benfordTest(amounts);
      if (benford.ok && benford.violates) {
        foundAnomalies.push({
          kind: "benford_violation",
          severity: "high",
          subject_kind: "period",
          detail: { chiSquared: benford.chiSquared, n: benford.n, distribution: benford.distribution },
        });
      }
    }

    // 3) Round-number cluster
    if (amounts.length >= 10) {
      const round = roundNumberCluster(amounts);
      if (round.ok && round.suspicious) {
        foundAnomalies.push({
          kind: "round_number_cluster",
          severity: "medium",
          subject_kind: "period",
          detail: { roundCount: round.count, total: round.total, pctRound: round.pctRound },
        });
      }
    }

    // 4) Duplicate invoice numbers within entity (different customers, same total + similar issued_date)
    const dupes = db.prepare(`
      SELECT customer_name, total, COUNT(*) AS n
      FROM accounting_invoices
      WHERE entity_id = ? AND status NOT IN ('voided','refunded') AND issued_date >= ? AND issued_date <= ?
      GROUP BY customer_name, total
      HAVING COUNT(*) > 1
    `).all(entityId, start, end);
    for (const d of dupes) {
      foundAnomalies.push({
        kind: "duplicate_invoice",
        severity: "medium",
        subject_kind: "invoice",
        detail: { customerName: d.customer_name, total: d.total, count: d.n },
      });
    }

    // 5) Negative-equity check (balance sheet equity total < 0)
    const equityRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN c.normal_balance = 'credit' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END), 0) AS net
      FROM accounting_journal_lines jl
      INNER JOIN accounting_coa c ON c.id = jl.account_id
      INNER JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
      WHERE c.entity_id = ? AND c.type = 'equity' AND je.status = 'posted' AND je.date <= ?
    `).get(entityId, end);
    if (equityRow && equityRow.net < 0) {
      foundAnomalies.push({
        kind: "negative_equity",
        severity: "high",
        subject_kind: "period",
        detail: { equityNet: Math.round(equityRow.net * 100) / 100 },
      });
    }

    // Persist
    const ins = db.prepare(`
      INSERT INTO accounting_anomalies (id, entity_id, kind, severity, period_start, period_end, subject_kind, subject_id, detail_json, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const a of foundAnomalies) {
        ins.run(`anom:${randomUUID()}`, entityId, a.kind, a.severity, start, end,
          a.subject_kind || null, a.subject_id || null,
          JSON.stringify(a.detail || {}), _now());
      }
    });
    tx();
    _recordAiRun(db, { entityId, userId, kind: "anomaly_scan", inputSummary: `${start}..${end}`, outputSummary: `${foundAnomalies.length} anomalies`, source: "deterministic" });
    return { ok: true, periodStart: start, periodEnd: end, anomalies: foundAnomalies, count: foundAnomalies.length };
  }, { destructive: true, note: "Scan a period for anomalies: unbalanced JEs, Benford's law violations, round-number clusters, duplicate invoices, negative equity." });

  register("accounting", "anomaly_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const unackOnly = input.unackOnly !== false;
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    const rows = unackOnly
      ? db.prepare(`SELECT * FROM accounting_anomalies WHERE entity_id = ? AND acknowledged_at IS NULL ORDER BY detected_at DESC LIMIT ?`).all(entityId, limit)
      : db.prepare(`SELECT * FROM accounting_anomalies WHERE entity_id = ? ORDER BY detected_at DESC LIMIT ?`).all(entityId, limit);
    return { ok: true, anomalies: rows.map((r) => ({ ...r, detail: _safeJson(r.detail_json, {}) })), count: rows.length };
  }, { note: "List anomalies for an entity (unacknowledged by default)" });

  register("accounting", "anomaly_acknowledge", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const note = input.note ? String(input.note).slice(0, 500) : null;
    const r = db.prepare(`UPDATE accounting_anomalies SET acknowledged_at = ?, acknowledged_by = ?, resolution_note = ? WHERE id = ?`).run(_now(), userId, note, id);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Acknowledge an anomaly with optional resolution note" });

  // ─── Narrative composer ─────────────────────────────────────

  register("accounting", "narrative_compose", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const kind = ["profit_loss","balance_sheet","variance","cashflow","tax_summary","audit_summary"].includes(input.kind) ? input.kind : "profit_loss";
    const tone = ["plain","executive","accountant","tax","founder"].includes(input.tone) ? input.tone : "plain";
    const t0 = Date.now();

    // Fetch the underlying report
    const { computeProfitLoss, computeBalanceSheet } = await import("../lib/accounting/persistence.js");
    let report = null;
    if (kind === "profit_loss") report = computeProfitLoss(db, entityId, { startDate: input.startDate, endDate: input.endDate });
    else if (kind === "balance_sheet") report = computeBalanceSheet(db, entityId, { asOfDate: input.asOfDate });
    if (!report) return { ok: false, reason: "report_unavailable" };

    // Deterministic prose
    let prose = "";
    const bullets = [];
    if (kind === "profit_loss") {
      prose = `For ${report.period.startDate} through ${report.period.endDate}, total revenue was ${report.totalRevenue.toFixed(2)} and total expenses were ${report.totalExpenses.toFixed(2)}, producing net income of ${report.netIncome.toFixed(2)}.`;
      const topExp = [...report.expenses].sort((a, b) => b.balance - a.balance).slice(0, 3);
      if (topExp.length) {
        bullets.push(`Top 3 expense categories: ${topExp.map((e) => `${e.name} (${e.balance.toFixed(2)})`).join(", ")}`);
      }
      const margin = report.totalRevenue > 0 ? (report.netIncome / report.totalRevenue * 100).toFixed(1) : "0.0";
      bullets.push(`Net margin: ${margin}%`);
    } else if (kind === "balance_sheet") {
      prose = `As of ${report.asOfDate}, total assets stand at ${report.totalAssets.toFixed(2)}, liabilities at ${report.totalLiabilities.toFixed(2)}, and equity at ${report.totalEquity.toFixed(2)}. The balance sheet ${report.isBalanced ? "ties out cleanly" : "does NOT balance — investigate"}.`;
      bullets.push(`Current period net income contribution to equity: ${report.netIncome.toFixed(2)}`);
    }

    const llm = ctx?.llm;
    if (!llm?.chat || input.deterministic) {
      const id = `narr:${randomUUID()}`;
      db.prepare(`
        INSERT INTO accounting_ai_narratives (id, entity_id, kind, period_start, period_end, narrative, bullets_json, tone, source, tokens, composed_by, composed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deterministic', 0, ?, ?)
      `).run(id, entityId, kind,
        report.period?.startDate || report.asOfDate || null,
        report.period?.endDate || report.asOfDate || null,
        prose, JSON.stringify(bullets), tone, userId, _now());
      _recordAiRun(db, { entityId, userId, kind: "narrative", inputSummary: kind, outputSummary: prose.slice(0, 200), source: "deterministic", latencyMs: Date.now() - t0 });
      return { ok: true, id, narrative: prose, bullets, source: "deterministic" };
    }

    const toneInstruction = {
      plain: "Plain language. Avoid jargon.",
      executive: "Executive summary. 2-3 sentences. High-level, decision-focused.",
      accountant: "Use accounting terminology. Cite specific account categories.",
      tax: "Frame for tax-filing context. Note deductibility implications.",
      founder: "Founder-friendly. Connect to growth + runway + burn.",
    }[tone];

    const sys = `You are a financial analyst. Given this ${kind} report, write a 2-4 sentence narrative in this tone:
${toneInstruction}

Then provide 3-5 bullet-point highlights. Output ONLY this JSON object:
{ "narrative": "<prose>", "bullets": ["...", "..."] }`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: JSON.stringify(report).slice(0, 4000) },
        ],
        temperature: 0.4, maxTokens: 600, slot: "subconscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJsonObject(raw);
      const useNarrative = parsed?.narrative || prose;
      const useBullets = Array.isArray(parsed?.bullets) ? parsed.bullets.slice(0, 8) : bullets;
      const id = `narr:${randomUUID()}`;
      db.prepare(`
        INSERT INTO accounting_ai_narratives (id, entity_id, kind, period_start, period_end, narrative, bullets_json, tone, source, tokens, composed_by, composed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'llm', ?, ?, ?)
      `).run(id, entityId, kind,
        report.period?.startDate || report.asOfDate || null,
        report.period?.endDate || report.asOfDate || null,
        useNarrative, JSON.stringify(useBullets), tone, 400, userId, _now());
      _recordAiRun(db, { entityId, userId, kind: "narrative", inputSummary: kind, outputSummary: useNarrative.slice(0, 200), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, id, narrative: useNarrative, bullets: useBullets, source: parsed ? "llm" : "fallback" };
    } catch (err) {
      return { ok: true, narrative: prose, bullets, source: "fallback", reason: "llm_error", error: err?.message };
    }
  }, { note: "Compose narrative prose for a financial report (P&L / balance sheet / variance) with selectable tone." });

  register("accounting", "narratives_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const rows = db.prepare(`SELECT * FROM accounting_ai_narratives WHERE entity_id = ? ORDER BY composed_at DESC LIMIT 100`).all(entityId);
    return { ok: true, narratives: rows.map((r) => ({ ...r, bullets: _safeJson(r.bullets_json, []) })) };
  }, { note: "Recent narratives for this entity" });

  // ─── Receipt extraction (LLaVA-style vision; deterministic fallback) ──

  register("accounting", "receipt_extract", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const { imageB64, imageUrl, sourceKind = "image", sourceUri = null } = input;
    const t0 = Date.now();
    let extracted = {
      vendor: input.vendor || null,
      total: Number(input.total) || null,
      taxAmount: Number(input.taxAmount) || null,
      receiptDate: input.receiptDate || null,
      lineItems: Array.isArray(input.lineItems) ? input.lineItems : [],
    };
    let source = "manual";

    if (imageB64 || imageUrl) {
      try {
        const vision = await import("../lib/vision-inference.js");
        const prompt = `Extract receipt data as JSON: { "vendor": "...", "total": number, "tax": number, "date": "YYYY-MM-DD", "lineItems": [{"description":"...","quantity":N,"unitPrice":N,"total":N}] }. Output JSON only.`;
        const raw = imageB64
          ? await _withTimeout(vision.callVision(imageB64, prompt))
          : await _withTimeout(vision.callVisionUrl(imageUrl, prompt));
        const text = String(raw?.text || raw?.content || raw || "").trim();
        const parsed = _extractJsonObject(text);
        if (parsed) {
          extracted = {
            vendor: parsed.vendor || extracted.vendor,
            total: Number(parsed.total) || extracted.total,
            taxAmount: Number(parsed.tax) || extracted.taxAmount,
            receiptDate: parsed.date || extracted.receiptDate,
            lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : extracted.lineItems,
          };
          source = "vision";
        } else { source = "fallback"; }
      } catch { source = "fallback"; }
    }

    // Suggest account via deterministic categorizer
    const accounts = listCoa(db, entityId);
    const codes = new Set(accounts.map((a) => a.code));
    const memo = `${extracted.vendor || ""} ${extracted.lineItems.map((l) => l.description).join(" ")}`.trim();
    const det = suggestCategoryDeterministic(memo, codes);
    const suggestedAccount = det ? accounts.find((a) => a.code === det.code) : null;
    const confidence = source === "vision" ? 0.8 : det ? det.confidence : 0.3;

    const id = `recext:${randomUUID()}`;
    db.prepare(`
      INSERT INTO accounting_receipt_extractions (id, entity_id, uploader_id, source_kind, source_uri, vendor_name, total, tax_amount, currency, receipt_date, line_items_json, suggested_account_id, confidence, source, extracted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entityId, userId,
      ["image","pdf","email","manual"].includes(sourceKind) ? sourceKind : "image",
      sourceUri,
      extracted.vendor || null,
      extracted.total || null,
      extracted.taxAmount || null,
      input.currency || "concord_coin",
      extracted.receiptDate || null,
      JSON.stringify(extracted.lineItems),
      suggestedAccount?.id || null,
      confidence,
      source, _now());
    _recordAiRun(db, { entityId, userId, kind: "receipt_extract", inputSummary: extracted.vendor || "unknown", outputSummary: `total=${extracted.total} acc=${suggestedAccount?.code || "?"}`, source, latencyMs: Date.now() - t0 });
    return { ok: true, id, extracted, suggestedAccountId: suggestedAccount?.id, suggestedAccountCode: suggestedAccount?.code, confidence, source };
  }, { destructive: true, note: "Extract structured receipt data via LLaVA vision (with image) or pass manual fields. Returns suggested CoA account." });

  register("accounting", "receipt_extractions_pending", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const rows = db.prepare(`SELECT * FROM accounting_receipt_extractions WHERE entity_id = ? AND journal_entry_id IS NULL ORDER BY extracted_at DESC LIMIT 200`).all(entityId);
    return { ok: true, extractions: rows.map((r) => ({ ...r, line_items: _safeJson(r.line_items_json, []) })) };
  }, { note: "Pending receipt extractions awaiting JE conversion" });

  register("accounting", "receipt_convert_to_je", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const id = String(input.id || "");
    const cashAccountId = String(input.cashAccountId || input.creditAccountId || "");
    const expenseAccountId = String(input.expenseAccountId || input.debitAccountId || "");
    if (!cashAccountId || !expenseAccountId) return { ok: false, reason: "cashAccountId_and_expenseAccountId_required" };
    const ext = db.prepare(`SELECT * FROM accounting_receipt_extractions WHERE id = ? AND entity_id = ?`).get(id, entityId);
    if (!ext) return { ok: false, reason: "not_found" };
    if (ext.journal_entry_id) return { ok: false, reason: "already_converted" };
    if (!ext.total || ext.total <= 0) return { ok: false, reason: "total_missing_or_zero" };
    const { postJournalEntry } = await import("../lib/accounting/persistence.js");
    const r = postJournalEntry(db, entityId, {
      date: ext.receipt_date || new Date().toISOString().slice(0, 10),
      memo: `Receipt: ${ext.vendor_name || "unknown"}`,
      lines: [
        { accountId: expenseAccountId, debit: ext.total, credit: 0, memo: ext.vendor_name || "expense" },
        { accountId: cashAccountId,    debit: 0,         credit: ext.total, memo: "payment" },
      ],
      source: `receipt:${ext.id}`,
      postedBy: userId,
    });
    if (!r.ok) return r;
    db.prepare(`UPDATE accounting_receipt_extractions SET journal_entry_id = ?, converted_at = ? WHERE id = ?`).run(r.id, _now(), id);
    return { ok: true, journalEntryId: r.id, number: r.number };
  }, { destructive: true, note: "Convert an extracted receipt to a posted JE (debit expense, credit cash)" });

  register("accounting", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const rows = db.prepare(`SELECT * FROM accounting_ai_runs WHERE entity_id = ? ORDER BY created_at DESC LIMIT 200`).all(entityId);
    return { ok: true, runs: rows };
  }, { note: "Recent AI invocations (categorize / anomaly_scan / narrative / receipt_extract)" });
}
