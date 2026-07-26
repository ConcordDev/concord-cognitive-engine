// server/tests/vault-admission.test.js
//
// TheVault — the curated-archive state machine (submitted -> under_review ->
// admitted | declined, plus submitter-initiated withdrawn) against a REAL
// in-memory better-sqlite3 DB, migrated with the actual migration files
// (001 core `dtus`, 008 `royalty_lineage`, 087 the type/creator_id/data
// columns, 225 `dtus.world_id`, 396 the vault tables). Mirrors the
// real-DB / scripted-input / no-live-brain style of
// tests/conkay-tool-authoring.test.js.
//
// The four hard invariants each get their own describe block, and each is
// asserted at BOTH layers where it is enforced (domain lib + SQLite CHECK)
// wherever both exist:
//
//   1. No admission without a non-empty, human-authored curator statement.
//   2. Every admission carries a named human curator; machine-assembled
//      evidence lives apart and can never satisfy the human field.
//   3. Declines are private — the public browse path cannot return them.
//   4. Guest-curator attribution — a guest's induction is the GUEST's.
//
// Plus: the DTU column convention the record is written with is asserted
// against the two readers that actually depend on it, with a control row
// proving the OTHER convention really is invisible to them.
//
// Run: node --test server/tests/vault-admission.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upCore } from "../migrations/001_core_tables.js";
import { up as upEconomy } from "../migrations/008_economic_system.js";
import { up as upDtuCols } from "../migrations/087_dtus_type_creator_data.js";
import { up as upDtuWorld } from "../migrations/225_dtu_world_id.js";
import { up as upVault } from "../migrations/396_vault_records.js";

import { searchDtus } from "../lib/cross-lens-discovery.js";
import { propPlacementsForWorld } from "../lib/dtu-props.js";

import registerVaultActions, {
  installFoundingCurator, inviteGuestCurator, retireCurator, listCurators, getCurator,
  submit, openReview, withdraw, admit, decline,
  browse, publicRecord, curatorQueue, mySubmissions,
  statementIsMachineEvidence,
  setAdmissionProtectionHandler,
  VAULT_WORLD_ID, VAULT_DTU_TYPE, MIN_CURATOR_STATEMENT_CHARS,
} from "../domains/vault.js";

const FOUNDER = "user_founder";
const GUEST = "user_guest";
const SUBMITTER = "user_maker";

// A real, human-length statement. Deliberately not derived from any
// machine-evidence fixture below.
const STATEMENT =
  "Accepted into TheVault because the third movement does something with silence " +
  "that I have not heard anyone else attempt, and it deserves to outlast the feed.";

function setup({ withDtus = true, withFounder = true } = {}) {
  const db = new Database(":memory:");
  if (withDtus) {
    upCore(db);
    upEconomy(db);
    upDtuCols(db);
    upDtuWorld(db);
  }
  upVault(db);
  if (withFounder) {
    const r = installFoundingCurator(db, { curatorId: FOUNDER, displayName: "Founding Curator" });
    assert.equal(r.ok, true, `founding curator install failed: ${JSON.stringify(r)}`);
  }
  return db;
}

function submitWork(db, over = {}) {
  const r = submit(db, SUBMITTER, {
    title: "Three Movements for an Empty Room",
    workKind: "music",
    description: "A short suite.",
    body: "notation…",
    ...over,
  });
  assert.equal(r.ok, true, `submit failed: ${JSON.stringify(r)}`);
  return r.id;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("state machine — submitted -> under_review -> admitted | declined | withdrawn", () => {
  it("a fresh Vault is EMPTY — no seeded curators, submissions or records", () => {
    const db = new Database(":memory:");
    upCore(db); upEconomy(db); upDtuCols(db); upDtuWorld(db); upVault(db);
    assert.deepEqual(listCurators(db), []);
    assert.deepEqual(browse(db), { ok: true, records: [], count: 0 });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vault_submissions").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus WHERE type = ?").get(VAULT_DTU_TYPE).n, 0);
  });

  it("submit -> open_review -> admit walks the full happy path", () => {
    const db = setup();
    const id = submitWork(db);
    assert.equal(db.prepare("SELECT status FROM vault_submissions WHERE id=?").get(id).status, "submitted");

    const opened = openReview(db, id, FOUNDER);
    assert.equal(opened.ok, true);
    assert.equal(opened.status, "under_review");

    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, "admitted");
    assert.match(r.recordDtuId, /^dtu_vault_/);
  });

  it("admission is terminal — a second admit and a post-admission withdraw are both refused", () => {
    const db = setup();
    const id = submitWork(db);
    assert.equal(admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT }).ok, true);

    const again = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "wrong_state");
    assert.equal(again.status, "admitted");

    // "Admitted works become permanent records" — enforced, not just stated.
    const w = withdraw(db, id, SUBMITTER, "changed my mind");
    assert.equal(w.ok, false);
    assert.equal(w.reason, "admitted_records_are_permanent");
  });

  it("a submitter may withdraw while still under consideration; a stranger may not", () => {
    const db = setup();
    const id = submitWork(db);
    assert.equal(withdraw(db, id, "someone_else", "nope").reason, "not_submitter");
    const w = withdraw(db, id, SUBMITTER, "not ready");
    assert.equal(w.ok, true);
    assert.equal(w.status, "withdrawn");
    // Withdrawn is terminal for curators too.
    assert.equal(admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT }).reason, "wrong_state");
  });

  it("an admission whose record cannot be minted rolls back WHOLLY — no orphan 'admitted' row", () => {
    // Vault tables present, `dtus` absent (minimal build): the DTU insert
    // throws inside the transaction, so the status flip must not survive.
    const db = setup({ withDtus: false });
    const id = submitWork(db);
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "record_mint_failed");
    const row = db.prepare("SELECT status, record_dtu_id, curator_statement FROM vault_submissions WHERE id=?").get(id);
    assert.equal(row.status, "submitted");
    assert.equal(row.record_dtu_id, null);
    assert.equal(row.curator_statement, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("INVARIANT 1 — no admission without a non-empty, human-authored curator statement", () => {
  for (const [label, statement] of [
    ["missing (undefined)", undefined],
    ["missing (null)", null],
    ["empty string", ""],
    ["whitespace only (spaces)", "     "],
    ["whitespace only (tabs + newlines)", "\t\n\r\n \t"],
    ["non-string", 12345],
  ]) {
    it(`refuses an admission with a ${label} statement`, () => {
      const db = setup();
      const id = submitWork(db);
      const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: statement });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "curator_statement_required");
      // Nothing was written — not the status, not a record.
      const row = db.prepare("SELECT status, record_dtu_id FROM vault_submissions WHERE id=?").get(id);
      assert.equal(row.status, "submitted");
      assert.equal(row.record_dtu_id, null);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus WHERE type=?").get(VAULT_DTU_TYPE).n, 0);
    });
  }

  it("refuses a placeholder statement below the meaningful floor", () => {
    const db = setup();
    const id = submitWork(db);
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: "." });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "curator_statement_too_short");
    assert.equal(r.minChars, MIN_CURATOR_STATEMENT_CHARS);
  });

  it("accepts a real statement and stores it verbatim, attributed to its author", () => {
    const db = setup();
    const id = submitWork(db);
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: `  ${STATEMENT}  ` });
    assert.equal(r.ok, true);
    const row = db.prepare("SELECT * FROM vault_submissions WHERE id=?").get(id);
    assert.equal(row.curator_statement, STATEMENT);       // trimmed, otherwise verbatim
    assert.equal(row.curator_statement_by, FOUNDER);
    assert.equal(row.curator_statement_by, row.admitted_by);
  });

  it("SQLITE ITSELF refuses an admitted row with no statement — a raw UPDATE cannot bypass the lib", () => {
    const db = setup();
    const id = submitWork(db);

    // The exact shape a future caller might reach for to "just mark it admitted".
    assert.throws(
      () => db.prepare(
        `UPDATE vault_submissions SET status='admitted', admitted_at=unixepoch(),
           admitted_by=?, admitted_by_role='founding_curator' WHERE id=?`,
      ).run(FOUNDER, id),
      /CHECK constraint failed: chk_vault_admission_requires_human/,
    );

    // Whitespace-only is refused at the storage layer too, not just in the lib.
    assert.throws(
      () => db.prepare(
        `UPDATE vault_submissions SET status='admitted', admitted_at=unixepoch(),
           curator_statement='   ', curator_statement_by=?, admitted_by=?,
           admitted_by_role='founding_curator' WHERE id=?`,
      ).run(FOUNDER, FOUNDER, id),
      /CHECK constraint failed: chk_vault_admission_requires_human/,
    );

    assert.equal(db.prepare("SELECT status FROM vault_submissions WHERE id=?").get(id).status, "submitted");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("INVARIANT 2 — every admission carries a named human curator; machine evidence never suffices", () => {
  // A rich, entirely plausible machine-assembled evidence bundle — exactly
  // what an AI "helping organize evidence" would produce.
  const MACHINE_EVIDENCE = {
    assembledBy: "concord.analysis.pipeline",
    signals: [
      "Structural analysis: 3 movements, unusual 7/8 metre in the third.",
      "Corpus comparison: no close match among 412 archived works.",
      "Citation graph: referenced by 4 later submissions.",
    ],
    scores: { novelty: 0.91, coherence: 0.88 },
    recommendation: "This work is highly novel and structurally coherent; admission is indicated.",
  };

  it("machine-assembled evidence ALONE cannot produce an admission", () => {
    const db = setup();
    const id = submitWork(db);

    // Everything a machine can supply, and nothing a human wrote.
    const r = admit(db, id, { curatorId: FOUNDER, machineEvidence: MACHINE_EVIDENCE });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "curator_statement_required");

    // …and with no curator either: still nothing.
    const r2 = admit(db, id, { machineEvidence: MACHINE_EVIDENCE });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "curator_required");

    const row = db.prepare("SELECT status, machine_evidence_json, curator_statement FROM vault_submissions WHERE id=?").get(id);
    assert.equal(row.status, "submitted");
    assert.equal(row.machine_evidence_json, null); // a refused admission stores nothing at all
    assert.equal(row.curator_statement, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus WHERE type=?").get(VAULT_DTU_TYPE).n, 0);
  });

  it("a machine actor is not a curator — an unregistered/system id is refused by name", () => {
    const db = setup();
    const id = submitWork(db);
    for (const machineActor of ["concord.analysis.pipeline", "system", "agent_curator_bot"]) {
      const r = admit(db, id, { curatorId: machineActor, curatorStatement: STATEMENT, machineEvidence: MACHINE_EVIDENCE });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "not_a_curator", `expected not_a_curator for ${machineActor}`);
    }
    // vault_curators has no machine role to register one under.
    assert.throws(
      () => db.prepare(`INSERT INTO vault_curators (curator_id, display_name, role) VALUES ('bot','Bot','machine_curator')`).run(),
      /CHECK constraint failed/,
    );
  });

  it("a statement that merely copies the machine's words is refused (no laundering)", () => {
    const db = setup();
    const id = submitWork(db);
    const copied = MACHINE_EVIDENCE.recommendation; // verbatim
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: copied, machineEvidence: MACHINE_EVIDENCE });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "curator_statement_is_machine_evidence");

    // Case/whitespace padding doesn't get around it either.
    const padded = `   ${copied.toUpperCase()}\n\n `;
    const r2 = admit(db, id, { curatorId: FOUNDER, curatorStatement: padded, machineEvidence: MACHINE_EVIDENCE });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "curator_statement_is_machine_evidence");

    // Direct unit check of the detector, both directions.
    assert.equal(statementIsMachineEvidence(MACHINE_EVIDENCE, copied), true);
    assert.equal(statementIsMachineEvidence(MACHINE_EVIDENCE, STATEMENT), false);
    assert.equal(statementIsMachineEvidence(null, STATEMENT), false);
  });

  it("machine evidence IS welcome — stored in its own labeled column, beside (never as) the decision", () => {
    const db = setup();
    const id = submitWork(db);
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT, machineEvidence: MACHINE_EVIDENCE });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.machineEvidenceStored, true);

    const row = db.prepare("SELECT * FROM vault_submissions WHERE id=?").get(id);
    // Two distinct columns. Neither is derived from the other.
    assert.deepEqual(JSON.parse(row.machine_evidence_json), MACHINE_EVIDENCE);
    assert.equal(row.curator_statement, STATEMENT);
    assert.notEqual(row.curator_statement, row.machine_evidence_json);

    // The record DTU keeps them apart and labels the machine half.
    const data = JSON.parse(db.prepare("SELECT data FROM dtus WHERE id=?").get(row.record_dtu_id).data);
    assert.equal(data.core.admission.curatorStatement, STATEMENT);
    assert.equal(data.core.admission.statementAuthorship, "human");
    assert.deepEqual(data.core.machineEvidence, MACHINE_EVIDENCE);
    assert.equal(data.core.machineEvidenceRole, "organizing_evidence_only__never_a_decision");
    assert.equal(data.machine.verifier, "human_curator");
  });

  it("a retired curator can no longer admit — but their past attributions stand", () => {
    const db = setup();
    assert.equal(inviteGuestCurator(db, FOUNDER, { curatorId: GUEST, displayName: "Guest Curator" }).ok, true);

    const first = submitWork(db);
    assert.equal(admit(db, first, { curatorId: GUEST, curatorStatement: STATEMENT }).ok, true);

    assert.equal(retireCurator(db, FOUNDER, { curatorId: GUEST, reason: "term ended" }).ok, true);

    const second = submitWork(db, { title: "Another Work" });
    const r = admit(db, second, { curatorId: GUEST, curatorStatement: STATEMENT });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "curator_retired");

    // Permanence of attribution: the earlier admission still names the guest.
    assert.equal(db.prepare("SELECT admitted_by FROM vault_submissions WHERE id=?").get(first).admitted_by, GUEST);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("INVARIANT 3 — declines are private; there is no public rejection list", () => {
  function setupWithBoth() {
    const db = setup();
    const admittedId = submitWork(db, { title: "Admitted Work" });
    assert.equal(admit(db, admittedId, { curatorId: FOUNDER, curatorStatement: STATEMENT }).ok, true);
    const declinedId = submitWork(db, { title: "Declined Work" });
    const d = decline(db, declinedId, { curatorId: FOUNDER, reason: "Derivative of an existing record." });
    assert.equal(d.ok, true);
    assert.equal(d.status, "declined");
    return { db, admittedId, declinedId };
  }

  it("browse() returns admitted records only — and offers no argument that widens it", () => {
    const { db, admittedId, declinedId } = setupWithBoth();

    const plain = browse(db);
    assert.equal(plain.ok, true);
    assert.equal(plain.count, 1);
    assert.equal(plain.records[0].id, admittedId);

    // Every shape a caller might try to smuggle a status filter through.
    for (const attempt of [
      { status: "declined" },
      { status: ["declined", "admitted"] },
      { includeDeclined: true },
      { workKind: "music", status: "declined" },
      { curatorId: FOUNDER, status: "declined" },
      { limit: 999, status: "declined" },
    ]) {
      const r = browse(db, attempt);
      assert.equal(r.ok, true);
      const ids = r.records.map((x) => x.id);
      assert.ok(!ids.includes(declinedId), `browse leaked a decline for ${JSON.stringify(attempt)}`);
      assert.ok(r.records.every((x) => x.status === "admitted"));
    }

    // The public record shape carries no decline field at all.
    const rec = plain.records[0];
    for (const leaky of ["declineReason", "decline_reason", "declinedBy", "declinedAt"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(rec, leaky), false, `public shape exposes ${leaky}`);
    }
  });

  it("publicRecord() on a declined submission is not_found — it does not exist publicly", () => {
    const { db, admittedId, declinedId } = setupWithBoth();
    assert.equal(publicRecord(db, admittedId).ok, true);
    const r = publicRecord(db, declinedId);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
    assert.equal(r.record, undefined);
  });

  it("the curator-scoped path CAN see the decline and its reason", () => {
    const { db, declinedId } = setupWithBoth();
    const q = curatorQueue(db, FOUNDER, { status: "declined" });
    assert.equal(q.ok, true);
    assert.equal(q.count, 1);
    assert.equal(q.submissions[0].id, declinedId);
    assert.equal(q.submissions[0].declineReason, "Derivative of an existing record.");
    assert.equal(q.submissions[0].declinedBy, FOUNDER);
  });

  it("a non-curator gets no queue at all — not an empty list, an honest refusal", () => {
    const { db } = setupWithBoth();
    for (const actor of ["random_user", SUBMITTER, "agent_curator_bot", null]) {
      const r = curatorQueue(db, actor, { status: "declined" });
      assert.equal(r.ok, false);
      assert.equal(r.submissions, undefined);
      assert.ok(["not_a_curator", "curator_required"].includes(r.reason), `unexpected reason ${r.reason}`);
    }
  });

  it("the submitter may read the outcome addressed to them — that is not a public list", () => {
    const { db, declinedId } = setupWithBoth();
    const mine = mySubmissions(db, SUBMITTER);
    assert.equal(mine.ok, true);
    const declined = mine.submissions.find((s) => s.id === declinedId);
    assert.equal(declined.status, "declined");
    assert.equal(declined.declineReason, "Derivative of an existing record.");
    // …and a different user's listing contains nothing of theirs.
    assert.equal(mySubmissions(db, "random_user").count, 0);
  });

  it("a decline requires a reason and cannot be issued by a non-curator", () => {
    const db = setup();
    const id = submitWork(db);
    assert.equal(decline(db, id, { curatorId: FOUNDER, reason: "   " }).reason, "decline_reason_required");
    assert.equal(decline(db, id, { curatorId: "random_user", reason: "no" }).reason, "not_a_curator");
    assert.equal(db.prepare("SELECT status FROM vault_submissions WHERE id=?").get(id).status, "submitted");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("INVARIANT 4 — a guest curator's induction is attributed to the guest, not the founder", () => {
  it("the guest is the admitting curator everywhere the admission is recorded", () => {
    const db = setup();
    const invited = inviteGuestCurator(db, FOUNDER, { curatorId: GUEST, displayName: "Guest Curator" });
    assert.equal(invited.ok, true);
    assert.equal(invited.role, "guest_curator");
    assert.equal(invited.invitedBy, FOUNDER);

    const id = submitWork(db);
    const r = admit(db, id, { curatorId: GUEST, curatorStatement: STATEMENT });
    assert.equal(r.ok, true, JSON.stringify(r));

    // Result envelope.
    assert.equal(r.admittedBy, GUEST);
    assert.equal(r.admittedByRole, "guest_curator");
    assert.equal(r.curatorDisplayName, "Guest Curator");
    assert.notEqual(r.admittedBy, FOUNDER);

    // Stored row.
    const row = db.prepare("SELECT * FROM vault_submissions WHERE id=?").get(id);
    assert.equal(row.admitted_by, GUEST);
    assert.equal(row.admitted_by_role, "guest_curator");
    assert.equal(row.curator_statement_by, GUEST);

    // Permanent record DTU — the founder appears ONLY as the inviter.
    const data = JSON.parse(db.prepare("SELECT data FROM dtus WHERE id=?").get(row.record_dtu_id).data);
    assert.equal(data.core.admission.curatorId, GUEST);
    assert.equal(data.core.admission.curatorDisplayName, "Guest Curator");
    assert.equal(data.core.admission.curatorRole, "guest_curator");
    assert.equal(data.core.admission.invitedBy, FOUNDER);
    assert.match(data.human.summary, /admitted to TheVault by Guest Curator/);

    // Public browse attributes it to the guest, and filtering by the founder
    // finds nothing — the founder did not induct this work.
    assert.equal(browse(db, { curatorId: GUEST }).count, 1);
    assert.equal(browse(db, { curatorId: FOUNDER }).count, 0);
  });

  it("only the founding curator invites; only one founding curator exists", () => {
    const db = setup();
    assert.equal(inviteGuestCurator(db, FOUNDER, { curatorId: GUEST, displayName: "Guest Curator" }).ok, true);

    // A guest cannot mint further curators.
    const chain = inviteGuestCurator(db, GUEST, { curatorId: "user_third", displayName: "Third" });
    assert.equal(chain.ok, false);
    assert.equal(chain.reason, "only_founding_curator_may_invite");

    // A non-curator certainly cannot.
    assert.equal(inviteGuestCurator(db, "random_user", { curatorId: "x", displayName: "X" }).reason, "not_a_curator");

    // The founding seat is not re-assignable.
    const second = installFoundingCurator(db, { curatorId: "user_usurper", displayName: "Usurper" });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "founding_curator_already_installed");
    assert.equal(second.curatorId, FOUNDER);

    // …and the founding seat cannot be retired away.
    assert.equal(retireCurator(db, FOUNDER, { curatorId: FOUNDER }).reason, "founding_curator_cannot_be_retired");
  });

  it("SQLITE ITSELF refuses a guest curator with no inviter", () => {
    const db = setup();
    assert.throws(
      () => db.prepare(
        `INSERT INTO vault_curators (curator_id, display_name, role, invited_by) VALUES (?,?, 'guest_curator', NULL)`,
      ).run("orphan_guest", "Orphan"),
      /CHECK constraint failed: chk_vault_guest_needs_inviter/,
    );
    assert.throws(
      () => db.prepare(
        `INSERT INTO vault_curators (curator_id, display_name, role, invited_by) VALUES (?,?, 'guest_curator', '  ')`,
      ).run("orphan_guest2", "Orphan2"),
      /CHECK constraint failed: chk_vault_guest_needs_inviter/,
    );
    assert.equal(getCurator(db, "orphan_guest"), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DTU convention — type / creator_id / data / world_id, verified against its real readers", () => {
  function admitOne(db, over = {}) {
    const id = submitWork(db, over);
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r;
  }

  it("the record row uses type/creator_id/data/world_id, with world_id set EXPLICITLY", () => {
    const db = setup();
    const r = admitOne(db);
    const row = db.prepare("SELECT * FROM dtus WHERE id=?").get(r.recordDtuId);

    assert.equal(row.type, VAULT_DTU_TYPE);
    assert.equal(row.type, "vault_record");
    assert.equal(row.creator_id, SUBMITTER);        // the maker, not the curator
    assert.equal(row.world_id, VAULT_WORLD_ID);
    assert.equal(row.world_id, "concordia-hub");
    assert.notEqual(row.world_id, null);            // NULL would make it un-walkable
    assert.ok(row.data && row.data.length > 0);
    assert.equal(row.visibility, "public");
    assert.equal(JSON.parse(row.data).core.vaultSubmissionId, r.id);
  });

  it("cross-lens-discovery#searchDtus finds it — and the OTHER convention is invisible to that reader", () => {
    const db = setup();
    admitOne(db, { title: "Three Movements for an Empty Room" });

    const found = searchDtus(db, "Three Movements");
    assert.equal(found.ok, true);
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].kind, "vault_record");   // SELECT type AS kind
    assert.equal(found.results[0].creator_id, SUBMITTER);
    assert.ok(found.results[0].content, "record body text should be extractable");

    // Kind facet filtering also routes through `type`.
    assert.equal(searchDtus(db, "Three Movements", { kind: "vault_record" }).results.length, 1);

    // CONTROL — the same content written the OTHER way (owner_user_id /
    // body_json / tags_json, no `type`, no `data`) is NOT found. This is the
    // evidence for the convention choice, not an assumption about it.
    // (`dtus.owner_user_id` carries a real FK to `users`, which is itself why
    // the Vault record leaves that legacy column NULL and keys off
    // `creator_id`; the control needs a real user row to satisfy it.)
    db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at)
                VALUES (?, 'maker', 'maker@example.test', 'x', datetime('now'))`).run(SUBMITTER);
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility)
      VALUES ('dtu_control_legacy', ?, 'Three Movements Legacy Copy', ?, '["vault"]', 'public')
    `).run(SUBMITTER, JSON.stringify({ summary: "A legacy-convention copy." }));

    const after = searchDtus(db, "Three Movements");
    assert.equal(after.results.length, 1, "legacy-convention row must stay invisible to searchDtus");
    assert.equal(after.results[0].id.startsWith("dtu_vault_"), true);
    // It is genuinely in the table — it is only invisible to this reader.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus WHERE title LIKE '%Three Movements%'").get().n, 2);
  });

  it("dtu-props#propPlacementsForWorld places it in concordia-hub; a NULL-world_id row is un-walkable", () => {
    const db = setup();
    const r = admitOne(db);

    // A control row with everything right EXCEPT world_id.
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, world_id, visibility)
      VALUES ('dtu_control_noworld', 'vault_record', 'No World Record', ?, '{}', NULL, 'public')
    `).run(SUBMITTER);

    const placed = propPlacementsForWorld(db, VAULT_WORLD_ID, { requesterId: null });
    assert.equal(placed.ok, true);
    const ids = placed.placements.map((p) => p.dtuId);
    assert.ok(ids.includes(r.recordDtuId), "admitted record must be walkable in concordia-hub");
    assert.ok(!ids.includes("dtu_control_noworld"), "a NULL world_id row is invisible to the world lens");

    // Honest note recorded as an assertion: 'vault_record' matches none of
    // slotForDtuType's keywords, so it lands in the default public bucket.
    const mine = placed.placements.find((p) => p.dtuId === r.recordDtuId);
    assert.equal(mine.slot, "plaza");
    assert.equal(mine.readableType, "vault_record");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("lineage — `lineage`, never `parents`", () => {
  it("a submission carrying `parents` is refused outright", () => {
    const db = setup();
    const r = submit(db, SUBMITTER, { title: "Derived Work", workKind: "music", parents: ["dtu_a"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "use_lineage_not_parents");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vault_submissions").get().n, 0);
  });

  it("declared lineage registers a REAL royalty_lineage edge on admission", () => {
    const db = setup();
    // A public parent DTU owned by someone other than the submitter.
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, world_id, visibility)
      VALUES ('dtu_parent_public', 'knowledge', 'Source Study', 'user_other', '{}', ?, 'public')
    `).run(VAULT_WORLD_ID);

    const id = submitWork(db, { title: "Derived Work", lineage: ["dtu_parent_public"] });
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.citations.length, 1);
    assert.equal(r.citations[0].ok, true, JSON.stringify(r.citations));

    const edge = db.prepare(
      `SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = 'dtu_parent_public'`,
    ).get(r.recordDtuId);
    assert.ok(edge, "a real royalty_lineage edge must exist");
    assert.equal(edge.generation, 1);
    assert.equal(edge.creator_id, SUBMITTER);
  });

  it("a self-owned parent is SKIPPED honestly, and a missing parent is reported, never faked", () => {
    const db = setup();
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, world_id, visibility)
      VALUES ('dtu_parent_self', 'knowledge', 'My Own Study', ?, '{}', ?, 'public')
    `).run(SUBMITTER, VAULT_WORLD_ID);

    const id = submitWork(db, { lineage: ["dtu_parent_self", "dtu_missing"] });
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(r.ok, true);
    assert.equal(r.citations.length, 2);
    assert.deepEqual(r.citations.map((c) => c.error), ["self_owned_skipped", "parent_not_found"]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM royalty_lineage WHERE child_id=?").get(r.recordDtuId).n, 0);
    // The admission itself is unaffected — a citation problem never reverses a human decision.
    assert.equal(db.prepare("SELECT status FROM vault_submissions WHERE id=?").get(id).status, "admitted");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("permanence hook — the clearly-named seam the pinning unit plugs into", () => {
  it("reports honestly that nothing is registered rather than faking protection", () => {
    const db = setup();
    setAdmissionProtectionHandler(null);
    const id = submitWork(db);
    const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
    assert.equal(r.ok, true);
    assert.deepEqual(r.protection, { applied: false, reason: "no_handler_registered" });
    assert.equal(db.prepare("SELECT protection_flags_json FROM vault_submissions WHERE id=?").get(id).protection_flags_json, null);
  });

  it("invokes a registered handler with the record context and persists its flags", () => {
    const db = setup();
    const seen = [];
    setAdmissionProtectionHandler((c) => { seen.push(c); return { pinned: true, replicas: 3 }; });
    try {
      const id = submitWork(db);
      const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
      assert.equal(r.ok, true);
      assert.deepEqual(r.protection, { applied: true, flags: { pinned: true, replicas: 3 } });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].submissionId, id);
      assert.equal(seen[0].recordDtuId, r.recordDtuId);
      assert.equal(seen[0].curatorId, FOUNDER);
      assert.equal(seen[0].submitterId, SUBMITTER);
      assert.equal(seen[0].worldId, VAULT_WORLD_ID);
      assert.ok(seen[0].db);
      assert.deepEqual(
        JSON.parse(db.prepare("SELECT protection_flags_json FROM vault_submissions WHERE id=?").get(id).protection_flags_json),
        { pinned: true, replicas: 3 },
      );
    } finally { setAdmissionProtectionHandler(null); }
  });

  it("a throwing handler never reverses the human's admission", () => {
    const db = setup();
    setAdmissionProtectionHandler(() => { throw new Error("pin service down"); });
    try {
      const id = submitWork(db);
      const r = admit(db, id, { curatorId: FOUNDER, curatorStatement: STATEMENT });
      assert.equal(r.ok, true);
      assert.equal(r.protection.applied, false);
      assert.equal(r.protection.reason, "handler_threw");
      assert.equal(db.prepare("SELECT status FROM vault_submissions WHERE id=?").get(id).status, "admitted");
    } finally { setAdmissionProtectionHandler(null); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("macro registration", () => {
  it("registers the vault domain's macros without touching server.js", async () => {
    const mod = await import("../domains/vault.js");
    const registered = new Map();
    mod.default((domain, action, handler) => registered.set(`${domain}.${action}`, handler));
    for (const key of [
      "vault.submit", "vault.withdraw", "vault.my_submissions",
      "vault.browse", "vault.record", "vault.curators",
      "vault.queue", "vault.open_review", "vault.admit", "vault.decline",
      "vault.install_founding_curator", "vault.invite_curator", "vault.retire_curator",
    ]) {
      assert.equal(typeof registered.get(key), "function", `${key} not registered`);
    }

    // The domain is reachable from domains/index.js (registration-only wire).
    const index = await import("../domains/index.js");
    assert.ok(index.default.includes(mod.default), "vault must be in the domains/index.js module array");
  });

  it("stays visible to scripts/verify-lens-backends.mjs — literal (domain, macro) pairs, no name indirection", async () => {
    // The verifier discovers macro domains with a regex that requires the
    // domain AND macro name as ADJACENT STRING LITERALS. A helper that
    // forwards the macro name as a variable registers fine at runtime while
    // making the whole domain invisible to the static wiring check — the
    // abstraction-defeats-the-scan trap CLAUDE.md records for
    // `_tickRssDomain`. This pins the literals so a future tidy-up cannot
    // silently un-wire the domain from the verifier's view.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../domains/vault.js", import.meta.url), "utf8");
    // Character classes are `\-`-free here only to satisfy no-useless-escape;
    // with `-` last they are identical to the verifier's `[a-zA-Z0-9_.\-]`.
    const verifierRe = /\b(?:register|registerLensAction)\(\s*["'`]([a-zA-Z0-9_.-]+)["'`]\s*,\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;
    const found = [...src.matchAll(verifierRe)];
    assert.ok(found.length >= 13, `verifier regex sees only ${found.length} vault registrations`);
    assert.ok(found.every((m) => m[1] === "vault"));
    assert.ok(found.some((m) => m[2] === "admit"));
  });

  it("the admit macro takes the curator from the AUTHENTICATED actor, never from the payload", () => {
    const db = setup();
    const id = submitWork(db);
    const registered = new Map();
    registerVaultActions((domain, action, handler) => registered.set(`${domain}.${action}`, handler));

    // A caller naming the founder while authenticated as nobody-in-particular.
    const res = registered.get("vault.admit")(
      { db, actor: { userId: "random_user" } },
      null,
      { submissionId: id, curatorId: FOUNDER, curatorStatement: STATEMENT },
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not_a_curator");
    assert.equal(db.prepare("SELECT status FROM vault_submissions WHERE id=?").get(id).status, "submitted");

    // The real curator, authenticated as themselves, succeeds.
    const ok = registered.get("vault.admit")(
      { db, actor: { userId: FOUNDER } }, null, { submissionId: id, curatorStatement: STATEMENT },
    );
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.admittedBy, FOUNDER);
  });
});
