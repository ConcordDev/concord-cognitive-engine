// server/tests/vault-permanence-wiring.test.js
//
// The integration seam between TWO units that landed separately: TheVault's
// curated archive (`server/domains/vault.js`) and the DTU permanence system
// (`server/lib/dtu-protection.js`). Each was correct in isolation and the
// pair did not connect, in three independent ways:
//
//   1. A Vault record is minted by a raw `INSERT INTO dtus` and never touches
//      `STATE.dtus`/`dtu_store`, so `protectDtuInStore` — which starts with
//      `store.get(id)` — returned `{ok:false, reason:'dtu_not_found'}` for
//      100% of admissions. Wiring the seam naively would have produced an
//      honest-but-useless failure on every single record.
//   2. `vault.js#setAdmissionProtectionHandler` had no registered handler at
//      all, so every admission reported `no_handler_registered`.
//   3. The archive's permanence held only by ACCIDENT: the one real deletion
//      threat to a `dtus` row is `account-lifecycle.js`'s
//      `DELETE FROM dtus WHERE owner_user_id = ?`, and Vault's INSERT happens
//      to omit that column. Setting it for correctness would have made every
//      admitted record deletable on account closure.
//
// Every assertion below runs BOTH DIRECTIONS where a direction exists — a
// retention guard that keeps everything is exactly as broken as one that
// keeps nothing, so each retention test is paired with a control proving the
// unprotected sibling is still really deleted.
//
// Real in-memory better-sqlite3, real migration files, real
// `executeAccountDeletion`, and the REAL boot-time registration read out of
// `server/domains/index.js` (not a hand-rolled stand-in — the wiring is half
// of what is under test).
//
// Run: node --test server/tests/vault-permanence-wiring.test.js

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upCore } from "../migrations/001_core_tables.js";
import { up as upEconomy } from "../migrations/008_economic_system.js";
import { up as upConsent } from "../migrations/032_consent_layer.js";
import { up as upDtuCols } from "../migrations/087_dtus_type_creator_data.js";
import { up as upDtuWorld } from "../migrations/225_dtu_world_id.js";
import { up as upVault } from "../migrations/396_vault_records.js";

import {
  protectDtuRow,
  unprotectDtuRow,
  isDtuRowProtected,
  verifyDtuRowIntegrity,
  listProtectedDtuIdsForOwner,
  dtuRowToRecord,
  protectDtuInStore,
  isDtuProtected,
} from "../lib/dtu-protection.js";

import {
  installFoundingCurator, submit, admit,
  setAdmissionProtectionHandler, getAdmissionProtectionHandler,
  VAULT_WORLD_ID,
} from "../domains/vault.js";

import { executeAccountDeletion } from "../lib/account-lifecycle.js";

const CURATOR = "user_founder";
const SUBMITTER = "user_maker";
const OTHER = "user_bystander";

const STATEMENT =
  "Admitted because the recording keeps a room's silence in a way I have not " +
  "heard attempted elsewhere, and it should outlast the feed that buried it.";

// ── The real boot-time wiring ───────────────────────────────────────────────
// `server.js` does `domainModules.forEach(mod => mod(registerLensAction))`.
// We pull the SAME array and invoke the SAME entry, so a rename, a reorder or
// a deletion of that registration fails this file rather than silently
// reverting the archive to "nothing is registered".
let bootRegisterVaultProtection = null;

before(async () => {
  const { default: domainModules } = await import("../domains/index.js");
  bootRegisterVaultProtection =
    domainModules.find((m) => m && m.name === "registerVaultAdmissionProtection") || null;
  assert.ok(
    bootRegisterVaultProtection,
    "domains/index.js must export a registerVaultAdmissionProtection entry — without it no admission is ever protected",
  );
});

after(() => setAdmissionProtectionHandler(null));

function migrate(db) {
  upCore(db);
  upEconomy(db);
  upConsent(db);
  upDtuCols(db);
  upDtuWorld(db);
  upVault(db);
  return db;
}

function freshDb() {
  return migrate(new Database(":memory:"));
}

/** A plain (non-vault) DTU row, written the way domains do it. */
function insertDtuRow(db, id, { owner = null, creator = null, data = {}, title = "A work", type = "knowledge" } = {}) {
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, title, type, creator_id, data, visibility, tier)
    VALUES (?, ?, ?, ?, ?, ?, 'public', 'regular')
  `).run(id, owner, title, type, creator, JSON.stringify(data));
  return id;
}

function readData(db, id) {
  const row = db.prepare("SELECT data FROM dtus WHERE id = ?").get(id);
  return row ? JSON.parse(row.data) : null;
}

function seedUser(db, id) {
  db.prepare(
    "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', datetime('now'))",
  ).run(id, id, `${id}@example.test`);
}

// ═══════════════════════════════════════════════════════════════════════════
// A. The `dtus`-table protection path
// ═══════════════════════════════════════════════════════════════════════════

describe("A. protection reaches records that live in the `dtus` table", () => {
  let db;
  // better-sqlite3 enforces foreign keys by default and migration 001 declares
  // `dtus.owner_user_id REFERENCES users(id)`, so an owned fixture needs a
  // real user row.
  beforeEach(() => { db = freshDb(); seedUser(db, SUBMITTER); seedUser(db, OTHER); });

  it("protectDtuInStore genuinely CANNOT reach a `dtus`-table record (the seam being closed)", () => {
    insertDtuRow(db, "dtu_row_1", { data: { human: { summary: "s" } } });
    // The write-through store's substrate is `dtu_store`, a different table.
    const emptyStore = new Map();
    const r = protectDtuInStore(emptyStore, "dtu_row_1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dtu_not_found");
  });

  it("protectDtuRow stamps + persists, and the record then reports protected", () => {
    insertDtuRow(db, "dtu_row_2", { data: { human: { summary: "s" }, core: { claims: ["c"] } } });
    assert.equal(isDtuRowProtected(db, "dtu_row_2"), false, "control: not protected before");

    const r = protectDtuRow(db, "dtu_row_2", { reason: "unit_test" });
    assert.equal(r.ok, true);
    assert.equal(r.protected, true);
    assert.equal(r.column, "data");
    assert.match(r.contentSha256, /^[0-9a-f]{64}$/, "full sha256, not the 16-hex runtime hash");

    assert.equal(isDtuRowProtected(db, "dtu_row_2"), true);

    // Both legacy flag vocabularies were persisted, so the forgetting engine
    // (`_pinned`) and demoteToArchive (`protected`) both honour it.
    const data = readData(db, "dtu_row_2");
    assert.equal(data.protected, true);
    assert.equal(data._pinned, true);
    assert.equal(data.protection.protected, true);
    assert.equal(data.protection.reason, "unit_test");
  });

  it("survives a reopen — the protection is in SQLite, not in memory", () => {
    insertDtuRow(db, "dtu_row_3", { data: { human: { summary: "s" } } });
    protectDtuRow(db, "dtu_row_3");
    const roundTripped = db.prepare("SELECT data FROM dtus WHERE id = ?").get("dtu_row_3").data;
    // A brand-new handle over the same serialized row — no shared JS object.
    const db2 = freshDb();
    insertDtuRow(db2, "dtu_row_3", {});
    db2.prepare("UPDATE dtus SET data = ? WHERE id = ?").run(roundTripped, "dtu_row_3");
    assert.equal(isDtuRowProtected(db2, "dtu_row_3"), true);
    assert.equal(verifyDtuRowIntegrity(db2, "dtu_row_3").verified, true);
  });

  it("verifyDtuIntegrity catches a tamper on the `dtus`-table path too — both directions", () => {
    insertDtuRow(db, "dtu_row_4", {
      data: { human: { summary: "original" }, core: { claims: ["the ledger balanced"] } },
    });
    protectDtuRow(db, "dtu_row_4");

    const clean = verifyDtuRowIntegrity(db, "dtu_row_4");
    assert.equal(clean.ok, true);
    assert.equal(clean.verified, true, "untampered record must verify");

    // Rewrite a HASHED field (core), preserving the protection block.
    const data = readData(db, "dtu_row_4");
    data.core.claims = ["the ledger did NOT balance"];
    db.prepare("UPDATE dtus SET data = ? WHERE id = ?").run(JSON.stringify(data), "dtu_row_4");

    const tampered = verifyDtuRowIntegrity(db, "dtu_row_4");
    assert.equal(tampered.ok, true);
    assert.equal(tampered.verified, false, "a rewritten claim must be detected");
    assert.notEqual(tampered.expected, tampered.actual);
  });

  it("does NOT false-alarm on the attribution rewrite a lawful erasure performs", () => {
    insertDtuRow(db, "dtu_row_5", {
      data: { human: { summary: "s" }, core: { claims: ["c"] } },
      owner: SUBMITTER,
    });
    protectDtuRow(db, "dtu_row_5");
    // Exactly what account deletion / migration 001's ON DELETE SET NULL do.
    db.prepare("UPDATE dtus SET owner_user_id = NULL WHERE id = ?").run("dtu_row_5");
    assert.equal(
      verifyDtuRowIntegrity(db, "dtu_row_5").verified, true,
      "owner_user_id is deliberately outside the hashed projection — GDPR erasure must not read as tampering",
    );
  });

  it("reports honest failures rather than fabricating success", () => {
    assert.deepEqual(protectDtuRow(db, "dtu_missing"), { ok: false, reason: "dtu_not_found", dtuId: "dtu_missing" });
    assert.deepEqual(protectDtuRow(null, "x"), { ok: false, reason: "no_db" });
    assert.deepEqual(protectDtuRow(db, ""), { ok: false, reason: "missing_dtu_id" });
    const v = verifyDtuRowIntegrity(db, "dtu_missing");
    assert.equal(v.ok, false);
    assert.equal(v.reason, "dtu_not_found");

    insertDtuRow(db, "dtu_row_6", { data: { human: { summary: "s" } } });
    const unprotectedVerify = verifyDtuRowIntegrity(db, "dtu_row_6");
    assert.equal(unprotectedVerify.ok, false);
    assert.equal(unprotectedVerify.reason, "not_protected");
  });

  it("unprotectDtuRow releases durably, keeping the integrity record as an audit trail", () => {
    insertDtuRow(db, "dtu_row_7", { data: { human: { summary: "s" } } });
    protectDtuRow(db, "dtu_row_7");
    const r = unprotectDtuRow(db, "dtu_row_7");
    assert.equal(r.ok, true);
    assert.equal(r.protected, false);
    assert.equal(isDtuRowProtected(db, "dtu_row_7"), false);
    const data = readData(db, "dtu_row_7");
    assert.equal(data.protection.protected, false);
    assert.ok(data.protection.releasedAt, "the hash it once carried is retained, not erased");
    assert.match(data.protection.contentSha256, /^[0-9a-f]{64}$/);
  });

  it("works on migration 001's `body_json`-only schema (no `data` column)", () => {
    const legacy = new Database(":memory:");
    upCore(legacy); // 001 only — no `data`/`creator_id`/`type` columns
    seedUser(legacy, SUBMITTER);
    legacy.prepare("INSERT INTO dtus (id, owner_user_id, title, body_json) VALUES (?,?,?,?)")
      .run("dtu_legacy", SUBMITTER, "Legacy", JSON.stringify({ human: { summary: "legacy" } }));

    const r = protectDtuRow(legacy, "dtu_legacy");
    assert.equal(r.ok, true);
    assert.equal(r.column, "body_json", "falls back to the original payload column");
    assert.equal(isDtuRowProtected(legacy, "dtu_legacy"), true);
    assert.equal(verifyDtuRowIntegrity(legacy, "dtu_legacy").verified, true);
    legacy.close();
  });

  it("dtuRowToRecord projects columns onto the runtime field names the hash uses", () => {
    insertDtuRow(db, "dtu_row_8", {
      owner: SUBMITTER, creator: SUBMITTER, title: "Titled", type: "vault_record",
      data: { human: { summary: "s" }, machine: { tags: ["vault", "x"] } },
    });
    const row = db.prepare("SELECT * FROM dtus WHERE id = ?").get("dtu_row_8");
    const rec = dtuRowToRecord(row);
    assert.equal(rec.id, "dtu_row_8");
    assert.equal(rec.title, "Titled");
    assert.equal(rec.type, "vault_record");
    assert.equal(rec.creator, SUBMITTER, "creator_id IS hashed — anonymization leaves it alone");
    assert.equal(rec.ownerUserId, undefined, "owner_user_id is deliberately NOT projected");
    assert.deepEqual(rec.tags, ["vault", "x"], "machine.tags surfaces so PROTECTED_TAGS applies");
  });

  it("listProtectedDtuIdsForOwner returns protected ids and ONLY protected ids", () => {
    insertDtuRow(db, "dtu_keep", { owner: SUBMITTER, data: { human: { summary: "keep" } } });
    insertDtuRow(db, "dtu_drop", { owner: SUBMITTER, data: { human: { summary: "drop" } } });
    insertDtuRow(db, "dtu_other", { owner: OTHER, data: { human: { summary: "other" } } });
    protectDtuRow(db, "dtu_keep");
    protectDtuRow(db, "dtu_other");

    assert.deepEqual(listProtectedDtuIdsForOwner(db, SUBMITTER), ["dtu_keep"]);
    assert.deepEqual(listProtectedDtuIdsForOwner(db, OTHER), ["dtu_other"], "scoped per owner");
    assert.deepEqual(listProtectedDtuIdsForOwner(db, null), []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. The admission handshake
// ═══════════════════════════════════════════════════════════════════════════

describe("B. admission actually protects the record it mints", () => {
  let db;

  function admitOne(statement = STATEMENT) {
    const s = submit(db, SUBMITTER, { title: "Room Tone", workKind: "music", description: "d" });
    assert.equal(s.ok, true);
    const r = admit(db, s.id, { curatorId: CURATOR, curatorStatement: statement });
    return { submissionId: s.id, result: r };
  }

  beforeEach(() => {
    db = freshDb();
    installFoundingCurator(db, { curatorId: CURATOR, displayName: "The Founder" });
    setAdmissionProtectionHandler(null);
  });

  it("CONTROL: with nothing registered, admission reports the honest un-applied state", () => {
    const { submissionId, result } = admitOne();
    assert.equal(result.ok, true);
    assert.deepEqual(result.protection, { applied: false, reason: "no_handler_registered" });
    assert.equal(
      db.prepare("SELECT protection_flags_json FROM vault_submissions WHERE id = ?").get(submissionId).protection_flags_json,
      null,
    );

    // No integrity anchor was stamped — nothing to verify against.
    assert.equal(readData(db, result.recordDtuId).protection, undefined);
    assert.equal(verifyDtuRowIntegrity(db, result.recordDtuId).reason, "not_protected");

    // Note the record IS already `isDtuRowProtected` here, from `PROTECTED_TAGS`
    // matching the "vault" tag `admit()` writes into `machine.tags` — the
    // module's documented belt-and-braces layer, which the deletion guard in
    // section C honours. That layer asserts "do not destroy this"; it carries
    // no hash, so it cannot assert "and here is proof it is unaltered". The
    // handler is what adds the second claim.
    assert.equal(isDtuRowProtected(db, result.recordDtuId), true);
  });

  it("with the REAL boot registration installed, the record is protected and verifiable", () => {
    bootRegisterVaultProtection();
    assert.ok(getAdmissionProtectionHandler(), "boot entry must install a handler");

    const { submissionId, result } = admitOne();
    assert.equal(result.ok, true);
    assert.equal(result.protection.applied, true);
    assert.equal(result.protection.flags.protected, true);
    assert.equal(result.protection.flags.protectedBy, CURATOR);
    assert.match(result.protection.flags.contentSha256, /^[0-9a-f]{64}$/);

    // The record itself — the thing the promise is about.
    assert.equal(isDtuRowProtected(db, result.recordDtuId), true);
    const v = verifyDtuRowIntegrity(db, result.recordDtuId);
    assert.equal(v.ok, true);
    assert.equal(v.verified, true);

    // And it is durable in the submission row, not just in the return value.
    const persisted = JSON.parse(
      db.prepare("SELECT protection_flags_json FROM vault_submissions WHERE id = ?").get(submissionId).protection_flags_json,
    );
    assert.equal(persisted.protected, true);
    assert.equal(persisted.contentSha256, result.protection.flags.contentSha256);
    assert.equal(persisted.source, "vault_admission");

    // The stamped hash covers the curator's statement: tampering with the
    // sacred artifact after admission is detectable.
    const data = readData(db, result.recordDtuId);
    data.core.admission.curatorStatement = "Something the curator never wrote.";
    db.prepare("UPDATE dtus SET data = ? WHERE id = ?").run(JSON.stringify(data), result.recordDtuId);
    assert.equal(verifyDtuRowIntegrity(db, result.recordDtuId).verified, false);
  });

  it("the world_id / column convention the record is minted with is unchanged", () => {
    bootRegisterVaultProtection();
    const { result } = admitOne();
    const row = db.prepare("SELECT world_id, creator_id, visibility FROM dtus WHERE id = ?").get(result.recordDtuId);
    assert.equal(row.world_id, VAULT_WORLD_ID);
    assert.equal(row.creator_id, SUBMITTER, "creator is the submitter — protection does not rewrite attribution");
    assert.equal(row.visibility, "public");
  });

  it("a THROWING handler never reverses the human's admission", () => {
    setAdmissionProtectionHandler(() => { throw new Error("pin service down"); });
    const { submissionId, result } = admitOne();

    assert.equal(result.ok, true, "the admission stands");
    assert.equal(result.status, "admitted");
    assert.equal(result.protection.applied, false);
    assert.equal(result.protection.reason, "handler_threw");

    const row = db.prepare("SELECT status, curator_statement, record_dtu_id FROM vault_submissions WHERE id = ?").get(submissionId);
    assert.equal(row.status, "admitted");
    assert.equal(row.curator_statement, STATEMENT, "the curator's prose survives a failing protection service");
    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = ?").get(row.record_dtu_id), "the record was still minted");
  });

  it("the registered handler reports an honest reason instead of fabricating protection", () => {
    bootRegisterVaultProtection();
    const handler = getAdmissionProtectionHandler();
    const flags = handler({ db, recordDtuId: "dtu_does_not_exist", curatorId: CURATOR });
    assert.equal(flags.protected, false, "never true unless a row was really stamped");
    assert.equal(flags.reason, "dtu_not_found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Account deletion — retention WITHOUT over-retention
// ═══════════════════════════════════════════════════════════════════════════

describe("C. account deletion retains protected records and still deletes the rest", () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    seedUser(db, SUBMITTER);
    seedUser(db, OTHER);
    installFoundingCurator(db, { curatorId: CURATOR, displayName: "The Founder" });
    setAdmissionProtectionHandler(null);
  });

  it("BOTH DIRECTIONS: the protected DTU survives (anonymized) and the unprotected one is deleted", () => {
    insertDtuRow(db, "dtu_permanent", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "permanent" } } });
    insertDtuRow(db, "dtu_ordinary", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "ordinary" } } });
    insertDtuRow(db, "dtu_bystander", { owner: OTHER, creator: OTHER, data: { human: { summary: "not mine" } } });
    protectDtuRow(db, "dtu_permanent");

    const r = executeAccountDeletion(db, SUBMITTER);
    assert.equal(r.ok, true, `deletion failed: ${JSON.stringify(r)}`);

    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_permanent"), "protected record must survive");
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_ordinary"), undefined,
      "unprotected record must STILL be deleted — a guard that retains everything is as broken as one that retains nothing");
    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_bystander"), "no cross-user bleed");

    // Retained, but the personal attribution is erased — the GDPR remedy, the
    // same one this function already applies to cited DTUs.
    const anon = db.prepare("SELECT * FROM anonymized_attributions WHERE dtu_id = ?").get("dtu_permanent");
    assert.ok(anon, "a retained record must be anonymized, not merely kept");
    assert.equal(anon.original_user_id, SUBMITTER);
    assert.equal(r.stats.retainedProtected, 1);

    // The work itself is untouched — retention keeps the record, not the person.
    assert.equal(readData(db, "dtu_permanent").human.summary, "permanent");
    assert.equal(isDtuRowProtected(db, "dtu_permanent"), true);
    assert.equal(verifyDtuRowIntegrity(db, "dtu_permanent").verified, true,
      "the integrity claim still holds after a lawful erasure");

    // And the user really is gone.
    assert.equal(db.prepare("SELECT id FROM users WHERE id = ?").get(SUBMITTER), undefined);
  });

  it("an ADMITTED Vault record survives its submitter's account closure, end to end", () => {
    bootRegisterVaultProtection();
    const s = submit(db, SUBMITTER, { title: "Room Tone", workKind: "music", description: "d" });
    const admitted = admit(db, s.id, { curatorId: CURATOR, curatorStatement: STATEMENT });
    assert.equal(admitted.protection.flags.protected, true);

    // The correctness fix that used to be fatal: set the ownership column the
    // Vault INSERT omits. Before this unit, THIS line alone deleted the
    // archive's record on account closure.
    db.prepare("UPDATE dtus SET owner_user_id = ? WHERE id = ?").run(SUBMITTER, admitted.recordDtuId);
    // A second, ordinary DTU by the same person — the control.
    insertDtuRow(db, "dtu_ordinary_2", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "ordinary" } } });

    const r = executeAccountDeletion(db, SUBMITTER);
    assert.equal(r.ok, true, `deletion failed: ${JSON.stringify(r)}`);

    const record = db.prepare("SELECT data FROM dtus WHERE id = ?").get(admitted.recordDtuId);
    assert.ok(record, "an admitted Vault record must be permanent");
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_ordinary_2"), undefined,
      "the same user's ordinary DTU is still deleted");

    // The curator's statement — the artifact that re-derives from nothing.
    const data = JSON.parse(record.data);
    assert.equal(data.core.admission.curatorStatement, STATEMENT);
    assert.equal(data.core.admission.curatorDisplayName, "The Founder");
    assert.equal(verifyDtuRowIntegrity(db, admitted.recordDtuId).verified, true);
  });

  it("a record protected only by its archive TAG is retained too (belt and braces)", () => {
    // No explicit stamp — `PROTECTED_TAGS` alone, exactly the shape
    // `vault.js#admit` writes into `machine.tags`.
    insertDtuRow(db, "dtu_tagged", {
      owner: SUBMITTER, creator: SUBMITTER,
      data: { human: { summary: "tagged" }, machine: { tags: ["vault", "vault_record"] } },
    });
    insertDtuRow(db, "dtu_untagged", {
      owner: SUBMITTER, creator: SUBMITTER,
      data: { human: { summary: "untagged" }, machine: { tags: ["music", "demo"] } },
    });

    const r = executeAccountDeletion(db, SUBMITTER);
    assert.equal(r.ok, true);
    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_tagged"));
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_untagged"), undefined,
      "an ordinary tag list confers nothing");
  });

  it("a DTU that is BOTH cited and protected is anonymized exactly once", () => {
    insertDtuRow(db, "dtu_both", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "both" } } });
    protectDtuRow(db, "dtu_both");
    db.prepare(`
      INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator)
      VALUES ('rl_1', 'dtu_child', 'dtu_both', 1, ?, ?)
    `).run(OTHER, SUBMITTER);

    const r = executeAccountDeletion(db, SUBMITTER);
    assert.equal(r.ok, true);
    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_both"));
    assert.equal(
      db.prepare("SELECT COUNT(*) c FROM anonymized_attributions WHERE dtu_id = ?").get("dtu_both").c, 1,
      "no double anonymization",
    );
  });

  it("the FALLBACK delete path preserves the retention guarantee too", () => {
    // The fallback fires when the json_each exclusion query fails. It used to
    // be an unqualified `DELETE FROM dtus WHERE owner_user_id = ?`, which
    // would have destroyed exactly the records the steps above just decided to
    // keep. Forced here by making that one prepare() throw.
    insertDtuRow(db, "dtu_permanent_fb", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "permanent" } } });
    insertDtuRow(db, "dtu_ordinary_fb", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "ordinary" } } });
    protectDtuRow(db, "dtu_permanent_fb");

    const brokenJsonEach = new Proxy(db, {
      get(target, prop, recv) {
        if (prop === "prepare") {
          return (sql) => {
            if (typeof sql === "string" && sql.includes("json_each")) throw new Error("json_each unavailable");
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

    const r = executeAccountDeletion(brokenJsonEach, SUBMITTER);
    assert.equal(r.ok, true, `deletion failed: ${JSON.stringify(r)}`);
    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_permanent_fb"),
      "the fallback must not destroy what the retain step kept");
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_ordinary_fb"), undefined,
      "and it must still delete the rest");
  });

  it("released protection means the record IS deletable again — the guard is not one-way", () => {
    insertDtuRow(db, "dtu_released", { owner: SUBMITTER, creator: SUBMITTER, data: { human: { summary: "released" } } });
    protectDtuRow(db, "dtu_released");
    assert.deepEqual(listProtectedDtuIdsForOwner(db, SUBMITTER), ["dtu_released"]);
    unprotectDtuRow(db, "dtu_released");
    assert.deepEqual(listProtectedDtuIdsForOwner(db, SUBMITTER), []);
    assert.equal(isDtuProtected(dtuRowToRecord(db.prepare("SELECT * FROM dtus WHERE id=?").get("dtu_released"))), false);

    const r = executeAccountDeletion(db, SUBMITTER);
    assert.equal(r.ok, true);
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = ?").get("dtu_released"), undefined);
  });
});
