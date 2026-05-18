// server/tests/accounting-rebuild-sprint-c.test.js
//
// Tier-2 contract tests for accounting Sprint C (moats): statement
// mint + cite cascade, template marketplace, multi-entity
// consolidation, audit-trail with SHA-256 hash chain.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAccountingRebuildMacros from "../domains/accounting-rebuild.js";
import registerAccountingMoatsMacros from "../domains/accounting-moats.js";
import {
  createEntity, getOrSeedDefaultEntity, listCoa, postJournalEntry,
} from "../lib/accounting/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["234_accounting_rebuild", "235_accounting_ai", "236_accounting_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Minimal dtus table stub
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, creator_id TEXT, meta_json TEXT, created_at INTEGER DEFAULT (unixepoch()))`);
  registerAccountingRebuildMacros(register);
  registerAccountingMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Statement mint + cite ──────────────────────────────────

describe("statement_mint + cite cascade", () => {
  it("mints P&L as DTU with royalty cap 30%", async () => {
    const e = getOrSeedDefaultEntity(db, "u_mint");
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const rev = accs.find((a) => a.code === "4010");
    postJournalEntry(db, e.id, {
      date: "2026-04-15",
      lines: [{ accountId: cash.id, debit: 2000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 2000 }],
      postedBy: "u_mint",
    });
    const r = await MACROS.get("statement_mint")(ctx("u_mint"), {
      kind: "profit_loss",
      startDate: "2026-04-01", endDate: "2026-04-30",
      royaltyRate: 0.99,  // try to overflow — should clamp to 30%
    });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("acc_stmt:"));
    assert.equal(r.royaltyRate, 0.30);
    // Verify DTU row created
    const dtu = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(r.dtuId);
    assert.ok(dtu);
    assert.equal(dtu.kind, "accounting_statement");
  });

  it("mint with invalid kind rejected (after entity resolution)", async () => {
    getOrSeedDefaultEntity(db, "u_bad_kind");
    const r = await MACROS.get("statement_mint")(ctx("u_bad_kind"), { kind: "WHATEVER" });
    assert.equal(r.reason, "invalid_kind");
  });

  it("statement_mints_list returns mints for entity", async () => {
    const r = await MACROS.get("statement_mints_list")(ctx("u_mint"));
    assert.ok(r.mints.length >= 1);
  });

  it("statement_cite_dtu requires parent DTU + degrades gracefully when engine absent", async () => {
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:taskparent', 'task', 'Parent', 'u_other', '{}')`).run();
    const e = getOrSeedDefaultEntity(db, "u_cite");
    const m = await MACROS.get("statement_mint")(ctx("u_cite"), { kind: "balance_sheet" });
    const mintRow = db.prepare(`SELECT id FROM accounting_statement_mints WHERE dtu_id = ?`).get(m.dtuId);
    const r = await MACROS.get("statement_cite_dtu")(ctx("u_cite"), { mintId: mintRow.id, parentDtuId: "dtu:taskparent" });
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId.startsWith("acc_stmt:"));
    // Cascade may or may not have engine in test — just verify the call returned
    assert.ok(r.cascade);
  });
});

// ─── Template marketplace ──────────────────────────────────

describe("template_mint + browse + install", () => {
  it("mints a CoA template as DTU", async () => {
    const payload = {
      accounts: [
        { code: "8100", name: "R&D Expense", type: "expense" },
        { code: "8200", name: "Marketing Expense", type: "expense" },
      ],
    };
    const r = await MACROS.get("template_mint")(ctx("u_tmpl"), {
      kind: "coa_template",
      title: "SaaS Startup Chart",
      description: "Common accounts for SaaS startups",
      payload,
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "coa_template");
  });

  it("template_browse returns published templates", async () => {
    const r = await MACROS.get("template_browse")(ctx("u_browse"), { kind: "coa_template" });
    assert.equal(r.ok, true);
    assert.ok(r.templates.find((t) => t.title === "SaaS Startup Chart"));
  });

  it("template_install adds accounts + bumps install_count", async () => {
    const browse = await MACROS.get("template_browse")(ctx("u_inst"), { kind: "coa_template" });
    const tmpl = browse.templates.find((t) => t.title === "SaaS Startup Chart");
    // Make sure u_inst has an entity
    getOrSeedDefaultEntity(db, "u_inst");
    const r = await MACROS.get("template_install")(ctx("u_inst"), { templateId: tmpl.id });
    assert.equal(r.ok, true);
    assert.equal(r.installed, 2);
    // Verify accounts were created
    const entity = db.prepare(`SELECT id FROM accounting_entities WHERE owner_user_id = 'u_inst' AND archived_at IS NULL`).get();
    const accounts = listCoa(db, entity.id);
    assert.ok(accounts.find((a) => a.code === "8100"));
    // install_count bumped
    const after = db.prepare(`SELECT install_count FROM accounting_template_mints WHERE id = ?`).get(tmpl.id);
    assert.equal(after.install_count, 1);
  });

  it("re-install is idempotent (alreadyInstalled flag)", async () => {
    const browse = await MACROS.get("template_browse")(ctx("u_inst2"), { kind: "coa_template" });
    const tmpl = browse.templates.find((t) => t.title === "SaaS Startup Chart");
    getOrSeedDefaultEntity(db, "u_inst2");
    await MACROS.get("template_install")(ctx("u_inst2"), { templateId: tmpl.id });
    const r2 = await MACROS.get("template_install")(ctx("u_inst2"), { templateId: tmpl.id });
    assert.equal(r2.ok, true);
    assert.equal(r2.alreadyInstalled, true);
  });

  it("rule_pack template installs categorization rules", async () => {
    const e = getOrSeedDefaultEntity(db, "u_rule");
    const rent = listCoa(db, e.id).find((a) => a.code === "6010");
    const r = await MACROS.get("template_mint")(ctx("u_rule"), {
      kind: "rule_pack",
      title: "Rent Rules",
      payload: { rules: [{ pattern: "WeWork", patternKind: "substring", targetCode: "6010" }] },
    });
    const browse = await MACROS.get("template_browse")(ctx("u_install_rules"), { kind: "rule_pack" });
    const tmpl = browse.templates.find((t) => t.title === "Rent Rules");
    getOrSeedDefaultEntity(db, "u_install_rules");
    const inst = await MACROS.get("template_install")(ctx("u_install_rules"), { templateId: tmpl.id });
    assert.equal(inst.ok, true);
    assert.equal(inst.installed, 1);
  });
});

// ─── Multi-entity consolidation ───────────────────────────

describe("multi-entity consolidate", () => {
  it("sums P&L across parent + child entities", async () => {
    const parent = createEntity(db, "u_cons", { name: "HoldCo", kind: "corp" });
    const sub1 = createEntity(db, "u_cons", { name: "Sub A", kind: "llc" });
    const sub2 = createEntity(db, "u_cons", { name: "Sub B", kind: "llc" });
    // Parent: 5000 rev
    const pAccs = listCoa(db, parent.id);
    postJournalEntry(db, parent.id, {
      date: "2026-03-15",
      lines: [{ accountId: pAccs.find((a) => a.code === "1010").id, debit: 5000, credit: 0 }, { accountId: pAccs.find((a) => a.code === "4010").id, debit: 0, credit: 5000 }],
      postedBy: "u_cons",
    });
    // Sub1: 1000 rev
    const s1Accs = listCoa(db, sub1.id);
    postJournalEntry(db, sub1.id, {
      date: "2026-03-15",
      lines: [{ accountId: s1Accs.find((a) => a.code === "1010").id, debit: 1000, credit: 0 }, { accountId: s1Accs.find((a) => a.code === "4010").id, debit: 0, credit: 1000 }],
      postedBy: "u_cons",
    });
    // Sub2: 2000 rev, 500 rent
    const s2Accs = listCoa(db, sub2.id);
    postJournalEntry(db, sub2.id, {
      date: "2026-03-15",
      lines: [{ accountId: s2Accs.find((a) => a.code === "1010").id, debit: 2000, credit: 0 }, { accountId: s2Accs.find((a) => a.code === "4010").id, debit: 0, credit: 2000 }],
      postedBy: "u_cons",
    });
    postJournalEntry(db, sub2.id, {
      date: "2026-03-20",
      lines: [{ accountId: s2Accs.find((a) => a.code === "6010").id, debit: 500, credit: 0 }, { accountId: s2Accs.find((a) => a.code === "1010").id, debit: 0, credit: 500 }],
      postedBy: "u_cons",
    });
    const r = await MACROS.get("consolidate")(ctx("u_cons"), {
      parentEntityId: parent.id,
      childEntityIds: [sub1.id, sub2.id],
      startDate: "2026-03-01", endDate: "2026-03-31",
    });
    assert.equal(r.ok, true);
    assert.equal(r.totalRevenue, 8000);
    assert.equal(r.totalExpenses, 500);
    assert.equal(r.netIncome, 7500);
    assert.equal(r.perEntity.length, 3);
  });

  it("rejects child entity not owned by user", async () => {
    const parent = createEntity(db, "u_cross", { name: "Parent" });
    const otherSub = createEntity(db, "u_other", { name: "OtherSub" });
    const r = await MACROS.get("consolidate")(ctx("u_cross"), {
      parentEntityId: parent.id,
      childEntityIds: [otherSub.id],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "child_forbidden");
  });
});

// ─── Audit-trail hash chain ───────────────────────────────

describe("audit_trail hash chain", () => {
  it("emit + verify round-trip succeeds", async () => {
    const e = getOrSeedDefaultEntity(db, "u_audit");
    const r1 = await MACROS.get("audit_trail_emit")(ctx("u_audit"), { eventKind: "je_posted", subjectId: "je:1" });
    const r2 = await MACROS.get("audit_trail_emit")(ctx("u_audit"), { eventKind: "invoice_paid", subjectId: "inv:1" });
    const r3 = await MACROS.get("audit_trail_emit")(ctx("u_audit"), { eventKind: "account_archived", subjectId: "acc:1" });
    assert.equal(r1.ok, true);
    assert.ok(r1.hashChain.length === 64); // SHA-256 hex
    assert.notEqual(r1.hashChain, r2.hashChain); // chain advances
    const verify = await MACROS.get("audit_trail_verify")(ctx("u_audit"));
    assert.equal(verify.verified, true);
    assert.equal(verify.totalRows, 3);
    assert.equal(verify.tampered.length, 0);
  });

  it("tampering with hash_chain is detected by verify", async () => {
    const e = getOrSeedDefaultEntity(db, "u_tamper");
    await MACROS.get("audit_trail_emit")(ctx("u_tamper"), { eventKind: "je_posted", subjectId: "je:t1" });
    await MACROS.get("audit_trail_emit")(ctx("u_tamper"), { eventKind: "je_posted", subjectId: "je:t2" });
    // Tamper: change the second row's hash
    const row = db.prepare(`SELECT id FROM accounting_audit_trail_dtus WHERE entity_id = ? ORDER BY id DESC LIMIT 1`).get(e.id);
    db.prepare(`UPDATE accounting_audit_trail_dtus SET hash_chain = 'tampered_hash_value_aaaaaa' WHERE id = ?`).run(row.id);
    const verify = await MACROS.get("audit_trail_verify")(ctx("u_tamper"));
    assert.equal(verify.verified, false);
    assert.ok(verify.tampered.length >= 1);
  });

  it("invalid eventKind rejected (after entity resolution)", async () => {
    getOrSeedDefaultEntity(db, "u_aud_bad");
    const r = await MACROS.get("audit_trail_emit")(ctx("u_aud_bad"), { eventKind: "weird" });
    assert.equal(r.reason, "invalid_eventKind");
  });

  it("audit_trail_list returns recent events", async () => {
    const r = await MACROS.get("audit_trail_list")(ctx("u_audit"));
    assert.ok(r.audit.length >= 3);
  });
});
