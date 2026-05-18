// server/domains/accounting-moats.js
//
// Accounting lens rebuild Sprint C — concord-native moats. Mint
// statements + templates as DTUs (royalty cascade on adoption), multi-
// entity consolidation, audit-trail DTUs with hash chain, cross-lens
// cite cascade (invoice ↔ task/calendar/chat).

import { randomUUID, createHash } from "node:crypto";
import {
  computeTrialBalance, computeBalanceSheet, computeProfitLoss, computeInvoiceAging,
  createAccount, listCoa, createBudget,
} from "../lib/accounting/persistence.js";

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

function _ensureDtuRow(db, { id, kind, title, creatorId, meta }) {
  // Insert a DTU row if a dtus table is present (test envs may not have it)
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, kind, String(title).slice(0, 200), creatorId, JSON.stringify(meta || {}));
  } catch { /* table missing in test env — moot */ }
}

const VALID_VIS = new Set(["private","workspace","public","published","global"]);

export default function registerAccountingMoatsMacros(register) {

  // ─── Mint financial statement as DTU ─────────────────────────

  register("accounting", "statement_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const kind = ["trial_balance","balance_sheet","profit_loss","invoice_aging","cash_flow","tax_summary"].includes(input.kind) ? input.kind : null;
    if (!kind) return { ok: false, reason: "invalid_kind" };
    let payload = null;
    if (kind === "trial_balance") payload = computeTrialBalance(db, entityId, { asOfDate: input.asOfDate });
    else if (kind === "balance_sheet") payload = computeBalanceSheet(db, entityId, { asOfDate: input.asOfDate });
    else if (kind === "profit_loss") payload = computeProfitLoss(db, entityId, { startDate: input.startDate, endDate: input.endDate });
    else if (kind === "invoice_aging") payload = computeInvoiceAging(db, entityId, { asOfDate: input.asOfDate });
    if (!payload) return { ok: false, reason: "report_compute_failed" };
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "private";
    const allowCitation = input.allowCitation === false ? 0 : 1;
    const dtuId = `acc_stmt:${randomUUID()}`;
    const title = `${kind.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} — ${payload.period?.startDate ? `${payload.period.startDate}..${payload.period.endDate}` : payload.asOfDate || "current"}`;
    try {
      const tx = db.transaction(() => {
        _ensureDtuRow(db, {
          id: dtuId, kind: "accounting_statement", title,
          creatorId: userId,
          meta: { type: "accounting_statement", kind, entityId, payload, royalty_rate: royaltyRate, visibility },
        });
        db.prepare(`
          INSERT INTO accounting_statement_mints (entity_id, statement_kind, period_start, period_end, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(entityId, kind,
          payload.period?.startDate || payload.asOfDate || null,
          payload.period?.endDate || payload.asOfDate || null,
          dtuId, userId, royaltyRate, visibility, allowCitation, _now());
      });
      tx();
      return { ok: true, dtuId, kind, title, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a financial statement (P&L / balance sheet / aging / etc) as a citable accounting_statement DTU. Royalty clamped to 30%." });

  register("accounting", "statement_cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const mintId = Number(input.mintId);
    const parentDtuId = String(input.parentDtuId || input.dtuId || "");
    if (!mintId || !parentDtuId) return { ok: false, reason: "mintId_and_parentDtuId_required" };
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM accounting_statement_mints WHERE id = ?`).get(mintId);
    if (!mint || mint.creator_id !== userId) return { ok: false, reason: "not_found" };
    let parentDtu = null;
    try { parentDtu = db.prepare(`SELECT id, creator_id, kind, meta_json FROM dtus WHERE id = ?`).get(parentDtuId); } catch { /* no dtus */ }
    if (!parentDtu) return { ok: false, reason: "parent_dtu_not_found" };
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const r = registerCitation(db, {
        childId: mint.dtu_id, parentId: parentDtu.id,
        creatorId: mint.creator_id, parentCreatorId: parentDtu.creator_id,
        parentDtu, hasPurchasedLicense: !!input.hasPurchasedLicense, generation: 1,
      });
      if (r.ok) db.prepare(`UPDATE accounting_statement_mints SET citation_count = citation_count + 1 WHERE id = ?`).run(mintId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: r };
    } catch (err) {
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Cite a minted statement against a parent DTU (invoice ↔ task / calendar / chat) — fires royalty cascade." });

  register("accounting", "statement_mints_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const rows = db.prepare(`SELECT * FROM accounting_statement_mints WHERE entity_id = ? ORDER BY minted_at DESC LIMIT 100`).all(entityId);
    return { ok: true, mints: rows };
  }, { note: "List minted statements for an entity" });

  // ─── Templates marketplace ──────────────────────────────────

  register("accounting", "template_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const kind = ["coa_template","budget_template","tax_template","rule_pack"].includes(input.kind) ? input.kind : null;
    if (!kind) return { ok: false, reason: "invalid_kind" };
    const title = String(input.title || "").trim();
    const payload = input.payload;
    if (!title || !payload) return { ok: false, reason: "title_and_payload_required" };
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "public";
    const dtuId = `acc_tmpl:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        _ensureDtuRow(db, {
          id: dtuId, kind: "accounting_template", title,
          creatorId: userId,
          meta: { type: "accounting_template", kind, payload, royalty_rate: royaltyRate, visibility, description: input.description || null },
        });
        db.prepare(`
          INSERT INTO accounting_template_mints (kind, title, description, payload_json, dtu_id, creator_id, royalty_rate, visibility, install_count, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(kind, title.slice(0, 200), input.description ? String(input.description).slice(0, 600) : null,
          JSON.stringify(payload), dtuId, userId, royaltyRate, visibility, _now());
      });
      tx();
      return { ok: true, dtuId, kind, royaltyRate };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Publish a CoA template / budget template / rule pack as a marketplace DTU" });

  register("accounting", "template_browse", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const kind = ["coa_template","budget_template","tax_template","rule_pack"].includes(input.kind) ? input.kind : null;
    const filters = ["visibility IN ('public','published','global')"];
    const args = [];
    if (kind) { filters.push("kind = ?"); args.push(kind); }
    args.push(Math.min(Math.max(1, Number(input.limit) || 50), 200));
    const rows = db.prepare(`
      SELECT id, kind, title, description, dtu_id, creator_id, royalty_rate, install_count, minted_at
      FROM accounting_template_mints WHERE ${filters.join(" AND ")}
      ORDER BY install_count DESC, minted_at DESC LIMIT ?
    `).all(...args);
    return { ok: true, templates: rows, count: rows.length };
  }, { note: "Browse the marketplace for accounting templates (CoA / budget / tax / rule packs)" });

  register("accounting", "template_install", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const mintId = Number(input.templateId || input.mintId);
    if (!mintId) return { ok: false, reason: "templateId_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const template = db.prepare(`SELECT * FROM accounting_template_mints WHERE id = ?`).get(mintId);
    if (!template) return { ok: false, reason: "not_found" };
    if (!["public","published","global","workspace"].includes(template.visibility)) return { ok: false, reason: "not_published" };
    const existing = db.prepare(`SELECT id FROM accounting_template_installs WHERE template_mint_id = ? AND target_entity_id = ?`).get(mintId, entityId);
    if (existing) return { ok: true, alreadyInstalled: true };
    const payload = _safeJson(template.payload_json, null);
    if (!payload) return { ok: false, reason: "invalid_payload" };

    let installed = 0;
    try {
      const tx = db.transaction(() => {
        // Apply payload based on template kind
        if (template.kind === "coa_template" && Array.isArray(payload.accounts)) {
          for (const a of payload.accounts) {
            const r = createAccount(db, entityId, a);
            if (r.ok) installed++;
          }
        } else if (template.kind === "budget_template" && payload.budget) {
          const b = payload.budget;
          // Need to map account_codes → account_ids in this entity
          const coa = listCoa(db, entityId);
          const codeToId = new Map(coa.map((a) => [a.code, a.id]));
          const lines = (b.lines || []).map((l) => ({ accountId: codeToId.get(l.code), amount: l.amount, notes: l.notes }))
            .filter((l) => l.accountId);
          const r = createBudget(db, entityId, { name: b.name, periodStart: b.periodStart, periodEnd: b.periodEnd, lines, createdBy: userId });
          if (r.ok) installed = 1;
        } else if (template.kind === "rule_pack" && Array.isArray(payload.rules)) {
          const coa = listCoa(db, entityId);
          const codeToId = new Map(coa.map((a) => [a.code, a.id]));
          const ins = db.prepare(`
            INSERT INTO accounting_categorization_rules (id, entity_id, pattern, pattern_kind, target_account_id, priority, created_by, source, enabled, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', 1, ?)
          `);
          for (const rule of payload.rules) {
            const acctId = rule.targetAccountId || codeToId.get(rule.targetCode);
            if (!acctId) continue;
            try {
              ins.run(`rule:${randomUUID()}`, entityId, rule.pattern, rule.patternKind || "substring", acctId, rule.priority || 100, userId, _now());
              installed++;
            } catch { /* dup pattern, skip */ }
          }
        }
        db.prepare(`INSERT INTO accounting_template_installs (template_mint_id, target_entity_id, installer_id, installed_at) VALUES (?, ?, ?, ?)`).run(mintId, entityId, userId, _now());
        db.prepare(`UPDATE accounting_template_mints SET install_count = install_count + 1 WHERE id = ?`).run(mintId);
      });
      tx();
      return { ok: true, installed, kind: template.kind, templateId: mintId };
    } catch (err) {
      return { ok: false, reason: "install_failed", error: err?.message };
    }
  }, { destructive: true, note: "Install a marketplace template into my entity (CoA accounts / budget / categorization rules)" });

  // ─── Multi-entity consolidation ─────────────────────────────

  register("accounting", "consolidate", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const parentEntityId = String(input.parentEntityId || "");
    const childEntityIds = Array.isArray(input.childEntityIds) ? input.childEntityIds : [];
    if (!parentEntityId || childEntityIds.length === 0) return { ok: false, reason: "parentEntityId_and_childEntityIds_required" };
    // Ownership check on every entity
    const parent = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(parentEntityId);
    if (!parent || parent.owner_user_id !== userId) return { ok: false, reason: "parent_forbidden" };
    for (const childId of childEntityIds) {
      const child = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(childId);
      if (!child || child.owner_user_id !== userId) return { ok: false, reason: "child_forbidden", entityId: childId };
    }
    const startDate = input.startDate || `${new Date().getFullYear()}-01-01`;
    const endDate = input.endDate || new Date().toISOString().slice(0, 10);

    // Compute P&L for parent + each child + sum
    const consolidated = { revenues: new Map(), expenses: new Map(), totalRevenue: 0, totalExpenses: 0, netIncome: 0 };
    const perEntity = [];
    const allEntities = [parentEntityId, ...childEntityIds];
    for (const eid of allEntities) {
      const pl = computeProfitLoss(db, eid, { startDate, endDate });
      perEntity.push({ entityId: eid, pl });
      for (const r of pl.revenues) {
        const k = `${r.code}|${r.name}`;
        const cur = consolidated.revenues.get(k) || { code: r.code, name: r.name, balance: 0 };
        cur.balance += r.balance;
        consolidated.revenues.set(k, cur);
      }
      for (const e of pl.expenses) {
        const k = `${e.code}|${e.name}`;
        const cur = consolidated.expenses.get(k) || { code: e.code, name: e.name, balance: 0 };
        cur.balance += e.balance;
        consolidated.expenses.set(k, cur);
      }
      consolidated.totalRevenue += pl.totalRevenue;
      consolidated.totalExpenses += pl.totalExpenses;
      consolidated.netIncome += pl.netIncome;
    }
    const result = {
      period: { startDate, endDate },
      revenues: [...consolidated.revenues.values()].sort((a, b) => a.code.localeCompare(b.code)),
      expenses: [...consolidated.expenses.values()].sort((a, b) => a.code.localeCompare(b.code)),
      totalRevenue: Math.round(consolidated.totalRevenue * 100) / 100,
      totalExpenses: Math.round(consolidated.totalExpenses * 100) / 100,
      netIncome: Math.round(consolidated.netIncome * 100) / 100,
      perEntity,
    };
    const id = `cons:${randomUUID()}`;
    db.prepare(`
      INSERT INTO accounting_consolidations (id, parent_entity_id, child_entity_ids_json, period_start, period_end, result_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, parentEntityId, JSON.stringify(childEntityIds), startDate, endDate, JSON.stringify(result), userId, _now());
    return { ok: true, id, ...result };
  }, { destructive: true, note: "Consolidate P&L across parent + child entities for a period" });

  register("accounting", "consolidations_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const parentEntityId = String(input.parentEntityId || "");
    if (!parentEntityId) return { ok: false, reason: "parentEntityId_required" };
    const ent = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(parentEntityId);
    if (!ent || ent.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT id, parent_entity_id, child_entity_ids_json, period_start, period_end, created_at FROM accounting_consolidations WHERE parent_entity_id = ? ORDER BY created_at DESC LIMIT 50`).all(parentEntityId);
    return { ok: true, consolidations: rows.map((r) => ({ ...r, child_entity_ids: _safeJson(r.child_entity_ids_json, []) })) };
  }, { note: "List recent consolidation runs for a parent entity" });

  // ─── Audit-trail DTUs (hash-chained immutable log) ───────────

  register("accounting", "audit_trail_emit", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const eventKind = ["je_posted","je_voided","invoice_paid","account_archived","consolidation_run","period_locked","template_installed"].includes(input.eventKind) ? input.eventKind : null;
    if (!eventKind) return { ok: false, reason: "invalid_eventKind" };
    const subjectId = input.subjectId ? String(input.subjectId) : null;
    // Look up the previous hash in the chain
    const prev = db.prepare(`SELECT hash_chain FROM accounting_audit_trail_dtus WHERE entity_id = ? ORDER BY id DESC LIMIT 1`).get(entityId);
    const prevHash = prev?.hash_chain || "";
    const rowContent = JSON.stringify({ entityId, eventKind, subjectId, actorId: userId, ts: _now() });
    const hashChain = createHash("sha256").update(prevHash + rowContent).digest("hex");
    const dtuId = `acc_audit:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        _ensureDtuRow(db, {
          id: dtuId, kind: "accounting_audit", title: `Audit: ${eventKind} ${subjectId || ""}`.slice(0, 200),
          creatorId: userId,
          meta: { type: "accounting_audit", entityId, eventKind, subjectId, hashChain, prevHash },
        });
        db.prepare(`
          INSERT INTO accounting_audit_trail_dtus (entity_id, event_kind, subject_id, dtu_id, hash_chain, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(entityId, eventKind, subjectId, dtuId, hashChain, userId, _now());
      });
      tx();
      return { ok: true, dtuId, hashChain };
    } catch (err) {
      return { ok: false, reason: "emit_failed", error: err?.message };
    }
  }, { destructive: true, note: "Emit an audit-trail DTU with SHA-256 hash chain. Each row's hash includes the previous row's hash, making tampering detectable." });

  register("accounting", "audit_trail_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 100), 500);
    const rows = db.prepare(`SELECT id, event_kind, subject_id, dtu_id, hash_chain, actor_id, created_at FROM accounting_audit_trail_dtus WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?`).all(entityId, limit);
    return { ok: true, audit: rows };
  }, { note: "Audit trail for an entity" });

  register("accounting", "audit_trail_verify", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    // Re-compute the chain from scratch + compare
    const rows = db.prepare(`SELECT id, event_kind, subject_id, hash_chain, actor_id, created_at FROM accounting_audit_trail_dtus WHERE entity_id = ? ORDER BY id ASC`).all(entityId);
    let prevHash = "";
    const tampered = [];
    for (const r of rows) {
      const rowContent = JSON.stringify({ entityId, eventKind: r.event_kind, subjectId: r.subject_id, actorId: r.actor_id, ts: r.created_at });
      const expected = createHash("sha256").update(prevHash + rowContent).digest("hex");
      if (expected !== r.hash_chain) tampered.push({ id: r.id, expected, actual: r.hash_chain });
      prevHash = r.hash_chain;
    }
    return { ok: true, verified: tampered.length === 0, totalRows: rows.length, tampered };
  }, { note: "Verify the audit-trail hash chain. Returns verified=false + list of tampered rows if hashes don't match." });
}
