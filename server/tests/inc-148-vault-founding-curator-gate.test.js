// INC-148 — vault.install_founding_curator was first-come-first-served for
// ANY authenticated member. The founding-curator slot is single, permanent
// and cannot be retired, and live had none installed, so the first member to
// call it would own TheVault (admit permanent records, invite curators, read
// every decline). Found live 2026-10-19 by the usability loop with a
// non-mutating probe (empty displayName reached the function and returned
// missing_display_name). The macro now requires a founder/sovereign actor.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upVault } from "../migrations/396_vault_records.js";
import registerVaultActions, { listCurators, FOUNDING_CURATOR_ROLES } from "../domains/vault.js";

function macros() {
  const m = new Map();
  registerVaultActions((d, a, h) => m.set(`${d}.${a}`, h));
  return m;
}
const freshDb = () => { const db = new Database(":memory:"); upVault(db); return db; };

describe("INC-148 vault founding-curator gate", () => {
  it("only founder/sovereign roles are allowed", () => {
    assert.deepEqual(FOUNDING_CURATOR_ROLES, ["founder", "sovereign"]);
  });

  for (const role of [undefined, "", "member", "user", "owner", "admin", "guest", "FOUNDERX"]) {
    it(`a ${role === undefined ? "role-less" : JSON.stringify(role)} actor is refused and nothing is written`, () => {
      const db = freshDb();
      const install = macros().get("vault.install_founding_curator");
      const r = install({ db, actor: { userId: "u_member", role } }, null, { displayName: "Me" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "founder_only");
      assert.match(r.error, /insufficient permission/i);
      assert.equal(listCurators(db).length, 0);
    });
  }

  it("refuses before validation (an empty name from a member is founder_only, not missing_display_name)", () => {
    const db = freshDb();
    const r = macros().get("vault.install_founding_curator")({ db, actor: { userId: "u", role: "member" } }, null, { displayName: "" });
    assert.equal(r.reason, "founder_only");
  });

  it("payload cannot smuggle a role", () => {
    const db = freshDb();
    const r = macros().get("vault.install_founding_curator")(
      { db, actor: { userId: "u", role: "member" } }, { data: { role: "founder" } }, { displayName: "Me", role: "founder" });
    assert.equal(r.reason, "founder_only");
    assert.equal(listCurators(db).length, 0);
  });

  for (const role of ["founder", "sovereign", "Founder"]) {
    it(`${role} installs the founding curator once, as themselves`, () => {
      const db = freshDb();
      const install = macros().get("vault.install_founding_curator");
      const r = install({ db, actor: { userId: "u_founder", role } }, null, { displayName: "Founding Curator", curatorId: "someone_else" });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.curatorId, "u_founder");
      const again = install({ db, actor: { userId: "u_founder2", role } }, null, { displayName: "Second" });
      assert.equal(again.reason, "founding_curator_already_installed");
      assert.equal(listCurators(db).length, 1);
    });
  }

  it("anonymous (no actor) still gets no_actor", () => {
    const db = freshDb();
    const r = macros().get("vault.install_founding_curator")({ db }, null, { displayName: "x" });
    assert.equal(r.reason, "no_actor");
  });
});
