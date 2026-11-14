// server/tests/slice-b7-vault-001.test.js
//
// FIX-vault-001 — a submission can be edited before review, and a
// withdrawn submission can be removed from the submitter's list.
// The vault is a real-DB domain (better-sqlite3), so this suite runs
// in the desk's batch checks / CI, not in this VM's lockfile env.
//
//   - updateSubmission: submitter-only, `submitted` status only;
//     title/description/body round-trip; empty title refused;
//     under_review is wrong_state (a curator is reading the work).
//   - removeSubmission: submitter-only, `withdrawn` status only at first;
//     the DTU verb slice (CB-0554 (1) carried leg) extends it to
//     `declined`, which could neither withdraw nor be removed before;
//     live/admitted rows are refused (admitted is permanent);
//     the row is gone from mySubmissions afterwards.
//
// Run: node --test server/tests/slice-b7-vault-001.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upCore } from "../migrations/001_core_tables.js";
import { up as upEconomy } from "../migrations/008_economic_system.js";
import { up as upDtuCols } from "../migrations/087_dtus_type_creator_data.js";
import { up as upDtuWorld } from "../migrations/225_dtu_world_id.js";
import { up as upVault } from "../migrations/396_vault_records.js";

import { submit, withdraw, updateSubmission, removeSubmission, mySubmissions } from "../domains/vault.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  upCore(db);
  upEconomy(db);
  upDtuCols(db);
  upDtuWorld(db);
  upVault(db);
});

function postWork(userId = "u1") {
  const r = submit(db, userId, {
    title: "A small study of light",
    workKind: "other",
    description: "A study in one movement.",
    body: "The light arrives before the sentence does.",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.id;
}

describe("FIX-vault-001 edit before review", () => {
  it("edits title/description/body while still submitted, and reads back", () => {
    const id = postWork();
    const edited = updateSubmission(db, id, "u1", {
      title: "A larger study of light",
      description: "A study in two movements.",
      body: "The light arrives, and stays.",
    });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    const [row] = mySubmissions(db, "u1").submissions;
    assert.equal(row.title, "A larger study of light");
    assert.equal(row.description, "A study in two movements.");
    assert.equal(row.body, "The light arrives, and stays.");
  });

  it("refuses a stranger, an empty title, and a work under review", () => {
    const id = postWork();
    assert.equal(updateSubmission(db, id, "u9", { title: "Hijacked" }).reason, "not_submitter");
    assert.equal(updateSubmission(db, id, "u1", { title: "   " }).reason, "missing_title");
    // A curator has opened review: the work is read as submitted.
    db.prepare(`UPDATE vault_submissions SET status = 'under_review' WHERE id = ?`).run(id);
    const late = updateSubmission(db, id, "u1", { title: "Too late" });
    assert.equal(late.ok, false);
    assert.equal(late.reason, "wrong_state");
    assert.equal(mySubmissions(db, "u1").submissions[0].title, "A small study of light");
  });
});

describe("FIX-vault-001 remove a withdrawn submission", () => {
  it("a withdrawn work can be removed by its submitter and is gone from the list", () => {
    const id = postWork();
    // Live rows cannot be removed — withdraw first.
    const live = removeSubmission(db, id, "u1");
    assert.equal(live.ok, false);
    assert.equal(live.reason, "wrong_state");
    assert.equal(withdraw(db, id, "u1").ok, true);
    const removed = removeSubmission(db, id, "u1");
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
    assert.equal(mySubmissions(db, "u1").submissions.length, 0);
    assert.equal(removeSubmission(db, id, "u1").reason, "not_found");
  });

  it("refuses a stranger and an admitted record, which stays permanent", () => {
    const id = postWork();
    assert.equal(withdraw(db, id, "u1").ok, true);
    assert.equal(removeSubmission(db, id, "u9").reason, "not_submitter");
    assert.equal(mySubmissions(db, "u1").submissions.length, 1);

    const admitted = postWork();
    db.prepare(`UPDATE vault_submissions SET status = 'admitted' WHERE id = ?`).run(admitted);
    const r = removeSubmission(db, admitted, "u1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "admitted_records_are_permanent");
    assert.equal(mySubmissions(db, "u1").submissions.length, 2);
  });

  it("a declined work can be removed by its submitter (DTU verb carried leg)", () => {
    const id = postWork();
    db.prepare(`UPDATE vault_submissions SET status = 'declined' WHERE id = ?`).run(id);
    // A declined work cannot take the withdraw-first path — withdraw
    // refuses non-live states, which is the dead end this leg closes.
    assert.equal(withdraw(db, id, "u1").reason, "wrong_state");
    assert.equal(removeSubmission(db, id, "u9").reason, "not_submitter");
    const removed = removeSubmission(db, id, "u1");
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
    assert.equal(mySubmissions(db, "u1").submissions.length, 2);
  });
});
